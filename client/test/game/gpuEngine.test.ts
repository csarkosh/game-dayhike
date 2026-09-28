import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { EffectFallbacks } from "@babylonjs/core/Materials/effectFallbacks.js";
import { WebGPUCacheRenderPipeline } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js";
import { ThinWebGPUEngine } from "@babylonjs/core/Engines/thinWebGPUEngine.js";
import { WEBGPU_FETCH_MS } from "../../src/game/engineChoice.js";
import { catchTranslationFailures, mipEveryLayer, reportUnfetched, watchPipelines, watchWebGpu } from "../../src/game/gpuEngine.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("watchWebGpu", () => {
  const effectError = { effect: null as unknown as Effect, errors: "FRAGMENT SHADER ERROR" };

  /** A NullEngine with a device of its own, as a WebGPU engine has once
   * started: something to dispatch `uncapturederror` on. */
  function withDevice(): NullEngine & { _device: EventTarget } {
    return Object.assign(new NullEngine(), { _device: new EventTarget() });
  }

  it("reports an uncaptured error on its own engine's device as pipeline", () => {
    const engine = withDevice();
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => seen.push(reason));
    try {
      engine._device.dispatchEvent(new Event("uncapturederror"));
      expect(seen).toEqual(["pipeline"]);
      // The same reason again, by another road, is not reported twice.
      engine.onEffectErrorObservable.notifyObservers(effectError);
      expect(seen).toEqual(["pipeline"]);
    } finally {
      stop();
      engine.dispose();
    }
  });

  it("hears no other engine's uncaptured error, nor Babylon's page-wide log of one, and nothing once it is off", () => {
    const watched = withDevice();
    const other = withDevice();
    const seen: string[] = [];
    const stop = watchWebGpu(watched, (reason) => seen.push(reason));
    try {
      other._device.dispatchEvent(new Event("uncapturederror"));
      Logger.Warn("[Frame 3] WebGPU uncaptured error (1): [object GPUValidationError] - binding missing");
      expect(seen).toEqual([]);
      stop();
      watched._device.dispatchEvent(new Event("uncapturederror"));
      expect(seen).toEqual([]);
    } finally {
      watched.dispose();
      other.dispose();
    }
  });

  it("hears the device Babylon itself listens on (a canary on the installed engine)", () => {
    const src = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(src).toContain("            this._device = device;");
    expect(src).toContain('            this._device.addEventListener("uncapturederror", (event) => {');
  });

  it("reports a failed effect as pipeline and a lost device as lost, each once", () => {
    const engine = new NullEngine();
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => seen.push(reason));
    try {
      engine.onEffectErrorObservable.notifyObservers(effectError);
      expect(seen).toEqual(["pipeline"]);
      engine.onContextLostObservable.notifyObservers(engine);
      engine.onContextLostObservable.notifyObservers(engine);
      expect(seen).toEqual(["pipeline", "lost"]);
    } finally {
      stop();
      engine.dispose();
    }
  });

  it("stops Babylon's own restore after a lost device, since the renderer is rebuilt on a new engine instead", () => {
    vi.useFakeTimers();
    const engine = new NullEngine();
    const stop = watchWebGpu(engine, () => undefined);
    try {
      // Babylon notifies, then calls the restore on the same engine: the
      // watcher answers in between.
      engine.onContextLostObservable.notifyObservers(engine);
      let restored = false;
      (engine as unknown as { _restoreEngineAfterContextLost(init: () => void): void })._restoreEngineAfterContextLost(() => {
        restored = true;
      });
      vi.advanceTimersByTime(10);
      expect(restored).toBe(false);
    } finally {
      stop();
      engine.dispose();
      vi.useRealTimers();
    }
  });

  it("gives Babylon's restore up from the moment it watches, and leaves it given up after: no second device for an engine let go", () => {
    vi.useFakeTimers();
    const engine = new NullEngine();
    // Babylon's own restore runs its `initEngine` on a timer.
    const restore = (): boolean => {
      let restored = false;
      (engine as unknown as { _restoreEngineAfterContextLost(init: () => void): void })._restoreEngineAfterContextLost(() => {
        restored = true;
      });
      vi.advanceTimersByTime(10);
      return restored;
    };
    const stop = watchWebGpu(engine, () => undefined);
    try {
      // A loss Babylon restores without the watcher having heard it first
      // (a device lost after the watcher is off, say).
      expect(restore()).toBe(false);
      stop();
      expect(restore()).toBe(false);
    } finally {
      engine.dispose();
      vi.useRealTimers();
    }
  });

  it("makes every WebGPU engine with Babylon's restore given up (the source of the one maker)", () => {
    const src = readFileSync(new URL("../../src/game/gpuEngine.ts", import.meta.url), "utf8");
    const start = src.slice(src.indexOf("  const start = async (): Promise<WebGPUEngine> => {"), src.indexOf("    await engine.initAsync("));
    expect(start).toContain("    giveUpRestore(engine);");
  });

  it("notifies a lost device before Babylon starts its restore, which it looks up on the engine (a canary on the installed engine)", () => {
    const src = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    // The restore is the engine's own `_restoreEngineAfterContextLost`, looked
    // up on the instance when the loss comes, and it makes a new device
    // (`initAsync`): replacing it on the instance is what stops it.
    expect(src).toContain("                        await this.initAsync(this._glslangOptions ?? this._options?.glslangOptions, this._twgslOptions ?? this._options?.twgslOptions);");
    expect(src).toContain(
      "                    this.onContextLostObservable.notifyObservers(this);\n" +
        "                    // eslint-disable-next-line @typescript-eslint/no-misused-promises\n" +
        "                    this._restoreEngineAfterContextLost(async () => {",
    );
  });

  it("reports a failure whenever it comes: no startup window decides anything any more", () => {
    const engine = new NullEngine();
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => seen.push(reason));
    try {
      engine.onEndFrameObservable.notifyObservers(engine);
      engine.onAfterShaderCompilationObservable.notifyObservers(engine);
      engine.onEffectErrorObservable.notifyObservers(effectError);
      engine.onContextLostObservable.notifyObservers(engine);
      expect(seen).toEqual(["pipeline", "lost"]);
    } finally {
      stop();
      engine.dispose();
    }
  });

  it("hears nothing from a disposed engine: Babylon reports no loss of a device its dispose destroyed (a canary)", () => {
    const src = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(src).toContain("    dispose() {\n        this._isDisposed = true;");
    expect(src).toContain(
      "                this._device.lost?.then((info) => {\n" +
        "                    if (this._isDisposed) {\n" +
        "                        return;\n" +
        "                    }",
    );
  });

  it("reports translators its own engine's lookup could not fetch as unfetched, once, even when told before it watched", async () => {
    const engine = new NullEngine();
    const other = new NullEngine();
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => seen.push(reason));
    try {
      reportUnfetched(other);
      reportUnfetched(engine);
      reportUnfetched(engine);
      expect(seen).toEqual(["unfetched"]);
    } finally {
      stop();
    }
    // Told before its watcher was put on: heard once the caller holds the
    // watcher's stop, and not by one taken off first.
    const late = new NullEngine();
    reportUnfetched(late);
    const heard: string[] = [];
    const stopLate = watchWebGpu(late, (reason) => heard.push(reason));
    expect(heard).toEqual([]);
    await Promise.resolve();
    expect(heard).toEqual(["unfetched"]);
    stopLate();
    const offFirst: string[] = [];
    watchWebGpu(late, (reason) => offFirst.push(reason))();
    await Promise.resolve();
    expect(offFirst).toEqual([]);
    for (const e of [engine, other, late]) e.dispose();
  });

  it("leaves Babylon's log hook as it found it", () => {
    const original = Logger.OnNewCacheEntry;
    const engine = new NullEngine();
    try {
      const stop = watchWebGpu(engine, () => undefined);
      expect(Logger.OnNewCacheEntry).toBe(original);
      stop();
      expect(Logger.OnNewCacheEntry).toBe(original);
    } finally {
      engine.dispose();
    }
  });
});

