/**
 * The startup probe's scene, its measured steps, and the page's `StartupDeps`.
 *
 * Each step builds the canopy pose (`probePose`) on a fresh canvas filling the
 * game's container, at the tier being measured, the way the landing backdrop
 * builds its own scenery: a forest, the stub level and an empty
 * non-authoritative world, mist, noon. It waits for the scene to be ready,
 * discards the warm-up frames, measures the intervals between render-loop
 * callbacks, and disposes the renderer and removes the canvas whatever
 * happened, so no probe renderer outlives its step.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
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
  probeReadingLine,
  type StartupDeps,
} from "./frameProbe.js";
import { afterNextPaint } from "./paint.js";
import { showProbeScreen, timeIdleCadence } from "./probeScreen.js";
import { containerPixels, type ProbeReading, type QualityTier, type VerdictEngine } from "./quality.js";
import { createRenderer, type Renderer } from "./renderer.js";
import { seedFromToken } from "./seed.js";
import { pageStorage } from "./tierChoice.js";
import { WEATHER_PRESETS } from "./weather.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

export type ProbeScene = { renderer: Renderer; frame(): void; dispose(): void };

/**
 * The engine a probe step draws with, and its canvas: WebGPU where the WebGPU
 * rule gives the step's tier and it started, made for `canvas`, with its
 * failure detector (`watchWebGpu`), which only the step itself listens to;
 * else WebGL2 (`engine` and `watch` null), which the renderer makes, with its
 * context lost on dispose as the game's is.
 */
export type StepEngine = {
  canvas: HTMLCanvasElement;
  engine: AbstractEngine | null;
  watch: ((engine: AbstractEngine, onFailure: (reason: "pipeline" | "lost") => void) => () => void) | null;
};

/** A probe step ended by a fault of its WebGPU engine: its build, an effect,
 * an uncaptured error or a lost device while it drew. */
export const ENGINE_FAILED = "engine-failed";

/**
 * The canopy pose at `tier` on `canvas`, drawn on `engine` when one is given
 * (WebGPU, made for `canvas`), else on WebGL2: `frame()` puts the free camera
 * on the pose, syncs and renders once; `dispose()` disposes the renderer and
 * its engine.
 */
