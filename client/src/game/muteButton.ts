/**
 * The page's one mute button: on every page, the title screen, the films
 * and the hike alike, so no sound ever plays without a way to stop it.
 * Pressed, nothing sounds: the hike's ambient master (`ambientAudio.ts`)
 * and the intro film's track (`introOverlay.ts`) both read it. The state is
 * the player's and lives in localStorage under `MUTE_KEY`, so a page opened
 * muted stays so.
 *
 * On a page it draws plain, at the top right corner. Over a hike it sits at
 * the top left, under the Pause button (the touch layer's, `touchControls.ts`,
 * or the HUD's for a keyboard, `hud.ts`), as faint as the touch controls
 * sit, and comes up under the pointer, on keyboard focus, and whenever it is
 * pressed, so a muted hike always shows why it is silent. Built with DOM
 * calls, and placed on the body, outside the page's own container, which
 * the pages replace as they come and go.
 */
import { lineIcon } from "./icons.js";

export const MUTE_KEY = "dayhike.muted";

/** The stored mute: false where nothing is stored or the storage refuses. */
export function readMuted(storage: Storage | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Keeps the mute; false where there is no storage or it refuses. */
export function writeMuted(storage: Storage | null, muted: boolean): boolean {
  if (storage === null) return false;
  try {
    if (muted) storage.setItem(MUTE_KEY, "1");
    else storage.removeItem(MUTE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** The button's label, which is its accessible name: what pressing it does. */
export function muteLabel(muted: boolean): string {
  return muted ? "Sound on" : "Sound off";
}

const STYLE = `
  .mute {
    position: fixed; z-index: 60; pointer-events: auto; touch-action: manipulation;
    top: calc(14px + env(safe-area-inset-top, 0px)); right: calc(14px + env(safe-area-inset-right, 0px));
    display: flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; padding: 0;
    color: #fff; background: rgba(16, 16, 20, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 50%;
    backdrop-filter: blur(4px); -webkit-user-select: none; user-select: none; cursor: pointer;
    opacity: 0.85; transition: opacity 120ms ease-out, background 80ms ease-out;
  }
  .mute svg { width: 22px; height: 22px; display: block; }
  /* Over a hike it sits as faint as the touch controls do, and comes up when wanted or when pressed,
     at the top left under the Pause button (44px tall at 14px from the corner, in the touch layer and the HUD alike). */
  .mute.hike { opacity: 0.35; right: auto; left: calc(14px + env(safe-area-inset-left, 0px)); top: calc(68px + env(safe-area-inset-top, 0px)); }
  .mute.on, .mute:hover, .mute:focus-visible { opacity: 1; }
  .mute.on { background: rgba(255, 255, 255, 0.18); }
  .mute:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 3px; }
`;

export type MuteButton = {
  muted(): boolean;
  /** The state set from outside (a key, a command): drawn, and told as a press is. */
  set(muted: boolean): void;
  /** Over a hike: faint, at the top left under the Pause button; plain at the top right on a page. */
  setHike(on: boolean): void;
  dispose(): void;
};

export function createMuteButton(host: HTMLElement, options: { muted: boolean; onChange(muted: boolean): void }): MuteButton {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mute";
  let muted = options.muted;
  const draw = (): void => {
    button.replaceChildren(lineIcon(muted ? "muted" : "sound"));
    button.setAttribute("aria-label", muteLabel(muted));
    button.setAttribute("aria-pressed", muted ? "true" : "false");
    button.classList.toggle("on", muted);
  };
  const set = (on: boolean): void => {
    if (on === muted) return;
    muted = on;
    draw();
    options.onChange(muted);
  };
  button.addEventListener("click", () => set(!muted));
  draw();
  host.append(style, button);
  return {
    muted: () => muted,
    set,
    setHike(on) {
      button.classList.toggle("hike", on);
    },
    dispose() {
      button.remove();
      style.remove();
    },
  };
}
