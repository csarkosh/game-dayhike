/**
 * A fixed data set in the shape the queries return, for the page's preview:
 * a week around a test party, two builds, a handful of errors, a few
 * visitors, one world's paths, and one session's trail (which also stands in
 * for a visitor's sessions and a match's). Seeded, so the preview is the same
 * every time.
 */

import type { Live, QueryName, Range, Row, Source } from "./source.js";
import { calendarDate } from "./timeline.js";
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
/** A day as the queries' `DATE` columns read it: the viewer's calendar date, as the routes would answer. */
const day = (ms: number): string => calendarDate(ms);

function funnel(): Row[] {
  return [
    { build: "all", landed: 181, pressed_play: 78, started: 69, finished: 40, sessions: 191, first_seen: iso(NOW - 5 * DAY), last_seen: iso(NOW - 600_000) },
    { build: "9557492d", landed: 143, pressed_play: 61, started: 54, finished: 31, sessions: 151, first_seen: iso(NOW - 2 * DAY), last_seen: iso(NOW - 600_000) },
    { build: "5759b340", landed: 38, pressed_play: 17, started: 15, finished: 9, sessions: 40, first_seen: iso(NOW - 5 * DAY), last_seen: iso(NOW - 2 * DAY) },
  ];
}

/** The kpis query's rows: the whole range, the two windows, and the weeks. */
function kpis(): Row[] {
  const r = rng(5);
  const rows: Row[] = [
    { kind: "range", period: "all", week_start: null, sessions: 191, matches: 62, ended: 170, clean: 161, erred: 7, visitors: 64, returning: 21 },
    { kind: "window", period: "current", week_start: null, sessions: 151, matches: 50, ended: 134, clean: 128, erred: 4, visitors: 52, returning: 17 },
    { kind: "window", period: "previous", week_start: null, sessions: 40, matches: 12, ended: 36, clean: 33, erred: 3, visitors: 19, returning: 6 },
  ];
  for (let i = 11; i >= 0; i--) {
    const monday = NOW - i * 7 * DAY;
    const sessions = i === 0 ? 151 : Math.floor(r() * 40);
    rows.push({ kind: "week", period: `W${12 - i}`, week_start: day(monday), sessions, matches: Math.floor(sessions / 3), ended: Math.floor(sessions * 0.9), clean: Math.floor(sessions * 0.85), erred: Math.floor(sessions * 0.03), visitors: Math.floor(sessions / 3), returning: Math.floor(sessions / 9) });
  }
  return rows;
}

/** The visitors query's rows: the browsers of the range, the most recently seen first. */
function visitors(): Row[] {
  const r = rng(17);
  const rows: Row[] = [];
  const machines = ["darwin-arm64 155", "win32-x64 141", "win32-x64 157", "linux-x64 140", "darwin-arm64 26"];
  for (let i = 0; i < 16; i++) {
    const sessions = i === 0 ? 11 : 1 + Math.floor(r() * 4);
    const last = NOW - i * 5_400_000 - 300_000;
    rows.push({
      vid: `v${(0x7a10 + i * 0x61).toString(16)}-${(0x1000 + i).toString(16)}`,
      sessions,
      days: Math.min(sessions, 1 + Math.floor(r() * 3)),
      played: Math.max(0, sessions - Math.floor(r() * 2)),
      finished: Math.floor(sessions / 2),
      build: i < 12 ? BUILDS[1]! : BUILDS[0]!,
      machine: machines[i % machines.length]!,
      last_sid: `s${(1000 + i * 37).toString(16)}`,
      first_seen: iso(last - sessions * 3_600_000),
      last_seen: iso(last),
    });
  }
  return rows;
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
    const party = 1 + Math.floor(r() * 5);
    rows.push({
      sid: `s${(1000 + i * 37).toString(16)}`,
      game: `g${(5000 + i * 91).toString(16)}`,
      build: i < 22 ? BUILDS[1]! : BUILDS[0]!,
      world: WORLD,
      players: Math.max(1, party - (r() < 0.3 ? 1 : 0)),
      party,
      farthest,
      wet: farthest >= 0.1,
      dusk: farthest >= 0.3,
      mist: farthest >= 0.4,
      summit: chase,
      chase,
      died,
      result: result ?? null,
      left_by: result === null && i % 7 !== 3 ? (["end", "exit", "session_end"] as const)[i % 3]! : null,
      minutes,
      started_at: iso(started),
      last_seen: iso(started + minutes * 60_000),
    });
  }
  return rows;
}

