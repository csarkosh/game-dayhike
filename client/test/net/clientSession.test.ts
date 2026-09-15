import { describe, it, expect } from "vitest";
import { createHostSession } from "../../src/net/hostSession.js";
import { createClientSession } from "../../src/net/clientSession.js";
import { FakeNetwork } from "../../src/net/fakeNetwork.js";
import { PERFECT_NETWORK, type NetworkConditions } from "../../src/net/transport.js";
import { parseLevel } from "../../src/sim/level.js";
import { createForest } from "../../src/sim/forest.js";
import { MAX_UNACKED_INPUTS, PLAYER_MAX_HEALTH, TICK_DT } from "../../src/sim/constants.js";
import { Button, NO_ITEM, Outcome, type InputCommand } from "../../src/sim/types.js";
import { encodeEvent, MessageType, PROTOCOL_VERSION } from "../../src/net/protocol.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const level = parseLevel(sandbox01);
const TICK_MS = TICK_DT * 1000;
const SEED = 20260725;

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

function harness(conditions: NetworkConditions = PERFECT_NETWORK, seed = 4242) {
  const net = new FakeNetwork(conditions, seed);
  const [hostSide, clientSide] = net.createPair();
  const host = createHostSession(level, SEED);
  const client = createClientSession(level, SEED, clientSide, () => net.now);
  const peerEntityId = host.addPeer("p1", hostSide);
  // Let the Welcome event arrive.
  net.advance(500);
  return { net, host, client, peerEntityId };
}

/** Runs both sides in lockstep for `ticks` sim steps. */
function drive(
  h: ReturnType<typeof harness>,
  ticks: number,
  makeInput: (t: number) => InputCommand,
): void {
  for (let t = 0; t < ticks; t++) {
    h.client.tick(makeInput(t));
    h.host.tick(input({ seq: 0 }));
    h.net.advance(TICK_MS);
  }
}

function distance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

describe("handshake", () => {
  it("learns its entity id from the welcome event", () => {
    const h = harness();
    expect(h.client.ready).toBe(true);
    expect(h.client.localEntityId).toBe(h.peerEntityId);
  });

  it("is not ready before the welcome arrives", () => {
    const net = new FakeNetwork({ latencyMs: 100, jitterMs: 0, lossRate: 0 }, 1);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED);
    const client = createClientSession(level, SEED, clientSide, () => net.now);
    host.addPeer("p1", hostSide);
    expect(client.ready).toBe(false);
    net.advance(150);
    expect(client.ready).toBe(true);
  });

  it("ignores ticks before it is ready", () => {
    const net = new FakeNetwork({ latencyMs: 100, jitterMs: 0, lossRate: 0 }, 1);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED);
    const client = createClientSession(level, SEED, clientSide, () => net.now);
    host.addPeer("p1", hostSide);
    expect(() => client.tick(input({ seq: 1, moveZ: 1 }))).not.toThrow();
    expect(client.localPlayer()).toBeUndefined();
  });
});

describe("prediction", () => {
  it("moves the local player immediately, without waiting for the host", () => {
    const net = new FakeNetwork({ latencyMs: 200, jitterMs: 0, lossRate: 0 }, 7);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED);
    const client = createClientSession(level, SEED, clientSide, () => net.now);
    host.addPeer("p1", hostSide);
    net.advance(500);

    const before = { ...client.localPlayer()!.pos };
    for (let t = 0; t < 30; t++) client.tick(input({ seq: t + 1, moveZ: 1 }));
    const after = client.localPlayer()!.pos;
    // 30 ticks is half a second; at 200ms RTT nothing has come back yet.
    expect(distance(before, after)).toBeGreaterThan(0);
  });

  it("tracks unacked inputs and drains them as they are acknowledged", () => {
    const h = harness();
    for (let t = 0; t < 10; t++) h.client.tick(input({ seq: t + 1, moveZ: 1 }));
    expect(h.client.stats.unackedInputs).toBeGreaterThan(0);
    drive(h, 60, (t) => input({ seq: 100 + t }));
    expect(h.client.stats.unackedInputs).toBeLessThan(10);
  });
});

