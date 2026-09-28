/**
 * Render pipelines made asynchronously on WebGPU: a draw whose pipeline is not
 * made yet is left out of the frame until it lands, and the frames keep
 * coming. WebGL2 with parallel shader compilation already does the same for a
 * mesh whose program is not linked.
 *
 * Babylon 9.18's WebGPU engine makes each render pipeline with the
 * synchronous `device.createRenderPipeline`, at the draw that first needs it
 * (`WebGPUEngine._draw` → `_cacheRenderPipeline.getRenderPipeline` →
 * `_createRenderPipeline`). The browser compiles such a pipeline when it
 * reaches the call in the page's command stream, and every later command of
 * the page waits behind it: no frame is shown until the batch is compiled.
 * Measured on a Windows machine with an NVIDIA T4 and 4 virtual CPUs, 91
 * pipelines made so on a page drawing 60 frames a second showed no frame for
 * 21 s; made with `createRenderPipelineAsync`, 57–60 frames every second.
 *
 * The patch (`installPipelines`, from `createWebGpuEngine`) is on one engine's
 * own cache instance and that engine's own `_draw`, never a prototype: the
 * clear quad's cache, and every other engine, keep Babylon's path. Inside its
 * scope (`enter()` to `leave()`, which the renderer calls around each
 * rendering group's draws, `scopeRenderingGroups` in `renderer.ts`) a draw
 * goes:
 * - through Babylon's own lookup (`_lookupRenderPipeline`, the sample count
 *   normalised as Babylon's `getRenderPipeline` does); a pipeline found draws;
 * - on a miss, the lookup leaves its cache node in `_parameter.token`. A node
 *   already being made leaves the draw out. Otherwise Babylon's own
 *   `_buildRenderPipelineDescriptor` builds the descriptor from the draw's
 *   state, now, and the creation is queued; the draw is left out;
 * - at most `limit` creations are in flight, the rest wait first in, first
 *   out. One that lands is stored in its node as Babylon's `preWarmPipeline`
 *   stores one (`_setRenderPipeline`), so the next draw of the same state
 *   finds it by Babylon's own lookup;
 * - one that fails marks its node: the node's next draw takes Babylon's
 *   synchronous path, which raises the validation error where it is raised
 *   today, so the failure watcher (`watchWebGpu`) and the swap to WebGL2 go
 *   as before; a node so marked is never made asynchronously again;
 * - a creation still in flight `ASYNC_PIPELINE_MAX_MS` after it started is
 *   given up the same way, its slot freed; one that lands after that stores
 *   nothing. The first rejection, and the first deadline passed, are said;
 * - once the engine is disposed or its device lost, or the patch removed,
 *   nothing is started and nothing is stored, and every draw is Babylon's.
 * And should the sentinel ever leave a frame (`guardRender`), the patch comes
 * off that engine for good rather than stop the game.
 * Outside the scope, and while the engine renders by snapshot, every draw is
 * Babylon's, untouched.
 *
 * An asynchronous creation is not a hitch and does not raise Babylon's count
 * of the pipelines a frame made (`NumPipelineCreationLastFrame`), but a frame
 * with draws left out is cheaper than a whole one: `watchPipelines` voids the
 * governor's window for either (`leftOutOn`). The start's reveal waits for a
 * frame that left nothing out (`revealWhenWhole`), and the impostor bake keeps
 * only a render that left nothing out (`forestMeshes.ts`).
 *
 * Only the WebGPU module (`gpuEngine.ts`) imports this one at run time; the
 * rest of the game names its types alone, so a WebGL2 page loads none of it.
 * Its canaries on Babylon are in `asyncPipelines.test.ts`.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { WebGPUCacheRenderPipeline } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js";
import { WebGPUTextureHelper } from "@babylonjs/core/Engines/WebGPU/webgpuTextureHelper.js";
import type { PipelineMode } from "./engineChoice.js";

/** What the rest of the game uses of the patch on one engine. */
export type AsyncPipelines = {
  /** Draws between enter() and leave() may be left out while their pipeline is made. */
  enter(): void;
  leave(): void;
  /** Pipelines asked for and not yet landed (in flight or queued). */
  pending(): number;
  /** Draws left out since the last call to takeSkipped(), which resets the count. */
  takeSkipped(): number;
  /** Resolves when pending() is 0, or after `ms`; true when it emptied. */
  settled(ms: number): Promise<boolean>;
  /** Takes the patch off (the engine's own methods back). */
  remove(): void;
};

/** Creations in flight at once for a processor with `cores` cores: two fewer
 * than the cores, at least two; two where the browser does not say. */
