import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, createWorld, spawnPlayer, type World } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";
import { DEFAULT_TERRAIN_VARIANT, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { AiState, DeathCause, Phase } from "../../src/sim/types.js";
import { trailDistance } from "../../src/sim/trail.js";
import { OFF_TRAIL_FROM_M, SHADE_TRAIL_OFF_M, offTrailOf, placeShadeOffTrail } from "../../src/sim/haunt.js";
import { OFF_TRAIL_M, causeOfDeath } from "../../src/sim/deathCause.js";
import { spawnHollow } from "../../src/sim/hollow.js";
import { WAY_RIM_M, wayDirection, wayDistance, wayPoint, wayProject } from "../../src/sim/wayDown.js";
import { wayOf } from "../../src/sim/wayDraw.js";
import { CREST_GRACE_M, WAY_SLACK_M, chaseLineDistance, chaseLinePoint, onWay } from "../../src/sim/chaseLine.js";
import { graph } from "./helpers/stemGraph.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");
const SUITE = { timeout: timeLimit(120_000) };

/** A forest world with its way drawn, in the chase or still on the climb. */
function forest(phase: Phase): World {
  const w = createForestWorld(createForest(seed));
  w.haunt!.active = false;
  wayOf(w);
  w.state.phase = phase;
  return w;
}
/** The way's point `s` metres along, moved `off` metres to its left. */
function beside(w: World, s: number, off: number): { x: number; z: number } {
  const p = wayPoint(w.way!, s, { x: 0, z: 0 }), d = wayDirection(w.way!, s, { x: 0, z: 0 });
  return { x: p.x - d.z * off, z: p.z + d.x * off };
}
/** Metres along the way of a place on it at least `far` metres from the trail. */
function offTheTrail(w: World, far: number): number {
  for (let s = 60; s < w.way!.length - 60; s += 4) {
    const p = wayPoint(w.way!, s, { x: 0, z: 0 });
    if (trailDistance(w.trail!, p.x, p.z) > far) return s;
  }
  throw new Error("the way never leaves the trail by that much");
}
const stand = (w: World, p: { pos: { x: number; y: number; z: number } }, x: number, z: number): void => { p.pos = { x, y: elevationAt(seed, x, z) + 0.9, z }; };

