/**
 * The rock relief of the steep ground: a unitless field in [−1, 1] with
 * exact derivatives, in two forms. Columns are a jittered cellular field
 * whose cells, on a steep face, stand as prisms taller than they are wide;
 * blocks are a near-square lattice with rounded joints, two octaves. A slow
 * noise over the world chooses the form, so one face carries one of them.
 *
 * The field is a function of the world position and seed alone. The stage
 * of the height chain, `faceStageD` at the end of this file, masks it to the
 * steep ground and scales it to metres.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */

import { gradientNoise2, hash3 } from "./field.js";
import { stepT, stepTd } from "./lakeShape.js";
import type { TerrainSample } from "./terrain.js";

// ---- Tunables (every one appears in FACE_RELIEF_TUNABLES) -------------------
/** The ground's gradient under which the relief is absent. */
export const FACE_SLOPE_LO = 1.0;
/** The ground's gradient from which the relief is whole. */
export const FACE_SLOPE_HI = 1.4;
/** How far, in metres along the face's normal, the surface moves either way. */
export const FACE_HALF_DEPTH = 0.6;
/** The forward-difference step, in metres, for the ground's second derivatives.
 * Finer than any crease of the ground beneath: a ridge's crest can turn its
 * gradient through 0.7 in 4 cm, and a step of a few centimetres misses that
 * turn by enough to put the stage's gradient off by a tenth of the slope. */
export const FACE_DIFF_STEP = 0.0001;

/** Columns: lattice spacing (m), jitter (share of the cell), joint width (m). */
export const FACE_COLUMN_CELL = 2.8;
export const FACE_COLUMN_JITTER = 0.8;
export const FACE_COLUMN_BORDER = 0.3;
/** Blocks, the coarse octave. */
export const FACE_BLOCK_CELL = 3.6;
export const FACE_BLOCK_JITTER = 0.25;
export const FACE_BLOCK_BORDER = 0.9;
/** Blocks, the fine octave, added at FACE_BLOCK_FINE_WEIGHT. */
export const FACE_BLOCK_FINE_CELL = 1.8;
export const FACE_BLOCK_FINE_JITTER = 0.25;
export const FACE_BLOCK_FINE_BORDER = 0.45;
export const FACE_BLOCK_FINE_WEIGHT = 0.5;
/** Brings the two octaves' sum, at most 1.5, back within [−1, 1]. */
export const FACE_BLOCK_NORM = 2 / 3;

/** The wavelength (m) of the noise that chooses the form. */
export const FACE_KIND_WAVE = 150;
/** The noise's values across which the form turns from columns to blocks. */
export const FACE_KIND_LO = -0.15;
export const FACE_KIND_HI = 0.15;

export const FACE_COLUMN_SALT = 0xc01a;
export const FACE_BLOCK_SALT = 0xb10c;
export const FACE_BLOCK_FINE_SALT = 0xb1c2;
export const FACE_KIND_SALT = 0x41d5;

export const FACE_RELIEF_TUNABLES: Readonly<Record<string, number>> = {
  FACE_SLOPE_LO, FACE_SLOPE_HI, FACE_HALF_DEPTH, FACE_DIFF_STEP,
  FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER,
  FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER,
  FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
  FACE_BLOCK_FINE_WEIGHT, FACE_BLOCK_NORM,
  FACE_KIND_WAVE, FACE_KIND_LO, FACE_KIND_HI,
  FACE_COLUMN_SALT, FACE_BLOCK_SALT, FACE_BLOCK_FINE_SALT, FACE_KIND_SALT,
};

/** A value and its exact partial derivatives in x and z. */
export type ReliefSample = { v: number; dx: number; dz: number };

/** A distance under which a point counts as on its site, whose gradient is
 * then taken as zero rather than divided by nothing. */
const ON_SITE = 1e-9;

/**
 * The site of lattice cell (i, j): its position, displaced from the cell's
 * centre by up to jitter · cell / 2 in each axis, and its value in [−1, 1].
 * `salt` is already mixed with the world seed.
 */
export function cellularSite(
  i: number, j: number, cell: number, jitter: number, salt: number,
): { x: number; z: number; o: number } {
  return {
    x: (i + 0.5 + jitter * (hash3(i, j, 0, salt) - 0.5)) * cell,
    z: (j + 0.5 + jitter * (hash3(i, j, 1, salt) - 0.5)) * cell,
    o: 2 * hash3(i, j, 2, salt) - 1,
  };
}

// The cellular field's result, written by `cellular` and read at once by its
// callers, so a sample of the relief allocates nothing but what it returns.
let cv = 0;
let cdx = 0;
let cdz = 0;

// The sites around the sample: their offsets from it, distances and cells.
// Room for the 5 × 5 window `cellular` widens to when the 3 × 3 cannot hold
// every site with weight.
const SITES_MAX = 25;
const siteEx = new Float64Array(SITES_MAX);
const siteEz = new Float64Array(SITES_MAX);
const siteF = new Float64Array(SITES_MAX);
const siteI = new Int32Array(SITES_MAX);
const siteJ = new Int32Array(SITES_MAX);
// The window's nearest site, written by `gather`.
let nearK = 0;

