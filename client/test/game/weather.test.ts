import { describe, it, expect } from "vitest";
import {
  airColourUnder, ambientGainsUnder, exposureUnder,
  fogDensityUnder, mistOpacityUnder,
  saturationUnder, shadowDarknessUnder, wetSurfaceUnder,
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
  vignetteWeightUnder,
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
  stepped,
  dreadWorldUnder,
  dreadLensUnder,
  ambientCollapseUnder,
  AMBIENT_COLLAPSE,
  DREAD_PLATEAUS,
  DREAD_STEP_EDGE,
  canopyWaterStep,
  rainHissCentreHz,
  rainWindCut,
} from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";
import { exposureFor, fogDensityFor, sunPositionAt } from "../../src/game/sky.js";
import { desaturateRgb, luma, type Rgb } from "../../src/game/colour.js";

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
/** Horizon colours the fog is built over: a noon blue, a sunset orange
 * brighter than 1, a dusk and a deep night. */
const BASES: readonly Rgb[] = [
  { r: 0.42, g: 0.58, b: 0.82 },
  { r: 1.4, g: 0.62, b: 0.21 },
  { r: 0.11, g: 0.09, b: 0.14 },
  { r: 0.02, g: 0.03, b: 0.06 },
];

describe("clear-identity sweep — the sunny look survives, exactly", () => {
  it("the exposure at clear is the altitude's own at every hour", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      const altitude = sunPositionAt(hour).y;
      expect(exposureUnder(CLEAR, altitude)).toBe(exposureFor(altitude));
    }
  });

  it("every scalar modifier at clear is the identity or zero", () => {
    expect(fogDensityUnder(CLEAR, 4000)).toBe(fogDensityFor(4000));
    expect(shadowDarknessUnder(CLEAR)).toBe(0);
    expect(saturationUnder(CLEAR)).toBe(0); // Babylon curves: 0 is neutral
    expect(wetSurfaceUnder(CLEAR)).toEqual({ albedoScale: 1, roughnessScale: 1 });
    expect(mistOpacityUnder(CLEAR)).toBe(0);
    expect(ambientGainsUnder(CLEAR)).toEqual({ rain: 0, wind: 0 });
    // The hiss under clear: its resting centre, uncut by clear's light wind.
    expect(rainHissCentreHz(CLEAR.rain)).toBe(3000);
    expect(rainWindCut(windRecordUnder(CLEAR, 0).speed)).toBe(1);
  });
});

