/**
 * The page's half of the startup probe: everything `StartupDeps` asks of the
 * page but the measuring of a step, with no engine.
 *
 * The steps of one probe read one sky, started at its first step at the
 * probe's hour and stopped when the probe ends (`endProbe`) or the page
 * moves on (`abort`), so no step makes the slices again. Before a step's
 * scene is built, which stops the page, the probe's screen is given a paint.
 * `abort()` stops a probe at once: the abort reaches the step first, which
 * lets go of its renderer before `abort()` returns, so the render that
 * replaces the probe builds its own with none living beside it.
 *
 * How a step is measured is its caller's (`StepMeasure`): the hike's own
 * renderer measures on the engine it makes for itself from the step's
 * canvas (`lite/probeScene.ts`).
 */
import { PROBE_HOUR, probeReadingLine, type StartupDeps } from "./frameProbe.js";
import { afterNextPaint } from "@csarkosh/engine/game/paint";
import { showProbeScreen, timeIdleCadence } from "./probeScreen.js";
import { containerPixels, type ProbeReading, type QualityTier } from "@csarkosh/engine/game/quality";
import type { SkyTable } from "@csarkosh/engine/game/skyTable";
import { sunAltitudeDeg } from "@csarkosh/engine/game/skyWait";
import { startSkySource, type SkySource } from "@csarkosh/engine/game/skyWorker";
import { pageStorage } from "@csarkosh/engine/game/tierChoice";

/** The page's `StartupDeps` for a container, with `abort()` to stop a probe at
 * once when the page moves on (the render that replaces it calls it first). */
export type PageProbe = StartupDeps & { abort(): void };

/**
 * One measurement of `tier`: null on a stop, a scene that is not ready by
 * `readyBy` (a `performance.now()` time), a failure, or too few frames.
 * `stopped` says the page has moved on or the probe's time is up, `signal`
 * stops the step at once, and `sky` is the probe's sky.
 */
export type StepMeasure = (tier: QualityTier, step: { stopped(): boolean; signal: AbortSignal; readyBy: number; sky: SkyTable }) => Promise<ProbeReading | null>;

/**
 * The page's `StartupDeps` for `container`, each step measured by `measure`.
 * The probe's sky is one source (`startSky`, at the probe's hour) started at
 * its first step, read by every step after, and stopped when the probe ends
 * (`endProbe`) or the page moves on (`abort`).
 */
export function pageProbe(container: HTMLElement, measure: StepMeasure, startSky: (startDeg: number) => SkySource = startSkySource): PageProbe {
  const aborts = new AbortController();
  /** The probe's sky, from its first step until it ends. */
  let sky: SkySource | null = null;
  const endSky = (): void => {
    sky?.dispose();
    sky = null;
  };
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
      sky ??= startSky(sunAltitudeDeg(PROBE_HOUR));
      const reading = await measure(tier, { stopped, signal: aborts.signal, readyBy, sky: sky.table });
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
    endProbe: endSky,
    abort: () => {
      // The step's renderer goes first, as the abort reaches it.
      aborts.abort();
      endSky();
    },
  };
}
