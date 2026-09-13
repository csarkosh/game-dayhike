import { describe, it, expect } from "vitest";
import { hasLineOfSight, acquireTarget, stepEnemy } from "../../src/sim/ai.js";
import { spawnEnemy, updateDirector, targetPopulation } from "../../src/sim/director.js";
import { createForestWorld, createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { parseLevel } from "../../src/sim/level.js";
import { AiState } from "../../src/sim/types.js";
import {
  TICK_DT,
  ENEMY_CORPSE_SECONDS,
  ENEMY_MAX_HEALTH,
  PLAYER_MAX_HEALTH,
} from "../../src/sim/constants.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const level = parseLevel(sandbox01);

/**
 * Open ground, nothing but a floor. The state-machine and acquisition tests
 * below are about AI behaviour, so they must not be run against sandbox01:
 * it has a solid 12x12x2 platform centred on the origin and a wall at z=20,
 * which puts an entity placed at (0, 0.9, 0) *inside* geometry and blocks
 * every sightline across the middle of the map. Sightlines through real level
 * brushes are covered separately at the bottom of this file.
 */
const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
  playerSpawns: [[0, 1, 0]],
  enemySpawns: [[40, 0.9, 40]],
});

describe("hasLineOfSight", () => {
  it("sees through open air", () => {
    const boxes = [{ min: { x: 40, y: 0, z: 40 }, max: { x: 41, y: 3, z: 41 } }];
    expect(hasLineOfSight({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, boxes)).toBe(true);
  });

  it("is blocked by a wall between the two points", () => {
    const boxes = [{ min: { x: -5, y: 0, z: 4 }, max: { x: 5, y: 4, z: 5 } }];
    expect(hasLineOfSight({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, boxes)).toBe(false);
  });

  it("is not blocked by a wall beyond the target", () => {
    const boxes = [{ min: { x: -5, y: 0, z: 20 }, max: { x: 5, y: 4, z: 21 } }];
    expect(hasLineOfSight({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, boxes)).toBe(true);
  });
});

describe("target acquisition", () => {
  it("finds a nearby visible player", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 1, z: 0 };
    const e = spawnEnemy(w, { x: 0, y: 1, z: 8 });
    expect(acquireTarget(e, w)).toBe(p.id);
  });

  it("ignores a player beyond detection range", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 1, z: 0 };
    const e = spawnEnemy(w, { x: 0, y: 1, z: 200 });
    expect(acquireTarget(e, w)).toBe(0);
  });

  it("picks the nearest of two players", () => {
    const w = createWorld(flat, 1);
    const near = spawnPlayer(w);
    const far = spawnPlayer(w);
    near.pos = { x: 0, y: 1, z: 5 };
    far.pos = { x: 0, y: 1, z: 20 };
    const e = spawnEnemy(w, { x: 0, y: 1, z: 0 });
    expect(acquireTarget(e, w)).toBe(near.id);
  });

  it("ignores dead players", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 1, z: 5 };
    p.health = 0;
    const e = spawnEnemy(w, { x: 0, y: 1, z: 0 });
    expect(acquireTarget(e, w)).toBe(0);
  });
});

