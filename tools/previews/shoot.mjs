#!/usr/bin/env node
// The README's stills (`branding/previews/*.png`), shot again the same way every time: each
// entry of `stills.json` is a place in a named world, and this opens the game there on the
// free camera under the conditions the game starts with, hides the roster, waits for the
// scene to settle, and writes the frame at 1200x675 with nothing but the image in it.
//
//   npm run previews                       every still, from the dev server (http://localhost:5173)
//   npm run previews -- --base https://games.csarko.sh/dayhike    from the live site
//   npm run previews -- tarn crest         only these
//   npm run previews -- --settle 80        wait longer for the scene (seconds; 55 by default)
//   npm run previews -- --cards            only the postcards, from the stills already shot (no browser)
//
// Beside each still its postcard (`<name>.card.png`, lib/postcard.mjs): the frame faded on an aged
// paper border, worn as old mail is, tilted by its name, shadowed, on a transparent ground, which
// the README lays out; the one `stills.json` names under `stamp` carries a postage stamp with the
// title, the author and the year, its picture a cut of the still.
//
// Needs Google Chrome (`CHROME` names another binary). Chrome opens as a window, not headless:
// the stills are shot on the WebGPU path at the high tier, which headless Chrome does not give.
// A still's name is its file's; the README's captions name what each shows.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { postcard } from "./lib/postcard.mjs";
import { stillUrl, stripPng } from "./lib/still.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = fileURLToPath(new URL("../../branding/previews/", import.meta.url));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_BASE = "http://localhost:5173/dayhike";
const WIDTH = 1920;
const HEIGHT = 1080;
/** The frame's size on disk: the render scaled down by this. */
const SCALE = 0.625;

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, settle: 55, names: [], cards: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i];
    else if (arg === "--settle") options.settle = Number(argv[++i]);
    else if (arg === "--cards") options.cards = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else options.names.push(arg);
  }
  if (!options.base) throw new Error("--base needs a URL");
  if (!Number.isFinite(options.settle) || options.settle < 0) throw new Error("--settle needs seconds");
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A CDP session: `send(method, params)` resolving to the result. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (m) => {
        waiting.delete(n);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
}

async function evaluate(page, expression) {
  const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** Opens Chrome on a fresh profile with remote debugging; resolves to the browser session, the
 * first page's session and a `close()`. */
async function openChrome() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME)`);
  const profile = join(tmpdir(), "dayhike-previews-profile");
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${WIDTH},${HEIGHT}`,
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--autoplay-policy=no-user-gesture-required",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; !existsSync(portFile); i++) {
    if (i > 150) throw new Error("Chrome did not open its debugging port");
    await sleep(200);
  }
  const [port, path] = readFileSync(portFile, "utf8").split(/\r?\n/);
  const browser = await connect(`ws://127.0.0.1:${port}${path}`);
  let target;
  for (let i = 0; !target; i++) {
    if (i > 50) throw new Error("Chrome opened no page");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find((t) => t.type === "page");
    if (!target) await sleep(200);
  }
  const page = await connect(target.webSocketDebuggerUrl);
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const close = async () => {
    await browser("Browser.close").catch(() => undefined);
    await sleep(500);
    if (proc.exitCode === null) proc.kill();
  };
  return { page, close };
}

/** One still: the page at its URL, the scene settled, the roster hidden, the frame scaled. */
async function shoot(page, url, settle) {
  await page("Page.navigate", { url });
  for (let i = 0; i < 120; i++) {
    if (await evaluate(page, "!!document.querySelector('canvas')")) break;
    if (i === 119) throw new Error("the game's canvas never appeared");
    await sleep(500);
  }
  await sleep(settle * 1000);
  // The roster, the HUD's voice and status lines, and the command bar: not the game's view.
  await evaluate(page, "document.querySelectorAll('.roster, .hud, .cmdbar').forEach((e) => { e.style.display = 'none'; }); true");
  await sleep(1500);
  const shot = await page("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: SCALE },
  });
  return stripPng(Buffer.from(shot.data, "base64"));
}

/** The still's postcard beside it, with the postage stamp where `stills.json` says (`stamp.still`). */
async function writeCard(name, png, mark) {
  const card = await postcard(png, name, mark);
  const out = join(OUT, `${name}.card.png`);
  writeFileSync(out, card);
  process.stdout.write(`  wrote ${out} (${card.length} bytes)\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(readFileSync(join(HERE, "stills.json"), "utf8"));
  const known = new Set(config.stills.map((s) => s.name));
  for (const name of options.names) if (!known.has(name)) throw new Error(`no still named ${name}; stills.json has ${[...known].join(", ")}`);
  const chosen = options.names.length === 0 ? config.stills : config.stills.filter((s) => options.names.includes(s.name));
  const markFor = (still) => (config.stamp?.still === still.name ? config.stamp : undefined);
  if (options.cards) {
    for (const still of chosen) await writeCard(still.name, readFileSync(join(OUT, `${still.name}.png`)), markFor(still));
    return;
  }
  const probe = await fetch(options.base, { redirect: "manual" }).catch(() => null);
  if (probe === null) throw new Error(`nothing answers at ${options.base}: start the dev server (npm run dev) or pass --base`);
  const { page, close } = await openChrome();
  try {
    for (const still of chosen) {
      const url = stillUrl(options.base, config, still);
      process.stdout.write(`${still.name}: ${url}\n`);
      const png = await shoot(page, url, options.settle);
      const out = join(OUT, `${still.name}.png`);
      writeFileSync(out, png);
      process.stdout.write(`  wrote ${out} (${png.length} bytes)\n`);
      await writeCard(still.name, png, markFor(still));
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