describe("a GLSL translation that fails inside Babylon's unawaited pipeline preparation", () => {
  /** What Babylon 9.18's WebGPU engine does with a shader glslang refuses: its
   * async preparation rejects, and the caller neither awaits nor catches it. */
  function translationFails(engine: NullEngine): void {
    (engine as unknown as { _preparePipelineContextAsync: () => Promise<void> })._preparePipelineContextAsync = () =>
      Promise.reject(new Error("GLSL compilation failed"));
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("is recorded on its effect and reported, as a compile error is on WebGL2", async () => {
    const engine = new NullEngine();
    translationFails(engine);
    catchTranslationFailures(engine);
    const reported: string[] = [];
    engine.onEffectErrorObservable.add(({ errors }) => void reported.push(errors));
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => seen.push(reason));
    try {
      const effect = engine.createEffect(
        { vertexSource: "void main() {}", fragmentSource: "void main() {}" },
        ["position"],
        [],
        [],
        "",
      );
      await settle();
      expect(effect.getCompilationError()).toContain("GLSL compilation failed");
      expect(effect.allFallbacksProcessed()).toBe(true);
      expect(effect.isReady()).toBe(false);
      expect(reported).toHaveLength(1);
      expect(seen).toEqual(["pipeline"]);
    } finally {
      stop();
      engine.dispose();
    }
  });

  it("reports one it cannot trace to an effect to its own engine's watcher only", async () => {
    const engine = new NullEngine();
    const other = new NullEngine();
    translationFails(engine);
    catchTranslationFailures(engine);
    const seen: string[] = [];
    const elsewhere: string[] = [];
    const stop = watchWebGpu(engine, (reason) => void seen.push(reason));
    const stopOther = watchWebGpu(other, (reason) => void elsewhere.push(reason));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const prepare = (engine as unknown as { _preparePipelineContextAsync: (context: object) => Promise<void> })
        ._preparePipelineContextAsync;
      void prepare({}).catch(() => undefined);
      await settle();
      expect(seen).toEqual(["pipeline"]);
      expect(elsewhere).toEqual([]);
    } finally {
      errors.mockRestore();
      stop();
      stopOther();
      engine.dispose();
      other.dispose();
    }
  });

  it("lets a fallback that compiles end it: one final state, and nothing reported", async () => {
    const engine = new NullEngine();
    // The first preparation fails to translate; the fallback's, with a define
    // fewer, succeeds on the engine's own path.
    const own = engine as unknown as { _preparePipelineContextAsync: (...args: unknown[]) => unknown };
    const real = own._preparePipelineContextAsync.bind(engine);
    let calls = 0;
    own._preparePipelineContextAsync = (...args: unknown[]) =>
      ++calls === 1 ? Promise.reject(new Error("GLSL compilation failed")) : real(...args);
    catchTranslationFailures(engine);
    const reported: string[] = [];
    engine.onEffectErrorObservable.add(({ errors }) => void reported.push(errors));
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => void seen.push(reason));
    try {
      const fallbacks = new EffectFallbacks();
      fallbacks.addFallback(0, "HEAVY");
      const effect = engine.createEffect(
        { vertexSource: "void main() {}", fragmentSource: "void main() {}" },
        ["position"],
        [],
        [],
        "#define HEAVY\n",
        fallbacks,
      );
      await settle();
      expect(calls).toBe(2);
      expect(effect.defines).not.toContain("HEAVY");
      expect(effect.isReady()).toBe(true);
      expect(effect.getCompilationError()).toBe("");
      expect(reported).toEqual([]);
      expect(seen).toEqual([]);
    } finally {
      stop();
      engine.dispose();
    }
  });

  it("leaves a preparation that succeeds as it was", async () => {
    const engine = new NullEngine();
    catchTranslationFailures(engine);
    const reported: string[] = [];
    engine.onEffectErrorObservable.add(({ errors }) => void reported.push(errors));
    try {
      const effect = engine.createEffect(
        { vertexSource: "void main() {}", fragmentSource: "void main() {}" },
        ["position"],
        [],
        [],
        "",
      );
      await settle();
      expect(effect.getCompilationError()).toBe("");
      expect(reported).toEqual([]);
    } finally {
      engine.dispose();
    }
  });

  it("wraps the shader lookup's preparation, installed first on every engine the maker makes (the source of the one maker)", () => {
    // The wrap binds whatever preparation it finds, so the lookup goes on
    // first and a translation it runs is caught like Babylon's own.
    const src = readFileSync(new URL("../../src/game/gpuEngine.ts", import.meta.url), "utf8");
    const start = src.slice(src.indexOf("  const start = async (): Promise<WebGPUEngine> => {"), src.indexOf("    await engine.initAsync("));
    expect(start.indexOf("      lookUpShaders(engine, {")).toBeGreaterThan(0);
    expect(start.indexOf("    catchTranslationFailures(engine);")).toBeGreaterThan(start.indexOf("      lookUpShaders(engine, {"));
    // Translators it cannot fetch are told to the engine's watcher, not thrown.
    expect(start).toContain("        unfetched: () => reportUnfetched(engine),");
    // A stage not found and the idle prefetch start them through one
    // function: the game's loader, with the fetch's budget, 10 s.
    expect(start).toContain("        translators: async () => handTranslators(engine, await loadTranslators()),");
    expect(src).toContain("    const attempt = startWithinBudget(WEBGPU_FETCH_MS);");
    expect(WEBGPU_FETCH_MS).toBe(10_000);
  });

  it("is still needed: Babylon still drops the rejection (a canary on the installed engine)", () => {
    const resolve = createRequire(import.meta.url).resolve;
    const functions = readFileSync(resolve("@babylonjs/core/Materials/effect.functions.js"), "utf8");
    // Called as a statement: neither awaited nor caught.
    expect(functions).toContain(
      '        _preparePipelineContext(pipelineContext, options.vertex, options.fragment, !!options.createAsRaw, "", "", options.rebuildRebind, options.defines, options.transformFeedbackVaryings, "", () => {',
    );
    const webgpu = readFileSync(resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(webgpu).toContain("    async _preparePipelineContextAsync(pipelineContext, vertexSourceCode, fragmentSourceCode,");
    expect(webgpu).toContain("        this._compiledEffects[name] = effect;");
    const effect = readFileSync(resolve("@babylonjs/core/Materials/effect.pure.js"), "utf8");
    // Looked up on the engine at every preparation, so an instance's own wins.
    expect(effect).toContain("this._engine._preparePipelineContextAsync.bind(this._engine)");
    expect(effect).toContain("    _processCompilationErrors(e, previousPipelineContext = null) {");
    // How the failing effect is found, by its pipeline context.
    expect(effect).toContain("    getPipelineContext() {\n        return this._pipelineContext;");
    // And why it would otherwise wait for good: nothing polls a WebGPU
    // pipeline context, whose readiness only the preparation sets.
    const context = readFileSync(resolve("@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js"), "utf8");
    expect(context).toContain("    get isAsync() {\n        return false;");
  });
});

