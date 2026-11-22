#!/usr/bin/env node
// Two builds of the game, one still each of the same views, and how far apart the stills are: what
// a change to the renderer is looked at with. Each view of the frame budget's list is opened on
// build A and then on build B, on one Chrome, one page at a time; the world is waited for and
// settled, the page's clock is held and the game left to draw on it (lib/shoot.mjs), and the
// canvas's picture is taken. The two pictures are scored (lib/score.mjs) and laid side by side with
// their difference.
//
//   npm run compare -- --a <url> --b <url> --out <dir> [--views forest,trailhead] [--tier low|medium|high]
//       [--engine webgpu|webgl2] [--settle 30] [--frames 320] [--remote <port>] [--floor]
//
// Written to --out: `<view>-a.png`, `<view>-b.png`, `<view>-diff.jpg` (A, B and their absolute
// difference amplified, left to right) and `compare.json`, the rows; with --floor also
// `<view>-a2.png` and `<view>-floor.jpg`, build A's second still and its sheet against the first.
// One line a view is printed, the progress on stderr. The options are in lib/args.mjs.
//
// A report, not a verdict: the exit is 0 whatever the scores say, 2 for arguments it cannot run
// with, and 1 when a still could not be taken (no browser, a page that never became ready).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attachChrome, launchChrome, version } from "../frame-budget/lib/cdp.mjs";
import { resolveViews } from "../frame-budget/lib/views.mjs";
import { SIZES, USAGE, parseArgs, stillViewUrl } from "./lib/args.mjs";
import { rounded, score, scoreLine } from "./lib/score.mjs";
import { pixels, sheet } from "./lib/sheet.mjs";
import { shoot } from "./lib/shoot.mjs";

// The game's root: these tools are started from it (an npm script of the game's), so the game's own files
// (its stills, views and budgets, its branding, its runs) are found from here and never from this script's location.
const GAME = process.cwd();
const VIEWS = join(GAME, "tools/frame-budget/views.json");
const STILLS = join(GAME, "tools/previews/stills.json");

const say = (text) => process.stderr.write(`${text}\n`);

/** What a row keeps of a still besides its picture. */
const about = ({ readyS, heldAt, canvas, reads, errors }) => ({ readyS, heldAt, canvas, reads, errors });

/** Picture `b` against picture `a`: the scores, and the sheet written to `path`. */
async function against(a, b, path) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`the stills are not one size: ${a.width} by ${a.height} and ${b.width} by ${b.height}`);
  }
  writeFileSync(path, await sheet(a, b));
  return rounded(score(a.data, b.data, a));
}

async function main() {
  let options;
  let views;
  const stills = JSON.parse(readFileSync(STILLS, "utf8"));
  try {
    options = parseArgs(process.argv.slice(2));
    views = resolveViews(JSON.parse(readFileSync(VIEWS, "utf8")), stills, options.views);
    if (views.length === 0) throw new Error("no views to compare");
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  const size = SIZES[options.tier];
  mkdirSync(options.out, { recursive: true });
  const remote = options.remote !== undefined;
  if (!remote) {
    for (const base of new Set([options.a, options.b])) {
      const probe = await fetch(base, { redirect: "manual" }).catch(() => null);
      if (probe === null) throw new Error(`nothing answers at ${base}: start the dev server (npm run dev) or check the URL`);
    }
  }
  // A window as the previews', frames capped as a player's are: nothing here is timed.
  const session = remote ? await attachChrome(options.remote) : await launchChrome({ flags: [] });
  const rows = [];
  let browser;
  try {
    browser = await version(session.port);
    say(`${remote ? "remote browser" : "browser"}: ${browser.browser}\n  ${browser.userAgent}`);
    say(`${options.tier} at ${size.width} by ${size.height}, settled ${options.settle} s, ${options.frames} frames on the held clock`);
    for (const { view, still } of views) {
      const urls = {
        a: stillViewUrl(options.a, stills.game, options.tier, view, still, { engine: options.engine }),
        b: stillViewUrl(options.b, stills.game, options.tier, view, still, { engine: options.engine }),
      };
      const row = { view: view.name, urls, score: null, floor: null, stills: {} };
      rows.push(row);
      const take = async (build, file) => {
        say(`${view.name} ${file}: ${urls[build]}`);
        const shot = await shoot(session, { name: view.name, url: urls[build], size, settle: options.settle + (view.extraSettleS ?? 0), frames: options.frames });
        writeFileSync(join(options.out, `${view.name}-${file}.png`), shot.png);
        row.stills[file] = about(shot);
        for (const e of shot.errors) say(`  the page threw on the held clock: ${e}`);
        return pixels(shot.png);
      };
      try {
        const a = await take("a", "a");
        if (options.floor) row.floor = await against(a, await take("a", "a2"), join(options.out, `${view.name}-floor.jpg`));
        row.score = await against(a, await take("b", "b"), join(options.out, `${view.name}-diff.jpg`));
        process.stdout.write(`${view.name}  ${scoreLine(row.score)}${row.floor === null ? "" : `  |  floor (A against A)  ${scoreLine(row.floor)}`}\n`);
      } catch (error) {
        row.error = error.message;
        process.stdout.write(`${view.name}  not compared: ${error.message}\n`);
      }
    }
  } finally {
    await session.close();
  }
  const out = join(options.out, "compare.json");
  const report = {
    time: new Date().toISOString(),
    a: options.a,
    b: options.b,
    tier: options.tier,
    engine: options.engine ?? null,
    size,
    settle: options.settle,
    frames: options.frames,
    browser: browser.browser,
    userAgent: browser.userAgent,
    rows,
  };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`rows: ${out}\n`);
  if (rows.some((r) => r.error !== undefined)) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
