/**
 * Which engine draws the game: WebGL2, as every tier always has, or Babylon's
 * WebGPU engine on the tiers `WEBGPU_TIERS` names, where the browser offers a
 * hardware adapter with the limits the scene needs. Decided for each renderer
 * the page builds (`main.ts`'s `engineFor`: the probe's steps, the hike's
 * start, every switch of tier and every rebuild after a failure), from the
 * tier it is for, and remembered when WebGPU fails, so a failing engine is
 * tried again only after the browser or Babylon moves on.
 *
 * Pure on purpose, like `quality.ts`: the parts that touch `navigator.gpu`
 * live in `gpuEngine.ts`, which only the WebGPU path loads, and everything
 * here takes plain values so the rule can be tested with literal inputs.
 * Storage is read and written through the `Storage` it is handed, every
 * access wrapped as `playerName.ts` wraps its own.
 */
import type { GpuSignals } from "./gpuSignals.js";
import type { QualityTier } from "./quality.js";

export type EngineName = "webgl2" | "webgpu";

/** WebGPU as the default on the tiers below. Off until the parity and frame
 * gates pass on each of them; until then only `?engine=webgpu` reaches it. */
export const WEBGPU_ENABLED = false;

/** The tiers the WebGPU default applies to: high and medium, the two that
 * desktop Chromium's detection gives (`quality.ts`). Low and the landing
 * backdrop stay WebGL2. */
export const WEBGPU_TIERS: readonly QualityTier[] = ["high", "medium"];

/**
 * What the device is created with, and what an adapter must reach to be
 * chosen: exactly these, never the adapter's maximum, so a pipeline that
 * outgrows them fails here rather than only on a weaker adapter. Each is
 * measured, over every pipeline of 13 WebGPU pages on both tiers, each
 * replayed at chosen limits (the verification note, §4):
 *
 * - Inter-stage variables, 19. WebGPU lets a vertex stage write at most this
 *   many user-defined outputs, each at a location below it, and a fragment
 *   stage read at most this many user-defined inputs less one for each
 *   inter-stage built-in it reads (`front_facing`, `sample_index`,
 *   `sample_mask`, `primitive_index` and the two subgroup built-ins; the
 *   position does not count). On WebGPU Babylon declares every vertex output
 *   as a fragment input, a `mat3` taking three locations. The giant trees'
 *   faded material (`material1`) writes 18 outputs and its two-sided fragment
 *   reads 18 inputs and `front_facing`, on both tiers: at 18 it fails
 *   validation, at 19 no pipeline does (`interStage.test.ts` holds the
 *   count). It is the one pipeline that sets 19. The halation's blur sizes its
 *   taps from the device's own limit, so it fills whatever the device offers
 *   and fits it; it failed at 18 only where the replay made, on a device of 18,
 *   a pipeline built for one of 19. The specification lowers the
 *   vertex stage's count twice more: by one for a pipeline drawing
 *   `point-list` topology, and by one for every four `clip_distances` it
 *   writes. The game uses neither: it draws no points, and the device is not
 *   asked for the `clip-distances` feature.
 * - Vertex buffers, 8, the default: the most a pipeline binds is 7 (the duff
 *   clumps, the giant fir's `material1`, the fern, the meadow's clutter, the
 *   grass).
 * - Sampled textures and samplers per stage, 16 each, and uniform buffers per
 *   stage, 12: WebGPU's defaults, at which the scene sits with no margin. The
 *   terrain's fragment stage takes all 16 textures and 16 samplers, and every
 *   lit PBR material with a full party's seven lights all 12 uniform buffers
 *   (`stageBindings.test.ts` holds the counts). They are named so that this
 *   is the scene's whole need; every adapter offers the defaults, so naming
 *   them turns none away.
 */
export const WEBGPU_REQUIRED_LIMITS: Readonly<Record<string, number>> = {
  maxInterStageShaderVariables: 19,
  maxVertexBuffers: 8,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxUniformBuffersPerShaderStage: 12,
};

/**
 * The texture compression the device is asked for, where the adapter has it:
 * the three features Babylon's WebGPU engine reads its compressed-format caps
 * from (`bc` gives `s3tc` and `bptc`, then `etc2` and `astc`), which the KTX2
 * transcoder picks a target from. Without them the characters' KTX2 textures
 * would be transcoded to uncompressed RGBA on WebGPU and stay compressed on
 * WebGL2.
 */
