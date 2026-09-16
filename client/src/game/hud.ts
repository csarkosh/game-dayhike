const STYLE = `
  .hud { position: absolute; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; color: #fff; }
  .hud .status {
    position: absolute; left: 50%; top: 55%; transform: translateX(-50%);
    font-size: 1.1rem; text-shadow: 0 1px 4px #000; text-align: center;
  }
  .hud .fade {
    position: absolute; inset: 0; background: #000; opacity: 0;
    transition: opacity 1.5s ease-in;
  }
  .hud .fade.on { opacity: 1; }
`;

export type Hud = {
  setStatus(text: string | null): void;
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

  root.append(fade, status);
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
