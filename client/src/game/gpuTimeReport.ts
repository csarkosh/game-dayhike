/**
 * The measurement mode's readout (`?gpuTime`), as arithmetic: the GPU's own
 * timings of the frame, of its main pass and of each render target and post
 * pass, in milliseconds, from the nanoseconds Babylon's timestamp queries
 * count (`gpuTime.ts` gathers them). Babylon-free, so it is tested with plain
 * objects.
 *
 * Each counter is Babylon's average over the last second. A target that drew
 * in neither the latest frame timed nor the one before (a lake's mirror drawn every third
 * frame, a shadow cascade refreshed now and then) still shows its last
 * second's time, marked `drewLastFrame: false`. A target with no counter at
 * all was made before the timing was turned on, so nothing of its time is
 * known: it is named in `missed`, never counted as nothing.
 */

export type GpuTarget = { name: string; ms: number | null; width: number; height: number; drewLastFrame: boolean };
export type GpuTimeReport = {
  supported: boolean; build: string; renderWidth: number; renderHeight: number;
  frameMs: number | null; mainMs: number | null; targets: GpuTarget[];
  /** Targets found with no counter: made before the timing was on. */
  missed: string[];
};
export type RawTarget = { name: string; ns: number | null; lastFrameId: number | null; width: number; height: number };
export type RawGpuTime = {
  supported: boolean; build: string;
  /** The latest frame whose timings have come back (the main pass's), which
   * is a few frames behind the engine's: a target drew in the last frame when
   * it drew in this one or the one before. */
  frameId: number;
  renderWidth: number; renderHeight: number; frameNs: number | null; mainNs: number | null; targets: RawTarget[];
};

/** Nanoseconds as milliseconds, to three decimals (a microsecond). */
function msOf(ns: number | null): number | null {
  return ns === null ? null : Math.round(ns / 1e3) / 1e3;
}

export function gpuTimeReport(raw: RawGpuTime): GpuTimeReport {
  const targets: GpuTarget[] = [];
  const missed: string[] = [];
  for (const t of raw.targets) {
    if (t.ns === null) {
      missed.push(t.name);
      continue;
    }
    targets.push({
      name: t.name,
      ms: msOf(t.ns),
      width: t.width,
      height: t.height,
      drewLastFrame: t.lastFrameId !== null && t.lastFrameId >= raw.frameId - 1,
    });
  }
  return {
    supported: raw.supported,
    build: raw.build,
    renderWidth: raw.renderWidth,
    renderHeight: raw.renderHeight,
    frameMs: msOf(raw.frameNs),
    mainMs: msOf(raw.mainNs),
    targets,
    missed,
  };
}

/** The corner's line: the frame and the main pass, or that there is no
 * timing here. A frame with no reading (Chrome's, `gpuTime.ts`) is `n/a`. */
export function gpuTimeLine(report: GpuTimeReport): string {
  if (!report.supported) return "gpu time: unsupported";
  const ms = (v: number | null): string => (v === null ? "n/a" : `${v.toFixed(3)} ms`);
  return `gpu ${ms(report.frameMs)} · main ${ms(report.mainMs)}`;
}
