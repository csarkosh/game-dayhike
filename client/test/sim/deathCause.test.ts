import { describe, expect, it } from "vitest";
import { createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { AiState, DeathCause } from "../../src/sim/types.js";
import { ENEMY_HALF } from "../../src/sim/constants.js";
import { spawnHollow } from "../../src/sim/hollow.js";
import { INTO_COS, LOOKED_STARE, OFF_TRAIL_M, STILL_SPEED, causeOfDeath } from "../../src/sim/deathCause.js";
import { OFF_TRAIL_FROM_M } from "../../src/sim/haunt.js";
import { graph } from "./helpers/stemGraph.js";

const FLOOR = { min: [-300, -1, -300] as [number, number, number], max: [300, 0, 300] as [number, number, number], material: "concrete" };
/** A flat world with the hand graph as its trail: the stem runs along +x from (0, 0) to (200, 0). */
function world() {
  const w = createWorld(parseLevel({ id: "flat", brushes: [FLOOR], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
  w.trail = graph(1);
  return w;
}
/** A player on the stem at x = 50 and a Hollow 1 m up the stem from them, hunting. */
function pair() {
  const w = world();
  const p = spawnPlayer(w);
  p.pos = { x: 50, y: 0.9, z: 0 };
  const h = spawnHollow(w, { x: 51, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
  return { w, p, h };
}

describe("why a player died", () => {
  it("was run down: on the trail, running away from it, not watching", () => {
    const { w, p, h } = pair();
    p.vel = { x: -7, y: 0, z: 0 };
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Caught);
  });

  it("was off the trail, whatever else they were doing", () => {
    const { w, p, h } = pair();
    p.pos = { x: 50, y: 0.9, z: 12 };
    h.pos = { x: 51, y: ENEMY_HALF.y, z: 12 };
    p.vel = { x: 0, y: 0, z: 0 };
    p.stare = 1;
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.OffTrail);
    // Within the haunt's own measure of the trail they are on it.
    expect(OFF_TRAIL_M).toBe(OFF_TRAIL_FROM_M);
    p.pos = { x: 50, y: 0.9, z: 3 };
    expect(causeOfDeath(w, p, h, "contact")).not.toBe(DeathCause.OffTrail);
  });

  it("stood still, or moved slower than a walk: before staring, which they also did", () => {
    const { w, p, h } = pair();
    p.vel = { x: 0, y: 0, z: 0 };
    p.stare = 1;
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Still);
    p.vel = { x: STILL_SPEED - 0.1, y: 0, z: 0 };
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Still);
    // A fall is not a walk: only the ground speed counts.
    p.vel = { x: 0, y: -9, z: 0 };
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Still);
  });

  it("moved toward the thing that killed them", () => {
    const { w, p, h } = pair();
    p.vel = { x: 7, y: 0, z: 0 };
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Into);
    // Across its path is not toward it.
    p.vel = { x: 0, y: 0, z: 7 };
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Caught);
    expect(INTO_COS).toBeGreaterThan(0);
  });

  it("was watching it: the stare most of the way closed, running away", () => {
    const { w, p, h } = pair();
    p.vel = { x: -7, y: 0, z: 0 };
    p.stare = LOOKED_STARE;
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Looked);
    p.stare = LOOKED_STARE - 0.01;
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Caught);
  });

  it("was taken by a shade's lunge: its strike, or its touch as it came", () => {
    const { w, p, h } = pair();
    p.vel = { x: -7, y: 0, z: 0 };
    expect(causeOfDeath(w, p, h, "strike")).toBe(DeathCause.Lunge);
    h.ai = AiState.Lunge;
    expect(causeOfDeath(w, p, h, "contact")).toBe(DeathCause.Lunge);
  });

  it("is on the player from the kill: a Hollow's touch leaves its cause, and a living player has none", () => {
    const { w, p, h } = pair();
    expect(p.cause).toBe(DeathCause.None);
    // Within its touch (0.9 m between the two).
    h.pos.x = 50.5;
    tickWorld(w, new Map());
    expect(p.health).toBe(0);
    expect(p.cause).toBe(DeathCause.Still);
  });
});
