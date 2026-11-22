/**
 * The empty game as the page's shell is handed it (`pageGame.ts`): its
 * definition on a page, and its own of the page, which is as little as a
 * page can be. A title and a Play button for a landing page, nothing played
 * before a session starts, a line for a visitor whose browser cannot draw
 * the world, a name and the one mode.
 */
import { createModeKeeper } from "@csarkosh/engine/game/modeList";
import type { LandingShell, PageGame, PageHost, PageSide, TurnedAway } from "@csarkosh/engine/game/pageGame";
import { pageProbe } from "@csarkosh/engine/game/probePage";
import { pageStorage } from "@csarkosh/engine/game/tierChoice";
import type { AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import { sanitiseName } from "@csarkosh/engine/net/lobby";
import { EMPTY_GAME, WALK_MODES, type WalkClient, type WalkHost, type WalkRenderer } from "./game.js";
import { createStatusLine, type WalkHud } from "./hud.js";
import { WALK_PROTOCOL } from "./net.js";
import type { WalkState, WalkWorld, Walker } from "./sim.js";

const NAME_KEY = "empty.playerName";

const STYLE = `
.empty-landing { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; font: 16px/1.4 ui-monospace, Menlo, monospace; color: #e8e8ea; }
.empty-landing h1 { font-size: 22px; letter-spacing: 0.3em; margin: 0; font-weight: 600; }
.empty-landing button { font: inherit; color: inherit; background: #fff1; border: 1px solid #fff5; border-radius: 4px; padding: 8px 28px; letter-spacing: 0.2em; }
.empty-landing button:disabled { opacity: 0.5; }
.empty-away { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; font: 16px/1.5 ui-monospace, Menlo, monospace; color: #e8e8ea; }
`;

/** The player's name as the roster shows it, kept across visits where the browser allows. */
function loadName(): string {
  try {
    const stored = pageStorage()?.getItem(NAME_KEY);
    if (typeof stored === "string") return sanitiseName(stored);
  } catch {
    /* storage refused: a name for this visit */
  }
  return `Walker-${String(Math.min(9999, Math.floor(Math.random() * 10000))).padStart(4, "0")}`;
}

/** The empty game's own of the page: made once by the shell, called at the page's own points. */
export function createEmptyPage(h: PageHost): PageSide {
  let landing: { play: HTMLButtonElement; root: HTMLElement } | null = null;
  let away: HTMLElement | null = null;
  let name = loadName();
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
    // The shell has let go of the session, the mute and the roster, and emptied the container.
    showTurnedAway(container: HTMLDivElement, why: TurnedAway) {
      landing = null;
      const style = document.createElement("style");
      style.textContent = STYLE;
      away = document.createElement("div");
      away.className = "empty-away";
      away.textContent = `This browser cannot draw the world (${why.reason}).`;
      container.append(style, away);
    },
    turnedAwayNow(next: TurnedAway) {
      if (away !== null) away.textContent = `This browser cannot draw the world (${next.reason}).`;
    },
    name: () => name,
    rename(raw) {
      name = sanitiseName(raw);
      try {
        pageStorage()?.setItem(NAME_KEY, name);
      } catch {
        /* the name is still in force for this visit */
      }
      return name;
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
  protocol: WALK_PROTOCOL,
  statusLine: createStatusLine,
  /** The worker that makes a session's world: the entry is the game's, since a worker is named by a path. */
  worldWorker: () => new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" }),
  /** The empty game stages no scene: a scene's address draws nothing. */
  scene: () => ({ dispose: () => undefined }),
  /** The tier check's steps read nothing yet, so the tier is chosen from what the browser says of the GPU alone. */
  probe: (container) => pageProbe(container, () => Promise.resolve(null)),
};
