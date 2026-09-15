import { clamp01, desaturateRgb, luma, mixRgb, type Rgb } from "./colour.js";
import {
  ambientColourFor, exposureFor, fillIntensityFor, fogDensityFor,
  skyColourAt, sunColourAt, sunIntensityAt, sunPositionAt,
} from "./sky.js";
import type { QualityTier } from "./quality.js";

/**
 * The weather axis, alongside `hour`. Pure and Babylon-free like `sky.ts`;
 * `lighting.ts` is the shell that applies it. States are points in a continuous
 * parameter space so a transition — including the future scripted sunny-to-eerie
 * turn — is interpolation, never new machinery.
 */
export type WeatherParams = {
  /** 0–1. Kills direct sun, greys the sky, fades shadows, desaturates. */
  cloudCover: number;
  /** 0–1. Fog density multiplier, mist-bank opacity, wind/air audio. */
  mist: number;
  /** 0–1. Rain particle rate, rain-loop gain. */
  rain: number;
  /** 0–1. Surface darkening and gloss on terrain materials. */
  wetness: number;
  /** 0–1. The Lovecraft axis: green-grey fog, deeper pallor, denser mist,
   * heavier vignette and grain. Zero in every pre-existing
   * preset so the clear-identity anchor is untouched by construction. */
  dread: number;
};

export type WeatherPresetName = "clear" | "overcast" | "mist" | "rain" | "eerie";

/**
 * `clear` is all zeros BY DEFINITION: every modifier in this file returns its
 * base value exactly at `clear`, which is the machine-checked guarantee the
 * sunny look survives. Tuning may move the other presets; it may
 * never move `clear`.
 */
export const WEATHER_PRESETS: Record<WeatherPresetName, WeatherParams> = Object.freeze({
  clear: Object.freeze({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 }),
  overcast: Object.freeze({ cloudCover: 0.8, mist: 0.25, rain: 0, wetness: 0.3, dread: 0 }),
  mist: Object.freeze({ cloudCover: 0.9, mist: 1, rain: 0, wetness: 0.5, dread: 0 }),
  rain: Object.freeze({ cloudCover: 1, mist: 0.6, rain: 1, wetness: 1, dread: 0 }),
  eerie: Object.freeze({ cloudCover: 1, mist: 1, rain: 0.3, wetness: 0.6, dread: 1 }),
});

export const WEATHER_NAMES = Object.freeze(
  Object.keys(WEATHER_PRESETS),
) as readonly WeatherPresetName[];

/** Matches the `/weather` command's `defaultValue` in `commands.ts`. */
export const DEFAULT_WEATHER: WeatherPresetName = "mist";

/** Componentwise lerp; exact copies at the endpoints, like `mixRgb`. */
export function lerpWeather(a: WeatherParams, b: WeatherParams, t: number): WeatherParams {
  if (t === 0) return { ...a };
  if (t === 1) return { ...b };
  return {
    cloudCover: a.cloudCover + (b.cloudCover - a.cloudCover) * t,
    mist: a.mist + (b.mist - a.mist) * t,
    rain: a.rain + (b.rain - a.rain) * t,
    wetness: a.wetness + (b.wetness - a.wetness) * t,
    dread: a.dread + (b.dread - a.dread) * t,
  };
}

/** Fade position at `elapsedS` into a `durationS` fade. Non-positive duration is instant. */
export function weatherFadeAt(
  from: WeatherParams,
  to: WeatherParams,
  elapsedS: number,
  durationS: number,
): WeatherParams {
  if (durationS <= 0 || elapsedS >= durationS) return { ...to };
  return lerpWeather(from, to, clamp01(elapsedS / durationS));
}

// ---- Modifier magnitudes. Browser-tunable; `clear` identity is not. ----

/** Fraction of direct sun lost at full cloud cover. */
export const SUN_CLOUD_LOSS = 0.9;
/** Sun-colour desaturation at full cloud cover. */
export const SUN_DESAT = 0.7;
/** Ambient-colour desaturation at full cloud cover. */
export const AMBIENT_DESAT = 0.5;
/** Fill-light lift at full cloud cover — overcast light is flat, not dark.
 * 0.5 read as dusk in the browser (fill 0.22 against 0.58-grey fog, trees in
 * silhouette); 2.5 lifts full-mist fill to ~0.49, which reads as daylight
 * under cloud. */
