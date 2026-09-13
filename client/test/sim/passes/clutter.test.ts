import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { generateChunk, registeredPasses } from "../../../src/sim/chunk.js";
import { CHUNK_SIZE } from "../../../src/sim/forestConstants.js";
import { clutterInRect, CLUTTER_BOULDER } from "../../../src/sim/clutter.js";
import {
  BOULDER_A_BASE_HALF,
  BOULDER_A_BASE_H,
  BOULDER_B_BASE_HALF,
  BOULDER_B_BASE_H,
  BOULDER_SINK,
} from "../../../src/sim/passes/clutter.js";
import { createForest } from "../../../src/sim/forest.js";
import { createGroundField } from "../../../src/sim/ground.js";
import { stepMovement } from "../../../src/sim/movement.js";
import { PLAYER_HALF, PLAYER_EYE_OFFSET } from "../../../src/sim/constants.js";
import { elevationAt } from "../../../src/sim/terrain.js";
import { CLUTTER_BOULDER_SCALE_MAX } from "../../../src/sim/clutter.js";

const SEED = 0x5eed;

/** Deterministic scan for a chunk holding at least one boulder. */
function findBoulderChunk(): { cx: number; cz: number } {
  for (let cz = -64; cz < 64; cz++) {
    for (let cx = -64; cx < 64; cx++) {
      const hits = clutterInRect(SEED, CLUTTER_BOULDER, cx * CHUNK_SIZE, cz * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE);
      if (hits.length > 0) return { cx, cz };
    }
  }
  throw new Error("no boulder found in the scan window — density collapsed");
}

