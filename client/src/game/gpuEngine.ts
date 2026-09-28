/**
 * The WebGPU engine: the translators, the engine itself, and the watcher
 * that reports a failure on it for the game to answer with a live swap. Only `main.ts`'s dynamic `import()`
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
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.pure.js";
// What the non-pure `webgpuEngine.js` loads with the engine, but for its
// audio engine: registered, it would give every engine made afterwards,
// WebGL2's included, Babylon's own audio engine. The clear quad's WGSL
// shaders, the vertex-buffer realignment WebGPU asks for, and the engine
// extensions every Babylon engine takes (the WebGL2 path loads the same).
import "@babylonjs/core/ShadersWGSL/clearQuad.vertex.js";
import "@babylonjs/core/ShadersWGSL/clearQuad.fragment.js";
import "@babylonjs/core/Buffers/buffer.align.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.loadingScreen.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.dom.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.states.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.stencil.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.renderPass.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.texture.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.loadFile.js";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.textureLoaders.js";
import { WebGPUCacheRenderPipeline } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js";
import { keyEveryBoundBuffer } from "./webgpuVertexBuffer.js";
// Side-effect import, load-bearing: the WebGPU engine's own extensions (its
// dynamic texture, compute shader, multi-render, render target and the rest),
// which the WebGL2 imports the rest of the game makes never reach. Without
// them a fingerpost's painted texture throws on WebGPU. All of them at once,
// so the next one a model needs is not found by a player; here, in the module
// only the WebGPU path loads, so they cost the WebGL2 bundle nothing.
import "@babylonjs/core/Engines/WebGPU/Extensions/index.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { AbstractEngine as BaseEngine } from "@babylonjs/core/Engines/abstractEngine.pure.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { _CommonDispose } from "@babylonjs/core/Engines/engine.common.js";
// The pure modules, as every other file imports them: the non-pure PBR
// module registers `BaseTexture.sphericalPolynomial`, which lit only a page
// that loaded this module with the probe's spherical harmonics (the
// verification note, §6.6).
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial.pure.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.pure.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
// Pure: the non-pure module registers `EngineStore.FallbackTexture`, the
// image a texture that fails to load is drawn with, on every engine.
import { Tools } from "@babylonjs/core/Misc/tools.pure.js";
import glslangJs from "@babylonjs/core/assets/glslang/glslang.js?url";
import glslangWasm from "@babylonjs/core/assets/glslang/glslang.wasm?url";
import twgslJs from "@babylonjs/core/assets/twgsl/twgsl.js?url";
import twgslWasm from "@babylonjs/core/assets/twgsl/twgsl.wasm?url";
import {
  WEBGPU_FETCH_MS,
  WEBGPU_REQUIRED_LIMITS,
  WEBGPU_START_MS,
} from "./engineChoice.js";

/** How `catchTranslationFailures` words a failure it cannot trace to an effect. */
const UNTRANSLATED = "WebGPU shader translation failed";

/** Per engine, who hears of a translation failure that belongs to no
 * compiled effect: the engine's watcher, and no other engine's. */
const untranslatedHeard = new WeakMap<AbstractEngine, Set<() => void>>();

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
 * effect is logged (`UNTRANSLATED`) and told to this engine's watcher. A wrapper
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
        for (const hear of untranslatedHeard.get(engine) ?? []) hear();
      }
    });
    return pending;
  };
}

/** The two translators, started: glslang as Babylon's GLSL path uses it, and
 * twgsl as its WGSL translation uses it. Handed to `createWebGpuEngine`. */
export type Translators = { glslang: unknown; twgsl: unknown };

/** Fetches `url` whole, so a loader's own fetch of it comes from the HTTP
 * cache (the build serves these immutable), and checks it is WebAssembly.
 * Never aborted, not even for a start given up at the fetch budget: on a slow
 * link the download still finishes into that cache, so a later attempt in the
 * page, or the next load, starts from it instead of running out again. */
