import { describe, it, expect } from "vitest";
import { createHostSession } from "../../src/net/hostSession.js";
import { createClientSession, type SessionEnd } from "../../src/net/clientSession.js";
import { FakeNetwork } from "../../src/net/fakeNetwork.js";
import { PERFECT_NETWORK, type NetworkConditions } from "../../src/net/transport.js";
import { parseLevel } from "../../src/sim/level.js";
import { TICK_DT } from "../../src/sim/constants.js";
import type { InputCommand } from "../../src/sim/types.js";
import { FixedStepAccumulator } from "../../src/game/loop.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

// The helpers of clientSession.test.ts: a host and a follower over a faked
// transport, run in lockstep.
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
  const peerId = "p1";
  const peerEntityId = host.addPeer(peerId, hostSide);
  // Let the Welcome event arrive.
  net.advance(500);
  return { net, host, client, peerEntityId, peerId };
}

/** Runs both sides in lockstep for `ticks` sim steps. */
function drive(
  h: ReturnType<typeof harness>,
  ticks: number,
  makeInput: (t: number) => InputCommand = (t) => input({ seq: t + 1 }),
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

/**
 * A renderer rebuild is one synchronous job on the page that does it: for its
 * length the page neither ticks nor sends nor reads. These pin what the other
 * side lives through: a host's page busy for 1.5 s (a follower keeps ticking
 * and sending), and a follower's (the host goes on). The data channels stay
 * open throughout: their keep-alive runs in the browser, not the page, and
 * nothing in the game times a peer out.
 */
describe("a renderer rebuild's stall", () => {
  it("keeps a follower connected and converging through the host's 1.5 s stall", () => {
    const h = harness({ latencyMs: 50, jitterMs: 0, lossRate: 0 }, 5150);
    const ended: SessionEnd[] = [];
    h.client.onSessionEnd((e) => ended.push(e));
    drive(h, 120, (t) => input({ seq: t + 1, moveZ: 1 }));

    // The host's page is busy: the follower ticks and sends for 90 ticks, the host not at all.
    for (let t = 0; t < 90; t++) {
      h.client.tick(input({ seq: 200 + t, moveZ: 1 }));
      h.net.advance(TICK_MS);
    }
    // Its first frame after runs the accumulator's cap and drops the rest.
    const burst = new FixedStepAccumulator().advance(1.5);
    expect(burst).toBe(15);
    for (let i = 0; i < burst; i++) h.host.tick(input({ seq: 0 }));

    const before = h.client.stats.snapshotsReceived;
    drive(h, 6, (t) => input({ seq: 300 + t, moveZ: 1 }));
    expect(h.client.stats.snapshotsReceived).toBeGreaterThan(before);

    drive(h, 240, (t) => input({ seq: 400 + t, moveZ: 1 }));
    h.net.advance(500);
    for (let i = 0; i < 90; i++) {
      h.host.tick(input({ seq: 0 }));
      h.net.advance(TICK_MS);
    }
    h.net.advance(500);
    expect(ended).toEqual([]);
    const hostPos = h.host.world.state.players.get(h.peerEntityId)!.pos;
    expect(distance(hostPos, h.client.localPlayer()!.pos)).toBeLessThan(1.0);
  });

  it("lets a follower stall 1.5 s and reconcile with the host that went on", () => {
    const h = harness({ latencyMs: 50, jitterMs: 0, lossRate: 0 }, 5151);
    const ended: SessionEnd[] = [];
    h.client.onSessionEnd((e) => ended.push(e));
    drive(h, 120, (t) => input({ seq: t + 1, moveZ: 1 }));

    // The follower's page is busy: the host goes on, and nothing reaches the follower's page…
    for (let t = 0; t < 90; t++) h.host.tick(input({ seq: 0 }));
    // …until it is free, when everything queued is handled at once.
    h.net.advance(1500);
    const burst = new FixedStepAccumulator().advance(1.5);
    for (let i = 0; i < burst; i++) h.client.tick(input({ seq: 200 + i, moveZ: 1 }));

    drive(h, 240, (t) => input({ seq: 400 + t, moveZ: 1 }));
    h.net.advance(500);
    for (let i = 0; i < 90; i++) {
      h.host.tick(input({ seq: 0 }));
      h.net.advance(TICK_MS);
    }
    h.net.advance(500);
    expect(ended).toEqual([]);
    const hostPos = h.host.world.state.players.get(h.peerEntityId)!.pos;
    expect(distance(hostPos, h.client.localPlayer()!.pos)).toBeLessThan(1.0);
  });
});
