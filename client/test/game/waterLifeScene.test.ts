import { describe, expect, it } from "vitest";
import "@csarkosh/engine/sim/olympic";
import { lakeOf } from "../sim/helpers/lakes.js";
import type { Dragonflies } from "@csarkosh/engine/game/dragonflyBehaviour";
import { MIDGE_TABLE_FLOATS, type MidgeFrame } from "../../src/game/midgeLook.js";
import { HEAD_ROW0, MIDGE_SWARMS_MAX } from "../../src/game/midgeMotion.js";
import { skyStateFor } from "@csarkosh/engine/game/skyState";
import { SILENT_WATER_LIFE, createPlayerSlots, pixelAtOneMetre, skyLumaOf } from "../../src/game/waterLifeInputs.js";
import { waterLifeLayout } from "@csarkosh/engine/game/waterLifeField";
import { createWaterLifeScene, type WaterLifeDraws, type WaterLifeFrame } from "../../src/game/waterLifeScene.js";
import { WEATHER_PRESETS, type WeatherParams } from "@csarkosh/engine/game/weather";
import { windRecordUnder } from "@csarkosh/engine/game/windParams";
import { skyFixture } from "./helpers/skyFixture.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 388817;

/** The camera at (x, y, z) at `hour` under `weather`, no player, no Hollow. */
function frameAt(x: number, y: number, z: number, hour: number, weather: WeatherParams = WEATHER_PRESETS.clear): WaterLifeFrame {
  return {
    camX: x, camY: y, camZ: z, tick: 0, dt: 1 / 60, time: 0, players: [], weather, hour, wind: windRecordUnder(weather, 0),
    sky: skyStateFor(skyFixture(), hour, weather), skyLuma: 0.25, pixelAt1m: 0.001, hollowDistance: Infinity,
  };
}

/** Draws that keep what they were last handed. */
function recorder(): WaterLifeDraws & { midgeFrames: (MidgeFrame | null)[]; units: Dragonflies | null; seed: number | null } {
  const seen = {
    midgeFrames: [] as (MidgeFrame | null)[], units: null as Dragonflies | null, seed: null as number | null,
    midges(frame: MidgeFrame | null) {
      seen.midgeFrames.push(frame);
    },
    dragonflies(units: Dragonflies, seed: number) {
      seen.units = units;
      seen.seed = seed;
    },
  };
  return seen;
}

describe("a lake's life stepped with no engine", { timeout: timeLimit(60_000) }, () => {
  it("lays the midges' blocks out once: a row a marker, a row a player's head, none past them", () => {
    const life = createWaterLifeScene(SEED, lakeOf(SEED), "high");
    expect(life.blocks).toHaveLength(MIDGE_SWARMS_MAX);
    expect(life.blocks.slice(0, HEAD_ROW0).some((block) => block > 0)).toBe(true);
    expect(life.blocks.slice(HEAD_ROW0).filter((block) => block > 0).length).toBeGreaterThan(0);
  });

  it("hands the dragonflies as they stand each frame, and the midges' frame only while a swarm is in sight", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLifeScene(SEED, lake, "high");
    const draws = recorder();
    // Noon: dragonflies fly, no midge swarms.
    const noon = frameAt(lake.x, lake.level + 2, lake.z, 12);
    for (let i = 0; i < 30; i++) life.update(noon, draws);
    expect(draws.seed).toBe(SEED);
    expect((draws.units as Dragonflies).count.reduce((n, c) => n + c, 0)).toBeGreaterThan(0);
    expect(draws.midgeFrames.every((frame) => frame === null)).toBe(true);
    // Dusk: the swarms are out, and the frame carries the eye and the table.
    const dusk = createWaterLifeScene(SEED, lake, "high");
    const duskDraws = recorder();
    // An hour and a half before a spring dusk, beside a swarm's marker.
    const marker = waterLifeLayout(SEED, lake).markers[0] as { x: number; y: number; z: number };
    const f = frameAt(marker.x, marker.y, marker.z + 1, 18.5);
    for (let i = 0; i < 5; i++) dusk.update(f, duskDraws);
    const frame = duskDraws.midgeFrames.at(-1) as MidgeFrame;
    expect(frame).not.toBeNull();
    expect([frame.eyeX, frame.eyeY, frame.eyeZ]).toEqual([f.camX, f.camY, f.camZ]);
    expect(frame.table).toHaveLength(MIDGE_TABLE_FLOATS);
    expect(frame.skyLuma).toBe(0.25);
  });

  it("rests out of the lake's reach: no midge, no dragonfly, no sound, told once", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLifeScene(SEED, lake, "high");
    const draws = recorder();
    life.update(frameAt(lake.x, lake.level + 2, lake.z, 12), draws);
    const before = draws.midgeFrames.length;
    const far = frameAt(lake.x + 5000, 0, lake.z, 12);
    life.update(far, draws);
    life.update(far, draws);
    expect(draws.midgeFrames.length).toBe(before + 1);
    expect(draws.midgeFrames.at(-1)).toBeNull();
    expect((draws.units as Dragonflies).count).toEqual([0, 0, 0]);
    expect(life.sound().hums_n).toBe(0);
    expect(life.sound().bed.level).toBe(0);
  });

  it("refills nothing once it is ended", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLifeScene(SEED, lake, "high");
    const draws = recorder();
    life.dispose();
    life.update(frameAt(lake.x, lake.level + 2, lake.z, 12), draws);
    life.rest(draws);
    expect(draws.midgeFrames).toEqual([]);
    expect(draws.units).toBeNull();
    expect(life.sound().hums_n).toBe(0);
  });
});

describe("what the lake's life is handed", () => {
  it("reads no sky as dark, a pixel's size from the lens, and silence as frozen", () => {
    expect(skyLumaOf(null)).toBe(0);
    expect(pixelAtOneMetre(Math.PI / 2, 1000)).toBeCloseTo(0.002, 12);
    expect(Object.isFrozen(SILENT_WATER_LIFE)).toBe(true);
    expect(Object.isFrozen(SILENT_WATER_LIFE.bed.points)).toBe(true);
    expect(SILENT_WATER_LIFE.hums_n).toBe(0);
  });

  it("keeps a player's slot while they stay, and frees it a frame before another takes it", () => {
    const slots = createPlayerSlots(2);
    const a = { id: 5, pos: { x: 1, y: 2, z: 3 } };
    const b = { id: 9, pos: { x: 4, y: 5, z: 6 } };
    expect(slots.fill(new Map([[5, a], [9, b]])).map((p) => p?.x)).toEqual([1, 4]);
    expect(slots.fill(new Map([[9, b]])).map((p) => p?.x)).toEqual([undefined, 4]);
    const c = { id: 11, pos: { x: 7, y: 8, z: 9 } };
    expect(slots.fill(new Map([[9, b], [11, c]])).map((p) => p?.x)).toEqual([7, 4]);
  });
});