describe("enemy state machine", () => {
  it("switches from idle to chase when a player appears", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 1, z: 5 };
    const e = spawnEnemy(w, { x: 0, y: 1, z: 0 });
    expect(e.ai).toBe(AiState.Idle);
    stepEnemy(e, w, TICK_DT);
    expect(e.ai).toBe(AiState.Chase);
    expect(e.targetId).toBe(p.id);
  });

  it("closes distance while chasing", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 };
    const e = spawnEnemy(w, { x: 0, y: 0.9, z: 20 });
    const before = Math.abs(e.pos.z - p.pos.z);
    for (let i = 0; i < 120; i++) stepEnemy(e, w, TICK_DT);
    // Assert the state too. Without it this passes on a level where the enemy
    // never acquires a target at all, because depenetration alone nudges it a
    // few centimetres and "distance decreased" is satisfied.
    expect(e.ai).not.toBe(AiState.Idle);
    expect(e.targetId).toBe(p.id);
    expect(Math.abs(e.pos.z - p.pos.z)).toBeLessThan(before - 1);
  });

  it("enters attack range and damages the player", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 };
    const e = spawnEnemy(w, { x: 0, y: 0.9, z: 3 });
    for (let i = 0; i < 300; i++) stepEnemy(e, w, TICK_DT);
    expect(p.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });

  it("returns to idle when the target disappears", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 5 };
    const e = spawnEnemy(w, { x: 0, y: 0.9, z: 0 });
    stepEnemy(e, w, TICK_DT);
    expect(e.ai).toBe(AiState.Chase);
    w.state.players.delete(p.id);
    for (let i = 0; i < 300; i++) stepEnemy(e, w, TICK_DT);
    expect(e.ai).toBe(AiState.Idle);
  });

  it("stays dead once killed and stops moving", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 5 };
    const e = spawnEnemy(w, { x: 0, y: 0.9, z: 0 });
    e.health = 0;
    e.ai = AiState.Dead;
    const pos = { ...e.pos };
    for (let i = 0; i < 60; i++) stepEnemy(e, w, TICK_DT);
    expect(e.ai).toBe(AiState.Dead);
    expect(e.pos.x).toBeCloseTo(pos.x, 6);
    expect(e.pos.z).toBeCloseTo(pos.z, 6);
  });

  it("removes a corpse from the world once it expires", () => {
    const w = createWorld(flat, 1);
    spawnPlayer(w);
    const e = spawnEnemy(w, { x: 0, y: 0.9, z: 5 });
    const id = e.id;
    e.health = 0;
    e.ai = AiState.Dead;
    e.stateTimer = 0;

    const corpseTicks = Math.ceil(ENEMY_CORPSE_SECONDS / TICK_DT);
    for (let i = 0; i < corpseTicks - 2; i++) tickWorld(w, new Map());
    expect(w.state.enemies.has(id)).toBe(true);

    for (let i = 0; i < 4; i++) tickWorld(w, new Map());
    expect(w.state.enemies.has(id)).toBe(false);
  });
});

describe("spawn director", () => {
  it("wants no enemies at any player count while the director is off", () => {
    expect(targetPopulation(1)).toBe(0);
    expect(targetPopulation(2)).toBe(0);
    expect(targetPopulation(5)).toBe(0);
  });

  it("spawns enemies with full health", () => {
    const w = createWorld(level, 1);
    const e = spawnEnemy(w, { x: 0, y: 1, z: 0 });
    expect(e.health).toBe(ENEMY_MAX_HEALTH);
    expect(e.ai).toBe(AiState.Idle);
  });

  it("spawns nothing over time while the director is off", () => {
    const w = createWorld(level, 12345);
    spawnPlayer(w);
    for (let i = 0; i < 2000; i++) updateDirector(w);
    expect(w.state.enemies.size).toBe(0);
  });

  it("does nothing when there are no players", () => {
    const w = createWorld(level, 12345);
    for (let i = 0; i < 500; i++) updateDirector(w);
    expect(w.state.enemies.size).toBe(0);
  });

  it("spawns no enemies on generated terrain while they are disabled", () => {
    // Straight-line chase assumed sparse convex obstacles on walkable
    // ground; both premises are gone. The director's ceiling is configuration,
    // so restoring enemies later is one number, not an excavation.
    const w = createForestWorld(createForest(0xbeef));
    spawnPlayer(w);
    for (let i = 0; i < 500; i++) updateDirector(w);
    expect(w.state.enemies.size).toBe(0);
  });

  it("never spawns on top of a player", () => {
    const w = createWorld(level, 999);
    const p = spawnPlayer(w);
    p.pos = { x: 24, y: 1, z: 24 }; // sitting exactly on a spawn point
    for (let i = 0; i < 2000; i++) updateDirector(w);
    for (const e of w.state.enemies.values()) {
      const d = Math.sqrt((e.pos.x - p.pos.x) ** 2 + (e.pos.z - p.pos.z) ** 2);
      expect(d).toBeGreaterThan(1);
    }
  });

  // The behaviour tests above run on open ground so they measure the state
  // machine. This one runs on the shipped level, so real brushes are proven to
  // break a sightline that is otherwise well inside detection range.
  it("does not acquire a target through a sandbox01 pillar", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    // The pillar spans x 8..10, z -16..-14, up to y=3.
    p.pos = { x: 9, y: 0.9, z: -20 };
    const e = spawnEnemy(w, { x: 9, y: 0.9, z: -10 });
    expect(acquireTarget(e, w)).toBe(0);

    // Step aside and the same player becomes visible at the same range.
    p.pos = { x: 2, y: 0.9, z: -20 };
    e.pos = { x: 2, y: 0.9, z: -10 };
    expect(acquireTarget(e, w)).toBe(p.id);
  });

  it("keeps the world deterministic with enemies active", () => {
    const build = () => {
      const w = createWorld(level, 555);
      spawnPlayer(w);
      for (let t = 0; t < 400; t++) tickWorld(w, new Map());
      return w;
    };
    const a = build();
    const b = build();
    expect(a.state.enemies.size).toBe(b.state.enemies.size);
    const ids = [...a.state.enemies.keys()];
    for (const id of ids) {
      expect(b.state.enemies.get(id)?.pos).toEqual(a.state.enemies.get(id)?.pos);
    }
  });
});

