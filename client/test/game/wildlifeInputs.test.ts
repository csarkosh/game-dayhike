import { describe, expect, it } from "vitest";
import { AiState, Outcome, Phase, type EnemyState, type PlayerState, type WorldState } from "../../src/sim/types.js";
import { createWildlifeInputs } from "../../src/game/wildlifeInputs.js";
import type { WildlifeEvent } from "../../src/game/wildlifeBehaviour.js";

function player(id: number, x: number, z: number): PlayerState {
  return {
    id, pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100, grounded: true, lastProcessedInput: 0,
    deathPos: null, killedBy: 0, returnIn: 0, heldFor: 0, out: false, cause: 0, lamp: { on: false, charge: 1 }, stare: 0, safe: false,
  };
}
function enemy(id: number, x: number, z: number, ai: AiState): EnemyState {
  return {
    id, pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, health: 40, ai,
    targetId: 0, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0,
    route: [], routeAt: 0, approach: false, seen: false, emergeTo: null, stalks: false, fork: -1, forkEdge: -1,
  };
}
function state(players: PlayerState[], enemies: EnemyState[] = []): WorldState {
  return {
    tick: 7, players: new Map(players.map((p) => [p.id, p])), enemies: new Map(enemies.map((e) => [e.id, e])),
    outcome: Outcome.Playing, phase: Phase.Climb, nextEntityId: 100, rngSeed: 1,
  };
}

describe("what the wildlife is handed each frame", () => {
  it("lists the players' places in one reused list of reused points", () => {
    const inputs = createWildlifeInputs();
    const first = inputs.players(state([player(1, 3, 4), player(2, 5, 6)]));
    expect(first).toEqual([{ x: 3, z: 4 }, { x: 5, z: 6 }]);
    const point = first[0];
    const second = inputs.players(state([player(9, -1, -2)]));
    expect(second).toBe(first);
    expect(second).toEqual([{ x: -1, z: -2 }]);
    expect(second[0]).toBe(point);
  });

  it("fills the director's view and match: the nearest Hollow's distance, and whether that one hunts", () => {
    const inputs = createWildlifeInputs();
    const world = state([player(1, 0, 0)], [enemy(5, 30, 40, AiState.Hunt), enemy(6, 6, 8, AiState.Stand), enemy(7, 1, 1, AiState.Shade)]);
    inputs.look(world, 0, 1.6, 0, 0.5, -0.1, 1.2, 1.5, 21, 0.3);
    expect(inputs.director.view).toEqual({ x: 0, y: 1.6, z: 0, yaw: 0.5, pitch: -0.1, fov: 1.2, aspect: 1.5 });
    // A shade is no Hollow; the nearer of the two that are stands, so nothing hunts.
    expect(inputs.director.match).toEqual({ phase: Phase.Climb, hollowDistance: 10, hollowHunting: false, inWorld: true, hour: 21, mist: 0.3 });
    inputs.findHollow(state([player(1, 0, 0)], [enemy(5, 3, 4, AiState.Hunt)]), 0, 0);
    expect([inputs.director.match.hollowDistance, inputs.director.match.hollowHunting]).toEqual([5, true]);
    inputs.findHollow(state([player(1, 0, 0)]), 0, 0);
    expect([inputs.director.match.hollowDistance, inputs.director.match.hollowHunting]).toEqual([Infinity, false]);
  });

  it("drains a frame's events into one reused list and empties their source", () => {
    const inputs = createWildlifeInputs();
    const source = [{ kind: "flee" }, { kind: "call" }] as unknown as WildlifeEvent[];
    const drained = inputs.drain(source);
    expect(drained.length).toBe(2);
    expect(source.length).toBe(0);
    expect(inputs.drain(source)).toBe(drained);
    expect(drained.length).toBe(0);
    expect(inputs.drain(undefined).length).toBe(0);
  });
});
