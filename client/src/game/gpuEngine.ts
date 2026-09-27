/**
 * The WebGPU engine: the adapter probe, the engine itself, and the watcher
 * that turns a failure on it into WebGL2. Only `main.ts`'s dynamic `import()`
 * loads this module, on the path where WebGPU could be the answer
 * (`engineChoice.ts`), so the WebGL2 bundle carries none of it, nor the
 * translators.
 *
 * Every material and plugin in this project is GLSL. A Babylon material on a
 * WebGPU engine generates WGSL unless told otherwise, and a GLSL
 * `MaterialPluginBase` refuses a WGSL material, so once the engine is made the
 * PBR and standard materials are switched to GLSL by Babylon's own
 * `ForceGLSL`, before the game makes any material. The engine translates that
 * GLSL at run time with the glslang and twgsl builds `@babylonjs/core` ships,
 * which the build content-hashes and serves with the game, never from a CDN.
 */
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
// Side-effect import, load-bearing: the WebGPU engine's own extensions (its
// dynamic texture, compute shader, multi-render, render target and the rest),
// which the WebGL2 imports the rest of the game makes never reach. Without
// them a fingerpost's painted texture throws on WebGPU. All of them at once,
// so the next one a model needs is not found by a player; here, in the module
// only the WebGPU path loads, so they cost the WebGL2 bundle nothing.
import "@babylonjs/core/Engines/WebGPU/Extensions/index.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { Tools } from "@babylonjs/core/Misc/tools.js";
import glslangJs from "@babylonjs/core/assets/glslang/glslang.js?url";
import glslangWasm from "@babylonjs/core/assets/glslang/glslang.wasm?url";
import twgslJs from "@babylonjs/core/assets/twgsl/twgsl.js?url";
import twgslWasm from "@babylonjs/core/assets/twgsl/twgsl.wasm?url";
import {
  createStartupWindow,
  WEBGPU_FETCH_MS,
  WEBGPU_REQUIRED_LIMITS,
  WEBGPU_START_MS,
  type AdapterReport,
} from "./engineChoice.js";

/** How Babylon words an uncaptured WebGPU error, which it logs as a warning
 * (`webgpuEngine.pure.js`, the device's `uncapturederror` listener). */
const UNCAPTURED = "WebGPU uncaptured error";

/** How `catchTranslationFailures` words a failure it cannot trace to an effect. */
const UNTRANSLATED = "WebGPU shader translation failed";

type Preparing = {
  _preparePipelineContextAsync: (pipelineContext: unknown, ...rest: unknown[]) => Promise<void>;
  _compiledEffects: Record<string, Effect>;
};

/**
 * Gives a GLSL translation failure on WebGPU the ending a compile error has on
 * WebGL2. In Babylon 9.18 the WebGPU engine's `_preparePipelineContextAsync` is
 * async, glslang throws inside it ("GLSL compilation failed"), and its caller
 * (`createAndPreparePipelineContext`, `effect.functions.js`) neither awaits nor
 * catches it: the effect is left not-ready for good, with no compilation error,
 * no fallback tried and nothing on `onEffectErrorObservable`, and the page
 * gets one unhandled rejection. This replaces the method on the engine
 * instance (`Effect` looks it up there at every preparation) with one that
 * catches that rejection and hands it to the effect it belongs to, found
 * among the engine's compiled effects by its pipeline context, through the
 * effect's own `_processCompilationErrors`: the error recorded, the next
 * fallback tried, and `onEffectErrorObservable` told once none is left, just
 * as on WebGL2. So `watchWebGpu` sees it as a pipeline failure, and the
 * impostor bake as its failed ending. A failure that belongs to no compiled
 * effect is logged (`UNTRANSLATED`), which the watcher also reads. A wrapper
 * rather than a page-wide `unhandledrejection` listener: that would learn of
 * the failure but not which effect it belongs to, so nothing would be recorded
 * on the effect. Its canaries are in `gpuEngine.test.ts`.
 */
