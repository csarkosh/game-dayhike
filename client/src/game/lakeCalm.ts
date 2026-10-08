import type { WeatherParams, WeatherPresetName } from "./weather.js";

/**
 * The lake's calm: how much of its surface is glass by the hour and the
 * weather, and what each of its three states does to a reflected image.
 * Babylon-free and on BABYLON_FREE_FILES. Renderer-only: the share reads the
 * hour every peer holds and the preset's name, so peers see the same glass
 * without anything of it entering the sim or the level id.
 *
 * The calm is the lake's own, not the world's wind's: the wind never drops
 * under a quarter, which would leave every lake a dull sheen. The share is a
 * table of literal hours with linear ramps (the water life's clock: the
 * mirror returns as the midges rise).
 *
 * | Weather              | 18:00–08:00 | 08:00→09:00 | 09:00–17:00 | 17:00→18:00 |
 * | clear, bright, eerie | 1           | ramp to 0   | 0           | ramp to 1   |
 * | mist                 | 1           | ramp to 0.3 | 0.3         | ramp to 1   |
 * | overcast             | 0.3         | ramp to 0   | 0           | ramp to 0.3 |
 * | rain                 | 0           | 0           | 0           | 0           |
 */

/** The surface's states: glass (a sharp mirror), a cat's-paw (the sky's blur), rough (Cox and Munk from the wind). */
export type SurfaceState = "glass" | "paw" | "rough";

/** rms slope (degrees) by state: glass is flat; a paw is Cox and Munk at about 1 m/s. */
export const SLOPE_GLASS_DEG = 0;
export const SLOPE_PAW_DEG = 4;
/** The crisp bound (degrees): under this rms slope a mirror reads sharp, a smear of 2 px at 1080p. */
export const SLOPE_CRISP_DEG = 0.07;

/** The calm share's hours: glass from CALM_GLASS_FROM through the night to CALM_GLASS_TO, ramping down to the day's value by CALM_RAMP_DOWN_END and back up from CALM_RAMP_UP_START. */
export const CALM_GLASS_FROM = 18;
export const CALM_GLASS_TO = 8;
export const CALM_RAMP_DOWN_END = 9;
export const CALM_RAMP_UP_START = 17;
/** Mist holds this share through the day; overcast this share at the day's ends. */
export const CALM_MIST_DAY = 0.3;
export const CALM_OVERCAST_ENDS = 0.3;

/** Rough over the whole surface above this wind (0..1) on a body of at least ROUGH_SHELTER. */
export const ROUGH_WIND01 = 0.7;
export const ROUGH_SHELTER = 0.3;
/** Rough over the whole surface above this rain (0..1): the eerie preset's drizzle, 0.3, is not. */
export const ROUGH_RAIN = 0.35;
/** The rough share's ramps (`roughShare`): the rain's from its step above to 0.5, so the eerie drizzle's 0.3 is none of it; the wind's from 0.6 to 0.8, about its step. */
export const ROUGH_RAIN_FROM = 0.35;
export const ROUGH_RAIN_TO = 0.5;
export const ROUGH_WIND_FROM = 0.6;
export const ROUGH_WIND_TO = 0.8;

const SHARE_AT_ENDS: Readonly<Record<WeatherPresetName, number>> = Object.freeze({
  clear: 1,
  bright: 1,
  eerie: 1,
  mist: 1,
  overcast: CALM_OVERCAST_ENDS,
  rain: 0,
});

const SHARE_BY_DAY: Readonly<Record<WeatherPresetName, number>> = Object.freeze({
  clear: 0,
  bright: 0,
  eerie: 0,
  mist: CALM_MIST_DAY,
  overcast: 0,
  rain: 0,
});

/**
 * The glass's share of the lake (0..1) at `hour` (any real; 24 is 0) under the
 * preset `weather`: the table above. A non-finite hour gives 0, the probe's
 * sheen, never NaN.
 */
export function calmShare(hour: number, weather: WeatherPresetName): number {
  if (!Number.isFinite(hour)) return 0;
  const h = ((hour % 24) + 24) % 24;
  const ends = SHARE_AT_ENDS[weather];
  const day = SHARE_BY_DAY[weather];
  if (h >= CALM_GLASS_FROM || h < CALM_GLASS_TO) return ends;
  if (h < CALM_RAMP_DOWN_END) {
    return ends + ((day - ends) * (h - CALM_GLASS_TO)) / (CALM_RAMP_DOWN_END - CALM_GLASS_TO);
  }
  if (h < CALM_RAMP_UP_START) return day;
  return day + ((ends - day) * (h - CALM_RAMP_UP_START)) / (CALM_GLASS_FROM - CALM_RAMP_UP_START);
}

/**
 * The vertical smear (pixels) of a reflected image under an rms slope of
 * `slopeDeg` degrees, on a frame `frameHeightPx` tall with a vertical field of
 * view of `fovVertical` radians: a facet tilted by σ turns the reflected ray
 * by 2σ, so 2σ · H / fov. At the game's 1.4 rad and 1080 px, 27 px a degree.
 */
export function smearPx(slopeDeg: number, frameHeightPx: number, fovVertical: number): number {
  return (2 * slopeDeg * (Math.PI / 180) * frameHeightPx) / fovVertical;
}

/**
 * Whether the body is rough over its whole surface, with no glass and no
 * paws: under rain above ROUGH_RAIN (the eerie drizzle is not rain), or above
 * a wind of ROUGH_WIND01 on a body as exposed as ROUGH_SHELTER (the clear
 * high lake's).
 */
export function isRough(weather: WeatherParams, wind01: number, shelter: number): boolean {
  return weather.rain > ROUGH_RAIN || (wind01 > ROUGH_WIND01 && shelter >= ROUGH_SHELTER);
}

/** Hermite smoothstep of `x` from `a` to `b`, 0 to 1, as GLSL's. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How rough the body is over its whole surface, 0 to 1: `isRough`'s two
 * steps eased into ramps, so the glass and the paws never snap in a frame.
 * The rain's ramp runs from ROUGH_RAIN_FROM to ROUGH_RAIN_TO at any shelter
 * (the eerie preset's drizzle, under it, leaves the glass whole);
 * the wind's from ROUGH_WIND_FROM to ROUGH_WIND_TO on a body as exposed as
 * ROUGH_SHELTER, and not at all on one more sheltered. The larger of the two.
 */
export function roughShare(weather: WeatherParams, wind01: number, shelter: number): number {
  const rain = smoothstep(ROUGH_RAIN_FROM, ROUGH_RAIN_TO, weather.rain);
  const wind = shelter >= ROUGH_SHELTER ? smoothstep(ROUGH_WIND_FROM, ROUGH_WIND_TO, wind01) : 0;
  return Math.max(rain, wind);
}
