/**
 * Where the tier comes from, and Auto's record in storage.
 *
 * The order is `resolveTier`'s: `?tier=` in the address (for testing) over the
 * player's choice, and the choice over Auto. Auto's record (`AutoRecord`,
 * `quality.ts`) is kept under `AUTO_KEY`. Every storage access is inside
 * `try`/`catch`: a private window or a browser that blocks site data throws on
 * the accessor itself, and a record that does not read back whole is no record.
 */
import type { AutoRecord, AutoVerdict, ProbeReading, QualityTier } from "./quality.js";

export const AUTO_KEY = "dayhike.quality.auto";

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

/** `?tier=low|medium|high`, else null. */
export function parseTierOverride(search: string): QualityTier | null {
  const value = new URLSearchParams(search).get("tier");
  return isTier(value) ? value : null;
}

function asReading(value: unknown): ProbeReading | null {
  if (!isObject(value)) return null;
  const { tier, frames, meanMs, p95Ms, pixels, engine } = value;
  if (!isTier(tier) || !isNumber(frames) || !isNumber(meanMs) || !isNumber(p95Ms) || !isNumber(pixels)) return null;
  if (engine !== "webgl2" && engine !== "webgpu") return null;
  return { tier, frames, meanMs, p95Ms, pixels, engine };
}

function asVerdict(value: unknown): AutoVerdict | null {
  if (!isObject(value)) return null;
  const { tier, source, pixels, at, readings } = value;
  if (!isTier(tier) || (source !== "probe" && source !== "governor") || !isNumber(pixels) || !isNumber(at)) return null;
  if (readings === undefined) return { tier, source, pixels, at };
  if (!Array.isArray(readings)) return null;
  const read = readings.map(asReading);
  if (read.some((reading) => reading === null)) return null;
  return { tier, source, pixels, at, readings: read as ProbeReading[] };
}

function asRecord(value: unknown): AutoRecord | null {
  if (!isObject(value)) return null;
  const { v, gpu, browser, attempts, verdict } = value;
  if (!isNumber(v) || typeof gpu !== "string" || !isNumber(browser) || !isNumber(attempts)) return null;
  if (verdict === null) return { v, gpu, browser, attempts, verdict: null };
  const held = asVerdict(verdict);
  return held === null ? null : { v, gpu, browser, attempts, verdict: held };
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
  choice: "auto" | QualityTier;
  auto: QualityTier;
}): { tier: QualityTier; source: TierSource } {
  if (input.override !== null) return { tier: input.override, source: "override" };
  if (input.choice !== "auto") return { tier: input.choice, source: "choice" };
  return { tier: input.auto, source: "auto" };
}
