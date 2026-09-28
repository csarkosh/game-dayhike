// The first run's probe on the rented Windows machine. Run it from an SSH
// shell (a local administrator, in the non-interactive services session):
//
//   node probe.mjs [--user=hiker] [--url=<page> [--seconds=60] [--runs=1]] [chrome flags]
//
// It answers whether Chrome, drawing on the desktop user's console session
// with nobody connected, gets the NVIDIA GPU. It starts itself again inside
// that session (a scheduled task with the interactive logon type: Task
// Scheduler runs such a task "only in an existing interactive session"),
// where it launches Chrome with a fresh profile and reads what Chrome got.
// Meanwhile, from here, it reads nvidia-smi's process list, which only an
// administrator sees whole. With --url it also loads that page --runs times,
// each in a fresh Chrome, and records frame intervals for --seconds, with the
// median of every minute.
//
// It refuses to start while the machine's set-up has not been verified
// (C:\ProgramData\test-rig\verified; it prints the set-up log's last failure)
// and while anyone is connected over Remote Desktop: the question is what
// Chrome gets with NOBODY connected.
//
// Prints one JSON report, any warnings, and then a last line, PASS or FAIL
// with the reasons; exits 0 only on PASS. A PASS needs all of:
//   - the WebGL renderer names NVIDIA and this machine's GPU (not SwiftShader,
//     not Microsoft's basic render driver);
//   - Chrome's own GPU feature status says hardware for what the game uses:
//     WebGL (Babylon's WebGL engine), GPU compositing and rasterization;
//   - the WebGPU adapter, if there is one, is not a fallback adapter (the game
//     does not use WebGPU, so no adapter, or another vendor's, is a warning);
//   - nvidia-smi listed chrome.exe while Chrome was drawing;
//   - the driver's licensed product is exactly "NVIDIA RTX Virtual
//     Workstation" and its licence status is Licensed: Google documents any
//     other output, "NVIDIA Virtual Applications ... Licensed" among them, as
//     no GPU acceleration;
//   - Chrome ran in the console session, not the services session;
//   - no Remote Desktop session was active at any point of the run;
//   - the desktop user could not reach the metadata server, from Node or from
//     Chrome's own network process;
//   - with --url, every run's page loaded (no navigation error, the document
//     complete at the address asked for) and drew frames.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SETUP = 'C:\\ProgramData\\test-rig';
const METADATA = 'http://169.254.169.254/computeMetadata/v1/';
// Chrome's feature status names (chrome://gpu, SystemInfo.getInfo) for what
// the game draws with. Chrome reports WebGL 1 and 2 as one entry, `webgl`.
const FEATURES = ['webgl', 'gpu_compositing', 'rasterization'];
// Task Scheduler: a task name is a file name under System32\Tasks, so no
// \ / : * ? " < > |; tests/startup.test.mjs checks it.
export const TASK = 'test-rig-probe';

const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const own = /^--(user|url|seconds|runs|inner)=/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (file, args) => spawnSync(file, args, { encoding: 'utf8', windowsHide: true });
const ps = (command) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- the licence
// From `nvidia-smi -q`: the product under "vGPU Software Licensed Product"
// (the GPU's own "Product Name" line comes earlier and is not it).
export function licenceState(text) {
  const state = { driver: '', product: '', status: '', ok: false };
  let inLicensed = false;
  for (const line of text.split(/\r?\n/)) {
    const value = line.split(':').slice(1).join(':').trim();
    if (/^\s*Driver Version\s*:/.test(line)) state.driver = value;
    if (/vGPU Software Licensed Product/.test(line)) { inLicensed = true; continue; }
    if (inLicensed && /^\s*Product Name\s*:/.test(line)) state.product = value;
    if (inLicensed && /^\s*License Status\s*:/.test(line)) { state.status = value; inLicensed = false; }
  }
  state.ok = state.product === 'NVIDIA RTX Virtual Workstation' && /^Licensed/.test(state.status);
  return state;
}