export const WEBGPU_TEXTURE_FEATURES: readonly string[] = [
  "texture-compression-bc",
  "texture-compression-etc2",
  "texture-compression-astc",
];

/** The remembered fallback, in `localStorage`. */
export const FALLBACK_KEY = "dayhike.engine";
/** How long a remembered fallback holds while nothing else changes. */
export const FALLBACK_DAYS = 30;
/** A second lost device inside this window remembers WebGL2. */
export const LOSS_WINDOW_MS = 86_400_000;
/** Fetching what the WebGPU path needs, the engine's module and then the two
 * translators, gets this long between them. A fetch that runs out is WebGL2
 * for this load and is not remembered: nothing of the GPU failed. */
export const WEBGPU_FETCH_MS = 10_000;
/** The GPU's part, the adapter probe and then making the engine, gets this
 * long between them, measured apart from the fetch. Running out is remembered
 * (`init`). */
export const WEBGPU_START_MS = 10_000;

/** How long the HUD shows the line after a swap that answered a failure. */
export const FALLBACK_NOTICE_MS = 6_000;

export const NOTICE_SWITCHED = "Graphics switched to WebGL2 after a GPU error.";
export const NOTICE_RESTARTED = "Graphics restarted after a GPU error.";
/** After translators that could not be fetched (`unfetched`): no GPU error. */
export const NOTICE_UNFETCHED = "Graphics switched to WebGL2: part of the renderer could not be downloaded.";

const DAY_MS = 86_400_000;

/** `?engine=webgl2|webgpu`, on any tier; anything else is no override. */
export function parseEngineOverride(search: string): EngineName | null {
  const value = new URLSearchParams(search).get("engine");
  return value === "webgl2" || value === "webgpu" ? value : null;
}

/**
 * How a WebGPU engine comes by the WGSL of the game's GLSL shaders
 * (`shaderLookup.ts`): `on`, looked up and translated only where not found;
 * `record`, the same, keeping every stage's texts and times for a
 * measurement to read; `verify`, the same, translating every stage found too
 * and counting those that differ; `off`, Babylon's own path, every stage
 * translated, the translators started before the engine.
 */
export type ShaderLookupMode = "on" | "record" | "verify" | "off";

/** `?wgsl=record|verify|off`; anything else is `on`. */
export function parseShaderLookup(search: string): ShaderLookupMode {
  const value = new URLSearchParams(search).get("wgsl");
  return value === "record" || value === "verify" || value === "off" ? value : "on";
}

/** What the rule reads of the high-performance adapter (`adapterFromSignals`). */
export type AdapterReport = {
  limits: Readonly<Record<string, number>>;
  isFallbackAdapter: boolean;
  /** The adapter's optional features, where it was asked for them. */
  features?: readonly string[];
};

/**
 * The adapter the rule reads, from the page's one adapter request (the GPU's
 * signals, `readSignals` in `gpuSignals.ts`): the signals' own reading where
 * the request answered within their 2 s; where it had not (`timed-out`, which
 * means not known yet, never a failure), the same request's `later` answer,
 * which the caller bounds with the GPU's budget (`resolveWebGpu`); and no
 * adapter where the browser has no WebGPU, offers none, or the request failed.
 */
export function adapterFromSignals(
  signals: Pick<GpuSignals, "adapterStatus" | "adapter" | "limits" | "features">,
  later: () => Promise<AdapterReport | null>,
): Promise<AdapterReport | null> {
  if (signals.adapterStatus === "timed-out") return later();
  if (signals.adapterStatus !== "ok" || signals.adapter === null || signals.limits === null) return Promise.resolve(null);
  return Promise.resolve({
    limits: signals.limits,
    isFallbackAdapter: signals.adapter.isFallbackAdapter,
    features: signals.features ?? [],
  });
}

/** Whether the signals' adapter fits (`adapterFits`), or null where it is not
 * known yet (the request `timed-out`): the rule's `fits` without a wait. */