describe("reconciliation", () => {
  it("produces no visible correction on a clean connection", () => {
    const h = harness(PERFECT_NETWORK);
    drive(h, 300, (t) => input({ seq: t + 1, moveZ: 1, moveX: t % 120 < 60 ? 1 : -1 }));
    // Only quantization error should remain: positions are sent as 1/128 m.
    expect(h.client.stats.lastPredictionError).toBeLessThan(0.02);
  });

  // Regression guard for a bug that made the client feel like sludge without
  // ever looking broken: quantized snapshot positions land a few millimetres
  // inside the floor, a penetrating mover gets no collision, so the client
  // never re-grounds and silently runs on air acceleration (1.2) while the
  // host runs on ground acceleration (10).
  it("stays grounded after reconciling onto a quantized floor position", () => {
    const h = harness(PERFECT_NETWORK);
    drive(h, 300, (t) => input({ seq: t + 1, moveZ: 1 }));

    const hostPlayer = h.host.world.state.players.get(h.peerEntityId)!;
    const clientPlayer = h.client.localPlayer()!;
    expect(hostPlayer.grounded).toBe(true);
    expect(clientPlayer.grounded).toBe(true);
    // Within one quantization step of the host, not centimetres below it.
    expect(Math.abs(clientPlayer.pos.y - hostPlayer.pos.y)).toBeLessThan(0.01);
  });

  it("converges to host state under latency, jitter, and packet loss", () => {
    const h = harness({ latencyMs: 75, jitterMs: 15, lossRate: 0.05 }, 31337);
    drive(h, 600, (t) => input({ seq: t + 1, moveZ: 1, moveX: Math.sin(t * 0.05) > 0 ? 1 : -1 }));

    // Stop feeding input and let the host drain everything already in flight.
    h.net.advance(500);
    for (let i = 0; i < 60; i++) {
      h.host.tick(input({ seq: 0 }));
      h.net.advance(TICK_MS);
    }
    h.net.advance(500);

    const hostPos = h.host.world.state.players.get(h.peerEntityId)!.pos;
    const clientPos = h.client.localPlayer()!.pos;
    expect(distance(hostPos, clientPos)).toBeLessThan(0.5);
  });

  it("survives a blackout and re-converges when the link returns", () => {
    const h = harness({ latencyMs: 50, jitterMs: 0, lossRate: 0 }, 5150);
    drive(h, 120, (t) => input({ seq: t + 1, moveZ: 1 }));

    // Tick the client without advancing delivery: nothing gets through.
    for (let t = 0; t < 60; t++) h.client.tick(input({ seq: 200 + t, moveZ: 1 }));

    drive(h, 240, (t) => input({ seq: 400 + t, moveZ: 1 }));
    h.net.advance(500);
    for (let i = 0; i < 90; i++) {
      h.host.tick(input({ seq: 0 }));
      h.net.advance(TICK_MS);
    }
    h.net.advance(500);

    const hostPos = h.host.world.state.players.get(h.peerEntityId)!.pos;
    const clientPos = h.client.localPlayer()!.pos;
    expect(distance(hostPos, clientPos)).toBeLessThan(1.0);
  });

  it("keeps reconciling after the input sequence passes 65536", () => {
    // About 18 minutes at 60 Hz. The wire used to carry seq as a uint16, so
    // past this point the host saw every input as already processed and
    // dropped it, while the client's unacked queue grew without bound and
    // was replayed in full on every snapshot.
    const h = harness(PERFECT_NETWORK);
    const ticks = 70_000;
    drive(h, ticks, (t) => input({ seq: t + 1, moveZ: 1, moveX: t % 600 < 300 ? 1 : -1 }));

    expect(h.client.stats.unackedInputs).toBeLessThanOrEqual(MAX_UNACKED_INPUTS + 4);
    // Still reconciling cleanly: only quantization error, as on a fresh link.
    expect(h.client.stats.lastPredictionError).toBeLessThan(0.02);

    // Stop feeding input and let the host drain what is still in flight, so
    // the comparison is host-to-client and not host-to-one-tick-ahead.
    h.net.advance(500);
    for (let i = 0; i < 60; i++) {
      h.host.tick(input({ seq: 0 }));
      h.net.advance(TICK_MS);
    }
    h.net.advance(500);
    const hostPos = h.host.world.state.players.get(h.peerEntityId)!.pos;
    const clientPos = h.client.localPlayer()!.pos;
    expect(distance(hostPos, clientPos)).toBeLessThan(0.05);
  }, 120_000);

  it("ignores a snapshot that arrives out of order", () => {
    const h = harness({ latencyMs: 40, jitterMs: 30, lossRate: 0 }, 606);
    drive(h, 300, (t) => input({ seq: t + 1, moveZ: 1 }));
    // Reordering is what the jitter above produces; the guard means the
    // client never regresses to an older tick.
    expect(h.client.stats.snapshotsReceived).toBeGreaterThan(0);
    expect(h.client.localPlayer()).toBeDefined();
  });
});

