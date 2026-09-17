import { describe, expect, it } from "vitest";
import {
  BLADE_CLUMP_RADIUS, BLADE_COUNT, BLADE_HEIGHT, BLADE_RINGS, BLADE_SOFT, BLADE_TRIS, BLADE_VERTS,
  bladeAlive, bladeClumpGeometry,
} from "../../src/game/bladeClump.js";

describe("the blade clump geometry", () => {
  const g = bladeClumpGeometry();
  const vertexCount = g.positions.length / 3;

  it("has 24 blades of 9 vertices and 7 triangles: 216 vertices, 168 triangles", () => {
    expect(BLADE_VERTS).toBe(BLADE_RINGS * 2 + 1);
    expect(BLADE_TRIS).toBe((BLADE_RINGS - 1) * 2 + 1);
    expect(vertexCount).toBe(BLADE_COUNT * BLADE_VERTS);
    expect(vertexCount).toBe(216);
    expect(g.indices.length).toBe(BLADE_COUNT * BLADE_TRIS * 3);
    expect(g.indices.length / 3).toBe(168);
    expect(g.normals.length).toBe(vertexCount * 3);
    expect(g.colors.length).toBe(vertexCount * 4);
    expect(g.blade.length).toBe(vertexCount * 4);
    for (const i of g.indices) expect(i).toBeLessThan(vertexCount);
  });

  it("roots every blade at y = 0 inside the clump radius, and the attribute carries that root", () => {
    for (let b = 0; b < BLADE_COUNT; b++) {
      const v0 = b * BLADE_VERTS;
      for (const v of [v0, v0 + 1]) {
        expect(g.positions[v * 3 + 1]).toBe(0);
        const rx = g.blade[v * 4]!, rz = g.blade[v * 4 + 1]!;
        expect(Math.hypot(rx, rz)).toBeLessThanOrEqual(BLADE_CLUMP_RADIUS + 1e-9);
        // The two root vertices straddle the root by the half-width. 9 decimal
        // places is unreachable here: root and position are independently
        // rounded to float32 at a magnitude up to BLADE_CLUMP_RADIUS (0.3), whose
        // ULP (~1.5-3e-8) alone exceeds a 9-digit tolerance (5e-10) before any
        // arithmetic runs; 6 digits (5e-7) keeps a >30x margin over the worst
        // case observed (see task-1-report.md for the measurement).
        expect(Math.hypot(g.positions[v * 3]! - rx, g.positions[v * 3 + 2]! - rz)).toBeCloseTo(0.02, 6);
      }
      // Every vertex of the blade names the same root.
      for (let v = v0; v < v0 + BLADE_VERTS; v++) {
        expect(g.blade[v * 4]).toBe(g.blade[v0 * 4]);
        expect(g.blade[v * 4 + 1]).toBe(g.blade[v0 * 4 + 1]);
        expect(g.blade[v * 4 + 2]).toBe(g.blade[v0 * 4 + 2]);
      }
    }
  });

  it("puts the tip at the blade's own height inside BLADE_HEIGHT, with the height fraction rising ring by ring", () => {
    const heights = new Set<number>();
    for (let b = 0; b < BLADE_COUNT; b++) {
      const v0 = b * BLADE_VERTS;
      const tip = v0 + BLADE_VERTS - 1;
      const h = g.positions[tip * 3 + 1]!;
      expect(h).toBeGreaterThanOrEqual(BLADE_HEIGHT[0]);
      expect(h).toBeLessThanOrEqual(BLADE_HEIGHT[1]);
      heights.add(Math.round(h * 1e6));
      for (let k = 0; k < BLADE_RINGS; k++) {
        expect(g.blade[(v0 + 2 * k) * 4 + 3]).toBeCloseTo(k / BLADE_RINGS, 9);
        expect(g.blade[(v0 + 2 * k + 1) * 4 + 3]).toBeCloseTo(k / BLADE_RINGS, 9);
      }
      expect(g.blade[tip * 4 + 3]).toBe(1);
      // The tip tapers to a point: the tip is one vertex, not a pair.
      expect(g.positions[tip * 3]).not.toBeNaN();
    }
    expect(heights.size).toBeGreaterThan(BLADE_COUNT / 2);
  });

  it("gives every blade a random in [0, 1), spread across the clump", () => {
    const randoms: number[] = [];
    for (let b = 0; b < BLADE_COUNT; b++) randoms.push(g.blade[b * BLADE_VERTS * 4 + 2]!);
    for (const r of randoms) { expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThan(1); }
    expect(Math.min(...randoms)).toBeLessThan(0.2);
    expect(Math.max(...randoms)).toBeGreaterThan(0.8);
  });

  it("has unit normals rolled to both sides of the strip", () => {
    for (let v = 0; v < vertexCount; v++) {
      const n = Math.hypot(g.normals[v * 3]!, g.normals[v * 3 + 1]!, g.normals[v * 3 + 2]!);
      expect(n).toBeCloseTo(1, 6);
    }
    // The two root vertices of a blade carry different normals (the roll).
    const dot = g.normals[0]! * g.normals[3]! + g.normals[1]! * g.normals[4]! + g.normals[2]! * g.normals[5]!;
    expect(dot).toBeLessThan(0.999);
    expect(dot).toBeGreaterThan(0);
  });

  it("tints the tip paler and yellower than the root, with a per-blade luma spread", () => {
    const rootB = g.colors.subarray(0, 4), tipB = g.colors.subarray((BLADE_VERTS - 1) * 4, BLADE_VERTS * 4);
    expect(tipB[2]! / tipB[0]!).toBeLessThan(rootB[2]! / rootB[0]!);
    expect(rootB[3]).toBe(1);
    const lumas = new Set<number>();
    for (let b = 0; b < BLADE_COUNT; b++) lumas.add(Math.round(g.colors[b * BLADE_VERTS * 4]! * 1e6));
    expect(lumas.size).toBeGreaterThan(BLADE_COUNT / 2);
  });

  it("is deterministic", () => {
    const h = bladeClumpGeometry();
    expect(Array.from(h.positions)).toEqual(Array.from(g.positions));
    expect(Array.from(h.blade)).toEqual(Array.from(g.blade));
  });
});

describe("bladeAlive, the mirror of the collapse", () => {
  it("keeps every blade whole at thin 0 and collapses every blade at thin 1", () => {
    for (const r of [0, 0.01, 0.5, 0.85, 0.999]) {
      expect(bladeAlive(r, 0)).toBe(1);
      expect(bladeAlive(r, 1)).toBe(0);
    }
  });
  it("is non-increasing in thin and later for a larger random", () => {
    for (const r of [0.2, 0.6]) {
      let prev = 1;
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const a = bladeAlive(r, t);
        expect(a).toBeLessThanOrEqual(prev + 1e-12);
        prev = a;
      }
    }
    expect(bladeAlive(0.6, 0.5)).toBeGreaterThan(bladeAlive(0.2, 0.5));
    // A blade begins to shrink at thin = random / (1 + BLADE_SOFT).
    expect(bladeAlive(0.5, 0.5 / (1 + BLADE_SOFT) - 1e-6)).toBe(1);
    expect(bladeAlive(0.5, 0.5 / (1 + BLADE_SOFT) + 1e-6)).toBeLessThan(1);
  });
});
