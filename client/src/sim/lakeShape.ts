/**
 * A lake's shore. A lake is a basin field B over the ground whose level set
 * B = 1 is its shoreline: a spine of one to three segments with a half-width
 * along it, random-phase harmonics about its centre, a metre-scale wobble,
 * bulges where talus or a fan meets the water, and a spout where it drains.
 * From B one function, `lakeShoreInto`, gives at any point the signed
 * distance s to the shore (positive inside, in metres to within the field's
 * stretch) with its exact gradient, the bed's depth under the level and the
 * side weight σ, written into the caller's record. Every system that asks
 * "is this water, and how far from the shore" reads it.
 *
 * Bends and directions are indices into LAKE_DIRECTIONS, 64 unit vectors as
 * literals; cos kθ and sin kθ come from the unit vector by complex
 * multiplication; unit vectors are normalised by `Math.sqrt`.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */

import { hash2, hash3 } from "./field.js";

export type LakeFamily = "valley" | "tarn";
/** A bulge: B rises by `height` · (1 − r²/ρ²)³ inside `radius` ρ about (x, z). */
export type LakeBump = { readonly x: number; readonly z: number; readonly radius: number; readonly height: number };
/** The outlet: a capsule from the shore point (ax, az) to the tip (bx, bz), `half` metres either side. */
export type LakeSpout = { readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number; readonly half: number };

export type LakeShape = {
  readonly family: LakeFamily;
  /** The spine: two to four points, and the half-width at each (m). */
  readonly px: readonly number[];
  readonly pz: readonly number[];
  readonly width: readonly number[];
  /** The deepest point of the spine's own region, which the harmonics turn about. */
  readonly cx: number;
  readonly cz: number;
  /** The drawn mean radius (m): the harmonics' fade is measured in it. */
  readonly size: number;
  /** a_k and b_k for k = 3 to 16, at index k − 3. */
  readonly harmA: readonly number[];
  readonly harmB: readonly number[];
  readonly noiseAmp: number;
  /** The seed the wobble is drawn with (`seed ^ LAKE_NOISE_SALT`). */
  readonly noiseSeed: number;
  readonly bumps: readonly LakeBump[];
  readonly spout: LakeSpout | null;
  /** The unit direction of the steep side: the headwall, or a valley lake's uphill side. */
  readonly headX: number;
  readonly headZ: number;
  /** The apron's width by direction: a0, a1, b1, a2, b2, a3, b3 (m). */
  readonly apron: readonly number[];
  /** The water's level (m) and murk, 0 clear to 1 murky. */
  readonly level: number;
  readonly murk: number;
  /** Measured at placement: the farthest the lake's ground reaches from the
   * centre (`bound`), the largest shore distance inside (`sMax`), the radius
   * of the circle of the same area (`meanRadius`) and the farthest shore
   * point from the centre (`shoreMax`). */
  readonly bound: number;
  readonly sMax: number;
  readonly meanRadius: number;
  readonly shoreMax: number;
};

// ---- Directions --------------------------------------------------------------
/** 64 unit vectors 5.625° apart from +x toward +z, as literals: the sim takes no trigonometric function. */
export const LAKE_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0], [0.9951847266721969, 0.0980171403295606],
  [0.9807852804032304, 0.19509032201612825], [0.9569403357322088, 0.29028467725446233],
  [0.9238795325112867, 0.3826834323650898], [0.881921264348355, 0.47139673682599764],
  [0.8314696123025452, 0.5555702330196022], [0.773010453362737, 0.6343932841636455],
  [0.7071067811865476, 0.7071067811865475], [0.6343932841636455, 0.7730104533627369],
  [0.5555702330196023, 0.8314696123025452], [0.4713967368259978, 0.8819212643483549],
  [0.38268343236508984, 0.9238795325112867], [0.29028467725446233, 0.9569403357322089],
  [0.19509032201612833, 0.9807852804032304], [0.09801714032956077, 0.9951847266721968],
  [0, 1], [-0.09801714032956065, 0.9951847266721969],
  [-0.1950903220161282, 0.9807852804032304], [-0.29028467725446216, 0.9569403357322089],
  [-0.3826834323650897, 0.9238795325112867], [-0.4713967368259977, 0.881921264348355],
  [-0.555570233019602, 0.8314696123025453], [-0.6343932841636454, 0.7730104533627371],
  [-0.7071067811865475, 0.7071067811865476], [-0.773010453362737, 0.6343932841636455],
  [-0.8314696123025453, 0.5555702330196022], [-0.8819212643483549, 0.47139673682599786],
  [-0.9238795325112867, 0.3826834323650899], [-0.9569403357322088, 0.2902846772544624],
  [-0.9807852804032304, 0.1950903220161286], [-0.9951847266721968, 0.09801714032956083],
  [-1, 0], [-0.9951847266721969, -0.09801714032956059],
  [-0.9807852804032304, -0.19509032201612836], [-0.9569403357322089, -0.2902846772544621],
  [-0.9238795325112868, -0.3826834323650896], [-0.881921264348355, -0.47139673682599764],
  [-0.8314696123025455, -0.555570233019602], [-0.7730104533627371, -0.6343932841636453],
  [-0.7071067811865477, -0.7071067811865475], [-0.6343932841636459, -0.7730104533627367],
  [-0.5555702330196022, -0.8314696123025452], [-0.4713967368259979, -0.8819212643483549],
  [-0.38268343236509034, -0.9238795325112865], [-0.29028467725446244, -0.9569403357322088],
  [-0.19509032201612866, -0.9807852804032303], [-0.09801714032956045, -0.9951847266721969],
  [0, -1], [0.09801714032956009, -0.9951847266721969],
  [0.1950903220161283, -0.9807852804032304], [0.29028467725446205, -0.9569403357322089],
  [0.38268343236509, -0.9238795325112866], [0.4713967368259976, -0.881921264348355],
  [0.5555702330196018, -0.8314696123025455], [0.6343932841636456, -0.7730104533627369],
  [0.7071067811865474, -0.7071067811865477], [0.7730104533627365, -0.6343932841636459],
  [0.8314696123025452, -0.5555702330196022], [0.8819212643483548, -0.4713967368259979],
  [0.9238795325112865, -0.3826834323650904], [0.9569403357322088, -0.2902846772544625],
  [0.9807852804032303, -0.19509032201612872], [0.9951847266721969, -0.0980171403295605],
];

/** The spine's smooth minimum at a joint: k is this share of the half-width there (spec §4.2, "k half the half-width at the joint"). */
export const LAKE_JOINT_K = 0.5;

// ---- Small exact pieces ------------------------------------------------------
/** Quintic smootherstep from e0 to e1 and its derivative in x. */
export function smootherstepD(e0: number, e1: number, x: number): { v: number; d: number } {
  if (x <= e0) return { v: 0, d: 0 };
  if (x >= e1) return { v: 1, d: 0 };
  const span = e1 - e0;
  const t = (x - e0) / span;
  return { v: t * t * t * (t * (t * 6 - 15) + 10), d: (30 * t * t * (t - 1) * (t - 1)) / span };
}

/** The quintic step at its own parameter t, clamped to [0, 1], and its derivative in t. */
export function stepT(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
}
export function stepTd(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return 30 * t * t * (t - 1) * (t - 1);
}

