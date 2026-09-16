import { describe, expect, it } from "vitest";
import { createForestWorld, createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { parseLevel } from "../../src/sim/level.js";
import { AiState } from "../../src/sim/types.js";
import { ENEMY_HALF, TICK_DT } from "../../src/sim/constants.js";
import { HOLLOW_CRAWL_SPEED, HOLLOW_HUNT_SPEED, HOLLOW_LOOK_FACTOR, HOLLOW_LOST_SIGHT_S, spawnHollow } from "../../src/sim/hollow.js";
import { nearestTrailNode } from "../../src/sim/trail.js";
import { graph } from "./helpers/registerGraph.js";

type Brush = { min: [number, number, number]; max: [number, number, number]; material: string };
const FLOOR: Brush = { min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" };
const level = (...walls: Brush[]) =>
  parseLevel({ id: "flat", brushes: [FLOOR, ...walls], playerSpawns: [[0, 0.9, 0], [0, 0.9, -5]], enemySpawns: [] });

/** A flat world with the one-loop hand graph as its trail, plus any walls; nothing else in it. */
function world(...walls: Brush[]) {
  const w = createWorld(level(...walls), 1);
  w.trail = graph(1);
  return w;
}
const tick = (w: ReturnType<typeof world>, n: number) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

describe("the crawl", () => {
  it("walks the stem from the crest to the pad, then turns and walks back up", () => {
    const w = world();
    const h = spawnHollow(w, { x: 200, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    const budget = Math.ceil((200 / HOLLOW_CRAWL_SPEED / TICK_DT) * 1.3);
    let t = 0;
    while (t < budget && h.pos.x > 2) { tickWorld(w, new Map()); t++; }
    expect(h.pos.x, `still at x=${h.pos.x} after ${t} ticks`).toBeLessThanOrEqual(2);
    expect(h.stemDir).toBe(-1);
    tick(w, 600);
    expect(h.stemDir).toBe(1);
    expect(h.pos.x).toBeGreaterThan(4);
  });

  it("crawls at the crawl speed", () => {
    const w = world();
    const h = spawnHollow(w, { x: 150, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    tick(w, 120); // settle
    const before = h.pos.x;
    tick(w, 600);
    expect(before - h.pos.x).toBeCloseTo(HOLLOW_CRAWL_SPEED * 10, 0);
  });
});

describe("the hunt", () => {
  it("routes along the graph to the node nearest its target, then walks straight at them", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 80 }; // nearest node is 3 (120, 50)
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    tickWorld(w, new Map());
    expect(h.route).toEqual([0, 1, 3]);
    expect(h.approach).toBe(false);
    const budget = Math.ceil((260 / HOLLOW_HUNT_SPEED / TICK_DT) * 1.5);
    let t = 0;
    while (t < budget && !h.approach) { tickWorld(w, new Map()); t++; }
    expect(h.approach, `never left the graph in ${t} ticks`).toBe(true);
    while (t < budget && dist(h.pos, p.pos) > 1.5) { tickWorld(w, new Map()); t++; }
    expect(dist(h.pos, p.pos)).toBeLessThanOrEqual(1.5);
  });

  it("re-routes when the target's nearest node changes", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 80 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    tickWorld(w, new Map());
    expect(h.route).toEqual([0, 1, 3]);
    p.pos = { x: 240, y: 0.9, z: -20 }; // nearest node is now 2, the crest
    tickWorld(w, new Map());
    expect(h.route[h.route.length - 1]).toBe(2);
  });

  it("rebuilds a route from the node it is already walking to, not the one behind it", () => {
    // Two places to stand whose nearest graph nodes differ, so a target
    // stepping between them rebuilds the route on every single tick. Rebuilt
    // from the node nearest its feet, the Hollow would turn round for the
    // node behind it every time it passed the halfway point of an edge and
    // rock about that node forever, never reaching the far end of the stem.
    const w = world();
    const here = { x: 140, y: 0.9, z: 60 };
    const there = { x: 160, y: 0.9, z: 60 };
    const g = w.trail!;
    expect(nearestTrailNode(g, here.x, here.z)).not.toBe(nearestTrailNode(g, there.x, there.z));
    const p = spawnPlayer(w);
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    const budget = Math.ceil((100 / HOLLOW_HUNT_SPEED / TICK_DT) * 1.5);
    let t = 0;
    let behind = h.pos.x;
    while (t < budget && h.pos.x < 100) {
      p.pos = t % 2 === 0 ? { ...here } : { ...there };
      const walkingTo = h.route[h.routeAt];
      const was = h.route;
      tickWorld(w, new Map());
      if (h.route !== was && walkingTo !== undefined) expect(h.route[0]).toBe(walkingTo);
      expect(h.pos.x, `turned round at tick ${t}`).toBeGreaterThanOrEqual(behind);
      behind = h.pos.x;
      t++;
    }
    expect(h.pos.x, `only reached x=${h.pos.x} in ${t} ticks`).toBeGreaterThanOrEqual(100);
  });

  it("gives up a straight approach after losing sight for HOLLOW_LOST_SIGHT_S and re-routes", () => {
    // A wall between them.
    const w = world({ min: [130, 0, 68], max: [170, 4, 70], material: "concrete" });
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 80 };
    const h = spawnHollow(w, { x: 150, y: ENEMY_HALF.y, z: 60 }, AiState.Hunt, p.id);
    h.approach = true;
    tick(w, Math.ceil(HOLLOW_LOST_SIGHT_S / TICK_DT) + 2);
    expect(h.approach).toBe(false);
    expect(h.route.length).toBeGreaterThan(0);
  });

  it("moves at the look factor while seen", () => {
    // The player stands 100 m up the z axis, inside the look range. Facing
    // away (yaw 0 is +z) for the free window, then turned round to look at
    // it for the slowed one — so the test holds whether `seen` is set by
    // hand or recomputed from the view each tick.
    //
    // Each window is measured after a settling one. Neither speed is reached
    // instantly: from rest it takes a few ticks to wind up to 6 m/s, and
    // friction bleeds 6 down to 2.1 over about a fifth of a second. Measuring
    // from the moment of the change compares two ramps rather than two speeds,
    // and both ramps err the same way.
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 100 };
    p.yaw = 0;
    const a = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    a.approach = true;
    tick(w, 60);
    const from = a.pos.z;
    tick(w, 60);
    const free = a.pos.z - from;
    p.yaw = Math.PI;
    a.seen = true;
    tick(w, 60);
    const at = a.pos.z;
    tick(w, 60);
    const slowed = a.pos.z - at;
    expect(slowed / free).toBeCloseTo(HOLLOW_LOOK_FACTOR, 3);
  });
});

describe("the merge walk", () => {
  it("walks to the nearest other Hollow", () => {
    const w = world();
    const target = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    const m = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Merge, target.id);
    const before = dist(m.pos, target.pos);
    tick(w, 120);
    expect(dist(m.pos, target.pos)).toBeLessThan(before - 5);
  });
});

describe("the first Hollow", () => {
  it("stands on the crest of a forest world, crawling, on the host only", () => {
    const forest = createForest(0x5eed);
    const host = createForestWorld(forest);
    const hollows = [...host.state.enemies.values()];
    expect(hollows).toHaveLength(1);
    const h = hollows[0]!;
    expect(h.ai).toBe(AiState.Crawl);
    const crest = host.trail!.nodes[host.trail!.summit]!;
    expect(dist(h.pos, crest)).toBeLessThan(1);
    expect(h.stemDir).toBe(-1);
    expect(createForestWorld(forest, false).state.enemies.size).toBe(0);
  });
});
