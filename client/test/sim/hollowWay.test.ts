import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, createWorld, spawnPlayer, tickWorld, type World } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";
import { DEFAULT_TERRAIN_VARIANT, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { AiState, Phase, type EnemyState, type PlayerState } from "../../src/sim/types.js";
import { ENEMY_HALF, TICK_DT } from "../../src/sim/constants.js";
import { trailDistance } from "../../src/sim/trail.js";
import { HOLLOW_HUNT_SPEED, WAY_LEAD_M, spawnHollow } from "../../src/sim/hollow.js";
import { wayDirection, wayDistance, wayPoint, wayProject } from "../../src/sim/wayDown.js";
import { wayOf } from "../../src/sim/wayDraw.js";
import { graph } from "./helpers/stemGraph.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");
const SUITE = { timeout: timeLimit(180_000) };

/** A forest world in the chase with its way drawn, one player, and a Hollow hunting them. */
function chase(): { w: World; p: PlayerState; h: EnemyState } {
  const w = createForestWorld(createForest(seed));
  w.haunt!.active = false;
  wayOf(w);
  w.state.phase = Phase.Chase;
  const p = spawnPlayer(w);
  p.out = true;
  // Held, as a returned player is (checkpoint.ts): nothing kills them, so the walk alone is on trial.
  p.heldFor = 1e9;
  const h = spawnHollow(w, { x: 0, y: 0, z: 0 }, p.id, 0);
  h.ai = AiState.Hunt;
  h.stateTimer = 0;
  return { w, p, h };
}
const put = (e: { pos: { x: number; y: number; z: number } }, x: number, z: number, half: number): void => { e.pos = { x, y: elevationAt(seed, x, z) + half, z }; };
/** Metres along the way where a 200 m stretch begins that is everywhere more than 25 m from the trail's nodes' edges at its start. */
function strayStretch(w: World): number {
  for (let s = 60; s + 260 < w.way!.length; s += 6) {
    let far = true;
    for (let k = 0; k <= 60 && far; k += 6) {
      const q = wayPoint(w.way!, s + k, { x: 0, z: 0 });
      if (trailDistance(w.trail!, q.x, q.z) < 25) far = false;
    }
    if (far) return s;
  }
  throw new Error("the way never leaves the trail for 60 m");
}

describe("a Hollow hunting down the way", SUITE, () => {
  it("names its lead", () => { expect(WAY_LEAD_M).toBe(12); });

  it("closes on a player 200 m down the way along the way, never further than 8 m off it", () => {
    const { w, p, h } = chase();
    const s0 = strayStretch(w);
    const from = wayPoint(w.way!, s0, { x: 0, z: 0 }), to = wayPoint(w.way!, s0 + 200, { x: 0, z: 0 });
    put(h, from.x, from.z, ENEMY_HALF.y);
    put(p, to.x, to.z, 0.9);
    const d = wayDirection(w.way!, s0 + 200, { x: 0, z: 0 });
    p.yaw = Math.atan2(d.x, d.z);
    let maxOff = 0;
    for (let i = 0; i < Math.round(20 / TICK_DT); i++) {
      tickWorld(w, new Map());
      maxOff = Math.max(maxOff, wayDistance(w.way!, h.pos.x, h.pos.z));
    }
    expect(maxOff).toBeLessThan(8);
    expect(wayProject(w.way!, h.pos.x, h.pos.z).s).toBeGreaterThan(s0 + HOLLOW_HUNT_SPEED * 20 * 0.8);
  });

  it("reaches a player who has left the way", () => {
    const { w, p, h } = chase();
    const s0 = strayStretch(w);
    const from = wayPoint(w.way!, s0, { x: 0, z: 0 });
    const at = wayPoint(w.way!, s0 + 60, { x: 0, z: 0 }), d = wayDirection(w.way!, s0 + 60, { x: 0, z: 0 });
    put(h, from.x, from.z, ENEMY_HALF.y);
    put(p, at.x - d.z * 40, at.z + d.x * 40, 0.9);
    p.yaw = Math.atan2(d.x, d.z);
    let reached = false;
    for (let i = 0; i < Math.round(90 / TICK_DT) && !reached; i++) {
      tickWorld(w, new Map());
      reached = Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z) < 3;
    }
    expect(reached).toBe(true);
  });

  it("with no way it routes on the trail as before", () => {
    const w = createWorld(parseLevel({ id: "flat", brushes: [{ min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" }], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
    w.trail = graph(0);
    w.state.phase = Phase.Chase;
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 0 };
    p.heldFor = 1e9;
    const h = spawnHollow(w, { x: 20, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
    h.ai = AiState.Hunt;
    h.stateTimer = 0;
    tickWorld(w, new Map());
    expect(h.route.length).toBeGreaterThan(0);
  });
});
