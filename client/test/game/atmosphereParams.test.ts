import { describe, it, expect } from "vitest";
import {
  atmosphereUnder, fogGradientUnder, heightFogAmount, sunWeightUnder,
  GRADIENT_STEPS, HEIGHT_DENSITY_BASE, HEIGHT_MIST_GAIN, LEVEL_MIST_RISE, LEVEL_DREAD_RISE, SUN_POWER,
} from "../../src/game/atmosphereParams.js";
import { WEATHER_PRESETS, fogColourUnder, fogDensityUnder } from "../../src/game/weather.js";
import { skyColourAt, sunColourAt, sunPositionAt } from "../../src/game/sky.js";

const CLEAR = WEATHER_PRESETS.clear;

describe("the fog gradient", () => {
  it("has GRADIENT_STEPS entries whose far end is the air colour and whose near end is dimmer", () => {
    const g = fogGradientUnder(CLEAR, 12);
    expect(g.length).toBe(GRADIENT_STEPS);
    expect(g[GRADIENT_STEPS - 1]).toEqual(fogColourUnder(CLEAR, 12));
    const near = g[0]!;
    const far = g[GRADIENT_STEPS - 1]!;
    expect(near.r + near.g + near.b).toBeLessThan(far.r + far.g + far.b);
  });

  it("at clear the far end is exactly the sky colour at every hour", () => {
    for (let hour = 0; hour < 24; hour += 0.5) {
      expect(fogGradientUnder(CLEAR, hour)[GRADIENT_STEPS - 1]).toEqual(skyColourAt(hour));
    }
  });
});

describe("atmosphereUnder", () => {
  it("at clear keeps the base density and the lowest height fog", () => {
    const a = atmosphereUnder(CLEAR, 12, 4000);
    expect(a.baseDensity).toBe(fogDensityUnder(CLEAR, 4000));
    expect(a.heightDensity).toBe(HEIGHT_DENSITY_BASE);
    expect(a.gradientScale).toBe(1 / 4000);
    expect(a.sunPower).toBe(SUN_POWER);
    expect(a.sunColour).toEqual(sunColourAt(12));
    expect(a.sunDir).toEqual(sunPositionAt(12));
  });

  it("mist raises the height density and the reference level; dread raises the level further", () => {
    const mist = atmosphereUnder(WEATHER_PRESETS.mist, 12, 4000);
    const eerie = atmosphereUnder(WEATHER_PRESETS.eerie, 12, 4000);
    const clear = atmosphereUnder(CLEAR, 12, 4000);
    expect(mist.heightDensity).toBeCloseTo(HEIGHT_DENSITY_BASE * (1 + HEIGHT_MIST_GAIN), 10);
    expect(mist.referenceLevel).toBeCloseTo(clear.referenceLevel + LEVEL_MIST_RISE, 10);
    expect(eerie.referenceLevel).toBeCloseTo(clear.referenceLevel + LEVEL_MIST_RISE + LEVEL_DREAD_RISE, 10);
  });

  it("the reference level holds still across a plateau of the dread fade", () => {
    const a = { ...WEATHER_PRESETS.eerie, dread: 0.36 };
    const b = { ...WEATHER_PRESETS.eerie, dread: 0.42 };
    expect(atmosphereUnder(a, 17, 4000).referenceLevel).toBe(atmosphereUnder(b, 17, 4000).referenceLevel);
  });
});

describe("sun weight", () => {
  it("is 1 with the sun up under clear, fades with cloud, and is 0 below the horizon", () => {
    expect(sunWeightUnder(CLEAR, 0.5)).toBe(1);
    expect(sunWeightUnder(WEATHER_PRESETS.rain, 0.5)).toBeLessThan(0.15);
    expect(sunWeightUnder(CLEAR, -0.3)).toBe(0);
  });
});

describe("heightFogAmount — the TS mirror of the GLSL", () => {
  it("is zero over zero distance, grows with distance, and is larger for a ray going down", () => {
    expect(heightFogAmount(50, 0.1, 0, 0.02, 0.05, 0)).toBe(0);
    expect(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0)).toBeGreaterThan(0);
    expect(heightFogAmount(50, 0.1, 200, 0.02, 0.05, 0)).toBeGreaterThan(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0));
    expect(heightFogAmount(50, -0.1, 100, 0.02, 0.05, 0)).toBeGreaterThan(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0));
  });

  it("a camera higher above the level sees thinner fog", () => {
    expect(heightFogAmount(200, 0, 100, 0.02, 0.05, 0)).toBeLessThan(heightFogAmount(20, 0, 100, 0.02, 0.05, 0));
  });
});
