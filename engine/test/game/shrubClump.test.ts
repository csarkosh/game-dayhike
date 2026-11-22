import { describe, expect, it } from "vitest";
import { SHRUB_CHARACTERS, shrubGeometry } from "../../src/game/shrubClump.js";

describe("shrubGeometry", () => {
  it("is a pure function of the character and the level of detail", () => {
    for (let variant = 0; variant < SHRUB_CHARACTERS.length; variant++) {
      for (const lod of [0, 1]) {
        const a = shrubGeometry(variant, lod);
        const b = shrubGeometry(variant, lod);
        expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
        expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
      }
    }
  });

  it("has whole arrays, finite values, unit normals and indices in range", () => {
    for (let variant = 0; variant < SHRUB_CHARACTERS.length; variant++) {
      for (const lod of [0, 1]) {
        const g = shrubGeometry(variant, lod);
        const verts = g.positions.length / 3;
        expect(g.normals.length).toBe(verts * 3);
        expect(g.colors.length).toBe(verts * 4);
        expect(g.indices.length % 3).toBe(0);
        expect(verts).toBeLessThan(65536);
        for (const v of g.positions) expect(Number.isFinite(v)).toBe(true);
        for (const i of g.indices) expect(i).toBeLessThan(verts);
        for (let i = 0; i < verts; i++) {
          expect(Math.hypot(g.normals[i * 3]!, g.normals[i * 3 + 1]!, g.normals[i * 3 + 2]!)).toBeCloseTo(1, 4);
          expect(g.colors[i * 4 + 3]).toBe(1);
        }
      }
    }
  });

  it("stands on its origin, inside its mound, and is lighter far than near", () => {
    for (let variant = 0; variant < SHRUB_CHARACTERS.length; variant++) {
      const ch = SHRUB_CHARACTERS[variant]!;
      const near = shrubGeometry(variant, 0);
      const far = shrubGeometry(variant, 1);
      expect(far.indices.length).toBeLessThan(near.indices.length / 2);
      for (const g of [near, far]) {
        let minY = Infinity, maxY = -Infinity, maxR = 0;
        for (let i = 0; i < g.positions.length; i += 3) {
          minY = Math.min(minY, g.positions[i + 1]!);
          maxY = Math.max(maxY, g.positions[i + 1]!);
          maxR = Math.max(maxR, Math.hypot(g.positions[i]!, g.positions[i + 2]!));
        }
        // A leaf reaches its own length past the point it hangs from.
        const reach = ch.leaf[1] * 1.3;
        expect(minY).toBeGreaterThan(-reach);
        expect(maxY).toBeGreaterThan(ch.height * 0.7);
        expect(maxY).toBeLessThan(ch.height + reach);
        expect(maxR).toBeLessThan(ch.radius + reach);
      }
    }
  });
});
