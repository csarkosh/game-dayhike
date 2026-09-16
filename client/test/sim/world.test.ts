import { describe, it, expect } from "vitest";
import {
  createWorld,
  spawnPlayer,
  removePlayer,
  tickWorld,
  cloneWorldState,
  serializeWorldState,
} from "../../src/sim/world.js";
import { collisionBoxes, parseLevel } from "../../src/sim/level.js";
import { AiState, NO_ITEM, Outcome, type InputCommand, type ItemState } from "../../src/sim/types.js";
import { PLAYER_MAX_HEALTH } from "../../src/sim/constants.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const level = parseLevel(sandbox01);

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

describe("world lifecycle", () => {
  it("starts empty at tick 0", () => {
    const w = createWorld(level, 1234);
    expect(w.state.tick).toBe(0);
    expect(w.state.players.size).toBe(0);
    // `boxes` is a BoxProvider, so it has no `.length` in general — a generated
    // world answers region queries instead of holding an array. For a
    // hand-authored level it is still the derived brush list, and asserting
    // equality with that is stronger than the length check this replaced.
    expect(w.boxes).toEqual(collisionBoxes(level));
  });

  it("spawns players with unique ids at level spawn points", () => {
    const w = createWorld(level, 1234);
    const a = spawnPlayer(w);
    const b = spawnPlayer(w);
    expect(a.id).not.toBe(b.id);
    expect(a.health).toBe(PLAYER_MAX_HEALTH);
    expect(w.state.players.size).toBe(2);
    const spawnYs = level.playerSpawns.map((s) => s.y);
    expect(spawnYs).toContain(a.pos.y);
  });

  it("cycles spawn points so five players do not stack", () => {
    const w = createWorld(level, 1234);
    const spawns = Array.from({ length: 5 }, () => spawnPlayer(w));
    const keys = new Set(spawns.map((p) => `${p.pos.x},${p.pos.z}`));
    expect(keys.size).toBe(5);
  });

  it("removes players", () => {
    const w = createWorld(level, 1234);
    const p = spawnPlayer(w);
    removePlayer(w, p.id);
    expect(w.state.players.size).toBe(0);
  });
});

describe("tick", () => {
  it("advances the tick counter", () => {
    const w = createWorld(level, 1234);
    tickWorld(w, new Map());
    tickWorld(w, new Map());
    expect(w.state.tick).toBe(2);
  });

  it("applies gravity to a player with no input", () => {
    const w = createWorld(level, 1234);
    const p = spawnPlayer(w);
    const startY = p.pos.y;
    for (let i = 0; i < 10; i++) tickWorld(w, new Map());
    expect(w.state.players.get(p.id)!.pos.y).toBeLessThan(startY);
  });

  it("records the last processed input sequence", () => {
    const w = createWorld(level, 1234);
    const p = spawnPlayer(w);
    tickWorld(w, new Map([[p.id, input({ seq: 42 })]]));
    expect(w.state.players.get(p.id)!.lastProcessedInput).toBe(42);
  });

  it("copies look angles from input onto the player", () => {
    const w = createWorld(level, 1234);
    const p = spawnPlayer(w);
    tickWorld(w, new Map([[p.id, input({ yaw: 1.25, pitch: -0.5 })]]));
    const after = w.state.players.get(p.id)!;
    expect(after.yaw).toBeCloseTo(1.25, 9);
    expect(after.pitch).toBeCloseTo(-0.5, 9);
  });

  it("ignores input for players that do not exist", () => {
    const w = createWorld(level, 1234);
    expect(() => tickWorld(w, new Map([[999, input()]]))).not.toThrow();
  });

  it("lands a spawned player on the platform below the spawn point", () => {
    const w = createWorld(level, 1234);
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map());
    const after = w.state.players.get(p.id)!;
    expect(after.grounded).toBe(true);
    expect(after.pos.y).toBeGreaterThan(0);
  });
});

describe("clone and serialize", () => {
  it("clones deeply so mutating the copy leaves the original alone", () => {
    const w = createWorld(level, 1234);
    const p = spawnPlayer(w);
    const copy = cloneWorldState(w.state);
    copy.players.get(p.id)!.pos.x = 999;
    expect(w.state.players.get(p.id)!.pos.x).not.toBe(999);
  });

  it("serializes identical states identically", () => {
    const w = createWorld(level, 1234);
    spawnPlayer(w);
    const copy = cloneWorldState(w.state);
    expect(serializeWorldState(copy)).toBe(serializeWorldState(w.state));
  });

  it("serializes different states differently", () => {
    const w = createWorld(level, 1234);
    const p = spawnPlayer(w);
    const before = serializeWorldState(w.state);
    tickWorld(w, new Map([[p.id, input({ moveZ: 1 })]]));
    expect(serializeWorldState(w.state)).not.toBe(before);
  });
});