describe("clutter pass", () => {
  it("registers as pass id 7 named clutter, tunables declared", () => {
    const pass = registeredPasses().find((p) => p.id === 7);
    expect(pass).toBeDefined();
    expect(pass!.name).toBe("clutter");
    expect(pass!.tunables.CLUTTER_BOULDER_D).toBeTypeOf("number");
    expect(pass!.tunables.BOULDER_A_BASE_HALF).toBe(BOULDER_A_BASE_HALF);
    expect(pass!.tunables.BOULDER_B_BASE_HALF).toBe(BOULDER_B_BASE_HALF);
  });

  it("emits one rock brush per boulder, clamped to the chunk footprint", () => {
    const { cx, cz } = findBoulderChunk();
    const minX = cx * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE;
    const chunk = generateChunk(SEED, cx, cz);
    const boulders = clutterInRect(SEED, CLUTTER_BOULDER, minX, minZ, minX + CHUNK_SIZE, minZ + CHUNK_SIZE);
    const rocks = chunk.props.filter((p) => p.material === "rock");
    expect(rocks.length).toBe(boulders.length);
    for (const p of rocks) {
      expect(p.box.min.x).toBeGreaterThanOrEqual(minX);
      expect(p.box.max.x).toBeLessThanOrEqual(minX + CHUNK_SIZE);
      expect(p.box.min.z).toBeGreaterThanOrEqual(minZ);
      expect(p.box.max.z).toBeLessThanOrEqual(minZ + CHUNK_SIZE);
      expect(p.box.max.y).toBeGreaterThan(p.box.min.y);
    }
    // Box height matches the sunk-collider derivation for SOME boulder,
    // using THAT boulder's own variant constant.
    const b = boulders[0]!;
    const baseH = b.variant === 1 ? BOULDER_B_BASE_H : BOULDER_A_BASE_H;
    const expected = baseH * b.scale * (1 - BOULDER_SINK);
    expect(rocks.some((p) => Math.abs(p.box.max.y - p.box.min.y - expected) < 1e-9)).toBe(true);
  });

  it("stops a mover walking into a boulder (full provider path)", () => {
    const { cx, cz } = findBoulderChunk();
    const minX = cx * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE;
    const b = clutterInRect(SEED, CLUTTER_BOULDER, minX, minZ, minX + CHUNK_SIZE, minZ + CHUNK_SIZE)[0]!;
    const forest = createForest(SEED);
    const ground = createGroundField(SEED);
    // Start just west of the boulder, on the ground, and walk east through
    // it for two seconds of ticks. yaw 0 faces +Z (movement.ts), and moveZ —
    // not moveX — is the forward axis (wishDirection: at yaw 0, {x: moveX,
    // z: moveZ}). So facing +X (yaw = PI/2) with moveZ=1 walks straight down
    // +X, which is "east" from the boulder's west side.
    const half = (b.variant === 1 ? BOULDER_B_BASE_HALF : BOULDER_A_BASE_HALF) * b.scale;
    const startX = b.x - half - 1.5;
    const startZ = b.z;
    // Ground height at the *start* point, not the boulder's own groundH: the
    // boulder sits on a slope (the boulder gate requires one), so the
    // two routinely differ by more than a player's half-height. Starting from
    // the boulder's groundH left the mover embedded in or floating well above
    // its actual local terrain, and depenetrate()'s least-penetration push
    // resolved that overlap sideways before the walk even began.
    const startGround = elevationAt(SEED, startX, startZ);
    let state = {
      pos: { x: startX, y: startGround + PLAYER_HALF.y + 0.1, z: startZ },
      vel: { x: 0, y: 0, z: 0 },
      grounded: false,
    };
    for (let i = 0; i < 120; i++) {
      // The ground is the analytic field, not the grid: `forest.grid` carries
      // props only. Without it the mover has nothing to stand on, falls under
      // gravity, and sails past the boulder underneath it.
      state = stepMovement(state, { seq: i, moveX: 0, moveZ: 1, yaw: Math.PI / 2, pitch: 0, buttons: 0 }, 1 / 60, forest.grid, PLAYER_HALF, -Infinity, ground);
    }
    // Without the boulder the mover covers ~8 m; the box face is ~1.5 m away.
    expect(state.pos.x).toBeLessThan(b.x + half);
  });

  it("keeps each boulder collider inside its OWN mesh, and at least 55% of it", () => {
    // Measured extents of the shipped models, re-measured independently
    // via NodeIO getBounds() against the same GLBs, at scale 1:
    //   clutter.boulder_a (variant 0): 1.268 x 1.003 x 1.829 m
    //   clutter.boulder_b (variant 1): 2.516 x 1.890 x 2.480 m
    // Each variant's box is derived from ITS OWN
    // mesh only — no more shared worst case — so check each pair against its
    // own mesh, not the other variant's.
    const variants = [
      { mesh: { x: 1.268, y: 1.003, z: 1.829 }, half: BOULDER_A_BASE_HALF, h: BOULDER_A_BASE_H },
      { mesh: { x: 2.516, y: 1.89, z: 2.48 }, half: BOULDER_B_BASE_HALF, h: BOULDER_B_BASE_H },
    ];
    for (const { mesh, half, h } of variants) {
      const minXZ = Math.min(mesh.x, mesh.z);
      // Never claims ground outside its own silhouette...
      expect(half * 2).toBeLessThanOrEqual(minXZ + 1e-9);
      expect(h).toBeLessThanOrEqual(mesh.y + 1e-9);
      // ...and never so small it reads as walk-through: at least 55% of its
      // own mesh in both dimensions.
      expect(half * 2).toBeGreaterThan(0.55 * minXZ);
      expect(h).toBeGreaterThan(0.55 * mesh.y);
    }
  });

  it("clears a standing eye line for a variant-b boulder at the top of the scale range", () => {
    // Large boulders must read as real
    // cover, not just occupy floor space. Real constants, not a hardcoded
    // 1.6 — PLAYER_HALF.y (0.9) + PLAYER_EYE_OFFSET (0.7).
    const eyeHeight = PLAYER_HALF.y + PLAYER_EYE_OFFSET;
    const boxHeight = BOULDER_B_BASE_H * CLUTTER_BOULDER_SCALE_MAX * (1 - BOULDER_SINK);
    expect(boxHeight).toBeGreaterThan(eyeHeight);
  });
});
