import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, createWorld, spawnPlayer } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, nextRandom } from "../../src/sim/types.js";
import type { PlayerState, Vec3 } from "../../src/sim/types.js";
import { ENEMY_HALF, PLAYER_EYE_OFFSET } from "../../src/sim/constants.js";
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
/** The record the tests draw from: no first rest spent, so the sequence starts at the seed. */
/** A hand-authored level: a floor and nothing else, so no forest, ground or trail. */
const flatWorld = () =>
  createWorld(parseLevel({ id: "flat", brushes: [{ min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" }], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
const record = (): WatcherRecord => ({ id: -1, rest: 0, rng: { rngSeed: (seed ^ WATCH_SALT) | 0 } });
const horizontal = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

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
    expect(cos).toBeGreaterThanOrEqual(0.342);
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
    const h = spawnWatcher(w, at, p.id);
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
});
