#!/usr/bin/env node
// The shader stages the game's pages ask for on the WebGPU path, recorded as `?wgsl=record`
// keeps them: one JSON file a page and tier, the recordings `merge-corpus.mjs` adds to the corpus.
// The pages are `record-pages.json`'s: the title's tour and the intro held at a frame, and places
// in two named worlds on the free camera, by day and night and in each weather; each is opened on a
// page of its own with the tier pinned, left for `seconds`, and its recording caught as the page
// makes the download.
//
//   node tools/wgsl/record.mjs --out <dir>                          every page, on medium and high
//   node tools/wgsl/record.mjs --out <dir> --tier low tarn night    these pages, on low
//   node tools/wgsl/record.mjs --out <dir> --base https://games.csarko.sh/dayhike
//   node tools/wgsl/record.mjs --out <dir> --jobs 4                 four pages at once
//   node tools/wgsl/record.mjs --out <dir> --attach http://127.0.0.1:9333
//
// From the dev server (http://localhost:5173/dayhike) by default. Each page runs on a Chrome of its
// own, started here from a fresh profile (Google Chrome; `CHROME` names another binary), opened as
// a window; `CHROME_FLAGS`, a JSON array, adds flags (`--headless=new`, which on a Mac gives WebGPU
// from Chrome 156; headless Chrome on a Linux GPU). With `--attach <url>`, the pages run instead on
// a Chrome already running whose DevTools endpoint is at `url` (a rig's Chrome, through a forwarded
// port: `tools/frame-budget/rig/forward.sh`), each on a tab of its own, and that Chrome is left
// running. Before each page it opens a file of the same origin and waits for a WebGPU adapter,
// which a freshly started headless Chrome gives a page only after a moment.
//
// `--jobs <n>` records that many pages at once (1 by default): on one GPU, a page that draws more
// slowly reaches fewer scene states in its `seconds`, so a recording made this way can hold fewer
// stages, never wrong ones. `--limit <seconds>` is the most a page may take, from its Chrome's
// start to its recording written (`seconds` plus 120 by default): past it, or when its Chrome
// goes away, the page fails and the run goes on. `--verbose` prints each page's console.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXTRA_FLAGS = JSON.parse(process.env.CHROME_FLAGS ?? "[]");
const PAGES = JSON.parse(readFileSync(new URL("record-pages.json", import.meta.url), "utf8"));
const WIDTH = 1200;
const HEIGHT = 675;
const TIERS = ["low", "medium", "high"];
/** `--verbose`: each page's whole console, and its failed requests, printed after it. */
let VERBOSE = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page's address: a held scene, or the game in a named world with its commands run. */
export function pageUrl(base, game, page, tier) {
  const root = base.replace(/\/+$/, "");
  const record = `engine=webgpu&tier=${tier}&wgsl=record&telemetry=off`;
  if (page.route !== undefined) return `${root}/${page.route}${page.route.includes("?") ? "&" : "?"}${record}`;
  const cmd = encodeURIComponent(page.cmd.join(";")).replace(/%3B/g, ";");
  return `${root}/game/${game}?cmd=${cmd}&${record}`;
}

/** `work`, or a rejection once `seconds` have passed, whichever comes first. The work is not
 * stopped by this: the caller closes what it was waiting on. */
