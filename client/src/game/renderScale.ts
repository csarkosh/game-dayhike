/**
 * The render scale under the paint (2026-10-18): the scene drawn at the
 * window's pixels while the frame rate holds, and a step down at a time,
 * to 87 % and then to 75 % of them on each axis, while it does not, back up
 * a step at a time once it has room again.
 *
 * The paint pass flattens detail under its stroke, about 3 px, so a frame
 * drawn at 87 % and upscaled reads as the full one under it, and one at 75 %
 * only a little softer (the design doc's panels); at a laptop's window on an
 * Apple M4 the first step bought 4 frames a second in the forest and the
 * second about 9. It is held to when the frames are slow, so an open view
 * keeps every pixel.
 *
 * The rule, over windows of `RENDER_SCALE_WINDOW_S` of play:
 * - a window whose mean frame is slower than `RENDER_SCALE_SLOW_HZ` counts
 *   toward a drop; `RENDER_SCALE_DROP_WINDOWS` in a row and the scale drops
 *   a step, if there is one below;
 * - below full scale, a window faster than `RENDER_SCALE_FAST_HZ` counts
 *   toward a rise; `RENDER_SCALE_RISE_WINDOWS` in a row and it rises a step;
 * - any other window breaks the run, and a frame longer than
 *   `RENDER_SCALE_STALL_S` (a load, a hidden tab, a pause) voids its window.
 * The two rates are apart, so the scale does not swing between them: a view
 * that draws at 50 at full scale stays there, and one drawn at 45 at full and
 * 52 reduced stays reduced. A change resizes every target of the chain, a
 * hitch of its own, so the windows after it begin afresh.
 *
 * Pure: the page feeds it frame seconds and reads `scale`.
 */

/** The scales, full first, each a share of the window's pixels on each axis. */
export const RENDER_SCALE_STEPS: readonly number[] = [1, 0.87, 0.75];
/** The first reduced scale (the second of the steps). */
export const RENDER_SCALE_REDUCED = 0.87;
/** Frames a second under which a window counts toward a drop. */
export const RENDER_SCALE_SLOW_HZ = 48;
/** Frames a second over which a window, below full scale, counts toward a rise. */
export const RENDER_SCALE_FAST_HZ = 57;
/** A window's seconds of play. */
export const RENDER_SCALE_WINDOW_S = 2;
/** Slow windows in a row that drop the scale a step. */
export const RENDER_SCALE_DROP_WINDOWS = 2;
/** Fast windows in a row that raise it a step. */
export const RENDER_SCALE_RISE_WINDOWS = 3;
/** A frame longer than this is not play: its window does not count. */
export const RENDER_SCALE_STALL_S = 0.25;

export type RenderScale = {
  /** The scale now: one of `RENDER_SCALE_STEPS`. */
  readonly scale: number;
  /** Feeds one frame's seconds; true when the scale changed with it. */
  frame(seconds: number): boolean;
  /** Back to full and the windows afresh: a new hike, a tier change. */
  reset(): void;
};

export function createRenderScale(steps: readonly number[] = RENDER_SCALE_STEPS): RenderScale {
  let step = 0;
  let elapsed = 0;
  let frames = 0;
  let void_ = false;
  let slowRun = 0;
  let fastRun = 0;
  const startWindow = (): void => {
    elapsed = 0;
    frames = 0;
    void_ = false;
  };
  const move = (to: number): true => {
    step = to;
    slowRun = 0;
    fastRun = 0;
    return true;
  };
  return {
    get scale() {
      return steps[step] as number;
    },
    frame(seconds) {
      if (!(seconds > 0)) return false;
      if (seconds > RENDER_SCALE_STALL_S) void_ = true;
      elapsed += seconds;
      frames++;
      if (elapsed < RENDER_SCALE_WINDOW_S) return false;
      const hz = frames / elapsed;
      const counted = !void_;
      startWindow();
      if (!counted) {
        slowRun = 0;
        fastRun = 0;
        return false;
      }
      slowRun = hz < RENDER_SCALE_SLOW_HZ ? slowRun + 1 : 0;
      fastRun = step > 0 && hz > RENDER_SCALE_FAST_HZ ? fastRun + 1 : 0;
      if (slowRun >= RENDER_SCALE_DROP_WINDOWS && step < steps.length - 1) return move(step + 1);
      if (fastRun >= RENDER_SCALE_RISE_WINDOWS) return move(step - 1);
      return false;
    },
    reset() {
      step = 0;
      slowRun = 0;
      fastRun = 0;
      startWindow();
    },
  };
}
