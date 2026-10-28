// Flicker capture: the real game page in a real Chrome, on the real clock, at the owner's display
// conditions (DPR 2, a 1300 by 1035 window), the camera turned at a constant slow rate by synthetic
// mouse-look or held still (`stillcam`), every compositor frame captured through DevTools'
// screencast as JPEG (`DAYHIKE_PNG=1` for PNG, which Chrome then sends only ~6 a second).
// Variants switch one thing each, in the page, and are captured in turn: compare variants within
// one run, since a fresh page spawns with another view and the explore day's sun keeps moving.
// See README.md beside this file, `docs/rendering/2026-10-27-shadow-cascade-flicker.md` and
// `docs/rendering/2026-10-28-temporal-anti-aliasing.md`.
//
//   node tools/flicker/capture.mjs --out <dir> [--base http://localhost:5173/dayhike]
//     [--engine webgl2|webgpu|auto] [--dpr 2] [--tier medium|auto] [--cmd "<?cmd= script>"]
//     [--variants stillcam,stillcam+sunfix] [--seconds 3] [--turn 1] [--walk 0] [--settle 25]
//     [--exact 1] [--extra "<more query>"]
//
// --exact 1 replaces the screencast with a read of the finished canvas every frame inside the page
// (WebGL2 only), summed per pixel as the second difference and sign alternations: no image codec
// between, so a flicker of a level or two is seen. Score it with score/exactmap.py.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launchChrome } from "../frame-budget/lib/cdp.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const OUT = args.out ?? "./out";
const ENGINE = args.engine ?? "webgl2";
const DPR = Number(args.dpr ?? 2);
const TIER = args.tier ?? "medium";
const VARIANTS = (args.variants ?? "base").split(",");
const SECONDS = Number(args.seconds ?? 3);
const TURN = Number(args.turn ?? 1); // movementX px per animation frame (0.0022 rad / px)
const WALK = Number(args.walk ?? 0); // 1: hold W
const SETTLE = Number(args.settle ?? 25);
const BASE = args.base ?? "http://localhost:5173/dayhike";
const SIZE = { width: Number(args.width ?? 1300), height: Number(args.height ?? 1035) };
const CMD = args.cmd ?? "seed atmo;mode game;freecam 250 -500 1.09";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A CDP session that also delivers events: `send(method, params)`, `on(method, fn)`. */
async function connectEv(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  const handlers = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
    else if (m.method) for (const fn of handlers.get(m.method) ?? []) fn(m.params);
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cannot connect " + wsUrl)); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, (m) => { waiting.delete(n); if (m.error) reject(new Error(method + ": " + m.error.message)); else resolve(m.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  send.on = (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); };
  send.off = (method) => handlers.delete(method);
  send.close = () => ws.close();
  return send;
}
const evaluate = async (page, expression) => {
  const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

mkdirSync(OUT, { recursive: true });
// "auto" leaves the game's own choice: no tier, no engine; an empty cmd leaves the start as a player sees it.
const url = `${BASE}/game/${randomUUID()}?telemetry=off${CMD ? "&cmd=" + encodeURIComponent(CMD).replace(/%3B/g, ";") : ""}${TIER === "auto" ? "" : "&tier=" + TIER}${ENGINE === "auto" ? "" : "&engine=" + ENGINE}${args.extra ? "&" + args.extra : ""}`;
console.log("url", url);
// Real pacing: vsync on, the frame cap on (no MEASURE_FLAGS).
const chrome = await launchChrome({ flags: ["--enable-webgpu-developer-features"] });
const log = [];
try {
  const { browserContextId } = await chrome.browser("Target.createBrowserContext");
  const { targetId } = await chrome.browser("Target.createTarget", { url: "about:blank", browserContextId, newWindow: true, width: SIZE.width, height: SIZE.height + 100 });
  let target;
  for (let i = 0; !target && i < 50; i++) { const ts = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json(); target = ts.find((t) => t.id === targetId); if (!target) await sleep(200); }
  const page = await connectEv(target.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${chrome.port}`));
  await page("Page.enable"); await page("Runtime.enable"); await page("Page.bringToFront");
  await page("Emulation.setDeviceMetricsOverride", { ...SIZE, deviceScaleFactor: DPR, mobile: false });
  // Production has no module URL to import, so the engine is caught as it binds its render loop.
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const b = Function.prototype.bind; Function.prototype.bind = function (t, ...a) { if (this.name === "_renderLoop" && t) window.__engine = t; return b.call(this, t, ...a); }; })()` });
  await page("Page.navigate", { url });
  for (let i = 0; i < 90; i++) { await sleep(2000); if (await evaluate(page, "document.body.classList.contains('world-ready')").catch(() => false)) break; }
  console.log("world ready; settling", SETTLE, "s");
  // The engine, caught from the first frame drawn after the hook.
  const hooked = await evaluate(page, `(async () => {
    if (window.__engine) return "engine (bind hook) " + window.__engine.getClassName();
    // Any loaded script (a dev module or a production chunk) that exports a class with beginFrame: the engine's prototype.
    const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /[.]js([?]|$)/.test(n));
    let proto = null;
    for (const u of urls) { try { const m = await import(u); for (const v of Object.values(m)) { if (typeof v === "function" && v.prototype && typeof v.prototype.beginFrame === "function") { let p = v.prototype; while (p && !Object.prototype.hasOwnProperty.call(p, "beginFrame")) p = Object.getPrototypeOf(p); proto = p; break; } } } catch (e) {} if (proto) break; }
    if (!proto) return "no engine class among " + urls.length + " scripts";
    const saved = ["beginFrame", "endFrame"].map((k) => [k, proto[k]]);
    await Promise.race([new Promise((resolve) => { for (const [k, f] of saved) proto[k] = function (...a) { if (this.scenes && this.scenes.length > 0) { window.__engine = this; for (const [k2, f2] of saved) proto[k2] = f2; resolve(); } return f.apply(this, a); }; }), new Promise((r) => setTimeout(r, 8000))]);
    for (const [k, f] of saved) proto[k] = f;
    return "engine " + (window.__engine ? window.__engine.getClassName() : "NOT CAUGHT");
  })()`);
  console.log(hooked);
  await sleep(SETTLE * 1000);
  const setup = await evaluate(page, `(() => {
    const e = window.__engine, scene = e.scenes[0];
    const canvas = document.querySelector("canvas");
    Object.defineProperty(document, "pointerLockElement", { get: () => canvas, configurable: true });
    document.dispatchEvent(new Event("pointerlockchange"));
    window.__turn = (dx, dy = 0) => canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: dx, movementY: dy }));
    window.__key = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code.replace("Key", "").toLowerCase(), bubbles: true }));
    const sun = scene.lights.find((l) => l.getClassName() === "DirectionalLight");
    const gen = sun && sun.getShadowGenerator();
    const undo = [];
    const set = (o, k, v) => { const old = o[k]; o[k] = v; undo.push(() => { o[k] = old; }); };
    window.__frames = 0;
    scene.onAfterRenderObservable.add(() => { window.__frames++; });
    scene.onBeforeRenderObservable.add(() => {
      if (window.__every && gen) gen.getShadowMap().refreshRate = 1;
      if (window.__sunfix && sun) sun.direction.copyFrom(window.__sunfix);
      if (window.__forceScale !== undefined && e.getHardwareScalingLevel() !== window.__forceScale) { e.setHardwareScalingLevel(window.__forceScale); }
    });
    window.__variant = (v) => {
      while (undo.length) undo.pop()();
      for (const part of v.split("+")) {
        if (part === "every") set(window, "__every", true);
        if (part === "noshadow" && sun) set(sun, "shadowEnabled", false);
        if (part === "fullscale") { const was = e.getHardwareScalingLevel(); set(window, "__forceScale", 1); undo.push(() => e.setHardwareScalingLevel(was)); }
        if (part.startsWith("scale")) { const was = e.getHardwareScalingLevel(); set(window, "__forceScale", 1 / Number(part.slice(5))); undo.push(() => e.setHardwareScalingLevel(was)); }
        if (part === "nopost") { const cam = scene.activeCamera; const pps = cam._postProcesses.filter(Boolean); for (const pp of pps) { cam.detachPostProcess(pp); } undo.push(() => { for (const pp of pps) cam.attachPostProcess(pp); }); }
        if (part === "notaa") { const cam = scene.activeCamera; const pps = cam._postProcesses.filter((p) => p && (p.name === "taa" || p.name === "taaSharpen")); for (const pp of pps) cam.detachPostProcess(pp); undo.push(() => { for (const pp of pps) cam.attachPostProcess(pp); }); }
        if (part === "stillcam") set(window, "__still", true);
        // TAA probes (2026-10-28): nosharpen, clipN (TAA_CLIP = N/100), taablendN (TAA_BLEND = N/100), nojitter (projection recomputed after the jitter).
        if (part === "nosharpen" || part.startsWith("clip") || part.startsWith("taablend")) {
          const cam = scene.activeCamera; const find = (n) => cam._postProcesses.find((q) => q && q.name === n);
          const pp = part === "nosharpen" ? find("taaSharpen") : find("taa");
          if (pp) { const o = pp.onApplyObservable.add((fx) => { if (part === "nosharpen") fx.setFloat("sharpen", 0); else { const n = Number(part.replace(/^clip|^taablend/, "")) / 100; fx.setFloat3("taaParams", part.startsWith("clip") ? 0.1 : n, part.startsWith("clip") ? n : 1.25, 1); } }); undo.push(() => pp.onApplyObservable.remove(o)); }
        }
        if (part.startsWith("jitter")) { const cam = scene.activeCamera; const k = Number(part.slice(6)) / 100; const o = scene.onBeforeRenderObservable.add(() => { const pm = cam.getProjectionMatrix(); pm.setRowFromFloats(2, pm.m[8] * k, pm.m[9] * k, pm.m[10], pm.m[11]); }); undo.push(() => scene.onBeforeRenderObservable.remove(o)); }
        if (part === "nojitter") { const cam = scene.activeCamera; const o = scene.onBeforeRenderObservable.add(() => { cam.getProjectionMatrix(true); }); undo.push(() => scene.onBeforeRenderObservable.remove(o)); }
        // walked: a step forward and back to standing before the capture (held 2.5 s of the 3 s before it).
        if (part === "walked") { window.__key("KeyW", true); setTimeout(() => window.__key("KeyW", false), 2500); }
        if (part === "sunfix" && sun) set(window, "__sunfix", sun.direction.clone());
        if (part === "pcfhigh" && gen) set(gen, "filteringQuality", 0);
        if (part === "pcfmed" && gen) set(gen, "filteringQuality", 1);
        if (part.startsWith("map") && gen) { const was = gen.mapSize; gen.mapSize = Number(part.slice(3)); gen.getShadowMap().refreshRate = 2; undo.push(() => { gen.mapSize = was; gen.getShadowMap().refreshRate = 2; }); }
        if (part === "nobark") { for (const m of scene.materials) { const p = m.pluginManager && m.pluginManager.getPlugin("BarkShade"); if (p) { const was = p.prepareDefines; p.prepareDefines = (d) => { d.BARK_SHADE = false; }; m.markAsDirty(1 | 16 | 64); undo.push(() => { p.prepareDefines = was; m.markAsDirty(1 | 16 | 64); }); } } }
        if (part.startsWith("blend") && gen) set(gen, "cascadeBlendPercentage", Number(part.slice(5)) / 100);
        if (part.startsWith("lambda") && gen) set(gen, "lambda", Number(part.slice(6)) / 100);
      }
      return { eng: e.getClassName(), pps: (scene.activeCamera._postProcesses || []).filter(Boolean).map((p) => p.name).join(","), map: gen ? gen.mapSize : null, pcf: gen ? gen.filteringQuality : null, scaling: e.getHardwareScalingLevel(), size: [e.getRenderWidth(), e.getRenderHeight()], refresh: gen ? gen.getShadowMap().refreshRate : null, dpr: window.devicePixelRatio, shadow: sun ? sun.shadowEnabled : null, sunI: sun ? +sun.intensity.toFixed(3) : null, sunDir: sun ? [sun.direction.x, sun.direction.y, sun.direction.z].map((v) => +v.toFixed(2)) : null, dark: gen ? +gen.darkness.toFixed(2) : null, fps: +e.getFps().toFixed(0) };
    };
    return window.__variant("base");
  })()`);
  console.log("setup", JSON.stringify(setup));

  for (const [vi, variant] of VARIANTS.entries()) {
    const dir = join(OUT, `${vi}_${variant}`);
    mkdirSync(dir, { recursive: true });
    const info = await evaluate(page, `window.__variant(${JSON.stringify(variant)})`);
    await sleep(1500);
    // A short turn before the capture so the scale and shadows settle to the turning state.
    await evaluate(page, `(() => { window.__turning = true; const step = () => { if (!window.__turning) return; if (!window.__still) window.__turn(${TURN}); requestAnimationFrame(step); }; requestAnimationFrame(step); ${WALK ? 'window.__key("KeyW", true);' : ""} })()`);
    await sleep(1500);
    const f0 = await evaluate(page, "window.__frames");
    const t0 = Date.now();
    const frames = [];
    page.on("Page.screencastFrame", (p) => {
      frames.push({ ts: p.metadata.timestamp, data: p.data });
      page("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
    });
    const EXACT = !!args.exact;
    if (EXACT) await evaluate(page, `(() => {
      // Exact frames (2026-10-28): read the finished canvas each frame inside the page (WebGL2) and
      // accumulate, per pixel, the second difference |L(t) - (L(t-1) + L(t+1)) / 2| and the count of
      // sign alternations above 2 levels, with no image codec in between.
      const e = window.__engine, gl = e._gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, n = w * h;
      const buf = new Uint8Array(n * 4); let a = null, b = null; const hf = new Float32Array(n), alt = new Uint16Array(n);
      const st = window.__exact = { w, h, frames: 0, hf, alt, first: null };
      st.obs = e.onEndFrameObservable.add(() => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const L = new Float32Array(n);
        for (let i = 0; i < n; i++) L[i] = 0.299 * buf[i * 4] + 0.587 * buf[i * 4 + 1] + 0.114 * buf[i * 4 + 2];
        if (!st.first) st.first = buf.slice();
        if (a && b) for (let i = 0; i < n; i++) { const d1 = b[i] - a[i], d2 = L[i] - b[i]; hf[i] += Math.abs(b[i] - (a[i] + L[i]) / 2); if (d1 * d2 < 0 && Math.abs(d1) > 2 && Math.abs(d2) > 2) alt[i]++; }
        a = b; b = L; st.frames++;
      });
    })()`);
    if (!EXACT) await page("Page.startScreencast", { format: process.env.DAYHIKE_PNG ? "png" : "jpeg", quality: 92, maxWidth: 4000, maxHeight: 4000, everyNthFrame: 1 });
    await sleep(SECONDS * 1000);
    if (!EXACT) { await page("Page.stopScreencast"); page.off("Page.screencastFrame"); }
    if (EXACT) {
      const r = await evaluate(page, `(() => { const st = window.__exact; window.__engine.onEndFrameObservable.remove(st.obs);
        const b64 = (u) => { let s = ""; const c = 0x8000; for (let i = 0; i < u.length; i += c) s += String.fromCharCode.apply(null, u.subarray(i, i + c)); return btoa(s); };
        return { w: st.w, h: st.h, frames: st.frames, hf: b64(new Uint8Array(st.hf.buffer)), alt: b64(new Uint8Array(st.alt.buffer)), first: b64(st.first) }; })()`);
      writeFileSync(join(dir, "exact.json"), JSON.stringify({ w: r.w, h: r.h, frames: r.frames }));
      writeFileSync(join(dir, "hf.f32"), Buffer.from(r.hf, "base64"));
      writeFileSync(join(dir, "alt.u16"), Buffer.from(r.alt, "base64"));
      writeFileSync(join(dir, "first.rgba"), Buffer.from(r.first, "base64"));
      frames.push({ ts: 0, data: "" }); frames.length = r.frames;
    }
    const f1 = await evaluate(page, "window.__frames");
    const dt = (Date.now() - t0) / 1000;
    await evaluate(page, `(() => { window.__turning = false; ${WALK ? 'window.__key("KeyW", false);' : ""} })()`);
    const after = await evaluate(page, `({ scaling: window.__engine.getHardwareScalingLevel(), size: [window.__engine.getRenderWidth(), window.__engine.getRenderHeight()], gpu: typeof window.__gpuTime === "function" ? window.__gpuTime() : null })`);
    if (!EXACT) frames.forEach((f, i) => writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.${process.env.DAYHIKE_PNG ? "png" : "jpg"}`), Buffer.from(f.data, "base64")));
    const row = { variant, dir: `${vi}_${variant}`, ...info, after, captured: frames.length, gameFrames: f1 - f0, seconds: +dt.toFixed(2), gameFps: +((f1 - f0) / dt).toFixed(1), captureFps: +(frames.length / dt).toFixed(1), firstTs: frames[0]?.ts, lastTs: frames.at(-1)?.ts };
    log.push(row);
    console.log(JSON.stringify(row));
    writeFileSync(join(OUT, "log.json"), JSON.stringify(log, null, 2));
    await sleep(1000);
  }
} finally {
  await chrome.close();
}
