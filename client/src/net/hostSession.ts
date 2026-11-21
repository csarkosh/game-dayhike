/**
 * Day Hike's host session: the engine's (`@csarkosh/engine/net/host`) over a hike's world, with
 * the game's own event heard as it always was.
 */
import type { Level } from "@csarkosh/engine/sim/level";
import type { Forest } from "@csarkosh/engine/sim/forest";
import { createHostSession as createEngineHost, type HostSession as EngineHost } from "@csarkosh/engine/net/host";
import { createForestWorld, createWorld, type World } from "../sim/world.js";
import { DAYHIKE } from "./dayhikeGame.js";
import type { Interacted } from "./protocol.js";

export type InteractedHandler = (e: { entityId: number; targetId: number }) => void;

export type HostSession = EngineHost<World, Interacted> & {
  onInteracted(handler: InteractedHandler): void;
};

export function createHostSession(
  level: Level,
  seed: number,
  clock: () => number = () => performance.now(),
  opts: { forest?: Forest | null; hostPeerId?: string; peaceful?: boolean } = {},
): HostSession {
  const { forest = null, hostPeerId = "host", peaceful = false } = opts;
  // A forest world's `level.id` is the versioned generator identity, which is
  // what a client must match to be let in (`Welcome.levelId`).
  const world = forest === null ? createWorld(level, seed) : createForestWorld(forest, true, peaceful);
  const session = createEngineHost(DAYHIKE, world, clock, { levelId: world.level.id, hostPeerId });
  return Object.assign(session, {
    onInteracted(handler: InteractedHandler): void {
      session.onGameEvent(handler);
    },
  });
}
