import { describe, it, expect, vi } from "vitest";
import { createDataChannelTransport, parseNetConditions } from "../../src/net/channels.js";

/** Minimal fake standing in for the one RTCDataChannel surface this module touches. */
function fakeChannel(): RTCDataChannel {
  const channel = {
    binaryType: "arraybuffer",
    readyState: "open",
    onmessage: null,
    onclose: null,
    send() {
      // no-op
    },
    close() {
      channel.readyState = "closed";
    },
  };
  return channel as unknown as RTCDataChannel;
}

describe("parseNetConditions", () => {
  it("returns null when the parameter is absent", () => {
    expect(parseNetConditions("")).toBeNull();
    expect(parseNetConditions("?foo=1")).toBeNull();
  });

  it("parses latency and loss", () => {
    expect(parseNetConditions("?net=lat:150,loss:5")).toEqual({
      latencyMs: 150,
      jitterMs: 0,
      lossRate: 0.05,
    });
  });

  it("parses jitter", () => {
    expect(parseNetConditions("?net=lat:80,jitter:20,loss:2")).toEqual({
      latencyMs: 80,
      jitterMs: 20,
      lossRate: 0.02,
    });
  });

  it("tolerates missing fields", () => {
    expect(parseNetConditions("?net=lat:40")).toEqual({
      latencyMs: 40,
      jitterMs: 0,
      lossRate: 0,
    });
  });

  it("clamps nonsense values instead of trusting them", () => {
    const parsed = parseNetConditions("?net=lat:-50,loss:900");
    expect(parsed?.latencyMs).toBe(0);
    expect(parsed?.lossRate).toBe(1);
  });

  it("falls back to zeroes for an unparseable value", () => {
    expect(parseNetConditions("?net=garbage")).toEqual({
      latencyMs: 0,
      jitterMs: 0,
      lossRate: 0,
    });
  });
});

describe("createDataChannelTransport teardown", () => {
  it("calls onDispose exactly once and never onClose on an explicit close", () => {
    const state = fakeChannel();
    const event = fakeChannel();
    const onClose = vi.fn();
    const onDispose = vi.fn();
    const transport = createDataChannelTransport(state, event, onClose, onDispose);

    transport.close();

    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls both onClose and onDispose once on a browser-initiated close", () => {
    const state = fakeChannel();
    const event = fakeChannel();
    const onClose = vi.fn();
    const onDispose = vi.fn();
    createDataChannelTransport(state, event, onClose, onDispose);

    state.onclose?.(new Event("close"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it("does not call onDispose a second time when close() follows a browser-initiated close", () => {
    const state = fakeChannel();
    const event = fakeChannel();
    const onClose = vi.fn();
    const onDispose = vi.fn();
    const transport = createDataChannelTransport(state, event, onClose, onDispose);

    state.onclose?.(new Event("close"));
    transport.close();

    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(transport.open).toBe(false);
  });
});
