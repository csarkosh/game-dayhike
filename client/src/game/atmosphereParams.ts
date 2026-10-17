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
/** Aerial perspective (2026-10-15): the air's transmittance raised to a
 * power a channel (r, g, b), the blue scattering in over the first kilometre
 * and the red left to the horizon, so a far hillside lifts toward the sky's
 * colour and loses its contrast by depth. The mean is near one, so the far
 * field reaches the fog's floor where it did. Mirrors ATM_AIR_POWER. */
export const AIR_POWER: readonly [number, number, number] = [0.72, 0.92, 1.3];

/** The fogged colour's mix weight a channel for a scalar transmittance `t`: t to each power. */
export function airTransmittance(t: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, t));
  return [Math.pow(c, AIR_POWER[0]), Math.pow(c, AIR_POWER[1]), Math.pow(c, AIR_POWER[2])];
}

/** The ground haze (2026-10-16): a thin layer of air at the walker's level in
 * every weather, its base `seat` metres below the eye, its density at the
 * base and its falloff a metre of height (halving every six metres), and
 * the share of the way from the gradient's air to the sun's colour the haze
 * is seen in, so the far ground sits in a faint, warm veil at noon and the
 * crowns in less of it. Mirrors ATM_HAZE_DENSITY, ATM_HAZE_FALLOFF,
 * ATM_HAZE_SEAT and ATM_HAZE_WARMTH in atmosphereFog.fragment.fx. */
export const HAZE = { density: 0.002, falloff: 0.12, seat: 1.5, warmth: 0.5 } as const;

/** The haze's optical depth along a ray of slope `rdY` to `t` metres from an
 * eye `HAZE.seat` above its base: the height fog's integral at the haze's
 * own constants, as the shader takes it. */
export function groundHazeAmount(rdY: number, t: number): number {
  return heightFogAmount(HAZE.seat, rdY, t, HAZE.density, HAZE.falloff, 0);
}

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
