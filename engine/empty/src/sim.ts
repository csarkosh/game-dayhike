/**
 * The empty game's simulation: a world with nothing in it but its players,
 * and the rules of a game with none beyond walking. The engine's tick moves
 * the players over the ground, through the forest and round the lakes; no one
 * is held still, nothing limits a move, and the host has no step of its own.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { cloneVec3 } from "@csarkosh/engine/sim/core";
import type { Forest } from "@csarkosh/engine/sim/forest";
import { createGroundField } from "@csarkosh/engine/sim/ground";
import { spiralSpawn } from "@csarkosh/engine/sim/spawnGround";
import { activeTerrainVariant } from "@csarkosh/engine/sim/terrain";
import type { PlayerCore, Rules, SimState, SimWorld } from "@csarkosh/engine/sim/tick";

/** A player: what the engine moves, and nothing of a game's beside it. */
export type Walker = PlayerCore;
/** The state: the tick, the players, and the two counters every state carries. */
export type WalkState = SimState<Walker>;
/** The world: the state, the ground and the forest it is walked on. */
export type WalkWorld = SimWorld<Walker> & { forest: Forest };

/**
 * Where the search for a first place to stand begins. Every peer walks the
 * same spiral out from it to the first place a hull stands free, above the
 * sea and off a lake's bed, so all agree with nothing exchanged.
 */
export const WALK_FROM = { x: 0.5, z: 0.5 };

export const WALK_RULES: Rules<WalkWorld, Walker> = {
  spawn: (world) => ({ pos: spiralSpawn(world.boxes, world.forest.seed, PLAYER_HALF, WALK_FROM), yaw: 0 }),
  newPlayer: (id, at) => ({ id, pos: cloneVec3(at.pos), vel: { x: 0, y: 0, z: 0 }, yaw: at.yaw, pitch: 0, grounded: false, lastProcessedInput: 0 }),
  held: () => false,
  hostStep: () => undefined,
};

/** A world on `forest`: the host's own, or a client's predicted copy. */
export function createWalkWorld(forest: Forest, authoritative: boolean): WalkWorld {
  return {
    state: { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: forest.seed | 0 },
    boxes: forest.grid,
    ground: createGroundField(forest.seed, null),
    forest,
    authoritative,
    waterLevel: activeTerrainVariant().waterLevel ?? null,
  };
}
