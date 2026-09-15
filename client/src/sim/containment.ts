import type { Vec3 } from "./types.js";
import { ROAD_BED_HALF } from "./road.js";
import { PLAYER_HALF } from "./constants.js";

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
