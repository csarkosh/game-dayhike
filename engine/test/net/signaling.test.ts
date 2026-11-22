import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignalingClient, type WebSocketLike } from "../../src/net/signaling.js";

/** A hand-driven stand-in for a browser WebSocket. */
class FakeSocket implements WebSocketLike {
  static readonly instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }
  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const ROOM = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

beforeEach(() => {
  FakeSocket.instances.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function client(offsetMs = 0) {
  return createSignalingClient("wss://example/ws", {
    backoffMs: [10, 20],
    connect: (url) => new FakeSocket(url),
    // No jitter: the advances below assert the exact schedule.
    random: () => 0,
    clientReconnectOffsetMs: offsetMs,
  });
}

describe("createSignalingClient reconnect", () => {
  it("reconnects after the socket drops and rejoins the same room", async () => {
    const signaling = client();
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "host", hostId: "me", peers: [] });
    await join;

    first.drop();
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15);
    expect(FakeSocket.instances).toHaveLength(2);

    const second = FakeSocket.instances[1]!;
    second.open();
    // Same room and peer id, or the server cannot recognise the reclaim.
    expect(second.sent.map((s) => JSON.parse(s))).toContainEqual({
      t: "join",
      room: ROOM,
      peerId: "me",
    });
  });

  it("does not resolve the original join promise twice on a rejoin", async () => {
    const signaling = client();
    const resolved: string[] = [];
    const join = signaling.join(ROOM, "me").then((info) => resolved.push(info.hostId));

    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "host", hostId: "me", peers: [] });
    await join;

    first.drop();
    await vi.advanceTimersByTimeAsync(15);
    const second = FakeSocket.instances[1]!;
    second.open();
    // The rejoin's own "joined" reply must not be mistaken for the first one.
    second.deliver({ t: "joined", role: "host", hostId: "me", peers: ["a", "b"] });
    await vi.advanceTimersByTimeAsync(1);

    expect(resolved).toEqual(["me"]);
  });

  it("tells onRejoined about a reconnect's joined, without resolving the join promise", async () => {
    const signaling = client();
    const rejoins: string[] = [];
    const off = signaling.onRejoined((info) => rejoins.push(info.hostId));
    const resolved: string[] = [];
    const join = signaling.join(ROOM, "me").then((info) => resolved.push(info.hostId));

    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;
    // The first `joined` had a waiting caller, so it is not a rejoin.
    expect(rejoins).toEqual([]);

    first.drop();
    await vi.advanceTimersByTimeAsync(15);
    const second = FakeSocket.instances[1]!;
    second.open();
    second.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });

    expect(rejoins).toEqual(["h"]);
    expect(resolved).toEqual(["h"]);

    off();
    second.drop();
    await vi.advanceTimersByTimeAsync(15);
    const third = FakeSocket.instances[2]!;
    third.open();
    third.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    expect(rejoins).toEqual(["h"]);
  });

  it("delivers a new peer's offer after reconnecting", async () => {
    // This is what the reconnect is actually for: a player who joins later
    // sends their offer through signaling, and the host must still be reachable.
    const signaling = client();
    const offers: string[] = [];
    signaling.onSignal((from) => offers.push(from));

    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "host", hostId: "me", peers: [] });
    await join;

    first.drop();
    await vi.advanceTimersByTimeAsync(15);
    const second = FakeSocket.instances[1]!;
    second.open();
    second.deliver({ t: "joined", role: "host", hostId: "me", peers: [] });
    second.deliver({ t: "signal", from: "latecomer", payload: { sdp: { type: "offer" } } });

    expect(offers).toEqual(["latecomer"]);
  });

  it("does not reconnect after an explicit close", async () => {
    const signaling = client();
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "host", hostId: "me", peers: [] });
    await join;

    signaling.close();
    first.drop();
    await vi.advanceTimersByTimeAsync(100);

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("backs off, holding at the last step", async () => {
    const signaling = client();
    void signaling.join(ROOM, "me").catch(() => undefined);
    FakeSocket.instances[0]!.drop();

    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1]!.drop();
    await vi.advanceTimersByTimeAsync(20);
    expect(FakeSocket.instances).toHaveLength(3);

    // The schedule has two steps; a third failure reuses the last.
    FakeSocket.instances[2]!.drop();
    await vi.advanceTimersByTimeAsync(20);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("keeps the first join's promise rejecting on a failed first connect", async () => {
    const signaling = client();
    const join = signaling.join(ROOM, "me");
    FakeSocket.instances[0]!.onerror?.();
    await expect(join).rejects.toThrow("signaling_unreachable");
  });
});