describe("the rain's sound", () => {
  it("the hiss's band centre falls from 3 kHz to 1.8 kHz with the rain, clamped", () => {
    expect(rainHissCentreHz(0)).toBe(3000);
    expect(rainHissCentreHz(1)).toBe(1800);
    expect(rainHissCentreHz(0.5)).toBe(2400);
    expect(rainHissCentreHz(0.25)).toBe(2700);
    expect(rainHissCentreHz(-1)).toBe(3000);
    expect(rainHissCentreHz(2)).toBe(1800);
    expect(rainHissCentreHz(RAIN.rain)).toBe(1800);
  });

  it("the wind cuts the hiss by up to a third, from 0.6 to full speed, smoothly", () => {
    expect(rainWindCut(0)).toBe(1);
    expect(rainWindCut(0.25)).toBe(1);
    expect(rainWindCut(0.6)).toBe(1);
    expect(rainWindCut(0.7)).toBeCloseTo(0.9484375, 10); // smoothstep at 0.25 is 0.15625
    expect(rainWindCut(0.8)).toBeCloseTo(0.835, 10);
    expect(rainWindCut(0.9)).toBeCloseTo(0.7215625, 10); // at 0.75, 0.84375
    expect(rainWindCut(1)).toBeCloseTo(0.67, 10);
    expect(rainWindCut(1.5)).toBeCloseTo(0.67, 10);
    let prev = 1;
    for (let v = 0; v <= 1; v += 0.05) {
      const cut = rainWindCut(v);
      expect(cut).toBeLessThanOrEqual(prev + 1e-12);
      prev = cut;
    }
  });

  it("the canopy wets up in a minute of full rain and drains over ten", () => {
    expect(canopyWaterStep(0, 1, 1)).toBeCloseTo(1 / 60, 12);
    expect(canopyWaterStep(0, 1, 30)).toBeCloseTo(0.5, 12);
    expect(canopyWaterStep(0, 1, 60)).toBe(1);
    expect(canopyWaterStep(0, 0.5, 60)).toBeCloseTo(0.5, 12);
    expect(canopyWaterStep(0, 0.5, 120)).toBe(1);
    expect(canopyWaterStep(0.9, 1, 60)).toBe(1); // clamped at full
    expect(canopyWaterStep(1, 0, 60)).toBeCloseTo(0.9, 12);
    expect(canopyWaterStep(1, 0, 300)).toBeCloseTo(0.5, 12);
    expect(canopyWaterStep(1, 0, 600)).toBe(0);
    expect(canopyWaterStep(0.05, 0, 60)).toBe(0); // clamped at dry
    expect(canopyWaterStep(0, 0, 60)).toBe(0);
    // The eerie preset's 0.3 of rain fills it in 200 s.
    expect(canopyWaterStep(0, WEATHER_PRESETS.eerie.rain, 200)).toBeCloseTo(1, 12);
    // A frame at a time reaches the same place as one long step.
    let w = 0;
    for (let i = 0; i < 600; i++) w = canopyWaterStep(w, 1, 0.1);
    expect(w).toBe(1);
    for (let i = 0; i < 3000; i++) w = canopyWaterStep(w, 0, 0.1);
    expect(w).toBeCloseTo(0.5, 6);
    // Half the rain, half the rate; a frame's step down from half full.
    expect(canopyWaterStep(0, 0.5, 30)).toBeCloseTo(0.25, 12);
    expect(canopyWaterStep(0.5, 0, 1 / 60)).toBeCloseTo(0.5 - 1 / 36000, 12);
    // A second at a time: sixty of rain fill it, six hundred of none drain it.
    let s = 0;
    for (let i = 0; i < 60; i++) s = canopyWaterStep(s, 1, 1);
    expect(s).toBeCloseTo(1, 9);
    for (let i = 0; i < 600; i++) s = canopyWaterStep(s, 0, 1);
    expect(s).toBeCloseTo(0, 9);
  });
});

describe("modifiers under weather", () => {
  it("full mist multiplies fog 12x", () => {
    expect(fogDensityUnder(MIST, 4000)).toBeCloseTo(12 * fogDensityFor(4000), 10);
  });

  it("shadow darkness and saturation reach their overcast extremes", () => {
    expect(shadowDarknessUnder(RAIN)).toBe(1);
    expect(saturationUnder(RAIN)).toBe(-SATURATION_DROP);
  });

  it("fog is monotonic in mist", () => {
    let prevFog = 0;
    for (let m = 0; m <= 1; m += 0.1) {
      const v = fogDensityUnder({ ...CLEAR, mist: m }, 4000);
      expect(v).toBeGreaterThanOrEqual(prevFog);
      prevFog = v;
    }
  });

  it("wetness darkens and glosses", () => {
    const wet = wetSurfaceUnder(RAIN);
    expect(wet.albedoScale).toBeCloseTo(0.62, 10);
    expect(wet.roughnessScale).toBeCloseTo(0.6, 10);
  });

  it("rain thickens the fog by half on top of the mist, and greys it toward its own luminance", () => {
    // Rain alone: 1.5x. The rain preset's mist of 0.6 is 7.6x; with the rain, 11.4x.
    expect(fogDensityUnder({ ...CLEAR, rain: 1 }, 4000)).toBeCloseTo(1.5 * fogDensityFor(4000), 10);
    expect(fogDensityUnder({ ...CLEAR, rain: 0.5 }, 4000)).toBeCloseTo(1.25 * fogDensityFor(4000), 10);
    expect(fogDensityUnder(RAIN, 4000)).toBeCloseTo(11.4 * fogDensityFor(4000), 10);
    expect(fogDensityUnder(RAIN, 4000)).toBeCloseTo(1.5 * fogDensityUnder({ ...RAIN, rain: 0 }, 4000), 10);
    for (const base of BASES) {
      const dry = airColourUnder({ ...RAIN, rain: 0 }, base);
      const wet = airColourUnder(RAIN, base);
      const spread = (c: { r: number; g: number; b: number }) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      // The pull is toward the colour's own luminance, so the luminance holds
      // and the colour's spread shrinks by the 0.3 pulled out.
      expect(luma(wet)).toBeCloseTo(luma(dry), 10);
      expect(spread(wet)).toBeCloseTo(0.7 * spread(dry), 10);
      const half = airColourUnder({ ...RAIN, rain: 0.5 }, base);
      expect(spread(half)).toBeCloseTo(0.85 * spread(dry), 10);
    }
  });

  it("ambience: rain drives patter; mist and cloud drive wind", () => {
    expect(ambientGainsUnder(RAIN)).toEqual({ rain: 1, wind: 0.8 });
    expect(ambientGainsUnder(MIST).wind).toBeCloseTo(0.8, 10);
  });
});

