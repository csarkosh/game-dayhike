/**
 * A fixed data set in the shape the six queries return, for the page's
 * preview: a week around a test party, two builds, a handful of errors, and
 * one world's paths. Seeded, so the preview is the same every time.
 */

import type { Live, QueryName, Range, Row, Source } from "./source.js";

const DAY = 86_400_000;
/** The sample's "now": the page's, to the minute, so the rows read as recent whenever it is looked at. */
const NOW = Math.floor(Date.now() / 60_000) * 60_000;
const BUILDS = ["5759b340", "9557492d"];
const WORLD = "forest/8/peninsula/-1771299565/88812";

/** A small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();
const day = (ms: number): string => iso(ms).slice(0, 10);

function funnel(): Row[] {
  return [
    { build: "9557492d", landed: 143, pressed_play: 61, started: 54, finished: 31, sessions: 151, first_seen: iso(NOW - 2 * DAY), last_seen: iso(NOW - 600_000) },
    { build: "5759b340", landed: 38, pressed_play: 17, started: 15, finished: 9, sessions: 40, first_seen: iso(NOW - 5 * DAY), last_seen: iso(NOW - 2 * DAY) },
  ];
}

function lobbies(): Row[] {
  const r = rng(7);
  const rows: Row[] = [];
  for (let i = 6; i >= 0; i--) {
    const party = i === 0;
    const lobbies = party ? 23 : Math.floor(r() * 4);
    rows.push({
      day: day(NOW - i * DAY),
      lobbies,
      lobbies_joined: party ? 19 : Math.min(lobbies, Math.floor(r() * 3)),
      largest: party ? 5 : lobbies === 0 ? null : 1 + Math.floor(r() * 3),
      median_life_min: lobbies === 0 ? null : Math.round((party ? 24 : 8 + r() * 20) * 10) / 10,
      refused_full: party ? 3 : 0,
      refused_stale_invite: party ? 2 : Math.floor(r() * 2),
      refused_host_away: party ? 1 : 0,
      hosts_lost: party ? 2 : 0,
    });
  }
  return rows;
}

function progress(): Row[] {
  const r = rng(11);
  const rows: Row[] = [];
  const results = ["won", "lost", "lost", "won", null] as const;
  for (let i = 0; i < 28; i++) {
    const farthest = Math.min(1, Math.round(Math.pow(r(), 0.6) * 1000) / 1000);
    const chase = farthest >= 0.98;
    const result = chase ? results[i % 4] : i % 5 === 0 ? "lost" : null;
    const died = result === "lost" || r() < 0.2;
    rows.push({
      sid: `s${(1000 + i * 37).toString(16)}`,
      game: `g${(5000 + i * 91).toString(16)}`,
      build: i < 22 ? BUILDS[1]! : BUILDS[0]!,
      world: WORLD,
      role: r() < 0.6 ? "host" : "client",
      party: 1 + Math.floor(r() * 5),
      farthest,
      wet: farthest >= 0.1,
      dusk: farthest >= 0.3,
      mist: farthest >= 0.4,
      summit: chase,
      chase,
      died,
      result: result ?? null,
      self_at_end: result === null ? null : died ? "dead" : "alive",
      left_by: result === null ? (r() < 0.5 ? "exit" : "session_end") : null,
      minutes: Math.round((4 + farthest * 22 + r() * 6) * 10) / 10,
      started_at: iso(NOW - i * 1_800_000 - 600_000),
    });
  }
  return rows;
}

function errors(): Row[] {
  return [
    { n: "error", kind: "console", at_page: "game", msg: "WebGPU: the renderer could not be built on it; building it on WebGL2.", build: "9557492d", times: 4, sessions: 3, a_session: "s3f8a", a_machine: "win32-x64 141 ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)", last_seen: iso(NOW - 2_400_000) },
    { n: "tier_fallback", kind: null, at_page: "start", msg: null, build: "9557492d", times: 2, sessions: 2, a_session: "s41b2", a_machine: "darwin-arm64 26 Apple M1", last_seen: iso(NOW - 5_000_000) },
    { n: "connect_fail", kind: null, at_page: "game", msg: "ice_failed", build: "9557492d", times: 2, sessions: 2, a_machine: "win32-x64 141 ANGLE (Intel, Intel(R) Iris(R) Xe)", last_seen: iso(NOW - 7_200_000) },
    { n: "warn", kind: "console", at_page: "game", msg: "forest impostor: bake retried once for clutter.fungus_b", build: "9557492d", times: 9, sessions: 6, a_machine: "darwin-arm64 26 Apple M2", last_seen: iso(NOW - 900_000) },
    { n: "error", kind: "unhandled", at_page: "landing", msg: "TypeError: Failed to fetch", build: "5759b340", times: 1, sessions: 1, a_machine: "other 0 null", last_seen: iso(NOW - 3 * DAY) },
  ];
}

function health(): Row[] {
  return [
    { build: "9557492d", tier: "high", engine: "webgpu", sessions: 21, played: 19, ended_silently: 1, clean: 17, p50_start_ms: 2640, p90_start_ms: 4810, p50_ready_ms: 6100, p50_fps: 59.8, p90_worst_frame_ms: 180 },
    { build: "9557492d", tier: "high", engine: "webgl2", sessions: 14, played: 13, ended_silently: 0, clean: 12, p50_start_ms: 2210, p90_start_ms: 3900, p50_ready_ms: 5400, p50_fps: 58.9, p90_worst_frame_ms: 260 },
    { build: "9557492d", tier: "medium", engine: "webgl2", sessions: 25, played: 18, ended_silently: 2, clean: 20, p50_start_ms: 1980, p90_start_ms: 3600, p50_ready_ms: 4900, p50_fps: 57.5, p90_worst_frame_ms: 410 },
    { build: "9557492d", tier: "low", engine: "webgl2", sessions: 6, played: 4, ended_silently: 1, clean: 4, p50_start_ms: 1720, p90_start_ms: 3100, p50_ready_ms: 4200, p50_fps: 44.2, p90_worst_frame_ms: 900 },
    { build: "5759b340", tier: "high", engine: "webgpu", sessions: 9, played: 8, ended_silently: 1, clean: 7, p50_start_ms: 2890, p90_start_ms: 5200, p50_ready_ms: 6500, p50_fps: 59.6, p90_worst_frame_ms: 210 },
    { build: "5759b340", tier: "medium", engine: "webgl2", sessions: 8, played: 7, ended_silently: 0, clean: 7, p50_start_ms: 2050, p90_start_ms: 3700, p50_ready_ms: 5000, p50_fps: 56.8, p90_worst_frame_ms: 450 },
  ];
}

/** Twelve sessions walking a winding stem up the peninsula, a sample every five seconds, some straying and some dying. */
function paths(): Row[] {
  const r = rng(23);
  const rows: Row[] = [];
  const stem = (p: number): [number, number] => [Math.sin(p * 9) * 60 + p * 40, -p * 520 + 20];
  for (let s = 0; s < 12; s++) {
    const farthest = Math.min(1, 0.25 + Math.pow(r(), 0.7) * 0.8);
    const wander = 6 + r() * 14;
    let hp = 100;
    for (let t = 0; t <= 240; t++) {
      const p = Math.min(farthest, t / 220);
      const [sx, sz] = stem(p);
      const x = sx + (r() - 0.5) * wander;
      const z = sz + (r() - 0.5) * wander;
      if (p > 0.6 && r() < 0.03) hp = Math.max(0, hp - 40);
      rows.push({ world: WORLD, seed: 123456, sid: `s${s}`, tick: t * 300, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, p: Math.round(p * 1000) / 1000, hp });
      if (p >= farthest && t > 200) break;
      if (hp === 0) break;
    }
  }
  return rows;
}

