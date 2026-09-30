import { describe, it, expect, beforeAll } from "vitest";
import "../../src/sim/olympic.js";
import { elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { BED_GRID, createBedGrid, bedOriginFor, bedNeedsRebake, bakeBed } from "../../src/game/bedHeight.js";

const SEED = 0x5eed;
beforeAll(() => setActiveTerrainVariant("olympic"));

describe("bed height grid", () => {
  it("has the spec's sizes per tier", () => {
    expect(BED_GRID.high).toEqual({ texels: 256, spacing: 1 });
    expect(BED_GRID.medium).toEqual({ texels: 256, spacing: 1 });
    expect(BED_GRID.low).toEqual({ texels: 128, spacing: 2 });
  });

  it("centres the grid on the camera, snapped to a quarter of its extent", () => {
    // 256 texels at 1 m: extent 256, snap step 64, origin = cam − 128 rounded down to 64
    expect(bedOriginFor(0, 256, 1)).toBe(-128);
    expect(bedOriginFor(63.9, 256, 1)).toBe(-128);
    expect(bedOriginFor(64, 256, 1)).toBe(-64);
    expect(bedOriginFor(-1, 128, 2)).toBe(-192);
  });

  it("bakes every texel equal to elevationAt at the texel's centre", { timeout: 15000 }, () => {
    const grid = createBedGrid(256, 1);
    expect(bakeBed(grid, SEED, 10, -20)).toBe(true);
    for (const [ix, iz] of [[0, 0], [255, 255], [17, 200], [128, 128]] as const) {
      const x = grid.originX + (ix + 0.5) * grid.spacing;
      const z = grid.originZ + (iz + 0.5) * grid.spacing;
      expect(grid.heights[iz * 256 + ix]).toBeCloseTo(elevationAt(SEED, x, z), 4);
    }
  });

  it("does not rebake until the camera leaves the inner half", () => {
    const grid = createBedGrid(256, 1);
    bakeBed(grid, SEED, 0, 0);
    const before = grid.heights.slice();
    expect(bedNeedsRebake(grid, 30, -30)).toBe(false);
    expect(bakeBed(grid, SEED, 30, -30)).toBe(false);
    expect(grid.heights).toEqual(before);
    expect(bedNeedsRebake(grid, 70, 0)).toBe(true);
    expect(bakeBed(grid, SEED, 70, 0)).toBe(true);
    expect(grid.originX).toBe(bedOriginFor(70, 256, 1));
  });

  it("rebake changes origin and heights together, never one without the other", () => {
    const grid = createBedGrid(128, 2);
    bakeBed(grid, SEED, 0, 0);
    const o = [grid.originX, grid.originZ];
    bakeBed(grid, SEED, 500, 500);
    expect([grid.originX, grid.originZ]).not.toEqual(o);
    const x = grid.originX + 0.5 * grid.spacing;
    const z = grid.originZ + 0.5 * grid.spacing;
    expect(grid.heights[0]).toBeCloseTo(elevationAt(SEED, x, z), 4);
  });
});
