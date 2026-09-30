import { describe, it, expect, beforeAll } from "vitest";
import "../../src/sim/olympic.js";
import { elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { BED_GRID, POND_DISC_MARGIN, createBedGrid, bedOriginFor, bedNeedsRebake, bakeBed, beginBake, bakeRows, bedSquareHasWater, bedOutsideSquare } from "../../src/game/bedHeight.js";

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

  it("bakes row by row into a spare grid and applies the origin only on the last call", () => {
    const grid = createBedGrid(128, 2);
    const bake = beginBake(grid, 300, -100);
    expect(bake).toEqual({ originX: bedOriginFor(300, 128, 2), originZ: bedOriginFor(-100, 128, 2), nextRow: 0 });
    expect(bakeRows(grid, SEED, bake, 50)).toBe(false);
    expect(bake.nextRow).toBe(50);
    expect(Number.isNaN(grid.originX)).toBe(true); // not applied yet
    expect(bakeRows(grid, SEED, bake, 50)).toBe(false);
    expect(bakeRows(grid, SEED, bake, 50)).toBe(true); // 28 rows left, clamped
    expect(bake.nextRow).toBe(128);
    expect(grid.originX).toBe(bake.originX);
    expect(grid.originZ).toBe(bake.originZ);
    for (const [ix, iz] of [[0, 0], [127, 127], [40, 99]] as const) {
      const x = grid.originX + (ix + 0.5) * 2;
      const z = grid.originZ + (iz + 0.5) * 2;
      expect(grid.heights[iz * 128 + ix]).toBeCloseTo(elevationAt(SEED, x, z), 4);
    }
  });

  it("an incremental bake equals a whole bake of the same camera", () => {
    const whole = createBedGrid(128, 2);
    bakeBed(whole, SEED, 300, -100);
    const inc = createBedGrid(128, 2);
    const bake = beginBake(inc, 300, -100);
    while (!bakeRows(inc, SEED, bake, 7)) { /* seven rows a step */ }
    expect(inc.originX).toBe(whole.originX);
    expect(inc.originZ).toBe(whole.originZ);
    expect(inc.heights).toEqual(whole.heights);
  });

  it("bakeRows after completion is a no-op that still reports done", () => {
    const grid = createBedGrid(128, 2);
    const bake = beginBake(grid, 0, 0);
    expect(bakeRows(grid, SEED, bake, 128)).toBe(true);
    const before = grid.heights.slice();
    expect(bakeRows(grid, SEED, bake, 10)).toBe(true);
    expect(grid.heights).toEqual(before);
  });

  it("says the camera has left a square only outside the whole of it, not its inner half", () => {
    // 128 texels at 2 m from (320, -128): the square [320, 576) x [-128, 128), inner half [384, 512) x [-64, 64)
    const out = (x: number, z: number): boolean => bedOutsideSquare(320, -128, 128, 2, x, z);
    const grid = { ...createBedGrid(128, 2), originX: 320, originZ: -128 };
    // past the inner half, inside the square: a rebake is due, but the square still holds the camera
    expect(bedNeedsRebake(grid, 540, 0)).toBe(true);
    expect(out(540, 0)).toBe(false);
    expect(out(320, -128)).toBe(false); // the min corner is inside
    expect(out(575.9, 127.9)).toBe(false);
    // outside on either axis
    expect(out(576, 0)).toBe(true); // the max edge is outside
    expect(out(319.9, 0)).toBe(true);
    expect(out(400, 128)).toBe(true);
    expect(out(400, -128.1)).toBe(true);
    expect(out(800, 0)).toBe(true);
  });

  describe("whether a body can reach a square (bedSquareHasWater)", () => {
    const grid = createBedGrid(256, 1);
    const bake = beginBake(grid, 1000, -600); // the square [x0, x0 + 256) x [z0, z0 + 256)
    const x0 = bake.originX;
    const z0 = bake.originZ;
    // read in the tests, after beforeAll has set the terrain variant
    const lowestOfNine = (): number => {
      const nine: number[] = [];
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) nine.push(elevationAt(SEED, x0 + i * 128, z0 + j * 128));
      return Math.min(...nine);
    };

    it("the sea reaches it when the ground at one of its nine points (corners, edge midpoints, centre) is below the level", () => {
      const lowest = lowestOfNine();
      expect(bedSquareHasWater(bake, grid, [], lowest + 0.01, SEED)).toBe(true);
      expect(bedSquareHasWater(bake, grid, [], lowest - 0.01, SEED)).toBe(false);
    });

    it("a pond reaches it when its disc overlaps the square, its centre inside or out", () => {
      const dry = lowestOfNine() - 1;
      const r = 20;
      // centre inside
      expect(bedSquareHasWater(bake, grid, [{ x: x0 + 100, z: z0 + 100, radius: r }], dry, SEED)).toBe(true);
      // centre outside, west of the square, the disc reaching in
      expect(bedSquareHasWater(bake, grid, [{ x: x0 - r, z: z0 + 50, radius: r }], dry, SEED)).toBe(true);
      expect(bedSquareHasWater(bake, grid, [{ x: x0 - r - POND_DISC_MARGIN + 0.01, z: z0 + 50, radius: r }], dry, SEED)).toBe(true);
      // just out of reach, past a corner on the diagonal
      const d = (r + POND_DISC_MARGIN + 0.5) / Math.SQRT2;
      expect(bedSquareHasWater(bake, grid, [{ x: x0 + 256 + d, z: z0 + 256 + d, radius: r }], dry, SEED)).toBe(false);
      expect(bedSquareHasWater(bake, grid, [{ x: x0 - r - POND_DISC_MARGIN - 0.5, z: z0 + 50, radius: r }], dry, SEED)).toBe(false);
    });
  });
});
