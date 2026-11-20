/**
 * The bed height square following the camera, with no engine: the grid the
 * water's materials read their depth from, the spare one a new square is
 * baked into a row a frame, and the swap when it is whole (`bedHeight.ts`
 * has the grids and the bake). Whoever draws the water steps this once a
 * frame and uploads the grid whenever the step says it has changed.
 */
import {
  BED_GRID, bakeBed, bakeRows, bedNeedsRebake, bedOutsideSquare, bedSquareHasWater, beginBake, createBedGrid,
  type BedBake, type BedGrid, type BedPond,
} from "./bedHeight.js";
import type { QualityTier } from "@csarkosh/engine/game/quality";

/** Rows of the bed grid baked per frame: a whole 256² grid measured 260 to 295 ms. */
export const BED_ROWS_PER_FRAME = 1;

export type BedFollow = {
  /** The grid the water is drawn by now: another object after a swap. */
  readonly grid: BedGrid;
  /** The grid's texels a side and their spacing (m): the tier's. */
  readonly texels: number;
  readonly spacing: number;
  /**
   * A frame with the camera at (camX, camZ). True when the grid to draw by
   * has changed (filled again, or swapped for the spare): it is uploaded
   * with its origin before the next draw.
   */
  step(camX: number, camZ: number): boolean;
};

/**
 * The bed for `tier` in world `seed`, first filled around (camX, camZ) at
 * once, or taken as `bakedAhead`. `ponds` are the world's lakes and
 * `waterLevel` its sea's: a new square is baked only where one of them can
 * reach it.
 */
export function createBedFollow(
  tier: QualityTier, seed: number, ponds: readonly BedPond[], waterLevel: number, camX: number, camZ: number, bakedAhead: BedGrid | null = null,
): BedFollow {
  const { texels, spacing } = BED_GRID[tier];
  let grid = bakedAhead ?? createBedGrid(texels, spacing);
  let spare = createBedGrid(texels, spacing);
  let bake: BedBake | null = null;
  // The last square found out of every body's reach: not asked again until
  // the camera's square changes.
  let dryX = Number.NaN;
  let dryZ = Number.NaN;
  let firstStep = true;
  // The first fill is at load, before any frame is shown: the whole grid at
  // once, unless it came baked ahead.
  if (bakedAhead === null) bakeBed(grid, seed, camX, camZ);
  return {
    get grid() {
      return grid;
    },
    texels,
    spacing,
    step(x, z) {
      let changed = false;
      // The bed re-centres a row a frame into the spare grid (a whole 256²
      // bake is 260 to 295 ms) and swaps in when complete.
      if (firstStep) {
        // The camera's real start is only known now: if it is outside the grid
        // made at creation, fill the whole grid at once (at load, before the
        // first frame is shown) rather than draw ~256 frames on the wrong bed.
        firstStep = false;
        if (bakeBed(grid, seed, x, z)) changed = true;
      }
      // A bake whose square the camera has already left (a teleport, a fast
      // ride) would swap in a bed for somewhere else: start over. Only the
      // whole square counts: leaving its inner half is what starts a bake, and
      // dropping on that would never let steady motion finish one.
      if (bake !== null && bedOutsideSquare(bake.originX, bake.originZ, texels, spacing, x, z)) bake = null;
      if (bake === null && bedNeedsRebake(grid, x, z)) {
        const next = beginBake(spare, x, z);
        // Where no body reaches the new square the current bed is kept: outside
        // it the ring's per-vertex depth stands in, and there is no water there.
        if (next.originX !== dryX || next.originZ !== dryZ) {
          if (bedSquareHasWater(next, spare, ponds, waterLevel, seed)) bake = next;
          else [dryX, dryZ] = [next.originX, next.originZ];
        }
      }
      if (bake !== null && bakeRows(spare, seed, bake, BED_ROWS_PER_FRAME)) {
        [grid, spare] = [spare, grid];
        bake = null;
        changed = true;
      }
      return changed;
    },
  };
}
