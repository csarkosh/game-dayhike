import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Phase, nextRandom } from "../../src/sim/types.js";
import type { PlayerState, Vec3 } from "../../src/sim/types.js";
import { ENEMY_HALF, PLAYER_EYE_OFFSET, TICK_DT } from "../../src/sim/constants.js";
import { trailDistance } from "../../src/sim/trail.js";
import type { TrailNode } from "../../src/sim/trail.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { groundSpawn } from "../../src/sim/spawn.js";
import { hasLineOfSight } from "../../src/sim/ai.js";
import {
  WATCH_SALT,
  climbOf,
  createWatcherRecord,
  hideWatcher,
  leadOf,
  placeWatcher,
  reachOf,
  spawnWatcher,
  stepWatcher,
  topForkClimb,
} from "../../src/sim/watcher.js";
import type { WatcherRecord } from "../../src/sim/watcher.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");

/** A real forest world: the first build runs past vitest's default, as summit.test.ts says. */
const SUITE = { timeout: 120_000 };

function forestWorld() {
  const w = createForestWorld(createForest(seed));
  const p = spawnPlayer(w);
  return { w, p };
}
const node = (w: World, i: number) => w.trail!.nodes[i] as TrailNode;
/** Stands a player on the ground at (x, z). */
const standAt = (p: PlayerState, x: number, z: number) => { p.pos = { x, y: elevationAt(seed, x, z) + 0.9, z }; };
/** Stands a player on stem node `i`, facing the next stem node up. */
function standOnStem(w: World, p: PlayerState, i: number) {
  const chain = stemNodes(w.trail!);
  const at = chain.indexOf(i);
  expect(at).toBeGreaterThanOrEqual(0);
  const here = node(w, i), next = node(w, chain[at + 1] as number);
  standAt(p, here.x, here.z);
  p.yaw = Math.atan2(next.x - here.x, next.z - here.z);
  p.pitch = 0;
}
/** A hand-authored level: a floor and nothing else, so no forest, ground or trail. */
const flatWorld = () =>
  createWorld(parseLevel({ id: "flat", brushes: [{ min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" }], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
/** The record the tests draw from: no first rest spent, so the sequence starts at the seed. */
const record = (): WatcherRecord => ({ id: -1, rest: 0, rng: { rngSeed: (seed ^ WATCH_SALT) | 0 } });
const horizontal = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
const tick = (w: World, n = 1) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
/** Aims a player's eye straight at `at`, yaw and pitch both. */
function lookAt(p: PlayerState, at: Vec3) {
  const dx = at.x - p.pos.x, dz = at.z - p.pos.z, dy = at.y - (p.pos.y + PLAYER_EYE_OFFSET);
  p.yaw = Math.atan2(dx, dz);
  p.pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
}
/** The shown watcher entity, or undefined. */
const shownWatcher = (w: World) => (w.watcher!.id === -1 ? undefined : w.state.enemies.get(w.watcher!.id));
/**
 * Runs the tick with the rest at zero until the watcher shows, and returns
 * how many ticks it took. Every caller pins that count.
 */
function showWatcher(w: World, limit = 120): number {
  w.watcher!.rest = 0;
  for (let i = 1; i <= limit; i++) {
    tick(w);
    if (w.watcher!.id !== -1) return i;
  }
  return -1;
}

describe("the climb", SUITE, () => {
  it("is 0 at the pad node and 1 at the crest node", () => {
    const { w } = forestWorld();
    const g = w.trail!;
    expect(g.summit).toBe(36);
    expect(climbOf(g, node(w, 0).x, node(w, 0).z)).toBeCloseTo(0, 2);
    expect(climbOf(g, node(w, 36).x, node(w, 36).z)).toBeCloseTo(1, 2);
  });

  it("names the living player farthest up the stem the lead, and the next when the lead dies", () => {
    const { w, p } = forestWorld();
    const q = spawnPlayer(w), r = spawnPlayer(w);
    standOnStem(w, p, 0);
    standOnStem(w, q, 18);
    standOnStem(w, r, 37);
    expect(leadOf(w)).toBe(r);
    r.health = 0;
    expect(leadOf(w)).toBe(q);
    q.health = 0;
    expect(leadOf(w)).toBe(p);
    p.health = 0;
    expect(leadOf(w)).toBeNull();
  });

  it("measures the reach against the top fork's climb", () => {
    const { w, p } = forestWorld();
    expect(w.trail!.forks).toEqual([2, 22, 37, 78, 79]);
    expect(topForkClimb(w.trail!)).toBeCloseTo(0.751, 3);
    standOnStem(w, p, 0);
    expect(reachOf(w, p)).toBeCloseTo(0, 2);
    standOnStem(w, p, 37);
    expect(reachOf(w, p)).toBe(1);
  });
});

describe("the record", SUITE, () => {
  it("seeds its own stream from the world's seed and draws its first rest from the band", () => {
    const a = createWatcherRecord(seed);
    expect(a.id).toBe(-1);
    expect(a.rest).toBeGreaterThanOrEqual(20);
    expect(a.rest).toBeLessThanOrEqual(60);
    const stream = { rngSeed: (seed ^ 0x57a7c4) | 0 };
    expect(a.rest).toBe(20 + nextRandom(stream) * 40);
    expect(a.rng.rngSeed).toBe(stream.rngSeed);
    expect(createWatcherRecord(seed)).toEqual(a);
  });

  it("is on a forest world with a trail and not on a hand-authored level", () => {
    const { w } = forestWorld();
    expect(w.watcher).not.toBeNull();
    expect(w.watcher!.id).toBe(-1);
    const flat = flatWorld();
    expect(flat.watcher).toBeNull();
  });
});

describe("the placement", SUITE, () => {
  /** Every constraint a placed point must obey, against the lead at `range`. */
  function check(w: World, lead: PlayerState, at: Vec3, range: number) {
    const g = w.trail!;
    expect(trailDistance(g, at.x, at.z)).toBeGreaterThanOrEqual(6);
    expect(isOnCorridor(w, at.x, at.z)).toBe(false);
    for (const p of w.state.players.values()) if (p.health > 0) expect(horizontal(p.pos, at)).toBeGreaterThanOrEqual(15);
    expect(groundSpawn(w.boxes, seed, at.x, at.z, ENEMY_HALF)).toEqual(at);
    const n = { x: 0, y: 0, z: 0 };
    w.ground!.normalAt(at.x, at.z, n);
    expect(n.y).toBeGreaterThanOrEqual(0.74);
    const eye = { x: lead.pos.x, y: lead.pos.y + PLAYER_EYE_OFFSET, z: lead.pos.z };
    expect(hasLineOfSight(eye, at, w.boxes, w.ground)).toBe(true);
    const d = horizontal(lead.pos, at);
    expect(Math.abs(d - range)).toBeLessThanOrEqual(0.5);
    const cos = ((at.x - lead.pos.x) * Math.sin(lead.yaw) + (at.z - lead.pos.z) * Math.cos(lead.yaw)) / d;
    // The 70° edge's rounded constants normalise to 0.34199998, a hair under cos 70°.
    expect(cos).toBeGreaterThanOrEqual(0.3419);
    expect(cos).toBeLessThanOrEqual(0.8661);
  }

  function attempts(w: World, lead: PlayerState, reach: number, n = 200): (Vec3 | null)[] {
    const out: (Vec3 | null)[] = [];
    for (let i = 0; i < n; i++) out.push(placeWatcher(w, lead, reach));
    return out;
  }

  it("lands only where every rule holds at the pad, 90 m out, and the count is pinned", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 0);
    w.watcher = record();
    const placed = attempts(w, p, reachOf(w, p));
    let landed = 0;
    for (const at of placed) if (at !== null) { landed++; check(w, p, at, 90); }
    expect(landed).toBe(11);
  });

  it("lands only where every rule holds at the top fork, 25 m out, and the count is pinned", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 37);
    w.watcher = record();
    const placed = attempts(w, p, reachOf(w, p));
    let landed = 0;
    for (const at of placed) if (at !== null) { landed++; check(w, p, at, 25); }
    expect(landed).toBe(147);
  });

  it("spends two draws on every attempt, landed or not, and repeats itself from the same record", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 0);
    w.watcher = record();
    const first = attempts(w, p, 0);
    const spent = { rngSeed: (seed ^ 0x57a7c4) | 0 };
    for (let i = 0; i < 400; i++) nextRandom(spent);
    expect(w.watcher.rng.rngSeed).toBe(spent.rngSeed);
    w.watcher = record();
    expect(attempts(w, p, 0)).toEqual(first);
  });

  it("refuses a spot within 15 m of another living player", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 37);
    w.watcher = record();
    const placed = attempts(w, p, 1);
    const k = placed.findIndex((at) => at !== null);
    const spot = placed[k] as Vec3;
    const q = spawnPlayer(w);
    standAt(q, spot.x + 10, spot.z);
    w.watcher = record();
    for (let i = 0; i < k; i++) placeWatcher(w, p, 1);
    expect(placeWatcher(w, p, 1)).toBeNull();
    q.health = 0;
    w.watcher = record();
    for (let i = 0; i < k; i++) placeWatcher(w, p, 1);
    expect(placeWatcher(w, p, 1)).toEqual(spot);
  });

  it("places nothing on a world without a forest", () => {
    const flat = flatWorld();
    const p = spawnPlayer(flat);
    flat.watcher = record();
    expect(placeWatcher(flat, p, 0)).toBeNull();
  });
});

