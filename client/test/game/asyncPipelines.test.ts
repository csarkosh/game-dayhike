import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { WebGPUCacheRenderPipeline } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js";
import { WebGPUCacheRenderPipelineTree } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipelineTree.js";
import {
  REVEAL_PIPELINES_MAX_MS,
  asyncPipelinesOf,
  installPipelines,
  leftOutOn,
  maxInFlightFor,
  revealWhenWhole,
  type AsyncPipelines,
  type PipelinesReport,
} from "../../src/game/asyncPipelines.js";
import { parsePipelines } from "../../src/game/engineChoice.js";
import { watchPipelines } from "../../src/game/gpuEngine.js";
import { timeLimit } from "../helpers/timeLimit.js";

const require = createRequire(import.meta.url);
const read = (spec: string): string => readFileSync(require.resolve(spec), "utf8");

type Deferred = { promise: Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void };
function deferred(): Deferred {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A device as the pipeline cache reads it: asynchronous creations the test
 * settles by hand, in the order they were asked for; synchronous ones made
 * at once and named; a loss the test can cause. */
function fakeDevice() {
  const asked: { label: string; made: Deferred }[] = [];
  const made: string[] = [];
  let lose: () => void = () => undefined;
  const device = {
    limits: {},
    lost: new Promise<unknown>((resolve) => {
      lose = () => resolve({ reason: "unknown" });
    }),
    createRenderPipelineAsync(descriptor: { label: string }): Promise<unknown> {
      const creation = deferred();
      asked.push({ label: descriptor.label, made: creation });
      return creation.promise;
    },
    createRenderPipeline(descriptor: { label: string }): unknown {
      made.push(descriptor.label);
      return { made: descriptor.label };
    },
  };
  return { device, asked, made, lose: () => lose() };
}

/** An effect as the cache's lookup reads it: its id, and no attributes. */
function effect(uniqueId: number) {
  return { uniqueId, _pipelineContext: { shaderProcessingContext: { attributeNamesFromEffect: [], attributeLocationsFromEffect: [] } } };
}

/** The cache as the tests reach into it (Babylon declares these private). */
type Cache = {
  _parameter: { token: { pipeline?: unknown }; pipeline: unknown };
  _lookupRenderPipeline(fillMode: number, effect: unknown, sampleCount: number, textureState: number): unknown;
  _setRenderPipeline(param: { token: unknown; pipeline: unknown }): void;
  getRenderPipeline(fillMode: number, effect: unknown, sampleCount: number, textureState?: number): unknown;
};

/** Babylon's own tree cache on the fake device, its descriptor named by the
 * effect's id (a real one would need the effect's shader modules). */
function cacheOn(device: object): Cache {
  const cache = new WebGPUCacheRenderPipelineTree(device as never, {} as never) as unknown as Cache;
  (cache as unknown as { _buildRenderPipelineDescriptor(e: { uniqueId: number }): { label: string } })._buildRenderPipelineDescriptor = (e) => ({
    label: `effect ${e.uniqueId}`,
  });
  return cache;
}

type FakeEngine = {
  _cacheRenderPipeline: Cache;
  _currentEffect: unknown;
  _draw(drawType: number, fillMode: number, start: number, count: number, instancesCount: number): void;
  isDisposed: boolean;
  snapshotRendering: boolean;
  onEndFrameObservable: Observable<unknown>;
  onDisposeObservable: Observable<unknown>;
  drawn: unknown[];
};

/** An engine as the patch reads it: its cache, and a `_draw` that asks the
 * cache for the current effect's pipeline, as Babylon's does, and records
 * what it drew with. */
function engineOn(cache: Cache): FakeEngine {
  const engine: FakeEngine = {
    _cacheRenderPipeline: cache,
    _currentEffect: null,
    isDisposed: false,
    snapshotRendering: false,
    onEndFrameObservable: new Observable<unknown>(),
    onDisposeObservable: new Observable<unknown>(),
    drawn: [],
    _draw(_drawType, fillMode) {
      engine.drawn.push(engine._cacheRenderPipeline.getRenderPipeline(fillMode, engine._currentEffect, 1, 0));
    },
  };
  return engine;
}

function draw(engine: FakeEngine, e: unknown): void {
  engine._currentEffect = e;
  engine._draw(0, 0, 0, 3, 1);
}

/** Lets every settled creation's handlers run. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function page(): PipelinesReport {
  const report = (globalThis as { dayhikePipelines?: PipelinesReport }).dayhikePipelines;
  if (report === undefined) throw new Error("no report on the page");
  return report;
}

/** A patched engine on a fresh cache, `limit` in flight. */
function patched(limit: number, now?: () => number) {
  const gpu = fakeDevice();
  const cache = cacheOn(gpu.device);
  const engine = engineOn(cache);
  const pipelines = installPipelines(engine as never, limit, now === undefined ? {} : { now }) as AsyncPipelines;
  return { ...gpu, cache, engine, pipelines };
}

beforeEach(() => {
  WebGPUCacheRenderPipelineTree.ResetCache();
  delete (globalThis as { dayhikePipelines?: PipelinesReport }).dayhikePipelines;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 0;
});

describe("Babylon's WebGPU pipeline cache and draw (canaries: when one fails, Babylon has moved; revise the patch in the upgrade's own commit)", () => {
  it("still has the methods the patch calls, on the cache's prototype", () => {
    const proto = WebGPUCacheRenderPipeline.prototype as unknown as Record<string, unknown>;
    for (const name of ["getRenderPipeline", "_lookupRenderPipeline", "_buildRenderPipelineDescriptor", "_createRenderPipeline", "preWarmPipeline", "_setRenderPipeline"]) {
      expect(typeof proto[name], name).toBe("function");
    }
    expect(typeof (WebGPUCacheRenderPipeline as unknown as { _GetTopology: unknown })._GetTopology).toBe("function");
  });

  it("still leaves a lookup's node where the patch reads it, and finds a pipeline stored there as the pre-warm stores it", () => {
    const { device } = fakeDevice();
    const cache = cacheOn(device);
    const first = effect(1);
    expect(cache._lookupRenderPipeline(0, first, 1, 0)).toBeNull();
    const node = cache._parameter.token;
    expect(typeof node).toBe("object");
    // The same state again: the same node, still empty.
    expect(cache._lookupRenderPipeline(0, first, 1, 0)).toBeNull();
    expect(cache._parameter.token).toBe(node);
    // Another effect: another node.
    expect(cache._lookupRenderPipeline(0, effect(2), 1, 0)).toBeNull();
    expect(cache._parameter.token).not.toBe(node);
    // Stored as `preWarmPipeline` stores it, found by the lookup.
    const pipeline = { made: "ahead" };
    cache._setRenderPipeline({ token: node, pipeline });
    expect(cache._lookupRenderPipeline(0, first, 1, 0)).toBe(pipeline);
    // And by Babylon's own draw-time path, which then makes nothing.
    expect(cache.getRenderPipeline(0, first, 1, 0)).toBe(pipeline);
    expect(device.made).toEqual([]);
  });

  it("still stores a pre-warmed pipeline in the node captured before the call, and normalises the sample count as the patch does", () => {
    const src = read("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js");
    const warm = src.slice(src.indexOf("    preWarmPipeline(fillMode, effect, sampleCount, textureState = 0) {"), src.indexOf("\n    }\n", src.indexOf("    preWarmPipeline(")));
    expect(warm).toContain("const capturedParam = { token: this._parameter.token, pipeline: null };");
    expect(warm).toContain("this._device.createRenderPipelineAsync(this._buildRenderPipelineDescriptor(effect, topology, sampleCount));");
    expect(warm).toContain("this._setRenderPipeline(capturedParam);");
    const get = src.slice(src.indexOf("    getRenderPipeline(fillMode, effect, sampleCount, textureState = 0) {"), src.indexOf("    endFrame() {"));
    expect(get).toContain("sampleCount = WebGPUTextureHelper.GetSample(sampleCount);");
    expect(get).toContain("const cached = this._lookupRenderPipeline(fillMode, effect, sampleCount, textureState);");
    // A synchronous creation is counted for the frame; the patch's are not.
    expect(get).toContain("WebGPUCacheRenderPipeline._NumPipelineCreationCurrentFrame++;");
    const tree = read("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipelineTree.js");
    expect(tree).toContain("        param.token = node;\n        param.pipeline = node.pipeline;");
    expect(tree).toContain("        param.token.pipeline = param.pipeline;");
  });

  it("still asks the cache for the draw's pipeline before it makes a bundle encoder or sets a pipeline, and after its fast path", () => {
    const src = read("@babylonjs/core/Engines/webgpuEngine.pure.js");
    const body = src.slice(src.indexOf("    _draw(drawType, fillMode, start, count, instancesCount) {"), src.indexOf("    drawElementsType(fillMode, indexStart, indexCount, instancesCount = 1) {"));
    const at = (text: string): number => body.indexOf(text);
    const ask = at("const pipeline = this._cacheRenderPipeline.getRenderPipeline(fillMode, this._currentEffect, this.currentSampleCount, textureState);");
    expect(ask).toBeGreaterThan(0);
    // One call, on the engine's own cache.
    expect(body.match(/getRenderPipeline\(/g)).toEqual(["getRenderPipeline("]);
    // Nothing is encoded before it but on the fast path, which returns first,
    // and the snapshot recording's encoder, which the patch leaves to Babylon.
    expect(at("this._device.createRenderBundleEncoder(")).toBeGreaterThan(ask);
    expect(at("renderPass2.setPipeline(pipeline);")).toBeGreaterThan(ask);
    expect(at("this._cacheBindGroups.getBindGroups(")).toBeGreaterThan(ask);
    expect(body.lastIndexOf("this._reportDrawCall();")).toBeGreaterThan(ask);
    const before = (text: string): void => {
      expect(at(text), text).toBeGreaterThan(0);
      expect(at(text), text).toBeLessThan(ask);
    };
    before("bundleList.addBundle(this._currentDrawContext.fastBundle);\n                this._reportDrawCall();\n                return;");
    before("renderPass2 = bundleList.getBundleEncoder(");
    // The draw context's bundle is dropped before the ask when it is stale,
    // so a draw left out is drawn again whole, never from a bundle.
    before("this._currentDrawContext.fastBundle = undefined;");
    // The engine's cache is the one the patch replaces the method on.
    expect(src).toContain("this._cacheRenderPipeline = new WebGPUCacheRenderPipelineTree(this._device, this._emptyVertexBuffer);");
    // Snapshot rendering is readable on the engine.
    expect(src).toContain("    get snapshotRendering() {\n        return this._snapshotRendering.enabled;");
  });
});

describe("render pipelines made asynchronously", () => {
  it("starts ONE creation for a miss inside the scope, and leaves the draw out", () => {
    const { asked, made, engine, pipelines } = patched(4);
    pipelines.enter();
    draw(engine, effect(1));
    expect(asked.map((a) => a.label)).toEqual(["effect 1"]);
    expect(made).toEqual([]);
    expect(engine.drawn).toEqual([]);
    expect(pipelines.takeSkipped()).toBe(1);
    expect(pipelines.takeSkipped()).toBe(0);
    expect(pipelines.pending()).toBe(1);
  });

  it("starts none for a second draw of the same node, which is left out too", () => {
    const { asked, engine, pipelines } = patched(4);
    pipelines.enter();
    draw(engine, effect(1));
    draw(engine, effect(1));
    expect(asked.length).toBe(1);
    expect(pipelines.takeSkipped()).toBe(2);
    expect(pipelines.pending()).toBe(1);
  });

  it("stores a landed pipeline in its node, where the next draw finds it by Babylon's own lookup", async () => {
    const { asked, made, cache, engine, pipelines } = patched(4);
    pipelines.enter();
    const first = effect(1);
    draw(engine, first);
    const pipeline = { made: "asynchronously" };
    asked[0]!.made.resolve(pipeline);
    await flush();
    expect(pipelines.pending()).toBe(0);
    const lookups = vi.spyOn(cache, "_lookupRenderPipeline");
    draw(engine, first);
    expect(engine.drawn).toEqual([pipeline]);
    expect(lookups).toHaveBeenCalledTimes(1);
    expect(asked.length).toBe(1);
    expect(made).toEqual([]);
    expect(pipelines.takeSkipped()).toBe(1);
  });

  it("sends the next draw of a node whose creation failed down Babylon's synchronous path, and never asks for it asynchronously again", async () => {
    const { asked, made, cache, engine, pipelines } = patched(4);
    pipelines.enter();
    const first = effect(1);
    draw(engine, first);
    asked[0]!.made.reject(new Error("pipeline validation failed"));
    await flush();
    expect(pipelines.pending()).toBe(0);
    draw(engine, first);
    expect(made).toEqual(["effect 1"]);
    expect(engine.drawn).toEqual([{ made: "effect 1" }]);
    // The node emptied again: still Babylon's path, still no asynchronous ask.
    cache._parameter.token.pipeline = undefined;
    cache._parameter.pipeline = null;
    draw(engine, first);
    expect(made).toEqual(["effect 1", "effect 1"]);
    expect(asked.length).toBe(1);
    expect(pipelines.takeSkipped()).toBe(1);
  });

  it("uses Babylon's synchronous path outside the scope", () => {
    const { asked, made, engine, pipelines } = patched(4);
    draw(engine, effect(1));
    pipelines.enter();
    pipelines.leave();
    draw(engine, effect(2));
    expect(made).toEqual(["effect 1", "effect 2"]);
    expect(asked).toEqual([]);
    expect(pipelines.takeSkipped()).toBe(0);
    // A leave with no enter leaves the scope shut.
    pipelines.leave();
    pipelines.enter();
    pipelines.leave();
    draw(engine, effect(3));
    expect(made).toEqual(["effect 1", "effect 2", "effect 3"]);
  });

  it("uses Babylon's synchronous path while the engine renders by snapshot", () => {
    const { asked, made, engine, pipelines } = patched(4);
    engine.snapshotRendering = true;
    pipelines.enter();
    draw(engine, effect(1));
    expect(made).toEqual(["effect 1"]);
    expect(asked).toEqual([]);
  });

  it("keeps at most the limit in flight and starts the rest first in, first out", async () => {
    const { asked, engine, pipelines } = patched(2);
    pipelines.enter();
    for (const id of [1, 2, 3, 4]) draw(engine, effect(id));
    expect(asked.map((a) => a.label)).toEqual(["effect 1", "effect 2"]);
    expect(pipelines.pending()).toBe(4);
    asked[1]!.made.resolve({ made: 2 });
    await flush();
    expect(asked.map((a) => a.label)).toEqual(["effect 1", "effect 2", "effect 3"]);
    expect(pipelines.pending()).toBe(3);
    asked[0]!.made.reject(new Error("failed"));
    await flush();
    expect(asked.map((a) => a.label)).toEqual(["effect 1", "effect 2", "effect 3", "effect 4"]);
    expect(pipelines.pending()).toBe(2);
  });

  it("starts nothing and stores nothing once the engine is disposed", async () => {
    const { asked, made, cache, engine, pipelines } = patched(1);
    pipelines.enter();
    const first = effect(1);
    draw(engine, first);
    draw(engine, effect(2));
    expect(asked.length).toBe(1);
    engine.isDisposed = true;
    asked[0]!.made.resolve({ made: 1 });
    await flush();
    expect(asked.length).toBe(1);
    expect(cache._lookupRenderPipeline(0, first, 1, 0)).toBeNull();
    expect(pipelines.pending()).toBe(0);
    // A draw in the scope now is Babylon's, as on a disposed engine today.
    pipelines.takeSkipped();
    draw(engine, effect(3));
    expect(made).toEqual(["effect 3"]);
    expect(pipelines.takeSkipped()).toBe(0);
  });

  it("starts nothing and stores nothing once the device is lost", async () => {
    const { asked, cache, engine, pipelines, lose } = patched(1);
    pipelines.enter();
    const first = effect(1);
    draw(engine, first);
    draw(engine, effect(2));
    lose();
    await flush();
    asked[0]!.made.resolve({ made: 1 });
    await flush();
    expect(asked.length).toBe(1);
    expect(cache._lookupRenderPipeline(0, first, 1, 0)).toBeNull();
    expect(pipelines.pending()).toBe(0);
  });

  it("puts the engine's own methods back on remove, and starts and stores nothing after", async () => {
    const { asked, made, cache, engine, pipelines } = patched(1);
    expect(Object.prototype.hasOwnProperty.call(cache, "getRenderPipeline")).toBe(true);
    expect(asyncPipelinesOf(engine as never)).toBe(pipelines);
    pipelines.enter();
    const first = effect(1);
    draw(engine, first);
    draw(engine, effect(2));
    pipelines.remove();
    expect(Object.prototype.hasOwnProperty.call(cache, "getRenderPipeline")).toBe(false);
    expect(cache.getRenderPipeline).toBe(WebGPUCacheRenderPipeline.prototype.getRenderPipeline);
    expect(asyncPipelinesOf(engine as never)).toBeNull();
    expect(pipelines.pending()).toBe(0);
    asked[0]!.made.resolve({ made: 1 });
    await flush();
    expect(asked.length).toBe(1);
    expect(cache._lookupRenderPipeline(0, first, 1, 0)).toBeNull();
    draw(engine, effect(3));
    expect(made).toEqual(["effect 3"]);
  });

  it("restores the draw it wrapped, the engine's own", () => {
    const gpu = fakeDevice();
    const engine = engineOn(cacheOn(gpu.device));
    const ownDraw = engine._draw;
    const pipelines = installPipelines(engine as never, 2) as AsyncPipelines;
    expect(engine._draw).not.toBe(ownDraw);
    pipelines.remove();
    expect(engine._draw).toBe(ownDraw);
  });

  it("passes every other throw out of the draw unchanged", () => {
    const { engine, pipelines } = patched(2);
    const cache = engine._cacheRenderPipeline as unknown as { _buildRenderPipelineDescriptor(): never };
    const broken = new Error("the descriptor could not be built");
    cache._buildRenderPipelineDescriptor = () => {
      throw broken;
    };
    pipelines.enter();
    expect(() => draw(engine, effect(1))).toThrow(broken);
    expect(pipelines.takeSkipped()).toBe(0);
  });

  it("settles when nothing is pending, at once or when the last lands, and gives up after its bound", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { asked, engine, pipelines } = patched(2);
    expect(await pipelines.settled(100)).toBe(true);
    pipelines.enter();
    draw(engine, effect(1));
    const landing = pipelines.settled(100);
    asked[0]!.made.resolve({ made: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await landing).toBe(true);
    draw(engine, effect(2));
    let answer: boolean | null = null;
    void pipelines.settled(100).then((emptied) => (answer = emptied));
    await vi.advanceTimersByTimeAsync(99);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBe(false);
  });

  it("counts what it asked, landed, failed and left out, the longest wait, what is pending, and the synchronous ones, on the page", async () => {
    let clock = 1_000;
    const { asked, engine, pipelines } = patched(2, () => clock);
    expect(page()).toMatchObject({ mode: "async", limit: 2, asked: 0, landed: 0, failed: 0, sync: 0, leftOut: 0, longestMs: 0, pending: 0 });
    pipelines.enter();
    draw(engine, effect(1));
    draw(engine, effect(1));
    draw(engine, effect(2));
    draw(engine, effect(3));
    expect(page()).toMatchObject({ asked: 3, leftOut: 4, pending: 3 });
    clock = 1_250;
    asked[0]!.made.resolve({ made: 1 });
    await flush();
    clock = 2_000;
    asked[1]!.made.reject(new Error("failed"));
    await flush();
    clock = 5_500;
    asked[2]!.made.resolve({ made: 3 });
    await flush();
    expect(page()).toMatchObject({ asked: 3, landed: 2, failed: 1, leftOut: 4, longestMs: 4_500, pending: 0 });
    WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 3;
    engine.onEndFrameObservable.notifyObservers(engine);
    WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 0;
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(page().sync).toBe(3);
    expect(leftOutOn(engine as never)).toBe(4);
  });

  it("is not installed on an engine with no pipeline cache, such as one whose start has not come", () => {
    const engine = { onEndFrameObservable: new Observable<unknown>() };
    expect(installPipelines(engine as never, 2)).toBeNull();
    expect(asyncPipelinesOf(engine as never)).toBeNull();
    expect(leftOutOn(engine as never)).toBe(0);
  });
});

describe("the address switch, ?pipelines=", () => {
  it("reads sync, async, or a limit from 1 to 16, and anything else as async", () => {
    expect(parsePipelines("?pipelines=sync")).toBe("sync");
    expect(parsePipelines("?pipelines=async")).toBe("async");
    expect(parsePipelines("")).toBe("async");
    expect(parsePipelines("?tier=high&pipelines=8")).toBe(8);
    expect(parsePipelines("?pipelines=1")).toBe(1);
    expect(parsePipelines("?pipelines=16")).toBe(16);
    expect(parsePipelines("?pipelines=0")).toBe("async");
    expect(parsePipelines("?pipelines=17")).toBe("async");
    expect(parsePipelines("?pipelines=2.5")).toBe("async");
    expect(parsePipelines("?pipelines=SYNC")).toBe("async");
  });

  it("leaves Babylon's path as it is with sync, and still reports the synchronous ones", () => {
    const gpu = fakeDevice();
    const cache = cacheOn(gpu.device);
    const engine = engineOn(cache);
    const ownDraw = engine._draw;
    expect(installPipelines(engine as never, "sync")).toBeNull();
    expect(engine._draw).toBe(ownDraw);
    expect(Object.prototype.hasOwnProperty.call(cache, "getRenderPipeline")).toBe(false);
    expect(page()).toMatchObject({ mode: "sync", limit: 0 });
    WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 2;
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(page().sync).toBe(2);
  });

  it("installs the patch with the limit given, each engine's report replacing the last", () => {
    const first = engineOn(cacheOn(fakeDevice().device));
    expect(installPipelines(first as never, 5)).not.toBeNull();
    expect(page()).toMatchObject({ mode: "async", limit: 5 });
    const second = engineOn(cacheOn(fakeDevice().device));
    expect(installPipelines(second as never, 16)).not.toBeNull();
    expect(page()).toMatchObject({ mode: "async", limit: 16 });
  });

  it("keeps two in flight at least, and two fewer than the processor's cores where it has more", () => {
    expect(maxInFlightFor(undefined)).toBe(2);
    expect(maxInFlightFor(0)).toBe(2);
    expect(maxInFlightFor(1)).toBe(2);
    expect(maxInFlightFor(4)).toBe(2);
    expect(maxInFlightFor(5)).toBe(3);
    expect(maxInFlightFor(8)).toBe(6);
    expect(maxInFlightFor(16)).toBe(14);
  });

  it("computes the page's limit once, from the processor's cores, and two where the browser gives none; async installs it", async () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
    vi.resetModules();
    const eight = await import("../../src/game/asyncPipelines.js");
    expect(eight.ASYNC_PIPELINES_MAX_IN_FLIGHT).toBe(6);
    expect(eight.installPipelines(engineOn(cacheOn(fakeDevice().device)) as never, "async")).not.toBeNull();
    expect(page()).toMatchObject({ mode: "async", limit: 6 });
    vi.stubGlobal("navigator", {});
    vi.resetModules();
    const none = await import("../../src/game/asyncPipelines.js");
    expect(none.ASYNC_PIPELINES_MAX_IN_FLIGHT).toBe(2);
    none.installPipelines(engineOn(cacheOn(fakeDevice().device)) as never, "async");
    expect(page()).toMatchObject({ mode: "async", limit: 2 });
  }, timeLimit(30_000));
});

describe("the frames the governor does not measure", () => {
  it("are told after a frame that left a draw out, as after one that made a pipeline, and no other", async () => {
    const { asked, engine, pipelines } = patched(2);
    let told = 0;
    const stop = watchPipelines(engine as never, () => void told++);
    try {
      pipelines.enter();
      draw(engine, effect(1));
      engine.onEndFrameObservable.notifyObservers(engine);
      expect(told).toBe(1);
      // Made asynchronously is not a hitch: a frame that only saw it land is measured.
      asked[0]!.made.resolve({ made: 1 });
      await flush();
      draw(engine, effect(1));
      engine.onEndFrameObservable.notifyObservers(engine);
      expect(told).toBe(1);
      // A pipeline made synchronously is one.
      WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 1;
      engine.onEndFrameObservable.notifyObservers(engine);
      expect(told).toBe(2);
      WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 0;
      stop();
      draw(engine, effect(2));
      engine.onEndFrameObservable.notifyObservers(engine);
      expect(told).toBe(2);
    } finally {
      stop();
    }
  });
});

describe("the reveal", () => {
  it("waits 10 s at most", () => {
    expect(REVEAL_PIPELINES_MAX_MS).toBe(10_000);
  });

  it("lifts at the end of the first frame that drew and left nothing out", async () => {
    const { asked, engine, pipelines } = patched(2);
    let lifted = 0;
    revealWhenWhole(engine as never, () => void lifted++);
    // A frame that drew nothing yet is not a whole world.
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(lifted).toBe(0);
    pipelines.enter();
    draw(engine, effect(1));
    engine.onEndFrameObservable.notifyObservers(engine);
    draw(engine, effect(1));
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(lifted).toBe(0);
    asked[0]!.made.resolve({ made: 1 });
    await flush();
    draw(engine, effect(1));
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(lifted).toBe(1);
    draw(engine, effect(2));
    engine.onEndFrameObservable.notifyObservers(engine);
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(lifted).toBe(1);
  });

  it("lifts 10 s after the end of the first frame when draws are still left out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { engine, pipelines } = patched(2);
    let lifted = 0;
    revealWhenWhole(engine as never, () => void lifted++);
    pipelines.enter();
    draw(engine, effect(1));
    engine.onEndFrameObservable.notifyObservers(engine);
    await vi.advanceTimersByTimeAsync(9_999);
    draw(engine, effect(1));
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(lifted).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(lifted).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lifted).toBe(1);
  });

  it("lifts at once on an engine that makes its pipelines as Babylon does, and never once stopped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const synchronous = engineOn(cacheOn(fakeDevice().device));
    installPipelines(synchronous as never, "sync");
    let lifted = 0;
    revealWhenWhole(synchronous as never, () => void lifted++);
    expect(lifted).toBe(1);
    const { engine, pipelines } = patched(2);
    const stop = revealWhenWhole(engine as never, () => void lifted++);
    pipelines.enter();
    draw(engine, effect(1));
    engine.onEndFrameObservable.notifyObservers(engine);
    stop();
    engine.onEndFrameObservable.notifyObservers(engine);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lifted).toBe(1);
  });
});
