import { describe, it, expect } from "vitest";
import { howItRan, machinesOf, problemsOf, problemsSummary, sessionRuns, sessionTiers, sizeWords, sourceWords, summaryLine } from "../../src/admin/profile.js";
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
    expect(used.notes).toEqual(["High could not be built once; Medium was used instead"]);
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

  it("counts every session on a tier, and the median of their medians", () => {
    const rows = [
      row("load", { tier: "high", source: "auto" }, 0, "a"),
      row("hb", { fps: 40 }, 1, "a"),
      row("hb", { fps: 40 }, 2, "a"),
      row("load", { tier: "high", source: "auto", decideMs: 1000 }, 0, "b"),
      row("ready", { ms: 1000 }, 1, "b"),
      row("load", { tier: "high", source: "auto" }, 0, "c"),
      row("hb", { fps: 60 }, 1, "c"),
    ];
    const [run] = howItRan(rows).runs;
    expect(run?.sessions).toBe(3);
    expect(run?.fps).toBe(50);
    const loadOnly = howItRan([rows[0] as Row, rows[1] as Row, rows[3] as Row, rows[4] as Row]).runs[0];
    expect(loadOnly?.sessions).toBe(2);
    expect(loadOnly?.noFrames).toBe(1);
  });

  it("counts a load that a fallback moved under the tier it ended on", () => {
    // As the engine writes them: the start-up fallback first, then the load, which names the tier it attempted.
    const rows = [row("tier_fallback", { attempted: "high", built: "medium" }, 0), row("load", { tier: "high", source: "auto", decideMs: 1000 }, 1), row("ready", { ms: 2000 }, 2), row("hb", { fps: 60 }, 3)];
    const { runs } = howItRan(rows);
    expect(runs.map((r) => [r.tier, r.loadMs])).toEqual([["medium", 3000]]);
  });

  it("puts a start-up fallback's frames under the tier built, in the engine's real order", () => {
    const rows = [
      row("tier_fallback", { attempted: "high", built: "medium", t: 1000 }, 0),
      row("load", { tier: "high", source: "auto", decideMs: 100, engineMs: 200, buildMs: 300, t: 1400 }, 0),
      row("ready", { ms: 900, t: 2500 }, 1),
      row("hb", { fps: 58, t: 5000 }, 2),
      row("hb", { fps: 62, t: 10_000 }, 3),
    ];
    const ran = howItRan(rows);
    expect(ran.runs.map((r) => [r.tier, r.sessions, r.fps, r.loadMs, r.noFrames])).toEqual([["medium", 1, 60, 1500, 0]]);
    expect(ran.notes).toEqual(["High could not be built once; Medium was used instead"]);
    expect(sessionRuns(rows).get("s1")?.tier).toBe("Medium");
    // No frames: the medium session is the one with no frames, and high has no run.
    const bare = howItRan(rows.slice(0, 3)).runs;
    expect(bare.map((r) => [r.tier, r.noFrames])).toEqual([["medium", 1]]);
  });

  it("ends the hike where the start-up fallback built nothing", () => {
    const rows = [row("tier_fallback", { attempted: "high", built: "none", t: 1000 }, 0), row("load", { tier: "high", source: "auto", t: 1400 }, 0), row("hb", { fps: 58 }, 1)];
    const ran = howItRan(rows);
    expect(ran.runs).toEqual([]);
    expect(ran.notes).toEqual(["High could not be built and the hike ended"]);
  });

  it("still moves a later in-hike fallback's frames to the tier it built", () => {
    const rows = [row("load", { tier: "high", source: "auto" }, 0), row("hb", { fps: 60 }, 1), row("tier_fallback", { attempted: "high", built: "low", t: 5000 }, 2), row("hb", { fps: 20 }, 3)];
    expect(howItRan(rows).runs.map((r) => [r.tier, r.fps])).toEqual([["high", 60], ["low", 20]]);
    expect(sessionRuns(rows).get("s1")?.tier).toBe("High then Low");
  });

  it("does not match a fallback of another tier to a load", () => {
    const rows = [row("tier_fallback", { attempted: "medium", built: "low", t: 1000 }, 0), row("load", { tier: "high", source: "auto", t: 1400 }, 0), row("hb", { fps: 60 }, 1)];
    expect(howItRan(rows).runs.map((r) => r.tier)).toEqual(["high"]);
  });

  it("groups the same fallback note across sessions with a count", () => {
    const fell = (sid: string): Row[] => [row("tier_fallback", { attempted: "high", built: "medium" }, 0, sid), row("load", { tier: "high", source: "auto" }, 0, sid), row("hb", { fps: 40 }, 1, sid)];
    expect(howItRan(["a", "b", "c"].flatMap(fell)).notes).toEqual(["High could not be built in 3 sessions; Medium was used instead"]);
  });

  it("speaks of frame rate alone in the summary", () => {
    // Fast frames but a slow load: the run's verdict is slow, the sentence still says smooth.
    const slowLoad = [row("load", { tier: "high", source: "auto", decideMs: 40_000 }, 0), row("ready", { ms: 1000 }, 1), row("hb", { fps: 60 }, 2)];
    expect(howItRan(slowLoad).runs[0]?.verdict).toBe("bad");
    expect(summaryLine(howItRan(slowLoad))).toBe("Ran smoothly on High.");
    const none = [row("load", { tier: "low", source: "auto" }, 0)];
    expect(summaryLine(howItRan(none))).toBe("No frames measured on Low.");
    const mixed = [...slowLoad, row("load", { tier: "low", source: "auto" }, 0, "b")];
    expect(summaryLine(howItRan(mixed))).toBe("Ran smoothly on High; no frames measured on Low.");
  });

  it("reads a load's own source as chosen with no heartbeat, and words a mix", () => {
    const [run] = howItRan([row("load", { tier: "high", source: "choice" }, 0)]).runs;
    expect(run?.chosen).toBe(true);
    expect(sourceWords(run!)).toBe("chosen");
    const sessions = [...Array(10).keys()].flatMap((i) => [row("load", { tier: "high", source: i < 3 ? "choice" : "auto" }, 0, `s${i}`), row("hb", { fps: 60 }, 1, `s${i}`)]);
    const [mix] = howItRan(sessions).runs;
    expect(mix?.chosen).toBe(false);
    expect(sourceWords(mix!)).toBe("auto in 7 of 10");
    expect(sourceWords(howItRan([row("load", { tier: "high", source: "auto" }, 0)]).runs[0]!)).toBe("auto");
  });

  it("counts the problems and the sessions they came from", () => {
    const rows = [row("error", { kind: "console", msg: "x" }, 0), row("warn", { kind: "console", msg: "y" }, 1), row("warn", { kind: "console", msg: "y" }, 2, "s2"), row("hb", { fps: 60 }, 3)];
    expect(problemsSummary(rows)).toBe("1 error and 2 warnings in 2 sessions");
    expect(problemsSummary([row("error", { kind: "console", msg: "x" }, 0)])).toBe("1 error and 0 warnings in 1 session");
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
  const env = { gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)", cores: 8, mem: 8, os: "darwin-arm64", browser: 140, ua: "Mozilla/5.0 (Macintosh) Chrome/140.0.0.0 Safari/537.36", adapter: "ok", vw: 1512, vh: 982 };

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

  it("takes a session's machine from the first row that has its graphics", () => {
    const rows = [row("page", { os: "darwin-arm64", cores: 8 }, 0), row("page", { ...env, adapter: "ok" }, 1)];
    const [m] = machinesOf(rows);
    expect(m?.gpu).toBe("Apple M3 Max");
    expect(m?.adapter).toBe("WebGPU available");
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

  it("groups a lost device by the reason and message the timeline shows", () => {
    const rows = [row("device_lost", { reason: "destroyed", msg: "one" }, 0), row("device_lost", { reason: "destroyed", msg: "one" }, 1), row("device_lost", { reason: "destroyed", msg: "two" }, 2)];
    expect(problemsOf(rows).map((p) => [p.msg, p.count])).toEqual([["destroyed: one", 2], ["destroyed: two", 1]]);
    expect(problemsOf([row("gpu_error", { kind: "validation", msg: "bad " }, 0)])[0]?.msg).toBe("validation, bad");
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

describe("the system line names the browser", () => {
  const base = { os: "darwin-arm64", gpu: "Apple M2" };
  const system = (p: Record<string, unknown>): string | undefined => machinesOf([row("page", { ...base, ...p }, 0)])[0]?.system;
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)";

  it("reads Chrome, Edge, Firefox and Safari from the user agent", () => {
    expect(system({ browser: 155, ua: `${MAC} Chrome/155.0.0.0 Safari/537.36` })).toBe("macOS, Chrome 155");
    expect(system({ browser: "154", ua: `${MAC} Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0` })).toBe("macOS, Edge 154");
    expect(system({ browser: 140, ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0" })).toBe("macOS, Firefox 140");
    expect(system({ browser: 18, ua: `${MAC} Version/18.1 Safari/605.1.15` })).toBe("macOS, Safari 18");
  });

  it("takes the major from the agent when the envelope has none", () => {
    expect(system({ browser: 0, ua: `${MAC} Chrome/155.0.0.0 Safari/537.36` })).toBe("macOS, Chrome 155");
  });

  it("keeps the number without an agent, and leaves the browser out with neither", () => {
    expect(system({ browser: 155 })).toBe("macOS, browser 155");
    expect(system({})).toBe("macOS");
  });

  it("names the phone browsers", () => {
    const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
    expect(system({ os: "ios", browser: 18, ua: IPHONE.slice(0, 120) })).toBe("iOS, Safari 18");
    expect(system({ os: "ios", browser: 18, ua: IPHONE.slice(0, 112) })).toBe("iOS, Safari 18");
    expect(system({ os: "ios", browser: 0, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1" })).toBe("iOS, Chrome 131");
    expect(system({ os: "ios", browser: 0, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15" })).toBe("iOS, Firefox 132");
    expect(system({ os: "ios", browser: 0, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/131.0.2903.92 Version/18.0 Mobile/15E148 Safari/604.1" })).toBe("iOS, Edge 131");
    expect(system({ os: "android-arm64", browser: 131, ua: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36" })).toBe("Android, Samsung Internet 25");
  });
});
