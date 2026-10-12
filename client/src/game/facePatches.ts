/**
 * Patches of finer rock over the steep ground. The world is divided into
 * `PATCH_CELL` metre cells on its own lattice; a cell with steep ground in
 * reach gets a patch: a finer grid of the same ground, each vertex pushed out
 * along the ground's normal by the rock relief (`sim/faceRelief.ts`), masked
 * by the ground's gradient so the push is nothing where the ground is not
 * steep. The patch is painted as the clipmap paints the ground under it, so
 * it is the same rock in the same light; the ground itself is not changed.
 *
 * Pure and Babylon-free; `facePatchMeshes.ts` is the shell that uploads it.
 *
 * Directions: west is −x, east +x, south −z, north +z. A cell (ci, cj)
 * covers [ci·16, (ci+1)·16] × [cj·16, (cj+1)·16].
 */
import { groundCover } from "../sim/clutter.js";
import { FACE_SLOPE_HI, FACE_SLOPE_LO, faceReliefD } from "../sim/faceRelief.js";
import { stepT } from "../sim/lakeShape.js";
import { elevationSampleAt, type TerrainSample } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { WEIGHTS2_STRIDE } from "./clipmap.js";
import type { QualityTier } from "./quality.js";
import { classifySurface } from "./terrainSurface.js";
import { waterGroundAt } from "./waterGround.js";

/** A patch cell's side, metres, on the world's lattice. */
export const PATCH_CELL = 16;
/** The most a patch vertex moves out along the ground's normal, metres. */
export const PATCH_DEPTH = 1.2;
/** Vertex spacing (m) of the cells within the near reach. */
export const PATCH_NEAR_SPACING = 0.5;
/** Vertex spacing (m) of the cells beyond it, within the far reach. */
export const PATCH_FAR_SPACING = 1;

export type PatchReach = { readonly near: number; readonly far: number };

/** Per tier: the camera's distance (m) to a cell's centre within which the
 * cell is fine (`near`) and within which it is patched at all (`far`). */
export const PATCH_REACH: Readonly<Record<QualityTier, PatchReach>> = {
  high: { near: 48, far: 160 },
  medium: { near: 36, far: 120 },
  low: { near: 24, far: 80 },
};

export type PatchCell = { ci: number; cj: number; spacing: number };

/** Which edges of a fine cell meet a coarse cell, whose midpoints are then
 * laid on the coarse edge. */
export type PatchStitch = { readonly west: boolean; readonly east: boolean; readonly north: boolean; readonly south: boolean };

export const NO_STITCH: PatchStitch = { west: false, east: false, north: false, south: false };

export type FacePatch = {
  /** World-space positions, three a vertex. */
  positions: Float32Array;
  /** Unit normals of the displaced surface, three a vertex. */
  normals: Float32Array;
  /** RGBA a vertex: classifySurface's albedo, alpha 1. */
  colors: Float32Array;
  /** (grass, forestFloor, rock, sand) a vertex, as the clipmap's `weights`. */
  weights: Float32Array;
  /** (pebble, detail, duff, canopy) a vertex, as the clipmap's `weights2`. */
  weights2: Float32Array;
  /** min(1, grass cover) a vertex, as the clipmap's `cover`. */
  cover: Float32Array;
  /** 16-bit: a fine patch has 33² = 1089 vertices. */
  indices: Uint16Array;
  vertexCount: number;
  triangleCount: number;
};

/** One number per cell, for maps: unique for |ci|, |cj| < 32768. */
export function patchKey(ci: number, cj: number): number {
  return ci * 65536 + cj;
}

/** The share of the relief at a ground gradient `g`: 0 below FACE_SLOPE_LO,
 * 1 from FACE_SLOPE_HI, a quintic step between. */
export function faceMask(g: number): number {
  return stepT((g - FACE_SLOPE_LO) / (FACE_SLOPE_HI - FACE_SLOPE_LO));
}

/**
 * The patch surface at (x, z) into `out` at `at`: the ground pushed out along
 * its normal by the masked relief. Returns the mask. Every position a patch
 * holds comes from here, so a world point is the same doubles in every patch
 * that holds it.
 */
function displacedInto(seed: number, s: TerrainSample, x: number, z: number, out: Float64Array, at: number): number {
  const g2 = s.dx * s.dx + s.dz * s.dz;
  const m = faceMask(Math.sqrt(g2));
  if (m === 0) {
    out[at] = x;
    out[at + 1] = s.h;
    out[at + 2] = z;
    return 0;
  }
  const d = (m * PATCH_DEPTH * (faceReliefD(seed, x, z).v + 1)) / 2;
  const k = d / Math.sqrt(1 + g2);
  out[at] = x - s.dx * k;
  out[at + 1] = s.h + k;
  out[at + 2] = z - s.dz * k;
  return m;
}

/**
 * The unit normal from the central differences of the displaced surface:
 * (xp − xm) along x, (zp − zm) along z, their cross product z × x, which is
 * (−∂h/∂x, 1, −∂h/∂z) on flat displacement. Into `out` at `at`.
 */
