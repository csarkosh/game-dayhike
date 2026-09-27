/**
 * The startup probe's arithmetic and its order of record writes, and the tier
 * the page starts a hike at. Babylon-free: the scene, the screen, the storage
 * and the clock come in as `StartupDeps` (the page's own are `probeDeps`, in
 * `probeScene.ts`), so every branch is tested with plain objects.
 *
 * Where the browser will not name the GPU (the probed classes of
 * `gpuClass.ts`), a few seconds of the heaviest standard view decide, once per
 * GPU and browser, before that machine's first hike: the canopy pose rendered
 * at the class's ceiling, `PROBE_WARMUP_FRAMES` discarded and `PROBE_FRAMES`
 * measured. A tier holds when the mean interval is at most `PROBE_HOLD_MS`.
 *
 * The browser never delivers frames faster than the display refreshes, so on a
 * 60 Hz display a tier with room to spare reads the same 16.67 ms as one with
 * none: a reading certifies "at least 60 Hz here" and nothing more. The probe
 * therefore never infers headroom and never steps up. It starts at the ceiling
 * and steps down: a miss at high measures medium once, and any other miss
 * settles on low, which is the floor and is never measured.
 */
import { elevationAt } from "../sim/terrain.js";
import { classifyGpu, gpuIdentity, type GpuClass } from "./gpuClass.js";
import type { GpuSignals } from "./gpuSignals.js";
import {
  autoTier,
  withinClass,
  withProbeStarted,
  withVerdict,
  type AutoRecord,
  type ProbeReading,
  type QualityTier,
} from "./quality.js";
import { seedFromToken } from "./seed.js";
import {
  parseProbeOverride,
  parseTierOverride,
  readAutoRecord,
  resolveTier,
  writeAutoRecord,
  type TierSource,
} from "./tierChoice.js";

/** A tier holds at a mean interval up to this: the 60 Hz budget (16.67 ms)
 * plus 5 %, room for a timer's jitter and one garbage collection in 120
 * frames (a single 50 ms hitch lifts the mean by 0.28 ms). */
export const PROBE_HOLD_MS = 17.5;
/** Frames discarded once the scene is ready: the fields' first rebuilds, the
 * reflection probe, the first shadow renders. */
export const PROBE_WARMUP_FRAMES = 60;
/** Frame intervals measured after the warm-up. */
export const PROBE_FRAMES = 120;
/** Fewer intervals than this left after the stalls are dropped is no reading. */
export const PROBE_MIN_FRAMES = 100;
/** An interval over this is a stall (a hidden tab, a collection), not a frame. */
export const PROBE_STALL_MS = 250;
/** The scene is ready once no shader has compiled for this long. */
export const PROBE_QUIET_MS = 1500;
/** A scene not ready in this long gives up its step. */
export const PROBE_READY_MAX_MS = 15_000;
/** The whole probe, every step, is abandoned after this. */
export const PROBE_MAX_MS = 30_000;
/** The seed of every rendering note's canopy pose (627994160). */
export const PROBE_SEED_TOKEN = "atmo";
/** Noon, the canopy pose's hour. */
export const PROBE_HOUR = 12;

/** The canopy pose, where the eye stands on the ground at `x`, `z`. */
const POSE = { x: 123, z: -105.5, yaw: 1.571, pitch: 0.3, eye: 1.6 } as const;

export type ProbeStats = { frames: number; meanMs: number; p95Ms: number };

/**
 * The mean and 95th percentile of a run of frame intervals, with stalls over
 * `PROBE_STALL_MS` (and anything that is not a time) dropped, or null when
 * fewer than `PROBE_MIN_FRAMES` are left.
 */
export function readIntervals(intervals: readonly number[]): ProbeStats | null {
  const kept = intervals.filter((ms) => Number.isFinite(ms) && ms >= 0 && ms <= PROBE_STALL_MS);
  if (kept.length < PROBE_MIN_FRAMES) return null;
  const meanMs = kept.reduce((sum, ms) => sum + ms, 0) / kept.length;
  const sorted = [...kept].sort((a, b) => a - b);
  const p95Ms = sorted[Math.ceil(0.95 * sorted.length) - 1] ?? meanMs;
  return { frames: kept.length, meanMs, p95Ms };
}