/** smin(a, b, k) = (a + b − √((a − b)² + k²)) / 2. */
export function smin(a: number, b: number, k: number): number {
  const r = a - b;
  return (a + b - Math.sqrt(r * r + k * k)) / 2;
}

/** A value read off a piecewise-linear quantile table at u in [0, 1]: lo at 0, mid at ½, hi at 1. */
export function quantile3(u: number, lo: number, mid: number, hi: number): number {
  return u < 0.5 ? lo + (mid - lo) * 2 * u : mid + (hi - mid) * (2 * u - 1);
}

// ---- The spine -----------------------------------------------------------------
// Module scratch, refilled by every `spineInto`: the smooth-minimum distance
// D to the spine, the half-width W there, and their gradients.
let mD = 0, mDx = 0, mDz = 0, mW = 0, mWx = 0, mWz = 0;

/**
 * The spine's pieces at (x, z) into the module scratch: D, the smooth minimum
 * of the distances to the segments (k LAKE_JOINT_K of the half-width at each
 * joint, so the inside of a bend has no crease), and W, the half-width there:
 * each segment's own, a smootherstep between its ends' widths in its nearest
 * point's parameter, blended by the smooth minimum's own weight
 * λ = (1 − r / √(r² + k²)) / 2; with exact gradients.
 */
function spineInto(shape: LakeShape, x: number, z: number): void {
  const n = shape.px.length - 1;
  for (let i = 0; i < n; i++) {
    const ax = shape.px[i] as number, az = shape.pz[i] as number;
    const ex = (shape.px[i + 1] as number) - ax, ez = (shape.pz[i + 1] as number) - az;
    const l2 = ex * ex + ez * ez;
    const raw = ((x - ax) * ex + (z - az) * ez) / l2;
    const t = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
    const rx = x - (ax + t * ex), rz = z - (az + t * ez);
    const d = Math.sqrt(rx * rx + rz * rz);
    const ddx = d > 0 ? rx / d : 0, ddz = d > 0 ? rz / d : 0;
    const w0 = shape.width[i] as number, w1 = shape.width[i + 1] as number;
    const w = w0 + (w1 - w0) * stepT(t);
    // ∂t/∂(x, z) = e / |e|² inside the segment, 0 where t is clamped.
    const gw = raw > 0 && raw < 1 ? ((w1 - w0) * stepTd(t)) / l2 : 0;
    const wx = gw * ex, wz = gw * ez;
    if (i === 0) {
      mD = d; mDx = ddx; mDz = ddz; mW = w; mWx = wx; mWz = wz;
      continue;
    }
    // The joint between segment i − 1 and segment i is point i.
    const k = LAKE_JOINT_K * (shape.width[i] as number);
    const r = mD - d;
    const root = Math.sqrt(r * r + k * k);
    const lam = (1 - r / root) / 2;
    const dlam = (-k * k) / (2 * root * root * root);
    const lx = dlam * (mDx - ddx), lz = dlam * (mDz - ddz);
    const nD = (mD + d - root) / 2;
    const nDx = lam * mDx + (1 - lam) * ddx, nDz = lam * mDz + (1 - lam) * ddz;
    const nW = lam * mW + (1 - lam) * w;
    const nWx = lam * mWx + (1 - lam) * wx + (mW - w) * lx;
    const nWz = lam * mWz + (1 - lam) * wz + (mW - w) * lz;
    mD = nD; mDx = nDx; mDz = nDz; mW = nW; mWx = nWx; mWz = nWz;
  }
}

/** The spine's metric m = D / W at (x, z) and its gradient, into `out` as (v, dx, dz), returned. */
export function spineMetricInto(
  out: { v: number; dx: number; dz: number }, shape: LakeShape, x: number, z: number,
): { v: number; dx: number; dz: number } {
  spineInto(shape, x, z);
  const m = mD / mW;
  out.v = m;
  out.dx = (mDx - m * mWx) / mW;
  out.dz = (mDz - m * mWz) / mW;
  return out;
}

// ---- The per-tick path's scratch ---------------------------------------------
let sV = 0, sD = 0;
/** `smootherstepD` into the scratch `sV`, `sD`: the same value and derivative, nothing allocated. */
function smootherstepInto(e0: number, e1: number, x: number): void {
  if (x <= e0) { sV = 0; sD = 0; return; }
  if (x >= e1) { sV = 1; sD = 0; return; }
  const span = e1 - e0;
  const t = (x - e0) / span;
  sV = t * t * t * (t * (t * 6 - 15) + 10);
  sD = (30 * t * t * (t - 1) * (t - 1)) / span;
}

// ---- The shore's tunables ----------------------------------------------------
/** The harmonics' amplitude c · T_k · g_k: c by family, T_k = (k/3)^−1.4 for
 * k = 3 to 16 as a literal table (spec §4.3), g_k drawn in [GAIN_MIN, GAIN_MAX]. */
export const LAKE_HARM_C_VALLEY = 0.14;
export const LAKE_HARM_GAIN_MIN = 0.5;
export const LAKE_HARM_GAIN_MAX = 1.5;
export const LAKE_HARM_TABLE: readonly number[] = [
  1, 0.669, 0.489, 0.379, 0.306, 0.253, 0.214, 0.186, 0.163, 0.144, 0.129, 0.116, 0.105, 0.096,
];
/** The harmonics and the side weight fade in over this share of the drawn radius from the centre, where θ is undefined. */
export const LAKE_HARM_FADE_LO = 0.15;
export const LAKE_HARM_FADE_HI = 0.45;
/** The metre-scale wobble: its amplitude drawn in [MIN, MAX], its wavelength (m). */
export const LAKE_NOISE_AMP_MIN = 0.015;
export const LAKE_NOISE_AMP_MAX = 0.03;
export const LAKE_NOISE_WAVE = 6;
/** The spout's smooth minimum with the basin, in the basin's own units. */
export const LAKE_SPOUT_K = 0.3;
/** The side weight's ramp: û · head from −EDGE to EDGE maps onto −1 to 1. */
export const LAKE_SIDE_EDGE = 0.7;

// ---- The bed -----------------------------------------------------------------
/** A valley lake's shelf: from the shore the bed falls to LAKE_SHELF_DEPTH
 * over min(LAKE_SHELF_WIDTH, LAKE_SHELF_SHARE · sMax), deep enough to wade to
 * the waist and no deeper (the depth a lake survey found at a shore's shelf);
 * then down over min(LAKE_SLOPE_WIDTH, LAKE_SHELF_SHARE · sMax) to the middle. */
export const LAKE_SHELF_DEPTH = 0.9;
export const LAKE_SHELF_WIDTH = 10;
export const LAKE_SLOPE_WIDTH = 8;
export const LAKE_SHELF_SHARE = 0.4;
/** The middle's depth: a murky lake's, and a clear lake's, whose bed then
 * reads to about 5 m as the subalpine lakes' do. */
export const LAKE_DEPTH_MURKY = 3;
export const LAKE_DEPTH_CLEAR = 6;
/** A tarn's shelf: TARN_SHELF_HEAD metres wide under the headwall,
 * TARN_SHELF_OUTLET_SHARE · sMax on the outlet side; then a smootherstep drop
 * over the rest of the half-width to TARN_DEPTH_SHARE · 2 · meanRadius. */