export function catchTranslationFailures(engine: AbstractEngine): void {
  const own = engine as unknown as Preparing;
  const prepare = own._preparePipelineContextAsync.bind(engine);
  own._preparePipelineContextAsync = (pipelineContext, ...rest) => {
    const pending = prepare(pipelineContext, ...rest);
    // WebGPU's preparation returns a promise; an engine whose preparation is
    // synchronous returns none, and has nothing to catch.
    void Promise.resolve(pending).catch((error: unknown) => {
      const effect = Object.values(own._compiledEffects).find((e) => e.getPipelineContext() === pipelineContext);
      if (effect) {
        (effect as unknown as { _processCompilationErrors(e: unknown): void })._processCompilationErrors(error);
      } else {
        Logger.Error(`${UNTRANSLATED}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return pending;
  };
}

/**
 * The high-performance adapter's limits and features, and whether it is a
 * fallback (software) adapter, or null where the browser has no WebGPU, offers
 * no adapter, or the request fails. Never rejects; a request that never
 * answers is bounded by the caller (`resolveWebGpu`).
 */
export async function probeAdapter(): Promise<AdapterReport | null> {
  const gpu = (globalThis.navigator as { gpu?: GPU } | undefined)?.gpu;
  if (!gpu) return null;
  try {
    if (!(await WebGPUEngine.IsSupportedAsync)) return null;
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    // Every limit, read with `for…in`: a browser's limits are getters on the
    // prototype, so `Object.keys` finds none of them.
    const limits: Record<string, number> = {};
    const source = adapter.limits as unknown as Record<string, unknown>;
    for (const name in source) {
      const value = source[name];
      if (typeof value === "number") limits[name] = value;
    }
    const legacy = (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter;
    const features = adapter.features ? [...adapter.features] : [];
    return { limits, isFallbackAdapter: adapter.info?.isFallbackAdapter ?? legacy ?? false, features };
  } catch {
    return null;
  }
}

/** The two translators, started: glslang as Babylon's GLSL path uses it, and
 * twgsl as its WGSL translation uses it. Handed to `createWebGpuEngine`. */
export type Translators = { glslang: unknown; twgsl: unknown };

/** Fetches `url` whole, so a loader's own fetch of it comes from the HTTP
 * cache (the build serves these immutable), and checks it is WebAssembly. */
async function prefetchWasm(url: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`${url}: not WebAssembly`);
  }
}

/** Starts the translator the loader just run defined as the page global
 * `name`, on `wasm`; throws at once where the loader defined nothing (this
 * host answers a missing script with its HTML page, which runs as nothing). */
function startTranslator(name: "glslang" | "twgsl", wasm: string): Promise<unknown> {
  const factory = (globalThis as unknown as Record<string, unknown>)[name];
  if (typeof factory !== "function") throw new Error(`the WebGPU translators did not load: ${name}`);
  return Promise.resolve((factory as (wasmPath: string) => unknown)(wasm));
}

/**
 * The two translators, fetched and started before any GPU work, so the
 * network's time is measured apart from the GPU's (`resolveWebGpu`).
 *
 * Their loaders collide. Each is a classic script that declares a top-level
 * `var Module`, its emscripten factory, and defines a global (`glslang`,
 * `twgsl`) whose initialisation calls whatever `Module` is when it is called.
 * Run both, and the later script's `Module` is the one either finds: started
 * after both had run, as Babylon would start them, glslang was handed twgsl's
 * factory and never came up. So they go one at a time, each started right
 * after its own script ran, while its own `Module` is the one there, and the
 * two started translators are handed to Babylon (`createWebGpuEngine`), which
 * then neither runs a loader again nor calls a factory. The WebAssembly is
 * fetched first, whole and checked, so the loaders' own fetches come from the
 * cache. Rejects at once on a script that does not load (Babylon's script
 * loader rejects), on a loader that defined nothing, and on a translator that
 * is not WebAssembly; and after `WEBGPU_FETCH_MS` on a start still under way,
 * which is then abandoned (`startWithinBudget`).
 */
export function loadTranslators(): Promise<Translators> {
  // Once per page: every later engine (a renderer swap back onto WebGPU makes
  // a new one) takes the same translators instead of fetching and compiling
  // about 2.6 MB of WebAssembly again. Babylon keeps the first twgsl anyway
  // (`WebGPUTintWASM._Twgsl` is static). A start that fails, or has not come
  // in within the fetch budget, is dropped, so the next attempt starts again;
  // one still under way is shared.
  if (translatorsStarted === null) {
    const attempt = startWithinBudget(WEBGPU_FETCH_MS);
    translatorsStarted = attempt;
    attempt.catch(() => {
      if (translatorsStarted === attempt) translatorsStarted = null;
    });
  }
  return translatorsStarted;
}

/** The page's one start of the translators, or null before it (or after one
 * failed). */
let translatorsStarted: Promise<Translators> | null = null;

/** Drops the page's started translators, so the next `loadTranslators` starts
 * them again. For tests: a page keeps its translators for its life. */
export function forgetTranslators(): void {
  translatorsStarted = null;
}

/**
 * `startTranslators`, given up after `ms`: this rejects then, and the start is
 * abandoned, its WebAssembly fetches aborted and nothing after them run. So a
 * start that stalled and comes in late settles nothing and runs no loader
 * beside a newer start. The timer goes as soon as either settles.
 */
async function startWithinBudget(ms: number): Promise<Translators> {
  const abandon = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abandon.abort();
      reject(new Error(`the WebGPU translators did not load in ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([startTranslators(abandon.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches and starts the translators, one loader at a time; stops before its
 * next step once `signal` is aborted. */
async function startTranslators(signal: AbortSignal): Promise<Translators> {
  await Promise.all([prefetchWasm(glslangWasm, signal), prefetchWasm(twgslWasm, signal)]);
  signal.throwIfAborted();
  await Tools.LoadScriptAsync(glslangJs);
  signal.throwIfAborted();
  const glslang = startTranslator("glslang", glslangWasm);
  await Tools.LoadScriptAsync(twgslJs);
  signal.throwIfAborted();
  const twgsl = startTranslator("twgsl", twgslWasm);
  const [glslangReady, twgslReady] = await Promise.all([glslang, twgsl]);
  return { glslang: glslangReady, twgsl: twgslReady };
}

/**
 * A WebGPU engine on `canvas`, made with the WebGL2 engine's own options
 * (antialiased, a stencil buffer, adapted to the device ratio), the
 * high-performance adapter, exactly `WEBGPU_REQUIRED_LIMITS`, and the optional
 * `features` it is given (`featuresToRequest`; Babylon also drops any the
 * adapter lacks), with the `translators` `loadTranslators` started handed to
 * Babylon as they are. Rejects on any failure, or when `ms` pass first, having
 * disposed what it made; the canvas may then hold a WebGPU context, so the
 * caller draws WebGL2 on a fresh one.
 */
export async function createWebGpuEngine(
  canvas: HTMLCanvasElement,
  options: { ms?: number; features?: readonly string[]; translators?: Translators } = {},
): Promise<WebGPUEngine> {
  const translators = options.translators;
  if (translators === undefined) throw new Error("load the WebGPU translators first");
  const ms = options.ms ?? WEBGPU_START_MS;
  const made: { engine: WebGPUEngine | null } = { engine: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the WebGPU engine was not ready in ${ms} ms`)), ms);
  });
  const start = async (): Promise<WebGPUEngine> => {
    const engine = new WebGPUEngine(canvas, {
      antialias: true,
      stencil: true,
      adaptToDeviceRatio: true,
      powerPreference: "high-performance",
      deviceDescriptor: {
        requiredLimits: { ...WEBGPU_REQUIRED_LIMITS },
        requiredFeatures: [...(options.features ?? [])] as GPUFeatureName[],
      },
    });
    made.engine = engine;
    catchTranslationFailures(engine);
    // The started translators, as Babylon's options take them: glslang as a
    // promise (its setup waits on it), twgsl as the instance. No path to load.
    await engine.initAsync({ glslang: Promise.resolve(translators.glslang) }, { twgsl: translators.twgsl });
    await engine.prepareGlslangAndTintAsync();
    return engine;
  };
  try {
    const engine = await Promise.race([start(), deadline]);
    // Only once the engine stands: a failed start leaves Babylon's defaults,
    // and neither switch changes anything on WebGL2, where every material is
    // GLSL.
    PBRBaseMaterial.ForceGLSL = true;
    StandardMaterial.ForceGLSL = true;
    return engine;
  } catch (err) {
    try {
      made.engine?.dispose();
    } catch {
      /* a half-made engine may not dispose cleanly; it is dropped either way */
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Watches a running WebGPU engine for the failures that end on WebGL2: an
 * effect that fails to translate or compile (with `catchTranslationFailures`
 * installed, a translation failure is one), or an uncaptured WebGPU error
 * (`"pipeline"`), and a lost device Babylon did not cause (`"lost"`). Each is
 * reported once, with whether it came inside the startup window
 * (`createStartupWindow`), whose clock starts now. Returns a function that
 * removes every observer and hands Babylon's log hook back.
 */
export function watchWebGpu(
  engine: AbstractEngine,
  onFailure: (reason: "pipeline" | "lost", inStartup: boolean) => void,
  now: () => number = () => performance.now(),
): () => void {
  const startup = createStartupWindow(now());
  const reported = new Set<"pipeline" | "lost">();
  const report = (reason: "pipeline" | "lost"): void => {
    if (reported.has(reason)) return;
    reported.add(reason);
    onFailure(reason, startup.open(now()));
  };

  const frame = engine.onEndFrameObservable.addOnce(() => startup.frame(now()));
  const compiled = engine.onAfterShaderCompilationObservable.add(() => startup.compiled(now()));
  const effectError = engine.onEffectErrorObservable.add(() => report("pipeline"));
  const lost = engine.onContextLostObservable.add(() => {
    // The page reloads after a lost device (and, once it lands, swaps
    // renderers), so Babylon's own restore, which it starts right after this
    // notification on the same engine, has nothing to do: it rebuilds what the
    // reload is about to throw away, and throws on the way.
    (engine as unknown as { _restoreEngineAfterContextLost: (init: unknown) => void })._restoreEngineAfterContextLost =
      () => undefined;
    report("lost");
  });

  // Chained, not replaced: whatever held the hook still hears every entry.
  const previous = Logger.OnNewCacheEntry as ((entry: string) => void) | undefined;
  const onEntry = (entry: string): void => {
    previous?.(entry);
    if (entry.includes(UNCAPTURED) || entry.includes(UNTRANSLATED)) report("pipeline");
  };
  Logger.OnNewCacheEntry = onEntry;

  return () => {
    engine.onEndFrameObservable.remove(frame);
    engine.onAfterShaderCompilationObservable.remove(compiled);
    engine.onEffectErrorObservable.remove(effectError);
    engine.onContextLostObservable.remove(lost);
    if (Logger.OnNewCacheEntry === onEntry) Logger.OnNewCacheEntry = previous as (entry: string) => void;
  };
}
