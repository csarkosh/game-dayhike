/**
 * The medium tier's wind sea (spec §6.3): one cascade, LOOP_N texels a side
 * over LOOP_SIZE metres, baked at load for WIND_SEA_U_REF blowing along +x
 * into LOOP_FRAMES frames of a LOOP_SECONDS loop, packed to half floats
 * (height, dx, dz, 0) for an RGBA16F texture array; and the numbers the
 * shaders scale it by. Babylon-free: the worker (`oceanLoop.worker.ts`) runs
 * it off the main thread and the tests run it under Node.
 *
 * A fully developed spectrum keeps its shape at every wind once lengths scale
 * by U² and times by U, so one bake serves every wind: the shaders sample the
 * tile at lengths and heights times loopScale = (U/U_ref)² and run its time
 * at loopRate = U_ref/U (`windSeaStateFor`), turned to the wind's direction.
 * Every frequency is a whole number of turns in LOOP_SECONDS (`windSeaH0`'s
 * `repeat`), so the last frame runs on into the first.
 */
import { OCEAN_G } from "./oceanPhysics.js";
import { WIND_SEA_CHOPPINESS, windSeaFields, type SpectrumH0 } from "./oceanFft.js";
import {
  LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE, WIND_SEA_FP_COEFF, WIND_SEA_GAMMA, WIND_SEA_HS_COEFF,
  cascadeBands, jonswap, windSeaH0,
} from "./oceanSpectrum.js";
import { WIND_SEA_U_REF } from "./oceanWindSea.js";

/** What the page asks the worker: the world's seed. */
export type LoopRequest = { seed: number };

/** What the worker answers: the loop's half floats, frame after frame, and
 * the two numbers the shaders normalise it by, measured on its first frame as
 * the texture holds it: the height's standard deviation (m, at
 * WIND_SEA_U_REF) and the slope variance of the central differences a texel
 * apart that `oceanWindSlopesAt` draws. */
export type LoopReply = {
  seed: number; frames: number; n: number; size: number;
  heightStd: number; slopeVar: number;
  data: Uint16Array<ArrayBuffer>;
};

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A number as an IEEE half float's bits, rounded to nearest, ties to even. */
export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant !== 0 ? 0x200 : 0);
  const e = exp - 112;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    let half = m >>> shift;
    const rest = m & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rest > mid || (rest === mid && (half & 1) === 1)) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1)) half++;
  return sign | half;
}

/** A half float's bits as a number. */
export function fromHalf(bits: number): number {
  const sign = (bits & 0x8000) !== 0 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** The loop's spectrum: the cascade at WIND_SEA_U_REF along +x, its frequencies
 * whole turns in LOOP_SECONDS. */
export function loopSpectrum(seed: number): SpectrumH0 {
  const band = cascadeBands([LOOP_SIZE], LOOP_N)[0] as { kMin: number; kMax: number };
  return windSeaH0(LOOP_N, LOOP_SIZE, { u10: WIND_SEA_U_REF, dir: [1, 0] }, band, seed, LOOP_SECONDS);
}

/** One frame at t seconds as floats, four a texel: (height, dx, dz, 0). */
export function loopFrame(spectrum: SpectrumH0, t: number): Float32Array {
  const f = windSeaFields(spectrum, LOOP_N, LOOP_SIZE, t, WIND_SEA_CHOPPINESS);
  const out = new Float32Array(LOOP_N * LOOP_N * 4);
  for (let i = 0; i < LOOP_N * LOOP_N; i++) {
    out[i * 4] = f.height[i] as number;
    out[i * 4 + 1] = f.dx[i] as number;
    out[i * 4 + 2] = f.dz[i] as number;
  }
  return out;
}

/** The whole loop: LOOP_FRAMES frames LOOP_SECONDS / LOOP_FRAMES apart, half floats. */
export function bakeWindSeaLoop(seed: number): Uint16Array<ArrayBuffer> {
  const spectrum = loopSpectrum(seed);
  const layer = LOOP_N * LOOP_N * 4;
  const out = new Uint16Array(LOOP_FRAMES * layer);
  for (let f = 0; f < LOOP_FRAMES; f++) {
    const frame = loopFrame(spectrum, (f * LOOP_SECONDS) / LOOP_FRAMES);
    for (let i = 0; i < layer; i++) out[f * layer + i] = toHalf(frame[i] as number);
  }
  return out;
}

/** The height's standard deviation and the slope variance of a frame of the
 * packed loop, as the shaders draw it: the mean square of the central
 * differences a texel apart along x and along z, wrapping, summed. */
export function loopStats(data: Uint16Array, frame: number): { heightStd: number; slopeVar: number } {
  const n = LOOP_N;
  const base = frame * n * n * 4;
  const h = (col: number, row: number): number => fromHalf(data[base + ((((row % n) + n) % n) * n + (((col % n) + n) % n)) * 4] as number);
  const step = (2 * LOOP_SIZE) / n;
  let sum = 0;
  let sumSq = 0;
  let slope = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const v = h(col, row);
      sum += v;
      sumSq += v * v;
      const gx = (h(col + 1, row) - h(col - 1, row)) / step;
      const gz = (h(col, row + 1) - h(col, row - 1)) / step;
      slope += gx * gx + gz * gz;
    }
  }
  const count = n * n;
  const mean = sum / count;
  return { heightStd: Math.sqrt(Math.max(0, sumSq / count - mean * mean)), slopeVar: slope / count };
}

/** The worker's whole job: bake the seed's loop and measure it. */
export function loopReply(request: LoopRequest): LoopReply {
  const data = bakeWindSeaLoop(request.seed);
  const { heightStd, slopeVar } = loopStats(data, 0);
  return { seed: request.seed, frames: LOOP_FRAMES, n: LOOP_N, size: LOOP_SIZE, heightStd, slopeVar, data };
}

/** Simpson intervals of a band's share, as `windSeaH0` normalises its bins by. */
const BAND_STEPS = 4096;

/**
 * The share of the fully developed sea at u10 (m/s) between two wavenumbers
 * in deep water: the height variance ∫S df (m²), exactly what `windSeaH0`
 * scales a cascade's bins to, and the slope variance ∫k²S df, k = (2πf)²/g,
 * between the band's frequencies √(gk)/2π. Zero for no wind.
 */
export function windSeaBandStats(u10: number, band: { kMin: number; kMax: number }): { heightVar: number; slopeVar: number } {
  if (!(u10 > 0)) return { heightVar: 0, slopeVar: 0 };
  const hs = (WIND_SEA_HS_COEFF * u10 * u10) / OCEAN_G;
  const fp = (WIND_SEA_FP_COEFF * OCEAN_G) / u10;
  const fLo = Math.sqrt(OCEAN_G * band.kMin) / (2 * Math.PI);
  const fHi = Math.sqrt(OCEAN_G * band.kMax) / (2 * Math.PI);
  const h = (fHi - fLo) / BAND_STEPS;
  const k2 = (f: number): number => {
    const k = (2 * Math.PI * f) * (2 * Math.PI * f) / OCEAN_G;
    return k * k;
  };
  let heightSum = 0;
  let slopeSum = 0;
  for (let i = 0; i <= BAND_STEPS; i++) {
    const f = fLo + i * h;
    const weight = i === 0 || i === BAND_STEPS ? 1 : i % 2 === 1 ? 4 : 2;
    const s = jonswap(f, fp, hs, WIND_SEA_GAMMA);
    heightSum += weight * s;
    slopeSum += weight * k2(f) * s;
  }
  return { heightVar: (heightSum * h) / 3, slopeVar: (slopeSum * h) / 3 };
}
