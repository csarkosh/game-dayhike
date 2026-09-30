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
 *
 * Nor can it measure anything where the page itself draws below 60 Hz: a
 * display that refreshes slower, or a browser that halves its frame rate
 * (Safari in Low Power Mode, or on a Mac running hot), reads a miss at every
 * tier whatever the GPU. So before the attempt is spent the probe screen's own
 * idle frames are timed, and below 60 Hz the probe is skipped, the class's
 * start tier kept, and nothing written: a later load tries again.
 *
 * Nor can a step settle where every shader links on the page's thread: a
 * WebGL2 context without `KHR_parallel_shader_compile` (Firefox 156) links about
 * one program a frame, each blocking for a few hundred milliseconds, so the
 * scene is never quiet for `PROBE_QUIET_MS` inside `PROBE_READY_MAX_MS`. There
 * the probe is skipped before its screen is shown, the class's start tier kept,
 * and nothing written (`probeStepCanSettle`). A step asks this of the engine it
 * draws with: on WebGPU, Babylon translates each effect's shaders on the
 * page's thread too, so a WebGPU step is not taken to settle until a browser
 * has measured that it does (`WEBGPU_PROBE_STEPS_SETTLE`), and until then
 * tiers that draw on WebGPU are measured on WebGL2 (`probeStepEngine`), whose
 * verdict holds for WebGPU too (`verdictRead`).
 */
