/**
 * The Pacific chorus frogs' night at the lake: when each voice calls, as the
 * list of calls that start this step. Pure and Babylon-free; `waterLifeAudio`
 * voices what this decides.
 *
 * A voice's neighbours are the voices within `FROG_NEIGHBOUR_RANGE` of it
 * along the shore, and its nearest voice however far. Each voice calls in
 * bouts: `FROG_BOUT_CALLS` calls `FROG_CALL_GAP_S` apart (start to start),
 * then a rest of `FROG_BOUT_REST_S`, and waits while a neighbour is mid-call,
 * so neighbours alternate rather than overlap.
 *
 * The silences, as a pond's frogs keep them:
 * - A voice with a player within `FROG_QUIET_RADIUS` stops at once. Once no
 *   player has been that near for its own draw of `FROG_RESTART_S`, it may
 *   start again, but only one voice of its stretch of shore (the silent
 *   voices linked to it neighbour by neighbour) restarts first: the one
 *   nearest the stretch's centre among those whose own wait has run out. The
 *   others, with no player near, join over `FROG_JOIN_S`, none before its own
 *   wait has run out.
 * - Every voice stops while the Hollow is within `FROG_HOLLOW_STOP` and stays
 *   silent until it is beyond `FROG_HOLLOW_RESUME`.
 * - `presence` (the frogs' share of the hour and the dread) thins the chorus
 *   by a hash of each voice: a voice calls only while its rank is below it.
 *
 * Whenever a voice comes back from a silence of the whole chorus (the first
 * step, a jump of the hour into the night, the Hollow gone, the presence
 * rising past its rank) its first call falls at random within `FROG_ONSET_S`,
 * so the lake does not start in one burst; a step after a stall longer than
 * the longest gap does the same rather than firing every call it owes.
 *
 * Timings are drawn from `random`, each player's own; a voice's rank and
 * loudness come from the world's seed. Nothing is allocated per step: the
 * state is typed arrays made once, and `calls` holds one reused entry a voice.
 */
import { hash3 } from "../sim/field.js";
import { FROG_CALL_S } from "./insectVoices.js";
import type { FrogVoice } from "./waterLifeField.js";

export const FROG_QUIET_RADIUS = 12, FROG_HOLLOW_STOP = 60, FROG_HOLLOW_RESUME = 80;
export const FROG_RESTART_S: readonly [number, number] = [20, 40];
export const FROG_JOIN_S: readonly [number, number] = [5, 15];
export const FROG_BOUT_CALLS: readonly [number, number] = [3, 12];
export const FROG_CALL_GAP_S: readonly [number, number] = [0.6, 1.4];
export const FROG_BOUT_REST_S: readonly [number, number] = [4, 20];
/** A voice back from a silence of the whole chorus calls first within this many seconds. */
export const FROG_ONSET_S = 10;
/** Voices this close are neighbours along the shore: they alternate their
 * calls, and silent ones share a stretch. */
export const FROG_NEIGHBOUR_RANGE = 30;
/** A voice's loudness at its reference distance, drawn once a voice from the seed. */
export const FROG_GAIN: readonly [number, number] = [2, 4];
/** The hash salts of a voice's rank and loudness: the frogs' own, 80 to 89,
 * apart from the placement's and the dragonflies'. */
const SALT_RANK = 80, SALT_GAIN = 81;

/** One call starting this step, at its voice's place in Babylon's world. */
export type FrogCall = { voice: number; x: number; y: number; z: number; gain: number };

export type FrogChorus = {
  /** The calls that start this step; emptied by the next. The array and its entries are reused. */
  readonly calls: FrogCall[];
  /**
   * Advances the chorus to `t` seconds, `dt` after the last step. `players`
   * are every player's ground position, `hollowDistance` how far the Hollow
   * is, `presence` the frogs' share (0..1).
   */
  step(
    t: number, dt: number, players: readonly { x: number; z: number }[],
    hollowDistance: number, presence: number,
  ): void;
};

/** A voice's state: calling in bouts, hushed by a player, or waiting to join its stretch. */
const CHORUS = 0, HUSHED = 1, JOINING = 2;

function lerp(range: readonly [number, number], u: number): number {
  return range[0] + (range[1] - range[0]) * u;
}