function normalInto(
  p: Float64Array, xp: number, xm: number, zp: number, zm: number, out: Float64Array, at: number,
): void {
  const ax = (p[xp] as number) - (p[xm] as number);
  const ay = (p[xp + 1] as number) - (p[xm + 1] as number);
  const az = (p[xp + 2] as number) - (p[xm + 2] as number);
  const bx = (p[zp] as number) - (p[zm] as number);
  const by = (p[zp + 1] as number) - (p[zm + 1] as number);
  const bz = (p[zp + 2] as number) - (p[zm + 2] as number);
  const nx = by * az - bz * ay;
  const ny = bz * ax - bx * az;
  const nz = bx * ay - by * ax;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  out[at] = nx / len;
  out[at + 1] = ny / len;
  out[at + 2] = nz / len;
}

/** The normal a coarse patch gives the point (x, z): from its neighbours a
 * coarse spacing away, sampled here exactly as its grid samples them. */
function coarseNormalInto(seed: number, x: number, z: number, out: Float64Array, at: number): void {
  const step = PATCH_FAR_SPACING;
  const q = new Float64Array(12);
  displacedInto(seed, elevationSampleAt(seed, x + step, z), x + step, z, q, 0);
  displacedInto(seed, elevationSampleAt(seed, x - step, z), x - step, z, q, 3);
  displacedInto(seed, elevationSampleAt(seed, x, z + step), x, z + step, q, 6);
  displacedInto(seed, elevationSampleAt(seed, x, z - step), x, z - step, q, 9);
  normalInto(q, 0, 3, 6, 9, out, at);
}

/**
 * The patch of cell (ci, cj) at `spacing` (0.5 or 1 m), or null when no point
 * of its grid, boundary included, has steep ground. The grid is the cell's
 * own (16/spacing + 1)² points; one ring of apron points around it is
 * sampled for the normals and not drawn. On each edge `stitch` flags, the
 * odd points are laid on the line between their two even neighbours, as the
 * coarse patch beside draws that edge, and the even points take the coarse
 * patch's normals.
 */
export function facePatchGeometry(
  seed: number, ci: number, cj: number, spacing: number, stitch: PatchStitch,
): FacePatch | null {
  const n = Math.round(PATCH_CELL / spacing);
  const side = n + 1;
  const aside = n + 3;
  const x0 = ci * PATCH_CELL;
  const z0 = cj * PATCH_CELL;
  // The apron grid: point (ax, az) is at x0 + (ax − 1)·spacing.
  const samples: TerrainSample[] = new Array<TerrainSample>(aside * aside);
  let steep = false;
  for (let az = 0; az < aside; az++) {
    const z = z0 + (az - 1) * spacing;
    for (let ax = 0; ax < aside; ax++) {
      const x = x0 + (ax - 1) * spacing;
      const s = elevationSampleAt(seed, x, z);
      samples[az * aside + ax] = s;
      if (!steep && ax >= 1 && ax <= side && az >= 1 && az <= side && faceMask(Math.sqrt(s.dx * s.dx + s.dz * s.dz)) > 0) {
        steep = true;
      }
    }
  }
  if (!steep) return null;

  const p = new Float64Array(aside * aside * 3);
  for (let az = 0; az < aside; az++) {
    const z = z0 + (az - 1) * spacing;
    for (let ax = 0; ax < aside; ax++) {
      const at = az * aside + ax;
      displacedInto(seed, samples[at] as TerrainSample, x0 + (ax - 1) * spacing, z, p, at * 3);
    }
  }

  const count = side * side;
  const nrm = new Float64Array(count * 3);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const weights = new Float32Array(count * 4);
  const weights2 = new Float32Array(count * WEIGHTS2_STRIDE);
  const cover = new Float32Array(count);
  for (let iz = 0; iz < side; iz++) {
    const z = z0 + iz * spacing;
    for (let ix = 0; ix < side; ix++) {
      const x = x0 + ix * spacing;
      const at = iz * side + ix;
      const a = (iz + 1) * aside + (ix + 1);
      positions[at * 3] = p[a * 3] as number;
      positions[at * 3 + 1] = p[a * 3 + 1] as number;
      positions[at * 3 + 2] = p[a * 3 + 2] as number;
      // Even points of a stitched edge take the coarse patch's normal, so the
      // two sides of the edge light alike; every other point its own.
      const onStitch = (ix & 1) === 0 && (iz & 1) === 0 && spacing < PATCH_FAR_SPACING &&
        ((stitch.west && ix === 0) || (stitch.east && ix === n) || (stitch.south && iz === 0) || (stitch.north && iz === n));
      if (onStitch) coarseNormalInto(seed, x, z, nrm, at * 3);
      else normalInto(p, (a + 1) * 3, (a - 1) * 3, (a + aside) * 3, (a - aside) * 3, nrm, at * 3);
      normals[at * 3] = nrm[at * 3] as number;
      normals[at * 3 + 1] = nrm[at * 3 + 1] as number;
      normals[at * 3 + 2] = nrm[at * 3 + 2] as number;

      // Painted as the clipmap paints the ground at this point: the same
      // calls with the same inputs (`clipmap.ts`, `sampleInto`).
      const s = samples[a] as TerrainSample;
      const gc = groundCover(seed, x, z, s);
      const duff = gc.duff;
      const canopy = forestDensity(seed, x, z, s);
      const { albedo, weights: w } = classifySurface(
        seed, x, z, s.h, Math.hypot(s.dx, s.dz), canopy, duff, waterGroundAt(seed, x, z, s.h),
      );
      const c = at * 4;
      colors[c] = albedo.r;
      colors[c + 1] = albedo.g;
      colors[c + 2] = albedo.b;
      colors[c + 3] = 1;
      weights[c] = w.grass;
      weights[c + 1] = w.forestFloor;
      weights[c + 2] = w.rock;
      weights[c + 3] = w.sand;
      const w2 = at * WEIGHTS2_STRIDE;
      weights2[w2] = w.pebble;
      weights2[w2 + 1] = w.detail;
      weights2[w2 + 2] = duff;
      weights2[w2 + 3] = canopy;
      cover[at] = Math.min(1, gc.grass);
    }
  }

  if (spacing < PATCH_FAR_SPACING) {
    if (stitch.west) stitchEdge(positions, normals, 0, side);
    if (stitch.east) stitchEdge(positions, normals, n, side);
    if (stitch.south) stitchEdge(positions, normals, 0, 1);
    if (stitch.north) stitchEdge(positions, normals, n * side, 1);
  }

  const indices = new Uint16Array(n * n * 6);
  let k = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * side + ix;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // The clipmap's winding (`ringGeometry`): Babylon is left-handed, and
      // the reverse order culls the patch away from above.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
  return { positions, normals, colors, weights, weights2, cover, indices, vertexCount: count, triangleCount: n * n * 2 };
}

