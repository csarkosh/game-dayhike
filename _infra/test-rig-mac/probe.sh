#!/usr/bin/env bash
# The first rented day's probe, run on a Mac after setup.sh:
#
#   ssh <username>@<ip> 'bash -s' < probe.sh                 # GPU and display
#   ssh <username>@<ip> 'bash -s -- <url> 60' < probe.sh      # plus two 60 s frame-time runs
#
# It answers, for a few cents of the day: does Chrome get the M4's GPU when
# started over SSH, headless and in a window; is a display attached, at what
# size and refresh rate; and, given a URL, how far apart two identical runs of
# the same page land. Everything goes to standard output and to
# ~/test-rig/probe-<time>.log.
#
# Chrome is started in the logged-in window session with `launchctl asuser`,
# which runs a command in that user's GUI (Aqua) context from an SSH shell;
# a plain SSH command runs outside it, with no WindowServer connection.

set -euo pipefail
url=${1:-}
seconds=${2:-60}
RIG=$HOME/test-rig
# shellcheck source=/dev/null
source "$HOME/.zshenv" 2>/dev/null || true # the PATH setup.sh wrote
exec > >(tee "$RIG/probe-$(date -u +%Y%m%dT%H%M%SZ).log") 2>&1
uid=$(id -u)

echo "== Machine"
echo "macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)), $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores"
echo "Console user: $(stat -f %Su /dev/console) (window session exists only if this is $USER)"
echo
echo "== Displays (Apple's view)"
system_profiler SPDisplaysDataType | sed -n '/Chipset Model/,$p'
echo

cat >"$RIG/probe.mjs" <<'EOF'
// Starts Chrome with the given flags, reports the GPU it got, the screen it
// sees and its frame rate; with --url, also a run of frame intervals.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const url = opt('url');
const seconds = Number(opt('seconds') ?? 60);
const flags = process.argv.slice(2).filter((a) => !/^--(url|seconds)=/.test(a));
const port = 9333;
const dir = mkdtempSync(join(tmpdir(), 'probe-'));
// A file: page, not about:blank: WebGPU exists only in a secure context.
writeFileSync(join(dir, 'probe.html'), '<!doctype html><body style="margin:0;background:#000">');
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(dir, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', ...flags, pathToFileURL(join(dir, 'probe.html')).href], { stdio: 'ignore' });

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

// Frame intervals over a stretch of time, as percentiles in milliseconds.
const frames = (ms) => `new Promise((done) => {
  const t = []; let last = 0; const end = performance.now() + ${ms};
  const tick = (now) => { if (last) t.push(now - last); last = now;
    if (now < end) requestAnimationFrame(tick);
    else { t.sort((a, b) => a - b); const p = (q) => +t[Math.floor(q * (t.length - 1))].toFixed(2);
      done({ frames: t.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: p(1) }); } };
  requestAnimationFrame(tick);
})`;

try {
  const browser = await connect((await devtools('/json/version')).webSocketDebuggerUrl);
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
  const report = { flags, ...found, featureStatus: gpu.featureStatus };
  if (url) {
    await page('Page.enable');
    await page('Page.navigate', { url });
    await sleep(10_000); // load and settle before measuring
    report.run = { url, seconds, ...(await evaluate(page, frames(seconds * 1000))) };
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  proc.kill();
}
process.exit(0);
EOF

echo "== Chrome started from the SSH shell (outside the window session), headless"
node "$RIG/probe.mjs" --headless=new || true
echo
echo "== Chrome in the window session, headless"
launchctl asuser "$uid" "$(command -v node)" "$RIG/probe.mjs" --headless=new || true
echo
echo "== Chrome in the window session, in a window"
launchctl asuser "$uid" "$(command -v node)" "$RIG/probe.mjs" || true

if [[ -n "$url" ]]; then
  for run in 1 2; do
    echo
    echo "== Frame times, run $run: $url for ${seconds}s, in a window"
    launchctl asuser "$uid" "$(command -v node)" "$RIG/probe.mjs" "--url=$url" "--seconds=$seconds" || true
  done
fi
