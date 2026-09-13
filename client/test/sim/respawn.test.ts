import { describe, it, expect } from "vitest";
import {
  createForestWorld,
  createWorld,
  spawnPlayer,
  tickWorld,
  isDead,
} from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { depenetrate } from "../../src/sim/collision.js";
import { parseLevel } from "../../src/sim/level.js";
import {
  ENEMY_POPULATION_CAP,
  PLAYER_HALF,
  PLAYER_MAX_HEALTH,
  RESPAWN_SECONDS,
  TICK_DT,
} from "../../src/sim/constants.js";
import type { InputCommand } from "../../src/sim/types.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const level = parseLevel(sandbox01);

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

const RESPAWN_TICKS = Math.ceil(RESPAWN_SECONDS / TICK_DT);

describe("death and respawn", () => {
  it("starts the respawn timer when health reaches zero", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    p.health = 0;
    tickWorld(w, new Map());
    expect(p.respawnTimer).toBeCloseTo(RESPAWN_SECONDS, 6);
    expect(isDead(p)).toBe(true);
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

  it("counts the timer down and respawns with full health at a spawn point", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map());
    p.pos = { x: 20, y: 0.9, z: -20 };
    p.health = 0;
    tickWorld(w, new Map());

    for (let i = 0; i < RESPAWN_TICKS - 2; i++) tickWorld(w, new Map());
    expect(p.health).toBe(0);
    expect(p.respawnTimer).toBeGreaterThan(0);

    // Step one tick at a time to the exact moment of respawn. Checking a few
    // ticks later instead would see gravity already applied to the velocity
    // this is meant to prove was zeroed.
    let ticksToRespawn = 0;
    while (p.health === 0 && ticksToRespawn < 10) {
      tickWorld(w, new Map());
      ticksToRespawn++;
    }
    expect(ticksToRespawn).toBeLessThan(10);
    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    expect(p.respawnTimer).toBe(0);
    expect(isDead(p)).toBe(false);
    expect(w.level.playerSpawns.some((s) => s.x === p.pos.x && s.z === p.pos.z)).toBe(true);
    expect(p.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("moves again once respawned", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    p.health = 0;
    for (let i = 0; i < RESPAWN_TICKS + 4; i++) tickWorld(w, new Map());
    const before = p.pos.z;
    for (let i = 0; i < 120; i++) tickWorld(w, new Map([[p.id, input({ moveZ: 1 })]]));
    expect(p.pos.z).toBeGreaterThan(before + 1);
  });

  it("never respawns in a non-authoritative world, so a client cannot predict it", () => {
    const w = createWorld(level, 1, false);
    const p = spawnPlayer(w);
    p.health = 0;
    for (let i = 0; i < RESPAWN_TICKS * 2; i++) tickWorld(w, new Map());
    expect(p.respawnTimer).toBe(0);
    expect(p.health).toBe(0);
  });

  it("does not simulate enemies in a non-authoritative world", () => {
    const w = createWorld(level, 1, false);
    spawnPlayer(w);
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(w.state.enemies.size).toBe(0);
  });
});

describe("respawn in a generated forest", () => {
  it("places the player near where they died, not back at the origin", () => {
    // The whole point of tracking deathPos. In an unbounded world, respawning at
    // a fixed point could be a two-minute walk back through cleared ground.
    const forest = createForest(0xdead);
    const w = createForestWorld(forest);
    const p = spawnPlayer(w);
    p.pos = { x: 220, y: 40, z: -180 };
    const diedAt = { ...p.pos };
    p.health = 0;

    for (let i = 0; i < RESPAWN_TICKS + 4 && p.health === 0; i++) tickWorld(w, new Map());

    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    const d = Math.sqrt((p.pos.x - diedAt.x) ** 2 + (p.pos.z - diedAt.z) ** 2);
    // Offset, not in place: RESPAWN_SECONDS is 3 and ENEMY_ATTACK_COOLDOWN is
    // 1.2, so whatever killed you is still standing there ready to swing.
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(40);
  });

  it("does not respawn inside geometry", () => {
    const forest = createForest(0xbeef);
    const w = createForestWorld(forest);
    const p = spawnPlayer(w);
    p.pos = { x: -90, y: 20, z: 55 };
    p.health = 0;
    for (let i = 0; i < RESPAWN_TICKS + 4 && p.health === 0; i++) tickWorld(w, new Map());

    const fixed = depenetrate(p.pos, PLAYER_HALF, w.boxes);
    expect(Math.abs(fixed.x - p.pos.x)).toBeLessThan(1e-9);
    expect(Math.abs(fixed.y - p.pos.y)).toBeLessThan(1e-9);
    expect(Math.abs(fixed.z - p.pos.z)).toBeLessThan(1e-9);
  });

  it("clears deathPos after respawning", () => {
    const w = createForestWorld(createForest(0xfeed));
    const p = spawnPlayer(w);
    p.pos = { x: 12, y: 20, z: 12 };
    p.health = 0;
    tickWorld(w, new Map());
    expect(p.deathPos).not.toBeNull();
    for (let i = 0; i < RESPAWN_TICKS + 4 && p.health === 0; i++) tickWorld(w, new Map());
    expect(p.deathPos).toBeNull();
  });

  it("spawns a joining player on valid ground", () => {
    const w = createForestWorld(createForest(0xc0ffee));
    const p = spawnPlayer(w);
    const fixed = depenetrate(p.pos, PLAYER_HALF, w.boxes);
    expect(Math.abs(fixed.y - p.pos.y)).toBeLessThan(1e-9);
  });
});

/**
 * Generated worlds ship with `maxEnemies` at 0, because straight-line chase
 * is broken by construction on montane ground. `ai.test.ts` covers that
 * default. This case raises the ceiling explicitly to prove that what holds a
 * generated world at zero enemies is `targetPopulation` (the director
 * switched off), not the ceiling. Restoring enemies later is the director's
 * job, not a configuration change.
 */
describe("the director in a generated forest", () => {
  it("spawns nothing even with the ceiling raised, while the director is off", () => {
    const w = createForestWorld(createForest(0x5eed1));
    w.maxEnemies = ENEMY_POPULATION_CAP;
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: elevationAt(0x5eed1, 0, 0) + PLAYER_HALF.y, z: 0 };

    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(w.state.enemies.size).toBe(0);
  });
});
