import { listOpen, renderSettings, type SettingsView } from "./settings.js";
import type { TierChoice } from "./tierChoice.js";

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
  /* While a new tier is applied the ground goes opaque, the vignette's own
     outer colour, so the rebuild behind it (the scene torn down, built again,
     its shaders compiling) is never seen; it fades back once the new scene is
     ready. */
  .pausemenu::before {
    content: ""; position: absolute; inset: 0; z-index: -1;
    background: rgb(8, 9, 12); opacity: 0;
    transition: opacity 220ms ease-out;
  }
  /* Opaque at once on the way in: the page paints once before the swap blocks
     it, and that paint must already hide the scene. The fade is the way out. */
  .pausemenu.applying::before { opacity: 1; transition: none; }
  .pausemenu .panel {
    /* Two pages in one cell: the main page and Settings. They swap in place
       with the landing's panel slide, so the swap never shifts layout. */
    display: grid;
    opacity: 0; transform: translateY(8px) scale(0.97);
    transition: opacity 180ms ease-in, transform 180ms ease-in;
  }
  .pausemenu .page {
    grid-area: 1 / 1; justify-self: center; align-self: center;
    display: flex; flex-direction: column; gap: 0.75rem;
    transition: opacity 240ms ease-out, transform 240ms ease-out;
  }
  .pausemenu .page.main { min-width: 14rem; }
  .pausemenu .page.settings {
    align-items: center; max-width: calc(100vw - 2rem);
    opacity: 0; transform: translateX(24px); pointer-events: none;
  }
  .pausemenu .page.settings button.apply, .pausemenu .page.settings button.back { min-width: 14rem; }
  .pausemenu.show-settings .page.main { opacity: 0; transform: translateX(-24px); pointer-events: none; }
  .pausemenu.show-settings .page.settings { opacity: 1; transform: none; pointer-events: auto; }
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
  .pausemenu h1, .pausemenu h2 {
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
    .pausemenu .page, .pausemenu.show-settings .page { transform: none; }
    @starting-style { .pausemenu.open .panel { transform: none; } }
    .pausemenu button:hover:not(:disabled), .pausemenu button:active:not(:disabled) { transform: none; }
  }
