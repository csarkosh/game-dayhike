// The phone harness's pure parts (phone.mjs is the driver): its arguments, the joystick's
// touches, the user-agent check, a window's row and a window's jobs, and the phone's own state
// through adb (how warm it is, and the wait until it is cool). Tested without a phone.
import { execFileSync } from "node:child_process";

/** Thumb travel from the stick's base that reads as full deflection, CSS px (touchControls.ts STICK_RADIUS). */
export const STICK_FORWARD = 60;

/** Seconds without a streaming slice after which `--steer` turns the walker: a walker that moves crosses a cell every two to three seconds. */
export const STEER_STILL_S = 3;
/** The look swipe `--steer` makes on a second touch: from x 340 along y 300 by -260 px, in eight moves 40 ms apart (the right half of a phone's screen turns the view). */
export const STEER_SWIPE = { x: 340, y: 300, dx: -260, steps: 8, id: 2 };

/** The options, with the defaults; throws on a missing `--base` or `--out`, or an option not known. */
export function parseArgs(argv) {
  const o = { base: undefined, out: undefined, tier: "low", views: [], windows: 1, settle: 0, port: 9222, label: "phone", tag: "", profile: false, steer: false, engine: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} takes a value`);
      return value;
    };
    if (a === "--base") o.base = v();
    else if (a === "--out") o.out = v();
    else if (a === "--tier") o.tier = v();
    else if (a === "--views") o.views = v().split(",").filter(Boolean);
    else if (a === "--windows") o.windows = Number(v());
    else if (a === "--settle") o.settle = Number(v());
    else if (a === "--port") o.port = Number(v());
    else if (a === "--label") o.label = v();
    else if (a === "--tag") o.tag = v();
    else if (a === "--profile") o.profile = true;
    else if (a === "--steer") o.steer = true;
    else if (a === "--engine") {
      o.engine = v();
      if (o.engine !== "webgpu" && o.engine !== "webgl2") throw new Error("--engine takes webgpu or webgl2");
    } else throw new Error(`unknown option ${a}`);
  }
  if (!o.base) throw new Error("--base <url> is required");
  if (!o.out) throw new Error("--out <dir> is required");
  return o;
}

/** The touch points that hold the joystick forward: a finger landing on the base's centre, then six moves up to `forward` px. */
export function stickTouches(base, forward = STICK_FORWARD) {
  const points = [{ x: base.x, y: base.y }];
  for (let i = 1; i <= 6; i++) points.push({ x: base.x, y: base.y - (forward * i) / 6 });
  return points;
}

/**
 * The page's own count of the streaming jobs' slices (`--steer` reads it): a walker that moves crosses a cell every two or
 * three seconds and each crossing's rebuild runs slices, one that stands against a trunk or a slope makes none. Read
 * from `window.__syncJobs()`, which the measurement mode exposes; installed before the page's own scripts run.
 */
export const ACT_SCRIPT = `(() => { window.__act = 0; const loop = () => { try { const j = window.__syncJobs && window.__syncJobs(); if (j) window.__act += j.slices + j.idle; } catch {} requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()`;

/**
 * The touches of a look swipe made while the joystick's finger (id 1, at `held`) stays down: the second finger lands
 * at the swipe's start and moves `dx` px along x in `steps` moves, each frame of touches carrying both fingers, as the
 * page reads a touch list whole. Each entry is one `Input.dispatchTouchEvent`'s points.
 */
export function swipeTouches(held, swipe = STEER_SWIPE) {
  const first = { x: held.x, y: held.y, id: 1 };
  const frames = [[first, { x: swipe.x, y: swipe.y, id: swipe.id }]];
  for (let i = 1; i <= swipe.steps; i++) frames.push([first, { x: swipe.x + (swipe.dx * i) / swipe.steps, y: swipe.y, id: swipe.id }]);
  return frames;
}

/**
 * The steering's decision, fed the page's count of slices once a second: true when the count has not moved for
 * `stillS` readings (the walker is stuck), and the count of stuck seconds starts again. Pure; `phone.mjs` makes the swipe.
 */
export function createSteering(stillS = STEER_STILL_S) {
  let last = null;
  let still = 0;
  return {
    feed(count) {
      still = last !== null && count === last ? still + 1 : 0;
      last = count;
      if (still < stillS) return false;
      still = 0;
      return true;
    },
  };
}

/** Whether the browser is Android's Chrome, the only kind this harness drives. */
export function isAndroid(userAgent) {
  return /\bAndroid\b/.test(userAgent);
}

const round2 = (x) => Math.round(x * 100) / 100;

/** What a window added to a page's counters: the end's reading less the start's, key by key; null where either is missing. */
function added(pair) {
  if (!pair || !pair.start || !pair.end) return null;
  return Object.fromEntries(Object.keys(pair.end).map((key) => [key, round2(pair.end[key] - (pair.start[key] ?? 0))]));
}

/** A window's row: the frames summarised, the slow ones and the stalls counted, and what was measured where. */
export function rowOf(window, sample, about) {
  const frames = sample.frames;
  const n = frames.length;
  if (n < 10) throw new Error(`a window needs at least 10 frames, got ${n}`);
  const mean = round2(frames.reduce((s, x) => s + x, 0) / n);
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = round2(sorted[Math.floor(0.95 * n)]);
  return {
    time: new Date().toISOString(),
    machine: about.label,
    tag: about.tag,
    browser: about.browser,
    gpu: sample.gpu ?? null,
    base: about.base,
    tier: about.tier,
    engine: about.engine ?? null,
    ran: sample.ran ?? null,
    view: about.view,
    window,
    mean,
    p95,
    n,
    fps: Math.round(1000 / mean),
    max: Math.round(Math.max(...frames)),
    over20: frames.filter((f) => f > 20).length,
    stalls: frames.filter((f) => f > 100).length,
    canvas: { start: sample.canvasStart, end: sample.canvasEnd },
    dpr: sample.dpr ?? null,
    inner: sample.inner ?? null,
    readyS: sample.readyS,
    walking: about.walking ?? false,
    jobs: sample.jobs ?? null,
    // On WebGPU, what the window added: the stages the shipped maps had (`hits`) and those
    // translated in the page (`misses`, with their milliseconds), and the pipelines asked for,
    // landed, made while a frame waited (`sync`), and the frames held and draws left out for them.
    wgsl: added(sample.wgsl),
    pipes: added(sample.pipes),
    phone: about.phone ?? null,
    frames: frames.map(round2),
  };
}

/**
 * A window's jobs, summed over its frames' `jobs` readings (`window.__syncJobs()` in the measurement mode); null when no
 * frame carried one. The milliseconds and the slices are sums over the frames; `lateJobs` and `overdueJobs` count a job
 * once a frame it was late in or run to its end in; `longest` is the longest single slice by owner, the last reading's
 * (the window began by resetting it), and `learned` the last reading's apply cost by owner.
 */
export function jobsOf(frames) {
  let any = false;
  const out = {
    ms: 0, lateMs: 0, frames: 0, lateFrames: 0, owners: {},
    slices: 0, idle: 0, late: 0, lateJobs: 0, overdue: 0, overdueJobs: 0, overdueFrames: 0, longest: {}, learned: {},
  };
  // A dozen readings or more that are all one and the same is a readout that handed the
  // scheduler's live record out by reference, and every reading is the last frame's: refused,
  // so a window's sums are never one frame's counts times its frame count.
  const read = frames.map((f) => f?.jobs).filter((j) => j != null);
  if (read.length >= 10 && read[0].ms > 0 && read.every((j) => JSON.stringify(j) === JSON.stringify(read[0]))) {
    throw new Error(`the jobs' readings alias one record (${read.length} readings all ${JSON.stringify(read[0])}); the page's __syncJobs must hand out a copy`);
  }
  for (const f of frames) {
    out.frames++;
    const j = f?.jobs;
    if (j == null) continue;
    any = true;
    out.ms += j.ms;
    out.lateMs += j.lateMs;
    if (j.lateMs > 0) out.lateFrames++;
    out.slices += j.slices ?? 0;
    out.idle += j.idle ?? 0;
    out.late += j.late ?? 0;
    out.lateJobs += j.lateJobs ?? 0;
    out.overdue += j.overdue ?? 0;
    out.overdueJobs += j.overdueJobs ?? 0;
    if ((j.overdue ?? 0) > 0) out.overdueFrames++;
    for (const [owner, ms] of Object.entries(j.owners ?? {})) out.owners[owner] = (out.owners[owner] ?? 0) + ms;
    out.longest = j.longest ?? out.longest;
    out.learned = j.learned ?? out.learned;
  }
  if (!any) return null;
  out.ms = round2(out.ms);
  out.lateMs = round2(out.lateMs);
  for (const k of Object.keys(out.owners)) out.owners[k] = round2(out.owners[k]);
  for (const k of Object.keys(out.longest)) out.longest[k] = round2(out.longest[k]);
  for (const k of Object.keys(out.learned)) out.learned[k] = round2(out.learned[k]);
  return out;
}

/** The phone's battery temperature and thermal status through adb; a field is absent where adb gave nothing. */
export function phoneState(run = execFileSync) {
  const out = {};
  try {
    const m = /temperature: (\d+)/.exec(run("adb", ["shell", "dumpsys", "battery"], { encoding: "utf8" }));
    if (m) out.batteryTempC = Number(m[1]) / 10;
  } catch {}
  try {
    const m = /Thermal Status: (\d+)/.exec(run("adb", ["shell", "dumpsys", "thermalservice"], { encoding: "utf8" }));
    if (m) out.thermalStatus = Number(m[1]);
  } catch {}
  return out;
}

/** A phone cool enough to time: three runs back to back warm a Pixel 9 until a fourth runs about 2.5 times slower. */
export const COOL = { thermalStatus: 0, batteryTempC: 34.5 };

export function isCool(state) {
  return state.thermalStatus !== undefined && state.batteryTempC !== undefined && state.thermalStatus <= COOL.thermalStatus && state.batteryTempC <= COOL.batteryTempC;
}

/** Waits, reading every `everyS`, until the phone is cool or `maxS` have passed; refuses at once a phone adb cannot read. */
export async function waitUntilCool({ maxS = 720, everyS = 15, read = phoneState, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const from = now();
  for (let first = true; ; first = false) {
    const state = read();
    if (first && state.thermalStatus === undefined && state.batteryTempC === undefined) throw new Error("no phone answers adb: is it plugged in, unlocked, and USB debugging allowed?");
    const waitedS = Math.round((now() - from) / 1000);
    if (isCool(state)) return { cool: true, waitedS, ...state };
    if (waitedS >= maxS) return { cool: false, waitedS, ...state };
    await sleep(everyS * 1000);
  }
}
