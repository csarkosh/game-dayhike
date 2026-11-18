import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const DESKTOP = new URL('../../../desktop/', import.meta.url);
const { PAGE_READING, TURNED_AWAY_REASONS, exitCodeOf, gameRoute, pageSeen, proves, settled, summaryOf } = require('../../../desktop/smokePage.cjs');

/** The app's own, as `main.cjs` makes them from the site it loads. */
const SITE = { origin: 'https://games.csarko.sh', base: '/dayhike/', offline: 'file:///Applications/Day%20Hike.app/Contents/Resources/app.asar/offline.html' };
const GAME = '/dayhike/game/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';

/** A reading of a page of the site's with nothing on it; each case says what its page shows. */
function reading(over = {}) {
  return {
    origin: SITE.origin, href: `${SITE.origin}/dayhike/`, path: '/dayhike/', title: 'Day Hike', characters: 0,
    landing: false, join: false, download: false, version: null, canvas: false,
    turnedAway: false, reason: null, heading: null, headline: null, detail: null,
    ...over,
  };
}
const landing = (over = {}) => reading({ landing: true, join: true, version: 'v0.3.0', characters: 240, ...over });
const turnedAway = (over = {}) =>
  reading({
    turnedAway: true, reason: 'software', heading: 'Day Hike', characters: 400,
    headline: 'Day Hike could not use the graphics card in this computer.',
    detail: 'Day Hike is drawn with WebGPU, which is running without the graphics card on this computer.',
    ...over,
  });
const hike = (over = {}) => reading({ href: `${SITE.origin}${GAME}`, path: GAME, canvas: true, ...over });

describe('the page the desktop smoke judges the load by', () => {
  it('takes the desktop landing, and a hike reached from it, as the site loaded', () => {
    expect(pageSeen(landing(), SITE)).toEqual({ page: 'landing', ok: true });
    expect(pageSeen(hike(), SITE)).toEqual({ page: 'hike', ok: true });
    // A hike is its route with a canvas on it: the route alone, or a canvas elsewhere, is neither.
    expect(pageSeen(hike({ canvas: false }), SITE).page).toBe('blank');
    expect(pageSeen(reading({ canvas: true, characters: 12 }), SITE)).toMatchObject({ page: 'other', ok: false });
    expect(proves(pageSeen(hike(), SITE))).toBe(true);
    // The landing is the way to a hike, not the proof: Play must still reach one.
    expect(proves(pageSeen(landing(), SITE))).toBe(false);
  });

  it('takes the page for those turned away as the site loaded, and says why the site turned the app away', () => {
    for (const reason of TURNED_AWAY_REASONS) {
      const seen = pageSeen(turnedAway({ reason }), SITE);
      expect(seen, reason).toEqual({
        page: 'turned-away', ok: true, reason,
        headline: 'Day Hike could not use the graphics card in this computer.',
        detail: 'Day Hike is drawn with WebGPU, which is running without the graphics card on this computer.',
      });
      expect(proves(seen), reason).toBe(true);
    }
    // It wins over a landing still in the page: the site puts it in the landing's place.
    expect(pageSeen(turnedAway({ landing: true, join: true }), SITE).page).toBe('turned-away');
  });

  it('refuses a page for those turned away that gives no reason of the site\'s, says nothing, or offers the app itself', () => {
    for (const reason of [null, '', 'gpu', 'no-gpu', 'Software']) {
      const seen = pageSeen(turnedAway({ reason }), SITE);
      expect(seen.ok, String(reason)).toBe(false);
      expect(seen.why, String(reason)).toContain('none of no-webgpu, no-adapter, software, short');
    }
    expect(pageSeen(turnedAway({ headline: '' }), SITE)).toMatchObject({ page: 'turned-away', ok: false });
    expect(pageSeen(turnedAway({ headline: null }), SITE).ok).toBe(false);
    expect(pageSeen(turnedAway({ heading: '' }), SITE).ok).toBe(false);
    expect(pageSeen(turnedAway({ download: true }), SITE)).toMatchObject({ ok: false, why: 'the page for those turned away offers the app a download of itself' });
    expect(proves(pageSeen(turnedAway({ reason: 'gpu' }), SITE))).toBe(false);
  });

  it('fails a blank page, an error page, the offline page and a page that is neither', () => {
    // Blank: the site's origin, nothing on it.
    expect(pageSeen(reading(), SITE)).toMatchObject({ page: 'blank', ok: false });
    // Chromium's own error page, and any page of another origin.
    expect(pageSeen(reading({ origin: 'null', href: 'chrome-error://chromewebdata/', characters: 90 }), SITE)).toMatchObject({ page: 'elsewhere', ok: false });
    expect(pageSeen(landing({ origin: 'https://example.com', href: 'https://example.com/dayhike/' }), SITE)).toMatchObject({ page: 'elsewhere', ok: false });
    // The app's offline page, shown where the site did not load: even one that carried the site's marks.
    const offline = { origin: 'file://', href: `${SITE.offline}?url=https%3A%2F%2Fgames.csarko.sh%2Fdayhike%2F`, characters: 120 };
    expect(pageSeen(reading(offline), SITE)).toMatchObject({ page: 'offline', ok: false });
    expect(pageSeen(turnedAway(offline), SITE)).toMatchObject({ page: 'offline', ok: false });
    // The host's own error page at the site's origin, or any page of the site's that is neither.
    const notFound = pageSeen(reading({ path: '/dayhike/nope', title: 'Page Not Found', characters: 61 }), SITE);
    expect(notFound).toMatchObject({ page: 'other', ok: false });
    expect(notFound.why).toContain('"Page Not Found"');
    // The web's landing, with a download of the app on it: the page took the app for a browser.
    expect(pageSeen(landing({ download: true }), SITE)).toMatchObject({ page: 'landing', ok: false, why: 'not the desktop landing: join=true download=true' });
    expect(pageSeen(landing({ join: false }), SITE).ok).toBe(false);
    // A renderer that did not answer, or answered with no object.
    expect(pageSeen(null, SITE)).toMatchObject({ page: 'none', ok: false });
    expect(pageSeen(undefined, SITE).ok).toBe(false);
    expect(pageSeen('', SITE).ok).toBe(false);
    for (const seen of [reading(), reading(offline), landing({ download: true }), null]) expect(proves(pageSeen(seen, SITE))).toBe(false);
  });

  it('waits for a page it can judge: the landing with its form in, a hike, or the page for those turned away', () => {
    expect(settled(pageSeen(landing(), SITE))).toBe(true);
    expect(settled(pageSeen(hike(), SITE))).toBe(true);
    expect(settled(pageSeen(turnedAway(), SITE))).toBe(true);
    // One that is malformed is judged at once: waiting would not mend it.
    expect(settled(pageSeen(turnedAway({ reason: null }), SITE))).toBe(true);
    for (const early of [reading(), landing({ join: false }), null]) expect(settled(pageSeen(early, SITE))).toBe(false);
  });

  it('matches the game route under the site\'s base, and nothing else', () => {
    expect(gameRoute('/dayhike/').test(GAME)).toBe(true);
    expect(gameRoute('/').test('/game/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0')).toBe(true);
    for (const path of ['/dayhike/', '/dayhike/game/', '/dayhike/game/abc', `${GAME}/x`, `/x${GAME}`, '/dayhikeXgame/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0']) {
      expect(gameRoute('/dayhike/').test(path), path).toBe(false);
    }
  });
});