describe("the frames that made a render pipeline, for the governor", () => {
  afterEach(() => {
    WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 0;
  });

  it("are told after each frame that made one, and no other", () => {
    const engine = new NullEngine();
    let told = 0;
    const stop = watchPipelines(engine, () => void told++);
    try {
      WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 2;
      engine.onEndFrameObservable.notifyObservers(engine);
      WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 0;
      engine.onEndFrameObservable.notifyObservers(engine);
      expect(told).toBe(1);
      stop();
      WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 1;
      engine.onEndFrameObservable.notifyObservers(engine);
      expect(told).toBe(1);
    } finally {
      engine.dispose();
    }
  });

  it("are counted before the frame's end is told, and a shader compile is told too (canaries on the installed engine)", () => {
    const src = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    // A pipeline is made at its first draw, counted for the frame…
    const end = src.slice(src.indexOf("    endFrame() {"), src.indexOf("    flushFramebuffer(_fromEndFrame = false) {"));
    expect(end.indexOf("this._cacheRenderPipeline.endFrame();")).toBeGreaterThan(0);
    expect(end.indexOf("super.endFrame();")).toBeGreaterThan(end.indexOf("this._cacheRenderPipeline.endFrame();"));
    const cache = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js"), "utf8");
    expect(cache).toContain("WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = WebGPUCacheRenderPipeline._NumPipelineCreationCurrentFrame;");
    // …while the observable the governor already reads fires on every effect's
    // translation, as on WebGL2 at a compile.
    const compile = src.slice(src.indexOf("    _compilePipelineStageDescriptor(vertexCode, fragmentCode, defines, shaderLanguage) {"), src.indexOf("    createRawShaderProgram() {"));
    expect(compile).toContain("this.onAfterShaderCompilationObservable.notifyObservers(this);");
  });
});

