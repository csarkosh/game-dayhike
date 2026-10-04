import { describe, it, expect } from "vitest";
import {
  agx, gradeRecordUnder, whitePointMatrix, hueToRgb, IDENTITY,
  HALATION_BASE, ABERRATION_BASE, AGX_MIN_EV, AGX_MAX_EV, STARE_VIGNETTE,
} from "../../src/game/gradeParams.js";
import { WEATHER_PRESETS, exposureUnder, vignetteWeightUnder, VIGNETTE_WEIGHT_BASE } from "../../src/game/weather.js";
import { sunPositionAt } from "../../src/game/sky.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { skyFixture } from "./helpers/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;
const EERIE = WEATHER_PRESETS.eerie;
const table = skyFixture();

/** Midnight's white point as it has always been: the night white's Bradford
 * matrix, column-major. */
const MIDNIGHT_WHITE = [
  0.9697945994651918, 0.0014453411088976608, 0.00580267983014306,
  -0.03242320525423818, 0.9984949351034228, 0.02245494273020565,
  -0.011408876046577587, -0.005255272691626595, 1.242522254356526,
];

describe("agx — the TS reference of the GLSL tone map", () => {
  it("is bracketed to [0, 1] and monotonic in exposure on grey", () => {
    let last = -1;
    for (let ev = -14; ev <= 6; ev += 0.25) {
      const v = 0.18 * Math.pow(2, ev);
      const out = agx({ r: v, g: v, b: v });
      expect(out.r).toBeGreaterThanOrEqual(0);
      expect(out.r).toBeLessThanOrEqual(1);
      expect(out.r).toBeGreaterThanOrEqual(last - 1e-9);
      last = out.r;
    }
  });

  it("maps middle grey near the middle and keeps grey neutral", () => {
    const out = agx({ r: 0.18, g: 0.18, b: 0.18 });
    // agx() returns linear values: 0.18 lands near 0.21 here, which is ~0.5 after the
    // sRGB encode the grade pass applies afterwards.
    expect(out.r).toBeGreaterThan(0.15);
    expect(out.r).toBeLessThan(0.3);
    expect(Math.abs(out.r - out.g)).toBeLessThan(1e-3);
    expect(Math.abs(out.g - out.b)).toBeLessThan(1e-3);
  });

  it("uses the documented log2 range", () => {
    expect(AGX_MIN_EV).toBe(-12.47393);
    expect(AGX_MAX_EV).toBe(4.026069);
  });
});

describe("white point", () => {
  it("is the identity by day", () => {
    // The morning, noon and the afternoon are day: no night factor, no shift.
    for (const hour of [8, 12, 15, 17]) {
      const night = skyStateFor(table, hour, CLEAR).night;
      expect(night, `hour ${hour}`).toBe(0);
      expect(gradeRecordUnder(CLEAR, hour, night, 1).whitePoint, `hour ${hour}`).toBe(IDENTITY);
    }
    // A quarter and a half hour past sunset the night factor has risen, and the white point has left the identity.
    for (const hour of [18.25, 18.5]) {
      const night = skyStateFor(table, hour, CLEAR).night;
      expect(gradeRecordUnder(CLEAR, hour, night, 1).whitePoint, `hour ${hour}`).not.toBe(IDENTITY);
    }
    expect(whitePointMatrix(0)).toBe(IDENTITY);
  });

  it("cools with the night factor, to midnight's night white, unchanged", () => {
    const half = whitePointMatrix(0.5);
    const full = whitePointMatrix(1);
    // A cool white point makes a grey pixel bluer than red, the more so the deeper the night.
    expect(half[8]).toBeGreaterThan(half[0]!);
    expect(full[8]).toBeGreaterThan(half[8]!);
    for (let i = 0; i < 9; i++) expect(full[i]).toBeCloseTo(MIDNIGHT_WHITE[i]!, 12);
    // Midnight's night factor is 1: the night white itself.
    expect(skyStateFor(table, 0, CLEAR).night).toBe(1);
  });
});

describe("hueToRgb", () => {
  it("returns pure red, green and blue at 0, 120 and 240 degrees", () => {
    expect(hueToRgb(0)).toEqual({ r: 1, g: 0, b: 0 });
    expect(hueToRgb(120)).toEqual({ r: 0, g: 1, b: 0 });
    expect(hueToRgb(240)).toEqual({ r: 0, g: 0, b: 1 });
  });
});

