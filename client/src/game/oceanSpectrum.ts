/**
 * The wind sea's spectrum, Babylon-free and tested under Node: JONSWAP in
 * frequency, cos-2s spreading in direction, the wavenumber band each of the
 * high tier's three cascades carries, and Tessendorf's starting amplitudes
 * h0(k) for a cascade, drawn from a seeded hash so every peer draws the same
 * sea. The swell is not here: it is analytic (`oceanSwell.ts`), and this
 * spectrum is the wind sea's alone, so nothing is counted twice.
 *
 * Render-side only; `Math.pow`, `Math.exp` and friends are fine here.
 * See docs/rendering/2026-10-02-ocean-waves-design.md §6.
 */
import { OCEAN_G } from "./oceanPhysics.js";
import { fftWaveIndex, type SpectrumH0 } from "./oceanFft.js";

/** Grid size of each of the high tier's cascades. */
export const FFT_N = 256;
/** The high tier's three cascades, metres across: the largest long enough for
 * the wind sea's longest waves, the smallest for its chop. */
export const FFT_CASCADES = [1000, 150, 25] as const;
/** The medium tier's loop: one cascade of LOOP_N², LOOP_SIZE metres across,
 * LOOP_FRAMES frames over LOOP_SECONDS. */
export const LOOP_N = 128;
export const LOOP_SIZE = 60;
export const LOOP_FRAMES = 64;
export const LOOP_SECONDS = 20;
/** Salt of the wind sea's random draws. */
export const WIND_SEA_SALT = 0x0ce4;
/** Fully developed sea for a wind U10 (m/s): Hs ≈ 0.28 U²/g, fp ≈ 0.123 g/U. */
export const WIND_SEA_HS_COEFF = 0.28;
export const WIND_SEA_FP_COEFF = 0.123;
/** The wind sea's directional spreading s (cos-2s), and its JONSWAP peak γ. */
export const WIND_SEA_SPREAD = 10;
export const WIND_SEA_GAMMA = 3.3;
/**
 * The wind sea repeats every this many seconds: each bin's ω is rounded to a
 * multiple of 2π/WIND_SEA_REPEAT (at most 0.003 rad/s away from √(gk)), so the
 * GPU can take the time folded into [0, WIND_SEA_REPEAT) and its
 * single-precision phase is as fine in the hundredth hour as in the first.
 */
export const WIND_SEA_REPEAT = 1024;

/** JONSWAP's peak width below and above the peak frequency. */
const SIGMA_BELOW = 0.07;
const SIGMA_ABOVE = 0.09;
/** Where the integral of the spectrum's shape switches from Simpson's rule
 * to the Pierson–Moskowitz tail's closed form (γ^r is 1 to double precision past it). */
const SHAPE_SPLIT = 3;
const SHAPE_STEPS = 6000;

/** JONSWAP's shape at x = f/fp: x⁻⁵ e^(−1.25 x⁻⁴) γ^r, r = e^(−(x − 1)²/(2σ²)). */
function jonswapShape(x: number, gamma: number): number {
  if (!(x > 0)) return 0;
  const x4 = x * x * x * x;
  const sigma = x <= 1 ? SIGMA_BELOW : SIGMA_ABOVE;
  const r = Math.exp(-((x - 1) * (x - 1)) / (2 * sigma * sigma));
  return (Math.exp(-1.25 / x4) / (x4 * x)) * Math.pow(gamma, r);
}

const shapeIntegrals = new Map<number, number>();

/** ∫₀^∞ of JONSWAP's shape over x = f/fp, for γ: Simpson's rule to x = 3,
 * then the tail's closed form, ∫ x⁻⁵ e^(−1.25 x⁻⁴) dx = e^(−1.25 x⁻⁴)/5. */
