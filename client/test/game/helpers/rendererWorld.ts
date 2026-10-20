/**
 * The world the tests that build a whole renderer hand it: a hand-authored
 * level with nothing in it, and a state of players standing in it. Made for
 * the wind test in `renderer.test.ts`; the files beside it that build
 * renderers by the lake and the sea read the same.
 */
import type { Level } from "../../../src/sim/level.js";
import { Outcome, Phase, type PlayerState, type WorldState } from "../../../src/sim/types.js";

/** A hand-authored level with nothing in it: `forest: null` keeps the forest,
 * clutter and mist shells out of the renderer this fixture builds, so the
 * wind test only has to reckon with what it actually reads. */
export const EMPTY_LEVEL: Level = { id: "wind-test", brushes: [], playerSpawns: [], enemySpawns: [] };

export function windTestPlayer(id: number): PlayerState {
  return {
    id,
    pos: { x: id, y: 0.9, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 100,
    grounded: true,
    lastProcessedInput: 0,
    deathPos: null,
    lamp: { on: false, charge: 1 },
    stare: 0,
    safe: false,
  };
}

export function windTestState(...players: PlayerState[]): WorldState {
  return {
    tick: 1,
    players: new Map(players.map((p) => [p.id, p])),
    enemies: new Map(),
    outcome: Outcome.Playing,
    phase: Phase.Climb,
    nextEntityId: 10,
    rngSeed: 1,
  };
}