export const TARN_SHELF_HEAD = 2;
export const TARN_SHELF_OUTLET_SHARE = 0.35;
export const TARN_DEPTH_SHARE = 0.095;

export function lakeMiddleDepth(murk: number): number {
  return LAKE_DEPTH_CLEAR + (LAKE_DEPTH_MURKY - LAKE_DEPTH_CLEAR) * murk;
}

/** A valley lake's shelf width, and its drop's, for a lake whose largest shore distance is `sMax`. */
export function lakeShelfWidth(sMax: number): number {
  return Math.min(LAKE_SHELF_WIDTH, LAKE_SHELF_SHARE * sMax);
}
export function lakeSlopeWidth(sMax: number): number {
  return Math.min(LAKE_SLOPE_WIDTH, LAKE_SHELF_SHARE * sMax);
}

/**
 * A valley lake's depth below the level at `s` metres in from the shore, and
 * ∂depth/∂s: two quintic steps, the shelf's over [0, shelf] and the drop's
 * over [shelf, shelf + slope], each flat to second order at both ends, so the
 * bed is C² at the shore, at the shelf's edge and at the middle's.
 */
export function lakeDepthD(s: number, murk: number, shelf: number, slope: number): { v: number; d: number } {
  const a = smootherstepD(0, shelf, s);
  const b = smootherstepD(shelf, shelf + slope, s);
  const extra = lakeMiddleDepth(murk) - LAKE_SHELF_DEPTH;
  return { v: LAKE_SHELF_DEPTH * a.v + extra * b.v, d: LAKE_SHELF_DEPTH * a.d + extra * b.d };
}

// Module scratch: a valley lake's depth and its derivative in s.
let dV = 0, dD = 0;
/** `lakeDepthD` into the scratch `dV`, `dD`: the same arithmetic, nothing allocated. */
function lakeDepthInto(s: number, murk: number, shelf: number, slope: number): void {
  smootherstepInto(0, shelf, s);
  const av = sV, ad = sD;
  smootherstepInto(shelf, shelf + slope, s);
  const extra = lakeMiddleDepth(murk) - LAKE_SHELF_DEPTH;
  dV = LAKE_SHELF_DEPTH * av + extra * sV;
  dD = LAKE_SHELF_DEPTH * ad + extra * sD;
}

// ---- The record ----------------------------------------------------------------
/** What `lakeShoreInto` writes: the signed shore distance and its gradient,
 * the bed's depth below the level and its gradient (0 outside the shore), the
 * side weight σ and its gradient, and the unit vector (ux, uz) from the
 * centre with the distance q (ux 1, uz 0 at the centre itself). */
export type LakeShore = {
  s: number; sx: number; sz: number;
  depth: number; depthX: number; depthZ: number;
  sigma: number; sigmaX: number; sigmaZ: number;
  ux: number; uz: number; q: number;
};

export function newLakeShore(): LakeShore {
  return { s: 0, sx: 0, sz: 0, depth: 0, depthX: 0, depthZ: 0, sigma: 0.5, sigmaX: 0, sigmaZ: 0, ux: 1, uz: 0, q: 0 };
}

// ---- The harmonics ---------------------------------------------------------------
// Module scratch: the harmonics' sum and its derivative in θ.
let hG = 0, hGt = 0;

/**
 * Σ (a_k cos kθ + b_k sin kθ) for k = 3 to 16 at the unit vector (ux, uz) =
 * (cos θ, sin θ), and its derivative in θ, into the module scratch: cos kθ and
 * sin kθ by complex multiplication, one step a harmonic.
 */
function harmonicsAt(harmA: readonly number[], harmB: readonly number[], ux: number, uz: number): void {
  // (cos 3θ, sin 3θ) from (cos θ, sin θ) by two steps.
  let c = ux * ux - uz * uz, s = 2 * ux * uz;
  const c3 = c * ux - s * uz, s3 = s * ux + c * uz;
  c = c3; s = s3;
  let g = 0, gt = 0;
  for (let j = 0; j < harmA.length; j++) {
    const k = j + 3;
    const a = harmA[j] as number, b = harmB[j] as number;
    g += a * c + b * s;
    gt += k * (b * c - a * s);
    const nc = c * ux - s * uz;
    s = s * ux + c * uz;
    c = nc;
  }
  hG = g; hGt = gt;
}

/** The harmonics' sum and its derivative in θ at the unit vector (ux, uz). */
export function harmonicSum(harmA: readonly number[], harmB: readonly number[], ux: number, uz: number): { v: number; dTheta: number } {
  harmonicsAt(harmA, harmB, ux, uz);
  return { v: hG, dTheta: hGt };
}

/** cos kθ and sin kθ at the unit vector (ux, uz) = (cos θ, sin θ), by the recurrence `harmonicsAt` steps. */
export function harmonicPair(k: number, ux: number, uz: number): [number, number] {
  let c = ux, s = uz;
  for (let i = 1; i < k; i++) {
    const nc = c * ux - s * uz;
    s = s * ux + c * uz;
    c = nc;
  }
  return [c, s];
}

// ---- The wobble ------------------------------------------------------------------
const SQ = Math.SQRT1_2;
const GRAD_X = [1, -1, 0, 0, SQ, SQ, -SQ, -SQ] as const;
const GRAD_Z = [0, 0, 1, -1, SQ, -SQ, SQ, -SQ] as const;
// Module scratch: one octave's value and gradient, then the two octaves' sum.
let nV = 0, nX = 0, nZ = 0;
let fV = 0, fX = 0, fZ = 0;

/** One octave of `field.ts`'s gradient noise (`gradientNoise2`, value and
 * first derivatives only) into the module scratch: the shore asks this at
 * every sample and keeps no record of it. */
