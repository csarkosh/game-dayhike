import { describe, expect, it } from "vitest";
import { createWorld, serializeWorldState, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { AiState, Outcome } from "../../src/sim/types.js";
import { ENEMY_HALF, TICK_DT } from "../../src/sim/constants.js";
import {
  HOLLOW_HUNT_SPEED,
  HOLLOW_LOOK_FACTOR,
  HOLLOW_LOOK_RANGE,
  HOLLOW_LOST_SIGHT_S,
  HOLLOW_STARE_EMPTY_S,
  HOLLOW_STARE_FILL_S,
  playerSees,
  spawnHollow,
} from "../../src/sim/hollow.js";
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

describe("contact", () => {
  it("kills a player it touches, hunted or not, and the dead stay dead", () => {
    const w = world();
    const hunted = spawnPlayer(w);
    const other = spawnPlayer(w);
    hunted.pos = { x: 100, y: 0.9, z: 0 };
    other.pos = { x: 100, y: 0.9, z: 1 };
    spawnHollow(w, { x: 100.5, y: ENEMY_HALF.y, z: 0.5 }, AiState.Hunt, hunted.id);
    tickWorld(w, new Map());
    expect(hunted.health).toBe(0);
    expect(other.health).toBe(0);
    tick(w, 600);
    expect(hunted.health).toBe(0);
  });

  it("does not reach a player standing two metres away", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 0 };
    spawnHollow(w, { x: 102, y: ENEMY_HALF.y, z: 0 }, AiState.Stand); // standing still, out of reach
    tickWorld(w, new Map());
    expect(p.health).toBe(100);
  });
});

describe("looking", () => {
  it("sees a Hollow inside the cone, in range, with line of sight, and not otherwise", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 }; p.yaw = 0; p.pitch = 0; // facing +z
    const ahead = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 30 }, AiState.Stand);
    expect(playerSees(p, ahead, w)).toBe(true);
    ahead.pos.x = 30; // 45° off the aim
    expect(playerSees(p, ahead, w)).toBe(false);
    ahead.pos.x = 0; ahead.pos.z = HOLLOW_LOOK_RANGE + 5;
    expect(playerSees(p, ahead, w)).toBe(false);
    ahead.pos.z = 30;
    expect(playerSees(p, ahead, w)).toBe(true);
    const walled = world({ min: [-5, 0, 10], max: [5, 4, 11], material: "concrete" });
    const q = spawnPlayer(walled);
    q.pos = { x: 0, y: 0.9, z: 0 }; q.yaw = 0; q.pitch = 0;
    const behind = spawnHollow(walled, { x: 0, y: ENEMY_HALF.y, z: 30 }, AiState.Stand);
    expect(playerSees(q, behind, walled)).toBe(false);
  });

  it("fills the stare over HOLLOW_STARE_FILL_S, empties it over HOLLOW_STARE_EMPTY_S, and kills at 1", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 };
    // It stands 100 m straight down the player's aim: in range and in the cone throughout.
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 100 }, AiState.Stand);
    const fillTicks = Math.round(HOLLOW_STARE_FILL_S / TICK_DT);
    tick(w, Math.floor(fillTicks / 2));
    expect(p.stare).toBeCloseTo(0.5, 2);
    expect(h.seen).toBe(true);
    p.yaw = Math.PI; // look away
    tick(w, Math.round((HOLLOW_STARE_EMPTY_S / TICK_DT) / 2));
    expect(p.stare).toBeCloseTo(0, 2);
    expect(h.seen).toBe(false);
    p.yaw = 0;
    tick(w, fillTicks + 1);
    expect(p.stare).toBe(1);
    expect(p.health).toBe(0);
  });
});

describe("the loss", () => {
  it("is declared when the last living player dies, and not while one lives, and never with no players", () => {
    const empty = world();
    spawnHollow(empty, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Stand);
    tick(empty, 10);
    expect(empty.state.outcome).toBe(Outcome.Playing);

    const w = world();
    spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Stand);
    const a = spawnPlayer(w);
    const b = spawnPlayer(w);
    a.health = 0;
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Playing);
    b.health = 0;
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Lost);
  });

  it("is declared on a world with no trail and no Hollow", () => {
    // Death is permanent everywhere, so the sandbox ends the same way.
    const w = createWorld(level(), 1);
    const a = spawnPlayer(w);
    const b = spawnPlayer(w);
    a.health = 0;
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Playing);
    b.health = 0;
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Lost);
  });
});

describe("determinism", () => {
  it("two worlds with a hunt on a moving player stay byte-identical for 600 ticks", () => {
    const a = world();
    const b = world();
    const pa = spawnPlayer(a);
    const pb = spawnPlayer(b);
    pa.pos = { x: 100, y: 0.9, z: 10 }; pb.pos = { x: 100, y: 0.9, z: 10 };
    spawnHollow(a, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, pa.id);
    spawnHollow(b, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, pb.id);
    for (let t = 0; t < 600; t++) {
      const cmd = { seq: t, moveX: t % 90 < 45 ? 1 : -1, moveZ: 1, yaw: t * 0.02, pitch: 0.1, buttons: 0 };
      tickWorld(a, new Map([[pa.id, cmd]]));
      tickWorld(b, new Map([[pb.id, cmd]]));
    }
    expect(serializeWorldState(a.state)).toBe(serializeWorldState(b.state));
    expect(a.state.enemies.size).toBe(1);
  });
});
