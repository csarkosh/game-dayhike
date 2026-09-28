import type { Vec3 } from "./types.js";
import { nextRandom } from "./types.js";
import type { BoxProvider } from "./boxSource.js";
import { depenetrate } from "./collision.js";
import { activeTerrainVariant, elevationSampleAt } from "./terrain.js";
import { facingYaw } from "./facing.js";
import type { Ground } from "./boxGap.js";
import { CAR_HALF, SPAWN_GAP, carSite, trailEntrance, type EntranceGraph } from "./passes/trailhead.js";

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

/** Where a player arrives, and the yaw they face. */
export type Start = { x: number; z: number; yaw: number };

/**
 * A player arrives on the straight line from the car to the trail's
 * entrance, SPAWN_GAP past the point where that line leaves the car's box,
 * facing the entrance. Because they stand on that line, the car is behind
 * them and the entrance ahead whatever way the trail leaves the pad: on 24
 * of the 227 sweep seeds it leaves nearly parallel to the road, and a place
 * fixed in the road's frame could not put the car behind them there.
 */
export function trailheadSpawn(graph: EntranceGraph, car: Ground): Start {
  const e = trailEntrance(graph);
  const lx = e.x - car.x, lz = e.z - car.z;
  const len = Math.sqrt(lx * lx + lz * lz);
  const ux = lx / len, uz = lz / len;
  const ax = ux < 0 ? -ux : ux, az = uz < 0 ? -uz : uz;
  // How far along the line the car's box reaches: the nearer of its two faces.
  const outX = ax === 0 ? Infinity : CAR_HALF.x / ax;
  const outZ = az === 0 ? Infinity : CAR_HALF.z / az;
  const reach = (outX < outZ ? outX : outZ) + SPAWN_GAP;
  const x = car.x + ux * reach, z = car.z + uz * reach;
  return { x, z, yaw: facingYaw(e.x - x, e.z - z) };
}

/**
 * The start on the active terrain's world for a seed, or null where the
 * world has no trail or no road. A pure function of the seed, so the sim
 * that places a player and the game that aims their view agree on every
 * peer with nothing exchanged.
 */
export function trailheadStart(seed: number): Start | null {
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  const roadCenterX = variant.roadCenterX;
  if (graph === undefined || roadCenterX === undefined) return null;
  return trailheadSpawn(graph, carSite(graph, roadCenterX, seed));
}
