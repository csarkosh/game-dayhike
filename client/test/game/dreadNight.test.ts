import { describe, it, expect } from "vitest";
import gradeFragment from "../../src/game/shaders/grade.fragment.fx?raw";
import finishFragment from "../../src/game/shaders/finish.fragment.fx?raw";
import {
  WEATHER_PRESETS, fogDensityUnder, saturationUnder, ambientCollapseUnder,
  FOG_DREAD_GAIN, FOG_MIST_GAIN, AMBIENT_COLLAPSE, DREAD_SATURATION_DROP, DREAD_FOG_PULL,
} from "../../src/game/weather.js";
import { fogDensityFor } from "../../src/game/sky.js";
import {
  gradeRecordUnder, LIFT_DREAD, VIGNETTE_PULSE, VIGNETTE_PULSE_PERIOD, PURKINJE_MAX, ABERRATION_DREAD_GAIN,
} from "../../src/game/gradeParams.js";
import { finishUnder, OVERLAP_MAX, OVERLAP_INNER, OVERLAP_ECHO, GRAIN_DREAD_GAIN } from "../../src/game/postParams.js";

const CLEAR = WEATHER_PRESETS.clear;
const EERIE = WEATHER_PRESETS.eerie;
const DREAD_ONLY = { ...CLEAR, dread: 1 };

function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

describe("darker and swallowed", () => {
  it("dread thickens the far fog on top of mist, and clear is exact", () => {
    expect(fogDensityUnder(CLEAR, 4000)).toBe(fogDensityFor(4000));
    expect(fogDensityUnder(DREAD_ONLY, 4000)).toBeCloseTo(fogDensityFor(4000) * (1 + FOG_DREAD_GAIN), 12);
    expect(fogDensityUnder(EERIE, 4000)).toBeCloseTo(fogDensityFor(4000) * (1 + FOG_MIST_GAIN) * (1 + FOG_DREAD_GAIN), 12);
  });

  it("the ambient collapses hard on the top plateau", () => {
    expect(AMBIENT_COLLAPSE).toBeGreaterThanOrEqual(0.7);
    expect(ambientCollapseUnder(EERIE)).toBeCloseTo(1 - AMBIENT_COLLAPSE, 12);
    expect(ambientCollapseUnder(CLEAR)).toBe(1);
  });

  it("night rods pull harder", () => {
    expect(PURKINJE_MAX).toBeGreaterThanOrEqual(0.8);
    expect(gradeRecordUnder(CLEAR, 1, 1).purkinjeStrength).toBeCloseTo(PURKINJE_MAX, 10);
  });
});

describe("sicker, not just darker", () => {
  it("shadows lift toward a green-grey under dread, and stay black at clear", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(gradeRecordUnder(CLEAR, hour, 1).lift).toEqual({ r: 0, g: 0, b: 0 });
    }
    const lifted = gradeRecordUnder(EERIE, 20, 1).lift;
    expect(lifted).toEqual(LIFT_DREAD);
    expect(lifted.g).toBeGreaterThan(lifted.r);
    expect(lifted.g).toBeGreaterThan(lifted.b);
    // World-side: the slider does not touch it.
    expect(gradeRecordUnder(EERIE, 20, 0).lift).toEqual(LIFT_DREAD);
  });

  it("the grade pass carries a global desaturation that is exactly 0 at clear", () => {
    expect(gradeRecordUnder(CLEAR, 12, 1).saturation).toBe(0);
    expect(gradeRecordUnder(EERIE, 20, 1).saturation).toBeCloseTo(saturationUnder(EERIE) / 100, 12);
    expect(DREAD_SATURATION_DROP).toBeGreaterThanOrEqual(30);
    expect(DREAD_FOG_PULL).toBeGreaterThanOrEqual(0.7);
  });

  it("the GLSL takes the lift as a colour and the saturation as a uniform", () => {
    expect(gradeFragment).toContain("uniform vec3 lift;");
    expect(gradeFragment).toContain("uniform float saturation;");
  });
});

describe("heavier lens", () => {
  it("full dread is unmistakable and unsettle 0 still silences it", () => {
    expect(OVERLAP_MAX).toBeGreaterThanOrEqual(0.8);
    expect(OVERLAP_INNER).toBeLessThanOrEqual(0.45);
    expect(GRAIN_DREAD_GAIN).toBeGreaterThanOrEqual(4);
    expect(ABERRATION_DREAD_GAIN).toBeGreaterThanOrEqual(3);
    expect(finishUnder(EERIE, 0, 0).overlapGain).toBe(0);
    expect(finishFragment).toContain(`const float OVERLAP_ECHO = ${glslFloat(OVERLAP_ECHO)};`);
    expect(finishFragment).toContain(`const float OVERLAP_INNER = ${glslFloat(OVERLAP_INNER)};`);
  });

  it("the vignette breathes under dread and holds still at clear", () => {
    const quarter = VIGNETTE_PULSE_PERIOD / 4;
    const rest = gradeRecordUnder(EERIE, 20, 1, 0).vignetteWeight;
    const peak = gradeRecordUnder(EERIE, 20, 1, quarter).vignetteWeight;
    expect(peak).toBeCloseTo(rest * (1 + VIGNETTE_PULSE), 10);
    expect(gradeRecordUnder(EERIE, 20, 0, quarter).vignetteWeight).toBe(gradeRecordUnder(EERIE, 20, 0, 0).vignetteWeight);
    for (const t of [0, 1.7, quarter, 5.5]) {
      expect(gradeRecordUnder(CLEAR, 20, 1, t).vignetteWeight).toBe(gradeRecordUnder(CLEAR, 20, 1, 0).vignetteWeight);
    }
  });
});
