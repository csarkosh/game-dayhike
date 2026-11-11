#!/usr/bin/env node
// Reads a `timeline.mjs` run back: each stretch of it (the settle's last seconds, the approach, the
// scene's five shots, the chase ten seconds at a time) as its frames' mean, median, p95 and worst,
// the share of frames over a 60 Hz frame and the seconds lost to stalls; the worst frames, each
// with the page's own account of it; the GPU readout by stretch; and, with the run's CPU profile
// beside it, where the main thread's time went in each stretch and in each stall.
//
//   node tools/frame-budget/timeline-report.mjs <run.json> [--worst 12] [--top 14] [--only <stretch>]
//       [--inclusive] [--maps <dir>] [--full] [--watch <file.ts:line,...>]
//
//   --worst <n>     the worst frames listed (12)
//   --top <n>       the functions listed a stretch (14); --only <text> the stretches whose name has it
//   --inclusive     each stretch's functions by inclusive time as well as self time
//   --maps <dir>    the build's source maps (`client/dist/assets/*.map`, kept beside the run)
//   --full          each function's whole URL, for `tools/telemetry/symbolicate.mjs <build>`
//   --watch <list>  named functions (`src/sim/ai.ts:37`, as --maps names them): inclusive
//                   milliseconds a frame over the chase's first 20 s
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

const SHOTS = [4, 4, 5, 4, 4];
const FRAME_60 = 1000 / 60;
/** A frame counted as a stall, and as a freeze. */
const STALL_MS = 50;
const FREEZE_MS = 250;

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : Number(args[i + 1]); };
const WORST = opt("--worst", 12);
const TOP = opt("--top", 14);
// --full prints each function's whole URL, the shape `tools/telemetry/symbolicate.mjs` reads back to source.
const FULL = args.includes("--full");
const INCLUSIVE = args.includes("--inclusive");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
if (!file) { console.error("usage: timeline-report.mjs <run.json> [--worst 12] [--top 14]"); process.exit(2); }
const run = JSON.parse(readFileSync(file, "utf8"));
const profilePath = file.replace(/\.json$/, ".cpuprofile");
const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, "utf8")) : null;

const markAt = (name) => run.marks.find((m) => m.name === name)?.t ?? null;
// A run with no find (`--climb`): its sprint read as the chase's stretches are, from its own start.
const sprintOn = markAt("sprint-on");
const sceneOn = markAt("scene-on") ?? sprintOn;
const sceneOff = markAt("scene-off") ?? sprintOn;
const approach = markAt("approach");
const chaseEnd = markAt("chase-end") ?? run.t[run.t.length - 1];
if (sceneOn === null) { console.error("the run has no scene: no scene-on mark"); process.exit(1); }

/** The frames as [start, duration]. */
const frames = [];
for (let i = 1; i < run.t.length; i++) frames.push([run.t[i - 1], run.t[i] - run.t[i - 1]]);

const quantile = (sorted, q) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
function stats(from, to) {
  const ds = frames.filter(([t]) => t >= from && t < to).map(([, d]) => d);
  const sorted = [...ds].sort((a, b) => a - b);
  const sum = ds.reduce((a, b) => a + b, 0);
  return {
    n: ds.length, mean: ds.length ? sum / ds.length : 0, p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), max: sorted[sorted.length - 1] ?? 0,
    over60: ds.length ? ds.filter((d) => d > FRAME_60 * 1.1).length / ds.length : 0,
    stalls: ds.filter((d) => d > STALL_MS).length, stallS: ds.filter((d) => d > STALL_MS).reduce((a, b) => a + b, 0) / 1000,
    freezes: ds.filter((d) => d > FREEZE_MS).length,
  };
}