describe('the desktop smoke\'s verdict', () => {
  it('says which page it saw, and the reason with the page for those turned away', () => {
    expect(summaryOf([true, true, true, true, true, true], pageSeen(hike(), SITE))).toEqual({ passed: 6, failed: 0, saw: 'hike' });
    expect(summaryOf([true, true, true], pageSeen(turnedAway({ reason: 'no-adapter' }), SITE))).toEqual({ passed: 3, failed: 0, saw: 'turned-away', reason: 'no-adapter' });
    expect(summaryOf([true, false], pageSeen(reading(), SITE))).toEqual({ passed: 1, failed: 1, saw: 'blank' });
  });

  it('passes only where every check counted passed and the last page seen proves the load', () => {
    expect(exitCodeOf([true, true, true, true, true, true], pageSeen(hike(), SITE))).toBe(0);
    expect(exitCodeOf([true, true, true], pageSeen(turnedAway(), SITE))).toBe(0);
    // A failed check fails it whatever the page.
    expect(exitCodeOf([true, false, true], pageSeen(turnedAway(), SITE))).toBe(1);
    expect(exitCodeOf([true, true, true, true, true, false], pageSeen(hike(), SITE))).toBe(1);
    // And so does a run that ended on no proof: the landing alone, a blank page, the offline page, no check at all.
    expect(exitCodeOf([true, true], pageSeen(landing(), SITE))).toBe(1);
    expect(exitCodeOf([true], pageSeen(reading(), SITE))).toBe(1);
    expect(exitCodeOf([true], pageSeen(turnedAway({ reason: 'gpu' }), SITE))).toBe(1);
    expect(exitCodeOf([], pageSeen(hike(), SITE))).toBe(1);
  });
});

