import { describe, expect, it } from "vitest";
import { createWorldLight } from "../../../src/game/lite/worldLight.js";
import { atmosphereUnder } from "../../../src/game/atmosphereParams.js";
import { sunPositionAt } from "@csarkosh/engine/game/sky";
import { sceneLightsUnder } from "@csarkosh/engine/game/sceneLights";
import { skyStateFor } from "@csarkosh/engine/game/skyState";
import { createSkyTable } from "@csarkosh/engine/game/skyTable";
import { DEFAULT_HOUR } from "@csarkosh/engine/game/skyWait";
import { DEFAULT_WEATHER, WEATHER_PRESETS, exposureUnder, lerpWeather } from "@csarkosh/engine/game/weather";
import { skyFixture } from "../helpers/skyFixture.js";

const VIEW = 4000;

describe("the hour and the weather a renderer is set to, as light", () => {
  it("starts at the default hour under the default weather, with the lights, the air and the exposure the game computes for them", () => {
    const light = createWorldLight(skyFixture(), VIEW);
    const weather = WEATHER_PRESETS[DEFAULT_WEATHER];
    expect(light.hour).toBe(DEFAULT_HOUR);
    expect(light.weather).toEqual(weather);
    const sky = skyStateFor(skyFixture(), DEFAULT_HOUR, weather);
    expect(light.sky).toEqual(sky);
    expect(light.lights).toEqual(sceneLightsUnder(weather, sky));
    expect(light.air).toEqual(atmosphereUnder(weather, sky, VIEW));
    expect(light.exposure).toBe(exposureUnder(weather, sunPositionAt(DEFAULT_HOUR).y));
    expect({ ...light.sunTravel }).toEqual(light.lights?.sun.direction);
    light.dispose();
  });

  it("applies the hour and the weather together once, the weather at once", () => {
    const light = createWorldLight(skyFixture(), VIEW);
    const before = light.version;
    light.setView(9, WEATHER_PRESETS.rain);
    expect(light.version).toBe(before + 1);
    expect(light.hour).toBe(9);
    expect(light.weather).toEqual(WEATHER_PRESETS.rain);
    expect(light.lights).toEqual(sceneLightsUnder(WEATHER_PRESETS.rain, skyStateFor(skyFixture(), 9, WEATHER_PRESETS.rain)));
    light.dispose();
  });

  it("fades the weather as its frames are stepped, and ends on the weather asked for", () => {
    const light = createWorldLight(skyFixture(), VIEW);
    const from = light.weather;
    light.setWeather(WEATHER_PRESETS.mist, 2);
    // Nothing moves until a frame steps the fade.
    expect(light.weather).toEqual(from);
    light.step(0.5);
    const part = light.weather;
    expect(part.mist).toBeGreaterThan(from.mist);
    expect(part.mist).toBeLessThan(WEATHER_PRESETS.mist.mist);
    expect(light.air?.baseDensity).toBe(atmosphereUnder(part, skyStateFor(skyFixture(), DEFAULT_HOUR, part), VIEW).baseDensity);
    light.step(5);
    expect(light.weather).toEqual(lerpWeather(from, WEATHER_PRESETS.mist, 1));
    const settled = light.version;
    light.step(1);
    expect(light.version).toBe(settled);
    // A fade of no seconds is the weather at once.
    light.setWeather(WEATHER_PRESETS.clear, 0);
    expect(light.weather).toEqual(WEATHER_PRESETS.clear);
    light.dispose();
  });

  it("moves the sun's direction alone with a followed hour, and the whole state at the next apply", () => {
    const light = createWorldLight(skyFixture(), VIEW);
    const sky = light.sky;
    const before = light.version;
    light.followHour(15);
    expect(light.hour).toBe(15);
    expect(light.sky).toBe(sky);
    expect(light.version).toBe(before + 1);
    const toSun = sunPositionAt(15);
    expect(light.sunTravel.x).toBe(-toSun.x);
    expect(light.sunTravel.y).toBe(-toSun.y);
    expect(light.sunTravel.z).toBe(-toSun.z);
    light.setWeather(light.weather, 0);
    expect(light.sky).toEqual(skyStateFor(skyFixture(), 15, light.weather));
    light.dispose();
  });

  it("has no state while the table lacks the hour's slices, knows the exposure all the same, and follows no hour", () => {
    const empty = createSkyTable();
    const light = createWorldLight(empty, VIEW);
    expect(light.sky).toBeNull();
    expect(light.lights).toBeNull();
    expect(light.air).toBeNull();
    expect(light.exposure).toBe(exposureUnder(WEATHER_PRESETS[DEFAULT_WEATHER], sunPositionAt(DEFAULT_HOUR).y));
    const travel = { ...light.sunTravel };
    const before = light.version;
    light.followHour(15);
    expect({ ...light.sunTravel }).toEqual(travel);
    expect(light.version).toBe(before);
    light.dispose();
  });
});
