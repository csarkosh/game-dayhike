#!/usr/bin/env node
// A film's start on a phone, with nothing of the game around it: a blank page, a film's file,
// played by a tap, and how far behind the tap its picture runs once it moves. It answers one
// question: what of a film's late start is the phone's, and what is the page's? Each variant adds
// one thing a page might do at the tap:
//   bare            the film alone, with its sound
//   muted           the film with its sound off
//   unmute-now      started with its sound off and the sound turned on in the same task;
//   unmute-playing  at its playing event; unmute-100, unmute-500: that many milliseconds later
//   move            the film's wrapper put under another element 50 ms after the tap
//   loop            a second film (--loop) playing muted beside it, paused and emptied at the tap
//   remove          the same, and its element taken out of the page 50 ms after the tap
//   busy            the page's thread held for 120 ms, 300 ms after the tap
//   gl              a WebGL2 context made 50 ms after the tap, and eight programs linked on it
// The film is fetched ahead (`preload="auto"`) and the tap comes once it can play through, so the
// connection is not what is timed. Each run prints, for the frames the compositor presented, how
// far behind the tap the first was and how far the picture ran behind at 0.5, 1, 2 and 3 s, the
// longest it stood between two frames after its start, the element's events and the page's long
// frames. On a Pixel 9 (Chrome 156, 2026-11-12) a film with sound ran 0.20 to 0.29 s behind and a
// muted one 0.01 to 0.04 s: the sound's output starting is the whole of it, and nothing in the
// other variants moved it. Turning the sound on after a silent start stands the picture 0.16 to
// 0.18 s, about 0.45 s after the sound is asked for.
//
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   node tools/frame-budget/film-start.mjs --film <the film's address> --out <file.json>
//       [--loop <a looping film's address>] [--variants bare,muted,…] [--runs 2] [--port 9222]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { connect, version } from "./lib/cdp.mjs";
import { phoneState } from "./lib/phone.mjs";