describe("showing and hiding", SUITE, () => {
  it("spawns a Watch Hollow facing nobody yet, records its id, and removes it on hide", () => {
    const { w, p } = forestWorld();
    const at = { x: 10, y: 5, z: 20 };
    const h = spawnWatcher(w, at, p.id)!;
    expect(h.ai).toBe(AiState.Watch);
    expect(h.targetId).toBe(p.id);
    expect(h.pos).toEqual(at);
    expect(h.pos).not.toBe(at);
    expect(h.yaw).toBe(0);
    expect(h.stateTimer).toBe(0);
    expect(h.emergeTo).toBeNull();
    expect(h.route).toEqual([]);
    expect(w.watcher!.id).toBe(h.id);
    expect(w.state.enemies.get(h.id)).toBe(h);
    hideWatcher(w);
    expect(w.watcher!.id).toBe(-1);
    expect(w.state.enemies.has(h.id)).toBe(false);
    hideWatcher(w);
    expect(w.watcher!.id).toBe(-1);
  });

  it("spawns nothing on a world without a record", () => {
    const flat = flatWorld();
    const p = spawnPlayer(flat);
    expect(spawnWatcher(flat, { x: 10, y: 0.9, z: 20 }, p.id)).toBeNull();
    expect(flat.state.enemies.size).toBe(0);
    expect(flat.state.nextEntityId).toBe(2);
  });
});

