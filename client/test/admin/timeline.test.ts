import { describe, it, expect } from "vitest";
import { clock, dayOf, delta, describe as describeEvent, duration, envelopeLine, opens, payloadOf, sessionsOf, toneOf, trailOf, when } from "../../src/admin/timeline.js";
import type { Row } from "../../src/admin/source.js";

/** 2026-10-14 23:05:51 UTC, which is 7:05:51 PM in New York (EDT). */
const T0 = Date.UTC(2026, 9, 14, 23, 5, 51);
const iso = (ms: number): string => new Date(ms).toISOString();

describe("the New York clocks", () => {
  it("label a moment on the New York wall clock and calendar", () => {
    expect(clock(T0)).toBe("7:05:51 PM");
    expect(dayOf(T0)).toBe("Wed, Oct 14, 2026");
    expect(when(T0)).toBe("Oct 14, 7:05 PM");
    // Past midnight in New York is still the day before UTC's.
    expect(dayOf(Date.UTC(2026, 9, 15, 3, 30))).toBe("Wed, Oct 14, 2026");
  });

  it("write a length of time short, and a step's delta with its sign", () => {
    expect(duration(0)).toBe("0.0 s");
    expect(duration(12_400)).toBe("12.4 s");
    expect(duration(182_000)).toBe("3 min 2 s");
    expect(duration(3_840_000)).toBe("1 h 4 min");
    expect(delta(null)).toBe("");
    expect(delta(1500)).toBe("+1.5 s");
    expect(delta(-200)).toBe("-0.2 s");
  });
});

describe("opens", () => {
  it("heads the segments in the order a session passes them, and not twice", () => {
    expect(opens(null, "page", "landing")).toBe("landing");
    expect(opens("landing", "page", "landing")).toBeNull();
    expect(opens("landing", "invite", "")).toBe("lobby");
    expect(opens("lobby", "lobby_joined", "")).toBeNull();
    expect(opens("landing", "page", "party")).toBe("lobby");
    expect(opens("lobby", "play", "")).toBe("loading");
    expect(opens("loading", "load", "")).toBeNull();
    expect(opens("loading", "match_start", "")).toBe("match");
    expect(opens("match", "outcome", "")).toBeNull();
    expect(opens("match", "match_end", "")).toBe("after");
    expect(opens("after", "exit", "")).toBeNull();
    expect(opens("after", "end", "")).toBeNull();
  });
});

describe("describe", () => {
  it("writes each event's payload as a short line", () => {
    expect(describeEvent("outcome", { result: "lost", self: "dead", alive: 0, players: 2 })).toBe("lost, dead, 0 alive of 2");
    expect(describeEvent("death", { cause: "hollow", p: 0.925, phase: "climb" })).toBe("hollow, 93% up, in the climb");
    expect(describeEvent("lobby_end", { reason: "left", members: 2 })).toBe("left, 2 were in");
    expect(describeEvent("tier_change", { from: "medium", to: "high", source: "choice", fellBack: false })).toBe("medium to high, (choice)");
    expect(describeEvent("load", { tier: "medium", engine: "webgl2", source: "choice", decideMs: 2, introMs: 102, engineMs: 5, buildMs: 2084 })).toBe("medium on webgl2 (choice), decide 2 ms, intro 102 ms, engine 5 ms, build 2084 ms");
    expect(describeEvent("hb", { fps: 59, rtt: 0, worst: 1015, stalls: 2, p: 0.001 })).toBe("59 fps, worst frame 1015 ms, 2 stalls, 0% up");
    expect(describeEvent("hb", { fps: 58, rtt: 41 })).toBe("58 fps, rtt 41 ms");
    expect(describeEvent("end", { reason: "pagehide", dur: 112_140, trouble: 0, failed: 0, dropped: 0 })).toBe("pagehide, after 1 min 52 s, trouble 0");
    expect(describeEvent("play", { party: 3 })).toBe("party of 3");
    expect(describeEvent("match_start", { role: "host", party: 2 })).toBe("host, party of 2");
    expect(describeEvent("settings", { choice: "high" })).toBe("high");
    expect(describeEvent("download", { platform: "mac" })).toBe("mac");
    expect(describeEvent("visibility", { state: "hidden" })).toBe("hidden");
    expect(describeEvent("error", { kind: "uncaught", where: "load:shaders", msg: "TypeError: x" })).toBe("uncaught at load:shaders, TypeError: x");
    expect(describeEvent("room_end", { reason: "host_left", lifeMs: 105_429 })).toBe("host_left, lived 1 min 45 s");
    expect(describeEvent("room_refused", { verb: "join", code: "no_such_lobby" })).toBe("join: no_such_lobby");
  });

  it("reads the strings BigQuery hands back as it reads numbers and booleans", () => {
    expect(describeEvent("match_end", { p: "0.5", ended: "true", dead: "false" })).toBe("50% up, ended");
    expect(describeEvent("lamp", { on: "true" })).toBe("on");
  });

  it("lists what an unknown event carried, the envelope aside", () => {
    expect(describeEvent("novel", { sid: "s", build: "b", at: 1, thing: "x", count: 2 })).toBe("thing x, count 2");
  });

  it("marks errors, warnings and the match's ends", () => {
    expect(toneOf("error", {})).toBe("error");
    expect(toneOf("tier_fallback", {})).toBe("warn");
    expect(toneOf("outcome", { result: "won" })).toBe("won");
    expect(toneOf("end", { trouble: 2 })).toBe("warn");
    expect(toneOf("end", { trouble: 0 })).toBe("");
    expect(toneOf("hb", {})).toBe("");
  });
});

