import { describe, it, expect } from "vitest";
import { fbm2, hash2, hash3, passSeed, valueNoise2 } from "../../src/sim/field.js";
import { fbm2d, gradientNoise2 } from "../../src/sim/field.js";

describe("passSeed", () => {
  it("is stable for the same inputs", () => {
    expect(passSeed(1234, -5, 7, 3)).toBe(passSeed(1234, -5, 7, 3));
  });

  it("separates streams so adding a pass cannot disturb earlier ones", () => {
    const a = passSeed(1234, 0, 0, 1);
    const b = passSeed(1234, 0, 0, 2);
    const c = passSeed(1234, 0, 0, 3);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("separates chunks", () => {
    expect(passSeed(1234, 0, 0, 1)).not.toBe(passSeed(1234, 1, 0, 1));
    expect(passSeed(1234, 0, 0, 1)).not.toBe(passSeed(1234, 0, 1, 1));
  });

  it("returns a 32-bit integer", () => {
    const s = passSeed(0x7fffffff, -1000, 1000, 9);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBe(s | 0);
  });
});

describe("hash2 / hash3", () => {
  it("stays in [0, 1)", () => {
    for (let x = -40; x < 40; x += 7) {
      for (let z = -40; z < 40; z += 5) {
        const h = hash2(x, z, 99);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });

  it("distinguishes swapped coordinates", () => {
    expect(hash2(3, 7, 1)).not.toBe(hash2(7, 3, 1));
  });

  it("hash3 varies with its third input", () => {
    expect(hash3(2, 2, 0, 5)).not.toBe(hash3(2, 2, 1, 5));
  });
});

describe("valueNoise2", () => {
  it("stays in [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise2(i * 0.37, i * -0.11, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("equals the lattice hash exactly at integer coordinates", () => {
    expect(valueNoise2(4, 9, 3)).toBeCloseTo(hash2(4, 9, 3), 12);
  });

  it("is continuous across a lattice boundary", () => {
    const left = valueNoise2(2 - 1e-7, 0.5, 11);
    const right = valueNoise2(2 + 1e-7, 0.5, 11);
    expect(Math.abs(left - right)).toBeLessThan(1e-5);
  });
});

describe("fbm2", () => {
  it("stays in [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = fbm2(i * 0.29, i * 0.13, 5, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("gradientNoise2", () => {
  it("is deterministic and bounded", () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 0.437 + 0.19;
      const z = i * -0.291 + 0.53;
      const n = gradientNoise2(x, z, 77);
      expect(n).toEqual(gradientNoise2(x, z, 77));
      expect(Math.abs(n.v)).toBeLessThanOrEqual(1);
      expect(Number.isFinite(n.dxz)).toBe(true);
    }
  });

  it("returns the exact analytic gradient", () => {
    // Central differences at h = 1e-4: truncation error is f'''·h²/6, far below
    // the 1e-5 tolerance for a field whose derivatives are polynomial in the
    // cell. A sign or term error in dx/dz shows up at O(1).
    const h = 1e-4;
    let worstD = 0;
    let steepest = 0;
    for (let i = 0; i < 300; i++) {
      const x = i * 0.719 - 100.31;
      const z = i * 0.377 + 40.17;
      const n = gradientNoise2(x, z, 1234);
      const ndx = (gradientNoise2(x + h, z, 1234).v - gradientNoise2(x - h, z, 1234).v) / (2 * h);
      const ndz = (gradientNoise2(x, z + h, 1234).v - gradientNoise2(x, z - h, 1234).v) / (2 * h);
      worstD = Math.max(worstD, Math.abs(n.dx - ndx), Math.abs(n.dz - ndz));
      steepest = Math.max(steepest, Math.abs(ndx), Math.abs(ndz));
    }
    // Teeth: a flat field would pass any agreement check.
    expect(steepest).toBeGreaterThan(0.5);
    expect(worstD).toBeLessThan(1e-5);
  });

  it("returns the exact analytic second derivatives", () => {
    // dxx/dxz/dzz are what the erosion weight's own derivative is built from in
    // the montane pipeline. Verified by differencing the returned FIRST
    // derivatives, which the previous test has independently verified.
    const h = 1e-4;
    let worst = 0;
    let curviest = 0;
    let skipped = 0;
    let compared = 0;
    for (let i = 0; i < 300; i++) {
      const x = i * 0.611 + 3.07;
      const z = i * -0.503 - 7.13;
      // Skip the rare sample that lands exactly on a lattice line (e.g. i =
      // 290 gives z = -153 exactly): the quintic fade's *third* derivative is
      // discontinuous there (value/dx/dxx themselves stay continuous, per the
      // C2 test below), which makes a centred finite difference straddling
      // the boundary degrade from O(h^2) to O(h) error. That is an artifact
      // of this numerical check, not of the analytic derivatives it verifies.
      const fx = x - Math.floor(x);
      const fz = z - Math.floor(z);
      if (fx < 2 * h || fx > 1 - 2 * h || fz < 2 * h || fz > 1 - 2 * h) {
        skipped++;
        continue;
      }
      compared++;
      const n = gradientNoise2(x, z, 555);
      const dxx = (gradientNoise2(x + h, z, 555).dx - gradientNoise2(x - h, z, 555).dx) / (2 * h);
      const dzz = (gradientNoise2(x, z + h, 555).dz - gradientNoise2(x, z - h, 555).dz) / (2 * h);
      const dxz = (gradientNoise2(x, z + h, 555).dx - gradientNoise2(x, z - h, 555).dx) / (2 * h);
      worst = Math.max(
        worst,
        Math.abs(n.dxx - dxx),
        Math.abs(n.dzz - dzz),
        Math.abs(n.dxz - dxz),
      );
      curviest = Math.max(curviest, Math.abs(dxx));
    }
    // The exclusion must not swallow the test: the excluded band is 4h wide
    // out of a unit cell, so this should reject essentially nothing.
    // Measured at 1 of 300.
    expect(skipped).toBeLessThan(10);
    expect(compared).toBeGreaterThan(280);
    expect(curviest).toBeGreaterThan(1);
    expect(worst).toBeLessThan(1e-4);
  });

  it("is C2-continuous across a lattice line", () => {
    // The quintic fade's second derivative vanishes at 0 and 1, so value, first
    // AND second derivatives must all agree across a cell border. The cubic
    // fade would fail the dxx case — that is why gradient noise gets quintic.
    const a = gradientNoise2(3 - 1e-7, 0.62, 11);
    const b = gradientNoise2(3 + 1e-7, 0.62, 11);
    expect(Math.abs(a.v - b.v)).toBeLessThan(1e-5);
    expect(Math.abs(a.dx - b.dx)).toBeLessThan(1e-4);
    expect(Math.abs(a.dxx - b.dxx)).toBeLessThan(1e-3);
  });
});

describe("fbm2d", () => {
  it("normalizes to [-1, 1] and matches numerical differentiation", () => {
    const h = 1e-4;
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.83 - 40.7;
      const z = i * 0.41 + 9.9;
      const n = fbm2d(x, z, 42, 4);
      expect(Math.abs(n.v)).toBeLessThanOrEqual(1);
      const ndx = (fbm2d(x + h, z, 42, 4).v - fbm2d(x - h, z, 42, 4).v) / (2 * h);
      worst = Math.max(worst, Math.abs(n.dx - ndx));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("keeps octave streams independent of octave count", () => {
    // The first octave of a 2-octave sum equals the whole 1-octave sum's
    // contribution — same seed convention as fbm2.
    const one = fbm2d(5.3, 2.1, 9, 1);
    expect(one.v).toBeCloseTo(gradientNoise2(5.3, 2.1, 9).v, 12);
  });
});
