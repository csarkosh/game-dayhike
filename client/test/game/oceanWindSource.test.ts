// client/test/game/oceanWindSource.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import {
  OCEAN_GPU_DEADLINE, WIND_SEA_RESPECTRUM_U, cascadeStats, createWindSeaSource, needsRespectrum, startLoopWorker,
  type GpuStarter, type LoopStarter,
} from "../../src/game/oceanWindSource.js";
import type { GpuWindSea } from "../../src/game/oceanGpuFft.js";
import type { LoopReply } from "../../src/game/oceanLoopBake.js";
import { LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE } from "../../src/game/oceanSpectrum.js";
import { OCEAN_SEA_LAG, windSeaAtSpeed, windSeaStateFor } from "../../src/game/oceanWindSea.js";
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
function fakeGpu(scene: Scene, start: ReturnType<GpuWindSea["status"]> = "running") {
  let status = start;
  return {
    disp: oceanArrayPlaceholder(scene),
    slope: oceanArrayPlaceholder(scene),
    setSpectrum: vi.fn<GpuWindSea["setSpectrum"]>(),
    step: vi.fn<GpuWindSea["step"]>(),
    status: (): ReturnType<GpuWindSea["status"]> => status,
    dispose: vi.fn<GpuWindSea["dispose"]>(),
    run(): void {
      status = "running";
    },
    fail(): void {
      status = "failed";
    },
  };
}

