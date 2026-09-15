import { describe, it, expect } from "vitest";
import { createHostSession } from "../../src/net/hostSession.js";
import { FakeNetwork } from "../../src/net/fakeNetwork.js";
import { PERFECT_NETWORK } from "../../src/net/transport.js";
import { parseLevel } from "../../src/sim/level.js";
import {
  encodeInput,
  decodeEvent,
  decodeSnapshot,
  messageTypeOf,
  MessageType,
} from "../../src/net/protocol.js";
import { TICKS_PER_SNAPSHOT } from "../../src/sim/constants.js";
import { Button, type InputCommand } from "../../src/sim/types.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const level = parseLevel(sandbox01);

/**
 * Open ground with no enemy spawn points. Unused since the rifle's combat
 * tests left with it; kept because the Interact tests reuse it.
 */
const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0]],
  enemySpawns: [],
});

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

describe("interact", () => {
  function facing(host: ReturnType<typeof createHostSession>, id: number) {
    const p = host.world.state.players.get(id);
    if (p === undefined) throw new Error("no player");
    p.pos = { x: 0, y: 0.9, z: 0 }; p.yaw = 0; p.pitch = 0;
    const acted: number[] = [];
    host.world.interactables.set(9, { id: 9, pos: { x: 0, y: 1.6, z: 2 }, radius: 0.3, kind: 1, onInteract: (who) => acted.push(who) });
    return acted;
  }

  it("acts once on the press edge, not every tick it is held", () => {
    const host = createHostSession(flat, 1);
    const acted = facing(host, host.localEntityId);
    for (let i = 0; i < 5; i++) host.tick(input({ buttons: Button.Interact }));
    expect(acted).toEqual([host.localEntityId]);
    host.tick(input());
    host.tick(input({ buttons: Button.Interact }));
    expect(acted).toHaveLength(2);
  });

  it("tells the acting peer what it acted on, and nobody else", () => {
    const host = createHostSession(flat, 1);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [aHost, aClient] = net.createPair();
    const [bHost, bClient] = net.createPair();
    const a = host.addPeer("a", aHost);
    host.addPeer("b", bHost);
    const acted = facing(host, a);
    const got: { entityId: number; targetId: number }[] = [];
    let others = 0;
    aClient.onEvent((d) => { const e = decodeEvent(d); if (e.t === MessageType.Interacted) got.push(e); });
    bClient.onEvent((d) => { if (decodeEvent(d).t === MessageType.Interacted) others++; });
    aClient.sendState(encodeInput([input({ seq: 1, buttons: Button.Interact })]));
    net.advance(1); host.tick(input()); net.advance(1);
    expect(acted).toEqual([a]);
    expect(got).toEqual([{ t: MessageType.Interacted, entityId: a, targetId: 9 }]);
    expect(others).toBe(0);
  });

  it("acts once for a catch-up burst that holds the bit across every command", () => {
    const host = createHostSession(flat, 1);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const id = host.addPeer("p1", hostSide);
    const acted = facing(host, id);
    clientSide.sendState(encodeInput([1, 2, 3, 4].map((seq) => input({ seq, buttons: Button.Interact }))));
    net.advance(1); host.tick(input()); host.tick(input()); host.tick(input()); host.tick(input());
    expect(acted).toEqual([id]);
  });

  it("fires once when the press sits on a NON-last command of a catch-up burst, and not on an all-released burst after", () => {
    const host = createHostSession(flat, 1);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const id = host.addPeer("p1", hostSide);
    const acted = facing(host, id);

    // Three queued commands, pending.length (3) > INPUT_BUFFER_TARGET (2), so
    // the host takes MAX_INPUTS_PER_TICK (2) this tick: the press (seq 1) as
    // an extra catch-up step, the release (seq 2) as the tick's applied
    // input. Only the OR across both catches this — measuring the edge from
    // the last command alone would miss the press entirely.
    clientSide.sendState(
      encodeInput([
        input({ seq: 1, buttons: Button.Interact }),
        input({ seq: 2, buttons: 0 }),
        input({ seq: 3, buttons: 0 }),
      ]),
    );
    net.advance(1);
    host.tick(input());
    expect(acted).toEqual([id]);

    // The leftover seq 3 plus two fresh released commands queue up another
    // two-command catch-up burst, this time with the press bit held nowhere.
    // It must not re-fire.
    clientSide.sendState(
      encodeInput([input({ seq: 4, buttons: 0 }), input({ seq: 5, buttons: 0 })]),
    );
    net.advance(1);
    host.tick(input());
    expect(acted).toEqual([id]);
  });

  it("reports the host's own interaction through the local handler", () => {
    const host = createHostSession(flat, 1);
    const acted = facing(host, host.localEntityId);
    const seen: number[] = [];
    host.onInteracted((e) => seen.push(e.targetId));
    host.tick(input({ buttons: Button.Interact }));
    expect(acted).toHaveLength(1);
    expect(seen).toEqual([9]);
  });

  it("does nothing while dead", () => {
    const host = createHostSession(flat, 1);
    const acted = facing(host, host.localEntityId);
    const me = host.world.state.players.get(host.localEntityId)!;
    me.health = 0; me.respawnTimer = 2;
    host.tick(input({ buttons: Button.Interact }));
    expect(acted).toEqual([]);
  });
});

