// Opens the game page and prints its console errors/warnings and uncaught exceptions for N seconds.
import { randomUUID } from "node:crypto";
import { launchChrome } from "../frame-budget/lib/cdp.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const BASE = args.base ?? "http://localhost:5173/dayhike";
const CMD = args.cmd ?? "seed atmo;mode game;freecam 250 -500 1.09;weather clear;time 15";
const SECONDS = Number(args.seconds ?? 30);
const ENGINE = args.engine ?? "webgl2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connectEv(wsUrl) {
  const ws = new WebSocket(wsUrl); const waiting = new Map(); const handlers = new Map(); let id = 0;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id !== undefined) waiting.get(m.id)?.(m); else if (m.method) for (const fn of handlers.get(m.method) ?? []) fn(m.params); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, (m) => { waiting.delete(n); if (m.error) reject(new Error(method + ": " + m.error.message)); else resolve(m.result); }); ws.send(JSON.stringify({ id: n, method, params })); });
  send.on = (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); };
  return send;
}
const url = `${BASE}/game/${randomUUID()}?cmd=${encodeURIComponent(CMD).replace(/%3B/g, ";")}&tier=medium&telemetry=off&engine=${ENGINE}${args.extra ? "&" + args.extra : ""}`;
const chrome = await launchChrome({ flags: [] });
try {
  const { browserContextId } = await chrome.browser("Target.createBrowserContext");
  const { targetId } = await chrome.browser("Target.createTarget", { url: "about:blank", browserContextId, newWindow: true, width: 1300, height: 1135 });
  let target; for (let i = 0; !target && i < 50; i++) { const ts = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json(); target = ts.find((t) => t.id === targetId); if (!target) await sleep(200); }
  const page = await connectEv(target.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${chrome.port}`));
  await page("Page.enable"); await page("Runtime.enable"); await page("Log.enable");
  const seen = new Map();
  const note = (kind, text) => { const key = kind + text.slice(0, 300); seen.set(key, (seen.get(key) ?? 0) + 1); };
  page.on("Runtime.consoleAPICalled", (p) => { if (p.type === "error" || p.type === "warning") note(p.type, p.args.map((a) => a.value ?? a.description ?? "").join(" ")); });
  page.on("Runtime.exceptionThrown", (p) => note("exception", p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
  page.on("Log.entryAdded", (p) => { if (p.entry.level === "error") note("log", p.entry.text); });
  await page("Page.navigate", { url });
  await sleep(SECONDS * 1000);
  for (const [k, n] of seen) console.log(`[x${n}] ${k.slice(0, 1200)}\n`);
  if (seen.size === 0) console.log("no errors or warnings");
} finally { await chrome.close(); }
