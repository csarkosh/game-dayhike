/**
 * The lines the game speaks at the road wall, on a player's death, and at
 * the end of the match — the last picked by who came down, not by a single
 * outcome byte.
 */
import { ROAD_WALL_U } from "../sim/containment.js";
import { Phase } from "../sim/types.js";

/** Within this of the wall, the line speaks — on the climb only. */
export const ROAD_LINE_U = ROAD_WALL_U + 0.5;

/** A player's death: their story closes on this line, and the view holds it. */
export const DEATH_LINE = "The woods had counted you among the missing before you knew that you were lost.";

/** The match's last line, chosen by who came down: all, some, none. */
export const END_PASSAGES = {
  all: "You came down out of the woods with the last of the light, every one of you, and the trees let you go. They will count again tomorrow.",
  some: "Not all of you came down. The woods kept what they kept, and those who reached the road did not look back; those who did are looking still.",
  none: "Nobody came down. The woods went back to counting, and the road ran on to a car that nobody drove home.",
} as const;

/** After the loss, the return to the landing. The win takes the same time. */
export const LOSS_LANDING_MS = 8000;
export const WIN_LANDING_MS = 8000;

/**
 * What a player at road offset `u` is told at the wall, or null: on the
 * climb, somebody is still up there; in the chase, nothing — the road is
 * the only way out and the wall no longer needs explaining.
 */
export function roadLine(u: number, phase: Phase): string | null {
  if (phase === Phase.Chase || u > ROAD_LINE_U) return null;
  return "Not yet. Somebody is still up there.";
}
