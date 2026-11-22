/**
 * The empty game as the page's shell is handed it (`pageGame.ts`): its
 * definition on a page, and its own of the page, which is as little as a
 * page can be. A title and a Play button for a landing page, nothing played
 * before a session starts, a line for a visitor whose browser cannot draw
 * the world, a name and the one mode.
 */
import { createModeKeeper } from "@csarkosh/engine/game/modeList";
import type { LandingShell, PageGame, PageHost, PageSide } from "@csarkosh/engine/game/pageGame";
import { pageStorage } from "@csarkosh/engine/game/tierChoice";
import type { AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import { EMPTY_GAME, WALK_MODES, type WalkClient, type WalkHost, type WalkRenderer } from "./game.js";
import { createStatusLine, type WalkHud } from "./hud.js";
import { WALK_PROTOCOL } from "./net.js";
import { createWalkWorld, type WalkState, type WalkWorld, type Walker } from "./sim.js";

const STYLE = `
.empty-landing { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; font: 16px/1.4 ui-monospace, Menlo, monospace; color: #e8e8ea; }
.empty-landing h1 { font-size: 22px; letter-spacing: 0.3em; margin: 0; font-weight: 600; }
.empty-landing button { font: inherit; color: inherit; background: #fff1; border: 1px solid #fff5; border-radius: 4px; padding: 8px 28px; letter-spacing: 0.2em; }
.empty-landing button:disabled { opacity: 0.5; }
`;

/** The empty game's own of the page: made once by the shell, called at the page's own points. */
export function createEmptyPage(h: PageHost): PageSide {
  let landing: { play: HTMLButtonElement; root: HTMLElement } | null = null;
  const mode = createModeKeeper(WALK_MODES, pageStorage);

  /** The landing page shows what the shell holds now: a follower waits for the host, and Play says so while it loads. */
  function repaint(): void {
    if (landing === null) return;
    const follower = h.lobby !== null && h.lobby.state.role === "client";
    landing.play.disabled = follower || h.launching;
    landing.play.textContent = follower ? "WAITING FOR THE HOST" : h.launching ? "LOADING…" : "PLAY";
  }

  return {
    showLanding(container: HTMLDivElement, _route, shell: LandingShell) {
      const style = document.createElement("style");
      style.textContent = STYLE;
      const root = document.createElement("div");
      root.className = "empty-landing";
      const title = document.createElement("h1");
      title.textContent = "THE EMPTY GAME";
      const play = document.createElement("button");
      play.type = "button";
      play.addEventListener("click", () => shell.play());
      root.append(title, play);
      container.append(style, root);
      const shown = { play, root };
      landing = shown;
      repaint();
      return {
        dispose: () => {
          if (landing === shown) landing = null;
          root.remove();
          style.remove();
        },
      };
    },
    landingUp: () => landing !== null,
    // One page and no panels: a panel's address shows the landing page as it stands.
    showPanel: () => undefined,
    repaint,
    left() {
      landing = null;
    },
    // Nothing plays before a session starts.
    played: () => undefined,
    carriesToGame: () => false,
    keepOpening: () => undefined,
    openingFor: () => null,
    muteChanged: () => undefined,
    // A visitor turned away is shown the engine's page; the landing page held goes first.
    turnedAway() {
      landing = null;
    },
    mode: mode.mode,
    saveMode(next) {
      if (WALK_MODES.modes.some((m) => m.id === next)) mode.save(next);
    },
  };
}

export const EMPTY_PAGE: PageGame<WalkWorld, WalkState, Walker, WalkRenderer, AmbientAudio, WalkHud, WalkHost, WalkClient> = {
  game: EMPTY_GAME,
  side: createEmptyPage,
  identity: { title: "The Empty Game", session: "walk", player: "Walker", storage: "empty", desktop: "EmptyGame" },
  /** The page for those turned away stands on no still and credits no works. */
  away: { still: () => null, credits: () => [] },
  protocol: WALK_PROTOCOL,
  statusLine: createStatusLine,
  /** The worker that makes a session's world: the entry is the game's, since a worker is named by a path. */
  worldWorker: () => new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" }),
  /** The empty game stages no scene: a scene's address draws nothing. */
  scene: () => ({ dispose: () => undefined }),
  /** What the tier check draws as it measures the renderer: the yard with nobody in it. */
  probeState: (_level, _seed, forest) => createWalkWorld(forest, false).state,
};
