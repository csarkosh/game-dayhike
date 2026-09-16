import { ROAD_WALL_U } from "../sim/containment.js";

/** Within this of the wall, the line speaks. */
export const ROAD_LINE_U = ROAD_WALL_U + 0.5;
export const WIN_LINE = "You signed them out.";
/** A player's death: their story closes on this line, and the view holds it. */
export const DEATH_LINE = "The woods had counted you among the missing before you knew that you were lost.";
/** Every player dead: the match's last line, then the landing. */
export const LOSS_LINE = "Nobody signed out. The book was closed from the bottom, by a hand that was not a hand, and the woods went back to counting.";
/** After the loss, the return to the landing. The win takes 5000. */
export const LOSS_LANDING_MS = 8000;

/** What a player at road offset `u` is told, or null when they are not at the wall. */
export function roadLine(u: number, allSignedOut: boolean): string | null {
  if (u > ROAD_LINE_U) return null;
  return allSignedOut ? "Get to the car." : "I need to find those missing hikers first.";
}
