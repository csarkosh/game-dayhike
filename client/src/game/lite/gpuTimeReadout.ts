/**
 * The measurement mode's readout (`?gpuTime`) on Babylon Lite: the GPU's own
 * time for the frame and for each of its tasks, read on each `read()` and
 * handed to `gpuTimeTasks.ts` for the arithmetic. `window.__gpuTime()` gives
 * the whole report to a rig driving the page, and a line in the bottom right
 * corner shows the frame and the task that ends on the canvas.
 *
 * The timers are Lite's. The frame's is one pair of timestamps written round
 * the frame's passes into one query set, resolved by a small submit of its
 * own and read back a frame or two later without the page waiting on it; the
 * tasks' are timestamps on each task's own passes. Both are switched on only
 * here, so a hike outside the measurement mode records no timestamp, makes
 * no query set and submits nothing more. Lite asks every device for
 * `timestamp-query` where the adapter has it; where it has not, the report
 * says unsupported and counts nothing.
 */
import {
  getRenderTaskGpuTimings, isGpuTimingSupported, setGpuTimingEnabled, setRenderTaskGpuTimingEnabled,
  type EngineContext,
} from "@babylonjs/lite";
import { gpuTimeLine, type GpuTimeReport } from "../gpuTimeReport.js";
import { taskTimeReport } from "../gpuTimeTasks.js";

/** The corner line's refresh, at most twice a second. */
const LINE_REFRESH_MS = 500;

/** The corner line. */
const STYLE = `
  .gputime {
    position: fixed; right: 8px; bottom: 8px; z-index: 60;
    font: 12px ui-monospace, monospace; color: #fff;
    background: rgba(16, 16, 20, 0.72); padding: 0.15rem 0.4rem; border-radius: 3px;
    pointer-events: none; white-space: pre;
  }
`;

export type LiteGpuTime = {
  /** The report now: unsupported until the engine stands. */
  read(): GpuTimeReport;
  /** The engine stands: its timers are switched on where its device has them, and the corner line is put up. */
  attach(engine: EngineContext): void;
  /** The end of a frame drawn: the corner line is written again when it is due. */
  frameEnd(): void;
  dispose(): void;
};

/**
 * The readout for a renderer on `canvas`, in the build named `build`.
 * `sizes` gives the sizes of the frame's targets known by their tasks'
 * names, read at each report.
 */
export function createLiteGpuTime(canvas: HTMLCanvasElement, build: string, sizes: () => Readonly<Record<string, readonly [number, number]>> = () => ({})): LiteGpuTime {
  let engine: EngineContext | null = null;
  let supported = false;
  const read = (): GpuTimeReport => {
    const timings = engine !== null && supported ? getRenderTaskGpuTimings(engine) : null;
    return taskTimeReport({
      supported,
      build,
      renderWidth: canvas.width,
      renderHeight: canvas.height,
      frameMs: engine !== null && supported ? engine.gpuFrameTimeMs : 0,
      frame: timings === null ? null : { available: timings.status === "available", tasks: timings.tasks },
      sizes: sizes(),
    });
  };
  const global = globalThis as { __gpuTime?: () => GpuTimeReport };
  global.__gpuTime = read;

  let style: HTMLStyleElement | null = null;
  let line: HTMLDivElement | null = null;
  let shownAt = -Infinity;
  return {
    read,
    attach(made) {
      engine = made;
      supported = isGpuTimingSupported(made);
      if (supported) {
        setGpuTimingEnabled(made, true);
        // The tasks' timer is fetched on its first use: a fetch that fails leaves the frame's time alone.
        void setRenderTaskGpuTimingEnabled(made, true).catch(() => undefined);
      }
      // The corner line, only on a page: a suite under Node has no document.
      if (typeof document === "undefined" || line !== null) return;
      const container = canvas.parentElement ?? document.body;
      if (!(container instanceof Element)) return;
      style = document.createElement("style");
      style.textContent = STYLE;
      line = document.createElement("div");
      line.className = "gputime";
      container.append(style, line);
    },
    frameEnd() {
      if (line === null) return;
      const now = performance.now();
      if (now - shownAt < LINE_REFRESH_MS) return;
      shownAt = now;
      line.textContent = gpuTimeLine(read());
    },
    dispose() {
      style?.remove();
      line?.remove();
      style = line = null;
      engine = null;
      supported = false;
      if (global.__gpuTime === read) delete global.__gpuTime;
    },
  };
}
