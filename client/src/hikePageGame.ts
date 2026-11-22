/**
 * Day Hike as the page's shell is handed it (`shell.ts`): the one definition
 * of the game on a page. The shell names nothing of Day Hike's by itself;
 * the game a session is of, Day Hike's own of the page and what the shell
 * starts for it reach it through this.
 */
import type { PageGame } from "@csarkosh/engine/game/pageGame";
import type { HikeAudio } from "./game/hikeAudio.js";
import type { Renderer } from "./game/hikeRendererTypes.js";
import type { Hud } from "./game/hud.js";
import type { ClientSession } from "./net/clientSession.js";
import type { HostSession } from "./net/hostSession.js";
import type { PlayerState, WorldState } from "./sim/types.js";
import type { World } from "./sim/world.js";
import { titleStillUrl } from "./game/dayhikeAssets.js";
import { creditsEntries } from "./game/hikeCredits.js";
import { startHikeWorldWorker } from "./game/hikeWorldWorker.js";
import { createHud } from "./game/hud.js";
import { liteProbeDeps } from "./game/lite/probeScene.js";
import { runLiteSceneRoute } from "./game/lite/sceneRoute.js";
import { HIKE_GAME } from "./hikeGame.js";
import { createHikePage } from "./hikePage.js";
import { PROTOCOL_VERSION } from "./net/protocol.js";

export const HIKE_PAGE: PageGame<World, WorldState, PlayerState, Renderer, HikeAudio, Hud, HostSession, ClientSession> = {
  /** The hike, as the page that runs one is handed it. */
  game: HIKE_GAME,
  /** Day Hike's own of the page: the intro's film, the title's loop, the landing page, the mode. */
  side: createHikePage,
  /** The game's name, as the page for those turned away titles itself and says it. */
  title: "Day Hike",
  /** What that page shows of Day Hike's: the title's still under it, and the works that still and the game are owed credit for. */
  away: { still: titleStillUrl, credits: creditsEntries },
  /** Where a hiker's name is kept between visits, and what one made for a new visitor starts with. */
  name: { key: "dayhike.playerName", prefix: "Hiker" },
  /** The version of the hike's wire (`protocol.ts`), which every telemetry row names. */
  protocol: PROTOCOL_VERSION,
  /** A start's line of status: the hike's HUD with nothing else of it shown. */
  statusLine: (container: HTMLElement) => createHud(container),
  /** The worker that makes a hike's world (`world.worker.ts`). */
  worldWorker: startHikeWorldWorker,
  /** The staged intro and title, a frame at a time for their recording. */
  scene: runLiteSceneRoute,
  /** The tier check's steps, measured on the hike's own renderer. */
  probe: (container: HTMLElement) => liteProbeDeps(container),
};