function noiseOctave(x: number, z: number, seed: number): void {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ia = (hash2(xi, zi, seed) * 8) | 0, ib = (hash2(xi + 1, zi, seed) * 8) | 0;
  const ic = (hash2(xi, zi + 1, seed) * 8) | 0, id = (hash2(xi + 1, zi + 1, seed) * 8) | 0;
  const gax = GRAD_X[ia] as number, gaz = GRAD_Z[ia] as number;
  const gbx = GRAD_X[ib] as number, gbz = GRAD_Z[ib] as number;
  const gcx = GRAD_X[ic] as number, gcz = GRAD_Z[ic] as number;
  const gdx = GRAD_X[id] as number, gdz = GRAD_Z[id] as number;
  const va = gax * fx + gaz * fz;
  const vb = gbx * (fx - 1) + gbz * fz;
  const vc = gcx * fx + gcz * (fz - 1);
  const vd = gdx * (fx - 1) + gdz * (fz - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const du = 30 * fx * fx * (fx - 1) * (fx - 1);
  const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const dw = 30 * fz * fz * (fz - 1) * (fz - 1);
  const B = vb - va, C = vc - va, D = va - vb - vc + vd;
  nV = (va + u * B + w * C + u * w * D) * Math.SQRT2;
  nX = (gax + u * (gbx - gax) + w * (gcx - gax) + u * w * (gax - gbx - gcx + gdx) + du * (B + w * D)) * Math.SQRT2;
  nZ = (gaz + u * (gbz - gaz) + w * (gcz - gaz) + u * w * (gaz - gbz - gcz + gdz) + dw * (C + u * D)) * Math.SQRT2;
}

/** Two octaves at gain ½ and lacunarity 2, normalised to [−1, 1], with the
 * per-octave seed `field.ts`'s `fbm2d` uses, into the module scratch. */
function wobble(x: number, z: number, seed: number): void {
  noiseOctave(x, z, seed);
  const v = nV, gx = nX, gz = nZ;
  noiseOctave(x * 2, z * 2, seed + 0x9e37);
  fV = (v + 0.5 * nV) / 1.5;
  fX = (gx + nX) / 1.5;
  fZ = (gz + nZ) / 1.5;
}

/** The wobble's value and gradient at (x, z) in its own units. */
export function lakeWobble(x: number, z: number, seed: number): { v: number; dx: number; dz: number } {
  wobble(x, z, seed);
  return { v: fV, dx: fX, dz: fZ };
}

// ---- The basin field and the shore ---------------------------------------------
// Module scratch: the basin field B and its gradient.
let bB = 0, bBx = 0, bBz = 0;

/**
 * B at (x, z) and its gradient into the module scratch, W and its gradient
 * left in mW…: `m · (1 − H − N) + Σ bump`, joined with the spout by a smooth
 * minimum (LAKE_SPOUT_K). The spout's own metric is in the basin's units,
 * 1 + (d − half) / W, so across the spout s runs at a metre a metre as it
 * does round the plain shore and its axis lies `half` metres in.
 */
function basinInto(shape: LakeShape, x: number, z: number, q: number, ux: number, uz: number): void {
  spineInto(shape, x, z);
  const W = mW, Wx = mWx, Wz = mWz;
  const m = mD / W;
  const mx = (mDx - m * Wx) / W, mz = (mDz - m * Wz) / W;
  // The harmonics, faded in from the centre: ∇q = û, ∇θ = (−uz, ux) / q.
  let H = 0, Hx = 0, Hz = 0;
  const lo = LAKE_HARM_FADE_LO * shape.size, hi = LAKE_HARM_FADE_HI * shape.size;
  if (q > lo) {
    smootherstepInto(lo, hi, q);
    const fv = sV, fd = sD;
    harmonicsAt(shape.harmA, shape.harmB, ux, uz);
    H = fv * hG;
    Hx = fd * ux * hG - (fv * hGt * uz) / q;
    Hz = fd * uz * hG + (fv * hGt * ux) / q;
  }
  // The wobble.
  let N = 0, Nx = 0, Nz = 0;
  if (shape.noiseAmp > 0) {
    wobble(x / LAKE_NOISE_WAVE, z / LAKE_NOISE_WAVE, shape.noiseSeed);
    N = shape.noiseAmp * fV;
    Nx = (shape.noiseAmp * fX) / LAKE_NOISE_WAVE;
    Nz = (shape.noiseAmp * fZ) / LAKE_NOISE_WAVE;
  }
  const keep = 1 - H - N;
  let B = m * keep;
  let Bx = mx * keep - m * (Hx + Nx);
  let Bz = mz * keep - m * (Hz + Nz);
  for (let i = 0; i < shape.bumps.length; i++) {
    const b = shape.bumps[i] as LakeBump;
    const rx = x - b.x, rz = z - b.z;
    const r2 = rx * rx + rz * rz, p2 = b.radius * b.radius;
    if (r2 >= p2) continue;
    const u = 1 - r2 / p2;
    B += b.height * u * u * u;
    const g = (-6 * b.height * u * u) / p2;
    Bx += g * rx;
    Bz += g * rz;
  }
  const sp = shape.spout;
  if (sp !== null) {
    const ex = sp.bx - sp.ax, ez = sp.bz - sp.az;
    const l2 = ex * ex + ez * ez;
    const raw = l2 > 0 ? ((x - sp.ax) * ex + (z - sp.az) * ez) / l2 : 0;
    const t = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
    const rx = x - (sp.ax + t * ex), rz = z - (sp.az + t * ez);
    const d = Math.sqrt(rx * rx + rz * rz);
    const ddx = d > 0 ? rx / d : 0, ddz = d > 0 ? rz / d : 0;
    const S = 1 + (d - sp.half) / W;
    const Sx = ddx / W - ((d - sp.half) * Wx) / (W * W);
    const Sz = ddz / W - ((d - sp.half) * Wz) / (W * W);
    const r = B - S;
    const root = Math.sqrt(r * r + LAKE_SPOUT_K * LAKE_SPOUT_K);
    const lam = (1 - r / root) / 2;
    const joined = (B + S - root) / 2;
    Bx = lam * Bx + (1 - lam) * Sx;
    Bz = lam * Bz + (1 - lam) * Sz;
    B = joined;
  }
  bB = B; bBx = Bx; bBz = Bz;
}

/**
 * A tarn's bed into `out`: a shelf LAKE_SHELF_DEPTH deep over W_shelf(σ),
 * TARN_SHELF_HEAD on the headwall side and TARN_SHELF_OUTLET_SHARE · sMax on
 * the outlet side, then a smootherstep drop over the rest of the half-width
 * (to sMax) to TARN_DEPTH_SHARE · 2 · meanRadius, with no flat middle. Reads
 * `out.sigma` and its gradient.
 */
function tarnDepthInto(out: LakeShore, shape: LakeShape, s: number, sx: number, sz: number): void {
  const wOut = TARN_SHELF_OUTLET_SHARE * shape.sMax;
  const ws = wOut + (TARN_SHELF_HEAD - wOut) * out.sigma;
  const wsx = (TARN_SHELF_HEAD - wOut) * out.sigmaX, wsz = (TARN_SHELF_HEAD - wOut) * out.sigmaZ;
  const dMax = TARN_DEPTH_SHARE * 2 * shape.meanRadius;
  // The shelf: S(s / ws), ∂/∂s = S′ / ws, ∂/∂ws = −S′ s / ws².
  const t1 = s / ws;
  const a = stepT(t1), ad = stepTd(t1);
  const aS = ad / ws, aW = (-ad * s) / (ws * ws);
  // The drop: S((s − ws) / (sMax − ws)), ∂/∂s = S′ / L, ∂/∂ws = S′ (s − sMax) / L².
  const L = shape.sMax - ws;
  const t2 = (s - ws) / L;
  const b = stepT(t2), bd = stepTd(t2);
  const bS = bd / L, bW = (bd * (s - shape.sMax)) / (L * L);
  const extra = dMax - LAKE_SHELF_DEPTH;
  out.depth = LAKE_SHELF_DEPTH * a + extra * b;
  const dS = LAKE_SHELF_DEPTH * aS + extra * bS;
  const dW = LAKE_SHELF_DEPTH * aW + extra * bW;
  out.depthX = dS * sx + dW * wsx;
  out.depthZ = dS * sz + dW * wsz;
}

/**
 * The shore at (x, z) into `out`, returned, nothing allocated: the signed
 * distance s = (1 − B) · W, positive inside, with ∇s = −W ∇B + (1 − B) ∇W;
 * the side weight σ = ½ + ½ fade(q) ζ(û · head), 1 on the steep side, 0 on
 * the gentle side, ½ at the centre, with its gradient; and the bed's depth
 * below the level by family (0 outside the shore) with its gradient. Outside
 * `bound` from the centre it writes s = −∞ after one distance test.
 */
export function lakeShoreInto(out: LakeShore, shape: LakeShape, x: number, z: number): LakeShore {
  const rx = x - shape.cx, rz = z - shape.cz;
  const q2 = rx * rx + rz * rz;
  if (q2 >= shape.bound * shape.bound) {
    out.s = Number.NEGATIVE_INFINITY; out.sx = 0; out.sz = 0;
    out.depth = 0; out.depthX = 0; out.depthZ = 0;
    out.sigma = 0.5; out.sigmaX = 0; out.sigmaZ = 0;
    out.ux = 1; out.uz = 0; out.q = Math.sqrt(q2);
    return out;
  }
  const q = Math.sqrt(q2);
  const ux = q > 0 ? rx / q : 1, uz = q > 0 ? rz / q : 0;
  out.ux = ux; out.uz = uz; out.q = q;
  basinInto(shape, x, z, q, ux, uz);
  const s = (1 - bB) * mW;
  const sx = -mW * bBx + (1 - bB) * mWx;
  const sz = -mW * bBz + (1 - bB) * mWz;
  out.s = s; out.sx = sx; out.sz = sz;
  // The side weight: ∇c = (head − c û) / q.
  const lo = LAKE_HARM_FADE_LO * shape.size, hi = LAKE_HARM_FADE_HI * shape.size;
  if (q > lo) {
    smootherstepInto(lo, hi, q);
    const fv = sV, fd = sD;
    const c = ux * shape.headX + uz * shape.headZ;
    smootherstepInto(-LAKE_SIDE_EDGE, LAKE_SIDE_EDGE, c);
    const zeta = 2 * sV - 1, dzeta = 2 * sD;
    const cx = (shape.headX - c * ux) / q, cz = (shape.headZ - c * uz) / q;
    out.sigma = 0.5 + 0.5 * fv * zeta;
    out.sigmaX = 0.5 * (fd * ux * zeta + fv * dzeta * cx);
    out.sigmaZ = 0.5 * (fd * uz * zeta + fv * dzeta * cz);
  } else {
    out.sigma = 0.5; out.sigmaX = 0; out.sigmaZ = 0;
  }
  // The bed.
  if (!(s > 0)) {
    out.depth = 0; out.depthX = 0; out.depthZ = 0;
    return out;
  }
  if (shape.family === "valley") {
    lakeDepthInto(s, shape.murk, lakeShelfWidth(shape.sMax), lakeSlopeWidth(shape.sMax));
    out.depth = dV; out.depthX = dD * sx; out.depthZ = dD * sz;
    return out;
  }
  tarnDepthInto(out, shape, s, sx, sz);
  return out;
}

// ---- Along a line ---------------------------------------------------------------
/** A line's march toward a shore distance: its step (m) and the halvings that refine the crossing. */
export const LAKE_RAY_STEP = 0.5;
export const LAKE_RAY_HALVINGS = 40;

const RAY = newLakeShore();

/**
 * How far along the line from (ox, oz) in the unit direction (dirX, dirZ)
 * the shore distance first falls to `target` or below: marched in
 * LAKE_RAY_STEP steps out to `maxR`, then halved LAKE_RAY_HALVINGS times. 0
 * where it is there at the start; Infinity where it is not by `maxR`.
 */
export function rayToShore(
  shape: LakeShape, ox: number, oz: number, dirX: number, dirZ: number, target: number, maxR: number,
): number {
  if (lakeShoreInto(RAY, shape, ox, oz).s <= target) return 0;
  let a = 0;
  for (let r = LAKE_RAY_STEP; r <= maxR + LAKE_RAY_STEP; r += LAKE_RAY_STEP) {
    if (lakeShoreInto(RAY, shape, ox + dirX * r, oz + dirZ * r).s <= target) {
      let lo = a, hi = r;
      for (let i = 0; i < LAKE_RAY_HALVINGS; i++) {
        const mid = (lo + hi) / 2;
        if (lakeShoreInto(RAY, shape, ox + dirX * mid, oz + dirZ * mid).s <= target) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    a = r;
  }
  return Number.POSITIVE_INFINITY;
}

// ---- The outline ----------------------------------------------------------------
/** A closed polyline, counter-clockwise from +x toward +z, its last point joined back to its first. */
export type LakeOutline = { readonly xs: readonly number[]; readonly zs: readonly number[] };

const OUT = newLakeShore();

/**
 * The shore's zero set marched by squares over the square of half-side
 * `extent` about the centre, every `step` metres, its rim held outside so
 * every loop closes, chained into loops; the loop of largest area,
 * counter-clockwise. With it the largest shore distance any grid point reads.
 */
function march(shape: LakeShape, step: number, extent: number): { outline: LakeOutline; sMax: number } {
  const n = Math.ceil((2 * extent) / step) + 1;
  const x0 = shape.cx - extent, z0 = shape.cz - extent;
  const vals = new Float64Array(n * n);
  let sMax = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s = lakeShoreInto(OUT, shape, x0 + i * step, z0 + j * step).s;
      const v = i === 0 || j === 0 || i === n - 1 || j === n - 1 ? -1 : s === Number.NEGATIVE_INFINITY ? -1e9 : s;
      vals[j * n + i] = v;
      if (v > sMax) sMax = v;
    }
  }
  const at = (i: number, j: number): number => vals[j * n + i] as number;
  // Edge ids: the horizontal edge from (i, j) to (i + 1, j) is j·n + i; the
  // vertical edge from (i, j) to (i, j + 1) is n·n + j·n + i.
  const links = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    let la = links.get(a);
    if (la === undefined) { la = []; links.set(a, la); }
    la.push(b);
    let lb = links.get(b);
    if (lb === undefined) { lb = []; links.set(b, lb); }
    lb.push(a);
  };
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const v0 = at(i, j), v1 = at(i + 1, j), v2 = at(i + 1, j + 1), v3 = at(i, j + 1);
      const c = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const e0 = j * n + i, e1 = n * n + j * n + i + 1, e2 = (j + 1) * n + i, e3 = n * n + j * n + i;
      const centreIn = v0 + v1 + v2 + v3 > 0;
      switch (c) {
        case 1: case 14: link(e3, e0); break;
        case 2: case 13: link(e0, e1); break;
        case 3: case 12: link(e3, e1); break;
        case 4: case 11: link(e1, e2); break;
        case 6: case 9: link(e0, e2); break;
        case 7: case 8: link(e3, e2); break;
        case 5:
          if (centreIn) { link(e0, e1); link(e2, e3); } else { link(e3, e0); link(e1, e2); }
          break;
        case 10:
          if (centreIn) { link(e3, e0); link(e1, e2); } else { link(e0, e1); link(e2, e3); }
          break;
      }
    }
  }
  // An edge's crossing, by linear interpolation of s between its ends.
  const pointOf = (e: number): [number, number] => {
    const vertical = e >= n * n;
    const k = vertical ? e - n * n : e;
    const i = k % n, j = (k - i) / n;
    const a = at(i, j);
    const b = vertical ? at(i, j + 1) : at(i + 1, j);
    const t = a / (a - b);
    return vertical ? [x0 + i * step, z0 + (j + t) * step] : [x0 + (i + t) * step, z0 + j * step];
  };
  const seen = new Set<number>();
  let best: { xs: number[]; zs: number[] } = { xs: [], zs: [] };
  let bestArea = 0;
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const xs: number[] = [], zs: number[] = [];
    let prev = -1, cur = start;
    for (;;) {
      seen.add(cur);
      const [px, pz] = pointOf(cur);
      xs.push(px); zs.push(pz);
      const nb = links.get(cur) as number[];
      const next = nb[0] !== prev ? (nb[0] as number) : (nb[1] as number);
      prev = cur;
      cur = next;
      if (cur === start || seen.has(cur)) break;
    }
    const area = shoelace(xs, zs);
    if (Math.abs(area) > Math.abs(bestArea)) {
      bestArea = area;
      best = { xs, zs };
    }
  }
  if (bestArea < 0) {
    best.xs.reverse();
    best.zs.reverse();
  }
  return { outline: best, sMax };
}

