import { describe, it, expect } from "vitest";
import { EXPLORE_DAWN, EXPLORE_DUSK, EXPLORE_HOUR_S, EXPLORE_SCHEDULE, exploreHour, exploreWeather } from "../../src/game/exploreDay.js";
import { WEATHER_PRESETS, lerpWeather } from "../../src/game/weather.js";

describe("the explore day's clock", () => {
  it("runs from dawn at two minutes an hour and wraps to dawn at dusk", () => {
    expect([EXPLORE_DAWN, EXPLORE_DUSK, EXPLORE_HOUR_S]).toEqual([6, 20, 120]);
    expect(exploreHour(6, 0)).toBe(6);
    expect(exploreHour(6, EXPLORE_HOUR_S)).toBe(7);
    expect(exploreHour(6, 14 * EXPLORE_HOUR_S)).toBe(6);
    expect(exploreHour(6, 14.5 * EXPLORE_HOUR_S)).toBeCloseTo(6.5, 9);
  });

  it("starts from the hour the console set when it is daylight, and from dawn when it is the night", () => {
    expect(exploreHour(12, 0)).toBe(12);
    expect(exploreHour(19.5, EXPLORE_HOUR_S)).toBeCloseTo(6.5, 9);
    expect(exploreHour(22, 0)).toBe(6);
    expect(exploreHour(3, 0)).toBe(6);
    expect(exploreHour(20, 0)).toBe(6);
    expect(exploreHour(12, -5)).toBe(12);
  });
});

describe("the explore day's weather", () => {
  it("meets every preset but the eerie one, dawn to dusk, a preset at each hour of the schedule", () => {
    expect(EXPLORE_SCHEDULE.map((s) => s.hour)).toEqual([6, 8, 10, 12, 14, 16, 18, 20]);
    expect(new Set(EXPLORE_SCHEDULE.map((s) => s.weather))).toEqual(new Set(["clear", "bright", "overcast", "mist", "rain"]));
    for (const { hour, weather } of EXPLORE_SCHEDULE) {
      const at = exploreWeather(hour);
      expect(at.name).toBe(weather);
      expect(at.weather).toEqual(WEATHER_PRESETS[weather]);
      expect(at.weather.dread).toBe(0);
    }
  });

  it("lerps between the schedule's neighbours, named for the nearer, and never beyond the day", () => {
    expect(exploreWeather(13).weather).toEqual(lerpWeather(WEATHER_PRESETS.mist, WEATHER_PRESETS.rain, 0.5));
    expect(exploreWeather(12.5).name).toBe("mist");
    expect(exploreWeather(13.5).name).toBe("rain");
    expect(exploreWeather(14.5).weather.rain).toBeCloseTo(0.75, 9);
    expect(exploreWeather(5)).toEqual(exploreWeather(6));
    expect(exploreWeather(21)).toEqual(exploreWeather(20));
  });

  it("comes in and goes out through the lines the voice answers: the rain past half, the fog in its band", () => {
    const rain = exploreWeather(13.6).weather;
    expect(rain.rain).toBeGreaterThanOrEqual(0.5);
    expect(rain.rain).toBeLessThan(1);
    const fog = exploreWeather(10.8).weather;
    expect(fog.mist).toBeGreaterThanOrEqual(0.2);
    expect(fog.mist).toBeLessThanOrEqual(0.6);
  });
});
