import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { OCEAN_NO_TIP, createOcean, oceanTipsFor } from "../../src/game/oceanRender.js";
import { attachWater, oceanArrayPlaceholder } from "../../src/game/waterPlugin.js";
import { WATER_ROWS } from "../../src/game/waterShading.js";
import {
  OCEAN_COAST_RECENTRE, OCEAN_COAST_SAMPLES, OCEAN_COAST_STEP, coastProfilesFor, writeCoastRow,
} from "../../src/game/oceanTables.js";
import { WATER_RING_CELLS, WATER_RING_COUNT, waterRingSpacing } from "../../src/game/water.js";
import { oceanFieldFor, swellPhases } from "../../src/game/oceanWaves.js";
import { windSeaAtSpeed, windSeaStateFor } from "../../src/game/oceanWindSea.js";
import type { LoopReply } from "../../src/game/oceanLoopBake.js";
import { LOOP_FRAMES, LOOP_N, LOOP_SIZE } from "../../src/game/oceanSpectrum.js";
import { coveFor } from "../../src/sim/olympic.js";
import { seedFromToken } from "../../src/game/seed.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");
const SEED = seedFromToken("atmo");

/** The data a raw texture was made or last updated with: NullEngine keeps it on the internal texture. */
const uploaded = (texture: Texture): Float32Array =>
  (texture.getInternalTexture() as unknown as { _bufferView: Float32Array })._bufferView;

