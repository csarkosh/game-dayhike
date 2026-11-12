#!/usr/bin/env node
// A scene's frames, one by one: the summit scene and the chase after it, played as a match plays
// them, every frame's time kept from before the find to the end of the chase's first minute, with
// the page's long frames (`long-animation-frame`), the GPU readout (`?gpuTime`) once a second and,
// when asked, a CPU profile. The fixed views of `measure.mjs` time ten settled seconds of a place;
// this times what happens in a world as it changes, where a hitch is the measure and a mean is not.
//
//   node tools/frame-budget/timeline.mjs --base <url> --out <dir> --remote <port> [--tier medium]
//       [--engine webgpu|webgl2] [--label <name>] [--settle 45] [--chase 60] [--approach walk|command|escape]
//       [--stand "x z yaw"] [--seed atmo] [--profile] [--still] [--climb <s>] [--walk] [--screencast]
//       [--intro <s>] [--cold] [--phone] [--cool [s]] [--cellular] [--query <a=b&c=d>]
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
//   --walk            with --climb: they walk
//   --intro <s>       a start as a player meets it: the landing page, Play clicked, that many seconds
//                     kept from the click (the film's frames with the page's)
//   --cold            the site's cache and storage emptied first: a first visit
//   --phone           with --intro: on a phone's Chrome over the cable (--remote 9222, --tier low; the
//                     README's "The phone"), at the phone's own size, Play tapped
//   --cellular        with --intro: the browser is told its connection is cellular (4g), at the line's
//                     own speed, so what it does differently there is timed (a film's preload)
//   --cool [s]        with --phone: the run waits until the phone is cool (thermal status 0, battery at
//                     most 34.5 °C), 720 s at most or the seconds given; how warm it was is in the
//                     run's `meta.phone` either way
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
import { execFileSync } from "node:child_process";
import { attachChrome, closeStrayPages, connect, evaluate, openPage, version, ORIGIN_STORAGE } from "./lib/cdp.mjs";
import { isAndroid, isCool, phoneState, waitUntilCool } from "./lib/phone.mjs";
import { fileURLToPath } from "node:url";
import { TIER_SIZES } from "./lib/views.mjs";

const STILLS = fileURLToPath(new URL("../previews/stills.json", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const o = { base: undefined, out: undefined, remote: undefined, tier: "medium", engine: undefined, label: "run", settle: 45, chase: 60, approach: "walk", stand: "650 -276 1.5708", seed: "atmo", profile: false, still: false, query: "", screencast: false, climb: 0, walk: false, intro: 0, cold: false, phone: false, cool: 0, cellular: false };
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
    else if (a === "--walk") o.walk = true;
    else if (a === "--intro") o.intro = Number(next());
    else if (a === "--cold") o.cold = true;
    else if (a === "--phone") o.phone = true;
    else if (a === "--cellular") o.cellular = true;
    else if (a === "--cool") o.cool = /^\d+$/.test(argv[i + 1] ?? "") ? Number(next()) : 720;
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.base || !o.out || !o.remote) throw new Error("--base, --out and --remote are needed");
  if (o.phone && !(o.intro > 0)) throw new Error("--phone times an intro: give --intro <s>");
  if (o.cool > 0 && !o.phone) throw new Error("--cool is a phone's: give --phone");
  if (o.cellular && !(o.intro > 0)) throw new Error("--cellular is an intro's: give --intro <s>");
  if (!(o.tier in TIER_SIZES) && o.tier !== "low") throw new Error(`--tier is medium, high or low, not ${o.tier}`);
  return o;
}

/** Installed before the page's own scripts: every frame's time, the scene's bars and the world's
 * readiness as marks, the long frames with their scripts, and the GPU readout once a second. */
