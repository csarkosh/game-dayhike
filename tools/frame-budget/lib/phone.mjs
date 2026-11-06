// The phone harness's pure parts (phone.mjs is the driver): its arguments, the joystick's
// touches, the user-agent check, a window's row and a window's jobs. Tested without a phone.

/** Thumb travel from the stick's base that reads as full deflection, CSS px (touchControls.ts STICK_RADIUS). */
export const STICK_FORWARD = 60;

/** The options, with the defaults; throws on a missing `--base` or `--out`, or an option not known. */
export function parseArgs(argv) {
  const o = { base: undefined, out: undefined, tier: "low", views: [], windows: 1, settle: 0, port: 9222, label: "phone", tag: "", profile: false };
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
    else throw new Error(`unknown option ${a}`);
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

/** Whether the browser is Android's Chrome, the only kind this harness drives. */
export function isAndroid(userAgent) {
  return /\bAndroid\b/.test(userAgent);
}

const round2 = (x) => Math.round(x * 100) / 100;

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
    phone: about.phone ?? null,
    frames: frames.map(round2),
  };
}

/** A window's jobs, summed over its frames' `jobs` readings (`window.__syncJobs()` in the measurement mode); null when no frame carried one. */
export function jobsOf(frames) {
  let any = false;
  const out = { ms: 0, lateMs: 0, frames: 0, lateFrames: 0, owners: {} };
  for (const f of frames) {
    out.frames++;
    const j = f?.jobs;
    if (j == null) continue;
    any = true;
    out.ms += j.ms;
    out.lateMs += j.lateMs;
    if (j.lateMs > 0) out.lateFrames++;
    for (const [owner, ms] of Object.entries(j.owners ?? {})) out.owners[owner] = (out.owners[owner] ?? 0) + ms;
  }
  if (!any) return null;
  out.ms = round2(out.ms);
  out.lateMs = round2(out.lateMs);
  for (const k of Object.keys(out.owners)) out.owners[k] = round2(out.owners[k]);
  return out;
}
