/**
 * The veil: a black sheet over the whole page that the route switches
 * behind (main.ts). The title and the game used to swap in one frame; now
 * the veil comes down over VEIL_COVER_MS, the page is swapped under it, and
 * it lifts over VEIL_LIFT_MS. It takes no input and is never in the way of
 * anything but the eye.
 */

/** Milliseconds the veil takes to come down, and to lift, between pages; and the quicker dip at the intro film's cut into first person. */
export const VEIL_COVER_MS = 600;
export const VEIL_LIFT_MS = 1600;
export const VEIL_CUT_COVER_MS = 350;
export const VEIL_CUT_LIFT_MS = 900;

const STYLE = `
  .veil {
    position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none;
    z-index: 100; transition: opacity ${VEIL_COVER_MS}ms ease-in;
  }
  .veil.down { opacity: 1; }
  .veil.lifting { transition: opacity ${VEIL_LIFT_MS}ms ease-out; }
`;

export type Veil = {
  /** Brings the veil down over `ms` (VEIL_COVER_MS by default); resolves once it is. A veil already down resolves at once. */
  cover(ms?: number): Promise<void>;
  /** Lifts the veil over `ms` (VEIL_LIFT_MS by default). */
  lift(ms?: number): void;
  /** Whether the veil is down (or coming down). */
  readonly down: boolean;
  dispose(): void;
};

export function createVeil(parent: HTMLElement, setTimer: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); }): Veil {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const sheet = document.createElement("div");
  sheet.className = "veil";
  parent.append(style, sheet);
  let down = false;
  return {
    get down() {
      return down;
    },
    cover(ms = VEIL_COVER_MS) {
      if (down) return Promise.resolve();
      down = true;
      sheet.classList.remove("lifting");
      sheet.style.transitionDuration = `${ms}ms`;
      sheet.classList.add("down");
      return new Promise((resolve) => setTimer(resolve, ms));
    },
    lift(ms = VEIL_LIFT_MS) {
      if (!down) return;
      down = false;
      sheet.classList.add("lifting");
      sheet.style.transitionDuration = `${ms}ms`;
      sheet.classList.remove("down");
    },
    dispose() {
      sheet.remove();
      style.remove();
    },
  };
}
