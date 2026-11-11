#!/usr/bin/env node
// A scene's frames, one by one: the summit scene and the chase after it, played as a match plays
// them, every frame's time kept from before the find to the end of the chase's first minute, with
// the page's long frames (`long-animation-frame`), the GPU readout (`?gpuTime`) once a second and,
// when asked, a CPU profile. The fixed views of `measure.mjs` time ten settled seconds of a place;
// this times what happens in a world as it changes, where a hitch is the measure and a mean is not.
//
//   node tools/frame-budget/timeline.mjs --base <url> --out <dir> --remote <port> [--tier medium]
//       [--engine webgpu|webgl2] [--label <name>] [--settle 45] [--chase 60] [--approach walk|command|escape]
//       [--stand "x z yaw"] [--seed atmo] [--profile] [--still] [--climb <s>] [--screencast] [--query <a=b&c=d>]
//
//   --base <url>      the build: the live site or a preview channel
//   --out <dir>       where the run's files go (under the lab disk): <label>.json, <label>.cpuprofile,
//                     <label>.jpg (the page as the run ends)
//   --remote <port>   the rig's Chrome behind a forwarded port
//   --tier <tier>     the tier the page is opened at (medium)
//   --engine <e>      the engine forced (`?engine=`); the game's own choice without it
//   --label <name>    the run's name in its files (run)
//   --settle <s>      seconds from world-ready to the approach (45): the place streamed in, the
//                     escalation eased to where the climb left it
//   --chase <s>       seconds timed after the scene's end (60)
//   --approach walk   the player walks the last metres to the body, as a match's find comes (the
//                     default); `command` types the console's `summit` instead; `escape` types the
//                     console's `escape`, the end scene from the win, timed 30 s, and no chase
//   --stand "x z yaw" where the player stands before the approach (30 m down the stem from seed
//                     atmo's body, facing it)
//   --profile         a CPU profile (`Profiler`, 0.5 ms samples) from the approach to the end
//   --still           the player stands still through the chase (the Hollow reaches them); without
//                     it they sprint the way the threshold turned them
//   --query <text>    more of the URL's query, as written (`a=b&c=d`)
//   --climb <s>       no find: from where the player stands they sprint that many seconds the way they
//                     face, on the climb, for the same run without the chase (the chase's control)
//   --screencast      what the screen showed: the compositor's frames (at most every fourth, small
//                     JPEGs) saved under <label>-cast/ with their times; it costs frames, so a run
//                     with it is for looking, not for timing
//
// The frames are the page's own `requestAnimationFrame` times, kept by a script installed before
// the page's first; a rig's Chrome runs with the frame cap off, so a frame's time is its cost.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attachChrome, closeStrayPages, evaluate, openPage, version } from "./lib/cdp.mjs";
import { fileURLToPath } from "node:url";
import { TIER_SIZES } from "./lib/views.mjs";