function errors(): Row[] {
  // The totals are distinct over the range and the same on every row.
  const totals = { sessions_with_errors: 5, sessions_with_warnings: 7 };
  return [
    { level: "error", n: "error", kind: "console", at_page: "game", msg: "WebGPU: the renderer could not be built on it; building it on WebGL2.", build: "9557492d", times: 4, sessions: 3, a_session: "s3f8a", a_machine: "win32-x64 141 ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)", last_seen: iso(NOW - 2_400_000), ...totals },
    { level: "error", n: "connect_fail", kind: null, at_page: "game", msg: "ice_failed", build: "9557492d", times: 2, sessions: 2, a_machine: "win32-x64 141 ANGLE (Intel, Intel(R) Iris(R) Xe)", last_seen: iso(NOW - 7_200_000), ...totals },
    { level: "error", n: "error", kind: "unhandled", at_page: "landing", msg: "TypeError: Failed to fetch", build: "5759b340", times: 1, sessions: 1, a_machine: "other 0 null", last_seen: iso(NOW - 3 * DAY), ...totals },
    { level: "warning", n: "warn", kind: "console", at_page: "game", msg: "forest impostor: bake retried once for clutter.fungus_b", build: "9557492d", times: 9, sessions: 6, a_machine: "darwin-arm64 26 Apple M2", last_seen: iso(NOW - 900_000), ...totals },
    { level: "warning", n: "tier_fallback", kind: null, at_page: "start", msg: null, build: "9557492d", times: 2, sessions: 2, a_session: "s41b2", a_machine: "darwin-arm64 26 Apple M1", last_seen: iso(NOW - 5_000_000), ...totals },
  ];
}

