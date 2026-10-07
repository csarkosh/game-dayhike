import { clamp01, mixRgb, type Rgb } from "./colour.js";
import type { Vec3 } from "./sky.js";
import type { SkyState } from "./skyState.js";
import { airColourUnder, dreadWorldUnder, fogDensityUnder, type WeatherParams } from "./weather.js";

/**
 * The pure arithmetic of the atmosphere plugin: height fog, the distance
 * gradient and the glow toward the sun. Babylon-free and on the architecture
 * test's BABYLON_FREE_FILES list; `atmosphere.ts` is the shell that binds it.
 * Its colours are the sky state's (`skyState.ts`): the gradient ends on the
 * dome's horizon away from the sun, and the glow is its horizon toward it, so
 * the haze and the sky behind it cannot disagree.
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
  /** The gradient's far end, the sky state's mist air: the shader draws the gradient on it (fogGradientUnder). */
  farColour: Rgb;
};

export const GRADIENT_STEPS = 256;

// ---- Browser-tunable magnitudes. ----

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

/**
 * Near → far, GRADIENT_STEPS entries, linear. The far end is exactly the sky
 * state's mist air: the fog colour, the clear colour and, at clear, the
 * dome's horizon away from the sun, one colour. `w` is the weather the state
 * was made under; its mist, cloud, rain and dread are in that colour already.
 * The shader draws the same curve on `farColour` itself (ATM_NEAR_DIM and
 * ATM_GRADIENT_BIAS in atmosphereFog.fragment.fx mirror GRADIENT_NEAR_DIM and
 * GRADIENT_BIAS); this list is for the mist banks' and motes' colours.
 */
export function fogGradientUnder(w: WeatherParams, sky: SkyState): Rgb[] {
  const far = { r: sky.mistAir.r, g: sky.mistAir.g, b: sky.mistAir.b };
  const near = { r: far.r * GRADIENT_NEAR_DIM, g: far.g * GRADIENT_NEAR_DIM, b: far.b * GRADIENT_NEAR_DIM };
  const out: Rgb[] = [];
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    const t = i / (GRADIENT_STEPS - 1);
    out.push(i === GRADIENT_STEPS - 1 ? far : mixRgb(near, far, Math.pow(t, 1 / GRADIENT_BIAS)));
  }
  return out;
}

/**
 * The plugin's record. The glow is the horizon toward the sun under the
 * weather's air, centred on the sun's azimuth at the horizon and as wide as
 * the horizon's fall-off away from it (`fitGlow`, `skyState.ts`): it outlasts
 * the sun while the twilight glows, and a full cloud deck, even all round the
 * horizon, has none.
 */
export function atmosphereUnder(w: WeatherParams, sky: SkyState, viewDistance: number): AtmosphereRecord {
  const m = clamp01(w.mist);
  const d = dreadWorldUnder(w);
  return {
    baseDensity: fogDensityUnder(w, viewDistance),
    heightDensity: HEIGHT_DENSITY_BASE * (1 + HEIGHT_MIST_GAIN * m),
    heightFalloff: HEIGHT_FALLOFF,
    referenceLevel: REFERENCE_LEVEL_BASE + LEVEL_MIST_RISE * m + LEVEL_DREAD_RISE * d,
    gradientScale: 1 / viewDistance,
    sunDir: sky.glowDir,
    sunColour: airColourUnder(w, sky.horizonToward),
    sunWeight: sky.glowWeight,
    sunPower: sky.glowPower,
    farColour: { r: sky.mistAir.r, g: sky.mistAir.g, b: sky.mistAir.b },
  };
}
