import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld, type World } from "../../src/sim/world.js";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { AiState, DeathCause, Phase, type EnemyState, type PlayerState } from "../../src/sim/types.js";
import { PLAYER_EYE_OFFSET, SPRINT_SPEED, TICK_DT } from "../../src/sim/constants.js";
import { playerSees } from "../../src/sim/hollow.js";
import { CROWD_LUNGE_MPS } from "../../src/game/crowdField.js";
import {
  LUNGE_ATTACK_M, WAYLAY_AHEAD_M, WAYLAY_FROM_M, WAYLAY_GAP_EARLY, WAYLAY_GAP_M, WAYLAY_GROUP_M, WAYLAY_LOOSE_M, WAYLAY_OFF_M, WAYLAY_PAST_M, WAYLAY_REACH_M, WAYLAY_RUN_S, WAYLAY_SIDE_M, WAYLAY_SPEED,
} from "../../src/sim/haunt.js";
import { WAY_FLOOR_M, WAY_RIM_M, wayDirection, wayDistance, wayPoint, wayProject } from "../../src/sim/wayDown.js";
import { wayOf } from "../../src/sim/wayDraw.js";
import { runDown } from "./helpers/wayRunner.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");
const SUITE = { timeout: timeLimit(240_000) };

/** A forest world in the chase with its way drawn and the haunt running, and one player out on the way. */
function chase(): { w: World; p: PlayerState } {
  const w = createForestWorld(createForest(seed));
  wayOf(w);
  w.state.phase = Phase.Chase;
  const p = spawnPlayer(w);
  p.out = true;
  return { w, p };
}
/** Stands `p` on the way `s` metres down it, `side` metres to its left. */
function stand(w: World, p: PlayerState, s: number, side = 0): void {
  const at = wayPoint(w.way!, s, { x: 0, z: 0 }), d = wayDirection(w.way!, s, { x: 0, z: 0 });
  const x = at.x - d.z * side, z = at.z + d.x * side;
  p.pos = { x, y: w.ground!.heightAt(x, z) + 0.9, z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = Math.atan2(d.x, d.z);
}
const waylayers = (w: World): EnemyState[] => [...w.state.enemies.values()].filter((e) => e.waylay !== 0);
const ticks = (w: World, seconds: number): void => { for (let i = 0; i < Math.round(seconds / TICK_DT); i++) tickWorld(w, new Map()); };

describe("the way's lungers: their numbers", () => {
  it("names them", () => {
    expect([WAYLAY_AHEAD_M, WAYLAY_OFF_M, WAYLAY_GAP_M]).toEqual([[40, 60], [7, 8], [40, 70]]);
    expect([WAYLAY_GAP_EARLY, WAYLAY_FROM_M, WAYLAY_LOOSE_M, WAYLAY_REACH_M, WAYLAY_SIDE_M, WAYLAY_SPEED, WAYLAY_RUN_S, WAYLAY_PAST_M, WAYLAY_GROUP_M]).toEqual([1.6, 110, 24, 2, 1, 8, 6, 8, 60]);
  });

  it("wait off the path, lunge onto it as the crowd's do, and are seen for seconds before they are met", () => {
    expect(WAYLAY_OFF_M[0]).toBeGreaterThan(WAY_FLOOR_M);
    expect(WAYLAY_SPEED).toBe(CROWD_LUNGE_MPS);
    // Loosed over three seconds of sprint ahead, and on its place on the path with two of them to spare.
    expect(WAYLAY_LOOSE_M / SPRINT_SPEED).toBeGreaterThan(3);
    expect((WAYLAY_OFF_M[1] - WAYLAY_SIDE_M) / WAYLAY_SPEED).toBeLessThan(WAYLAY_LOOSE_M / SPRINT_SPEED - 2);
    // The middle of the path is within its reach, and the far half from a metre off the line is not.
    expect(WAYLAY_SIDE_M).toBeLessThan(WAYLAY_REACH_M);
    expect(WAYLAY_REACH_M - WAYLAY_SIDE_M).toBeLessThanOrEqual(1);
    // The nearest one rises is over five seconds of sprint ahead.
    expect(WAYLAY_AHEAD_M[0] / SPRINT_SPEED).toBeGreaterThan(5);
    // Two are never met within five seconds of sprint of each other.
    expect(WAYLAY_GAP_M[0] / SPRINT_SPEED).toBeGreaterThan(5);
    // It has whoever it reaches, from nearer than a lunge's own strike begins.
    expect(WAYLAY_REACH_M).toBeLessThan(LUNGE_ATTACK_M);
  });
});

describe("the way's lungers, on a real world", SUITE, () => {
  it("one stands up ahead of a player on the way: 40 to 60 m down it, beside the path, a lunge that waits", () => {
    const { w, p } = chase();
    stand(w, p, 200);
    p.heldFor = 1e9;
    ticks(w, 2);
    const all = waylayers(w);
    expect(all.length).toBeGreaterThanOrEqual(1);
    for (const e of all) {
      expect(e.ai).toBe(AiState.Lunge);
      expect(e.approach).toBe(false);
      expect(e.targetId).toBe(p.id);
      const gap = wayProject(w.way!, e.pos.x, e.pos.z).s - 200;
      expect(gap).toBeGreaterThan(WAYLAY_AHEAD_M[0] - 3);
      expect(gap).toBeLessThan(WAYLAY_AHEAD_M[1] + 3);
      const off = wayDistance(w.way!, e.pos.x, e.pos.z);
      expect(off).toBeGreaterThan(WAYLAY_OFF_M[0] - 1);
      expect(off).toBeLessThan(WAYLAY_OFF_M[1] + 1);
    }
    // And it stands where it rose while its player stands off.
    const first = all[0]!, was = { x: first.pos.x, z: first.pos.z };
    ticks(w, 2);
    expect(Math.hypot(first.pos.x - was.x, first.pos.z - was.z)).toBeLessThan(0.01);
  });

  it("lunges onto the path once its player is within 24 m of it down the way: straight out from where it waited, to a metre short of the line, and stands there", () => {
    const { w, p } = chase();
    stand(w, p, 200);
    p.heldFor = 1e9;
    ticks(w, 2);
    const e = waylayers(w)[0]!;
    const mine = wayProject(w.way!, e.pos.x, e.pos.z).s;
    stand(w, p, mine - WAYLAY_LOOSE_M + 1, -e.waylay * 4);
    const from = { x: e.pos.x, z: e.pos.z };
    ticks(w, 0.5);
    expect(e.approach).toBe(true);
    const moved = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
    expect(moved).toBeGreaterThan(WAYLAY_SPEED * 0.5 * 0.7);
    expect(moved).toBeLessThan(WAYLAY_SPEED * 0.5 * 1.05);
    ticks(w, 2);
    // On its own side of the line, a metre from it, where it set out from down the way; and still.
    const at = wayProject(w.way!, e.pos.x, e.pos.z);
    expect(at.d).toBeGreaterThan(WAYLAY_SIDE_M - 0.5);
    expect(at.d).toBeLessThan(WAYLAY_SIDE_M + 0.5);
    expect(Math.abs(at.s - mine)).toBeLessThan(1.5);
    const stood = { x: e.pos.x, z: e.pos.z };
    ticks(w, 1);
    expect(Math.hypot(e.pos.x - stood.x, e.pos.z - stood.z)).toBeLessThan(0.05);
    // It has had its seconds: gone.
    ticks(w, WAYLAY_RUN_S);
    expect(w.state.enemies.has(e.id)).toBe(false);
  });

  it("is no stare: one stood in the path in a runner's plain view fills nothing, so the dark stays open down the way", () => {
    const { w, p } = chase();
    stand(w, p, 200);
    p.heldFor = 1e9;
    ticks(w, 2);
    const e = waylayers(w)[0]!;
    const mine = wayProject(w.way!, e.pos.x, e.pos.z).s;
    stand(w, p, mine - WAYLAY_LOOSE_M + 1, -e.waylay * 2);
    ticks(w, 1.5);
    // Then from eight metres up the way, looking straight at it for three seconds, with nothing between.
    stand(w, p, mine - 8, -e.waylay * 2);
    let seen = 0;
    for (let i = 0; i < Math.round(3 / TICK_DT); i++) {
      const dx = e.pos.x - p.pos.x, dy = e.pos.y - (p.pos.y + PLAYER_EYE_OFFSET), dz = e.pos.z - p.pos.z;
      p.yaw = Math.atan2(dx, dz);
      p.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      if (playerSees(p, e, w)) seen++;
      tickWorld(w, new Map());
    }
    expect(w.state.enemies.has(e.id)).toBe(true);
    expect(seen).toBeGreaterThan(100);
    expect(p.stare).toBe(0);
    expect(e.seen).toBe(false);
  });

  it("never stands two within a gap of each other, whoever leads: a second runner who takes the lead is not given one beside the first's", () => {
    const { w, p } = chase();
    const q = spawnPlayer(w);
    q.out = true;
    p.heldFor = 1e9;
    q.heldFor = 1e9;
    stand(w, p, 200);
    stand(w, q, 150);
    ticks(w, 2);
    expect(waylayers(w).length).toBe(1);
    // The second runner comes past the first and leads.
    stand(w, q, 215);
    ticks(w, 2);
    stand(w, q, 222);
    ticks(w, 2);
    const at = waylayers(w).map((e) => wayProject(w.way!, e.pos.x, e.pos.z).s).sort((a, b) => a - b);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!, `lunges at ${at.map((s) => s.toFixed(0)).join(", ")}`).toBeGreaterThanOrEqual(WAYLAY_GAP_M[0] - 2);
  });

  it("none stands in the way's first 110 m, and none for a player who has left the way", () => {
    const { w, p } = chase();
    p.heldFor = 1e9;
    stand(w, p, 60);
    ticks(w, 2);
    expect(waylayers(w).length).toBeGreaterThanOrEqual(1);
    for (const e of waylayers(w)) expect(wayProject(w.way!, e.pos.x, e.pos.z).s).toBeGreaterThanOrEqual(WAYLAY_FROM_M - 1);
    const off = chase();
    off.p.heldFor = 1e9;
    stand(off.w, off.p, 300, WAY_RIM_M + 14);
    ticks(off.w, 3);
    expect(waylayers(off.w).length).toBe(0);
  });

  it("a runner who keeps to the far side of the path from each one reaches the road, past many of them", () => {
    const { w, p } = chase();
    stand(w, p, 20);
    const met = new Set<number>();
    const run = runDown(w, p.id, { lunges: "far", each: () => { for (const e of waylayers(w)) met.add(e.id); } });
    expect(run.cause).toBe(DeathCause.None);
    expect(run.reached).toBe(true);
    expect(run.maxOff).toBeLessThan(WAY_RIM_M);
    // One every 40 to 70 m of way, further apart at its start, none in its first 110 m.
    expect(met.size).toBeGreaterThan((w.way!.length - 110) / 95);
    expect(met.size).toBeLessThan(w.way!.length / 38);
  });

  it("a runner who keeps to each one's own side of the path is struck down", () => {
    const { w, p } = chase();
    stand(w, p, 20);
    const run = runDown(w, p.id, { lunges: "near" });
    expect(run.reached).toBe(false);
    expect(run.cause).not.toBe(DeathCause.None);
  });

  it("a runner who minds none of them and holds the middle of the path is struck down too", () => {
    const { w, p } = chase();
    stand(w, p, 20);
    const run = runDown(w, p.id);
    expect(run.reached).toBe(false);
    // Struck, or run into it: it stood in their way.
    expect([DeathCause.Lunge, DeathCause.Into]).toContain(run.cause);
  });
});