function health(): Row[] {
  const line = (build: string, tier: string, engine: string, sessions: number, played: number, ended: number, clean: number, silent: number, backgrounded: number, timing: number[]): Row => ({
    build,
    tier,
    engine,
    sessions,
    played,
    ended,
    clean,
    troubled: ended - clean,
    unknown: sessions - ended,
    backgrounded,
    ended_silently: silent,
    p50_start_ms: timing[0]!,
    p90_start_ms: timing[1]!,
    p50_ready_ms: timing[2]!,
    p50_fps: timing[3]!,
    p90_worst_frame_ms: timing[4]!,
  });
  return [
    line("9557492d", "high", "webgpu", 21, 19, 19, 17, 1, 1, [2640, 4810, 6100, 59.8, 180]),
    line("9557492d", "high", "webgl2", 14, 13, 13, 12, 0, 1, [2210, 3900, 5400, 58.9, 260]),
    line("9557492d", "medium", "webgl2", 25, 18, 22, 20, 2, 1, [1980, 3600, 4900, 57.5, 410]),
    line("9557492d", "low", "webgl2", 6, 4, 5, 4, 1, 0, [1720, 3100, 4200, 44.2, 900]),
    line("5759b340", "high", "webgpu", 9, 8, 8, 7, 1, 0, [2890, 5200, 6500, 59.6, 210]),
    line("5759b340", "medium", "webgl2", 8, 7, 8, 7, 0, 0, [2050, 3700, 5000, 56.8, 450]),
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

const LOBBY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GAME = "g1388";
const VID = "v7a10-1000";

/**
 * One session's trail: a session that landed, made a lobby, was joined,
 * loaded, played, hit a shader failure mid-climb, died and said goodbye.
 * Each row carries `row_json` as the query does, with the envelope's facts
 * the drawer reads from the first.
 */
function session(sid: string, offsetMs = 0): Row[] {
  const t0 = NOW - 40 * 60_000 - offsetMs;
  const at = (ms: number): string => iso(t0 + ms);
  const envelope = { sid, vid: VID, build: "9557492d", os: "darwin-arm64", browser: "155", gpu: "Apple M2", tz: "America/New_York", lang: "en-US", vw: 1440, vh: 900, path: "/dayhike/", ref: "" };
  const row = (ms: number, n: string, fields: Record<string, unknown> = {}): Row => {
    const payload = { n, t: ms, ...envelope, ...fields };
    return {
      timestamp: at(ms),
      t: ms,
      n,
      svc: "telemetry",
      sid,
      vid: VID,
      game: (fields.game as string | undefined) ?? null,
      lobby: (fields.lobby as string | undefined) ?? null,
      at_page: (fields.where as string | undefined) ?? null,
      kind: (fields.kind as string | undefined) ?? null,
      reason: (fields.reason as string | undefined) ?? null,
      result: (fields.result as string | undefined) ?? null,
      act: (fields.act as string | undefined) ?? null,
      phase: (fields.phase as string | undefined) ?? null,
      tier: (fields.tier as string | undefined) ?? null,
      fps: (fields.fps as number | undefined) ?? null,
      dur: (fields.dur as number | undefined) ?? null,
      trouble: (fields.trouble as number | undefined) ?? null,
      p: (fields.p as number | undefined) ?? null,
      msg: (fields.msg as string | undefined) ?? null,
      stack: (fields.stack as string | undefined) ?? null,
      build: "9557492d",
      row_json: JSON.stringify(payload),
    };
  };
  const signal = (ms: number, n: string, fields: Record<string, unknown> = {}): Row => ({
    timestamp: at(ms),
    t: null,
    n,
    svc: "signaling",
    sid: null,
    vid: null,
    game: null,
    lobby: LOBBY,
    at_page: null,
    kind: null,
    reason: (fields.reason as string | undefined) ?? null,
    result: null,
    act: null,
    phase: null,
    tier: null,
    fps: null,
    dur: (fields.lifeMs as number | undefined) ?? null,
    trouble: null,
    p: null,
    msg: (fields.code as string | undefined) ?? null,
    stack: null,
    build: "4580155c",
    row_json: JSON.stringify({ n, room: LOBBY, sbuild: "4580155c", ...fields }),
  });
  const inMatch = { game: GAME, lobby: LOBBY, world: WORLD, seed: SEED };
  return [
    row(0, "page", { kind: "landing" }),
    row(1_900, "invite"),
    row(2_000, "page", { kind: "party" }),
    signal(2_500, "room_create", { peers: 1, role: "host" }),
    row(2_600, "lobby_joined", { kind: "invite", role: "host", members: 1, ms: 480, lobby: LOBBY }),
    row(2_700, "invite_copied", { lobby: LOBBY }),
    signal(31_000, "room_join", { peers: 2, role: "client" }),
    row(31_200, "lobby_change", { members: 2, joined: 1, left: 0, lobby: LOBBY }),
    row(41_000, "play", { party: 2, lobby: LOBBY }),
    row(41_100, "page", { kind: "game", lobby: LOBBY }),
    row(46_900, "load", { tier: "high", engine: "webgpu", source: "choice", decideMs: 12, introMs: 102, engineMs: 410, buildMs: 2084, lobby: LOBBY }),
    row(52_400, "ready", { ms: 6100, lobby: LOBBY }),
    row(52_500, "match_start", { role: "host", party: 2, ...inMatch }),
    row(52_600, "intro", { reason: "stepOut", ...inMatch }),
    row(54_500, "pos", { tick: 120, x: -338.1, z: 0.2, p: 0.001, hp: 100, ...inMatch }),
    row(54_500, "edge", { edge: 0, kind: "stem", p: 0.001, ...inMatch }),
    row(82_500, "hb", { fps: 59, worst: 48, stalls: 0, rtt: 41, p: 0.02, ...inMatch }),
    row(190_000, "act", { act: "wet", p: 0.1, tick: 1445, ...inMatch }),
    row(260_000, "visibility", { state: "hidden", ...inMatch }),
    row(275_000, "visibility", { state: "visible", ...inMatch }),
    row(420_000, "act", { act: "dusk", p: 0.3, tick: 7698, ...inMatch }),
    row(421_000, "lamp", { on: true, p: 0.31, tick: 7720, ...inMatch }),
    row(601_000, "error", { where: "game", kind: "console", msg: "WebGPU: the renderer could not be built on it; building it on WebGL2.", stack: "Error: pipeline\n    at https://games.csarko.sh/dayhike/assets/index-CJQw8Dxw.js:2:5", ...inMatch }),
    row(601_100, "engine_failed", { reason: "pipeline", ...inMatch }),
    row(601_300, "tier_change", { from: "high", to: "medium", source: "fallback", fellBack: true, ...inMatch }),
    row(640_000, "act", { act: "mist", p: 0.4, tick: 11_600, ...inMatch }),
    row(1_250_000, "hollow_seen", { p: 0.88, tick: 16_878, ...inMatch }),
    row(1_310_000, "death", { cause: "hollow", p: 0.925, phase: "climb", near: 1, x: 652.3, z: 322.1, tick: 19_453, ...inMatch }),
    row(1_530_000, "outcome", { result: "lost", self: "dead", alive: 0, players: 2, p: 0.93, tick: 31_552, ...inMatch }),
    row(1_545_000, "match_end", { p: 0.93, ended: true, dead: true, ...inMatch }),
    row(1_545_500, "page", { kind: "landing", lobby: LOBBY }),
    row(1_545_800, "lobby_end", { reason: "left", members: 2 }),
    row(1_546_000, "end", { reason: "pagehide", dur: 1_546_000, trouble: 1, failed: 0, dropped: 0, sent: 52 }),
    signal(1_546_200, "room_leave", { host: true, peers: 1 }),
    signal(1_546_300, "room_end", { reason: "host_left", lifeMs: 1_543_800, peers: 1 }),
  ];
}

/** A visitor's sessions: the trail three times over, on three days, as the sample visitor's. */
function visitor(): Row[] {
  return [...session("s3f8a", 2 * DAY), ...session("s41b2", DAY + 3_600_000), ...session("s1000", 0)].filter((r) => r.svc === "telemetry");
}

/** A match's sessions: the host's trail and a follower's, side by side. */
function match(): Row[] {
  const follower = session("s3f8a", -30_000)
    .filter((r) => r.svc === "telemetry" && r.n !== "invite" && r.n !== "invite_copied")
    .map((r) => (r.n === "match_start" || r.n === "lobby_joined" ? { ...r, row_json: str(r.row_json).replace('"role":"host"', '"role":"client"') } : r));
  return [...session("s1000", 0), ...follower].sort((a, b) => Date.parse(str(a.timestamp)) - Date.parse(str(b.timestamp)));
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** A query's rows cut to the range, by the date column each carries. */
function within(rows: Row[], column: string, range: Range): Row[] {
  const since = NOW - range * DAY;
  return rows.filter((row) => {
    const value = row[column];
    return typeof value !== "string" || Date.parse(value) >= since;
  });
}

export function sampleSource(): Source {
  const tables: Record<QueryName, () => Row[]> = { funnel, lobbies, progress, errors, health, paths, kpis, visitors };
  const dated: Partial<Record<QueryName, string>> = { lobbies: "day", progress: "started_at", errors: "last_seen", funnel: "last_seen", visitors: "last_seen" };
  return {
    kind: "sample",
    query: (name, range) => {
      const rows = tables[name]();
      const column = dated[name];
      return Promise.resolve(column === undefined ? rows : within(rows, column, range));
    },
    live: () => Promise.resolve(live()),
    session: (sid) => Promise.resolve(session(sid)),
    visitor: () => Promise.resolve(visitor()),
    match: () => Promise.resolve(match()),
  };
}