/** Whether a reading holds 60 Hz. */
export function probeHolds(stats: { meanMs: number }): boolean {
  return stats.meanMs <= PROBE_HOLD_MS;
}

/**
 * What to do next, from the ceiling and the readings so far: measure the
 * ceiling first; a reading that holds is the verdict; a miss at high with no
 * medium reading measures medium; any other miss is low. Low is never
 * measured, and nothing ever steps up.
 */
export function nextProbeStep(
  ceiling: QualityTier,
  readings: readonly ProbeReading[],
): { measure: QualityTier } | { verdict: QualityTier } {
  if (ceiling === "low") return { verdict: "low" };
  const last = readings[readings.length - 1];
  if (last === undefined) return { measure: ceiling };
  if (probeHolds(last)) return { verdict: last.tier };
  if (last.tier === "high" && !readings.some((reading) => reading.tier === "medium")) return { measure: "medium" };
  return { verdict: "low" };
}

/**
 * Every rendering note's canopy pose: seed `atmo`, the free camera at
 * (123, ground + 1.6, −105.5), yaw 1.571, pitch 0.3. The heaviest standard view,
 * and every measurement in the repository is taken there, so a probe reading
 * reads against them. The ground is the active terrain variant's, which
 * `buildProbeScene` sets to the default first.
 */
export function probePose(): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const seed = seedFromToken(PROBE_SEED_TOKEN);
  return { x: POSE.x, y: elevationAt(seed, POSE.x, POSE.z) + POSE.eye, z: POSE.z, yaw: POSE.yaw, pitch: POSE.pitch };
}

/** One reading as the page logs it:
 * `quality probe: high 23.96 ms mean, 33.4 p95, 120 frames, 1920×1080, webgl2 → misses`. */
export function probeReadingLine(reading: ProbeReading, width: number, height: number): string {
  const p95 = Math.round(reading.p95Ms * 10) / 10;
  const answer = probeHolds(reading) ? "holds" : "misses";
  return `quality probe: ${reading.tier} ${reading.meanMs.toFixed(2)} ms mean, ${p95} p95, ${reading.frames} frames, ${width}×${height}, ${reading.engine} → ${answer}`;
}

/** Which record a probe's attempt and verdict are written to. */
export type ProbeKey = { gpu: string; browser: number; cls: GpuClass };

export type ProbeDeps = {
  storage: Storage | null;
  /** Measures one tier; null when it cannot (a cancel, a scene that never
   * readies, too few frames). */
  runStep(tier: QualityTier): Promise<ProbeReading | null>;
  /** The game container's area, `containerPixels`. */
  pixels(): number;
  now(): number;
};

/**
 * One probe, from `from` down, returning the tier to start the hike at: the
 * verdict, or `start` when the probe cannot run or is abandoned. The order of
 * its record writes is what keeps the attempt cap honest:
 *
 * 1. A window with no area is never measured, and nothing is written: it
 *    certifies nothing, and its verdict would never hold again.
 * 2. The attempt is written before the first `await`, so a tab closed
 *    mid-probe has still spent it; and where the write fails nothing is
 *    measured at all, since a storage that refuses writes reads back no
 *    attempts on every load and would otherwise probe before every hike.
 * 3. A step that reads nothing (or throws) abandons, the attempt standing.
 * 4. The verdict is written with the same area as step 1, the area
 *    `AutoInput.pixels` reads, so it holds on the next load at this window.
 */
