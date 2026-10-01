import type { Vec3 } from "./types.js";
import type { World } from "./world.js";
import { ROAD_BED_HALF, ROAD_CORRIDOR_HALF } from "./road.js";
import { activeTerrainVariant } from "./terrain.js";
import { PLAYER_HALF } from "./constants.js";
import { LAKE_SHELF_WIDTH } from "./features.js";

/**
 * The invisible wall at the road: the one place the design admits one
 * (parent §16, B §1.12). The road runs along z with the forest on its +x
 * side (`TRAILHEAD_U` is +9), so the wall is a floor on the hull's road
 * offset u = x − roadCenterX(z).
 *
 * The hull's centre may come no nearer than the pavement's edge, half a metre
 * of shoulder, and its own half-width — so its road-side face stops exactly
 * where the car's does (`CAR_ROAD_U − CAR_HALF.x`), and the car on the
 * shoulder stays a thing you can stand against, not a thing behind glass.
 *
 * Runs inside the movement step on both sides, so a client predicts the
 * wall exactly and never rubber-bands off it.
 */
export const ROAD_WALL_U = ROAD_BED_HALF + 0.5 + PLAYER_HALF.x;

/** Clamps `pos` to the wall and cancels the velocity into it. Returns whether it acted. */
export function containAtRoad(pos: Vec3, vel: Vec3, roadCenterX: number): boolean {
  const wall = roadCenterX + ROAD_WALL_U;
  if (pos.x >= wall) return false;
  pos.x = wall;
  if (vel.x < 0) vel.x = 0;
  return true;
}

/**
 * The wall in a lake: a hull's centre may not go deeper in than `wallQ` from
 * the lake's centre (the shelf's inner edge, where the water is 0.9 m deep),
 * so a player wades to the waist and the camera never goes under. Moves the
 * hull back out along the radius and cancels the velocity into the lake.
 */
export function containAtLake(pos: Vec3, vel: Vec3, cx: number, cz: number, wallQ: number): boolean {
  const rx = pos.x - cx, rz = pos.z - cz;
  const q2 = rx * rx + rz * rz;
  if (q2 >= wallQ * wallQ) return false;
  const q = Math.sqrt(q2);
  // At the very centre there is no outward direction: out along +x.
  const nx = q > 1e-9 ? rx / q : 1;
  const nz = q > 1e-9 ? rz / q : 0;
  pos.x = cx + nx * wallQ;
  pos.z = cz + nz * wallQ;
  const inward = vel.x * nx + vel.z * nz;
  if (inward < 0) {
    vel.x -= inward * nx;
    vel.z -= inward * nz;
  }
  return true;
}

/**
 * The wall in each of a forest world's lakes (`containAtLake`), for any hull,
 * a player's or an enemy's, after its movement step. A hull the wall moved
 * out is lifted to stand on the ground there if it lay below it: the wall
 * puts it on the shelf, up the slope from where the step left it.
 */
export function containInLakes(world: World, pos: Vec3, vel: Vec3, half: Vec3): void {
  if (world.forest === null) return;
  const bodies = activeTerrainVariant().waterBodies?.(world.forest.seed);
  if (bodies === undefined) return;
  let walled = false;
  for (const b of bodies) {
    if (b.kind === "lake" && containAtLake(pos, vel, b.x, b.z, b.radius - LAKE_SHELF_WIDTH)) walled = true;
  }
  if (walled && world.ground !== null) {
    pos.y = Math.max(pos.y, world.ground.heightAt(pos.x, pos.z) + half.y);
  }
}

/** The water a hull at (x, z) wades in: a lake's level within its rim (the
 * marsh lies inside it), the world's sea level elsewhere. */
export function waterLevelAt(world: World, x: number, z: number): number | null {
  if (world.forest !== null) {
    const bodies = activeTerrainVariant().waterBodies?.(world.forest.seed);
    if (bodies !== undefined) {
      for (const b of bodies) {
        if (b.kind !== "lake") continue;
        const dx = x - b.x, dz = z - b.z;
        if (dx * dx + dz * dz < b.radius * b.radius) return b.level;
      }
    }
  }
  return world.waterLevel;
}

/** The road offset of (x, z): `x - roadCenterX(seed, z)`, or null on a world with no road. */
export function roadOffset(world: World, x: number, z: number): number | null {
  if (world.forest === null) return null;
  const roadCenterX = activeTerrainVariant().roadCenterX;
  if (roadCenterX === undefined) return null;
  return x - roadCenterX(world.forest.seed, z);
}

/**
 * The road corridor: the cleared strip ROAD_CORRIDOR_HALF either side of
 * the centreline, where the pad and the car stand. Safe ground (summit.ts):
 * a player on it is never targeted and a Hollow never steps onto it.
 */
export function isOnCorridor(world: World, x: number, z: number): boolean {
  const u = roadOffset(world, x, z);
  return u !== null && (u < 0 ? -u : u) < ROAD_CORRIDOR_HALF;
}
