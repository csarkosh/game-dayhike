/**
 * Which display refreshes a phone's hike draws: at most sixty a second, at an
 * even pace, whatever rate the display runs at.
 *
 * A phone's display runs faster than 60 Hz while a finger is on it (a Pixel
 * goes to 120 Hz at a touch and back to 60 Hz when it lifts), and the browser
 * then asks for a frame at every refresh. A phone cannot draw a hike in one
 * 120 Hz refresh (8.3 ms), so the frames it does draw fall one, two or three
 * refreshes apart: 8, 17 and 25 ms in turn, the walk moving on unevenly while
 * the player's thumb steers it.
 *
 * The pace reads the display's rate from the frames the browser asks for and
 * draws every Nth refresh, N the fewest that come to a sixtieth of a second:
 * every refresh at 60 Hz, every second at 90 Hz (45 a second) and at 120 Hz
 * (60), every third at 144 Hz (48), every fourth at 240 Hz (60). A whole
 * number of refreshes, never a mix of two and three: frames an equal time
 * apart read as smooth at 45 a second where frames 11 and 22 ms apart in
 * turn do not at 60.
 *
 * Pure: the renderer's loop (`lite/renderer.ts`) asks `due` with every
 * frame's time, drawn or not, and skips the frame when it says no; tests
 * drive it with the times a display would give.
 */

/** The shortest time (ms) between a phone's drawn frames: 60 frames a second. */
export const PHONE_FRAME_MS = 1000 / 60;

/**
 * How many of the last gaps between the browser's frames the display's
 * refresh is read from: the shortest of them. Few, so a display that slows
 * (a finger lifted: 120 Hz to 60 Hz) is followed within a seventh of a
 * second; more than one, because a busy page is not asked at every refresh
 * and a lone gap may be two refreshes.
 */
export const PACE_GAPS = 8;

/**
 * A gap (ms) longer than this says nothing of the display's rate (a stall, a
 * hidden tab), and is left out; no phone's display refreshes slower than
 * 24 Hz.
 */
export const PACE_GAP_MAX_MS = 45;

/**
 * How early a refresh may come and still be the one drawn, as a share of a
 * refresh: enough for the jitter in the times a display gives, and far from
 * the refresh before, which is a whole one earlier.
 */
export const PACE_EARLY = 0.25;

/**
 * How far short of a sixtieth of a second N refreshes may fall, in refreshes:
 * three tenths. It keeps a refresh read a little short (the times a display
 * gives jitter by a fiftieth of a refresh on a Pixel 9) from costing a
 * refresh more, lets a 72 or 75 Hz display draw every refresh, and puts the
 * change from N to N + 1 (78, 138, 198 Hz) at no rate a display runs at.
 */
export const PACE_SHORT = 0.3;

export type FramePace = {
  /** Whether the frame the display gives at `now` (ms) is drawn. Asked for every frame, in order. */
  due(now: number): boolean;
};

/**
 * A pace of at least `frameMs` between drawn frames, a whole number of the
 * display's refreshes; 0 draws every frame.
 */
export function createFramePace(frameMs: number): FramePace {
  const gaps: number[] = [];
  let seen: number | null = null;
  let next: number | null = null;
  const refresh = (): number | null => (gaps.length === 0 ? null : Math.min(...gaps));
  return {
    due(now) {
      if (frameMs <= 0) return true;
      if (seen !== null) {
        const gap = now - seen;
        if (gap > 0 && gap <= PACE_GAP_MAX_MS) {
          gaps.push(gap);
          if (gaps.length > PACE_GAPS) gaps.shift();
        }
      }
      seen = now;
      // The display's refresh; before it is known, the pace itself, which holds a display of any rate to it.
      const every = refresh() ?? frameMs;
      const early = every * PACE_EARLY;
      if (next !== null && now < next - early) return false;
      // The fewest refreshes that come to a frame. Counted from the frame drawn, not from when it was due, so a
      // late frame (a busy page) is followed a full pace later and nothing is drawn to catch up.
      const count = Math.max(1, Math.ceil(frameMs / every - PACE_SHORT));
      next = now + count * every;
      return true;
    },
  };
}
