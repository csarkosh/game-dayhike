import { describe, it, expect } from "vitest";
import {
  CALM_GLASS_FROM, CALM_GLASS_TO, CALM_MIST_DAY, CALM_OVERCAST_ENDS, CALM_RAMP_DOWN_END, CALM_RAMP_UP_START,
  ROUGH_RAIN, ROUGH_RAIN_FROM, ROUGH_RAIN_TO, ROUGH_SHELTER, ROUGH_WIND01, ROUGH_WIND_FROM, ROUGH_WIND_TO,
  SLOPE_CRISP_DEG, SLOPE_GLASS_DEG, SLOPE_PAW_DEG,
  calmShare, isRough, roughShare, smearPx,
} from "../../src/game/lakeCalm.js";
import { WEATHER_PRESETS, type WeatherPresetName } from "../../src/game/weather.js";

/** The hours every row is read at: the table's edges, both ramps' midpoints, dawn and night. */
const HOURS = [0, 4.5, 6.25, 8, 8.5, 9, 12, 17, 17.5, 18, 22] as const;

/** The design's table (§4.1) at HOURS, by preset. */
const TABLE: Record<WeatherPresetName, readonly number[]> = {
  clear: [1, 1, 1, 1, 0.5, 0, 0, 0, 0.5, 1, 1],
  bright: [1, 1, 1, 1, 0.5, 0, 0, 0, 0.5, 1, 1],
  eerie: [1, 1, 1, 1, 0.5, 0, 0, 0, 0.5, 1, 1],
  mist: [1, 1, 1, 1, 0.65, 0.3, 0.3, 0.3, 0.65, 1, 1],
  overcast: [0.3, 0.3, 0.3, 0.3, 0.15, 0, 0, 0, 0.15, 0.3, 0.3],
  rain: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

describe("the calm's constants", () => {
  it("are the design's literals", () => {
    expect(CALM_GLASS_FROM).toBe(18);
    expect(CALM_GLASS_TO).toBe(8);
    expect(CALM_RAMP_DOWN_END).toBe(9);
    expect(CALM_RAMP_UP_START).toBe(17);
    expect(CALM_MIST_DAY).toBe(0.3);
    expect(CALM_OVERCAST_ENDS).toBe(0.3);
    expect(SLOPE_GLASS_DEG).toBe(0);
    expect(SLOPE_PAW_DEG).toBe(4);
    expect(SLOPE_CRISP_DEG).toBe(0.07);
    expect(ROUGH_WIND01).toBe(0.7);
    expect(ROUGH_SHELTER).toBe(0.3);
    expect(ROUGH_RAIN).toBe(0.35);
    expect([ROUGH_RAIN_FROM, ROUGH_RAIN_TO]).toEqual([0.25, 0.45]);
    expect([ROUGH_WIND_FROM, ROUGH_WIND_TO]).toEqual([0.6, 0.8]);
  });
});

describe("calmShare", () => {
  for (const name of Object.keys(TABLE) as WeatherPresetName[]) {
    it(`is the table's row for ${name} at every hour read`, () => {
      const row = TABLE[name];
      HOURS.forEach((hour, i) => {
        expect(calmShare(hour, name), `${name} at ${hour}`).toBeCloseTo(row[i]!, 12);
      });
    });
  }

  it("ramps linearly: a quarter of the way down at 08:15, three quarters of the way up at 17:45", () => {
    expect(calmShare(8.25, "clear")).toBeCloseTo(0.75, 12);
    expect(calmShare(17.75, "clear")).toBeCloseTo(0.75, 12);
    expect(calmShare(8.25, "mist")).toBeCloseTo(0.825, 12);
    expect(calmShare(17.75, "overcast")).toBeCloseTo(0.225, 12);
  });

  it("wraps the hour: 24 is midnight, −1 is 23:00, 32.5 is 08:30", () => {
    expect(calmShare(24, "clear")).toBe(1);
    expect(calmShare(-1, "overcast")).toBeCloseTo(0.3, 12);
    expect(calmShare(32.5, "clear")).toBeCloseTo(0.5, 12);
    expect(calmShare(-12, "clear")).toBe(0);
  });

  it("gives 0, never NaN, for a non-finite hour", () => {
    expect(calmShare(Number.NaN, "clear")).toBe(0);
    expect(calmShare(Number.POSITIVE_INFINITY, "mist")).toBe(0);
  });
});

describe("smearPx", () => {
  it("is 2σ · H / fov: 27 px a degree at 1080p and 54 at 4K under the game's 1.4 rad", () => {
    expect(smearPx(1, 1080, 1.4)).toBeCloseTo(26.927937030769655, 10);
    expect(smearPx(1, 2160, 1.4)).toBeCloseTo(53.85587406153931, 10);
  });

  it("is under 2 px at 1080p at the crisp bound, and under 4 at 4K", () => {
    expect(smearPx(0.07, 1080, 1.4)).toBeCloseTo(1.884955592153876, 10);
    expect(smearPx(0.07, 2160, 1.4)).toBeCloseTo(3.769911184307752, 10);
    expect(smearPx(SLOPE_CRISP_DEG, 1080, 1.4)).toBeLessThan(2);
  });

  it("is 0 on glass and over a hundred pixels under a paw at 1080p", () => {
    expect(smearPx(SLOPE_GLASS_DEG, 1080, 1.4)).toBe(0);
    expect(smearPx(SLOPE_PAW_DEG, 1080, 1.4)).toBeCloseTo(107.71174812307862, 10);
  });
});

describe("isRough", () => {
  const dry = { ...WEATHER_PRESETS.clear, rain: 0 };
  const wet = { ...WEATHER_PRESETS.clear, rain: 0.36 };
  const drizzle = { ...WEATHER_PRESETS.clear, rain: 0.35 };

  it("holds under rain above the drizzle, at any wind and shelter", () => {
    expect(isRough(wet, 0.25, 0.1)).toBe(true);
    expect(isRough(wet, 0.25, 0.3)).toBe(true);
    expect(isRough(WEATHER_PRESETS.rain, 0.9, 0.1)).toBe(true);
    expect(isRough(drizzle, 0.25, 0.1)).toBe(false);
  });

  it("holds above a wind of 0.7 on a body of shelter 0.3, and not at 0.7", () => {
    expect(isRough(dry, 0.71, 0.3)).toBe(true);
    expect(isRough(dry, 0.7, 0.3)).toBe(false);
  });

  it("never holds by the wind on a sheltered body of 0.1", () => {
    expect(isRough(dry, 0.71, 0.1)).toBe(false);
    expect(isRough(dry, 1, 0.1)).toBe(false);
    expect(isRough(dry, 0.7, 0.1)).toBe(false);
  });

  it("is false under clear and bright skies at their own winds", () => {
    expect(isRough(WEATHER_PRESETS.clear, 0.25, 0.3)).toBe(false);
    expect(isRough(WEATHER_PRESETS.bright, 0.4075, 0.3)).toBe(false);
    expect(isRough(WEATHER_PRESETS.mist, 0.565, 0.3)).toBe(false);
    expect(isRough(WEATHER_PRESETS.overcast, 0.53, 0.3)).toBe(false);
  });

  it("does not hold under the eerie preset, whose drizzle is 0.3", () => {
    expect(isRough(WEATHER_PRESETS.eerie, 0.69, 0.1)).toBe(false);
    expect(isRough(WEATHER_PRESETS.eerie, 0.69, 0.3)).toBe(false);
  });
});

describe("roughShare", () => {
  const rainOf = (rain: number) => ({ ...WEATHER_PRESETS.clear, rain });

  it("ramps in with the rain from 0.25 to 0.45, half at the step's 0.35, at any wind and shelter", () => {
    expect(roughShare(rainOf(0.25), 0, 0.1)).toBe(0);
    expect(roughShare(rainOf(0.35), 0, 0.1)).toBe(0.4999999999999998);
    expect(roughShare(rainOf(0.45), 0, 0.1)).toBe(1);
    expect(roughShare(rainOf(0.25), 0, 0.3)).toBe(0);
    expect(roughShare(rainOf(0.35), 0, 0.3)).toBe(0.4999999999999998);
    expect(roughShare(rainOf(0.45), 0, 0.3)).toBe(1);
    expect(roughShare(WEATHER_PRESETS.rain, 0.9, 0.1)).toBe(1);
    // The eerie preset's drizzle, 0.3, takes a little of the glass.
    expect(roughShare(WEATHER_PRESETS.eerie, 0.69, 0.1)).toBe(0.15624999999999994);
  });

  it("ramps in with the wind from 0.6 to 0.8 on a body of shelter 0.3, half at the step's 0.7", () => {
    const dry = rainOf(0);
    expect(roughShare(dry, 0.6, 0.3)).toBe(0);
    expect(roughShare(dry, 0.7, 0.3)).toBe(0.49999999999999956);
    expect(roughShare(dry, 0.8, 0.3)).toBe(1);
  });

  it("never ramps in by the wind on a sheltered body of 0.1", () => {
    const dry = rainOf(0);
    expect(roughShare(dry, 0.6, 0.1)).toBe(0);
    expect(roughShare(dry, 0.7, 0.1)).toBe(0);
    expect(roughShare(dry, 0.8, 0.1)).toBe(0);
    expect(roughShare(dry, 1, 0.1)).toBe(0);
  });

  it("takes the larger of the two, and is 0 under clear and bright skies at their own winds", () => {
    expect(roughShare(rainOf(0.35), 0.75, 0.3)).toBe(0.84375);
    expect(roughShare(rainOf(0.45), 0.7, 0.3)).toBe(1);
    expect(roughShare(WEATHER_PRESETS.clear, 0.25, 0.3)).toBe(0);
    expect(roughShare(WEATHER_PRESETS.bright, 0.4075, 0.3)).toBe(0);
  });
});