/** A Worker that records what it is sent and whether it was ended; the test answers for it. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static refuse = false;
  readonly posted: unknown[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<LoopReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    if (FakeWorker.refuse) throw new Error("no worker to be had");
    FakeWorker.made.push(this);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated++;
  }
}

/** Lets every promise already settled run its callbacks. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The wind sea of a wind of u10 m/s blowing onshore, at noon. */
const at = (u10: number) => windSeaStateFor(u10 / 12, [1, 0], 12);

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
    expect(startLoop).toHaveBeenCalledWith(SEED, expect.any(AbortSignal));
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
    // 6 m/s, held until the sea has followed it: lengths and heights by 0.36, time at 10/6.
    const light = windSeaStateFor(0.5, [1, 0], 12);
    source.update(light, 3730);
    source.update(light, 3733);
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
    expect(startLoop).toHaveBeenCalledWith(SEED, expect.any(AbortSignal));
    expect(source.disp).toBeInstanceOf(RawTexture2DArray);
    source.dispose();
  }, timeLimit(30_000));

  it("falls back on high to the loop where the compute's module fails to load", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop, () => Promise.reject(new Error("the chunk did not load")));
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    expect(startLoop).toHaveBeenCalledWith(SEED, expect.any(AbortSignal));
    expect(source.disp).toBeInstanceOf(RawTexture2DArray);
    source.dispose();
  }, timeLimit(30_000));

  it("draws the FFT on high along +x once it runs, rebuilt by the step, stepped every frame, and the loop once it fails", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const gpu = fakeGpu(scene);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop, () => Promise.resolve(gpu));
    await settle();
    // The wind turning never rebuilds: the shaders turn the field.
    source.update(windSeaStateFor(10 / 12, [1, 0], 12), 50);
    expect(source.mode).toBe(2);
    expect(source.disp).toBe(gpu.disp);
    expect(source.slope).toBe(gpu.slope);
    source.update(windSeaStateFor(10.4 / 12, [0, 1], 12), 51);
    expect(gpu.setSpectrum).toHaveBeenCalledTimes(1);
    expect(gpu.setSpectrum).toHaveBeenCalledWith({ u10: 10, dir: [1, 0] }, SEED);
    expect(source.stats).toEqual(cascadeStats(10));
    // The sea follows its wind a minute behind: 10.6 m/s held two and a half minutes moves it past the step.
    source.update(windSeaStateFor(10.6 / 12, [0, 1], 12), 200);
    expect(gpu.setSpectrum).toHaveBeenCalledTimes(2);
    expect(gpu.step.mock.calls.map(([seconds]) => seconds)).toEqual([50, 51, 200]);
    expect(startLoop).not.toHaveBeenCalled();
    gpu.fail();
    source.update(windSeaStateFor(10.6 / 12, [0, 1], 12), 201);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(source.mode).toBe(0);
    expect(startLoop).toHaveBeenCalledWith(SEED, expect.any(AbortSignal));
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    source.dispose();
  }, timeLimit(30_000));

  it("draws the FFT only once it runs: mode 0 and no fields while its shaders compile, stepped all along", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const gpu = fakeGpu(scene, "compiling");
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop, () => Promise.resolve(gpu));
    await settle();
    source.update(at(10), 50);
    source.update(at(10), 60);
    expect([source.mode, source.disp, source.slope]).toEqual([0, null, null]);
    expect(gpu.step.mock.calls.map(([seconds]) => seconds)).toEqual([50, 60]);
    gpu.run();
    source.update(at(10), 61);
    expect(source.mode).toBe(2);
    expect(source.disp).toBe(gpu.disp);
    expect(source.slope).toBe(gpu.slope);
    expect(startLoop).not.toHaveBeenCalled();
    source.dispose();
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
  });

  it("draws the loop instead of an FFT still compiling OCEAN_GPU_DEADLINE seconds on, no second counted twice", async () => {
    expect(OCEAN_GPU_DEADLINE).toBe(30);
    engine = new NullEngine();
    const scene = new Scene(engine);
    const gpu = fakeGpu(scene, "compiling");
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop, () => Promise.resolve(gpu));
    await settle();
    source.update(at(10), 100);
    source.update(at(10), 125);
    // A step back and on again: 29 s have passed, not 34.
    source.update(at(10), 120);
    source.update(at(10), 129);
    expect(gpu.dispose).not.toHaveBeenCalled();
    expect(startLoop).not.toHaveBeenCalled();
    source.update(at(10), 130.5);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(startLoop).toHaveBeenCalledWith(SEED, expect.any(AbortSignal));
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    // The FFT gone, it is stepped no more.
    const steps = gpu.step.mock.calls.length;
    source.update(at(10), 131);
    expect(gpu.step).toHaveBeenCalledTimes(steps);
    source.dispose();
  }, timeLimit(30_000));

  it("follows its wind a minute behind: the wind's own speed on the first frame, a step approached exponentially, a step back held", () => {
    expect(OCEAN_SEA_LAG).toBe(60);
    engine = new NullEngine();
    const source = createWindSeaSource(new Scene(engine), SEED, "low");
    // No ramp from still air: the first frame's sea is its wind's.
    expect(source.update(at(6), 0).u10).toBe(6);
    // A step to 8 m/s, frame by frame at 60 a second: a minute on, 1 - 1/e of the way.
    let sea = source.update(at(8), 0);
    for (let f = 1; f <= 3600; f++) sea = source.update(at(8), f / 60);
    expect(sea.u10).toBeCloseTo(7.2642411, 6);
    // The seconds stepping back move it not at all; two minutes on, 1 - 1/e² of the way.
    expect(source.update(at(8), 59).u10).toBe(sea.u10);
    sea = source.update(at(8), 120);
    expect(sea.u10).toBeCloseTo(7.7293294, 6);
    // Everything the speed gives follows it: the height, the whitecaps, the loop's scale and rate.
    expect(sea).toEqual(windSeaAtSpeed(at(8), sea.u10));
    source.dispose();
  });

  it("rebuilds the FFT's spectrum at most once over a 3 s weather fade from 6 to 8 m/s, then follows it over minutes", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const gpu = fakeGpu(scene);
    const source = createWindSeaSource(scene, SEED, "high", (seed) => Promise.resolve(reply(seed)), () => Promise.resolve(gpu));
    await settle();
    for (let f = 0; f <= 180; f++) source.update(at(6 + (2 * f) / 180), 100 + f / 60);
    // The first build, at 6 m/s, and at most one more through the fade.
    expect(gpu.setSpectrum.mock.calls[0]?.[0]).toEqual({ u10: 6, dir: [1, 0] });
    expect(gpu.setSpectrum.mock.calls.length).toBeLessThanOrEqual(2);
    // Held at 8 m/s, the sea comes up to it a step at a time: within a step of it five minutes on.
    for (let f = 1; f <= 300; f++) source.update(at(8), 103 + f);
    expect(gpu.setSpectrum.mock.calls.at(-1)?.[0].u10).toBeGreaterThan(7.5);
    source.dispose();
  });

  it("bakes in a worker of its own, ended on its answer, and rejects one it cannot make or read", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const answered = startLoopWorker(7, new AbortController().signal);
      const worker = FakeWorker.made.at(-1) as FakeWorker;
      expect(String(worker.url)).toMatch(/\/oceanLoop\.worker\.ts$/);
      expect(worker.options).toEqual({ type: "module" });
      expect(worker.posted).toEqual([{ seed: 7 }]);
      const sent = reply(7);
      worker.onmessage?.({ data: sent } as MessageEvent<LoopReply>);
      await expect(answered).resolves.toBe(sent);
      expect(worker.terminated).toBe(1);
      const unreadable = startLoopWorker(7);
      const second = FakeWorker.made.at(-1) as FakeWorker;
      second.onmessageerror?.({} as MessageEvent);
      await expect(unreadable).rejects.toThrow("unreadable");
      expect(second.terminated).toBe(1);
      // A worker that cannot be made rejects; it does not throw.
      FakeWorker.refuse = true;
      await expect(startLoopWorker(7)).rejects.toThrow("no worker to be had");
    } finally {
      FakeWorker.refuse = false;
      vi.unstubAllGlobals();
    }
    // And with no Worker at all, as under Node.
    await expect(startLoopWorker(7)).rejects.toThrow("no Worker");
  });

  it("ends the bake's worker when the sea goes before it answers, and leaves an answer that comes after unused", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const make = vi.spyOn(engine, "createRawTexture2DArray");
      const source = createWindSeaSource(scene, SEED, "medium");
      const worker = FakeWorker.made.at(-1) as FakeWorker;
      expect(worker.posted).toEqual([{ seed: SEED }]);
      source.dispose();
      expect(worker.terminated).toBe(1);
      worker.onmessage?.({ data: reply(SEED) } as MessageEvent<LoopReply>);
      await settle();
      expect(worker.terminated).toBe(2);
      expect(make).not.toHaveBeenCalled();
      expect(source.mode).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the swell alone, and no rejection unhandled, when the loop's upload throws", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const make = vi.spyOn(engine, "createRawTexture2DArray").mockImplementation(() => {
      throw new Error("no texture to be had");
    });
    const source = createWindSeaSource(scene, SEED, "medium", (seed) => Promise.resolve(reply(seed)));
    await settle();
    expect(make).toHaveBeenCalledTimes(1);
    expect([source.mode, source.disp]).toEqual([0, null]);
    source.update(at(10), 1);
    expect(source.mode).toBe(0);
    source.dispose();
  });

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