// ------------------------------------------------------------- nvidia-smi
// Where the driver installs nvidia-smi.exe, in the order the start-up script
// looks: System32, NVIDIA's NVSMI directory, the driver store's directory for
// an NVIDIA driver; then whatever PATH finds. Found here rather than through
// PATH alone, which a driver that installs it only in the driver store leaves
// without it: every reading would then be empty and fail a healthy machine.
export function findSmi({ exists, list }, env = process.env) {
  const store = `${env.WINDIR}\\System32\\DriverStore\\FileRepository`;
  const candidates = [
    `${env.WINDIR}\\System32\\nvidia-smi.exe`,
    `${env.ProgramFiles}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
    ...list(store).filter((d) => /^nv/i.test(d)).map((d) => `${store}\\${d}\\nvidia-smi.exe`),
  ];
  return candidates.find((p) => exists(p)) ?? 'nvidia-smi';
}

const DISPLAY = { width: 1920, height: 1080 };

// ------------------------------------------------------ Remote Desktop sessions
// The sessions `qwinsta` lists, and of them the Remote Desktop ones that are
// active (someone connected). A listener (`rdp-tcp`, state Listen) and a
// disconnected session draw nothing and do not count.
export function sessions(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^[ >]?(\S+)\s+(?:(\S+)\s+)?(\d+)\s+([A-Za-z]+)\b/.exec(line);
    if (m && m[1] !== 'SESSIONNAME') out.push({ name: m[1], user: m[2] ?? '', id: Number(m[3]), state: m[4] });
  }
  return out;
}

export function activeRemoteSessions(text) {
  return sessions(text).filter((s) => /^rdp-tcp#/i.test(s.name) && /^Active$/i.test(s.state));
}

// ------------------------------------------------------------- the verdict
export function verdict(report) {
  const reasons = [];
  const renderer = report.webgl ?? '';
  const model = (report.nvidia.gpuName.split(/\s+/).pop() || '?').toUpperCase();
  if (!/NVIDIA/i.test(renderer) || !renderer.toUpperCase().includes(model) || /SwiftShader|Basic Render|Microsoft/i.test(renderer)) {
    reasons.push(`the WebGL renderer is "${renderer}", not the NVIDIA ${model}`);
  }
  if (report.nvidia.chromeSamples === 0) reasons.push('nvidia-smi never listed chrome.exe while Chrome drew');
  if (!report.nvidia.licence.ok) {
    reasons.push(`the driver's licensed product is "${report.nvidia.licence.product}", status "${report.nvidia.licence.status}", not a licensed NVIDIA RTX Virtual Workstation`);
  }
  for (const feature of FEATURES) {
    const status = report.featureStatus?.[feature];
    if (!/^enabled/.test(status ?? '')) reasons.push(`Chrome's ${feature} is "${status}", not hardware-accelerated`);
  }
  if (report.webgpu?.fallback === true) reasons.push('the WebGPU adapter is a fallback (software) adapter');
  for (const [when, count] of Object.entries(report.remoteSessions ?? { unknown: null })) {
    if (count !== 0) reasons.push(`${count ?? 'an unknown number of'} Remote Desktop session(s) active ${when}; disconnect every client and run again`);
  }
  if (report.metadataReachable !== false) reasons.push('the desktop user reached the metadata server');
  if (report.browserMetadata?.reachable !== false) reasons.push(`Chrome reached the metadata server (${report.browserMetadata?.detail ?? 'not checked'})`);
  if (!/^console$/i.test(report.session?.name ?? '') || report.session?.id === 0) {
    reasons.push(`Chrome ran in session "${report.session?.name}" (${report.session?.id}), not the console session`);
  }
  for (const [i, r] of (report.runs ?? []).entries()) {
    if (!r.loaded) reasons.push(`run ${i + 1}: the page did not load (${r.error})`);
    else if (!(r.frames > 0)) reasons.push(`run ${i + 1}: the page drew no frames`);
  }
  return reasons;
}

// What is worth knowing but does not decide the question.
export function warnings(report) {
  const out = [];
  const webgpu = report.webgpu;
  if (webgpu === 'no adapter' || !webgpu) out.push('no WebGPU adapter (the game does not use WebGPU)');
  else if (!/nvidia/i.test(webgpu.vendor ?? '')) out.push(`the WebGPU adapter's vendor is "${webgpu.vendor}", not nvidia`);
  if (report.display?.cappedAt60OrLower) out.push(`requestAnimationFrame runs at ${report.refreshHz} Hz: frame times below ${(1000 / report.refreshHz).toFixed(1)} ms cannot be seen`);
  if (report.screen && (report.screen.width !== DISPLAY.width || report.screen.height !== DISPLAY.height)) {
    out.push(`Chrome's screen is ${report.screen.width} x ${report.screen.height}, not the ${DISPLAY.width} x ${DISPLAY.height} the start-up script sets`);
  }
  if ((report.display?.adapters ?? []).length > 1) out.push(`Windows lists ${report.display.adapters.length} display adapters: ${report.display.adapters.join('; ')}`);
  return out;
}