/** The signed area of a closed polyline: positive counter-clockwise from +x toward +z. */
export function shoelace(xs: readonly number[], zs: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    a += (xs[j] as number) * (zs[i] as number) - (xs[i] as number) * (zs[j] as number);
  }
  return a / 2;
}

/** The lake's shore as an ordered closed polyline at `step` metres: the checks read it at 1 m, the game at 2 m. */
export function lakeOutline(shape: LakeShape, step: number, extent: number = shape.shoreMax + 2 * step): LakeOutline {
  return march(shape, step, extent).outline;
}

// ---- The bank and the apron ---------------------------------------------------------
/** The bank: from the shore the ground rises at the bank's grade, eased in
 * over LAKE_BANK_EASE metres, out to its width; gentle on the side weight's
 * 0 side and steep on its 1 side, lerped by σ. */
export const LAKE_BANK_GRADE_GENTLE = 0.12;
export const LAKE_BANK_GRADE_STEEP = 0.5;
export const LAKE_BANK_WIDTH_GENTLE = 4;
export const LAKE_BANK_WIDTH_STEEP = 6;
export const LAKE_BANK_EASE = 1;
/** The apron's width in a direction: clamp(LAKE_APRON_RISE / g, MIN, MAX)
 * for g the mean gradient of the ground in that direction across the band
 * 0 to LAKE_APRON_BAND metres outside the shore, read every LAKE_APRON_STEP;
 * fitted on 16 directions with harmonics up to k = 3 and held off MIN by a
 * smooth floor LAKE_APRON_SOFT wide. */
