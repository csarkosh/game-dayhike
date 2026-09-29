#!/usr/bin/env bash
#
# STATUS: INCOMPLETE. Never run against a real account. README.md's first
# section lists this script's known gaps and how to pick the work up.
#
# The first rented day's probe, run from this machine after setup.sh:
#
#   TEST_RIG_PASSWORD=... ./probe.sh --to <username>@<ip> [<url> [<seconds>]]
#
# It answers, for a few cents of the day: does Chrome get the M4's GPU, when
# started from the SSH shell and inside the logged-in desktop, headless and in
# a window; is a display attached, at what size and refresh rate; and, given a
# URL, how far apart two identical frame-time runs of that page land. Output
# goes to this terminal and to ~/test-rig/probe-<time>.log on the Mac. Each
# run that fails prints a FAIL line, and the probe exits non-zero if the
# windowed run inside the desktop, the one the measurements depend on, fails.
#
# Chrome is started inside the desktop with `sudo launchctl asuser <uid>
# sudo -u <user>`: switching into the logged-in user's GUI session needs
# root when it is asked from SSH. The password travels as in setup.sh: first
# line of the connection's stdin, then to sudo's askpass helper only.
#
# Written for the bash 3.2 macOS ships.

set -euo pipefail

# --- This machine ----------------------------------------------------------------
if [[ "${1:-}" == --to ]]; then
  target=${2:?usage: probe.sh --to <username>@<ip> [<url> [<seconds>]]}
  : "${TEST_RIG_PASSWORD:?set TEST_RIG_PASSWORD to the password of the Mac user}"
  # The URL and duration expand here, on purpose.
  # shellcheck disable=SC2029
  {
    printf '%s\n' "$TEST_RIG_PASSWORD"
    cat "$0"
  } | ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$target" \
    "IFS= read -r TEST_RIG_PASSWORD && export TEST_RIG_PASSWORD \
     TEST_RIG_URL='${3:-}' TEST_RIG_SECONDS='${4:-60}' \
     && mkdir -p ~/test-rig && cat >~/test-rig/probe.sh && bash ~/test-rig/probe.sh </dev/null"
  exit
fi

# --- The Mac ---------------------------------------------------------------------
: "${TEST_RIG_PASSWORD:?run this through probe.sh --to, which supplies the password}"
pw=$TEST_RIG_PASSWORD
unset TEST_RIG_PASSWORD
url=${TEST_RIG_URL:-}
seconds=${TEST_RIG_SECONDS:-60}
RIG=$HOME/test-rig
exec > >(tee "$RIG/probe-$(date -u +%Y%m%dT%H%M%SZ).log") 2>&1
uid=$(id -u)
node=$RIG/node-v22.13.1-darwin-arm64/bin/node # the version setup.sh installs
chrome_app='/Applications/Google Chrome.app'
[[ -x "$node" && -d "$chrome_app" ]] || {
  echo 'FAIL: Node or Chrome is missing; run setup.sh first.'
  exit 1
}

cat >"$RIG/askpass" <<'EOF'
#!/bin/sh
printf '%s\n' "$TEST_RIG_PASSWORD"
EOF
chmod 700 "$RIG/askpass"
as_root() { TEST_RIG_PASSWORD=$pw SUDO_ASKPASS=$RIG/askpass sudo -A "$@"; }
as_root -v
# Runs a command inside the logged-in user's desktop session (called through run).
# shellcheck disable=SC2329
in_desktop() { as_root launchctl asuser "$uid" sudo -u "$USER" -H "$@"; }

echo "== Machine"
echo "macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)), $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores"
echo "Chrome $(defaults read "$chrome_app/Contents/Info" CFBundleShortVersionString)"
console=$(stat -f %Su /dev/console)
echo "Console user: $console"
if [[ "$console" != "$USER" ]]; then
  echo "FAIL: no logged-in desktop for $USER; automatic login did not take effect."
fi
echo
echo "== Displays (Apple's view)"
system_profiler SPDisplaysDataType | sed -n '/Chipset Model/,$p'
echo "-- ioreg display entries:"
ioreg -l | grep -i -E '"(IODisplay[A-Za-z]*|EDID|DisplayAttributes)"' | cut -c1-200 | head -20 || echo '(none)'
echo

cat >"$RIG/probe.mjs" <<'EOF'
// Starts Chrome with the given flags and reports the GPU it got, the screen it
// sees, its frame rate and its version; with --url, also a run of frame
// intervals. Exits non-zero if Chrome could not be driven.
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
  const report = { chrome: version.Browser, flags, ...found, featureStatus: gpu.featureStatus };
  if (url) {
    await page('Page.enable');
    await page('Page.navigate', { url });
    await sleep(10_000); // load and settle before measuring
    report.run = { url, seconds, ...(await evaluate(page, frames(seconds * 1000))) };
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  failed = true;
} finally {
  proc.kill();
}
process.exit(failed ? 1 : 0);
EOF

# A window macOS may treat as hidden has its frames throttled by Chrome, which
# would read as "no display"; these flags rule that out.
windowed=(--disable-backgrounding-occluded-windows --disable-renderer-backgrounding)
status=0
run() { # label, command...
  local label=$1
  shift
  echo "== $label"
  if ! "$@"; then
    echo "FAIL: $label"
    return 1
  fi
  echo
}

run 'Chrome from the SSH shell, outside the desktop, headless' "$node" "$RIG/probe.mjs" --headless=new || true
run 'Chrome inside the desktop, headless' in_desktop "$node" "$RIG/probe.mjs" --headless=new || true
run 'Chrome inside the desktop, in a window' in_desktop "$node" "$RIG/probe.mjs" "${windowed[@]}" || status=1

if [[ -n "$url" ]]; then
  for n in 1 2; do
    run "Frame times, run $n: $url for ${seconds}s, in a window" \
      in_desktop "$node" "$RIG/probe.mjs" "${windowed[@]}" "--url=$url" "--seconds=$seconds" || status=1
  done
fi

if ((status)); then
  echo 'PROBE FAILED: Chrome could not be driven in a window inside the desktop; see the FAIL lines above.'
fi
exit "$status"
