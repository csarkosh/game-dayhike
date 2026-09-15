import { describe, it, expect } from "vitest";
import {
  agx, gradeRecordUnder, whitePointMatrix, hueToRgb, IDENTITY,
  HALATION_BASE, ABERRATION_BASE, PURKINJE_MAX, AGX_MIN_EV, AGX_MAX_EV,
} from "../../src/game/gradeParams.js";
import { WEATHER_PRESETS, exposureUnder, vignetteWeightUnder, VIGNETTE_WEIGHT_BASE } from "../../src/game/weather.js";
import { sunPositionAt } from "../../src/game/sky.js";

const CLEAR = WEATHER_PRESETS.clear;
const EERIE = WEATHER_PRESETS.eerie;

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
  it("is the identity at noon and warms at dusk", () => {
    const noon = whitePointMatrix(sunPositionAt(12).y);
    for (let i = 0; i < 9; i++) expect(noon[i]).toBeCloseTo(IDENTITY[i]!, 6);
    const dusk = whitePointMatrix(sunPositionAt(18.2).y);
    // A warm white point makes a grey pixel redder than blue: the diagonal's
    // red gain exceeds its blue gain.
    expect(dusk[0]).toBeGreaterThan(dusk[8]!);
    const night = whitePointMatrix(sunPositionAt(1).y);
    expect(night[8]).toBeGreaterThan(night[0]!);
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
      const g = gradeRecordUnder(CLEAR, hour, 1);
      expect(g.exposure).toBe(exposureUnder(CLEAR, sunPositionAt(hour).y));
      expect(g.shadows.density).toBe(0);
      expect(g.midtones.density).toBe(0);
      expect(g.highlights.density).toBe(0);
      expect(g.lift).toBe(0);
      expect(g.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
      expect(g.halationStrength).toBe(HALATION_BASE);
      expect(g.aberrationAmount).toBe(ABERRATION_BASE);
    }
  });

  it("purkinje only bites at night", () => {
    expect(gradeRecordUnder(CLEAR, 12, 1).purkinjeStrength).toBe(0);
    expect(gradeRecordUnder(CLEAR, 1, 1).purkinjeStrength).toBeCloseTo(PURKINJE_MAX, 10);
  });

  it("dread raises the lens terms and unsettle scales exactly those", () => {
    const full = gradeRecordUnder(EERIE, 17, 1);
    const off = gradeRecordUnder(EERIE, 17, 0);
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
    const g = gradeRecordUnder(EERIE, 17, 1);
    expect(g.shadows.density).toBeGreaterThan(0);
    expect(g.midtones.density).toBeGreaterThan(g.highlights.density);
  });
});
