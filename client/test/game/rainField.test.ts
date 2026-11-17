import { describe, expect, it } from "vitest";
import type { AtmosphereRecord } from "../../src/game/atmosphereParams.js";
import {
  DRIP_SEED, RAIN_INSTANCE_FLOATS, RAIN_SEED, RAIN_TEX_H, RAIN_TEX_W, createRainField, emptyRainStageUniforms, emptyRainUniforms, rainInstances,
  rainInstancesDrawn, rainMilk, rainStageUniforms, rainStreakMap, type RainLamp,
} from "../../src/game/rainField.js";
import { DRIP, DRIP_TIERS, RAIN_BOX, RAIN_CLASSES, RAIN_FOLD_S, RAIN_MAP, RAIN_TIERS, rainSeeds } from "../../src/game/rainParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";
import { babylonValues } from "../helpers/babylonFixture.js";

const STILL = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);
const CAM = { x: 10, y: 5, z: -20 };
const LAMP_OFF: RainLamp = { x: 10, y: 5, z: -20, dx: 0, dy: 0, dz: 1, intensity: 0, angle: 1.5, r: 1, g: 0.9, b: 0.8 };
const LAMP_ON: RainLamp = { ...LAMP_OFF, intensity: 400 };
const FOG = { r: 0.5, g: 0.5, b: 0.5 };
const DT = 1 / 60;
const MAP = { x: 30, z: -20 };
/** The scene's fog, of which the stage reads the far colour and the density. */
const AIR = { baseDensity: 0.004, farColour: { r: 0.3, g: 0.4, b: 0.5 } } as AtmosphereRecord;

describe("the rain's sprite, seeds and colour", () => {
  it("is a 4 by 16 white streak whose alpha peaks mid-column and dies at the ends and edges", () => {
    const data = rainStreakMap();
    expect(data.length).toBe(RAIN_TEX_W * RAIN_TEX_H * 4);
    const alpha = (x: number, y: number): number => data[(y * RAIN_TEX_W + x) * 4 + 3] as number;
    expect(alpha(1, 8)).toBeGreaterThan(alpha(1, 0));
    expect(alpha(1, 8)).toBeGreaterThan(alpha(0, 8));
    expect(Math.max(alpha(1, 7), alpha(1, 8))).toBeGreaterThan(180);
    for (let i = 0; i < 64; i++) expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]).toEqual([255, 255, 255]);
  });

  it("seeds the streaks and the drips apart, the same on every load", () => {
    expect(RAIN_SEED).not.toBe(DRIP_SEED);
    expect(rainSeeds(8, RAIN_SEED)).toEqual(rainSeeds(8, RAIN_SEED));
    expect(rainSeeds(8, RAIN_SEED)).not.toEqual(rainSeeds(8, DRIP_SEED));
  });

  it("lifts the fog colour by the milk and holds each channel to one", () => {
    const milk = rainMilk(FOG);
    for (const c of milk) expect(c).toBeCloseTo(0.705, 9);
    expect(rainMilk({ r: 0, g: 0, b: 0 })).toEqual([0.08, 0.08, 0.08]);
    expect(rainMilk({ r: 1, g: 2, b: 0.9 })).toEqual([1, 1, 1]);
    const out: [number, number, number] = [0, 0, 0];
    expect(rainMilk(FOG, out)).toBe(out);
  });
});

describe("a volume's uniforms", () => {
  it("are the streak plugin's, name for name and component for component", () => {
    // The plugin's own list on Babylon.js (`rainPlugin.ts`, recorded) is the one its material's buffer is laid out by.
    const declared = babylonValues<{ rainUniforms: { name: string; size: number }[] }>("stages/declared.json").rainUniforms;
    expect(declared.length).toBeGreaterThan(10);
    const record = emptyRainUniforms();
    expect(Object.keys(record)).toEqual(declared.map((u) => u.name));
    for (const u of declared) expect((record as Record<string, number[]>)[u.name], u.name).toHaveLength(u.size);
  });

  it("start with the classes' lanes, the box and the map's extent set", () => {
    const u = emptyRainUniforms();
    expect(u.rainSpeeds).toEqual(RAIN_CLASSES.map((c) => c.speed));
    expect(u.rainWidths).toEqual(RAIN_CLASSES.map((c) => c.width));
    expect(u.rainAlphas).toEqual(RAIN_CLASSES.map((c) => c.alpha));
    expect(u.rainBoxSize).toEqual([RAIN_BOX.x, RAIN_BOX.y, RAIN_BOX.z]);
    expect(u.rainMapExtent).toEqual([RAIN_MAP.extent]);
    expect(emptyRainUniforms(DRIP.box).rainBoxSize).toEqual([DRIP.box.x, DRIP.box.y, DRIP.box.z]);
  });
});