async function prefetchWasm(url: string): Promise<void> {
  const response = await fetch(url);
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
 * abandoned. Its WebAssembly downloads run on into the cache (`prefetchWasm`),
 * but nothing after them does, so a start that stalled and comes in late
 * settles nothing and runs no loader beside a newer start. The timer goes as
 * soon as either settles.
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
  await Promise.all([prefetchWasm(glslangWasm), prefetchWasm(twgslWasm)]);
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
  let late = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      late = true;
      reject(new Error(`the WebGPU engine was not ready in ${ms} ms`));
    }, ms);
  });
  // Every vertex buffer this engine draws keyed by its offset in the
  // pipeline cache (`webgpuVertexBuffer.ts`); once per page.
  keyEveryBoundBuffer(WebGPUCacheRenderPipeline.prototype as never);
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
    giveUpRestore(engine);
    mipEveryLayer(engine);
    catchTranslationFailures(engine);
    // The started translators, as Babylon's options take them: glslang as a
    // promise (its setup waits on it), twgsl as the instance. No path to load.
    await engine.initAsync({ glslang: Promise.resolve(translators.glslang) }, { twgsl: translators.twgsl });
    await engine.prepareGlslangAndTintAsync();
    return engine;
  };
  const starting = start();
  try {
    const engine = await Promise.race([starting, deadline]);
    // Only once the engine stands: a failed start leaves Babylon's defaults,
    // and neither switch changes anything on WebGL2, where every material is
    // GLSL.
    PBRBaseMaterial.ForceGLSL = true;
    StandardMaterial.ForceGLSL = true;
    return engine;
  } catch (err) {
    if (made.engine !== null) disposeHalfMade(made.engine);
    // Given up while the start was still under way: its device may come
    // later, to an engine already disposed. When the start settles, that
    // engine's disposal is finished and its device destroyed.
    if (late) {
      const finish = (): void => {
        if (made.engine !== null) disposeHalfMade(made.engine);
      };
      void starting.then(finish, finish);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Disposes a WebGPU engine whose start failed part-way. Babylon's
 * `WebGPUEngine.dispose` reads what `initAsync` makes after the device
 * (`_timestampQuery` first, then the texture and buffer managers), so on an
 * engine whose start failed before those it throws at the first of them,
 * before its last steps: destroying the device, where one came, dropping the
 * canvas's, the window's and the document's listeners (`_CommonDispose`),
 * and the base dispose, which takes the engine out of
 * `EngineStore.Instances`. Those run here where it threw, each on its own
 * guard, and the engine leaves the store whatever they do. Run again on an
 * engine whose start settled after it was given up, it destroys the device
 * that came since.
 */
export function disposeHalfMade(engine: WebGPUEngine): void {
  try {
    engine.dispose();
    return;
  } catch {
    /* a start that failed part-way: finish below */
  }
  try {
    _CommonDispose(engine, engine.getRenderingCanvas());
  } catch {
    /* listeners that were never added */
  }
  try {
    BaseEngine.prototype.dispose.call(engine);
  } catch {
    /* as far as it goes */
  }
  destroyDevice(engine);
  const at = EngineStore.Instances.indexOf(engine);
  if (at >= 0) EngineStore.Instances.splice(at, 1);
}

/** Destroys the engine's device, where one came; a second destroy is a no-op. */
function destroyDevice(engine: WebGPUEngine): void {
  try {
    (engine as unknown as { _device?: { destroy(): void } })._device?.destroy();
  } catch {
    /* already gone */
  }
}

/** `InternalTextureSource.Raw2DArray`, the source of a `RawTexture2DArray`. */
const RAW_2D_ARRAY = 11;

type MipEngine = {
  _generateMipmaps(texture: unknown, commandEncoder?: unknown): void;
  _renderEncoder: unknown;
  _textureHelper: { generateMipmaps(hardware: unknown, levels: number, layer: number, commandEncoder: unknown): void };
};

/**
 * Makes `engine` build the mips of every layer of an array texture. Babylon
 * 9.18's WebGPU mip pass for a `RawTexture2DArray` renders the chain of layer
 * 0 alone (`ThinWebGPUEngine._generateMipmaps`), so layers 1 and up read zero
 * at every level below full size: the ground's relief arrays
 * (`groundMaps.ts`) then blacked the trail's bed wherever it was drawn from a
 * coarser level. After Babylon's own pass (layer 0, and the render pass it
 * ends), the same pass runs for each other layer on the same encoder: each
 * level rendered from the one above through a linear sampler, a 2×2 average,
 * which is the box filter WebGL2's `generateMipmap` gives every layer. Other
 * textures are left to Babylon. A WebGL2 engine is never given it. Its canary
 * is in `gpuEngine.test.ts`.
 */
export function mipEveryLayer(engine: AbstractEngine): void {
  const own = engine as unknown as MipEngine;
  if (typeof own._generateMipmaps !== "function") return;
  const generate = own._generateMipmaps.bind(engine);
  own._generateMipmaps = (texture, commandEncoder) => {
    generate(texture, commandEncoder);
    const array = texture as { _source?: number; depth?: number; mipLevelCount?: number; _hardwareTexture?: unknown; isCube?: boolean };
    if (array._source !== RAW_2D_ARRAY || array.isCube === true || !array._hardwareTexture || !((array.depth ?? 1) > 1)) return;
    const encoder = commandEncoder ?? own._renderEncoder;
    for (let layer = 1; layer < (array.depth ?? 1); layer++) {
      own._textureHelper.generateMipmaps(array._hardwareTexture, array.mipLevelCount ?? 1, layer, encoder);
    }
  };
}

/**
 * Stops Babylon's own recovery of `engine` after a lost device, for good.
 * Babylon, right after it notifies the loss, calls the engine's
 * `_restoreEngineAfterContextLost`, looked up on the instance, which makes a
 * new device (`initAsync`) and rebuilds the engine's resources. This code
 * never relies on it: a hike's renderer is rebuilt on a new engine on a fresh
 * canvas, a probe step is measured again, and an engine let go of is about to
 * be disposed, where a restore would leave a second device alive. So every
 * engine made here, and every engine watched, has it replaced by nothing, and
 * it stays so after the watcher is off.
 */
export function giveUpRestore(engine: AbstractEngine): void {
  (engine as unknown as { _restoreEngineAfterContextLost: (init: unknown) => void })._restoreEngineAfterContextLost = () => undefined;
}

/**
 * Watches a running WebGPU engine for the failures the game answers with a
 * live swap of its renderer (`failureSwap`, `engineChoice.ts`): an effect that
 * fails to translate or compile (with `catchTranslationFailures` installed, a
 * translation failure is one), or an uncaptured WebGPU error (`"pipeline"`),
 * and a lost device Babylon did not cause (`"lost"`; Babylon says nothing of
 * the loss a disposed engine's destroyed device makes). Each is reported
 * once, and only from this engine: an uncaptured error is heard on its own
 * device's `uncapturederror` event, not in Babylon's log, which every engine
 * of the page writes to (a probe step's, or one released and still waiting
 * for its BRDF lookup texture). Returns a function that removes every
 * listener; the game calls it before the engine is disposed.
 */
export function watchWebGpu(engine: AbstractEngine, onFailure: (reason: "pipeline" | "lost") => void): () => void {
  const reported = new Set<"pipeline" | "lost">();
  const report = (reason: "pipeline" | "lost"): void => {
    if (reported.has(reason)) return;
    reported.add(reason);
    onFailure(reason);
  };

  const effectError = engine.onEffectErrorObservable.add(() => report("pipeline"));
  giveUpRestore(engine);
  const lost = engine.onContextLostObservable.add(() => report("lost"));

  // The device Babylon itself listens on for uncaptured errors; an engine
  // not yet started has none.
  const device = (engine as unknown as { _device?: EventTarget })._device;
  const onUncaptured = (): void => report("pipeline");
  device?.addEventListener("uncapturederror", onUncaptured);
  const heard = untranslatedHeard.get(engine) ?? new Set<() => void>();
  untranslatedHeard.set(engine, heard);
  heard.add(onUncaptured);

  return () => {
    engine.onEffectErrorObservable.remove(effectError);
    engine.onContextLostObservable.remove(lost);
    device?.removeEventListener("uncapturederror", onUncaptured);
    heard.delete(onUncaptured);
  };
}

/**
 * Calls `onCreated` after each frame of `engine` that made a render pipeline.
 * On WebGPU an effect's shaders are translated when it is prepared, which
 * `onAfterShaderCompilationObservable` reports as on WebGL2, but the pipeline
 * that draws with them is made at their first draw, a frame or more later,
 * and that is a hitch of its own: the governor voids its window as for a
 * compile. Babylon counts the pipelines each frame made
 * (`WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame`) before it tells
 * the frame's end. Returns a function that stops listening.
 */
export function watchPipelines(engine: AbstractEngine, onCreated: () => void): () => void {
  const observer = engine.onEndFrameObservable.add(() => {
    if (WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame > 0) onCreated();
  });
  return () => engine.onEndFrameObservable.remove(observer);
}

