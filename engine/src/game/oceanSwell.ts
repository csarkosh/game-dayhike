/**
 * The swell: the long waves that reach this coast from distant storms, drawn
 * once per world from its seed. Babylon-free (on BABYLON_FREE_FILES) and
 * render-side: nothing in `sim/` reads it, and nothing here enters the level id.
 *
 * The sea state (`swellStateFor`) is the real coast's range (buoy 46041): a
 * significant height log-normal about 1.9 m, a peak period rising with it,
 * a direction within 15° south and 30° north of the west-facing shore's
 * normal, a peaked spectrum and long crests. Its components
 * (`swellComponents`) are twelve trochoidal waves whose neighbouring
 * frequencies lie 0.005 to 0.01 Hz apart, so the two largest beat every 100 to
 * 200 s: the sets.
 *
 * Convention: the sea lies toward −x and the swell travels toward +x
 * (k0x > 0). A compass bearing θ the swell comes FROM travels at
 * α = θ − 270° measured from +x toward +z.
 */
import { hash3 } from "../sim/field.js";
import { OCEAN_G } from "./oceanPhysics.js";
import { jonswap, spreading } from "./oceanSpectrum.js";

export const SWELL_HS_MIN = 0.8;
export const SWELL_HS_MAX = 4.0;
export const SWELL_HS_MEDIAN = 1.9;
/** The log-normal σ of ln Hs. */
export const SWELL_HS_SIGMA = 0.45;
export const SWELL_TP_BASE = 7.5;
export const SWELL_TP_PER_HS = 1.6;
export const SWELL_TP_JITTER = 1;
export const SWELL_TP_MIN = 8;
export const SWELL_TP_MAX = 14;
/** Compass bearings the swell comes from (deg), and the most likely one: due west. */
export const SWELL_DIR_MIN_DEG = 255;
export const SWELL_DIR_MAX_DEG = 300;
export const SWELL_DIR_MODE_DEG = 270;
export const SWELL_GAMMA_MIN = 3.3;
export const SWELL_GAMMA_MAX = 7;
export const SWELL_SPREAD_MIN = 25;
export const SWELL_SPREAD_MAX = 75;
export const SWELL_COMPONENTS = 12;
export const SWELL_COMPONENTS_LOW = 8;
/** Neighbouring components' frequencies lie this far apart (Hz): sets every 100 to 200 s. */
export const SWELL_PAIR_DF_MIN = 0.005;
export const SWELL_PAIR_DF_MAX = 0.01;
/** The cap on Σ Q|K|A, applied where the swell is evaluated, so the surface never loops. */
export const SWELL_Q_SUM_MAX = 0.9;
export const SWELL_SALT = 0x5e11;
/** In frequency order, the component just below the peak: two below it, nine above. */
export const SWELL_PEAK_INDEX = 2;
/** No component travels more than this far (deg) from straight onshore. */
export const SWELL_TRAVEL_MAX_DEG = 60;
/** Each component's own steepness factor: a true trochoid, whose orbit radius is its amplitude. */
export const SWELL_Q0 = 1;

export type SwellState = { hs: number; tp: number; dirFromDeg: number; gamma: number; spread: number };
export type SwellComponent = { k0x: number; k0z: number; omega: number; a0: number; phase0: number; q0: number };

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;
/** Steps of the spreading's cumulative table over (−π, π]. */
const SPREAD_STEPS = 1024;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A triangular draw on [lo, hi] peaking at `mode`, from one uniform. */
function triangular(u: number, lo: number, mode: number, hi: number): number {
  const split = (mode - lo) / (hi - lo);
  return u < split
    ? lo + Math.sqrt(u * (hi - lo) * (mode - lo))
    : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

/** The world's swell: height, period, direction, peakedness and crest length. */
export function swellStateFor(seed: number): SwellState {
  const salted = seed ^ SWELL_SALT;
  // A standard normal by Box–Muller; 1 − u keeps the logarithm finite.
  const normal =
    Math.sqrt(-2 * Math.log(1 - hash3(0, 0, 0, salted))) * Math.cos(TWO_PI * hash3(0, 1, 0, salted));
  const hs = clamp(SWELL_HS_MEDIAN * Math.exp(SWELL_HS_SIGMA * normal), SWELL_HS_MIN, SWELL_HS_MAX);
  const jitter = SWELL_TP_JITTER * (2 * hash3(1, 0, 0, salted) - 1);
  const tp = clamp(SWELL_TP_BASE + SWELL_TP_PER_HS * hs + jitter, SWELL_TP_MIN, SWELL_TP_MAX);
  const dirFromDeg = triangular(hash3(2, 0, 0, salted), SWELL_DIR_MIN_DEG, SWELL_DIR_MODE_DEG, SWELL_DIR_MAX_DEG);
  const gamma = SWELL_GAMMA_MIN + (SWELL_GAMMA_MAX - SWELL_GAMMA_MIN) * hash3(3, 0, 0, salted);
  const spread = SWELL_SPREAD_MIN + (SWELL_SPREAD_MAX - SWELL_SPREAD_MIN) * hash3(4, 0, 0, salted);
  return { hs, tp, dirFromDeg, gamma, spread };
}

/** The spreading's inverse: the angle (rad, about the mean) below which a fraction `u` of its energy lies. */
function spreadAngle(u: number, cumulative: Float64Array): number {
  const total = cumulative[SPREAD_STEPS] as number;
  const target = u * total;
  let lo = 0;
  let hi = SPREAD_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] as number) <= target) lo = mid;
    else hi = mid;
  }
  const a = cumulative[lo] as number;
  const b = cumulative[hi] as number;
  const f = b > a ? (target - a) / (b - a) : 0;
  return -Math.PI + ((lo + f) / SPREAD_STEPS) * TWO_PI;
}

