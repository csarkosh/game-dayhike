/**
 * The intro film's head start. A film element made at Play begins its download at Play, and on a
 * first visit the film stands on its first frame until its first seconds are in: 0.2 to 2.1 s on a
 * phone (2026-11-11). So the title page makes the element early, off the page, with the film's
 * file and `preload="auto"`: the browser has the film's head buffered and its decoder ready, and
 * Play hands that element to the intro (`introOverlay.ts`) instead of making one.
 *
 * One element a page load. It is handed over once; a later hike in the same session makes its own,
 * and by then the file is in the browser's cache. How far ahead a preloading element buffers is
 * the browser's to decide.
 */
import { slowConnection } from "./titleLoopModel.js";

export type FilmHead = {
  /** Makes the element and starts its load; only the first call does anything. */
  warm(src: string): void;
  /** The element, once, when it was warmed for `src` and has not failed; else null. */
  take(src: string): HTMLVideoElement | null;
  /** Ends the download and lets the element go. */
  drop(): void;
};

/** Whether to fetch a film's head before Play: there is a film, and the connection is one the title loop would use. */
export function filmHeadWanted(env: { saveData: boolean; effectiveType: string | null }, src: string | null): boolean {
  return src !== null && !slowConnection(env);
}

export function createFilmHead(deps: { video(): HTMLVideoElement }): FilmHead {
  let warmed = false;
  let kept: HTMLVideoElement | null = null;
  const drop = (): void => {
    if (kept === null) return;
    // No source and a load: the download in flight ends.
    kept.removeAttribute("src");
    kept.load();
    kept = null;
  };
  return {
    warm(src) {
      if (warmed) return;
      warmed = true;
      const video = deps.video();
      video.setAttribute("src", src);
      video.setAttribute("playsinline", "");
      video.setAttribute("preload", "auto");
      // Silent until the intro says otherwise: its sound waits for a gesture of the page's own.
      video.muted = true;
      kept = video;
    },
    take(src) {
      const video = kept;
      if (video === null || video.getAttribute("src") !== src) return null;
      if (video.error != null) {
        drop();
        return null;
      }
      kept = null;
      return video;
    },
    drop,
  };
}
