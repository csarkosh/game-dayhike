import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { AiState, Button, DeathCause, Phase } from "../../src/sim/types.js";
import { SPRINT_SPEED, TICK_DT } from "../../src/sim/constants.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { stemAhead } from "../../src/sim/trailRoute.js";
import { chaseLineDistance, chaseLinePoint } from "../../src/sim/chaseLine.js";
import { WAY_RIM_M } from "../../src/sim/wayDown.js";
import { WAY_APART_M, WAY_BACK_MAX_M, WAY_LONG_RATIO, WAY_MAX_M, WAY_STRAIGHT_MAX_M, wayOf } from "../../src/sim/wayDraw.js";
import { seedPart } from "../helpers/seedPart.js";
import { BACK_SLACK_M, STRAIGHT_SLACK_M, wayRules } from "./helpers/wayRules.js";
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
/** Seconds a sprint down the way may take over its length at the sprint's speed: trunks to run round. */
const RUN_SLACK = 1.25;
/** The longest the runner's place along the way may go without advancing, seconds (measured 0.1), and the nearest the hunting Hollow may come, metres. */
const STALL_MOST_S = 1;
/** The most the way's first 60 m may take it from the pad: round the crest's clear ground, where the stem came up its far side. */
const START_BACK_MOST_M = 45;
const HOLLOW_NEAREST_M = 3;

/** The threshold's run (game/cutscene.ts: the last shot less its look and turn): the seconds the scene has the player sprinting before the hunt. */
const SCENE_RUN_S = 1.8;

/**
 * One world's way against the design's route gate (spec §8): drawn, not the
 * fallback; its length by its aim; its shape (no straight stretch, never
 * heading back, never doubling on itself); and the chase as a first-timer
 * meets it. A player comes up the stem to the find, the scene plays and its
 * threshold runs them down the way as app.ts does, and then a runner who
 * stays in the channel and sprints takes them to the road, the crest's
 * Hollow hunting behind: without stalling, without leaving the channel, and
 * never caught up with.
 */
function checkWay(token: string): { withinTenth: boolean } {
  const w = createForestWorld(createForest(seedFromToken(token)));
  w.haunt!.active = false;
  // Long drawn by the find in a match (app.ts steps the draw from ten seconds in).
  const way = wayOf(w)!;
  expect(way.fallback, token).toBe(false);
  const r = wayRules(way, w.trail!.trailhead);
  expect(r.length, `${token}: length`).toBeGreaterThan(r.target * 0.9);
  expect(r.length, `${token}: length`).toBeLessThan(r.target * LENGTH_MOST);
  // And never far over the most a way may be: 1,150 m, or a very long line's own least winding.
  expect(r.length, `${token}: length`).toBeLessThan(Math.max(WAY_MAX_M, WAY_LONG_RATIO * way.straight) * 1.1);
  expect(r.longestStraight, `${token}: straight`).toBeLessThanOrEqual(WAY_STRAIGHT_MAX_M + STRAIGHT_SLACK_M);
  expect(r.worstBack, `${token}: back`).toBeLessThanOrEqual(WAY_BACK_MAX_M + BACK_SLACK_M);
  // Its first 60 m may go round the crest, never further from the pad than that takes.
  expect(r.startBack, `${token}: the start`).toBeLessThanOrEqual(START_BACK_MOST_M);
  expect(r.closestApart, `${token}: apart`).toBeGreaterThanOrEqual(WAY_APART_M);

  // The find, by a player coming up the stem: stood a little inside the discovery's radius.
  const g = w.trail!, crest = g.nodes[g.summit]!;
  const p = spawnPlayer(w);
  const place = (x: number, z: number): void => { p.pos = { x, y: w.ground!.heightAt(x, z) + 0.9, z }; };
  for (const down of [10, 8, 6, 4]) {
    const at = stemAhead(g, crest.x, crest.z, -down) ?? crest;
    place(at.x, at.z);
    tickWorld(w, new Map());
    if (w.state.phase !== Phase.Climb) break;
  }
  expect(w.state.phase, `${token}: the find`).toBe(Phase.Scene);
  // Where they stand is on the line from the first tick: nothing reads them as off the way.
  expect(chaseLineDistance(w, p.pos.x, p.pos.z), `${token}: the party's place`).toBe(0);
  const h = [...w.state.enemies.values()][0]!;
  // The scene, its last seconds the threshold's run down the way.
  const down = chaseLinePoint(w, p.pos.x, p.pos.z, 8, { x: 0, z: 0 })!;
  const runYaw = Math.atan2(down.x - p.pos.x, down.z - p.pos.z);
  const sceneTicks = Math.round(SUMMIT_REVEAL_S / TICK_DT) + 1, runTicks = Math.round(SCENE_RUN_S / TICK_DT);
  for (let i = 0; i < sceneTicks; i++) {
    const running = i >= sceneTicks - 1 - runTicks;
    tickWorld(w, running ? new Map([[p.id, { seq: i, moveX: 0, moveZ: 1, yaw: runYaw, pitch: 0, buttons: Button.Sprint }]]) : new Map());
  }
  expect(w.state.phase, `${token}: the chase`).toBe(Phase.Chase);
  expect(h.ai, `${token}: the hunt`).toBe(AiState.Hunt);
  let nearest = Infinity;
  const run = runDown(w, p.id, {
    each: () => { nearest = Math.min(nearest, Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z)); },
  });
  expect(run.cause, `${token}: died`).toBe(DeathCause.None);
  expect(run.reached, `${token}: reached (stalled ${run.stalledS.toFixed(1)} s, ${run.seconds.toFixed(0)} s)`).toBe(true);
  expect(run.stalledS, `${token}: stalled`).toBeLessThan(STALL_MOST_S);
  expect(run.maxOff, `${token}: off the way`).toBeLessThan(WAY_RIM_M);
  expect(run.seconds, `${token}: seconds`).toBeLessThan((way.length / SPRINT_SPEED) * RUN_SLACK);
  expect(nearest, `${token}: the Hollow's nearest`).toBeGreaterThan(HOLLOW_NEAREST_M);
  return { withinTenth: r.length < r.target * 1.1 };
}

/** Part `part` (from 1) of the sweep: its worlds one by one, and most of them within a tenth of their aim. */
export function checkWayPart(part: number): void {
  const tokens = seedPart(WAY_TOKENS, part, WAY_PARTS);
  let within = 0;
  for (const token of tokens) if (checkWay(token).withinTenth) within++;
  expect(within / tokens.length, `part ${part}: within a tenth of the aim`).toBeGreaterThanOrEqual(WITHIN_TENTH_SHARE);
}
