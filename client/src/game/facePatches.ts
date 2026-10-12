/**
 * Patches of finer rock over the steep ground. The world is divided into
 * `PATCH_CELL` metre cells on its own lattice; a cell with steep ground in
 * reach gets a patch: a finer grid of the same ground, each vertex pushed out
 * along the ground's normal by the rock relief (`sim/faceRelief.ts`), masked
 * by the ground's gradient so the push is nothing where the ground is not
 * steep, and faded out toward the cells outside the patched set. The patch
 * is painted as the clipmap paints the ground under it, so it is the same
 * rock in the same light; the ground itself is not changed.
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
/** The most a patch vertex moves out along the ground's normal, metres: the
 * relief's half-depth doubled, its whole range from the smooth face out. */
export const PATCH_DEPTH = 2.0;
/** Vertex spacing (m) of the cells within the near reach. */
export const PATCH_NEAR_SPACING = 0.5;
/** Vertex spacing (m) of the cells beyond it, within the far reach. */
export const PATCH_FAR_SPACING = 1;
/** The distance (m) over which the relief fades to nothing toward a cell
 * outside the patched set, so a patch never ends with its relief in the air. */
export const PATCH_TAPER = 3;

export type PatchReach = { readonly near: number; readonly far: number };

/** Per tier: the camera's distance (m) to a cell's centre within which the
 * cell is fine (`near`) and within which it is patched at all (`far`). */
export const PATCH_REACH: Readonly<Record<QualityTier, PatchReach>> = {
  high: { near: 48, far: 160 },
  medium: { near: 36, far: 120 },
  low: { near: 24, far: 80 },
};

export type PatchCell = { ci: number; cj: number; spacing: number };

/** A cell's eight neighbours as (di, dj): the four sides, then the four
 * corners. Bit k of a stitch's `open` is neighbour k. */
export const PATCH_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/** The bits of `PatchStitch.open`, one a neighbour, in `PATCH_NEIGHBOURS`' order. */
export const OPEN_WEST = 1;
export const OPEN_EAST = 2;
export const OPEN_SOUTH = 4;
export const OPEN_NORTH = 8;
export const OPEN_SOUTH_WEST = 16;
export const OPEN_SOUTH_EAST = 32;
export const OPEN_NORTH_WEST = 64;
export const OPEN_NORTH_EAST = 128;

/** Which edges of a fine cell meet a coarse cell, whose midpoints are then
 * laid on the coarse edge; and `open`, which of the cell's eight neighbours
 * are outside the patched set, toward which the relief fades out. */
export type PatchStitch = {
  readonly west: boolean;
  readonly east: boolean;
  readonly north: boolean;
  readonly south: boolean;
  readonly open: number;
};

export const NO_STITCH: PatchStitch = { west: false, east: false, north: false, south: false, open: 0 };

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
 * The relief's share at (x, z), a point of cell (ci, cj), toward the
 * neighbours `open` flags: a quintic step of the distance from the point to
 * the nearest of their squares, 0 on it and 1 from PATCH_TAPER in. Every
 * square outside the set within PATCH_TAPER of a point of the cell is one of
 * its eight neighbours, so two patches that share a point find the same
 * squares and taper it alike, bit for bit.
 */
export function patchTaper(ci: number, cj: number, open: number, x: number, z: number): number {
  if (open === 0) return 1;
  let near = PATCH_TAPER;
  for (let k = 0; k < PATCH_NEIGHBOURS.length; k++) {
    if ((open & (1 << k)) === 0) continue;
    const [di, dj] = PATCH_NEIGHBOURS[k] as readonly [number, number];
    const lx = (ci + di) * PATCH_CELL;
    const lz = (cj + dj) * PATCH_CELL;
    const ex = x < lx ? lx - x : x > lx + PATCH_CELL ? x - (lx + PATCH_CELL) : 0;
    const ez = z < lz ? lz - z : z > lz + PATCH_CELL ? z - (lz + PATCH_CELL) : 0;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < near) near = d;
  }
  return near >= PATCH_TAPER ? 1 : stepT(near / PATCH_TAPER);
}

