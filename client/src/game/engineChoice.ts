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
 * gates pass; until then only `?engine=webgpu` reaches it. */
export const WEBGPU_ON_HIGH = false;

/** The tiers the WebGPU default applies to. Medium, low and the landing
 * backdrop stay WebGL2. */
export const WEBGPU_TIERS: readonly QualityTier[] = ["high"];

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

/** The remembered fallback, in `localStorage`. */
export const FALLBACK_KEY = "dayhike.engine";
/** The HUD line carried across a fallback reload, in `sessionStorage`. */
export const FALLBACK_NOTICE_KEY = "dayhike.engine.notice";
/** How long a remembered fallback holds while nothing else changes. */
export const FALLBACK_DAYS = 30;
/** A second lost device inside this window remembers WebGL2. */
export const LOSS_WINDOW_MS = 86_400_000;
/** Making the WebGPU engine, translators included, gets this long. */
export const WEBGPU_START_MS = 15_000;
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
export type AdapterReport = { limits: Readonly<Record<string, number>>; isFallbackAdapter: boolean };

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
  /** `WEBGPU_ON_HIGH`, passed in so the rule can be tested both ways. */
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
 * last one counts up; any other starts the count again. */
export function recordFailure(
  prev: FallbackRecord | null,
  reason: FallbackReason,
  env: EngineEnv,
  now: number,
): FallbackRecord {
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