const stretches = [];
if (approach !== null) {
  stretches.push({ name: "settled (10 s before)", from: approach - 10_000, to: approach });
  stretches.push({ name: "approach", from: approach, to: sceneOn });
}
if (sprintOn !== null) stretches.push({ name: "settled (10 s before)", from: sprintOn - 10_000, to: sprintOn });
let at = sceneOn;
if (sprintOn === null) SHOTS.forEach((s, i) => { stretches.push({ name: `scene shot ${i + 1}`, from: at, to: at + s * 1000 }); at += s * 1000; });
const chaseFrom = sceneOff ?? at;
for (let t = chaseFrom; t < chaseEnd - 1000; t += 10_000) stretches.push({ name: `chase ${Math.round((t - chaseFrom) / 1000)}-${Math.round((Math.min(t + 10_000, chaseEnd) - chaseFrom) / 1000)} s`, from: t, to: Math.min(t + 10_000, chaseEnd) });
if (sprintOn === null) stretches.push({ name: "SCENE (whole)", from: sceneOn, to: chaseFrom });
stretches.push({ name: "CHASE (whole)", from: chaseFrom, to: chaseEnd });

const f1 = (x) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(1) : "–");
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

const m = run.meta;
console.log(`${m.label}  ${m.time}  tier ${m.tier}  engine ${m.engine ?? "(own choice)"}  canvas ${run.canvas?.join("×")}  ${m.browser}`);
console.log(`gpu ${m.gpu}  build ${run.gpu.at(-1)?.build ?? "?"}  readout ${run.gpu.at(-1)?.supported ? "on" : "unsupported"}  classes "${m.classes}"`);
console.log(`ready ${f1(m.readyS)} s, settle ${m.settle} s, approach ${m.approach}, chase ${m.still ? "standing" : "sprinting"}; scene ${f1(((sceneOff ?? at) - sceneOn) / 1000)} s; marks: ${run.marks.map((k) => `${k.name}@${f1((k.t - sceneOn) / 1000)}`).join(" ")}`);
console.log("");
console.log(`${pad("stretch", 24)}${lpad("frames", 7)}${lpad("fps", 7)}${lpad("mean", 7)}${lpad("p50", 7)}${lpad("p95", 7)}${lpad("max", 8)}${lpad(">60Hz", 7)}${lpad("stalls", 7)}${lpad("lost s", 7)}${lpad("freezes", 8)}`);
for (const s of stretches) {
  const r = stats(s.from, s.to);
  const secs = (s.to - s.from) / 1000;
  console.log(`${pad(s.name, 24)}${lpad(r.n, 7)}${lpad(f1(r.n / secs), 7)}${lpad(f1(r.mean), 7)}${lpad(f1(r.p50), 7)}${lpad(f1(r.p95), 7)}${lpad(f1(r.max), 8)}${lpad(`${Math.round(r.over60 * 100)}%`, 7)}${lpad(r.stalls, 7)}${lpad(f1(r.stallS), 7)}${lpad(r.freezes, 8)}`);
}

// ---- The shaders: stages the shipped WGSL maps had, and those translated in the page ------------
const wgsl = run.wgsl ?? [];
if (wgsl.length > 0) {
  const w0 = (t) => wgsl.filter((w) => w.t <= t).at(-1) ?? { hits: 0, misses: 0, translateMs: 0 };
  const last = wgsl.at(-1);
  console.log(`\nWGSL stages: found ${last.hits}, translated in the page ${last.misses} (${f1(last.translateMs)} ms)`);
  console.log(`${pad("stretch", 24)}${lpad("found", 7)}${lpad("missed", 8)}${lpad("ms", 8)}`);
  for (const s of stretches) {
    const a = w0(s.from), b = w0(s.to);
    console.log(`${pad(s.name, 24)}${lpad(b.hits - a.hits, 7)}${lpad(b.misses - a.misses, 8)}${lpad(f1(b.translateMs - a.translateMs), 8)}`);
  }
}

// ---- The streaming jobs: each shell's milliseconds a frame, and what ran late ---------------------
const jobRows = run.jobs ?? [];
if (jobRows.length > 0) {
  const names = [...new Set(jobRows.flatMap((j) => Object.keys(j.owners ?? {})))];
  console.log(`\nStreaming jobs (frames whose jobs took over 2 ms), ms a frame of the stretch; "other" is the face patches':`);
  console.log(`${pad("stretch", 24)}${lpad("all", 7)}${lpad("late", 7)}${lpad(">30ms", 7)}  ${names.map((n) => lpad(n.slice(0, 9), 10)).join("")}`);
  for (const s of stretches) {
    const n = Math.max(1, stats(s.from, s.to).n);
    const rows = jobRows.filter((j) => j.t >= s.from && j.t < s.to);
    const sum = (f) => rows.reduce((a, j) => a + f(j), 0);
    console.log(`${pad(s.name, 24)}${lpad(f1(sum((j) => j.ms) / n), 7)}${lpad(f1(sum((j) => j.late ?? 0) / n), 7)}${lpad(rows.filter((j) => j.ms > 30).length, 7)}  ${names.map((k) => lpad(f1(sum((j) => j.owners?.[k] ?? 0) / n), 10)).join("")}`);
  }
}

