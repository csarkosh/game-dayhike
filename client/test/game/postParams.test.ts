import { describe, it, expect } from "vitest";
import {
  postFeaturesFor, finishUnder, OVERLAP_MAX, GRAIN_BASE, GRAIN_DREAD_GAIN, OVERLAP_BREATH_HZ,
} from "../../src/game/postParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

describe("postFeaturesFor", () => {
  it("high gets the pipeline and halation, medium the pipeline only, low nothing", () => {
    expect(postFeaturesFor("high", true)).toEqual({ pipeline: true, halation: true, colourPath: "post" });
    expect(postFeaturesFor("medium", true)).toEqual({ pipeline: true, halation: false, colourPath: "post" });
    expect(postFeaturesFor("low", true)).toEqual({ pipeline: false, halation: false, colourPath: "material" });
  });

  it("without float render targets every tier takes the material path", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(postFeaturesFor(tier, false).colourPath).toBe("material");
      expect(postFeaturesFor(tier, false).pipeline).toBe(false);
    }
  });
});

describe("finishUnder", () => {
  it("at clear the overlap is off and grain sits at its base", () => {
    const f = finishUnder(WEATHER_PRESETS.clear, 1, 3);
    expect(f.overlapGain).toBe(0);
    expect(f.grainGain).toBe(GRAIN_BASE);
    expect(f.time).toBe(3);
  });

  it("eerie reaches the full overlap and grain; unsettle scales both back to base", () => {
    const on = finishUnder(WEATHER_PRESETS.eerie, 1, 0);
    expect(on.overlapGain).toBeCloseTo(OVERLAP_MAX, 10);
    expect(on.grainGain).toBeCloseTo(GRAIN_BASE * (1 + GRAIN_DREAD_GAIN), 10);
    const off = finishUnder(WEATHER_PRESETS.eerie, 0, 0);
    expect(off.overlapGain).toBe(0);
    expect(off.grainGain).toBe(GRAIN_BASE);
  });

  it("the overlap breathes at OVERLAP_BREATH_HZ", () => {
    const period = 1 / OVERLAP_BREATH_HZ;
    expect(finishUnder(WEATHER_PRESETS.eerie, 1, 0).overlapPhase).toBeCloseTo(finishUnder(WEATHER_PRESETS.eerie, 1, period).overlapPhase, 6);
  });
});