export function signalsFit(signals: Pick<GpuSignals, "adapterStatus" | "adapter" | "limits" | "features">): boolean | null {
  if (signals.adapterStatus === "timed-out") return null;
  if (signals.adapterStatus !== "ok" || signals.adapter === null || signals.limits === null) return false;
  return adapterFits({ limits: signals.limits, isFallbackAdapter: signals.adapter.isFallbackAdapter }).fits;
}

/** Of `WEBGPU_TEXTURE_FEATURES`, those the adapter has, in that order. */
export function featuresToRequest(adapterFeatures: Iterable<string>): string[] {
  const have = new Set(adapterFeatures);
  return WEBGPU_TEXTURE_FEATURES.filter((feature) => have.has(feature));
}

/** Whether the adapter can run the scene, and if not, why, in a few words. A
 * limit the adapter does not report counts as zero. */
export function adapterFits(
  adapter: AdapterReport | null,
  required: Readonly<Record<string, number>> = WEBGPU_REQUIRED_LIMITS,
): { fits: boolean; why: string | null } {
  if (adapter === null) return { fits: false, why: "no adapter" };
  if (adapter.isFallbackAdapter) return { fits: false, why: "fallback adapter" };
  for (const [name, need] of Object.entries(required)) {
    const have = adapter.limits[name] ?? 0;
    if (have < need) return { fits: false, why: `${name} ${have} < ${need}` };
  }
  return { fits: true, why: null };
}

export type EngineInput = {
  tier: QualityTier;
  override: EngineName | null;
  /** The remembered fallback holds (`fallbackHolds`). */
  remembered: boolean;
  /** `WEBGPU_ENABLED`, passed in so the rule can be tested both ways. */
  on: boolean;
  /** The adapter's verdict, or null before it has been asked. */
  fits: boolean | null;
};

/**
 * The rule. `"probe"` means the answer needs the adapter: ask it, then call
 * again with `fits`. `?engine=webgl2` wins outright; `?engine=webgpu` goes past
 * the tier, the switch and the memory, but never past the adapter.
 */
export function chooseEngine(input: EngineInput, tiers: readonly QualityTier[] = WEBGPU_TIERS): EngineName | "probe" {
  if (input.override === "webgl2") return "webgl2";
  if (input.override !== "webgpu" && (!tiers.includes(input.tier) || !input.on || input.remembered)) return "webgl2";
  if (input.fits === null) return "probe";
  return input.fits ? "webgpu" : "webgl2";
}

/**
 * The engine for `input.tier`: WebGL2 (null) at once where the rule says so,
 * nothing fetched and nothing asked, as for every tier while `WEBGPU_ENABLED`
 * is false and the address sets no engine; else what `resolve` makes of it
 * (`resolveWebGpu`), which may still be WebGL2.
 */
export function engineForTier<E>(input: EngineInput, resolve: () => Promise<E | null>): Promise<E | null> {
  return chooseEngine(input) === "webgl2" ? Promise.resolve(null) : resolve();
}

export type FallbackReason = "init" | "pipeline" | "lost";

/**
 * A failure of a running WebGPU engine, as its watcher reports it
 * (`watchWebGpu`): an effect that failed or an uncaptured error
 * (`pipeline`), a lost device (`lost`), or translators that could not be
 * fetched for a shader the lookup did not find (`unfetched`,
 * `shaderLookup.ts`). The last is the network's, not the GPU's: it is never
 * remembered, and holds for the page alone (`answerUnfetched`).
 */
export type EngineFailure = "pipeline" | "lost" | "unfetched";

/**
 * A remembered failure: why, on which browser major and Babylon version, when,
 * and how many lost devices in the last `LOSS_WINDOW_MS`.
 */
export type FallbackRecord = { reason: FallbackReason; browser: number; babylon: string; at: number; losses: number };

/** The browser's major version (`browserMajor`, `gpuSignals.ts`: a change is
 * what earns WebGPU a retry) and Babylon's version. */
export type EngineEnv = { browser: number; babylon: string };

/** The record after a failure. A lost device inside `LOSS_WINDOW_MS` of the
 * last one counts up; any other starts the count again. A lost device never
 * replaces a record of another reason that still holds: the fault that record
 * remembers has not gone away, and a lone loss would retry WebGPU. */