import { elevationAt } from "../sim/terrain.js";
import { CLASS_TIERS, classifyGpu, gpuIdentity, type GpuClass } from "./gpuClass.js";
import type { GpuSignals } from "./gpuSignals.js";
import {
  autoTier,
  holdingVerdict,
  withinClass,
  onEngine,
  withProbeStarted,
  withVerdict,
  type AutoRecord,
  type ProbeReading,
  type QualityTier,
  type VerdictEngine,
} from "./quality.js";
import { seedFromToken } from "./seed.js";
import {
  parseProbeOverride,
  parseTierOverride,
  readAutoRecord,
  resolveTier,
  writeAutoRecord,
  type TierChoice,
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
/**
 * What the measured frames may take in all and still hold: `PROBE_FRAMES` ×
 * `PROBE_HOLD_MS`, 2,100 ms. Once the kept intervals sum past it the mean of
 * 120 can only be over the bar, so the step ends there as a miss rather than
 * spend 12 s on 120 frames of 100 ms. It bounds the warm-up too: 60 frames or
 * this much of the warm-up's own intervals, each counted at most 250 ms so a
 * hidden tab does not spend it, whichever comes first, so a slow machine
 * spends at most about 4.2 s of frames on a step (at 100 ms a frame the 60
 * warm-up frames alone were 6 s). A machine that holds reaches 60 warm-up
 * frames in about 1 s, well inside it.
 */
export const PROBE_STEP_BUDGET_MS = PROBE_FRAMES * PROBE_HOLD_MS;
/** An interval over this is a stall (a hidden tab, a collection), not a frame. */
export const PROBE_STALL_MS = 250;
/**
 * Stalls a step's measurement may hold: `PROBE_FRAMES` − `PROBE_MIN_FRAMES`,
 * 20. One more and the 120 can no longer leave the 100 frames a reading
 * needs, so the step ends there as a miss (`readStallMiss`): a machine that
 * takes over 250 ms that often does not hold the tier, and below 4 frames a
 * second every interval is a stall, which the early end, summing frames only,
 * never sees.
 */
export const PROBE_MAX_STALLS = PROBE_FRAMES - PROBE_MIN_FRAMES;
/** The scene is ready once no shader has compiled for this long. */
export const PROBE_QUIET_MS = 1500;
/** A scene not ready in this long gives up its step. */
export const PROBE_READY_MAX_MS = 15_000;
/** The whole probe, every step, is abandoned after this. */
export const PROBE_MAX_MS = 30_000;
/** Idle frames timed on the probe screen before the attempt, about 0.5 s. */
export const PROBE_IDLE_FRAMES = 30;
/** Fewer idle intervals than this left after the stalls are dropped is no reading. */
export const PROBE_IDLE_MIN_FRAMES = 20;
/** The seed of every rendering note's canopy pose (627994160). */
export const PROBE_SEED_TOKEN = "atmo";
/** Noon, the canopy pose's hour. */
export const PROBE_HOUR = 12;

/** The canopy pose, where the eye stands on the ground at `x`, `z`. */
const POSE = { x: 123, z: -105.5, yaw: 1.571, pitch: 0.3, eye: 1.6 } as const;

/** A step's statistics; `early` when it ended as a miss before `PROBE_FRAMES`
 * (`PROBE_STEP_BUDGET_MS`), its mean and p95 then those of the frames measured;
 * `stalls` when it ended as a miss for its stalls (`PROBE_MAX_STALLS`), its
 * mean and p95 then those of every interval measured, stalls included. */
export type ProbeStats = { frames: number; meanMs: number; p95Ms: number; early?: true; stalls?: number };

/** An interval that is a frame: a time, not a stall. */
const isFrame = (ms: number): boolean => Number.isFinite(ms) && ms >= 0 && ms <= PROBE_STALL_MS;

function statsOf(kept: readonly number[]): ProbeStats {
  const meanMs = kept.reduce((sum, ms) => sum + ms, 0) / kept.length;
  const sorted = [...kept].sort((a, b) => a - b);
  const p95Ms = sorted[Math.ceil(0.95 * sorted.length) - 1] ?? meanMs;
  return { frames: kept.length, meanMs, p95Ms };
}

/**
 * The mean and 95th percentile of a run of frame intervals, with stalls over
 * `PROBE_STALL_MS` (and anything that is not a time) dropped, or null when
 * fewer than `PROBE_MIN_FRAMES` are left.
 */
export function readIntervals(intervals: readonly number[]): ProbeStats | null {
  const kept = intervals.filter(isFrame);
  if (kept.length < PROBE_MIN_FRAMES) return null;
  return statsOf(kept);
}

/**
 * The reading of a step ended early: its kept intervals already sum past
 * `PROBE_STEP_BUDGET_MS`, so the mean of the full 120 could only miss. The
 * statistics are those of the frames measured, marked `early`. Its floor is
 * the arithmetic's own: 2,100 ms of intervals of at most 250 ms is at least 9
 * frames. Null while the sum is within the budget.
 */
export function readEarlyMiss(intervals: readonly number[]): ProbeStats | null {
  const kept = intervals.filter(isFrame);
  if (kept.reduce((sum, ms) => sum + ms, 0) <= PROBE_STEP_BUDGET_MS) return null;
  return { ...statsOf(kept), early: true };
}

/**
 * The reading of a step ended for its stalls: more than `PROBE_MAX_STALLS` of
 * its intervals are over `PROBE_STALL_MS`, so it can no longer read 100
 * frames. The statistics are those of every interval measured, stalls
 * included, since they are what the frames took, with the count of stalls:
 * 21 over 250 ms among at most 120 intervals is a mean over 43 ms, a miss
 * whatever the rest read. Null while the stalls are within the bound.
 */
export function readStallMiss(intervals: readonly number[]): ProbeStats | null {
  const measured = intervals.filter((ms) => Number.isFinite(ms) && ms >= 0);
  const stalls = measured.length - measured.filter(isFrame).length;
  if (stalls <= PROBE_MAX_STALLS) return null;
  return { ...statsOf(measured), stalls };
}

/**
 * The page's own frame interval while nothing is drawn but the probe screen:
 * the median of an idle run, the first interval (the screen's own paint) and
 * stalls dropped, or null when too few are left. The median, so one hitch in
 * half a second does not read as a slow display.
 */
export function idleCadenceMs(intervals: readonly number[]): number | null {
  const kept = intervals.slice(1).filter((ms) => Number.isFinite(ms) && ms >= 0 && ms <= PROBE_STALL_MS);
  if (kept.length < PROBE_IDLE_MIN_FRAMES) return null;
  const sorted = [...kept].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * One probe step's frames, as data: `frame` for each render-loop callback,
 * `compiled` whenever a shader compiles. The scene is ready once it says so and
 * no shader has compiled for `PROBE_QUIET_MS`, given up at `readyMaxMs`
 * (`PROBE_READY_MAX_MS` after the build, or less where the probe's cap leaves
 * less: `stepReadyMaxMs`);
 * then `PROBE_WARMUP_FRAMES` are discarded (or fewer, once their intervals,
 * each counted at most `PROBE_STALL_MS`, sum to `PROBE_STEP_BUDGET_MS`) and `PROBE_FRAMES`
 * intervals kept, or fewer where their sum passes `PROBE_STEP_BUDGET_MS`
 * first (`readEarlyMiss`) or more than `PROBE_MAX_STALLS` of them are stalls
 * (`readStallMiss`): then the step ends as a miss. A shader that
 * compiles after the scene is ready starts the warm-up again, so its hitch (a
 * hundred milliseconds or more, which would tip a 60 Hz machine's mean into a
 * miss) is never measured; the probe's 30 s cap bounds the restarts.
 */
export function createProbeMeter(start: number, readyMaxMs: number = PROBE_READY_MAX_MS): {
  readonly ready: boolean;
  compiled(now: number): void;
  frame(now: number, sceneReady: boolean): { done: false } | { done: true; stats: ProbeStats | null };
} {
  let lastCompile = start;
  let ready = false;
  let warm = 0;
  let warmSpent = 0;
  let last = start;
  const intervals: number[] = [];
  return {
    get ready() {
      return ready;
    },
    compiled(now) {
      lastCompile = now;
      if (ready) {
        warm = 0;
        warmSpent = 0;
        intervals.length = 0;
      }
    },
    frame(now, sceneReady) {
      if (!ready) {
        if (now - start > readyMaxMs) return { done: true, stats: null };
        ready = sceneReady && now - lastCompile >= PROBE_QUIET_MS;
        last = now;
        return { done: false };
      }
      if (warm < PROBE_WARMUP_FRAMES) {
        // The warm-up's own intervals, each counted at most `PROBE_STALL_MS`:
        // a tab hidden for seconds spends 250 ms of it, not the whole bound,
        // while a machine under 4 frames a second still reaches the bound.
        const spent = warmSpent + Math.min(Math.max(now - last, 0), PROBE_STALL_MS);
        if (spent < PROBE_STEP_BUDGET_MS) {
          warm += 1;
          warmSpent = spent;
          last = now;
          return { done: false };
        }
      }
      warm = PROBE_WARMUP_FRAMES;
      intervals.push(now - last);
      last = now;
      const stalled = readStallMiss(intervals);
      if (stalled !== null) return { done: true, stats: stalled };
      if (intervals.length >= PROBE_FRAMES) return { done: true, stats: readIntervals(intervals) };
      const early = readEarlyMiss(intervals);
      return early === null ? { done: false } : { done: true, stats: early };
    },
  };
}

/**
 * How long a step has, from its start, to be ready when `leftMs` of the
 * probe's cap is left as it starts: what is left after the frames a step
 * needs once ready (its warm-up and its measurement, at most
 * `PROBE_STEP_BUDGET_MS` each). Two steps each allowed 15 s cannot both fit
 * 30 s: a second step that could only be ready too late to be measured gives
 * up there, rather than at the cap after the player has waited it out. At or
 * under 0 the step is not started. Not capped here: the step's own
 * `PROBE_READY_MAX_MS` is counted from after its build, so the step takes the
 * lesser of the two once its scene is built, and a first step keeps its full
 * 15 s after a slow build.
 */
export function stepReadyMaxMs(leftMs: number): number {
  return leftMs - 2 * PROBE_STEP_BUDGET_MS;
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
 * Whether a probe step on WebGPU is ready (`PROBE_QUIET_MS` without a compile
 * or a new pipeline) inside `PROBE_READY_MAX_MS`. Not taken on trust: Babylon's
 * WebGPU engine translates every effect's shaders on the page's thread as the
 * effect is made (GLSL to SPIR-V by glslang, then to WGSL by Tint, both
 * synchronous, `WebGPUPipelineContext.isAsync` false), and makes each render
 * pipeline at its first draw with `createRenderPipeline`, so a WebGPU step is
 * as busy as a WebGL2 one without `KHR_parallel_shader_compile`. The first
 * reading on a four-core Windows machine drew about 2 frames a second for
 * about 50 s after the page opened. A step that is never ready holds the
 * player behind the probe's screen for its 15 s, writes no verdict, and
 * spends one of the three attempts: so false, the safe value, until a browser
 * has measured, at the canopy pose with an empty shader cache, on the slowest
 * machines whose class is probed, and on each tier probed, the time from a
 * WebGPU step's engine to its meter's `ready`, and found it inside
 * `PROBE_READY_MAX_MS` with margin on every load (a measurement build that
 * sets this true, with `?probe=`). While false, the probe's steps draw on
 * WebGL2 whatever the rule gives their tier (`probeStepEngine`).
 */
export const WEBGPU_PROBE_STEPS_SETTLE = false;

/**
 * Whether a probe step drawing with `engine` can ever be ready: on WebGL2 only
 * where the context exposes `KHR_parallel_shader_compile` (`parallelCompile`
 * true), since without it every program links on the page's thread and the
 * scene is never quiet long enough; on WebGPU as `webgpuSettles` says
 * (`WEBGPU_PROBE_STEPS_SETTLE`). An engine not known yet (null) may be either,
 * so both must settle.
 */
export function probeStepCanSettle(
  parallelCompile: boolean | null,
  engine: VerdictEngine | null,
  webgpuSettles: boolean = WEBGPU_PROBE_STEPS_SETTLE,
): boolean {
  if (engine === null) return probeStepCanSettle(parallelCompile, "webgl2", webgpuSettles) && webgpuSettles;
  return engine === "webgpu" ? webgpuSettles : parallelCompile === true;
}

/**
 * The engine the probe's steps draw with, as far as it is known before they
 * run. `engine` is the one the WebGPU rule gives the high tier (medium's is
 * WebGL2), WebGL2 where none is given. Where it is WebGPU and a
 * WebGPU step cannot settle (`webgpuSettles` false), the steps draw on WebGL2
 * on their own canvases: a WebGL2 verdict holds for WebGPU (`verdictRead`),
 * and the hike then starts on the rule's engine at the verdict's tier. Where
 * a WebGPU step can settle, WebGPU, or null while the adapter has not
 * answered, since a step may still end on WebGL2.
 */
export function probeStepEngine(
  signals: Pick<GpuSignals, "adapterStatus">,
  engine: VerdictEngine | undefined,
  webgpuSettles: boolean = WEBGPU_PROBE_STEPS_SETTLE,
): VerdictEngine | null {
  if ((engine ?? "webgl2") === "webgl2" || !webgpuSettles) return "webgl2";
  return signals.adapterStatus === "timed-out" ? null : "webgpu";
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
 * `quality probe: high 23.96 ms mean, 33.4 p95, 120 frames, 1920×1080, webgl2 → misses`,
 * with `(ended early)` after the frames for a step that ended as a miss before
 * 120, or `(21 over 250 ms)` for one that ended for its stalls. */
export function probeReadingLine(reading: ProbeReading, width: number, height: number): string {
  const p95 = Math.round(reading.p95Ms * 10) / 10;
  const answer = probeHolds(reading) ? "holds" : "misses";
  const why = reading.early === true ? " (ended early)" : reading.stalls !== undefined ? ` (${reading.stalls} over 250 ms)` : "";
  const frames = `${reading.frames} frames${why}`;
  return `quality probe: ${reading.tier} ${reading.meanMs.toFixed(2)} ms mean, ${p95} p95, ${frames}, ${width}×${height}, ${reading.engine} → ${answer}`;
}

/** Which record a probe's attempt and verdict are written to, and the engine
 * the probed tiers draw with now (absent, WebGL2): the verdict's engine where
 * no reading gives one. */
export type ProbeKey = { gpu: string; browser: number; cls: GpuClass; engine?: VerdictEngine };

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
 * 3. A step that reads nothing (or throws) abandons. With nothing read
 *    before it, the attempt stands and nothing else is written. After a step
 *    that missed, what that miss taught is kept (`cutVerdict`): the tier below
 *    it, never above `start`, written as the probe's verdict, so the next hike
 *    does not measure the miss again. That verdict keeps the attempt spent:
 *    only a probe that finished clears the count, so a machine whose probe is
 *    always cut sees at most three probes in all, however often its verdict
 *    lapses or is replaced.
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
  const settle = (tier: QualityTier, cut: boolean): QualityTier => {
    // The engine the deciding reading drew with: a step whose WebGPU engine
    // failed is measured on WebGL2, and the rule then gives WebGL2 too.
    const engine = readings[readings.length - 1]?.engine ?? key.engine ?? "webgl2";
    const verdict = onEngine({ tier, source: "probe" as const, pixels, at: deps.now(), readings }, engine);
    // Looked up next load under the key's engine: a verdict it will not read
    // keeps the attempts, so the cap still ends the probing; so does a cut's,
    // which only a finished probe clears.
    const next = withVerdict(started, key.gpu, key.browser, key.cls, verdict, key.engine ?? "webgl2", cut);
    if (next !== null) writeAutoRecord(deps.storage, next);
    return tier;
  };
  for (;;) {
    const step = nextProbeStep(from, readings);
    if ("verdict" in step) return settle(step.verdict, false);
    let reading: ProbeReading | null;
    try {
      reading = await deps.runStep(step.measure);
    } catch {
      reading = null;
    }
    if (reading === null) {
      const cut = cutVerdict(readings, start);
      return cut === null ? start : settle(cut, true);
    }
    readings.push(reading);
  }
}

const BELOW: Readonly<Record<QualityTier, QualityTier>> = { high: "medium", medium: "low", low: "low" };

/**
 * The verdict of a probe cut short (its 30 s cap, or a step that read
 * nothing) after a step that missed: the tier below the one that missed, never
 * above `start`, the class's start tier here. Null when nothing was read, which
 * teaches nothing. Every reading before a cut is a miss, since a hold ends the
 * probe with its verdict (`nextProbeStep`).
 */
export function cutVerdict(readings: readonly ProbeReading[], start: QualityTier): QualityTier | null {
  const missed = readings[readings.length - 1];
  if (missed === undefined) return null;
  const below = BELOW[missed.tier];
  return RANK[below] <= RANK[start] ? below : start;
}

/** What `startupTier` needs of the page. */
export type StartupDeps = {
  storage: Storage | null;
  /** The game container's area, `containerPixels`. */
  pixels(): number;
  now(): number;
  /** Measures one tier on a fresh canvas; null on a cancel or a failure, or
   * when its scene is not ready within `readyMaxMs` of the call. */
  runStep(tier: QualityTier, cancelled: () => boolean, readyMaxMs: number): Promise<ProbeReading | null>;
  /** The "Setting up graphics…" screen over the probe's canvas. */
  showScreen(): { dispose(): void };
  /** A timer; the function returned clears it. */
  setTimer(fn: () => void, ms: number): () => void;
  /** Resolves true once the tab is visible, false if the page moves on first. */
  whenVisible(): Promise<boolean>;
  /** The page's idle frame interval on the probe screen (`idleCadenceMs`), or
   * null when it cannot be read. */
  idleCadence(): Promise<number | null>;
  log(line: string): void;
};

export type StartupTier = { tier: QualityTier; source: TierSource; cls: GpuClass };

/** Auto on this machine: the GPU's class and identity, the tier, the tier a
 * probe would start from, or null, whether a probe that was due is skipped
 * because its step could not settle here (`probeStepCanSettle`), and the most
 * Auto recommends here: a holding verdict's tier, else the class's ceiling
 * (low under the cap). What the Settings screen reads, and where
 * `startupTier` begins. `at.engine` is the engine the probed tiers draw with
 * now: the verdict's lookup (`verdictRead`), and what decides the engine the
 * probe's steps draw with, of which it is asked whether they can settle
 * (`probeStepEngine`). */
export function autoPick(
  signals: GpuSignals,
  at: { record: AutoRecord | null; pixels: number; now: number; engine?: VerdictEngine },
): { cls: GpuClass; gpu: string; tier: QualityTier; probeFrom: QualityTier | null; probeSkipped: boolean; ceiling: QualityTier } {
  const cls = classifyGpu(signals);
  const gpu = gpuIdentity(signals);
  const input = {
    cls,
    cores: signals.cores,
    memoryGb: signals.memoryGb,
    record: at.record,
    gpu,
    browser: signals.browser,
    pixels: at.pixels,
    now: at.now,
    engine: at.engine,
  };
  const auto = autoTier(input);
  // What the frame measured, or the tier that built, once a verdict holds;
  // until then, the most the class may take here.
  const measured = holdingVerdict(input);
  const ceiling = withinClass(measured?.tier ?? "high", cls, signals.cores, signals.memoryGb);
  // The first step's engine; a step that ends on another is checked as it runs.
  const probeSkipped = auto.probeFrom !== null && !probeStepCanSettle(signals.parallelCompile, probeStepEngine(signals, at.engine));
  return { cls, gpu, tier: auto.tier, probeFrom: probeSkipped ? null : auto.probeFrom, probeSkipped, ceiling };
}

/**
 * The tier to build the hike at, and where it came from: `?tier=` over the
 * player's choice, and the choice over Auto. On Auto, a probed class with no
 * verdict that holds and fewer than three attempts is probed first behind the
 * screen, from its ceiling, or any class from `?probe=`. Where its step could
 * not settle (`probeStepCanSettle`) it is skipped at once, with no screen and
 * nothing written, unless `?probe=` forces it. Before the attempt is spent the
 * probe waits for the tab to be seen (a hidden tab draws no frames) and times
 * the page's idle frames; below 60 Hz it is skipped with nothing written. The
 * probe itself is bounded at `PROBE_MAX_MS`, and everything stops at once when
 * `opts.cancelled` says the page has moved on. A probe's verdict is never
 * taken above what the class may take on this machine. Logs one line for the
 * probe's outcome; the tier's own line is the launch's, once the engine is
 * known (`qualityLine`).
 */
export async function startupTier(
  signals: GpuSignals,
  opts: { search: string; choice: TierChoice; cancelled(): boolean; engine?: VerdictEngine },
  deps: StartupDeps,
): Promise<StartupTier> {
  const record = readAutoRecord(deps.storage);
  const auto = autoPick(signals, { record, pixels: deps.pixels(), now: deps.now(), engine: opts.engine });
  const { cls, gpu } = auto;
  const decided = resolveTier({ override: parseTierOverride(opts.search), choice: opts.choice, auto: auto.tier });
  let tier = decided.tier;
  const from = decided.source === "auto" ? (parseProbeOverride(opts.search) ?? auto.probeFrom) : null;
  if (decided.source === "auto" && from === null && auto.probeSkipped) {
    // What is known: the extension absent, or no WebGL2 context to ask. (A
    // WebGPU step that cannot settle is measured on WebGL2 instead.)
    const reason =
      signals.parallelCompile === null
        ? "no WebGL2 context could be made to measure with"
        : "this browser compiles shaders on the page's thread";
    deps.log(`quality probe: skipped, ${reason}; starting at ${tier} (${cls})`);
  }
  if (from !== null && !opts.cancelled()) {
    const screen = deps.showScreen();
    try {
      const outcome = await probeOnce(from, auto.tier, record, { gpu, browser: signals.browser, cls, engine: opts.engine }, opts, deps);
      tier = withinClass(outcome.tier, cls, signals.cores, signals.memoryGb);
      if (outcome.line !== null) deps.log(`${outcome.line}; starting at ${tier} (${cls})`);
      else deps.log(`quality probe: verdict ${outcome.tier} (${cls})`);
    } finally {
      screen.dispose();
    }
  }
  return { tier, source: decided.source, cls };
}

/**
 * The line a hike's launch logs, once per renderer build as a switch's is:
 * the tier the first renderer was built at and the engine it draws with,
 * with the decided tier's source, or `fallback` where the decided tier did
 * not build and a lower one did (as a switch that falls back logs it).
 */
export function launchLine(decided: StartupTier, built: { tier: QualityTier; engine: VerdictEngine }): string {
  return qualityLine(built.tier, built.tier === decided.tier ? decided.source : "fallback", decided.cls, built.engine);
}

/** The line a hike logs for its tier once it is launched, with the engine
 * actually in use: `quality: medium (auto, apple-unknown), engine webgl2`. */
export function qualityLine(tier: QualityTier, source: TierSource | "fallback", cls: GpuClass, engine: VerdictEngine): string {
  return `quality: ${tier} (${source}, ${cls}), engine ${engine}`;
}

/**
 * One probe behind its screen: seen, then timed idle, then `runProbe` under the
 * 30 s cap. The tier, and a log line when there is no verdict.
 */
async function probeOnce(
  from: QualityTier,
  start: QualityTier,
  record: AutoRecord | null,
  key: ProbeKey,
  opts: { cancelled(): boolean },
  deps: StartupDeps,
): Promise<{ tier: QualityTier; line: string | null }> {
  const moved = { tier: start, line: "quality probe: not run, the page moved on" };
  if (!(await deps.whenVisible()) || opts.cancelled()) return moved;
  const cadence = await deps.idleCadence();
  if (opts.cancelled()) return moved;
  if (cadence === null) return { tier: start, line: "quality probe: skipped, the page's frame rate could not be read" };
  if (cadence > PROBE_HOLD_MS) {
    return { tier: start, line: `quality probe: skipped, the page draws below 60 Hz (${cadence.toFixed(1)} ms a frame)` };
  }
  let late = false;
  const began = deps.now();
  const clear = deps.setTimer(() => {
    late = true;
  }, PROBE_MAX_MS);
  const cancelled = (): boolean => late || opts.cancelled();
  const readings: ProbeReading[] = [];
  try {
    const tier = await runProbe(from, start, record, key, {
      storage: deps.storage,
      runStep: async (step) => {
        const readyMaxMs = stepReadyMaxMs(PROBE_MAX_MS - (deps.now() - began));
        if (cancelled() || readyMaxMs <= 0) return null;
        const reading = await deps.runStep(step, cancelled, readyMaxMs);
        if (reading !== null) readings.push(reading);
        return reading;
      },
      pixels: () => deps.pixels(),
      now: () => deps.now(),
    });
    if ("verdict" in nextProbeStep(from, readings)) return { tier, line: null };
    const missed = readings[readings.length - 1];
    if (missed === undefined) return { tier, line: "quality probe: no verdict" };
    return { tier, line: `quality probe: cut short after ${missed.tier} missed, verdict ${tier}` };
  } finally {
    clear();
  }
}

const RANK: Readonly<Record<QualityTier, number>> = { low: 0, medium: 1, high: 2 };

/**
 * The tiers a hike's first renderer falls back through when `tier` fails to
 * build: the class's start tier (within what the class may take here), then
 * low, each only below `tier`.
 */
export function startFallbacks(tier: QualityTier, cls: GpuClass, cores: number | null, memoryGb: number | null): QualityTier[] {
  const start = withinClass(CLASS_TIERS[cls].start, cls, cores, memoryGb);
  return [...new Set<QualityTier>([start, "low"])].filter((t) => RANK[t] < RANK[tier]);
}

/** The line over the game's container while a hike starts: the landing's
 * own word, which its Play button showed a moment before. */
export const LOADING_LINE = "Loading…";

/** The line over the game's container when the hike cannot be started. */
export const START_FAILED_LINE = "This browser could not start the game.";

/** What starting a hike needs of the page; `E` is the engine made for it. */
export type HikeStartDeps<E> = {
  signals: Promise<GpuSignals>;
  /** Whether this start is still the page's. */
  current(): boolean;
  /** "Loading…" over the container: from the start of the wait, and again
   * while the engine is made after the probe's screen has gone. */
  showLoading(): { dispose(): void };
  /** The tier (`startupTier`); `hideLoading` gives way to the probe's screen. */
  decide(signals: GpuSignals, hideLoading: () => void): Promise<StartupTier>;
  /** Waited for once the tier is decided and before the engine is made: the
   * page's gate on the download, where an intro plays over the start. */
  before?(): Promise<void>;
  /** A paint of the page, waited for before the engine is made and before
   * the build, so what the page shows over the start keeps its frames
   * between the start's long tasks. Absent, the phases follow at once. */
  paint?(): Promise<void>;
  /** The engine the WebGPU rule gives the tier decided, made for the game's
   * canvas, which is created here, after the probe. */
  engine(decided: StartupTier, signals: GpuSignals): Promise<E>;
  /** Lets go of an engine made for a start the page has since left. */
  discard(engine: E): void;
  /** Builds the hike at the tier decided, on the engine made for it; a
   * promise returned is waited for, and its rejection is a failed start. */
  build(decided: StartupTier, engine: E): void | Promise<void>;
  /** The hike could not start: says so over the container. */
  fail(error: unknown): void;
};

/**
 * The page's start of a hike, in order: "Loading…" from the first moment, the
 * signals, the tier (the probe's screen taking over from the line when there
 * is one), then the engine for that tier ("Loading…" again, if the probe's
 * screen had taken over), then the build, with the line gone in the same task
 * so nothing blank shows between. One catch for all of it: a throw anywhere
 * is answered with a line, never a blank page. A start the page has moved on
 * from builds nothing, says nothing, and lets go of an engine made meanwhile.
 * With `before`, the start waits for it between the tier and the engine; with
 * `paint`, it lets the page paint before the engine and before the build.
 */
export async function startHike<E>(deps: HikeStartDeps<E>): Promise<void> {
  let loading = deps.showLoading();
  let shown = true;
  const hide = (): void => {
    if (!shown) return;
    shown = false;
    loading.dispose();
  };
  try {
    const signals = await deps.signals;
    if (!deps.current()) return;
    const decided = await deps.decide(signals, hide);
    if (!deps.current()) return;
    if (deps.before !== undefined) {
      await deps.before();
      if (!deps.current()) return;
    }
    if (!shown) {
      loading = deps.showLoading();
      shown = true;
    }
    await deps.paint?.();
    const engine = await deps.engine(decided, signals);
    if (!deps.current()) {
      hide();
      deps.discard(engine);
      return;
    }
    hide();
    await deps.paint?.();
    await deps.build(decided, engine);
  } catch (error) {
    hide();
    if (deps.current()) deps.fail(error);
  } finally {
    hide();
  }
}