export function buildProbeScene(canvas: HTMLCanvasElement, tier: QualityTier, engine: AbstractEngine | null = null): ProbeScene {
  // Module state survives a game's `/terrain` command; the pose is the
  // default variant's.
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const seed = seedFromToken(PROBE_SEED_TOKEN);
  const level = parseLevel(sandbox01);
  const forest = createForest(seed);
  const renderer = createRenderer(canvas, level, forest, { tier, engine: engine ?? undefined });
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
 */
export function runProbeStep(
  container: HTMLElement,
  tier: QualityTier,
  opts: { cancelled(): boolean; signal?: AbortSignal; on?: StepEngine; readyBy?: number },
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
      probe = buildProbeScene(canvas, tier, given);
    } catch (error) {
      console.warn("quality probe: the scene could not be built.", error);
      canvas.remove();
      resolve(given === null ? null : ENGINE_FAILED);
      return;
    }
    const { engine, scene } = probe.renderer;
    // Ready within `PROBE_READY_MAX_MS` of the end of the build, and by
    // `readyBy` (a `performance.now()` time: what the probe's cap leaves the
    // step, the paint wait and the build spent from it), whichever is sooner.
    const began = performance.now();
    const meter = createProbeMeter(began, opts.readyBy === undefined ? PROBE_READY_MAX_MS : Math.min(PROBE_READY_MAX_MS, opts.readyBy - began));
    const compiled = engine.onAfterShaderCompilationObservable.add(() => meter.compiled(performance.now()));
    let done = false;
    let unwatch = (): void => undefined;

    const finish = (reading: ProbeReading | null | typeof ENGINE_FAILED): void => {
      if (done) return;
      done = true;
      engine.stopRenderLoop(loop);
      engine.onAfterShaderCompilationObservable.remove(compiled);
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
        const sceneReady = meter.ready || (scene.isReady() && scene.getWaitingItemsCount() === 0);
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
  measure(tier: QualityTier, on: StepEngine): Promise<ProbeReading | null | typeof ENGINE_FAILED>;
  /** WebGL2 on a fresh canvas. */
  webgl2(): StepEngine;
};

/**
 * One probe step on the engine the WebGPU rule gives its tier: WebGPU for
 * high and medium where the rule gives it, on the step's own canvas; WebGL2
 * for low and wherever else. A WebGPU engine that fails to start is already
 * the rule's start failure (`resolveWebGpu`) and hands back WebGL2; one that
 * fails in the step's build or frames is the same failure (`failed`), and the
 * step is measured again on WebGL2. A step whose engine it cannot settle on
 * (`settles`), such as WebGL2 after a WebGPU start that failed on a browser
 * without `KHR_parallel_shader_compile`, is not measured: no reading, at once,
 * rather than the player held behind the probe's screen for one that cannot
 * come. The engine is let go of when the page has moved on while it was made,
 * or when it is not measured.
 */
export async function measureOnRuleEngine(
  tier: QualityTier,
  stopped: () => boolean,
  deps: RuleEngineDeps,
): Promise<ProbeReading | null> {
  const on = await deps.engineFor(tier);
  if (stopped() || !(await deps.settles(on.engine === null ? "webgl2" : "webgpu")) || stopped()) {
    on.engine?.dispose();
    return null;
  }
  const first = await deps.measure(tier, on);
  if (first !== ENGINE_FAILED) return first;
  deps.failed();
  if (stopped() || !(await deps.settles("webgl2")) || stopped()) return null;
  const again = await deps.measure(tier, deps.webgl2());
  return again === ENGINE_FAILED ? null : again;
}

/** The page's `StartupDeps` for `container`, with `abort()` to stop a probe at
 * once when the page moves on (the render that replaces it calls it first). */
export type PageProbe = StartupDeps & { abort(): void };

/** WebGL2 on a fresh canvas: a probe step's engine where the page gives none. */
function webgl2Step(): StepEngine {
  return { canvas: document.createElement("canvas"), engine: null, watch: null };
}

/**
 * The page's `StartupDeps` for `container`. `engines` gives each step the
 * engine the WebGPU rule gives its tier, hears of a WebGPU step that failed,
 * and says whether a step can settle on the engine it got
 * (`measureOnRuleEngine`); without it every step is WebGL2.
 */
export function probeDeps(
  container: HTMLElement,
  engines: Pick<RuleEngineDeps, "engineFor" | "failed" | "settles"> = {
    engineFor: async () => webgl2Step(),
    failed: () => undefined,
    // Every step WebGL2: the start has already skipped a probe it cannot settle.
    settles: () => true,
  },
): PageProbe {
  const aborts = new AbortController();
  return {
    storage: pageStorage(),
    pixels: () => containerPixels(container),
    now: () => Date.now(),
    async runStep(tier, cancelled, readyMaxMs) {
      const readyBy = performance.now() + readyMaxMs;
      // The scene's build blocks the page; the screen paints first.
      await new Promise<void>((resolve) => afterNextPaint(resolve));
      const stopped = (): boolean => aborts.signal.aborted || cancelled();
      if (stopped()) return null;
      // One bound for the step, both measurements: the WebGL2 one after a
      // WebGPU engine's failure takes what is left of it, not a fresh one.
      const reading = await measureOnRuleEngine(tier, stopped, {
        ...engines,
        measure: (step, on) => runProbeStep(container, step, { cancelled: stopped, signal: aborts.signal, on, readyBy }),
        webgl2: webgl2Step,
      });
      if (reading !== null) console.info(probeReadingLine(reading, container.clientWidth, container.clientHeight));
      return reading;
    },
    showScreen: () => showProbeScreen(container),
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    whenVisible: () =>
      new Promise<boolean>((resolve) => {
        if (aborts.signal.aborted) return resolve(false);
        if (document.visibilityState === "visible") return resolve(true);
        const settle = (seen: boolean): void => {
          document.removeEventListener("visibilitychange", onChange);
          aborts.signal.removeEventListener("abort", onAbort);
          resolve(seen);
        };
        const onChange = (): void => {
          if (document.visibilityState === "visible") settle(true);
        };
        const onAbort = (): void => settle(false);
        document.addEventListener("visibilitychange", onChange);
        aborts.signal.addEventListener("abort", onAbort);
      }),
    // The screen's own frames, timed before any scene is built: the page's
    // cadence with nothing to draw.
    idleCadence: () => timeIdleCadence(aborts.signal),
    log: (line) => console.info(line),
    abort: () => aborts.abort(),
  };
}
