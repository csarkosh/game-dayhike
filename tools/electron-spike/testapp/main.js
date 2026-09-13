// Throwaway probe: lock -> real Esc -> retry relock every 100 ms until granted; report the gap.
const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

const ROUNDS = Number(process.env.ROUNDS || 3);
const ESC = process.env.ESC || 'osascript';   // osascript | sendInputEvent | manual
const results = [];
let win, round = 0, state = 'idle', relockTimer = null, relockStart = 0, relockAttempts = 0, escSentAt = 0;

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function click() {
  const [w, h] = win.getContentSize();
  const ev = { x: (w / 2) | 0, y: (h / 2) | 0, button: 'left', clickCount: 1 };
  win.webContents.sendInputEvent({ type: 'mouseDown', ...ev });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...ev });
}
function pressEscape() {
  escSentAt = Date.now();
  if (ESC === 'sendInputEvent') {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  } else if (ESC === 'osascript') {
    execFile('osascript', ['-e', 'tell application "System Events" to key code 53'], (err, so, se) => {
      if (err) out({ main: 'osascript-failed', err: String(se || err) });
    });
  } else {
    out({ main: 'PRESS ESC NOW' });
  }
}
function startRelockLoop() {
  relockStart = Date.now(); relockAttempts = 0;
  const tick = () => { relockAttempts++; click(); };
  tick();
  relockTimer = setInterval(tick, 100);
}
async function runRound() {
  round++;
  out({ main: 'round', round });
  state = 'locking';
  click();
}
ipcMain.on('probe', async (_e, m) => {
  out({ round, state, ...m });
  if (m.kind === 'pointerlockchange' && m.locked && state === 'locking') {
    state = 'escaping';
    await sleep(400);
    pressEscape();
  } else if (m.kind === 'pointerlockchange' && !m.locked && state === 'escaping') {
    state = 'relocking';
    out({ main: 'unlocked', msAfterEsc: Date.now() - escSentAt });
    startRelockLoop();
  } else if (m.kind === 'pointerlockchange' && m.locked && state === 'relocking') {
    clearInterval(relockTimer);
    const gap = Date.now() - relockStart;
    results.push({ round, relockGapMs: gap, attempts: relockAttempts });
    out({ main: 'relocked', round, relockGapMs: gap, attempts: relockAttempts });
    state = 'escaping2';
    await sleep(400);
    pressEscape();
  } else if (m.kind === 'pointerlockchange' && !m.locked && state === 'escaping2') {
    if (round < ROUNDS) { await sleep(1600); runRound(); }
    else { out({ summary: results, variant: process.env.VARIANT || 'unknown', esc: ESC }); app.exit(0); }
  }
});
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 800, height: 600, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  await win.loadFile('index.html');
  app.focus({ steal: true }); win.focus();
  await sleep(1200);
  runRound();
});
setTimeout(() => { out({ main: 'TIMEOUT', state, results }); app.exit(2); }, Number(process.env.TIMEOUT_MS || 60000));
