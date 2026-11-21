import { describe, expect, it } from "vitest";
import type { InputCommand, Vec3 } from "@csarkosh/engine/sim/core";
import { collisionBoxes, parseLevel } from "@csarkosh/engine/sim/level";
import { addPlayer, applyInput, removePlayer, tickPlayers, type PlayerCore, type Rules, type SimWorld } from "@csarkosh/engine/sim/tick";

/**
 * The engine's tick under a game of a test's own: a flat floor, players who only walk, one
 * field of their own (`tag`), and a host step that counts. What any game hands the engine is
 * its rules; nothing here is Day Hike's.
 */
type Walker = PlayerCore & { tag: string; frozen: boolean };
type Yard = SimWorld<Walker> & { hostSteps: number; seenAtHostStep: number[]; fence: number | null };

const LEVEL = parseLevel({
  id: "yard",
  brushes: [{ min: [-50, -1, -50], max: [50, 0, 50] }],
  playerSpawns: [[0, 0.9, 0], [3, 0.9, 0]],
  enemySpawns: [],
});

const RULES: Rules<Yard, Walker> = {
  spawn: (world) => ({ pos: LEVEL.playerSpawns[world.state.players.size % 2] as Vec3, yaw: 0.5 }),
  newPlayer: (id, at) => ({
    id, pos: { ...at.pos }, vel: { x: 0, y: 0, z: 0 }, yaw: at.yaw, pitch: 0, grounded: false, lastProcessedInput: 0, tag: `walker ${id}`, frozen: false,
  }),
  held: (player) => player.frozen,
  constrain: (world, pos, vel) => {
    if (world.fence !== null && pos.z > world.fence) {
      pos.z = world.fence;
      vel.z = 0;
    }
  },
  hostStep: (world) => {
    world.hostSteps++;
    world.seenAtHostStep = [...world.state.players.values()].map((p) => p.pos.z);
  },
};

function yard(authoritative = true): Yard {
  return {
    state: { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: 7 },
    boxes: collisionBoxes(LEVEL), ground: null, forest: null, authoritative, waterLevel: null,
    hostSteps: 0, seenAtHostStep: [], fence: null,
  };
}

const forward = (seq: number, more: Partial<InputCommand> = {}): InputCommand => ({ seq, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0, ...more });

describe("the engine's tick under a game's rules", () => {
  it("adds a player where the rules say, with the fields the rules give it, under the next entity id", () => {
    const world = yard();
    const a = addPlayer(world, RULES);
    const b = addPlayer(world, RULES);
    expect([a.id, b.id, world.state.nextEntityId]).toEqual([1, 2, 3]);
    expect([a.pos, b.pos]).toEqual([{ x: 0, y: 0.9, z: 0 }, { x: 3, y: 0.9, z: 0 }]);
    expect([a.yaw, a.tag, b.tag]).toEqual([0.5, "walker 1", "walker 2"]);
    expect(world.state.players.get(2)).toBe(b);
    removePlayer(world, 1);
    expect([...world.state.players.keys()]).toEqual([2]);
  });

  it("moves each player by its command, counts the tick and acknowledges the command", () => {
    const world = yard();
    const a = addPlayer(world, RULES);
    const b = addPlayer(world, RULES);
    for (let t = 1; t <= 60; t++) tickPlayers(world, new Map([[a.id, forward(t)]]), RULES);
    expect(world.state.tick).toBe(60);
    expect(a.pos.z).toBeGreaterThan(3);
    expect(a.lastProcessedInput).toBe(60);
    // The one with no command stands, settles onto the floor, and acknowledges nothing new.
    expect([b.pos.x, b.pos.z, b.lastProcessedInput, b.grounded]).toEqual([3, 0, 0, true]);
  });

  it("lets a held player look and not move", () => {
    const world = yard();
    const a = addPlayer(world, RULES);
    for (let t = 1; t <= 30; t++) tickPlayers(world, new Map([[a.id, forward(t)]]), RULES);
    const stood = { ...a.pos };
    a.frozen = true;
    tickPlayers(world, new Map([[a.id, forward(31, { yaw: 1.25, pitch: -0.5 })]]), RULES);
    expect(a.pos).toEqual(stood);
    expect(a.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect([a.yaw, a.pitch, a.lastProcessedInput]).toEqual([1.25, -0.5, 31]);
  });

  it("holds a move to what the rules allow, inside the step", () => {
    const world = yard();
    world.fence = 1;
    const a = addPlayer(world, RULES);
    for (let t = 1; t <= 120; t++) tickPlayers(world, new Map([[a.id, forward(t)]]), RULES);
    expect(a.pos.z).toBe(1);
  });

  it("runs the game's own step on the host alone, after every player has moved", () => {
    const host = yard(true);
    const a = addPlayer(host, RULES);
    tickPlayers(host, new Map([[a.id, forward(1)]]), RULES);
    expect(host.hostSteps).toBe(1);
    expect(host.seenAtHostStep).toEqual([a.pos.z]);
    const predicted = yard(false);
    const mine = addPlayer(predicted, RULES);
    tickPlayers(predicted, new Map([[mine.id, forward(1)]]), RULES);
    expect(predicted.hostSteps).toBe(0);
    // A client predicts the same move its host computes.
    expect(mine.pos).toEqual(a.pos);
  });

  it("applies one command to one player outside the tick, as a host does for a late input", () => {
    const world = yard();
    const a = addPlayer(world, RULES);
    const tick = world.state.tick;
    applyInput(world, a.id, forward(9, { yaw: 0.75 }), RULES);
    expect([world.state.tick, a.lastProcessedInput, a.yaw]).toEqual([tick, 9, 0.75]);
    a.frozen = true;
    const stood = { ...a.pos };
    applyInput(world, a.id, forward(10, { yaw: 2 }), RULES);
    expect([a.pos, a.yaw, a.lastProcessedInput]).toEqual([stood, 2, 10]);
    applyInput(world, 404, forward(11), RULES);
  });
});
