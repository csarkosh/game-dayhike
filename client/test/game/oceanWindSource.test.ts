// client/test/game/oceanWindSource.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import {
  WIND_SEA_RESPECTRUM_U, cascadeStats, createWindSeaSource, needsRespectrum, type GpuStarter, type LoopStarter,
} from "../../src/game/oceanWindSource.js";
import type { GpuWindSea } from "../../src/game/oceanGpuFft.js";
import type { LoopReply } from "../../src/game/oceanLoopBake.js";
import { LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE } from "../../src/game/oceanSpectrum.js";
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import { oceanArrayPlaceholder } from "../../src/game/waterPlugin.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 0x5eed;

/** A bake's answer with the loop's sizes and numbers to tell apart. */
function reply(seed: number): LoopReply {
  return {
    seed, frames: LOOP_FRAMES, n: LOOP_N, size: LOOP_SIZE, heightStd: 0.8, slopeVar: 0.03,
    data: new Uint16Array(LOOP_FRAMES * LOOP_N * LOOP_N * 4),
  };
}

/** A GPU wind sea that records what it is asked, its status the test's to set. */
function fakeGpu(scene: Scene) {
  let status: ReturnType<GpuWindSea["status"]> = "running";
  return {
    disp: oceanArrayPlaceholder(scene),
    slope: oceanArrayPlaceholder(scene),
    setSpectrum: vi.fn<GpuWindSea["setSpectrum"]>(),
    step: vi.fn<GpuWindSea["step"]>(),
    status: (): ReturnType<GpuWindSea["status"]> => status,
    dispose: vi.fn<GpuWindSea["dispose"]>(),
    fail(): void {
      status = "failed";
    },
  };
}

let engine: NullEngine;
afterEach(() => engine?.dispose());