const STILLS = fileURLToPath(new URL("../previews/stills.json", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const o = { base: undefined, out: undefined, remote: undefined, tier: "medium", engine: undefined, label: "run", settle: 45, chase: 60, approach: "walk", stand: "650 -276 1.5708", seed: "atmo", profile: false, still: false, query: "", screencast: false, climb: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--base") o.base = next();
    else if (a === "--out") o.out = next();
    else if (a === "--remote") o.remote = Number(next());
    else if (a === "--tier") o.tier = next();
    else if (a === "--engine") o.engine = next();
    else if (a === "--label") o.label = next();
    else if (a === "--settle") o.settle = Number(next());
    else if (a === "--chase") o.chase = Number(next());
    else if (a === "--approach") o.approach = next();
    else if (a === "--stand") o.stand = next();
    else if (a === "--seed") o.seed = next();
    else if (a === "--profile") o.profile = true;
    else if (a === "--still") o.still = true;
    else if (a === "--query") o.query = next();
    else if (a === "--screencast") o.screencast = true;
    else if (a === "--climb") o.climb = Number(next());
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.base || !o.out || !o.remote) throw new Error("--base, --out and --remote are needed");
  if (!(o.tier in TIER_SIZES) && o.tier !== "low") throw new Error(`--tier is medium, high or low, not ${o.tier}`);
  return o;
}

/** Installed before the page's own scripts: every frame's time, the scene's bars and the world's
 * readiness as marks, the long frames with their scripts, and the GPU readout once a second. */
const RECORDER = `(() => {
  if (window.__tl) return;
  const tl = (window.__tl = { t: [], marks: [], loaf: [], gpu: [], jobs: [], pipes: [], wgsl: [] });
  let scene = false, ready = false, end = false, pipeKey = "", wgslKey = "";
  tl.mark = (name) => tl.marks.push({ t: performance.now(), name });
  const tick = (t) => {
    tl.t.push(t);
    const b = document.body;
    if (b) {
      const s = b.classList.contains("scene");
      if (s !== scene) { scene = s; tl.marks.push({ t, name: s ? "scene-on" : "scene-off" }); }
      const r = b.classList.contains("world-ready");
      if (r !== ready) { ready = r; tl.marks.push({ t, name: "world-ready" }); }
      const e = !!document.querySelector(".end.on, .ending.on");
      if (e !== end) { end = e; tl.marks.push({ t, name: e ? "end-on" : "end-off" }); }
    }
    const p = globalThis.dayhikePipelines;
    if (p) {
      const key = p.asked + "," + p.landed + "," + p.held + "," + p.leftOut + "," + p.sync + "," + p.pending;
      if (key !== pipeKey) { pipeKey = key; tl.pipes.push({ t, mode: p.mode, asked: p.asked, landed: p.landed, held: p.held, leftOut: p.leftOut, sync: p.sync, pending: p.pending, failed: p.failed, expired: p.expired, longestMs: p.longestMs }); }
    }
    // The WGSL lookup's counters (shaderLookup.ts): a miss is a stage the shipped maps lack, translated in the page.
    const w = globalThis.dayhikeWgsl;
    if (w) {
      const key = w.hits + "," + w.misses;
      if (key !== wgslKey) { wgslKey = key; tl.wgsl.push({ t, hits: w.hits, misses: w.misses, translateMs: w.translateMs }); }
    }
    if (typeof window.__syncJobs === "function") { const j = window.__syncJobs(); if (j && j.ms > 2) tl.jobs.push({ t, ms: j.ms, late: j.lateMs, owners: j.owners }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    if (typeof window.__gpuTime !== "function") return;
    const r = window.__gpuTime();
    tl.gpu.push({ t: performance.now(), frameMs: r.frameMs, mainMs: r.mainMs, supported: r.supported, build: r.build, size: [r.renderWidth, r.renderHeight], targets: r.targets.map((x) => [x.name, x.ms]) });
  }, 1000);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        tl.loaf.push({
          start: e.startTime, dur: e.duration, render: e.renderStart, style: e.styleAndLayoutStart,
          scripts: e.scripts.map((s) => ({ invoker: s.invoker, type: s.invokerType, start: s.startTime, dur: s.duration, fn: s.sourceFunctionName, url: s.sourceURL, char: s.sourceCharPosition, forced: s.forcedStyleAndLayoutDuration })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {}
})();`;

const KEYS = {
  KeyW: { key: "w", code: "KeyW", windowsVirtualKeyCode: 87 },
  ShiftLeft: { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, location: 1 },
  Slash: { key: "/", code: "Slash", windowsVirtualKeyCode: 191, text: "/" },
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
};
const keyDown = (page, name) => page("Input.dispatchKeyEvent", { type: KEYS[name].text ? "keyDown" : "rawKeyDown", ...KEYS[name] });
const keyUp = (page, name) => page("Input.dispatchKeyEvent", { type: "keyUp", ...KEYS[name], text: undefined });

const classOn = (page, name) => evaluate(page, `document.body.classList.contains(${JSON.stringify(name)})`).catch(() => false);
const mark = (page, name) => evaluate(page, `window.__tl.mark(${JSON.stringify(name)})`);

async function waitFor(what, test, maxS) {
  const start = Date.now();
  for (;;) {
    if (await test()) return (Date.now() - start) / 1000;
    if (Date.now() - start > maxS * 1000) throw new Error(`${what}: not within ${maxS} s`);
    await sleep(250);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const game = JSON.parse(readFileSync(STILLS, "utf8")).game;
  mkdirSync(o.out, { recursive: true });
  const about = await version(o.remote);
  if (!/Windows NT/.test(about.userAgent)) throw new Error(`--remote ${o.remote} is not the rig's Chrome (${about.userAgent})`);
  const strays = await closeStrayPages(o.remote);
  if (strays.length > 0) process.stdout.write(`closed ${strays.length} stray page(s)\n`);
  const session = await attachChrome(o.remote);
  const root = o.base.replace(/\/+$/, "");
  const cmd = encodeURIComponent(`seed ${o.seed};stand ${o.stand}`).replace(/%3B/g, ";");
  const url = `${root}/game/${game}?cmd=${cmd}&tier=${o.tier}&telemetry=off&gpuTime${o.engine ? `&engine=${o.engine}` : ""}${o.query ? `&${o.query}` : ""}`;
  const { page, close } = await openPage(session.browser, o.remote, { origin: new URL(url).origin });
  try {
    const size = TIER_SIZES[o.tier] ?? TIER_SIZES.medium;
    await page("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    await page("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
    const nav = await page("Page.navigate", { url });
    if (nav.errorText) throw new Error(`${url} did not load: ${nav.errorText}`);
    process.stdout.write(`${o.label}: ${url}\n`);
    const readyS = await waitFor("world-ready", () => classOn(page, "world-ready"), 240);
    process.stdout.write(`${o.label}: world ready after ${readyS.toFixed(1)} s; settling ${o.settle} s\n`);
    await sleep(o.settle * 1000);
    if (o.profile) {
      await page("Profiler.enable");
      await page("Profiler.setSamplingInterval", { interval: 500 });
      await page("Profiler.start");
      // A known burn, so the profile's clock can be laid on the page's: 40 ms inside a named function.
      await evaluate(page, `(() => { const t0 = performance.now(); (function __tlSyncBurn() { while (performance.now() - t0 < 40); })(); window.__tl.marks.push({ t: t0, name: "sync-burn" }); })()`);
    }
    const cast = [];
    if (o.screencast) {
      // What the screen showed, as the compositor presented it: a frame each time the page's picture
      // changed (at most every fourth), with its time. A screen that kept one image shows as a gap.
      mkdirSync(join(o.out, `${o.label}-cast`), { recursive: true });
      page.on("Page.screencastFrame", (e) => {
        const n = cast.length;
        cast.push({ n, timestamp: e.metadata.timestamp });
        writeFileSync(join(o.out, `${o.label}-cast`, `${String(n).padStart(5, "0")}.jpg`), Buffer.from(e.data, "base64"));
        page("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => undefined);
      });
      const wall = await evaluate(page, "[Date.now(), performance.now()]");
      cast.clock = wall;
      await page("Page.startScreencast", { format: "jpeg", quality: 50, maxWidth: 735, maxHeight: 478, everyNthFrame: 4 });
    }
    if (o.climb > 0) {
      await mark(page, "sprint-on");
      await keyDown(page, "ShiftLeft");
      await keyDown(page, "KeyW");
      process.stdout.write(`${o.label}: sprinting ${o.climb} s on the climb\n`);
      await sleep(o.climb * 1000);
      await mark(page, "chase-end");
      await keyUp(page, "KeyW");
      await keyUp(page, "ShiftLeft");
    } else {
    await mark(page, "approach");
    if (o.approach === "walk") {
      await keyDown(page, "KeyW");
      await waitFor("the find (walking)", () => classOn(page, "scene"), 40);
      await keyUp(page, "KeyW");
    } else {
      const command = o.approach === "escape" ? "escape" : "summit";
      await keyDown(page, "Slash");
      await keyUp(page, "Slash");
      await sleep(200);
      await page("Input.insertText", { text: command });
      await keyDown(page, "Enter");
      await keyUp(page, "Enter");
      // `escape` waits for the film's car (up to 10 s) before the win.
      await waitFor(`the ${command === "escape" ? "win" : "find"} (command)`, () => classOn(page, "scene"), command === "escape" ? 40 : 20);
    }
    process.stdout.write(`${o.label}: the scene began\n`);
    if (o.approach === "escape") {
      // The end scene, from the win to its dark (about 24 s), and on a little; no chase after it.
      await sleep(30_000);
      await mark(page, "chase-end");
    } else {
    await waitFor("the scene's end", async () => !(await classOn(page, "scene")), 40);
    process.stdout.write(`${o.label}: the scene ended; ${o.still ? "standing" : "sprinting"} ${o.chase} s of the chase\n`);
    if (!o.still) {
      await keyDown(page, "ShiftLeft");
      await keyDown(page, "KeyW");
    }
    await sleep(o.chase * 1000);
    await mark(page, "chase-end");
    if (!o.still) {
      await keyUp(page, "KeyW");
      await keyUp(page, "ShiftLeft");
    }
    }
    }
    if (o.screencast) await page("Page.stopScreencast").catch(() => undefined);
    let profile = null;
    if (o.profile) profile = (await page("Profiler.stop")).profile;
    const tl = await evaluate(page, `(() => { const c = document.querySelector("canvas"); return { ...window.__tl, canvas: c ? [c.width, c.height] : null, href: location.href }; })()`);
    const engine = await evaluate(page, `(async () => { let gpu = null; try { const info = (await navigator.gpu?.requestAdapter())?.info; gpu = (info && (info.description || info.architecture)) || null; } catch {} return { gpu, classes: document.body.className, status: document.querySelector(".gputime")?.textContent ?? null }; })()`);
    const shot = await page("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    writeFileSync(join(o.out, `${o.label}.jpg`), Buffer.from(shot.data, "base64"));
    const meta = { label: o.label, time: new Date().toISOString(), url, tier: o.tier, engine: o.engine ?? null, approach: o.approach, still: o.still, settle: o.settle, chase: o.chase, readyS, browser: about.browser, ...engine };
    writeFileSync(join(o.out, `${o.label}.json`), JSON.stringify({ meta, ...tl, cast: o.screencast ? { clock: cast.clock, frames: cast } : null }));
    if (profile !== null) writeFileSync(join(o.out, `${o.label}.cpuprofile`), JSON.stringify(profile));
    process.stdout.write(`${o.label}: ${tl.t.length} frames, ${tl.loaf.length} long frames; written to ${o.out}\n`);
  } finally {
    await close();
    await session.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
