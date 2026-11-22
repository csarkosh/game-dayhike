import { describe, expect, it } from "vitest";
import { WET_PLANT_COUNT, WET_PLANT_DEVILS_CLUB, WET_PLANT_SKUNK_CABBAGE, wetPlantGeometry } from "../../src/game/wetPlantClump.js";

describe("wetPlantGeometry", () => {
  it("is a pure function of the variant and the level of detail, with whole arrays", () => {
    for (let variant = 0; variant < WET_PLANT_COUNT; variant++) {
      for (const lod of [0, 1]) {
        const g = wetPlantGeometry(variant, lod);
        expect(Array.from(g.positions)).toEqual(Array.from(wetPlantGeometry(variant, lod).positions));
        const verts = g.positions.length / 3;
        expect(verts).toBeGreaterThan(0);
        expect(g.normals.length).toBe(verts * 3);
        expect(g.colors.length).toBe(verts * 4);
        expect(g.indices.length % 3).toBe(0);
        for (const v of g.positions) expect(Number.isFinite(v)).toBe(true);
        for (const i of g.indices) expect(i).toBeLessThan(verts);
        for (let i = 0; i < verts; i++) {
          expect(Math.hypot(g.normals[i * 3]!, g.normals[i * 3 + 1]!, g.normals[i * 3 + 2]!)).toBeCloseTo(1, 4);
        }
      }
    }
  });

  it("stands a skunk cabbage knee to waist high and a devil's club head high, each lighter far than near", () => {
    const top = (variant: number, lod: number): number => {
      const g = wetPlantGeometry(variant, lod);
      let max = -Infinity, min = Infinity;
      for (let i = 1; i < g.positions.length; i += 3) {
        max = Math.max(max, g.positions[i]!);
        min = Math.min(min, g.positions[i]!);
      }
      expect(min).toBeGreaterThan(-0.1);
      return max;
    };
    expect(top(WET_PLANT_SKUNK_CABBAGE, 0)).toBeGreaterThan(0.45);
    expect(top(WET_PLANT_SKUNK_CABBAGE, 0)).toBeLessThan(1.2);
    expect(top(WET_PLANT_DEVILS_CLUB, 0)).toBeGreaterThan(1.1);
    expect(top(WET_PLANT_DEVILS_CLUB, 0)).toBeLessThan(2);
    for (let variant = 0; variant < WET_PLANT_COUNT; variant++) {
      expect(wetPlantGeometry(variant, 1).indices.length).toBeLessThan(wetPlantGeometry(variant, 0).indices.length * 0.6);
    }
  });
});