const rest = process.argv.slice(2);
const opt = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
const FILM = opt("--film", undefined);
const LOOP = opt("--loop", FILM);
const out = opt("--out", undefined);
if (FILM === undefined || out === undefined) throw new Error("--film <address> and --out <file.json> are needed");
const port = Number(opt("--port", "9222"));
const variants = opt("--variants", "bare,muted,unmute-now,move,loop,remove,busy,gl").split(",");
const runs = Number(opt("--runs", "2"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const args of [["shell", "input", "keyevent", "KEYCODE_WAKEUP"], ["shell", "svc", "power", "stayon", "true"], ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "about:blank", "com.android.chrome"]]) {
  try { execFileSync("adb", args, { stdio: "ignore" }); } catch {}
}
await sleep(2000);
const about = await version(port);
const local = (ws) => ws.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`);
const browser = await connect(local(about.wsUrl));

const SETUP = (variant) => `(async () => {
  document.body.style.cssText = "margin:0;background:#000";
  const wrap = document.createElement("div"), other = document.createElement("div");
  wrap.style.cssText = other.style.cssText = "position:fixed;inset:0";
  const v = document.createElement("video");
  v.setAttribute("playsinline", ""); v.setAttribute("preload", "auto");
  v.style.cssText = "width:100%;height:100%;object-fit:contain";
  v.src = ${JSON.stringify(FILM)};
  wrap.append(v); document.body.append(other, wrap);
  let loop = null;
  if (${JSON.stringify(variant)} === "loop" || ${JSON.stringify(variant)} === "remove") {
    loop = document.createElement("video");
    for (const a of ["muted", "playsinline", "loop"]) loop.setAttribute(a, "");
    loop.muted = true; loop.style.cssText = "position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1";
    loop.src = ${JSON.stringify(LOOP)};
    document.body.prepend(loop);
    await loop.play().catch(() => undefined);
  }
  if (${JSON.stringify(variant)}.startsWith("mute") || ${JSON.stringify(variant)}.startsWith("unmute")) v.muted = true;
  await new Promise((resolve) => { const ok = () => { if (v.readyState >= 4 || (v.buffered.length && v.buffered.end(0) > 8)) resolve(); else setTimeout(ok, 100); }; ok(); });
  window.__p = { v, wrap, other, loop, clock: [], shown: [], events: [], loaf: [], t0: 0 };
  for (const name of ["waiting", "stalled", "playing", "pause", "seeking", "canplay", "ratechange", "suspend"]) v.addEventListener(name, () => window.__p.events.push([performance.now(), name, v.currentTime, v.readyState]));
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__p.loaf.push([e.startTime, e.duration]); }).observe({ type: "long-animation-frame" }); } catch {}
  return { ready: v.readyState, buffered: v.buffered.length ? v.buffered.end(0) : 0 };
})()`;

const TAP = (variant) => `(() => {
  const p = window.__p, v = p.v;
  p.t0 = performance.now();
  if (p.loop && ${JSON.stringify(variant)} !== "bare") { p.loop.pause(); p.loop.removeAttribute("src"); p.loop.load(); }
  const played = v.play();
  // Started silent, the sound turned on after: in the same task, at the playing event, or later.
  const unmute = (why) => { v.muted = false; p.events.push([performance.now(), "unmuted-" + why, v.currentTime, v.readyState]); };
  if (${JSON.stringify(variant)} === "unmute-now") unmute("now");
  if (${JSON.stringify(variant)} === "unmute-playing") v.addEventListener("playing", () => unmute("playing"), { once: true });
  if (${JSON.stringify(variant)} === "unmute-100") setTimeout(() => unmute("100"), 100);
  if (${JSON.stringify(variant)} === "unmute-500") setTimeout(() => unmute("500"), 500);
  const onShown = (now, m) => { p.shown.push([now, m.mediaTime, m.presentedFrames, m.presentationTime]); v.requestVideoFrameCallback(onShown); };
  v.requestVideoFrameCallback(onShown);
  const tick = () => { const now = performance.now(); p.clock.push([now, v.currentTime, v.readyState]); if (now - p.t0 < 4000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  if (${JSON.stringify(variant)} === "move") setTimeout(() => { p.other.append(p.wrap); p.events.push([performance.now(), "moved", v.currentTime, v.readyState]); }, 50);
  if (${JSON.stringify(variant)} === "remove") setTimeout(() => { p.loop.remove(); p.events.push([performance.now(), "loop-removed", v.currentTime, v.readyState]); }, 50);
  if (${JSON.stringify(variant)} === "gl") setTimeout(() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 256; c.style.cssText = "position:fixed;left:0;top:0;width:8px;height:8px;opacity:0.01"; document.body.append(c);
    const gl = c.getContext("webgl2");
    p.events.push([performance.now(), gl ? "gl-context" : "gl-none", v.currentTime, v.readyState]);
    if (!gl) return;
    let n = 0;
    const one = () => {
      const vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(vs, "#version 300 es\\nin vec2 a; out vec2 uv; void main(){ uv = a; gl_Position = vec4(a, 0., 1.); }");
      let body = "";
      for (let i = 0; i < 60; i++) body += "c += texture(t" + (i % 8) + ", uv * " + (1.01 + i * 0.013 + n * 0.1).toFixed(3) + " + c.xy * 0.1) * " + (0.5 + i * 0.01).toFixed(3) + "; c = fract(c * 1.37 + sin(c.yzxw * " + (2 + i).toFixed(1) + "));\\n";
      gl.shaderSource(fs, "#version 300 es\\nprecision highp float; in vec2 uv; out vec4 o; uniform sampler2D t0,t1,t2,t3,t4,t5,t6,t7; void main(){ vec4 c = vec4(uv, 0.5, 1.);\\n" + body + " o = c; }");
      gl.compileShader(vs); gl.compileShader(fs);
      const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      const t = performance.now(); const ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
      p.events.push([performance.now(), "link" + (ok ? "" : "-failed") + ":" + Math.round(performance.now() - t) + "ms", v.currentTime, v.readyState]);
      if (++n < 8) requestAnimationFrame(one);
    };
    one();
  }, 50);
  if (${JSON.stringify(variant)} === "busy") setTimeout(() => { const t = performance.now(); while (performance.now() - t < 120); p.events.push([performance.now(), "busy-end", v.currentTime, v.readyState]); }, 300);
  return played.then(() => "playing", (e) => "refused: " + e);
})()`;

const results = [];
for (let run = 0; run < runs; run++) {
  for (const variant of variants) {
    const { targetId } = await browser("Target.createTarget", { url: "about:blank" });
    let target;
    for (let i = 0; !target && i < 50; i++) {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.id === targetId);
      if (!target) await sleep(200);
    }
    const page = await connect(local(target.webSocketDebuggerUrl));
    try {
      await page("Page.enable");
      await page("Runtime.enable");
      await browser("Target.activateTarget", { targetId }).catch(() => undefined);
      const setup = await page("Runtime.evaluate", { expression: SETUP(variant), awaitPromise: true, returnByValue: true });
      if (setup.exceptionDetails) throw new Error(setup.exceptionDetails.exception?.description ?? setup.exceptionDetails.text);
      await sleep(2500);
      const tap = await page("Runtime.evaluate", { expression: TAP(variant), awaitPromise: true, returnByValue: true, userGesture: true });
      if (tap.exceptionDetails) throw new Error(`the tap threw: ${tap.exceptionDetails.exception?.description ?? tap.exceptionDetails.text}`);
      await sleep(4500);
      const got = await page("Runtime.evaluate", { expression: `(() => { const p = window.__p; return { t0: p.t0, clock: p.clock, shown: p.shown, events: p.events, loaf: p.loaf, muted: p.v.muted }; })()`, returnByValue: true });
      const r = got.result.value;
      const behind = r.shown.map((s) => (s[3] - r.t0) / 1000 - s[1]);
      const at = (s) => { const row = r.shown.find((x) => (x[3] - r.t0) / 1000 >= s); return row ? ((row[3] - r.t0) / 1000 - row[1]) : null; };
      // The longest the picture stood between two presented frames, beyond a film frame's own 42 ms.
      let hold = 0, holdAt = 0;
      for (let i = 1; i < r.shown.length; i++) { const extra = (r.shown[i][3] - r.shown[i - 1][3]) / 1000 - (r.shown[i][1] - r.shown[i - 1][1]); if (extra > hold) { hold = extra; holdAt = (r.shown[i][3] - r.t0) / 1000; } }
      const fmt = (x) => (x === null || x === undefined ? "  -  " : x.toFixed(3));
      const state = phoneState();
      console.log(`${variant.padEnd(14)} run ${run + 1}: ${tap.result.value}; first frame ${fmt(behind[0])} s behind the tap; at 0.5 s ${fmt(at(0.5))}, 1 s ${fmt(at(1))}, 2 s ${fmt(at(2))}, 3 s ${fmt(at(3))}; worst hold after the start ${hold.toFixed(3)} s at ${holdAt.toFixed(2)} s; muted at the end ${r.muted}; events ${r.events.map((e) => `${e[1]}@${((e[0] - r.t0) / 1000).toFixed(2)}`).join(" ")}; long frames ${r.loaf.filter((l) => l[0] > r.t0).map((l) => `${Math.round(l[1])}ms@${((l[0] - r.t0) / 1000).toFixed(2)}`).join(" ") || "none"}; ${state.batteryTempC} °C`);
      results.push({ variant, run, setup: setup.result.value, tap: tap.result.value, phone: state, ...r });
    } finally {
      await page("Page.navigate", { url: "about:blank" }).catch(() => undefined);
      page.close();
      await browser("Target.closeTarget", { targetId }).catch(() => undefined);
    }
    await sleep(1500);
  }
}
browser.close();
writeFileSync(out, JSON.stringify({ browser: about.browser, film: FILM, results }));
console.log(`written to ${out}`);