describe("the tick", SUITE, () => {
  it("shows on the tick the rest runs out and a placement fits, at a point the placement rule admits", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 37);
    // Two and a half ticks of rest: two count it down, the third runs it out and tries the placements.
    w.watcher!.rest = 2.5 * TICK_DT;
    tick(w, 2);
    expect(w.state.enemies.size).toBe(0);
    expect(w.watcher!.id).toBe(-1);
    tick(w);
    expect(w.state.enemies.size).toBe(1);
    const h = shownWatcher(w)!;
    expect(h.ai).toBe(AiState.Watch);
    expect(h.targetId).toBe(p.id);
    expect(h.pos).toEqual({ x: 166.38168084443757, y: 186.96436776923537, z: -93.9021019130009 });
    expect(horizontal(p.pos, h.pos)).toBeCloseTo(25, 0);
    expect(trailDistance(w.trail!, h.pos.x, h.pos.z)).toBeGreaterThanOrEqual(6);
    expect(isOnCorridor(w, h.pos.x, h.pos.z)).toBe(false);
    expect(groundSpawn(w.boxes, seed, h.pos.x, h.pos.z, ENEMY_HALF)).toEqual(h.pos);
    // The same tick turned it to face the lead, and it is not in the stare's cone.
    expect(h.yaw).toBeCloseTo(Math.atan2(p.pos.x - h.pos.x, p.pos.z - h.pos.z), 6);
    expect(p.stare).toBe(0);
    // It stays: the lead has it in the wide view and nobody is near.
    tick(w, 30);
    expect(shownWatcher(w)).toBe(h);
    expect(h.pos).toEqual({ x: 166.38168084443757, y: 186.96436776923537, z: -93.9021019130009 });
  });

  it("keeps trying, a tick at a time, from the pad where most placements fail", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 0);
    expect(showWatcher(w)).toBe(2);
    const h = shownWatcher(w)!;
    expect(horizontal(p.pos, h.pos)).toBeCloseTo(90, 0);
    expect(h.targetId).toBe(p.id);
  });

  it("hides on the first tick the lead turns away, and draws a rest in the band scaled by the reach", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 37);
    expect(showWatcher(w)).toBe(1);
    const h = shownWatcher(w)!;
    expect(reachOf(w, p)).toBe(1);
    // A quarter turn toward its side leaves it inside the 80° cone.
    const side = Math.sign((h.pos.x - p.pos.x) * Math.cos(p.yaw) - (h.pos.z - p.pos.z) * Math.sin(p.yaw));
    p.yaw += side * Math.PI / 2;
    tick(w);
    expect(shownWatcher(w)).toBe(h);
    // Half a turn puts it behind: gone this tick, and the rest is 20–60 s scaled to 0.4 at the top fork.
    p.yaw += Math.PI;
    tick(w);
    expect(shownWatcher(w)).toBeUndefined();
    expect(w.state.enemies.size).toBe(0);
    expect(w.watcher!.id).toBe(-1);
    expect(w.watcher!.rest).toBeGreaterThanOrEqual(8);
    expect(w.watcher!.rest).toBeLessThanOrEqual(24);
    expect(w.watcher!.rest).toBe(19.658605493605137);
    // And it stays hidden while the rest runs: one tick short of it, nothing.
    tick(w, Math.floor(w.watcher!.rest / TICK_DT) - 1);
    expect(w.state.enemies.size).toBe(0);
  });

  it("hides on the first tick a player comes within 15 m", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 37);
    expect(showWatcher(w)).toBe(1);
    const h = shownWatcher(w)!;
    const q = spawnPlayer(w);
    standAt(q, h.pos.x + 16, h.pos.z);
    tick(w);
    expect(shownWatcher(w)).toBe(h);
    standAt(q, h.pos.x + 14, h.pos.z);
    tick(w);
    expect(shownWatcher(w)).toBeUndefined();
    expect(w.state.enemies.size).toBe(0);
    expect(w.watcher!.rest).toBeGreaterThanOrEqual(8);
    expect(w.watcher!.rest).toBeLessThanOrEqual(24);
  });

  it("fills the stare only while the lead looks at it, and the stare is already falling on the hide tick", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 37);
    expect(showWatcher(w)).toBe(1);
    const h = shownWatcher(w)!;
    // In the wide view but outside the stare's 20° cone: shown, and no stare.
    tick(w, 30);
    expect(shownWatcher(w)).toBe(h);
    expect(p.stare).toBe(0);
    expect(h.seen).toBe(false);
    // Centred: the stare fills at 1/360 a tick.
    lookAt(p, h.pos);
    tick(w, 60);
    expect(h.seen).toBe(true);
    expect(p.stare).toBeCloseTo(60 / 360, 12);
    const before = p.stare;
    // Looked away: it hides before the look pass runs, which finds nothing, so
    // the stare has already fallen by 1/180 on the very tick it went.
    p.yaw += Math.PI;
    tick(w);
    expect(shownWatcher(w)).toBeUndefined();
    expect(p.stare).toBeCloseTo(before - 1 / 180, 12);
    let last = p.stare;
    for (let i = 0; i < 20; i++) {
      tick(w);
      expect(p.stare).toBeLessThan(last);
      last = p.stare;
    }
    expect(p.health).toBe(100);
  });

  it("never shows once the phase has flipped, leaving the summit Hollow alone", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w);
    expect(w.state.phase).toBe(Phase.Chase);
    expect(w.state.enemies.size).toBe(1);
    w.watcher!.rest = 0;
    for (let i = 0; i < 2000; i++) {
      tick(w);
      expect(w.state.enemies.size).toBe(1);
      for (const e of w.state.enemies.values()) expect(e.ai).not.toBe(AiState.Watch);
    }
    expect(w.watcher!.id).toBe(-1);
    expect(w.watcher!.rest).toBe(0);
  });

  it("is removed on the flip tick, and the guide is drawn from the world's stream untouched", () => {
    const { w, p } = forestWorld();
    // A second player finds the body while the lead, at the top fork, keeps
    // the watcher in view: it is shown into the flip tick, and only the flip
    // can remove it. Spawned before the showing, so the ids below hold.
    const q = spawnPlayer(w);
    standOnStem(w, p, 37);
    expect(showWatcher(w)).toBe(1);
    const id = w.watcher!.id;
    tick(w, 10);
    expect(w.state.enemies.has(id)).toBe(true);
    expect(w.state.rngSeed).toBe(2032433950);
    const body = w.register!.body.pos;
    standAt(q, body.x - 5, body.z);
    tick(w);
    expect(w.state.phase).toBe(Phase.Chase);
    expect(w.state.enemies.has(id)).toBe(false);
    expect(w.watcher!.id).toBe(-1);
    // The rest is what the showing left, one tick under zero: no hide drew a
    // new one, so it was the flip that took it, not the hide rule.
    expect(w.watcher!.rest).toBe(-1 / 60);
    const hollows = [...w.state.enemies.values()];
    expect(hollows).toHaveLength(1);
    expect(hollows[0]!.ai).toBe(AiState.Emerge);
    expect(hollows[0]!.id).toBe(id + 1);
    expect(w.state.rngSeed).toBe(1201198389);
    expect(w.cut!.guide.length).toBe(54);
  });

  it("re-reads the lead when the lead dies: the facing and the next placement follow the survivor", () => {
    const { w, p } = forestWorld();
    const q = spawnPlayer(w);
    standOnStem(w, p, 37);
    // Two metres behind the lead on the stem, looking the same way: sees what the lead sees.
    const chain = stemNodes(w.trail!);
    const here = node(w, 37), below = node(w, chain[chain.indexOf(37) - 1] as number);
    const dx = below.x - here.x, dz = below.z - here.z, len = Math.sqrt(dx * dx + dz * dz);
    standAt(q, here.x + (dx / len) * 2, here.z + (dz / len) * 2);
    q.yaw = p.yaw;
    expect(leadOf(w)).toBe(p);
    expect(showWatcher(w)).toBe(1);
    const h = shownWatcher(w)!;
    expect(h.targetId).toBe(p.id);
    p.health = 0;
    tick(w);
    expect(leadOf(w)).toBe(q);
    expect(shownWatcher(w)).toBe(h);
    expect(h.targetId).toBe(q.id);
    expect(h.yaw).toBeCloseTo(Math.atan2(q.pos.x - h.pos.x, q.pos.z - h.pos.z), 6);
    // Hidden by the survivor looking away, then shown again for them.
    q.yaw += Math.PI;
    tick(w);
    expect(shownWatcher(w)).toBeUndefined();
    q.yaw -= Math.PI;
    expect(showWatcher(w)).toBe(1);
    const again = shownWatcher(w)!;
    expect(again.targetId).toBe(q.id);
    expect(horizontal(q.pos, again.pos)).toBeCloseTo(25, 0);
  });

  it("scales the rest by the reach: the same draw is 0.4 of itself at the top fork", () => {
    const { w, p } = forestWorld();
    standOnStem(w, p, 37);
    const stream = w.watcher!.rng.rngSeed;
    expect(showWatcher(w)).toBe(1);
    p.yaw += Math.PI;
    tick(w);
    const near = w.watcher!.rest;
    expect(near).toBe(19.658605493605137);
    // The same stream and the same showing, with the lead back on the pad on
    // the hide tick: reach 0 exactly, and the watcher far out of view from there.
    w.watcher!.rng.rngSeed = stream;
    standOnStem(w, p, 37);
    expect(showWatcher(w)).toBe(1);
    standOnStem(w, p, 0);
    expect(reachOf(w, p)).toBe(0);
    tick(w);
    expect(shownWatcher(w)).toBeUndefined();
    const far = w.watcher!.rest;
    expect(far).toBe(49.14651373401284);
    expect(near).toBeCloseTo(0.4 * far, 12);
    // And with no lead at all: the lead dead on the hide tick reads as reach 0 too.
    w.watcher!.rng.rngSeed = stream;
    standOnStem(w, p, 37);
    expect(showWatcher(w)).toBe(1);
    p.health = 0;
    tick(w);
    expect(shownWatcher(w)).toBeUndefined();
    expect(w.watcher!.rest).toBe(49.14651373401284);
  });

  it("never shows on a world that is not authoritative", () => {
    const w = createForestWorld(createForest(seed), false);
    const p = spawnPlayer(w);
    standOnStem(w, p, 37);
    expect(w.watcher).toBeNull();
    tick(w, 100);
    expect(w.state.enemies.size).toBe(0);
    expect(w.state.phase).toBe(Phase.Climb);
    // Handed a record by hand, the tick still refuses it; only the rule itself would show.
    w.watcher = record();
    tick(w, 100);
    expect(w.state.enemies.size).toBe(0);
    expect(w.watcher.rest).toBe(0);
    stepWatcher(w, TICK_DT);
    expect(w.state.enemies.size).toBe(1);
  });
});
