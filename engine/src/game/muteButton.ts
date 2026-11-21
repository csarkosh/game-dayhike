/**
 * The page's one mute button: on every page, the title screen, the films
 * and the hike alike, so no sound ever plays without a way to stop it.
 * Pressed, nothing sounds: the hike's ambient master (`ambientAudio.ts`)
 * and the intro film's track (`introOverlay.ts`) both read it. The state is
 * the player's and lives in localStorage under `MUTE_KEY`, so a page opened
 * muted stays so.
 *
 * It sits at the top left corner on every page, the title screen included,
 * and over a hike the Pause button (the touch layer's, `touchControls.ts`,
 * or the HUD's for a keyboard, `hud.ts`) sits under it. On a page it draws
 * plain; over a hike it is as faint as the touch controls sit, and comes up
 * under the pointer, on keyboard focus, and whenever it is pressed, so a
 * muted hike always shows why it is silent. Built with DOM
 * calls, and placed on the body, outside the page's own container, which
 * the pages replace as they come and go.
 *
 * `M` presses it on every page (`isMuteKey`), as the media players and the
 * browser games do; for a keyboard the button carries the key beside the
 * speaker, as the HUD's Pause button and lamp hint carry theirs (`hud.ts`).
 */
import { aimedAtFormControl } from "./input.js";
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

/** The key that presses the mute, as its cap reads. */
export const MUTE_HOTKEY = "M";

/** A key press as the mute's key reads it (a `KeyboardEvent`). */
export type KeyPress = {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
};

/**
 * Whether a press is the mute's key: the M the layout types, or, where the
 * layout types a letter of another script, the key in M's place. Never with
 * Ctrl, Alt or Cmd held (the browser's and the system's own: Cmd-M hides the
 * window on a Mac), never a held key's repeat, and never a press aimed at a
 * form control, where an M is a letter typed.
 */
export function isMuteKey(e: KeyPress): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || aimedAtFormControl(e.target)) return false;
  const typed = e.key.length === 1 ? e.key.toLowerCase() : "";
  if (typed === "m") return true;
  return e.code === "KeyM" && /^\p{L}$/u.test(typed) && !/^[a-z]$/.test(typed);
}

/** The button's label, which is its accessible name: what pressing it does. */
export function muteLabel(muted: boolean): string {
  return muted ? "Sound on" : "Sound off";
}

const STYLE = `
  .mute {
    position: fixed; z-index: 60; pointer-events: auto; touch-action: manipulation;
    top: calc(14px + env(safe-area-inset-top, 0px)); left: calc(14px + env(safe-area-inset-left, 0px));
    display: flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; padding: 0;
    color: #fff; background: rgba(16, 16, 20, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 50%;
    backdrop-filter: blur(4px); -webkit-user-select: none; user-select: none; cursor: pointer;
    opacity: 0.85; transition: opacity 120ms ease-out, background 80ms ease-out;
  }
  .mute svg { width: 22px; height: 22px; display: block; }
  /* With its key, for a keyboard: the speaker and the key, drawn as the HUD's Pause button draws its own (hud.ts). */
  .mute.keyed { width: auto; gap: 8px; padding: 0 12px 0 10px; border-radius: 22px; font: 500 13px/1 system-ui, sans-serif; }
  .mute .key {
    display: inline-block; min-width: 1.4em; padding: 3px 5px; text-align: center;
    border: 1px solid rgba(255, 255, 255, 0.45); border-bottom-width: 2px; border-radius: 4px;
    font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: 0.04em;
  }
  /* Over a hike it sits as faint as the touch controls do, and comes up when wanted or when pressed;
     the Pause button sits under it (44px tall at 14px from the corner, in the touch layer and the HUD alike). */
  .mute.hike { opacity: 0.35; }
  .mute.on, .mute:hover, .mute:focus-visible { opacity: 1; }
  .mute.on { background: rgba(255, 255, 255, 0.18); }
  .mute:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 3px; }
`;

export type MuteButton = {
  muted(): boolean;
  /** The state set from outside (a key, a command): drawn, and told as a press is. */
  set(muted: boolean): void;
  /** Over a hike: faint, the Pause button under it; plain on a page. */
  setHike(on: boolean): void;
  dispose(): void;
};

/**
 * `showKey`: the button carries its key (`MUTE_HOTKEY`), for a keyboard; a
 * touch screen's button is the speaker alone. The key presses it either way.
 */
export function createMuteButton(host: HTMLElement, options: { muted: boolean; showKey: boolean; onChange(muted: boolean): void }): MuteButton {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mute";
  button.setAttribute("aria-keyshortcuts", MUTE_HOTKEY);
  button.classList.toggle("keyed", options.showKey);
  const key = document.createElement("span");
  key.className = "key";
  key.textContent = MUTE_HOTKEY;
  let muted = options.muted;
  const draw = (): void => {
    button.replaceChildren(lineIcon(muted ? "muted" : "sound"), ...(options.showKey ? [key] : []));
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
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isMuteKey(e)) set(!muted);
  };
  window.addEventListener("keydown", onKeyDown);
  draw();
  host.append(style, button);
  return {
    muted: () => muted,
    set,
    setHike(on) {
      button.classList.toggle("hike", on);
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      button.remove();
      style.remove();
    },
  };
}