describe("the line the chase holds a player to", SUITE, () => {
  it("gives the rim the trail's own edge", () => {
    expect(WAY_SLACK_M).toBe(WAY_RIM_M - OFF_TRAIL_FROM_M);
    expect(OFF_TRAIL_M).toBe(OFF_TRAIL_FROM_M);
  });

  it("before the find it is the trail's distance, way or no way", () => {
    const w = forest(Phase.Climb);
    expect(onWay(w)).toBe(false);
    const p = beside(w, offTheTrail(w, 30), 0);
    expect(chaseLineDistance(w, p.x, p.z)).toBe(trailDistance(w.trail!, p.x, p.z));
  });

  it("in the scene and the chase the way's rim reads as the trail's edge, and the way itself as nothing", () => {
    for (const phase of [Phase.Scene, Phase.Chase]) {
      const w = forest(phase);
      expect(onWay(w)).toBe(true);
      const s = offTheTrail(w, 30);
      const rim = beside(w, s, WAY_RIM_M), on = beside(w, s, 1), floor = beside(w, s, 4);
      expect(chaseLineDistance(w, rim.x, rim.z)).toBeCloseTo(OFF_TRAIL_FROM_M, 1);
      expect(chaseLineDistance(w, on.x, on.z)).toBe(0);
      // The floor's edge is inside the trail's own: on the way.
      expect(chaseLineDistance(w, floor.x, floor.z)).toBeLessThan(OFF_TRAIL_FROM_M);
    }
  });

  it("where the party stood at the find is on the line, a few strides round: a player caught there, or just returned there, did not leave the way", () => {
    const w = forest(Phase.Chase);
    expect(CREST_GRACE_M).toBe(15);
    // The party's place: beside the way's start, off it by more than its rim.
    const start = beside(w, 0, 0);
    w.crest = { pos: { x: start.x + 9, y: elevationAt(seed, start.x + 9, start.z), z: start.z }, yaw: 0 };
    expect(wayDistance(w.way!, w.crest.pos.x, w.crest.pos.z)).toBeGreaterThan(WAY_RIM_M);
    expect(chaseLineDistance(w, w.crest.pos.x, w.crest.pos.z)).toBe(0);
    expect(chaseLineDistance(w, w.crest.pos.x + 10, w.crest.pos.z)).toBe(0);
    // A player standing there, caught: standing still is why, not leaving the way.
    const p = spawnPlayer(w);
    stand(w, p, w.crest.pos.x, w.crest.pos.z);
    const h = spawnHollow(w, { x: p.pos.x + 1, y: p.pos.y, z: p.pos.z }, p.id, 0);
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Still);
    // Past the grace it is the way's distance again.
    const far = { x: w.crest.pos.x + 40, z: w.crest.pos.z };
    if (wayDistance(w.way!, far.x, far.z) > WAY_RIM_M + 1) expect(chaseLineDistance(w, far.x, far.z)).toBeGreaterThan(0);
  });

  it("a level with no way keeps the trail in the chase, and one with no trail is never off it", () => {
    const flat = createWorld(parseLevel({ id: "flat", brushes: [{ min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" }], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
    flat.state.phase = Phase.Chase;
    expect(chaseLineDistance(flat, 10, 10)).toBe(0);
    expect(chaseLinePoint(flat, 0, 0, 10, { x: 0, z: 0 })).toBeNull();
    flat.trail = graph(0);
    expect(onWay(flat)).toBe(false);
    expect(chaseLineDistance(flat, 50, 9)).toBe(trailDistance(flat.trail, 50, 9));
  });

  it("the point ahead is further down the way", () => {
    const w = forest(Phase.Chase);
    const me = beside(w, 200, 3);
    const a = chaseLinePoint(w, me.x, me.z, 30, { x: 0, z: 0 })!;
    expect(wayDistance(w.way!, a.x, a.z)).toBeLessThan(0.01);
    expect(wayProject(w.way!, a.x, a.z).s - wayProject(w.way!, me.x, me.z).s).toBeCloseTo(30, 0);
  });

  it("a death beside the trail but 8 m off the way is off the trail's cause; one on the way, far from the trail, is not", () => {
    const w = forest(Phase.Chase);
    const p = spawnPlayer(w);
    const s = offTheTrail(w, 30);
    const on = beside(w, s, 1), off = beside(w, s, 8);
    const h = spawnHollow(w, { x: on.x, y: elevationAt(seed, on.x, on.z) + 1, z: on.z }, p.id, 0);
    h.ai = AiState.Hunt;
    // Running down the way, the Hollow behind: caught, not off anything.
    const d = wayDirection(w.way!, s, { x: 0, z: 0 });
    stand(w, p, on.x, on.z);
    h.pos = { x: on.x - d.x * 2, y: p.pos.y, z: on.z - d.z * 2 };
    p.vel = { x: d.x * 7, y: 0, z: d.z * 7 };
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Caught);
    stand(w, p, off.x, off.z);
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.OffTrail);
    // The same place on the climb's rules would be the trail's to judge.
    w.state.phase = Phase.Climb;
    stand(w, p, on.x, on.z);
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.OffTrail);
  });

  it("the haunt reads a player on the way as on it, however far the trail is", () => {
    const w = forest(Phase.Chase);
    const p = spawnPlayer(w);
    p.out = true;
    const s = offTheTrail(w, 30);
    const on = beside(w, s, 1);
    stand(w, p, on.x, on.z);
    expect(offTrailOf(w)).toBe(0);
    const off = beside(w, s, 30);
    stand(w, p, off.x, off.z);
    expect(offTrailOf(w)).toBeGreaterThan(0.9);
  });

  it("the haunt stands its shades 15 to 20 m off the way in the chase, as it does off the trail", () => {
    const w = forest(Phase.Chase);
    const p = spawnPlayer(w);
    const s = offTheTrail(w, 30);
    const on = beside(w, s, 0), d = wayDirection(w.way!, s, { x: 0, z: 0 });
    stand(w, p, on.x, on.z);
    p.yaw = Math.atan2(d.x, d.z);
    const rng = { rngSeed: 12345 };
    let placed = 0;
    for (let i = 0; i < 200; i++) {
      const at = placeShadeOffTrail(w, p, rng);
      if (at === null) continue;
      placed++;
      const off = chaseLineDistance(w, at.x, at.z);
      expect(off).toBeGreaterThanOrEqual(SHADE_TRAIL_OFF_M[0]);
      expect(off).toBeLessThanOrEqual(SHADE_TRAIL_OFF_M[1]);
    }
    expect(placed).toBeGreaterThan(10);
  });
});