export function maxInFlightFor(cores: number | undefined): number {
  return typeof cores === "number" && cores > 2 ? Math.max(2, Math.floor(cores) - 2) : 2;
}

/** The page's creations in flight at once (`?pipelines=async`, the default),
 * computed once, as the page loads this module: `max(2, cores − 2)`. A first
 * value, to be measured in a browser. */
export const ASYNC_PIPELINES_MAX_IN_FLIGHT = maxInFlightFor(globalThis.navigator?.hardwareConcurrency);

/** The longest a creation may take from the moment it is started (not
 * queued): past it, it is given up, its slot freed and its node drawn
 * synchronously from its next draw, so a creation that never settles can
 * neither keep a mesh out for good nor stall the queue behind it. */
export const ASYNC_PIPELINE_MAX_MS = 30_000;

/** The longest the start holds its reveal for a frame that left nothing out,
 * counted from the end of its first frame (`revealWhenWhole`). */
export const REVEAL_PIPELINES_MAX_MS = 10_000;

/**
 * What a measurement reads, on `globalThis` as `dayhikePipelines`: the report
 * of the page's latest WebGPU engine, each engine made replacing it.
 */
export type PipelinesReport = {
  mode: "sync" | "async";
  /** Creations in flight at most; 0 with `sync`. */
  limit: number;
  /** Pipelines asked for asynchronously. */
  asked: number;
  /** Of those, landed and stored. */
  landed: number;
  /** Of those, failed (their nodes then made synchronously). */
  failed: number;
  /** Of those, given up at their deadline (`ASYNC_PIPELINE_MAX_MS`; their
   * nodes then made synchronously). */
  expired: number;
  /** Frames a draw left out escaped (`guardRender`): the patch then came off. */
  escapes: number;
  /** Pipelines made on Babylon's synchronous path: its per-frame count, summed. */
  sync: number;
  /** Draws left out while their pipeline was made. */
  leftOut: number;
  /** The longest time from a pipeline asked for to its landing, queue included. */
  longestMs: number;
  /** Pipelines asked for and not yet landed. */
  pending: number;
};

/** A cache node of Babylon's tree cache (`webgpuCacheRenderPipelineTree.js`). */
type CacheNode = { pipeline?: unknown };

/** The engine's pipeline cache, as the patch reads it (Babylon declares these private). */
type PipelineCache = {
  _device: { createRenderPipelineAsync(descriptor: unknown): Promise<unknown>; lost?: Promise<unknown> };
  _parameter: { token: CacheNode; pipeline: unknown };
  disabled: boolean;
  getRenderPipeline(fill: number, effect: unknown, sampleCount: number, textureState?: number): unknown;
  _lookupRenderPipeline(fill: number, effect: unknown, sampleCount: number, textureState: number): unknown;
  _buildRenderPipelineDescriptor(effect: unknown, topology: string, sampleCount: number): unknown;
  _setRenderPipeline(param: { token: CacheNode; pipeline: unknown }): void;
};

/** The engine, as the patch reads it. */
type PatchedEngine = {
  _cacheRenderPipeline?: PipelineCache;
  _draw?: (...args: unknown[]) => void;
  isDisposed: boolean;
  snapshotRendering?: boolean;
};

/** Babylon's topology for a fill mode, as its own `getRenderPipeline` takes it. */
const topologyOf = (fill: number): string =>
  (WebGPUCacheRenderPipeline as unknown as { _GetTopology(fill: number): string })._GetTopology(fill);

/** Thrown out of `getRenderPipeline` for a draw left out, and caught by the
 * wrapper on `_draw`: one object, made once, so throwing it costs no trace. */
const LEFT_OUT = new Error("a draw left out while its render pipeline is made");

/** The patch on each engine that has one. */
const installed = new WeakMap<object, AsyncPipelines>();

/** Per engine, the draws it left out and the pipelines it asked for, never
 * reset: frame readers take the difference from frame to frame. */
const tallies = new WeakMap<object, { leftOut: number; asked: number }>();

/** The patch on `engine`, or null: not installed (`?pipelines=sync`, or an
 * engine with no pipeline cache), or removed. */
export function asyncPipelinesOf(engine: AbstractEngine): AsyncPipelines | null {
  return installed.get(engine) ?? null;
}

/** The draws `engine` has left out so far; 0 without the patch. */
export function leftOutOn(engine: AbstractEngine): number {
  return tallies.get(engine)?.leftOut ?? 0;
}

