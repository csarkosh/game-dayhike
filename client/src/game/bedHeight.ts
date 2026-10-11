/**
 * The bed height texture's contents: a square of terrain heights around the
 * camera, sampled from `elevationAt` (the same function the water rings and
 * the terrain clipmap sample, so the three agree), that the water material
 * reads per pixel for its depth (spec §4.1). Pure and Babylon-free; the
 * water shell uploads `heights` as one R32F texture.
 *
 * Re-centred when the camera leaves the inner half of the square, snapped
 * to a quarter of the extent so consecutive bakes share their alignment.
 *
 * A whole-grid bake (`bakeBed`) fills synchronously in ~260–295 ms and cannot
 * run in a frame. For production, use the incremental API: `beginBake` starts
 * a bake into a spare grid, then `bakeRows` fills a few rows per frame (~1 ms
 * per row). The caller keeps the spare grid, swaps it in when `bakeRows` returns
 * true, then uses it as the spare for the next bake.
 */
import { elevationAt } from "../sim/terrain.js";
import { lakeShoreInto, newLakeShore, type LakeShape } from "../sim/lakeShape.js";
import type { QualityTier } from "./quality.js";

export type BedGrid = {
  texels: number;
  /** Metres per texel. */
  spacing: number;
  /** World x and z of the grid's min corner. */
  originX: number;
  originZ: number;
  /** texels² heights, row-major by (iz, ix), each at its texel's centre. */
  heights: Float32Array;
};

/** A bake in progress into a spare grid: the origin it is for and the next row to fill. */
export type BedBake = { originX: number; originZ: number; nextRow: number };

/** Spec §4.1's table. */
export const BED_GRID: Record<QualityTier, { texels: number; spacing: number }> = {
  high: { texels: 256, spacing: 1 },
  medium: { texels: 256, spacing: 1 },
  low: { texels: 128, spacing: 2 },
};

export function createBedGrid(texels: number, spacing: number): BedGrid {
  return { texels, spacing, originX: Number.NaN, originZ: Number.NaN, heights: new Float32Array(texels * texels) };
}

/** The min corner for a camera at `cam`: half an extent back, snapped down to a quarter extent. */
export function bedOriginFor(cam: number, texels: number, spacing: number): number {
  const extent = texels * spacing;
  const step = extent / 4;
  return Math.floor((cam - extent / 2) / step) * step;
}

/** Starts a bake for a camera position: the origin the grid will have once `bakeRows` finishes. */
export function beginBake(grid: BedGrid, camX: number, camZ: number): BedBake {
  return {
    originX: bedOriginFor(camX, grid.texels, grid.spacing),
    originZ: bedOriginFor(camZ, grid.texels, grid.spacing),
    nextRow: 0,
  };
}

/**
 * Fills up to `rows` rows of `target` for `bake`'s origin and returns true when
 * the whole grid is filled. `target`'s own origin is written only on that last
 * call, so a reader of (origin, heights) never sees one changed without the
 * other; the caller keeps `target` as a spare and swaps it in when this
 * returns true. About 1 ms a row at 256 texels (3.8 µs a sample, measured).
 */
export function bakeRows(target: BedGrid, seed: number, bake: BedBake, rows: number): boolean {
  const n = target.texels;
  const end = Math.min(n, bake.nextRow + rows);
  for (let iz = bake.nextRow; iz < end; iz++) {
    const z = bake.originZ + (iz + 0.5) * target.spacing;
    for (let ix = 0; ix < n; ix++) {
      target.heights[iz * n + ix] = elevationAt(seed, bake.originX + (ix + 0.5) * target.spacing, z);
    }
  }
  bake.nextRow = end;
  if (end < n) return false;
  target.originX = bake.originX;
  target.originZ = bake.originZ;
  return true;
}

/** True when the camera is outside the inner half of the current square (or nothing is baked). */
export function bedNeedsRebake(grid: BedGrid, camX: number, camZ: number): boolean {
  if (Number.isNaN(grid.originX)) return true;
  const extent = grid.texels * grid.spacing;
  const q = extent / 4;
  const inX = camX >= grid.originX + q && camX < grid.originX + extent - q;
  const inZ = camZ >= grid.originZ + q && camZ < grid.originZ + extent - q;
  return !(inX && inZ);
}

/**
 * True when the camera is outside the square [origin, origin + extent) on
 * either axis: a bake for that square is then for somewhere the camera has
 * left, and is dropped. While the camera is inside it, even past its inner
 * half, the bake goes on: the bed it swaps in still holds the camera, and a
 * camera moving a quarter extent a bake would otherwise never finish one.
 */
export function bedOutsideSquare(
  originX: number,
  originZ: number,
  texels: number,
  spacing: number,
  camX: number,
  camZ: number,
): boolean {
  const extent = texels * spacing;
  const inX = camX >= originX && camX < originX + extent;
  const inZ = camZ >= originZ && camZ < originZ + extent;
  return !(inX && inZ);
}

/** Re-centres on the camera and fills the heights; false when no rebake was due. */
export function bakeBed(grid: BedGrid, seed: number, camX: number, camZ: number): boolean {
  if (!bedNeedsRebake(grid, camX, camZ)) return false;
  const bake = beginBake(grid, camX, camZ);
  bakeRows(grid, seed, bake, grid.texels);
  return true;
}

/** A lake as the bed needs it: its centre, its shape and how far its ground reaches. */
export type BedPond = { x: number; z: number; bound: number; shape: LakeShape };

/** How far past a lake's shore its surface reaches, metres (renderer.ts `lakeSurface`). */
export const LAKE_SURFACE_REACH = 3;
/** The lattice a lake's part of a square is read on (m), and the shore distance past the surface's reach a lattice point may stand and still answer for the square about it (m): 2√2 m to the nearest lattice point at a stretch of up to 1.6. */
const BED_LAKE_STEP = 4;
const BED_LAKE_SLACK = 5;

const BED_SHORE = newLakeShore();

/**
 * Whether any body can reach `bake`'s square: the sea where the terrain at one
 * of nine points (corners, edge midpoints, centre) is below `waterLevel`, or a
 * lake whose box overlaps the square and whose shore distance, on a
 * BED_LAKE_STEP lattice over the overlap, comes within LAKE_SURFACE_REACH and
 * BED_LAKE_SLACK of the shore. Nine points are 128 m apart on a 256 m square,
 * so a strip of sea between them can be missed; the caller then keeps its
 * current square, and the ring's per-vertex depth stands in outside it, so a
 * miss draws the water coarser, never not at all.
 */
export function bedSquareHasWater(
  bake: BedBake,
  grid: BedGrid,
  ponds: readonly BedPond[],
  waterLevel: number,
  seed: number,
): boolean {
  const extent = grid.texels * grid.spacing;
  const x0 = bake.originX;
  const z0 = bake.originZ;
  for (const p of ponds) {
    const ax = Math.max(x0, p.x - p.bound), bx = Math.min(x0 + extent, p.x + p.bound);
    const az = Math.max(z0, p.z - p.bound), bz = Math.min(z0 + extent, p.z + p.bound);
    if (ax > bx || az > bz) continue;
    for (let z = az; z <= bz; z += BED_LAKE_STEP) {
      for (let x = ax; x <= bx; x += BED_LAKE_STEP) {
        if (lakeShoreInto(BED_SHORE, p.shape, x, z).s > -(LAKE_SURFACE_REACH + BED_LAKE_SLACK)) return true;
      }
    }
  }
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      if (elevationAt(seed, x0 + (i * extent) / 2, z0 + (j * extent) / 2) < waterLevel) return true;
    }
  }
  return false;
}
