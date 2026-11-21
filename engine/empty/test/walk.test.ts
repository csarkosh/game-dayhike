import { describe, expect, it } from "vitest";
import "../src/terrain.js";
import { createClientSession } from "@csarkosh/engine/net/client";
import { FakeNetwork } from "@csarkosh/engine/net/fakeNetwork";
import { createHostSession } from "@csarkosh/engine/net/host";
import { PERFECT_NETWORK } from "@csarkosh/engine/net/transport";
import { MessageType, POSITION_PRECISION } from "@csarkosh/engine/net/wire";
import { PLAYER_HALF, TICK_DT } from "@csarkosh/engine/sim/constants";
import type { InputCommand } from "@csarkosh/engine/sim/core";
import { createForest } from "@csarkosh/engine/sim/forest";
import { activeTerrainVariant, elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { addPlayer } from "@csarkosh/engine/sim/tick";
import { MOVER_BYTES, WALK, WALK_PROTOCOL, decodeWalkSnapshot, encodeWalkSnapshot, type WalkSnapshot } from "../src/net.js";
import { WALK_RULES, createWalkWorld } from "../src/sim.js";

/**
 * The empty game on the engine alone: its world is the engine's coast with no place laid over
 * it, its rules are walking, and two peers walk it together through the engine's own sessions.
 * Nothing here is a game's but the few records the empty game hands the engine.
 */

const SEED = 20261121;
const cmd = (seq: number, more: Partial<InputCommand> = {}): InputCommand => ({ seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...more });

describe("the empty game's world", () => {
  it("is the engine's coast with no trail, no road's start and no place of a game's", () => {
    const variant = activeTerrainVariant();
    expect(variant.trailGraph?.(SEED)).toBeUndefined();
    expect(typeof variant.waterLevel).toBe("number");
  });

  it("stands its players on dry ground, the same place on every peer", () => {
    const forest = createForest(SEED);
    const host = createWalkWorld(forest, true);
    const predicted = createWalkWorld(forest, false);
    const a = addPlayer(host, WALK_RULES);
    const b = addPlayer(predicted, WALK_RULES);
    expect(a.pos).toEqual(b.pos);
    const ground = elevationSampleAt(SEED, a.pos.x, a.pos.z).h;
    expect(a.pos.y).toBeCloseTo(ground + PLAYER_HALF.y, 9);
    expect(ground).toBeGreaterThan((host.waterLevel ?? -Infinity) + 2 - 1e-9);
    expect([a.id, a.yaw, a.pitch, a.grounded, a.lastProcessedInput]).toEqual([1, 0, 0, false, 0]);
    expect(host.state).toEqual({ tick: 0, players: new Map([[1, a]]), nextEntityId: 2, rngSeed: SEED | 0 });
  });
});

describe("the empty game's snapshot", () => {
  const shot: WalkSnapshot = {
    tick: 123456,
    lastProcessedInput: 987,
    players: [
      { id: 1, pos: { x: 10.25, y: 31.5, z: -400.125 }, vel: { x: 1.5, y: -2.25, z: 0 }, yaw: Math.PI / 2, pitch: -0.5, grounded: true },
      { id: 5, pos: { x: -3000.007, y: 0.9, z: 7 }, vel: { x: 0, y: 0, z: 4 }, yaw: 6, pitch: 1.2, grounded: false },
    ],
  };

  it("is packed under the wire's snapshot type, in a fixed size a player", () => {
    const bytes = encodeWalkSnapshot(shot);
    expect(new Uint8Array(bytes)[0]).toBe(MessageType.Snapshot);
    expect(bytes.byteLength).toBe(10 + 2 * MOVER_BYTES);
    expect(MOVER_BYTES).toBe(24);
  });

  it("comes back as it went, to the wire's precision", () => {
    const back = decodeWalkSnapshot(encodeWalkSnapshot(shot));
    expect([back.tick, back.lastProcessedInput, back.players.length]).toEqual([123456, 987, 2]);
    shot.players.forEach((p, i) => {
      const q = back.players[i];
      if (q === undefined) throw new Error("a player is missing");
      expect([q.id, q.grounded]).toEqual([p.id, p.grounded]);
      for (const axis of ["x", "y", "z"] as const) {
        expect(Math.abs(q.pos[axis] - p.pos[axis])).toBeLessThanOrEqual(POSITION_PRECISION / 2);
        expect(Math.abs(q.vel[axis] - p.vel[axis])).toBeLessThanOrEqual(POSITION_PRECISION / 2);
      }
      expect(Math.abs(q.yaw - p.yaw)).toBeLessThan(0.001);
      expect(Math.abs(q.pitch - p.pitch)).toBeLessThan(0.02);
    });
  });

  it("refuses bytes that are not one", () => {
    expect(() => decodeWalkSnapshot(new ArrayBuffer(3))).toThrow(/not a snapshot/);
    const cut = encodeWalkSnapshot(shot).slice(0, 20);
    expect(() => decodeWalkSnapshot(cut)).toThrow(/wrong length/);
  });
});

describe("two peers in the empty game", () => {
  function party() {
    const forest = createForest(SEED);
    const net = new FakeNetwork(PERFECT_NETWORK, 7);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(WALK, createWalkWorld(forest, true), () => net.now, { levelId: forest.levelId, hostPeerId: "host" });
    const client = createClientSession(WALK, createWalkWorld(forest, false), clientSide, () => net.now, { expectedLevelId: forest.levelId });
    const ends: string[] = [];
    client.onSessionEnd((end) => ends.push(end.kind));
    const peer = host.addPeer("p1", hostSide);
    net.advance(500);
    const play = (ticks: number, mine: (t: number) => InputCommand): void => {
      for (let t = 0; t < ticks; t++) {
        client.tick(mine(t));
        host.tick(cmd(t + 1));
        net.advance(TICK_DT * 1000);
      }
    };
    return { net, host, client, peer, ends, play };
  }

  it("are welcomed into one world, each under an id of its own", () => {
    const p = party();
    expect(p.ends).toEqual([]);
    expect([p.client.ready, p.host.localEntityId, p.peer, p.client.localEntityId, p.host.peerCount]).toEqual([true, 1, 2, 2, 1]);
    expect(WALK.protocolVersion).toBe(WALK_PROTOCOL);
  });

  it("walk: the follower's steps move its player on the host, and the follower predicts the same place", () => {
    const p = party();
    const before = { ...(p.host.world.state.players.get(p.peer)?.pos ?? { x: 0, y: 0, z: 0 }) };
    p.play(120, (t) => cmd(t + 1, { moveZ: 1 }));
    const onHost = p.host.world.state.players.get(p.peer);
    const predicted = p.client.localPlayer();
    if (onHost === undefined || predicted === undefined) throw new Error("the follower's player is missing");
    expect(Math.hypot(onHost.pos.x - before.x, onHost.pos.z - before.z)).toBeGreaterThan(2);
    expect(Math.hypot(predicted.pos.x - onHost.pos.x, predicted.pos.z - onHost.pos.z)).toBeLessThan(1);
    expect(p.client.stats.snapshotsReceived).toBeGreaterThan(20);
    expect(p.client.stats.lastPredictionError).toBeLessThan(0.05);
  });

  it("see each other: a frame on the follower's side is drawn from a state that holds both", () => {
    const p = party();
    p.play(60, (t) => cmd(t + 1));
    const frame = p.client.renderState(p.net.now);
    expect([...frame.players.keys()].sort()).toEqual([1, 2]);
    expect(frame.players.get(2)).toBe(p.client.localPlayer());
    const hostThere = p.host.world.state.players.get(1);
    const hostSeen = frame.players.get(1);
    if (hostThere === undefined || hostSeen === undefined) throw new Error("the host's player is missing");
    expect(Math.hypot(hostSeen.pos.x - hostThere.pos.x, hostSeen.pos.z - hostThere.pos.z)).toBeLessThan(0.5);
  });
});
