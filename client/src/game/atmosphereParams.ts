import { clamp01, mixRgb, type Rgb } from "./colour.js";
import { sunColourAt, sunPositionAt, type Vec3 } from "./sky.js";
import { dreadWorldUnder, fogColourUnder, fogDensityUnder, type WeatherParams } from "./weather.js";

/**
 * The pure arithmetic of the atmosphere plugin: height fog, the distance
 * gradient and the sun-direction inscatter. Babylon-free and on the
 * architecture test's BABYLON_FREE_FILES list; `atmosphere.ts` is the shell
 * that binds it. Every function is exact at `clear`.
 */

export type AtmosphereRecord = {
  baseDensity: number;
  heightDensity: number;
  heightFalloff: number;
  referenceLevel: number;
  gradientScale: number;
  sunDir: Vec3;
  sunColour: Rgb;
  sunWeight: number;
  sunPower: number;
};

export const GRADIENT_STEPS = 256;

// ---- Browser-tunable magnitudes. `clear` identity is not. ----

/** Quílez `a` at clear: a faint valley haze even on a sunny day. */
export const HEIGHT_DENSITY_BASE = 0.004;
/** Height-density gain at full mist: density × (1 + gain·mist). */
export const HEIGHT_MIST_GAIN = 2;
/** Quílez `b`, per metre: the fog halves every ~14 m of height. */
export const HEIGHT_FALLOFF = 0.05;
/** World y the height fog is densest at, at clear. Below the trailhead pad. */
export const REFERENCE_LEVEL_BASE = -20;
/** Metres the reference level rises at full mist. */
export const LEVEL_MIST_RISE = 8;
/** Additional rise on the top dread plateau. */
export const LEVEL_DREAD_RISE = 6;
/** Exponent on dot(rd, sunDir): 8 is a broad warm glow, 64 a tight disc. */
export const SUN_POWER = 8;
/** How much of the sun glow survives full cloud cover. */
export const SUN_CLOUD_SURVIVAL = 0.1;
/** Near-end dimming of the gradient: air close by is denser and darker. */
export const GRADIENT_NEAR_DIM = 0.85;
/** Bias of the gradient toward the near colour: t^(1/GRADIENT_BIAS). */
export const GRADIENT_BIAS = 1.6;

/**
 * Quílez's closed-form height fog: density a·exp(−b·y) integrated along a
 * ray of length t from height camY (relative to `level`) with vertical slope
 * rdY. Mirrors `atmHeightFog` in atmosphereFog.fragment.fx exactly, including
 * the clamp that keeps a level ray from dividing by zero.
 */
export function heightFogAmount(camY: number, rdY: number, t: number, a: number, b: number, level: number): number {
  const y0 = camY - level;
  const slope = Math.abs(rdY) < 1e-3 ? (rdY < 0 ? -1e-3 : 1e-3) : rdY;
  return ((a / b) * Math.exp(-y0 * b) * (1 - Math.exp(-t * slope * b))) / slope;
}

/** 1 with the sun up under clear; scaled by cloud; 0 once the sun is below the horizon. */
export function sunWeightUnder(w: WeatherParams, altitude: number): number {
  if (altitude <= 0) return 0;
  const c = clamp01(w.cloudCover);
  const up = clamp01(altitude / 0.1);
  return up * (1 - (1 - SUN_CLOUD_SURVIVAL) * c);
}

/** Near → far, GRADIENT_STEPS entries, linear. Far end is exactly `fogColourUnder`. */
export function fogGradientUnder(w: WeatherParams, hour: number): Rgb[] {
  const far = fogColourUnder(w, hour);
  const near = { r: far.r * GRADIENT_NEAR_DIM, g: far.g * GRADIENT_NEAR_DIM, b: far.b * GRADIENT_NEAR_DIM };
  const out: Rgb[] = [];
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    const t = i / (GRADIENT_STEPS - 1);
    out.push(i === GRADIENT_STEPS - 1 ? far : mixRgb(near, far, Math.pow(t, 1 / GRADIENT_BIAS)));
  }
  return out;
}

export function atmosphereUnder(w: WeatherParams, hour: number, viewDistance: number): AtmosphereRecord {
  const m = clamp01(w.mist);
  const d = dreadWorldUnder(w);
  const toSun = sunPositionAt(hour);
  return {
    baseDensity: fogDensityUnder(w, viewDistance),
    heightDensity: HEIGHT_DENSITY_BASE * (1 + HEIGHT_MIST_GAIN * m),
    heightFalloff: HEIGHT_FALLOFF,
    referenceLevel: REFERENCE_LEVEL_BASE + LEVEL_MIST_RISE * m + LEVEL_DREAD_RISE * d,
    gradientScale: 1 / viewDistance,
    sunDir: toSun,
    sunColour: sunColourAt(hour),
    sunWeight: sunWeightUnder(w, toSun.y),
    sunPower: SUN_POWER,
  };
}
