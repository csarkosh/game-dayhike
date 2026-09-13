// Throwaway: open the real game in a (patched) Electron and drive lock -> real Esc -> Resume.
const { app, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const BASE = process.env.GAME_URL || 'http://localhost:5173';
const OUT = process.env.OUT || 'out';
const TAG = process.env.VARIANT || 'unknown';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let win;

const js = (code) => win.webContents.executeJavaScript(code, true);
const locked = () => js('!!document.pointerLockElement');
const menuOpen = () => js('(() => { const m = document.querySelector(".pausemenu"); return !!m && getComputedStyle(m).display !== "none" && !m.hidden; })()');
async function waitFor(fn, ms, label) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return Date.now() - t; await sleep(10); }
  out({ main: 'wait-timeout', label }); return -1;
}
function click(x, y) {
  const ev = { x: x | 0, y: y | 0, button: 'left', clickCount: 1 };
  win.webContents.sendInputEvent({ type: 'mouseDown', ...ev });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...ev });
}
async function shot(name) {
  const img = await win.capturePage();
  fs.writeFileSync(`${OUT}/${TAG}-${name}.png`, img.toPNG());
  out({ main: 'screenshot', file: `${OUT}/${TAG}-${name}.png`, size: img.getSize() });
}
const escape = () => new Promise((res) => execFile('osascript', ['-e', 'tell application "System Events" to key code 53'], (err, so, se) => { if (err) out({ main: 'osascript-failed', err: String(se || err) }); res(); }));

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 800 });
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) out({ console: level, msg: msg.slice(0, 300) }); });
  win.webContents.on('render-process-gone', (_e, d) => out({ main: 'renderer-gone', d }));
  const url = `${BASE}/game/${crypto.randomUUID()}?cmd=weather clear`;
  out({ main: 'loading', url });
  await win.loadURL(url);
  app.focus({ steal: true }); win.focus();
  out({ main: 'loaded', title: await js('document.title'), hasCanvas: await js('!!document.querySelector("canvas")') });
  if (process.env.PREVIEW) { out({ main: 'preview: leaving the window open; close it to exit' }); return; }
  await js(`window.__ev = []; const __t0 = performance.now();
    const __log = (k, x) => window.__ev.push({ k, t: +(performance.now() - __t0).toFixed(1), locked: !!document.pointerLockElement, ...x });
    document.addEventListener('pointerlockchange', () => __log('plc'));
    document.addEventListener('pointerlockerror', () => __log('plerr'));
    window.addEventListener('keydown', (e) => __log('keydown', { code: e.code }), true);
    window.addEventListener('keyup', (e) => __log('keyup', { code: e.code }), true);
    window.addEventListener('mousedown', (e) => __log('mousedown', { x: e.clientX, y: e.clientY, target: e.target.tagName + '.' + e.target.className }), true);
    window.addEventListener('click', (e) => __log('click', { target: e.target.tagName + '.' + e.target.className }), true);
    const orig = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function (...a) { __log('requestPointerLock', { el: this.tagName }); const p = orig.apply(this, a); if (p && p.then) p.then(() => __log('rpl-resolved'), (e) => __log('rpl-rejected', { name: e.name, msg: e.message })); return p; };
    'instrumented'`);
  await sleep(8000);   // let assets/terrain settle
  await shot('1-loaded');

  const [w, h] = win.getContentSize();
  click(w / 2, h / 2);
  const tLock = await waitFor(locked, 3000, 'initial-lock');
  out({ main: 'initial-lock', ms: tLock, locked: await locked() });
  await sleep(500);
  await shot('2-locked');

  await escape();
  const tMenu = await waitFor(menuOpen, 3000, 'menu-open');
  out({ main: 'after-esc', menuOpenMs: tMenu, locked: await locked() });
  await sleep(300);
  await shot('3-pause-menu');

  out({ main: 'menus', info: await js('[...document.querySelectorAll(".pausemenu")].map(m => ({ cls: m.className, disp: getComputedStyle(m).display, rect: m.getBoundingClientRect().toJSON(), buttons: [...m.querySelectorAll("button")].map(b => ({ t: b.textContent, r: b.getBoundingClientRect().toJSON() })) }))') });
  const r = await js('(() => { const b = [...document.querySelectorAll(".pausemenu button")].find(b => b.textContent.trim() === "Resume"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
  out({ main: 'resume-button', r });
  if (r) {
    const t0 = Date.now();
    click(r.x, r.y);
    const tRelock = await waitFor(locked, 3000, 'relock');
    out({ main: 'resume-click', relockMs: tRelock, wallMs: Date.now() - t0, locked: await locked(), menuOpen: await menuOpen() });
  }
  await sleep(500);
  await shot('4-resumed');
  out({ main: 'events', ev: await js('window.__ev') });
  out({ main: 'done', variant: TAG });
  app.exit(0);
});
if (!process.env.PREVIEW) setTimeout(() => { out({ main: 'TIMEOUT' }); app.exit(2); }, 60000);
app.on('window-all-closed', () => app.quit());
