/**
 * The measurement mode's readout (`?gpuTime`) from a frame the GPU timed task
 * by task, as arithmetic: the report `gpuTimeReport.ts` has, made from what
 * Babylon Lite's timers hand over. Lite times the whole frame with one pair
 * of timestamps round the frame's passes, read back a frame or two later
 * without waiting on the GPU, and each task of the frame (the rain's cover
 * map, a lake's panorama, the shades' mask, the scene, the post chain) by
 * its own passes.
 *
 * The frame's last task is the one that ends on the canvas: the scene's own
 * pass on a tier with no post chain, the chain's passes on a tier with one.
 * Its time is `mainMs`; the tasks
 * before it are the report's targets. A task's target size is not the
 * timer's to know: a target is given the size its name is known by
 * (`sizes`), else none. Where the device has no timestamp queries the
 * report says unsupported and counts nothing. Engine-free.
 */
import type { GpuTarget, GpuTimeReport } from "./gpuTimeReport.js";

/** One task of a timed frame: its place in the frame, its name and the GPU's milliseconds for it. */
export type TimedTask = { readonly index: number; readonly name: string; readonly durationMs: number };

/** A frame's tasks as timed, or none yet (`available` false: nothing has been read back, or the timing is off). */
export type TimedFrame = { readonly available: boolean; readonly tasks: readonly TimedTask[] };

/** Milliseconds to three decimals (a microsecond), as the report's others are. */
function ms(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}

export function taskTimeReport(input: {
  supported: boolean;
  build: string;
  renderWidth: number;
  renderHeight: number;
  /** The whole frame's milliseconds as last read back; 0 before the first reading. */
  frameMs: number;
  frame: TimedFrame | null;
  /** The sizes of the targets known by name. */
  sizes?: Readonly<Record<string, readonly [number, number]>>;
}): GpuTimeReport {
  const { supported, build, renderWidth, renderHeight } = input;
  if (!supported) return { supported: false, build, renderWidth, renderHeight, frameMs: null, mainMs: null, targets: [], missed: [] };
  const tasks = input.frame !== null && input.frame.available ? [...input.frame.tasks].sort((a, b) => a.index - b.index) : [];
  const main = tasks.length > 0 ? (tasks[tasks.length - 1] as TimedTask) : null;
  /** How many tasks carry each name: one drawn twice a frame is told apart by its place. */
  const named = new Map<string, number>();
  for (const task of tasks) named.set(task.name, (named.get(task.name) ?? 0) + 1);
  const targets: GpuTarget[] = tasks.slice(0, -1).map((task) => {
    const size = input.sizes?.[task.name];
    return {
      name: (named.get(task.name) ?? 0) > 1 ? `${task.name}#${task.index}` : task.name,
      ms: ms(task.durationMs),
      width: size?.[0] ?? 0,
      height: size?.[1] ?? 0,
      // The tasks listed are the ones the last frame read back ran.
      drewLastFrame: true,
    };
  });
  return {
    supported: true,
    build,
    renderWidth,
    renderHeight,
    frameMs: input.frameMs > 0 ? ms(input.frameMs) : null,
    mainMs: main === null ? null : ms(main.durationMs),
    targets,
    missed: [],
  };
}
