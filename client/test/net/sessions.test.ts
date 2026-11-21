import { describe, expect, it } from "vitest";
import { createClientSession, blendPosition, lerpAngle } from "@csarkosh/engine/net/client";
import { FakeNetwork } from "@csarkosh/engine/net/fakeNetwork";
import type { NetGame, SnapshotMover } from "@csarkosh/engine/net/game";
import { createHostSession } from "@csarkosh/engine/net/host";
import { PERFECT_NETWORK } from "@csarkosh/engine/net/transport";
import { MessageType } from "@csarkosh/engine/net/wire";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import type { InputCommand, Vec3 } from "@csarkosh/engine/sim/core";
import { collisionBoxes, parseLevel } from "@csarkosh/engine/sim/level";
import type { PlayerCore, Rules, SimWorld } from "@csarkosh/engine/sim/tick";

/**
 * The engine's two sessions under a game of a test's own: walkers on a flat floor who collect a
 * coin by pressing a button, a snapshot packed as text, one event of the game's own. Nothing
 * here is Day Hike's; what the sessions need of a game is all in the one record below.
 */
type Walker = PlayerCore & { coins: number };
type Yard = SimWorld<Walker> & { hostSteps: number };
type Shot = { tick: number; lastProcessedInput: number; players: (SnapshotMover & { pitch: number; coins: number })[]; hostSteps: number };
type Coin = { t: 200; entityId: number; coins: number };
type Frame = { me: number; players: Map<number, { pos: Vec3; coins: number }>; hostSteps: number };

const COIN = 1;
const LEVEL = parseLevel({
  id: "yard",
  brushes: [{ min: [-50, -1, -50], max: [50, 0, 50] }],
  playerSpawns: [[0, 0.9, 0], [3, 0.9, 0], [6, 0.9, 0]],
  enemySpawns: [],
});

const RULES: Rules<Yard, Walker> = {
  spawn: (world) => ({ pos: LEVEL.playerSpawns[world.state.players.size % 3] as Vec3, yaw: 0 }),
  newPlayer: (id, at) => ({ id, pos: { ...at.pos }, vel: { x: 0, y: 0, z: 0 }, yaw: at.yaw, pitch: 0, grounded: false, lastProcessedInput: 0, coins: 0 }),
  held: () => false,
  hostStep: (world) => {
    world.hostSteps++;
  },
};

const text = new TextEncoder();
const untext = new TextDecoder();
const pack = (type: number, value: unknown): ArrayBuffer => {
  const body = text.encode(JSON.stringify(value));
  const out = new Uint8Array(1 + body.length);
  out[0] = type;
  out.set(body, 1);
  return out.buffer;
};
const unpack = <T>(buffer: ArrayBuffer): T => JSON.parse(untext.decode(new Uint8Array(buffer, 1))) as T;

const YARD: NetGame<Yard, Walker, Shot, Frame, Coin> = {
  protocolVersion: 3,
  rules: RULES,
  encodeSnapshot: (shot) => pack(MessageType.Snapshot, shot),
  decodeSnapshot: (buffer) => unpack<Shot>(buffer),
  encodeEvent: (event) => pack(event.t, event),
  decodeEvent: (type, buffer) => (type === 200 ? unpack<Coin>(buffer) : null),
  snapshot: (world, lastProcessedInput) => ({
    tick: world.state.tick,
    lastProcessedInput,
    players: [...world.state.players.values()].map((p) => ({ id: p.id, pos: p.pos, vel: p.vel, yaw: p.yaw, pitch: p.pitch, grounded: p.grounded, coins: p.coins })),
    hostSteps: world.hostSteps,
  }),
  tracked: () => [],
  pressed: (_world, player, bits) => {
    if ((bits & COIN) === 0) return null;
    player.coins++;
    return { t: 200, entityId: player.id, coins: player.coins };
  },
  correct: (world, local, truth, shot) => {
    local.coins = truth.coins;
    world.hostSteps = shot.hostSteps;
  },
  blend: (a, b, alpha) => ({
    ...b,
    players: b.players.map((to) => {
      const from = a.players.find((p) => p.id === to.id);
      return from === undefined ? to : { ...to, pos: blendPosition(from.pos, to.pos, alpha), yaw: lerpAngle(from.yaw, to.yaw, alpha) };
    }),
  }),
  view: (world, localId, between, latest) => {
    const players = new Map<number, { pos: Vec3; coins: number }>();
    for (const p of between?.players ?? []) if (p.id !== localId) players.set(p.id, { pos: p.pos, coins: latest?.players.find((q) => q.id === p.id)?.coins ?? p.coins });
    const me = world.state.players.get(localId);
    if (me !== undefined) players.set(localId, { pos: me.pos, coins: me.coins });
    return { me: localId, players, hostSteps: latest?.hostSteps ?? 0 };
  },
};

const yard = (authoritative: boolean): Yard => ({
  state: { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: 1 },
  boxes: collisionBoxes(LEVEL), ground: null, forest: null, authoritative, waterLevel: null, hostSteps: 0,
});

