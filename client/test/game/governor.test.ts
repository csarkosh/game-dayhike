import { describe, it, expect } from "vitest";
import {
  GOVERNOR_IDLE_MAX_MS, GOVERNOR_LIMIT_MS, GOVERNOR_LINE_MS, GOVERNOR_START_MS, GOVERNOR_STALL_MS, GOVERNOR_WINDOW_MS, GOVERNOR_WINDOWS,
  actOnDrop, createGovernor, governorDecision, governorLine, steadyFrame, type DropDeps, type Governor,
} from "../../src/game/governor.js";
import type { QualityTier } from "../../src/game/quality.js";

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
  const play = { engaged: true, menuOpen: false, visible: true, waitingItems: 0, compiled: false, switching: false, freecam: false };
  it("is steady play, and nothing else", () => {
    expect(steadyFrame(play)).toBe(true);
    expect(steadyFrame({ ...play, engaged: false })).toBe(false);
    expect(steadyFrame({ ...play, menuOpen: true })).toBe(false);
    expect(steadyFrame({ ...play, visible: false })).toBe(false);
    expect(steadyFrame({ ...play, waitingItems: 2 })).toBe(false);
    expect(steadyFrame({ ...play, compiled: true })).toBe(false);
    expect(steadyFrame({ ...play, switching: true })).toBe(false);
    // Flying crosses the fields' rebuild lattice every frame: work walking never causes.
    expect(steadyFrame({ ...play, freecam: true })).toBe(false);
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

describe("acting on a drop", () => {
  /** Fakes for the page, and what the governor did with them, in order. */
  function page(
    cadence: number | null,
    reached: QualityTier | "throws" = "low",
    alive = true,
    also: { throwsAt?: "time" | "record"; endsMidSwitch?: boolean } = {},
  ) {
    const did: string[] = [];
    let onEnd: (() => void) | null = null;
    let ended = false;
    const deps: DropDeps = {
      cover: () => {
        did.push("cover");
        return () => did.push("lift");
      },
      stopLoop: () => {
        did.push("stop");
        return () => did.push("resume");
      },
      idleCadence: async () => {
        did.push("time");
        if (also.throwsAt === "time") throw new Error("no timer");
        return cadence;
      },
      record: (running) => {
        did.push(`record ${running}`);
        if (also.throwsAt === "record") throw new Error("no storage");
      },
      switchTo: async (next) => {
        did.push(`switch ${next}`);
        if (also.endsMidSwitch) {
          ended = true;
          onEnd?.();
        }
        if (reached === "throws") throw new Error("no tier built");
        did.push("switched");
        return reached;
      },
      flash: (line, ms) => did.push(`flash ${line} ${ms}`),
      log: (line) => did.push(`log ${line}`),
      alive: () => alive && !ended,
      whenEnded: (fn) => {
        onEnd = fn;
        return () => {
          onEnd = null;
        };
      },
    };
    return { deps, did };
  }

  it("bounds its timing of the page's idle frames", () => {
    expect(GOVERNOR_IDLE_MAX_MS).toBe(2_000);
  });

  it("stands down on a page that itself draws below 60 Hz: no drop, no verdict, one line", async () => {
    const { deps, did } = page(33.4);
    expect(await actOnDrop("medium", "low", deps)).toBe("held");
    expect(did).toEqual([
      "cover", "stop", "time",
      "log quality governor: held at medium, the page itself draws below 60 Hz (33.4 ms a frame)",
      "resume", "lift",
    ]);
  });

  it("stands down when the page's idle frames cannot be timed", async () => {
    const { deps, did } = page(null);
    expect(await actOnDrop("high", "medium", deps)).toBe("held");
    expect(did).toEqual([
      "cover", "stop", "time",
      "log quality governor: held at high, the page's idle frames could not be timed",
      "resume", "lift",
    ]);
  });

  it("drops on a page whose idle frames hold 60 Hz: the verdict first, then the switch, then the line", async () => {
    const { deps, did } = page(16.7);
    expect(await actOnDrop("medium", "low", deps)).toBe("lowered");
    expect(did).toEqual([
      "cover", "stop", "time",
      "record medium",
      "log quality governor: medium → low, 30 s of play under 48 fps",
      "switch low", "switched", "lift",
      "flash Graphics lowered to Low to keep the game smooth. 6000",
    ]);
  });

  it("takes the probe's bar for 60 Hz, 17.5 ms, as holding", async () => {
    expect(await actOnDrop("high", "medium", page(17.5, "medium").deps)).toBe("lowered");
    expect(await actOnDrop("high", "medium", page(17.6, "medium").deps)).toBe("held");
  });

  it("shows no line when the switch fell back or ended the hike", async () => {
    const fellBack = page(16.7, "medium");
    expect(await actOnDrop("medium", "low", fellBack.deps)).toBe("fell-back");
    expect(fellBack.did.slice(-3)).toEqual(["switch low", "switched", "lift"]);
    const failed = page(16.7, "throws");
    expect(await actOnDrop("medium", "low", failed.deps)).toBe("failed");
    expect(failed.did.slice(-2)).toEqual(["switch low", "lift"]);
  });

  it("runs the loop again when anything before the switch throws, and lifts the cover", async () => {
    const timer = page(16.7, "low", true, { throwsAt: "time" });
    await expect(actOnDrop("medium", "low", timer.deps)).rejects.toThrow("no timer");
    expect(timer.did).toEqual(["cover", "stop", "time", "resume", "lift"]);
    const storage = page(16.7, "low", true, { throwsAt: "record" });
    await expect(actOnDrop("medium", "low", storage.deps)).rejects.toThrow("no storage");
    expect(storage.did).toEqual(["cover", "stop", "time", "record medium", "resume", "lift"]);
  });

  it("leaves the loop to the switch once the switch has run, even one that failed", async () => {
    const failed = page(16.7, "throws");
    expect(await actOnDrop("medium", "low", failed.deps)).toBe("failed");
    expect(failed.did).not.toContain("resume");
  });

  it("lifts the cover the moment the session ends mid-switch, once, and shows no line", async () => {
    const { deps, did } = page(16.7, "low", true, { endsMidSwitch: true });
    expect(await actOnDrop("medium", "low", deps)).toBe("lowered");
    expect(did).toEqual([
      "cover", "stop", "time",
      "record medium",
      "log quality governor: medium → low, 30 s of play under 48 fps",
      "switch low", "lift", "switched",
    ]);
  });

  it("writes and switches nothing once the game has gone, or its session ended, while it timed", async () => {
    const { deps, did } = page(16.7, "low", false);
    expect(await actOnDrop("medium", "low", deps)).toBe("gone");
    // The loop is handed back: an ended session's last seconds still draw.
    expect(did).toEqual(["cover", "stop", "time", "resume", "lift"]);
  });
});

describe("when a drop is acted on", () => {
  it("acts once, on the frame the drop latches when that frame is steady play", () => {
    const g = createGovernor(0);
    const acted: number[] = [];
    for (let t = 25; t <= 90_000; t += 25) if (g.frame(25, t)) acted.push(t);
    expect(acted).toEqual([60_000]);
  });

  it("waits while the pause screen is open, and acts on the first steady frame after it closes", () => {
    const g = createGovernor(0);
    feed(g, 0, 59_975, 25);
    // The pause screen opens on the frame that closes the third slow window.
    expect(g.frame(25, 60_000, false)).toBe(false);
    expect(g.verdict).toBe("drop");
    expect(g.frame(25, 75_000, false)).toBe(false);
    expect(g.frame(25, 75_025)).toBe(true);
    expect(g.frame(25, 75_050)).toBe(false);
  });

  it("counts nothing, and never acts, once the hike's session has ended", () => {
    const g = createGovernor(0);
    feed(g, 0, 59_975, 25);
    g.stop();
    expect(g.frame(25, 60_000)).toBe(false);
    expect(g.verdict).toBe("none");
    // A drop latched under the pause screen and not yet acted on stays so.
    const h = createGovernor(0);
    feed(h, 0, 59_975, 25);
    h.frame(25, 60_000, false);
    h.stop();
    expect(h.frame(25, 60_025)).toBe(false);
    h.restart(60_025);
    expect(h.frame(25, 200_000)).toBe(false);
  });

  it("acts at most once per hike, across restarts", () => {
    const g = createGovernor(0);
    feed(g, 0, 59_975, 25);
    expect(g.frame(25, 60_000)).toBe(true);
    g.restart(60_000);
    expect(g.frame(25, 200_000)).toBe(false);
  });
});
