// The comparison's command line and the link a view is shot at: the parts with no browser in them.
import { TIER_SIZES, viewUrl } from "../../frame-budget/lib/views.mjs";

/** The page's size a tier is shot at: the frame budget's standard sizes, and the low tier, which
 * has no standard of its own there, at medium's. */
export const SIZES = Object.freeze({ low: TIER_SIZES.medium, ...TIER_SIZES });

/** What a comparison adds to a view's `?cmd=` script: the wind held at nothing (`/wind 0`), so the
 * grass and the crowns are not bent one way on one page and another way on the next when the clock
 * is held. The rest of a view's script already holds the day (`escalation 0`, `unsettle 0`). */
export const STILL_COMMANDS = Object.freeze(["wind 0"]);

export const USAGE = `npm run compare -- --a <url> --b <url> --out <dir> [--views a,b] [--tier low|medium|high]
    [--engine webgpu|webgl2] [--settle <s>] [--frames <n>] [--remote <port>] [--floor]

  --a <url>         build A's base: the dev server (http://localhost:5173/dayhike), the live site, a preview channel
  --b <url>         build B's base
  --out <dir>       where the pictures and compare.json go (made if absent)
  --views a,b       only these views of tools/frame-budget/views.json; every view without \`check\` by default
  --tier <tier>     the quality both builds are opened at, and the page's size (high by default)
  --engine <name>   the engine forced on both pages (?engine=); the game's own choice by default
  --settle <s>      seconds from the world ready to the clock's hold (30 by default), plus the view's extraSettleS
  --frames <n>      frames the game draws on the held clock before the picture is taken (320 by default)
  --remote <port>   a Chrome already running behind a forwarded port, instead of one started here
  --floor           build A shot twice and scored against itself: the difference the method leaves`;

/** The options of `argv`, or an error that says what is wrong with it. */
export function parseArgs(argv) {
  const options = { a: undefined, b: undefined, out: undefined, views: [], tier: "high", engine: undefined, settle: 30, frames: 320, remote: undefined, floor: false };
  const value = (i, arg) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
    return v;
  };
  const count = (v, arg) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${arg} needs a whole number of at least 1, got ${v}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--a") options.a = value(++i, arg);
    else if (arg === "--b") options.b = value(++i, arg);
    else if (arg === "--out") options.out = value(++i, arg);
    else if (arg === "--views") options.views = value(++i, arg).split(",").filter((v) => v !== "");
    else if (arg === "--tier") options.tier = value(++i, arg);
    else if (arg === "--engine") options.engine = value(++i, arg);
    else if (arg === "--settle") {
      options.settle = Number(value(++i, arg));
      if (!Number.isFinite(options.settle) || options.settle < 0) throw new Error(`--settle needs seconds, got ${argv[i]}`);
    } else if (arg === "--frames") options.frames = count(value(++i, arg), arg);
    else if (arg === "--remote") options.remote = count(value(++i, arg), arg);
    else if (arg === "--floor") options.floor = true;
    else throw new Error(`unknown option ${arg}`);
  }
  for (const required of ["a", "b", "out"]) {
    if (options[required] === undefined) throw new Error(`--${required} is required`);
  }
  for (const build of ["a", "b"]) {
    if (!/^https?:\/\//.test(options[build])) throw new Error(`--${build} needs an http or https URL, got ${options[build]}`);
  }
  if (!Object.hasOwn(SIZES, options.tier)) throw new Error(`--tier must be ${Object.keys(SIZES).join(", ")}, got ${options.tier}`);
  if (options.engine !== undefined && options.engine !== "webgpu" && options.engine !== "webgl2") throw new Error(`--engine is webgpu or webgl2, not ${options.engine}`);
  return options;
}

/**
 * The URL a view is shot at on `base`: the frame budget's link for it (`viewUrl`) with
 * `STILL_COMMANDS` after the view's own commands, and in the measurement mode (`?gpuTime`), under
 * which the game holds the render scale at the window's pixels: without it a slow stretch before
 * the hold leaves one build's frame drawn at 87 % and the other's at full.
 */
export function stillViewUrl(base, game, tier, view, still, { engine = undefined } = {}) {
  const url = viewUrl(base, game, tier, view, still, { gpuTime: true, engine });
  const more = STILL_COMMANDS.map((c) => `;${encodeURIComponent(c)}`).join("");
  return url.replace(/(\?cmd=[^&]*)/, `$1${more}`);
}
