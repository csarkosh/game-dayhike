/**
 * The line the chase holds a player to (docs/gameplay/2026-11-13-the-way-down.md):
 * the way down once the scene or the chase is on and the world has one, the
 * trail before that and wherever no way is drawn (the test level, a hand
 * graph). Every rule that asks how far off the line a place is asks here, in
 * the trail's own terms, so its thresholds keep their meaning.
 */
import type { World } from "./world.js";
import { Phase } from "./types.js";
import { trailDistance } from "./trail.js";
import { stemAhead } from "./trailRoute.js";
import { wayDistance, wayPoint, wayProject } from "./wayDown.js";

/**
 * Metres taken off a distance from the way's line, so that its walls' rim
 * (WAY_RIM_M, 5.5) reads as the trail's edge (OFF_TRAIL_FROM_M, 4): the
 * channel is wider than the trail was. A test holds it to their difference.
 */
export const WAY_SLACK_M = 1.5;

/** Whether the world's players are held to the way down: the scene or the chase is on, and there is a way. */
export function onWay(world: World): boolean {
  const phase = world.state.phase;
  return world.way !== null && (phase === Phase.Scene || phase === Phase.Chase);
}

/** Metres (x, z) is off the line, as the trail's distance would read: 0 anywhere inside the way's slack, 0 on a world with no trail. */
export function chaseLineDistance(world: World, x: number, z: number): number {
  if (world.way !== null && onWay(world)) {
    const d = wayDistance(world.way, x, z) - WAY_SLACK_M;
    return d > 0 ? d : 0;
  }
  return world.trail === null ? 0 : trailDistance(world.trail, x, z);
}

/** The line's point `ahead` metres further down it (toward the pad) than its place nearest (x, z), into `out`; null with no line, or past the stem's end. */
export function chaseLinePoint(world: World, x: number, z: number, ahead: number, out: { x: number; z: number }): { x: number; z: number } | null {
  if (world.way !== null && onWay(world)) return wayPoint(world.way, wayProject(world.way, x, z).s + ahead, out);
  if (world.trail === null) return null;
  const down = stemAhead(world.trail, x, z, -ahead);
  if (down === null) return null;
  out.x = down.x;
  out.z = down.z;
  return out;
}