describe("the wind sea's field by tier", () => {
  it("bakes the loop in a module worker, in the form Vite bundles, and imports the compute on the high tier's path alone", () => {
    const source = readFileSync(new URL("../../src/game/oceanWindSource.ts", import.meta.url), "utf8");
    expect(source).toContain('new Worker(new URL("./oceanLoop.worker.ts", import.meta.url), { type: "module" })');
    expect(source).toContain('await import("./oceanGpuFft.js")');
    expect(source).not.toMatch(/^import \{[^\n]*from "\.\/oceanGpuFft\.js";$/m);
  });

  it("rebuilds the FFT's spectrum only when the wind's speed moves by half a metre a second", () => {
    expect(WIND_SEA_RESPECTRUM_U).toBe(0.5);
    expect(needsRespectrum(null, 10)).toBe(true);
    expect(needsRespectrum(10, 10.49)).toBe(false);
    expect(needsRespectrum(10, 10.5)).toBe(true);
    expect(needsRespectrum(10, 9.5)).toBe(true);
  });

  it("normalises the FFT by its cascades' shares: the three heights make the whole sea's at 10 m/s", () => {
    const stats = cascadeStats(10);
    expect(stats[0]).toBeCloseTo(0.713557, 5);
    expect(stats[1]).toBeCloseTo(0.0027272, 6);
    expect(stats[2]).toBeCloseTo(0.0049297, 6);
    expect(stats[3]).toBeCloseTo(0.0099255, 6);
  });

  it("draws nothing on the low tier, and asks for no field", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>(() => Promise.resolve(reply(SEED)));
    const startGpu = vi.fn<GpuStarter>(() => Promise.resolve(null));
    const source = createWindSeaSource(scene, SEED, "low", startLoop, startGpu);
    await Promise.resolve();
    source.update(windSeaStateFor(0.5, [1, 0], 12), 10);
    expect([source.mode, source.disp, source.slope, source.loopTime]).toEqual([0, null, null, 0]);
    expect(source.stats).toEqual([0, 0, 0, 0]);
    expect(startLoop).not.toHaveBeenCalled();
    expect(startGpu).not.toHaveBeenCalled();
  });

  it("bakes the loop on medium, uploads it as LOOP_FRAMES half-float layers, and runs its time at the wind's rate", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const startGpu = vi.fn<GpuStarter>(() => Promise.resolve(null));
    const source = createWindSeaSource(scene, SEED, "medium", startLoop, startGpu);
    expect(startLoop).toHaveBeenCalledWith(SEED);
    expect(source.mode).toBe(0);
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    const texture = source.disp as RawTexture2DArray;
    expect(texture).toBeInstanceOf(RawTexture2DArray);
    expect(texture.depth).toBe(LOOP_FRAMES);
    expect(texture.getSize()).toEqual({ width: LOOP_N, height: LOOP_N });
    expect(texture.getInternalTexture()!.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    expect(texture.wrapU).toBe(Constants.TEXTURE_WRAP_ADDRESSMODE);
    expect(source.slope).toBeNull();
    // 10 m/s, the bake's own wind: the loop runs at one second a second and folds at LOOP_SECONDS.
    const state = windSeaStateFor(10 / 12, [1, 0], 12);
    expect(state.loopRate).toBe(1);
    source.update(state, 100);
    source.update(state, 130);
    expect(source.loopTime).toBeCloseTo(30 - LOOP_SECONDS, 9);
    expect(source.stats).toEqual([0.8, 0.03, 0, 0]);
    // 6 m/s: lengths and heights by 0.36, time at 10/6.
    const light = windSeaStateFor(0.5, [1, 0], 12);
    source.update(light, 133);
    expect(source.loopTime).toBeCloseTo(10 + 3 * (10 / 6), 9);
    expect(source.stats[0]).toBeCloseTo(0.8 * 0.36, 12);
    expect(startGpu).not.toHaveBeenCalled();
    source.dispose();
    expect(source.mode).toBe(0);
  }, timeLimit(30_000));

  it("holds the loop's clock through a step back of the shared seconds, and counts no second twice", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const source = createWindSeaSource(scene, SEED, "medium", (seed) => Promise.resolve(reply(seed)));
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    const state = windSeaStateFor(10 / 12, [1, 0], 12);
    source.update(state, 100);
    source.update(state, 104);
    // A client's tick reconciled to the host's steps the seconds back a little.
    source.update(state, 103.9);
    expect(source.loopTime).toBeCloseTo(4, 9);
    source.update(state, 104.5);
    expect(source.loopTime).toBeCloseTo(4.5, 9);
    source.dispose();
  }, timeLimit(30_000));

  it("falls back on high to the loop where the engine has no compute: createGpuWindSea is null on NullEngine", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop);
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    expect(startLoop).toHaveBeenCalledWith(SEED);
    expect(source.disp).toBeInstanceOf(RawTexture2DArray);
    source.dispose();
  }, timeLimit(30_000));

  it("falls back on high to the loop where the compute's module fails to load", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop, () => Promise.reject(new Error("the chunk did not load")));
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    expect(startLoop).toHaveBeenCalledWith(SEED);
    expect(source.disp).toBeInstanceOf(RawTexture2DArray);
    source.dispose();
  }, timeLimit(30_000));

  it("draws the FFT on high along +x, rebuilt by the step, stepped every frame, and the loop once it fails", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const gpu = fakeGpu(scene);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop, () => Promise.resolve(gpu));
    await vi.waitFor(() => expect(source.mode).toBe(2), { timeout: timeLimit(10_000) });
    expect(source.disp).toBe(gpu.disp);
    expect(source.slope).toBe(gpu.slope);
    // The wind turning never rebuilds: the shaders turn the field.
    source.update(windSeaStateFor(10 / 12, [1, 0], 12), 50);
    source.update(windSeaStateFor(10.4 / 12, [0, 1], 12), 51);
    expect(gpu.setSpectrum).toHaveBeenCalledTimes(1);
    expect(gpu.setSpectrum).toHaveBeenCalledWith({ u10: 10, dir: [1, 0] }, SEED);
    expect(source.stats).toEqual(cascadeStats(10));
    source.update(windSeaStateFor(10.6 / 12, [0, 1], 12), 52);
    expect(gpu.setSpectrum).toHaveBeenCalledTimes(2);
    expect(gpu.step.mock.calls.map(([seconds]) => seconds)).toEqual([50, 51, 52]);
    expect(startLoop).not.toHaveBeenCalled();
    gpu.fail();
    source.update(windSeaStateFor(10.6 / 12, [0, 1], 12), 53);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(source.mode).toBe(0);
    expect(startLoop).toHaveBeenCalledWith(SEED);
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    source.dispose();
  }, timeLimit(30_000));

  it("never uploads a loop that answers after it was disposed", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    let answer: (value: LoopReply) => void = () => undefined;
    const startLoop = vi.fn<LoopStarter>(() => new Promise<LoopReply>((resolve) => { answer = resolve; }));
    const make = vi.spyOn(engine, "createRawTexture2DArray");
    const source = createWindSeaSource(scene, SEED, "medium", startLoop);
    source.dispose();
    answer(reply(SEED));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(make).not.toHaveBeenCalled();
    expect(source.mode).toBe(0);
  });
});
