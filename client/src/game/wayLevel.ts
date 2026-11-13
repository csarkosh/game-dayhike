/**
 * When the way down's light is up (docs/gameplay/2026-11-13-the-way-down.md):
 * from the summit scene's threshold, the shot in which the player turns to
 * run, through the chase, and gone once the match is decided. The app holds
 * the level and moves it a frame at a time; the renderer draws the light at
 * it and dims the rest of the frame by it.
 */
import type { World } from "../sim/world.js";
import { Outcome, Phase } from "../sim/types.js";
import { THRESHOLD_AT_S } from "./cutscene.js";

/** What the frame outside the light is multiplied by when the light is whole: the woods round the way about half as bright. */
export const WAY_DIM = 0.5;
/** Seconds the light takes to come up, and to go. */
export const WAY_FADE_S = 2;

/**
 * The light's level a frame of `dt` seconds on from `shown`: toward 1 while
 * the world has its way, the match is being played, and either the chase is
 * on or the summit scene has reached its threshold (`sceneInto`, the seconds
 * into the scene the app is timing, or null when it is timing none); toward
 * 0 otherwise.
 */
export function wayLevelFor(sim: World, sceneInto: number | null, shown: number, dt: number): number {
  const phase = sim.state.phase;
  const up =
    sim.way !== null && sim.state.outcome === Outcome.Playing &&
    (phase === Phase.Chase || (phase === Phase.Scene && sceneInto !== null && sceneInto >= THRESHOLD_AT_S));
  const step = dt / WAY_FADE_S;
  return up ? Math.min(1, shown + step) : Math.max(0, shown - step);
}

/** What the frame outside the light is multiplied by at `level`: 1 at none, WAY_DIM at whole. */
export function wayDimAt(level: number): number {
  return 1 - (1 - WAY_DIM) * level;
}
