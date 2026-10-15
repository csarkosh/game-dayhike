/**
 * A fixed data set in the shape the six queries return, for the page's
 * preview: a week around a test party, two builds, a handful of errors, and
 * one world's paths. Seeded, so the preview is the same every time.
 */

import type { Live, QueryName, Range, Row, Source } from "./source.js";
import { buildTrailFor } from "./trail.js";
import { GEN_VERSION } from "../sim/forest.js";
import { DEFAULT_TERRAIN_VARIANT } from "../sim/terrain.js";

const DAY = 86_400_000;
/** The sample's "now": the page's, to the minute, so the rows read as recent whenever it is looked at. */
const NOW = Math.floor(Date.now() / 60_000) * 60_000;
const BUILDS = ["5759b340", "9557492d"];
const WORLD = `forest/${GEN_VERSION}/${DEFAULT_TERRAIN_VARIANT}/-1771299565/88812`;
const SEED = 123456;

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
    const minutes = Math.round((4 + farthest * 22 + r() * 6) * 10) / 10;
    const started = NOW - i * 1_800_000 - 600_000;
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
      left_by: result === null && i % 7 !== 3 ? (["end", "exit", "session_end"] as const)[i % 3]! : null,
      minutes,
      started_at: iso(started),
      last_seen: iso(started + minutes * 60_000),
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

/**
 * Fourteen sessions on the real trail of the sample's seed, built as the
 * page builds it: up the stem a node at a time with a little wander, some
 * round a loop, some straying off the trail, some dying in the night, with
 * the route's events as the game would send them.
 */
function paths(): Row[] {
  const r = rng(23);
  const trail = buildTrailFor(WORLD, SEED);
  const rows: Row[] = [];
  if (trail === null) return rows;
  // The stem as a node chain, pad to crest: each stem edge in order, taken
  // from whichever end the chain is at, since an edge's ends are in no
  // particular order.
  const chain: number[] = [0];
  for (const i of trail.stem) {
    const e = trail.edges[i]!;
    const at = chain[chain.length - 1]!;
    chain.push(e.a === at ? e.b : e.a);
  }
  const loop = trail.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== "stem");
  const row = (sid: string, n: string, tick: number, fields: Row): Row => ({ world: WORLD, seed: SEED, sid, n, tick, build: "9557492d", timestamp: iso(NOW - 3_600_000 + tick * (1000 / 60)), ...fields });
  for (let s = 0; s < 14; s++) {
    const sid = `s${(0x3f8a + s * 0x53).toString(16)}`;
    const farthest = Math.min(1, 0.2 + Math.pow(r(), 0.6) * 0.85);
    const takesLoop = loop.length > 0 && r() < 0.5;
    const wander = 2 + r() * 6;
    const strays = r() < 0.3;
    let hp = 100;
    let tick = 0;
    let lamp = false;
    let lastEdge = -1;
    let off = false;
    const places = new Set<number>();
    rows.push(row(sid, "match_start", 0, { role: s % 3 === 0 ? "client" : "host" }));
    // Walk the chain node to node at about 1.4 m/s, a sample every 120 ticks.
    const walk: { x: number; z: number }[] = [];
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = trail.nodes[chain[i]!]!;
      const b = trail.nodes[chain[i + 1]!]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.round(len / 2.8));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        walk.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    const limit = Math.floor(walk.length * farthest);
    for (let k = 0; k < limit; k++) {
      const p = k / Math.max(1, walk.length - 1);
      let { x, z } = walk[k]!;
      x += (r() - 0.5) * wander;
      z += (r() - 0.5) * wander;
      const straying = strays && p > 0.5 && p < 0.6;
      if (straying) x += 25;
      tick += 120;
      if (p > 0.35 && !lamp) {
        lamp = true;
        rows.push(row(sid, "lamp", tick, { lamp_on: true, p }));
      }
      if (p > 0.6 && r() < 0.02) hp = Math.max(0, hp - 50);
      const sample = { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, yaw: Math.round(r() * 6.28 * 100) / 100, p: Math.round(p * 1000) / 1000, hp, lamp, sprint: r() < 0.2, off: straying ? 0.7 : 0, lens: Math.round(Math.max(0, p - 0.3) * 100) / 100, near: p > 0.95 ? 0.6 : 0, stare: 0 };
      rows.push(row(sid, "pos", tick, sample));
      // The nearest edge, as the trace reports it.
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < trail.edges.length; i++) {
        const e = trail.edges[i]!;
        const a = trail.nodes[e.a]!;
        const b = trail.nodes[e.b]!;
        const abx = b.x - a.x, abz = b.z - a.z;
        const l2 = abx * abx + abz * abz || 1;
        let tt = ((x - a.x) * abx + (z - a.z) * abz) / l2;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const d = Math.hypot(x - (a.x + abx * tt), z - (a.z + abz * tt));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best !== lastEdge) {
        lastEdge = best;
        rows.push(row(sid, "edge", tick, { edge: best, kind: trail.edges[best]?.kind ?? "", p }));
      }
      for (const f of trail.features) {
        if (Math.hypot(x - f.x, z - f.z) <= f.radius && !places.has(f.id)) {
          places.add(f.id);
          rows.push(row(sid, "place", tick, { id: f.id, kind: f.kind, name: f.name, in_place: true }));
        }
      }
      if (straying !== off) {
        off = straying;
        rows.push(row(sid, off ? "offtrail" : "ontrail", tick, { x: sample.x, z: sample.z, p }));
      }
      if (p > 0.7 && r() < 0.01) rows.push(row(sid, "hollow_seen", tick, { p }));
      if (hp === 0) {
        rows.push(row(sid, "death", tick, { x: sample.x, z: sample.z, p, near: 0.9 }));
        break;
      }
    }
    if (takesLoop) for (const [k, { i, e }] of loop.slice(0, 2).entries()) rows.push(row(sid, "edge", tick + 120 * (k + 1), { edge: i, kind: e.kind, p: farthest }));
    if (hp > 0 && farthest >= 0.98) rows.push(row(sid, "outcome", tick + 240, { result: r() < 0.5 ? "won" : "lost" }));
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
