import { describe, it, expect } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  createWaterRingSamples, updateWaterRingSamples, waterHoleCellsFor,
  waterRingGeometry, waterRingSpacing,
  WATER_RING_CELLS, WATER_RING_COUNT,
} from "../../src/game/water.js";
import { RING_CELLS } from "../../src/game/clipmap.js";

const SEED = 0x5eed;
setActiveTerrainVariant("olympic");

describe("water rings", () => {
  it("keeps the same cell count as the terrain clipmap", () => {
    // The borrowed `snapOrigin` centres rings using clipmap's RING_CELLS, so
    // if the two counts ever diverge, water rings silently miscentre.
    expect(WATER_RING_CELLS).toBe(RING_CELLS);
  });

  it("doubles spacing per level and spans at least 8 km", () => {
    expect(waterRingSpacing(0)).toBe(8);
    expect(waterRingSpacing(WATER_RING_COUNT - 1) * WATER_RING_CELLS).toBeGreaterThanOrEqual(8000);
  });

  it("scroll equals fresh build", () => {
    const scrolled = createWaterRingSamples(SEED, 0, 0, 0);
    updateWaterRingSamples(scrolled, SEED, 100, -60);
    const fresh = createWaterRingSamples(SEED, 0, 100, -60);
    expect(scrolled.originX).toBe(fresh.originX);
    expect(scrolled.originZ).toBe(fresh.originZ);
    expect(Array.from(scrolled.h)).toEqual(Array.from(fresh.h));
  }, timeLimit(30_000));

  it("returns false when the snapped origin has not moved", () => {
    const ring = createWaterRingSamples(SEED, 2, 0, 0);
    expect(updateWaterRingSamples(ring, SEED, 3, 3)).toBe(false); // level-2 snap step is 64 m
  });

  it("cuts a hole exactly where the finer ring sits", () => {
    const fine = createWaterRingSamples(SEED, 0, -500, 0);
    const coarse = createWaterRingSamples(SEED, 1, -500, 0);
    const hole = waterHoleCellsFor(coarse, fine);
    const g = waterRingGeometry(coarse, hole, 0);
    const cells = WATER_RING_CELLS * WATER_RING_CELLS - (WATER_RING_CELLS / 2) * (WATER_RING_CELLS / 2);
    expect(g.indices.length).toBe(cells * 6);
  });

  it("puts every vertex at the water level with an up normal and a UV", () => {
    const ring = createWaterRingSamples(SEED, 0, -500, 0);
    const g = waterRingGeometry(ring, null, 0);
    expect(g.positions[1]).toBe(0);
    expect(g.normals.slice(0, 3)).toEqual(new Float32Array([0, 1, 0]));
    expect(g.uvs.length * 3).toBe(g.positions.length * 2);
  });

  it("writes the bed depth per vertex, clamped at zero on land", () => {
    const ring = createWaterRingSamples(SEED, 0, 0, 0);
    const g = waterRingGeometry(ring, null, 10);
    expect(g.bedDepth.length).toBe(g.positions.length / 3);
    expect((g as unknown as { colors?: unknown }).colors).toBeUndefined();
    for (let i = 0; i < g.bedDepth.length; i++) {
      const expected = Math.max(0, 10 - (ring.h[i] as number));
      expect(g.bedDepth[i]).toBeCloseTo(expected, 5);
    }
  });
});
