#!/usr/bin/env node
// The frame budget's measurements: each fixed view of `views.json` opened on a fresh page at a
// tier's standard size, waited for until the page says its world is ready (`body.world-ready`: the
// world in and the URL's looks applied), settled, warmed 3 s, then its frames timed for 10 s with the GPU
// readout (`?gpuTime`) read at the start and the end. One JSON row a sample is appended to a JSONL
// file, and the run ends with a table of each view's medians, against the tier's budget when
// `budgets.json` has one. The verdict is information: the script exits 0 over budget or under.
//
//   npm run frame-budget -- --base <url> --tier medium|high --machine <label> [--views a,b] [--pairs 3]
//       [--against <url2>] [--remote <port>] [--settle 30] [--warm 0] [--rotate 0] [--out <file.jsonl>] [--steadiness]
//       [--shot]
//
//   --base <url>       the build measured (A): the dev server, the live site or a preview channel
//   --tier <tier>      medium or high, the size and the quality the views are opened at
//   --machine <label>  the machine's name in the rows (air-m4, rig-t4, …)
//   --views a,b        only these views (a `check` view only by name); every view without `check` by default
//   --pairs <n>        samples a view, or with --against pairs of samples (3 by default)
//   --against <url2>   a second build (B), interleaved with A: A B, B A, A B, … each pair back to back
//   --remote <port>    a Chrome already running behind a forwarded port (the rig's) instead of one
//                      started here; refused unless its user agent says Windows NT
//   --settle <s>       seconds from the world ready (`body.world-ready`) to the warm-up (30 by default),
//                      plus the view's extraSettleS
//   --warm <s>         this Mac only: the first view open that long before the first sample (a warm Air)
//   --rotate <n>       the views' order rotated left by n, so a run's drift falls on different views
//   --out <file>       the rows' file (tools/frame-budget/runs/<date>-<machine>-<tier>.jsonl by default)
//   --steadiness       six samples of the first view on --base, and the spread of their means
//   --shot             a JPEG of each sample's page beside the rows, taken as its frames end
//
// On this Mac the script starts Chrome itself (Google Chrome, or `CHROME`) from a fresh profile,
// as a window: the frame cap off and WebGPU's timestamps allowed. Each sample is a browser context
// of its own. A row's `load` is the CPU cores busy outside the harness as the sample ends: every
// process's share in `ps`, less this script's and the Chrome it started (the load average cannot be
// used: the harness's own uncapped Chrome takes an idle Air's to 8). With --remote it is null, the
// rig running nothing else by construction (its steadiness run is its load check). A row's `readyS`
// is the seconds from the canvas to the page's `world-ready` class. Before Chrome starts, the Mac's
// GPU must read under QUIET_GPU % busy in `ioreg`: another page drawing on it voids every row.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict } from "./lib/budget.mjs";
import { attachChrome, evaluate, launchChrome, openPage, version } from "./lib/cdp.mjs";
import { QUIET_GPU, QUIET_LOAD, flagsFor, medianOf, parseGpuUtil, pairDeltas, pairOrder, summarise, table } from "./lib/sample.mjs";
import { TIER_SIZES, resolveViews, viewUrl } from "./lib/views.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STILLS = fileURLToPath(new URL("../previews/stills.json", import.meta.url));
/** The warm-up inside a sample, before its frames are timed, and how long they are timed. */
const WARMUP_S = 3;
const SAMPLE_S = 10;
/** The page's canvas, waited for as the previews wait (60 s at most). */
const CANVAS_TRIES = 120;
const CANVAS_POLL_MS = 500;
/** The world's readiness class, waited for up to this long after the canvas (a cold cache takes 60 to 120 s). */
const READY_MAX_S = 180;
/** The samples a steadiness run takes. */
const STEADINESS_SAMPLES = 6;