/**
 * Makes `engine` report its pipelines on the page (`dayhikePipelines`,
 * replacing an earlier engine's report), counting those Babylon makes
 * synchronously; and, unless `mode` is `sync`, installs the patch, with
 * `ASYNC_PIPELINES_MAX_IN_FLIGHT` in flight for `async` and the number given
 * otherwise. Returns the patch, or null where none was installed: with
 * `sync`, which leaves Babylon's path as it is, and on an engine with no
 * pipeline cache (one whose start has not come). `now` times the waits.
 */
export function installPipelines(
  engine: AbstractEngine,
  mode: PipelineMode,
  options: { now?: () => number } = {},
): AsyncPipelines | null {
  const limit = mode === "sync" ? 0 : mode === "async" ? ASYNC_PIPELINES_MAX_IN_FLIGHT : mode;
  const report: PipelinesReport = {
    mode: mode === "sync" ? "sync" : "async",
    limit,
    asked: 0,
    landed: 0,
    failed: 0,
    expired: 0,
    escapes: 0,
    sync: 0,
    leftOut: 0,
    longestMs: 0,
    pending: 0,
  };
  (globalThis as { dayhikePipelines?: PipelinesReport }).dayhikePipelines = report;
  // Babylon counts the pipelines each frame made synchronously before it
  // tells the frame's end, whichever cache made them.
  (engine as { onEndFrameObservable?: AbstractEngine["onEndFrameObservable"] }).onEndFrameObservable?.add(() => {
    report.sync += WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame;
  });
  if (mode === "sync") return null;
  return patch(engine, limit, report, options.now ?? (() => performance.now()));
}

/** A creation asked for, in flight or waiting its turn; its deadline set
 * once it is started. */
type Creation = { node: CacheNode; descriptor: unknown; askedAt: number; deadline?: ReturnType<typeof setTimeout> };

/** What a scene's render is, to the guard (`Scene.render`). */
type Renders = { render: (...args: unknown[]) => void };

