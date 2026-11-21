/**
 * Day Hike as the page that runs a hike is handed it (`app.ts`): the one
 * definition of the game on a screen. The page names nothing of Day Hike's by
 * itself; every maker, list and rule of the game's reaches it through this.
 * The hike's console commands register as this is imported.
 */
import "./game/hikeCommands.js";
import type { Level } from "@csarkosh/engine/sim/level";
import type { Forest } from "@csarkosh/engine/sim/forest";
import type { Transport } from "@csarkosh/engine/net/transport";
import { HIKE_MODES, isGameMode, peaceful } from "./game/gameMode.js";
import type { SessionGame } from "./game/sessionGame.js";
import type { HikeAudio } from "./game/hikeAudio.js";
import type { Renderer } from "./game/hikeRendererTypes.js";
import type { Hud } from "./game/hud.js";
import type { ClientSession } from "./net/clientSession.js";
import type { HostSession } from "./net/hostSession.js";
import type { PlayerState, WorldState } from "./sim/types.js";
import type { World } from "./sim/world.js";
import { createHikeAudio } from "./game/hikeAudio.js";
import { createHikeRenderer } from "./game/hikeRenderer.js";
import { createHud } from "./game/hud.js";
import { createHike } from "./hike.js";
import { createClientSession } from "./net/clientSession.js";
import { createHostSession } from "./net/hostSession.js";
import { trailheadStart } from "./sim/spawn.js";
import { HIKE_ACTIONS } from "./sim/types.js";
import sandbox01 from "../levels/sandbox01.json" with { type: "json" };

/** Whether a mode's woods are empty and its sky never falls: the explore modes (`gameMode.ts`). */
const calmIn = (mode: string): boolean => isGameMode(mode) && peaceful(mode);

export const HIKE_GAME: SessionGame<World, WorldState, PlayerState, Renderer, HikeAudio, Hud, HostSession, ClientSession> = {
  /**
   * The level the renderer and both sessions are shaped by: the sandbox, kept
   * as the fallback. A forest world carries a stub level with no brushes, so
   * the brush-mesh path is a no-op, not a second code path.
   */
  level: sandbox01 as unknown,
  /** The modes a hike is played in, as the settings and the address hold them. */
  modes: HIKE_MODES,
  /** The hike's bits for an interaction and the lamp's switch. */
  actions: HIKE_ACTIONS,
  /** Where a hike's players start, from the seed alone; null for a world with no trail. */
  startOf: trailheadStart,
  /** Whether the weather is the mode's own to turn (the explore day's): a preset asked for at the console is then answered, not set. */
  weatherIsOwn: calmIn,
  /** The renderer of the hike: the engine's, with Day Hike's parts. */
  renderer: createHikeRenderer,
  /** The sound's bus with Day Hike's voices on it. */
  audio: createHikeAudio,
  /** The hike's HUD. */
  hud: createHud,
  /** Day Hike's own half of a hike on a screen. */
  side: createHike,
  /** A host's session on the world of a mode. */
  host: (level: Level, seed: number, clock: () => number, o: { forest: Forest; hostPeerId: string; mode: string }) =>
    createHostSession(level, seed, clock, { forest: o.forest, hostPeerId: o.hostPeerId, peaceful: calmIn(o.mode) }),
  /** A follower's session on the world of a mode. */
  join: (level: Level, seed: number, transport: Transport, clock: () => number, o: { expectedLevelId: string; forest: Forest; mode: string }) =>
    createClientSession(level, seed, transport, clock, { expectedLevelId: o.expectedLevelId, forest: o.forest, peaceful: calmIn(o.mode) }),
};

