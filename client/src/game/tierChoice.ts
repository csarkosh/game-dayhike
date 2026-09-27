/**
 * Where the tier comes from, and Auto's record in storage.
 *
 * The order is `resolveTier`'s: `?tier=` in the address (for testing) over the
 * player's choice, and the choice over Auto. Auto's record (`AutoRecord`,
 * `quality.ts`) is kept under `AUTO_KEY`, in the storage `pageStorage` gives.
 * Every storage access is inside `try`/`catch`: a private window or a browser
 * that blocks site data throws on the accessor itself, and a record that does
 * not read back whole is no record.
 */
import { CLASS_TIERS, type GpuClass } from "./gpuClass.js";
import { withVerdict, type AutoRecord, type AutoVerdict, type ProbeReading, type QualityTier } from "./quality.js";

export const AUTO_KEY = "dayhike.quality.auto";
/** Where the player's choice is kept. */
export const QUALITY_KEY = "dayhike.quality";

/** The player's choice on the Settings screen: Auto, or a tier. */
export type TierChoice = "auto" | QualityTier;

export type TierSource = "override" | "choice" | "auto";

function isTier(value: unknown): value is QualityTier {
  return value === "low" || value === "medium" || value === "high";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClass(value: unknown): value is GpuClass {
  return typeof value === "string" && Object.hasOwn(CLASS_TIERS, value);
}

const TIER_NAMES: Record<QualityTier, string> = { high: "High", medium: "Medium", low: "Low" };

/** Where the landing's one-shot notice waits, for this tab only. */
export const NOTICE_KEY = "dayhike.notice";
/** How long a line left for the landing waits to be shown: a reload before
 * the landing drew it drops it rather than show it out of its moment. */
export const NOTICE_MAX_AGE_MS = 30_000;

/** The page's `sessionStorage`, or null where there is none or its accessor
 * throws. */
export function pageSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Leaves a line, dated `now` (`Date.now()`), for the landing page to show
 * once; false where storage refuses. */
export function leaveNotice(storage: Storage | null, text: string, now: number): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(NOTICE_KEY, JSON.stringify({ text, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** The line left for the landing, taken so it shows once; null when there is
 * none, or it is not one, or it was left more than `NOTICE_MAX_AGE_MS` before
 * `now` or dated after it. */
export function takeNotice(storage: Storage | null, now: number): string | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(NOTICE_KEY);
    if (raw === null) return null;
    storage.removeItem(NOTICE_KEY);
    const left: unknown = JSON.parse(raw);
    if (typeof left !== "object" || left === null) return null;
    const { text, at } = left as { text?: unknown; at?: unknown };
    if (typeof text !== "string" || typeof at !== "number") return null;
    const age = now - at;
    return age >= 0 && age <= NOTICE_MAX_AGE_MS ? text : null;
  } catch {
    return null;
  }
}

/**
 * What a tier that failed to build leaves in storage (design §9.3). Under
 * `?tier=` nothing: it is for testing. Otherwise a `build` verdict at the tier
 * that did build (low when none did), for this version, GPU, browser and
 * class, holding 30 days at any window, so Auto starts there and never tries
 * the failed tier each hike. And where the tier came from the stored choice
 * (source `choice`, the stored choice the tier that failed), the choice goes
 * back to Auto with a line saying so: no record can override an explicit
 * choice, which would otherwise be retried at every hike.
 */
export function recordFallback(input: {
  record: AutoRecord | null;
  gpu: string;
  browser: number;
  cls: GpuClass;
  attempted: QualityTier;
  built: QualityTier | null;
  source: TierSource;
  choice: TierChoice;
  pixels: number;
  now: number;
}): { record: AutoRecord | null; choice: TierChoice | null; notice: string | null } {
  if (input.source === "override") return { record: null, choice: null, notice: null };
  const verdict: AutoVerdict = { tier: input.built ?? "low", source: "build", pixels: input.pixels, at: input.now };
  const record = withVerdict(input.record, input.gpu, input.browser, input.cls, verdict);
  if (input.source !== "choice" || input.choice !== input.attempted) return { record, choice: null, notice: null };
  return {
    record,
    choice: "auto",
    notice: `${TIER_NAMES[input.attempted]} did not start on this computer, so Settings is back on Auto (Recommended).`,
  };
}

/** The page's `localStorage`, or null where there is none or its accessor
 * throws (a private window, a browser that blocks site data). */
export function pageStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** `?tier=low|medium|high`, else null. */
export function parseTierOverride(search: string): QualityTier | null {
  const value = new URLSearchParams(search).get("tier");
  return isTier(value) ? value : null;
}

/** `?probe=high|medium`, else null: a probe from that tier on Auto, whatever
 * the class and the record, for measuring. Low is never measured. */
export function parseProbeOverride(search: string): QualityTier | null {
  const value = new URLSearchParams(search).get("probe");
  return value === "high" || value === "medium" ? value : null;
}

function asReading(value: unknown): ProbeReading | null {
  if (!isObject(value)) return null;
  const { tier, frames, meanMs, p95Ms, pixels, engine } = value;
  if (!isTier(tier) || !isNumber(frames) || !isNumber(meanMs) || !isNumber(p95Ms) || !isNumber(pixels)) return null;
  if (engine !== "webgl2" && engine !== "webgpu") return null;
  return { tier, frames, meanMs, p95Ms, pixels, engine };
}

/**
 * A verdict, or null. Its readings are a log the tier never reads, so a reading
 * that does not read back whole is dropped rather than the verdict with it:
 * `JSON.stringify` writes a NaN or an Infinity as null, which then fails here.
 */
function asVerdict(value: unknown): AutoVerdict | null {
  if (!isObject(value)) return null;
  const { tier, source, pixels, at, readings } = value;
  if (!isTier(tier) || (source !== "probe" && source !== "governor" && source !== "build") || !isNumber(pixels) || !isNumber(at)) {
    return null;
  }
  if (!Array.isArray(readings)) return { tier, source, pixels, at };
  const kept = readings.map(asReading).filter((reading): reading is ProbeReading => reading !== null);
  return { tier, source, pixels, at, readings: kept };
}

function asRecord(value: unknown): AutoRecord | null {
  if (!isObject(value)) return null;
  const { v, gpu, cls, browser, attempts, verdict } = value;
  if (!isNumber(v) || typeof gpu !== "string" || !isClass(cls) || !isNumber(browser) || !isNumber(attempts)) return null;
  if (verdict === null) return { v, gpu, cls, browser, attempts, verdict: null };
  const held = asVerdict(verdict);
  return held === null ? null : { v, gpu, cls, browser, attempts, verdict: held };
}

/** Auto's record, or null: none stored, no storage, a storage that throws,
 * or a stored value that is not a whole record. */
export function readAutoRecord(storage: Storage | null): AutoRecord | null {
  if (storage === null) return null;
  try {
    const text = storage.getItem(AUTO_KEY);
    return text === null ? null : asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * The player's choice, and whether the browser keeps it: Auto when nothing
 * (or nothing recognisable) is saved; Auto and not kept where the storage is
 * missing or refuses.
 */
export function readChoice(storage: Storage | null): { choice: TierChoice; stored: boolean } {
  if (storage === null) return { choice: "auto", stored: false };
  try {
    const value = storage.getItem(QUALITY_KEY);
    return { choice: value === "auto" || isTier(value) ? value : "auto", stored: true };
  } catch {
    return { choice: "auto", stored: false };
  }
}

/** Keeps the player's choice; false where there is no storage or it refuses. */
export function writeChoice(storage: Storage | null, choice: TierChoice): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(QUALITY_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/**
 * The player's choice for the page's life: read from and kept in `storage()`
 * where it can be, and held here where a write is refused, with `stored()`
 * false until a later write succeeds.
 */
export function createChoiceKeeper(storage: () => Storage | null): {
  choice(): TierChoice;
  stored(): boolean;
  save(choice: TierChoice): void;
} {
  let held: TierChoice | null = null;
  let refused = false;
  return {
    choice: () => held ?? readChoice(storage()).choice,
    stored: () => !refused && readChoice(storage()).stored,
    save(choice) {
      if (writeChoice(storage(), choice)) {
        held = null;
        refused = false;
        return;
      }
      held = choice;
      refused = true;
    },
  };
}

/** Stores Auto's record; false where there is no storage or it refuses. */
export function writeAutoRecord(storage: Storage | null, record: AutoRecord): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(AUTO_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** The tier to build, and which of the three decided it. */
export function resolveTier(input: {
  override: QualityTier | null;
  choice: TierChoice;
  auto: QualityTier;
}): { tier: QualityTier; source: TierSource } {
  if (input.override !== null) return { tier: input.override, source: "override" };
  if (input.choice !== "auto") return { tier: input.choice, source: "choice" };
  return { tier: input.auto, source: "auto" };
}
