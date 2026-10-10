import { describe, expect, it } from "vitest";
import {
  LAKE_DIRECTIONS, quantile3, smin, smootherstepD, spineMetricInto, type LakeShape,
} from "../../src/sim/lakeShape.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { timeLimit } from "../helpers/timeLimit.js";

const metric = { v: 0, dx: 0, dz: 0 };

describe("the shore's small pieces", { timeout: timeLimit(10_000) }, () => {
  it("holds 64 unit directions 5.625° apart from +x toward +z", () => {
    expect(LAKE_DIRECTIONS).toHaveLength(64);
    expect(LAKE_DIRECTIONS[0]).toEqual([1, 0]);
    expect(LAKE_DIRECTIONS[16]).toEqual([0, 1]);
    expect(LAKE_DIRECTIONS[32]).toEqual([-1, 0]);
    expect(LAKE_DIRECTIONS[48]).toEqual([0, -1]);
    for (let k = 0; k < 64; k++) {
      const [x, z] = LAKE_DIRECTIONS[k]!;
      const [nx, nz] = LAKE_DIRECTIONS[(k + 1) % 64]!;
      expect(x * x + z * z, `k ${k}`).toBeCloseTo(1, 14);
      expect(x * nx + z * nz, `k ${k}`).toBeCloseTo(0.9951847266721969, 14);
      expect(x * nz - z * nx, `k ${k}`).toBeGreaterThan(0);
    }
  });

  it("takes the smooth minimum (a + b − √((a − b)² + k²)) / 2", () => {
    expect(smin(3, 3, 2)).toBe(2);
    expect(smin(0, 10, 0.3)).toBeCloseTo(-0.0022494939776844802, 15);
    expect(smin(10, 0, 0.3)).toBeCloseTo(-0.0022494939776844802, 15);
  });

  it("reads a three-point quantile table piecewise linearly", () => {
    expect(quantile3(0, 1.5, 2.2, 3)).toBe(1.5);
    expect(quantile3(0.25, 1.5, 2.2, 3)).toBeCloseTo(1.85, 14);
    expect(quantile3(0.5, 1.5, 2.2, 3)).toBeCloseTo(2.2, 14);
    expect(quantile3(0.75, 1.5, 2.2, 3)).toBeCloseTo(2.6, 14);
    expect(quantile3(1, 1.5, 2.2, 3)).toBe(3);
  });

  it("steps by the quintic smootherstep, flat at both ends", () => {
    expect(smootherstepD(0, 2, -1)).toEqual({ v: 0, d: 0 });
    expect(smootherstepD(0, 2, 3)).toEqual({ v: 1, d: 0 });
    expect(smootherstepD(0, 2, 1).v).toBeCloseTo(0.5, 15);
    expect(smootherstepD(0, 2, 1).d).toBeCloseTo(0.9375, 15);
  });
});

describe("the spine's metric", { timeout: timeLimit(10_000) }, () => {
  const stadium = stadiumShape({ cx: 0, cz: 10, halfLen: 10, w: 10 });

  it("is the distance to the spine over the half-width: 0 on it, 1 on the plain shore", () => {
    expect(spineMetricInto(metric, stadium, 7, 10)).toEqual({ v: 0.7, dx: 0.1, dz: 0 });
    const cap = spineMetricInto(metric, stadium, 6, 28);
    expect(cap.v).toBeCloseTo(1, 14);
    expect(cap.dx).toBeCloseTo(0.06, 14);
    expect(cap.dz).toBeCloseTo(0.08, 14);
    expect(spineMetricInto(metric, stadium, 0, 30).v).toBeCloseTo(1, 14);
  });

  it("runs the half-width between the points' widths by a smootherstep along the segment", () => {
    const egg: LakeShape = { ...stadium, width: [10, 20] };
    const m = spineMetricInto(metric, egg, 7.5, 10);
    expect(m.v).toBeCloseTo(0.5, 14);
    expect(m.dx).toBeCloseTo(0.06666666666666667, 14);
    expect(m.dz).toBeCloseTo(-0.03125, 14);
  });

  it("has no crease on the inside of a bend: the gradient is continuous across the inner bisector", () => {
    // A 45° bend at (0, 20), turning toward +x; its inner bisector leaves the
    // joint along (0.9238795325112867, −0.3826834323650898).
    const bent: LakeShape = { ...stadium, px: [0, 0, 14.142135623730951], pz: [0, 20, 34.14213562373095], width: [10, 10, 10] };
    const bx = 0.9238795325112867, bz = -0.3826834323650898;
    for (const along of [4, 8, 12]) {
      const x = bx * along, z = 20 + bz * along;
      const a = spineMetricInto({ v: 0, dx: 0, dz: 0 }, bent, x - 0.001 * bz, z + 0.001 * bx);
      const b = spineMetricInto({ v: 0, dx: 0, dz: 0 }, bent, x + 0.001 * bz, z - 0.001 * bx);
      expect(Math.abs(a.dx - b.dx), `along ${along}`).toBeLessThan(1e-3);
      expect(Math.abs(a.dz - b.dz), `along ${along}`).toBeLessThan(1e-3);
    }
  });

  it("returns its record, refilled", () => {
    const out = { v: 0, dx: 0, dz: 0 };
    expect(spineMetricInto(out, stadium, 3, 4)).toBe(out);
  });
});
