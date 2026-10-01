import { describe, it, expect } from "vitest";
import {
  WATER_ROWS, lakeWaterRow, lakeSkin, waterSkinOffset, CLEAR_LAKE_KD, WATER_F0, WATER_HORIZON, WATER_WIND_MAX,
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
  it("alpha is 1 - (1 - F) * T: the reflected share stays out of the transmission", () => {
    const kd = WATER_ROWS.sea.kd;
    expect(meanKd(kd)).toBeCloseTo((0.34 + 0.18 + 0.26) / 3, 6);
    expect(alphaFor(kd, 1)).toBeCloseTo(1 - (1 - WATER_F0) * Math.exp(-2 * meanKd(kd)), 6);
    expect(alphaFor(kd, 0)).toBeCloseTo(WATER_F0, 6);
    expect(alphaFor(kd, 100)).toBeCloseTo(1, 6);
    expect(alphaFor(kd, 0.5, 0)).toBeCloseTo(1, 6); // grazing
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
    let fired = 0;
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
        fired++;
        expect(reflectY(safe, v)).toBeCloseTo(WATER_HORIZON, 5);
      }
    }
    // the lift ran for at least one angle
    expect(fired).toBeGreaterThan(0);
  });
  it("lifts the reflected ray exactly to the horizon for ripple normals across all angles", () => {
    let fired = 0;
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const tilt = 0.6;
      const n: [number, number, number] = [Math.sin(a) * tilt, 1, Math.cos(a) * tilt];
      const len = Math.hypot(...n);
      const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const v: [number, number, number] = [0, 0.05, Math.sqrt(1 - 0.0025)];
      const origReflectY = reflectY(nn, v);
      if (origReflectY < WATER_HORIZON) {
        fired++;
        const safe = horizonSafeNormal(nn, v);
        expect(reflectY(safe, v)).toBeCloseTo(WATER_HORIZON, 5);
      }
    }
    expect(fired).toBeGreaterThan(0);
  });
});

describe("lakeWaterRow", () => {
  it("is the very clear lake's row at murk 0 and the humic lake's at murk 1", () => {
    expect(lakeWaterRow(0)).toEqual(WATER_ROWS.highLake);
    expect(lakeWaterRow(1)).toEqual(WATER_ROWS.lowlandLake);
  });

  it("is the research's clear lake at murk 0.5", () => {
    const row = lakeWaterRow(0.5);
    expect(CLEAR_LAKE_KD).toEqual([0.75, 0.8, 1.6]);
    for (let c = 0; c < 3; c++) expect(row.kd[c]).toBeCloseTo(CLEAR_LAKE_KD[c]!, 12);
    expect(row.shelter).toBeCloseTo(0.2, 12);
    for (let c = 0; c < 3; c++) {
      expect(row.lInf[c]).toBeCloseTo((WATER_ROWS.highLake.lInf[c]! + WATER_ROWS.lowlandLake.lInf[c]!) / 2, 12);
    }
  });

  it("clamps murk outside [0, 1]", () => {
    expect(lakeWaterRow(-1)).toEqual(WATER_ROWS.highLake);
    expect(lakeWaterRow(2)).toEqual(WATER_ROWS.lowlandLake);
  });
});

describe("lakeSkin", () => {
  it("is off up to murk 0.5, full from 0.8", () => {
    expect(lakeSkin(0)).toBe(0);
    expect(lakeSkin(0.5)).toBe(0);
    expect(lakeSkin(0.8)).toBe(1);
    expect(lakeSkin(1)).toBe(1);
    expect(lakeSkin(0.65)).toBeCloseTo(0.5, 12);
  });
});

describe("waterSkinOffset", () => {
  it("is the same for a seed every time, and differs between seeds", () => {
    expect(waterSkinOffset(0x5eed)).toBe(waterSkinOffset(0x5eed));
    expect(waterSkinOffset(1)).not.toBe(waterSkinOffset(2));
    expect(waterSkinOffset(-1)).toBeGreaterThanOrEqual(0);
    expect(waterSkinOffset(-1)).toBeLessThan(4096);
  });
});
