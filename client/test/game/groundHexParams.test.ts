import { describe, it, expect } from "vitest";
import {
  HEX_LATTICE, HEX_SHARPNESS, DETAIL_TILING, DETAIL_FADE, DETAIL_NORMAL, DETAIL_AO, DETAIL_AO_RANGE,
  MACRO_WAVE, MACRO_WEIGHT, MACRO_SLOPE, MACRO_LUSH, MACRO_DRY, TUFT_ALBEDO, HORIZON, HORIZON_MAX,
  HEX_SKEW, HEX_UNSKEW,
  latticeHash, hexTriangle, hexWeights, macroNoise, macroTint, horizonWeight,
} from "../../src/game/groundHexParams.js";

describe("constants are the spec's", () => {
  it("carries the spec values", () => {
    expect(HEX_LATTICE).toBe(1);
    expect(HEX_SHARPNESS).toBe(8);
    expect(DETAIL_TILING).toBe(1.0);
    expect(DETAIL_FADE).toEqual([8, 20]);
    expect(DETAIL_NORMAL).toBe(0.5);
    expect(DETAIL_AO).toBe(0.7);
    expect(DETAIL_AO_RANGE).toEqual([0.3, 0.7]);
    expect(MACRO_WAVE).toEqual([18, 6]);
    expect(MACRO_WEIGHT).toEqual([0.65, 0.35]);
    expect(MACRO_SLOPE).toBe(0.6);
    expect(MACRO_LUSH).toEqual({ r: 0.82, g: 1.06, b: 0.84 });
    expect(MACRO_DRY).toEqual({ r: 1.18, g: 0.98, b: 0.7 });
    expect(TUFT_ALBEDO).toEqual({ r: 0.18, g: 0.22, b: 0.11 });
    expect(HORIZON).toEqual([35, 90]);
    expect(HORIZON_MAX).toBe(0.5);
    expect(HEX_SKEW).toEqual([1, 0, -0.57735027, 1.15470054]);
    expect(HEX_UNSKEW).toEqual([1, 0, 0.5, 0.8660254]);
  });
});

describe("latticeHash", () => {
  it("is in [0, 1) and differs between neighbouring cells", () => {
    for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) {
      const h = latticeHash(i, j);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(Math.abs(h - latticeHash(i + 1, j))).toBeGreaterThan(0.01);
      expect(Math.abs(h - latticeHash(i, j + 1))).toBeGreaterThan(0.01);
    }
  });
});

describe("hex lattice", () => {
  it("barycentric weights are non-negative and sum to one everywhere; sharpened weights too", () => {
    for (let y = -3; y < 3; y += 0.093) for (let x = -3; x < 3; x += 0.097) {
      const t = hexTriangle(x, y);
      expect(t.w[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[0] + t.w[1] + t.w[2]).toBeCloseTo(1, 9);
      const s = hexWeights(t.w);
      expect(s[0] + s[1] + s[2]).toBeCloseTo(1, 9);
    }
  });
  it("the three vertices are distinct lattice points and the point lies in their triangle (both branches)", () => {
    // Test both the fx + fy < 1 branch (lower half) and fx + fy >= 1 branch (upper half).
    const testPoints = [
      { uv: [0.3, 0.2] as const, expectedFirstVertex: [0, 0] as const },
      { uv: [0.8, 0.8] as const, expectedFirstVertex: [1, 1] as const },
    ];
    for (const test of testPoints) {
      const t = hexTriangle(test.uv[0], test.uv[1]);
      const keys = new Set(t.v.map(([a, b]) => `${a},${b}`));
      expect(keys.size).toBe(3);
      // Reconstruct the skewed point from the vertices and weights.
      const sx = t.v[0][0] * t.w[0] + t.v[1][0] * t.w[1] + t.v[2][0] * t.w[2];
      const sy = t.v[0][1] * t.w[0] + t.v[1][1] * t.w[1] + t.v[2][1] * t.w[2];
      expect(sx).toBeCloseTo(t.skewed[0], 9);
      expect(sy).toBeCloseTo(t.skewed[1], 9);
      // Explicitly assert which branch this point falls into by checking the first vertex.
      expect(t.v[0]).toEqual(test.expectedFirstVertex);
    }
  });
  it("sharpening keeps two samples dominant: the smallest weight vanishes away from a vertex", () => {
    const s = hexWeights([0.5, 0.4, 0.1]);
    expect(s[2]).toBeLessThan(0.001);
    expect(s[0]).toBeGreaterThan(s[1]);
  });
});

describe("macroNoise and macroTint", () => {
  it("is bounded in [0, 1] and continuous", () => {
    let last = macroNoise(0, 37.3);
    for (let x = 0; x < 200; x += 0.1) {
      const v = macroNoise(x, 37.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - last)).toBeLessThan(0.05);
      last = v;
    }
  });
  it("varies across a meadow: not constant over 100 m", () => {
    let lo = 1, hi = 0;
    for (let x = 0; x < 100; x += 2) for (let z = 0; z < 100; z += 2) {
      const v = macroNoise(x, z);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeGreaterThan(0.4);
  });
  it("tint is exactly lush at 0 and dry at 1 on flat ground, and slope pushes toward dry", () => {
    expect(macroTint(0, 0)).toEqual(MACRO_LUSH);
    expect(macroTint(1, 0)).toEqual(MACRO_DRY);
    const flat = macroTint(0.3, 0);
    const steep = macroTint(0.3, 0.5);
    expect(steep.r).toBeGreaterThan(flat.r);
    expect(steep.b).toBeLessThan(flat.b);
  });
});

describe("horizonWeight", () => {
  it("is 0 inside HORIZON[0], HORIZON_MAX at and beyond HORIZON[1], smooth between", () => {
    expect(horizonWeight(10)).toBe(0);
    expect(horizonWeight(90)).toBeCloseTo(HORIZON_MAX, 10);
    expect(horizonWeight(200)).toBeCloseTo(HORIZON_MAX, 10);
    const mid = horizonWeight(62.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.3);
  });
});
