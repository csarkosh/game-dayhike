/**
 * The rock relief of the steep ground: a unitless field in [−1, 1] with
 * exact derivatives, in two forms. Columns are a jittered cellular field
 * whose cells, on a steep face, stand as prisms taller than they are wide;
 * blocks are a near-square lattice with rounded joints, two octaves. A slow
 * noise over the world chooses the form, so one face carries one of them.
 *
 * The field is a function of the world position and seed alone. It is not a
 * stage of the height chain by itself: the stage that masks it to the steep
 * ground and scales it to metres reads `faceReliefD` and the constants here.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */

import { gradientNoise2, hash3 } from "./field.js";
import { stepT, stepTd } from "./lakeShape.js";

// ---- Tunables (every one appears in FACE_RELIEF_TUNABLES) -------------------
/** The ground's gradient under which the relief is absent. */
export const FACE_SLOPE_LO = 1.0;
/** The ground's gradient from which the relief is whole. */
export const FACE_SLOPE_HI = 1.4;
/** How far, in metres along the face's normal, the surface moves either way. */
export const FACE_HALF_DEPTH = 0.6;
/** The forward-difference step, in metres, for the ground's second derivatives. */
export const FACE_DIFF_STEP = 0.25;

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

/** The cellular field into cv/cdx/cdz. */
function cellular(
  x: number, z: number, cell: number, jitter: number, border: number, salt: number,
): void {
  const i0 = Math.floor(x / cell);
  const j0 = Math.floor(z / cell);
  let q1 = Infinity;
  let q2 = Infinity;
  let i1 = 0, j1 = 0, i2 = 0, j2 = 0;
  let e1x = 0, e1z = 0, e2x = 0, e2z = 0;
  for (let di = -1; di <= 1; di++) {
    const i = i0 + di;
    for (let dj = -1; dj <= 1; dj++) {
      const j = j0 + dj;
      const ex = x - (i + 0.5 + jitter * (hash3(i, j, 0, salt) - 0.5)) * cell;
      const ez = z - (j + 0.5 + jitter * (hash3(i, j, 1, salt) - 0.5)) * cell;
      const q = ex * ex + ez * ez;
      if (q < q1) {
        q2 = q1; i2 = i1; j2 = j1; e2x = e1x; e2z = e1z;
        q1 = q; i1 = i; j1 = j; e1x = ex; e1z = ez;
      } else if (q < q2) {
        q2 = q; i2 = i; j2 = j; e2x = ex; e2z = ez;
      }
    }
  }
  const f1 = Math.sqrt(q1);
  const f2 = Math.sqrt(q2);
  const o1 = 2 * hash3(i1, j1, 2, salt) - 1;
  const t = (f2 - f1) / border;
  if (t >= 1) {
    // Well inside a cell: the cell's own value, flat.
    cv = o1;
    cdx = 0;
    cdz = 0;
    return;
  }
  const o2 = 2 * hash3(i2, j2, 2, salt) - 1;
  const half = (o1 - o2) / 2;
  cv = (o1 + o2) / 2 + half * stepT(t);
  // ∇F = (p − c) / F for each site; on a site the gradient is taken as zero.
  const g1x = f1 < ON_SITE ? 0 : e1x / f1;
  const g1z = f1 < ON_SITE ? 0 : e1z / f1;
  const g2x = f2 < ON_SITE ? 0 : e2x / f2;
  const g2z = f2 < ON_SITE ? 0 : e2z / f2;
  const k = (half * stepTd(t)) / border;
  cdx = k * (g2x - g1x);
  cdz = k * (g2z - g1z);
}

/**
 * The cellular field: the nearest site's value inside a cell, the mean of the
 * two nearest sites' values on the border between them, a quintic blend
 * across a joint `border` metres wide. Of the nine cells around the sample.
 * Where the second nearest site changes, near a junction of three cells, the
 * field has a kink, as a joint does.
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

/**
 * The relief at (x, z): columns, blocks, or their mix by the form share, in
 * [−1, 1], with exact derivatives through the forms and the mix. Only the
 * forms with weight are evaluated.
 */
export function faceReliefD(seed: number, x: number, z: number): ReliefSample {
  kind(seed, x, z);
  if (ks === 0) {
    columns(seed, x, z);
    return { v: cv, dx: cdx, dz: cdz };
  }
  if (ks === 1) {
    blocks(seed, x, z);
    return { v: cv, dx: cdx, dz: cdz };
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
  return {
    v: colV + s * diff,
    dx: colDx + s * (cdx - colDx) + sx * diff,
    dz: colDz + s * (cdz - colDz) + sz * diff,
  };
}