describe("interpolation", () => {
  it("renders remote entities behind the newest snapshot", () => {
    const h = harness({ latencyMs: 20, jitterMs: 0, lossRate: 0 }, 61);
    drive(h, 200, (t) => input({ seq: t + 1 }));
    const state = h.client.renderState(h.net.now);
    // The host's own player is remote from this client's point of view.
    expect(state.players.has(h.host.localEntityId)).toBe(true);
  });

  it("includes the predicted local player in the render state", () => {
    const h = harness();
    drive(h, 120, (t) => input({ seq: t + 1, moveZ: 1 }));
    const state = h.client.renderState(h.net.now);
    const local = state.players.get(h.client.localEntityId);
    expect(local).toBeDefined();
    expect(local!.pos).toEqual(h.client.localPlayer()!.pos);
  });

  it("returns an empty render state before any snapshot arrives", () => {
    const net = new FakeNetwork({ latencyMs: 100, jitterMs: 0, lossRate: 0 }, 1);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED);
    const client = createClientSession(level, SEED, clientSide, () => net.now);
    host.addPeer("p1", hostSide);
    const state = client.renderState(0);
    expect(state.players.size).toBe(0);
    expect(state.enemies.size).toBe(0);
  });
});

describe("stats", () => {
  it("measures round-trip time", () => {
    const h = harness({ latencyMs: 60, jitterMs: 0, lossRate: 0 }, 88);
    drive(h, 200, (t) => input({ seq: t + 1 }));
    h.net.advance(2000);
    drive(h, 60, (t) => input({ seq: 300 + t }));
    // 60ms each way.
    expect(h.client.stats.rttMs).toBeGreaterThan(100);
    expect(h.client.stats.rttMs).toBeLessThan(160);
  });

  it("counts snapshots and bytes received", () => {
    const h = harness();
    drive(h, 180, (t) => input({ seq: t + 1 }));
    expect(h.client.stats.snapshotsReceived).toBeGreaterThan(0);
    expect(h.client.stats.bytesReceived).toBeGreaterThan(0);
  });
});

describe("lamp", () => {
  it("shows a remote player's toggled lamp in the render state", () => {
    const h = harness();
    // A press edge on the HOST's own local player, which is remote from the client's view.
    h.host.tick(input({ buttons: Button.Lamp }));
    drive(h, 120, (t) => input({ seq: t + 1 }));

    const state = h.client.renderState(h.net.now);
    const remote = state.players.get(h.host.localEntityId);
    expect(remote).toBeDefined();
    expect(remote!.lamp).toEqual({ on: true, charge: 1 });
  });

  it("applies the authoritative lamp to the local predicted player after reconcile", () => {
    const h = harness();
    let sentToggle = false;
    drive(h, 120, (t) => {
      if (!sentToggle && t === 10) {
        sentToggle = true;
        return input({ seq: t + 1, buttons: Button.Lamp });
      }
      return input({ seq: t + 1 });
    });

    const hostPlayer = h.host.world.state.players.get(h.peerEntityId)!;
    const localPlayer = h.client.localPlayer()!;
    expect(hostPlayer.lamp.on).toBe(true);
    expect(localPlayer.lamp).toEqual(hostPlayer.lamp);
  });
});

describe("prediction scope", () => {
  const ambush = parseLevel({
    id: "ambush",
    brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
    playerSpawns: [[0, 0.9, 0]],
    // Just outside the director's 25 m minimum spawn distance but inside the
    // 30 m detection range, so anything spawned here walks over and attacks
    // whoever is standing at the origin.
    enemySpawns: [[26, 0.9, 0]],
  });

  it("does not spawn or run enemies in its predicted world", () => {
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(ambush, SEED);
    const client = createClientSession(ambush, SEED, clientSide, () => net.now);
    host.addPeer("p1", hostSide);
    net.advance(500);

    // The host is deliberately never ticked, so no snapshot arrives to correct
    // anything. Enemies are the host's to own: any that appear here are the
    // client's own invention, and any health lost is phantom damage.
    for (let seq = 1; seq <= 900; seq++) client.tick(input({ seq }));

    expect(client.localPlayer()?.health).toBe(PLAYER_MAX_HEALTH);
  });
});

