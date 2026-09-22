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

describe("safe ground", SUITE, () => {
  it("does not let a Hollow at the treeline kill a player who reached the corridor this tick", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w, 1);
    const h = [...w.state.enemies.values()][0]!;
    const th = w.trail!.trailhead;
    const roadX = activeTerrainVariant().roadCenterX!(seed, th.z);
    // The player was out in the woods at the end of the last tick, so `safe`
    // reads false coming in. This tick they are a hand's breadth inside the
    // corridor with the Hollow standing at the edge, 0.4 m away — well inside
    // contact reach. Safety has to be read from where they are now, not from
    // where the last tick left them.
    h.ai = AiState.Hunt; h.stateTimer = 0; h.targetId = p.id;
    const hx = roadX + ROAD_CORRIDOR_HALF + 0.3;
    h.pos = { x: hx, y: elevationAt(seed, hx, th.z) + ENEMY_HALF.y, z: th.z };
    const px = roadX + ROAD_CORRIDOR_HALF - 0.1;
    standAt(p, px, th.z);
    expect(p.safe).toBe(false);
    tick(w, 1);
    expect(p.safe).toBe(true);
    expect(p.health).toBeGreaterThan(0);
    expect(w.state.outcome).toBe(Outcome.Won);
  });
});

describe("the discovery", SUITE, () => {
  it("flips the phase for everyone when the first living player reaches the body, and the Hollow steps out behind it", () => {
    const { w, p } = forestWorld();
    const q = spawnPlayer(w);
    const body = w.register!.body.pos;
    // Both are in reach on the same tick, and q — the higher id — is both
    // nearer the body and on the other side of it, so the lower id winning
    // the tie is what decides the target and the side it steps out on.
    standAt(p, body.x - (DISCOVERY_RADIUS - 1), body.z);
    standAt(q, body.x + 2, body.z);
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

  it("steps out on the +x fallback when the finder is standing on the body", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    // Exactly on it: the line from the finder through the body is degenerate,
    // and `emergePoint` falls back to +x rather than dividing by nothing.
    standAt(p, body.x, body.z);
    tick(w, 1);
    const h = [...w.state.enemies.values()][0]!;
    expect(h.pos.x).toBeCloseTo(body.x + SUMMIT_SPAWN_DIST, 1);
    expect(h.pos.z).toBeCloseTo(body.z, 1);
    expect(h.pos.y).toBeCloseTo(elevationAt(seed, h.pos.x, h.pos.z) + ENEMY_HALF.y, 1);
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

  it("does not flip inside a match that is already over", () => {
    const { w, p } = forestWorld();
    p.health = 0;
    tick(w, 1);
    expect(w.state.outcome).toBe(Outcome.Lost); // the party died on the climb
    const q = spawnPlayer(w);
    standAt(q, w.register!.body.pos.x, w.register!.body.pos.z);
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
    const placeH = (u: number) => { h.pos = { x: roadX + u, y: elevationAt(seed, roadX + u, th.z) + ENEMY_HALF.y, z: th.z }; };
    const uOf = (o: { x: number; z: number }) => o.x - activeTerrainVariant().roadCenterX!(seed, o.z);

    // First it walks at the treeline. Its prey stands just outside the
    // corridor, which is nearer the road than the Hollow is, so hunting them
    // IS walking toward the corridor; `approach` puts it on the straight line
    // rather than on a trail route.
    h.ai = AiState.Hunt; h.stateTimer = 0; h.targetId = p.id; h.approach = true; h.lastDistSq = Infinity;
    placeH(ROAD_CORRIDOR_HALF + 2);
    standAt(p, roadX + ROAD_CORRIDOR_HALF + 0.05, th.z);
    tick(w, 10);
    expect(p.safe).toBe(false);
    expect(p.health).toBeGreaterThan(0); // not caught yet: contact reach is 0.9 m
    // 0.66 m of the 1.95 m gap in ten ticks — it walks from a standstill, so
    // the first ticks are the acceleration, not the top speed.
    const travelled = ROAD_CORRIDOR_HALF + 2 - uOf(h.pos);
    expect(travelled).toBeGreaterThan(0.5);

    // Now it is within one step of the edge — HOLLOW_HUNT_SPEED carries it
    // 0.105 m in a tick — and the player reaches the pad. The step it takes
    // toward them would end on the corridor, so containment is what decides
    // where it finishes, not the distance it was standing off.
    placeH(ROAD_CORRIDOR_HALF + 0.02);
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(p.safe).toBe(true);
    tick(w, 60);
    expect(uOf(h.pos)).toBeGreaterThanOrEqual(ROAD_CORRIDOR_HALF - 0.01);
    expect(uOf(h.pos)).toBeLessThan(ROAD_CORRIDOR_HALF + 0.1); // it settled AT the edge
    expect(h.ai).toBe(AiState.Stand);
    expect(w.state.outcome).toBe(Outcome.Won);
  });
});
