/**
 * A clip's time, for a renderer with no animation system of its own: every skinned body, a
 * hiker's or an animal's, plays its clip from a clock stepped a frame. No engine.
 */

/** A clip's time as a renderer with no animation system of its own counts it. */
export type ClipClock = { clip: string; seconds: number; rate: number };

/**
 * A frame of `clock`: a clip newly asked for starts at its beginning, and the
 * one playing runs on by `dt` at its rate. `rate` null leaves the rate as it
 * was (a pose that names a clip and no pace).
 */
export function stepClip(clock: ClipClock, clip: string, rate: number | null, dt: number): void {
  if (rate !== null) clock.rate = rate;
  if (clock.clip !== clip) {
    clock.clip = clip;
    clock.seconds = 0;
  }
  clock.seconds += dt * clock.rate;
}
