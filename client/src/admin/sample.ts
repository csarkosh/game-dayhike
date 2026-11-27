/**
 * A fixed data set in the shape the queries return, for the page's preview:
 * a week around a test party, two builds, a handful of errors, a few
 * visitors, one world's paths, and one session's trail (which also stands in
 * for a visitor's sessions and a match's). The trail carries one of each
 * thing the GPU can do under a hike: an error whose picture held, one whose
 * picture broke, and a lost device with its rebuild; the session `ENDED_SID`
 * is one whose hike was ended by its lost devices. Seeded, so the preview is
 * the same every time.
 */

import type { Live, QueryName, Range, Row, Source } from "./source.js";
import { calendarDate } from "./timeline.js";
import { buildTrailFor, type DrawableTrail } from "./trail.js";
import { GEN_VERSION } from "@csarkosh/engine/sim/forest";
import { DEFAULT_TERRAIN_VARIANT } from "@csarkosh/engine/sim/terrain";

/** The line a hike ended by lost devices leaves, in Day Hike's words (`lossEndedLine` makes it): the admin page runs no game, so no identity is set to make it from. */
const LOSS_ENDED_LINE = "The hike ended: this device's graphics keep resetting. Restarting the browser may help.";
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
    { build: "all", landed: 181, turned_away: 6, pressed_play: 78, started: 69, finished: 40, sessions: 191, first_seen: iso(NOW - 5 * DAY), last_seen: iso(NOW - 600_000) },
    { build: "9557492d", landed: 143, turned_away: 6, pressed_play: 61, started: 54, finished: 31, sessions: 151, first_seen: iso(NOW - 2 * DAY), last_seen: iso(NOW - 600_000) },
    { build: "5759b340", landed: 38, turned_away: 0, pressed_play: 17, started: 15, finished: 9, sessions: 40, first_seen: iso(NOW - 5 * DAY), last_seen: iso(NOW - 2 * DAY) },
  ];
}

