import { describe, it, expect } from "vitest";
import { EXPLORE_HOUR_S, EXPLORE_SCHEDULE, exploreHour, exploreNight, exploreWeather } from "../../src/game/exploreDay.js";
import { WEATHER_PRESETS, lerpWeather } from "../../src/game/weather.js";

describe("the explore day's clock", () => {
  it("runs round the clock at forty seconds an hour, a day in sixteen minutes", () => {
    expect(EXPLORE_HOUR_S).toBe(40);
    expect(exploreHour(6, 0)).toBe(6);
    expect(exploreHour(6, EXPLORE_HOUR_S)).toBe(7);
    expect(exploreHour(6, 24 * EXPLORE_HOUR_S)).toBe(6);
    expect(exploreHour(23, 1.5 * EXPLORE_HOUR_S)).toBeCloseTo(0.5, 9);
    expect(24 * EXPLORE_HOUR_S).toBe(16 * 60);
  });

  it("starts from the hour the console set, any hour of the day, and never runs back", () => {
    expect(exploreHour(12, 0)).toBe(12);
    expect(exploreHour(22, 0)).toBe(22);
    expect(exploreHour(3, 0)).toBe(3);
    expect(exploreHour(24, 0)).toBe(0);
    expect(exploreHour(12, -5)).toBe(12);
  });
});

describe("the explore day's night", () => {
  it("is none by day, comes in over the two hours to ten and goes out over the two to six, for the birds alone", () => {
    expect(exploreNight(12)).toBe(0);
    expect(exploreNight(20)).toBe(0);
    expect(exploreNight(21)).toBe(0.5);
    expect(exploreNight(22)).toBe(1);
    expect(exploreNight(2)).toBe(1);
    expect(exploreNight(5)).toBe(0.5);
    expect(exploreNight(6)).toBe(0);
    expect(exploreNight(30)).toBe(0);
  });
});

describe("the explore day's weather", () => {
  it("meets every preset but the eerie one, midnight to midnight, a preset at each hour of the schedule, the ends the same", () => {
    expect(EXPLORE_SCHEDULE[0]!.hour).toBe(0);
    expect(EXPLORE_SCHEDULE.at(-1)!.hour).toBe(24);
    expect(EXPLORE_SCHEDULE.at(-1)!.weather).toBe(EXPLORE_SCHEDULE[0]!.weather);
    expect(new Set(EXPLORE_SCHEDULE.map((s) => s.weather))).toEqual(new Set(["clear", "bright", "overcast", "mist", "rain"]));
    for (const { hour, weather } of EXPLORE_SCHEDULE) {
      const at = exploreWeather(hour);
      expect(at.name).toBe(weather);
      expect(at.weather).toEqual(WEATHER_PRESETS[weather]);
      expect(at.weather.dread).toBe(0);
    }
  });

  it("turns every hour and a half or two, rains twice a day, and lerps between the schedule's neighbours, named for the nearer", () => {
    const hours = EXPLORE_SCHEDULE.map((s) => s.hour);
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i]! - hours[i - 1]!).toBeGreaterThanOrEqual(1.5);
      expect(hours[i]! - hours[i - 1]!).toBeLessThanOrEqual(2);
    }
    expect(EXPLORE_SCHEDULE.filter((s) => s.weather === "rain")).toHaveLength(2);
    expect(exploreWeather(10.25).weather).toEqual(lerpWeather(WEATHER_PRESETS.rain, WEATHER_PRESETS.bright, 0.5));
    expect(exploreWeather(9).name).toBe("rain");
    expect(exploreWeather(8.5).name).toBe("overcast");
    expect(exploreWeather(23).weather).toEqual(lerpWeather(WEATHER_PRESETS.mist, WEATHER_PRESETS.overcast, 0.5));
    expect(exploreWeather(24)).toEqual(exploreWeather(0));
    expect(exploreWeather(-1)).toEqual(exploreWeather(23));
  });

  it("comes in and goes out through the lines the voice answers: the rain past half, the fog in its band", () => {
    const rain = exploreWeather(9.1).weather;
    expect(rain.rain).toBeGreaterThanOrEqual(0.5);
    expect(rain.rain).toBeLessThan(1);
    const fog = exploreWeather(14.6).weather;
    expect(fog.mist).toBeGreaterThanOrEqual(0.2);
    expect(fog.mist).toBeLessThanOrEqual(0.6);
  });
});
