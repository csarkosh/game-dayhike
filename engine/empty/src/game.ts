/**
 * The empty game as the page that runs a session is handed it
 * (`sessionGame.ts`): one definition of a game of nothing. Its world is the
 * engine's coast, its rules are walking, its renderer and its sound's bus
 * are the engine's with no parts and no voices of a game's, and its own half
 * of a session does nothing at every point the page calls it. A new game
 * starts from a copy of this and fills in what is its own.
 */
import { createAmbientAudio, noGameSound, type AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import { noParts, type NoPartsApi } from "@csarkosh/engine/game/lite/noParts";
import { createLiteRenderer } from "@csarkosh/engine/game/lite/renderer";
import type { ModeList } from "@csarkosh/engine/game/modeList";
import type { WorldRenderer } from "@csarkosh/engine/game/rendererTypes";
import type { SessionGame, SessionSide } from "@csarkosh/engine/game/sessionGame";
import { createClientSession, type ClientSession } from "@csarkosh/engine/net/client";
import { createHostSession, type HostSession } from "@csarkosh/engine/net/host";
import { NO_ACTIONS } from "@csarkosh/engine/sim/core";
import yard from "../levels/yard.json" with { type: "json" };
import { createWalkHud, type WalkHud } from "./hud.js";
import { WALK, type WalkSnapshot } from "./net.js";
import { createWalkWorld, type WalkState, type WalkWorld, type Walker } from "./sim.js";

export type WalkRenderer = WorldRenderer<WalkState> & NoPartsApi;
export type WalkHost = HostSession<WalkWorld, never>;
export type WalkClient = ClientSession<WalkWorld, Walker, WalkState, never>;

/** The one mode the empty game is played in. */
export const WALK_MODES: ModeList = {
  modes: [{ id: "walk", label: "Walk", line: "The world, and whoever is in it with you." }],
  initial: "walk",
  key: "empty.mode",
  restarts: "Picking another mode starts the world again.",
};

/** The empty game's own half of a session: nothing, at every point the page calls. */
export const WALK_SIDE: SessionSide<WalkWorld, WalkState, Walker, WalkRenderer, WalkHost, WalkClient> = {
  atRest: () => undefined,
  hostStarted: () => undefined,
  worldIn: () => undefined,
  hears: () => undefined,
  matchStarted: () => undefined,
  dispose: () => undefined,
  beforeTicks: () => undefined,
  command: (sample) => sample,
  beforeSync: () => undefined,
  sound: () => undefined,
  lampOn: () => false,
  afterSync: () => undefined,
  report: () => undefined,
  decided: () => false,
  over: () => false,
  holdsFrame: () => false,
  progress: () => 0,
  matchEnd: () => ({}),
  entities: (state) => state.players.size,
  applyOwnView: () => false,
  buildExtras: () => undefined,
  disposeExtras: () => undefined,
  extrasStand: () => false,
};

export const EMPTY_GAME: SessionGame<WalkWorld, WalkState, Walker, WalkRenderer, AmbientAudio, WalkHud, WalkHost, WalkClient> = {
  /** A forest world carries a level of its own with no brushes; this is the least the parser takes. */
  level: yard as unknown,
  modes: WALK_MODES,
  actions: NO_ACTIONS,
  /** Nowhere of the game's own: the players stand where the rules' spiral finds dry ground. */
  startOf: () => null,
  weatherIsOwn: () => false,
  renderer: (canvas, level, forest, options) => createLiteRenderer<WalkState, Walker, NoPartsApi>(canvas, level, forest, options, noParts),
  audio: () => createAmbientAudio(noGameSound),
  hud: createWalkHud,
  side: () => WALK_SIDE,
  host: (_level, _seed, clock, o) => createHostSession(WALK, createWalkWorld(o.forest, true), clock, { levelId: o.forest.levelId, hostPeerId: o.hostPeerId }),
  join: (_level, _seed, transport, clock, o) => createClientSession(WALK, createWalkWorld(o.forest, false), transport, clock, { expectedLevelId: o.expectedLevelId }),
};

export type { WalkSnapshot };
