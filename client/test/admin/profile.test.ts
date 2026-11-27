import { describe, it, expect } from "vitest";
import { howItRan, machinesOf, problemsOf, sessionTiers, sizeWords, summaryLine } from "../../src/admin/profile.js";
import type { Row } from "../../src/admin/source.js";

const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);
/** A row as the query returns it: its columns, and the whole payload as `row_json`. */
function row(n: string, payload: Record<string, unknown>, at: number, sid = "s1"): Row {
  return { timestamp: new Date(T0 + at * 1000).toISOString(), sid, n, row_json: JSON.stringify({ sid, n, ...payload }) };
}

describe("sizeWords", () => {
  it("reads megabytes under a thousand and gigabytes from there", () => {
    expect(sizeWords(640)).toBe("640 MB");
    expect(sizeWords(1229)).toBe("1.2 GB");
    expect(sizeWords(null)).toBe("not shared by the browser");
  });
});

describe("howItRan", () => {
  it("splits a session's heartbeats at the tier change", () => {
    const rows = [
      row("load", { tier: "high", source: "auto" }, 0),
      row("hb", { fps: 30 }, 1),
      row("hb", { fps: 32 }, 2),
      row("tier_change", { to: "medium", source: "auto" }, 3),
      row("hb", { fps: 58 }, 4),
      row("hb", { fps: 60 }, 5),
    ];
    const { runs } = howItRan(rows);
    expect(runs.map((r) => [r.tier, r.fps, r.sessions, r.verdict])).toEqual([
      ["high", 31, 1, "slow"],
      ["medium", 59, 1, "good"],
    ]);
  });

  it("marks the tier after a chosen change as chosen", () => {
    const rows = [row("load", { tier: "high", source: "auto" }, 0), row("hb", { fps: 60 }, 1), row("tier_change", { to: "low", source: "settings" }, 2), row("hb", { fps: 60 }, 3)];
    expect(howItRan(rows).runs.map((r) => [r.tier, r.chosen])).toEqual([["high", false], ["low", true]]);
  });

  it("notes a fallback and adds no run for the tier that failed", () => {
    const ended = howItRan([row("load", { tier: "high", source: "auto" }, 0), row("tier_fallback", { attempted: "high", built: "none" }, 1)]);
    expect(ended.notes).toEqual(["High could not be built and the hike ended"]);
    expect(ended.runs).toEqual([]);
    const used = howItRan([row("tier_fallback", { attempted: "high", built: "medium" }, 0), row("hb", { fps: 60 }, 1)]);
    expect(used.notes).toEqual(["High could not be built; Medium was used instead"]);
    expect(used.runs.map((r) => r.tier)).toEqual(["medium"]);
  });

  it("counts sessions that never started", () => {
    const rows = ["a", "b", "c"].flatMap((sid) => [row("page", { kind: "landing" }, 0, sid), row("end", { reason: "close" }, 1, sid)]);
    const ran = howItRan(rows);
    expect(ran.runs).toEqual([]);
    expect(ran.neverStarted).toBe(3);
    expect(summaryLine(ran)).toBe("Never started a hike in 3 sessions");
  });

  it("sums the load and counts a load with no heartbeat", () => {
    const rows = [row("load", { tier: "low", source: "auto", decideMs: 1000, engineMs: 2000, buildMs: 3000 }, 0), row("ready", { ms: 4000 }, 1)];
    const [run] = howItRan(rows).runs;
    expect(run?.loadMs).toBe(10_000);
    expect(run?.noFrames).toBe(1);
    expect(run?.fps).toBeNull();
    expect(run?.verdict).toBe("good");
  });

  it("says which tiers ran smoothly and which were choppy", () => {
    const rows = [row("load", { tier: "high", source: "auto" }, 0), row("hb", { fps: 30 }, 1), row("tier_change", { to: "medium", source: "auto" }, 2), row("hb", { fps: 60 }, 3)];
    expect(summaryLine(howItRan(rows))).toBe("Ran smoothly on Medium; was choppy on High.");
  });

  it("reads numbers the query sends as strings", () => {
    const [run] = howItRan([row("load", { tier: "high", source: "auto" }, 0), row("hb", { fps: "58.5", heap: "310" }, 1)]).runs;
    expect(run?.fps).toBe(58.5);
    expect(run?.heapPeakMb).toBe(310);
  });

  it("leaves memory unknown, not zero, where the browser shared none", () => {
    const [run] = howItRan([row("load", { tier: "high", source: "auto" }, 0), row("hb", { fps: 60 }, 1)]).runs;
    expect(run?.heapPeakMb).toBeNull();
    expect(run?.gpuPeakMb).toBeNull();
  });

  it("notes lost devices by session", () => {
    expect(howItRan([row("device_lost", {}, 0)]).notes).toEqual(["The graphics device was lost in 1 session"]);
  });
});

