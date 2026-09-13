import { describe, it, expect } from "vitest";
import {
  ambientColourUnder, ambientGainsUnder, exposureUnder, fillIntensityUnder,
  fogColourUnder, fogDensityUnder, mistOpacityUnder, RAIN_CAPACITY,
  rainEmitRateUnder, saturationUnder, shadowDarknessUnder, skyMaterialParamsUnder,
  sunColourUnder, sunIntensityUnder, wetSurfaceUnder,
  DEFAULT_WEATHER,
  lerpWeather,
  weatherFadeAt,
  WEATHER_NAMES,
  WEATHER_PRESETS,
  type WeatherParams,
  SATURATION_DROP,
  MIST_OPACITY_MAX,
  DREAD_EXPOSURE_DIP,
  DREAD_SATURATION_DROP,
  DREAD_MIST_GAIN,
  VIGNETTE_WEIGHT_BASE,
  GRAIN_INTENSITY_BASE,
  vignetteWeightUnder,
  grainIntensityUnder,
  gradeUnder,
  moodUnder,
  GRADE_SHADOW_HUE,
  GRADE_SHADOW_DENSITY,
  GRADE_SHADOW_SATURATION,
  GRADE_MIDTONE_HUE,
  GRADE_MIDTONE_DENSITY,
  GRADE_MIDTONE_SATURATION,
  GRADE_HIGHLIGHT_HUE,
  GRADE_HIGHLIGHT_DENSITY,
  GRADE_HIGHLIGHT_SATURATION,
} from "../../src/game/weather.js";
import {
  ambientColourFor, exposureFor, fillIntensityFor, fogDensityFor,
  skyColourAt, sunColourAt, sunIntensityAt, sunPositionAt,
} from "../../src/game/sky.js";
import { luma } from "../../src/game/colour.js";

describe("weather model", () => {
  it("clear is exactly all zeros — the regression anchor", () => {
    expect(WEATHER_PRESETS.clear).toEqual({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 });
  });

  it("ships the eerie identity as the default", () => {
    expect(DEFAULT_WEATHER).toBe("mist");
    expect(WEATHER_NAMES).toEqual(["clear", "overcast", "mist", "rain", "eerie"]);
  });

  it("eerie is the dread destination the scripted turn aims at", () => {
    expect(WEATHER_PRESETS.eerie).toEqual({ cloudCover: 1, mist: 1, rain: 0.3, wetness: 0.6, dread: 1 });
  });

  it("lerpWeather interpolates dread like every other scalar", () => {
    const mid = lerpWeather(WEATHER_PRESETS.clear, WEATHER_PRESETS.eerie, 0.5);
    expect(mid.dread).toBe(0.5);
  });

  it("every preset scalar sits in [0, 1]", () => {
    for (const name of WEATHER_NAMES) {
      for (const v of Object.values(WEATHER_PRESETS[name])) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lerpWeather returns exact copies at the endpoints", () => {
    const a = WEATHER_PRESETS.clear;
    const b = WEATHER_PRESETS.rain;
    expect(lerpWeather(a, b, 0)).toEqual(a);
    expect(lerpWeather(a, b, 1)).toEqual(b);
    expect(lerpWeather(a, b, 0)).not.toBe(a); // copy, not alias
    expect(lerpWeather(a, b, 0.5).cloudCover).toBeCloseTo(0.5, 10);
  });

  it("weatherFadeAt clamps to the target at and past the duration", () => {
    const a = WEATHER_PRESETS.clear;
    const b = WEATHER_PRESETS.mist;
    expect(weatherFadeAt(a, b, 3, 3)).toEqual(b);
    expect(weatherFadeAt(a, b, 99, 3)).toEqual(b);
    expect(weatherFadeAt(a, b, 0, 3)).toEqual(a);
    expect(weatherFadeAt(a, b, 0, 0)).toEqual(b); // zero duration = instant
    expect(weatherFadeAt(a, b, 1.5, 3).mist).toBeCloseTo(0.5, 10);
  });
});

const CLEAR = WEATHER_PRESETS.clear;
const RAIN = WEATHER_PRESETS.rain;
const MIST = WEATHER_PRESETS.mist;

describe("clear-identity sweep — the sunny look survives, exactly", () => {
  it("every hour-domain modifier at clear returns its base value", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      expect(sunIntensityUnder(CLEAR, hour)).toBe(sunIntensityAt(hour));
      expect(sunColourUnder(CLEAR, hour)).toEqual(sunColourAt(hour));
      expect(ambientColourUnder(CLEAR, hour)).toEqual(ambientColourFor(hour));
      expect(fogColourUnder(CLEAR, hour)).toEqual(skyColourAt(hour));
      const altitude = sunPositionAt(hour).y;
      expect(fillIntensityUnder(CLEAR, altitude)).toBe(fillIntensityFor(altitude));
      expect(exposureUnder(CLEAR, altitude)).toBe(exposureFor(altitude));
    }
  });

  it("every scalar modifier at clear is the identity or zero", () => {
    expect(skyMaterialParamsUnder(CLEAR)).toEqual({
      turbidity: 4, luminance: 1, rayleigh: 2, mieCoefficient: 0.005, mieDirectionalG: 0.8,
    });
    expect(fogDensityUnder(CLEAR, 4000)).toBe(fogDensityFor(4000));
    expect(shadowDarknessUnder(CLEAR)).toBe(0);
    expect(saturationUnder(CLEAR)).toBe(0); // Babylon curves: 0 is neutral
    expect(wetSurfaceUnder(CLEAR)).toEqual({ albedoScale: 1, roughnessScale: 1 });
    expect(mistOpacityUnder(CLEAR)).toBe(0);
    for (const tier of ["low", "medium", "high"] as const) {
      expect(rainEmitRateUnder(CLEAR, tier)).toBe(0);
    }
    expect(ambientGainsUnder(CLEAR)).toEqual({ rain: 0, wind: 0, air: 0 });
  });
});

