import { bench, describe } from "vitest";
import "../../src/sim/passes/index.js";
import { depenetrate, raycast, sweepBox } from "../../src/sim/collision.js";
import type { Aabb } from "../../src/sim/level.js";
import { PLAYER_HALF } from "../../src/sim/constants.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";

/**
 * Deterministic pseudo-random field of 1 m boxes, so runs are comparable across
 * machines and across commits. Not the real generator — this measures the query
 * cost against N boxes, which is the thing a broadphase is meant to change.
 */
function grid(count: number): Aabb[] {
  const out: Aabb[] = [];
  let h = 0x811c9dc5;
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ i, 0x01000193);
    const x = ((h >>> 8) % 200) - 100;
    const z = ((h >>> 16) % 200) - 100;
    out.push({ min: { x, y: 0, z }, max: { x: x + 1, y: 1, z: z + 1 } });
  }
  return out;
}

const center = { x: 0, y: 2, z: 0 };
/** One tick of displacement at MAX_SPEED, plus a tick of gravity. */
const delta = { x: 0.117, y: -0.4, z: 0 };
const dir = { x: 0, y: 0, z: 1 };

for (const count of [100, 1000, 5000]) {
  describe(`${count} boxes`, () => {
    const boxes = grid(count);
    bench("sweepBox", () => {
      sweepBox(center, PLAYER_HALF, delta, boxes);
    });
    bench("depenetrate", () => {
      depenetrate(center, PLAYER_HALF, boxes);
    });
    bench("raycast 30m", () => {
      raycast(center, dir, 30, boxes);
    });
  });
}

/**
 * The comparison the broadphase exists for. A 5x5 chunk region holds 25,600
 * ground columns resident — five times the largest flat case above — and the
 * query cost should track the *small* flat cases, not the large ones, because a
 * moving hull only ever overlaps a handful of cells.
 */
describe("chunk grid, 25,600 columns resident", () => {
  const grid = createChunkGrid(0xbe4c4);
  grid.allBoxesIn(-2, -2, 2, 2);
  const onGround = { x: 4, y: 6, z: 4 };

  bench("sweepBox", () => {
    sweepBox(onGround, PLAYER_HALF, delta, grid);
  });
  bench("depenetrate", () => {
    depenetrate(onGround, PLAYER_HALF, grid);
  });
  bench("raycast 30m", () => {
    raycast(onGround, dir, 30, grid);
  });
});
