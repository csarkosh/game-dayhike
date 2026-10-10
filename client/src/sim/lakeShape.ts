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
  /** The centroid of the spine's own region, which the harmonics turn about. */
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