describe("gradeRecordUnder", () => {
  it("at clear is the identity apart from exposure, the white point and the baseline treatment", () => {
    for (let hour = 0; hour < 24; hour += 0.5) {
      const g = gradeRecordUnder(CLEAR, hour, 0, 1);
      expect(g.exposure).toBe(exposureUnder(CLEAR, sunPositionAt(hour).y));
      expect(g.shadows.density).toBe(0);
      expect(g.midtones.density).toBe(0);
      expect(g.highlights.density).toBe(0);
      expect(g.lift).toEqual({ r: 0, g: 0, b: 0 });
      expect(g.saturation).toBe(0);
      expect(g.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
      expect(g.halationStrength).toBe(HALATION_BASE);
      expect(g.aberrationAmount).toBe(ABERRATION_BASE);
    }
  });

  it("purkinje follows the night factor: none by day, today's 0.8 at midnight", () => {
    expect(gradeRecordUnder(CLEAR, 12, 0, 1).purkinjeStrength).toBe(0);
    expect(gradeRecordUnder(CLEAR, 18.5, 0.5, 1).purkinjeStrength).toBeCloseTo(0.4, 12);
    expect(gradeRecordUnder(CLEAR, 1, 1, 1).purkinjeStrength).toBeCloseTo(0.8, 10);
    // Clamped as the white point's blend is: past 1 is still full night.
    expect(gradeRecordUnder(CLEAR, 1, 1.5, 1).purkinjeStrength).toBe(0.8);
    // Through the sky state: noon's night factor and midnight's.
    expect(gradeRecordUnder(CLEAR, 12, skyStateFor(table, 12, CLEAR).night, 1).purkinjeStrength).toBe(0);
    expect(gradeRecordUnder(CLEAR, 0, skyStateFor(table, 0, CLEAR).night, 1).purkinjeStrength).toBeCloseTo(0.8, 10);
  });

  it("dread raises the lens terms and unsettle scales exactly those", () => {
    const full = gradeRecordUnder(EERIE, 17, 0, 1);
    const off = gradeRecordUnder(EERIE, 17, 0, 0);
    expect(full.halationStrength).toBeGreaterThan(HALATION_BASE);
    expect(full.aberrationAmount).toBeGreaterThan(ABERRATION_BASE);
    expect(full.vignetteWeight).toBe(vignetteWeightUnder(EERIE));
    expect(off.halationStrength).toBe(HALATION_BASE);
    expect(off.aberrationAmount).toBe(ABERRATION_BASE);
    expect(off.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
    // The world-side colour is untouched by the slider.
    expect(off.shadows).toEqual(full.shadows);
    expect(off.exposure).toBe(full.exposure);
  });

  it("the split-tone reaches today's densities under eerie", () => {
    const g = gradeRecordUnder(EERIE, 17, 0, 1);
    expect(g.shadows.density).toBeGreaterThan(0);
    expect(g.midtones.density).toBeGreaterThan(g.highlights.density);
  });
});

describe("the stare", () => {
  it("leaves the record untouched at 0, darkens monotonically, and is black at 1", () => {
    expect(gradeRecordUnder(CLEAR, 12, 0, 1, 0, 0)).toEqual(gradeRecordUnder(CLEAR, 12, 0, 1));
    let lastExposure = Infinity;
    let lastVignette = -Infinity;
    for (const stare of [0, 0.25, 0.5, 0.75, 1]) {
      const r = gradeRecordUnder(EERIE, 12, 0, 1, 0, stare);
      expect(r.exposure).toBeLessThanOrEqual(lastExposure);
      expect(r.vignetteWeight).toBeGreaterThanOrEqual(lastVignette);
      lastExposure = r.exposure;
      lastVignette = r.vignetteWeight;
    }
    expect(gradeRecordUnder(EERIE, 12, 0, 1, 0, 1).exposure).toBe(0);
    expect(gradeRecordUnder(EERIE, 12, 0, 1, 0, 1).vignetteWeight).toBeCloseTo(gradeRecordUnder(EERIE, 12, 0, 1).vignetteWeight + STARE_VIGNETTE, 9);
  });
});
