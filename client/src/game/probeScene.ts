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
import { createForest } from "../sim/forest.js";
import { parseLevel } from "../sim/level.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../sim/terrain.js";
import { createWorld } from "../sim/world.js";
import {
  PROBE_HOUR,
  PROBE_SEED_TOKEN,
  createProbeMeter,
  probePose,
  probeReadingLine,
  type StartupDeps,
} from "./frameProbe.js";
import { afterNextPaint } from "./paint.js";
import { showProbeScreen, timeIdleCadence } from "./probeScreen.js";
import { containerPixels, type ProbeReading, type QualityTier } from "./quality.js";
import { createRenderer, type Renderer } from "./renderer.js";
import { seedFromToken } from "./seed.js";
import { pageStorage } from "./tierChoice.js";
import { WEATHER_PRESETS } from "./weather.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

export type ProbeScene = { renderer: Renderer; frame(): void; dispose(): void };

/**
 * The canopy pose at `tier` on `canvas`: `frame()` puts the free camera on the
 * pose, syncs and renders once; `dispose()` disposes the renderer and its
 * engine.
 */
export function buildProbeScene(canvas: HTMLCanvasElement, tier: QualityTier): ProbeScene {
  // Module state survives a game's `/terrain` command; the pose is the
  // default variant's.
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const seed = seedFromToken(PROBE_SEED_TOKEN);
  const level = parseLevel(sandbox01);
  const forest = createForest(seed);
  const renderer = createRenderer(canvas, level, forest, { tier });
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
 * Measures `tier` on a fresh canvas in `container`, frame by frame through
 * `createProbeMeter`: ready, warm, measured, with a late shader compile
 * starting the warm-up again. Null on a cancel, an abort, a scene that never
 * readies, a throw, or too few frames. `signal` stops it at once,
 * disposing the renderer before `abort()` returns, so the page can build its
 * next renderer straight after without two living at once.
 */
export function runProbeStep(
  container: HTMLElement,
  tier: QualityTier,
  opts: { cancelled(): boolean; signal?: AbortSignal },
): Promise<ProbeReading | null> {
  return new Promise((resolve) => {
    if (opts.cancelled() || opts.signal?.aborted === true) {
      resolve(null);
      return;
    }
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    let probe: ProbeScene;
    try {
      probe = buildProbeScene(canvas, tier);
    } catch (error) {
      console.warn("quality probe: the scene could not be built.", error);
      canvas.remove();
      resolve(null);
      return;
    }
    const { engine, scene } = probe.renderer;
    const meter = createProbeMeter(performance.now());
    const compiled = engine.onAfterShaderCompilationObservable.add(() => meter.compiled(performance.now()));
    let done = false;

    const finish = (reading: ProbeReading | null): void => {
      if (done) return;
      done = true;
      engine.stopRenderLoop(loop);
      engine.onAfterShaderCompilationObservable.remove(compiled);
      opts.signal?.removeEventListener("abort", onAbort);
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
    engine.runRenderLoop(loop);
  });
}

/** The page's `StartupDeps` for `container`, with `abort()` to stop a probe at
 * once when the page moves on (the render that replaces it calls it first). */
export type PageProbe = StartupDeps & { abort(): void };

export function probeDeps(container: HTMLElement): PageProbe {
  const aborts = new AbortController();
  return {
    storage: pageStorage(),
    pixels: () => containerPixels(container),
    now: () => Date.now(),
    async runStep(tier, cancelled) {
      // The scene's build blocks the page; the screen paints first.
      await new Promise<void>((resolve) => afterNextPaint(resolve));
      const stopped = (): boolean => aborts.signal.aborted || cancelled();
      if (stopped()) return null;
      const reading = await runProbeStep(container, tier, { cancelled: stopped, signal: aborts.signal });
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
