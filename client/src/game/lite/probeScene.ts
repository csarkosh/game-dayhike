/**
 * The startup probe's scene on Babylon Lite, one measured step of it, and
 * the page's `StartupDeps` that measure every step so (`liteProbeDeps`).
 *
 * The scene is the
 * canopy pose (`probePose`) at the tier being measured, on a forest, the
 * stub level and an empty world nothing steps, in mist at the probe's hour,
 * drawn by the hike's own renderer on a canvas of its own filling the
 * game's container. A step waits for the sky's first slices and for every
 * model the renderer asked for to land, discards the warm-up frames,
 * measures the intervals between frames through the same meter
 * (`createProbeMeter`), and lets go of the renderer and its canvas whatever
 * happened, so no probe renderer outlives its step: the renderer's engine
 * and its device go with it, before the step's reading is handed back, so
 * the next step's, and then the hike's, are made with none living beside
 * them. A renderer let go while it is still being made lets go of its
 * device only once its making has ended, so a step that ends that early
 * (the probe's time ran out) hands its answer back after that.
 *
 * The renderer makes its own engine from the canvas, on WebGPU, so a step
 * is handed none and there is no second engine to measure on; and a frame
 * is ready when the renderer has nothing left to land (`waitingItems`). A
 * shader compiled late starts the warm-up again through
 * `Renderer.onShaderCompiled`.
 *
 * **A step whose renderer draws nothing reads nothing.** A renderer that
 * cannot be made (no adapter, a device refused) is handed back all the
 * same and stays empty: its sky comes in, nothing is left to land, and its
 * frames, which draw nothing, would read as a tier that holds. So the step
 * asks the renderer whether it came to stand (`Renderer.whenMade`) and ends
 * at once where it did not; and it keeps the renderer's own watch on its
 * device (`Renderer.ownWatch`), ending the same way where the device fails
 * under it. Either is a step that failed: the probe is abandoned and the
 * hike starts at the class's tier (`runProbe`).
 */
import sandbox01 from "../../../levels/sandbox01.json" with { type: "json" };
import { createForest } from "@csarkosh/engine/sim/forest";
import { parseLevel } from "@csarkosh/engine/sim/level";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { createWorld } from "../../sim/world.js";
import { PROBE_HOUR, PROBE_READY_MAX_MS, PROBE_SEED_TOKEN, createProbeMeter, probePose } from "@csarkosh/engine/game/frameProbe";
import { pageProbe, type PageProbe } from "@csarkosh/engine/game/probePage";
import { containerPixels, type ProbeReading, type QualityTier } from "@csarkosh/engine/game/quality";
import type { Renderer } from "../hikeRendererTypes.js";
import type { RendererOptions } from "../rendererTypes.js";
import { hikeParts } from "./hikeParts.js";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import type { SkyTable } from "@csarkosh/engine/game/skyTable";
import type { SkySource } from "@csarkosh/engine/game/skyWorker";
import { WEATHER_PRESETS } from "@csarkosh/engine/game/weather";
import { createLiteRenderer } from "./renderer.js";

export type LiteProbeScene = { renderer: Renderer; frame(): void; dispose(): void };

/**
 * The longest a step's answer waits for a renderer let go while it was
 * still being made to end its making (ms): a making that never ends (a
 * device never answered) must not hold the start behind the probe's screen.
 */
export const LET_GO_MAX_MS = 5_000;

/** Makes the renderer a probe step draws with; a test hands in its own. */
export type ProbeRendererMaker = (canvas: HTMLCanvasElement, level: ReturnType<typeof parseLevel>, forest: ReturnType<typeof createForest>, options: RendererOptions) => Renderer;

/**
 * The canopy pose at `tier` on `canvas`, its sky read from `sky` when given
 * (the probe's own, shared by its steps), else from a source of the
 * renderer's own: `frame()` puts the free camera on the pose, syncs and
 * draws once; `dispose()` lets go of the renderer and its engine.
 */