describe("createSignalingClient reconnect ordering by role", () => {
  const OFFSET = 100;

  /** Joins, takes the reply, then kills the socket the way a revision swap does. */
  async function joinThenDrop(role: "host" | "client" | null) {
    const signaling = client(OFFSET);
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: role ?? "host", hostId: "h", peers: [] });
    await join;
    if (role !== null) signaling.setRole(role);
    first.drop();
    return signaling;
  }

  it("brings a host back on the bare backoff, with no offset", async () => {
    await joinThenDrop("host");

    // The first backoff step is 10 ms and jitter is pinned to zero.
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("holds a client back by the offset so the host reclaims first", async () => {
    await joinThenDrop("client");

    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(OFFSET);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("waits the client offset when no role has been set yet", async () => {
    // Never assume host: guessing wrong here is what makes a client recreate
    // the room and claim `hostId`, which silently kills the invite link.
    await joinThenDrop(null);

    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(OFFSET);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe("lobby verbs", () => {
  it("create sends create and reconnects with create, not join", async () => {
    const signaling = client();
    const created = signaling.create(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    expect(JSON.parse(first.sent[0]!)).toEqual({ t: "create", room: ROOM, peerId: "me" });
    first.deliver({ t: "joined", role: "host", hostId: "me", peers: [] });
    await expect(created).resolves.toEqual({ role: "host", hostId: "me", peers: [] });

    first.drop();
    await vi.advanceTimersByTimeAsync(15);
    const second = FakeSocket.instances[1]!;
    second.open();
    expect(second.sent.map((s) => JSON.parse(s))).toContainEqual({ t: "create", room: ROOM, peerId: "me" });
  });

  it("rejects create with the server's code", async () => {
    const signaling = client();
    const created = signaling.create(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "error", code: "lobby_taken" });
    await expect(created).rejects.toThrow("lobby_taken");
  });

  it("leave says goodbye before closing and never reconnects", async () => {
    const signaling = client();
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;
    signaling.leave();
    expect(JSON.parse(first.sent.at(-1)!)).toEqual({ t: "leave" });
    expect(first.readyState).toBe(3);
    first.onclose?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("onSignal returns an unsubscribe and onError is additive", async () => {
    const signaling = client();
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;

    const seen: string[] = [];
    const off = signaling.onSignal((from) => seen.push(`a:${from}`));
    signaling.onSignal((from) => seen.push(`b:${from}`));
    first.deliver({ t: "signal", from: "h", payload: {} });
    off();
    first.deliver({ t: "signal", from: "h", payload: {} });
    expect(seen).toEqual(["a:h", "b:h", "b:h"]);

    const errors: string[] = [];
    signaling.onError((code) => errors.push(`x:${code}`));
    const offErr = signaling.onError((code) => errors.push(`y:${code}`));
    first.deliver({ t: "error", code: "host_gone" });
    offErr();
    first.deliver({ t: "error", code: "host_gone" });
    expect(errors).toEqual(["x:host_gone", "y:host_gone", "x:host_gone"]);
  });

  it("signal dispatch survives a handler unsubscribing itself mid-dispatch", async () => {
    const signaling = client();
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;

    const seen: string[] = [];
    let offFirst: () => void = () => undefined;
    offFirst = signaling.onSignal((from) => {
      seen.push(`a:${from}`);
      offFirst();
    });
    signaling.onSignal((from) => seen.push(`b:${from}`));
    first.deliver({ t: "signal", from: "h", payload: {} });
    // Both handlers fired on the delivery that unsubscribed the first...
    expect(seen).toEqual(["a:h", "b:h"]);
    first.deliver({ t: "signal", from: "h", payload: {} });
    // ...and the first does not fire again, while the second still does.
    expect(seen).toEqual(["a:h", "b:h", "b:h"]);
  });

  it("error dispatch survives a handler unsubscribing itself mid-dispatch", async () => {
    const signaling = client();
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;

    const errors: string[] = [];
    let offFirst: () => void = () => undefined;
    offFirst = signaling.onError((code) => {
      errors.push(`x:${code}`);
      offFirst();
    });
    signaling.onError((code) => errors.push(`y:${code}`));
    first.deliver({ t: "error", code: "host_gone" });
    expect(errors).toEqual(["x:host_gone", "y:host_gone"]);
    first.deliver({ t: "error", code: "host_gone" });
    expect(errors).toEqual(["x:host_gone", "y:host_gone", "y:host_gone"]);
  });
});

describe("createSignalingClient onOpen", () => {
  it("fires when the socket opens, before the joined reply", async () => {
    const signaling = client();
    const opens: number[] = [];
    signaling.onOpen(() => opens.push(opens.length));
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    expect(opens).toEqual([]);
    first.open();
    expect(opens).toEqual([0]);
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;
    expect(opens).toEqual([0]);
  });

  it("still sends the join verb on open with a handler registered", async () => {
    const signaling = client();
    signaling.onOpen(() => undefined);
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    expect(first.sent.map((s) => JSON.parse(s) as { t: string })).toEqual([
      { t: "join", room: ROOM, peerId: "me" },
    ]);
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;
  });

  it("fires again when a reconnect's socket opens", async () => {
    const signaling = client();
    let opens = 0;
    signaling.onOpen(() => {
      opens += 1;
    });
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;
    expect(opens).toBe(1);

    first.drop();
    await vi.advanceTimersByTimeAsync(10);
    const second = FakeSocket.instances[1]!;
    second.open();
    expect(opens).toBe(2);
    // The reconnect must still rejoin the same room as the same peer.
    expect(second.sent.map((s) => JSON.parse(s) as { t: string })).toEqual([
      { t: "join", room: ROOM, peerId: "me" },
    ]);
  });

  it("unsubscribes, and dispatch survives a handler unsubscribing itself", async () => {
    const signaling = client();
    const seen: string[] = [];
    let offFirst: () => void = () => undefined;
    offFirst = signaling.onOpen(() => {
      seen.push("a");
      offFirst();
    });
    signaling.onOpen(() => seen.push("b"));
    const join = signaling.join(ROOM, "me");
    const first = FakeSocket.instances[0]!;
    first.open();
    expect(seen).toEqual(["a", "b"]);
    first.deliver({ t: "joined", role: "client", hostId: "h", peers: ["h"] });
    await join;

    first.drop();
    await vi.advanceTimersByTimeAsync(10);
    FakeSocket.instances[1]!.open();
    expect(seen).toEqual(["a", "b", "b"]);
  });
});
