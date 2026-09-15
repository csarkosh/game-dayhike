import { ROAD_WALL_U } from "../sim/containment.js";

/** Within this of the wall, the line speaks. */
export const ROAD_LINE_U = ROAD_WALL_U + 0.5;
export const WIN_LINE = "You signed them out.";

/** What a player at road offset `u` is told, or null when they are not at the wall. */
export function roadLine(u: number, allSignedOut: boolean): string | null {
  if (u > ROAD_LINE_U) return null;
  return allSignedOut ? "Get to the car." : "I need to find those missing hikers first.";
}