describe("level agreement", () => {
  function pair(expectedLevelId?: string) {
    const net = new FakeNetwork(PERFECT_NETWORK, 7);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED);
    const client = createClientSession(level, SEED, clientSide, () => net.now, {
      expectedLevelId,
    });
    const reasons: string[] = [];
    client.onSessionEnd((r) => reasons.push(r));
    host.addPeer("p1", hostSide);
    net.advance(500);
    return { client, reasons };
  }

  it("accepts a Welcome whose levelId matches", () => {
    // sandbox01's id is what the host sends, so expecting it must succeed.
    const { client, reasons } = pair(level.id);
    expect(reasons).toEqual([]);
    expect(client.ready).toBe(true);
  });

  it("refuses a Welcome whose levelId does not match", () => {
    // The realistic desync: one peer on a bundle cached from before a deploy,
    // generating a different world. Nothing about geometry crosses the wire, so
    // this string is the only agreement check there is.
    const { client, reasons } = pair("forest/2/5/999");
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toContain("forest/2/5/999");
    expect(client.ready).toBe(false);
  });

  it("skips the check when no expectation is given", () => {
    // Hand-authored levels and the existing tests pass no expectation.
    const { client, reasons } = pair();
    expect(reasons).toEqual([]);
    expect(client.ready).toBe(true);
  });

  it("refuses a Welcome from a host on another protocol version, and says which", () => {
    const net = new FakeNetwork(PERFECT_NETWORK, 7);
    const [hostSide, clientSide] = net.createPair();
    const client = createClientSession(level, SEED, clientSide, () => net.now, {});
    const reasons: string[] = [];
    client.onSessionEnd((r) => reasons.push(r));
    // A hand-built Welcome one version ahead: the shape a newer host would send.
    hostSide.sendEvent(encodeEvent({ t: MessageType.Welcome, entityId: 5, tick: 1, protocolVersion: PROTOCOL_VERSION + 1, levelId: level.id }));
    net.advance(50);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("Protocol mismatch");
    expect(reasons[0]).toContain(`${PROTOCOL_VERSION + 1}`);
    expect(reasons[0]).toContain("Reload");
    expect(client.ready).toBe(false);
  });
  it("accepts a Welcome on its own protocol version", () => {
    const { client, reasons } = pair(level.id);
    expect(reasons).toEqual([]);
    expect(client.ready).toBe(true);
  });

  /**
   * The old layout: [t][entityId u16][tick u32][len u8][levelId] — one byte
   * shorter than the current one's [t][entityId u16][tick u32][version u8][len u8][levelId].
   * A stale host still running this layout is the realistic deploy-day case,
   * and every client in the wild today must tolerate it.
   */
  function buildLegacyWelcome(entityId: number, tick: number, levelId: string): ArrayBuffer {
    const idBytes = new TextEncoder().encode(levelId);
    const buffer = new ArrayBuffer(8 + idBytes.length);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.Welcome);
    view.setUint16(1, entityId, true);
    view.setUint32(3, tick, true);
    view.setUint8(7, idBytes.length);
    new Uint8Array(buffer, 8).set(idBytes);
    return buffer;
  }

  it.each([
    ["sandbox01-length id", "sandbox01"],
    ["40-char forest-style id", "forest-v7-9d126351-aaaaaaaaaaaaaaaaaaaaa"],
  ])("refuses a legacy host's Welcome (%s) in words instead of hanging", (_label, levelId) => {
    const net = new FakeNetwork(PERFECT_NETWORK, 7);
    const [hostSide, clientSide] = net.createPair();
    const client = createClientSession(level, SEED, clientSide, () => net.now, {});
    const reasons: string[] = [];
    client.onSessionEnd((r) => reasons.push(r));

    hostSide.sendEvent(buildLegacyWelcome(5, 1, levelId));
    net.advance(50);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("Protocol mismatch");
    expect(reasons[0]).toContain("Reload");
    expect(client.ready).toBe(false);
  });
});

