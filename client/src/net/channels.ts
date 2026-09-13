import type { NetworkConditions, StateHandler, Transport } from "./transport.js";
import { nextRandom } from "../sim/types.js";

export const STATE_CHANNEL = "state";
export const EVENT_CHANNEL = "event";

/** Unreliable and unordered: a stale snapshot is worse than no snapshot. */
export const STATE_CHANNEL_INIT: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0,
};

/** Reliable and ordered: losing a join or a hit confirm corrupts session state. */
export const EVENT_CHANNEL_INIT: RTCDataChannelInit = {
  ordered: true,
};

/**
 * Two separate teardown hooks, because they mean different things:
 *
 *  - `onClose`: the *peer* went away (a channel closed on its own, without a
 *    matching explicit `close()` on this side). The host's `removePeer` and
 *    the client's reconnect both hang off this, so it must NOT fire on an
 *    explicit close — hanging up is not the same as the other end leaving.
 *  - `onDispose`: this *transport* is finished, whoever ended it. Cleanup
 *    that must run in both directions (e.g. unregistering the signaling
 *    handler that answered this connection) hangs off this instead, and it
 *    fires exactly once regardless of which side initiated the teardown.
 */
export function createDataChannelTransport(
  state: RTCDataChannel,
  event: RTCDataChannel,
  onClose?: () => void,
  onDispose?: () => void,
): Transport {
  state.binaryType = "arraybuffer";
  event.binaryType = "arraybuffer";

  let stateHandler: StateHandler | null = null;
  let eventHandler: StateHandler | null = null;
  let closed = false;
  let disposed = false;

  const disposeOnce = () => {
    if (disposed) return;
    disposed = true;
    onDispose?.();
  };

  state.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) stateHandler?.(e.data);
  };
  event.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) eventHandler?.(e.data);
  };

  const handleClose = () => {
    if (closed) return;
    closed = true;
    onClose?.();
    disposeOnce();
  };
  state.onclose = handleClose;
  event.onclose = handleClose;

  return {
    get open() {
      return !closed && state.readyState === "open" && event.readyState === "open";
    },
    sendState(data) {
      if (state.readyState === "open") state.send(data);
    },
    sendEvent(data) {
      if (event.readyState === "open") event.send(data);
    },
    onState(handler) {
      stateHandler = handler;
    },
    onEvent(handler) {
      eventHandler = handler;
    },
    close() {
      closed = true;
      state.close();
      event.close();
      disposeOnce();
    },
  };
}

export function parseNetConditions(search: string): NetworkConditions | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("net");
  if (raw === null) return null;

  const fields = new Map<string, number>();
  for (const part of raw.split(",")) {
    const [key, value] = part.split(":");
    if (key === undefined || value === undefined) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) fields.set(key.trim(), parsed);
  }

  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  return {
    latencyMs: clamp(fields.get("lat") ?? 0, 0, 5000),
    jitterMs: clamp(fields.get("jitter") ?? 0, 0, 1000),
    lossRate: clamp((fields.get("loss") ?? 0) / 100, 0, 1),
  };
}

/**
 * Wraps a real transport in artificial latency, jitter, and loss so a single
 * tab can reproduce a bad connection against otherwise healthy peers.
 */
export function degradeTransport(
  inner: Transport,
  conditions: NetworkConditions,
  seed = 1337,
): Transport {
  const rng = { rngSeed: seed | 0 };
  const delay = (): number => {
    let d = conditions.latencyMs;
    if (conditions.jitterMs > 0) d += (nextRandom(rng) * 2 - 1) * conditions.jitterMs;
    return Math.max(0, d);
  };

  return {
    get open() {
      return inner.open;
    },
    sendState(data) {
      if (nextRandom(rng) < conditions.lossRate) return;
      setTimeout(() => inner.sendState(data), delay());
    },
    sendEvent(data) {
      // The event channel is reliable by contract; only delay it.
      setTimeout(() => inner.sendEvent(data), delay());
    },
    onState(handler) {
      inner.onState((data) => {
        if (nextRandom(rng) < conditions.lossRate) return;
        setTimeout(() => handler(data), delay());
      });
    },
    onEvent(handler) {
      inner.onEvent((data) => setTimeout(() => handler(data), delay()));
    },
    close() {
      inner.close();
    },
  };
}
