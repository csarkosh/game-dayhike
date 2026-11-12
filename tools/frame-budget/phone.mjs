#!/usr/bin/env node
// A phone's frames, over the cable: the views of `views.json` opened on a Chrome for Android
// reached through `adb forward tcp:<port> localabstract:chrome_devtools_remote`, each on a tab of
// its own at the phone's own size (no emulation), waited for until the page says its world is
// ready (`body.world-ready`), settled, then its frames timed in consecutive 10 s windows (after a
// 3 s warm-up) with a JPEG at each window's end. A `walk` view holds the joystick forward by
// synthetic touches for every window. With --profile a CPU profile of the whole view is saved
// beside the rows. One JSON row a window, appended to `<out>/rows.jsonl`. The README's section
// "The phone" says how to get the phone to the cable.
//
//   npm run frame-budget:phone -- --base <url> --out <dir> --views reveal,walk-night [--tier low]
//       [--windows 1] [--settle 0] [--port 9222] [--label phone] [--tag <text>] [--profile]
//       [--engine webgpu|webgl2]
//
//   --base <url>     the build measured: the live site, a preview channel or a dev server the phone can reach
//   --out <dir>      the rows' and the JPEGs' directory (under the lab disk)
//   --views a,b      the views to open (a `check` view only by name)
//   --tier <tier>    the tier the views are opened at (low: what every phone is put on)
//   --windows <n>    consecutive 10 s windows a view (1 by default); a `check` view's extraSettleS is
//                    skipped when there is more than one, since the windows are the settle
//   --settle <s>     seconds from world-ready to the first window
//   --port <port>    the forwarded port (9222)
//   --label <name>   the phone's name in the rows; --tag <text> the run's
//   --engine <e>     the engine forced (`?engine=`): a phone is put on WebGL2 by the game's own rule, so
//                    `webgpu` is how its WebGPU path is timed; the row's `engine` says what was asked
//   --profile        a CPU profile (`Profiler.start/stop`, 0.5 ms samples) over the view, saved as
//                    <view>-<stamp>.cpuprofile; `tools/telemetry/symbolicate.mjs` reads its frames back
//
// The phone's GPU readout (`?gpuTime`) is WebGPU's and every phone draws with WebGL2, so a phone
// measures whole frames; the measurement mode is still asked for, so the page exposes
// `window.__syncJobs()` (the streaming jobs' milliseconds a frame), read each frame into the row's `jobs`.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, evaluate, version, ORIGIN_STORAGE } from "./lib/cdp.mjs";
import { isAndroid, jobsOf, parseArgs, phoneState, rowOf, stickTouches } from "./lib/phone.mjs";
import { resolveViews, viewUrl } from "./lib/views.mjs";

const HERE = new URL(".", import.meta.url);
const WARMUP_S = 3;
const WINDOW_S = 10;
const CANVAS_TRIES = 240;
const POLL_MS = 500;
const READY_MAX_S = 420;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WINDOW_EXPRESSION = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const size = () => { const c = document.querySelector("canvas"); return c ? [c.width, c.height] : null; };
  const jobs = () => (typeof window.__syncJobs === "function" ? window.__syncJobs() : null);
  await sleep(${WARMUP_S * 1000});
  const canvasStart = size();
  const frames = [];
  const readings = [];
  await new Promise((done) => {
    let last = null;
    let end = null;
    const tick = (t) => {
      if (last === null) end = t + ${WINDOW_S * 1000};
      else { frames.push(t - last); readings.push({ jobs: jobs() }); }
      last = t;
      if (t < end) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  const canvasEnd = size();
  let gpu = null;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    gpu = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || null;
    gl && gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
  const ran = typeof window.dayhikePipelines !== "undefined" ? "webgpu" : "webgl2";
  return { frames, readings, canvasStart, canvasEnd, gpu, ran, dpr: devicePixelRatio, inner: [innerWidth, innerHeight] };
})()`;

/** The phone woken, kept awake while on the cable, and the game opened in front through adb (best
 * effort: a Chrome in the background does not answer on its socket). */
function wakePhone(base) {
  const adb = (...args) => {
    try {
      execFileSync("adb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {}
  };
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "svc", "power", "stayon", "true");
  adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `${base.replace(/\/+$/, "")}/`, "com.android.chrome");
}

/** A tab of the phone's Chrome, the game's stored state cleared, navigated to `url` and its canvas waited for. */
async function openTab(browser, port, url) {
  const origin = new URL(url).origin;
  const { targetId } = await browser("Target.createTarget", { url: "about:blank" });
  let target;
  for (let i = 0; !target; i++) {
    if (i > 50) throw new Error("the new tab never appeared in /json/list");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find((t) => t.id === targetId);
    if (!target) await sleep(200);
  }
  const page = await connect(target.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`));
  const close = async () => {
    await page("Page.navigate", { url: "about:blank" }).catch(() => undefined);
    page.close();
    await browser("Target.closeTarget", { targetId }).catch(() => undefined);
  };
  try {
    await page("Page.enable");
    await page("Runtime.enable");
    await page("Storage.clearDataForOrigin", { origin, storageTypes: ORIGIN_STORAGE }).catch(() => undefined);
    await browser("Target.activateTarget", { targetId }).catch(() => undefined);
    const nav = await page("Page.navigate", { url });
    if (nav.errorText) throw new Error(`${url} did not load: ${nav.errorText}`);
    for (let i = 0; ; i++) {
      if (await evaluate(page, "!!document.querySelector('canvas')").catch(() => false)) break;
      if (i === CANVAS_TRIES - 1) throw new Error(`the game's canvas never appeared at ${url}`);
      await sleep(POLL_MS);
    }
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function awaitReady(page, name) {
  const start = Date.now();
  while (!(await evaluate(page, "document.body.classList.contains('world-ready')").catch(() => false))) {
    if (Date.now() - start > READY_MAX_S * 1000) throw new Error(`${name}: the world was not ready within ${READY_MAX_S} s`);
    await sleep(POLL_MS);
  }
  return Math.round((Date.now() - start) / 100) / 10;
}

/** The joystick held forward: the base found in the page, a finger put down on it and moved up. */
async function holdStick(page) {
  const base = await evaluate(page, "(() => { const s = document.querySelector('.touch .stick'); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  if (base === null) throw new Error("no joystick in the page: is this a phone's Chrome?");
  const [down, ...moves] = stickTouches(base);
  await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...down, id: 1 }] });
  for (const p of moves) {
    await page("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p, id: 1 }] });
    await sleep(30);
  }
  return () => page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => undefined);
}

