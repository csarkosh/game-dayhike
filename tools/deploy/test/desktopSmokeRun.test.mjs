import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * The desktop app's smoke run from end to end with no Electron: `main.cjs`
 * itself, required with a stand-in for the `electron` module whose one window
 * answers `executeJavaScript` from a page made here, so what the smoke prints
 * and how it exits are held for each page the app may find itself on. The
 * stand-in's clock is the test's (fake timers): nothing waits.
 */
const require = createRequire(import.meta.url);
const MAIN = fileURLToPath(new URL('../../../desktop/main.cjs', import.meta.url));
const SITE = 'https://games.csarko.sh';
const GAME = '/dayhike/game/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
const { version } = require('../../../desktop/package.json');

/** What each kind of page holds, by the selectors the smoke asks for. */
const box = (x, y) => ({ getBoundingClientRect: () => ({ x, y, width: 100, height: 40 }) });
const PAGES = {
  landing: () => ({
    '.landing': {}, '.landing form.join input': {}, '.landing .version': { textContent: `v${version}` }, '#create': box(600, 400),
  }),
  webLanding: () => ({
    '.landing': {}, '.landing form.join input': {}, '.landing a.download': {}, 'a.download': {}, '.landing .version': { textContent: `v${version}` }, '#create': box(600, 400),
  }),
  hike: () => ({ canvas: box(0, 0) }),
  turnedAway: (reason = 'software') => ({
    'main.turned-away': { dataset: reason === null ? {} : { reason } },
    'main.turned-away h1': { textContent: 'Day Hike' },
    'main.turned-away .headline': { textContent: 'Day Hike could not use the graphics card in this computer.' },
    'main.turned-away .detail': { textContent: 'Day Hike is drawn with WebGPU, which is running without the graphics card on this computer.' },
  }),
  blank: () => ({}),
  notFound: () => ({}),
};

/**
 * A page the stand-in window shows. `show(kind, …)` puts a page up; `onPlay`
 * and `onCanvasClick` say what a click on Play and on the canvas lead to.
 */
function makePage() {
  const page = {
    origin: SITE, path: '/dayhike/', href: `${SITE}/dayhike/`, title: 'Day Hike', text: '', elements: {}, locked: false,
    onPlay: () => undefined, onCanvasClick: () => undefined,
    show(kind, ...more) {
      page.elements = PAGES[kind](...more);
      page.text = kind === 'blank' ? '' : kind === 'notFound' ? 'Page Not Found' : `the ${kind} page`;
      page.title = kind === 'notFound' ? 'Page Not Found' : 'Day Hike';
      if (kind === 'hike') page.path = GAME;
      page.href = `${page.origin}${page.path}`;
      if (kind !== 'hike') page.locked = false;
    },
    evaluate(code) {
      const document = {
        get title() { return page.title; },
        body: { get innerText() { return page.text; } },
        querySelector: (selector) => (Object.hasOwn(page.elements, selector) ? page.elements[selector] : null),
        get pointerLockElement() { return page.locked ? {} : null; },
        exitPointerLock() { page.locked = false; },
      };
      return vm.runInNewContext(code, { document, location: { origin: page.origin, href: page.href, pathname: page.path } });
    },
    click(x, y) {
      const hit = (selector) => {
        const element = page.elements[selector];
        if (element === undefined) return false;
        const r = element.getBoundingClientRect();
        return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
      };
      if (hit('#create')) page.onPlay();
      else if (hit('canvas')) page.onCanvasClick();
    },
  };
  return page;
}

/** Runs `main.cjs` in smoke mode against `page`: the lines it printed and the code it exited with. */
async function smoke(page) {
  const lines = [];
  let exit = null;
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.gone = false;
      const contents = new EventEmitter();
      Object.assign(contents, {
        session: { setPermissionRequestHandler: () => undefined, setPermissionCheckHandler: () => undefined },
        setWindowOpenHandler: () => undefined,
        getURL: () => page.href,
        isDestroyed: () => this.gone,
        executeJavaScript: async (code) => page.evaluate(code),
        sendInputEvent: (event) => { if (event.type === 'mouseUp') page.click(event.x, event.y); },
      });
      this.webContents = contents;
      windows.push(this);
      setTimeout(() => contents.emit('did-finish-load'), 300);
    }
    static getAllWindows() { return windows.filter((w) => !w.gone); }
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return this.gone; }
    maximize() {}
    show() {}
    focus() {}
    moveTop() {}
    destroy() { this.close(); }
    close() {
      if (this.gone) return;
      this.gone = true;
      this.emit('closed');
    }
  }
  const app = Object.assign(new EventEmitter(), {
    userAgentFallback: 'Electron',
    whenReady: () => Promise.resolve(),
    exit: (code) => { if (exit === null) exit = code; },
    quit: () => { if (exit === null) exit = 0; },
  });
  const electron = { app, BrowserWindow, Menu: { setApplicationMenu: () => undefined, buildFromTemplate: () => ({}) }, shell: { openExternal: async () => undefined } };

  const load = Module._load;
  const write = process.stdout.write;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? electron : load.call(this, request, ...rest);
  };
  process.stdout.write = (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.startsWith('{')) lines.push(JSON.parse(line));
    return true;
  };
  try {
    delete require.cache[MAIN];
    require(MAIN);
    for (let i = 0; i < 700 && exit === null; i++) await vi.advanceTimersByTimeAsync(100);
  } finally {
    Module._load = load;
    process.stdout.write = write;
    delete require.cache[MAIN];
  }
  return { lines, exit, summary: lines.find((line) => line.summary !== undefined)?.summary ?? null, checks: lines.filter((line) => line.check !== undefined) };
}

