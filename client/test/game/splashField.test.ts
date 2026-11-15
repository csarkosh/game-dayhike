import { describe, expect, it } from "vitest";
import type { AtmosphereRecord } from "../../src/game/atmosphereParams.js";
import type { RainLamp } from "../../src/game/rainField.js";
import { RAIN_MAP, SPLASH_FOLD_S, SPLASH_TIERS, rainSeeds } from "../../src/game/rainParams.js";
import { SplashPlugin } from "../../src/game/rainSplash.js";
import {
  SPLASH_INSTANCE_FLOATS, SPLASH_SEED, SUN_UP, emptySplashStageUniforms, emptySplashUniforms, splashInstances, splashStageUniforms, splashUniforms,
  splashesDrawn,
} from "../../src/game/splashField.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

const CAM = { x: 10, y: 5, z: -20 };
const LAMP_OFF: RainLamp = { x: 10, y: 5, z: -20, dx: 0, dy: 0, dz: 1, intensity: 0, angle: 1.5, r: 1, g: 0.9, b: 0.8 };
const LAMP_ON: RainLamp = { ...LAMP_OFF, intensity: 400 };
/** The light's travel at noon-ish, down and a little north; and at night, up. */
const SUN_HIGH = { x: 0, y: -0.8, z: 0.6 };
const SUN_DOWN = { x: 0, y: 0.8, z: -0.6 };
const AIR = { baseDensity: 0.004, farColour: { r: 0.3, g: 0.4, b: 0.5 } } as AtmosphereRecord;

describe("the splashes with no engine", () => {
  it("names the splash plugin's uniforms, name for name and component for component", () => {
    const declared = SplashPlugin.prototype.getUniforms.call({}).ubo;
    const record = emptySplashUniforms();
    expect(Object.keys(record)).toEqual(declared.map((u) => u.name));
    for (const u of declared) expect((record as Record<string, number[]>)[u.name], u.name).toHaveLength(u.size);
    expect(record.splashMapExtent).toEqual([RAIN_MAP.extent]);
  });

  it("draws the rain value's share of the tier's rings on a map, and none without one, at clear or on low", () => {
    expect(splashesDrawn(WEATHER_PRESETS.rain, "medium", true)).toBe(SPLASH_TIERS.medium);
    expect(splashesDrawn(WEATHER_PRESETS.rain, "high", true)).toBe(SPLASH_TIERS.high);
    expect(splashesDrawn(WEATHER_PRESETS.eerie, "high", true)).toBe(Math.round(0.3 * SPLASH_TIERS.high));
    expect(splashesDrawn(WEATHER_PRESETS.rain, "high", false)).toBe(0);
    expect(splashesDrawn(WEATHER_PRESETS.clear, "high", true)).toBe(0);
    expect(splashesDrawn(WEATHER_PRESETS.rain, "low", true)).toBe(0);
  });

  it("fills the folded time, the eye, the rain, the sun while it is up, the lamp and the map's centre", () => {
    const out = emptySplashUniforms();
    expect(splashUniforms(CAM, WEATHER_PRESETS.rain, LAMP_ON, SUN_HIGH, SPLASH_FOLD_S + 1.5, { x: 30, z: -20 }, out)).toBe(out);
    expect(out.splashTime[0]).toBeCloseTo(1.5, 9);
    expect(out.splashCam).toEqual([10, 5, -20]);
    expect(out.splashRain).toEqual([1]);
    // The sun well up: its travel whole.
    expect(out.splashSun).toEqual([0, -0.8, 0.6]);
    expect(out.splashLampPos).toEqual([10, 5, -20]);
    expect(out.splashLampDir).toEqual([0, 0, 1]);
    expect(out.splashLamp[0]).toBeCloseTo(2, 9);
    expect(out.splashLamp[1]).toBeCloseTo(Math.cos(0.75), 9);
    expect(out.splashMapCentre).toEqual([30, -20]);
    // The sun down: no backlight from it. Low over the horizon: its share of the fade.
    splashUniforms(CAM, WEATHER_PRESETS.eerie, LAMP_OFF, SUN_DOWN, 2, null, out);
    expect(out.splashSun.map((v) => v + 0)).toEqual([0, 0, 0]);
    expect(out.splashRain[0]).toBeCloseTo(0.3, 9);
    expect(out.splashLamp[0]).toBe(0);
    // No map: the last centre stands.
    expect(out.splashMapCentre).toEqual([30, -20]);
    splashUniforms(CAM, WEATHER_PRESETS.rain, LAMP_OFF, { x: 0.6, y: -SUN_UP / 2, z: 0 }, 2, null, out);
    expect(out.splashSun[0]).toBeCloseTo(0.3, 9);
  });

  it("lists a ring an instance, its seed in the first four floats", () => {
    const { data, count } = splashInstances("medium");
    expect(count).toBe(SPLASH_TIERS.medium);
    expect(data.length).toBe(count * SPLASH_INSTANCE_FLOATS);
    const seeds = rainSeeds(count, SPLASH_SEED);
    for (const i of [0, 5, count - 1]) {
      const at = i * SPLASH_INSTANCE_FLOATS;
      expect([...data.subarray(at, at + 4)]).toEqual([...seeds.subarray(i * 4, i * 4 + 4)]);
      expect([...data.subarray(at + 4, at + 16)].every((v) => v === 0)).toBe(true);
    }
    expect(splashInstances("low").count).toBe(0);
  });

  it("hands a stage of a renderer's own the material beside the rings' record", () => {
    const out = emptySplashStageUniforms();
    expect(Object.keys(out).slice(0, Object.keys(emptySplashUniforms()).length)).toEqual(Object.keys(emptySplashUniforms()));
    expect(splashStageUniforms([0.7, 0.71, 0.72], AIR, 1.2, 1.1, out)).toBe(out);
    expect(out.splashEmissive).toEqual([0.7, 0.71, 0.72]);
    expect(out.splashFogColour).toEqual([0.3, 0.4, 0.5]);
    expect(out.splashFogDensity).toEqual([0.004]);
    expect([out.splashExposure[0], out.splashContrast[0]]).toEqual([1.2, 1.1]);
  });
});