export const FILL_LIFT = 2.5;
/** Fog density multiplier gain: density x(1 + gain·mist). 11 → 12x at mist 1. */
export const FOG_MIST_GAIN = 11;
/** Exposure dip at full cloud cover — dim pallor, not darkness. */
export const EXPOSURE_DIP = 0.15;
/** globalSaturation drop at full cloud (Babylon curves: 0 neutral, -100 grey).
 * Cut from 45 to 15 to 5: greyness no longer
 * carries the mood — the split-tone grade below does — so a heavy global
 * crush only fought it. 15 was still enough, paired with the old
 * DREAD_SATURATION_DROP of 20, to leave eerie barely lighter than the
 * pre-branch -40.5; cut further so the crush stops competing with the grade. */
export const SATURATION_DROP = 5;
/** Albedo scale at full wetness. */
export const WET_ALBEDO_LOSS = 0.38;
/** Roughness scale at full wetness — wet ground goes glossier. */
export const WET_ROUGHNESS_LOSS = 0.4;
/** Peak mist-bank billboard opacity. */
export const MIST_OPACITY_MAX = 0.55;
/** Bright mist air the fog colour pulls toward under mist. */
const MIST_AIR: Rgb = { r: 0.58, g: 0.6, b: 0.62 };
/** Fraction of the way fog is pulled toward the dread air at full dread. */
export const DREAD_FOG_PULL = 0.35;
/** Additional exposure dip at full dread, on top of the cloud dip. */
export const DREAD_EXPOSURE_DIP = 0.1;
/** Additional globalSaturation drop at full dread. Cut from 20 to 5:
 * left at 20 alongside the first SATURATION_DROP
 * cut, eerie's total crush (-35) was barely below the pre-branch value
 * (-40.5), so the eeriest preset was almost unchanged. Now the grade —
 * not a global crush — carries eerie's mood. */
export const DREAD_SATURATION_DROP = 5;
/** Mist-bank opacity gain at full dread — denser banks, same 12-bank cap. */
export const DREAD_MIST_GAIN = 0.3;
/** Vignette weight baseline (Babylon vignetteWeight) and its dread gain. */
export const VIGNETTE_WEIGHT_BASE = 1.8;
export const DREAD_VIGNETTE_GAIN = 0.6;
/** Bruised green-grey air the fog pulls toward under dread. Deliberately dim:
 * it is lifted DOWN to the current fog's luma before mixing, so dread shifts
 * hue without ever brightening — the fixed-bright-target night-glow trap
 * documented on MIST_AIR, avoided the same way. */
const DREAD_AIR: Rgb = { r: 0.35, g: 0.42, b: 0.36 };

// ---- Stepped dread. Browser-tunable; `clear` identity is not. ----

/** Number of plateaus the WORLD-side dread terms move through: 0, 1/3, 2/3, 1. */
export const DREAD_PLATEAUS = 4;
/** Half-width, in dread units, of the soft edge on each plateau. */
export const DREAD_STEP_EDGE = 0.06;
/** Fraction of the fill and probe ambient lost on the top plateau. */
export const AMBIENT_COLLAPSE = 0.45;

function smoothstep01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * Quantises a dread level to DREAD_PLATEAUS plateaus with a smoothstep edge
 * of half-width DREAD_STEP_EDGE centred on each boundary. Exact at 0 and 1,
 * monotonic, so the world changes DREAD_PLATEAUS − 1 times as dread rises
 * rather than sliding.
 */
export function stepped(d: number): number {
  const x = clamp01(d);
  const step = 1 / (DREAD_PLATEAUS - 1);
  let out = 0;
  for (let i = 1; i < DREAD_PLATEAUS; i++) {
    const edge = i * step - step / 2;
    out += step * smoothstep01((x - edge + DREAD_STEP_EDGE) / (2 * DREAD_STEP_EDGE));
  }
  return x === 0 ? 0 : x === 1 ? 1 : out;
}

/** The plateau'd dread the world-side terms read: fog, exposure, mist, ambient, motes. */
export function dreadWorldUnder(w: WeatherParams): number {
  return stepped(w.dread);
}

