import { describe, it, expect } from "vitest";
import {
  ROAD_LATTICE, ROAD_BED_HALF, ROAD_CORRIDOR_HALF,
  roadOffsetD, gradeSplineD, corridorD,
} from "../../src/sim/road.js";
import { olympicBaseSample, roadGradeAt } from "../../src/sim/olympic.js";
import { centerlineX, roadOffsetDAt } from "./helpers/roadLine.js";
import { DERIV_SEED as SEED } from "./helpers/derivatives.js";



describe("roadOffsetD", () => {
  it("keeps the corridor west edge at or inland of blendStart for extreme inputs", () => {
    // Worst case is the narrowest window (headland, blendEnd = 40) with the
    // wobble at any value: the (1 + 0.4·v) factor is positive for |v| ≤ 1, so
    // dr ≥ blendStart + ROAD_CORRIDOR_HALF structurally. Sweep 2000 z values.
    for (let i = 0; i < 2000; i++) {
      const z = i * 37.3 - 40000;
      const { dr } = roadOffsetD(SEED, z, 25, 40, 0);
      expect(dr - ROAD_CORRIDOR_HALF).toBeGreaterThanOrEqual(25);
    }
  });

  it("is deterministic: same inputs, identical bits", () => {
    const a = roadOffsetD(SEED, 12345.678, 25, 300, 0.01);
    const b = roadOffsetD(SEED, 12345.678, 25, 300, 0.01);
    expect(a).toEqual(b);
  });

  it("carries an exact analytic drDz (checked numerically)", () => {
    // blendEnd here is a linear function of z so blendEndDz is exact by hand.
    const H = 0.02;
    for (const z of [-9000.5, -13.2, 0.318, 777.7, 51234.9]) {
      const be = (zz: number) => 200 + 0.05 * zz;
      const at = (zz: number) => roadOffsetD(SEED, zz, 25, be(zz), 0.05);
      const numeric = (at(z + H).dr - at(z - H).dr) / (2 * H);
      expect(Math.abs(at(z).drDz - numeric)).toBeLessThan(1e-3);
    }
  });
});

describe("gradeSplineD", () => {
  it("reproduces constant lattice data exactly at every query", () => {
    const g = gradeSplineD(() => 42.5, 1234.567);
    expect(g.h).toBeCloseTo(42.5, 10);
    expect(g.dz).toBeCloseTo(0, 10);
  });

  it("reproduces linear lattice data (uniform cubic B-splines are linear-precise)", () => {
    const lat = (i: number) => 3 * i + 7;
    for (const z of [-800.25, -160, 0, 79.9, 160, 1000.01]) {
      const g = gradeSplineD(lat, z);
      expect(g.h).toBeCloseTo((3 * z) / ROAD_LATTICE + 7, 9);
      expect(g.dz).toBeCloseTo(3 / ROAD_LATTICE, 9);
    }
  });

  it("is C1 across lattice boundaries (numeric derivative continuity)", () => {
    // Irregular data; check value and slope agree from both sides of z = 320.
    const lat = (i: number) => Math.abs(((i * 2654435761) | 0) % 97);
    const H = 1e-4;
    const left = gradeSplineD(lat, 320 - H);
    const right = gradeSplineD(lat, 320 + H);
    expect(Math.abs(left.h - right.h)).toBeLessThan(1e-2);
    expect(Math.abs(left.dz - right.dz)).toBeLessThan(1e-2);
  });

  it("matches a numeric derivative of itself", () => {
    const lat = (i: number) => Math.abs(((i * 40503) | 0) % 89) * 1.7;
    const H = 0.02;
    for (const z of [-451.3, 3.14, 158.9, 161.1, 5000.5]) {
      const numeric = (gradeSplineD(lat, z + H).h - gradeSplineD(lat, z - H).h) / (2 * H);
      expect(Math.abs(gradeSplineD(lat, z).dz - numeric)).toBeLessThan(1e-4);
    }
  });
});

