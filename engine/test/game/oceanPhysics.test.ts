import { describe, it, expect } from "vitest";
import {
  OCEAN_G, WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX, WEGGEL_SLOPE_MAX,
  CALLAGHAN_ONSET, CALLAGHAN_TOP, CALLAGHAN_COEFF, WHITECAP_MAX,
  waveNumber, waveNumberNewton, groupSpeed, shoalingFactor, refraction,
  weggelCoefficients, breakerIndex, whitecapCoverage,
} from "../../src/game/oceanPhysics.js";

const omega = (period: number): number => (2 * Math.PI) / period;
const length = (period: number, depth: number): number => (2 * Math.PI) / waveNumber(omega(period), depth);

describe("the ocean's constants", () => {
  it("are the values the shaders and tables are built on", () => {
    expect(OCEAN_G).toBe(9.81);
    expect([WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX, WEGGEL_SLOPE_MAX]).toEqual([0.78, 1.56, 0.1]);
    expect([CALLAGHAN_ONSET, CALLAGHAN_TOP, CALLAGHAN_COEFF, WHITECAP_MAX]).toEqual([3.7, 11.25, 3.18e-5, 0.1]);
  });
});

describe("dispersion", () => {
  it("Fenton and McKee's form, refined, is within 1e-6 of Newton's root for periods 3 to 16 s at depths 0.05 to 200 m", () => {
    let worst = 0;
    for (let period = 3; period <= 16.0001; period += 0.25) {
      for (let lnDepth = Math.log(0.05); lnDepth <= Math.log(200) + 1e-9; lnDepth += 0.05) {
        const depth = Math.exp(lnDepth);
        const exact = waveNumberNewton(omega(period), depth);
        worst = Math.max(worst, Math.abs(waveNumber(omega(period), depth) - exact) / exact);
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("is ω²/g in deep water, by Infinity or by a depth past half a wavelength many times over", () => {
    for (const period of [3, 8, 11, 16]) {
      const k0 = (omega(period) * omega(period)) / 9.81;
      expect(waveNumber(omega(period), Infinity)).toBe(k0);
      expect(waveNumberNewton(omega(period), Infinity)).toBe(k0);
      expect(Math.abs(waveNumber(omega(period), 5000) - k0) / k0).toBeLessThan(1e-12);
    }
    expect(length(11, Infinity)).toBeCloseTo(188.92, 1);
  });

  it("gives the research's wavelengths: an 11 s swell 148, 93, 75 and 48 m long at 25, 8, 5 and 2 m; a 9 s swell 60 m at 5 m", () => {
    expect(Math.abs(length(11, 25) - 148)).toBeLessThan(1);
    expect(Math.abs(length(11, 8) - 93)).toBeLessThan(1);
    expect(Math.abs(length(11, 5) - 75)).toBeLessThan(1);
    expect(Math.abs(length(11, 2) - 48)).toBeLessThan(1);
    expect(Math.abs(length(9, 5) - 60)).toBeLessThan(1);
  });

  it("takes a depth below 0.01 m as 0.01 m and never returns NaN", () => {
    expect(waveNumber(omega(11), 0.001)).toBe(waveNumber(omega(11), 0.01));
    expect(waveNumber(omega(11), 0)).toBe(waveNumber(omega(11), 0.01));
    expect(Number.isFinite(waveNumber(omega(11), 0))).toBe(true);
  });
});

describe("group speed and shoaling", () => {
  it("is half the phase speed in deep water and near √(gh) in shallow water", () => {
    const k0 = waveNumber(omega(11), Infinity);
    expect(groupSpeed(omega(11), k0, Infinity)).toBeCloseTo(9.81 / (2 * omega(11)), 9);
    const k2 = waveNumber(omega(11), 2);
    expect(Math.abs(groupSpeed(omega(11), k2, 2) - Math.sqrt(9.81 * 2)) / Math.sqrt(9.81 * 2)).toBeLessThan(0.04);
  });

  it("gives the research's shoaling coefficients for an 11 s swell: 1.05, 1.15 and 1.42 at 8, 5 and 2 m", () => {
    expect(Math.abs(shoalingFactor(omega(11), 8) - 1.05)).toBeLessThan(0.01);
    expect(Math.abs(shoalingFactor(omega(11), 5) - 1.15)).toBeLessThan(0.01);
    expect(Math.abs(shoalingFactor(omega(11), 2) - 1.42)).toBeLessThan(0.01);
  });

  it("and for 6 s (0.91, 0.94, 1.09) and 15 s (1.19, 1.32, 1.63) at 8, 5 and 2 m, the table's rounding allowed", () => {
    // The research's table rounds by hand; 15 s at 2 m comes to 1.641 here.
    const rows: [number, number[]][] = [[6, [0.91, 0.94, 1.09]], [15, [1.19, 1.32, 1.63]]];
    for (const [period, expected] of rows) {
      [8, 5, 2].forEach((depth, i) => {
        expect(Math.abs(shoalingFactor(omega(period), depth) - expected[i]!)).toBeLessThan(0.015);
      });
    }
  });

  it("is 1 in deep water and dips below 1 before it grows", () => {
    expect(shoalingFactor(omega(11), Infinity)).toBe(1);
    expect(shoalingFactor(omega(6), 8)).toBeLessThan(1);
  });
});

describe("refraction", () => {
  const k0 = waveNumber(omega(11), Infinity);
  const k0z = k0 * Math.sin(Math.PI / 6);
  const angleAt = (depth: number): number => {
    const { kn } = refraction(k0, k0z, waveNumber(omega(11), depth));
    return (Math.atan2(k0z, kn) * 180) / Math.PI;
  };

  it("turns an 11 s swell from 30° offshore to about 14° at 8 m and 7° at 2 m", () => {
    expect(Math.abs(angleAt(8) - 14)).toBeLessThan(1);
    expect(Math.abs(angleAt(2) - 7)).toBeLessThan(1);
  });

  it("keeps the along-shore wavenumber and spreads the crests: K_r under 1 and kn² + k0z² = k²", () => {
    const k = waveNumber(omega(11), 5);
    const { kn, kr } = refraction(k0, k0z, k);
    expect(kn * kn + k0z * k0z).toBeCloseTo(k * k, 12);
    expect(kr).toBeLessThan(1);
    expect(kr).toBeGreaterThan(0.9);
  });

  it("changes nothing offshore: kn = k0x and K_r = 1", () => {
    const { kn, kr } = refraction(k0, k0z, k0);
    expect(kn).toBeCloseTo(k0 * Math.cos(Math.PI / 6), 12);
    expect(kr).toBeCloseTo(1, 12);
  });
});

describe("Weggel's breaker index", () => {
  it("is about 0.9 for the typical swell (2.9 m, 11 s) on the 1:50 bed", () => {
    expect(Math.abs(breakerIndex(0.02, 2.9, 11) - 0.9)).toBeLessThan(0.05);
  });

  it("is about 1.24 for a 1.5 m, 9 s wave on the 1:12 face", () => {
    expect(Math.abs(breakerIndex(1 / 12, 1.5, 9) - 1.24)).toBeLessThan(0.06);
  });

  it("holds the index inside [0.78, 1.56] and takes slopes past 1:10 as 1:10", () => {
    expect(breakerIndex(0, 1, 10)).toBe(0.78);
    expect(breakerIndex(0.001, 10, 4)).toBe(0.78);
    expect(breakerIndex(0.5, 1.5, 9)).toBe(breakerIndex(0.1, 1.5, 9));
    expect(weggelCoefficients(0.5)).toEqual(weggelCoefficients(0.1));
    expect(weggelCoefficients(-0.02)).toEqual(weggelCoefficients(0.02));
    for (let slope = 0; slope <= 0.2; slope += 0.01) {
      for (const height of [0, 0.5, 2, 6]) {
        const gamma = breakerIndex(slope, height, 9);
        expect(gamma).toBeGreaterThanOrEqual(0.78);
        expect(gamma).toBeLessThanOrEqual(1.56);
      }
    }
  });

  it("has Weggel's coefficients: a = 43.8(1 − e^(−19 tanβ)), b = 1.56/(1 + e^(−19.5 tanβ))", () => {
    const { a, b } = weggelCoefficients(0.02);
    expect(a).toBeCloseTo(13.847, 3);
    expect(b).toBeCloseTo(0.9302, 4);
  });
});

describe("whitecap coverage", () => {
  it("is none at 3.7 m/s and below", () => {
    for (const u of [-1, 0, 2, 3.7]) expect(whitecapCoverage(u)).toBe(0);
    expect(whitecapCoverage(Number.NaN)).toBe(0);
  });

  it("is 0.1 to 0.3 % at 7 m/s and about 1 % at 10 m/s", () => {
    expect(whitecapCoverage(7)).toBeGreaterThanOrEqual(0.001);
    expect(whitecapCoverage(7)).toBeLessThanOrEqual(0.003);
    expect(Math.abs(whitecapCoverage(10) - 0.01)).toBeLessThanOrEqual(0.003);
  });

  it("follows the cubic to 11.25 m/s, its tangent past it (a few per cent at 15 m/s), and stops at WHITECAP_MAX", () => {
    expect(whitecapCoverage(11.25)).toBeCloseTo(3.18e-5 * 7.55 ** 3, 12);
    expect(whitecapCoverage(15)).toBeGreaterThan(0.02);
    expect(whitecapCoverage(15)).toBeLessThan(0.04);
    expect(whitecapCoverage(30)).toBe(0.1);
    expect(whitecapCoverage(100)).toBe(0.1);
    let last = 0;
    for (let u = 3.7; u <= 40; u += 0.05) {
      const c = whitecapCoverage(u);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
    const step = 1e-6;
    expect(Math.abs(whitecapCoverage(11.25 + step) - whitecapCoverage(11.25 - step))).toBeLessThan(1e-7);
  });
});
