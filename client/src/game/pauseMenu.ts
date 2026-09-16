const STYLE = `
  .pausemenu {
    /* The cold cast every control on this screen is drawn in. landing.ts and
       roster.ts carry the same tokens, deliberately repeated rather than
       shared: each renderer owns exactly one STYLE literal, and the pale slab
       these replace was already written out in all three. Change one, change
       all three. */
    --btn-sheen: linear-gradient(rgba(226, 236, 236, 0.16), rgba(198, 222, 222, 0));
    --btn-fill: rgba(198, 222, 222, 0.10);
    --btn-fill-lit: rgba(214, 234, 234, 0.20);
    --btn-fill-hit: rgba(230, 244, 244, 0.32);
    --btn-edge: rgba(198, 222, 222, 0.30);
    --btn-edge-lit: rgba(214, 234, 234, 0.58);
    --btn-rim: inset 0 1px 0 rgba(226, 236, 236, 0.30);
    --btn-bloom: rgba(198, 222, 222, 0.24);

    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    /* A vignette rather than the old flat scrim, matching the landing's: the
       world darkens towards the edges and stays legible behind the panel.
       Deliberately NOT a backdrop-filter — pause is a per-player statement and
       the match keeps running behind this menu (see below), so a full-screen
       blur would cost a slice of every frame for as long as it is up.
       roster.ts drops its own blur while playing for the same reason. */
    background: radial-gradient(
      ellipse at center,
      rgba(10, 12, 14, 0.68) 0%,
      rgba(8, 9, 12, 0.93) 100%
    );
    font-family: ui-monospace, monospace;
    /* Above the touch layer (touchControls.ts, 15) and the interact prompt
       (interactPrompt.ts, 12), below the roster (roster.ts, 20): the menu must
       win a tap over the controls it is meant to cover, but the roster stays
       reachable while it is open. */
    z-index: 18;
    opacity: 0;
    /* The dismiss. display is a discrete property, so on its own it would flip
       to none on the first frame and leave nothing to fade; allow-discrete
       holds it at flex until the fade finishes. Kept out of the transition
       shorthand on purpose — a browser that does not know the keyword throws
       out the whole declaration it appears in, which would take the opacity
       fade with it. Dropped on its own it degrades to the instant hide this
       menu had before. */
    transition: opacity 180ms ease-in, display 180ms ease-in;
    transition-behavior: allow-discrete;
  }
  .pausemenu.open {
    display: flex;
    opacity: 1;
    transition: opacity 220ms ease-out, display 220ms ease-out;
    transition-behavior: allow-discrete;
  }
  .pausemenu .panel {
    display: flex; flex-direction: column; gap: 0.75rem; min-width: 14rem;
    opacity: 0; transform: translateY(8px) scale(0.97);
    transition: opacity 180ms ease-in, transform 180ms ease-in;
  }
  .pausemenu.open .panel {
    opacity: 1; transform: none;
    /* A shallow overshoot on the way up against a plain ease-in on the way
       out: arriving is a settle, leaving is a release. */
    transition: opacity 200ms ease-out, transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  /* Nothing inside a display: none subtree is rendered, so on opening the panel
     has no previous value to travel FROM and would simply appear in place.
     This is that value. */
  @starting-style {
    .pausemenu.open { opacity: 0; }
    .pausemenu.open .panel { opacity: 0; transform: translateY(8px) scale(0.97); }
  }
  .pausemenu h1 {
    margin: 0 0 0.5rem; color: #fff; font-size: 1.1rem;
    font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; text-align: center;
  }
  .pausemenu button {
    padding: 0.6rem 1rem; font: inherit; font-size: 1rem; cursor: pointer;
    /* The heading's vocabulary, carried down onto the controls. */
    letter-spacing: 0.12em; text-transform: uppercase;
    color: #eaf1f1;
    /* A fixed gradient over an animated flat colour: only background-color
       moves between states, which interpolates cleanly and costs nothing,
       while the sheen keeps the slab from reading as a flat wash. */
    background-image: var(--btn-sheen);
    background-color: var(--btn-fill);
    border: 1px solid var(--btn-edge); border-radius: 4px;
    box-shadow: var(--btn-rim), 0 0 0 rgba(198, 222, 222, 0);
    transition:
      background-color 160ms ease-out, border-color 160ms ease-out,
      box-shadow 160ms ease-out, transform 160ms ease-out;
  }
  .pausemenu button:hover:not(:disabled) {
    background-color: var(--btn-fill-lit); border-color: var(--btn-edge-lit);
    /* Mist-light caught on the slab: the same bloom the landing's dread line
       carries, at the same cold tint. */
    box-shadow: var(--btn-rim), 0 0 18px var(--btn-bloom);
    transform: translateY(-1px);
  }
  /* A finger gets no hover: the press itself has to show, and so does the
     teardown that follows Exit. Faster than the rise, so the press reads as
     mechanical rather than soft. */
  .pausemenu button:active:not(:disabled) {
    background-color: var(--btn-fill-hit); border-color: var(--btn-edge-lit);
    box-shadow: var(--btn-rim), 0 0 8px var(--btn-bloom);
    transform: translateY(1px);
    transition-duration: 70ms;
  }
  /* Both buttons are keyboard-reachable and had no visible focus at all. */
  .pausemenu button:focus-visible { outline: 2px solid var(--btn-edge-lit); outline-offset: 3px; }
  .pausemenu button:disabled {
    cursor: default; color: rgba(214, 234, 234, 0.45);
    background-color: rgba(198, 222, 222, 0.04); border-color: rgba(198, 222, 222, 0.14);
    box-shadow: none; transform: none;
  }
  @media (prefers-reduced-motion: reduce) {
    /* The fades stay — they are not what makes motion sickening. Every
       displacement goes, including the one the starting style would have
       travelled from. */
    .pausemenu .panel, .pausemenu.open .panel { transform: none; }
    @starting-style { .pausemenu.open .panel { transform: none; } }
    .pausemenu button:hover:not(:disabled), .pausemenu button:active:not(:disabled) { transform: none; }
  }
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
