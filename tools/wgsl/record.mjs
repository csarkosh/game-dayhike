#!/usr/bin/env node
// The shader stages the game's pages ask for on the WebGPU path, recorded as `?wgsl=record`
// keeps them: one JSON file a page and tier, the recordings `merge-corpus.mjs` adds to the corpus.
// The pages are `record-pages.json`'s: the title's tour and the intro held at a frame, and places
// in two named worlds on the free camera, by day and night and in each weather; each is opened on a
// Chrome of its own with the tier pinned, left for `seconds`, and its recording caught as the page
// makes the download.
//
//   node tools/wgsl/record.mjs --out <dir>                          every page, on medium and high
//   node tools/wgsl/record.mjs --out <dir> --tier low tarn night    these pages, on low
//   node tools/wgsl/record.mjs --out <dir> --base https://games.csarko.sh/dayhike
//
// From the dev server (http://localhost:5173/dayhike) by default. Needs Google Chrome (`CHROME`
// names another binary), opened as a window: headless Chrome on a Mac gives no WebGPU.
// `CHROME_FLAGS`, a JSON array, adds flags (headless Chrome on a Linux GPU, say); before each page
// it opens a file of the same origin and waits for a WebGPU adapter, which a freshly started
// headless Chrome gives a page only after a moment. `--verbose` prints each page's console.
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

/** A CDP session: `send(method, params)` resolving to the result; `send.errors`, the page's
 * uncaught exceptions, console errors and warnings so far, and the line it logs for its engine,
 * for a page that recorded nothing to say why. */
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
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
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
  return send;
}

async function evaluate(page, expression) {
  const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** One page recorded: written to `<out>/<name>-<tier>.json`; resolves to what the page reported.
 * `warmUrl`: a small file of the page's origin, opened first (below). */
async function record(url, warmUrl, file, seconds) {
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
  try {
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; !existsSync(portFile); i++) {
      if (i > 150) throw new Error("Chrome did not open its debugging port");
      await sleep(200);
    }
    const [port] = readFileSync(portFile, "utf8").split(/\r?\n/);
    let target;
    for (let i = 0; !target; i++) {
      if (i > 50) throw new Error("Chrome opened no page");
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((t) => t.type === "page");
      if (!target) await sleep(200);
    }
    const page = await connect(target.webSocketDebuggerUrl);
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
    for (let i = 0; !(await evaluate(page, "(async () => !!(await navigator.gpu?.requestAdapter()))()")); i++) {
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
    await page("Browser.close").catch(() => undefined);
    return report;
  } finally {
    await sleep(500);
    if (proc.exitCode === null) proc.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
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
      verbose: { type: "boolean", default: false },
    },
  });
  VERBOSE = values.verbose;
  if (!values.out) throw new Error("--out <dir>: where the recordings go");
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME)`);
  const tiers = values.tier.split(",");
  for (const tier of tiers) if (!TIERS.includes(tier)) throw new Error(`--tier ${tier}: one of ${TIERS.join(", ")}`);
  const pages = positionals.length === 0 ? PAGES.pages : positionals.map((name) => PAGES.pages.find((p) => p.name === name) ?? name);
  const unknown = pages.filter((p) => typeof p === "string");
  if (unknown.length > 0) throw new Error(`no page ${unknown.join(", ")} in record-pages.json`);
  const seconds = Number(values.seconds ?? PAGES.seconds);
  mkdirSync(values.out, { recursive: true });
  let failed = 0;
  for (const tier of tiers) {
    for (const p of pages) {
      const started = Date.now();
      const file = join(values.out, `${p.name}-${tier}.json`);
      const report = await record(pageUrl(values.base, PAGES.game, p, tier), `${values.base.replace(/\/+$/, "")}/favicon.ico`, file, seconds).catch((error) => ({ problem: error.message }));
      const took = `${((Date.now() - started) / 1000).toFixed(0)} s`;
      if (report.problem) {
        failed += 1;
        console.log(`✗ ${p.name} ${tier} ${took}: ${report.problem}`);
      } else {
        console.log(`✓ ${p.name} ${tier} ${took}: ${report.effects} effects, ${report.hits} stages found, ${report.misses} translated -> ${file}`);
        if (report.carriageReturns > 0) console.log(`  ! ${report.carriageReturns} stages with carriage returns: not a recording to merge`);
      }
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}

// Run, not imported (`recordPages.test.mjs` imports `pageUrl`).
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main().catch((error) => {
    console.error(`record: ${error.message}`);
    process.exit(2);
  });
}