const RECORDER = `(() => {
  if (window.__tl) return;
  const tl = (window.__tl = { t: [], marks: [], loaf: [], gpu: [], jobs: [], pipes: [], wgsl: [], video: [], shown: [] });
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
  // The film's picture: each frame the compositor put on the screen that this thread heard of, with
  // the film's own time and the count of frames shown so far. Between two of them, the film's seconds
  // passed against the frames shown say whether the picture kept up (a picture that stood and then
  // jumped passes film seconds with few frames shown), whether this thread was running or not.
  // The film's start, mark by mark: the Play button's click, the film's play() call (a film is a
  // video that does not loop: the title's does), and its first playing event.
  const once = (name) => { if (!tl.marks.some((m) => m.name === name)) tl.mark(name); };
  document.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest("button#create")) once("play-click"); }, true);
  const playOf = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!this.loop) {
      once("film-play");
      this.addEventListener("playing", () => once("film-playing"), { once: true });
    }
    return playOf.apply(this, arguments);
  };
  // The film is the intro itself: the video under .intro, not the landing loop.
  let watched = null;
  const onShown = (now, m) => {
    tl.shown.push([now, m.mediaTime, m.presentedFrames, m.presentationTime]);
    if (watched && watched.isConnected) watched.requestVideoFrameCallback(onShown); else watched = null;
  };
  setInterval(() => {
    if (watched && watched.isConnected) return;
    const v = document.querySelector(".intro video");
    if (v && typeof v.requestVideoFrameCallback === "function") {
      watched = v;
      v.requestVideoFrameCallback(onShown);
      // The film's end, as a mark: an ended film is paused, and the sampler below skips a paused one.
      v.addEventListener("ended", () => tl.marks.push({ t: performance.now(), name: "film-end" }), { once: true });
    }
  }, 100);
  // A film playing over the page (the intro): the frames it presented and those it dropped, four times a second.
  setInterval(() => {
    const v = document.querySelector(".intro video");
    if (!v || v.paused || typeof v.getVideoPlaybackQuality !== "function") return;
    const q = v.getVideoPlaybackQuality();
    tl.video.push({ t: performance.now(), at: v.currentTime, total: q.totalVideoFrames, dropped: q.droppedVideoFrames, dur: v.duration });
  }, 250);
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

/**
 * The intro over a start, as a player meets it: the landing page, Play clicked (a real click, so
 * the film plays with sound as theirs does), and `o.intro` seconds kept from the click: the page's
 * frames, the film's presented and dropped frames, the world's readiness as a mark. Marked as a
 * sprint is (`sprint-on` at the click), so the report reads it in ten-second stretches.
 */
async function intro(page, o, root, about, phone = undefined) {
  // A phone is timed at its own size, as its player sees it.
  if (!o.phone) {
    const size = TIER_SIZES[o.tier] ?? TIER_SIZES.medium;
    await page("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
  }
  // The browser told its connection is cellular, at the line's own speed: Chrome fetches only a
  // film's metadata ahead on one, whatever the page asks (`filmHead.ts`).
  if (o.cellular) {
    await page("Network.enable");
    await page("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "cellular4g" });
  }
  await page("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  const url = `${root}/?tier=${o.tier}&telemetry=off${o.engine ? `&engine=${o.engine}` : ""}${o.query ? `&${o.query}` : ""}`;
  const nav = await page("Page.navigate", { url });
  if (nav.errorText) throw new Error(`${url} did not load: ${nav.errorText}`);
  process.stdout.write(`${o.label}: ${url}\n`);
  await waitFor("the Play button", () => evaluate(page, `(() => { const b = document.querySelector("button#create"); return !!b && !b.disabled; })()`).catch(() => false), 60);
  await sleep(3000);
  if (o.profile) {
    await page("Profiler.enable");
    await page("Profiler.setSamplingInterval", { interval: 500 });
    await page("Profiler.start");
    await evaluate(page, `(() => { const t0 = performance.now(); (function __tlSyncBurn() { while (performance.now() - t0 < 40); })(); window.__tl.marks.push({ t: t0, name: "sync-burn" }); })()`);
  }
  const at = await evaluate(page, `(() => { const r = document.querySelector("button#create").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await mark(page, "sprint-on");
  if (o.phone) {
    await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at[0], y: at[1] }] });
    await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", clickCount: 1 });
    await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", clickCount: 1 });
  }
  process.stdout.write(`${o.label}: Play clicked; keeping ${o.intro} s\n`);
  await sleep(o.intro * 1000);
  await mark(page, "chase-end");
  let profile = null;
  if (o.profile) profile = (await page("Profiler.stop")).profile;
  const tl = await evaluate(page, `(() => { const c = document.querySelector("canvas"); return { ...window.__tl, canvas: c ? [c.width, c.height] : null, href: location.href }; })()`);
  const engine = await evaluate(page, `(async () => { let gpu = null; try { const info = (await navigator.gpu?.requestAdapter())?.info; gpu = (info && (info.description || info.architecture)) || null; } catch {} return { gpu, classes: document.body.className, status: null }; })()`);
  const shot = await page("Page.captureScreenshot", { format: "jpeg", quality: 70 });
  writeFileSync(join(o.out, `${o.label}.jpg`), Buffer.from(shot.data, "base64"));
  const ready = tl.marks.find((m) => m.name === "world-ready"), play = tl.marks.find((m) => m.name === "sprint-on");
  const meta = { label: o.label, time: new Date().toISOString(), url, tier: o.tier, engine: o.engine ?? null, approach: "intro", still: false, settle: 0, chase: o.intro, readyS: ready && play ? (ready.t - play.t) / 1000 : Number.NaN, cold: o.cold, cellular: o.cellular, browser: about.browser, ...engine, ...(phone === undefined ? {} : { phone }) };
  writeFileSync(join(o.out, `${o.label}.json`), JSON.stringify({ meta, ...tl, cast: null }));
  if (profile !== null) writeFileSync(join(o.out, `${o.label}.cpuprofile`), JSON.stringify(profile));
  process.stdout.write(`${o.label}: ${tl.t.length} frames, ${tl.loaf.length} long frames, world ready ${meta.readyS.toFixed(1)} s after Play; written to ${o.out}\n`);
}