/** The machines query's rows: each chip against each tier it ran on, one masked GPU and one phone among them. */
function machines(): Row[] {
  // A chip's players over every tier it ran on: a player on two tiers counts once.
  const chipPlayers: Record<string, number> = { "Apple M2|false": 14, "NVIDIA GeForce RTX 3060|false": 9, "Intel(R) UHD Graphics 620|false": 7, "|false": 4, "Apple GPU|true": 5 };
  const row = (gpu: string, mobile: boolean, tier: string, players: number, sessions: number, fps: number | null, [good, slow, bad]: [number, number, number], loadMs: number, auto: number, cores: number, mem: number, oses: string): Row => ({
    gpu, mobile, tier, chip_players: chipPlayers[`${gpu}|${mobile}`] ?? players, players, sessions, fps, good, slow, bad, no_frames: sessions - good - slow - bad, load_ms: loadMs, auto_sessions: auto, cores, mem, oses,
  });
  return [
    row("Apple M2", false, "high", 14, 31, 59.6, [30, 1, 0], 6_100, 28, 8, 8, "darwin-arm64"),
    row("NVIDIA GeForce RTX 3060", false, "high", 9, 17, 58.2, [16, 1, 0], 7_400, 15, 12, 8, "win32-x64"),
    row("Intel(R) UHD Graphics 620", false, "medium", 6, 11, 41.0, [3, 6, 2], 16_800, 8, 4, 8, "win32-x64"),
    row("Intel(R) UHD Graphics 620", false, "low", 3, 5, 28.4, [0, 2, 3], 24_000, 5, 4, 8, "win32-x64"),
    row("", false, "medium", 4, 6, 47.5, [2, 4, 0], 12_000, 6, 0, 0, "darwin-arm64"),
    row("Apple GPU", true, "low", 5, 9, 33.0, [1, 6, 2], 21_500, 9, 6, 4, "ios"),
    row("Apple GPU", true, "medium", 1, 2, null, [0, 0, 0], 18_000, 2, 6, 4, "ios"),
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
/** The sample's places, one a player in turn, as the collector's city database names them; the last is not placed. */
const PLACES: { city: string | null; region: string | null; country: string | null }[] = [
  { city: "Seattle", region: "Washington", country: "US" },
  { city: "Port Angeles", region: "Washington", country: "US" },
  { city: "Brooklyn", region: "New York", country: "US" },
  { city: "London", region: "England", country: "GB" },
  { city: "Toronto", region: "Ontario", country: "CA" },
  { city: "Berlin", region: "Land Berlin", country: "DE" },
  { city: "Portland", region: "Oregon", country: "US" },
  { city: null, region: null, country: null },
];
const placeAt = (i: number): (typeof PLACES)[number] => PLACES[i % PLACES.length]!;
const GPUS = ["Apple M2", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)", "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)", "ANGLE (AMD, AMD Radeon RX 6700 XT (radeonsi navi22 LLVM 17.0.6), OpenGL 4.6)", "Apple GPU"];

function errors(): Row[] {
  // The totals are distinct over the range and the same on every row.
  const totals = { sessions_with_errors: 7, sessions_with_warnings: 14 };
  return [
    { whose: "players", level: "error", n: "error", kind: "console", at_page: "game", msg: "WebGPU: the renderer could not be built on it; building it on WebGL2.", build: "9557492d", times: 4, sessions: 3, a_session: "s3f8a", a_machine: "win32-x64 141 ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)", last_seen: iso(NOW - 2_400_000), ...totals },
    { whose: "players", level: "error", n: "connect_fail", kind: null, at_page: "game", msg: "ice_failed", build: "9557492d", times: 2, sessions: 2, a_machine: "win32-x64 141 ANGLE (Intel, Intel(R) Iris(R) Xe)", last_seen: iso(NOW - 7_200_000), ...totals },
    { whose: "players", level: "error", n: "error", kind: "unhandled", at_page: "landing", msg: "TypeError: Failed to fetch", build: "5759b340", times: 1, sessions: 1, a_machine: "other 0 null", last_seen: iso(NOW - 3 * DAY), ...totals },
    { whose: "you", level: "error", n: "error", kind: "uncaught", at_page: "game", msg: "RangeError: offset is out of bounds (trail chunk 14)", build: "9557492d", times: 1, sessions: 1, a_session: "s9c01", a_machine: "darwin-arm64 26 Apple M3 Max", last_seen: iso(NOW - 1_500_000), ...totals },
    { whose: "players", level: "error", n: "gpu_error", kind: "validation", at_page: null, msg: "[Texture \"post_scene_resolved\"] used in submit while destroyed.", build: "9557492d", times: 1, sessions: 1, a_session: "s3f8a", a_machine: "darwin-arm64 155 Apple M2", last_seen: iso(NOW - 1_600_000), ...totals },
    { whose: "players", level: "error", n: "device_lost", kind: null, at_page: null, msg: "The GPU process exited unexpectedly.", build: "9557492d", times: 4, sessions: 2, a_session: ENDED_SID, a_machine: "win32-x64 141 ANGLE (AMD, Radeon RX 580)", last_seen: iso(NOW - 1_800_000), ...totals },
    { whose: "players", level: "error", n: "session_end", kind: null, at_page: null, msg: LOSS_ENDED_LINE, build: "9557492d", times: 1, sessions: 1, a_session: ENDED_SID, a_machine: "win32-x64 141 ANGLE (AMD, Radeon RX 580)", last_seen: iso(NOW - 1_800_000), ...totals },
    { whose: "players", level: "warning", n: "gpu_error", kind: "validation", at_page: null, msg: "Vertex range (first: 0, count: 2616) requires a larger buffer (62784) than the bound buffer size (3139", build: "9557492d", times: 3, sessions: 2, a_session: "s3f8a", a_machine: "darwin-arm64 155 Apple M2", last_seen: iso(NOW - 1_700_000), ...totals },
    { whose: "players", level: "warning", n: "warn", kind: "console", at_page: "game", msg: "forest impostor: bake retried once for clutter.fungus_b", build: "9557492d", times: 9, sessions: 6, a_machine: "darwin-arm64 26 Apple M2", last_seen: iso(NOW - 900_000), ...totals },
    { whose: "players", level: "warning", n: "tier_fallback", kind: null, at_page: "start", msg: null, build: "9557492d", times: 2, sessions: 2, a_session: "s41b2", a_machine: "darwin-arm64 26 Apple M1", last_seen: iso(NOW - 5_000_000), ...totals },
    // Visitors the load check turned away, by the reason: the browser has no WebGPU, or the GPU behind it cannot play.
    { whose: "players", level: "warning", n: "turned_away", kind: "no-webgpu", at_page: null, msg: null, build: "9557492d", times: 4, sessions: 4, a_machine: "darwin-arm64 18 Apple GPU", last_seen: iso(NOW - 4_000_000), ...totals },
    { whose: "players", level: "warning", n: "turned_away", kind: "software", at_page: null, msg: null, build: "9557492d", times: 2, sessions: 2, a_machine: "win32-x64 141 ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)", last_seen: iso(NOW - 6_000_000), ...totals },
  ];
}

/**
 * Twelve players' load times and frame rates, one a visitor of the sample's
 * list, spread over good, slow and bad so every mark shows: most load in a few
 * seconds and run near 60 fps, a few laptops crawl, one phone does both, and
 * one left before the world was in.
 */
/**
 * Where the sample's visitors are, as the collector's city database places them: a handful of
 * cities, a few with one visit, and the visits from before the database, which have no place.
 */
/**
 * Sixteen players, one a visitor of the sample's lists, as the Players card reads them: a third
 * only looked, the rest played, some to an end; most load in seconds at near 60 fps, a few laptops
 * and a phone crawl, one left before the world was in; each placed in turn, the last of the
 * places not placed at all.
 */
function players(): Row[] {
  const r = rng(17);
  // [load ms, median fps, worst frame ms] a player; null where they never got that far.
  const timing: [number | null, number | null, number | null][] = [
    [7_200, 59.8, 120], [9_600, 59.1, 180], [19_900, 41.5, 520], [48_400, 24.3, 1_400], [6_900, 60, 90], [11_800, 58.2, 240],
    [12_400, 33.0, 610], [8_800, 59.9, 110], [null, null, null], [22_600, 56.4, 300], [10_100, 27.8, 900], [7_400, 60, 100],
    [8_100, 59.5, 140], [14_200, 52.0, 380], [9_000, 60, 120], [31_500, 45.0, 700],
  ];
  const machines: [string, string, string][] = [
    ["darwin-arm64", "high", "webgpu"], ["win32-x64", "high", "webgpu"], ["win32-x64", "low", "webgpu"], ["linux-x64", "high", "webgpu"], ["darwin-arm64", "low", "webgl2"],
  ];
  return timing.map(([load, fps, worst], i) => {
    const sessions = i === 0 ? 11 : 1 + Math.floor(r() * 4);
    const days = Math.min(sessions, 1 + Math.floor(r() * 3));
    const looked = fps === null || i % 3 === 2;
    const played = looked ? 0 : Math.max(1, sessions - Math.floor(r() * 2));
    const finished = looked || i % 4 === 1 ? 0 : Math.min(played, Math.floor(sessions / 2) || 1);
    const farthest = looked ? null : finished > 0 ? (i % 5 === 0 ? 1 : 0.98) : Math.round((0.1 + r() * 0.8) * 1000) / 1000;
    const [os, tier, engine] = machines[i % machines.length]!;
    const last = NOW - i * 5_400_000 - 300_000;
    return {
      vid: `v${(0x7a10 + i * 0x61).toString(16)}-${(0x1000 + i).toString(16)}`,
      sessions,
      days,
      // Returning over the last ninety days: everyone seen on two days here, and a few seen once here but on other days before.
      returning: days > 1 || i % 5 === 3,
      played,
      finished,
      farthest,
      result: finished === 0 ? null : farthest === 1 ? "won" : "lost",
      died: finished > 0 && farthest !== 1,
      party: looked ? null : 1 + (i % 4),
      load_ms: looked ? null : load,
      fps: looked ? null : fps,
      worst_frame_ms: looked ? null : worst,
      build: i < 12 ? BUILDS[1]! : BUILDS[0]!,
      os,
      gpu: GPUS[i % GPUS.length]!,
      tier,
      engine,
      ...placeAt(i),
      first_seen: iso(last - sessions * 3_600_000),
      last_seen: iso(last),
    };
  });
}

function places(): Row[] {
  const at = (h: number): string => iso(NOW - h * 3_600_000);
  return [
    { city: "Seattle", region: "Washington", country: "US", lat: 47.6, lon: -122.3, visits: 9, played: 6, last_seen: at(1) },
    { city: "Port Angeles", region: "Washington", country: "US", lat: 48.1, lon: -123.4, visits: 6, played: 5, last_seen: at(3) },
    { city: "Brooklyn", region: "New York", country: "US", lat: 40.7, lon: -73.9, visits: 5, played: 2, last_seen: at(5) },
    { city: "London", region: "England", country: "GB", lat: 51.5, lon: -0.1, visits: 4, played: 1, last_seen: at(9) },
    { city: "Toronto", region: "Ontario", country: "CA", lat: 43.7, lon: -79.4, visits: 3, played: 2, last_seen: at(14) },
    { city: "Berlin", region: "Land Berlin", country: "DE", lat: 52.5, lon: 13.4, visits: 3, played: 0, last_seen: at(20) },
    { city: "Portland", region: "Oregon", country: "US", lat: 45.5, lon: -122.7, visits: 2, played: 2, last_seen: at(26) },
    { city: "Sydney", region: "New South Wales", country: "AU", lat: -33.9, lon: 151.2, visits: 1, played: 1, last_seen: at(31) },
    { city: "São Paulo", region: "São Paulo", country: "BR", lat: -23.5, lon: -46.6, visits: 1, played: 0, last_seen: at(40) },
    { city: null, region: null, country: null, lat: null, lon: null, visits: 7, played: 4, last_seen: at(60) },
  ];
}

/**
 * Fourteen sessions on the real trail of the sample's seed, built as the
 * page builds it: up the stem a node at a time with a little wander, some
 * round a loop, some straying off the trail, some dying in the night, with
 * the route's events as the game would send them. The trail is given, not
 * built here: building one is the generator's whole run, too long for the
 * page's main thread (2026-10-30: 1.5 s of blocked load under Lighthouse),
 * so the page hands in its worker's builder.
 */
function paths(trail: DrawableTrail | null): Row[] {
  const r = rng(23);
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
    // Two hikes heard from just now: the four-player lobby's host, and a solo hike, which opens no lobby.
    playing: [
      { sid: "s7a10", vid: "v7a10-1000", build: "9557492d", tier: "high", p: 0.42, fps: 59.6, heard_at: iso(at - 12_000) },
      { sid: "s41b2", vid: "v7b32-1002", build: "9557492d", tier: "low", p: 0.08, fps: 38.2, heard_at: iso(at - 25_000) },
    ],
  };
}