describe("machinesOf", () => {
  const env = { gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)", cores: 8, mem: 8, os: "darwin-arm64", browser: "Chrome 140", adapter: "ok", vw: 1512, vh: 982 };

  it("says what the browser would not share", () => {
    const [m] = machinesOf([row("page", { gpu: "", mem: 0, cores: 0 }, 0)]);
    expect([m?.gpu, m?.cores, m?.memory]).toEqual(["not shared by the browser", "not shared by the browser", "not shared by the browser"]);
  });

  it("reads memory, cores, device and window", () => {
    const [m] = machinesOf([row("page", { ...env, shell: "0.8.1", heapLimit: 4096 }, 0)]);
    expect(m?.memory).toBe("8 GB or more · 4.0 GB page limit");
    expect(m?.cores).toBe("8 cores");
    expect(m?.device).toBe("Desktop app");
    expect(m?.gpu).toBe("Apple M3 Max");
    expect(m?.adapter).toBe("WebGPU available");
    expect(m?.system).toBe("macOS, Chrome 140");
    expect(m?.window).toBe("1512 × 982 window");
  });

  it("tells a phone from a desktop", () => {
    expect(machinesOf([row("page", { ...env, mobile: true }, 0)])[0]?.device).toBe("Phone");
    expect(machinesOf([row("page", { ...env, mobile: false }, 0)])[0]?.device).toBe("Desktop");
  });

  it("keeps one machine per distinct gpu, latest first, counting sessions", () => {
    const rows = [row("page", env, 0, "a"), row("page", { ...env, gpu: "Other GPU" }, 10, "b"), row("page", env, 5, "c")];
    const ms = machinesOf(rows);
    expect(ms.map((m) => [m.gpu, m.sessions])).toEqual([["Other GPU", 1], ["Apple M3 Max", 2]]);
  });
});

describe("problemsOf", () => {
  it("groups by level, words and message, errors first", () => {
    const rows = [row("warn", { kind: "console", msg: "y" }, 0), row("error", { kind: "console", msg: "x" }, 1), row("error", { kind: "console", msg: "x" }, 2, "s2")];
    expect(problemsOf(rows).map((p) => [p.level, p.words, p.count])).toEqual([["error", "Console error", 2], ["warning", "Console warning", 1]]);
  });

  it("calls an uncaught error a crash and keeps the first session and stack", () => {
    const [p] = problemsOf([row("error", { kind: "uncaught", msg: "boom", stack: "at a" }, 5, "late"), row("error", { kind: "uncaught", msg: "boom" }, 1, "early")]);
    expect(p?.words).toBe("Crash");
    expect(p?.firstSid).toBe("early");
    expect(p?.stack).toBe("at a");
  });

  it("includes GPU errors and lost devices", () => {
    expect(problemsOf([row("gpu_error", { msg: "oom" }, 0), row("device_lost", { reason: "destroyed" }, 1)]).map((p) => p.words).sort()).toEqual(["GPU error", "Lost device"]);
  });
});

describe("sessionTiers", () => {
  it("gives each session its last tier and median frame rate", () => {
    const rows = [row("load", { tier: "high", source: "auto" }, 0), row("hb", { fps: 30 }, 1), row("tier_change", { to: "low", source: "auto" }, 2), row("hb", { fps: 50 }, 3), row("hb", { fps: 60 }, 4)];
    expect(sessionTiers(rows).get("s1")).toEqual({ tier: "low", fps: 50 });
  });
});