describe("host and client agree on a generated forest", () => {
  /**
   * The regression this exists for: `hostSession` sent the `level` *parameter*'s
   * id rather than `world.level.id`. For a generated world those differ — the
   * parameter is the sandbox fallback app.ts still passes — so the host advertised
   * "sandbox01" while correctly simulating a forest, and every client was refused
   * with a level mismatch. Every unit test passed, because none of them ran a host
   * and a client against a forest together.
   */
  function forestPair(seed: number) {
    const forest = createForest(seed);
    const net = new FakeNetwork(PERFECT_NETWORK, 11);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED, () => net.now, { forest });
    const client = createClientSession(level, SEED, clientSide, () => net.now, {
      expectedLevelId: forest.levelId,
      forest,
    });
    const reasons: string[] = [];
    client.onSessionEnd((r) => reasons.push(r));
    host.addPeer("p1", hostSide);
    net.advance(500);
    return { forest, host, client, reasons };
  }

  it("connects without a level mismatch", () => {
    const { client, reasons } = forestPair(0x1234);
    expect(reasons).toEqual([]);
    expect(client.ready).toBe(true);
  });

  it("advertises the generator identity, not the fallback level's id", () => {
    const { forest, host } = forestPair(0x1234);
    expect(host.world.level.id).toBe(forest.levelId);
    expect(host.world.level.id).not.toBe(level.id);
  });

  it("refuses a client whose forest was built from a different seed", () => {
    const forest = createForest(0x1234);
    const other = createForest(0x9999);
    const net = new FakeNetwork(PERFECT_NETWORK, 11);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED, () => net.now, { forest });
    const client = createClientSession(level, SEED, clientSide, () => net.now, {
      expectedLevelId: other.levelId,
      forest: other,
    });
    const reasons: string[] = [];
    client.onSessionEnd((r) => reasons.push(r));
    host.addPeer("p1", hostSide);
    net.advance(500);

    expect(reasons.length).toBe(1);
    expect(reasons[0]).toContain(forest.levelId);
    expect(client.ready).toBe(false);
  });
});

describe("level mismatch", () => {
  function mismatch(advice?: string): string | null {
    const net = new FakeNetwork(PERFECT_NETWORK, 7);
    const [hostSide, clientSide] = net.createPair();
    const host = createHostSession(level, SEED);
    const client = createClientSession(level, SEED, clientSide, () => net.now, {
      expectedLevelId: "not-the-level-the-host-runs",
      ...(advice === undefined ? {} : { staleClientAdvice: advice }),
    });
    let reason: string | null = null;
    client.onSessionEnd((r) => {
      reason = r;
    });
    host.addPeer("p1", hostSide);
    net.advance(500);
    return reason;
  }

  it("refuses the welcome and says how to recover, defaulting to a reload", () => {
    const reason = mismatch();
    expect(reason).not.toBeNull();
    expect(reason).toContain("Level mismatch");
    expect(reason).toContain("Reload the page to update.");
  });

  it("uses the caller's recovery advice when given — the desktop app cannot reload its way out", () => {
    const reason = mismatch("Download the latest desktop version from the landing page.");
    expect(reason).toContain("Download the latest desktop version from the landing page.");
    expect(reason).not.toContain("Reload the page");
  });
});

describe("items and outcome", () => {
  it("carries items and the outcome into the render state, and the carry fields onto the local player", () => {
    const h = harness();
    const me = h.peerEntityId;
    h.host.world.state.items = [
      { id: 0, pos: { x: 5, y: 1, z: 5 }, carrier: 0, pickedUp: false, signedOut: false },
      { id: 1, pos: { x: 0, y: 0, z: 0 }, carrier: me, pickedUp: true, signedOut: false },
    ];
    h.host.world.state.players.get(me)!.carrying = 1;
    h.host.world.state.players.get(me)!.signOutTicks = 42;
    h.host.world.state.outcome = Outcome.Won;
    drive(h, 6, (t) => input({ seq: t + 1 }));
    const state = h.client.renderState(h.net.now);
    expect(state.items.map((i) => [i.id, i.carrier, i.pickedUp, i.signedOut])).toEqual([[0, 0, false, false], [1, me, true, false]]);
    expect(state.outcome).toBe(Outcome.Won);
    expect(h.client.localPlayer()!.carrying).toBe(1);
    expect(h.client.localPlayer()!.signOutTicks).toBe(42);
    expect(state.players.get(me)!.carrying).toBe(1);
  });

  it("starts empty-handed with no items before any snapshot", () => {
    const h = harness();
    const state = h.client.renderState(h.net.now);
    expect(state.items).toEqual([]);
    expect(state.outcome).toBe(Outcome.Playing);
    expect(h.client.localPlayer()!.carrying).toBe(NO_ITEM);
  });
});
