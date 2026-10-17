import { endLines } from "./passages.js";
import { lineIcon } from "./icons.js";
const STYLE = `
  .hud { position: absolute; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; color: #fff; }
  .hud .status {
    position: absolute; left: 50%; top: 55%; transform: translateX(-50%);
    font-size: 1.1rem; text-shadow: 0 1px 4px #000; text-align: center;
  }
  .hud .end {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 100%;
    display: none; flex-direction: column; align-items: center; gap: 0.9rem; text-align: center;
    font-family: ui-monospace, monospace; color: #fff;
  }
  .hud .end.on { display: flex; }
  /* The title screen's text, to the letter (landing.ts): its heading, and its
     turn in the sentence, the cold tint, the letters drawn apart, the pale
     bloom and the slow breathing. The quote is two lines, the turn alone on
     the second, as the title's tagline turns. */
  .hud .end-title { margin: 0; font-size: 2rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
  .hud .end-line { margin: 0; max-width: 32rem; padding: 0 1rem; text-wrap: balance; color: rgba(255, 255, 255, 0.62); }
  .hud .end-line .dread {
    display: block; color: #dbe2e2; font-weight: 500; letter-spacing: 0.05em; font-style: oblique 4deg;
    text-shadow: 0 0 14px rgba(198, 222, 222, 0.55), 0 2px 8px rgba(0, 0, 0, 0.85);
    animation: hud-dread-breathe 7s ease-in-out infinite;
  }
  @keyframes hud-dread-breathe {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hud .end-line .dread { animation: none; }
  }
  /* A scene's letterbox: the film's frame (2.39:1) on the game's, the bars black; the voice's line sits in the lower bar. */
  .hud .bars::before, .hud .bars::after { content: ""; position: absolute; left: 0; right: 0; height: 12.5vh; background: #000; opacity: 0; transition: opacity 400ms ease-out; }
  .hud .bars::before { top: 0; }
  .hud .bars::after { bottom: 0; }
  .hud .bars.on::before, .hud .bars.on::after { opacity: 1; }
  /* The roster (roster.ts) leaves the frame while the bars are up. */
  body.scene .roster { opacity: 0; transition: opacity 400ms ease-out; }
  /* The inner voice: where the film's captions sat, in their type (introOverlay.ts). */
  .hud .voice {
    position: absolute; left: 50%; bottom: 11vh; transform: translateX(-50%); max-width: 44ch; padding: 0 1rem;
    text-align: center; white-space: pre-line; color: #eee; font: 500 clamp(16px, 2.4vh, 26px)/1.35 system-ui, sans-serif;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 12px rgba(0, 0, 0, 0.6);
    opacity: 0; transition: opacity 350ms ease-out;
  }
  .hud .voice.on { opacity: 1; }
  .hud .fade {
    position: absolute; inset: 0; background: #000; opacity: 0;
    transition: opacity 1.5s ease-in;
  }
  .hud .fade.on { opacity: 1; }
  /* The headlamp's hint, for a keyboard: the torch and its key, at the bottom
     left corner (the roster sits at the right), as faint as the touch controls
     sit (touchControls.ts) and lit with the lamp, so every player knows the
     lamp is there and what turns it on. Hidden by default: the touch layer has
     its own button. A scene's bars take it down. */
  .hud .lamp {
    position: absolute; left: calc(14px + env(safe-area-inset-left, 0px)); bottom: calc(14px + env(safe-area-inset-bottom, 0px));
    display: none; align-items: center; gap: 8px; padding: 6px 10px 6px 8px;
    color: #fff; background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 22px;
    font: 500 13px/1 system-ui, sans-serif; opacity: 0.35; transition: opacity 300ms ease-out, box-shadow 300ms ease-out;
  }
  .hud .lamp.shown { display: flex; }
  .hud .lamp.lit { opacity: 1; box-shadow: 0 0 0 1px #ffd24d; }
  .hud .lamp svg { width: 22px; height: 22px; display: block; }
  .hud .lamp .key, .hud .pause .key {
    display: inline-block; min-width: 1.4em; padding: 3px 5px; text-align: center;
    border: 1px solid rgba(255, 255, 255, 0.45); border-bottom-width: 2px; border-radius: 4px;
    font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: 0.04em;
  }
  /* The pause button, for a keyboard: the bars and the key that pauses, at
     the top left corner where the touch layer's own Pause sits, so every
     player sees the game can be paused and what does it; the page's mute
     sits under it (muteButton.ts). As faint as the lamp's hint, up under the
     pointer and on focus, and pressed it pauses as the key does. Hidden by
     default: the touch layer has its own button. A scene's bars take it down. */
  .hud .pause {
    position: absolute; left: calc(14px + env(safe-area-inset-left, 0px)); top: calc(14px + env(safe-area-inset-top, 0px));
    display: none; align-items: center; gap: 8px; height: 44px; box-sizing: border-box; padding: 0 12px 0 10px;
    pointer-events: auto; cursor: pointer;
    color: #fff; background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 22px;
    font: 500 13px/1 system-ui, sans-serif; opacity: 0.35; transition: opacity 120ms ease-out;
  }
  .hud .pause.shown { display: flex; }
  .hud .pause:hover, .hud .pause:focus-visible { opacity: 1; }
  .hud .pause:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 3px; }
  .hud .pause svg { width: 22px; height: 22px; display: block; }
  .hud .bars.on ~ .lamp, .hud .bars.on ~ .pause { opacity: 0; }
`;

