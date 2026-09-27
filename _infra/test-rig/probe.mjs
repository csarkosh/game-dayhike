// The first run's probe on the Windows machine: starts Chrome with the flags
// given, and reports the GPU it got (WebGL renderer, WebGPU adapter, Chrome's
// own feature status), its version, whether nvidia-smi lists chrome.exe while
// it draws, and the driver's licence state. With --url and --seconds, it also
// records frame intervals on that page, minute by minute, to catch a frame
// rate that collapses part-way (NVIDIA's limits on an unlicensed driver start
// after about 20 minutes).
//
//   node probe.mjs [chrome flags] [--url=<page>] [--seconds=<n>]
//
// Exits non-zero, with a FAIL line, if Chrome could not be driven.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const url = opt('url');
const seconds = Number(opt('seconds') ?? 60);
const flags = process.argv.slice(2).filter((a) => !/^--(url|seconds)=/.test(a));
const port = 9333;
const dir = mkdtempSync(join(tmpdir(), 'probe-'));
// A file: page, not about:blank: WebGPU exists only in a secure context.
writeFileSync(join(dir, 'probe.html'), '<!doctype html><body style="margin:0;background:#000">');
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(dir, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', ...flags, pathToFileURL(join(dir, 'probe.html')).href], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function devtools(path) {
  for (let i = 0; i < 100; i++, await sleep(200)) {
    try { return await (await fetch(`http://127.0.0.1:${port}${path}`)).json(); } catch {}
  }
  throw new Error('Chrome never opened its DevTools port');
}
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl), waiting = new Map();
  let id = 0;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m.result ?? m.error); };
  await new Promise((r) => (ws.onopen = r));
  return (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
}
const evaluate = async (page, expression) =>
  (await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
// The lines of nvidia-smi's output that match, or why it could not run.
const smi = (args, match) => {
  const r = spawnSync('nvidia-smi', args, { encoding: 'utf8' });
  if (r.error) return [`nvidia-smi not runnable: ${r.error.message}`];
  return r.stdout.split('\n').filter((l) => match.test(l)).map((l) => l.trim());
};

// Frame-interval percentiles (ms) over `ms`, and the median of each minute.
const frames = (ms) => `new Promise((done) => {
  const t = [], minutes = []; let last = 0, minute = [];
  const start = performance.now(), end = start + ${ms};
  const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(q * (s.length - 1))].toFixed(2); };
  const tick = (now) => {
    if (last) { t.push(now - last); minute.push(now - last); }
    last = now;
    if (now - start >= (minutes.length + 1) * 60000) { minutes.push(pct(minute, 0.5)); minute = []; }
    if (now < end) requestAnimationFrame(tick);
    else done({ frames: t.length, p50: pct(t, 0.5), p95: pct(t, 0.95), p99: pct(t, 0.99), max: pct(t, 1), minuteP50: minutes });
  };
  requestAnimationFrame(tick);
})`;

let failed = false;
try {
  const version = await devtools('/json/version');
  const browser = await connect(version.webSocketDebuggerUrl);
  const page = await connect((await devtools('/json/list')).find((t) => t.type === 'page').webSocketDebuggerUrl);
  const { gpu } = await browser('SystemInfo.getInfo');
  const found = await evaluate(page, `(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const adapter = await navigator.gpu?.requestAdapter();
    return { webgl: gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'no WebGL2',
             webgpu: adapter ? { ...Object.fromEntries(['vendor', 'architecture', 'device', 'description']
               .map((k) => [k, adapter.info[k]])), fallback: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter } : 'no adapter',
             screen: { width: screen.width, height: screen.height, devicePixelRatio },
             refresh: await ${frames(2000)} };
  })()`);
  const report = { chrome: version.Browser, flags, ...found };
  if (url) {
    await page('Page.enable');
    await page('Page.navigate', { url });
    await sleep(10_000); // load and settle before measuring
    report.run = { url, seconds, ...(await evaluate(page, frames(seconds * 1000))) };
  }
  // Read while Chrome is still drawing: a GPU in use lists chrome.exe (C+G).
  report.nvidiaSmiChrome = smi([], /chrome\.exe/i);
  report.licence = smi(['-q'], /Licensed Product|Product Name|License Status/i);
  report.featureStatus = gpu.featureStatus;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  failed = true;
} finally {
  proc.kill();
}
process.exit(failed ? 1 : 0);
