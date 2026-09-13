import { describe, it, expect } from "vitest";
import { FakeNetwork } from "../../src/net/fakeNetwork.js";
import { PERFECT_NETWORK } from "../../src/net/transport.js";

function payload(n: number): ArrayBuffer {
  const b = new ArrayBuffer(1);
  new DataView(b).setUint8(0, n);
  return b;
}
const tag = (b: ArrayBuffer) => new DataView(b).getUint8(0);

describe("FakeNetwork", () => {
  it("delivers nothing before the latency has elapsed", () => {
    const net = new FakeNetwork({ latencyMs: 50, jitterMs: 0, lossRate: 0 }, 1);
    const [a, b] = net.createPair();
    const got: number[] = [];
    b.onState((d) => got.push(tag(d)));
    a.sendState(payload(1));
    net.advance(49);
    expect(got).toEqual([]);
    net.advance(1);
    expect(got).toEqual([1]);
  });

  it("delivers immediately on a perfect network", () => {
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [a, b] = net.createPair();
    const got: number[] = [];
    b.onState((d) => got.push(tag(d)));
    a.sendState(payload(7));
    net.advance(0);
    expect(got).toEqual([7]);
  });

  it("is bidirectional", () => {
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [a, b] = net.createPair();
    const toA: number[] = [];
    a.onState((d) => toA.push(tag(d)));
    b.sendState(payload(9));
    net.advance(0);
    expect(toA).toEqual([9]);
  });

  it("drops state messages at the configured rate", () => {
    const net = new FakeNetwork({ latencyMs: 0, jitterMs: 0, lossRate: 0.5 }, 12345);
    const [a, b] = net.createPair();
    let received = 0;
    b.onState(() => received++);
    for (let i = 0; i < 1000; i++) a.sendState(payload(i & 0xff));
    net.advance(10);
    // Deterministic RNG, so this is a stable range, not a flaky one.
    expect(received).toBeGreaterThan(400);
    expect(received).toBeLessThan(600);
  });

  it("never drops event messages even at high loss", () => {
    const net = new FakeNetwork({ latencyMs: 20, jitterMs: 10, lossRate: 0.9 }, 999);
    const [a, b] = net.createPair();
    let received = 0;
    b.onEvent(() => received++);
    for (let i = 0; i < 200; i++) a.sendEvent(payload(i & 0xff));
    net.advance(1000);
    expect(received).toBe(200);
  });

  it("delivers events in order even with jitter", () => {
    const net = new FakeNetwork({ latencyMs: 30, jitterMs: 25, lossRate: 0 }, 4242);
    const [a, b] = net.createPair();
    const got: number[] = [];
    b.onEvent((d) => got.push(tag(d)));
    for (let i = 0; i < 50; i++) a.sendEvent(payload(i));
    net.advance(1000);
    expect(got).toEqual([...Array(50).keys()]);
  });

  it("is reproducible for a given seed", () => {
    const run = () => {
      const net = new FakeNetwork({ latencyMs: 10, jitterMs: 20, lossRate: 0.3 }, 777);
      const [a, b] = net.createPair();
      const got: number[] = [];
      b.onState((d) => got.push(tag(d)));
      for (let i = 0; i < 100; i++) a.sendState(payload(i));
      net.advance(500);
      return got;
    };
    expect(run()).toEqual(run());
  });

  it("stops delivering after close", () => {
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    const [a, b] = net.createPair();
    let received = 0;
    b.onState(() => received++);
    a.close();
    expect(a.open).toBe(false);
    a.sendState(payload(1));
    net.advance(100);
    expect(received).toBe(0);
  });

  it("copies payloads so a reused buffer cannot corrupt delivery", () => {
    const net = new FakeNetwork({ latencyMs: 20, jitterMs: 0, lossRate: 0 }, 3);
    const [a, b] = net.createPair();
    const got: number[] = [];
    b.onState((d) => got.push(tag(d)));
    const scratch = payload(1);
    a.sendState(scratch);
    // Mutate the caller's buffer before it is delivered.
    new DataView(scratch).setUint8(0, 99);
    net.advance(50);
    expect(got).toEqual([1]);
  });

  it("advances its clock", () => {
    const net = new FakeNetwork(PERFECT_NETWORK, 1);
    net.advance(250);
    expect(net.now).toBe(250);
  });
});
