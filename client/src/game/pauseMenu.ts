const STYLE = `
  .pausemenu {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    background: rgba(16, 16, 20, 0.82);
    font-family: ui-monospace, monospace;
    /* Above the touch layer (touchControls.ts, 15) and the interact prompt
       (interactPrompt.ts, 12), below the roster (roster.ts, 20): the menu must
       win a tap over the controls it is meant to cover, but the roster stays
       reachable while it is open. */
    z-index: 18;
  }
  .pausemenu.open { display: flex; }
  .pausemenu .panel { display: flex; flex-direction: column; gap: 0.75rem; min-width: 14rem; }
  .pausemenu h1 {
    margin: 0 0 0.5rem; color: #fff; font-size: 1.1rem;
    font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; text-align: center;
  }
  .pausemenu button {
    padding: 0.6rem 1rem; font: inherit; font-size: 1rem; cursor: pointer;
    color: #fff; background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
  }
  .pausemenu button:hover { background: rgba(255, 255, 255, 0.18); }
  /* A finger gets no hover: the press itself has to show, and so does the
     teardown that follows Exit. */
  .pausemenu button:active { background: rgba(255, 255, 255, 0.3); }
  .pausemenu button:disabled { cursor: default; color: rgba(255, 255, 255, 0.55); background: rgba(255, 255, 255, 0.04); }
`;

export type PauseMenu = {
  show(): void;
  hide(): void;
  /** Exit was pressed and the game is about to be torn down: the button says
   * so and neither button takes another press. Nothing undoes it; the menu
   * goes with the game. */
  setExiting(): void;
  readonly isOpen: boolean;
  dispose(): void;
};

/**
 * The overlay shown whenever the pointer lock is lost outside the command bar.
 *
 * "Pause" is a per-player statement, not a simulation one: this is a networked
 * co-op game, so the world keeps running — only this player's controls
 * disengage (the caller suppresses input while the menu is open, exactly as it
 * does for the command bar).
 *
 * Deliberately ignorant of pointer lock and routing: Resume and Exit are the
 * caller's callbacks, and show/hide are driven from outside off
 * `pointerlockchange`. Esc pressed while open also resumes; note the relock it
 * triggers is refused by Chrome inside the ~1.25 s cooldown that follows the
 * escape that opened this menu, so a quick Esc-Esc leaves the menu up — the
 * Resume click a moment later succeeds.
 *
 * Built with DOM APIs and `textContent`, matching the HUD's rule that anything
 * dynamic cannot become markup.
 */
export function createPauseMenu(
  container: HTMLElement,
  options: { onResume(): void; onExit(): void },
): PauseMenu {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "pausemenu";

  const panel = document.createElement("div");
  panel.className = "panel";

  const title = document.createElement("h1");
  title.textContent = "Paused";

  const resume = document.createElement("button");
  resume.type = "button";
  resume.textContent = "Resume";
  resume.addEventListener("click", () => options.onResume());

  const exit = document.createElement("button");
  exit.type = "button";
  exit.textContent = "Exit";
  exit.addEventListener("click", () => options.onExit());

  panel.append(title, resume, exit);
  root.append(panel);
  container.append(style, root);

  let isOpen = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (isOpen && e.code === "Escape") {
      e.preventDefault();
      options.onResume();
    }
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    show() {
      isOpen = true;
      root.classList.add("open");
    },
    hide() {
      isOpen = false;
      root.classList.remove("open");
    },
    setExiting() {
      exit.textContent = "Leaving…";
      exit.disabled = true;
      resume.disabled = true;
    },
    get isOpen() {
      return isOpen;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      root.remove();
      style.remove();
    },
  };
}
