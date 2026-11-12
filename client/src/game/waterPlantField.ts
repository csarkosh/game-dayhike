/**
 * Where a lake's plants stand, as the sim's clutter places them: the sampling
 * half of `waterPlants.ts`, Babylon-free so the world's worker can do it
 * ahead of the build (`preparedScene.ts`).
 */
import { CLUTTER_LILY, CLUTTER_REED, clutterInRect, type ClutterInstance } from "../sim/clutter.js";
import { POND_SHORE } from "../sim/features.js";
import type { LakeSource } from "../sim/terrain.js";

/** The reed classes' variants: the bulrush, the sedge and the cattail (`REED_CHARACTERS`). */
export const REED_VARIANTS = 3;

/** A lake's reeds, by variant, and its lily pads, as the clutter places them. */
export type WaterPlantPlacements = { reeds: ClutterInstance[][]; pads: ClutterInstance[] };

export function waterPlantPlacements(seed: number, lake: LakeSource): WaterPlantPlacements {
  const reeds: ClutterInstance[][] = Array.from({ length: REED_VARIANTS }, () => []);
  // The lake's box: its farthest shore point and the reeds' POND_SHORE past it, and a metre.
  const shape = lake.shape;
  const r = shape.shoreMax + POND_SHORE + 1;
  for (const inst of clutterInRect(seed, CLUTTER_REED, shape.cx - r, shape.cz - r, shape.cx + r, shape.cz + r)) {
    (reeds[inst.variant] as ClutterInstance[]).push(inst);
  }
  const pads = clutterInRect(seed, CLUTTER_LILY, shape.cx - r, shape.cz - r, shape.cx + r, shape.cz + r);
  return { reeds, pads };
}