describe("modifiers under weather", () => {
  it("full cloud kills 90% of direct sun and full mist multiplies fog 12x", () => {
    expect(sunIntensityUnder(RAIN, 12)).toBeCloseTo(0.1 * sunIntensityAt(12), 10);
    expect(fogDensityUnder(MIST, 4000)).toBeCloseTo(12 * fogDensityFor(4000), 10);
  });

  it("shadow darkness and saturation reach their overcast extremes", () => {
    expect(shadowDarknessUnder(RAIN)).toBe(1);
    expect(saturationUnder(RAIN)).toBe(-SATURATION_DROP);
  });

  it("sun dimming is monotonic in cloud cover; fog is monotonic in mist", () => {
    let prev = Infinity;
    for (let c = 0; c <= 1; c += 0.1) {
      const v = sunIntensityUnder({ ...CLEAR, cloudCover: c }, 12);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    let prevFog = 0;
    for (let m = 0; m <= 1; m += 0.1) {
      const v = fogDensityUnder({ ...CLEAR, mist: m }, 4000);
      expect(v).toBeGreaterThanOrEqual(prevFog);
      prevFog = v;
    }
  });

  it("wetness darkens and glosses; rain rate scales with tier capacity", () => {
    const wet = wetSurfaceUnder(RAIN);
    expect(wet.albedoScale).toBeCloseTo(0.62, 10);
    expect(wet.roughnessScale).toBeCloseTo(0.6, 10);
    expect(rainEmitRateUnder(RAIN, "high")).toBe(RAIN_CAPACITY.high);
    expect(rainEmitRateUnder({ ...CLEAR, rain: 0.5 }, "low")).toBe(0.5 * RAIN_CAPACITY.low);
  });

  it("ambience: rain drives patter; mist and cloud drive wind and air", () => {
    expect(ambientGainsUnder(RAIN)).toEqual({ rain: 1, wind: 0.8, air: 0.6 * 0.6 });
    expect(ambientGainsUnder(MIST).wind).toBeCloseTo(0.8, 10);
    expect(ambientGainsUnder(MIST).air).toBeCloseTo(0.6, 10);
  });
});

describe("dread modifiers — identity at dread 0, monotonic toward the pit", () => {
  const DREAD_ONLY: WeatherParams = { cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 1 };

  it("dread alone shifts the fog's balance toward green", () => {
    const base = fogColourUnder(CLEAR, 12);
    const pulled = fogColourUnder(DREAD_ONLY, 12);
    const greenShare = (c: { r: number; g: number; b: number }) => c.g / (c.r + c.g + c.b);
    expect(pulled).not.toEqual(base);
    expect(greenShare(pulled)).toBeGreaterThan(greenShare(base));
  });

  it("dread never brightens the fog — no glowing air at night", () => {
    for (let hour = 0; hour <= 24; hour += 0.25) {
      expect(luma(fogColourUnder(DREAD_ONLY, hour))).toBeLessThanOrEqual(
        luma(fogColourUnder(CLEAR, hour)) + 1e-12,
      );
    }
  });

  it("dread dips exposure on top of the cloud dip", () => {
    expect(exposureUnder(DREAD_ONLY, 0.8)).toBeCloseTo(exposureFor(0.8) * (1 - DREAD_EXPOSURE_DIP), 12);
  });

  it("dread drains saturation beyond cloud", () => {
    expect(saturationUnder(WEATHER_PRESETS.eerie)).toBe(-(SATURATION_DROP + DREAD_SATURATION_DROP));
  });

  it("dread thickens mist banks", () => {
    const mistDread: WeatherParams = { cloudCover: 0, mist: 1, rain: 0, wetness: 0, dread: 1 };
    expect(mistOpacityUnder(mistDread)).toBeCloseTo(MIST_OPACITY_MAX * (1 + DREAD_MIST_GAIN), 12);
  });

  it("vignette and grain sit exactly at baseline at dread 0 and deepen with dread", () => {
    expect(vignetteWeightUnder(CLEAR)).toBe(VIGNETTE_WEIGHT_BASE);
    expect(grainIntensityUnder(CLEAR)).toBe(GRAIN_INTENSITY_BASE);
    expect(vignetteWeightUnder(DREAD_ONLY)).toBeGreaterThan(VIGNETTE_WEIGHT_BASE);
    expect(grainIntensityUnder(DREAD_ONLY)).toBeGreaterThan(GRAIN_INTENSITY_BASE);
  });
});

describe("colour grade — rich eerie, identity at clear", () => {
  const CLEAR_W = WEATHER_PRESETS.clear;

  it("applies no colour filter at all under clear", () => {
    // Densities and saturations are what make a hue visible; all must be
    // exactly zero so the sunny frame is untouched. Hues are deliberately
    // NOT asserted zero — Babylon documents density 0 as "no effect", so a
    // constant hue with zero density is inert.
    const g = gradeUnder(CLEAR_W);
    expect(g.shadowsDensity).toBe(0);
    expect(g.shadowsSaturation).toBe(0);
    expect(g.midtonesDensity).toBe(0);
    expect(g.midtonesSaturation).toBe(0);
    expect(g.highlightsDensity).toBe(0);
    expect(g.highlightsSaturation).toBe(0);
    expect(moodUnder(CLEAR_W)).toBe(0);
  });

  it("reaches the full palette under eerie", () => {
    const g = gradeUnder(WEATHER_PRESETS.eerie);
    expect(moodUnder(WEATHER_PRESETS.eerie)).toBe(1);
    expect(g.shadowsHue).toBe(GRADE_SHADOW_HUE);
    expect(g.shadowsDensity).toBe(GRADE_SHADOW_DENSITY);
    expect(g.shadowsSaturation).toBe(GRADE_SHADOW_SATURATION);
    expect(g.midtonesHue).toBe(GRADE_MIDTONE_HUE);
    expect(g.midtonesDensity).toBe(GRADE_MIDTONE_DENSITY);
    expect(g.midtonesSaturation).toBe(GRADE_MIDTONE_SATURATION);
    expect(g.highlightsHue).toBe(GRADE_HIGHLIGHT_HUE);
    expect(g.highlightsDensity).toBe(GRADE_HIGHLIGHT_DENSITY);
    expect(g.highlightsSaturation).toBe(GRADE_HIGHLIGHT_SATURATION);
  });

  it("lifts midtone colour and drains highlights — rich, not cheerful", () => {
    expect(GRADE_MIDTONE_SATURATION).toBeGreaterThan(0);
    expect(GRADE_HIGHLIGHT_SATURATION).toBeLessThan(0);
  });

  it("keeps every value inside Babylon's documented ranges", () => {
    for (const name of WEATHER_NAMES) {
      const g = gradeUnder(WEATHER_PRESETS[name]);
      for (const hue of [g.shadowsHue, g.midtonesHue, g.highlightsHue]) {
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThanOrEqual(360);
      }
      for (const v of [
        g.shadowsDensity, g.shadowsSaturation,
        g.midtonesDensity, g.midtonesSaturation,
        g.highlightsDensity, g.highlightsSaturation,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-100);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("is monotonic in the mood driver", () => {
    let prev = -Infinity;
    for (let c = 0; c <= 1; c += 0.02) {
      const g = gradeUnder({ cloudCover: c, mist: 0, rain: 0, wetness: 0, dread: 0 });
      expect(g.midtonesDensity).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = g.midtonesDensity;
    }
  });

  it("greyness stops carrying the mood — the crush is much smaller now", () => {
    expect(SATURATION_DROP).toBe(5);
  });
});