/** The message of what a rejected creation was rejected with. */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function patch(engine: AbstractEngine, limit: number, report: PipelinesReport, now: () => number): AsyncPipelines | null {
  const own = engine as unknown as PatchedEngine;
  const cache = own._cacheRenderPipeline;
  const ownDraw = own._draw;
  if (cache === undefined || typeof ownDraw !== "function") return null;
  const device = cache._device;
  const tally = { leftOut: 0, asked: 0 };
  tallies.set(engine, tally);

  /** Each node asked for: being made, or failed for good. */
  const nodes = new WeakMap<CacheNode, "pending" | "failed">();
  const queue: Creation[] = [];
  let inFlight = 0;
  let depth = 0;
  let skipped = 0;
  let removed = false;
  let lost = false;
  /** The creations in flight, each until it lands, fails or is given up. */
  const flying = new Set<Creation>();
  /** Whether a rejection, and a deadline passed, has been said. */
  let saidFailure = false;
  let saidExpiry = false;
  const waiters = new Set<{ resolve(emptied: boolean): void; timer: ReturnType<typeof setTimeout> }>();

  const stopped = (): boolean => removed || lost || own.isDisposed;
  const pending = (): number => (stopped() ? 0 : inFlight + queue.length);
  /** The report's count, and every wait that has emptied. */
  const update = (): void => {
    report.pending = pending();
    if (report.pending > 0) return;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(true);
    }
    waiters.clear();
  };
  /** Starts queued creations, first in first out, up to the limit. */
  const start = (): void => {
    if (stopped()) {
      queue.length = 0;
      return;
    }
    while (inFlight < limit) {
      const creation = queue.shift();
      if (creation === undefined) return;
      inFlight++;
      flying.add(creation);
      creation.deadline = setTimeout(() => expire(creation), ASYNC_PIPELINE_MAX_MS);
      let making: Promise<unknown>;
      try {
        making = device.createRenderPipelineAsync(creation.descriptor);
      } catch (error) {
        making = Promise.reject(error);
      }
      void making.then(
        (pipeline) => settle(creation, { pipeline }),
        (error: unknown) => settle(creation, { error }),
      );
    }
  };
  /** Takes `creation` out of flight, once: false where it already was (given
   * up at its deadline, whatever comes of it after). */
  const land = (creation: Creation): boolean => {
    if (!flying.delete(creation)) return false;
    clearTimeout(creation.deadline);
    inFlight--;
    return true;
  };
  /** A creation landed or failed. */
  const settle = (creation: Creation, outcome: { pipeline: unknown } | { error: unknown }): void => {
    if (!land(creation)) return;
    if (!stopped()) {
      if ("pipeline" in outcome) {
        // As `preWarmPipeline` stores it: in the node the lookup left.
        cache._setRenderPipeline({ token: creation.node, pipeline: outcome.pipeline });
        nodes.delete(creation.node);
        report.landed++;
        report.longestMs = Math.max(report.longestMs, now() - creation.askedAt);
      } else {
        nodes.set(creation.node, "failed");
        report.failed++;
        if (!saidFailure) {
          saidFailure = true;
          console.warn(`WebGPU: a render pipeline could not be made asynchronously; its draws make it synchronously: ${messageOf(outcome.error)}`);
        }
      }
    }
    start();
    update();
  };
  /** A creation still in flight at its deadline: given up, its node drawn
   * synchronously from its next draw, its slot freed. */
  const expire = (creation: Creation): void => {
    if (!land(creation)) return;
    if (!stopped()) {
      nodes.set(creation.node, "failed");
      report.expired++;
      if (!saidExpiry) {
        saidExpiry = true;
        console.warn(`WebGPU: a render pipeline was not made within ${ASYNC_PIPELINE_MAX_MS / 1000} s; its draws make it synchronously.`);
      }
    }
    start();
    update();
  };
  void device.lost?.then(() => {
    lost = true;
    queue.length = 0;
    update();
  });

  const ownGet = cache.getRenderPipeline;
  const hadOwnGet = Object.prototype.hasOwnProperty.call(cache, "getRenderPipeline");
  const getRenderPipeline = (fill: number, effect: unknown, sampleCount: number, textureState = 0): unknown => {
    if (depth === 0 || cache.disabled || stopped() || own.snapshotRendering === true) {
      return ownGet.call(cache, fill, effect, sampleCount, textureState);
    }
    const samples = WebGPUTextureHelper.GetSample(sampleCount);
    const found = cache._lookupRenderPipeline(fill, effect, samples, textureState);
    if (found) return found;
    const node = cache._parameter.token;
    const state = nodes.get(node);
    // Babylon's own path, which looks the node up again, misses, makes the
    // pipeline and stores it, raising a validation error where it did.
    if (state === "failed") return ownGet.call(cache, fill, effect, sampleCount, textureState);
    if (state === undefined) {
      // Built now, from the draw's state, as Babylon's own path would.
      const descriptor = cache._buildRenderPipelineDescriptor(effect, topologyOf(fill), samples);
      nodes.set(node, "pending");
      queue.push({ node, descriptor, askedAt: now() });
      tally.asked++;
      report.asked++;
      start();
      update();
    }
    throw LEFT_OUT;
  };
  cache.getRenderPipeline = getRenderPipeline;

  // Leaving `_draw` where its lookup throws is safe, item by item, for what it
  // has done by then (`webgpuEngine.pure.js`, `_draw`):
  // - `_getCurrentRenderPass` has begun the render target's pass, or the
  //   main pass, where none was open; it is ended with the frame's others,
  //   this draw simply absent from it;
  // - `applyStates` has set the stencil state (through the stencil composer)
  //   and the alpha blend's enable on the cache; the depth and cull state came
  //   from `setState` before the draw. Every draw sets its own;
  // - the internals' uniform buffer and the effect's leftover one are bound on
  //   the draw context (`bindUniformBufferBase`, `setBuffer`), and the
  //   leftover one written with this draw's values; the next draw binds and
  //   writes its own;
  // - the draw context's vertex pulling is set (marking the context dirty
  //   where it changed);
  // - outside compatibility mode, the draw context's bundle is dropped where
  //   stale (`fastBundle = undefined`); a draw with a live bundle returns
  //   before the lookup, so a draw left out never has one. Babylon's default,
  //   compatibility mode, keeps no bundle: every draw sets its pipeline, index
  //   and vertex buffers and bind groups on the pass anew;
  // - the texture state is written to the material context, recomputed at
  //   every draw;
  // - the cache's lookup has set its state keys, its node stack and
  //   `_parameter` (the token the node, no pipeline) as after any miss, and
  //   its vertex buffers, which every lookup rebuilds; the next lookup of the
  //   same state walks to the same node and reads what is stored there.
  // Not reached: `getBindGroups`, which resets the draw and material
  // contexts' dirty flags, so both stay dirty and the next draw makes its bind
  // groups again; `_applyRenderPassChanges`, so the viewport, scissor, stencil
  // reference and blend colour stay to be applied by the next draw; the bundle
  // encoder, `setPipeline`, the buffers and bind groups set on the pass, the
  // draw itself and `_reportDrawCall`. Snapshot recording, which takes a
  // bundle encoder before the lookup, is left to Babylon (`snapshotRendering`
  // above).
  const hadOwnDraw = Object.prototype.hasOwnProperty.call(own, "_draw");
  const draw = (...args: unknown[]): void => {
    try {
      ownDraw.apply(engine, args);
    } catch (error) {
      if (error !== LEFT_OUT) throw error;
      skipped++;
      tally.leftOut++;
      report.leftOut++;
    }
  };
  own._draw = draw;

  // The last guard: were a draw path ever to ask the cache without going
  // through this engine's `_draw` (a Babylon that moved; the canaries in
  // `asyncPipelines.test.ts` watch for it), the sentinel would leave
  // `scene.render`, and Babylon's render loop queues no frame after a throw:
  // the game would stop for good, with no WebGPU error to swap on. So each
  // scene of this engine renders inside a catch of the sentinel alone: the
  // patch then comes off this engine for good, every later draw synchronous,
  // said once, and the frame's loop goes on. Any other throw passes through.
  const scenes = new Map<Renders, { ownRender: Renders["render"]; hadOwn: boolean; guarded: Renders["render"] }>();
  const guardRender = (scene: Renders): void => {
    if (scenes.has(scene)) return;
    const ownRender = scene.render;
    const hadOwn = Object.prototype.hasOwnProperty.call(scene, "render");
    const guarded = (...args: unknown[]): void => {
      try {
        ownRender.apply(scene, args);
      } catch (error) {
        if (error !== LEFT_OUT) throw error;
        report.escapes++;
        console.warn("WebGPU: a draw left out while its render pipeline was made reached the frame; this engine makes every pipeline synchronously from now on.");
        pipelines.remove();
      }
    };
    scene.render = guarded;
    scenes.set(scene, { ownRender, hadOwn, guarded });
  };
  const withScenes = engine as { onNewSceneAddedObservable?: AbstractEngine["onNewSceneAddedObservable"]; scenes?: unknown[] };
  const sceneAdded = withScenes.onNewSceneAddedObservable?.add((scene) => guardRender(scene as unknown as Renders)) ?? null;
  for (const scene of withScenes.scenes ?? []) guardRender(scene as Renders);

  const pipelines: AsyncPipelines = {
    enter() {
      depth++;
    },
    leave() {
      depth = Math.max(0, depth - 1);
    },
    pending,
    takeSkipped() {
      const count = skipped;
      skipped = 0;
      return count;
    },
    settled(ms) {
      if (pending() === 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const waiter = {
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            resolve(false);
          }, ms),
        };
        waiters.add(waiter);
      });
    },
    remove() {
      if (removed) return;
      removed = true;
      queue.length = 0;
      depth = 0;
      if (cache.getRenderPipeline === getRenderPipeline) {
        if (hadOwnGet) cache.getRenderPipeline = ownGet;
        else delete (cache as { getRenderPipeline?: unknown }).getRenderPipeline;
      }
      if (own._draw === draw) {
        if (hadOwnDraw) own._draw = ownDraw;
        else delete own._draw;
      }
      for (const creation of flying) clearTimeout(creation.deadline);
      withScenes.onNewSceneAddedObservable?.remove(sceneAdded);
      for (const [scene, { ownRender, hadOwn, guarded }] of scenes) {
        if (scene.render !== guarded) continue;
        if (hadOwn) scene.render = ownRender;
        else delete (scene as { render?: unknown }).render;
      }
      scenes.clear();
      if (installed.get(engine) === pipelines) installed.delete(engine);
      update();
    },
  };
  installed.set(engine, pipelines);
  update();
  return pipelines;
}

/**
 * Calls `lift` once: at the end of the first frame of `engine` that left no
 * draw out, once it has asked for a pipeline (a frame before any draw met the
 * cache is not a whole world, only an empty one), or `maxMs` after the end of
 * its first frame, whichever comes first. On an engine without the patch,
 * where nothing is left out, at once. Returns a function that stops waiting,
 * without lifting.
 */
export function revealWhenWhole(engine: AbstractEngine, lift: () => void, maxMs = REVEAL_PIPELINES_MAX_MS): () => void {
  if (asyncPipelinesOf(engine) === null) {
    lift();
    return () => undefined;
  }
  let seen = leftOutOn(engine);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const stop = (): void => {
    done = true;
    clearTimeout(timer);
    engine.onEndFrameObservable.remove(observer);
  };
  const finish = (): void => {
    if (done) return;
    stop();
    lift();
  };
  const observer = engine.onEndFrameObservable.add(() => {
    timer ??= setTimeout(finish, maxMs);
    const leftOut = leftOutOn(engine);
    const whole = leftOut === seen && (tallies.get(engine)?.asked ?? 0) > 0;
    seen = leftOut;
    if (whole) finish();
  });
  return stop;
}
