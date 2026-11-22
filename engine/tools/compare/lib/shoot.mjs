// One still of one build: the view's page opened on the session's Chrome, its world waited for and
// settled, the page's clock held, the game left to draw on that held clock, and the canvas's
// picture taken. The browser is reached with the frame budget's plumbing (`cdp.mjs`).
import { evaluate, openPage } from "../../frame-budget/lib/cdp.mjs";

/** The page's canvas, waited for as the frame budget waits (60 s at most). */
const CANVAS_TRIES = 120;
const POLL_MS = 500;
/** The world's readiness class, waited for up to this long after the canvas, and the bound on one
 * look at it, so a page that stops answering ends the wait. */
const READY_MAX_S = 180;
const READY_CALL_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `promise`, or an error after `ms`. */
function within(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---- The hold, as it runs in the page ------------------------------------------------------------
// `performance.now` and `Date.now` answer the instant of the hold from here on. The game reads
// nothing else for time (Babylon's frame delta is `performance.now` too), so every frame after is
// a frame of no seconds: the wind's phase, the water, the cloud, the grain, the simulation's tick
// and every fade stay where they are, while the game's own loop goes on drawing, which is what the
// temporal anti-aliasing needs to settle on one picture. `requestAnimationFrame` is left alone: the
// loop is driven by it. The held `performance.now` counts its calls, which is how the tool knows
// the game is still drawing (the loop reads the clock every frame).
//
// Everything in the page but the game's canvas (the largest one) is hidden: the roster, the HUD,
// the command bar, the measurement mode's corner line, whatever a build lays over its picture.
const HOLD_EXPRESSION = `(() => {
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ c, r: c.getBoundingClientRect() }));
  canvases.sort((p, q) => q.r.width * q.r.height - p.r.width * p.r.height);
  const shown = canvases[0];
  if (shown === undefined || shown.r.width < 1 || shown.r.height < 1) return null;
  shown.c.setAttribute("data-compare-shot", "");
  const style = document.createElement("style");
  style.textContent = "body * { visibility: hidden !important; } canvas[data-compare-shot] { visibility: visible !important; }";
  document.head.append(style);
  const at = performance.now();
  const wall = Date.now();
  const hold = { reads: 0 };
  performance.now = () => { hold.reads++; return at; };
  Date.now = () => wall;
  window.__compareHold = hold;
  return { at, wall };
})()`;

/** `frames` animation frames of the page, then what the picture is taken of: the canvas's place in
 * the page, its own pixels, and how often the game read the held clock meanwhile. */
const framesExpression = (frames) => `new Promise((done) => {
  let n = 0;
  const from = window.__compareHold.reads;
  const tick = () => {
    if (++n < ${frames}) { requestAnimationFrame(tick); return; }
    const c = document.querySelector("canvas[data-compare-shot]");
    const r = c ? c.getBoundingClientRect() : null;
    done({
      reads: window.__compareHold.reads - from,
      rect: r && { x: r.x, y: r.y, width: r.width, height: r.height },
      canvas: c && [c.width, c.height],
    });
  };
  requestAnimationFrame(tick);
})`;
// -------------------------------------------------------------------------------------------------

/** Waits for `body.world-ready` on `page`, up to READY_MAX_S; the seconds it took, to 1 dp. */
async function awaitReady(page, name) {
  const start = Date.now();
  for (;;) {
    const ready = await within(evaluate(page, "document.body.classList.contains('world-ready')"), READY_CALL_MS, "no answer").catch(() => false);
    if (ready) break;
    if (Date.now() - start > READY_MAX_S * 1000) throw new Error(`${name}: the world was not ready within ${READY_MAX_S} s`);
    await sleep(POLL_MS);
  }
  return Math.round((Date.now() - start) / 100) / 10;
}

/**
 * The still of `url`: `{ png, readyS, heldAt, canvas, reads, errors }`, the PNG's bytes, the seconds
 * the world took, the page's clock at the hold (ms since the page began), the canvas's own pixels,
 * how often the game read the held clock over the frames, and the exceptions the page threw on it.
 *
 * `session` is the frame budget's (`launchChrome` or `attachChrome`). The page is one of this
 * call's own, opened in a window of its own and closed alone, on a failure too: a Chrome behind a
 * forwarded port keeps the page it had, so it never loses its last one (a Windows Chrome that does
 * exits).
 */
export async function shoot(session, { name, url, size, settle, frames }) {
  const { page, close } = await openPage(session.browser, session.port, { origin: new URL(url).origin });
  try {
    await page("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    let held = false;
    const errors = [];
    page.on("Runtime.exceptionThrown", (e) => {
      if (held) errors.push(e.exceptionDetails?.exception?.description?.split("\n")[0] ?? e.exceptionDetails?.text ?? "an exception");
    });
    const nav = await page("Page.navigate", { url });
    if (nav.errorText) throw new Error(`${url} did not load: ${nav.errorText}`);
    for (let i = 0; ; i++) {
      if (await evaluate(page, "!!document.querySelector('canvas')").catch(() => false)) break;
      if (i === CANVAS_TRIES - 1) throw new Error(`${name}: the game's canvas never appeared at ${url}`);
      await sleep(POLL_MS);
    }
    const readyS = await awaitReady(page, name);
    await sleep(settle * 1000);
    const hold = await evaluate(page, HOLD_EXPRESSION);
    if (hold === null) throw new Error(`${name}: the page has no canvas to take a picture of`);
    held = true;
    const limit = (60 + frames) * 1000;
    const drawn = await within(evaluate(page, framesExpression(frames)), limit, `${name}: ${frames} frames did not pass in ${limit / 1000} s on the held clock (did the page stop drawing?)`);
    if (drawn.rect === null) throw new Error(`${name}: the canvas went away on the held clock`);
    if (drawn.reads === 0) throw new Error(`${name}: the game never read the clock over ${frames} frames of the hold: its loop is not drawing`);
    const shot = await page("Page.captureScreenshot", { format: "png", clip: { ...drawn.rect, scale: 1 } });
    return { png: Buffer.from(shot.data, "base64"), readyS, heldAt: Math.round(hold.at), canvas: drawn.canvas, reads: drawn.reads, errors };
  } finally {
    await close();
  }
}
