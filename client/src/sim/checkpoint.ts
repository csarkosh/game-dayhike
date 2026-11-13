/**
 * The chase's checkpoint: its rules' constants and tests, which the Hollows,
 * the haunt and the summit all read (docs/gameplay/2026-09-16-the-summit.md
 * §2). A player who dies in the chase is not out of the match: they come
 * back on the crest `RETURN_AFTER_S` later, met by one Hollow already
 * walking at them, and for `RETURN_HOLD_S` (the summit scene's last shot,
 * which their screen plays again) nothing kills them. The coming back itself
 * is `returns.ts`.
 *
 * Only a forest match's chase has it. A hand-authored level keeps death
 * permanent, and nothing kills on the climb.
 */
import type { PlayerState } from "./types.js";
import { Outcome, Phase } from "./types.js";
import type { World } from "./world.js";

/** Seconds from a death in the chase to the return: long enough to read the death's line once. */
export const RETURN_AFTER_S = 6;
/** Seconds a returning player is held, and their Hollow steps out: the length of the summit scene's last shot (`SHOTS[4]`, game/cutscene.ts; a test holds the two equal). */
export const RETURN_HOLD_S = 4;
/** Metres into its walk the Hollow already is as the player returns. */
export const RETURN_HEAD_START_M = 1.5;
/** The most Hollows a return may leave hunting: above the twelve a first attempt's forks have been measured to make. At it, a return moves one and raises none. */
export const HOLLOW_PACK_MAX = 14;

/** Whether a death in this world comes back: the host's forest match with a summit, in the chase, still being played. */
export function returnsOn(world: World): boolean {
  return (
    world.authoritative && world.forest !== null && world.search !== null && !world.peaceful &&
    world.state.phase === Phase.Chase && world.state.outcome === Outcome.Playing
  );
}

/**
 * Whether a forest match is decided. The first player to the road wins it
 * with others still out on the mountain, alive, their Hollows on them: from
 * then nothing kills, since no death would come back and every screen is in
 * the end scene.
 */
export function decided(world: World): boolean {
  return world.forest !== null && world.state.outcome !== Outcome.Playing;
}

/** Whether `p` is in the hold after a return: nothing kills them. */
export function held(p: PlayerState): boolean {
  return p.heldFor > 0;
}
