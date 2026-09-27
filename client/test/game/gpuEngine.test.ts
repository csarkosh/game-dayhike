import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { catchTranslationFailures, probeAdapter, watchWebGpu } from "../../src/game/gpuEngine.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A limits object shaped as a browser's is: every limit an enumerable
 * getter on the prototype, none an own property. */
function browserLimits(values: Record<string, number>): object {
  const proto = {};
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(proto, name, { get: () => value, enumerable: true });
  }
  return Object.create(proto) as object;
}

describe("probeAdapter", () => {
  it("finds nothing where the browser has no WebGPU", async () => {
    vi.stubGlobal("navigator", {});
    expect(await probeAdapter()).toBeNull();
  });

  it("finds nothing where no adapter is offered, or the request fails", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: () => Promise.resolve(null) } });
    expect(await probeAdapter()).toBeNull();
    vi.stubGlobal("navigator", { gpu: { requestAdapter: () => Promise.reject(new Error("lost")) } });
    expect(await probeAdapter()).toBeNull();
  });

  it("reads every limit off the prototype, and asks for the high-performance adapter", async () => {
    const asked: unknown[] = [];
    const adapter = {
      limits: browserLimits({ maxInterStageShaderVariables: 28, maxVertexBuffers: 8 }),
      info: { isFallbackAdapter: false },
      features: new Set(["texture-compression-bc", "timestamp-query"]),
    };
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: (options?: unknown) => {
          asked.push(options);
          return Promise.resolve(adapter);
        },
      },
    });
    expect(Object.keys(adapter.limits)).toEqual([]);
    expect(await probeAdapter()).toEqual({
      limits: { maxInterStageShaderVariables: 28, maxVertexBuffers: 8 },
      isFallbackAdapter: false,
      features: ["texture-compression-bc", "timestamp-query"],
    });
    expect(asked.at(-1)).toEqual({ powerPreference: "high-performance" });
  });

  it("reports a fallback adapter as one", async () => {
    const adapter = { limits: browserLimits({ maxVertexBuffers: 8 }), info: { isFallbackAdapter: true } };
    vi.stubGlobal("navigator", { gpu: { requestAdapter: () => Promise.resolve(adapter) } });
    expect(await probeAdapter()).toEqual({ limits: { maxVertexBuffers: 8 }, isFallbackAdapter: true, features: [] });
  });
});

describe("watchWebGpu", () => {
  const effectError = { effect: null as unknown as Effect, errors: "FRAGMENT SHADER ERROR" };

  it("reports an uncaptured error Babylon logs as pipeline, by the log alone", () => {
    const engine = new NullEngine();
    const seen: [string, boolean][] = [];
    const stop = watchWebGpu(engine, (reason, inStartup) => seen.push([reason, inStartup]), () => 0);
    try {
      Logger.Warn("[Frame 3] WebGPU uncaptured error (1): [object GPUValidationError] - binding missing");
      expect(seen).toEqual([["pipeline", true]]);
      // The same reason again, by another road, is not reported twice.
      engine.onEffectErrorObservable.notifyObservers(effectError);
      expect(seen).toEqual([["pipeline", true]]);
    } finally {
      stop();
      engine.dispose();
    }
  });

  it("reports a failed effect as pipeline and a lost device as lost, each once", () => {
    const engine = new NullEngine();
    const seen: [string, boolean][] = [];
    const stop = watchWebGpu(engine, (reason, inStartup) => seen.push([reason, inStartup]), () => 0);
    try {
      engine.onEffectErrorObservable.notifyObservers(effectError);
      expect(seen).toEqual([["pipeline", true]]);
      engine.onContextLostObservable.notifyObservers(engine);
      engine.onContextLostObservable.notifyObservers(engine);
      expect(seen).toEqual([["pipeline", true], ["lost", true]]);
    } finally {
      stop();
      engine.dispose();
    }
  });

  it("tells a failure in the startup window from one after it", () => {
    const engine = new NullEngine();
    let now = 0;
    const seen: [string, boolean][] = [];
    const stop = watchWebGpu(engine, (reason, inStartup) => seen.push([reason, inStartup]), () => now);
    try {
      now = 2_000;
      engine.onEndFrameObservable.notifyObservers(engine);
      now = 8_000;
      engine.onAfterShaderCompilationObservable.notifyObservers(engine);
      now = 18_000;
      engine.onEffectErrorObservable.notifyObservers(effectError);
      expect(seen).toEqual([["pipeline", false]]);
      engine.onContextLostObservable.notifyObservers(engine);
      expect(seen).toEqual([["pipeline", false], ["lost", false]]);
    } finally {
      stop();
      engine.dispose();
    }
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
      const stop = watchWebGpu(engine, (reason) => seen.push(reason), () => 0);
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
    const seen: [string, boolean][] = [];
    const stop = watchWebGpu(engine, (reason, inStartup) => seen.push([reason, inStartup]), () => 0);
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
      expect(seen).toEqual([["pipeline", true]]);
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
    const stop = watchWebGpu(engine, (reason) => void seen.push(reason), () => 0);
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
  });
});
