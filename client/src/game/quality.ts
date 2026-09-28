/**
 * The three quality tiers (low, medium, high), as data, and the rules that
 * pick one.
 *
 * Pure on purpose: the renderer must read these rather than hard-code shadow
 * resolutions, and a capability probe that takes a plain object can be tested
 * without a browser. Tiers change `game/` state only — never asset content and
 * never the simulation.
 *
 * `autoTier` is Auto's rule: the GPU's class (`gpuClass.ts`) gives a start
 * tier and a ceiling, a stored verdict (a probe's measurement, or a drop after
 * a sustained low frame rate) moves the tier within them, and two cores or two
 * gigabytes cap it at low. `tierFor` is the older rule, from cores and memory
 * alone, which `renderer.ts` applies when it is given no tier.
 */
import { CLASS_TIERS, type GpuClass } from "./gpuClass.js";

export type QualityTier = "low" | "medium" | "high";

export type QualitySettings = {
  /** Babylon `engine.setHardwareScalingLevel` — above 1 renders below native. */
  hardwareScaling: number;
  /** Shadow map edge in texels. Zero means shadows are off. */
  shadowMapSize: number;
  /** Cascade count; meaningless when `shadowMapSize` is zero. `medium` uses a
   * single cascade; `high` uses Babylon's default cascade count as a
   * tuning value. */
  shadowCascades: number;
  /** Levels coarser to bias mesh LOD selection by. */
  lodBias: number;
  /** Largest mip dimension to keep. Zero means no cap. */
  textureMipCap: number;
};

/** Hardware scaling, shadow map sizes, LOD bias, and texture mip caps, by
 * tier. Cascade counts are tuning values: `medium` uses a single
 * cascade, and `high`'s count is ours to tune. `high` ran Babylon's default of 4 until
 * 2026-08-26: rasterising the old-growth giants' alpha-tested canopy into four 2048²
 * cascade maps measured ~5 ms/frame of GPU time at a deep-forest camera on production —
 * the frame missed 60 Hz vsync and juddered. Two cascades restore a locked 60 fps; the
 * first cascade widens from ~8 m to ~19 m of camera depth (still on a full 2048 map),
 * which PCF keeps acceptable. */
export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    hardwareScaling: 1.5,
    shadowMapSize: 0,
    shadowCascades: 0,
    lodBias: 1,
    textureMipCap: 512,
  },
  medium: {
    hardwareScaling: 1,
    shadowMapSize: 1024,
    shadowCascades: 1,
    lodBias: 0,
    textureMipCap: 1024,
  },
  high: {
    hardwareScaling: 1,
    shadowMapSize: 2048,
    shadowCascades: 2,
    lodBias: 0,
    textureMipCap: 0,
  },
};

export type Capabilities = {
  cores: number;
  memoryGb: number;
  mobile: boolean;
};

/**
 * Picks a starting tier. The player can override it; this only has to avoid
 * being embarrassing on first load.
 *
 * Mobile goes to `low` outright rather than by thresholds: a phone reporting
 * eight cores is reporting little clusters, and its thermal budget is the real
 * constraint. `low` is required to be genuinely playable, not merely
 * functional, so this is not a punishment.
 */
export function tierFor(caps: Capabilities): QualityTier {
  if (caps.mobile) return "low";
  if (caps.cores <= 4 || caps.memoryGb <= 4) return "low";
  if (caps.cores <= 8 || caps.memoryGb <= 8) return "medium";
  return "high";
}

/**
 * Bumped when every stored verdict should be redone: when what a tier costs
 * moves enough, or when `CLASS_TIERS` moves a class's start or ceiling. A
 * classifier change that moves a GPU to another class needs no bump, since
 * the record carries the class its verdict was made for (`verdictFor`).
 */
export const DETECT_VERSION = 1;
/** How long a probe's or a build verdict holds, in days. */
export const VERDICT_DAYS = 30;
/** How long a governor's verdict holds, in days: slowness from load outside
 * the game (another app, a video call) passes, and a machine should not be
 * held down a month for it. */
export const GOVERNOR_VERDICT_DAYS = 7;
/** A probe verdict holds while the window is at most this many times the area it was measured at. */
export const PROBE_PIXEL_SLACK = 1.5;
/** Probes started for one GPU and browser without a verdict, after which Auto keeps the class's start tier. */
export const PROBE_ATTEMPTS = 3;

const DAY_MS = 86_400_000;
const RANK: Readonly<Record<QualityTier, number>> = { low: 0, medium: 1, high: 2 };

