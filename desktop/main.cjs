'use strict';
// Day Hike's desktop shell: a launcher, nothing more.
//
// It opens one window on the live site. There is no copy of the game in here:
// every web deploy is the desktop update, and a release of this shell is cut
// only when the Electron underneath changes. The page tells the shell apart
// by user agent — Electron's own token, plus a DayHike/<version> token added
// below so the landing can show which shell this is and offer a newer one.
// There is no preload and no IPC, so nothing here can drift from the web build.
//
// Electron comes from github.com/csarkosh/electron-gamepatch (see .npmrc): its
// pointerlock-noeject patch is what makes Esc open the pause menu and Resume
// relock instantly. The release script proves the packaged binary carries it.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { version } = require('./package.json');

// Development points this at `npm run dev`; a release never sets it.
const SITE = process.env.DAYHIKE_URL || 'https://games.csarko.sh/dayhike/';
const SITE_ORIGIN = new URL(SITE).origin;
// The site's base path with its trailing slash — '/dayhike/' in production —
// which the smoke needs to recognise the game route.
const SITE_BASE = new URL(SITE).pathname.replace(/\/*$/, '/');
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');

function isOurs(url) {
  return url.startsWith(`${SITE_ORIGIN}/`) || url.startsWith(pathToFileURL(OFFLINE_PAGE).href);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: 'Day Hike',
    backgroundColor: '#101014',
    // Native fullscreen via the green button. The page never asks for HTML
    // fullscreen: with the patch, Esc reaches the fullscreen controller and
    // would drop out of it.
    fullscreenable: true,
    // A remote site in a window: the sandbox and isolation are what make that
    // safe, and there is nothing to expose to it anyway.
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  // The window now renders a remote document. Electron approves every
  // permission request when no handler is set; the game needs the pointer
  // lock (and native fullscreen) and nothing else.
  const allowed = new Set(['pointerLock', 'fullscreen']);
  win.webContents.session.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  // The update banner and the download link open URLs; those belong to the
  // system browser, never to a second window of ours.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  // No network, no DNS, a site that is down: show the offline page instead of
  // Chromium's grey error. -3 is ERR_ABORTED — a navigation we replaced, not
  // a failure. Subframes (none today) are not ours to judge.
  win.webContents.on('did-fail-load', (_event, errorCode, _description, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (win.webContents.getURL().startsWith(pathToFileURL(OFFLINE_PAGE).href)) return;
    win.loadFile(OFFLINE_PAGE, { query: { url: SITE } }).catch(() => {});
  });
  // Rejects on every offline launch; did-fail-load is the handler, not this promise.
  win.loadURL(SITE).catch(() => {});
  return win;
}

// Non-null once the smoke has decided its exit code. It also tells
// `window-all-closed` to keep its hands off: tearing the window down below
// fires that event, and its app.quit() would exit 0 over a failing smoke.
let smokeExitCode = null;

/**
 * End smoke mode with `code`.
 *
 * On Windows, tearing the window down from under a live renderer — one still
 * holding the pointer lock the last check took — faults during teardown
 * (0xC0000005), so a run that passed every check reports failure. destroy()
 * alone was not enough: it drops the renderer where it stands. close() asks it
 * to unload first, which is what lets the GPU and input state go before the
 * main process does; destroy() stays as the fallback for a renderer that will
 * not close, and the exit waits 250 ms after the last window is gone so stdout
 * can drain.
 *
 * Every path here is armed by a timer, and the outer 5 s bound is armed
 * *first*: a throw out of close(), or a 'closed' event that never arrives,
 * would otherwise leave the job with no exit scheduled at all, and a CI run
 * that hangs for its full 20-minute timeout says nothing about the build.
 * Idempotent for the same reason — the timeout path and the summary path can
 * both fire, and the first verdict is the honest one.
 */
function finishSmoke(code) {
  if (smokeExitCode !== null) return;
  smokeExitCode = code;
  setTimeout(() => app.exit(code), 5000);
  const done = () => setTimeout(() => app.exit(code), 250);
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    done();
    return;
  }
  let pending = windows.length;
  for (const w of windows) {
    const fallback = setTimeout(() => {
      try {
        if (!w.isDestroyed()) w.destroy();
      } catch {
        /* a window that is already gone needs no destroying */
      }
    }, 1000);
    w.once('closed', () => {
      clearTimeout(fallback);
      if (--pending === 0) done();
    });
    try {
      w.close();
    } catch {
      try {
        w.destroy();
      } catch {
        /* ditto */
      }
    }
  }
}

/**
 * Smoke mode (DAYHIKE_SMOKE=1): the app checks itself and exits. One JSON line
 * per check on stdout; exit 0 when all pass, 1 when any fails, 2 on timeout.
 * Read-only page queries plus two synthesized clicks — no preload, no IPC.
 */