export const LAKE_APRON_RISE = 4;
export const LAKE_APRON_MIN = 4;
export const LAKE_APRON_MAX = 30;
export const LAKE_APRON_BAND = 30;
export const LAKE_APRON_STEP = 2;
export const LAKE_APRON_SOFT = 1;

/** A direction's apron width from its ground's mean gradient. */
export function apronWidthFor(g: number): number {
  if (!(g > 0)) return LAKE_APRON_MAX;
  return Math.min(LAKE_APRON_MAX, Math.max(LAKE_APRON_MIN, LAKE_APRON_RISE / g));
}

/**
 * The harmonics up to k = 3 of 16 widths, one every 22.5° from +x toward +z
 * (LAKE_DIRECTIONS[4i]): a0 the mean, and a_k and b_k each 2/16 of the sum of
 * the widths times cos kθ and sin kθ.
 */
export function fitApron(widths: readonly number[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 16; i++) {
    const [ux, uz] = LAKE_DIRECTIONS[4 * i] as readonly [number, number];
    const a = widths[i] as number;
    out[0] = (out[0] as number) + a / 16;
    let c = ux, s = uz;
    for (let k = 1; k <= 3; k++) {
      out[2 * k - 1] = (out[2 * k - 1] as number) + (2 * a * c) / 16;
      out[2 * k] = (out[2 * k] as number) + (2 * a * s) / 16;
      const nc = c * ux - s * uz;
      s = s * ux + c * uz;
      c = nc;
    }
  }
  return out;
}

/** The apron's width at the unit vector (ux, uz) from the centre, and its
 * derivative in θ: the fitted series held off LAKE_APRON_MIN by the smooth
 * floor (A + MIN + √((A − MIN)² + SOFT²)) / 2. */
export function apronAt(apron: readonly number[], ux: number, uz: number): { v: number; dTheta: number } {
  let a = apron[0] as number, at = 0;
  let c = ux, s = uz;
  for (let k = 1; k <= 3; k++) {
    const ak = apron[2 * k - 1] as number, bk = apron[2 * k] as number;
    a += ak * c + bk * s;
    at += k * (bk * c - ak * s);
    const nc = c * ux - s * uz;
    s = s * ux + c * uz;
    c = nc;
  }
  const r = a - LAKE_APRON_MIN;
  const root = Math.sqrt(r * r + LAKE_APRON_SOFT * LAKE_APRON_SOFT);
  return { v: (a + LAKE_APRON_MIN + root) / 2, dTheta: ((1 + r / root) / 2) * at };
}

/** Where the lake's ground gives the hillside back, metres outside the shore,
 * at a point whose shore record is `r`: the bank's width by σ plus the apron's. */
export function lakeApronEnd(shape: LakeShape, r: LakeShore): number {
  const wb = LAKE_BANK_WIDTH_GENTLE + (LAKE_BANK_WIDTH_STEEP - LAKE_BANK_WIDTH_GENTLE) * r.sigma;
  return wb + apronAt(shape.apron, r.ux, r.uz).v;
}

// ---- Placement measures ------------------------------------------------------------
/** The step the placement's outline is marched at (m), and the bound's
 * margin past the apron's end (m): between the 64 rays the apron's end
 * reaches up to 4.7 m past the farthest ray's (measured on 200 drawn lakes
 * at 2,880 directions), so the margin holds twice that. */
export const LAKE_MEASURE_STEP = 2;
export const LAKE_BOUND_MARGIN = 10;
/** The step the bound's rays march at (m), and the farthest any ray marches (m). */
export const LAKE_BOUND_STEP = 1;
export const LAKE_BOUND_REACH = 1000;

const BOUND = newLakeShore();

/**
 * The farthest the lake's ground reaches from the centre: along each of
 * LAKE_DIRECTIONS from the shore crossing out in LAKE_BOUND_STEP steps until
 * the point lies past its apron's end, the farthest of the 64, plus
 * LAKE_BOUND_MARGIN. Read with the shape's bound Infinity.
 */
export function lakeBound(shape: LakeShape): number {
  let far = 0;
  for (const [dx, dz] of LAKE_DIRECTIONS) {
    let r = rayToShore(shape, shape.cx, shape.cz, dx, dz, 0, LAKE_BOUND_REACH);
    while (r <= LAKE_BOUND_REACH) {
      const p = lakeShoreInto(BOUND, shape, shape.cx + dx * r, shape.cz + dz * r);
      if (-p.s >= lakeApronEnd(shape, p)) break;
      r += LAKE_BOUND_STEP;
    }
    if (r > far) far = r;
  }
  return far + LAKE_BOUND_MARGIN;
}

/** sMax, meanRadius and shoreMax from the outline marched at `step` over the
 * square of half-side `extent`, the shape's bound Infinity. */
export function measureLake(shape: LakeShape, step: number, extent: number): { sMax: number; meanRadius: number; shoreMax: number } {
  const { outline, sMax } = march(shape, step, extent);
  let shoreMax = 0;
  for (let i = 0; i < outline.xs.length; i++) {
    const dx = (outline.xs[i] as number) - shape.cx, dz = (outline.zs[i] as number) - shape.cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > shoreMax) shoreMax = d;
  }
  return { sMax, meanRadius: Math.sqrt(Math.abs(shoelace(outline.xs, outline.zs)) / Math.PI), shoreMax };
}