describe("the mips of every layer of an array texture on WebGPU", () => {
  /** An engine as the mip pass reads it: its own `_generateMipmaps` (the
   * installed engine's), and a helper that records each layer it is asked for. */
  function engine() {
    const layers: [number, number][] = [];
    const fake = {
      _renderEncoder: { id: "render" },
      _endCurrentRenderPass: () => undefined,
      _textureHelper: {
        generateMipmaps: (_hw: unknown, levels: number, layer: number) => void layers.push([layer, levels]),
        generateCubeMipmaps: () => void layers.push([-1, 0]),
      },
      _generateMipmaps(texture: unknown, commandEncoder?: unknown) {
        (ThinWebGPUEngine.prototype as unknown as { _generateMipmaps(t: unknown, e?: unknown): void })._generateMipmaps.call(this, texture, commandEncoder);
      },
    };
    return { fake, layers };
  }
  // The ground's relief arrays: 512², six layers, ten levels, `Raw2DArray`.
  const array = { _source: 11, depth: 6, width: 512, height: 512, mipLevelCount: 10, isCube: false, _hardwareTexture: {} };

  it("are made for layer 0 alone by Babylon 9.18 (a canary: an upstream fix is noticed here)", () => {
    const { fake, layers } = engine();
    fake._generateMipmaps(array);
    expect(layers).toEqual([[0, 10]]);
  });

  it("are made for every layer once the engine is given the pass per layer, and nothing else changes", () => {
    const { fake, layers } = engine();
    mipEveryLayer(fake as never);
    fake._generateMipmaps(array);
    expect(layers).toEqual([[0, 10], [1, 10], [2, 10], [3, 10], [4, 10], [5, 10]]);
    layers.length = 0;
    fake._generateMipmaps({ ...array, _source: 3, depth: 1 });
    fake._generateMipmaps({ ...array, depth: 1 });
    fake._generateMipmaps({ ...array, isCube: true, _source: 0 });
    expect(layers).toEqual([[0, 10], [0, 10], [-1, 0]]);
  });

  it("gives every engine the maker makes the pass per layer", () => {
    const src = readFileSync(new URL("../../src/game/gpuEngine.ts", import.meta.url), "utf8");
    const start = src.slice(src.indexOf("  const start = async (): Promise<WebGPUEngine> => {"), src.indexOf("    await engine.initAsync("));
    expect(start).toContain("    mipEveryLayer(engine);");
  });
});