/** The sites of the (2r + 1)² cells about (i0, j0) into the scratch; returns
 * their count and leaves the nearest one's index in nearK. */
function gather(
  x: number, z: number, cell: number, jitter: number, salt: number,
  i0: number, j0: number, r: number,
): number {
  let n = 0;
  let best = Infinity;
  for (let i = i0 - r; i <= i0 + r; i++) {
    for (let j = j0 - r; j <= j0 + r; j++) {
      const ex = x - (i + 0.5 + jitter * (hash3(i, j, 0, salt) - 0.5)) * cell;
      const ez = z - (j + 0.5 + jitter * (hash3(i, j, 1, salt) - 0.5)) * cell;
      const f = Math.sqrt(ex * ex + ez * ez);
      siteEx[n] = ex;
      siteEz[n] = ez;
      siteF[n] = f;
      siteI[n] = i;
      siteJ[n] = j;
      if (f < best) {
        best = f;
        nearK = n;
      }
      n++;
    }
  }
  return n;
}

/** The cellular field into cv/cdx/cdz. */
function cellular(
  x: number, z: number, cell: number, jitter: number, border: number, salt: number,
): void {
  const i0 = Math.floor(x / cell);
  const j0 = Math.floor(z / cell);
  let n = gather(x, z, cell, jitter, salt, i0, j0, 1);
  // A site outside the 3 × 3 window is at least this far from the sample: a
  // window's width, the gap jitter leaves at a cell's edge, and the sample's
  // own distance to the edge of its cell. Inside that reach the window holds
  // every site with weight; past it the 5 × 5 does, for any border under
  // (2 − √2) cells, which every form keeps.
  const fx = x / cell - i0;
  const fz = z / cell - j0;
  const reach = (1 + (1 - jitter) / 2 + Math.min(fx, 1 - fx, fz, 1 - fz)) * cell;
  if ((siteF[nearK] as number) + border >= reach) n = gather(x, z, cell, jitter, salt, i0, j0, 2);

  const f1 = siteF[nearK] as number;
  const g1x = f1 < ON_SITE ? 0 : (siteEx[nearK] as number) / f1;
  const g1z = f1 < ON_SITE ? 0 : (siteEz[nearK] as number) / f1;
  let weighted = 0;
  let sw = 0;
  let swo = 0;
  let ax = 0;
  let az = 0;
  let bx = 0;
  let bz = 0;
  for (let k = 0; k < n; k++) {
    const f = siteF[k] as number;
    const t = (f - f1) / border;
    if (t >= 1) continue;
    const w = 1 - stepT(t);
    const o = 2 * hash3(siteI[k] as number, siteJ[k] as number, 2, salt) - 1;
    weighted++;
    sw += w;
    swo += w * o;
    if (t > 0) {
      // w′ = −S′(t) · (∇F − ∇F1) / border, with ∇F = (p − c) / F.
      const d = -stepTd(t) / border;
      const gx = (f < ON_SITE ? 0 : (siteEx[k] as number) / f) - g1x;
      const gz = (f < ON_SITE ? 0 : (siteEz[k] as number) / f) - g1z;
      ax += d * gx * o;
      az += d * gz * o;
      bx += d * gx;
      bz += d * gz;
    }
  }
  if (weighted === 1) {
    // Well inside a cell: the cell's own value, flat.
    cv = swo;
    cdx = 0;
    cdz = 0;
    return;
  }
  const v = swo / sw;
  cv = v;
  cdx = (ax - v * bx) / sw;
  cdz = (az - v * bz) / sw;
}

/**
 * The cellular field: the sites' values weighted by how near each is to the
 * nearest, w = 1 − smootherstep((F − F1) / border), so the nearest site's
 * value inside a cell, the mean of two sites' values on the border between
 * them and a quintic blend across a joint `border` metres wide. A convex mix,
 * so within the values' [−1, 1]; continuous everywhere, smooth across a joint
 * of two cells, with a kink only at a junction of three or more. Of the nine
 * cells around the sample, or the twenty-five when a site with weight could
 * lie outside the nine (only on the most jittered forms, and rarely).
 */
export function cellularD(
  x: number, z: number, cell: number, jitter: number, border: number, salt: number,
): ReliefSample {
  cellular(x, z, cell, jitter, border, salt);
  return { v: cv, dx: cdx, dz: cdz };
}

// The form share, written by `kind`.
let ks = 0;
let ksx = 0;
let ksz = 0;

function kind(seed: number, x: number, z: number): void {
  const n = gradientNoise2(x / FACE_KIND_WAVE, z / FACE_KIND_WAVE, seed ^ FACE_KIND_SALT);
  const span = FACE_KIND_HI - FACE_KIND_LO;
  const t = (n.v - FACE_KIND_LO) / span;
  ks = stepT(t);
  const d = stepTd(t) / (span * FACE_KIND_WAVE);
  ksx = d * n.dx;
  ksz = d * n.dz;
}

