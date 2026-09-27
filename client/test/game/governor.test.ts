import { describe, it, expect } from "vitest";
import {
  GOVERNOR_LIMIT_MS, GOVERNOR_LINE_MS, GOVERNOR_START_MS, GOVERNOR_STALL_MS, GOVERNOR_WINDOW_MS, GOVERNOR_WINDOWS,
  createGovernor, governorDecision, governorLine, steadyFrame, type Governor,
} from "../../src/game/governor.js";

/** Frames of `ms` each, from `from` until the clock reaches `until`; returns the clock. */
function feed(g: Governor, from: number, until: number, ms: number, steady = true): number {
  let t = from;
  while (t < until) {
    t += ms;
    g.frame(ms, t, steady);
  }
  return t;
}

describe("the governor", () => {
  it("pins its numbers", () => {
    expect([GOVERNOR_START_MS, GOVERNOR_WINDOW_MS, GOVERNOR_LIMIT_MS, GOVERNOR_WINDOWS, GOVERNOR_STALL_MS, GOVERNOR_LINE_MS])
      .toEqual([30_000, 10_000, 20.8, 3, 250, 6_000]);
  });

  it("stays quiet for five minutes on a machine that holds 60 Hz", () => {
    const g = createGovernor(0);
    feed(g, 0, 300_000, 16.667);
    expect(g.verdict).toBe("none");
  });

  it("drops after the 30 s grace and three slow 10 s windows, and not a frame before", () => {
    const g = createGovernor(0);
    feed(g, 0, 59_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 60_000);
    expect(g.verdict).toBe("drop");
  });

  it("lets a stalled window neither count nor break the run", () => {
    const g = createGovernor(0);
    feed(g, 0, 45_000, 25);
    g.frame(300, 45_300);
    feed(g, 45_300, 69_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 70_000);
    expect(g.verdict).toBe("drop");
  });

  it("starts the run again after a window at or under the limit", () => {
    const g = createGovernor(0);
    feed(g, 0, 50_000, 25);
    feed(g, 50_000, 60_000, 20);
    feed(g, 60_000, 89_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 90_000);
    expect(g.verdict).toBe("drop");
  });

  it("takes a new grace after a swap, and keeps a drop once made", () => {
    const g = createGovernor(0);
    feed(g, 0, 50_000, 25);
    g.restart(50_000);
    feed(g, 50_000, 109_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 110_000);
    expect(g.verdict).toBe("drop");
    g.restart(110_000);
    expect(g.verdict).toBe("drop");
  });

  it("does not drop for brief spikes on a machine that holds 60 Hz", () => {
    const g = createGovernor(0);
    let t = 0;
    // A 200 ms hitch every 5 s (a collection, a streamed model): each 10 s
    // window's mean rises by about 0.37 ms, far under the limit.
    while (t < 300_000) {
      const ms = t > 0 && Math.round(t) % 5_000 < 17 ? 200 : 16.667;
      t += ms;
      g.frame(ms, t);
    }
    expect(g.verdict).toBe("none");
  });

  it("ignores frames that are not steady play: paused, hidden, loading, compiling, switching", () => {
    const g = createGovernor(0);
    // Slow throughout, but never steady: nothing counts.
    feed(g, 0, 300_000, 40, false);
    expect(g.verdict).toBe("none");
    // One unsteady frame voids its window, which neither counts nor breaks the run.
    const h = createGovernor(0);
    feed(h, 0, 45_000, 25);
    h.frame(25, 45_025, false);
    feed(h, 45_025, 69_975, 25);
    expect(h.verdict).toBe("none");
    h.frame(25, 70_000);
    expect(h.verdict).toBe("drop");
  });

  it("says what it did in one line", () => {
    expect(governorLine("medium")).toBe("Graphics lowered to Medium to keep the game smooth.");
    expect(governorLine("low")).toBe("Graphics lowered to Low to keep the game smooth.");
  });
});

describe("steadyFrame", () => {
  const play = { engaged: true, menuOpen: false, visible: true, waitingItems: 0, compiled: false, switching: false };
  it("is steady play, and nothing else", () => {
    expect(steadyFrame(play)).toBe(true);
    expect(steadyFrame({ ...play, engaged: false })).toBe(false);
    expect(steadyFrame({ ...play, menuOpen: true })).toBe(false);
    expect(steadyFrame({ ...play, visible: false })).toBe(false);
    expect(steadyFrame({ ...play, waitingItems: 2 })).toBe(false);
    expect(steadyFrame({ ...play, compiled: true })).toBe(false);
    expect(steadyFrame({ ...play, switching: true })).toBe(false);
  });
});

describe("governorDecision", () => {
  it("lowers a tier Auto picked by one, and never a chosen tier, ?tier=, or low", () => {
    expect(governorDecision("drop", "high", "auto")).toEqual({ next: "medium" });
    expect(governorDecision("drop", "medium", "auto")).toEqual({ next: "low" });
    expect(governorDecision("drop", "low", "auto")).toBe(null);
    expect(governorDecision("drop", "high", "choice")).toBe(null);
    expect(governorDecision("drop", "high", "override")).toBe(null);
    expect(governorDecision("none", "high", "auto")).toBe(null);
  });
});