describe("the desktop app's smoke, run on a stand-in window", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.DAYHIKE_SMOKE = '1';
    delete process.env.DAYHIKE_URL;
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...env };
  });

  it('passes on a hike: the landing, Play to a game route with a canvas, the pointer locked', async () => {
    const page = makePage();
    page.show('landing');
    page.onPlay = () => setTimeout(() => page.show('hike'), 2_000);
    page.onCanvasClick = () => { page.locked = true; };
    const run = await smoke(page);
    expect(run.checks.map((line) => [line.check, line.ok])).toEqual([
      ['origin is the site', true],
      ['the site shows its landing or the page for those turned away', true],
      ['landing is the desktop landing', true],
      ['version label matches package.json', true],
      ['Play navigates to a game route with a canvas', true],
      ['a click on the canvas locks the pointer', true],
    ]);
    expect(run.checks[1].saw).toBe('landing');
    expect(run.summary).toEqual({ passed: 6, failed: 0, saw: 'hike' });
    expect(run.exit).toBe(0);
    // The lock is let go before the window is taken down.
    expect(page.locked).toBe(false);
  });

  it('passes on the page for those turned away, and says the reason: a machine with no graphics card', async () => {
    for (const reason of ['no-webgpu', 'no-adapter', 'software', 'short']) {
      const page = makePage();
      page.show('turnedAway', reason);
      const run = await smoke(page);
      expect(run.checks.map((line) => [line.check, line.ok]), reason).toEqual([
        ['origin is the site', true],
        ['the site shows its landing or the page for those turned away', true],
        ['the page for those turned away says why', true],
      ]);
      expect(run.checks[1].saw).toBe('turned-away');
      expect(run.checks[2]).toMatchObject({ reason, headline: 'Day Hike could not use the graphics card in this computer.' });
      expect(run.summary, reason).toEqual({ passed: 3, failed: 0, saw: 'turned-away', reason });
      expect(run.exit, reason).toBe(0);
    }
  });

  it('with a hike asked for, passes on a hike and fails on the page for those turned away: a machine with a graphics card', async () => {
    process.env.DAYHIKE_SMOKE_NEEDS_HIKE = '1';
    const hike = makePage();
    hike.show('landing');
    hike.onPlay = () => setTimeout(() => hike.show('hike'), 2_000);
    hike.onCanvasClick = () => { hike.locked = true; };
    const drawn = await smoke(hike);
    expect(drawn.checks.at(-1)).toEqual({ check: 'this machine draws a hike', ok: true });
    expect(drawn.summary).toEqual({ passed: 7, failed: 0, saw: 'hike' });
    expect(drawn.exit).toBe(0);

    const away = makePage();
    away.show('turnedAway', 'software');
    const turned = await smoke(away);
    expect(turned.checks.map((line) => [line.check, line.ok])).toEqual([
      ['origin is the site', true],
      ['the site shows its landing or the page for those turned away', true],
      ['the page for those turned away says why', true],
      ['this machine draws a hike', false],
    ]);
    expect(turned.checks.at(-1).detail).toBe('the last page seen is the turned-away page, not a hike');
    expect(turned.summary).toEqual({ passed: 3, failed: 1, saw: 'turned-away', reason: 'software' });
    expect(turned.exit).toBe(1);
  });

  it('passes where the site turns the app away after the landing is up: the checks it finds that page in the place of are not counted', async () => {
    // The GPU answers the site while the smoke waits for Play's hike.
    const afterPlay = makePage();
    afterPlay.show('landing');
    afterPlay.onPlay = () => setTimeout(() => afterPlay.show('turnedAway', 'no-adapter'), 1_500);
    let run = await smoke(afterPlay);
    expect(run.checks.map((line) => [line.check, line.ok ?? 'skipped'])).toEqual([
      ['origin is the site', true],
      ['the site shows its landing or the page for those turned away', true],
      ['landing is the desktop landing', true],
      ['version label matches package.json', true],
      ['Play navigates to a game route with a canvas', 'skipped'],
      ['the page for those turned away says why', true],
    ]);
    expect(run.summary).toEqual({ passed: 5, failed: 0, saw: 'turned-away', reason: 'no-adapter' });
    expect(run.exit).toBe(0);

    // It answers once a hike has started: the page takes the hike's place before the pointer is locked.
    const afterHike = makePage();
    afterHike.show('landing');
    afterHike.onPlay = () => {
      setTimeout(() => afterHike.show('hike'), 500);
      setTimeout(() => afterHike.show('turnedAway', 'software'), 1_200);
    };
    run = await smoke(afterHike);
    expect(run.checks.at(-2)).toEqual({ check: 'a click on the canvas locks the pointer', skipped: 'the page for those turned away has taken the page over' });
    expect(run.summary).toEqual({ passed: 6, failed: 0, saw: 'turned-away', reason: 'software' });
    expect(run.exit).toBe(0);

    // It answers between the landing's first sight and its own checks.
    const atOnce = makePage();
    atOnce.show('landing');
    setTimeout(() => atOnce.show('turnedAway', 'short'), 850);
    run = await smoke(atOnce);
    expect(run.summary).toMatchObject({ failed: 0, saw: 'turned-away', reason: 'short' });
    expect(run.exit).toBe(0);
  });

  it('fails on a blank page, the offline page, an error page and a page that is neither', async () => {
    const blank = makePage();
    blank.show('blank');
    let run = await smoke(blank);
    expect(run.checks[1]).toMatchObject({ check: 'the site shows its landing or the page for those turned away', ok: false, saw: 'blank' });
    expect(run.summary).toEqual({ passed: 1, failed: 1, saw: 'blank' });
    expect(run.exit).toBe(1);

    const offline = makePage();
    offline.origin = 'file://';
    offline.path = '/Applications/Day%20Hike.app/Contents/Resources/app.asar/offline.html';
    offline.show('blank');
    offline.text = 'Day Hike needs a connection.';
    // Where the app's own offline page stands on this machine.
    offline.href = `${new URL('../../../desktop/offline.html', import.meta.url).href}?url=x`;
    run = await smoke(offline);
    expect(run.checks.map((line) => line.ok)).toEqual([false, false]);
    expect(run.summary).toEqual({ passed: 0, failed: 2, saw: 'offline' });
    expect(run.exit).toBe(1);

    const error = makePage();
    error.origin = 'null';
    error.show('blank');
    error.href = 'chrome-error://chromewebdata/';
    error.text = 'This site can’t be reached';
    run = await smoke(error);
    expect(run.summary).toMatchObject({ failed: 2, saw: 'elsewhere' });
    expect(run.exit).toBe(1);

    const notFound = makePage();
    notFound.show('notFound');
    run = await smoke(notFound);
    expect(run.checks[1]).toMatchObject({ ok: false, saw: 'other' });
    expect(run.checks[1].detail).toContain('"Page Not Found"');
    expect(run.exit).toBe(1);
  });

  it('fails on a page for those turned away that gives no reason, on the web\'s landing, and where Play reaches nothing', async () => {
    const noReason = makePage();
    noReason.show('turnedAway', null);
    let run = await smoke(noReason);
    expect(run.checks.map((line) => line.ok)).toEqual([true, false, false]);
    expect(run.summary).toMatchObject({ failed: 2, saw: 'turned-away' });
    expect(run.exit).toBe(1);

    const web = makePage();
    web.show('webLanding');
    run = await smoke(web);
    expect(run.checks[1]).toMatchObject({ ok: false, saw: 'landing', detail: 'not the desktop landing: join=true download=true' });
    expect(run.exit).toBe(1);

    // Play is clicked and the landing stays: no hike and no page for those turned away.
    const stuck = makePage();
    stuck.show('landing');
    run = await smoke(stuck);
    expect(run.checks.at(-2)).toMatchObject({ check: 'Play navigates to a game route with a canvas', ok: false });
    // Every check of the way to a hike is run and told, as before: the next finds no canvas.
    expect(run.checks.at(-1)).toEqual({ check: 'a click on the canvas locks the pointer', ok: false, detail: 'no canvas' });
    expect(run.summary).toEqual({ passed: 4, failed: 2, saw: 'landing' });
    expect(run.exit).toBe(1);

    // A hike whose canvas never takes the pointer fails as it always did.
    const unlocked = makePage();
    unlocked.show('landing');
    unlocked.onPlay = () => setTimeout(() => unlocked.show('hike'), 500);
    run = await smoke(unlocked);
    expect(run.checks.at(-1)).toMatchObject({ check: 'a click on the canvas locks the pointer', ok: false });
    expect(run.summary).toEqual({ passed: 5, failed: 1, saw: 'hike' });
    expect(run.exit).toBe(1);
  });
});
