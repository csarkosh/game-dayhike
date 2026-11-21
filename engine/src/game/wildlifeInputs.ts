/**
 * What a renderer hands the wildlife each frame, made from the simulation's
 * state with no engine: the players' places the animals react to, the
 * director's view of the frame and the match state it goes quiet under
 * (which the game's reader fills, if it has one), and the frame's events
 * drained for whoever voices them. Each is one object reused across
 * frames: the wildlife's update is a per-frame path.
 */
import type { PlayerPoint, WildlifeEvent } from "./wildlifeBehaviour.js";
import type { MatchState, View } from "./wildlifeDirector.js";

/** What a game says of its match for the animals, for a view at (x, z): it writes `phase`, `hollowDistance` and `hollowHunting` into `match`. */
export type MatchReader<S> = (state: S, x: number, z: number, match: MatchState) => void;

export type WildlifeInputs<S> = {
  /**
   * The director's view of this frame, filled by `look`: from whichever
   * position is authoritative this frame (the sim's place and aim for a
   * player, never a camera's own transform, which may still be last
   * frame's), and the match as the game's reader says it.
   */
  readonly director: { readonly view: View; readonly match: MatchState };
  /** The player positions wildlife reacts to, rebuilt in place: one reused list of reused points. */
  players(state: S): readonly PlayerPoint[];
  /**
   * Fills `director` for a view at (x, y, z) turned `yaw` and `pitch`, of
   * `fov` and `aspect`, at `hour` under a mist of `mist`.
   */
  look(state: S, x: number, y: number, z: number, yaw: number, pitch: number, fov: number, aspect: number, hour: number, mist: number): void;
  /**
   * This frame's events, DRAINED: `source` is emptied and its events handed
   * back in one reused list, which the caller copies out of at once.
   */
  drain(source: WildlifeEvent[] | undefined): readonly WildlifeEvent[];
};

export function createWildlifeInputs<S extends { players: Map<number, { pos: { x: number; z: number } }> }>(read?: MatchReader<S>): WildlifeInputs<S> {
  // `pool` keeps the point objects alive across the truncation of `players`.
  const pool: PlayerPoint[] = [];
  const players: PlayerPoint[] = [];
  const drained: WildlifeEvent[] = [];
  const view: View = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0, aspect: 0 };
  const match: MatchState = { phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 0, mist: 0 };
  const inputs: WildlifeInputs<S> = {
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
      read?.(state, x, z, match);
      match.inWorld = true;
      match.hour = hour;
      match.mist = mist;
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
