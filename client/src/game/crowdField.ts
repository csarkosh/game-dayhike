/**
 * The crowd (docs/gameplay/2026-11-13-the-way-down.md): in the chase the
 * woods beside the way are full of shades. They are dressing. Each screen
 * makes and moves its own round its own player, from the rules here; they
 * hurt nobody, the host knows none of them, and two players side by side do
 * not see the same ones. What can kill is the host's, as it was (a Hollow, a
 * shade's lunge), and is told apart by its red eyes.
 *
 * This file is the rules and their numbers, free of Babylon so they are
 * tested as arithmetic: how many the way wants, what each figure is, where
 * one may stand. The renderer draws what it holds.
 */
import type { QualityTier } from "./quality.js";
import { hash2 } from "../sim/field.js";
import { nextRandom } from "../sim/types.js";
import { WAY_RIM_M } from "../sim/wayDown.js";

/** The most figures a screen keeps at the crowd's thickest. */
export const CROWD_MOST: Record<QualityTier, number> = { low: 60, medium: 60, high: 60 };
/**
 * Where they stand, in metres. Beyond the channel's rim: none within
 * CROWD_CLEAR_M of it, CROWD_NEAR_SHARE of them within CROWD_NEAR_BAND_M,
 * the rest out to CROWD_FAR_BAND_M. Down the way from the player's own place
 * on it: to CROWD_AHEAD_M, so there are always eyes far down the way; one
 * left CROWD_BEHIND_M behind is taken away. No two within CROWD_APART_M.
 * Round a player who has left the way: CROWD_OFF_WAY_M from them. And the
 * nearest one comes to its player before it goes: CROWD_KEEP_M.
 */
export const CROWD_CLEAR_M = 3;
export const CROWD_NEAR_BAND_M = 15;
export const CROWD_FAR_BAND_M = 35;
export const CROWD_NEAR_SHARE = 0.7;
export const CROWD_AHEAD_M = 85;
export const CROWD_BEHIND_M = 30;
export const CROWD_APART_M = 5.5;
export const CROWD_OFF_WAY_M: readonly [number, number] = [8, 15];
export const CROWD_KEEP_M = 6;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * How many the crowd wants at `progress` of the way (0 its start, 1 the
 * pad) where `most` is the thickest: a third near the crest, all of them
 * from three tenths of the way to eight, and half by the road.
 */
export function crowdTarget(progress: number, most: number): number {
  const share = progress < 0.3 ? 1 / 3 + (2 / 3) * smooth(progress / 0.3) : 1 - 0.5 * smooth((progress - 0.8) / 0.2);
  return Math.round(most * share);
}

/**
 * A figure of the crowd. `size` is its share of a Hollow's; `eyes` how
 * bright its eyes are (0 to 1) and `warm` their colour, 0 pale to 1 a dull
 * ember (never the Hollow's red); `pace` the metres a second it walks at;
 * `born` the seconds it began to rise at, and `gone` the seconds it began to
 * go at, or -1; `rise` how it came, 0 out of the mist or 1 as a pair of eyes
 * opening far off.
 */
export type CrowdFigure = { id: number; x: number; z: number; size: number; eyes: number; warm: number; pace: number; born: number; gone: number; rise: 0 | 1 };

/** A figure's look, from its own number: the same for as long as it lives. A fifth are small, one in seven large, the rest near a Hollow's size. */
export function figureOf(id: number, seed: number): Pick<CrowdFigure, "size" | "eyes" | "warm" | "pace"> {
  const kind = hash2(id, 1, seed), within = hash2(id, 2, seed);
  const size = kind < 0.2 ? 0.5 + 0.2 * within : kind < 0.2 + 1 / 7 ? 1.4 + 0.35 * within : 0.8 + 0.45 * within;
  return { size, eyes: 0.35 + 0.65 * hash2(id, 3, seed), warm: hash2(id, 4, seed), pace: 0.6 + 0.8 * hash2(id, 5, seed) };
}

/**
 * The way and the ground as the crowd needs them: the way's length, a place
 * projected onto it (the metres down it and the metres off its line), its
 * point and its direction at so many metres down it, and whether a figure
 * may stand at a place (dry ground it can stand on, with nothing solid in it).
 */
export type CrowdWorld = {
  length: number;
  project(x: number, z: number): { s: number; d: number };
  point(s: number, out: { x: number; z: number }): { x: number; z: number };
  direction(s: number, out: { x: number; z: number }): { x: number; z: number };
  admit(x: number, z: number): boolean;
};

const AT = { x: 0, z: 0 }, ALONG = { x: 0, z: 0 };

/**
 * One try at a place for a new figure. Beside the way: a drawn side of it, a
 * drawn distance beyond the rim, a drawn distance down it from the player's
 * own place. Round a player who has left the way (`offWay` metres off its
 * rim, over nothing): a drawn bearing, CROWD_OFF_WAY_M from them. Kept when
 * the ground admits it, when it is clear of the channel, and when it is
 * CROWD_APART_M from every figure. Spends six draws whatever the ground says.
 */
export function placeCrowd(world: CrowdWorld, eye: { x: number; z: number; yaw: number }, figures: readonly CrowdFigure[], rng: { rngSeed: number }, offWay: number): { x: number; z: number } | null {
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  const near = nextRandom(rng) < CROWD_NEAR_SHARE;
  const band = nextRandom(rng);
  const ahead = nextRandom(rng) * CROWD_AHEAD_M;
  const bearing = nextRandom(rng) * 2 * Math.PI;
  const range = CROWD_OFF_WAY_M[0] + nextRandom(rng) * (CROWD_OFF_WAY_M[1] - CROWD_OFF_WAY_M[0]);
  let x: number, z: number;
  if (offWay > 0) {
    x = eye.x + Math.sin(bearing) * range;
    z = eye.z + Math.cos(bearing) * range;
  } else {
    const s = Math.min(world.length, world.project(eye.x, eye.z).s + ahead);
    world.point(s, AT);
    world.direction(s, ALONG);
    const beyond = near ? CROWD_CLEAR_M + band * (CROWD_NEAR_BAND_M - CROWD_CLEAR_M) : CROWD_NEAR_BAND_M + band * (CROWD_FAR_BAND_M - CROWD_NEAR_BAND_M);
    x = AT.x - side * ALONG.z * (WAY_RIM_M + beyond);
    z = AT.z + side * ALONG.x * (WAY_RIM_M + beyond);
  }
  // Clear of the channel wherever the way bends toward it.
  if (world.project(x, z).d < WAY_RIM_M + CROWD_CLEAR_M) return null;
  if (!world.admit(x, z)) return null;
  for (const f of figures) {
    const dx = f.x - x, dz = f.z - z;
    if (dx * dx + dz * dz < CROWD_APART_M * CROWD_APART_M) return null;
  }
  return { x, z };
}