describe("corridorD", () => {
  const base = { h: 12.5, dx: 0.3, dz: -0.2 };
  const grade = { h: 20, dz: 0.05 };

  it("returns the base object untouched outside the corridor", () => {
    // toBe: the SAME object, which is the strongest possible bit-identity.
    expect(corridorD(ROAD_CORRIDOR_HALF, 0.1, grade, base)).toBe(base);
    expect(corridorD(-ROAD_CORRIDOR_HALF - 1, 0.1, grade, base)).toBe(base);
  });

  it("returns exactly the grade on the bed, flat across", () => {
    for (const u of [0, ROAD_BED_HALF, -ROAD_BED_HALF, 2.3]) {
      const s = corridorD(u, 0.1, grade, base);
      expect(s.h).toBe(20);
      expect(s.dx).toBe(0);
      expect(s.dz).toBe(0.05);
    }
  });

  it("is continuous at both window edges", () => {
    const e = 1e-6;
    const atBed = corridorD(ROAD_BED_HALF + e, 0, grade, base);
    expect(Math.abs(atBed.h - grade.h)).toBeLessThan(1e-3);
    const atEdge = corridorD(ROAD_CORRIDOR_HALF - e, 0, grade, base);
    expect(Math.abs(atEdge.h - base.h)).toBeLessThan(1e-3);
  });

  it("carries exact blend derivatives (checked numerically along u)", () => {
    // Vary u with uDz = 0 so ∂h/∂x is the pure window derivative; base is
    // held constant, which isolates the dW/du·(g − b.h) term.
    const H = 1e-4;
    for (const u of [6.1, 12.7, 22.2, -8.8, -29.1]) {
      const num =
        (corridorD(u + H, 0, grade, base).h - corridorD(u - H, 0, grade, base).h) / (2 * H);
      // ∂h/∂x = dW/du·(g − b.h) + (1 − w)·b.dx, and (1 − w) is recoverable
      // from the outputs as (s.h − g)/(b.h − g); subtracting its share of
      // b.dx isolates the window term the numeric derivative measures.
      const s = corridorD(u, 0, grade, base);
      const windowTerm = s.dx - ((s.h - grade.h) / (base.h - grade.h)) * base.dx;
      expect(Math.abs(windowTerm - num)).toBeLessThan(1e-3);
    }
  });
});

describe("road census — geometry-derived bounds, 30 km at 10 m", () => {
  // Bounds derive from the field's construction plus margin, NOT from any
  // single measured run: the 90 km re-probe (2026-08-26) measured max grade 7.0 %, max
  // |cut/fill| 24.2 m, min elevation ≥ 6 m; the bounds below are
  // those mechanisms' honest ceilings, not the probe re-encoded.
  it("holds grade, cut/fill, elevation and placement bounds", () => {
    const STEP = 10, N = 3000;
    let prevH: number | null = null, prevX = 0;
    for (let i = 0; i < N; i++) {
      const z = i * STEP - 15_000;
      const off = roadOffsetDAt(z); // helper shared with olympic.test.ts's tests
      const xr = centerlineX(z);
      const g = roadGradeAt(SEED, z);
      // placement: centerline coast distance within its structural window
      expect(off.dr).toBeGreaterThanOrEqual(55);
      expect(off.dr).toBeLessThanOrEqual(135);
      // elevation: the road never approaches the water
      expect(g.h).toBeGreaterThan(1);
      // cut/fill against the pre-road field at the centerline
      const base = olympicBaseSample(SEED, xr, z);
      expect(Math.abs(g.h - base.h)).toBeLessThan(30);
      // grade along the actual path (x meander included)
      if (prevH !== null) {
        const run = Math.sqrt((xr - prevX) * (xr - prevX) + STEP * STEP);
        expect(Math.abs(g.h - prevH) / run).toBeLessThan(0.12);
      }
      prevH = g.h; prevX = xr;
    }
  });
});
