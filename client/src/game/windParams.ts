import { clamp01 } from "./colour.js";
import type { WeatherParams } from "./weather.js";

/**
 * The one wind field every moving thing reads: grass, carpet, flowers, bushes,
 * understory, the near tree LODs (foliagePlugin.ts), the motes, the mist banks,
 * the rain and the ambient wind bed. Babylon-free and on BABYLON_FREE_FILES.
 * Renderer-only by design: nothing here may migrate into sim/ or a tunables
 * registry — sway is cosmetic, peers need not agree on phase, and a wind
 * constant in the level id would break invite links.
 *
 * Time is wrapped at WIND_TIME_WRAP seconds and every temporal frequency is an
 * exact multiple of 2π / WIND_TIME_WRAP (`omegaMultiple` is asserted integral
 * in the tests), so the wrap is phase-continuous and the float32 sin()
 * argument in the shader never grows past ~3800.
 */

export const WIND_TIME_WRAP = 300;
/** rad/s: n = 18, 42 and 600 of 2π / 300. The gust pair is unchanged from the retired windField.ts. */
export const WIND_OMEGA_GUST = 0.3769911184;
export const WIND_OMEGA_GUST2 = 0.879645943;
export const WIND_OMEGA_FLUTTER = 12.5663706144;
/** rad/m: a 25 m primary wave (1.5 m/s downwind at Ω1) and a 9 m second octave. */
export const WIND_K1 = (2 * Math.PI) / 25;
export const WIND_K2 = (2 * Math.PI) / 9;
/** Peak-to-peak ragged phase offset per 6 m cell (±0.6 rad). */
export const WIND_RAGGED = 1.2;
export const WIND_RAGGED_CELL = 6;
/** speed = WIND_BASE + WIND_CLOUD·cloudCover + WIND_RAIN·rain, clamped to 1. */
export const WIND_BASE = 0.25;
export const WIND_CLOUD = 0.35;
export const WIND_RAIN = 0.3;
/** Tip lean, gust and flutter amplitudes at speed 1, as fractions of mesh height. */
export const WIND_LEAN_MAX = 0.35;
export const WIND_GUST_MAX = 0.25;
export const WIND_FLUTTER_MAX = 0.04;
/** Direction: a slow turn, one revolution per WIND_DIR_PERIOD seconds from WIND_DIR_BASE. */
export const WIND_DIR_BASE = 0.6;
export const WIND_DIR_PERIOD = 1200;

export type WindRecord = {
  dirX: number;
  dirZ: number;
  speed: number;
  lean: number;
  gustAmp: number;
  flutterAmp: number;
  time: number;
};

/** ω divided by the wrap's fundamental; integral for a phase-continuous wrap. */
export function omegaMultiple(omega: number): number {
  return omega / ((2 * Math.PI) / WIND_TIME_WRAP);
}

export function windSpeedUnder(w: WeatherParams): number {
  return clamp01(WIND_BASE + WIND_CLOUD * clamp01(w.cloudCover) + WIND_RAIN * clamp01(w.rain));
}

export function directionAt(seconds: number): { x: number; z: number } {
  const a = WIND_DIR_BASE + (seconds * 2 * Math.PI) / WIND_DIR_PERIOD;
  return { x: Math.cos(a), z: Math.sin(a) };
}

/** `override`, when given, replaces the weather-driven speed (the /wind command). */
export function windRecordUnder(w: WeatherParams, seconds: number, override?: number): WindRecord {
  const speed = override === undefined ? windSpeedUnder(w) : clamp01(override);
  const d = directionAt(seconds);
  return {
    dirX: d.x,
    dirZ: d.z,
    speed,
    lean: WIND_LEAN_MAX * speed,
    gustAmp: WIND_GUST_MAX * speed,
    flutterAmp: WIND_FLUTTER_MAX * speed,
    time: seconds % WIND_TIME_WRAP,
  };
}

/** The gust the shader evaluates (foliage.vertex.fx `foliageGust`), in [-1.5, 1.5].
 * The ragged term is a golden-ratio lattice hash: multiply-add-fract on cell
 * indices, which GPU and CPU compute to the same 1e-3, unlike a sin() hash. */
export function gustAt(r: WindRecord, x: number, z: number): number {
  const u = r.dirX * x + r.dirZ * z;
  const ci = Math.floor(x / WIND_RAGGED_CELL);
  const cj = Math.floor(z / WIND_RAGGED_CELL);
  const f = ci * 0.618034 + cj * 0.381966;
  const ragged = WIND_RAGGED * (f - Math.floor(f) - 0.5);
  return (
    Math.sin(WIND_K1 * u + WIND_OMEGA_GUST * r.time + ragged) +
    0.5 * Math.sin(WIND_K2 * u + WIND_OMEGA_GUST2 * r.time + 1.7 * ragged)
  );
}
