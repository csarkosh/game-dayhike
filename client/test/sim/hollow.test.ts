import { describe, expect, it } from "vitest";
import { cloneWorldState, createWorld, serializeWorldState, spawnPlayer, tickWorld } from "../../src/sim/world.js";
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
  SUMMIT_REVEAL_S,
  playerSees,
  spawnForkHollow,
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
/**
 * A reveal longer than any test that uses it: a Hollow that never leaves
 * Emerge, and so never takes a step. Contact and the stare read every Hollow
 * whatever its state, so these tests still measure what they are about — and
 * no other state stands still while a living player is in the world.
 */
const STILL = 600;

describe("the hunt", () => {
  it("routes along the graph to the node nearest its target, then walks straight at them", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 80 }; // nearest node is 3 (120, 50)
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
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
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
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
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
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
    const h = spawnHollow(w, { x: 150, y: ENEMY_HALF.y, z: 60 }, p.id, 0);
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
    const a = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
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
    spawnHollow(w, { x: 100.5, y: ENEMY_HALF.y, z: 0.5 }, hunted.id, 0);
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
    spawnHollow(w, { x: 102, y: ENEMY_HALF.y, z: 0 }, p.id, STILL); // emerging, so it never moves: out of reach
    tickWorld(w, new Map());
    expect(p.health).toBe(100);
  });
});

describe("looking", () => {
  it("sees a Hollow inside the cone, in range, with line of sight, and not otherwise", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 }; p.yaw = 0; p.pitch = 0; // facing +z
    const ahead = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 30 }, p.id, STILL);
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
    const behind = spawnHollow(walled, { x: 0, y: ENEMY_HALF.y, z: 30 }, q.id, STILL);
    expect(playerSees(q, behind, walled)).toBe(false);
  });

  it("fills the stare over HOLLOW_STARE_FILL_S, empties it over HOLLOW_STARE_EMPTY_S, and kills at 1", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 };
    // It stands 100 m straight down the player's aim: in range and in the cone throughout.
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 100 }, p.id, STILL);
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
    spawnHollow(empty, { x: 0, y: ENEMY_HALF.y, z: 0 }, 0, STILL);
    tick(empty, 10);
    expect(empty.state.outcome).toBe(Outcome.Playing);

    const w = world();
    spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, 0, STILL);
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
    spawnHollow(a, { x: 0, y: ENEMY_HALF.y, z: 0 }, pa.id, 0);
    spawnHollow(b, { x: 0, y: ENEMY_HALF.y, z: 0 }, pb.id, 0);
    for (let t = 0; t < 600; t++) {
      const cmd = { seq: t, moveX: t % 90 < 45 ? 1 : -1, moveZ: 1, yaw: t * 0.02, pitch: 0.1, buttons: 0 };
      tickWorld(a, new Map([[pa.id, cmd]]));
      tickWorld(b, new Map([[pb.id, cmd]]));
    }
    expect(serializeWorldState(a.state)).toBe(serializeWorldState(b.state));
    expect(a.state.enemies.size).toBe(1);
  });
});