`;

/** The main page, as data: its title and its buttons, in order. */
export function pauseMenuModel(): { title: string; buttons: { id: "resume" | "settings" | "exit"; label: string }[] } {
  return {
    title: "Paused",
    buttons: [
      { id: "resume", label: "Resume" },
      { id: "settings", label: "Settings" },
      { id: "exit", label: "Exit" },
    ],
  };
}

/** Which page shows, the Settings selection not yet applied, and whether one
 * is being applied. */
export type PauseState = { panel: "main" | "settings"; selection: TierChoice | null; applying: boolean };

export const PAUSE_START: PauseState = Object.freeze({ panel: "main", selection: null, applying: false });

export type PauseEvent =
  | { kind: "show" }
  | { kind: "settings"; saved: TierChoice }
  | { kind: "choose"; choice: TierChoice }
  | { kind: "apply" }
  | { kind: "applied" }
  | { kind: "back" }
  | { kind: "escape" };

/** Where the keyboard's focus goes: the main page's Resume or Settings, or
 * the Settings page's Graphics select. */
export type PauseFocus = "resume" | "settings" | "choice";

export type PauseEffect =
  | { kind: "resume" }
  | { kind: "apply"; choice: TierChoice }
  | { kind: "focus"; target: PauseFocus }
  | null;

/**
 * The menu's decisions, as data. Settings opens on the saved choice; a choice
 * only selects; Apply hands the selection on; Back and Escape leave Settings
 * and discard a selection not applied; Escape on the main page resumes. While
 * a choice is being applied nothing but its end is heard, and the menu always
 * opens on the main page. Focus follows: Resume when the menu opens, the
 * Graphics select on entering Settings and once a choice is applied (Apply
 * goes disabled, and a disabled button loses the focus), Settings on leaving.
 */
export function pauseStep(state: PauseState, event: PauseEvent): { state: PauseState; effect: PauseEffect } {
  const stay = { state, effect: null };
  if (state.applying) {
    return event.kind === "applied"
      ? { state: { ...state, applying: false }, effect: { kind: "focus", target: "choice" } }
      : stay;
  }
  switch (event.kind) {
    case "show":
      return { state: PAUSE_START, effect: { kind: "focus", target: "resume" } };
    case "settings":
      return {
        state: { panel: "settings", selection: event.saved, applying: false },
        effect: { kind: "focus", target: "choice" },
      };
    case "choose":
      return state.panel === "settings" ? { state: { ...state, selection: event.choice }, effect: null } : stay;
    case "apply":
      return state.panel === "settings" && state.selection !== null
        ? { state: { ...state, applying: true }, effect: { kind: "apply", choice: state.selection } }
        : stay;
    case "applied":
      return stay;
    case "back":
      return state.panel === "settings" ? { state: PAUSE_START, effect: { kind: "focus", target: "settings" } } : stay;
    case "escape":
      return state.panel === "settings"
        ? { state: PAUSE_START, effect: { kind: "focus", target: "settings" } }
        : { state, effect: { kind: "resume" } };
  }
}

/** What the play gate reads of the page, and does to it. */
export type PlayGateDeps = {
  /** Whether the pointer is locked to the game now. */
  engaged(): boolean;
  barOpen(): boolean;
  menuOpen(): boolean;
  /** The match is over: the controls stay held. */
  ended(): boolean;
  showMenu(): void;
  hideMenu(): void;
  setSuppressed(on: boolean): void;
  /** Tells the page the player has paused, or resumed. */
  paused(on: boolean): void;
};

export type PlayGate = {
  /** The pointer's lock was taken (true) or released (false). */
  engagedChanged(engaged: boolean): void;
  /** The command bar opened (true) or closed (false). */
  barChanged(open: boolean): void;
  /** Sets the controls from the state as it is now: for a change the gate is
   * not told of, the match's end. */
  refresh(): void;
  /** Holds the controls under a cover over play; the function returned lifts
   * it, once. */
  cover(): () => void;
  readonly covered: boolean;
};

/**
 * The pause menu and the controls. The gate alone holds or frees the
 * controls: held while the command bar or the pause menu is open, once the
 * match is over, and under a cover over play; free otherwise. The pointer's
 * lock released shows the menu, unless the bar has the keyboard; taken, it
 * hides it. The bar opening hides the menu. While a cover is over play (the
 * governor's rebuild), the lock changes nothing: a menu shown under the cover
 * would be unseen but reachable by keyboard, and handing the controls back
 * would let the player walk blind. When the cover lifts, the gate reconciles
 * once with the lock as it is then: released shows the menu on Resume, taken
 * plays on.
 */
export function createPlayGate(deps: PlayGateDeps): PlayGate {
  let covered = false;
  const settle = (): void => {
    deps.setSuppressed(deps.barOpen() || deps.menuOpen() || deps.ended() || covered);
  };
  const engagedChanged = (engaged: boolean): void => {
    if (covered) return;
    if (engaged) {
      deps.hideMenu();
      settle();
      deps.paused(false);
    } else if (!deps.barOpen()) {
      deps.showMenu();
      settle();
      deps.paused(true);
    }
  };
  return {
    engagedChanged,
    barChanged(open) {
      // The bar outranks the pause menu: "/" over the menu switches to typing.
      if (open) deps.hideMenu();
      settle();
    },
    refresh: settle,
    cover() {
      covered = true;
      settle();
      let lifted = false;
      return () => {
        if (lifted) return;
        lifted = true;
        covered = false;
        engagedChanged(deps.engaged());
      };
    },
    get covered() {
      return covered;
    },
  };
}

/** What the pause screen's Settings needs from the game. */
export type PauseSettings = {
  /** The choice saved now, which Settings opens on. */
  saved(): TierChoice;
  /** The Settings page for a selection, painted fresh each time it is shown. */
  view(selection: TierChoice, applying: boolean): SettingsView;
  /** Apply: save the choice, and apply it where that is possible. A promise
   * holds the page on "Applying…" until it settles. */
  onApply(choice: TierChoice): void | Promise<void>;
  /** A choice was picked (the selection changed): what the last Apply said
   * can be let go. */
  onChoose?(choice: TierChoice): void;
};

export type PauseMenu = {
  show(): void;
  hide(): void;
  /** Exit was pressed and the game is about to be torn down: the button says
   * so and neither button takes another press. Nothing undoes it; the menu
   * goes with the game. */
  setExiting(): void;
  readonly isOpen: boolean;
  /** A choice is being applied: the command bar holds off until it is done. */
  readonly applying: boolean;
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
 * Settings swaps the main page for the shared Settings screen (`settings.ts`)
 * in place; Back and Esc return to the main page. Every decision is
 * `pauseStep`'s.
 *
 * Built with DOM APIs and `textContent`, matching the HUD's rule that anything
 * dynamic cannot become markup.
 */
export function createPauseMenu(
  container: HTMLElement,
  options: { onResume(): void; onExit(): void; settings: PauseSettings },
): PauseMenu {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "pausemenu";

  const panel = document.createElement("div");
  panel.className = "panel";

  const model = pauseMenuModel();
  const main = document.createElement("div");
  main.className = "page main";
  const title = document.createElement("h1");
  title.textContent = model.title;
  main.append(title);
  const buttons = new Map<string, HTMLButtonElement>();
  for (const b of model.buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = b.label;
    main.append(button);
    buttons.set(b.id, button);
  }
  const resume = buttons.get("resume") as HTMLButtonElement;
  const settingsButton = buttons.get("settings") as HTMLButtonElement;
  const exit = buttons.get("exit") as HTMLButtonElement;

  const settingsPage = document.createElement("div");
  settingsPage.className = "page settings";
  settingsPage.inert = true;
  const settingsUi = renderSettings(settingsPage, options.settings.view(options.settings.saved(), false), {
    onChoose: (choice) => dispatch({ kind: "choose", choice }),
    onBack: () => dispatch({ kind: "back" }),
    onApply: () => dispatch({ kind: "apply" }),
  });

  panel.append(main, settingsPage);
  root.append(panel);
  container.append(style, root);

  let isOpen = false;
  let state = PAUSE_START;

  function paint(): void {
    const onSettings = state.panel === "settings";
    root.classList.toggle("show-settings", onSettings);
    root.classList.toggle("applying", state.applying);
    main.inert = onSettings;
    settingsPage.inert = !onSettings;
    if (onSettings && state.selection !== null) settingsUi.setView(options.settings.view(state.selection, state.applying));
  }

  function focus(target: PauseFocus): void {
    if (!isOpen) return;
    if (target === "resume") resume.focus();
    else if (target === "settings") settingsButton.focus();
    else settingsPage.querySelector<HTMLSelectElement>("select")?.focus();
  }

  function dispatch(event: PauseEvent): void {
    const step = pauseStep(state, event);
    const chose = step.state !== state && event.kind === "choose" ? event.choice : null;
    state = step.state;
    if (chose !== null) options.settings.onChoose?.(chose);
    paint();
    const effect = step.effect;
    if (effect === null) return;
    if (effect.kind === "focus") {
      focus(effect.target);
      return;
    }
    if (effect.kind === "resume") {
      options.onResume();
      return;
    }
    let applied: void | Promise<void> = undefined;
    try {
      applied = options.settings.onApply(effect.choice);
    } catch (error) {
      console.error("settings: the choice could not be applied.", error);
    }
    void Promise.resolve(applied)
      .catch((error: unknown) => console.error("settings: the choice could not be applied.", error))
      .finally(() => dispatch({ kind: "applied" }));
  }

  resume.addEventListener("click", () => options.onResume());
  settingsButton.addEventListener("click", () => dispatch({ kind: "settings", saved: options.settings.saved() }));
  exit.addEventListener("click", () => options.onExit());

  const onKeyDown = (e: KeyboardEvent) => {
    if (isOpen && e.code === "Escape") {
      // A browser that hands the page the Escape closing a select's open list
      // (and says the list is open, through `:open`) closes only the list.
      if (listOpen(e.target)) return;
      e.preventDefault();
      dispatch({ kind: "escape" });
    }
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    show() {
      // Open first: nothing in a display: none subtree can take the focus
      // that opening gives Resume.
      isOpen = true;
      root.classList.add("open");
      dispatch({ kind: "show" });
    },
    hide() {
      isOpen = false;
      root.classList.remove("open");
    },
    setExiting() {
      exit.textContent = "Leaving…";
      exit.disabled = true;
      resume.disabled = true;
      settingsButton.disabled = true;
    },
    get isOpen() {
      return isOpen;
    },
    get applying() {
      return state.applying;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      settingsUi.dispose();
      root.remove();
      style.remove();
    },
  };
}