export function withLimit(work, seconds, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${seconds} s`)), seconds * 1000);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** `jobs` run through `run`, `at` of them at once, each result put at its job's index; a job that
 * throws is its error. */
export async function runJobs(jobs, at, run) {
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < jobs.length; i = next++) {
      results[i] = await run(jobs[i], i).catch((error) => ({ problem: error.message }));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(at, jobs.length)) }, worker));
  return results;
}

/** A CDP session: `send(method, params)` resolving to the result, and rejecting, with every other
 * request still waiting, once the socket closes, so a Chrome that dies mid-request fails the page
 * rather than leaving a promise that never settles. `send.errors`: the page's uncaught exceptions,
 * console errors and warnings so far, and the line it logs for its engine, for a page that
 * recorded nothing to say why. `send.close()` closes the socket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  const errors = [];
  const log = [];
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      log.push(`${m.params.type}: ${text}`);
      // Errors and warnings, and the line the page logs for its tier and engine.
      if (m.params.type === "error" || m.params.type === "warning" || /^quality: /.test(text)) errors.push(text);
    } else if (m.method === "Network.loadingFailed") log.push(`request failed: ${m.params.errorText}`);
    else if (m.method === "Network.responseReceived" && m.params.response.status >= 400) log.push(`${m.params.response.status} ${m.params.response.url}`);
  };
  ws.onclose = () => {
    for (const settle of waiting.values()) settle({ error: { message: "Chrome closed the connection" } });
    waiting.clear();
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`${method}: Chrome closed the connection`));
      const n = ++id;
      waiting.set(n, (m) => {
        waiting.delete(n);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  send.errors = errors;
  send.log = log;
  send.close = () => ws.close();
  return send;
}

async function evaluate(page, expression) {
  const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** The page targets a DevTools endpoint lists, with their socket addresses rewritten to the
 * endpoint's own host and port: Chrome names its own (a rig's `127.0.0.1:9222`), which through a
 * forwarded port is not where it is reached. */
async function listPages(endpoint) {
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const { host } = new URL(endpoint);
  return targets
    .filter((t) => t.type === "page")
    .map((t) => {
      const ws = new URL(t.webSocketDebuggerUrl);
      ws.host = host;
      return { ...t, webSocketDebuggerUrl: ws.href };
    });
}

/** A fresh page on a Chrome started here from a fresh profile: `page`, its session, and
 * `close()`, which ends the Chrome and removes the profile. */
async function launchPage() {
  const profile = mkdtempSync(join(tmpdir(), "dayhike-record-"));
  const proc = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${WIDTH},${HEIGHT}`,
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--autoplay-policy=no-user-gesture-required",
      ...EXTRA_FLAGS,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let page = null;
  const close = async () => {
    await page?.("Browser.close").catch(() => undefined);
    page?.close();
    await sleep(500);
    if (proc.exitCode === null) proc.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; !existsSync(portFile); i++) {
      if (i > 150 || proc.exitCode !== null) throw new Error("Chrome did not open its debugging port");
      await sleep(200);
    }
    const [port] = readFileSync(portFile, "utf8").split(/\r?\n/);
    let target;
    for (let i = 0; !target; i++) {
      if (i > 50) throw new Error("Chrome opened no page");
      [target] = await listPages(`http://127.0.0.1:${port}`);
      if (!target) await sleep(200);
    }
    page = await connect(target.webSocketDebuggerUrl);
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A fresh tab on the Chrome whose DevTools endpoint is `endpoint`: `page`, its session, and
 * `close()`, which closes the tab and leaves the Chrome running. */
async function attachPage(endpoint) {
  const version = await (await fetch(`${endpoint}/json/version`)).json();
  const browserWs = new URL(version.webSocketDebuggerUrl);
  browserWs.host = new URL(endpoint).host;
  const browser = await connect(browserWs.href);
  let targetId = null;
  let page = null;
  const close = async () => {
    page?.close();
    if (targetId) await browser("Target.closeTarget", { targetId }).catch(() => undefined);
    browser.close();
  };
  try {
    ({ targetId } = await browser("Target.createTarget", { url: "about:blank" }));
    let target;
    for (let i = 0; !target; i++) {
      if (i > 50) throw new Error("Chrome listed no page for the new tab");
      target = (await listPages(endpoint)).find((t) => t.id === targetId);
      if (!target) await sleep(200);
    }
    page = await connect(target.webSocketDebuggerUrl);
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** One page recorded on `page`: written to `<out>/<name>-<tier>.json`; resolves to what the page
 * reported, with the adapter it drew on. `warmUrl`: a small file of the page's origin, opened
 * first (below). */
async function recordOn(page, url, warmUrl, file, seconds) {
  await page("Page.enable");
  await page("Runtime.enable");
  if (VERBOSE) await page("Network.enable");
  await page("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  // A GPU that has answered once before the page asks: a freshly started Chrome on a
  // headless Linux GPU gives a page that asks at once no adapter, where a player's warm
  // browser gives one, and the page then draws with WebGL2. Asked from a file of the
  // page's own origin, a secure context, as about:blank is not.
  await page("Page.navigate", { url: warmUrl });
  await sleep(1000);
  const askAdapter = `(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? [a.info?.vendor, a.info?.architecture, a.info?.description].filter(Boolean).join(" ") : null; })()`;
  let adapter = null;
  for (let i = 0; !(adapter = await evaluate(page, askAdapter)); i++) {
    if (i > 30) return { problem: "the GPU gave no WebGPU adapter in 30 s" };
    await sleep(1000);
  }
  await page("Page.navigate", { url });
  await sleep(seconds * 1000);
  // The page's own download, caught on its way to the anchor it would click.
  const report = await evaluate(
    page,
    `(async () => {
      if (!globalThis.dayhikeWgsl) {
        const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
        const info = adapter?.info ? \`\${adapter.info.vendor} \${adapter.info.architecture}\` : "none";
        const said = (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 200);
        return { problem: \`the page made no WebGPU shader report (navigator.gpu \${navigator.gpu ? "there" : "missing"}, adapter \${info}, at \${location.href}, showing "\${said}")\` };
      }
      const make = URL.createObjectURL;
      const click = HTMLAnchorElement.prototype.click;
      let blob = null;
      URL.createObjectURL = (b) => { blob = b; return "blob:caught"; };
      HTMLAnchorElement.prototype.click = function () {};
      try { dayhikeWgsl.download(); } finally { URL.createObjectURL = make; HTMLAnchorElement.prototype.click = click; }
      if (!blob) return { problem: "the page made no recording" };
      globalThis.__recording = await blob.text();
      const r = dayhikeWgsl;
      return { length: __recording.length, hits: r.hits, misses: r.misses, effects: r.effects.length, carriageReturns: r.stagesWithCarriageReturns };
    })()`,
  );
  if (VERBOSE) for (const line of page.log) console.log(`  page ${line.slice(0, 400)}`);
  if (report.problem) return { problem: [report.problem, ...page.errors.slice(-8).map((e) => `  page: ${e.slice(0, 500)}`)].join("\n") };
  let text = "";
  for (let at = 0; at < report.length; at += 1_000_000) {
    text += await evaluate(page, `globalThis.__recording.slice(${at}, ${at + 1_000_000})`);
  }
  writeFileSync(file, text);
  return { ...report, adapter };
}

/** One page recorded, on a Chrome of its own or a tab of the attached one, within `limit`
 * seconds: the page's report, or `{ problem }`. Whatever happens, its Chrome or tab is closed. */
async function record(url, warmUrl, file, seconds, limit, attach) {
  let opened = null;
  try {
    return await withLimit(
      (async () => {
        opened = attach ? await attachPage(attach) : await launchPage();
        return await recordOn(opened.page, url, warmUrl, file, seconds);
      })(),
      limit,
      "the page",
    );
  } catch (error) {
    return { problem: error.message };
  } finally {
    await opened?.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      base: { type: "string", default: "http://localhost:5173/dayhike" },
      tier: { type: "string", default: "medium,high" },
      out: { type: "string" },
      seconds: { type: "string" },
      jobs: { type: "string", default: "1" },
      limit: { type: "string" },
      attach: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
  });
  VERBOSE = values.verbose;
  if (!values.out) throw new Error("--out <dir>: where the recordings go");
  if (!values.attach && !existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME)`);
  const tiers = values.tier.split(",");
  for (const tier of tiers) if (!TIERS.includes(tier)) throw new Error(`--tier ${tier}: one of ${TIERS.join(", ")}`);
  const pages = positionals.length === 0 ? PAGES.pages : positionals.map((name) => PAGES.pages.find((p) => p.name === name) ?? name);
  const unknown = pages.filter((p) => typeof p === "string");
  if (unknown.length > 0) throw new Error(`no page ${unknown.join(", ")} in record-pages.json`);
  const seconds = Number(values.seconds ?? PAGES.seconds);
  const jobs = Number(values.jobs);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs ${values.jobs}: a whole number from 1`);
  const limit = Number(values.limit ?? seconds + 120);
  if (!(limit > seconds)) throw new Error(`--limit ${values.limit}: more than the ${seconds} s a page is left for`);
  if (values.attach) {
    const version = await fetch(`${values.attach}/json/version`).then((r) => r.json()).catch(() => null);
    if (!version?.Browser) throw new Error(`--attach ${values.attach}: no Chrome answers there (its /json/version)`);
    console.log(`attached to ${version.Browser} at ${values.attach}`);
  }
  mkdirSync(values.out, { recursive: true });
  const base = values.base.replace(/\/+$/, "");
  const work = tiers.flatMap((tier) => pages.map((p) => ({ tier, page: p })));
  let failed = 0;
  await runJobs(work, jobs, async ({ tier, page: p }) => {
    const started = Date.now();
    const file = join(values.out, `${p.name}-${tier}.json`);
    const report = await record(pageUrl(base, PAGES.game, p, tier), `${base}/favicon.ico`, file, seconds, limit, values.attach);
    const took = `${((Date.now() - started) / 1000).toFixed(0)} s`;
    if (report.problem) {
      failed += 1;
      console.log(`✗ ${p.name} ${tier} ${took}: ${report.problem}`);
    } else {
      console.log(`✓ ${p.name} ${tier} ${took}: ${report.effects} effects, ${report.hits} stages found, ${report.misses} translated, on ${report.adapter} -> ${file}`);
      if (report.carriageReturns > 0) console.log(`  ! ${report.carriageReturns} stages with carriage returns: not a recording to merge`);
    }
    return report;
  });
  process.exit(failed === 0 ? 0 : 1);
}

// Run, not imported (`recordPages.test.mjs` imports `pageUrl`).
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main().catch((error) => {
    console.error(`record: ${error.message}`);
    process.exit(2);
  });
}