/**
 * The patch surface at (x, z) into `pos`, and its unit normal into `nrm`,
 * both at `at`: the ground pushed out along its normal by the masked relief,
 * `taper` times. Every position and normal a patch holds comes from here,
 * from the world point and the squares outside the set alone, so a point is
 * the same doubles in every patch that holds it, whatever its spacing.
 *
 * The push is k = d / sqrt(1 + g²) along n = (−h_x, 1, −h_z), with
 * d = m · PATCH_DEPTH · (v + 1) / 2. The normal is the displaced surface's,
 * from the field's own derivatives: ∂P/∂x ≈ (1, h_x, 0) + n · ∂k/∂x with
 * ∂k/∂x = (m · PATCH_DEPTH / 2 · v_x) / sqrt(1 + g²), likewise in z, the
 * slowly varying terms (the mask's, the ground normal's, sqrt(1 + g²)'s)
 * left out; then ∂P/∂z × ∂P/∂x, which is (−h_x, 1, −h_z) where the relief
 * is nothing, up on flat ground as the clipmap's. A column's flat face
 * shades flat and its joint steep whatever the grid's spacing.
 */
function surfaceInto(
  seed: number, s: TerrainSample, x: number, z: number, taper: number,
  pos: Float64Array, nrm: Float64Array, at: number,
): void {
  const g2 = s.dx * s.dx + s.dz * s.dz;
  const m = faceMask(Math.sqrt(g2)) * taper;
  let kx = 0;
  let kz = 0;
  if (m === 0) {
    pos[at] = x;
    pos[at + 1] = s.h;
    pos[at + 2] = z;
  } else {
    const r = faceReliefD(seed, x, z);
    const q = Math.sqrt(1 + g2);
    const d = (m * PATCH_DEPTH * (r.v + 1)) / 2;
    const k = d / q;
    pos[at] = x - s.dx * k;
    pos[at + 1] = s.h + k;
    pos[at + 2] = z - s.dz * k;
    const half = (m * PATCH_DEPTH) / 2;
    kx = (half * r.dx) / q;
    kz = (half * r.dz) / q;
  }
  const ax = 1 - s.dx * kx;
  const ay = s.dx + kx;
  const az = -s.dz * kx;
  const bx = -s.dx * kz;
  const by = s.dz + kz;
  const bz = 1 - s.dz * kz;
  const nx = by * az - bz * ay;
  const ny = bz * ax - bx * az;
  const nz = bx * ay - by * ax;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nrm[at] = nx / len;
  nrm[at + 1] = ny / len;
  nrm[at + 2] = nz / len;
}

/**
 * The patch of cell (ci, cj) at `spacing` (0.5 or 1 m), or null when no point
 * of its grid, boundary included, has steep ground. The grid is the cell's
 * own (16/spacing + 1)² points. The relief fades out toward the neighbours
 * `stitch.open` flags (`patchTaper`). On each edge `stitch` flags, the odd
 * points are laid on the line between their two even neighbours, as the
 * coarse patch beside draws that edge, and painted as the coarse patch's
 * interpolation paints them; the even points are the coarse patch's own,
 * position and normal, since both come from the world point alone.
 */