const LOBBY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GAME = "g1388";
const VID = "v7a10-1000";
/** The session whose hike was ended by three lost devices in ten minutes. */
const ENDED_SID = "s41b2";

/** What a hike says was happening beside a row about the GPU (`game/gpuFaults.ts`). */
const HIKE_NOW = { ready: true, busy: "", film: false, hidden: false, shownMs: 345_000, scene: false, ending: false, dark: 0, rain: 0.2, wet: 0.5, night: 0.4, hour: 18.6, lakes: 0, sea: false };

/** User agents as the envelope carries them, cut to 120 characters. */
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36".slice(0, 120);
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15".slice(0, 120);

/**
 * One session's trail: a session that landed, made a lobby, was joined,
 * loaded, played, hit a shader failure mid-climb, then a GPU error that
 * left the picture whole, one that left it black, and a lost device that
 * was rebuilt, died and said goodbye. `ENDED_SID`'s lost its device three
 * times in ten minutes and its hike was ended. Each row carries `row_json`
 * as the query does, with the envelope's facts the drawer reads from the
 * first.
 */
function session(sid: string, offsetMs = 0): Row[] {
  const t0 = NOW - 40 * 60_000 - offsetMs;
  const at = (ms: number): string => iso(t0 + ms);
  const envelope = { sid, vid: VID, build: "9557492d", os: "darwin-arm64", browser: "155", ua: MAC_CHROME, gpu: "Apple M2", tz: "America/New_York", lang: "en-US", vw: 1440, vh: 900, path: "/dayhike/", ref: "" };
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
  const drawing = (r: number, frames: number, stoodMs: number, more: Record<string, unknown> = {}): Record<string, unknown> => ({ ...HIKE_NOW, r, tier: "medium", state: "standing", frames, stoodMs, ...more, ...inMatch });
  const loss = (ms: number, r: number, losses: number, sinceMs: number | null, verdict: "rebuild" | "end"): Row =>
    row(ms, "device_lost", {
      ...drawing(r, 7_100, 121_000, { p: 0.52, tick: 14_000 + losses * 900 }), reason: "unknown", msg: "The GPU process exited unexpectedly.", losses, recent: losses, verdict, errors: 0,
      ...(sinceMs === null ? {} : { sinceMs }), bufs: 1807, bufMB: 96.2, texs: 275, texMB: 540.3, heapMB: 311.4,
    });
  /** The rows after the climb's first acts: this session's own, or the one whose hike its lost devices ended. */
  const rest: Row[] =
    sid === ENDED_SID
      ? [
          loss(760_000, 2, 1, null, "rebuild"),
          row(760_010, "error", { where: "game", kind: "console", msg: "the hike's renderer lost its device (unknown): The GPU process exited unexpectedly.", ...inMatch }),
          row(760_020, "engine_failed", { reason: "lost", ...inMatch }),
          row(764_100, "engine_rebuilt", { reason: "lost", ok: true, ms: 4080, tier: "medium", engine: "webgpu", r: 3, state: "standing", frames: 96, ...inMatch }),
          loss(905_000, 3, 2, 145_000, "rebuild"),
          row(905_020, "engine_failed", { reason: "lost", ...inMatch }),
          row(909_300, "engine_rebuilt", { reason: "lost", ok: true, ms: 4280, tier: "medium", engine: "webgpu", r: 4, state: "standing", frames: 88, ...inMatch }),
          loss(1_012_000, 4, 3, 107_000, "end"),
          row(1_012_020, "engine_failed", { reason: "lost", ...inMatch }),
          row(1_012_030, "session_end", { msg: LOSS_ENDED_LINE, p: 0.52, why: "device_lost", losses: 3, recent: 3, ...inMatch }),
          row(1_014_000, "match_end", { p: 0.52, ended: false, dead: false, ...inMatch }),
          row(1_014_500, "page", { kind: "landing", lobby: LOBBY }),
          row(1_100_000, "end", { reason: "pagehide", dur: 1_100_000, trouble: 4, failed: 0, dropped: 0, sent: 49 }),
        ]
      : [
          // A GPU error that left the picture whole: one bad draw, said once.
          row(700_000, "gpu_error", {
            ...drawing(2, 5_420, 98_000, { p: 0.43, tick: 12_400 }), w: 1, nth: 1, kind: "validation", src: "uncaptured", labels: 'RenderPassEncoder "post_scene"; RenderPipeline "clutter-fern"',
            msg: 'Vertex range (first: 0, count: 2616) requires a larger buffer (62784) than the bound buffer size (31392) of the vertex buffer at slot 2 with stride 12.\n - While encoding [RenderPassEncoder "post_scene"].Draw(2616, 1, 0, 0).\n [RenderPipeline "clutter-fern"]',
          }),
          row(705_020, "gpu_window", { ...HIKE_NOW, ...inMatch, w: 1, r: 2, nth: 1, tier: "medium", state: "standing", ms: 5020, errors: 3, distinct: 1, total: 3, totalDistinct: 1, frames: 297, picture: "held", read: true, luma: 41.2, black: 0.012, spread: 22.6, p: 0.43, tick: 12_700 }),
          // And one that left it black: the chain's own target gone, an error every frame after.
          row(900_000, "gpu_error", {
            ...drawing(2, 17_300, 298_000, { p: 0.61, tick: 24_300 }), w: 2, nth: 2, kind: "validation", src: "uncaptured", labels: 'Texture "post_scene_resolved"; CommandBuffer (unlabeled)',
            msg: '[Texture "post_scene_resolved"] used in submit while destroyed.\n - While calling [Queue].Submit([[CommandBuffer (unlabeled)]])',
          }),
          row(905_030, "gpu_window", { ...HIKE_NOW, ...inMatch, w: 2, r: 2, nth: 2, tier: "medium", state: "standing", ms: 5030, errors: 301, distinct: 1, total: 304, totalDistinct: 2, frames: 301, picture: "broke", read: true, luma: 0, black: 1, spread: 0, p: 0.61, tick: 24_600 }),
          // A lost device, and the renderer built again on a new one.
          loss(1_000_000, 2, 1, null, "rebuild"),
          row(1_000_010, "error", { where: "game", kind: "console", msg: "the hike's renderer lost its device (unknown): The GPU process exited unexpectedly.", ...inMatch }),
          row(1_000_020, "engine_failed", { reason: "lost", ...inMatch }),
          row(1_004_300, "engine_rebuilt", { reason: "lost", ok: true, ms: 4280, tier: "medium", engine: "webgpu", r: 3, state: "standing", frames: 104, ...inMatch }),
          row(1_250_000, "hollow_seen", { p: 0.88, tick: 16_878, ...inMatch }),
          row(1_310_000, "death", { cause: "hollow", p: 0.925, phase: "climb", near: 1, x: 652.3, z: 322.1, tick: 19_453, ...inMatch }),
          row(1_530_000, "outcome", { result: "lost", self: "dead", alive: 0, players: 2, p: 0.93, tick: 31_552, ...inMatch }),
          row(1_545_000, "match_end", { p: 0.93, ended: true, dead: true, ...inMatch }),
          row(1_545_500, "page", { kind: "landing", lobby: LOBBY }),
          row(1_545_800, "lobby_end", { reason: "left", members: 2 }),
          row(1_546_000, "end", { reason: "pagehide", dur: 1_546_000, trouble: 3, failed: 0, dropped: 0, sent: 60 }),
          signal(1_546_200, "room_leave", { host: true, peers: 1 }),
          signal(1_546_300, "room_end", { reason: "host_left", lifeMs: 1_543_800, peers: 1 }),
        ];
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
    row(601_300, "tier_change", { from: "high", to: "medium", source: "auto", fellBack: true, ...inMatch }),
    row(640_000, "act", { act: "mist", p: 0.4, tick: 11_600, ...inMatch }),
    ...rest,
  ];
}

