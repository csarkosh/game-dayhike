// client/src/game/waterGround.ts
/**
 * What the ground paint needs from the water at a point: how far under a lake
 * it lies (`bed`), that lake's murk, the marsh's weight and the cove's. Pure
 * and Babylon-free: `clipmap.ts` asks it per vertex beside `groundCover`.
 */
import { marshWeightAt } from "../sim/features.js";
import { activeTerrainVariant } from "../sim/terrain.js";

export type WaterGround = { bed: number; murk: number; marsh: number; cove: number };
export const NO_WATER_GROUND: WaterGround = Object.freeze({ bed: 0, murk: 0, marsh: 0, cove: 0 });

/** The bed's paint comes in from this far above a lake's waterline (m)… */
export const BED_PAINT_TOP = 0.05;
/** …and is whole from this far below it. */
export const BED_PAINT_FULL = 0.2;

export function waterGroundAt(seed: number, x: number, z: number, h: number): WaterGround {
  const variant = activeTerrainVariant();
  const cove = variant.coveMask?.(seed, x, z) ?? 0;
  let bed = 0;
  let murk = 0;
  let marsh = 0;
  const bodies = variant.waterBodies?.(seed);
  if (bodies !== undefined) {
    for (const b of bodies) {
      if (b.kind !== "lake") continue;
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz >= b.radius * b.radius) continue;
      const t = Math.min(1, Math.max(0, (b.level - h + BED_PAINT_TOP) / (BED_PAINT_FULL + BED_PAINT_TOP)));
      bed = t * t * (3 - 2 * t);
      murk = b.murk;
      marsh = marshWeightAt(b, x, z);
    }
  }
  return cove === 0 && bed === 0 && marsh === 0 ? NO_WATER_GROUND : { bed, murk, marsh, cove };
}
