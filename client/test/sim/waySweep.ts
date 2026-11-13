import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { DeathCause, Phase } from "../../src/sim/types.js";
import { SPRINT_SPEED } from "../../src/sim/constants.js";
import { WAY_RIM_M, wayPoint } from "../../src/sim/wayDown.js";
import { WAY_APART_M, WAY_BACK_MAX_M, WAY_STRAIGHT_MAX_M, wayOf } from "../../src/sim/wayDraw.js";
import { seedPart } from "../helpers/seedPart.js";
import { wayRules } from "./helpers/wayRules.js";
import { runDown } from "./helpers/wayRunner.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/** The sweep's worlds, `hollow0` to `hollow49`, and the files they are split over: five worlds a file, about a minute and a half on a runner. */
export const WAY_TOKENS: readonly string[] = Array.from({ length: 50 }, (_, i) => `hollow${i}`);
export const WAY_PARTS = 10;
/**
 * How far over its aim a way may run, and the share of a part's worlds that
 * must be within a tenth of it: a world whose near ground a lake or a cliff
 * band crosses is gone round, and that detour is length the aim did not ask
 * for (measured 2026-11-13: one in eight, 13 % over).
 */
const LENGTH_MOST = 1.25;
const WITHIN_TENTH_SHARE = 0.6;
/** "No straight stretch over about 40 m": a long line, wound least, measured 44 m. And a way gone round a lake heads back a little more than the rule's 10 m (measured 11 m). */
const STRAIGHT_SLACK_M = 8;
const BACK_SLACK_M = 5;
/** Seconds a sprint down the way may take over its length at the sprint's speed: trunks to run round. */
const RUN_SLACK = 1.25;

/**
 * One world's way against the design's route gate (spec §8): drawn, not the
 * fallback; its length by its aim; its shape (no straight stretch, never
 * heading back, never doubling on itself); and a runner who sprints down it
 * from the crest reaches the road without stalling or leaving the channel.
 * The crest's Hollow is not there: only the route is on trial.
 */
function checkWay(token: string): { withinTenth: boolean } {
  const w = createForestWorld(createForest(seedFromToken(token)));
  w.haunt!.active = false;
  const way = wayOf(w)!;
  expect(way.fallback, token).toBe(false);
  const r = wayRules(way, w.trail!.trailhead);
  expect(r.length, `${token}: length`).toBeGreaterThan(r.target * 0.9);
  expect(r.length, `${token}: length`).toBeLessThan(r.target * LENGTH_MOST);
  expect(r.longestStraight, `${token}: straight`).toBeLessThanOrEqual(WAY_STRAIGHT_MAX_M + STRAIGHT_SLACK_M);
  expect(r.worstBack, `${token}: back`).toBeLessThanOrEqual(WAY_BACK_MAX_M + BACK_SLACK_M);
  expect(r.closestApart, `${token}: apart`).toBeGreaterThanOrEqual(WAY_APART_M);

  w.state.phase = Phase.Chase;
  const p = spawnPlayer(w);
  p.out = true;
  const start = wayPoint(way, 2, { x: 0, z: 0 });
  p.pos = { x: start.x, y: w.ground!.heightAt(start.x, start.z) + 0.9, z: start.z };
  const run = runDown(w, p.id);
  expect(run.cause, `${token}: died`).toBe(DeathCause.None);
  expect(run.reached, `${token}: reached (stalled ${run.stalledS.toFixed(1)} s, ${run.seconds.toFixed(0)} s)`).toBe(true);
  expect(run.stalledS, `${token}: stalled`).toBeLessThan(3);
  expect(run.maxOff, `${token}: off the way`).toBeLessThan(WAY_RIM_M);
  expect(run.seconds, `${token}: seconds`).toBeLessThan((way.length / SPRINT_SPEED) * RUN_SLACK);
  return { withinTenth: r.length < r.target * 1.1 };
}

/** Part `part` (from 1) of the sweep: its worlds one by one, and most of them within a tenth of their aim. */
export function checkWayPart(part: number): void {
  const tokens = seedPart(WAY_TOKENS, part, WAY_PARTS);
  let within = 0;
  for (const token of tokens) if (checkWay(token).withinTenth) within++;
  expect(within / tokens.length, `part ${part}: within a tenth of the aim`).toBeGreaterThanOrEqual(WITHIN_TENTH_SHARE);
}