/** The 16 apron widths of a shape over `ground`: along each LAKE_DIRECTIONS[4i]
 * from the shore crossing out across LAKE_APRON_BAND, the mean of
 * |Δh| / LAKE_APRON_STEP, through `apronWidthFor`. */
export function apronWidths(shape: LakeShape, ground: (x: number, z: number) => number): number[] {
  const out: number[] = [];
  const steps = Math.round(LAKE_APRON_BAND / LAKE_APRON_STEP);
  for (let i = 0; i < 16; i++) {
    const [dx, dz] = LAKE_DIRECTIONS[4 * i] as readonly [number, number];
    const c = rayToShore(shape, shape.cx, shape.cz, dx, dz, 0, LAKE_BOUND_REACH);
    let sum = 0;
    let prev = ground(shape.cx + dx * c, shape.cz + dz * c);
    for (let k = 1; k <= steps; k++) {
      const r = c + k * LAKE_APRON_STEP;
      const h = ground(shape.cx + dx * r, shape.cz + dz * r);
      sum += Math.abs(h - prev);
      prev = h;
    }
    out.push(apronWidthFor(sum / (steps * LAKE_APRON_STEP)));
  }
  return out;
}

// ---- The valley family ------------------------------------------------------------------
/** Every draw of a lake's shape is hash3(id, i, 0, seed ^ LAKE_SHAPE_SALT);
 * the wobble is drawn with seed ^ LAKE_NOISE_SALT. */
export const LAKE_SHAPE_SALT = 0x1a4e;
export const LAKE_NOISE_SALT = 0x5a1e;
/** The spine's length to width (the stadium's, 1 + ℓ / 2w) from a quantile
 * table: at 0, the median and 1. The joints' smooth minimum widens each joint
 * by a quarter of the half-width and the taper widens the head by τ, so the
 * outline's Feret L:W comes out at about two thirds of the spine's. */
export const LAKE_VALLEY_LW_LO = 2.2;
export const LAKE_VALLEY_LW_MID = 3.8;
export const LAKE_VALLEY_LW_HI = 5.2;
/** Egg and teardrop: the head end's half-width (1 + τ) w and the tail's (1 − τ) w, τ in [0, MAX]. */
export const LAKE_TAPER_MAX = 0.3;
/** Two segments when the draw is under this share, three otherwise. */
export const LAKE_VALLEY_TWO_SHARE = 0.5;
/** Each bend, as LAKE_DIRECTIONS indices: 16.875° to 45°. */
export const LAKE_VALLEY_BEND_MIN = 3;
export const LAKE_VALLEY_BEND_MAX = 8;
/** A two-segment spine bends at this share of its length; a three-segment
 * one at a third and two thirds, give or take LAKE_BEND3_JITTER. */
export const LAKE_BEND_AT_MIN = 0.35;
export const LAKE_BEND_AT_MAX = 0.65;
export const LAKE_BEND3_JITTER = 0.05;
/** One valley lake in three is two-lobed: the half-width at its first bend pinched to this share. */
export const LAKE_VALLEY_LOBED_SHARE = 0.3333333333333333;
export const LAKE_PINCH_MIN = 0.6;
export const LAKE_PINCH_MAX = 0.75;
/** The spout: its width and its length (m). */
export const LAKE_SPOUT_WIDTH_MIN = 5;
export const LAKE_SPOUT_WIDTH_MAX = 20;
export const LAKE_SPOUT_LENGTH_MIN = 5;
export const LAKE_SPOUT_LENGTH_MAX = 10;
/** The outlet: of the shore past the spine's tail end, the point whose ground
 * LAKE_OUTLET_PROBE metres out stands lowest. */
export const LAKE_OUTLET_PROBE = 5;
/** The step the base shape's deepest point is found on (m). */
export const LAKE_CENTRE_STEP = 1;

function shapeDraw(seed: number, id: number, i: number): number {
  return hash3(id, i, 0, seed ^ LAKE_SHAPE_SALT);
}

const METRIC = { v: 0, dx: 0, dz: 0 };

/**
 * The deepest point of the base shape: the grid point of the spine's region
 * m < 1 where (1 − m)·W is largest. A centroid can fall outside a bent,
 * pinched shape; this point is in water by construction, with the widest
 * margin, so the harmonics' frame and the bound's rays start inside the lake.
 */
function spineCentre(shape: LakeShape): [number, number] {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, wMax = 0;
  for (let i = 0; i < shape.px.length; i++) {
    x0 = Math.min(x0, shape.px[i] as number); x1 = Math.max(x1, shape.px[i] as number);
    z0 = Math.min(z0, shape.pz[i] as number); z1 = Math.max(z1, shape.pz[i] as number);
    wMax = Math.max(wMax, shape.width[i] as number);
  }
  let bx = (x0 + x1) / 2, bz = (z0 + z1) / 2, best = -Infinity;
  for (let z = z0 - wMax; z <= z1 + wMax; z += LAKE_CENTRE_STEP) {
    for (let x = x0 - wMax; x <= x1 + wMax; x += LAKE_CENTRE_STEP) {
      const m = spineMetricInto(METRIC, shape, x, z).v;
      if (m >= 1) continue;
      // mW is the local half-width the metric was just made with.
      const depth = (1 - m) * mW;
      if (depth > best) { best = depth; bx = x; bz = z; }
    }
  }
  return [bx, bz];
}

const SPOUT = newLakeShore();

/**
 * A valley lake's shape, drawn for feature `id` of world `seed`, about
 * (x, z) with drawn mean radius `size`, on ground whose mean gradient over the
 * candidate's disc is (gradX, gradZ), `ground` the pre-feature field: the
 * spine laid along the contour (its uphill end the head, the uphill side
 * `head`), the harmonics, the wobble, the spout at the shore point of lowest
 * bank on the downhill end, the apron fitted to the ground, and the
 * measures. Level 0 and murk ½: the builder sets both.
 */