async function measureView(session, options, stills, view, still, rowsFile, about) {
  const url = viewUrl(options.base, stills.game, options.tier, view, still, { gpuTime: true, engine: options.engine });
  const { page, close } = await openTab(session.browser, session.port, url);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let release = null;
  try {
    const readyS = await awaitReady(page, view.name);
    await sleep((options.settle + (options.windows > 1 ? 0 : (view.extraSettleS ?? 0))) * 1000);
    if (options.profile) {
      await page("Profiler.enable");
      await page("Profiler.setSamplingInterval", { interval: 500 });
      await page("Profiler.start");
    }
    if (view.walk) {
      release = await holdStick(page);
      await sleep(2000);
    }
    const rows = [];
    for (let w = 0; w < options.windows; w++) {
      const r = await evaluate(page, WINDOW_EXPRESSION);
      const shot = await page("Page.captureScreenshot", { format: "jpeg", quality: 60 }).catch(() => null);
      if (shot) writeFileSync(join(options.out, `${view.name}${options.tag ? `-${options.tag}` : ""}-${stamp}-w${String(w).padStart(2, "0")}.jpg`), Buffer.from(shot.data, "base64"));
      if (r.canvasStart === null || r.canvasEnd === null) throw new Error(`${view.name}: the canvas went away during window ${w}`);
      const row = rowOf(w, { ...r, readyS, jobs: jobsOf(r.readings) }, { ...about, view: view.name, walking: view.walk === true, phone: phoneState() });
      appendFileSync(rowsFile, JSON.stringify(row) + "\n");
      rows.push(row);
      const jobs = row.jobs === null ? "" : `  jobs ${row.jobs.ms} ms (${row.jobs.lateMs} late in ${row.jobs.lateFrames} frames)`;
      console.log(`  ${view.name} w${w}: mean ${row.mean} ms  p95 ${row.p95}  max ${row.max}  (${row.fps} fps, ${row.over20} over 20 ms, ${row.stalls} stalls)${jobs}  canvas ${r.canvasStart.join("x")}  ready ${readyS}s`);
    }
    if (options.profile) {
      const { profile } = await page("Profiler.stop");
      writeFileSync(join(options.out, `${view.name}-${stamp}.cpuprofile`), JSON.stringify(profile));
      console.log(`  profile saved (${profile.samples.length} samples)`);
    }
    return rows;
  } finally {
    if (release !== null) await release();
    await close();
  }
}

const options = parseArgs(process.argv.slice(2));
mkdirSync(options.out, { recursive: true });
const config = JSON.parse(readFileSync(new URL("views.json", HERE), "utf8"));
const stills = JSON.parse(readFileSync(new URL("../previews/stills.json", HERE), "utf8"));
const views = resolveViews(config, stills, options.views);
wakePhone(options.base);
await sleep(3000);
const about = await version(options.port);
if (!isAndroid(about.userAgent)) {
  console.error(`the browser on 127.0.0.1:${options.port} is not an Android Chrome: ${about.userAgent}`);
  process.exit(2);
}
console.log(`attached: ${about.browser}`);
const browser = await connect(about.wsUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${options.port}`));
const session = { browser, port: options.port };
const rowsFile = join(options.out, "rows.jsonl");
const results = [];
try {
  for (const { view, still } of views) {
    try {
      results.push(...(await measureView(session, options, stills, view, still, rowsFile, { browser: about.browser, label: options.label, tag: options.tag, base: options.base, tier: options.tier, engine: options.engine })));
    } catch (error) {
      console.log(`  ${view.name}: FAILED: ${error.message}`);
    }
  }
} finally {
  browser.close();
}
console.log("\nview              w   mean ms  p95 ms   max  fps  late frames");
for (const r of results) {
  console.log(`${r.view.padEnd(17)} ${String(r.window).padStart(2)} ${String(r.mean).padStart(8)} ${String(r.p95).padStart(7)} ${String(r.max).padStart(5)} ${String(r.fps).padStart(4)}  ${r.jobs === null ? "-" : r.jobs.lateFrames}`);
}
