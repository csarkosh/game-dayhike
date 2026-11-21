import { isHollow } from "../sim/hollow.js";
import { AiState, type WorldState } from "../sim/types.js";
import type { MatchReader } from "@csarkosh/engine/game/wildlifeInputs";

/**
 * Finds the nearest Hollow (`isHollow`: `AiState` Emerge, Hunt, Stand or Watch) to
 * (x, z) and writes its distance and hunting state into the match:
 * `Infinity`/`false` when there is none. The woods go quiet near it and
 * fall silent outright while it hunts (`wildlifeDirector.ts`'s `relaxFor`):
 * a fiction requirement, not an optimisation, so a cue is never staged
 * competing with the one thing the player is supposed to be looking at.
 *
 * Nearest only: a second, farther Hollow actually hunting is masked by a
 * nearer one merely standing or emerging, which only relaxes the cadence
 * rather than silencing it outright. In practice there is one Hollow at a
 * time, so this is a known shape of the single-Hollow match rather than an
 * oversight, not a case this needs to handle today.
 */
export const readHikeMatch: MatchReader<WorldState> = (state, x, z, match) => {
  let distance = Infinity;
  let hunting = false;
  for (const e of state.enemies.values()) {
    if (!isHollow(e)) continue;
    const d = Math.hypot(e.pos.x - x, e.pos.z - z);
    if (d < distance) { distance = d; hunting = e.ai === AiState.Hunt; }
  }
  match.hollowDistance = distance;
  match.hollowHunting = hunting;
  match.phase = state.phase;
};
