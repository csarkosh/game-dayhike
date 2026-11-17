/**
 * The startup probe's scene on the renderer on Babylon.js, its measured
 * steps, and a page's `StartupDeps` that measure so.
 *
 * Each step builds the canopy pose (`probePose`) on a fresh canvas filling the
 * game's container, at the tier being measured, the way the landing backdrop
 * builds its own scenery: a forest, the stub level and an empty
 * non-authoritative world, mist, noon. It waits for the sky's first slices
 * and the scene to be ready, discards the warm-up frames, measures the
 * intervals between render-loop callbacks, and disposes the renderer and
 * removes the canvas whatever happened, so no probe renderer outlives its
 * step. The steps of one probe read one sky, started at its first step and
 * stopped when the probe ends, so no step makes the slices again: that, and
 * the rest of what the page's start asks of a probe but its measuring, is
 * made with no engine (`probePage.ts`).
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { createForest } from "../sim/forest.js";
import { parseLevel } from "../sim/level.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../sim/terrain.js";
import { createWorld } from "../sim/world.js";
import {
  PROBE_HOUR,
  PROBE_READY_MAX_MS,
  PROBE_SEED_TOKEN,
  createProbeMeter,
  probePose,
} from "./frameProbe.js";
import { pageProbe, type PageProbe } from "./probePage.js";
import type { EngineHandle } from "./engineHandle.js";
import { containerPixels, type ProbeReading, type QualityTier, type VerdictEngine } from "./quality.js";
import { createRenderer, type SceneRenderer } from "./renderer.js";
import { seedFromToken } from "./seed.js";
import { startSkySource, type SkySource } from "./skyWorker.js";
import type { SkyTable } from "./skyTable.js";
import { WEATHER_PRESETS } from "./weather.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

export type ProbeScene = { renderer: SceneRenderer; frame(): void; dispose(): void };

/**
 * The engine a probe step draws with, and its canvas: WebGPU where the WebGPU
 * rule gives the step's tier and it started, made for `canvas`, with its
 * failure detector (`watchWebGpu`), which only the step itself listens to;
 * else WebGL2 (`engine` and `watch` null), which the renderer makes, with its
 * context lost on dispose as the game's is.
 */
export type StepEngine = {
  canvas: HTMLCanvasElement;
  engine: EngineHandle | null;
  watch: ((engine: EngineHandle, onFailure: (reason: "pipeline" | "lost") => void) => () => void) | null;
  /** Tells `onFrame` at the end of each frame of a WebGPU engine that is no
   * measure of its tier: one held while a render pipeline was made, one that
   * left a draw out, or one that made a pipeline synchronously
   * (`watchPipelines`); absent or null on WebGL2, and where the page has no
   * WebGPU module. The step starts its warm-up again on each, as after a
   * late compile. */
  unmeasured?: ((engine: EngineHandle, onFrame: () => void) => () => void) | null;
};

/** A probe step ended by a fault of its WebGPU engine: its build, an effect,
 * an uncaptured error or a lost device while it drew. */
export const ENGINE_FAILED = "engine-failed";

/**
 * The canopy pose at `tier` on `canvas`, drawn on `engine` when one is given
 * (WebGPU, made for `canvas`), else on WebGL2, its sky read from `sky` when
 * given (the probe's own, shared by its steps), else from a source of the
 * renderer's own: `frame()` puts the free camera on the pose, syncs and
 * renders once; `dispose()` disposes the renderer and its engine.
 */