// ---- A film over the page (the intro): the frames it presented and dropped ----------------------
const video = run.video ?? [];
if (video.length > 1) {
  const v0 = (t) => video.filter((v) => v.t <= t).at(-1) ?? video[0];
  console.log(`\nThe film: ${video.at(-1).total} frames presented, ${video.at(-1).dropped} dropped`);
  console.log(`${pad("stretch", 24)}${lpad("frames", 8)}${lpad("dropped", 9)}${lpad("film s", 8)}`);
  for (const s of stretches) {
    const a = v0(s.from), b = v0(s.to);
    console.log(`${pad(s.name, 24)}${lpad(b.total - a.total, 8)}${lpad(b.dropped - a.dropped, 9)}${lpad(f1(b.at - a.at), 8)}`);
  }
}

// ---- The film's picture: where it stood and jumped ------------------------------------------------
// Between two frames this thread heard were shown: the film's seconds that passed, the wall's, and
// the frames shown. The picture's own rate is the film's (24 a second here, taken from the run).
// A gap is film time that passed with no frame shown for it (the picture stood, then jumped), or
// wall time that passed with the film's clock standing (the film waited: buffering, or starved).
const shown = run.shown ?? [];
if (shown.length > 2) {
  const rate = (() => { const d = []; for (let i = 1; i < shown.length; i++) { const f = shown[i][2] - shown[i - 1][2], m = shown[i][1] - shown[i - 1][1]; if (f === 1 && m > 0) d.push(m); } d.sort((a, b) => a - b); return d.length ? 1 / d[d.length >> 1] : 24; })();
  const gaps = [];
  for (let i = 1; i < shown.length; i++) {
    const wall = (shown[i][0] - shown[i - 1][0]) / 1000, film = shown[i][1] - shown[i - 1][1], n = shown[i][2] - shown[i - 1][2];
    const jumped = Math.max(0, film - n / rate), stood = Math.max(0, wall - film);
    if (jumped > 0.1 || stood > 0.1) gaps.push({ t: shown[i - 1][0], wall, film, n, jumped, stood });
  }
  const sum = (rows, k) => rows.reduce((a, g) => a + g[k], 0);
  console.log(`\nThe film's picture (${f1(rate)} frames a second): ${gaps.length} gaps over 0.1 s; ${f1(sum(gaps, "jumped"))} s of film passed unseen (the picture stood, then jumped), ${f1(sum(gaps, "stood"))} s with the film's clock standing; the longest ${f1(Math.max(0, ...gaps.map((g) => Math.max(g.jumped, g.stood))))} s`);
  console.log(`${pad("stretch", 24)}${lpad("gaps", 6)}${lpad("unseen s", 10)}${lpad("stood s", 9)}${lpad("longest", 9)}`);
  for (const s of stretches) {
    const rows = gaps.filter((g) => g.t >= s.from && g.t < s.to);
    console.log(`${pad(s.name, 24)}${lpad(rows.length, 6)}${lpad(f1(sum(rows, "jumped")), 10)}${lpad(f1(sum(rows, "stood")), 9)}${lpad(f1(Math.max(0, ...rows.map((g) => Math.max(g.jumped, g.stood)))), 9)}`);
  }
}