describe("the rain's field", () => {
  it("draws nothing at clear and leaves its records as they stood", () => {
    const field = createRainField("high");
    const before = JSON.stringify(field.streaks);
    expect(field.step(CAM, 0, WEATHER_PRESETS.clear, STILL, DT, LAMP_ON, FOG, MAP)).toBe(false);
    expect(field.drawn).toBe(0);
    expect(field.dripping).toBe(0);
    expect(JSON.stringify(field.streaks)).toBe(before);
  });

  it("draws the rain value's share of the tier's streaks", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const field = createRainField(tier);
      expect(field.step(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF, FOG, null)).toBe(true);
      expect(field.drawn).toBe(RAIN_TIERS[tier]);
      field.step(CAM, 0, WEATHER_PRESETS.eerie, STILL, DT, LAMP_OFF, FOG, null);
      expect(field.drawn).toBe(Math.round(0.3 * RAIN_TIERS[tier]));
    }
  });

  it("fills the streaks' record: the box ahead of the eye, the eye, the wind's slant, the lamp and the milk", () => {
    const field = createRainField("high");
    const wind = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 0, dirZ: 1 };
    field.step(CAM, 0, WEATHER_PRESETS.rain, wind, DT, LAMP_ON, FOG, null);
    const u = field.streaks;
    // Yaw 0 faces +Z: 6 m ahead, 2 m down, the box's half-size off each axis.
    expect(u.rainBoxMin).toEqual([-2, -7, -26]);
    expect(u.rainCam).toEqual([10, 5, -20]);
    expect(u.rainWind[0]).toBe(0);
    expect(u.rainWind[1]).toBeCloseTo(3 * wind.speed, 9);
    expect(u.rainLampPos).toEqual([10, 5, -20]);
    expect(u.rainLampDir).toEqual([0, 0, 1]);
    // 400 light units at the gain of 0.005 is 2; the cone's edge is cos(0.75).
    expect(u.rainLamp[0]).toBeCloseTo(2, 9);
    expect(u.rainLamp[1]).toBeCloseTo(Math.cos(0.75), 9);
    expect(u.rainLampColour).toEqual([1, 0.9, 0.8]);
    for (const c of field.milk) expect(c).toBeCloseTo(0.705, 9);
    field.step(CAM, Math.PI / 2, WEATHER_PRESETS.rain, wind, DT, LAMP_OFF, FOG, null);
    expect(u.rainLamp[0]).toBe(0);
    // Turned a quarter: the box is ahead along +X.
    expect(u.rainBoxMin[0]).toBeCloseTo(10 + 6 - 12, 9);
    expect(u.rainBoxMin[2]).toBeCloseTo(-20 - 12, 9);
  });

  it("folds the time at the fold, steps the drift with the wind, smooths the frame, and steps at most a second", () => {
    const field = createRainField("low");
    const wind = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 1, dirZ: 0, speed: 1 };
    field.step(CAM, 0, WEATHER_PRESETS.rain, wind, 0.5, LAMP_OFF, FOG, null);
    expect(field.streaks.rainFold[0]).toBeCloseTo(0.5, 9);
    // 3 m/s downwind over half a second, in boxes of 24 m.
    expect(field.streaks.rainDrift[0]).toBeCloseTo(1.5 / 24, 9);
    expect(field.streaks.rainDrift[1]).toBe(0);
    // A stall of ten seconds is one second.
    field.step(CAM, 0, WEATHER_PRESETS.rain, wind, 10, LAMP_OFF, FOG, null);
    expect(field.streaks.rainFold[0]).toBeCloseTo(1.5, 9);
    for (let i = 0; i < RAIN_FOLD_S; i++) field.step(CAM, 0, WEATHER_PRESETS.rain, wind, 1, LAMP_OFF, FOG, null);
    expect(field.streaks.rainFold[0]).toBeCloseTo(1.5, 6);
    // The frame the length reads stays inside its clamp.
    expect(field.streaks.rainDt[0]).toBeGreaterThanOrEqual(1 / 40);
    expect(field.streaks.rainDt[0]).toBeLessThanOrEqual(1 / 30);
  });

  it("steps the canopy's water whether or not anything is drawn, and drips only under a map, on the tiers with drips", () => {
    const low = createRainField("low");
    expect(low.drips).toBeNull();
    const field = createRainField("high");
    for (let i = 0; i < 60; i++) field.step(CAM, 0, WEATHER_PRESETS.rain, STILL, 1, LAMP_OFF, FOG, null);
    expect(field.canopyWater).toBeCloseTo(1, 9);
    // Full of water with no map to fall under: none.
    expect(field.dripping).toBe(0);
    field.step(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_ON, FOG, MAP);
    expect(field.dripping).toBe(DRIP_TIERS.high);
    const drips = field.drips!;
    // The drips' box is the shorter one, placed as the streaks' is; the rest is the streaks'.
    expect(drips.rainBoxMin).toEqual([-2, -3, -26]);
    expect(field.streaks.rainBoxMin).toEqual([-2, -7, -26]);
    expect(drips.rainFold).toEqual(field.streaks.rainFold);
    expect(drips.rainCanopyWater[0]).toBeCloseTo(1, 9);
    expect(drips.rainMapCentre).toEqual([30, -20]);
    expect(field.streaks.rainMapCentre).toEqual([30, -20]);
    // The rain stops: the streaks go, the drips outlast them and a step still draws.
    expect(field.step(CAM, 0, WEATHER_PRESETS.clear, STILL, 60, LAMP_OFF, FOG, MAP)).toBe(true);
    expect(field.drawn).toBe(0);
    expect(field.dripping).toBeGreaterThan(0);
    // A map taken away leaves the centre it last had.
    field.step(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF, FOG, null);
    expect(field.streaks.rainMapCentre).toEqual([30, -20]);
  });
});

