import { describe, it, expect } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  createWaterRingSamples, updateWaterRingSamples, waterHoleCellsFor,
  waterRingGeometry, waterRingSpacing, wetBounds,
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

  describe("the box a ring's water can be drawn in (wetBounds)", () => {
    const SIDE = WATER_RING_CELLS + 1;

    it("is null for a ring with no wet vertex", () => {
      const ring = createWaterRingSamples(SEED, 1, 0, 0);
      ring.h.fill(50);
      expect(wetBounds(waterRingGeometry(ring, null, 0))).toBeNull();
    });

    it("is the box of the cells around the wet vertices, at the water level", () => {
      const ring = createWaterRingSamples(SEED, 0, 0, 0);
      ring.h.fill(50);
      // two wet vertices: (10, 20) and (30, 25)
      ring.h[20 * SIDE + 10] = -5;
      ring.h[25 * SIDE + 30] = -1;
      const b = wetBounds(waterRingGeometry(ring, null, 3))!;
      const s = ring.spacing;
      // each wet vertex's four cells draw water up to their dry corners
      expect(b.min).toEqual([ring.originX + 9 * s, 3, ring.originZ + 19 * s]);
      expect(b.max).toEqual([ring.originX + 31 * s, 3, ring.originZ + 26 * s]);
    });

    it("counts a vertex wet only when its depth is above zero, and a cell in the hole for nothing", () => {
      const fine = createWaterRingSamples(SEED, 0, 0, 0);
      const coarse = createWaterRingSamples(SEED, 1, 0, 0);
      const hole = waterHoleCellsFor(coarse, fine);
      coarse.h.fill(50);
      // exactly at the level: depth 0, dry
      coarse.h[10 * SIDE + 10] = 0;
      expect(wetBounds(waterRingGeometry(coarse, hole, 0))).toBeNull();
      // wet, but every cell around it is in the hole (not drawn)
      const inside = (hole.z0 + 5) * SIDE + hole.x0 + 5;
      coarse.h[inside] = -5;
      expect(wetBounds(waterRingGeometry(coarse, hole, 0))).toBeNull();
      expect(wetBounds(waterRingGeometry(coarse, null, 0))).not.toBeNull();
    });

    it("holds every wet vertex of a real ring and is no larger than the cells around them", () => {
      const ring = createWaterRingSamples(SEED, 1, -500, 0);
      const g = waterRingGeometry(ring, null, 0);
      const b = wetBounds(g)!;
      expect(b).not.toBeNull();
      let wet = 0;
      let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.bedDepth.length; i++) {
        if ((g.bedDepth[i] as number) <= 0) continue;
        wet++;
        const x = g.positions[i * 3] as number;
        const z = g.positions[i * 3 + 2] as number;
        [minX, minZ, maxX, maxZ] = [Math.min(minX, x), Math.min(minZ, z), Math.max(maxX, x), Math.max(maxZ, z)];
      }
      expect(wet).toBeGreaterThan(0);
      expect(wet).toBeLessThan(g.bedDepth.length); // a shore: some of it is land
      const s = ring.spacing;
      expect(b.min[0]).toBeLessThanOrEqual(minX);
      expect(b.min[0]).toBeGreaterThanOrEqual(minX - s);
      expect(b.min[2]).toBeLessThanOrEqual(minZ);
      expect(b.min[2]).toBeGreaterThanOrEqual(minZ - s);
      expect(b.max[0]).toBeGreaterThanOrEqual(maxX);
      expect(b.max[0]).toBeLessThanOrEqual(maxX + s);
      expect(b.max[2]).toBeGreaterThanOrEqual(maxZ);
      expect(b.max[2]).toBeLessThanOrEqual(maxZ + s);
    }, timeLimit(30_000));
  });
});
