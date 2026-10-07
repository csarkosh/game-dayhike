/**
 * The lines the game speaks at the road wall, on a player's death, and on
 * a win. There is no panel of names at the end: the line is the end.
 */
import { ROAD_WALL_U } from "../sim/containment.js";
import { Phase } from "../sim/types.js";

/** Within this of the wall, the line speaks — on the climb only. */
export const ROAD_LINE_U = ROAD_WALL_U + 0.5;

/**
 * A player's death: their story closes on this line as the body goes down
 * and the dark closes (ending.ts). The title's shape, three parts and a
 * turn: the one who went looking for the missing,
 * gone under the leaves with no one left to look for them, in the manner of Poe.
 */
export const DEATH_LINE = "The light guttering; their name, unanswered; and the help, cold beneath the leaves, sought nevermore.";
/**
 * The match won, as the camera lifts to the sky: the same shape, and the
 * turn, ten words like the title's, lets them out but not alone.
 */
export const WON_LINE = "The night, outlasted; the car, at last; and in the mirror, a shadow, where no one sat.";

/** After a loss, the return to the landing comes this long after the end. */
export const END_LANDING_MS = 8000;
/** Won: the camera's lift under the line runs this long before the view goes dark (ending.ts WON_LIFT_S and the blur after it), and the landing comes at WON_LANDING_MS. */
export const WON_FADE_AFTER_MS = 7000;
export const WON_LANDING_MS = 10000;
/** Died: the HUD's own fade finishes the black this long after the fall begins, once the dark has closed (ending.ts). */
export const DEATH_FADE_AFTER_MS = 3500;

/**
 * What a player at road offset `u` is told at the wall, or null: on the
 * climb, somebody is still up there; in the chase, nothing — the road is
 * the only way out and the wall no longer needs explaining.
 */
export function roadLine(u: number, phase: Phase): string | null {
  if (phase === Phase.Chase || u > ROAD_LINE_U) return null;
  return "Not yet. Somebody is still up there.";
}