describe("emerge, hunt, stand", () => {
  it("stands still for the reveal, facing its target, then hunts", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 20 };
    const h = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, p.id, SUMMIT_REVEAL_S);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.emergeTo).toBeNull();
    tick(w, Math.round(SUMMIT_REVEAL_S / TICK_DT) - 2);
    expect(h.ai).toBe(AiState.Emerge);
    // Emerging never reaches `stepMovement`, so not even gravity touches it:
    // the spawn point is exactly where it still stands, y included.
    expect(h.pos).toEqual({ x: 100, y: ENEMY_HALF.y, z: 0 });
    expect(Math.abs(h.yaw)).toBeLessThan(0.01); // facing +z, toward the player
    tick(w, 4);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);
    tick(w, 30);
    expect(h.pos.z).toBeGreaterThan(1);
  });

  it("hunts at the hunt speed, slowed to the look factor while seen", () => {
    // It starts on the stem's middle node with its target at the summit node,
    // so its route is the one edge between them and the whole walk is +x —
    // no leg back to a node behind it to muddy the measurement.
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 200, y: 0.9, z: 0 };
    const h = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
    // Each window is measured after a settling quarter-second: neither speed
    // is reached instantly, and measuring from the moment of the change
    // compares two ramps rather than two speeds. Settled, a second of walking
    // is the speed to thirteen decimal places; measured from the change, the
    // wind-up alone costs the first window 0.30 m of its 6.3.
    tick(w, 15);
    const x0 = h.pos.x;
    tick(w, 60);
    expect(h.pos.x - x0).toBeCloseTo(HOLLOW_HUNT_SPEED, 3);
    // Now look straight at it: yaw = atan2(dx, dz) with dx < 0, dz = 0 → -pi/2.
    p.yaw = -Math.PI / 2;
    tick(w, 15);
    const x1 = h.pos.x;
    tick(w, 60);
    expect(h.pos.x - x1).toBeCloseTo(HOLLOW_HUNT_SPEED * HOLLOW_LOOK_FACTOR, 3);
  });

  it("retargets the nearest living, unsafe player when its target dies, and stands when nobody is left", () => {
    const w = world();
    const a = spawnPlayer(w), b = spawnPlayer(w);
    a.pos = { x: 60, y: 0.9, z: 0 };
    b.pos = { x: 120, y: 0.9, z: 0 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, a.id, 0);
    tick(w, 2);
    a.health = 0;
    tick(w, 2);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(b.id);
    b.safe = true;
    tick(w, 2);
    expect(h.ai).toBe(AiState.Stand);
    const standing = { ...h.pos };
    tick(w, 30);
    expect(h.pos.x).toBeCloseTo(standing.x, 3);
    b.safe = false;
    tick(w, 2);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(b.id);
  });

  it("kills any living, unsafe player it touches — target or not — and never a safe one", () => {
    const w = world();
    const a = spawnPlayer(w), b = spawnPlayer(w);
    a.pos = { x: 200, y: 0.9, z: 0 };
    b.pos = { x: 0.5, y: 0.9, z: 0 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, a.id, 0);
    tick(w, 2);
    expect(b.health).toBe(0);
    const c = spawnPlayer(w);
    c.pos = { x: 0.5, y: 0.9, z: 0 };
    c.safe = true;
    tick(w, 2);
    expect(c.health).toBeGreaterThan(0);
    expect(h.targetId).toBe(a.id);
  });

  it("fills a safe player's stare all the same: looking back from the road still costs the screen", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 };
    p.safe = true;
    // 100 m straight down the player's aim, as the stare test's is.
    spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 100 }, 0, STILL);
    tick(w, Math.round(HOLLOW_STARE_FILL_S / TICK_DT / 2));
    expect(p.stare).toBeCloseTo(0.5, 2);
  });
});