/** The share of blocks in the relief at (x, z): 0 where it is columns, 1 where
 * it is blocks, a quintic blend in the band between. */
export function faceKindD(seed: number, x: number, z: number): ReliefSample {
  kind(seed, x, z);
  return { v: ks, dx: ksx, dz: ksz };
}

function columns(seed: number, x: number, z: number): void {
  cellular(
    x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, seed ^ FACE_COLUMN_SALT,
  );
}

/** The two octaves of blocks into cv/cdx/cdz. */
function blocks(seed: number, x: number, z: number): void {
  cellular(x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, seed ^ FACE_BLOCK_SALT);
  const av = cv;
  const adx = cdx;
  const adz = cdz;
  cellular(
    x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
    seed ^ FACE_BLOCK_FINE_SALT,
  );
  cv = (av + FACE_BLOCK_FINE_WEIGHT * cv) * FACE_BLOCK_NORM;
  cdx = (adx + FACE_BLOCK_FINE_WEIGHT * cdx) * FACE_BLOCK_NORM;
  cdz = (adz + FACE_BLOCK_FINE_WEIGHT * cdz) * FACE_BLOCK_NORM;
}

// The relief's result, written by `relief`.
let rv = 0;
let rdx = 0;
let rdz = 0;

/** The relief into rv/rdx/rdz. */
function relief(seed: number, x: number, z: number): void {
  kind(seed, x, z);
  if (ks === 0 || ks === 1) {
    if (ks === 0) columns(seed, x, z);
    else blocks(seed, x, z);
    rv = cv;
    rdx = cdx;
    rdz = cdz;
    return;
  }
  const s = ks;
  const sx = ksx;
  const sz = ksz;
  columns(seed, x, z);
  const colV = cv;
  const colDx = cdx;
  const colDz = cdz;
  blocks(seed, x, z);
  const diff = cv - colV;
  rv = colV + s * diff;
  rdx = colDx + s * (cdx - colDx) + sx * diff;
  rdz = colDz + s * (cdz - colDz) + sz * diff;
}

/**
 * The relief at (x, z): columns, blocks, or their mix by the form share, in
 * [−1, 1], with exact derivatives through the forms and the mix. Only the
 * forms with weight are evaluated.
 */
export function faceReliefD(seed: number, x: number, z: number): ReliefSample {
  relief(seed, x, z);
  return { v: rv, dx: rdx, dz: rdz };
}

/**
 * The relief as a stage of the height chain. Where the ground's gradient g is
 * at most FACE_SLOPE_LO the stage returns `s` itself. Above it the surface
 * moves by up to FACE_HALF_DEPTH metres either way along the face's normal,
 * a vertical move of FACE_HALF_DEPTH · sqrt(1 + g²), faded in by a quintic
 * step m(g) from FACE_SLOPE_LO to FACE_SLOPE_HI:
 *
 *   h′ = h + m(g) · A(g) · r,   A(g) = FACE_HALF_DEPTH · sqrt(1 + g²)
 *
 * h′ depends on g, and g's derivative is the ground's second derivative,
 * which the chain does not carry: the stage takes it from forward differences
 * of `pre`, the chain that made `s`, FACE_DIFF_STEP on in x and in z. Those
 * two samples are taken only past the early-out.
 */
export function faceStageD(
  seed: number, x: number, z: number, s: TerrainSample,
  pre: (x: number, z: number) => TerrainSample,
): TerrainSample {
  const g2 = s.dx * s.dx + s.dz * s.dz;
  if (g2 <= FACE_SLOPE_LO * FACE_SLOPE_LO) return s;
  const g = Math.sqrt(g2);
  const span = FACE_SLOPE_HI - FACE_SLOPE_LO;
  const t = (g - FACE_SLOPE_LO) / span;
  const m = stepT(t);
  const mg = stepTd(t) / span;
  const q = Math.sqrt(1 + g2);
  const a = FACE_HALF_DEPTH * q;
  const ag = (FACE_HALF_DEPTH * g) / q;
  // ∂g/∂x = (h_x · h_xx + h_z · h_zx) / g, the second derivatives from the
  // gradient one step on in x; ∂g/∂z likewise from one step on in z.
  const e = FACE_DIFF_STEP;
  const px = pre(x + e, z);
  const gx = (s.dx * (px.dx - s.dx) + s.dz * (px.dz - s.dz)) / (e * g);
  const pz = pre(x, z + e);
  const gz = (s.dx * (pz.dx - s.dx) + s.dz * (pz.dz - s.dz)) / (e * g);
  relief(seed, x, z);
  const ma = m * a;
  const k = (mg * a + m * ag) * rv;
  return { h: s.h + ma * rv, dx: s.dx + ma * rdx + k * gx, dz: s.dz + ma * rdz + k * gz };
}
