import { nextRandom } from "../sim/types.js";
import type { NetworkConditions, StateHandler, Transport } from "./transport.js";

type Delivery = { at: number; order: number; deliver: () => void };

export class FakeNetwork {
  private readonly queue: Delivery[] = [];
  private readonly rng: { rngSeed: number };
  private clock = 0;
  private counter = 0;

  constructor(
    private readonly conditions: NetworkConditions,
    seed: number,
  ) {
    this.rng = { rngSeed: seed | 0 };
  }

  get now(): number {
    return this.clock;
  }

  createPair(): [Transport, Transport] {
    const endpointA = new FakeEndpoint(this);
    const endpointB = new FakeEndpoint(this);
    endpointA.link(endpointB);
    endpointB.link(endpointA);
    return [endpointA, endpointB];
  }

  /** Loss and jitter both come from the seeded RNG so runs are reproducible. */
  schedule(kind: "state" | "event", lastEventAt: number, deliver: () => void): number | null {
    if (kind === "state" && nextRandom(this.rng) < this.conditions.lossRate) {
      return null; // dropped, and nothing retransmits it
    }

    let at = this.clock + this.conditions.latencyMs;
    if (this.conditions.jitterMs > 0) {
      at += (nextRandom(this.rng) * 2 - 1) * this.conditions.jitterMs;
    }
    if (at < this.clock) at = this.clock;

    // The event channel is ordered: never let one land before its predecessor.
    if (kind === "event" && at < lastEventAt) at = lastEventAt;

    this.queue.push({ at, order: this.counter++, deliver });
    return at;
  }

  advance(ms: number): void {
    const target = this.clock + ms;
    for (;;) {
      // Sort by time, breaking ties by send order so delivery is deterministic.
      this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = this.queue[0];
      if (next === undefined || next.at > target) break;
      this.queue.shift();
      this.clock = Math.max(this.clock, next.at);
      next.deliver();
    }
    this.clock = target;
  }
}

class FakeEndpoint implements Transport {
  private peer: FakeEndpoint | null = null;
  private stateHandler: StateHandler | null = null;
  private eventHandler: StateHandler | null = null;
  private closed = false;
  private lastEventAt = 0;

  constructor(private readonly network: FakeNetwork) {}

  link(peer: FakeEndpoint): void {
    this.peer = peer;
  }

  get open(): boolean {
    return !this.closed;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  deliverState(data: ArrayBuffer): void {
    this.stateHandler?.(data);
  }

  deliverEvent(data: ArrayBuffer): void {
    this.eventHandler?.(data);
  }

  sendState(data: ArrayBuffer): void {
    if (this.closed) return;
    const peer = this.peer;
    if (peer === null || peer.isClosed) return;
    const copy = data.slice(0);
    this.network.schedule("state", 0, () => peer.deliverState(copy));
  }

  sendEvent(data: ArrayBuffer): void {
    if (this.closed) return;
    const peer = this.peer;
    if (peer === null || peer.isClosed) return;
    const copy = data.slice(0);
    const at = this.network.schedule("event", this.lastEventAt, () => peer.deliverEvent(copy));
    if (at !== null) this.lastEventAt = at;
  }

  onState(handler: StateHandler): void {
    this.stateHandler = handler;
  }

  onEvent(handler: StateHandler): void {
    this.eventHandler = handler;
  }

  close(): void {
    this.closed = true;
  }
}