describe("both volumes as one mesh's instances", () => {
  it("lists the drips first, then the streaks, each its volume's seed, the drips marked and numbered by their share", () => {
    const { data, drips, streaks } = rainInstances("medium");
    expect(drips).toBe(DRIP_TIERS.medium);
    expect(streaks).toBe(RAIN_TIERS.medium);
    expect(data.length).toBe((drips + streaks) * RAIN_INSTANCE_FLOATS);
    const dripSeeds = rainSeeds(drips, DRIP_SEED);
    const streakSeeds = rainSeeds(streaks, RAIN_SEED);
    for (const i of [0, 1, drips - 1]) {
      const at = i * RAIN_INSTANCE_FLOATS;
      expect([...data.subarray(at, at + 4)]).toEqual([...dripSeeds.subarray(i * 4, i * 4 + 4)]);
      expect(data[at + 4]).toBe(1);
      expect(data[at + 5]).toBeCloseTo((i + 0.5) / drips, 6);
      expect([...data.subarray(at + 6, at + 16)].every((v) => v === 0)).toBe(true);
    }
    for (const i of [0, 7, streaks - 1]) {
      const at = (drips + i) * RAIN_INSTANCE_FLOATS;
      expect([...data.subarray(at, at + 4)]).toEqual([...streakSeeds.subarray(i * 4, i * 4 + 4)]);
      expect([...data.subarray(at + 4, at + 16)].every((v) => v === 0)).toBe(true);
    }
    // A tier with no drip is the streaks alone.
    const low = rainInstances("low");
    expect([low.drips, low.streaks]).toEqual([0, RAIN_TIERS.low]);
  });

  it("draws every drip's place and the streaks shown while a streak is, the drips shown alone while none is", () => {
    const field = createRainField("medium");
    const drips = DRIP_TIERS.medium;
    field.step(CAM, 0, WEATHER_PRESETS.clear, STILL, DT, LAMP_OFF, FOG, MAP);
    expect(rainInstancesDrawn(field, drips)).toBe(0);
    field.step(CAM, 0, WEATHER_PRESETS.eerie, STILL, DT, LAMP_OFF, FOG, MAP);
    expect(rainInstancesDrawn(field, drips)).toBe(drips + Math.round(0.3 * RAIN_TIERS.medium));
    for (let i = 0; i < 60; i++) field.step(CAM, 0, WEATHER_PRESETS.rain, STILL, 1, LAMP_OFF, FOG, MAP);
    field.step(CAM, 0, WEATHER_PRESETS.clear, STILL, 60, LAMP_OFF, FOG, MAP);
    expect(field.drawn).toBe(0);
    expect(rainInstancesDrawn(field, drips)).toBe(field.dripping);
    expect(field.dripping).toBeGreaterThan(0);
    expect(field.dripping).toBeLessThan(drips);
  });

  it("hands the one stage the streaks' record, the drips' box, the share of drips shown and the material", () => {
    const field = createRainField("medium");
    const drips = DRIP_TIERS.medium;
    for (let i = 0; i < 30; i++) field.step(CAM, 0, WEATHER_PRESETS.rain, STILL, 1, LAMP_ON, FOG, MAP);
    const air = AIR;
    const out = emptyRainStageUniforms();
    expect(rainStageUniforms(field, drips, air, 1.2, 1.1, out)).toBe(out);
    for (const name of Object.keys(field.streaks)) expect((out as Record<string, number[]>)[name], name).toEqual((field.streaks as Record<string, number[]>)[name]);
    expect(out.dripBoxMin).toEqual(field.drips!.rainBoxMin);
    expect(out.dripBoxSize).toEqual([DRIP.box.x, DRIP.box.y, DRIP.box.z]);
    expect(out.rainDripShown[0]).toBeCloseTo(field.dripping / drips, 9);
    expect(out.rainEmissive).toEqual([...field.milk]);
    expect(out.rainFogColour).toEqual([air.farColour.r, air.farColour.g, air.farColour.b]);
    expect(out.rainFogDensity).toEqual([air.baseDensity]);
    expect([out.rainExposure[0], out.rainContrast[0]]).toEqual([1.2, 1.1]);
    // A tier with no drip shows none.
    const low = createRainField("low");
    low.step(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF, FOG, null);
    expect(rainStageUniforms(low, 0, air, 1, 1).rainDripShown).toEqual([0]);
  });
});