// The last "FAILED:" line of the set-up log, if any.
export function lastFailure(log) {
  return log.split(/\r?\n/).filter((l) => l.includes('FAILED:')).pop() ?? null;
}

// ------------------------------------------------ inside the console session
async function inner(dir) {
  const args = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
  const result = { session: sessionOf(process.pid), metadataReachable: await metadataReachable(), runs: [] };
  let n = 0;
  const blank = pathToFileURL(join(dir, 'probe.html')).href;
  const probe = await withChrome(join(dir, `profile-${n++}`), args.flags, blank, async (browser, page, version) => {
    for (let i = 0; (await evaluate(page, 'location.href')) !== blank; i++) {
      if (i > 50) throw new Error(`Chrome never opened ${blank}`);
      await sleep(200);
    }
    const { gpu } = await browser('SystemInfo.getInfo');
    const found = await evaluate(page, `(async () => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      const adapter = await navigator.gpu?.requestAdapter();
      const info = adapter ? (adapter.info ?? {}) : null;
      return { webgl: gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'no WebGL2',
               webgpu: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device,
                 description: info.description, fallback: info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null } : 'no adapter',
               screen: { width: screen.width, height: screen.height, devicePixelRatio, visibility: document.visibilityState },
               blank: await ${frames(3000)} };
    })()`);
    const refreshHz = found.blank?.p50 ? +(1000 / found.blank.p50).toFixed(1) : null;
    // The metadata server, from Chrome's own network process: a top-level
    // navigation, which no page policy (CORS, private network access) stops,
    // so only the host firewall can. Any answer, even the error page for the
    // missing Metadata-Flavor header, means it was reached.
    const browserMetadata = await Promise.race([
      page('Page.navigate', { url: METADATA })
        .then((nav) => ({ reachable: !nav.errorText, detail: nav.errorText || 'answered' })),
      sleep(45_000).then(() => ({ reachable: false, detail: 'no answer in 45 s' })),
    ]);
    return { chrome: version, flags: args.flags, ...found, refreshHz, featureStatus: gpu.featureStatus, devices: gpu.devices, browserMetadata };
  });
  Object.assign(result, probe);
  for (let i = 0; i < args.runs && args.url; i++) {
    result.runs.push(await withChrome(join(dir, `profile-${n++}`), args.flags, 'about:blank', async (browser, page) => {
      await page('Page.enable');
      const loaded = new Promise((resolve) => page.on('Page.loadEventFired', resolve));
      const nav = await page('Page.navigate', { url: args.url });
      if (nav.errorText) return { url: args.url, loaded: false, error: nav.errorText };
      const timedOut = await Promise.race([loaded.then(() => false), sleep(60_000).then(() => true)]);
      const doc = await evaluate(page, '({ href: location.href, ready: document.readyState, title: document.title, visibility: document.visibilityState })');
      const expected = new URL(args.url);
      if (timedOut || doc.ready !== 'complete' || new URL(doc.href).origin !== expected.origin) {
        return { url: args.url, loaded: false, error: `load event ${timedOut ? 'never fired' : 'fired'}; at ${doc.href}, ${doc.ready}` };
      }
      await sleep(10_000); // settle after load
      return { url: args.url, loaded: true, document: doc, seconds: args.seconds, ...(await evaluate(page, frames(args.seconds * 1000))) };
    }).catch((e) => ({ url: args.url, loaded: false, error: e.message })));
  }
  writeFileSync(join(dir, 'result.tmp'), JSON.stringify(result));
  renameSync(join(dir, 'result.tmp'), join(dir, 'result.json'));
}