/**
 * The swell's components, largest first (the low tier takes the first
 * SWELL_COMPONENTS_LOW). Frequencies: a ladder whose neighbouring gaps are
 * drawn in [SWELL_PAIR_DF_MIN, SWELL_PAIR_DF_MAX], placed so the peak falls
 * between components SWELL_PEAK_INDEX and SWELL_PEAK_INDEX + 1. Each component
 * stands for an equal share of the band, its amplitude ∝ √S(f) of the world's
 * JONSWAP spectrum; that spectrum has one peak, so the two largest components
 * are neighbours on the ladder and beat at their gap: the sets come every
 * 1/Δf, 100 to 200 s. Amplitudes are then scaled so 4√(Σa²/2) = Hs exactly.
 * Directions are drawn from the spreading about the mean, held within
 * SWELL_TRAVEL_MAX_DEG of onshore; wavenumbers are deep water's, k0 = ω²/g;
 * phases are seeded; every q0 is SWELL_Q0.
 */
export function swellComponents(seed: number, state: SwellState): SwellComponent[] {
  const salted = seed ^ SWELL_SALT;
  const n = SWELL_COMPONENTS;
  const fp = 1 / state.tp;
  const gaps: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    gaps.push(SWELL_PAIR_DF_MIN + (SWELL_PAIR_DF_MAX - SWELL_PAIR_DF_MIN) * hash3(i, 0, 1, salted));
  }
  const m = SWELL_PEAK_INDEX;
  // The peak sits a seeded quarter to three quarters of the way across its gap.
  const straddle = 0.25 + 0.5 * hash3(0, 1, 1, salted);
  const freqs = new Array<number>(n).fill(0);
  freqs[m] = fp - straddle * (gaps[m] as number);
  for (let i = m + 1; i < n; i++) freqs[i] = (freqs[i - 1] as number) + (gaps[i - 1] as number);
  for (let i = m - 1; i >= 0; i--) freqs[i] = (freqs[i + 1] as number) - (gaps[i] as number);

  // The spreading's cumulative table, for this world's s.
  const cumulative = new Float64Array(SPREAD_STEPS + 1);
  const dTheta = TWO_PI / SPREAD_STEPS;
  let prev = spreading(-Math.PI, state.spread);
  for (let j = 1; j <= SPREAD_STEPS; j++) {
    const next = spreading(-Math.PI + j * dTheta, state.spread);
    cumulative[j] = (cumulative[j - 1] as number) + 0.5 * (prev + next) * dTheta;
    prev = next;
  }

  const mean = (state.dirFromDeg - 270) * DEG;
  const limit = SWELL_TRAVEL_MAX_DEG * DEG;
  const raw: number[] = freqs.map((f) => Math.sqrt(jonswap(f, fp, state.hs, state.gamma)));
  let energy = 0;
  for (const a of raw) energy += (a * a) / 2;
  const scale = state.hs / 4 / Math.sqrt(energy);

  const out: SwellComponent[] = [];
  for (let i = 0; i < n; i++) {
    const omega = TWO_PI * (freqs[i] as number);
    const k0 = (omega * omega) / OCEAN_G;
    const alpha = clamp(mean + spreadAngle(hash3(i, 2, 1, salted), cumulative), -limit, limit);
    out.push({
      k0x: k0 * Math.cos(alpha),
      k0z: k0 * Math.sin(alpha),
      omega,
      a0: (raw[i] as number) * scale,
      phase0: TWO_PI * hash3(i, 3, 1, salted),
      q0: SWELL_Q0,
    });
  }
  return out.sort((p, q) => q.a0 - p.a0);
}

/** The amplitude²-weighted unit vector the swell travels along, (x, z). */
export function swellTravelDirection(components: readonly SwellComponent[]): [number, number] {
  let x = 0;
  let z = 0;
  for (const c of components) {
    const k = Math.hypot(c.k0x, c.k0z);
    const w = c.a0 * c.a0;
    x += (w * c.k0x) / k;
    z += (w * c.k0z) / k;
  }
  const len = Math.hypot(x, z);
  return len > 0 ? [x / len, z / len] : [1, 0];
}
