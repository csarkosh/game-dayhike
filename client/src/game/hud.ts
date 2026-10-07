import { endLines } from "./passages.js";
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
  .hud .fade {
    position: absolute; inset: 0; background: #000; opacity: 0;
    transition: opacity 1.5s ease-in;
  }
  .hud .fade.on { opacity: 1; }
`;

export type Hud = {
  setStatus(text: string | null): void;
  /** The status line's text now, "" when it says nothing. */
  status(): string;
  /** The end: a title in the title screen's voice over its line, centred; null takes it down. Clears the status. */
  setEnding(end: { title: string; line: string } | null): void;
  /** The end's title and line now, null while none is up. */
  ending(): { title: string; line: string } | null;
  /** A line that clears itself after `ms`, unless something replaces it first. */
  flash(text: string, ms: number): void;
  /** Darkens the whole view over 1.5 s; the status line stays readable on top. */
  fade(on: boolean): void;
  dispose(): void;
};

/**
 * Built with DOM APIs rather than innerHTML: setStatus carries server-supplied
 * disconnect reasons, and textContent makes injection structurally impossible.
 */
export function createHud(container: HTMLElement): Hud {
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

  root.append(fade, status, end);
  container.append(style, root);

  let flashTimer: ReturnType<typeof setTimeout> | null = null;
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
    dispose() {
      cancelFlash();
      root.remove();
      style.remove();
    },
  };
}