export function recordFailure(
  prev: FallbackRecord | null,
  reason: FallbackReason,
  env: EngineEnv,
  now: number,
): FallbackRecord {
  if (reason === "lost" && prev !== null && prev.reason !== "lost" && fallbackHolds(prev, env, now)) return prev;
  let losses = 0;
  if (reason === "lost") {
    losses = prev !== null && prev.reason === "lost" && now - prev.at < LOSS_WINDOW_MS ? prev.losses + 1 : 1;
  }
  return { reason, browser: env.browser, babylon: env.babylon, at: now, losses };
}

/** Whether the record sends this load to WebGL2: not for a lone lost device,
 * and only on the browser and Babylon it was written on, for `FALLBACK_DAYS`. */
export function fallbackHolds(record: FallbackRecord | null, env: EngineEnv, now: number): boolean {
  if (record === null) return false;
  if (record.reason === "lost" && record.losses < 2) return false;
  if (record.browser !== env.browser || record.babylon !== env.babylon) return false;
  return now - record.at < FALLBACK_DAYS * DAY_MS;
}

function isRecord(value: unknown): value is FallbackRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    (r.reason === "init" || r.reason === "pipeline" || r.reason === "lost") &&
    typeof r.browser === "number" &&
    typeof r.babylon === "string" &&
    typeof r.at === "number" &&
    typeof r.losses === "number"
  );
}

/** The remembered record, or null where there is none, it is not one of ours,
 * or storage throws. */
