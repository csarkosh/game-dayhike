/**
 * Which engine draws the game: WebGL2, as every tier always has, or Babylon's
 * WebGPU engine on the tiers `WEBGPU_TIERS` names, where the browser offers a
 * hardware adapter with the limits the scene needs. Decided once, before the
 * game starts (`main.ts`), and remembered when WebGPU fails, so a failing
 * engine is tried again only after the browser or Babylon moves on.
 *
 * Pure on purpose, like `quality.ts`: the parts that touch `navigator.gpu`
 * live in `gpuEngine.ts`, which only the WebGPU path loads, and everything
 * here takes plain values so the rule can be tested with literal inputs.
 * Storage is read and written through the `Storage` it is handed, every
 * access wrapped as `playerName.ts` wraps its own.
 */
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
 * outgrows them fails here rather than only on a weaker adapter. Seventeen
 * inter-stage variables are the blade material's (PBR's varyings plus the
 * foliage plugin's four), one over the default of 16; eight vertex buffers are
 * a terrain ring's six and the default.
 */
export const WEBGPU_REQUIRED_LIMITS: Readonly<Record<string, number>> = {
  maxInterStageShaderVariables: 17,
  maxVertexBuffers: 8,
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
/** The HUD line carried across a fallback reload, in `sessionStorage`. */
export const FALLBACK_NOTICE_KEY = "dayhike.engine.notice";
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

/** What the page shows while the engine is chosen: the landing's own word. */
const ENGINE_WAIT_LINE = "Loading…";

/** The line to show over the canvas for a choice, or null where there is no
 * wait: only a `"probe"` answer waits, for the adapter and perhaps the engine. */
export function engineWaitLine(choice: EngineName | "probe"): string | null {
  return choice === "probe" ? ENGINE_WAIT_LINE : null;
}
/** The startup window closes once no effect has compiled for this long after
 * the first frame… */
export const STARTUP_QUIET_MS = 10_000;
/** …or this long after the engine was made, whichever is first. */
export const STARTUP_MAX_MS = 60_000;
/** How long the HUD shows the line after a fallback reload. */
export const FALLBACK_NOTICE_MS = 6_000;

export const NOTICE_SWITCHED = "Graphics switched to WebGL2 after a GPU error.";
export const NOTICE_RESTARTED = "Graphics restarted after a GPU error.";

const DAY_MS = 86_400_000;

/** `?engine=webgl2|webgpu`, on any tier; anything else is no override. */
export function parseEngineOverride(search: string): EngineName | null {
  const value = new URLSearchParams(search).get("engine");
  return value === "webgl2" || value === "webgpu" ? value : null;
}

/** `?tier=low|medium|high`, in place of detection. */
export function parseTierOverride(search: string): QualityTier | null {
  const value = new URLSearchParams(search).get("tier");
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

/** What `gpuEngine.ts` learns of the high-performance adapter. */
export type AdapterReport = {
  limits: Readonly<Record<string, number>>;
  isFallbackAdapter: boolean;
  /** The adapter's optional features, where it was asked for them. */
  features?: readonly string[];
};

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

export type FallbackReason = "init" | "pipeline" | "lost";

/**
 * A remembered failure: why, on which browser major and Babylon version, when,
 * and how many lost devices in the last `LOSS_WINDOW_MS`.
 */
export type FallbackRecord = { reason: FallbackReason; browser: number; babylon: string; at: number; losses: number };

export type EngineEnv = { browser: number; babylon: string };

/** The browser's major version: the first of `Chrome/`, `Firefox/` and
 * `Version/` (Safari) found, else 0. A change is what earns WebGPU a retry. */
export function browserMajor(userAgent: string): number {
  for (const key of ["Chrome", "Firefox", "Version"]) {
    const match = new RegExp(`${key}/(\\d+)`).exec(userAgent);
    if (match) return Number(match[1]);
  }
  return 0;
}

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

/** A storage area, or null where the accessor itself throws (a private window,
 * blocked site data). */
export function safeStorage(get: () => Storage): Storage | null {
  try {
    return get();
  } catch {
    return null;
  }
}

/**
 * The startup window: from the engine's creation until no effect has compiled
 * for `STARTUP_QUIET_MS` after the first frame, or `STARTUP_MAX_MS`, whichever
 * is first. Once closed it stays closed. A failure inside it reloads onto
 * WebGL2; after it, it waits for the next load.
 */
export function createStartupWindow(created: number): {
  frame(now: number): void;
  compiled(now: number): void;
  open(now: number): boolean;
} {
  let firstFrame: number | null = null;
  let quietFrom = created;
  let closed = false;
  const open = (now: number): boolean => {
    if (!closed && (now - created >= STARTUP_MAX_MS || (firstFrame !== null && now - quietFrom >= STARTUP_QUIET_MS))) {
      closed = true;
    }
    return !closed;
  };
  return {
    frame(now) {
      if (firstFrame === null && open(now)) {
        firstFrame = now;
        quietFrom = now;
      }
    },
    compiled(now) {
      if (open(now) && firstFrame !== null) quietFrom = now;
    },
    open,
  };
}

/**
 * What the page does about a failure on WebGPU once the game is running,
 * after the record has been written (`stored`) and read back (`holds`).
 * A failure in the startup window and a lost device reload; any other failure
 * only waits for the next load. The reload carries `engine=webgl2` wherever a
 * plain reload would start WebGPU again: storage refused the record, or
 * `?engine=webgpu`, which outranks it, is in the URL.
 */
export function failureAction(input: {
  stored: boolean;
  holds: boolean;
  reason: "pipeline" | "lost";
  inStartup: boolean;
  override: EngineName | null;
}): { reload: "none" | "reload" | "webgl2"; notice: string | null } {
  if (input.reason !== "lost" && !input.inStartup) return { reload: "none", notice: null };
  const toWebGl2 = !input.stored || input.holds;
  if (!toWebGl2) return { reload: "reload", notice: NOTICE_RESTARTED };
  const pinned = !input.stored || input.override === "webgpu";
  return { reload: pinned ? "webgl2" : "reload", notice: NOTICE_SWITCHED };
}

/** The line one GPU error after the startup window logs: what the next load
 * will do, which is WebGL2 only where the record was stored and no
 * `?engine=webgpu` outranks it, or where this tab's URL was pinned instead. */
export function lateFailureLine(stored: boolean, override: EngineName | null): string {
  const head = "WebGPU: a GPU error after startup; ";
  if (!stored) return `${head}storage refused the record, so this tab's URL now asks for WebGL2.`;
  if (override === "webgpu") return `${head}remembered, but ?engine=webgpu in this URL still asks for WebGPU.`;
  return `${head}the next load draws with WebGL2.`;
}

/** The query parameters that belong to this page alone (design §5.3). */
const OVERRIDES = ["engine", "tier"] as const;

/**
 * `route` (a path and query, as a lobby host announces it) without `engine=`
 * and `tier=`, so a test override or a pinned fallback never follows a host
 * onto a follower's machine. A route with neither comes back byte for byte.
 */
export function stripOverrides(route: string): string {
  const at = route.indexOf("?");
  if (at < 0) return route;
  const params = new URLSearchParams(route.slice(at));
  if (!OVERRIDES.some((name) => params.has(name))) return route;
  for (const name of OVERRIDES) params.delete(name);
  const query = params.toString();
  return query === "" ? route.slice(0, at) : `${route.slice(0, at)}?${query}`;
}

/**
 * Whether two routes (a path and query each) are the same place: the same
 * path and the same parameters in any order, each decoded, with `engine=` and
 * `tier=` left out. A follower compares the host's route with its own this
 * way, since the two sides encode one query differently (`%20` or `+` for a
 * space, `;` or `%3B`), and a route that reads as changed makes the follower
 * rebuild its game.
 */
export function sameRoute(a: string, b: string): boolean {
  const canonical = (route: string): string => {
    const at = route.indexOf("?");
    const params = new URLSearchParams(at < 0 ? "" : route.slice(at));
    const entries = [...params].filter(([name]) => !(OVERRIDES as readonly string[]).includes(name));
    // By name only, and stably: a name's repeated values keep their order,
    // since the page reads the first of them.
    entries.sort(([n1], [n2]) => (n1 < n2 ? -1 : n1 > n2 ? 1 : 0));
    return JSON.stringify([at < 0 ? route : route.slice(0, at), entries]);
  };
  return canonical(a) === canonical(b);
}

/** `route` with this page's own `engine=` and `tier=` (from `ownSearch`)
 * carried onto it: where a follower goes, its own overrides go too. */
export function keepOverrides(route: string, ownSearch: string): string {
  const own = new URLSearchParams(ownSearch);
  if (!OVERRIDES.some((name) => own.has(name))) return route;
  const at = route.indexOf("?");
  const params = new URLSearchParams(at < 0 ? "" : route.slice(at));
  for (const name of OVERRIDES) {
    const value = own.get(name);
    if (value !== null) params.set(name, value);
  }
  return `${at < 0 ? route : route.slice(0, at)}?${params.toString()}`;
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
  /** The WebGPU module: `import("./gpuEngine.js")`, adapted. */
  load(): Promise<{
    probe(): Promise<AdapterReport | null>;
    /** The translators (`loadTranslators`), fetched only once the adapter fits. */
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
 * adapter asked, and only where it fits are the translators fetched and the
 * engine made, so a browser that cannot run WebGPU fetches no translator, and
 * one without WebGPU at all fetches nothing. Two budgets, each a running total
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

/** Leaves the HUD line for the next load; dropped silently where storage
 * throws. */
export function leaveNotice(storage: Storage | null, line: string): void {
  try {
    storage?.setItem(FALLBACK_NOTICE_KEY, line);
  } catch {
    /* the reload still happens; only the line is lost */
  }
}

/** The line a fallback reload left, once: it is removed as it is read. */
export function takeNotice(storage: Storage | null): string | null {
  try {
    const line = storage?.getItem(FALLBACK_NOTICE_KEY);
    if (typeof line !== "string") return null;
    storage?.removeItem(FALLBACK_NOTICE_KEY);
    return line;
  } catch {
    return null;
  }
}