export type Hud = {
  setStatus(text: string | null): void;
  /** The status line's text now, "" when it says nothing. */
  status(): string;
  /** The end: a title in the title screen's voice over its line, centred; null takes it down. Clears the status. */
  setEnding(end: { title: string; line: string } | null): void;
  /** The end's title and line now, null while none is up. */
  ending(): { title: string; line: string } | null;
  /** The inner voice's line, at the bottom where the film's captions were, for `ms`; a new one replaces it. */
  say(text: string, ms: number): void;
  /** The line taken down at once. */
  hush(): void;
  /** The inner voice's line now, "" when none is up. */
  saying(): string;
  /** A scene's letterbox bars, on or off. */
  setBars(on: boolean): void;
  /** A line that clears itself after `ms`, unless something replaces it first. */
  flash(text: string, ms: number): void;
  /** Darkens the whole view over 1.5 s; the status line stays readable on top. */
  fade(on: boolean): void;
  /** The headlamp's hint: shown with the key that turns it on and lit while the lamp is; null takes it down (a touch screen, the end). */
  setLamp(lamp: { key: string; on: boolean } | null): void;
  /** The hint now: its key and whether it is lit, or null while none shows. */
  lamp(): { key: string; on: boolean } | null;
  /** The pause button, for a keyboard: shown with the key that pauses; null takes it down (a touch screen, the end). */
  setPause(pause: { key: string } | null): void;
  /** The pause button now: its key, or null while none shows. */
  pause(): { key: string } | null;
  dispose(): void;
};

/**
 * Built with DOM APIs rather than innerHTML: setStatus carries server-supplied
 * disconnect reasons, and textContent makes injection structurally impossible.
 */
export function createHud(container: HTMLElement, hooks: { onPause?: () => void } = {}): Hud {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "hud";

  // The fade comes first so the lines below it paint on top.
  const fade = document.createElement("div");
  fade.className = "fade";

  const status = document.createElement("div");
  status.className = "status";

  const end = document.createElement("div");
  end.className = "end";
  const endTitle = document.createElement("div");
  endTitle.className = "end-title";
  const endLine = document.createElement("div");
  endLine.className = "end-line";
  const endOpen = document.createElement("span");
  endOpen.className = "open";
  const endTurn = document.createElement("span");
  endTurn.className = "dread";
  endLine.append(endOpen, endTurn);
  end.append(endTitle, endLine);

  const voice = document.createElement("div");
  voice.className = "voice";
  const bars = document.createElement("div");
  bars.className = "bars";
  const lamp = document.createElement("div");
  lamp.className = "lamp";
  lamp.setAttribute("aria-hidden", "true");
  const lampKey = document.createElement("span");
  lampKey.className = "key";
  lamp.append(lineIcon("lamp"), lampKey);
  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "pause";
  pause.setAttribute("aria-label", "Pause");
  const pauseKey = document.createElement("span");
  pauseKey.className = "key";
  pause.append(lineIcon("pause"), pauseKey);
  pause.addEventListener("click", () => hooks.onPause?.());

  root.append(fade, bars, status, end, voice, lamp, pause);
  container.append(style, root);

  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelFlash = () => {
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = null;
  };

  return {
    setStatus(text) {
      cancelFlash();
      status.textContent = text ?? "";
    },
    status() {
      return status.textContent ?? "";
    },
    setEnding(e) {
      cancelFlash();
      status.textContent = "";
      endTitle.textContent = e?.title ?? "";
      const [open, turn] = endLines(e?.line ?? "");
      endOpen.textContent = open;
      endTurn.textContent = turn;
      end.classList.toggle("on", e !== null);
    },
    say(text, ms) {
      if (voiceTimer !== null) clearTimeout(voiceTimer);
      voice.textContent = text;
      voice.classList.add("on");
      voiceTimer = setTimeout(() => {
        voice.classList.remove("on");
        voiceTimer = null;
      }, ms);
    },
    hush() {
      if (voiceTimer !== null) clearTimeout(voiceTimer);
      voiceTimer = null;
      voice.classList.remove("on");
    },
    setBars(on) {
      bars.classList.toggle("on", on);
      document.body.classList.toggle("scene", on);
    },
    saying() {
      return voice.classList.contains("on") ? (voice.textContent ?? "") : "";
    },
    ending() {
      return end.classList.contains("on") ? { title: endTitle.textContent ?? "", line: `${endOpen.textContent ?? ""} ${endTurn.textContent ?? ""}`.trim() } : null;
    },
    flash(text, ms) {
      cancelFlash();
      status.textContent = text;
      flashTimer = setTimeout(() => {
        flashTimer = null;
        if (status.textContent === text) status.textContent = "";
      }, ms);
    },
    fade(on) {
      fade.classList.toggle("on", on);
    },
    setLamp(state) {
      lamp.classList.toggle("shown", state !== null);
      lamp.classList.toggle("lit", state?.on === true);
      lampKey.textContent = state?.key ?? "";
    },
    setPause(state) {
      pause.classList.toggle("shown", state !== null);
      pauseKey.textContent = state?.key ?? "";
    },
    pause() {
      return pause.classList.contains("shown") ? { key: pauseKey.textContent ?? "" } : null;
    },
    lamp() {
      return lamp.classList.contains("shown") ? { key: lampKey.textContent ?? "", on: lamp.classList.contains("lit") } : null;
    },
    dispose() {
      if (voiceTimer !== null) clearTimeout(voiceTimer);
      cancelFlash();
      root.remove();
      style.remove();
    },
  };
}
