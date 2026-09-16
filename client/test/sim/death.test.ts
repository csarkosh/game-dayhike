import { describe, it, expect } from "vitest";
import { createForestWorld, createWorld, spawnPlayer, tickWorld, isDead } from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { depenetrate } from "../../src/sim/collision.js";
import { parseLevel } from "../../src/sim/level.js";
import { ENEMY_POPULATION_CAP, PLAYER_HALF } from "../../src/sim/constants.js";
import { AiState, type InputCommand } from "../../src/sim/types.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const level = parseLevel(sandbox01);

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

describe("death is permanent", () => {
  it("marks where they fell on the tick health reaches zero, and starts no timer", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    p.health = 0;
    tickWorld(w, new Map());
    expect(isDead(p)).toBe(true);
    expect(p.respawnTimer).toBe(0);
    expect(p.deathPos).toEqual(p.pos);
  });

  it("ignores movement input while dead", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map()); // land first
    p.health = 0;
    tickWorld(w, new Map());

    const at = { ...p.pos };
    for (let i = 0; i < 30; i++) tickWorld(w, new Map([[p.id, input({ moveZ: 1 })]]));
    expect(p.pos.x).toBeCloseTo(at.x, 6);
    expect(p.pos.y).toBeCloseTo(at.y, 6);
    expect(p.pos.z).toBeCloseTo(at.z, 6);
  });

  it("still tracks view angles while dead, so the camera does not freeze", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    p.health = 0;
    tickWorld(w, new Map());
    tickWorld(w, new Map([[p.id, input({ yaw: 1.25, pitch: -0.5 })]]));
    expect(p.yaw).toBeCloseTo(1.25, 6);
    expect(p.pitch).toBeCloseTo(-0.5, 6);
  });

  it("never comes back: a minute later they are still dead where they fell", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map());
    p.pos = { x: 20, y: 0.9, z: -20 };
    p.health = 0;
    for (let i = 0; i < 3600; i++) tickWorld(w, new Map([[p.id, input({ moveZ: 1 })]]));
    expect(p.health).toBe(0);
    expect(isDead(p)).toBe(true);
    expect(p.pos.x).toBeCloseTo(20, 6);
    expect(p.pos.z).toBeCloseTo(-20, 6);
    expect(p.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.deathPos).toEqual({ x: 20, y: 0.9, z: -20 });
  });

  it("holds in a non-authoritative world too, so a client cannot predict a return", () => {
    const w = createWorld(level, 1, false);
    const p = spawnPlayer(w);
    p.health = 0;
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(p.health).toBe(0);
    expect(p.deathPos).toBeNull(); // the drop and the mark are the host's
  });

  it("does not simulate enemies in a non-authoritative world", () => {
    const w = createWorld(level, 1, false);
    spawnPlayer(w);
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(w.state.enemies.size).toBe(0);
  });
});

describe("death in a generated forest", () => {
  it("keeps the fallen where they fell, on valid ground they were already on", () => {
    const w = createForestWorld(createForest(0xdead));
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map());
    const diedAt = { ...p.pos };
    p.health = 0;
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(p.health).toBe(0);
    expect(p.pos).toEqual(diedAt);
    expect(p.deathPos).toEqual(diedAt);
  });

  it("spawns a joining player on valid ground", () => {
    const w = createForestWorld(createForest(0xc0ffee));
    const p = spawnPlayer(w);
    const fixed = depenetrate(p.pos, PLAYER_HALF, w.boxes);
    expect(Math.abs(fixed.y - p.pos.y)).toBeLessThan(1e-9);
  });
});

/**
 * Generated worlds ship with `maxEnemies` at 0 and the director switched off.
 * This raises the ceiling explicitly to prove that what holds a generated
 * world's population is `targetPopulation`, not the ceiling.
 */
describe("the director in a generated forest", () => {
  it("spawns nothing even with the ceiling raised, while the director is off", () => {
    const w = createForestWorld(createForest(0x5eed1));
    w.maxEnemies = ENEMY_POPULATION_CAP;
    spawnPlayer(w);
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect([...w.state.enemies.values()].filter((e) => e.ai === AiState.Chase || e.ai === AiState.Idle)).toEqual([]);
  });
});