// ---- The pipelines: what was asked for, and how long the screen was held for it ----------------
// A WebGPU page holds its frames, the canvas keeping its last image, while a render pipeline is
// being made (`asyncPipelines.ts`): the page's frames keep coming, short, and show nothing new. A
// hold is a run of frames each of which raised the report's `held`.
const pipes = run.pipes ?? [];
const holds = [];
if (pipes.length > 1) {
  let open = null;
  for (let i = 1; i < pipes.length; i++) {
    const grew = pipes[i].held > pipes[i - 1].held;
    if (grew && open !== null && pipes[i].t - open.to < 250) { open.to = pipes[i].t; open.frames += pipes[i].held - pipes[i - 1].held; open.askedTo = pipes[i].asked; }
    else if (grew) { open = { from: pipes[i - 1].t, to: pipes[i].t, frames: pipes[i].held - pipes[i - 1].held, askedFrom: pipes[i - 1].asked, askedTo: pipes[i].asked }; holds.push(open); }
  }
  const at0 = (t) => pipes.filter((p) => p.t <= t).at(-1) ?? pipes[0];
  console.log(`\nPipelines (${pipes.at(-1).mode}): asked ${pipes.at(-1).asked}, landed ${pipes.at(-1).landed}, made synchronously ${pipes.at(-1).sync}, failed ${pipes.at(-1).failed}, expired ${pipes.at(-1).expired}, longest ${f1(pipes.at(-1).longestMs)} ms`);
  console.log(`${pad("stretch", 24)}${lpad("asked", 7)}${lpad("sync", 6)}${lpad("held fr", 9)}${lpad("held s", 8)}${lpad("left out", 9)}`);
  for (const s of stretches) {
    const a = at0(s.from), b = at0(s.to);
    const heldS = holds.reduce((sum, h) => sum + Math.max(0, Math.min(h.to, s.to) - Math.max(h.from, s.from)), 0) / 1000;
    console.log(`${pad(s.name, 24)}${lpad(b.asked - a.asked, 7)}${lpad(b.sync - a.sync, 6)}${lpad(b.held - a.held, 9)}${lpad(f1(heldS), 8)}${lpad(b.leftOut - a.leftOut, 9)}`);
  }
  const long = holds.filter((h) => h.to - h.from > 100 && h.to >= (approach ?? sceneOn)).sort((a, b) => a.from - b.from);
  console.log(`\nThe screen held on one image (over 0.1 s), seconds from the scene's start:`);
  for (const h of long) console.log(`  ${lpad(f1((h.from - sceneOn) / 1000), 7)} s  held ${lpad(f1((h.to - h.from) / 1000), 5)} s  ${h.frames} frames  ${h.askedTo - h.askedFrom} pipelines asked`);
  if (long.length === 0) console.log("  none");
}

// ---- What the screen showed: the gaps between the compositor's frames -------------------------
if (run.cast && run.cast.frames.length > 1) {
  const [wallMs, perfMs] = run.cast.clock;
  const toPage = (ts) => ts * 1000 - wallMs + perfMs;
  const gaps = [];
  for (let i = 1; i < run.cast.frames.length; i++) gaps.push({ from: toPage(run.cast.frames[i - 1].timestamp), gap: (run.cast.frames[i].timestamp - run.cast.frames[i - 1].timestamp) * 1000, n: i });
  console.log(`\nScreencast: ${run.cast.frames.length} frames; the gaps over 0.3 s (seconds from the scene's start):`);
  for (const g of gaps.filter((x) => x.gap > 300 && x.from >= (approach ?? sceneOn) - 2000)) console.log(`  ${lpad(f1((g.from - sceneOn) / 1000), 7)} s  ${lpad(f1(g.gap / 1000), 5)} s with no new picture (before frame ${g.n})`);
}