describe("a fork Hollow's emerge", () => {
  // Road-less and flat: it spawns 12 m into a branch that runs along -x from
  // the mouth at (12, 0), and its trigger stands 20 m up the z axis from the
  // mouth, off the walk's line and out of its own view of the Hollow.
  const AT = { x: 0, y: ENEMY_HALF.y, z: 0 };
  const MOUTH = { x: 12, y: ENEMY_HALF.y, z: 0 };
  const walkUntilRevealed = (w: ReturnType<typeof world>, h: { emergeTo: unknown }, budget: number) => {
    let t = 0;
    while (t < budget && h.emergeTo !== null) { tickWorld(w, new Map()); t++; }
    return t;
  };

  it("walks to the mouth at the hunt speed, still emerging, stands one second facing its trigger, then hunts", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 12, y: 0.9, z: 20 };
    const h = spawnForkHollow(w, AT, MOUTH, p.id);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.targetId).toBe(p.id);
    expect(h.emergeTo).toEqual({ x: 12, y: 0.9, z: 0 });
    // Measured after the same settling quarter-second as the hunt's speed.
    tick(w, 15);
    const x0 = h.pos.x;
    tick(w, 60);
    expect(h.pos.x - x0).toBeCloseTo(6.3, 3);
    expect(h.yaw).toBeCloseTo(Math.PI / 2, 3); // walking +x, facing the mouth
    expect(h.ai).toBe(AiState.Emerge);
    // On arrival it is still emerging, within the waypoint radius of the mouth.
    expect(walkUntilRevealed(w, h, 300)).toBeLessThan(300);
    expect(h.ai).toBe(AiState.Emerge);
    expect(dist(h.pos, MOUTH)).toBeLessThanOrEqual(1.5);
    const stood = { ...h.pos };
    tick(w, 58);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.pos).toEqual(stood);
    // Facing its trigger, up the z axis: yaw 0 with a little +x, not the walk's pi/2.
    expect(h.yaw).toBeGreaterThanOrEqual(0);
    expect(h.yaw).toBeLessThan(0.1);
    tick(w, 4);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);
    const apart = dist(stood, p.pos);
    tick(w, 60);
    expect(dist(h.pos, p.pos)).toBeLessThan(apart - 3);
  });

  it("is not slowed by a player looking at it: the walk is the reveal, not the hunt", () => {
    const w = world();
    const p = spawnPlayer(w);
    // 40 m down the walk's line, turned round to look straight back at it.
    p.pos = { x: 40, y: 0.9, z: 0 };
    p.yaw = -Math.PI / 2;
    const h = spawnForkHollow(w, AT, MOUTH, p.id);
    tick(w, 15);
    expect(h.seen).toBe(true);
    const x0 = h.pos.x;
    tick(w, 60);
    expect(h.seen).toBe(true);
    expect(h.pos.x - x0).toBeCloseTo(6.3, 3);
    expect(h.emergeTo).not.toBeNull();
  });

  it("kills a player it touches on the way to the mouth", () => {
    const w = world();
    const trigger = spawnPlayer(w);
    trigger.pos = { x: 12, y: 0.9, z: 20 };
    const other = spawnPlayer(w);
    other.pos = { x: 6, y: 0.9, z: 0 };
    const h = spawnForkHollow(w, AT, MOUTH, trigger.id);
    let t = 0;
    while (t < 120 && other.health > 0) { tickWorld(w, new Map()); t++; }
    expect(other.health).toBe(0);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.emergeTo).not.toBeNull();
    expect(trigger.health).toBe(100);
  });

  it("stuck on the way, it reveals where it stands after the stuck time and hunts from there", () => {
    // A wall a step ahead of the spawn, so the walk is nearly all stuck time:
    // ten ticks to cover the 0.6 m to the wall, one more that still reads as
    // progress (the stuck check compares the last two pre-step positions, and
    // tick 10's step moved it), then the 91 it takes the stuck timer to pass
    // 1.5 s standing against it: 10 + 1 + 91, and it reveals on tick 102 where
    // it is, well short of the mouth, for the fork's second.
    const w = world({ min: [1, 0, -5], max: [2, 4, 5], material: "concrete" });
    const p = spawnPlayer(w);
    p.pos = { x: 12, y: 0.9, z: 20 };
    const h = spawnForkHollow(w, AT, MOUTH, p.id);
    expect(walkUntilRevealed(w, h, 200)).toBe(102);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.pos.x).toBeLessThan(1);
    expect(dist(h.pos, MOUTH)).toBeGreaterThan(11);
    const stood = { ...h.pos };
    tick(w, 58);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.pos).toEqual(stood);
    tick(w, 4);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);
  });

  it("with the mouth 100 m off, it reveals after six seconds of walking, wherever it has got to", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 20 };
    const h = spawnForkHollow(w, AT, { x: 100, y: ENEMY_HALF.y, z: 0 }, p.id);
    tick(w, 358);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.emergeTo).not.toBeNull();
    tick(w, 4);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.emergeTo).toBeNull();
    // Six seconds at 6.3 m/s, less the wind-up from rest.
    expect(h.pos.x).toBeGreaterThan(37);
    expect(h.pos.x).toBeLessThan(38);
    tick(w, 62);
    expect(h.ai).toBe(AiState.Hunt);
  });

  it("is cloned with a destination of its own, and a summit Hollow's stays null", () => {
    const w = world();
    const fork = spawnForkHollow(w, AT, MOUTH, 0);
    const summit = spawnHollow(w, { x: 200, y: ENEMY_HALF.y, z: 0 }, 0, SUMMIT_REVEAL_S);
    const copy = cloneWorldState(w.state);
    const forkCopy = copy.enemies.get(fork.id)!;
    expect(forkCopy.emergeTo).toEqual({ x: 12, y: 0.9, z: 0 });
    expect(forkCopy.emergeTo).not.toBe(fork.emergeTo);
    forkCopy.emergeTo!.x = 99;
    expect(fork.emergeTo!.x).toBe(12);
    expect(copy.enemies.get(summit.id)!.emergeTo).toBeNull();
  });

  it("keeps its destination out of the fingerprint", () => {
    const w = world();
    const h = spawnForkHollow(w, AT, MOUTH, 0);
    const withDestination = serializeWorldState(w.state);
    h.emergeTo = null;
    expect(serializeWorldState(w.state)).toBe(withDestination);
  });
});