/** One tier measured by the startup probe; `early` when its step ended as a
 * miss before its 120 frames, the mean and p95 then those of the frames it
 * measured. */
export type ProbeReading = {
  tier: QualityTier;
  frames: number;
  meanMs: number;
  p95Ms: number;
  pixels: number;
  engine: "webgl2" | "webgpu";
  early?: true;
};

/**
 * What was learned of one GPU: a probe's tier, a drop after a sustained low
 * frame rate (`governor`), or the tier a renderer did build at after a higher
 * one failed to (`build`). `pixels` is the game container's CSS area when it
 * was set, and `at` is `Date.now()` then.
 */
export type AutoVerdict = {
  tier: QualityTier;
  source: "probe" | "governor" | "build";
  pixels: number;
  at: number;
  readings?: ProbeReading[];
};

/**
 * Auto's memory, one per browser profile: the GPU (`gpuIdentity`) and browser
 * major it was made on, the probes started for them, the verdict, and the
 * class the verdict was made for. A record for another `DETECT_VERSION`, GPU
 * or browser is ignored, attempts and all (`recordMatches`); one for another
 * class keeps its attempts but not its verdict (`verdictFor`).
 */
export type AutoRecord = { v: number; gpu: string; cls: GpuClass; browser: number; attempts: number; verdict: AutoVerdict | null };

export type AutoInput = {
  cls: GpuClass;
  cores: number | null;
  memoryGb: number | null;
  record: AutoRecord | null;
  /** The running GPU's `gpuIdentity`. */
  gpu: string;
  /** The running browser's major version. */
  browser: number;
  /** The game container's CSS area now. */
  pixels: number;
  now: number;
};

/**
 * Whether a stored record was made for this version, GPU and browser: the
 * identity its attempts are counted on. Not the class, which can differ
 * between loads of one GPU (an unnamed renderer classed by an adapter that
 * answers on one load and times out on the next); matched on the class, each
 * load would throw the other's attempts away and probe again without end.
 */
export function recordMatches(record: AutoRecord | null, gpu: string, browser: number): boolean {
  return record !== null && record.v === DETECT_VERSION && record.gpu === gpu && record.browser === browser;
}

/**
 * The record's verdict when it was made for `cls`, else null: a classifier
 * change that moves this GPU to another class retires the verdict made under
 * the old one, while the attempts stand.
 */
export function verdictFor(record: AutoRecord, cls: GpuClass): AutoVerdict | null {
  return record.cls === cls ? record.verdict : null;
}

/**
 * Whether a verdict still stands: set no later than `now` (a verdict dated in
 * the future was written under a clock running ahead) and under
 * `GOVERNOR_VERDICT_DAYS` old for the governor's, `VERDICT_DAYS` for the rest,
 * and, for a probe's, with the window at most `PROBE_PIXEL_SLACK` times the
 * area it certified (a bigger window costs more). A drop for a low frame rate,
 * and a tier that failed to build, hold at any size.
 */
export function verdictHolds(verdict: AutoVerdict, pixels: number, now: number): boolean {
  const age = now - verdict.at;
  const days = verdict.source === "governor" ? GOVERNOR_VERDICT_DAYS : VERDICT_DAYS;
  return age >= 0 && age < days * DAY_MS && (verdict.source !== "probe" || pixels <= verdict.pixels * PROBE_PIXEL_SLACK);
}

/**
 * The stored verdict that decides Auto's tier now, or null: the record's, when
 * it was made for this version, GPU and browser (`recordMatches`) and this
 * class (`verdictFor`), and still holds (`verdictHolds`).
 */
export function holdingVerdict(input: AutoInput): AutoVerdict | null {
  if (!recordMatches(input.record, input.gpu, input.browser) || input.record === null) return null;
  const verdict = verdictFor(input.record, input.cls);
  return verdict !== null && verdictHolds(verdict, input.pixels, input.now) ? verdict : null;
}

function lower(a: QualityTier, b: QualityTier): QualityTier {
  return RANK[a] <= RANK[b] ? a : b;
}

/** The highest tier a class may take on this machine: its ceiling, or low
 * where two cores or two gigabytes are reported (a missing value caps
 * nothing). */
function ceilingFor(cls: GpuClass, cores: number | null, memoryGb: number | null): QualityTier {
  const capped = (cores !== null && cores <= 2) || (memoryGb !== null && memoryGb <= 2);
  return capped ? "low" : CLASS_TIERS[cls].ceiling;
}

/** `tier`, never above what the class may take on this machine: how a probe's
 * verdict, which a forced probe may take past the ceiling, is started at. */