describe('what the smoke reads of the page', () => {
  /** A page as the reading's script sees it: elements by the selectors it asks for. */
  function page(location, elements, bodyText = '') {
    const document = {
      title: 'Day Hike',
      body: { innerText: bodyText },
      querySelector: (selector) => (Object.hasOwn(elements, selector) ? elements[selector] : null),
    };
    return vm.runInNewContext(PAGE_READING, { document, location });
  }
  const at = (path) => ({ origin: SITE.origin, href: `${SITE.origin}${path}`, pathname: path });

  it('reads the desktop landing', () => {
    const got = page(at('/dayhike/'), { '.landing': {}, '.landing form.join input': {}, '.landing .version': { textContent: ' v0.3.0 ' } }, 'DAY HIKE\nPlay');
    expect(got).toMatchObject({ origin: SITE.origin, path: '/dayhike/', landing: true, join: true, download: false, version: 'v0.3.0', turnedAway: false, reason: null, canvas: false, characters: 13 });
    expect(pageSeen(got, SITE)).toEqual({ page: 'landing', ok: true });
  });

  it('reads the page for those turned away, its reason from the landmark\'s data', () => {
    const got = page(at('/dayhike/'), {
      'main.turned-away': { dataset: { reason: 'software' } },
      'main.turned-away h1': { textContent: 'Day Hike' },
      'main.turned-away .headline': { textContent: 'Day Hike could not use the graphics card in this computer.' },
      'main.turned-away .detail': { textContent: 'Day Hike is drawn with WebGPU, which is running without the graphics card on this computer.' },
    }, 'Day Hike\nDay Hike could not use the graphics card in this computer.');
    expect(pageSeen(got, SITE)).toMatchObject({ page: 'turned-away', ok: true, reason: 'software' });
    // A landmark with no reason on it reads as none, and is refused.
    const bare = page(at('/dayhike/'), { 'main.turned-away': { dataset: {} }, 'main.turned-away h1': { textContent: 'Day Hike' }, 'main.turned-away .headline': { textContent: 'x' } }, 'x');
    expect(bare.reason).toBeNull();
    expect(pageSeen(bare, SITE).ok).toBe(false);
  });

  it('reads a hike, a blank page and a page with no body', () => {
    expect(pageSeen(page(at(GAME), { canvas: {} }), SITE)).toEqual({ page: 'hike', ok: true });
    expect(pageSeen(page(at('/dayhike/'), {}), SITE).page).toBe('blank');
    const noBody = vm.runInNewContext(PAGE_READING, { document: { title: '', body: null, querySelector: () => null }, location: at('/dayhike/') });
    expect(noBody.characters).toBe(0);
    expect(pageSeen(noBody, SITE).page).toBe('blank');
  });
});

describe('the smoke and the site agree', () => {
  const read = (file) => readFileSync(new URL(file, DESKTOP), 'utf8');
  const client = (file) => readFileSync(new URL(`../../../client/src/game/${file}`, import.meta.url), 'utf8');

  it('on the reasons the site turns a visitor away for', () => {
    const listed = /export const TURNED_AWAY_REASONS: readonly TurnedAwayReason\[\] = \[([^\]]*)\];/.exec(client('loadCheck.ts'));
    expect(listed).not.toBeNull();
    expect(listed[1].split(',').map((word) => word.trim().replace(/^"|"$/g, ''))).toEqual(TURNED_AWAY_REASONS);
  });

  it('on where the page carries its reason and its words', () => {
    const turned = client('turnedAway.ts');
    expect(turned).toContain('root.dataset.reason = v.reason;');
    expect(turned).toContain('const root = document.createElement("main");\n  root.className = "turned-away";');
    expect(turned).toContain('line("headline", v.headline)');
    expect(turned).toContain('line("detail", v.detail)');
    expect(turned).toContain('link.className = "download";');
    expect(PAGE_READING).toContain("document.querySelector('main.turned-away')");
    expect(PAGE_READING).toContain('away.dataset.reason');
  });

  it('and the app ships the smoke\'s module, which nothing but the smoke loads', () => {
    const main = read('main.cjs');
    // The one require of a file of the app's own, inside the smoke: a launch that is no smoke never loads it.
    const own = [...main.matchAll(/require\('(\.\/[^']+)'\)/g)].map((m) => m[1]);
    expect(own.sort()).toEqual(['./package.json', './smokePage.cjs']);
    expect(main.indexOf("require('./smokePage.cjs')")).toBeGreaterThan(main.indexOf('async function runSmoke(win) {'));
    expect(main).toContain("  if (process.env.DAYHIKE_SMOKE === '1') void runSmoke(win);");
    const packed = /files: \[([^\]]*)\]/.exec(read('electron-builder.cjs'));
    expect(packed[1].split(',').map((word) => word.trim().replace(/^'|'$/g, ''))).toEqual(['main.cjs', 'smokePage.cjs', 'offline.html', 'package.json']);
    // The smoke judges by the module's word alone: what it prints and how it exits.
    expect(main).toContain('  out({ summary: summaryOf(results, seen) });\n  finishSmoke(exitCodeOf(results, seen));');
    expect(main).toContain("const look = async () => pageSeen(await jsTimed(PAGE_READING), site);");
  });
});