const row = (ms: number, n: string, fields: Record<string, unknown> = {}, sid = "s1"): Row => ({
  timestamp: iso(T0 + ms),
  n,
  svc: "telemetry",
  sid,
  vid: "v1",
  build: "abc",
  kind: (fields.kind as string | undefined) ?? null,
  row_json: JSON.stringify({ n, sid, vid: "v1", build: "abc", os: "darwin-arm64", browser: "155", tz: "America/New_York", ...fields }),
});

describe("trailOf", () => {
  it("reads a session's rows into steps with their segments, text and the envelope's facts", () => {
    const rows: Row[] = [
      row(0, "page", { kind: "landing" }),
      row(1_400, "invite"),
      { timestamp: iso(T0 + 1_500), n: "room_create", svc: "signaling", lobby: "L1", row_json: JSON.stringify({ n: "room_create", peers: 1, room: "L1" }) },
      row(7_900, "lobby_joined", { kind: "invite", role: "host", members: 1, ms: 255, lobby: "L1" }),
      row(43_000, "play", { party: 1 }),
      row(48_000, "match_start", { role: "host", party: 1, game: "G1", lobby: "L1" }),
      row(49_000, "pos", { p: 0.001, hp: 100 }),
      row(49_100, "edge", { edge: 0, kind: "stem" }),
      row(60_000, "hb", { fps: 59 }),
      row(90_000, "outcome", { result: "won", self: "alive", alive: 1, players: 1 }),
      row(91_000, "match_end", { p: 1 }),
      row(92_000, "end", { reason: "pagehide", dur: 92_000, trouble: 0 }),
    ];
    const trail = trailOf(rows);
    expect(trail.sid).toBe("s1");
    expect(trail.vid).toBe("v1");
    expect(trail.build).toBe("abc");
    expect(trail.game).toBe("G1");
    expect(trail.lobby).toBe("L1");
    expect(trail.startedAt).toBe(T0);
    expect(trail.endedAt).toBe(T0 + 92_000);
    expect(trail.trace).toBe(2);
    expect(trail.steps.map((s) => s.opens)).toEqual(["landing", "lobby", null, null, "loading", "match", null, null, null, null, "after", null]);
    expect(trail.steps.map((s) => s.trace)).toEqual([false, false, false, false, false, false, true, true, false, false, false, false]);
    expect(trail.steps[2]?.signaling).toBe(true);
    expect(trail.steps[2]?.text).toBe("1 peer");
    expect(trail.steps[9]?.tone).toBe("won");
    expect(trail.steps[11]?.text).toBe("pagehide, after 1 min 32 s, trouble 0");
    expect(envelopeLine(trail.first)).toBe("darwin-arm64 155 · America/New_York");
  });

  it("falls back on the row's columns where there is no row_json", () => {
    const p = payloadOf({ n: "outcome", result: "lost", row_json: null });
    expect(describeEvent("outcome", p)).toBe("lost");
  });
});

describe("sessionsOf", () => {
  it("summarises each session among a visitor's or a match's rows, in the order they began", () => {
    const rows: Row[] = [
      row(0, "page", { kind: "landing" }, "s2"),
      row(100, "match_start", { role: "client", game: "G1" }, "s2"),
      row(500, "end", { reason: "pagehide", trouble: 0 }, "s2"),
      row(-5_000, "page", { kind: "landing" }, "s1"),
      row(-4_000, "match_start", { role: "host", game: "G1" }, "s1"),
      row(-1_000, "outcome", { result: "won" }, "s1"),
      row(9_000, "page", { kind: "landing" }, "s3"),
      row(9_500, "error", { kind: "uncaught", msg: "x" }, "s3"),
      { timestamp: iso(T0), n: "room_create", svc: "signaling", lobby: "L1" },
    ];
    const lines = sessionsOf(rows);
    expect(lines.map((l) => l.sid)).toEqual(["s1", "s2", "s3"]);
    expect(lines[0]).toMatchObject({ role: "host", game: "G1", end: "won", tone: "won", rows: 3, startedAt: T0 - 5_000, endedAt: T0 - 1_000 });
    expect(lines[1]).toMatchObject({ role: "client", end: "left (pagehide)", tone: "" });
    expect(lines[2]).toMatchObject({ end: "no goodbye", tone: "warn", errors: 1 });
  });
});
