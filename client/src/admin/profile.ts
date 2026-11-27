/**
 * A player's profile from their rows: the machine they play on, how each
 * graphics tier ran for them, and what went wrong. Pure; `views.ts` renders it.
 */

import type { Row } from "./source.js";
import { payloadOf, type Payload } from "./timeline.js";
import { fpsVerdict, gpuName, loadVerdict, osName, present, RANK, type Verdict } from "./verdicts.js";

export type TierName = "high" | "medium" | "low";
export const TIERS: readonly TierName[] = ["high", "medium", "low"];
export const TIER_WORDS: Record<TierName, string> = { high: "High", medium: "Medium", low: "Low" };
export const FPS_WORDS: Record<Verdict, string> = { good: "smooth", slow: "choppy", bad: "poor" };

const UNKNOWN = "not shared by the browser";

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const isTier = (v: string): v is TierName => (TIERS as readonly string[]).includes(v);

/** A size in megabytes as people read it: under 1000 in MB, from 1000 in GB with one decimal. */
export function sizeWords(mb: number | null): string {
  if (mb === null || !Number.isFinite(mb)) return UNKNOWN;
  return mb < 1000 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

type Line = { row: Row; p: Payload; n: string; at: number; t: number };

/** The rows by session, each session's rows in order (`timestamp`, then `t`). */
function bySession(rows: Row[]): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  for (const row of rows) {
    const sid = text(row.sid);
    if (sid === "" || row.svc === "signaling") continue;
    const p = payloadOf(row);
    const at = Date.parse(text(row.timestamp));
    const line: Line = { row, p, n: text(row.n), at: Number.isFinite(at) ? at : 0, t: present(row.t) ?? present(p.t) ?? 0 };
    const list = out.get(sid);
    if (list === undefined) out.set(sid, [line]);
    else list.push(line);
  }
  for (const list of out.values()) list.sort((a, b) => a.at - b.at || a.t - b.t);
  return out;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const maxOf = (xs: number[]): number | null => (xs.length === 0 ? null : Math.max(...xs));
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export type Machine = { gpu: string; adapter: string; cores: string; memory: string; device: string; system: string; window: string; sessions: number; lastAt: number };

const ADAPTER_WORDS: Record<string, string> = { ok: "WebGPU available", none: "no WebGPU", rejected: "WebGPU refused", "timed-out": "WebGPU did not answer" };

/** The machines among the rows, by what the envelope says of them, the latest first. */
export function machinesOf(rows: Row[]): Machine[] {
  const by = new Map<string, Machine>();
  for (const list of bySession(rows).values()) {
    const first = list[0];
    const last = list[list.length - 1];
    if (first === undefined || last === undefined) continue;
    // The envelope is flattened onto every row; the first row that carries the machine speaks for the session.
    const p = list.find((l) => l.p.gpu !== undefined || l.p.os !== undefined || l.p.cores !== undefined)?.p ?? first.p;
    const key = [p.gpu, p.cores, p.mem, p.os, p.browser, p.mobile].map(text).join("|");
    const cores = present(p.cores);
    const mem = present(p.mem);
    const limit = present(p.heapLimit);
    const vw = present(p.vw);
    const vh = present(p.vh);
    const gpu = gpuName(text(p.gpu));
    const os = osName(text(p.os));
    const browser = text(p.browser);
    const memory = mem === null || mem <= 0 ? UNKNOWN : mem >= 8 ? "8 GB or more" : `${mem} GB`;
    const m: Machine = {
      gpu: gpu === "" ? UNKNOWN : gpu,
      adapter: ADAPTER_WORDS[text(p.adapter)] ?? UNKNOWN,
      cores: cores === null || cores <= 0 ? UNKNOWN : `${cores} cores`,
      memory: limit !== null && limit > 0 ? `${memory} · ${sizeWords(limit)} page limit` : memory,
      device: text(p.shell) !== "" ? "Desktop app" : p.mobile === true || p.mobile === "true" ? "Phone" : "Desktop",
      system: [os, browser].filter((s) => s !== "").join(", ") || UNKNOWN,
      window: vw !== null && vh !== null ? `${vw} × ${vh} window` : UNKNOWN,
      sessions: 1,
      lastAt: last.at,
    };
    const seen = by.get(key);
    if (seen === undefined) by.set(key, m);
    else {
      seen.sessions += 1;
      if (m.lastAt >= seen.lastAt) Object.assign(seen, { window: m.window, lastAt: m.lastAt });
    }
  }
  return [...by.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export type TierRun = {
  tier: TierName;
  chosen: boolean;
  sessions: number;
  fps: number | null;
  verdict: Verdict | null;
  worstMs: number | null;
  loadMs: number | null;
  heapPeakMb: number | null;
  gpuPeakMb: number | null;
  noFrames: number;
};
export type HowItRan = { runs: TierRun[]; notes: string[]; neverStarted: number; sessions: number };

type Acc = { sids: Set<string>; chosen: boolean; fps: Map<string, number[]>; worst: number[]; load: number[]; heap: number[]; gpu: number[]; noFrames: number };

/** How each tier ran for the player: the tier in force follows the load, a fallback and each tier change. */
export function howItRan(rows: Row[]): HowItRan {
  const sessions = bySession(rows);
  const acc = new Map<TierName, Acc>();
  const accOf = (tier: TierName): Acc => {
    let a = acc.get(tier);
    if (a === undefined) {
      a = { sids: new Set(), chosen: false, fps: new Map(), worst: [], load: [], heap: [], gpu: [], noFrames: 0 };
      acc.set(tier, a);
    }
    return a;
  };
  const notes: string[] = [];
  let neverStarted = 0;
  let lostIn = 0;
  for (const [sid, list] of sessions) {
    let tier: TierName | null = null;
    let source = "";
    let started = false;
    let loadTier: TierName | null = null;
    let loadMs: number | null = null;
    let loadBeats = 0;
    for (const { n, p } of list) {
      if (n === "load") {
        started = true;
        const t = text(p.tier);
        tier = isTier(t) ? t : null;
        source = text(p.source);
        loadTier = tier;
        const parts = [p.decideMs, p.engineMs, p.buildMs].map(present);
        loadMs = parts.every((x) => x === null) ? null : parts.reduce<number>((s, x) => s + (x ?? 0), 0);
      } else if (n === "ready" && tier !== null && loadMs !== null) {
        // Counted under the tier in force when the world is in, which a fallback may have changed.
        const ms = present(p.ms);
        if (ms !== null) {
          const a = accOf(tier);
          a.load.push(loadMs + ms);
          a.sids.add(sid);
        }
        loadMs = null;
      } else if (n === "tier_fallback") {
        started = true;
        const attempted = text(p.attempted);
        const built = text(p.built);
        const was = isTier(attempted) ? TIER_WORDS[attempted] : "The tier";
        notes.push(built === "none" || !isTier(built) ? `${was} could not be built and the hike ended` : `${was} could not be built; ${TIER_WORDS[built]} was used instead`);
        tier = isTier(built) ? built : null;
        // The tier the load named was never built, so it has no run to be empty.
        loadTier = null;
      } else if (n === "tier_change") {
        const to = text(p.to);
        tier = isTier(to) ? to : null;
        source = text(p.source);
      } else if (n === "hb") {
        started = true;
        const here = tier ?? (isTier(text(p.tier)) ? (text(p.tier) as TierName) : null);
        if (here === null) continue;
        const a = accOf(here);
        a.sids.add(sid);
        if (source !== "" && source !== "auto") a.chosen = true;
        if (here === loadTier) loadBeats += 1;
        const fps = present(p.fps);
        if (fps !== null) a.fps.set(sid, [...(a.fps.get(sid) ?? []), fps]);
        const worst = present(p.worst);
        if (worst !== null) a.worst.push(worst);
        const heap = present(p.heap);
        if (heap !== null) a.heap.push(heap);
        const buf = present(p.gpuBuf);
        const tex = present(p.gpuTex);
        if (buf !== null || tex !== null) a.gpu.push((buf ?? 0) + (tex ?? 0));
      }
    }
    if (loadTier !== null) {
      const a = accOf(loadTier);
      a.sids.add(sid);
      if (loadBeats === 0) a.noFrames += 1;
    }
    if (!started) neverStarted += 1;
    if (list.some((l) => l.n === "device_lost")) lostIn += 1;
  }
  if (lostIn > 0) notes.push(`The graphics device was lost in ${plural(lostIn, "session")}`);
  const runs: TierRun[] = [];
  for (const tier of TIERS) {
    const a = acc.get(tier);
    if (a === undefined) continue;
    const fps = median([...a.fps.values()].map((xs) => median(xs) as number));
    const loadMs = median(a.load);
    const marks = [fpsVerdict(fps), loadVerdict(loadMs)].filter((v): v is Verdict => v !== null);
    runs.push({
      tier,
      chosen: a.chosen,
      sessions: a.sids.size,
      fps,
      verdict: marks.length === 0 ? null : marks.reduce((x, y) => (RANK[y] > RANK[x] ? y : x)),
      worstMs: maxOf(a.worst),
      loadMs,
      heapPeakMb: maxOf(a.heap),
      gpuPeakMb: maxOf(a.gpu),
      noFrames: a.noFrames,
    });
  }
  return { runs, notes, neverStarted, sessions: sessions.size };
}

const CLAUSES: [Verdict, string][] = [["good", "ran smoothly on"], ["slow", "was choppy on"], ["bad", "struggled on"]];

/** One sentence for how the player's hikes ran: "Ran smoothly on Medium; was choppy on High." */
export function summaryLine(ran: HowItRan): string {
  if (ran.runs.length === 0) return ran.neverStarted > 0 ? `Never started a hike in ${plural(ran.neverStarted, "session")}` : "No hikes yet";
  const parts = CLAUSES.flatMap(([verdict, words]) => {
    const tiers = ran.runs.filter((r) => r.verdict === verdict).map((r) => TIER_WORDS[r.tier]);
    return tiers.length === 0 ? [] : [`${words} ${tiers.join(" and ")}`];
  });
  if (parts.length === 0) return "No frame rate was shared";
  const line = parts.join("; ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

export type Problem = { level: "error" | "warning"; words: string; msg: string; count: number; firstSid: string; stack: string };

const KIND_WORDS: Record<string, [string, string]> = {
  uncaught: ["Crash", "Crash"],
  unhandled: ["Unhandled promise", "Unhandled promise"],
  console: ["Console error", "Console warning"],
};

/** What went wrong in the rows, grouped by level, words and the message's first hundred characters. */
export function problemsOf(rows: Row[]): Problem[] {
  const groups = new Map<string, Problem & { at: number }>();
  for (const [sid, list] of bySession(rows)) {
    for (const { n, p, at } of list) {
      let level: "error" | "warning";
      let words: string;
      let msg: string;
      if (n === "error" || n === "warn") {
        level = n === "error" ? "error" : "warning";
        const kind = text(p.kind);
        words = KIND_WORDS[kind]?.[level === "error" ? 0 : 1] ?? `${kind || "page"} ${level}`;
        msg = text(p.msg);
      } else if (n === "gpu_error" || n === "device_lost") {
        level = "error";
        words = n === "gpu_error" ? "GPU error" : "Lost device";
        // As `describe()` words them, so the groups match what the timeline shows.
        msg = n === "device_lost" ? [text(p.reason) || "no reason given", text(p.msg).trim()].filter((x) => x !== "").join(": ") : [text(p.kind), text(p.msg).trim()].filter((x) => x !== "").join(", ");
      } else continue;
      const key = `${level}|${words}|${msg.slice(0, 100)}`;
      const g = groups.get(key);
      const stack = text(p.stack);
      if (g === undefined) groups.set(key, { level, words, msg, count: 1, firstSid: sid, stack, at });
      else {
        g.count += 1;
        if (at < g.at) Object.assign(g, { at, firstSid: sid });
        if (g.stack === "") g.stack = stack;
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) || b.count - a.count)
    .map((g) => ({ level: g.level, words: g.words, msg: g.msg, count: g.count, firstSid: g.firstSid, stack: g.stack }));
}

/** Each session's tier at its end and median frame rate, for the sessions list. */
export function sessionTiers(rows: Row[]): Map<string, { tier: string; fps: number | null }> {
  const out = new Map<string, { tier: string; fps: number | null }>();
  for (const [sid, list] of bySession(rows)) {
    let tier = "";
    const fps: number[] = [];
    for (const { n, p } of list) {
      if (n === "load") tier = text(p.tier);
      else if (n === "tier_fallback" && text(p.built) !== "none") tier = text(p.built);
      else if (n === "tier_change") tier = text(p.to);
      else if (n === "hb") {
        const f = present(p.fps);
        if (f !== null) fps.push(f);
      }
    }
    out.set(sid, { tier, fps: median(fps) });
  }
  return out;
}