function parseArgs(argv) {
  const options = {
    base: undefined,
    tier: undefined,
    machine: undefined,
    views: [],
    pairs: 3,
    against: undefined,
    remote: undefined,
    settle: 30,
    warm: 0,
    rotate: 0,
    out: undefined,
    steadiness: false,
    shot: false,
  };
  const value = (i, arg) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
    return v;
  };
  const count = (v, arg, min) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`${arg} needs a whole number of at least ${min}, got ${v}`);
    return n;
  };
  const seconds = (v, arg) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${arg} needs seconds, got ${v}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") options.base = value(++i, arg);
    else if (arg === "--tier") options.tier = value(++i, arg);
    else if (arg === "--machine") options.machine = value(++i, arg);
    else if (arg === "--views") options.views = value(++i, arg).split(",").filter((v) => v !== "");
    else if (arg === "--pairs") options.pairs = count(value(++i, arg), arg, 1);
    else if (arg === "--against") options.against = value(++i, arg);
    else if (arg === "--remote") options.remote = count(value(++i, arg), arg, 1);
    else if (arg === "--settle") options.settle = seconds(value(++i, arg), arg);
    else if (arg === "--warm") options.warm = seconds(value(++i, arg), arg);
    else if (arg === "--rotate") options.rotate = count(value(++i, arg), arg, 0);
    else if (arg === "--out") options.out = value(++i, arg);
    else if (arg === "--steadiness") options.steadiness = true;
    else if (arg === "--shot") options.shot = true;
    else throw new Error(`unknown option ${arg}`);
  }
  for (const required of ["base", "tier", "machine"]) {
    if (options[required] === undefined) throw new Error(`--${required} is required`);
  }
  if (!Object.hasOwn(TIER_SIZES, options.tier)) throw new Error(`--tier must be ${Object.keys(TIER_SIZES).join(" or ")}, got ${options.tier}`);
  if (options.remote !== undefined && options.warm > 0) throw new Error("--warm is for this Mac only, not with --remote");
  if (options.steadiness && options.against !== undefined) throw new Error("--steadiness measures one base, not with --against");
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `promise`, or an error after `ms`. */
function within(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---- The sample, as it runs in the page --------------------------------------------------------
// It waits out the warm-up, reads the canvas's size and the GPU readout, times every frame from the
// first requestAnimationFrame for SAMPLE_S seconds, reads the canvas and the readout again, and names
// the GPU: the WebGPU adapter's description (or its architecture), else WebGL's unmasked renderer on
// a scratch canvas. `__gpuTime` is there only with `?gpuTime` on a build that has the readout.
const SAMPLE_EXPRESSION = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const size = () => { const c = document.querySelector("canvas"); return c ? [c.width, c.height] : null; };
  const readout = () => (typeof window.__gpuTime === "function" ? window.__gpuTime() : null);
  await sleep(${WARMUP_S * 1000});
  const canvasStart = size();
  const gpuStart = readout();
  const frames = [];
  await new Promise((done) => {
    let last = null;
    let end = null;
    const tick = (t) => {
      if (last === null) end = t + ${SAMPLE_S * 1000};
      else frames.push(t - last);
      last = t;
      if (t < end) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  const canvasEnd = size();
  const gpuEnd = readout();
  let gpu = null;
  try {
    const info = (await navigator.gpu?.requestAdapter())?.info;
    gpu = (info && (info.description || info.architecture)) || null;
  } catch {}
  if (!gpu) {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpu = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || null;
      gl && gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
  }
  return { frames, canvasStart, canvasEnd, gpuStart, gpuEnd, sha: gpuEnd?.build ?? gpuStart?.build ?? null, gpu };
})()`;
// -------------------------------------------------------------------------------------------------

/** The page at `url`, at the tier's size, its canvas waited for. */
async function openView(browser, port, tier, url) {
  const opened = await openPage(browser, port);
  try {
    const { width, height } = TIER_SIZES[tier];
    await opened.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const nav = await opened.page("Page.navigate", { url });
    if (nav.errorText) throw new Error(`${url} did not load: ${nav.errorText}`);
    for (let i = 0; ; i++) {
      if (await evaluate(opened.page, "!!document.querySelector('canvas')").catch(() => false)) break;
      if (i === CANVAS_TRIES - 1) throw new Error(`the game's canvas never appeared at ${url}`);
      await sleep(CANVAS_POLL_MS);
    }
    return opened;
  } catch (error) {
    await opened.close();
    throw error;
  }
}

