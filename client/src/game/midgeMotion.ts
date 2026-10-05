import { hash3 } from "../sim/field.js";
import { MAX_PLAYERS, PLAYER_HALF } from "../sim/constants.js";
import type { QualityTier } from "./quality.js";
import { WATER_LIFE_SALT } from "./waterLifeField.js";

/**
 * How a midge swarm moves, Babylon-free: the arithmetic the midges' vertex
 * shader runs, mirrored here constant for constant so it can be tested and so
 * the CPU can place what the shader will draw. Each midge is held to its
 * swarm's centre as if on a spring: three sinusoids an axis at incommensurate
 * rates, so a path runs nearly straight and turns back near the edge, as the
 * field studies' midges fly, with no neighbour search. Driven by the shared
 * clock and the swarm's seed, so the swarms move alike on every screen.
 *
 * Also the share of the tier's midges each swarm draws, the per-swarm table
 * the shader reads, and the swarms that form over a player standing still.
 */

/** Rows of the per-swarm uniform table: the markers (at most 25) from row 0,
 * a swarm over each player's head from HEAD_ROW0. */
export const MIDGE_SWARMS_MAX = 32;
export const HEAD_ROW0 = 25;
/** Midges in view, at most, by tier. */
export const MIDGE_TIER_MAX: Record<QualityTier, number> = { low: 800, medium: 2000, high: 4000 };
/** A swarm draws its full count within MIDGE_NEAR, a tenth at MIDGE_FAR, none beyond MIDGE_CUTOFF (m). */
export const MIDGE_NEAR = 15;
export const MIDGE_FAR = 60;
export const MIDGE_CUTOFF = 80;
/** A midge's card across (m), and the fewest pixels it covers. */
export const MIDGE_CARD = 0.002;
export const MIDGE_MIN_PX = 1.2;
/** The three sinusoids' base rates (Hz), each midge's × (0.85 + 0.3 · hash), and their weights (sum 1). */
export const MIDGE_RATES: readonly [number, number, number] = [0.7, 1.3, 2.1];
export const MIDGE_AMPS: readonly [number, number, number] = [0.55, 0.3, 0.15];
/** A ball's vertical amplitude as a share of its radius: the horizontal legs 1.5× the vertical. */
export const MIDGE_BALL_FLAT = 1 / 1.5;
/** A column's swirl about the vertical (rev/s). */
export const MIDGE_SWIRL: readonly [number, number] = [0.05, 0.15];
/** The surge along the wind, out and back (s). */
export const MIDGE_SURGE_PERIOD: readonly [number, number] = [3, 6];
/** The wind speed (0–1) at which the shift, the surge and the flattening are full. */
export const MIDGE_WIND_FULL = 0.75;
/** A midge's wing flash (Hz). */
export const MIDGE_FLASH_HZ: readonly [number, number] = [9, 14];
/** The swarm over a player's head: forms after HEAD_FORM_S slower than HEAD_SLOW m/s
 * in the shore band, follows at up to HEAD_FOLLOW m/s, lets go after HEAD_RELEASE_S
 * faster than HEAD_RELEASE_SPEED m/s. */
export const HEAD_FORM_S = 10, HEAD_SLOW = 0.5, HEAD_FOLLOW = 1.5, HEAD_RELEASE_SPEED = 2, HEAD_RELEASE_S = 3;
export const HEAD_MIDGES: readonly [number, number] = [80, 150];
/** Its centre over the top of the head (m). */
export const HEAD_ABOVE: readonly [number, number] = [0.5, 1.0];
/** A marker's block of instances: its most midges, mist-filled. */
export const MIDGE_BLOCK_MAX = 520;
/** Floats a row of the per-swarm table: three vec4s,
 * (cx, cy, cz, radius), (height, count, presence, column), (swirl, flatten, seed, 0). */
export const SWARM_ROW_FLOATS = 12;

const TAU = 2 * Math.PI;