export function createFrogChorus(voices: readonly FrogVoice[], seed: number, random: () => number): FrogChorus {
  const n = voices.length;
  const state = new Uint8Array(n);
  /** Passed the Hollow and the presence last step. */
  const live = new Uint8Array(n);
  /** A player within `FROG_QUIET_RADIUS` this step. */
  const near = new Uint8Array(n);
  /** Scratch for a stretch being restarted: who is in it, in the order found. */
  const linked = new Uint8Array(n);
  const queue = new Int32Array(n);
  /** `adjacent[i · n + j]`: voices i and j are neighbours. */
  const adjacent = new Uint8Array(n * n);
  const rank = new Float64Array(n);
  const nextCall = new Float64Array(n);
  const lastCall = new Float64Array(n).fill(-Infinity);
  const callsLeft = new Int32Array(n);
  /** Seconds since a player was last near, while hushed. */
  const clear = new Float64Array(n);
  const restartAfter = new Float64Array(n);
  const joinAt = new Float64Array(n);
  const pool: FrogCall[] = [];
  const calls: FrogCall[] = [];
  let hollowQuiet = false;

  for (let i = 0; i < n; i++) {
    const v = voices[i]!;
    rank[i] = hash3(i, 0, SALT_RANK, seed);
    pool.push({ voice: i, x: v.x, y: v.y, z: v.z, gain: lerp(FROG_GAIN, hash3(i, 0, SALT_GAIN, seed)) });
    let nearest = -1, best = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.hypot(voices[j]!.x - v.x, voices[j]!.z - v.z);
      if (d <= FROG_NEIGHBOUR_RANGE) adjacent[i * n + j] = adjacent[j * n + i] = 1;
      if (d < best) {
        best = d;
        nearest = j;
      }
    }
    if (nearest >= 0) adjacent[i * n + nearest] = adjacent[nearest * n + i] = 1;
  }

  function boutCalls(): number {
    return FROG_BOUT_CALLS[0] + Math.floor(random() * (FROG_BOUT_CALLS[1] - FROG_BOUT_CALLS[0] + 1));
  }

  /** Whether a neighbour of voice `i` is mid-call at `t`. */
  function neighbourCalling(i: number, t: number): boolean {
    for (let j = 0; j < n; j++) {
      if (adjacent[i * n + j] && t - lastCall[j]! < FROG_CALL_S) return true;
    }
    return false;
  }

  /**
   * Voice `i` has waited out its draw: its stretch (the hushed voices linked
   * to it neighbour by neighbour) starts again from the voice nearest the
   * stretch's centre among those with no player near and their own wait run
   * out, and the rest of the stretch with no player near joins over
   * `FROG_JOIN_S`, none before its own wait has run out. A voice a player
   * still stands by keeps waiting.
   */
  function restartStretch(i: number, t: number): void {
    linked.fill(0);
    linked[i] = 1;
    queue[0] = i;
    let found = 1;
    let cx = 0, cz = 0;
    for (let head = 0; head < found; head++) {
      const a = queue[head]!;
      cx += voices[a]!.x;
      cz += voices[a]!.z;
      for (let b = 0; b < n; b++) {
        if (linked[b] || state[b] !== HUSHED || !adjacent[a * n + b]) continue;
        linked[b] = 1;
        queue[found++] = b;
      }
    }
    cx /= found;
    cz /= found;
    // Voice `i` is clear and has waited, so the leader is always found.
    let leader = i, best = Infinity;
    for (let k = 0; k < found; k++) {
      const a = queue[k]!;
      if (near[a] || clear[a]! < restartAfter[a]!) continue;
      const d = Math.hypot(voices[a]!.x - cx, voices[a]!.z - cz);
      if (d < best) {
        best = d;
        leader = a;
      }
    }
    for (let k = 0; k < found; k++) {
      const a = queue[k]!;
      if (near[a]) continue;
      if (a === leader) {
        state[a] = CHORUS;
        nextCall[a] = t;
        callsLeft[a] = boutCalls();
      } else {
        state[a] = JOINING;
        joinAt[a] = t + Math.max(lerp(FROG_JOIN_S, random()), restartAfter[a]! - clear[a]!);
      }
    }
  }

  return {
    calls,
    step(t, dt, players, hollowDistance, presence) {
      calls.length = 0;
      if (hollowDistance < FROG_HOLLOW_STOP) hollowQuiet = true;
      else if (hollowDistance > FROG_HOLLOW_RESUME) hollowQuiet = false;

      // The players: a voice with one near falls silent at once.
      for (let i = 0; i < n; i++) {
        const v = voices[i]!;
        let hushed = 0;
        for (let p = 0; p < players.length; p++) {
          const dx = players[p]!.x - v.x, dz = players[p]!.z - v.z;
          if (dx * dx + dz * dz < FROG_QUIET_RADIUS * FROG_QUIET_RADIUS) {
            hushed = 1;
            break;
          }
        }
        near[i] = hushed;
        if (hushed) {
          if (state[i] !== HUSHED) {
            state[i] = HUSHED;
            restartAfter[i] = lerp(FROG_RESTART_S, random());
          }
          clear[i] = 0;
        } else if (state[i] === HUSHED) {
          clear[i] = clear[i]! + dt;
        } else if (state[i] === JOINING && t >= joinAt[i]!) {
          state[i] = CHORUS;
          nextCall[i] = t;
          callsLeft[i] = boutCalls();
        }
      }
      for (let i = 0; i < n; i++) {
        if (state[i] === HUSHED && !near[i] && clear[i]! >= restartAfter[i]!) restartStretch(i, t);
      }

      // The calls.
      for (let i = 0; i < n; i++) {
        // Written as "not below" so a presence that is not a number silences too.
        if (hollowQuiet || !(rank[i]! < presence)) {
          live[i] = 0;
          continue;
        }
        if (!live[i]) {
          live[i] = 1;
          nextCall[i] = t + random() * FROG_ONSET_S;
          callsLeft[i] = boutCalls();
          continue;
        }
        if (state[i] !== CHORUS || t < nextCall[i]!) continue;
        if (t - nextCall[i]! > FROG_CALL_GAP_S[1]) {
          nextCall[i] = t + random() * FROG_ONSET_S;
          continue;
        }
        if (neighbourCalling(i, t)) continue;
        lastCall[i] = t;
        calls.push(pool[i]!);
        const left = callsLeft[i]! - 1;
        if (left > 0) {
          callsLeft[i] = left;
          nextCall[i] = t + lerp(FROG_CALL_GAP_S, random());
        } else {
          callsLeft[i] = boutCalls();
          nextCall[i] = t + lerp(FROG_BOUT_REST_S, random());
        }
      }
    },
  };
}