describe("determinism", () => {
  // The single most important test in the project. If this fails, client
  // prediction silently breaks and the symptom in-game is unexplained
  // rubber-banding that is very hard to trace back to here.
  it("two worlds fed identical inputs stay byte-identical for 600 ticks", () => {
    const a = createWorld(level, 987654);
    const b = createWorld(level, 987654);
    const pa = spawnPlayer(a);
    const pb = spawnPlayer(b);
    expect(pa.id).toBe(pb.id);

    for (let t = 0; t < 600; t++) {
      const cmd = input({
        seq: t,
        moveX: Math.sin(t * 0.11) > 0 ? 1 : -1,
        moveZ: Math.cos(t * 0.07) > 0 ? 1 : 0,
        yaw: t * 0.013,
        buttons: t % 47 === 0 ? 2 : 0,
      });
      tickWorld(a, new Map([[pa.id, cmd]]));
      tickWorld(b, new Map([[pb.id, cmd]]));
    }

    expect(serializeWorldState(a.state)).toBe(serializeWorldState(b.state));
  });

  it("diverges when seeds differ, proving the fingerprint is sensitive", () => {
    const a = createWorld(level, 1);
    const b = createWorld(level, 2);
    spawnPlayer(a);
    spawnPlayer(b);
    a.state.rngSeed = 111;
    b.state.rngSeed = 222;
    expect(serializeWorldState(a.state)).not.toBe(serializeWorldState(b.state));
  });
});

describe("items in world state", () => {
  const item = (): ItemState => ({ id: 0, pos: { x: 1, y: 2, z: 3 }, carrier: 0, pickedUp: false, signedOut: false });

  it("starts with no items, a playing outcome and empty hands", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    expect(w.state.items).toEqual([]);
    expect(w.state.outcome).toBe(Outcome.Playing);
    expect(p.carrying).toBe(NO_ITEM);
    expect(p.signOutTicks).toBe(0);
  });

  it("clones items deeply and fingerprints them", () => {
    const w = createWorld(level, 1);
    w.state.items = [item()];
    const copy = cloneWorldState(w.state);
    copy.items[0]!.pos.x = 99;
    copy.items[0]!.pickedUp = true;
    expect(w.state.items[0]!.pos.x).toBe(1);
    expect(w.state.items[0]!.pickedUp).toBe(false);
    expect(serializeWorldState(copy)).not.toBe(serializeWorldState(w.state));
    expect(serializeWorldState(w.state)).toContain("I0:1,2,3,0,0,0");
  });

  it("fingerprints the carry fields and the outcome", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    const before = serializeWorldState(w.state);
    p.carrying = 2;
    expect(serializeWorldState(w.state)).not.toBe(before);
    p.carrying = NO_ITEM;
    p.signOutTicks = 7;
    expect(serializeWorldState(w.state)).not.toBe(before);
    p.signOutTicks = 0;
    w.state.outcome = Outcome.Won;
    expect(serializeWorldState(w.state)).not.toBe(before);
  });
});

describe("the stare and the graph", () => {
  it("starts with an empty stare and no sign-out, and fingerprints the stare", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    expect(p.stare).toBe(0);
    expect(p.signedOut).toBe(false);
    expect(w.trail).toBeNull();
    const before = serializeWorldState(w.state);
    p.stare = 0.5;
    expect(serializeWorldState(w.state)).not.toBe(before);
    expect(serializeWorldState(w.state)).toContain(",0.5");
  });

  it("clones a Hollow's route as its own array", () => {
    const w = createWorld(level, 1);
    w.state.enemies.set(9, {
      id: 9, pos: { x: 1, y: 2, z: 3 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, health: 40, ai: AiState.Crawl,
      targetId: 0, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0,
      route: [0, 1, 2], routeAt: 1, stemDir: -1, approach: false, seen: false,
    });
    const copy = cloneWorldState(w.state);
    copy.enemies.get(9)!.route.push(3);
    expect(w.state.enemies.get(9)!.route).toEqual([0, 1, 2]);
  });
});