export function buildLiteProbeScene(canvas: HTMLCanvasElement, tier: QualityTier, sky?: SkyTable, make: ProbeRendererMaker = (at, level, forest, options) => createLiteRenderer(at, level, forest, options ?? {}, hikeParts)): LiteProbeScene {
  // Module state survives a game's `/terrain` command; the pose is the default variant's.
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const seed = seedFromToken(PROBE_SEED_TOKEN);
  const level = parseLevel(sandbox01);
  const forest = createForest(seed);
  const renderer = make(canvas, level, forest, sky === undefined ? { tier } : { tier, skyTable: sky });
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
        renderer.drawFrame();
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
 * Whether a probe step's scene counts as ready this frame. Once the meter
 * has found it so, it stays so. Before that, the sky's first slices must be
 * in and the renderer must have nothing left to land: otherwise the frames
 * warmed and measured could be the world arriving, not the scene the tier
 * draws.
 */
export function liteProbeReady(meterReady: boolean, skyIn: boolean, renderer: Pick<Renderer, "waitingItems">): boolean {
  return meterReady || (skyIn && renderer.waitingItems() === 0);
}

/**
 * Measures `tier` in `container`, frame by frame through `createProbeMeter`:
 * ready, warm, measured, with a late shader compile starting the warm-up
 * again. Null on a cancel, an abort, a scene that never readies (by
 * `opts.readyBy`, at most `PROBE_READY_MAX_MS` after its build), a renderer
 * that could not be made, a device that fails under the step, a throw, or
 * too few frames. `signal` stops it at once, letting go of the renderer
 * before `abort()` returns, so the page can build its next renderer straight
 * after; the step's answer comes once the renderer's making has ended.
 */
export function runLiteProbeStep(
  container: HTMLElement,
  tier: QualityTier,
  opts: { cancelled(): boolean; signal?: AbortSignal; readyBy?: number; sky?: SkyTable; make?: ProbeRendererMaker; now?: () => number },
): Promise<ProbeReading | null> {
  return new Promise((resolve) => {
    if (opts.cancelled() || opts.signal?.aborted === true) {
      resolve(null);
      return;
    }
    const now = opts.now ?? (() => performance.now());
    const canvas = document.createElement("canvas");
    container.append(canvas);
    let probe: LiteProbeScene;
    try {
      probe = buildLiteProbeScene(canvas, tier, opts.sky, opts.make);
    } catch (error) {
      console.warn("quality probe: the scene could not be built.", error);
      canvas.remove();
      resolve(null);
      return;
    }
    const { renderer } = probe;
    // The step is not ready until the sky's first slices are in; the meter's bound counts from here regardless.
    let skyIn = false;
    void renderer.skyReady().then(() => {
      skyIn = true;
    });
    const began = now();
    const meter = createProbeMeter(began, opts.readyBy === undefined ? PROBE_READY_MAX_MS : Math.min(PROBE_READY_MAX_MS, opts.readyBy - began));
    const uncompiled = renderer.onShaderCompiled(() => meter.compiled(now()));
    let done = false;
    let unwatch = (): void => undefined;
    const finish = (reading: ProbeReading | null): void => {
      if (done) return;
      done = true;
      renderer.stopLoop(loop);
      uncompiled();
      opts.signal?.removeEventListener("abort", onAbort);
      // Before the dispose: a renderer let go is not a failing one.
      unwatch();
      probe.dispose();
      canvas.remove();
      // A renderer let go while it was still being made has its device until its making ends: the answer waits for
      // that, within a bound, so whoever is told the step is over makes the next renderer with none living beside it.
      const settled = renderer.whenMade;
      if (settled === undefined) {
        resolve(reading);
        return;
      }
      const answer = (): void => {
        clearTimeout(bound);
        resolve(reading);
      };
      const bound = setTimeout(answer, LET_GO_MAX_MS);
      void settled.then(answer, answer);
    };
    const onAbort = (): void => finish(null);
    const loop = (): void => {
      if (opts.cancelled()) {
        finish(null);
        return;
      }
      try {
        const at = now();
        probe.frame();
        const step = meter.frame(at, liteProbeReady(meter.ready, skyIn, renderer));
        if (!step.done) return;
        finish(step.stats === null ? null : { tier, ...step.stats, pixels: containerPixels(container), engine: "webgpu" });
      } catch (error) {
        console.warn("quality probe: a frame failed.", error);
        finish(null);
      }
    };
    opts.signal?.addEventListener("abort", onAbort);
    // A renderer that could not be made stays empty, and one whose device has failed draws no more: frames that draw
    // nothing are no measure of the tier.
    void renderer.whenMade?.then((stood) => {
      if (stood || done) return;
      console.warn("quality probe: the renderer could not be made.");
      finish(null);
    });
    unwatch =
      renderer.ownWatch?.(renderer.engine, (reason) => {
        console.warn(`quality probe: the renderer's device failed (${reason}).`);
        finish(null);
      }) ?? unwatch;
    renderer.runLoop(loop);
  });
}

/**
 * The page's `StartupDeps` for `container`, every step measured on the
 * hike's own renderer (`runLiteProbeStep`), on a canvas and an engine of the
 * step's own that go with it. The probe's sky is one source for its steps
 * (`pageProbe`). `startSky` and `make` are a test's.
 */
export function liteProbeDeps(container: HTMLElement, startSky?: (startDeg: number) => SkySource, make?: ProbeRendererMaker): PageProbe {
  return pageProbe(
    container,
    (tier, step) => runLiteProbeStep(container, tier, { cancelled: step.stopped, signal: step.signal, readyBy: step.readyBy, sky: step.sky, make }),
    startSky,
  );
}
