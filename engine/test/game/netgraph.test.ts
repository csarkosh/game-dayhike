import { describe, it, expect } from "vitest";
import { RateCounter } from "../../src/game/netgraph.js";

describe("RateCounter", () => {
  it("reports zero before anything is added", () => {
    expect(new RateCounter(1000).perSecond(0)).toBe(0);
  });

  it("reports the total added within the window", () => {
    const c = new RateCounter(1000);
    c.add(10, 0);
    c.add(20, 500);
    expect(c.perSecond(900)).toBe(30);
  });

  it("forgets samples older than the window", () => {
    const c = new RateCounter(1000);
    c.add(100, 0);
    c.add(5, 1500);
    expect(c.perSecond(1500)).toBe(5);
  });

  it("scales to a per-second rate for a shorter window", () => {
    const c = new RateCounter(500);
    c.add(10, 0);
    // 10 over a 500ms window is 20 per second.
    expect(c.perSecond(400)).toBe(20);
  });

  it("handles many samples without unbounded growth", () => {
    const c = new RateCounter(1000);
    for (let t = 0; t < 10000; t += 10) c.add(1, t);
    expect(c.perSecond(10000)).toBeLessThanOrEqual(101);
  });
});