/** Waits for `body.world-ready` on `page`, up to READY_MAX_S; the seconds it took, to 1 dp. */
async function awaitReady(page, name) {
  const start = Date.now();
  for (;;) {
    if (await evaluate(page, "document.body.classList.contains('world-ready')").catch(() => false)) break;
    if (Date.now() - start > READY_MAX_S * 1000) throw new Error(`${name}: the world was not ready within ${READY_MAX_S} s`);
    await sleep(CANVAS_POLL_MS);
  }
  return Math.round((Date.now() - start) / 100) / 10;
}

/** One sample: a fresh page at the view, settled, its frames timed; the page closed after, and on a
 * failure too. With `shotPath`, the page's JPEG as the frames end. */
async function sample(session, { tier, base, game, view, still, settle, shotPath }) {
  const url = viewUrl(base, game, tier, view, still, { gpuTime: true });
  const { page, close } = await openView(session.browser, session.port, tier, url);
  try {
    const readyS = await awaitReady(page, view.name);
    await sleep((settle + (view.extraSettleS ?? 0)) * 1000);
    const limit = (WARMUP_S + SAMPLE_S + 30) * 1000;
    const r = await within(evaluate(page, SAMPLE_EXPRESSION), limit, `${view.name}: the sample did not finish in ${limit / 1000} s (did the page stop drawing?)`);
    if (r.canvasStart === null || r.canvasEnd === null) throw new Error(`${view.name}: the canvas went away during the sample`);
    if (shotPath !== undefined) {
      const shot = await page("Page.captureScreenshot", { format: "jpeg", quality: 70 });
      writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
    }
    return { ...r, readyS };
  } finally {
    await close();
  }
}

/** The CPU cores busy outside the harness, to 2 dp: the sum of `ps`'s %CPU over every process
 * but this one and its descendants (the Chrome it started and Chrome's helpers). The one-minute
 * load average cannot tell other work from the harness: with the harness alone on an idle Air it
 * reads 8, the uncapped Chrome's own threads counted in it. */