describe("unstick fallback", () => {
  /**
   * A wall between enemy and target, wide enough that straight-line chase pins the
   * enemy against it permanently. This is not a hypothetical: measured in a
   * generated forest, an enemy chasing a player who stands on a higher plateau
   * closes to the cliff base and then holds position for as long as you watch,
   * because the drop is 3 m against a 0.5 m step height.
   */
  const walled = parseLevel({
    id: "walled",
    brushes: [
      { min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" },
      { min: [-30, 0, 4], max: [30, 4, 5], material: "wall" },
    ],
    playerSpawns: [[0, 1, 12]],
    enemySpawns: [],
  });

  function pinnedEnemy() {
    const w = createWorld(walled, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 12 };
    const e = spawnEnemy(w, { x: 0, y: 0.9, z: 0 });
    e.ai = AiState.Chase;
    e.targetId = p.id;
    return { w, p, e };
  }

  it("engages after a sustained lack of progress", () => {
    const { w, e } = pinnedEnemy();
    let engaged = false;
    for (let i = 0; i < 300; i++) {
      stepEnemy(e, w, TICK_DT);
      if (e.unstickTimer > 0) engaged = true;
    }
    expect(engaged).toBe(true);
  });

  it("does not engage while the enemy is still closing", () => {
    // Same enemy, no wall. Steering sideways when the direct route works would
    // make every chase drunken.
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 20 };
    const e = spawnEnemy(w, { x: 0, y: 0.9, z: 0 });
    e.ai = AiState.Chase;
    e.targetId = p.id;

    for (let i = 0; i < 200; i++) {
      stepEnemy(e, w, TICK_DT);
      expect(e.unstickTimer).toBe(0);
    }
    expect(e.pos.z).toBeGreaterThan(5);
  });

  it("moves the enemy laterally instead of leaving it frozen", () => {
    const { w, e } = pinnedEnemy();
    // Let it reach the wall and settle.
    for (let i = 0; i < 120; i++) stepEnemy(e, w, TICK_DT);
    const settled = e.pos.x;
    for (let i = 0; i < 300; i++) stepEnemy(e, w, TICK_DT);
    expect(Math.abs(e.pos.x - settled)).toBeGreaterThan(1);
  });

  it("stays deterministic", () => {
    const a = pinnedEnemy();
    const b = pinnedEnemy();
    for (let i = 0; i < 400; i++) {
      stepEnemy(a.e, a.w, TICK_DT);
      stepEnemy(b.e, b.w, TICK_DT);
    }
    expect(a.e.pos).toEqual(b.e.pos);
    expect(a.e.unstickTimer).toBe(b.e.unstickTimer);
  });
});