export async function runProbe(
  from: QualityTier,
  start: QualityTier,
  record: AutoRecord | null,
  key: ProbeKey,
  deps: ProbeDeps,
): Promise<QualityTier> {
  const pixels = deps.pixels();
  if (!(pixels > 0)) return start;
  const started = withProbeStarted(record, key.gpu, key.browser, key.cls);
  if (!writeAutoRecord(deps.storage, started)) return start;
  const readings: ProbeReading[] = [];
  for (;;) {
    const step = nextProbeStep(from, readings);
    if ("verdict" in step) {
      const verdict = { tier: step.verdict, source: "probe" as const, pixels, at: deps.now(), readings };
      const next = withVerdict(started, key.gpu, key.browser, key.cls, verdict);
      if (next !== null) writeAutoRecord(deps.storage, next);
      return step.verdict;
    }
    let reading: ProbeReading | null;
    try {
      reading = await deps.runStep(step.measure);
    } catch {
      reading = null;
    }
    if (reading === null) return start;
    readings.push(reading);
  }
}

/** What `startupTier` needs of the page. */
export type StartupDeps = {
  storage: Storage | null;
  /** The game container's area, `containerPixels`. */
  pixels(): number;
  now(): number;
  /** Measures one tier on a fresh canvas; null on a cancel or a failure. */
  runStep(tier: QualityTier, cancelled: () => boolean): Promise<ProbeReading | null>;
  /** The "Setting up graphics…" screen over the probe's canvas. */
  showScreen(): { dispose(): void };
  /** A timer; the function returned clears it. */
  setTimer(fn: () => void, ms: number): () => void;
  log(line: string): void;
};

export type StartupTier = { tier: QualityTier; source: TierSource; cls: GpuClass };

/**
 * The tier to build the hike at, and where it came from: `?tier=` over Auto
 * (the player's choice joins with the Settings screen). On Auto, a probed
 * class with no verdict that holds and fewer than three attempts is probed
 * first behind the screen, from its ceiling, or any class from `?probe=`; the
 * probe is bounded at `PROBE_MAX_MS`, and stops at once when `opts.cancelled`
 * says the page has moved on. A probe's verdict is never taken above what the
 * class may take on this machine. Logs one line for the probe's outcome and
 * one for the tier.
 */
export async function startupTier(
  signals: GpuSignals,
  opts: { search: string; cancelled(): boolean },
  deps: StartupDeps,
): Promise<StartupTier> {
  const cls = classifyGpu(signals);
  const gpu = gpuIdentity(signals);
  const record = readAutoRecord(deps.storage);
  const auto = autoTier({
    cls,
    cores: signals.cores,
    memoryGb: signals.memoryGb,
    record,
    gpu,
    browser: signals.browser,
    pixels: deps.pixels(),
    now: deps.now(),
  });
  const decided = resolveTier({ override: parseTierOverride(opts.search), choice: "auto", auto: auto.tier });
  let tier = decided.tier;
  const from = decided.source === "auto" ? (parseProbeOverride(opts.search) ?? auto.probeFrom) : null;
  if (from !== null && !opts.cancelled()) {
    const screen = deps.showScreen();
    let late = false;
    const clear = deps.setTimer(() => {
      late = true;
    }, PROBE_MAX_MS);
    const cancelled = (): boolean => late || opts.cancelled();
    const readings: ProbeReading[] = [];
    let probed: QualityTier;
    try {
      probed = await runProbe(from, auto.tier, record, { gpu, browser: signals.browser, cls }, {
        storage: deps.storage,
        runStep: async (step) => {
          if (cancelled()) return null;
          const reading = await deps.runStep(step, cancelled);
          if (reading !== null) readings.push(reading);
          return reading;
        },
        pixels: () => deps.pixels(),
        now: () => deps.now(),
      });
    } finally {
      clear();
      screen.dispose();
    }
    tier = withinClass(probed, cls, signals.cores, signals.memoryGb);
    const outcome = nextProbeStep(from, readings);
    deps.log(
      "verdict" in outcome
        ? `quality probe: verdict ${outcome.verdict} (${cls})`
        : `quality probe: no verdict, starting at ${tier} (${cls})`,
    );
  }
  deps.log(`quality: ${tier} (${decided.source}, ${cls}), engine webgl2`);
  return { tier, source: decided.source, cls };
}
