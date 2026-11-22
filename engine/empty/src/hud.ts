/**
 * The empty game's HUD: what the page asks of any game's (`PageHud`) and no
 * more. A line of status, a line that shows for a few seconds, and a Pause
 * button for a screen with no keyboard to press Esc on. Built with DOM APIs
 * and `textContent`: a status line may carry words that came over the wire.
 */
import type { PageHud } from "@csarkosh/engine/game/sessionGame";

const STYLE = `
.walk-hud { position: absolute; inset: 0; pointer-events: none; font: 14px/1.4 ui-monospace, Menlo, monospace; color: #e8e8ea; }
.walk-hud .line { position: absolute; left: 0; right: 0; text-align: center; text-shadow: 0 1px 2px #000; }
.walk-hud .status { top: 46%; }
.walk-hud .flash { bottom: 12%; }
.walk-hud button { position: absolute; top: 12px; right: 12px; pointer-events: auto; font: inherit; color: inherit; background: #0008; border: 1px solid #fff4; border-radius: 4px; padding: 4px 10px; }
`;

export type WalkHud = PageHud;

/** A line of status alone, for a start's waits and its failure. */
export function createStatusLine(container: HTMLElement): { setStatus(line: string | null): void; dispose(): void } {
  const hud = createWalkHud(container, null);
  return { setStatus: hud.setStatus, dispose: hud.dispose };
}

export function createWalkHud(container: HTMLElement, hooks: { onPause(): void } | null): WalkHud {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "walk-hud";
  const status = document.createElement("div");
  status.className = "line status";
  const flash = document.createElement("div");
  flash.className = "line flash";
  const pause = document.createElement("button");
  pause.type = "button";
  pause.hidden = true;
  pause.addEventListener("click", () => hooks?.onPause());
  root.append(status, flash, pause);
  container.append(style, root);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    setStatus(line) {
      status.textContent = line ?? "";
    },
    flash(line, ms) {
      flash.textContent = line;
      if (flashTimer !== null) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flash.textContent = "";
        flashTimer = null;
      }, ms);
    },
    // The empty game carries no lamp, so there is no hint of one to show.
    setLamp: () => undefined,
    setPause(shown) {
      pause.hidden = shown === null || hooks === null;
      if (shown !== null) pause.textContent = `Pause (${shown.key})`;
    },
    dispose() {
      if (flashTimer !== null) clearTimeout(flashTimer);
      root.remove();
      style.remove();
    },
  };
}