/**
 * One edge of a fine patch laid on the coarse patch's edge: each odd point
 * the mean of its two even neighbours, position and normal (the normal made
 * unit again). The edge runs from vertex `start` in steps of `stride`.
 */
function stitchEdge(positions: Float32Array, normals: Float32Array, start: number, stride: number): void {
  const n = Math.round(PATCH_CELL / PATCH_NEAR_SPACING);
  for (let i = 1; i < n; i += 2) {
    const at = (start + i * stride) * 3;
    const lo = (start + (i - 1) * stride) * 3;
    const hi = (start + (i + 1) * stride) * 3;
    for (let c = 0; c < 3; c++) {
      positions[at + c] = ((positions[lo + c] as number) + (positions[hi + c] as number)) / 2;
    }
    const nx = ((normals[lo] as number) + (normals[hi] as number)) / 2;
    const ny = ((normals[lo + 1] as number) + (normals[hi + 1] as number)) / 2;
    const nz = ((normals[lo + 2] as number) + (normals[hi + 2] as number)) / 2;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    normals[at] = nx / len;
    normals[at + 1] = ny / len;
    normals[at + 2] = nz / len;
  }
}

/**
 * The cells within `reach.far` of the camera, by the distance from the camera
 * to each cell's centre, each at the near spacing within `reach.near` and the
 * far spacing beyond. Ordered by row (cj), then column (ci).
 */
export function facePatchCells(camX: number, camZ: number, reach: PatchReach): PatchCell[] {
  const far2 = reach.far * reach.far;
  const near2 = reach.near * reach.near;
  const i0 = Math.floor((camX - reach.far) / PATCH_CELL);
  const i1 = Math.floor((camX + reach.far) / PATCH_CELL);
  const j0 = Math.floor((camZ - reach.far) / PATCH_CELL);
  const j1 = Math.floor((camZ + reach.far) / PATCH_CELL);
  const cells: PatchCell[] = [];
  for (let cj = j0; cj <= j1; cj++) {
    const dz = (cj + 0.5) * PATCH_CELL - camZ;
    for (let ci = i0; ci <= i1; ci++) {
      const dx = (ci + 0.5) * PATCH_CELL - camX;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      cells.push({ ci, cj, spacing: d2 <= near2 ? PATCH_NEAR_SPACING : PATCH_FAR_SPACING });
    }
  }
  return cells;
}

/**
 * For each cell of `cells`, in order, which of its edges a fine patch lays on
 * a coarse neighbour's: an edge whose neighbour is in the set at the far
 * spacing. A neighbour outside the set is not drawn, so it is no stitch, and
 * a coarse cell stitches nothing.
 */
export function facePatchStitch(cells: readonly PatchCell[]): PatchStitch[] {
  const spacingOf = new Map<number, number>();
  for (const c of cells) spacingOf.set(patchKey(c.ci, c.cj), c.spacing);
  const coarse = (ci: number, cj: number): boolean => spacingOf.get(patchKey(ci, cj)) === PATCH_FAR_SPACING;
  return cells.map((c) =>
    c.spacing === PATCH_FAR_SPACING
      ? NO_STITCH
      : {
        west: coarse(c.ci - 1, c.cj),
        east: coarse(c.ci + 1, c.cj),
        south: coarse(c.ci, c.cj - 1),
        north: coarse(c.ci, c.cj + 1),
      },
  );
}