function live(): Live {
  const at = Date.now();
  return {
    at,
    instances: [{ id: "fps-signaling-00033-7d5-98f3960c", seenAt: at - 20_000 }],
    rooms: [
      { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", hostId: "h-a1", createdAt: at - 14 * 60_000, hostDroppedAt: null, peers: 4 },
      { id: "9a0c0305-e82c-4330-8f25-04e04f8941d3", hostId: "h-b7", createdAt: at - 3 * 60_000, hostDroppedAt: null, peers: 2 },
      { id: "c1d2e3f4-1111-4222-8333-444444444444", hostId: "h-c2", createdAt: at - 41 * 60_000, hostDroppedAt: at - 20_000, peers: 1 },
    ],
  };
}

/** One session's timeline: a session that loaded, played, hit a shader failure mid-climb and ended. */
function session(sid: string): Row[] {
  const t0 = NOW - 40 * 60_000;
  const at = (ms: number): string => iso(t0 + ms);
  const row = (ms: number, n: string, fields: Row = {}): Row => ({ timestamp: at(ms), t: ms, n, svc: "telemetry", at_page: null, kind: null, msg: null, stack: null, lobby: null, build: "9557492d", ...fields });
  return [
    row(0, "page", { at_page: "landing" }),
    row(1_900, "play"),
    row(2_000, "page", { at_page: "game" }),
    row(2_050, "invite"),
    row(2_600, "lobby_joined", { lobby: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }),
    { timestamp: at(2_600), t: null, n: "room_create", svc: "signaling", at_page: null, kind: null, msg: null, stack: null, lobby: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", build: "9557492d" },
    row(6_900, "load", { at_page: "start:build" }),
    row(12_400, "ready"),
    row(12_500, "match_start"),
    { timestamp: at(41_000), t: null, n: "room_join", svc: "signaling", at_page: null, kind: null, msg: null, stack: null, lobby: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", build: "9557492d" },
    row(30_000, "hb"),
    row(41_200, "lobby_change"),
    row(190_000, "act", { kind: "wet" }),
    row(420_000, "act", { kind: "dusk" }),
    row(601_000, "error", { at_page: "game", kind: "console", msg: "WebGPU: the renderer could not be built on it; building it on WebGL2.", stack: "Error: pipeline\n    at https://games.csarko.sh/dayhike/assets/index-CJQw8Dxw.js:2:5" }),
    row(601_100, "engine_failed", { kind: "pipeline" }),
    row(640_000, "act", { kind: "mist" }),
    row(1_310_000, "death"),
    row(1_530_000, "outcome", { msg: "lost" }),
    row(1_545_000, "match_end"),
    row(1_546_000, "end", { msg: "pagehide" }),
    { timestamp: at(1_546_200), t: null, n: "room_leave", svc: "signaling", at_page: null, kind: null, msg: null, stack: null, lobby: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", build: "9557492d" },
    { timestamp: at(1_546_300), t: null, n: "room_end", svc: "signaling", at_page: null, kind: "host_left", msg: null, stack: null, lobby: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", build: "9557492d" },
  ].map((r) => ({ ...r, sid }));
}

/** A query's rows cut to the range, by the date column each carries. */
function within(rows: Row[], column: string, range: Range): Row[] {
  const since = NOW - range * DAY;
  return rows.filter((row) => {
    const value = row[column];
    return typeof value !== "string" || Date.parse(value) >= since;
  });
}

export function sampleSource(): Source {
  const tables: Record<QueryName, () => Row[]> = { funnel, lobbies, progress, errors, health, paths };
  const dated: Partial<Record<QueryName, string>> = { lobbies: "day", progress: "started_at", errors: "last_seen", funnel: "last_seen" };
  return {
    kind: "sample",
    query: (name, range) => {
      const rows = tables[name]();
      const column = dated[name];
      return Promise.resolve(column === undefined ? rows : within(rows, column, range));
    },
    live: () => Promise.resolve(live()),
    session: (sid) => Promise.resolve(session(sid)),
  };
}