/**
 * A visitor's sessions: the trail three times over, on three days, as the sample visitor's,
 * with what the drawer's profile reads on top: heartbeats on two tiers, a fallback, console
 * warnings, and a last session from a browser that shares no graphics or memory.
 */
function visitor(): Row[] {
  const sessions = [["s3f8a", 2 * DAY], ["s41b2", DAY + 3_600_000], ["s1000", 0]] as const;
  const out: Row[] = [];
  for (const [sid, offset] of sessions) {
    const rows = session(sid, offset).filter((r) => r.svc === "telemetry");
    const t0 = NOW - 40 * 60_000 - offset;
    const template = rows[0]!;
    const payload = JSON.parse(str(template.row_json)) as Record<string, unknown>;
    const extra = (ms: number, n: string, fields: Record<string, unknown>): Row => ({
      ...template,
      timestamp: iso(t0 + ms),
      t: ms,
      n,
      kind: (fields.kind as string | undefined) ?? null,
      msg: (fields.msg as string | undefined) ?? null,
      stack: (fields.stack as string | undefined) ?? null,
      row_json: JSON.stringify({ ...payload, n, t: ms, ...fields }),
    });
    const beat = (ms: number, fps: number, worst: number, heap: number): Row => extra(ms, "hb", { fps, worst, heap, gpuBuf: 180, gpuTex: 460, stalls: 0 });
    out.push(
      ...rows,
      beat(90_000, 58, 410, 640),
      beat(120_000, 60, 52, 700),
      beat(610_000, 24, 180, 1250),
      beat(640_000, 27, 160, 1300),
      extra(602_000, "warn", { kind: "console", msg: "WebGPU: the texture budget was exceeded.", stack: "Warning: budget\n    at https://games.csarko.sh/dayhike/assets/index-CJQw8Dxw.js:3:9" }),
    );
    // The engine writes a start-up fallback before the load row, which names the tier it attempted.
    if (sid === "s41b2") out.push(extra(46_800, "tier_fallback", { attempted: "high", built: "medium" }));
    if (sid === "s1000") {
      // A browser that shares no graphics, memory or cores (Safari): the machine reads "not shared by the browser".
      for (const r of out.filter((o) => o.sid === sid)) {
        const p = JSON.parse(str(r.row_json)) as Record<string, unknown>;
        r.row_json = JSON.stringify({ ...p, gpu: "", mem: 0, cores: 0, browser: "18", ua: MAC_SAFARI });
      }
    }
  }
  return out;
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

/** A trail for a world and seed, as the page's worker answers (`paths.ts`, `trailBuilder`). */
export type TrailFor = (world: string, seed: number) => Promise<DrawableTrail | null>;

/**
 * The sample. Its paths walk the sample world's real trail, which `trailFor` builds: the page
 * passes its worker's builder, so the trail is made off the main thread and once for the paths
 * card too; a caller with no worker (the tests) gets the generator run in place.
 */
export function sampleSource(trailFor: TrailFor = (world, seed) => Promise.resolve(buildTrailFor(world, seed))): Source {
  let pathRows: Promise<Row[]> | null = null;
  const tables: Record<QueryName, () => Row[] | Promise<Row[]>> = {
    funnel, places, errors, players, machines, kpis,
    paths: () => (pathRows ??= trailFor(WORLD, SEED).then(paths)),
  };
  const dated: Partial<Record<QueryName, string>> = { players: "last_seen", places: "last_seen", errors: "last_seen", funnel: "last_seen" };
  return {
    kind: "sample",
    query: async (name, range) => {
      const rows = await tables[name]();
      const column = dated[name];
      return column === undefined ? rows : within(rows, column, range);
    },
    live: () => Promise.resolve(live()),
    session: (sid) => Promise.resolve(session(sid)),
    visitor: () => Promise.resolve(visitor()),
    match: () => Promise.resolve(match()),
  };
}