export function valleyLakeShape(
  seed: number, id: number, x: number, z: number, size: number,
  gradX: number, gradZ: number, ground: (x: number, z: number) => number,
): LakeShape {
  const d = (i: number): number => shapeDraw(seed, id, i);
  const lw = quantile3(d(0), LAKE_VALLEY_LW_LO, LAKE_VALLEY_LW_MID, LAKE_VALLEY_LW_HI);
  const w = size * Math.sqrt(Math.PI / (4 * (lw - 1) + Math.PI));
  const len = 2 * w * (lw - 1);
  const tau = LAKE_TAPER_MAX * d(1);
  const two = d(2) < LAKE_VALLEY_TWO_SHARE;
  const lobed = d(3) < LAKE_VALLEY_LOBED_SHARE;
  const pinch = LAKE_PINCH_MIN + (LAKE_PINCH_MAX - LAKE_PINCH_MIN) * d(4);
  // Along the contour: perpendicular to the mean gradient, the uphill side the head.
  const g = Math.sqrt(gradX * gradX + gradZ * gradZ);
  let hx: number, hz: number;
  if (g > 1e-6) {
    hx = gradX / g; hz = gradZ / g;
  } else {
    const [fx, fz] = LAKE_DIRECTIONS[Math.min(63, Math.floor(d(12) * 64))] as readonly [number, number];
    hx = fx; hz = fz;
  }
  let ex = -hz, ez = hx;
  if (d(11) < 0.5) { ex = -ex; ez = -ez; }
  // The bends, as shares of the length.
  const at = two
    ? [LAKE_BEND_AT_MIN + (LAKE_BEND_AT_MAX - LAKE_BEND_AT_MIN) * d(9)]
    : [1 / 3 + LAKE_BEND3_JITTER * (2 * d(9) - 1), 2 / 3 + LAKE_BEND3_JITTER * (2 * d(10) - 1)];
  const px = [0], pz = [0], arc = [0];
  let cx = ex, cz = ez, prevAt = 0;
  for (let b = 0; b <= at.length; b++) {
    const next = b < at.length ? (at[b] as number) : 1;
    const l = len * (next - prevAt);
    px.push((px[b] as number) + cx * l);
    pz.push((pz[b] as number) + cz * l);
    arc.push(next);
    prevAt = next;
    if (b === at.length) break;
    const span = LAKE_VALLEY_BEND_MAX - LAKE_VALLEY_BEND_MIN + 1;
    const idx = LAKE_VALLEY_BEND_MIN + Math.min(span - 1, Math.floor(d(5 + 2 * b) * span));
    const [rc, rs0] = LAKE_DIRECTIONS[idx] as readonly [number, number];
    const rs = d(6 + 2 * b) < 0.5 ? rs0 : -rs0;
    const ncx = cx * rc - cz * rs;
    cz = cx * rs + cz * rc;
    cx = ncx;
  }
  // The arc-length middle onto (x, z).
  let mx = 0, mz = 0;
  for (let i = 0; i + 1 < px.length; i++) {
    const a0 = arc[i] as number, a1 = arc[i + 1] as number;
    if (a0 <= 0.5 && a1 >= 0.5) {
      const t = (0.5 - a0) / (a1 - a0);
      mx = (px[i] as number) + t * ((px[i + 1] as number) - (px[i] as number));
      mz = (pz[i] as number) + t * ((pz[i + 1] as number) - (pz[i] as number));
      break;
    }
  }
  for (let i = 0; i < px.length; i++) { px[i] = (px[i] as number) - mx + x; pz[i] = (pz[i] as number) - mz + z; }
  // The head end is the uphill one.
  const last = px.length - 1;
  const headLast = ground(px[last] as number, pz[last] as number) > ground(px[0] as number, pz[0] as number);
  const width = arc.map((f) => w * (headLast ? 1 - tau + 2 * tau * f : 1 + tau - 2 * tau * f));
  if (lobed) width[1] = (width[1] as number) * pinch;
  // The harmonics.
  const harmA: number[] = [], harmB: number[] = [];
  for (let j = 0; j < LAKE_HARM_TABLE.length; j++) {
    const amp = LAKE_HARM_C_VALLEY * (LAKE_HARM_TABLE[j] as number)
      * (LAKE_HARM_GAIN_MIN + (LAKE_HARM_GAIN_MAX - LAKE_HARM_GAIN_MIN) * d(20 + 3 * j));
    let pu = 2 * d(21 + 3 * j) - 1, pv = 2 * d(22 + 3 * j) - 1;
    const norm = Math.sqrt(pu * pu + pv * pv);
    if (norm > 1e-9) { pu /= norm; pv /= norm; } else { pu = 1; pv = 0; }
    harmA.push(amp * pu);
    harmB.push(amp * pv);
  }
  const base: LakeShape = {
    family: "valley", px, pz, width, cx: x, cz: z, size,
    harmA: harmA.map(() => 0), harmB: harmB.map(() => 0), noiseAmp: 0, noiseSeed: seed ^ LAKE_NOISE_SALT,
    bumps: [], spout: null, headX: hx, headZ: hz, apron: [LAKE_APRON_MAX, 0, 0, 0, 0, 0, 0],
    level: 0, murk: 0.5, bound: Number.POSITIVE_INFINITY, sMax: w, meanRadius: size, shoreMax: len / 2 + w,
  };
  const [ccx, ccz] = spineCentre(base);
  const extent0 = len + 2 * w * (1 + tau) + 10;
  let shape: LakeShape = {
    ...base, cx: ccx, cz: ccz, harmA, harmB,
    noiseAmp: LAKE_NOISE_AMP_MIN + (LAKE_NOISE_AMP_MAX - LAKE_NOISE_AMP_MIN) * d(13),
  };
  shape = { ...shape, ...measureLake(shape, LAKE_MEASURE_STEP, extent0) };
  // The outlet: past the tail end of the spine (the cap the end's own segment
  // ends in), the shore point whose ground LAKE_OUTLET_PROBE out stands lowest.
  const tx = (headLast ? px[0] : px[last]) as number, tz = (headLast ? pz[0] : pz[last]) as number;
  const sx0 = (headLast ? px[1] : px[last - 1]) as number, sz0 = (headLast ? pz[1] : pz[last - 1]) as number;
  const tdx = tx - sx0, tdz = tz - sz0;
  const tl = Math.sqrt(tdx * tdx + tdz * tdz);
  const outline = lakeOutline(shape, LAKE_MEASURE_STEP, extent0);
  let bestI = -1, bestH = Infinity, nearI = 0, nearA = -Infinity;
  for (let i = 0; i < outline.xs.length; i++) {
    const ox = outline.xs[i] as number, oz = outline.zs[i] as number;
    // How far past the tail end, along the tail segment's direction.
    const past = ((ox - tx) * tdx + (oz - tz) * tdz) / tl;
    if (past > nearA) { nearA = past; nearI = i; }
    if (past < 0) continue;
    const r = lakeShoreInto(SPOUT, shape, ox, oz);
    const gl = Math.sqrt(r.sx * r.sx + r.sz * r.sz);
    if (!(gl > 0)) continue;
    const h = ground(ox - (r.sx / gl) * LAKE_OUTLET_PROBE, oz - (r.sz / gl) * LAKE_OUTLET_PROBE);
    if (h < bestH) { bestH = h; bestI = i; }
  }
  const oi = bestI >= 0 ? bestI : nearI;
  const ox = outline.xs[oi] as number, oz = outline.zs[oi] as number;
  const r = lakeShoreInto(SPOUT, shape, ox, oz);
  const gl = Math.sqrt(r.sx * r.sx + r.sz * r.sz);
  const nx = gl > 0 ? -r.sx / gl : tdx / tl, nz = gl > 0 ? -r.sz / gl : tdz / tl;
  const spLen = LAKE_SPOUT_LENGTH_MIN + (LAKE_SPOUT_LENGTH_MAX - LAKE_SPOUT_LENGTH_MIN) * d(15);
  const spHalf = (LAKE_SPOUT_WIDTH_MIN + (LAKE_SPOUT_WIDTH_MAX - LAKE_SPOUT_WIDTH_MIN) * d(14)) / 2;
  shape = { ...shape, spout: { ax: ox, az: oz, bx: ox + nx * spLen, bz: oz + nz * spLen, half: spHalf } };
  shape = { ...shape, ...measureLake(shape, LAKE_MEASURE_STEP, extent0 + spLen + spHalf) };
  shape = { ...shape, apron: fitApron(apronWidths(shape, ground)) };
  return { ...shape, bound: lakeBound(shape) };
}
