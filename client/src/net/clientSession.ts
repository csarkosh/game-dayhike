/**
 * Day Hike's client session: the engine's (`@csarkosh/engine/net/client`) over a hike's
 * predicted world, with the game's own event heard as it always was.
 */
import type { Level } from "@csarkosh/engine/sim/level";
import type { Forest } from "@csarkosh/engine/sim/forest";
import type { Transport } from "@csarkosh/engine/net/transport";
import { createClientSession as createEngineClient, type ClientSession as EngineClient } from "@csarkosh/engine/net/client";
import type { PlayerState, WorldState } from "../sim/types.js";
import { createForestWorld, createWorld, type World } from "../sim/world.js";
import { DAYHIKE } from "./dayhikeGame.js";
import type { Interacted } from "./protocol.js";

export { blendPosition, classifyLevelMismatch, type NamedHandler, type NetStats, type SessionEnd } from "@csarkosh/engine/net/client";

export type InteractedHandler = (e: { entityId: number; targetId: number }) => void;

export type ClientSession = EngineClient<World, PlayerState, WorldState, Interacted> & {
  onInteracted(handler: InteractedHandler): void;
};

export function createClientSession(
  level: Level,
  seed: number,
  transport: Transport,
  clock: () => number,
  opts: { expectedLevelId?: string; forest?: Forest | null; peaceful?: boolean } = {},
): ClientSession {
  const { expectedLevelId, forest = null, peaceful = false } = opts;
  // The predicted world holds ONLY the local player. Remote entities are
  // interpolated from snapshots instead: the client has no authority over
  // them and cannot predict them correctly. Non-authoritative, so it never
  // runs the spawn director, enemy AI, or respawn timers.
  const predicted: World = forest === null ? createWorld(level, seed, false) : createForestWorld(forest, false, peaceful);
  const session = createEngineClient(DAYHIKE, predicted, transport, clock, expectedLevelId === undefined ? {} : { expectedLevelId });
  return Object.assign(session, {
    onInteracted(handler: InteractedHandler): void {
      session.onGameEvent((event) => handler({ entityId: event.entityId, targetId: event.targetId }));
    },
  });
}
