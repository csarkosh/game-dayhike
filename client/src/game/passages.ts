/**
 * The lines the game speaks on a player's death and on a win, and where the
 * road's wall is for the inner voice's line there. There is no panel of names
 * at the end: the line is the end.
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
 * The match won, over the car going down the road (endScene.ts): the same
 * shape, and the turn, ten words like the title's, lets them out but not
 * alone. Its timings are the end scene's own.
 */
/** The end's titles, in the title screen's voice (hud.ts draws them uppercase). */
export const WON_TITLE = "You lived";
export const DEATH_TITLE = "You died";

/** A line as the end draws it: two lines, the turn alone on the second (the title screen's shape). */
export function endLines(line: string): [string, string] {
  const at = line.lastIndexOf("; ");
  return at < 0 ? [line, ""] : [line.slice(0, at + 1), line.slice(at + 2)];
}

export const WON_LINE = "The night, outlasted; the car, at last; and in the mirror, a shadow, where no one sat.";

/** After a loss, the return to the landing comes this long after the end. */
export const END_LANDING_MS = 12000;
/** Died: the HUD's own fade finishes the black this long after the fall begins, once the dark has closed (ending.ts). */
export const DEATH_FADE_AFTER_MS = 6000;
/** Died: the master's fade from the dark's closing (ending.ts DIED_CLOSE_FROM_S), so the sound is gone at 6 s, as the HUD's black begins. */
export const DEATH_SOUND_FADE_S = 5;

/**
 * Whether a player at road offset `u` stands at the wall where the inner
 * voice says it will not leave (`innerLines.ts` `road`): on the climb, within
 * half a metre of it; in the chase never, since the road is the only way out
 * and the wall no longer needs explaining; on a peaceful world
 * (`gameMode.ts`) never, since there is no wall and no one up there.
 */
export function atRoadWall(u: number, phase: Phase, peaceful = false): boolean {
  return !peaceful && phase === Phase.Climb && u <= ROAD_LINE_U;
}