/** A swarm's centre after the wind's shift and surge, its swirl (radians) and flattening (0–0.5). */
export type SwarmFrame = { cx: number; cy: number; cz: number; swirl: number; flatten: number };
/** The swarm over player i's head. `still` and `fast`: seconds slow in the band, and fast. */
export type HeadSwarm = { active: boolean; x: number; y: number; z: number; midges: number; still: number; fast: number; seed: number };

function fract(x: number): number {
  return x - Math.floor(x);
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The shader's hash, mirrored: Hoskins' "hash without sine" of (i, s, i + s),
 * 0–1. Small integers keep its float precision on the GPU.
 */
export function midgeHash(i: number, s: number): number {
  let px = fract(i * 0.1031), py = fract(s * 0.1031), pz = fract((i + s) * 0.1031);
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += d; py += d; pz += d;
  return fract((px + py) * pz);
}

/** One axis of a midge's path: three sinusoids, -1..1. */
function axis(slot: number, seed: number, t: number, a: number): number {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const rate = (MIDGE_RATES[k] as number) * (0.85 + 0.3 * midgeHash(slot, seed + 3 * a + k + 11));
    const phase = TAU * midgeHash(slot, seed + 3 * a + k + 41);
    sum += (MIDGE_AMPS[k] as number) * Math.sin(TAU * rate * t + phase);
  }
  return sum;
}

/**
 * Midge `slot`'s offset from its swarm's centre at shared time `t`: each
 * horizontal axis within the radius, the vertical within the column's
 * half-height or a ball's flattened radius, less the wind's `flatten`, and
 * (x, z) turned by `swirl` radians: x' = x cos − z sin, z' = x sin + z cos.
 */
export function midgeOffset(
  slot: number, seed: number, t: number, radius: number, height: number, column: boolean,
  swirl: number, flatten: number, out: { x: number; y: number; z: number },
): void {
  const x = radius * axis(slot, seed, t, 0);
  const z = radius * axis(slot, seed, t, 2);
  out.y = (column ? height : radius * MIDGE_BALL_FLAT) * axis(slot, seed, t, 1) * (1 - flatten);
  const c = Math.cos(swirl), s = Math.sin(swirl);
  out.x = c * x - s * z;
  out.z = s * x + c * z;
}

/**
 * A swarm's frame at time `t` in a wind blowing along the unit (windX, windZ)
 * at `windSpeed` (0–1): the centre pushed downwind by up to its radius and
 * surging along the wind, the swarm flattened by up to half, a column's swirl.
 * The swirl is wrapped to one turn, so its float stays precise on the GPU.
 */
export function swarmFrame(
  baseX: number, baseY: number, baseZ: number, radius: number, column: boolean, seed: number, t: number,
  windX: number, windZ: number, windSpeed: number, out: SwarmFrame,
): void {
  const w = smoothstep(0, MIDGE_WIND_FULL, windSpeed);
  const period = lerp(MIDGE_SURGE_PERIOD, midgeHash(seed, 7));
  const push = radius * (w + 0.5 * w * Math.sin((TAU * t) / period + TAU * midgeHash(seed, 8)));
  out.cx = baseX + windX * push;
  out.cy = baseY;
  out.cz = baseZ + windZ * push;
  out.flatten = 0.5 * w;
  out.swirl = column ? TAU * fract(lerp(MIDGE_SWIRL, midgeHash(seed, 9)) * t) : 0;
}

/** The midges a swarm of `full` draws at `distance`: all within MIDGE_NEAR,
 * falling linearly to a tenth at MIDGE_FAR, a tenth to MIDGE_CUTOFF, none beyond. */
export function countAt(distance: number, full: number): number {
  if (distance > MIDGE_CUTOFF) return 0;
  if (distance <= MIDGE_NEAR) return full;
  if (distance >= MIDGE_FAR) return 0.1 * full;
  return full * (1 - (0.9 * (distance - MIDGE_NEAR)) / (MIDGE_FAR - MIDGE_NEAR));
}

