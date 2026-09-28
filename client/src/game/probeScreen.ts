/**
 * The screen over the startup probe: the landing's dark ground and one line,
 * opaque, so the probe's canvas renders beneath it unseen. Built with DOM calls
 * and `textContent` only. And the page's idle frame rate, timed while nothing
 * is drawn under it.
 */
import { PROBE_IDLE_FRAMES, idleCadenceMs } from "./frameProbe.js";

/** The one line the screen shows. */
export const PROBE_SCREEN_LINE = "Setting up graphics…";

const STYLE = `
  .probe-screen {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: #101014; color: #fff;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.06em;
  }
`;

/** The screen's layer over a hike in play: above the interact prompt (12),
 * the touch layer (15) and the roster (20), and so above the pause screen
 * (18), which the governor never acts under. */
export const OVER_PLAY_Z = 21;

/** Covers `container` with the screen until `dispose`, at `layer`: by
 * default just above the probe's canvas, a plain block in the container. */
export function showProbeScreen(container: HTMLElement, layer = 1): { dispose(): void } {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "probe-screen";
  root.style.zIndex = String(layer);
  root.setAttribute("role", "status");
  root.textContent = PROBE_SCREEN_LINE;
  container.append(style, root);
  return {
    dispose() {
      style.remove();
      root.remove();
    },
  };
}

/**
 * The page's idle frame interval: `PROBE_IDLE_FRAMES` intervals between
 * `requestAnimationFrame` callbacks, taken while nothing is being drawn, and
 * their median by `idleCadenceMs` (the first interval and stalls dropped).
 * Null when `signal` stops it first, or when too few intervals are left.
 */
export function timeIdleCadence(signal: AbortSignal): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const intervals: number[] = [];
    let last = -1;
    let id = 0;
    const onAbort = (): void => {
      cancelAnimationFrame(id);
      resolve(null);
    };
    const tick = (now: number): void => {
      if (last >= 0) intervals.push(now - last);
      last = now;
      if (intervals.length > PROBE_IDLE_FRAMES) {
        signal.removeEventListener("abort", onAbort);
        resolve(idleCadenceMs(intervals));
        return;
      }
      id = requestAnimationFrame(tick);
    };
    if (signal.aborted) {
      resolve(null);
      return;
    }
    signal.addEventListener("abort", onAbort);
    id = requestAnimationFrame(tick);
  });
}
