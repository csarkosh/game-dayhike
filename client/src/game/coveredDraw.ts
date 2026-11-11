/**
 * The hike's draws while the intro's film covers it.
 *
 * A start with an intro builds its world under the film and draws it there,
 * unseen, so its shaders, its pipelines and its buffers are made before the
 * cut. Drawn every frame, that hidden world took the graphics chip from the
 * film: on a phone (WebGL2) the film's picture stood 8.5 s of its first 53
 * and jumped 1.8 s more, its longest pause 6.1 s; drawn four times a second,
 * 1.7 s and none, the longest 0.5 s (2026-11-11, the owner's phone, each a
 * first visit). So while a film covers the hike it is drawn every
 * `COVERED_DRAW_MS`, which is still each new thing's first draw a quarter
 * second after it arrives, and every frame again from the cut.
 *
 * Only the film's cover: the quality probe's screen covers play too, and
 * times the frames it covers.
 */
export const COVERED_DRAW_MS = 250;

export type CoveredDraw = {
  /** A film covers the hike from now until the function returned is called (once; again does nothing). */
  cover(): () => void;
  /** Whether the frame at `now` (ms, the page's clock) draws: every one with no film over the hike, else one every `COVERED_DRAW_MS`. */
  due(now: number): boolean;
};

export function createCoveredDraw(): CoveredDraw {
  let covers = 0;
  let drawn = -Infinity;
  return {
    cover() {
      covers++;
      let lifted = false;
      return () => {
        if (lifted) return;
        lifted = true;
        covers--;
      };
    },
    due(now) {
      if (covers === 0) return true;
      if (now - drawn < COVERED_DRAW_MS) return false;
      drawn = now;
      return true;
    },
  };
}