function busyOutside() {
  const procs = execFileSync("ps", ["-Ao", "pid=,ppid=,pcpu="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .map(([pid, ppid, pcpu]) => ({ pid, ppid, pcpu }));
  const children = new Map();
  for (const p of procs) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const ours = new Set();
  const stack = [process.pid];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (ours.has(pid)) continue;
    ours.add(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  const busy = procs.filter((p) => !ours.has(p.pid)).reduce((sum, p) => sum + p.pcpu / 100, 0);
  return Math.round(busy * 100) / 100;
}

/** The row a sample is written as. */
function rowOf(r, { machine, about, base, build, tier, view, remote }) {
  const { n, mean, p95 } = summarise(r.frames);
  const load = remote ? null : busyOutside();
  const row = {
    time: new Date().toISOString(),
    machine,
    browser: about.browser,
    userAgent: about.userAgent,
    gpu: r.gpu,
    sha: r.sha,
    base,
    build,
    tier,
    view: view.name,
    mean,
    p95,
    n,
    canvas: { start: r.canvasStart, end: r.canvasEnd },
    readyS: r.readyS,
    gpuTime: { start: r.gpuStart, end: r.gpuEnd },
    load,
    quiet: load === null ? null : load <= QUIET_LOAD,
    flags: [],
  };
  row.flags = flagsFor(row);
  return row;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The tier's budget from `budgets.json`, or null when there is none yet. */
function tierBudget(tier) {
  const path = join(HERE, "budgets.json");
  if (!existsSync(path)) return null;
  const entry = JSON.parse(readFileSync(path, "utf8"))[tier];
  return entry === undefined ? null : { meanMs: entry.meanMs, p95Ms: entry.p95Ms };
}

/** Each view's pairs, A against B on the means, and the median of the pairs with no flagged row. */
function printPairs(rows) {
  const views = [...new Set(rows.map((r) => r.view))];
  for (const view of views) {
    const vr = rows.filter((r) => r.view === view);
    const as = vr.filter((r) => r.build === "A");
    const bs = vr.filter((r) => r.build === "B");
    const { pairs } = pairDeltas(vr);
    const kept = [];
    for (const p of pairs) {
      const flagged = as[p.pair - 1].flags.length > 0 || bs[p.pair - 1].flags.length > 0;
      if (!flagged) kept.push(p.delta);
      const sign = p.delta > 0 ? "+" : "";
      process.stdout.write(`${view}  pair ${p.pair}  A ${p.a} ms  B ${p.b} ms  delta ${sign}${p.delta} ms${flagged ? "  (flagged, left out)" : ""}\n`);
    }
    const median = kept.length === 0 ? null : Math.round(medianOf(kept) * 100) / 100;
    process.stdout.write(`${view}  median delta (B - A) ${median === null ? "none: no pair without a flag" : `${median > 0 ? "+" : ""}${median} ms over ${kept.length} pair(s)`}\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(readFileSync(join(HERE, "views.json"), "utf8"));
  const stills = JSON.parse(readFileSync(STILLS, "utf8"));
  const resolved = resolveViews(config, stills, options.views);
  const shift = resolved.length === 0 ? 0 : options.rotate % resolved.length;
  const views = [...resolved.slice(shift), ...resolved.slice(0, shift)];
  if (views.length === 0) throw new Error("no views to measure");
  const remote = options.remote !== undefined;
  const bases = { A: options.base, B: options.against };
  const out = options.out ?? join(HERE, "runs", `${today()}-${options.machine}-${options.tier}.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  const stem = out.replace(/\.jsonl$/, "");

  // The plan: (view, build) in the order the samples are taken.
  const plan = [];
  if (options.steadiness) {
    for (let i = 0; i < STEADINESS_SAMPLES; i++) plan.push({ ...views[0], build: "A" });
  } else {
    const order = options.against === undefined ? Array.from({ length: options.pairs }, () => "A") : pairOrder(options.pairs);
    for (const v of views) for (const build of order) plan.push({ ...v, build });
  }

  if (!remote) {
    for (const base of Object.values(bases).filter((b) => b !== undefined)) {
      const probe = await fetch(base, { redirect: "manual" }).catch(() => null);
      if (probe === null) throw new Error(`nothing answers at ${base}: start the dev server (npm run dev:client) or check the URL`);
    }
  }
  if (!remote) {
    let util = null;
    try {
      util = parseGpuUtil(execFileSync("ioreg", ["-r", "-c", "AGXAccelerator", "-d", "1"], { encoding: "utf8" }));
    } catch {}
    if (util === null) process.stdout.write("GPU check unavailable (ioreg failed)\n");
    else if (util >= QUIET_GPU) {
      throw new Error(`the Mac's GPU is busy before Chrome starts (Device Utilization ${util} %, limit ${QUIET_GPU}): close every other page or app that draws, then run again`);
    } else process.stdout.write(`gpu idle: ${util} %\n`);
  }
  const session = remote ? await attachChrome(options.remote) : await launchChrome();
  const rows = [];
  try {
    const about = await version(session.port);
    if (remote) {
      process.stdout.write(`remote browser: ${about.browser}\n  ${about.userAgent}\n`);
      if (!about.userAgent.includes("Windows NT")) {
        throw new Error(`the browser on port ${options.remote} is not the rig's (no "Windows NT" in its user agent): a reading on the wrong machine is void`);
      }
    }
    if (options.warm > 0) {
      const { view, still } = views[0];
      process.stdout.write(`warming ${options.warm} s on ${view.name} (${options.tier})\n`);
      const warm = await openView(session.browser, session.port, options.tier, viewUrl(options.base, stills.game, options.tier, view, still, { gpuTime: true }));
      try {
        await awaitReady(warm.page, view.name);
        await sleep(options.warm * 1000);
      } finally {
        await warm.close();
      }
    }
    const taken = new Map();
    for (const [i, { view, still, build }] of plan.entries()) {
      const nth = (taken.get(`${view.name}${build}`) ?? 0) + 1;
      taken.set(`${view.name}${build}`, nth);
      const base = bases[build];
      process.stdout.write(`[${i + 1}/${plan.length}] ${view.name} ${build} (${base})\n`);
      const shotPath = options.shot ? `${stem}-${view.name}-${build}${nth}.jpg` : undefined;
      const r = await sample(session, { tier: options.tier, base, game: stills.game, view, still, settle: options.settle, shotPath });
      const row = rowOf(r, { machine: options.machine, about, base, build, tier: options.tier, view, remote });
      appendFileSync(out, `${JSON.stringify(row)}\n`);
      rows.push(row);
      const scale = `canvas ${row.canvas.start.join("x")} -> ${row.canvas.end.join("x")}`;
      process.stdout.write(
        `  mean ${row.mean} ms  p95 ${row.p95} ms  n ${row.n}  ${scale}  sha ${row.sha}  load ${row.load ?? "n/a"}  ready ${row.readyS} s${row.flags.length ? `  [${row.flags.join(", ")}]` : ""}${shotPath ? `\n  shot ${shotPath}` : ""}\n`,
      );
    }
  } finally {
    await session.close();
  }

  process.stdout.write(`\nrows: ${out}\n\n`);
  // One table and one verdict a build: the medians group by view, so two builds' rows never mix.
  const budget = tierBudget(options.tier);
  const builds = options.against === undefined ? ["A"] : ["A", "B"];
  for (const build of builds) {
    const own = rows.filter((r) => r.build === build);
    if (options.against !== undefined) process.stdout.write(`build ${build}: ${bases[build]}\n`);
    const lines = table(own, budget);
    process.stdout.write(lines === "" ? "(no view has a row without a flag: nothing to tabulate)\n" : `${lines}\n`);
    if (budget === null) process.stdout.write(`(no budget for ${options.tier} in budgets.json: not judged)\n`);
    else {
      const v = verdict(own, budget);
      const line =
        v.worst === null
          ? "not judged: no row without a flag"
          : `${v.over ? "OVER" : "under"} the ${options.tier} budget (${budget.meanMs} ms mean, ${budget.p95Ms} ms p95); worst ${v.worst} at ${v.views[v.worst].meanMs} ms mean, ${v.views[v.worst].p95Ms} ms p95`;
      process.stdout.write(`verdict: ${line}\n`);
    }
    process.stdout.write("\n");
  }
  const flagged = rows.filter((r) => r.flags.length > 0);
  if (flagged.length > 0) {
    process.stdout.write(`flagged, left out of the medians:\n`);
    for (const r of flagged) process.stdout.write(`  ${r.view} ${r.build}  mean ${r.mean} ms  [${r.flags.join(", ")}]  load ${r.load ?? "n/a"}\n`);
  }
  if (options.against !== undefined) {
    process.stdout.write("\n");
    printPairs(rows);
  }
  if (options.steadiness) {
    const means = rows.map((r) => r.mean);
    const spread = (Math.max(...means) - Math.min(...means)) / medianOf(means);
    process.stdout.write(`\nsteadiness, ${views[0].view.name}: means ${means.join(", ")} ms\n`);
    process.stdout.write(`  spread (max - min) / median ${(spread * 100).toFixed(1)} %${flagged.length ? ` (${flagged.length} of ${rows.length} flagged)` : ""}\n`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