/** The continuous dread the lens-side terms read: grain, aberration, vignette, halation, overlap. */
export function dreadLensUnder(w: WeatherParams): number {
  return clamp01(w.dread);
}

/** Multiplier on the fill light and the probe's contribution: 1 at clear, 1 − AMBIENT_COLLAPSE on the top plateau. */
export function ambientCollapseUnder(w: WeatherParams): number {
  const d = dreadWorldUnder(w);
  return d === 0 ? 1 : 1 - AMBIENT_COLLAPSE * d;
}

/** Rain particle capacity by quality tier; emit rate is rain x capacity. */
export const RAIN_CAPACITY: Record<QualityTier, number> = { low: 600, medium: 1200, high: 2000 };

// ---- Rich-eerie split-tone palette. Browser-tunable. ----
// Hues are HSB degrees; densities are tint STRENGTH (0 = the hue does nothing);
// saturations are Babylon's -100..+100 with 0 neutral.

/** Bruised violet shadows — bloodless and cold, never neutral grey. Density,
 * saturation and hue raised across two browser passes:
 * at the shipped 35/10/265 the tint could not win against the green-blue fog
 * and dark ambient it sits under (browser-measured as teal, not violet). Hue
 * nudged 265→275, closer to true violet. First pass tried 55/20, which
 * shifted the measured shadow-band hue (~195°→~233°) and raised saturation
 * (~0.14→~0.19) but still read as merely tinted, not obviously colourful, on
 * the raw (unbrightened) screenshot — shadow luminance is low enough that a
 * moderate tint doesn't move enough 8-bit RGB. Pushed to 70/30, which reads
 * as clearly violet at a glance (measured hue ~256°, saturation ~0.30) while
 * `/weather clear` — grade densities all scale to zero there — stays the
 * identical sunny anchor. */
export const GRADE_SHADOW_HUE = 275;
export const GRADE_SHADOW_DENSITY = 70;
export const GRADE_SHADOW_SATURATION = 30;
/** Sickly green-teal midtones — terrain, bark and foliage live here, so this
 * band carries the "rich" half of rich-eerie. Density and saturation raised
 * across two browser passes: 30/25 was too weak to
 * read as obviously colourful at a glance; the first-pass 50/45 was better
 * but still subtle in a deep-shadow forest framing, so pushed further to
 * 65/60 alongside the shadow-band push above. */
export const GRADE_MIDTONE_HUE = 150;
export const GRADE_MIDTONE_DENSITY = 65;
export const GRADE_MIDTONE_SATURATION = 60;
/** Cold cyan highlights, deliberately drained: saturated mids under bright
 * highlights would read cheerful, which is the one thing this must not be.
 * Density raised 20→30 to keep pace with the
 * stronger shadow/midtone densities; saturation left at -10 — the drain is
 * what stops the richer midtones from tipping cheerful. Left at 30 through
 * the second push: highlights were never the muted band, only shadows and
 * midtones needed the extra push. */
export const GRADE_HIGHLIGHT_HUE = 200;
export const GRADE_HIGHLIGHT_DENSITY = 30;
export const GRADE_HIGHLIGHT_SATURATION = -10;

export type SkyMaterialParams = {
  turbidity: number;
  luminance: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
};

/**
 * SkyMaterial under weather. At clear these are exactly the five constants
 * `lighting.ts` shipped with; high turbidity + low luminance turns the
 * scattering sky into flat grey-white haze — and the reflection probe capturing
 * that sky is what greys the IBL automatically.
 */
export function skyMaterialParamsUnder(w: WeatherParams): SkyMaterialParams {
  const c = clamp01(w.cloudCover);
  return {
    turbidity: 4 + 16 * c,
    luminance: 1 - 0.6 * c,
    // Browser-measured: turbidity alone whitens only the horizon —
    // the zenith stays saturated blue (probe faces r~180 b~232 under full
    // mist) — and DRAINING rayleigh darkens the dome to navy rather than
    // greying it (less scattered light, not whiter light). What actually
    // reads as overcast is leaving rayleigh alone and flooding the dome with
    // near-isotropic Mie haze: white, wavelength-independent scattering
    // everywhere, which is roughly what a cloud deck is.
    rayleigh: 2,
    mieCoefficient: 0.005 + 0.075 * c,
    mieDirectionalG: 0.8 - 0.8 * c,
  };
}

