'use strict';
// What the smoke reads of the page the app loaded and what it makes of it:
// plain functions with no Electron in them, so a test can run them
// (tools/deploy/test/desktopSmoke.test.mjs).
//
// The app proves it loaded the site by one of two pages. The desktop landing,
// from which Play reaches a hike: a game route with a canvas. Or the page for
// a visitor who cannot play (client/src/game/turnedAway.ts), which the site
// shows in place of everything else where its load check
// (engine/src/game/loadCheck.ts) finds no graphics card a hike can be drawn
// with: a runner with no GPU is such a visitor, and the page it is shown is
// the site working as built. Anything else fails: a blank page, the app's own
// offline page, a page of another origin (Chromium's error page among them),
// or a page of the site's that is neither.

/** Why the site turns a visitor away: `TURNED_AWAY_REASONS` in engine/src/game/loadCheck.ts. */
const TURNED_AWAY_REASONS = ['no-webgpu', 'no-adapter', 'software', 'short'];

/**
 * Evaluated in the page: what it shows, as plain data. The page for those
 * turned away carries its reason on its landmark (`data-reason`).
 */
const PAGE_READING = `(() => {
  const text = (selector) => {
    const found = document.querySelector(selector);
    return found === null ? null : (found.textContent || '').trim();
  };
  const away = document.querySelector('main.turned-away');
  return {
    origin: location.origin,
    href: location.href,
    path: location.pathname,
    title: document.title,
    characters: ((document.body && document.body.innerText) || '').trim().length,
    landing: document.querySelector('.landing') !== null,
    join: document.querySelector('.landing form.join input') !== null,
    download: document.querySelector('a.download') !== null,
    version: text('.landing .version'),
    canvas: document.querySelector('canvas') !== null,
    turnedAway: away !== null,
    reason: away === null ? null : (away.dataset.reason || null),
    heading: text('main.turned-away h1'),
    headline: text('main.turned-away .headline'),
    detail: text('main.turned-away .detail'),
  };
})()`;

/** The site's game route: `<base>game/<uuid>`. */
function gameRoute(base) {
  return new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}game\\/[0-9a-f-]{36}$`);
}

/**
 * What a reading is a page of. `site` is the app's own: its origin, its base
 * path with the trailing slash, and the address of its offline page.
 *
 * `page` is one of: `landing` (the desktop landing), `hike` (a game route
 * with a canvas), `turned-away` (with `reason`, `headline` and `detail`),
 * `offline`, `elsewhere`, `blank`, `other`, `none` (no reading at all). `ok`
 * says whether it proves the app loaded the site; where it does not, `why`
 * says what was seen.
 */
function pageSeen(reading, site) {
  if (reading === null || typeof reading !== 'object') return { page: 'none', ok: false, why: 'the page did not answer' };
  if (typeof reading.href === 'string' && reading.href.startsWith(site.offline)) {
    return { page: 'offline', ok: false, why: 'the app is showing its offline page: the site did not load' };
  }
  if (reading.origin !== site.origin) return { page: 'elsewhere', ok: false, why: `the page is ${reading.origin} (${reading.href}), not the site` };
  if (reading.turnedAway) {
    const seen = { page: 'turned-away', reason: reading.reason, headline: reading.headline, detail: reading.detail };
    if (!TURNED_AWAY_REASONS.includes(reading.reason)) return { ...seen, ok: false, why: `the page for those turned away gives the reason ${JSON.stringify(reading.reason)}, which is none of ${TURNED_AWAY_REASONS.join(', ')}` };
    if (!reading.heading || !reading.headline) return { ...seen, ok: false, why: `the page for those turned away says nothing: heading ${JSON.stringify(reading.heading)}, headline ${JSON.stringify(reading.headline)}` };
    // In the app there is no app to offer: a download's link means the page took the app for a browser.
    if (reading.download) return { ...seen, ok: false, why: 'the page for those turned away offers the app a download of itself' };
    return { ...seen, ok: true };
  }
  if (reading.landing) {
    if (reading.join && !reading.download) return { page: 'landing', ok: true };
    return { page: 'landing', ok: false, why: `not the desktop landing: join=${reading.join} download=${reading.download}` };
  }
  if (reading.canvas && gameRoute(site.base).test(reading.path)) return { page: 'hike', ok: true };
  if (!reading.canvas && reading.characters === 0) return { page: 'blank', ok: false, why: `a blank page at ${reading.path}` };
  return {
    page: 'other',
    ok: false,
    why: `neither the landing nor the page for those turned away: ${reading.path}, titled ${JSON.stringify(reading.title)}, ${reading.characters} characters of text`,
  };
}

/** Whether a reading has settled on a page the smoke can judge: the landing with its form in, a hike, or the page for those turned away. */
function settled(seen) {
  return seen.page === 'turned-away' || seen.page === 'hike' || (seen.page === 'landing' && seen.ok);
}

/** Whether a page proves the app loaded the site: a hike, or the page for those turned away as the site makes it. */
function proves(seen) {
  return seen.ok === true && (seen.page === 'hike' || seen.page === 'turned-away');
}

/** The smoke's last line: what was counted, which page proved the load, and why the site turned the app away where it did. */
function summaryOf(results, seen) {
  const summary = { passed: results.filter(Boolean).length, failed: results.filter((r) => !r).length, saw: seen.page };
  if (seen.page === 'turned-away') summary.reason = seen.reason;
  return summary;
}

/** The smoke's exit code: 0 where every check counted passed and the last page seen proves the load, 1 otherwise. */
function exitCodeOf(results, seen) {
  return results.length > 0 && results.every(Boolean) && proves(seen) ? 0 : 1;
}

module.exports = { PAGE_READING, TURNED_AWAY_REASONS, exitCodeOf, gameRoute, pageSeen, proves, settled, summaryOf };