// ---- The GPU readout by stretch--------------------------------------------------------------
if (run.gpu.some((g) => g.supported)) {
  console.log("\nGPU readout (ms a frame, the last second's average), by stretch:");
  for (const s of stretches) {
    const gs = run.gpu.filter((g) => g.t >= s.from && g.t < s.to && g.supported);
    if (gs.length === 0) continue;
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const byTarget = new Map();
    for (const g of gs) for (const [name, ms] of g.targets) byTarget.set(name, [...(byTarget.get(name) ?? []), ms]);
    const top = [...byTarget.entries()].map(([name, xs]) => [name, mean(xs)]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const sum = mean(gs.map((g) => (g.mainMs ?? 0) + g.targets.reduce((a, [, ms]) => a + ms, 0)));
    console.log(`  ${pad(s.name, 24)} passes' sum ${lpad(f1(sum), 6)}  main ${f1(mean(gs.map((g) => g.mainMs ?? 0)))}  ${top.map(([n, v]) => `${n} ${f1(v)}`).join("  ")}`);
  }
}

// ---- The profile, laid on the page's clock ----------------------------------------------------
let samples = null;
if (profile !== null) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  // The burn: the first sample inside __tlSyncBurn is the page's `sync-burn` mark.
  const burnIds = new Set(profile.nodes.filter((n) => n.callFrame.functionName === "__tlSyncBurn").map((n) => n.id));
  let t = profile.startTime;
  const times = [];
  for (let i = 0; i < profile.samples.length; i++) { t += profile.timeDeltas[i]; times.push(t); }
  const burnIndex = profile.samples.findIndex((id) => burnIds.has(id));
  const burnMark = markAt("sync-burn");
  if (burnIndex >= 0 && burnMark !== null) {
    const offset = burnMark - times[burnIndex] / 1000;
    samples = { ids: profile.samples, at: times.map((x) => x / 1000 + offset), nodes, parent };
  } else console.log("\n(the profile has no sync burn: it cannot be laid on the frames)");
}
// --maps <dir>: the build's source maps (`client/dist/assets/*.map`, kept beside the run), so a
// function is named by its source file and line.
const MAPS = args.includes("--maps") ? args[args.indexOf("--maps") + 1] : null;
const maps = new Map();
const labels = new Map();
function sourceOf(c) {
  const file = c.url.split("/").pop();
  if (!maps.has(file)) {
    const path = join(MAPS, `${file}.map`);
    maps.set(file, existsSync(path) ? new TraceMap(JSON.parse(readFileSync(path, "utf8"))) : null);
  }
  const map = maps.get(file);
  if (map === null) return null;
  const pos = originalPositionFor(map, { line: c.lineNumber + 1, column: c.columnNumber });
  if (pos.source === null) return null;
  const source = pos.source.replace(/^(\.\.\/)+/, "").replace("node_modules/@babylonjs/core/", "bjs/");
  return `${pos.name ?? c.functionName ?? ""} ${source}:${pos.line}`.trim();
}
const label = (n) => {
  const c = n.callFrame;
  if (MAPS !== null && c.url) {
    if (!labels.has(n.id)) labels.set(n.id, sourceOf(c));
    const named = labels.get(n.id);
    if (named !== null) return named;
  }
  const where = c.url ? `${FULL ? c.url : c.url.split("/").pop()}:${c.lineNumber + 1}:${c.columnNumber + 1}` : "";
  return `${c.functionName || "(anonymous)"} ${where}`.trim();
};
/** Self time by function over [from, to), and by the nearest named ancestor chain's top entries. */
function hot(from, to, top) {
  const self = new Map();
  let total = 0;
  const { ids, at: ts, nodes } = samples;
  for (let i = 0; i < ids.length - 1; i++) {
    if (ts[i] < from || ts[i] >= to) continue;
    const dt = ts[i + 1] - ts[i];
    const n = nodes.get(ids[i]);
    const key = label(n);
    self.set(key, (self.get(key) ?? 0) + dt);
    total += dt;
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return { total, rows };
}
/** Inclusive time by function over [from, to): each sample counted once for every distinct function on its stack. */
function inclusive(from, to, top) {
  const { ids, at: ts, nodes, parent } = samples;
  const incl = new Map();
  for (let i = 0; i < ids.length - 1; i++) {
    if (ts[i] < from || ts[i] >= to) continue;
    const dt = ts[i + 1] - ts[i];
    const seen = new Set();
    for (let id = ids[i]; id !== undefined; id = parent.get(id)) {
      const key = label(nodes.get(id));
      if (seen.has(key)) continue;
      seen.add(key);
      incl.set(key, (incl.get(key) ?? 0) + dt);
    }
  }
  return [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}
/** The stack of the sample nearest the middle of [from, to) that is not idle. */
function stackIn(from, to) {
  const { ids, at: ts, nodes, parent } = samples;
  const counts = new Map();
  for (let i = 0; i < ids.length - 1; i++) {
    if (ts[i] < from || ts[i] >= to) continue;
    const name = nodes.get(ids[i]).callFrame.functionName;
    if (name === "(idle)") continue;
    counts.set(ids[i], (counts.get(ids[i]) ?? 0) + (ts[i + 1] - ts[i]));
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return [];
  const stack = [];
  for (let id = best[0]; id !== undefined; id = parent.get(id)) stack.push(label(nodes.get(id)));
  return stack;
}

if (samples !== null) {
  console.log("\nMain thread by stretch (self time, ms; share of the stretch):");
  for (const s of stretches.filter((x) => ONLY === null ? /shot|whole|approach|settled/.test(x.name) : x.name.includes(ONLY))) {
    const h = hot(s.from, s.to, TOP);
    console.log(`  ${s.name}: ${f1(h.total)} ms sampled over ${f1(s.to - s.from)} ms`);
    for (const [name, ms] of h.rows) console.log(`    ${lpad(f1(ms), 8)}  ${lpad(`${f1((ms / (s.to - s.from)) * 100)}%`, 6)}  ${name}`);
    if (INCLUSIVE) {
      console.log("    inclusive:");
      for (const [name, ms] of inclusive(s.from, s.to, TOP * 3)) console.log(`    ${lpad(f1(ms), 8)}  ${lpad(`${f1((ms / (s.to - s.from)) * 100)}%`, 6)}  ${name}`);
    }
  }
}

// ---- Named costs: inclusive milliseconds a frame in the chase's first 20 s ----------------------
if (samples !== null && args.includes("--watch")) {
  const names = args[args.indexOf("--watch") + 1].split(",");
  const from = chaseFrom, to = Math.min(chaseFrom + 20_000, chaseEnd);
  const n = frames.filter(([t]) => t >= from && t < to).length;
  const all = inclusive(from, to, 100000);
  console.log(`\nInclusive main-thread time in the chase's first ${f1((to - from) / 1000)} s (${n} frames), ms a frame and share:`);
  for (const name of names) {
    const rows = all.filter(([k]) => k.endsWith(name));
    const ms = rows.reduce((a, [, v]) => a + v, 0);
    console.log(`  ${pad(name, 34)} ${lpad(f1(ms / n), 7)} ms/frame  ${lpad(f1((ms / (to - from)) * 100), 5)}%   ${rows.slice(0, 2).map(([k]) => k).join(" | ")}`);
  }
}

// ---- The worst frames -------------------------------------------------------------------------
console.log(`\nThe ${WORST} worst frames from the approach on (seconds from the scene's start):`);
const worst = frames.filter(([t]) => t >= (approach ?? sceneOn) && t < chaseEnd).sort((a, b) => b[1] - a[1]).slice(0, WORST);
for (const [t, d] of worst) {
  const where = stretches.find((s) => t >= s.from && t < s.to && !/whole/.test(s.name))?.name ?? "";
  console.log(`  ${lpad(f1((t - sceneOn) / 1000), 7)} s  ${lpad(f1(d), 8)} ms  ${where}`);
  const loaf = run.loaf.filter((l) => l.start < t + d && l.start + l.dur > t);
  for (const l of loaf) {
    const scripts = l.scripts.map((s) => `${s.type}:${s.fn || s.invoker} ${f1(s.dur)} ms`).join("; ");
    console.log(`           long frame ${f1(l.dur)} ms (scripts: ${scripts || "none: not script"})`);
  }
  const jobs = run.jobs.filter((j) => j.t >= t && j.t <= t + d + 20);
  for (const j of jobs.slice(0, 2)) console.log(`           jobs ${f1(j.ms)} ms: ${JSON.stringify(j.owners)}`);
  if (samples !== null) {
    const h = hot(t, t + d, 5);
    for (const [name, ms] of h.rows) console.log(`           ${lpad(f1(ms), 8)} ms  ${name}`);
    const stack = stackIn(t, t + d);
    if (stack.length > 0) console.log(`           stack: ${stack.slice(0, 14).join(" < ")}`);
  }
}