// Whether this user can open a connection to the metadata server: any answer
// at all, even an error status, means it can.
async function metadataReachable() {
  try {
    await fetch(METADATA, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

// This process's Windows session, from tasklist.
function sessionOf(pid) {
  const line = (run('tasklist.exe', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh']).stdout ?? '').trim();
  const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return { name: cells[2] ?? '', id: Number(cells[3] ?? NaN) };
}

// Starts a Chrome of our own on a fresh profile, finds its DevTools endpoint
// through the DevToolsActivePort file it writes into that profile (so it can
// never attach to another Chrome), runs `body`, then closes it.
async function withChrome(profile, flags, url, body) {
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--start-maximized', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', ...flags, url], { stdio: 'ignore' });
  let browser;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; !existsSync(portFile); i++) {
      if (i > 150) throw new Error('Chrome never wrote DevToolsActivePort');
      await sleep(200);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split(/\r?\n/);
    browser = await connect(`ws://127.0.0.1:${port}${path}`);
    const { product } = await browser('Browser.getVersion');
    let target;
    for (let i = 0; !target; i++) {
      if (i > 50) throw new Error('Chrome opened no page');
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
      if (!target) await sleep(200);
    }
    const page = await connect(target.webSocketDebuggerUrl);
    return await body(browser, page, product);
  } finally {
    await browser?.('Browser.close').catch(() => undefined);
    await sleep(1000);
    if (proc.exitCode === null) proc.kill();
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  const listeners = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
    else listeners.get(m.method)?.forEach((f) => f(m.params));
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`)); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 3 * 3600_000);
    waiting.set(n, (m) => { clearTimeout(timer); waiting.delete(n); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  call.on = (method, f) => listeners.set(method, [...(listeners.get(method) ?? []), f]);
  return call;
}

async function evaluate(page, expression) {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}

// Frame intervals over `ms` (percentiles, in ms) and the median of each minute.
function frames(ms) {
  return `new Promise((done) => {
    const t = [], minutes = []; let last = 0, minute = [];
    const start = performance.now(), end = start + ${ms};
    const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(q * (s.length - 1))].toFixed(2); };
    const tick = (now) => {
      if (last) { t.push(now - last); minute.push(now - last); }
      last = now;
      if (now - start >= (minutes.length + 1) * 60000) { minutes.push(pct(minute, 0.5)); minute = []; }
      if (now < end) requestAnimationFrame(tick);
      else done({ frames: t.length, p50: pct(t, 0.5), p95: pct(t, 0.95), p99: pct(t, 0.99), max: pct(t, 1), minuteP50: minutes });
    };
    requestAnimationFrame(tick);
  })`;
}

// ------------------------------------------- outside, in the services session
async function outer() {
  const user = opt('user') ?? 'hiker';
  const url = opt('url');
  const seconds = Number(opt('seconds') ?? 60);
  const runs = url ? Number(opt('runs') ?? 1) : 0;
  const flags = process.argv.slice(2).filter((a) => !own.test(a));
  const smiPath = findSmi({ exists: existsSync, list: (dir) => { try { return readdirSync(dir); } catch { return []; } } });
  console.log(`nvidia-smi: ${smiPath}`);
  const smi = (args) => ({ stdout: run(smiPath, args).stdout ?? '' });

  if (!existsSync(join(SETUP, 'verified'))) {
    const log = existsSync(join(SETUP, 'setup.log')) ? readFileSync(join(SETUP, 'setup.log'), 'utf8') : '';
    throw new Error(`the machine's set-up is not verified (no ${join(SETUP, 'verified')}); ${lastFailure(log) ?? 'the set-up log has no failure yet: it may still be running'}. Read ${join(SETUP, 'setup.log')}`);
  }
  // Active Remote Desktop sessions, or null if qwinsta cannot be read (an
  // unknown count is not "nobody connected").
  const remote = () => {
    const r = run('qwinsta.exe', []);
    return r.status === 0 || r.stdout ? activeRemoteSessions(r.stdout ?? '').length : null;
  };
  const listed = (run('qwinsta.exe', []).stdout ?? '').trim();
  console.log(`Sessions:\n${listed}`);
  const before = remote();
  if (before !== 0) throw new Error(`a Remote Desktop session is active (${before}); sign out of or disconnect every Remote Desktop client and run again`);
  if (!sessions(listed).some((s) => /^console$/i.test(s.name) && s.user.toLowerCase() === user.toLowerCase() && /^Active$/i.test(s.state))) {
    throw new Error(`${user} is not logged on at the console (restart the machine: automatic logon puts it back there)`);
  }
  const running = run('tasklist.exe', ['/fi', 'IMAGENAME eq chrome.exe', '/fo', 'csv', '/nh']).stdout;
  if (/chrome\.exe/i.test(running)) throw new Error('a Chrome is already running on this machine; close it so that nvidia-smi\'s chrome.exe lines are this probe\'s');

  const dir = join('C:\\Users', user, 'test-rig-probe', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(process.argv[1], join(dir, 'probe.mjs'));
  // A file: page, not about:blank: WebGPU exists only in a secure context.
  writeFileSync(join(dir, 'probe.html'), '<!doctype html><title>probe</title><body style="margin:0;background:#000">');
  writeFileSync(join(dir, 'args.json'), JSON.stringify({ url, seconds, runs, flags }));

  const registered = ps(`$ErrorActionPreference = 'Stop'
    $a = New-ScheduledTaskAction -Execute ${quote(process.execPath)} -Argument ${quote(`"${join(dir, 'probe.mjs')}" --inner="${dir}"`)} -WorkingDirectory ${quote(dir)}
    $p = New-ScheduledTaskPrincipal -UserId ${quote(`${process.env.COMPUTERNAME}\\${user}`)} -LogonType Interactive -RunLevel Highest
    $s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 6) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName ${quote(TASK)} -Action $a -Principal $p -Settings $s -Force | Out-Null
    Start-ScheduledTask -TaskName ${quote(TASK)}`);
  if (registered.status !== 0) throw new Error(`could not start the probe in ${user}'s session: ${registered.stderr.trim()}`);

  const samples = [];
  const gpuSamples = [];
  // The most active Remote Desktop sessions seen during the run, read every
  // 30 seconds; null if a reading failed, which fails the verdict.
  let during = 0;
  const deadline = Date.now() + (120 + runs * (seconds + 90) + 120) * 1000;
  try {
    for (let i = 0; !existsSync(join(dir, 'result.json')); i++) {
      if (Date.now() > deadline) throw new Error('the probe in the console session never finished');
      if (i % 15 === 7 && during !== null) {
        const now = remote();
        during = now === null ? null : Math.max(during, now);
      }
      if (i % 15 === 14) {
        const state = ps(`(Get-ScheduledTask -TaskName ${quote(TASK)}).State`).stdout.trim();
        if (state !== 'Running' && !existsSync(join(dir, 'result.json'))) throw new Error(`the probe in the console session stopped (task ${state}, result ${ps(`(Get-ScheduledTaskInfo -TaskName ${quote(TASK)}).LastTaskResult`).stdout.trim()})`);
      }
      samples.push(...smi([]).stdout.split(/\r?\n/).filter((l) => /chrome\.exe/i.test(l)).map((l) => ({ t: Date.now(), line: l.trim() })));
      if (i % 30 === 0) gpuSamples.push({ t: Date.now(), csv: smi(['--query-gpu=utilization.gpu,clocks.gr,clocks.max.gr,temperature.gpu,power.draw,pstate', '--format=csv,noheader']).stdout.trim() });
      await sleep(2000);
    }
  } finally {
    ps(`Unregister-ScheduledTask -TaskName ${quote(TASK)} -Confirm:$false`);
  }

  const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  if (result.error) throw new Error(`in the console session: ${result.error}`);
  const after = remote();
  const adapters = ps('Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name): $($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution) at $($_.CurrentRefreshRate) Hz" }');
  const p50s = (result.runs ?? []).filter((r) => r.loaded && r.p50).map((r) => r.p50);
  const report = {
    ...result,
    nvidia: {
      smi: smiPath,
      gpuName: smi(['--query-gpu=name', '--format=csv,noheader']).stdout.trim(),
      licence: licenceState(smi(['-q']).stdout ?? ''),
      chromeSamples: samples.length,
      chromeLines: [...new Set(samples.map((s) => s.line))].slice(0, 10),
      gpu: gpuSamples,
    },
    display: {
      adapters: adapters.stdout.trim().split(/\r?\n/).filter(Boolean),
      refreshHz: result.refreshHz,
      cappedAt60OrLower: result.refreshHz !== null && result.refreshHz <= 61,
    },
    // Last minute's median frame interval over the first's, per run: above 1,
    // it slowed as it ran.
    drift: (result.runs ?? []).map((r) => (r.minuteP50?.length > 1 ? +(r.minuteP50.at(-1) / r.minuteP50[0]).toFixed(4) : null)),
    // (slowest - fastest) / median of the runs' median frame intervals.
    spread: p50s.length > 1 ? +((Math.max(...p50s) - Math.min(...p50s)) / [...p50s].sort((a, b) => a - b)[Math.floor(p50s.length / 2)]).toFixed(4) : null,
    remoteSessions: { before, during, after },
    workDir: dir,
  };
  console.log(JSON.stringify(report, null, 2));
  for (const w of warnings(report)) console.log(`WARNING: ${w}`);
  const reasons = verdict(report);
  console.log(reasons.length ? `FAIL: ${reasons.join('; ')}` : 'PASS');
  return reasons.length ? 1 : 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  const dir = opt('inner');
  try {
    if (dir) await inner(dir);
    else process.exitCode = await outer();
  } catch (error) {
    // Inside the session nobody reads the console: the error goes to the
    // result file, where the outer process reports it.
    if (dir) writeFileSync(join(dir, 'result.json'), JSON.stringify({ error: error.message }));
    console.log(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
