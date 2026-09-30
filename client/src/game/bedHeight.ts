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

/** Re-centres on the camera and fills the heights; false when no rebake was due. */
export function bakeBed(grid: BedGrid, seed: number, camX: number, camZ: number): boolean {
  if (!bedNeedsRebake(grid, camX, camZ)) return false;
  const bake = beginBake(grid, camX, camZ);
  bakeRows(grid, seed, bake, grid.texels);
  return true;
}

/** A pond's disc as the bed needs it: centre and basin radius, metres. */
export type BedPond = { x: number; z: number; radius: number };

/** How far a pond's disc reaches past its basin radius (renderer.ts `pondDisc`). */
export const POND_DISC_MARGIN = 1;

/**
 * Whether any body can reach `bake`'s square: the sea where the terrain at one
 * of nine points (corners, edge midpoints, centre) is below `waterLevel`, or a
 * pond whose disc overlaps the square. Nine points are 128 m apart on a 256 m
 * square, so a strip of sea between them can be missed; the caller then keeps
 * its current square, and the ring's per-vertex depth stands in outside it, so
 * a miss draws the water coarser, never not at all.
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
    const nx = Math.min(Math.max(p.x, x0), x0 + extent);
    const nz = Math.min(Math.max(p.z, z0), z0 + extent);
    if (Math.hypot(p.x - nx, p.z - nz) <= p.radius + POND_DISC_MARGIN) return true;
  }
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      if (elevationAt(seed, x0 + (i * extent) / 2, z0 + (j * extent) / 2) < waterLevel) return true;
    }
  }
  return false;
}
