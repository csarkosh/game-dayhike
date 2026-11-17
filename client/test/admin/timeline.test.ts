import { afterEach, describe, it, expect } from "vitest";
import { browserZone, calendarDate, clock, dayOf, delta, describe as describeEvent, duration, envelopeLine, fullWhen, opens, payloadOf, sessionsOf, toneOf, trailOf, useZone, viewerZone, when, zoneName } from "../../src/admin/timeline.js";
import type { Row } from "../../src/admin/source.js";

/** 2026-10-14 23:05:51 UTC, which is 7:05:51 PM in New York (EDT). */
const T0 = Date.UTC(2026, 9, 14, 23, 5, 51);
const iso = (ms: number): string => new Date(ms).toISOString();

/** 9:30 PM on Oct 22 in San Francisco (PDT), already 12:30 AM on Oct 23 in New York. */
const EVENING_PACIFIC = Date.UTC(2026, 9, 23, 4, 30);

describe("the viewer's clocks", () => {
  afterEach(() => useZone(browserZone()));

  it("start in the browser's own zone", () => {
    expect(viewerZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("label a moment on the viewer's wall clock and calendar", () => {
    useZone("America/New_York");
    expect(clock(T0)).toBe("7:05:51 PM");
    expect(dayOf(T0)).toBe("Wed, Oct 14, 2026");
    expect(when(T0)).toBe("Oct 14, 7:05 PM");
    // Past midnight in New York is still the day before UTC's.
    expect(dayOf(Date.UTC(2026, 9, 15, 3, 30))).toBe("Wed, Oct 14, 2026");
    useZone("America/Los_Angeles");
    expect(clock(T0)).toBe("4:05:51 PM");
    expect(fullWhen(T0)).toBe("Oct 14, 2026, 4:05:51 PM PDT");
  });

  it("put an evening in San Francisco on that day, not New York's next one", () => {
    useZone("America/Los_Angeles");
    expect(clock(EVENING_PACIFIC)).toBe("9:30:00 PM");
    expect(when(EVENING_PACIFIC)).toBe("Oct 22, 9:30 PM");
    expect(dayOf(EVENING_PACIFIC)).toBe("Thu, Oct 22, 2026");
    expect(calendarDate(EVENING_PACIFIC)).toBe("2026-10-22");
    useZone("America/New_York");
    expect(clock(EVENING_PACIFIC)).toBe("12:30:00 AM");
    expect(calendarDate(EVENING_PACIFIC)).toBe("2026-10-23");
  });

  it("name the zone by its short name at the moment", () => {
    useZone("America/Los_Angeles");
    expect(zoneName(EVENING_PACIFIC)).toBe("PDT");
    expect(zoneName(Date.UTC(2026, 11, 1))).toBe("PST");
    useZone("America/New_York");
    expect(zoneName(EVENING_PACIFIC)).toBe("EDT");
    useZone("UTC");
    expect(zoneName(EVENING_PACIFIC)).toBe("UTC");
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

  it("names a GPU error, its window, a lost device, its rebuild and a hike its lost devices ended", () => {
    const now = { ready: true, busy: "", film: false, hidden: false, shownMs: 41_000, scene: false, ending: false, dark: 0, rain: 0, wet: 0.15, night: 0, hour: 12, lakes: 0, sea: false, p: 0.312, tick: 4810 };
    expect(
      describeEvent("gpu_error", {
        ...now, tier: "medium", state: "standing", frames: 600, stoodMs: 20_000, r: 1, nth: 1, kind: "validation", src: "uncaptured",
        msg: "Buffer usages must not be 0.\n", labels: 'BufferDescriptor "forced-buffer"',
      }),
    ).toBe('validation, Buffer usages must not be 0., names BufferDescriptor "forced-buffer", medium renderer 1, stood 20.0 s, 600 frames, 31% up');
    // What was out of the ordinary is said, and only that.
    expect(
      describeEvent("gpu_error", {
        ...now, ready: false, busy: "switch", film: true, shownMs: 1200, scene: true, rain: 0.6, night: 0.9, lakes: 2, sea: true,
        tier: "high", state: "making", frames: 0, r: 2, nth: 3, kind: "out-of-memory", src: "scope", msg: "Out of memory", labels: "",
      }),
    ).toBe("out-of-memory (caught by a scope), Out of memory, high renderer 2, the renderer making, 0 frames, the world still loading, a switch under way, under the intro's film, the page shown 1.2 s before, a scene playing, rain, night, a lake in view, the sea in view, 31% up");
    expect(describeEvent("gpu_window", { ...now, r: 1, nth: 1, tier: "medium", state: "standing", ms: 5066, errors: 50, distinct: 1, total: 51, totalDistinct: 2, frames: 301, picture: "held", read: true, luma: 31, black: 0, spread: 14.8 })).toBe(
      "picture held, luminance 31 of 255, 0% black, spread 14.8, 301 frames drawn in 5.1 s, 50 errors, 1 distinct, 51 this hike",
    );
    expect(describeEvent("gpu_window", { ...now, r: 1, nth: 1, tier: "low", state: "standing", ms: 5000, errors: 300, distinct: 1, total: 300, totalDistinct: 1, frames: 300, picture: "broke", read: true, luma: 0, black: 1, spread: 0 })).toBe(
      "picture broke, luminance 0 of 255, 100% black, spread 0, 300 frames drawn in 5.0 s, 300 errors, 1 distinct",
    );
    expect(describeEvent("gpu_window", { ...now, hidden: true, r: 1, nth: 1, tier: "low", state: "lost", ms: 5000, errors: 1, distinct: 1, total: 1, totalDistinct: 1, frames: 0, picture: "unknown", read: false, unread: "the renderer is lost" })).toBe(
      "picture unknown, not read: the renderer is lost, 0 frames drawn in 5.0 s, 1 errors, 1 distinct, the page hidden, the renderer lost",
    );
    expect(
      describeEvent("device_lost", {
        ...now, tier: "medium", state: "standing", frames: 7100, stoodMs: 121_000, r: 2, reason: "unknown", msg: "The GPU process exited unexpectedly.", losses: 3, recent: 3, sinceMs: 107_000,
        verdict: "end", errors: 2, bufs: 1807, bufMB: 96.2, texs: 275, texMB: 540.3, heapMB: 311.4,
      }),
    ).toBe(
      "unknown: The GPU process exited unexpectedly., loss 3 of this page, 3 within the bound, 1 min 47 s after the last, the hike ends, medium renderer 2, stood 2 min 1 s, 7100 frames, 31% up, held 1807 buffers (96.2 MB) and 275 textures (540.3 MB), heap 311.4 MB, 2 GPU errors before it",
    );
    // The first loss of a page, on a device the page did not count, in a browser with no heap to read.
    expect(describeEvent("device_lost", { ...now, tier: "low", state: "making", frames: 0, r: 2, reason: "", msg: "", losses: 1, recent: 1, verdict: "rebuild", errors: 0 })).toBe(
      "no reason given, loss 1 of this page, 1 within the bound, rebuilt, low renderer 2, the renderer making, 0 frames, 31% up",
    );
    expect(describeEvent("engine_rebuilt", { reason: "lost", ok: true, ms: 4080, tier: "medium", engine: "webgpu", r: 3, state: "standing", frames: 96 })).toBe("stood again after lost, medium on webgpu renderer 3, 96 frames under the cover, in 4.1 s");
    expect(describeEvent("engine_rebuilt", { reason: "lost", ok: "false", ms: 10_400, tier: "medium", engine: "webgpu", r: 3, state: "failed", frames: 0 })).toBe(
      "did not stand (failed) after lost, medium on webgpu renderer 3, 0 frames under the cover, in 10.4 s",
    );
    expect(describeEvent("engine_rebuilt", { reason: "pipeline", ok: false, ms: 900, tier: "high", why: "Error: no tier builds" })).toBe("did not stand after pipeline, high, in 0.9 s, Error: no tier builds");
    expect(describeEvent("engine_rebuilt", { reason: "lost", ok: true, ms: 10_050, tier: "high", engine: "webgpu", r: 2, state: "making", frames: 0 })).toBe(
      "still being made as the cover lifted after lost, high on webgpu renderer 2, 0 frames under the cover, in 10.1 s",
    );
    expect(describeEvent("session_end", { msg: "The hike ended because the graphics kept failing.", p: 0.52, why: "device_lost", losses: 3, recent: 3 })).toBe(
      "The hike ended because the graphics kept failing., ended by lost devices: 3 this page, 3 within the bound, 52% up",
    );
    // An older page's rows read as they did, the climb beside them.
    expect(describeEvent("session_end", { msg: "The host ended this session.", p: 0.4 })).toBe("The host ended this session., 40% up");
    expect(describeEvent("session_end", { msg: "Lost connection to the host." })).toBe("Lost connection to the host.");
    expect(describeEvent("engine_failed", { reason: "lost" })).toBe("lost");
  });

  it("reads a lost device, a rebuild that did not stand and a hike its losses ended as errors, and a GPU error's window by its picture", () => {
    expect(toneOf("device_lost", {})).toBe("error");
    expect(toneOf("engine_failed", { reason: "lost" })).toBe("error");
    expect(toneOf("engine_rebuilt", { ok: true })).toBe("");
    expect(toneOf("engine_rebuilt", { ok: "true" })).toBe("");
    expect(toneOf("engine_rebuilt", { ok: false })).toBe("error");
    expect(toneOf("engine_rebuilt", { ok: "false" })).toBe("error");
    expect(toneOf("session_end", { msg: "any words", why: "device_lost" })).toBe("error");
    expect(toneOf("session_end", { msg: "The host ended this session." })).toBe("");
    expect(toneOf("gpu_window", { picture: "held" })).toBe("warn");
    expect(toneOf("gpu_window", { picture: "unknown" })).toBe("warn");
    expect(toneOf("gpu_window", { picture: "broke" })).toBe("error");
    // By itself a GPU error is a warning: its window says the rest (`trailOf`).
    expect(toneOf("gpu_error", { kind: "validation" })).toBe("warn");
  });

  it("names a visitor the load check turned away by the reason, in words, and marks it a warning", () => {
    expect(describeEvent("turned_away", { reason: "no-webgpu", adapter: "none" })).toBe("the browser has no WebGPU, adapter none");
    expect(describeEvent("turned_away", { reason: "no-adapter", adapter: "rejected" })).toBe("the browser gave no adapter, adapter rejected");
    expect(describeEvent("turned_away", { reason: "software", adapter: "ok" })).toBe("a software adapter, adapter ok");
    expect(describeEvent("turned_away", { reason: "short", short: "maxTextureDimension2D 4096 < 8192", adapter: "ok" })).toBe(
      "the adapter is short of what the game needs, short of maxTextureDimension2D 4096 < 8192, adapter ok",
    );
    // A reason this page does not know is said as it came, and a row with none says nothing.
    expect(describeEvent("turned_away", { reason: "novel" })).toBe("novel");
    expect(describeEvent("turned_away", {})).toBe("");
    for (const reason of ["no-webgpu", "no-adapter", "software", "short"]) expect(toneOf("turned_away", { reason })).toBe("warn");
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

  it("reads a GPU error by how its picture came out: an error where the window it fell in says it broke, a warning where it held or was never judged", () => {
    const trail = trailOf([
      row(0, "page", { kind: "game" }),
      row(1_000, "gpu_error", { game: "G1", w: 1, r: 1, nth: 1, kind: "validation", msg: "one bad draw" }),
      row(6_000, "gpu_window", { game: "G1", w: 1, r: 1, nth: 1, picture: "held", errors: 1, distinct: 1, frames: 300 }),
      row(20_000, "tier_change", { from: "medium", to: "low", source: "choice" }),
      // The same renderer, a later window: each error is read by its own.
      row(30_000, "gpu_error", { game: "G1", w: 2, r: 1, nth: 2, kind: "validation", msg: "the frame's target is gone" }),
      row(30_001, "gpu_error", { game: "G1", w: 2, r: 1, nth: 3, kind: "internal", msg: "and another" }),
      row(35_000, "gpu_window", { game: "G1", w: 2, r: 1, nth: 2, picture: "broke", errors: 300, distinct: 2, frames: 300, luma: 0, black: 1 }),
      row(40_000, "device_lost", { r: 1, reason: "unknown", msg: "gone", losses: 1, recent: 1, verdict: "rebuild" }),
      row(44_000, "engine_rebuilt", { reason: "lost", ok: true, r: 2, ms: 4000, frames: 90 }),
      // An error whose window was never sent (the page left first), one that fell in no window, and the next
      // hike's first, whose window has the broken one's number: none is judged by another's picture.
      row(50_000, "gpu_error", { game: "G1", w: 3, r: 2, nth: 4, kind: "validation", msg: "a last one" }),
      row(51_000, "gpu_error", { game: "G1", r: 2, nth: 5, kind: "validation", msg: "past the windows" }),
      row(90_000, "gpu_error", { game: "G2", w: 2, r: 1, nth: 1, kind: "validation", msg: "another hike's" }),
    ]);
    expect(trail.steps.map((s) => [s.n, s.tone])).toEqual([
      ["page", ""],
      ["gpu_error", "warn"],
      ["gpu_window", "warn"],
      ["tier_change", ""],
      ["gpu_error", "error"],
      ["gpu_error", "error"],
      ["gpu_window", "error"],
      ["device_lost", "error"],
      ["engine_rebuilt", ""],
      ["gpu_error", "warn"],
      ["gpu_error", "warn"],
      ["gpu_error", "warn"],
    ]);
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

  it("counts a lost device and a window whose picture broke among a session's errors, and no other GPU row", () => {
    const lines = sessionsOf([
      row(0, "page", { kind: "game" }, "s1"),
      row(1_000, "gpu_error", { r: 1, kind: "validation" }, "s1"),
      row(6_000, "gpu_window", { r: 1, picture: "held" }, "s1"),
      row(7_000, "gpu_error", { r: 1, kind: "validation" }, "s1"),
      row(12_000, "gpu_window", { r: 1, picture: "broke" }, "s1"),
      row(13_000, "device_lost", { r: 1, reason: "unknown" }, "s1"),
      row(17_000, "engine_rebuilt", { ok: true }, "s1"),
    ]);
    expect(lines[0]).toMatchObject({ rows: 7, errors: 2 });
  });
});
