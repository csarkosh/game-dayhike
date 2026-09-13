import type { Vec3 } from "./types.js";
import { nextRandom } from "./types.js";
import type { BoxProvider } from "./boxSource.js";
import { depenetrate } from "./collision.js";
import { activeTerrainVariant, elevationSampleAt } from "./terrain.js";

/** Attempts per call. Bounded so a caller cannot hang the tick. */
const RING_ATTEMPTS = 8;

/** Minimum surface height above sea level for a spawn. */
export const SPAWN_FREEBOARD = 2;

/**
 * A hull standing on the ground at (x, z), or null if that spot is occupied.
 *
 * Validated with `depenetrate` rather than by inspecting geometry: that is the
 * exact test the first movement tick will apply, so agreeing with it is the only
 * useful definition of "valid". It also rejects for free anything the elevation
 * field cannot see — any prop a future feature pass emits — because those all
 * displace a hull placed inside them.
 */
export function groundSpawn(
  source: BoxProvider,
  seed: number,
  x: number,
  z: number,
  half: Vec3,
): Vec3 | null {
  const s = elevationSampleAt(seed, x, z);
  const waterLevel = activeTerrainVariant().waterLevel;
  if (waterLevel !== undefined && s.h < waterLevel + SPAWN_FREEBOARD) return null;
  const p: Vec3 = { x, y: s.h + half.y, z };
  const fixed = depenetrate(p, half, source);
  const moved =
    Math.abs(fixed.x - p.x) > 1e-9 ||
    Math.abs(fixed.y - p.y) > 1e-9 ||
    Math.abs(fixed.z - p.z) > 1e-9;
  return moved ? null : p;
}

/**
 * Outward square spiral from `centre` (the world origin by default; the trailhead flat for the olympic variant) in 4 m steps, returning the first
 * valid hull position.
 *
 * Deterministic, which is the point: every peer picks the same first spawn from
 * the seed alone, with nothing exchanged over the wire.
 */
export function spiralSpawn(
  source: BoxProvider,
  seed: number,
  half: Vec3,
  centre: { x: number; z: number } = { x: 0.5, z: 0.5 },
): Vec3 {
  const STEP = 4;
  for (let ring = 0; ring < 64; ring++) {
    for (let i = -ring; i <= ring; i++) {
      const candidates: Array<[number, number]> = [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ];
      for (const [gx, gz] of candidates) {
        const p = groundSpawn(source, seed, centre.x + gx * STEP, centre.z + gz * STEP, half);
        if (p !== null) return p;
      }
    }
  }
  // 64 rings is 256 m of searching. Returning something is better than throwing:
  // a player standing 1 cm inside a rock is recoverable, a crash is not.
  const s = elevationSampleAt(seed, centre.x, centre.z);
  return { x: centre.x, y: s.h + half.y, z: centre.z };
}

/**
 * A point in the annulus [minR, maxR] around `around`, or null after a bounded
 * number of attempts.
 *
 * Rejection-samples a square rather than picking a random bearing, because a
 * bearing needs `Math.cos`/`Math.sin` and those are implementation-defined — two
 * browsers would place enemies differently from the same seed. This uses
 * multiplication only.
 *
 * Always consumes from the stream, including on failure, so a caller retrying
 * every tick makes progress instead of redrawing the same rejected point.
 */
export function ringSample(
  rng: { rngSeed: number },
  around: Vec3,
  minR: number,
  maxR: number,
): Vec3 | null {
  const minSq = minR * minR;
  const maxSq = maxR * maxR;
  for (let attempt = 0; attempt < RING_ATTEMPTS; attempt++) {
    const dx = (nextRandom(rng) * 2 - 1) * maxR;
    const dz = (nextRandom(rng) * 2 - 1) * maxR;
    const dSq = dx * dx + dz * dz;
    if (dSq < minSq || dSq > maxSq) continue;
    return { x: around.x + dx, y: around.y, z: around.z + dz };
  }
  return null;
}
