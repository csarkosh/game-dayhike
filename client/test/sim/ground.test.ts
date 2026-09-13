import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createGroundField, MAX_WALKABLE_GRADIENT, type GroundField } from "../../src/sim/ground.js";
import { raycastGround, raycastScene } from "../../src/sim/collision.js";
import { stepMovement, type MoveState } from "../../src/sim/movement.js";
import {
  DEFAULT_TERRAIN_VARIANT,
  elevationSampleAt,
  setActiveTerrainVariant,
} from "../../src/sim/terrain.js";
import {
  GROUND_NORMAL_Y,
  JUMP_SPEED,
  PLAYER_HALF,
  TICK_DT,
  SPRINT_SPEED,
} from "../../src/sim/constants.js";
import type { Aabb } from "../../src/sim/level.js";
import { Button, type InputCommand, type Vec3 } from "../../src/sim/types.js";

const SEED = 0xf0e57;

/**
 * An exact inclined plane h = a·x + b·z. Synthetic rather than sampled, so the
 * slope under test is stated rather than hunted for, and the expected answers
 * are arithmetic instead of "whatever the field happens to do there".
 */
function planeGround(a: number, b: number): GroundField {
  return {
    heightAt: (x, z) => a * x + b * z,
    normalAt: (_x, _z, out) => {
      const inv = 1 / Math.sqrt(1 + a * a + b * b);
      out.x = -a * inv;
      out.y = inv;
      out.z = -b * inv;
    },
  };
}

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

/** Drops a hull onto the ground and lets it settle. */
function settled(ground: GroundField, x: number, z: number): MoveState {
  let s: MoveState = {
    pos: { x, y: ground.heightAt(x, z) + PLAYER_HALF.y + 0.05, z },
    vel: { x: 0, y: 0, z: 0 },
    grounded: false,
  };
  for (let i = 0; i < 30; i++) {
    s = stepMovement(s, input(), TICK_DT, [], PLAYER_HALF, null, ground);
  }
  return s;
}

describe("createGroundField", () => {
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const ground = createGroundField(SEED);

  it("is the same surface the renderer samples", () => {
    for (const [x, z] of [
      [0, 0],
      [13.7, -41.2],
      [-500, 250],
    ]) {
      const s = elevationSampleAt(SEED, x as number, z as number);
      expect(ground.heightAt(x as number, z as number)).toBe(s.h);
    }
  });

  it("reports a unit normal built from the variant's exact gradient", () => {
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    for (const [x, z] of [
      [0, 0],
      [13.7, -41.2],
      [-500, 250],
    ]) {
      ground.normalAt(x as number, z as number, out);
      const length = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
      expect(Math.abs(length - 1)).toBeLessThan(1e-12);
      expect(out.y).toBeGreaterThan(0); // a height field never overhangs

      // The normal of y = h(x, z) is (-h_x, 1, -h_z) normalized.
      const s = elevationSampleAt(SEED, x as number, z as number);
      expect(Math.abs(out.x / out.y - -s.dx)).toBeLessThan(1e-12);
      expect(Math.abs(out.z / out.y - -s.dz)).toBeLessThan(1e-12);
    }
  });

  it("derives the walkable gradient from GROUND_NORMAL_Y rather than restating it", () => {
    // A plane at exactly MAX_WALKABLE_GRADIENT must sit exactly on the
    // threshold, which is what lets movement use the two interchangeably.
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    planeGround(MAX_WALKABLE_GRADIENT, 0).normalAt(0, 0, out);
    expect(Math.abs(out.y - GROUND_NORMAL_Y)).toBeLessThan(1e-12);
  });
});

