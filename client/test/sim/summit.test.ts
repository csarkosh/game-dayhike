import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt, activeTerrainVariant } from "../../src/sim/terrain.js";
import { AiState, Outcome, Phase } from "../../src/sim/types.js";
import { ENEMY_HALF, TICK_DT } from "../../src/sim/constants.js";
import { DISCOVERY_RADIUS, SUMMIT_SPAWN_DIST } from "../../src/sim/summit.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");

/**
 * Every suite here runs on a real forest world, so every suite carries a
 * timeout the way containment.test.ts's does: `createForest` and `bowlFor`
 * memoise per seed, so only the first world costs anything, but that first
 * build runs past vitest's 5 s default whenever this file shares the machine
 * with the other forest suites. One seed throughout, for the same reason.
 */
const SUITE = { timeout: 120_000 };

function forestWorld() {
  const w = createForestWorld(createForest(seed));
  const p = spawnPlayer(w);
  return { w, p };
}
const tick = (w: ReturnType<typeof forestWorld>["w"], n: number) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
/** Stands a player on the ground at (x, z). */
const standAt = (p: { pos: { x: number; y: number; z: number } }, x: number, z: number) => { p.pos = { x, y: elevationAt(seed, x, z) + 0.9, z }; };

describe("the climb", SUITE, () => {
  it("starts with no Hollow, on the climb, and the pad is safe ground", () => {
    const { w, p } = forestWorld();
    expect(w.state.enemies.size).toBe(0);
    expect(w.state.phase).toBe(Phase.Climb);
    tick(w, 1);
    expect(p.safe).toBe(true); // the pad is 9 m from the road's centreline
    const body = w.register!.body.pos;
    standAt(p, body.x - 40, body.z);
    tick(w, 1);
    expect(p.safe).toBe(false);
    expect(w.state.phase).toBe(Phase.Climb);
  });
});

describe("the discovery", SUITE, () => {
  it("flips the phase for everyone when the first living player reaches the body, and the Hollow steps out behind it", () => {
    const { w, p } = forestWorld();
    const q = spawnPlayer(w);
    const body = w.register!.body.pos;
    standAt(p, body.x - (DISCOVERY_RADIUS - 1), body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Chase);
    const hollows = [...w.state.enemies.values()];
    expect(hollows).toHaveLength(1);
    const h = hollows[0]!;
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.targetId).toBe(p.id);
    // Behind the body, on the far side from the player: +x of the body by SUMMIT_SPAWN_DIST.
    expect(h.pos.x).toBeCloseTo(body.x + SUMMIT_SPAWN_DIST, 1);
    expect(h.pos.z).toBeCloseTo(body.z, 1);
    expect(h.pos.y).toBeCloseTo(elevationAt(seed, h.pos.x, h.pos.z) + ENEMY_HALF.y, 1);
    // The phase never flips back, and a second player arriving spawns nothing more.
    standAt(q, body.x - 5, body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Chase);
    expect(w.state.enemies.size).toBe(1);
    tick(w, Math.round(SUMMIT_REVEAL_S / TICK_DT) + 2);
    expect(h.ai).toBe(AiState.Hunt);
  });

  it("does not flip for a dead player at the body", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    p.health = 0;
    standAt(p, body.x, body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Climb);
    expect(w.state.enemies.size).toBe(0);
  });
});

describe("the end", SUITE, () => {
  it("wins when every living player is on the corridor, once the chase has begun", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Chase);
    const th = w.trail!.trailhead;
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Won);
  });

  it("is a win with one safe and one dead, and a loss with everyone dead", () => {
    const { w, p } = forestWorld();
    const q = spawnPlayer(w);
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w, 1);
    q.health = 0;
    const th = w.trail!.trailhead;
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(w.state.outcome).toBe(Outcome.Won);

    const two = forestWorld();
    standAt(two.p, two.w.register!.body.pos.x - 5, two.w.register!.body.pos.z);
    tick(two.w, 1);
    two.p.health = 0;
    tick(two.w, 1);
    expect(two.w.state.outcome).toBe(Outcome.Lost);
  });

  it("does not end on the climb: a player on the pad before the discovery is safe but still out", () => {
    const { w, p } = forestWorld();
    tick(w, 2);
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Playing);
  });

  it("a Hollow chasing a player onto the corridor stops at the treeline and stands", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w, 1);
    const h = [...w.state.enemies.values()][0]!;
    const th = w.trail!.trailhead;
    const roadX = activeTerrainVariant().roadCenterX!(seed, th.z);
    // Put the Hollow just inside the woods, hunting, and the player on the pad.
    h.ai = AiState.Hunt; h.stateTimer = 0;
    h.pos = { x: roadX + ROAD_CORRIDOR_HALF + 3, y: elevationAt(seed, roadX + ROAD_CORRIDOR_HALF + 3, th.z) + ENEMY_HALF.y, z: th.z };
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(p.safe).toBe(true);
    tick(w, 60);
    expect(h.pos.x - roadX).toBeGreaterThanOrEqual(ROAD_CORRIDOR_HALF - 0.01);
    expect(h.ai).toBe(AiState.Stand);
    expect(w.state.outcome).toBe(Outcome.Won);
  });
});