function shapeIntegral(gamma: number): number {
  const cached = shapeIntegrals.get(gamma);
  if (cached !== undefined) return cached;
  const h = SHAPE_SPLIT / SHAPE_STEPS;
  let sum = jonswapShape(SHAPE_SPLIT, gamma);
  for (let i = 1; i < SHAPE_STEPS; i++) sum += (i % 2 === 1 ? 4 : 2) * jonswapShape(i * h, gamma);
  const tail = (1 - Math.exp(-1.25 / SHAPE_SPLIT ** 4)) / 5;
  const total = (sum * h) / 3 + tail;
  shapeIntegrals.set(gamma, total);
  return total;
}

/**
 * The JONSWAP spectrum S(f) (m²/Hz) of significant height hs (m), peak
 * frequency fp (Hz) and peak enhancement γ, normalised so that
 * 4 √(∫ S df) = hs exactly (the shape's integral taken numerically, once per γ).
 */
export function jonswap(f: number, fp: number, hs: number, gamma: number): number {
  if (!(fp > 0) || !(hs > 0)) return 0;
  return (hs * hs * jonswapShape(f / fp, gamma)) / (16 * fp * shapeIntegral(gamma));
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x ≥ 1 (Lanczos, g = 7). */
function lnGamma(x: number): number {
  const y = x - 1;
  let a = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i]! / (y + i);
  const t = y + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * The cos-2s spreading D(θ) = N(s) cos^{2s}(θ/2), θ the angle from the mean
 * direction (any angle, wrapped to (−π, π]), N(s) = 2^{2s} Γ(s+1)² / (2π Γ(2s+1))
 * so that its integral over a turn is 1. s below 0 is taken as 0 (uniform).
 */
export function spreading(theta: number, s: number): number {
  const spread = Math.max(0, s);
  const wrapped = theta - 2 * Math.PI * Math.round(theta / (2 * Math.PI));
  const norm = Math.exp(2 * spread * Math.LN2 + 2 * lnGamma(spread + 1) - lnGamma(2 * spread + 1)) / (2 * Math.PI);
  return norm * Math.pow(Math.max(0, Math.cos(wrapped / 2)), 2 * spread);
}

/**
 * The wavenumber band (rad/m) each cascade carries, [kMin, kMax): band i ends
 * where band i + 1 begins, at four of cascade i + 1's fundamentals
 * (4 · 2π/size_{i+1}), so each finer cascade leaves its three longest, worst
 * sampled waves to the coarser one; the first begins at 0, the last ends at
 * its own Nyquist wavenumber, π n / size.
 */
export function cascadeBands(sizes: readonly number[], n: number): { kMin: number; kMax: number }[] {
  return sizes.map((size, i) => ({
    kMin: i === 0 ? 0 : (8 * Math.PI) / size,
    kMax: i === sizes.length - 1 ? (Math.PI * n) / size : (8 * Math.PI) / sizes[i + 1]!,
  }));
}

/** The seed of cascade `cascade`'s draws, so no two cascades draw the same numbers. */
export function windSeaCascadeSeed(seed: number, cascade: number): number {
  return (seed + Math.imul(cascade + 1, 0x9e3779b9)) >>> 0;
}

/** A 32-bit integer mix (Wellons' lowbias32). */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A uniform number in [0, 1) from the seed, the bin and a lane. */
function unit(seed: number, row: number, col: number, lane: number): number {
  const h = mix32(mix32(mix32(seed ^ 0x9e3779b9) ^ row) ^ ((col << 1) | lane));
  return (h >>> 8) / 16777216;
}

/** Simpson intervals of the band's share of the spectrum. */
const BAND_STEPS = 4096;

/** The variance (m²) of the JONSWAP sea between wavenumbers kMin and kMax in
 * deep water: ∫ S df between their frequencies √(gk)/2π. */
function bandVariance(fp: number, hs: number, kMin: number, kMax: number): number {
  const fLo = Math.sqrt(OCEAN_G * kMin) / (2 * Math.PI);
  const fHi = Math.sqrt(OCEAN_G * kMax) / (2 * Math.PI);
  const h = (fHi - fLo) / BAND_STEPS;
  let sum = jonswap(fLo, fp, hs, WIND_SEA_GAMMA) + jonswap(fHi, fp, hs, WIND_SEA_GAMMA);
  for (let i = 1; i < BAND_STEPS; i++) sum += (i % 2 === 1 ? 4 : 2) * jonswap(fLo + i * h, fp, hs, WIND_SEA_GAMMA);
  return (sum * h) / 3;
}

/**
 * Tessendorf's h0(k) for the wind sea on one cascade: n × n bins on a tile
 * `size` metres across, in FFT order (`oceanFft.ts`). The sea is the fully
 * developed one for state.u10 (m/s, JONSWAP with Hs = WIND_SEA_HS_COEFF U²/g,
 * fp = WIND_SEA_FP_COEFF g/U, γ = WIND_SEA_GAMMA), spread by cos-2s
 * (s = WIND_SEA_SPREAD) about state.dir, the way the wind blows (x, z).
 * Each bin inside [band.kMin, band.kMax) gets
 * h0 = (ξ₁ + i ξ₂) · ½ Δk √(c F(k)), ξ standard normal from a hash of the
 * seed and the bin (Box–Muller), F(k) = S(f) (df/dk) D(θ) / k the spectrum
 * per unit area of wavenumber space at the bin's centre, Δk = 2π/size, and c the
 * one factor that makes the sum of c F Δk² over the band's bins equal the
 * band's share of the spectrum (the grid's coarse rings near a band's inner
 * edge would otherwise carry up to a fifth too much). So the field's expected
 * variance is that share. Bins outside the band, the DC bin and the Nyquist
 * row and column are zero. omega is deep water's √(g|k|) rounded to a multiple
 * of 2π/repeat (WIND_SEA_REPEAT by default), so the sea repeats every
 * `repeat` seconds. The same arguments give the same arrays.
 */
export function windSeaH0(
  n: number,
  size: number,
  state: { u10: number; dir: [number, number] },
  band: { kMin: number; kMax: number },
  seed: number,
  repeat: number = WIND_SEA_REPEAT,
): SpectrumH0 {
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  const omega = new Float32Array(n * n);
  const density = new Float64Array(n * n);
  const u = state.u10;
  const live = u > 0;
  const hs = live ? (WIND_SEA_HS_COEFF * u * u) / OCEAN_G : 0;
  const fp = live ? (WIND_SEA_FP_COEFF * OCEAN_G) / u : 0;
  const windAngle = Math.atan2(state.dir[1], state.dir[0]);
  const quantum = (2 * Math.PI) / repeat;
  const dk = (2 * Math.PI) / size;
  const nyquist = n / 2;
  let drawn = 0;
  for (let row = 0; row < n; row++) {
    const kz = dk * fftWaveIndex(row, n);
    for (let col = 0; col < n; col++) {
      const kx = dk * fftWaveIndex(col, n);
      const k = Math.hypot(kx, kz);
      const i = row * n + col;
      const w = Math.sqrt(OCEAN_G * k);
      omega[i] = Math.round(w / quantum) * quantum;
      if (!live || k === 0 || k < band.kMin || k >= band.kMax || row === nyquist || col === nyquist) continue;
      const sk = (jonswap(w / (2 * Math.PI), fp, hs, WIND_SEA_GAMMA) * OCEAN_G) / (4 * Math.PI * w);
      density[i] = (sk * spreading(Math.atan2(kz, kx) - windAngle, WIND_SEA_SPREAD)) / k;
      drawn += density[i]! * dk * dk;
    }
  }
  if (!(drawn > 0)) return { re, im, omega };
  const scale = bandVariance(fp, hs, band.kMin, band.kMax) / drawn;
  const salted = (seed ^ WIND_SEA_SALT) >>> 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      if (density[i] === 0) continue;
      const amplitude = 0.5 * dk * Math.sqrt(scale * density[i]!);
      const u1 = 1 - unit(salted, row, col, 0);
      const u2 = unit(salted, row, col, 1);
      const radius = Math.sqrt(-2 * Math.log(u1));
      re[i] = amplitude * radius * Math.cos(2 * Math.PI * u2);
      im[i] = amplitude * radius * Math.sin(2 * Math.PI * u2);
    }
  }
  return { re, im, omega };
}