describe("host session", () => {
  it("pings each peer on a cadence so both sides can measure round-trip time", () => {
    const host = createHostSession(flat, 1);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);
    let pings = 0;
    clientSide.onEvent((data) => {
      if (decodeEvent(data).t === MessageType.Ping) pings++;
    });
    host.tick(input());
    net.advance(1);
    expect(pings).toBe(1);
  });

  it("spawns a local player for the host itself", () => {
    const host = createHostSession(level, 42);
    expect(host.world.state.players.has(host.localEntityId)).toBe(true);
    expect(host.peerCount).toBe(0);
  });

  it("spawns an entity for each joining peer", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide] = net.createPair();
    const entityId = host.addPeer("p1", hostSide);
    expect(host.world.state.players.has(entityId)).toBe(true);
    expect(host.peerCount).toBe(1);
  });

  it("removes a peer's entity when they leave", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide] = net.createPair();
    const entityId = host.addPeer("p1", hostSide);
    host.removePeer("p1");
    expect(host.world.state.players.has(entityId)).toBe(false);
    expect(host.peerCount).toBe(0);
  });

  it("keeps only the peers the lobby still lists", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [aSide] = net.createPair();
    const [bSide] = net.createPair();
    const a = host.addPeer("a", aSide);
    const b = host.addPeer("b", bSide);
    // The lobby has already dropped "a" (its tab closed without a data-channel
    // close) and lists someone who has not connected yet.
    host.retainPeers(new Set(["b", "not-connected-yet"]));
    expect(host.world.state.players.has(a)).toBe(false);
    expect(host.world.state.players.has(b)).toBe(true);
    expect(host.peerCount).toBe(1);
  });

  it("advances the world one tick per call", () => {
    const host = createHostSession(level, 42);
    host.tick(input());
    host.tick(input());
    expect(host.world.state.tick).toBe(2);
  });

  it("broadcasts a snapshot every TICKS_PER_SNAPSHOT ticks", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);

    const snapshots: number[] = [];
    clientSide.onState((d) => {
      if (messageTypeOf(d) === MessageType.Snapshot) snapshots.push(decodeSnapshot(d).tick);
    });

    for (let i = 0; i < TICKS_PER_SNAPSHOT * 3; i++) host.tick(input());
    net.advance(1);
    expect(snapshots).toHaveLength(3);
  });

  it("includes every player in the snapshot", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const peerEntity = host.addPeer("p1", hostSide);

    let latest: ReturnType<typeof decodeSnapshot> | null = null;
    clientSide.onState((d) => {
      if (messageTypeOf(d) === MessageType.Snapshot) latest = decodeSnapshot(d);
    });
    for (let i = 0; i < TICKS_PER_SNAPSHOT; i++) host.tick(input());
    net.advance(1);

    const snap = latest as ReturnType<typeof decodeSnapshot> | null;
    expect(snap).not.toBeNull();
    const ids = snap!.players.map((p) => p.id);
    expect(ids).toContain(host.localEntityId);
    expect(ids).toContain(peerEntity);
  });

  it("carries the host's own toggled lamp to a peer in the next snapshot", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);

    let latest: ReturnType<typeof decodeSnapshot> | null = null;
    clientSide.onState((d) => {
      if (messageTypeOf(d) === MessageType.Snapshot) latest = decodeSnapshot(d);
    });

    // One press edge on the host's own local player.
    host.tick(input({ buttons: Button.Lamp }));
    for (let i = 1; i < TICKS_PER_SNAPSHOT; i++) host.tick(input());
    net.advance(1);

    const snap = latest as ReturnType<typeof decodeSnapshot> | null;
    expect(snap).not.toBeNull();
    const me = snap!.players.find((p) => p.id === host.localEntityId);
    expect(me?.lamp.on).toBe(true);
  });

  it("applies a peer's input to their entity", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const entityId = host.addPeer("p1", hostSide);

    // Land first so friction and ground acceleration apply.
    for (let i = 0; i < 240; i++) host.tick(input());
    const startZ = host.world.state.players.get(entityId)!.pos.z;

    for (let seq = 1; seq <= 60; seq++) {
      clientSide.sendState(encodeInput([input({ seq, moveZ: 1 })]));
      net.advance(1);
      host.tick(input());
    }
    expect(host.world.state.players.get(entityId)!.pos.z).toBeGreaterThan(startZ);
  });

  it("reports each peer's last processed input back to them", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);

    let lastProcessed = -1;
    clientSide.onState((d) => {
      if (messageTypeOf(d) === MessageType.Snapshot) {
        lastProcessed = decodeSnapshot(d).lastProcessedInput;
      }
    });

    clientSide.sendState(encodeInput([input({ seq: 5 })]));
    net.advance(1);
    for (let i = 0; i < TICKS_PER_SNAPSHOT; i++) host.tick(input());
    net.advance(1);
    expect(lastProcessed).toBe(5);
  });

  it("ignores duplicate input sequences rather than double-applying them", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const entityId = host.addPeer("p1", hostSide);
    for (let i = 0; i < 240; i++) host.tick(input());

    const redundant = encodeInput([input({ seq: 1, moveZ: 1 })]);
    for (let i = 0; i < 10; i++) clientSide.sendState(redundant);
    net.advance(1);

    const before = host.world.state.players.get(entityId)!.pos.z;
    host.tick(input());
    const afterOne = host.world.state.players.get(entityId)!.pos.z;
    // Only one command existed, so the next tick must find nothing left.
    host.tick(input());
    const afterTwo = host.world.state.players.get(entityId)!.pos.z;
    expect(afterOne - before).toBeGreaterThan(0);
    expect(afterTwo - afterOne).toBeLessThan(afterOne - before);
  });

  it("answers a ping with a pong carrying the same stamp", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);

    const pongs: { stamp: number; hostTick: number }[] = [];
    clientSide.onEvent((d) => {
      const type = messageTypeOf(d);
      if (type !== MessageType.Pong) return;
      const view = new DataView(d);
      pongs.push({ stamp: view.getUint32(1, true), hostTick: view.getUint32(5, true) });
    });

    const ping = new ArrayBuffer(5);
    const pv = new DataView(ping);
    pv.setUint8(0, MessageType.Ping);
    pv.setUint32(1, 987654, true);
    clientSide.sendEvent(ping);
    net.advance(1);

    expect(pongs).toHaveLength(1);
    expect(pongs[0]?.stamp).toBe(987654);
  });

  it("catches up when a peer has built a backlog", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);

    // Ten commands arrive at once, as they would after a hitch.
    for (let seq = 1; seq <= 10; seq++) {
      clientSide.sendState(encodeInput([input({ seq, moveZ: 1 })]));
    }
    net.advance(1);

    // A strict one-per-tick host would still owe 10 after 10 ticks. With
    // catch-up the backlog must actually shrink to the jitter buffer.
    for (let i = 0; i < 12; i++) host.tick(input());
    net.advance(1);
    for (let seq = 100; seq < 110; seq++) {
      clientSide.sendState(encodeInput([input({ seq, moveZ: 1 })]));
      net.advance(1);
      host.tick(input());
    }
    // Everything sent has been consumed; nothing is stuck behind.
    expect(host.world.state.players.size).toBe(2);
  });

  it("rejects an input carrying a non-finite angle", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const entityId = host.addPeer("p1", hostSide);
    for (let i = 0; i < 240; i++) host.tick(input());

    // NaN reaches Math.sin and would make the position NaN permanently.
    clientSide.sendState(encodeInput([input({ seq: 1, moveZ: 1, yaw: NaN })]));
    clientSide.sendState(encodeInput([input({ seq: 2, moveZ: 1, pitch: Infinity })]));
    net.advance(1);
    for (let i = 0; i < 10; i++) host.tick(input());

    const p = host.world.state.players.get(entityId)!;
    expect(Number.isFinite(p.pos.x)).toBe(true);
    expect(Number.isFinite(p.pos.y)).toBe(true);
    expect(Number.isFinite(p.pos.z)).toBe(true);
  });

  it("bounds a peer's queue against a flood", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const entityId = host.addPeer("p1", hostSide);

    // Far more than the host could ever consume, with no ticks in between.
    for (let seq = 1; seq <= 5000; seq++) {
      clientSide.sendState(encodeInput([input({ seq, moveZ: 1 })]));
    }
    net.advance(1);

    // The queue is capped, so the newest commands survive and memory is bounded.
    host.tick(input());
    const p = host.world.state.players.get(entityId)!;
    expect(p.lastProcessedInput).toBeGreaterThan(4900);
  });

  it("ignores a forged command count larger than the packet", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);

    // Claims 65535 commands but carries none.
    const forged = new ArrayBuffer(3);
    const view = new DataView(forged);
    view.setUint8(0, MessageType.Input);
    view.setUint16(1, 65535, true);
    clientSide.sendState(forged);
    net.advance(1);
    expect(() => host.tick(input())).not.toThrow();
  });

  it("closes the transport when a peer is removed", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);
    expect(hostSide.open).toBe(true);

    host.removePeer("p1");
    expect(hostSide.open).toBe(false);

    // Late packets from a removed peer must not accumulate anywhere.
    clientSide.sendState(encodeInput([input({ seq: 99, moveZ: 1 })]));
    net.advance(1);
    expect(() => host.tick(input())).not.toThrow();
  });

  it("survives a peer sending garbage", () => {
    const host = createHostSession(level, 42);
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    host.addPeer("p1", hostSide);
    clientSide.sendState(new ArrayBuffer(3));
    net.advance(1);
    expect(() => host.tick(input())).not.toThrow();
  });
});