export function withinClass(tier: QualityTier, cls: GpuClass, cores: number | null, memoryGb: number | null): QualityTier {
  return lower(tier, ceilingFor(cls, cores, memoryGb));
}

/** The game container's CSS area: the one measure of the window, for a probe
 * verdict's `pixels` and for `AutoInput.pixels`, so a verdict holds on the
 * next load at the same window. 0 for a container not laid out. */
export function containerPixels(container: { clientWidth: number; clientHeight: number }): number {
  const { clientWidth, clientHeight } = container;
  return clientWidth > 0 && clientHeight > 0 ? clientWidth * clientHeight : 0;
}

/**
 * The record once a probe starts: a matching record (`recordMatches`) with one
 * more attempt, its class and verdict kept until the probe's own verdict
 * replaces them, or a fresh one at one attempt.
 */
export function withProbeStarted(prev: AutoRecord | null, gpu: string, browser: number, cls: GpuClass): AutoRecord {
  if (prev !== null && recordMatches(prev, gpu, browser)) return { ...prev, attempts: prev.attempts + 1 };
  return { v: DETECT_VERSION, gpu, cls, browser, attempts: 1, verdict: null };
}

/**
 * The record with a verdict for `cls`, or null for a probe's verdict over no
 * area, which certifies nothing and would never hold again. A probe's verdict
 * sets the attempts back to 0, unless it replaces one made for another class:
 * then the count is carried, so two classes alternating on one GPU, each
 * ignoring the other's verdict, cannot probe on every load. A governor's or a
 * build's verdict measured nothing, so it keeps a matching record's count:
 * once it lapses, the probes left are the ones that were left before it, and
 * a GPU whose probes never reached a verdict is not probed three more times.
 */
export function withVerdict(prev: AutoRecord | null, gpu: string, browser: number, cls: GpuClass, verdict: AutoVerdict): AutoRecord | null {
  if (verdict.source === "probe" && !(verdict.pixels > 0)) return null;
  const matching = prev !== null && recordMatches(prev, gpu, browser) ? prev : null;
  const carried = verdict.source !== "probe" || (matching?.verdict != null && matching.cls !== cls);
  return { v: DETECT_VERSION, gpu, cls, browser, attempts: carried ? (matching?.attempts ?? 0) : 0, verdict };
}

/**
 * The record after the governor drops the running tier one step: a verdict of
 * source `governor` at the tier below, for this class, which holds at any
 * window for 7 days, so the next hike starts there too. Null on low, which
 * has nothing below it.
 */
export function withGovernorDrop(
  prev: AutoRecord | null,
  gpu: string,
  browser: number,
  cls: GpuClass,
  running: QualityTier,
  pixels: number,
  now: number,
): AutoRecord | null {
  const below: QualityTier | null = running === "high" ? "medium" : running === "medium" ? "low" : null;
  if (below === null) return null;
  return withVerdict(prev, gpu, browser, cls, { tier: below, source: "governor", pixels, at: now });
}

/**
 * Auto's tier, and the tier to probe from before the first hike, or null. The
 * class gives a start tier and a ceiling (`CLASS_TIERS`); two cores or two
 * gigabytes, where reported, cap both at low (a missing value caps nothing).
 * A matching record's probe or governor verdict for this class that holds
 * decides, never above the ceiling. A `build` verdict only lowers the ceiling
 * to the tier that built: the tier that failed and all above it are out, and
 * a probed class is still measured below that. Otherwise the start tier, with
 * a probe from the ceiling when the class is probed, the ceiling is above the
 * start, and fewer than `PROBE_ATTEMPTS` probes have been started.
 */
export function autoTier(input: AutoInput): { tier: QualityTier; probeFrom: QualityTier | null } {
  const row = CLASS_TIERS[input.cls];
  const verdict = holdingVerdict(input);
  const classCeiling = ceilingFor(input.cls, input.cores, input.memoryGb);
  if (verdict !== null && verdict.source !== "build") return { tier: lower(verdict.tier, classCeiling), probeFrom: null };
  const ceiling = verdict === null ? classCeiling : lower(verdict.tier, classCeiling);
  const start = lower(row.start, ceiling);
  const record = recordMatches(input.record, input.gpu, input.browser) ? input.record : null;
  const attempts = record?.attempts ?? 0;
  if (row.probe && ceiling !== start && attempts < PROBE_ATTEMPTS) return { tier: start, probeFrom: ceiling };
  return { tier: start, probeFrom: null };
}
