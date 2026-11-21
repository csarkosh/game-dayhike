import { TICK_DT } from "../sim/constants.js";

/** Never simulate more than this many ticks in one frame. */
const MAX_TICKS_PER_FRAME = 15;

export class FixedStepAccumulator {
  private accumulated = 0;

  /** Feeds in a frame duration and returns how many fixed ticks to run. */
  advance(frameSeconds: number): number {
    this.accumulated += Math.max(0, frameSeconds);
    let ticks = Math.floor(this.accumulated / TICK_DT);
    if (ticks > MAX_TICKS_PER_FRAME) {
      // A backgrounded tab can hand us a multi-second frame. Running every
      // owed tick would stall for longer than the frame we are trying to
      // catch up on, so drop the excess and accept the discontinuity.
      this.accumulated = 0;
      return MAX_TICKS_PER_FRAME;
    }
    if (ticks < 0) ticks = 0;
    this.accumulated -= ticks * TICK_DT;
    return ticks;
  }

  /** Fraction of the way into the next pending tick, for render interpolation. */
  get alpha(): number {
    return this.accumulated / TICK_DT;
  }
}