/**
 * An intro on a phone, over the cable (`adb forward tcp:<port> localabstract:chrome_devtools_remote`,
 * the README's "The phone"): the phone's Chrome brought to the front, a tab of its own with the
 * site's stored state cleared (and its cache, with --cold), and `intro` on it at the phone's size.
 */
async function phoneIntro(o) {
  mkdirSync(o.out, { recursive: true });
  // Awake, kept awake on any charger (the cable's or a wall's: off the cable the phone is reached
  // over Wi-Fi, the README's "The phone"), and Chrome in front: a Chrome behind answers nothing.
  const front = () => {
    for (const args of [["shell", "input", "keyevent", "KEYCODE_WAKEUP"], ["shell", "svc", "power", "stayon", "true"], ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "about:blank", "com.android.chrome"]]) {
      try { execFileSync("adb", args, { stdio: "ignore" }); } catch {}
    }
  };
  front();
  await sleep(2000);
  // How warm the phone is as the run starts: with --cool, waited for; without, only read.
  const phone = o.cool > 0 ? await waitUntilCool({ maxS: o.cool }) : { ...phoneState(), waitedS: 0 };
  phone.cool ??= isCool(phone);
  process.stdout.write(`${o.label}: thermal ${phone.thermalStatus ?? "?"}, battery ${phone.batteryTempC ?? "?"} °C, waited ${phone.waitedS} s${phone.cool ? "" : " (not cool)"}\n`);
  // A wait of minutes can leave Chrome behind: it is brought in front again before it is asked anything.
  if (phone.waitedS > 0) {
    front();
    await sleep(2000);
  }
  const about = await version(o.remote);
  if (!isAndroid(about.userAgent)) throw new Error(`--remote ${o.remote} is not a phone's Chrome (${about.userAgent})`);
  const local = (ws) => ws.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${o.remote}`);
  const browser = await connect(local(about.wsUrl));
  const root = o.base.replace(/\/+$/, "");
  const { targetId } = await browser("Target.createTarget", { url: "about:blank" });
  let target;
  for (let i = 0; !target; i++) {
    if (i > 50) throw new Error("the new tab never appeared in /json/list");
    target = (await (await fetch(`http://127.0.0.1:${o.remote}/json/list`)).json()).find((t) => t.id === targetId);
    if (!target) await sleep(200);
  }
  const page = await connect(local(target.webSocketDebuggerUrl));
  try {
    await page("Page.enable");
    await page("Runtime.enable");
    const origin = new URL(root).origin;
    // A first visit that could not be made one is no run: with --cold a clear that fails ends it.
    const cleared = page("Storage.clearDataForOrigin", { origin, storageTypes: o.cold ? "all" : ORIGIN_STORAGE });
    await (o.cold ? cleared : cleared.catch(() => undefined));
    if (o.cold) {
      await page("Network.enable");
      await page("Network.clearBrowserCache");
    }
    await browser("Target.activateTarget", { targetId }).catch(() => undefined);
    await intro(page, o, root, about, phone);
  } finally {
    await page("Page.navigate", { url: "about:blank" }).catch(() => undefined);
    page.close();
    await browser("Target.closeTarget", { targetId }).catch(() => undefined);
    browser.close();
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.phone) return phoneIntro(o);
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
    if (o.cold) {
      // A first visit: nothing of the site in the cache or its storage (the shaders the page kept, the pipelines' cache).
      await page("Network.enable");
      await page("Network.clearBrowserCache");
      await page("Storage.clearDataForOrigin", { origin: new URL(url).origin, storageTypes: "all" });
    }
    if (o.intro > 0) { await intro(page, o, root, about); return; }
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
      if (!o.walk) await keyDown(page, "ShiftLeft");
      await keyDown(page, "KeyW");
      process.stdout.write(`${o.label}: ${o.walk ? "walking" : "sprinting"} ${o.climb} s on the climb\n`);
      await sleep(o.climb * 1000);
      await mark(page, "chase-end");
      await keyUp(page, "KeyW");
      if (!o.walk) await keyUp(page, "ShiftLeft");
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
