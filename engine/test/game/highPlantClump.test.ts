import { describe, expect, it } from "vitest";
import {
  HIGH_PLANT_BEARGRASS, HIGH_PLANT_COUNT, HIGH_PLANT_HEATHER, HIGH_PLANT_LUPINE, HIGH_PLANT_TUSSOCK, highPlantGeometry,
} from "../../src/game/highPlantClump.js";

function top(variant: number, lod: number): number {
  const g = highPlantGeometry(variant, lod);
  let max = -Infinity;
  for (let i = 1; i < g.positions.length; i += 3) max = Math.max(max, g.positions[i]!);
  return max;
}

describe("highPlantGeometry", () => {
  it("is a pure function of the variant and the level of detail, with whole arrays", () => {
    for (let variant = 0; variant < HIGH_PLANT_COUNT; variant++) {
      for (const lod of [0, 1]) {
        const g = highPlantGeometry(variant, lod);
        expect(Array.from(g.positions)).toEqual(Array.from(highPlantGeometry(variant, lod).positions));
        const verts = g.positions.length / 3;
        expect(verts).toBeGreaterThan(0);
        expect(g.normals.length).toBe(verts * 3);
        expect(g.colors.length).toBe(verts * 4);
        expect(g.indices.length % 3).toBe(0);
        for (const v of g.positions) expect(Number.isFinite(v)).toBe(true);
        for (const i of g.indices) expect(i).toBeLessThan(verts);
        for (let i = 0; i < verts; i++) {
          expect(Math.hypot(g.normals[i * 3]!, g.normals[i * 3 + 1]!, g.normals[i * 3 + 2]!)).toBeCloseTo(1, 4);
          expect(g.positions[i * 3 + 1]!).toBeGreaterThan(-0.05);
        }
        if (lod === 1) expect(g.indices.length).toBeLessThan(highPlantGeometry(variant, 0).indices.length * 0.7);
      }
    }
  });

  it("stands each plant at its own height: a heather mat a hand high, a flowering beargrass over a metre", () => {
    expect(top(HIGH_PLANT_HEATHER, 0)).toBeLessThan(0.35);
    expect(top(HIGH_PLANT_TUSSOCK, 0)).toBeLessThan(0.7);
    expect(top(HIGH_PLANT_LUPINE, 0)).toBeGreaterThan(0.4);
    expect(top(HIGH_PLANT_LUPINE, 0)).toBeLessThan(0.9);
    expect(top(HIGH_PLANT_BEARGRASS, 0)).toBeGreaterThan(1.1);
    // The flowering one is the tussock with a stalk: its leaves are the tussock's.
    const tussock = highPlantGeometry(HIGH_PLANT_TUSSOCK, 0);
    const flowering = highPlantGeometry(HIGH_PLANT_BEARGRASS, 0);
    expect(flowering.positions.length).toBeGreaterThan(tussock.positions.length);
  });

  it("colours the flowers: blue on the lupine, pink on the heather, pale on the beargrass", () => {
    const has = (variant: number, match: (r: number, g: number, b: number) => boolean): boolean => {
      const c = highPlantGeometry(variant, 0).colors;
      for (let i = 0; i < c.length; i += 4) if (match(c[i]!, c[i + 1]!, c[i + 2]!)) return true;
      return false;
    };
    expect(has(HIGH_PLANT_LUPINE, (r, g, b) => b > 2 * g && b > 2 * r)).toBe(true);
    expect(has(HIGH_PLANT_HEATHER, (r, g, b) => r > 2 * g && r > b)).toBe(true);
    expect(has(HIGH_PLANT_BEARGRASS, (r, g, b) => r > 0.25 && g > 0.25 && b > 0.2)).toBe(true);
    expect(has(HIGH_PLANT_TUSSOCK, (r, g, b) => r > 0.25 && g > 0.25 && b > 0.2)).toBe(false);
  });
});
