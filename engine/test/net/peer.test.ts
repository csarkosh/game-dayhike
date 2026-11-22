import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { acceptAsHost, connectAsClient } from "../../src/net/peer.js";
import { ICE_TIMEOUT_MS } from "../../src/sim/constants.js";
import type { SignalingClient } from "../../src/net/signaling.js";

/**
 * The handshakes are mostly browser plumbing, but their failure path is not:
 * the lobby's socket outlives every game played over it, so what a handshake
 * leaves behind when it throws accumulates for the whole visit.
 */

class FakePeerConnection {
  static readonly instances: FakePeerConnection[] = [];
  closed = false;
  onicecandidate: unknown = null;
  ondatachannel: unknown = null;

  constructor() {
    FakePeerConnection.instances.push(this);
  }
  createDataChannel(label: string): unknown {
    return { label, readyState: "connecting", onopen: null };
  }
  createOffer(): Promise<unknown> {
    return Promise.resolve({ type: "offer", sdp: "o" });
  }
  createAnswer(): Promise<unknown> {
    return Promise.resolve({ type: "answer", sdp: "a" });
  }
  setLocalDescription(): Promise<void> {
    return Promise.resolve();
  }
  setRemoteDescription(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {
    this.closed = true;
  }
}

/** Counts live signal handlers; nothing ever answers. */
function silentSignaling(): SignalingClient & { handlers: number } {
  const handlers: ((from: string, payload: unknown) => void)[] = [];
  return {
    get handlers() {
      return handlers.length;
    },
    create: () => Promise.reject(new Error("unused")),
    join: () => Promise.reject(new Error("unused")),
    send: () => undefined,
    onSignal(h) {
      handlers.push(h);
      return () => handlers.splice(handlers.indexOf(h), 1);
    },
    onRejoined: () => () => undefined,
    onPeerJoined: () => undefined,
    onPeerLeft: () => () => undefined,
    onError: () => () => undefined,
    onOpen: () => () => undefined,
    setRole: () => undefined,
    leave: () => undefined,
    close: () => undefined,
  } as SignalingClient & { handlers: number };
}

beforeEach(() => {
  FakePeerConnection.instances.length = 0;
  vi.useFakeTimers();
  (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakePeerConnection;
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
});

describe("a handshake that times out", () => {
  it("takes its signal handler and its connection down with it (client)", async () => {
    const signaling = silentSignaling();
    // The expectation is attached before the clock moves: the rejection lands
    // inside `advanceTimersByTimeAsync`, and an unwatched one is an error.
    const attempt = expect(connectAsClient(signaling, "host")).rejects.toThrow("ice_failed");
    expect(signaling.handlers).toBe(1);

    await vi.advanceTimersByTimeAsync(ICE_TIMEOUT_MS + 1);
    await attempt;

    // Left behind, these would keep trickling candidates at a host that is not
    // listening, once per failed attempt, for the life of the lobby.
    expect(signaling.handlers).toBe(0);
    expect(FakePeerConnection.instances[0]?.closed).toBe(true);
  });

  it("takes its signal handler and its connection down with it (host)", async () => {
    const signaling = silentSignaling();
    const attempt = expect(
      acceptAsHost(signaling, "guest", { type: "offer", sdp: "o" }),
    ).rejects.toThrow("ice_failed");
    expect(signaling.handlers).toBe(1);

    await vi.advanceTimersByTimeAsync(ICE_TIMEOUT_MS + 1);
    await attempt;

    expect(signaling.handlers).toBe(0);
    expect(FakePeerConnection.instances[0]?.closed).toBe(true);
  });
});