async function runSmoke(win) {
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const timer = setTimeout(() => {
    out({ check: 'timeout', ok: false });
    finishSmoke(2);
  }, 45000);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A renderer that stops answering never settles executeJavaScript, and
  // awaiting it forever is how a slow pointer lock became a 30 s watchdog kill
  // with no verdict at all. Every poll that runs after the page is interactive
  // goes through here: the call races a timer, and a stall reads as "not yet"
  // rather than stalling the whole check. The bound is generous on purpose —
  // a runner loading the scene answers honestly but slowly, and a cap tight
  // enough to mistake that for a wedge fails checks that would have passed.
  async function jsTimed(code, ms = 3000) {
    let bail = null;
    try {
      return await Promise.race([
        js(code).catch(() => null),
        new Promise((r) => {
          bail = setTimeout(() => r(null), ms);
        }),
      ]);
    } finally {
      if (bail !== null) clearTimeout(bail);
    }
  }
  // Windows hands the pointer lock to the foreground window only, and a runner
  // desktop with no user can leave ours behind another window (or unshown, if
  // ready-to-show has not landed). Retake the foreground before each attempt.
  function foreground() {
    try {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
      win.moveTop?.();
    } catch {
      /* a window on its way out cannot be focused; the check reports it */
    }
  }
  // Release the lock before anything tears the window down: destroying a
  // renderer that still holds it is what faulted on Windows.
  async function exitPointerLock() {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    await jsTimed('(() => { document.exitPointerLock?.(); return true; })()', 1000);
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if ((await jsTimed('!document.pointerLockElement', 1000)) === true) return;
      await sleep(100);
    }
  }
  const results = [];
  async function check(name, fn) {
    let ok = false;
    let detail = null;
    try {
      detail = await fn();
      ok = detail === true;
    } catch (error) {
      detail = String(error);
    }
    results.push(ok);
    out({ check: name, ok, detail: ok ? undefined : detail });
  }
  async function until(code, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await jsTimed(code)) return true;
      await sleep(100);
    }
    return `timed out waiting for ${code}`;
  }
  function click(rect) {
    const ev = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), button: 'left', clickCount: 1 };
    win.webContents.sendInputEvent({ type: 'mouseDown', ...ev });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...ev });
  }
  const rectOf = (selector) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);

  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await sleep(500);

  await check('origin is the site', async () => (await js('location.origin')) === SITE_ORIGIN || `got ${await js('location.origin')}`);
  await check('landing is the desktop landing', async () => {
    const join = await js('!!document.querySelector(".landing form.join input")');
    const download = await js('!!document.querySelector(".landing a.download")');
    return (join && !download) || `join=${join} download=${download}`;
  });
  await check('version label matches package.json', async () => {
    const expected = `v${version}`;
    const got = await js('document.querySelector(".landing .version")?.textContent ?? null');
    return got === expected || `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`;
  });
  await check('Play navigates to a game route with a canvas', async () => {
    const rect = await rectOf('#create');
    if (!rect) return 'no Play button';
    click(rect);
    // 12 s, not 5: the first frame of the scene is the heaviest thing the app
    // does, and a cold runner has come in over 5 s while still being perfectly
    // healthy a beat later.
    const game = `^${SITE_BASE.replace(/[/]/g, '\\/')}game\\/[0-9a-f-]{36}$`;
    return until(`new RegExp(${JSON.stringify(game)}).test(location.pathname) && !!document.querySelector("canvas")`, 12000);
  });
  await check('a click on the canvas locks the pointer', async () => {
    await sleep(1500); // let the scene come up before asking for the lock
    const rect = await rectOf('canvas');
    if (!rect) return 'no canvas';
    // One synthesized click is not a reliable request: it can land while the
    // scene is still settling, or while the window is not foreground, and the
    // browser simply drops it — half the Windows runs failed here. Keep
    // clicking every 500 ms for 6 s instead, taking the foreground first, and
    // poll through jsTimed so a wedged renderer costs one poll, not the run.
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      foreground();
      click(rect);
      for (let i = 0; i < 5 && Date.now() < deadline; i++) {
        if ((await jsTimed('!!document.pointerLockElement')) === true) return true;
        await sleep(100);
      }
    }
    return 'timed out waiting for document.pointerLockElement';
  });

  clearTimeout(timer);
  await exitPointerLock();
  out({ summary: { passed: results.filter(Boolean).length, failed: results.filter((r) => !r).length } });
  finishSmoke(results.every(Boolean) ? 0 : 1);
}

app.whenReady().then(() => {
  // Set before any window exists: a WebContents copies the fallback at creation.
  app.userAgentFallback = `${app.userAgentFallback} DayHike/${version}`;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
  );
  const win = createWindow();
  if (process.env.DAYHIKE_SMOKE === '1') void runSmoke(win);
});

app.on('window-all-closed', () => {
  // Under the smoke, a window that closes on its own before a verdict is a
  // failure — app.quit() would exit 0 and report a green run for an app that
  // vanished. Once finishSmoke owns the exit code this handler stands down.
  if (smokeExitCode !== null) return;
  if (process.env.DAYHIKE_SMOKE === '1') app.exit(1);
  else app.quit();
});
