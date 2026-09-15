import { clamp01 } from "./colour.js";
import type { QualityTier } from "./quality.js";
import { dreadLensUnder, type WeatherParams } from "./weather.js";

/**
 * The pure arithmetic of the post chain: which passes a tier gets, and the
 * finish pass's record. Babylon-free and on the architecture test's
 * BABYLON_FREE_FILES list; `post.ts` is the shell.
 */

export type PostFeatures = { pipeline: boolean; halation: boolean; colourPath: "post" | "material" };

/**
 * The tier ladder as data. Without float render targets (NullEngine, weak
 * WebGL) nothing HDR can run, so every tier falls to the material path: an
 * 8-bit chain would band the very frames this restyle exists for.
 */
export function postFeaturesFor(tier: QualityTier, fxSupported: boolean): PostFeatures {
  if (!fxSupported || tier === "low") return { pipeline: false, halation: false, colourPath: "material" };
  return { pipeline: true, halation: tier === "high", colourPath: "post" };
}

export type FinishRecord = { overlapGain: number; overlapPhase: number; grainGain: number; time: number };

// ---- Browser-tunable magnitudes. `clear` identity is not. ----
/** Overlap gain at full dread and unsettle 1. */
export const OVERLAP_MAX = 0.35;
/** Radius (of the half-diagonal) inside which the overlap mask is zero. */
export const OVERLAP_INNER = 0.55;
/** Scale of the echo about the frame centre. */
export const OVERLAP_SCALE = 1.06;
/** The echo's breathing rate. */
export const OVERLAP_BREATH_HZ = 0.05;
/** Grain amplitude in display units at clear; near the threshold of perception. */
export const GRAIN_BASE = 0.035;
/** Grain gain at full dread: base × (1 + gain). */
export const GRAIN_DREAD_GAIN = 1.5;
/** One 8-bit step. The finish pass applies TPDF dither at ±1 LSB
 * (`(d1 + d2 − 1) · LSB`, the sum of two uniform draws), the correct
 * triangular form — not ±½ LSB, which is RPDF (a single uniform draw). Don't
 * "fix" it to ±½. */
export const DITHER_LSB = 1 / 255;
/** Linear, EXPOSED scene luminance above which halation is extracted: brighter
 * than display white before the tone map rolls it off. */
export const HALATION_THRESHOLD = 1.0;
/** Luminance excess at which the extract saturates; keeps the response bounded. */
export const HALATION_CAP = 4.0;

export function finishUnder(w: WeatherParams, unsettle: number, timeSeconds: number): FinishRecord {
  const lens = dreadLensUnder(w) * clamp01(unsettle);
  return {
    overlapGain: lens === 0 ? 0 : OVERLAP_MAX * lens,
    overlapPhase: (timeSeconds * OVERLAP_BREATH_HZ) % 1,
    grainGain: lens === 0 ? GRAIN_BASE : GRAIN_BASE * (1 + GRAIN_DREAD_GAIN * lens),
    time: timeSeconds,
  };
}