export function sunIntensityUnder(w: WeatherParams, hour: number): number {
  return sunIntensityAt(hour) * (1 - SUN_CLOUD_LOSS * clamp01(w.cloudCover));
}

export function sunColourUnder(w: WeatherParams, hour: number): Rgb {
  return desaturateRgb(sunColourAt(hour), SUN_DESAT * clamp01(w.cloudCover));
}

export function fillIntensityUnder(w: WeatherParams, altitude: number): number {
  // The lift stands in for the flat light a cloud deck scatters DOWNWARD by
  // day, so it must follow the sun: unconditional, it triple-lit the ground
  // at hour 18 under a near-black dusk sky (browser-measured). The
  // ramp matches sky.ts's DAY_ALTITUDE (0.35) so the lift fades in step with
  // the sky's own dusk transition. At night cloud adds nothing — the fill is
  // already the moonlight stand-in.
  const daylight = clamp01(altitude / 0.35);
  return fillIntensityFor(altitude) * (1 + FILL_LIFT * clamp01(w.cloudCover) * daylight);
}

export function ambientColourUnder(w: WeatherParams, hour: number): Rgb {
  return desaturateRgb(ambientColourFor(hour), AMBIENT_DESAT * clamp01(w.cloudCover));
}

export function fogDensityUnder(w: WeatherParams, viewDistance: number): number {
  return fogDensityFor(viewDistance) * (1 + FOG_MIST_GAIN * clamp01(w.mist));
}

/**
 * Fog colour under weather: pulled toward mist air by mist, then desaturated
 * by cloud, so the horizon dissolves into the greyed sky rather than banding
 * against it. The mist-air target scales with the base sky's own luminance —
 * a fixed bright grey made the fog band GLOW against a near-black dusk sky
 * (browser-measured at hour 18); tracking the sky's brightness keeps
 * the noon look identical while dusk fog dims with the dusk. At clear every
 * step is an exact copy of `skyColourAt`.
 */
export function fogColourUnder(w: WeatherParams, hour: number): Rgb {
  const c = clamp01(w.cloudCover);
  const base = skyColourAt(hour);
  const lift = Math.min(1.2, luma(base) / luma(MIST_AIR));
  const air = { r: MIST_AIR.r * lift, g: MIST_AIR.g * lift, b: MIST_AIR.b * lift };
  const grey = desaturateRgb(mixRgb(base, air, 0.5 * clamp01(w.mist)), 0.9 * c);
  // skyColourAt models a CLEAR sky's bright sunset horizon, but a cloud deck
  // blocks exactly that low light — without this the fog band glowed white
  // against a near-black overcast dusk dome (browser-measured at hour 18).
  // Identity at clear (c = 0) and by day (daylight 1), both exact.
  const daylight = clamp01(sunPositionAt(hour).y / 0.35);
  const duskDim = 1 - 0.85 * c * (1 - daylight);
  const dimmed = { r: grey.r * duskDim, g: grey.g * duskDim, b: grey.b * duskDim };
  const d = dreadWorldUnder(w);
  // Early return to ensure no dread-term arithmetic touches the clear path; the
  // preceding cloud-term arithmetic is IEEE-exact at zero (dimmed is a freshly built
  // object; the sweep asserts value equality, not identity).
  if (d === 0) return dimmed;
  const dreadLift = Math.min(1, luma(dimmed) / luma(DREAD_AIR));
  const target = { r: DREAD_AIR.r * dreadLift, g: DREAD_AIR.g * dreadLift, b: DREAD_AIR.b * dreadLift };
  return mixRgb(dimmed, target, DREAD_FOG_PULL * d);
}

/** Babylon ShadowGenerator darkness: 0 = full shadows, 1 = invisible. */
export function shadowDarknessUnder(w: WeatherParams): number {
  return clamp01(w.cloudCover);
}

export function exposureUnder(w: WeatherParams, altitude: number): number {
  return (
    exposureFor(altitude) *
    (1 - EXPOSURE_DIP * clamp01(w.cloudCover)) *
    (1 - DREAD_EXPOSURE_DIP * dreadWorldUnder(w))
  );
}

