/**
 * The measurement mode's readout (`?gpuTime`): Babylon's GPU timings read off
 * the engine, the main pass, every render target and the active camera's post
 * passes on each `read()`, and handed to `gpuTimeReport.ts` for the
 * arithmetic. `window.__gpuTime()` gives the whole report to a rig driving the
 * page; a line in the bottom right corner shows the frame and the main pass.
 *
 * A post process's counter is its input's, so it times the pass that drew
 * INTO that input: each post-chain entry is named after that pass, the post
 * process before it, or `scene-render` for the first one's input. The last
 * post process draws to the canvas, the main pass: its time is `mainMs`.
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
  _timestampQuery?: { enable: boolean; gpuFrameTimeCounter: Counter & { total: number } };
  gpuTimeInFrameForMainPass?: PassCounter;
};
/** A post process as read here: Babylon's `inputTexture` getter ignores a
 * target handed to it (the prepass's, for the chain's first pass), which it
 * keeps in `_forcedOutputTexture`. */
type ChainPass = { name: string; inputTexture?: TimedTarget | null; _forcedOutputTexture?: TimedTarget | null };
/** A render target wrapper: its counter exists only on WebGPU with the timing on. */
type TimedTarget = { gpuTimeInFrame?: PassCounter; width: number; height: number };

/** The corner line's refresh, at most twice a second. */
const LINE_REFRESH_MS = 500;

const STYLE = `
  .gputime {
    position: fixed; right: 8px; bottom: 8px; z-index: 60;
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
      /** The counters already listed, so a target the chain shares with a texture is listed once. */
      const listed = new Set<PassCounter>();
      for (const t of scene.textures) {
        if (!(t instanceof RenderTargetTexture)) continue;
        const target = t.renderTarget as TimedTarget | null;
        if (target?.gpuTimeInFrame !== undefined) listed.add(target.gpuTimeInFrame);
        targets.push(rawTarget(t.name, target, t.getRenderWidth(), t.getRenderHeight()));
      }
      // Each post process's input, named after the pass that drew into it.
      let drewInto = "scene-render";
      for (const entry of scene.activeCamera?._postProcesses ?? []) {
        if (entry === null) continue;
        const pp = entry as unknown as ChainPass;
        const input = pp._forcedOutputTexture ?? pp.inputTexture;
        const counter = input?.gpuTimeInFrame;
        // The prepass's target: the scene's render into it is listed already.
        if (counter === undefined || !listed.has(counter)) {
          targets.push(rawTarget(drewInto, input, input?.width ?? 0, input?.height ?? 0));
          if (counter !== undefined) listed.add(counter);
        }
        drewInto = pp.name;
      }
    }
    const main = timed.gpuTimeInFrameForMainPass;
    // Chrome has no `GPUCommandEncoder.writeTimestamp`, which Babylon times
    // the whole frame with, so Babylon records 0 every frame: no reading, not
    // a free frame. A Babylon that times the frame by its passes' timestamps
    // would fill it again.
    const frameCounter = query?.gpuFrameTimeCounter;
    return gpuTimeReport({
      supported,
      build,
      // The queries come back a few frames late: the latest frame whose
      // timings have, which is what "drew in the last frame" is judged by.
      frameId: main !== undefined ? main._gpuTimeInFrameId : engine.frameId,
      renderWidth: engine.getRenderWidth(),
      renderHeight: engine.getRenderHeight(),
      frameNs: supported && frameCounter !== undefined && frameCounter.total > 0 ? frameCounter.lastSecAverage : null,
      mainNs: supported ? (main?.counter.lastSecAverage ?? null) : null,
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
