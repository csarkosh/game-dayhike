// The frame-budget harness's way to the browser, over the Chrome DevTools Protocol: a session,
// an expression evaluated in a page, Chrome started on this Mac from a fresh profile or a Chrome
// already running elsewhere attached through a forwarded port, and a page in a browser context
// of its own, so no GPU state or cache carries from one sample into the next. Plumbing only; what
// is measured, and how, is `measure.mjs`'s.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** The window Chrome opens with, as the previews'; the page's size is the emulation's. */
const WINDOW = { width: 1920, height: 1080 };
/** The previews' flags (`tools/previews/shoot.mjs`): a window that is never backgrounded. */
const PREVIEW_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  `--window-size=${WINDOW.width},${WINDOW.height}`,
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--autoplay-policy=no-user-gesture-required",
];
/** A measurement's flags: the frame cap off, so a frame's time is its cost, and WebGPU's
 * timestamp queries allowed. */
export const MEASURE_FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--enable-webgpu-developer-features"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A CDP session: `send(method, params)` resolving to the result, and `send.close()`. A call
 * pending when the socket closes is rejected, so a browser that goes away stops the run. */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  let id = 0;
  let closed = false;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
  });
  ws.onclose = () => {
    closed = true;
    for (const done of [...waiting.values()]) done({ error: { message: "the browser closed the connection" } });
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error(`${method}: the browser closed the connection`));
        return;
      }
      const n = ++id;
      waiting.set(n, (m) => {
        waiting.delete(n);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  send.close = () => ws.close();
  return send;
}

/** The value of `expression` in the page, its promise awaited; throws the page's exception. */
export async function evaluate(page, expression) {
  const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** A DevTools URL as reached from here: a Chrome behind a forwarded port names its own host and
 * port in the URLs it hands out, so the socket is pointed at the local end of the forward. */
const local = (wsUrl, port) => wsUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`);

/** The browser's `/json/version`: its product (`Chrome/141.…`) and user agent. */
export async function version(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
  if (r === null || !r.ok) throw new Error(`no browser answers on 127.0.0.1:${port}`);
  const v = await r.json();
  return { browser: v.Browser, userAgent: v["User-Agent"], wsUrl: v.webSocketDebuggerUrl };
}

/** Chrome started on this Mac from a fresh profile, a directory of its own under the OS temp dir
 * (so a second run never deletes a first run's live profile), with remote debugging: the browser's
 * session, its port and a `close()` that quits it and removes the profile. */
export async function launchChrome({ flags = MEASURE_FLAGS } = {}) {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME)`);
  const profileDir = mkdtempSync(join(tmpdir(), "dayhike-frame-budget-"));
  const proc = spawn(CHROME, [`--user-data-dir=${profileDir}`, "--remote-debugging-port=0", ...PREVIEW_FLAGS, ...flags, "about:blank"], {
    stdio: "ignore",
  });
  let browser;
  const close = async () => {
    await browser?.("Browser.close").catch(() => undefined);
    browser?.close();
    await sleep(500);
    if (proc.exitCode === null) proc.kill();
    // A profile left behind (a helper still writing as it exits) is only a temp dir: never a failure.
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  };
  try {
    const portFile = join(profileDir, "DevToolsActivePort");
    for (let i = 0; !existsSync(portFile); i++) {
      if (proc.exitCode !== null) throw new Error(`Chrome exited (code ${proc.exitCode}) before it opened its debugging port`);
      if (i > 150) throw new Error("Chrome did not open its debugging port");
      await sleep(200);
    }
    const [port, path] = readFileSync(portFile, "utf8").split(/\r?\n/);
    browser = await connect(`ws://127.0.0.1:${port}${path}`);
    return { browser, port: Number(port), close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A Chrome already running, reached on 127.0.0.1:`port` (the rig's, through a forwarded port):
 * the browser's session and a `close()` that leaves it running. */
export async function attachChrome(port) {
  const { wsUrl } = await version(port);
  const browser = await connect(local(wsUrl, port));
  return {
    browser,
    port,
    close: async () => {
      browser.close();
    },
  };
}

/** A page in a browser context of its own, in front, with the page and runtime domains on; its
 * `close()` empties it and disposes the context, which closes the page's window. */
export async function openPage(browser, port) {
  const { browserContextId } = await browser("Target.createBrowserContext");
  let page;
  const close = async () => {
    if (page !== undefined) {
      await page("Page.navigate", { url: "about:blank" }).catch(() => undefined);
      page.close();
    }
    await browser("Target.disposeBrowserContext", { browserContextId }).catch(() => undefined);
  };
  try {
    const { targetId } = await browser("Target.createTarget", {
      url: "about:blank",
      browserContextId,
      newWindow: true,
      width: WINDOW.width,
      height: WINDOW.height,
    });
    let target;
    for (let i = 0; !target; i++) {
      if (i > 50) throw new Error("the new page never appeared in /json/list");
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((t) => t.id === targetId);
      if (!target) await sleep(200);
    }
    page = await connect(local(target.webSocketDebuggerUrl, port));
    await page("Page.enable");
    await page("Runtime.enable");
    await page("Page.bringToFront");
    return { page, contextId: browserContextId, close };
  } catch (error) {
    await close();
    throw error;
  }
}