describe("the sea's waves as the water material reads them (createOcean)", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("uploads the swell's tables as one RGBA32F texture, 1,040 by 28, nearest and clamped", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const ocean = createOcean(scene, SEED, "medium");
    expect(ocean.atlas.getSize()).toEqual({ width: 1040, height: 28 });
    const internal = ocean.atlas.getInternalTexture()!;
    expect(internal.type).toBe(Constants.TEXTURETYPE_FLOAT);
    expect(internal.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(internal.generateMipMaps).toBe(false);
    expect(ocean.atlas.samplingMode).toBe(Texture.NEAREST_SAMPLINGMODE);
    expect(ocean.atlas.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(ocean.atlas.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
    // the tables as the swell's evaluation reads them, the coastline row about z = 0
    const reference = oceanFieldFor(SEED, 12).tables;
    writeCoastRow(reference, coastProfilesFor(SEED), 0);
    const data = uploaded(ocean.atlas);
    expect(data.length).toBe(116480);
    expect(reference.coastOriginZ).toBe(-6240);
    expect(Array.from(data)).toEqual(Array.from(reference.data));
    ocean.dispose();
  }, timeLimit(30_000));

  it("draws the wind sea by its normals on every tier here, its textures the scene's one 1×1 array", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    for (const tier of ["low", "medium", "high"] as const) {
      const ocean = createOcean(scene, SEED, tier);
      expect(ocean.windMode).toBe(0);
      expect(ocean.windDisp).toBe(oceanArrayPlaceholder(scene));
      expect(ocean.windSlope).toBe(oceanArrayPlaceholder(scene));
      ocean.dispose();
    }
    const placeholder = oceanArrayPlaceholder(scene);
    expect(placeholder.is2DArray).toBe(true);
    expect(placeholder.getSize()).toEqual({ width: 1, height: 1 });
    expect(placeholder.getInternalTexture()!.depth).toBe(1);
    // disposing an ocean leaves the scene's placeholder to the scene
    expect(placeholder.getInternalTexture()).not.toBeNull();
  }, timeLimit(30_000));

  it("binds itself to a water plugin: its OCEAN define on, the tier's count of components, the coastline row's origin and step", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    for (const [tier, count] of [["low", 8], ["medium", 12], ["high", 12]] as const) {
      const plugin = attachWater(new PBRMaterial(`sea_${tier}`, scene), WATER_ROWS.sea);
      const ocean = createOcean(scene, SEED, tier);
      ocean.bind(plugin);
      const binding = plugin.ocean!;
      expect(binding.atlas).toBe(ocean.atlas);
      expect(binding.windDisp).toBe(ocean.windDisp);
      expect(binding.windSlope).toBe(ocean.windSlope);
      expect(binding.coast).toEqual([-6240, 12, count, 0]);
      const field = oceanFieldFor(SEED, count);
      expect(binding.swell).toEqual([field.travel[0], field.travel[1], field.tp, field.hs]);
      expect(binding.tips).toEqual(oceanTipsFor(field.tips));
      const defines: Record<string, unknown> = {};
      plugin.prepareDefines(defines as never, scene, undefined as never);
      expect(defines.OCEAN).toBe(true);
      ocean.dispose();
    }
  }, timeLimit(30_000));

  it("moves the swell's phases, the wind sea and its direction each frame, from the shared seconds, the wind and the hour", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
    const ocean = createOcean(scene, SEED, "medium");
    ocean.bind(plugin);
    const binding = plugin.ocean!;
    const field = oceanFieldFor(SEED, 12);
    // An hour apart, so the sea has caught up with each wind (it follows a minute behind).
    for (const [seconds, wind01, dir, hour] of [[0, 0.25, [1, 0], 12], [3600.25, 0.9, [0.6, -0.8], 15], [7200.5, 0.53, [-1, 0], 6]] as const) {
      ocean.update(0, 0, seconds, wind01, [dir[0], dir[1]], hour);
      expect(Array.from(binding.phases)).toEqual(Array.from(swellPhases(field, seconds)));
      const sea = windSeaStateFor(wind01, [dir[0], dir[1]], hour);
      const want = [sea.hs, sea.loopScale, 0, sea.coverage];
      binding.wind.forEach((value, i) => expect(value, `wind[${i}] at ${seconds}`).toBeCloseTo(want[i] as number, 12));
      expect(binding.windDir).toEqual([sea.dir[0], sea.dir[1], sea.u10, sea.onshoreWeight]);
    }
    // the binding is the plugin's, written in place: no frame needs a new bind
    expect(plugin.ocean).toBe(binding);
    ocean.dispose();
  }, timeLimit(30_000));

  it("binds the sea's state a minute behind its wind, and the wind as it blows now for the roughness", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
    const ocean = createOcean(scene, SEED, "low");
    ocean.bind(plugin);
    const binding = plugin.ocean!;
    // 6 m/s from the first frame, no ramp from still air.
    ocean.update(0, 0, 100, 0.5, [1, 0], 12);
    expect(binding.wind[1]).toBeCloseTo(0.36, 12);
    // A minute of 8 m/s: the sea at 6 + 2 (1 - 1/e) = 7.264 m/s, the roughness at the wind's own 8.
    ocean.update(0, 0, 160, 8 / 12, [1, 0], 12);
    expect(binding.wind[0]).toBeCloseTo(1.5061545, 6);
    expect(binding.wind[1]).toBeCloseTo(0.5276920, 6);
    expect(binding.wind[3]).toBeCloseTo(windSeaAtSpeed(windSeaStateFor(8 / 12, [1, 0], 12), 7.264241117657115).coverage, 12);
    expect(binding.windDir[2]).toBe(8);
    ocean.dispose();
  }, timeLimit(30_000));

  it("writes the coastline row again round the camera once it is more than 1,000 m along z from the last, and uploads it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
    const ocean = createOcean(scene, SEED, "medium");
    ocean.bind(plugin);
    const upload = vi.spyOn(ocean.atlas, "update");
    const frame = (x: number, z: number): void => ocean.update(x, z, 1, 0.25, [1, 0], 12);
    // across x does not count, and 1,000 m along z is not past it
    frame(5000, 0);
    frame(0, 1000);
    frame(0, -1000);
    expect(upload).not.toHaveBeenCalled();
    expect(plugin.ocean!.coast[0]).toBe(-6240);
    // 1,200 m: the row about z = 1,200, 12,480 m long
    frame(0, 1200);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(plugin.ocean!.coast[0]).toBe(-5040);
    const profiles = coastProfilesFor(SEED);
    const data = upload.mock.calls[0]![0] as Float32Array;
    const coastTexel = (j: number): number => data[(27 * 1040 + j) * 4] as number;
    expect(coastTexel(0)).toBe(Math.fround(profiles.coastlineX(-5040)));
    expect(coastTexel(1039)).toBe(Math.fround(profiles.coastlineX(7428)));
    // and from there, not again until the camera is 1,000 m from 1,200
    frame(0, 2100);
    expect(upload).toHaveBeenCalledTimes(1);
    frame(0, -200);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(plugin.ocean!.coast[0]).toBe(-6444);
    ocean.dispose();
  }, timeLimit(30_000));

  it("keeps the coastline row past the outermost water ring's reach wherever the camera is along z", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
    const ocean = createOcean(scene, SEED, "low");
    ocean.bind(plugin);
    // The outermost ring is 128 cells of 64 m about its origin, which lags the camera by up to two of its cells.
    const spacing = waterRingSpacing(WATER_RING_COUNT - 1);
    const reach = (WATER_RING_CELLS * spacing) / 2 + 2 * spacing;
    expect(reach).toBe(4224);
    expect([OCEAN_COAST_STEP, OCEAN_COAST_SAMPLES, OCEAN_COAST_RECENTRE]).toEqual([12, 1040, 1000]);
    let behind = Infinity;
    let ahead = Infinity;
    const frame = (z: number): void => {
      ocean.update(0, z, 1, 0.25, [1, 0], 12);
      const first = plugin.ocean!.coast[0] as number;
      behind = Math.min(behind, z - first);
      ahead = Math.min(ahead, first + (OCEAN_COAST_SAMPLES - 1) * OCEAN_COAST_STEP - z);
    };
    // A walk out along z and back by steps that are no multiple of the row's, so the row is recentred at
    // every remainder of its step, and the camera met at each recentre's threshold.
    for (let z = 0; z <= 30_000; z += 7) frame(z);
    for (let z = 30_000; z >= -30_000; z -= 7) frame(z);
    for (let z = -30_000; z <= 0; z += 7) frame(z);
    expect(behind).toBeGreaterThanOrEqual(4224);
    expect(ahead).toBeGreaterThanOrEqual(4224);
    ocean.dispose();
  }, timeLimit(30_000));

  it("writes an absent headland tip far inland, where it shelters nothing", () => {
    expect(OCEAN_NO_TIP).toBe(1e9);
    expect(oceanTipsFor([])).toEqual([1e9, 0, 1e9, 0]);
    expect(oceanTipsFor([[-520, -150]])).toEqual([-520, -150, 1e9, 0]);
    expect(oceanTipsFor([[-520, -150], [-505, 160]])).toEqual([-520, -150, -505, 160]);
  });

  it("disposes its atlas and not the scene's placeholder", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const ocean = createOcean(scene, SEED, "low");
    ocean.dispose();
    expect(ocean.atlas.getInternalTexture()).toBeNull();
    expect(oceanArrayPlaceholder(scene)).toBe(ocean.windDisp);
    expect(ocean.windDisp.getInternalTexture()).not.toBeNull();
  }, timeLimit(30_000));
});