export function readFallback(storage: Storage | null): FallbackRecord | null {
  try {
    const raw = storage?.getItem(FALLBACK_KEY);
    if (typeof raw !== "string") return null;
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the record; false where there is no storage or it throws, and
 * the caller then carries the choice in the URL instead. */
export function writeFallback(storage: Storage | null, record: FallbackRecord): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(FALLBACK_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a WebGPU failure that ends on WebGL2 pins `engine=webgl2` in this
 * tab's address: wherever the rule would otherwise give WebGPU again in this
 * tab, so a reload does not walk into the same failure while the record
 * holds. That is where storage refused the record (nothing remembers it), or
 * where the address's `?engine=webgpu` outranks the record. One rule for every
 * such path: a failed start (`init`), a pipeline or uncaptured error, a second
 * lost device, and a lost device's retry whose start fails.
 */
export function pinsAfterFailure(input: { stored: boolean; override: EngineName | null }): boolean {
  return !input.stored || input.override === "webgpu";
}

/**
 * What a failure of the running WebGPU engine does, after the record has been
 * written (`stored`) and read back (`holds`): a live swap of the renderer at
 * the running tier, never a reload, which would end a party (a host's reload
 * ends the room). A pipeline error or an uncaptured one, whenever it comes,
 * and a second lost device in `LOSS_WINDOW_MS`, swap onto WebGL2; a first
 * lost device retries once on a new WebGPU engine. `engine` is what the rule
 * then gives, which the rebuild takes by the rule: `pin` asks for
 * `engine=webgl2` in this tab's URL wherever the rule would otherwise give
 * WebGPU again (storage refused the record, or `?engine=webgpu` outranks it),
 * so a failing engine can never loop. `notice` is the HUD's line once the
 * swap is done.
 */
export function failureSwap(input: {
  stored: boolean;
  holds: boolean;
  reason: "pipeline" | "lost";
  override: EngineName | null;
}): { engine: EngineName; pin: boolean; notice: string } {
  const retry = input.reason === "lost" && input.stored && !input.holds;
  if (retry) return { engine: "webgpu", pin: false, notice: NOTICE_RESTARTED };
  return { engine: "webgl2", pin: pinsAfterFailure(input), notice: NOTICE_SWITCHED };
}

const TIMED_OUT = Symbol("timed out");

/** `promise`, or `TIMED_OUT` once `ms` pass first. */
function withinTime<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** How `resolveWebGpu` reaches the WebGPU module and the page, passed in so
 * the order, the budgets and every failure can be tested without either. */
export type WebGpuSteps<E> = {
  /** Whether the page has WebGPU at all (`navigator.gpu`); where it does not,
   * nothing is fetched. */
  available(): boolean;
  /** The WebGPU module: `import("./gpuEngine.js")`, adapted, with the
   * adapter's report from the GPU's signals (`adapterFromSignals`). */
  load(): Promise<{
    probe(): Promise<AdapterReport | null>;
    /** The translators (`loadTranslators`), fetched only once the adapter
     * fits: with `?wgsl=off`, where Babylon's own path needs them before the
     * engine; else nothing, as the shader lookup starts them at its first
     * stage not found (`shaderLookup.ts`). */
    fetchTranslators(): Promise<void>;
    /** The engine, given what is left of the GPU's budget and the features to ask for. */
    create(ms: number, features: string[]): Promise<E>;
  }>;
  /** Writes the remembered fallback. */
  remember(reason: "init"): void;
  warn(message: string, detail?: unknown): void;
};

/**
 * The WebGPU engine, or null for WebGL2. In order: the module is imported, the
 * adapter asked, and only where it fits are the translators fetched (with
 * `?wgsl=off`; else the shader lookup fetches them later, at its first stage
 * not found) and the engine made, so a browser that cannot run WebGPU fetches
 * no translator, and one without WebGPU at all fetches nothing. Two budgets, each a running total
 * over its two steps and measured apart from the other: `fetchMs` for the
 * module and then the translators, `startMs` for the probe and then the engine,
 * so nothing on the way can leave the page waiting for good. Never rejects. A
 * fetch that fails or runs out is not remembered: nothing of the GPU failed,
 * and a slow network must not keep WebGPU off for the next 30 days. An adapter
 * that does not answer, or an engine that does not start, is (`init`). An
 * adapter that does not fit is WebGL2 with no record, and a word in the
 * console only where `?engine=webgpu` asked for it.
 */
export async function resolveWebGpu<E>(
  input: EngineInput,
  steps: WebGpuSteps<E>,
  budgets: { fetchMs: number; startMs: number } = { fetchMs: WEBGPU_FETCH_MS, startMs: WEBGPU_START_MS },
  now: () => number = () => Date.now(),
): Promise<E | null> {
  const unfit = (why: string | null): null => {
    if (input.override === "webgpu") steps.warn(`WebGPU: not on this browser (${why}); drawing with WebGL2.`);
    return null;
  };
  if (!steps.available()) return unfit("no WebGPU");
  let fetchLeft = budgets.fetchMs;
  let startLeft = budgets.startMs;
  /** `promise` within `left` ms, and the ms it took. */
  const timed = async <T>(promise: Promise<T>, left: number): Promise<[T | typeof TIMED_OUT, number]> => {
    const from = now();
    const value = await withinTime(promise, Math.max(0, left));
    return [value, now() - from];
  };

  let gpu: Awaited<ReturnType<WebGpuSteps<E>["load"]>>;
  try {
    const [loaded, took] = await timed(steps.load(), fetchLeft);
    if (loaded === TIMED_OUT) {
      steps.warn(`WebGPU: its module did not load in ${budgets.fetchMs} ms; drawing with WebGL2.`);
      return null;
    }
    gpu = loaded;
    fetchLeft -= took;
  } catch (err) {
    steps.warn("WebGPU: its module did not load; drawing with WebGL2.", err);
    return null;
  }

  const [report, probed] = await timed(gpu.probe().catch(() => null), startLeft);
  if (report === TIMED_OUT) {
    steps.remember("init");
    steps.warn(`WebGPU: the adapter did not answer in ${budgets.startMs} ms; drawing with WebGL2.`);
    return null;
  }
  startLeft -= probed;
  const fit = adapterFits(report);
  if (chooseEngine({ ...input, fits: fit.fits }) !== "webgpu") return unfit(fit.why);

  try {
    const [fetched] = await timed(gpu.fetchTranslators(), fetchLeft);
    if (fetched === TIMED_OUT) {
      steps.warn(`WebGPU: its translators did not load in ${budgets.fetchMs} ms; drawing with WebGL2.`);
      return null;
    }
  } catch (err) {
    steps.warn("WebGPU: its translators did not load; drawing with WebGL2.", err);
    return null;
  }

  try {
    return await gpu.create(Math.max(0, startLeft), featuresToRequest(report?.features ?? []));
  } catch (err) {
    steps.remember("init");
    steps.warn("WebGPU: the engine did not start; drawing with WebGL2.", err);
    return null;
  }
}

/** `href` with `engine=` set, everything else kept. */
export function withEngine(href: string, engine: EngineName): string {
  const url = new URL(href);
  url.searchParams.set("engine", engine);
  return url.toString();
}
