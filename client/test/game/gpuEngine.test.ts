import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { EffectFallbacks } from "@babylonjs/core/Materials/effectFallbacks.js";
import { WebGPUCacheRenderPipeline } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js";
import { catchTranslationFailures, watchPipelines, watchWebGpu } from "../../src/game/gpuEngine.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("watchWebGpu", () => {
  const effectError = { effect: null as unknown as Effect, errors: "FRAGMENT SHADER ERROR" };

  it("reports an uncaptured error Babylon logs as pipeline, by the log alone", () => {
    const engine = new NullEngine();
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => seen.push(reason));
    try {
      Logger.Warn("[Frame 3] WebGPU uncaptured error (1): [object GPUValidationError] - binding missing");
      expect(seen).toEqual(["pipeline"]);
      // The same reason again, by another road, is not reported twice.
      engine.onEffectErrorObservable.notifyObservers(effectError);
      expect(seen).toEqual(["pipeline"]);
    } finally {
      stop();
      engine.dispose();
    }
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

  it("matches the words Babylon logs an uncaptured error with (a canary on the installed engine)", () => {
    const source = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(source).toContain("Logger.Warn(`[Frame ${this._frameId}] WebGPU uncaptured error (");
    expect(source).toContain("this.onContextLostObservable.notifyObservers(this);");
  });

  it("passes every log entry on to the handler it found, and puts that handler back", () => {
    const original = Logger.OnNewCacheEntry;
    const previous = vi.fn();
    Logger.OnNewCacheEntry = previous;
    const engine = new NullEngine();
    try {
      const seen: string[] = [];
      const stop = watchWebGpu(engine, (reason) => seen.push(reason));
      Logger.OnNewCacheEntry("<div>[10:00:00]: a note</div><br>");
      expect(previous).toHaveBeenCalledWith("<div>[10:00:00]: a note</div><br>");
      expect(seen).toEqual([]);
      stop();
      expect(Logger.OnNewCacheEntry).toBe(previous);
      engine.onEffectErrorObservable.notifyObservers(effectError);
      expect(seen).toEqual([]);
    } finally {
      Logger.OnNewCacheEntry = original;
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

  it("reports one it cannot trace to an effect through Babylon's log, which the watcher reads", async () => {
    const engine = new NullEngine();
    translationFails(engine);
    catchTranslationFailures(engine);
    const seen: string[] = [];
    const stop = watchWebGpu(engine, (reason) => void seen.push(reason));
    try {
      const prepare = (engine as unknown as { _preparePipelineContextAsync: (context: object) => Promise<void> })
        ._preparePipelineContextAsync;
      void prepare({}).catch(() => undefined);
      await settle();
      expect(seen).toEqual(["pipeline"]);
    } finally {
      stop();
      engine.dispose();
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