describe("walking a synthetic slope", () => {
  it("stands on a walkable slope with its feet exactly on the surface", () => {
    const slope = MAX_WALKABLE_GRADIENT * 0.5;
    const ground = planeGround(slope, 0);
    const s = settled(ground, 3, -2);
    expect(s.grounded).toBe(true);
    expect(Math.abs(s.pos.y - PLAYER_HALF.y - ground.heightAt(s.pos.x, s.pos.z))).toBeLessThan(1e-9);
  });

  it("tracks the surface while walking across it, never leaving it", () => {
    const slope = MAX_WALKABLE_GRADIENT * 0.5;
    const ground = planeGround(slope, 0);
    let s = settled(ground, 0, 0);
    // yaw PI/2 with moveZ 1 walks along +x — straight up the fall line.
    for (let i = 0; i < 120; i++) {
      s = stepMovement(
        s,
        input({ moveZ: 1, yaw: Math.PI / 2, seq: i }),
        TICK_DT,
        [],
        PLAYER_HALF,
        null,
        ground,
      );
      expect(s.grounded).toBe(true);
      expect(Math.abs(s.pos.y - PLAYER_HALF.y - ground.heightAt(s.pos.x, s.pos.z))).toBeLessThan(
        1e-9,
      );
    }
    expect(s.pos.x).toBeGreaterThan(1); // it actually went somewhere
  });

  it("will not stand on ground steeper than GROUND_NORMAL_Y allows, and slides down it", () => {
    const ground = planeGround(MAX_WALKABLE_GRADIENT * 2, 0);
    let s = settled(ground, 0, 0);
    expect(s.grounded).toBe(false);

    const startX = s.pos.x;
    for (let i = 0; i < 60; i++) {
      s = stepMovement(s, input({ seq: i }), TICK_DT, [], PLAYER_HALF, null, ground);
    }
    // Height rises with x, so sliding downhill means travelling in -x.
    expect(s.pos.x).toBeLessThan(startX - 0.5);
    expect(s.grounded).toBe(false);
    // Still on the surface rather than sunk into it.
    expect(Math.abs(s.pos.y - PLAYER_HALF.y - ground.heightAt(s.pos.x, s.pos.z))).toBeLessThan(1e-9);
  });

  it("still jumps, and lands back on the surface", () => {
    const ground = planeGround(0, 0);
    const start = settled(ground, 0, 0);
    let s = stepMovement(start, input({ buttons: Button.Jump }), TICK_DT, [], PLAYER_HALF, null, ground);
    expect(s.grounded).toBe(false);
    expect(s.pos.y).toBeGreaterThan(start.pos.y);

    let peak = s.pos.y;
    for (let i = 0; i < 120 && !s.grounded; i++) {
      s = stepMovement(s, input({ seq: i }), TICK_DT, [], PLAYER_HALF, null, ground);
      peak = Math.max(peak, s.pos.y);
    }
    expect(s.grounded).toBe(true);
    expect(Math.abs(s.pos.y - start.pos.y)).toBeLessThan(1e-9);
    // A real arc, not a one-tick hop: JUMP_SPEED against GRAVITY clears a metre.
    expect(peak - start.pos.y).toBeGreaterThan(1);
  });

  it("does not stick to the ground when walking off a genuine ledge", () => {
    // A cliff: flat, then a sheer drop past anything the stick rule tolerates.
    const drop = 50;
    const ground: GroundField = {
      heightAt: (x) => (x < 0 ? 0 : -drop),
      // Flat on both sides; the discontinuity itself has no defined normal.
      normalAt: (_x, _z, out) => {
        out.x = 0;
        out.y = 1;
        out.z = 0;
      },
    };
    let s = settled(ground, -1, 0);
    expect(s.grounded).toBe(true);
    for (let i = 0; i < 60; i++) {
      s = stepMovement(
        s,
        input({ moveZ: 1, yaw: Math.PI / 2, seq: i }),
        TICK_DT,
        [],
        PLAYER_HALF,
        null,
        ground,
      );
      if (s.pos.x > 0.5) break;
    }
    expect(s.pos.x).toBeGreaterThan(0);
    expect(s.grounded).toBe(false);
    // Falling, not teleported to the lower surface.
    expect(s.pos.y).toBeGreaterThan(-drop);
    expect(s.vel.y).toBeLessThan(0);
  });

  it("keeps the ground-stick bound tight enough that walking speed cannot outrun it", () => {
    // The stick allowance is horizontal distance times MAX_WALKABLE_GRADIENT.
    // Measured at SPRINT_SPEED, the fastest anyone can cross ground: a few
    // centimetres per tick, so a ledge deeper than that is always a fall —
    // which is what the cliff case above relies on.
    const perTick = SPRINT_SPEED * TICK_DT * MAX_WALKABLE_GRADIENT;
    expect(perTick).toBeLessThan(0.2);
    expect(JUMP_SPEED * TICK_DT).toBeGreaterThan(perTick);
  });
});

describe("raycastGround", () => {
  const ground = planeGround(0, 0); // the plane y = 0

  it("finds the surface straight below", () => {
    const d = raycastGround({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100, ground);
    expect(d).not.toBeNull();
    expect(Math.abs((d as number) - 10)).toBeLessThan(1e-3);
  });

  it("misses when the ray never reaches the surface", () => {
    expect(raycastGround({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }, 100, ground)).toBeNull();
    // Parallel and above.
    expect(raycastGround({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, 100, ground)).toBeNull();
    // Pointing down but stopping short.
    expect(raycastGround({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 5, ground)).toBeNull();
  });

  it("reports zero when the origin is already underground", () => {
    expect(raycastGround({ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }, 100, ground)).toBe(0);
  });

  it("finds a sloped surface at the right distance", () => {
    // h = x, so a ray straight down from (4, 10) meets the surface at y = 4.
    const d = raycastGround({ x: 4, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100, planeGround(1, 0));
    expect(d).not.toBeNull();
    expect(Math.abs((d as number) - 6)).toBeLessThan(1e-3);
  });
});

describe("raycastScene", () => {
  const ground = planeGround(0, 0);
  const origin: Vec3 = { x: 0, y: 10, z: 0 };
  const down: Vec3 = { x: 0, y: -1, z: 0 };

  it("returns the nearer of prop and ground", () => {
    // A slab at y = 4, above the ground plane at y = 0.
    const slab: Aabb = { min: { x: -1, y: 3.5, z: -1 }, max: { x: 1, y: 4, z: 1 } };
    const d = raycastScene(origin, down, 100, [slab], ground);
    expect(d).not.toBeNull();
    expect(Math.abs((d as number) - 6)).toBeLessThan(1e-3);
  });

  it("falls through to the ground when no prop is in the way", () => {
    const d = raycastScene(origin, down, 100, [], ground);
    expect(Math.abs((d as number) - 10)).toBeLessThan(1e-3);
  });

  it("is the plain box raycast when there is no ground, as on authored levels", () => {
    expect(raycastScene(origin, down, 100, [], null)).toBeNull();
  });
});