/** For Babylon ColorCurves.globalSaturation: 0 is neutral, negative desaturates. */
export function saturationUnder(w: WeatherParams): number {
  return -(SATURATION_DROP * clamp01(w.cloudCover) + DREAD_SATURATION_DROP * clamp01(w.dread)) || 0;
}

export function wetSurfaceUnder(w: WeatherParams): { albedoScale: number; roughnessScale: number } {
  const k = clamp01(w.wetness);
  return { albedoScale: 1 - WET_ALBEDO_LOSS * k, roughnessScale: 1 - WET_ROUGHNESS_LOSS * k };
}

export function rainEmitRateUnder(w: WeatherParams, tier: QualityTier): number {
  return clamp01(w.rain) * RAIN_CAPACITY[tier];
}

export function mistOpacityUnder(w: WeatherParams): number {
  return MIST_OPACITY_MAX * clamp01(w.mist) * (1 + DREAD_MIST_GAIN * dreadWorldUnder(w));
}

/** Target gains in [0,1] per ambience layer; the audio shell scales by its levels. */
export function ambientGainsUnder(w: WeatherParams): { rain: number; wind: number; air: number } {
  const c = clamp01(w.cloudCover);
  const m = clamp01(w.mist);
  return { rain: clamp01(w.rain), wind: 0.8 * Math.max(c, m), air: 0.6 * m };
}

/** Vignette weight for the unease layer: baseline always on, deeper under dread. */
export function vignetteWeightUnder(w: WeatherParams): number {
  return VIGNETTE_WEIGHT_BASE * (1 + DREAD_VIGNETTE_GAIN * dreadLensUnder(w));
}

/** The nine ColorCurves values the grade drives, one triple per tonal range. */
export type ColourGrade = {
  shadowsHue: number;
  shadowsDensity: number;
  shadowsSaturation: number;
  midtonesHue: number;
  midtonesDensity: number;
  midtonesSaturation: number;
  highlightsHue: number;
  highlightsDensity: number;
  highlightsSaturation: number;
};

/**
 * How far into "overcast and wrong" the weather is, in [0, 1].
 *
 * The max of cloud, mist and dread rather than a sum: each alone is enough to
 * put the world in that state, and summing would saturate the grade the moment
 * two of them were mildly present. `mist` and `eerie` both reach 1 and so
 * share a grade — deliberate: eerie separates itself through the
 * dread terms already in the system, not through a second colour axis.
 */
export function moodUnder(w: WeatherParams): number {
  return Math.max(clamp01(w.cloudCover), clamp01(w.mist), clamp01(w.dread));
}

/**
 * Split-toning for Babylon's ColorCurves: violet shadows, saturated green-teal
 * midtones, drained cold highlights, all scaled by `moodUnder`.
 *
 * Every density and saturation is exactly 0 at `clear`, so the sunny frame is
 * untouched and the clear-identity sweep extends over this rather than being
 * weakened. Hues stay constant because a hue at zero density has no effect.
 */
export function gradeUnder(w: WeatherParams): ColourGrade {
  const m = moodUnder(w);
  // At clear (m=0), normalise all values to +0 to pass toBe(0) assertions
  // (multiplication can produce -0, which Object.is() distinguishes from +0).
  if (m === 0) {
    return {
      shadowsHue: GRADE_SHADOW_HUE,
      shadowsDensity: 0,
      shadowsSaturation: 0,
      midtonesHue: GRADE_MIDTONE_HUE,
      midtonesDensity: 0,
      midtonesSaturation: 0,
      highlightsHue: GRADE_HIGHLIGHT_HUE,
      highlightsDensity: 0,
      highlightsSaturation: 0,
    };
  }
  return {
    shadowsHue: GRADE_SHADOW_HUE,
    shadowsDensity: GRADE_SHADOW_DENSITY * m,
    shadowsSaturation: GRADE_SHADOW_SATURATION * m,
    midtonesHue: GRADE_MIDTONE_HUE,
    midtonesDensity: GRADE_MIDTONE_DENSITY * m,
    midtonesSaturation: GRADE_MIDTONE_SATURATION * m,
    highlightsHue: GRADE_HIGHLIGHT_HUE,
    highlightsDensity: GRADE_HIGHLIGHT_DENSITY * m,
    highlightsSaturation: GRADE_HIGHLIGHT_SATURATION * m,
  };
}
