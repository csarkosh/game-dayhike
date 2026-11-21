import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { AiState, Outcome, Phase, type EnemyState, type PlayerState, type WorldState } from "../../src/sim/types.js";
import { createWildlifeInputs, type MatchReader } from "../../src/game/wildlifeInputs.js";
import { readHikeMatch } from "../../src/game/hikeWildlife.js";
import type { WildlifeEvent } from "@csarkosh/engine/game/wildlifeBehaviour";

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
    route: [], routeAt: 0, approach: false, seen: false, emergeTo: null, stalks: false, waylay: 0,
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
    const inputs = createWildlifeInputs<WorldState>();
    const first = inputs.players(state([player(1, 3, 4), player(2, 5, 6)]));
    expect(first).toEqual([{ x: 3, z: 4 }, { x: 5, z: 6 }]);
    const point = first[0];
    const second = inputs.players(state([player(9, -1, -2)]));
    expect(second).toBe(first);
    expect(second).toEqual([{ x: -1, z: -2 }]);
    expect(second[0]).toBe(point);
  });

  it("with no reader leaves the match at rest and still fills the view", () => {
    const inputs = createWildlifeInputs<WorldState>();
    const world = state([player(1, 0, 0)], [enemy(5, 3, 4, AiState.Hunt)]);
    inputs.look(world, 0, 1.6, 0, 0.5, -0.1, 1.2, 1.5, 21, 0.3);
    expect(inputs.director.view).toEqual({ x: 0, y: 1.6, z: 0, yaw: 0.5, pitch: -0.1, fov: 1.2, aspect: 1.5 });
    expect(inputs.director.match).toEqual({ phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 21, mist: 0.3 });
  });

  it("calls a reader once per look, with the state, the view's x and z and the director's match, after the view and before the rest", () => {
    const calls: unknown[][] = [];
    const read: MatchReader<WorldState> = (s, x, z, match) => {
      calls.push([s, x, z, match]);
      // What the reader sees of the frame so far: the view is filled, the rest is not yet written.
      calls.push([{ ...inputs.director.view }, { inWorld: match.inWorld, hour: match.hour, mist: match.mist }]);
      match.phase = 9;
      match.hollowDistance = 2;
      match.hollowHunting = true;
    };
    const inputs = createWildlifeInputs<WorldState>(read);
    inputs.director.match.inWorld = false;
    const world = state([player(1, 0, 0)]);
    inputs.look(world, 3, 1.6, 4, 0.5, -0.1, 1.2, 1.5, 21, 0.3);
    expect(calls.length).toBe(2);
    expect(calls[0]?.[0]).toBe(world);
    expect([calls[0]?.[1], calls[0]?.[2]]).toEqual([3, 4]);
    expect(calls[0]?.[3]).toBe(inputs.director.match);
    expect(calls[1]).toEqual([{ x: 3, y: 1.6, z: 4, yaw: 0.5, pitch: -0.1, fov: 1.2, aspect: 1.5 }, { inWorld: false, hour: 0, mist: 0 }]);
    expect(inputs.director.match).toEqual({ phase: 9, hollowDistance: 2, hollowHunting: true, inWorld: true, hour: 21, mist: 0.3 });
  });

  it("Day Hike's reader writes the nearest Hollow's distance, whether that one hunts, and the phase", () => {
    const inputs = createWildlifeInputs(readHikeMatch);
    const world = state([player(1, 0, 0)], [enemy(5, 30, 40, AiState.Hunt), enemy(6, 6, 8, AiState.Stand), enemy(7, 1, 1, AiState.Shade)]);
    inputs.look(world, 0, 1.6, 0, 0.5, -0.1, 1.2, 1.5, 21, 0.3);
    expect(inputs.director.view).toEqual({ x: 0, y: 1.6, z: 0, yaw: 0.5, pitch: -0.1, fov: 1.2, aspect: 1.5 });
    // A shade is no Hollow; the nearer of the two that are stands, so nothing hunts.
    expect(inputs.director.match).toEqual({ phase: Phase.Climb, hollowDistance: 10, hollowHunting: false, inWorld: true, hour: 21, mist: 0.3 });
    readHikeMatch(state([player(1, 0, 0)], [enemy(5, 3, 4, AiState.Hunt)]), 0, 0, inputs.director.match);
    expect([inputs.director.match.hollowDistance, inputs.director.match.hollowHunting]).toEqual([5, true]);
    readHikeMatch(state([player(1, 0, 0)]), 0, 0, inputs.director.match);
    expect([inputs.director.match.hollowDistance, inputs.director.match.hollowHunting]).toEqual([Infinity, false]);
  });

  it("drains a frame's events into one reused list and empties their source", () => {
    const inputs = createWildlifeInputs<WorldState>();
    const source = [{ kind: "flee" }, { kind: "call" }] as unknown as WildlifeEvent[];
    const drained = inputs.drain(source);
    expect(drained.length).toBe(2);
    expect(source.length).toBe(0);
    expect(inputs.drain(source)).toBe(drained);
    expect(drained.length).toBe(0);
    expect(inputs.drain(undefined).length).toBe(0);
  });
});
