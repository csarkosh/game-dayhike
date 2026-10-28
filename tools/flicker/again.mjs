// Watches the live page on WebGPU for a pipeline context prepared a second time (the integer
// vertex buffer re-preparation) and prints how the kept context's binding layout differs from
// the fresh processing's. Also prints console errors.
import { randomUUID } from "node:crypto";
import { launchChrome } from "../frame-budget/lib/cdp.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const BASE = args.base ?? "https://games.csarko.sh/dayhike";
const CMD = args.cmd ?? "mode explore";
const SECONDS = Number(args.seconds ?? 120);
const WALK = Number(args.walk ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connectEv(wsUrl) {
  const ws = new WebSocket(wsUrl); const waiting = new Map(); const handlers = new Map(); let id = 0;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id !== undefined) waiting.get(m.id)?.(m); else if (m.method) for (const fn of handlers.get(m.method) ?? []) fn(m.params); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, (m) => { waiting.delete(n); if (m.error) reject(new Error(method + ": " + m.error.message)); else resolve(m.result); }); ws.send(JSON.stringify({ id: n, method, params })); });
  send.on = (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); };
  return send;
}
const evaluate = async (page, expression) => { const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const url = `${BASE}/game/${randomUUID()}?cmd=${encodeURIComponent(CMD).replace(/%3B/g, ";")}&tier=medium&telemetry=off&engine=webgpu`;
const chrome = await launchChrome({ flags: ["--enable-webgpu-developer-features"] });
try {
  const { browserContextId } = await chrome.browser("Target.createBrowserContext");
  const { targetId } = await chrome.browser("Target.createTarget", { url: "about:blank", browserContextId, newWindow: true, width: 1300, height: 1135 });
  let target; for (let i = 0; !target && i < 50; i++) { const ts = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json(); target = ts.find((t) => t.id === targetId); if (!target) await sleep(200); }
  const page = await connectEv(target.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${chrome.port}`));
  await page("Page.enable"); await page("Runtime.enable"); await page("Page.bringToFront");
  page.on("Runtime.consoleAPICalled", (p) => { const t = p.args.map((a) => a.value ?? a.description ?? "").join(" "); if (p.type === "error" || p.type === "warning" || t.startsWith("AGAIN")) console.log(`[${p.type}] ${t.slice(0, 2500)}`); });
  page.on("Runtime.exceptionThrown", (p) => console.log("[exception]", (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 400)));
  await page("Page.navigate", { url });
  for (let i = 0; i < 90; i++) { await sleep(1000); if (await evaluate(page, "document.body.classList.contains('world-ready')").catch(() => false)) break; }
  const hooked = await evaluate(page, `(async () => {
    const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /[.]js([?]|$)/.test(n));
    let proto = null;
    for (const u of urls) { try { const m = await import(u); for (const v of Object.values(m)) { if (typeof v === "function" && v.prototype && typeof v.prototype.beginFrame === "function") { let p = v.prototype; while (p && !Object.prototype.hasOwnProperty.call(p, "beginFrame")) p = Object.getPrototypeOf(p); proto = p; break; } } } catch (e) {} if (proto) break; }
    if (!proto) return "no engine class";
    const saved = ["beginFrame", "endFrame"].map((k) => [k, proto[k]]);
    await Promise.race([new Promise((resolve) => { for (const [k, f] of saved) proto[k] = function (...a) { if (this.scenes && this.scenes.length > 0) { window.__engine = this; for (const [k2, f2] of saved) proto[k2] = f2; resolve(); } return f.apply(this, a); }; }), new Promise((r) => setTimeout(r, 8000))]);
    for (const [k, f] of saved) proto[k] = f;
    const e = window.__engine; if (!e) return "engine not caught";
    const names = (ctx) => !ctx || !ctx.bindGroupLayoutEntries ? "?" : ctx.bindGroupLayoutEntries.map((g, gi) => (g || []).map((en) => gi + ":" + en.binding + "=" + (ctx.bindGroupLayoutEntryInfo[gi][en.binding] || {}).name + (en.buffer ? "(buf)" : en.texture ? "(tex)" : en.sampler ? "(smp)" : "")).join(" ")).join(" | ");
    const made = [];
    const getCtx = e._getShaderProcessingContext.bind(e);
    e._getShaderProcessingContext = (lang, pure) => { const c = getCtx(lang, pure); if (c) made.push(c); if (made.length > 64) made.shift(); return c; };
    const prep = e._preparePipelineContextAsync.bind(e);
    e._preparePipelineContextAsync = (ctx, ...rest) => {
      if (ctx && ctx.stages !== undefined) {
        const fresh = made[made.length - 1];
        const a = names(ctx.shaderProcessingContext), b = names(fresh);
        console.log("AGAIN " + (ctx._name || "").slice(0, 60) + (a === b ? " layouts equal" : " LAYOUTS DIFFER\\n old " + a + "\\n new " + b));
        window.__againCount = (window.__againCount || 0) + 1;
      }
      return prep(ctx, ...rest);
    };
    return "hooked " + e.getClassName();
  })()`);
  console.log(hooked);
  // --switch <mode>: after a settle, change the mode as the menu does (the mode written into the
  // address, then a popstate that main.ts answers by starting the hike over on the kept engine).
  const walk = () => evaluate(page, `(() => { const canvas = document.querySelector("canvas"); Object.defineProperty(document, "pointerLockElement", { get: () => canvas, configurable: true }); document.dispatchEvent(new Event("pointerlockchange")); document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", bubbles: true })); return "walking"; })()`);
  if (args.switch) {
    if (WALK) console.log(await walk());
    await sleep(Number(args.settle ?? 15) * 1000);
    console.log("effects compiled before the switch:", await evaluate(page, "Object.keys(window.__engine._compiledEffects).length"), "skinned among them:", await evaluate(page, "Object.keys(window.__engine._compiledEffects).filter((k) => k.includes('BONETEXTURE')).length"));
    await evaluate(page, `(() => { const u = new URL(location.href); u.searchParams.set("cmd", "mode ${args.switch}"); history.replaceState({}, "", u.toString()); window.dispatchEvent(new PopStateEvent("popstate")); return location.href; })()`).then((h) => console.log("switched to", h));
    for (let i = 0; i < 90; i++) { await sleep(1000); if (await evaluate(page, "document.body.classList.contains('world-ready')").catch(() => false)) break; }
    console.log("second world ready");
  }
  // --force 1: after the switch, reprocess every stripped skinned effect as Babylon's integer
  // vertex buffer check would (a kept pipeline context, a fresh processing context).
  if (args.force) {
    await sleep(10000);
    console.log(await evaluate(page, `(() => {
      const e = window.__engine; const out = [];
      for (const [key, effect] of Object.entries(e._compiledEffects)) {
        if (!key.includes("BONETEXTURE") || !effect.isReady()) continue;
        const stripped = effect._processCodeAfterIncludes === undefined;
        const ctx = e._getShaderProcessingContext(effect.shaderLanguage, false);
        ctx.vertexBufferKindToNumberOfComponents = { matricesIndices: 4 };
        try { effect._processShaderCodeAsync(null, true, ctx); out.push("forced " + (stripped ? "STRIPPED " : "armed ") + key.slice(0, 50)); } catch (err) { out.push("threw " + err.message); }
      }
      return out.join(String.fromCharCode(10)) || "no skinned effect in the cache";
    })()`));
    await sleep(8000);
  }
  if (WALK) await evaluate(page, `(() => { const canvas = document.querySelector("canvas"); Object.defineProperty(document, "pointerLockElement", { get: () => canvas, configurable: true }); document.dispatchEvent(new Event("pointerlockchange")); document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", bubbles: true })); })()`);
  await sleep(SECONDS * 1000);
  console.log("again preparations seen:", await evaluate(page, "window.__againCount || 0"));
} finally { await chrome.close(); }
