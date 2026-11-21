/**
 * What a renderer hands the wildlife each frame, made from the simulation's
 * state with no engine: the players' places the animals react to, the
 * director's view of the frame and the match state it goes quiet under,
 * and the frame's events drained for whoever voices them. Each is one
 * object reused across frames: the wildlife's update is a per-frame path.
 */
import { isHollow } from "../sim/hollow.js";
import { AiState, type WorldState } from "../sim/types.js";
import type { PlayerPoint, WildlifeEvent } from "@csarkosh/engine/game/wildlifeBehaviour";
import type { MatchState, View } from "@csarkosh/engine/game/wildlifeDirector";

export type WildlifeInputs = {
  /**
   * The director's view of this frame, filled by `look`: from whichever
   * position is authoritative this frame (the sim's place and aim for a
   * player, never a camera's own transform, which may still be last
   * frame's), and the match from the world state and the nearest Hollow.
   */
  readonly director: { readonly view: View; readonly match: MatchState };
  /** The player positions wildlife reacts to, rebuilt in place: one reused list of reused points. */
  players(state: WorldState): readonly PlayerPoint[];
  /**
   * Fills `director` for a view at (x, y, z) turned `yaw` and `pitch`, of
   * `fov` and `aspect`, at `hour` under a mist of `mist`.
   */
  look(state: WorldState, x: number, y: number, z: number, yaw: number, pitch: number, fov: number, aspect: number, hour: number, mist: number): void;
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
  findHollow(state: WorldState, x: number, z: number): void;
  /**
   * This frame's events, DRAINED: `source` is emptied and its events handed
   * back in one reused list, which the caller copies out of at once.
   */
  drain(source: WildlifeEvent[] | undefined): readonly WildlifeEvent[];
};

export function createWildlifeInputs(): WildlifeInputs {
  // `pool` keeps the point objects alive across the truncation of `players`.
  const pool: PlayerPoint[] = [];
  const players: PlayerPoint[] = [];
  const drained: WildlifeEvent[] = [];
  const view: View = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0, aspect: 0 };
  const match: MatchState = { phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 0, mist: 0 };
  const inputs: WildlifeInputs = {
    director: { view, match },
    players(state) {
      let n = 0;
      for (const p of state.players.values()) {
        let q = pool[n];
        if (q === undefined) {
          q = { x: 0, z: 0 };
          pool[n] = q;
        }
        q.x = p.pos.x;
        q.z = p.pos.z;
        players[n] = q;
        n++;
      }
      players.length = n;
      return players;
    },
    look(state, x, y, z, yaw, pitch, fov, aspect, hour, mist) {
      view.x = x;
      view.y = y;
      view.z = z;
      view.yaw = yaw;
      view.pitch = pitch;
      view.fov = fov;
      view.aspect = aspect;
      inputs.findHollow(state, x, z);
      match.phase = state.phase;
      match.inWorld = true;
      match.hour = hour;
      match.mist = mist;
    },
    findHollow(state, x, z) {
      let distance = Infinity;
      let hunting = false;
      for (const e of state.enemies.values()) {
        if (!isHollow(e)) continue;
        const d = Math.hypot(e.pos.x - x, e.pos.z - z);
        if (d < distance) { distance = d; hunting = e.ai === AiState.Hunt; }
      }
      match.hollowDistance = distance;
      match.hollowHunting = hunting;
    },
    drain(source) {
      let n = 0;
      if (source !== undefined) {
        for (const e of source) drained[n++] = e;
        source.length = 0;
      }
      drained.length = n;
      return drained;
    },
  };
  return inputs;
}