/**
 * Each of the first `rows` swarms' count by its full count and distance, then
 * all of them scaled down together so their sum stays within `tierMax`; whole
 * midges, rounded down. Writes `out[0..rows)`.
 */
export function shareBudget(fulls: Float32Array, distances: Float32Array, rows: number, tierMax: number, out: Float32Array): void {
  let sum = 0;
  for (let r = 0; r < rows; r++) {
    out[r] = countAt(distances[r] as number, fulls[r] as number);
    sum += out[r] as number;
  }
  const scale = sum > tierMax ? tierMax / sum : 1;
  for (let r = 0; r < rows; r++) out[r] = Math.floor((out[r] as number) * scale);
}

/** Row `row` of the per-swarm table. */
export function packSwarm(
  out: Float32Array, row: number, f: SwarmFrame, radius: number, height: number, count: number,
  presence: number, column: boolean, seed: number,
): void {
  const o = row * SWARM_ROW_FLOATS;
  out[o] = f.cx; out[o + 1] = f.cy; out[o + 2] = f.cz; out[o + 3] = radius;
  out[o + 4] = height; out[o + 5] = count; out[o + 6] = presence; out[o + 7] = column ? 1 : 0;
  out[o + 8] = f.swirl; out[o + 9] = f.flatten; out[o + 10] = seed; out[o + 11] = 0;
}

/** A swarm for every player's head, all of them waiting. */
export function createHeads(seed: number): HeadSwarm[] {
  const heads: HeadSwarm[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    heads.push({
      active: false, x: 0, y: 0, z: 0, midges: 0, still: 0, fast: 0,
      seed: Math.floor(hash3(i, 0, WATER_LIFE_SALT.head, seed) * 4096),
    });
  }
  return heads;
}

/**
 * The swarms over the players' heads, a step of `dt` seconds. Player i (the
 * sim's position, the body's centre, PLAYER_HALF.y below the top of the head)
 * moving at `speeds[i]` m/s, in the shore band or not: slow in the band while
 * the midges are out, for HEAD_FORM_S, and a swarm forms over the head; it
 * eases after the head at up to HEAD_FOLLOW m/s, and lets go once the player
 * has moved faster than HEAD_RELEASE_SPEED for HEAD_RELEASE_S, leaves the
 * band, or the midges go. A head whose player is absent (undefined, or past
 * the players' array) waits. Allocates nothing.
 */
export function stepHeads(
  heads: HeadSwarm[], players: readonly ({ x: number; y: number; z: number } | undefined)[], speeds: readonly number[],
  inBand: readonly boolean[], presence: number, dt: number,
): void {
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i] as HeadSwarm;
    const p = players[i];
    if (p === undefined) {
      h.active = false; h.still = 0; h.fast = 0;
      continue;
    }
    const speed = speeds[i] ?? 0;
    const band = inBand[i] === true;
    h.still = band && presence > 0 && speed < HEAD_SLOW ? h.still + dt : 0;
    h.fast = speed > HEAD_RELEASE_SPEED ? h.fast + dt : 0;
    const tx = p.x, ty = p.y + PLAYER_HALF.y + lerp(HEAD_ABOVE, midgeHash(h.seed, 6)), tz = p.z;
    if (!h.active) {
      if (h.still >= HEAD_FORM_S) {
        h.active = true;
        h.x = tx; h.y = ty; h.z = tz;
        h.midges = Math.round(lerp(HEAD_MIDGES, midgeHash(h.seed, 5)));
      }
      continue;
    }
    if (h.fast >= HEAD_RELEASE_S || !band || !(presence > 0)) {
      h.active = false; h.still = 0; h.fast = 0;
      continue;
    }
    const dx = tx - h.x, dy = ty - h.y, dz = tz - h.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const reach = HEAD_FOLLOW * dt;
    if (d <= reach) {
      h.x = tx; h.y = ty; h.z = tz;
    } else {
      const k = reach / d;
      h.x += dx * k; h.y += dy * k; h.z += dz * k;
    }
  }
}
