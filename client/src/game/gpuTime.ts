/**
 * The measurement mode's readout (`?gpuTime`): Babylon's GPU timings read off
 * the engine, the main pass, every render target and the active camera's post
 * passes on each `read()`, and handed to `gpuTimeReport.ts` for the
 * arithmetic. `window.__gpuTime()` gives the whole report to a rig driving the
 * page; a line in the bottom left corner shows the frame and the main pass.
 *
 * The counters exist only because the engine's timing was on from its
 * creation (`gpuEngine.ts`): a render target made before that has none, and
 * the report names it in `missed`. Where there is no WebGPU or the browser
 * refused `timestamp-query`, the report says unsupported and counts nothing.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { gpuTimeLine, gpuTimeReport, type GpuTimeReport, type RawTarget } from "./gpuTimeReport.js";

/** Babylon's `PerfCounter`, as far as it is read here: nanoseconds, over the last second. */
type Counter = { lastSecAverage: number };
/** Babylon's `WebGPUPerfCounter`: the counter and the frame it last drew in (-1 never). */
type PassCounter = { counter: Counter; _gpuTimeInFrameId: number };
/** The WebGPU engine's timing, which `AbstractEngine` does not declare. */
type TimedEngine = {
  _timestampQuery?: { enable: boolean; gpuFrameTimeCounter: Counter };
  gpuTimeInFrameForMainPass?: PassCounter;
};
/** A render target wrapper: its counter exists only on WebGPU with the timing on. */
type TimedTarget = { gpuTimeInFrame?: PassCounter; width: number; height: number };

/** The corner line's refresh, at most twice a second. */
const LINE_REFRESH_MS = 500;

const STYLE = `
  .gputime {
    position: fixed; left: 0.5rem; bottom: 0.5rem; z-index: 60;
    font: 12px ui-monospace, monospace; color: #fff;
    background: rgba(16, 16, 20, 0.72); padding: 0.15rem 0.4rem; border-radius: 3px;
    pointer-events: none; white-space: pre;
  }
`;

function rawTarget(name: string, target: TimedTarget | null | undefined, width: number, height: number): RawTarget {
  const timed = target?.gpuTimeInFrame;
  return {
    name,
    ns: timed === undefined ? null : timed.counter.lastSecAverage,
    lastFrameId: timed === undefined ? null : timed._gpuTimeInFrameId,
    width,
    height,
  };
}

export function installGpuTimeReadout(
  scene: Scene,
  engine: AbstractEngine,
  container: HTMLElement | null,
  build: string,
): { read(): GpuTimeReport; dispose(): void } {
  const timed = engine as unknown as TimedEngine;
  const read = (): GpuTimeReport => {
    const query = timed._timestampQuery;
    const supported = engine.isWebGPU === true && query?.enable === true;
    const targets: RawTarget[] = [];
    if (supported) {
      for (const t of scene.textures) {
        if (!(t instanceof RenderTargetTexture)) continue;
        targets.push(rawTarget(t.name, t.renderTarget as TimedTarget | null, t.getRenderWidth(), t.getRenderHeight()));
      }
      for (const pp of scene.activeCamera?._postProcesses ?? []) {
        if (pp === null) continue;
        const input = pp.inputTexture as TimedTarget | null | undefined;
        targets.push(rawTarget(pp.name, input, input?.width ?? 0, input?.height ?? 0));
      }
    }
    return gpuTimeReport({
      supported,
      build,
      frameId: engine.frameId,
      renderWidth: engine.getRenderWidth(),
      renderHeight: engine.getRenderHeight(),
      frameNs: supported && query !== undefined ? query.gpuFrameTimeCounter.lastSecAverage : null,
      mainNs: supported ? (timed.gpuTimeInFrameForMainPass?.counter.lastSecAverage ?? null) : null,
      targets,
    });
  };
  const global = globalThis as { __gpuTime?: () => GpuTimeReport };
  global.__gpuTime = () => read();

  // The corner line, only on a page: a suite under Node has no document.
  let style: HTMLStyleElement | null = null;
  let line: HTMLDivElement | null = null;
  let observer: ReturnType<typeof scene.onAfterRenderObservable.add> | null = null;
  if (typeof document !== "undefined" && container instanceof Element) {
    style = document.createElement("style");
    style.textContent = STYLE;
    line = document.createElement("div");
    line.className = "gputime";
    container.append(style, line);
    let shownAt = -Infinity;
    const shown = line;
    observer = scene.onAfterRenderObservable.add(() => {
      const now = performance.now();
      if (now - shownAt < LINE_REFRESH_MS) return;
      shownAt = now;
      shown.textContent = gpuTimeLine(read());
    });
  }

  return {
    read,
    dispose() {
      if (observer !== null) scene.onAfterRenderObservable.remove(observer);
      style?.remove();
      line?.remove();
      if (global.__gpuTime !== undefined) delete global.__gpuTime;
    },
  };
}