const cmd = (seq: number, more: Partial<InputCommand> = {}): InputCommand => ({ seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...more });

function party(opts: { clientVersion?: number; expectedLevelId?: string } = {}) {
  const net = new FakeNetwork(PERFECT_NETWORK, 99);
  const [hostSide, clientSide] = net.createPair();
  const host = createHostSession(YARD, yard(true), () => net.now, { levelId: "yard/1" });
  const game = opts.clientVersion === undefined ? YARD : { ...YARD, protocolVersion: opts.clientVersion };
  const client = createClientSession(game, yard(false), clientSide, () => net.now, opts.expectedLevelId === undefined ? {} : { expectedLevelId: opts.expectedLevelId });
  const ends: string[] = [];
  client.onSessionEnd((end) => ends.push(end.kind));
  const peer = host.addPeer("p1", hostSide);
  net.advance(500);
  const play = (ticks: number, mine: (t: number) => InputCommand, hosts: (t: number) => InputCommand = (t) => cmd(t + 1)) => {
    for (let t = 0; t < ticks; t++) {
      client.tick(mine(t));
      host.tick(hosts(t));
      net.advance(TICK_DT * 1000);
    }
  };
  return { net, host, client, peer, ends, play };
}

describe("the engine's sessions under a game of a test's own", () => {
  it("welcomes a client under the id the host gave its player", () => {
    const p = party();
    expect([p.client.ready, p.client.localEntityId, p.peer, p.host.localEntityId, p.host.peerCount]).toEqual([true, 2, 2, 1, 1]);
    expect(p.client.localPlayer()?.coins).toBe(0);
  });

  it("turns away a client on another protocol, or expecting another world", () => {
    expect(party({ clientVersion: 4 }).ends).toEqual(["version_skew"]);
    expect(party({ expectedLevelId: "meadow/1" }).ends).toEqual(["version_skew"]);
    expect(party({ expectedLevelId: "yard/1" }).ends).toEqual([]);
  });

  it("moves the client's player on the host from the client's input, and the client predicts the same place", () => {
    const p = party();
    p.play(90, (t) => cmd(t + 1, { moveZ: 1 }));
    const onHost = p.host.world.state.players.get(p.peer);
    const predicted = p.client.localPlayer();
    expect(onHost?.pos.z).toBeGreaterThan(4);
    expect(Math.abs((predicted?.pos.z ?? 0) - (onHost?.pos.z ?? 0))).toBeLessThan(1);
    expect(p.client.stats.snapshotsReceived).toBeGreaterThan(20);
    expect(p.client.stats.lastPredictionError).toBeLessThan(0.05);
  });

  it("runs the game's own step on the host alone, and carries what the game puts in a snapshot to the client's view", () => {
    const p = party();
    p.play(60, (t) => cmd(t + 1));
    expect(p.host.world.hostSteps).toBe(60);
    const frame = p.client.renderState(p.net.now);
    expect(frame.me).toBe(2);
    expect(frame.hostSteps).toBeGreaterThan(50);
    expect([...frame.players.keys()].sort()).toEqual([1, 2]);
  });

  it("does what the game says a pressed button does, once a press, and says the game's event to whoever pressed", () => {
    const p = party();
    const heardByClient: Coin[] = [];
    const heardByHost: Coin[] = [];
    p.client.onGameEvent((event) => heardByClient.push(event));
    p.host.onGameEvent((event) => heardByHost.push(event));
    // Held for ten ticks: one press. Then let go and pressed again: a second.
    p.play(30, (t) => cmd(t + 1, { buttons: t < 10 || (t >= 15 && t < 20) ? COIN : 0 }), (t) => cmd(t + 1, { buttons: t === 5 ? COIN : 0 }));
    expect(heardByClient).toEqual([{ t: 200, entityId: 2, coins: 1 }, { t: 200, entityId: 2, coins: 2 }]);
    expect(heardByHost).toEqual([{ t: 200, entityId: 1, coins: 1 }]);
    // The host's word on the game's own field reaches the predicted player.
    expect(p.client.localPlayer()?.coins).toBe(2);
    expect(p.client.renderState(p.net.now).players.get(1)?.coins).toBe(1);
  });

  it("tells the others when a peer joins and leaves, and stops stepping the one who left", () => {
    const p = party();
    const [hostSide2, clientSide2] = p.net.createPair();
    const second = createClientSession(YARD, yard(false), clientSide2, () => p.net.now);
    const names: string[] = [];
    second.onNamed((named) => names.push(`${named.entityId}:${named.peerId}`));
    const id = p.host.addPeer("p2", hostSide2);
    p.net.advance(500);
    expect([id, second.localEntityId]).toEqual([3, 3]);
    expect(names.sort()).toEqual(["1:host", "2:p1", "3:p2"]);
    p.host.removePeer("p1");
    expect([p.host.peerCount, p.host.world.state.players.has(2)]).toEqual([1, false]);
  });
});