describe("dread modifiers — identity at dread 0, monotonic toward the pit", () => {
  const DREAD_ONLY: WeatherParams = { cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 1 };

  it("dread alone shifts the fog's balance toward green", () => {
    const plain = airColourUnder(CLEAR, BASES[0]!);
    const pulled = airColourUnder(DREAD_ONLY, BASES[0]!);
    const greenShare = (c: { r: number; g: number; b: number }) => c.g / (c.r + c.g + c.b);
    expect(pulled).not.toEqual(plain);
    expect(greenShare(pulled)).toBeGreaterThan(greenShare(plain));
  });

  it("dread never brightens the fog — no glowing air at night", () => {
    for (const base of BASES) {
      expect(luma(airColourUnder(DREAD_ONLY, base))).toBeLessThanOrEqual(luma(airColourUnder(CLEAR, base)) + 1e-12);
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

  it("vignette sits exactly at baseline at dread 0 and deepens with dread", () => {
    expect(vignetteWeightUnder(CLEAR)).toBe(VIGNETTE_WEIGHT_BASE);
    expect(vignetteWeightUnder(DREAD_ONLY)).toBeGreaterThan(VIGNETTE_WEIGHT_BASE);
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

describe("stepped dread — the world moves in plateaus, the lens moves continuously", () => {
  it("is exact at 0 and 1 and monotonic between", () => {
    expect(stepped(0)).toBe(0);
    expect(stepped(1)).toBe(1);
    let last = 0;
    for (let d = 0; d <= 1; d += 0.001) {
      const s = stepped(d);
      expect(s).toBeGreaterThanOrEqual(last - 1e-12);
      last = s;
    }
  });

  it("sits on a plateau away from the edges", () => {
    const step = 1 / (DREAD_PLATEAUS - 1);
    for (let i = 0; i < DREAD_PLATEAUS; i++) {
      const centre = i * step;
      const probe = Math.min(1, Math.max(0, centre + (i === DREAD_PLATEAUS - 1 ? -0.5 : 0.5) * (step - 2 * DREAD_STEP_EDGE)));
      expect(stepped(probe)).toBeCloseTo(centre, 10);
    }
  });

  it("clear is the identity for every derived value", () => {
    expect(dreadWorldUnder(WEATHER_PRESETS.clear)).toBe(0);
    expect(dreadLensUnder(WEATHER_PRESETS.clear)).toBe(0);
    expect(ambientCollapseUnder(WEATHER_PRESETS.clear)).toBe(1);
  });

  it("eerie reaches the top plateau and the full collapse", () => {
    expect(dreadWorldUnder(WEATHER_PRESETS.eerie)).toBe(1);
    expect(dreadLensUnder(WEATHER_PRESETS.eerie)).toBe(1);
    expect(ambientCollapseUnder(WEATHER_PRESETS.eerie)).toBeCloseTo(1 - AMBIENT_COLLAPSE, 10);
  });

  it("a mid-fade dread holds the world on a plateau while the lens keeps moving", () => {
    const a = { ...WEATHER_PRESETS.eerie, dread: 0.36 };
    const b = { ...WEATHER_PRESETS.eerie, dread: 0.42 };
    expect(dreadWorldUnder(a)).toBe(dreadWorldUnder(b));
    expect(dreadLensUnder(b)).toBeGreaterThan(dreadLensUnder(a));
    expect(airColourUnder(a, BASES[1]!)).toEqual(airColourUnder(b, BASES[1]!));
  });
});

describe("airColourUnder: the air over a horizon colour from the sky, with no dusk dimming of its own", () => {
  /** A day sky and a dusk horizon, a red sunset horizon past 1, a dim twilight and the night floor. */
  const BASES: Rgb[] = [
    { r: 0.42, g: 0.58, b: 0.82 },
    { r: 0.62, g: 0.5, b: 0.42 },
    { r: 2.6, g: 0.93, b: 0.63 },
    { r: 0.13, g: 0.12, b: 0.21 },
    { r: 0.02, g: 0.03, b: 0.06 },
  ];
  const spread = (c: Rgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

  it("is exactly the base at clear, as a copy", () => {
    for (const base of BASES) {
      const air = airColourUnder(CLEAR, base);
      expect(air).toEqual(base);
      expect(air).not.toBe(base);
    }
  });

  it("pulls halfway to mist air scaled to the base's luma under full mist, the target capped at 1.2 times mist air", () => {
    const MIST_ONLY: WeatherParams = { ...CLEAR, mist: 1 };
    // A base dimmer than 1.2 times mist air's luma (0.5972): the target has the base's own luma.
    for (const base of [BASES[0]!, BASES[3]!, BASES[4]!]) {
      expect(luma(airColourUnder(MIST_ONLY, base))).toBeCloseTo(luma(base), 12);
    }
    // A white base: the target is mist air (0.58, 0.6, 0.62) times 1.2.
    const white = airColourUnder(MIST_ONLY, { r: 1, g: 1, b: 1 });
    expect(white.r).toBeCloseTo(0.848, 12);
    expect(white.g).toBeCloseTo(0.86, 12);
    expect(white.b).toBeCloseTo(0.872, 12);
  });

  it("desaturates by 0.9 of the cloud and never dims: the deck already darkens a cloudy dusk", () => {
    for (const base of BASES) {
      for (const cloudCover of [0.5, 0.8, 1]) {
        const air = airColourUnder({ ...CLEAR, cloudCover }, base);
        const expected = desaturateRgb(base, 0.9 * cloudCover);
        expect(air.r).toBeCloseTo(expected.r, 12);
        expect(air.g).toBeCloseTo(expected.g, 12);
        expect(air.b).toBeCloseTo(expected.b, 12);
        expect(luma(air)).toBeCloseTo(luma(base), 12);
      }
    }
  });

  it("greys toward its own luminance under rain, holding the luma", () => {
    for (const base of BASES) {
      const dry = airColourUnder({ ...RAIN, rain: 0 }, base);
      const wet = airColourUnder(RAIN, base);
      expect(luma(wet)).toBeCloseTo(luma(dry), 10);
      expect(spread(wet)).toBeCloseTo(0.7 * spread(dry), 10);
      const half = airColourUnder({ ...RAIN, rain: 0.5 }, base);
      expect(spread(half)).toBeCloseTo(0.85 * spread(dry), 10);
    }
  });

  it("pulls toward the dread air, greener and never brighter", () => {
    const DREAD_ONLY: WeatherParams = { ...CLEAR, dread: 1 };
    const greenShare = (c: Rgb) => c.g / (c.r + c.g + c.b);
    for (const base of BASES) {
      const pulled = airColourUnder(DREAD_ONLY, base);
      expect(pulled).not.toEqual(base);
      expect(luma(pulled)).toBeLessThanOrEqual(luma(base) + 1e-12);
    }
    expect(greenShare(airColourUnder(DREAD_ONLY, BASES[0]!))).toBeGreaterThan(greenShare(BASES[0]!));
    expect(greenShare(airColourUnder(DREAD_ONLY, BASES[2]!))).toBeGreaterThan(greenShare(BASES[2]!));
  });

  it("holds the air on a dread plateau while the lens keeps moving", () => {
    const a = { ...WEATHER_PRESETS.eerie, dread: 0.36 };
    const b = { ...WEATHER_PRESETS.eerie, dread: 0.42 };
    for (const base of BASES) expect(airColourUnder(a, base)).toEqual(airColourUnder(b, base));
  });
});
