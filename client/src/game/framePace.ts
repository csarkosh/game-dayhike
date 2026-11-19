/**
 * Which display refreshes a phone's hike draws: at most sixty a second, at an
 * even pace.
 *
 * A phone's display runs faster than 60 Hz while a finger is on it (a Pixel
 * goes to 120 Hz at a touch and back to 60 Hz when it lifts), and the browser
 * then asks for a frame at every refresh. A phone cannot draw a hike in one
 * 120 Hz refresh (8.3 ms), so the frames it does draw fall one, two or three
 * refreshes apart: 8, 17 and 25 ms in turn, the walk moving on unevenly while
 * the player's thumb steers it. Drawing every second refresh keeps each frame
 * 16.7 ms from the last, as on a 60 Hz display, which draws every refresh
 * here.
 *
 * Pure: the renderer's loop (`lite/renderer.ts`) asks `due` with each
 * frame's time and skips the frame when it says no; tests drive it with
 * the times a display would give.
 */

/** The pace a phone's hike draws at: 60 frames a second. */
export const PHONE_FRAME_MS = 1000 / 60;

/**
 * How early (ms) a refresh may come and still be drawn: well under half of
 * the shortest refresh a phone has (8.3 ms at 120 Hz), so a refresh between
 * two due ones is never taken, and well over a display's jitter in the times
 * it gives, so a 60 Hz display draws every refresh.
 */
export const PACE_EARLY_MS = 2;

export type FramePace = {
  /** Whether the frame the display gives at `now` (ms) is drawn. */
  due(now: number): boolean;
};

/** A pace of `frameMs` between drawn frames; 0 draws every frame. */
export function createFramePace(frameMs: number): FramePace {
  let next: number | null = null;
  return {
    due(now) {
      if (frameMs <= 0) return true;
      if (next !== null && now < next - PACE_EARLY_MS) return false;
      // On time, the next is due a frame after this one was due, so the pace
      // keeps to the display's refreshes. A frame drawn more than a frame
      // late (the page was busy, the tab was hidden) starts the pace afresh
      // from now, so no run of frames is drawn to catch up.
      next = next === null || now - next > frameMs ? now + frameMs : next + frameMs;
      return true;
    },
  };
}