describe("the water plugin's array placeholder", () => {
  it("is made once a scene, and again once disposed", () => {
    const engine = new NullEngine();
    try {
      const a = new Scene(engine);
      const b = new Scene(engine);
      const first = oceanArrayPlaceholder(a);
      expect(oceanArrayPlaceholder(a)).toBe(first);
      expect(oceanArrayPlaceholder(b)).not.toBe(first);
      expect(first.name).toBe("oceanArrayPlaceholder");
      first.dispose();
      const again = oceanArrayPlaceholder(a);
      expect(again).not.toBe(first);
      expect(again.getInternalTexture()).not.toBeNull();
    } finally {
      engine.dispose();
    }
  });
});

describe("the wind sea by tier (createOcean)", () => {
  /** A bake's answer with the loop's sizes and numbers to tell apart. */
  const reply = (seed: number): LoopReply => ({
    seed, frames: LOOP_FRAMES, n: LOOP_N, size: LOOP_SIZE, heightStd: 0.8, slopeVar: 0.03,
    data: new Uint16Array(LOOP_FRAMES * LOOP_N * LOOP_N * 4),
  });

  it("draws none on low, and on medium the loop once its bake answers, its mode, field, time and numbers bound", async () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const startLoop = vi.fn((seed: number) => Promise.resolve(reply(seed)));
      const startGpu = vi.fn(() => Promise.resolve(null));
      const low = createOcean(scene, SEED, "low", { startLoop, startGpu });
      low.update(0, 0, 1, 0.5, [1, 0], 12);
      expect(low.windMode).toBe(0);
      expect(startLoop).not.toHaveBeenCalled();
      const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
      const medium = createOcean(scene, SEED, "medium", { startLoop, startGpu });
      medium.bind(plugin);
      expect(startLoop).toHaveBeenCalledWith(SEED, expect.any(AbortSignal));
      await vi.waitFor(() => {
        medium.update(0, 0, 10, 0.5, [1, 0], 12);
        expect(medium.windMode).toBe(1);
      }, { timeout: timeLimit(10_000) });
      medium.update(0, 0, 13, 0.5, [1, 0], 12);
      const sea = windSeaStateFor(0.5, [1, 0], 12);
      const binding = plugin.ocean!;
      expect(binding.coast[3]).toBe(1);
      expect(binding.windDisp).toBe(medium.windDisp);
      expect(binding.windDisp.is2DArray).toBe(true);
      expect(binding.windDisp.getInternalTexture()!.depth).toBe(LOOP_FRAMES);
      expect(binding.windSlope).toBe(oceanArrayPlaceholder(scene));
      expect(binding.wind[2]).toBeCloseTo(3 * sea.loopRate, 9);
      expect(binding.windStats).toEqual([0.8 * sea.loopScale, 0.03, 0, 0]);
      expect(startGpu).not.toHaveBeenCalled();
      low.dispose();
      medium.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));

  it("turns the wind sea about the cove's waterline centre, bound for the shaders", () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
      const ocean = createOcean(scene, SEED, "low");
      ocean.bind(plugin);
      const z0 = coveFor(SEED).z0;
      expect(plugin.ocean!.windPivot).toEqual([coastProfilesFor(SEED).coastlineX(z0), z0, 0, 0]);
      // at sea: the pivot is the cove's waterline, west of the road
      expect(plugin.ocean!.windPivot[0]).toBeLessThan(-150);
      ocean.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));

  it("falls back on high to the medium loop where the engine has no compute (NullEngine's createGpuWindSea is null)", async () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const startLoop = vi.fn((seed: number) => Promise.resolve(reply(seed)));
      const high = createOcean(scene, SEED, "high", { startLoop });
      await vi.waitFor(() => {
        high.update(0, 0, 10, 0.9, [0.6, -0.8], 15);
        expect(high.windMode).toBe(1);
      }, { timeout: timeLimit(10_000) });
      expect(startLoop).toHaveBeenCalledWith(SEED, expect.any(AbortSignal));
      high.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));
});