export function facePatchGeometry(
  seed: number, ci: number, cj: number, spacing: number, stitch: PatchStitch,
): FacePatch | null {
  const n = Math.round(PATCH_CELL / spacing);
  const side = n + 1;
  const count = side * side;
  const x0 = ci * PATCH_CELL;
  const z0 = cj * PATCH_CELL;
  const samples: TerrainSample[] = new Array<TerrainSample>(count);
  let steep = false;
  for (let iz = 0; iz < side; iz++) {
    const z = z0 + iz * spacing;
    for (let ix = 0; ix < side; ix++) {
      const s = elevationSampleAt(seed, x0 + ix * spacing, z);
      samples[iz * side + ix] = s;
      if (!steep && faceMask(Math.sqrt(s.dx * s.dx + s.dz * s.dz)) > 0) steep = true;
    }
  }
  if (!steep) return null;

  const pos = new Float64Array(count * 3);
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
      const s = samples[at] as TerrainSample;
      surfaceInto(seed, s, x, z, patchTaper(ci, cj, stitch.open, x, z), pos, nrm, at * 3);
      for (let c = 0; c < 3; c++) {
        positions[at * 3 + c] = pos[at * 3 + c] as number;
        normals[at * 3 + c] = nrm[at * 3 + c] as number;
      }

      // Painted as the clipmap paints the ground at this point: the same
      // calls with the same inputs (`clipmap.ts`, `sampleInto`).
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
    const attrs = { positions, normals, colors, weights, weights2, cover };
    if (stitch.west) stitchEdge(attrs, 0, side, n);
    if (stitch.east) stitchEdge(attrs, n, side, n);
    if (stitch.south) stitchEdge(attrs, 0, 1, n);
    if (stitch.north) stitchEdge(attrs, n * side, 1, n);
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

type PatchAttributes = Pick<FacePatch, "positions" | "normals" | "colors" | "weights" | "weights2" | "cover">;

/** The mean of `width` values at vertices `lo` and `hi` into vertex `at`. */
function meanInto(a: Float32Array, width: number, at: number, lo: number, hi: number): void {
  for (let c = 0; c < width; c++) {
    a[at * width + c] = ((a[lo * width + c] as number) + (a[hi * width + c] as number)) / 2;
  }
}

/**
 * One edge of a fine patch laid on the coarse patch's edge: each odd point
 * the mean of its two even neighbours, as the coarse patch interpolates its
 * edge between them: position, normal (made unit again), colour, weights and
 * cover. The edge's `n + 1` points run from vertex `start` in steps of `stride`.
 */
function stitchEdge(p: PatchAttributes, start: number, stride: number, n: number): void {
  for (let i = 1; i < n; i += 2) {
    const at = start + i * stride;
    const lo = at - stride;
    const hi = at + stride;
    meanInto(p.positions, 3, at, lo, hi);
    meanInto(p.normals, 3, at, lo, hi);
    meanInto(p.colors, 4, at, lo, hi);
    meanInto(p.weights, 4, at, lo, hi);
    meanInto(p.weights2, WEIGHTS2_STRIDE, at, lo, hi);
    meanInto(p.cover, 1, at, lo, hi);
    const nx = p.normals[at * 3] as number;
    const ny = p.normals[at * 3 + 1] as number;
    const nz = p.normals[at * 3 + 2] as number;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    p.normals[at * 3] = nx / len;
    p.normals[at * 3 + 1] = ny / len;
    p.normals[at * 3 + 2] = nz / len;
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
 * a coarse neighbour's (an edge whose neighbour is in the set at the far
 * spacing; a coarse cell stitches nothing), and which of its eight
 * neighbours are outside the set, not drawn, toward which its relief fades.
 */
export function facePatchStitch(cells: readonly PatchCell[]): PatchStitch[] {
  const spacingOf = new Map<number, number>();
  for (const c of cells) spacingOf.set(patchKey(c.ci, c.cj), c.spacing);
  const coarse = (ci: number, cj: number): boolean => spacingOf.get(patchKey(ci, cj)) === PATCH_FAR_SPACING;
  return cells.map((c) => {
    let open = 0;
    PATCH_NEIGHBOURS.forEach(([di, dj], k) => {
      if (!spacingOf.has(patchKey(c.ci + di, c.cj + dj))) open |= 1 << k;
    });
    const fine = c.spacing !== PATCH_FAR_SPACING;
    return {
      west: fine && coarse(c.ci - 1, c.cj),
      east: fine && coarse(c.ci + 1, c.cj),
      south: fine && coarse(c.ci, c.cj - 1),
      north: fine && coarse(c.ci, c.cj + 1),
      open,
    };
  });
}
