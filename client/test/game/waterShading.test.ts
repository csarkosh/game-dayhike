import { describe, it, expect } from "vitest";
import {
  WATER_ROWS, WATER_F0, WATER_HORIZON, WATER_WIND_MAX,
  fresnelSchlick, fresnelExact, transmission, meanKd, alphaFor,
  slopeVariance, roughnessFor, horizonSafeNormal,
} from "../../src/game/waterShading.js";

describe("Fresnel for water", () => {
  it("is F0 = 0.02 straight down and 1 at grazing", () => {
    expect(fresnelSchlick(1)).toBeCloseTo(WATER_F0, 6);
    expect(fresnelSchlick(0)).toBeCloseTo(1, 6);
  });
  it("stays within 6 % absolute of the exact unpolarised curve for n = 1.33 (the worst is 0.058 at 85°)", () => {
    for (const deg of [0, 45, 60, 70, 80, 85, 90]) {
      const c = Math.cos((deg * Math.PI) / 180);
      expect(Math.abs(fresnelSchlick(c) - fresnelExact(c))).toBeLessThan(0.06);
    }
  });
});

describe("transmission by depth", () => {
  it("gives the research doc's humic numbers at 0.3 m: half the red, two fifths of the green, an eighth of the blue", () => {
    const [r, g, b] = transmission(WATER_ROWS.lowlandLake.kd, 0.3);
    expect(r).toBeCloseTo(0.52, 1);
    expect(g).toBeCloseTo(0.41, 1);
    expect(b).toBeCloseTo(0.12, 1);
  });
  it("loses the bed by 10 m in every body", () => {
    for (const row of Object.values(WATER_ROWS)) {
      for (const t of transmission(row.kd, 10)) expect(t).toBeLessThan(0.1);
    }
  });
  it("is 1 at zero and negative depth", () => {
    expect(transmission(WATER_ROWS.sea.kd, 0)).toEqual([1, 1, 1]);
    expect(transmission(WATER_ROWS.sea.kd, -2)).toEqual([1, 1, 1]);
  });
  it("alpha is 1 minus the mean-Kd transmission", () => {
    const kd = WATER_ROWS.sea.kd;
    expect(meanKd(kd)).toBeCloseTo((0.34 + 0.18 + 0.26) / 3, 6);
    expect(alphaFor(kd, 1)).toBeCloseTo(1 - Math.exp(-2 * meanKd(kd)), 6);
    expect(alphaFor(kd, 0)).toBe(0);
    expect(alphaFor(kd, 100)).toBeCloseTo(1, 6);
  });
});

describe("roughness from wind", () => {
  it("has Cox and Munk's floor in a dead calm on the open sea", () => {
    expect(slopeVariance(0, 1)).toBeCloseTo(0.003, 6);
    expect(roughnessFor(0, 1)).toBeGreaterThan(0.2);
  });
  it("shelter 0.1 in calm air is under 0.2; the sea in rain is at least 0.5", () => {
    expect(roughnessFor(0, 0.1)).toBeLessThan(0.2);
    expect(roughnessFor(1, 1)).toBeGreaterThanOrEqual(0.5);
  });
  it("is monotone in wind and maps 1 to 12 m/s", () => {
    let last = -1;
    for (let w = 0; w <= 1; w += 0.05) {
      const r = roughnessFor(w, 1);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    expect(WATER_WIND_MAX).toBe(12);
    expect(slopeVariance(1, 1)).toBeCloseTo(0.003 + 0.00512 * 12, 6);
  });
  it("clamps wind and shelter to [0, 1]", () => {
    expect(roughnessFor(3, 1)).toBeCloseTo(roughnessFor(1, 1), 6);
    expect(roughnessFor(-1, 1)).toBeCloseTo(roughnessFor(0, 1), 6);
    expect(roughnessFor(0.5, 7)).toBeCloseTo(roughnessFor(0.5, 1), 6);
  });
});

describe("horizon-safe normal", () => {
  const reflectY = (n: [number, number, number], v: [number, number, number]): number => {
    // reflect(-v, n).y with v the direction from the surface to the eye
    const d = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
    return -v[1] - 2 * d * n[1];
  };
  it("leaves a normal alone when the reflection already clears the horizon", () => {
    const n: [number, number, number] = [0, 1, 0];
    const v: [number, number, number] = [0, 0.5, Math.sqrt(0.75)];
    expect(horizonSafeNormal(n, v)).toEqual(n);
  });
  it("tilts a ripple normal up until the reflection clears the horizon, for the eye above the water", () => {
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const tilt = 0.6;
      const n: [number, number, number] = [Math.sin(a) * tilt, 1, Math.cos(a) * tilt];
      const len = Math.hypot(...n);
      const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const v: [number, number, number] = [0, 0.05, Math.sqrt(1 - 0.0025)];
      const origReflectY = reflectY(nn, v);
      const safe = horizonSafeNormal(nn, v);
      expect(reflectY(safe, v)).toBeGreaterThanOrEqual(WATER_HORIZON - 1e-6);
      expect(Math.hypot(...safe)).toBeCloseTo(1, 6);
      if (origReflectY < WATER_HORIZON) {
        expect(reflectY(safe, v)).toBeCloseTo(WATER_HORIZON, 5);
      }
    }
  });
  it("lifts the reflected ray exactly to the horizon for ripple normals across all angles", () => {
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const tilt = 0.6;
      const n: [number, number, number] = [Math.sin(a) * tilt, 1, Math.cos(a) * tilt];
      const len = Math.hypot(...n);
      const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const v: [number, number, number] = [0, 0.05, Math.sqrt(1 - 0.0025)];
      const origReflectY = reflectY(nn, v);
      if (origReflectY < WATER_HORIZON) {
        const safe = horizonSafeNormal(nn, v);
        expect(reflectY(safe, v)).toBeCloseTo(WATER_HORIZON, 5);
      }
    }
  });
});
