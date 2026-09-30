/**
 * The bed height texture's contents: a square of terrain heights around the
 * camera, sampled from `elevationAt` (the same function the water rings and
 * the terrain clipmap sample, so the three agree), that the water material
 * reads per pixel for its depth (spec §4.1). Pure and Babylon-free; the
 * water shell uploads `heights` as one R32F texture.
 *
 * Re-centred when the camera leaves the inner half of the square, snapped
 * to a quarter of the extent so consecutive bakes share their alignment.
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
  const originX = bedOriginFor(camX, grid.texels, grid.spacing);
  const originZ = bedOriginFor(camZ, grid.texels, grid.spacing);
  const n = grid.texels;
  for (let iz = 0; iz < n; iz++) {
    const z = originZ + (iz + 0.5) * grid.spacing;
    for (let ix = 0; ix < n; ix++) {
      grid.heights[iz * n + ix] = elevationAt(seed, originX + (ix + 0.5) * grid.spacing, z);
    }
  }
  grid.originX = originX;
  grid.originZ = originZ;
  return true;
}