export function buildProbeScene(canvas: HTMLCanvasElement, tier: QualityTier, engine: EngineHandle | null = null, sky?: SkyTable): ProbeScene {
  // Module state survives a game's `/terrain` command; the pose is the
  // default variant's.
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const seed = seedFromToken(PROBE_SEED_TOKEN);
  const level = parseLevel(sandbox01);
  const forest = createForest(seed);
  const renderer = createRenderer(canvas, level, forest, { tier, engine: engine ?? undefined, skyTable: sky });
  try {
    renderer.setWeather(WEATHER_PRESETS.mist, 0);
    renderer.setHour(PROBE_HOUR);
    const world = createWorld(level, seed, false);
    const pose = probePose();
    return {
      renderer,
      frame() {
        renderer.setFreecam(pose);
        renderer.sync(world.state, -1, 0);
        renderer.scene.render();
      },
      dispose() {
        renderer.dispose();
      },
    };
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

/**
 * Whether a probe step's scene counts as ready this frame. Once the meter has
 * found it so, it stays so. Before that, the sky's first slices must be in
 * (`Renderer.skyReady`) as well as the scene ready with nothing waiting:
 * otherwise the frames warmed and measured could be the sky arriving (its
 * texture uploaded, the probe captured again), not the scene the tier draws.
 */
export function probeSceneReady(meterReady: boolean, skyIn: boolean, scene: Pick<Scene, "isReady" | "getWaitingItemsCount">): boolean {
  return meterReady || (skyIn && scene.isReady() && scene.getWaitingItemsCount() === 0);
}

/**
 * Measures `tier` in `container`, frame by frame through `createProbeMeter`:
 * ready, warm, measured, with a late shader compile starting the warm-up
 * again. On `opts.on`'s canvas and engine when given (the engine the WebGPU
 * rule gives the tier), else on WebGL2 on a fresh canvas. Null on a cancel, an
 * abort, a scene that never readies (by `opts.readyBy`, at most
 * `PROBE_READY_MAX_MS` after its build), a throw, or too few frames;
 * `ENGINE_FAILED` where a WebGPU engine's build or its frames failed, which
 * only the step's own watcher hears, never the game's. `signal` stops it at
 * once, disposing the renderer before `abort()` returns, so the page can
 * build its next renderer straight after without two living at once.
 * `opts.sky` is the probe's sky, shared by its steps (`buildProbeScene`).
 */
export function runProbeStep(
  container: HTMLElement,
  tier: QualityTier,
  opts: { cancelled(): boolean; signal?: AbortSignal; on?: StepEngine; readyBy?: number; sky?: SkyTable },
): Promise<ProbeReading | null | typeof ENGINE_FAILED> {
  return new Promise((resolve) => {
    const given = opts.on?.engine ?? null;
    if (opts.cancelled() || opts.signal?.aborted === true) {
      given?.dispose();
      resolve(null);
      return;
    }
    const canvas = opts.on?.canvas ?? document.createElement("canvas");
    container.appendChild(canvas);
    let probe: ProbeScene;
    try {
      // A renderer whose build throws disposes the engine it was given.
      probe = buildProbeScene(canvas, tier, given, opts.sky);
    } catch (error) {
      console.warn("quality probe: the scene could not be built.", error);
      canvas.remove();
      resolve(given === null ? null : ENGINE_FAILED);
      return;
    }
    const { engine, scene } = probe.renderer;
    // The step is not ready until the sky's first slices are in
    // (`probeSceneReady`); the meter's bound counts from here regardless.
    let skyIn = false;
    void probe.renderer.skyReady().then(() => {
      skyIn = true;
    });
    // Ready within `PROBE_READY_MAX_MS` of the end of the build, and by
    // `readyBy` (a `performance.now()` time: what the probe's cap leaves the
    // step, the paint wait and the build spent from it), whichever is sooner.
    const began = performance.now();
    const meter = createProbeMeter(began, opts.readyBy === undefined ? PROBE_READY_MAX_MS : Math.min(PROBE_READY_MAX_MS, opts.readyBy - began));
    const compiled = engine.onAfterShaderCompilationObservable.add(() => meter.compiled(performance.now()));
    // A frame held while a pipeline was made, or that left a draw out, is no
    // measure of the tier either: the warm-up starts again (`StepEngine`).
    const unwatchFrames =
      given !== null && opts.on?.unmeasured != null ? opts.on.unmeasured(given, () => meter.compiled(performance.now())) : (): void => undefined;
    let done = false;
    let unwatch = (): void => undefined;

    const finish = (reading: ProbeReading | null | typeof ENGINE_FAILED): void => {
      if (done) return;
      done = true;
      engine.stopRenderLoop(loop);
      engine.onAfterShaderCompilationObservable.remove(compiled);
      unwatchFrames();
      opts.signal?.removeEventListener("abort", onAbort);
      // Before the dispose: a disposed engine is not a failing one.
      unwatch();
      probe.dispose();
      canvas.remove();
      resolve(reading);
    };
    const onAbort = (): void => finish(null);
    const loop = (): void => {
      if (opts.cancelled()) {
        finish(null);
        return;
      }
      try {
        const now = performance.now();
        probe.frame();
        const sceneReady = probeSceneReady(meter.ready, skyIn, scene);
        const step = meter.frame(now, sceneReady);
        if (!step.done) return;
        finish(
          step.stats === null
            ? null
            : { tier, ...step.stats, pixels: containerPixels(container), engine: engine.isWebGPU ? "webgpu" : "webgl2" },
        );
      } catch (error) {
        console.warn("quality probe: a frame failed.", error);
        finish(null);
      }
    };
    opts.signal?.addEventListener("abort", onAbort);
    if (given !== null && opts.on?.watch) {
      const stop = opts.on.watch(given, () => finish(ENGINE_FAILED));
      if (done) stop();
      else unwatch = stop;
    }
    if (done) return;
    engine.runRenderLoop(loop);
  });
}

/** What `measureOnRuleEngine` needs of the page. */
export type RuleEngineDeps = {
  /** The engine the WebGPU rule gives `tier` now, on its own canvas. */
  engineFor(tier: QualityTier): Promise<StepEngine>;
  /** A WebGPU step failed: the rule's start failure, remembered as `init`. */
  failed(): void;
  /** Whether a step drawing with `engine` can be ready here
   * (`probeStepCanSettle`), or true where `?probe=` forces the probe. */
  settles(engine: VerdictEngine): boolean | Promise<boolean>;
  /** One measurement of `tier` on `on` (`runProbeStep`). */
  measure(tier: QualityTier, on: StepEngine, readyBy: number): Promise<ProbeReading | null | typeof ENGINE_FAILED>;
  /** WebGL2 on a fresh canvas. */
  webgl2(): StepEngine;
};

/**
 * One probe step on the engine the WebGPU rule gives its tier: WebGPU for
 * high where the rule gives it, on the step's own canvas; WebGL2 for medium,
 * low and wherever else. A WebGPU engine that fails to start is already
 * the rule's start failure (`resolveWebGpu`) and hands back WebGL2; one that
 * fails in the step's build or frames is the same failure (`failed`), and the
 * step is measured again on WebGL2. A step whose engine it cannot settle on
 * (`settles`), such as WebGL2 after a WebGPU start that failed on a browser
 * without `KHR_parallel_shader_compile`, is not measured: no reading, at once,
 * rather than the player held behind the probe's screen for one that cannot
 * come. The engine is let go of when the page has moved on while it was made,
 * or when it is not measured. Both measurements are ready by the one
 * `readyBy`, the step's bound: the WebGL2 one after a WebGPU engine's failure
 * takes what is left of it, not a fresh one.
 */
export async function measureOnRuleEngine(
  tier: QualityTier,
  stopped: () => boolean,
  deps: RuleEngineDeps,
  readyBy: number,
): Promise<ProbeReading | null> {
  const on = await deps.engineFor(tier);
  if (stopped() || !(await deps.settles(on.engine === null ? "webgl2" : "webgpu")) || stopped()) {
    on.engine?.dispose();
    return null;
  }
  const first = await deps.measure(tier, on, readyBy);
  if (first !== ENGINE_FAILED) return first;
  deps.failed();
  // A bound already passed gives the re-measure nothing to be ready in: no
  // scene is built for it.
  if (stopped() || performance.now() >= readyBy || !(await deps.settles("webgl2")) || stopped()) return null;
  const again = await deps.measure(tier, deps.webgl2(), readyBy);
  return again === ENGINE_FAILED ? null : again;
}

export type { PageProbe };

/** WebGL2 on a fresh canvas: a probe step's engine where the page gives none. */
function webgl2Step(): StepEngine {
  return { canvas: document.createElement("canvas"), engine: null, watch: null };
}

/**
 * A page's `StartupDeps` for `container`, every step measured on the renderer
 * on Babylon.js. `engines` gives each step the engine the WebGPU rule gives
 * its tier, hears of a WebGPU step that failed, and says whether a step can
 * settle on the engine it got (`measureOnRuleEngine`); without it every step
 * is WebGL2. The probe's sky is one source (`startSky`, at the probe's hour)
 * started at its first step, read by every step after, and stopped when the
 * probe ends (`endProbe`) or the page moves on (`abort`): the page's half,
 * made with no engine (`pageProbe`).
 */
export function probeDeps(
  container: HTMLElement,
  engines: Pick<RuleEngineDeps, "engineFor" | "failed" | "settles"> = {
    engineFor: async () => webgl2Step(),
    failed: () => undefined,
    // Every step WebGL2: the start has already skipped a probe it cannot settle.
    settles: () => true,
  },
  startSky: (startDeg: number) => SkySource = startSkySource,
): PageProbe {
  return pageProbe(
    container,
    (tier, step) =>
      measureOnRuleEngine(
        tier,
        step.stopped,
        {
          ...engines,
          measure: (measured, on, by) => runProbeStep(container, measured, { cancelled: step.stopped, signal: step.signal, on, readyBy: by, sky: step.sky }),
          webgl2: webgl2Step,
        },
        step.readyBy,
      ),
    startSky,
  );
}
