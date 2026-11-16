/**
 * The grade on the material colour path, with no engine: what the tiers
 * with no post chain grade their frame with inside every material, after
 * the manner of Babylon.js's image processing there. The colour curves that
 * carry the weather's split-tone and the chase's cast, the vignette, and the
 * dither, each as the numbers a shader reads, worked out as Babylon.js works
 * them out from its own settings (`ColorCurves`, `ImageProcessingConfiguration`).
 *
 * `post.ts` writes the curves' settings from here onto Babylon.js's
 * configuration, which then computes the same vectors itself; the renderer
 * on Babylon Lite reads the vectors (`lite/displayCurve.ts`).
 */
import { CHASE_SHADOW_DENSITY, CHASE_SHADOW_HUE, VIGNETTE_COLOUR, type GradeRecord } from "./gradeParams.js";
import { gradeUnder, saturationUnder, type WeatherParams } from "./weather.js";

/** One band of the curves, on Babylon.js's own scales: a hue in degrees, a density and a saturation each within -100 to 100. */
export type CurveBand = { hue: number; density: number; saturation: number };

/** The colour curves' settings: the three bands and the whole frame's saturation, as Babylon.js's `ColorCurves` holds them. */
export type CurveSettings = { globalSaturation: number; shadows: CurveBand; midtones: CurveBand; highlights: CurveBand };

/** The hue a band stands at where it is given none: Babylon.js's own default. */
export const CURVE_DEFAULT_HUE = 30;

/**
 * The curves' settings under a weather and the chase's cast (0 to 1): the
 * weather's split-tone, the whole frame's saturation, and under the chase
 * the shadows turned toward burgundy and deepened.
 */
export function curveSettingsUnder(weather: WeatherParams, chase: number): CurveSettings {
  const g = gradeUnder(weather);
  return {
    globalSaturation: saturationUnder(weather),
    shadows: { hue: g.shadowsHue + (CHASE_SHADOW_HUE - g.shadowsHue) * chase, density: g.shadowsDensity + CHASE_SHADOW_DENSITY * chase, saturation: g.shadowsSaturation },
    midtones: { hue: g.midtonesHue, density: g.midtonesDensity, saturation: g.midtonesSaturation },
    highlights: { hue: g.highlightsHue, density: g.highlightsDensity, saturation: g.highlightsSaturation },
  };
}

type V4 = [number, number, number, number];

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Babylon.js's slider curve: the square of a share of a hundred, its sign kept. */
function sliderNonlinear(value: number): number {
  const v = value / 100;
  let x = Math.abs(v);
  x = Math.pow(x, 2);
  if (v < 0) x *= -1;
  return x * 100;
}

/** A colour from a hue (degrees), a saturation and a brightness (each of a hundred), as Babylon.js converts one. */
function fromHsb(hue: number, saturation: number, brightness: number, out: V4): void {
  let h = clamp(hue, 0, 360);
  const s = clamp(saturation / 100, 0, 1);
  const v = clamp(brightness / 100, 0, 1);
  if (s === 0) {
    out[0] = v;
    out[1] = v;
    out[2] = v;
  } else {
    h /= 60;
    const i = Math.floor(h);
    const f = h - i;
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));
    const [r, g, b] = i === 0 ? [v, t, p] : i === 1 ? [q, v, p] : i === 2 ? [p, v, t] : i === 3 ? [p, q, v] : i === 4 ? [t, p, v] : [v, p, q];
    out[0] = r as number;
    out[1] = g as number;
    out[2] = b as number;
  }
  out[3] = 1;
}

/** One band's curve: the filter colour doubled, and one plus a hundredth of the saturation in its fourth place. */
function bandCurve(hue: number, density: number, saturation: number, exposure: number, out: V4): V4 {
  let h = clamp(hue, 0, 360);
  let d = clamp(density, -100, 100);
  const s = clamp(saturation, -100, 100);
  const e = sliderNonlinear(clamp(exposure, -100, 100));
  // The density's slider is curved, and halved so the fullest filter is half a control.
  d = sliderNonlinear(d) * 0.5;
  if (d < 0) {
    d *= -1;
    h = (h + 180) % 360;
  }
  fromHsb(h, d, 50 + 0.25 * e, out);
  out[0] *= 2;
  out[1] *= 2;
  out[2] *= 2;
  out[3] = 1 + 0.01 * s;
  return out;
}

/** The curves as a shader reads them: the neutral curve, what is added toward the highlights and what is taken toward the shadows. */
export type CurveVectors = { gradeCurveNeutral: V4; gradeCurvePositive: V4; gradeCurveNegative: V4 };

export function emptyCurveVectors(): CurveVectors {
  return { gradeCurveNeutral: [1, 1, 1, 1], gradeCurvePositive: [0, 0, 0, 0], gradeCurveNegative: [0, 0, 0, 0] };
}

const scratch = { global: [0, 0, 0, 0] as V4, band: [0, 0, 0, 0] as V4, highlights: [0, 0, 0, 0] as V4, shadows: [0, 0, 0, 0] as V4 };

/**
 * The three vectors of `settings`, as Babylon.js's `ColorCurves` binds
 * them: each band's curve times the whole frame's; the midtones' is the
 * neutral, the highlights' less it the positive, and it less the shadows'
 * the negative.
 */
export function curveVectors(settings: CurveSettings, out: CurveVectors = emptyCurveVectors()): CurveVectors {
  const global = bandCurve(CURVE_DEFAULT_HUE, 0, settings.globalSaturation, 0, scratch.global);
  const times = (band: CurveBand, into: V4): V4 => {
    const own = bandCurve(band.hue, band.density, band.saturation, 0, scratch.band);
    for (let i = 0; i < 4; i++) into[i] = (own[i] as number) * (global[i] as number);
    return into;
  };
  const highlights = times(settings.highlights, scratch.highlights);
  const midtones = times(settings.midtones, out.gradeCurveNeutral);
  const shadows = times(settings.shadows, scratch.shadows);
  for (let i = 0; i < 4; i++) {
    out.gradeCurvePositive[i] = (highlights[i] as number) - (midtones[i] as number);
    out.gradeCurveNegative[i] = (midtones[i] as number) - (shadows[i] as number);
  }
  return out;
}

/** The field of view Babylon.js's vignette is shaped by where it is given none: its own, not the camera's. */
export const VIGNETTE_CAMERA_FOV = 0.5;
/** The dither's step either way where it is given none, of the display's range: Babylon.js's own default, a step of the 8-bit frame. */
export const DITHER_INTENSITY = 1 / 255;

/**
 * The vignette and the dither as a shader reads them: (the frame's reach
 * across and up from its centre, and the centre's offset), (the vignette's
 * colour and its power), and (one over the frame's width and height, half
 * the dither's step, unused).
 */
export type VignetteVectors = { gradeVignette1: V4; gradeVignette2: V4; gradeScreen: V4 };

export function emptyVignetteVectors(): VignetteVectors {
  return { gradeVignette1: [0, 0, 0, 0], gradeVignette2: [1, 1, 1, 0], gradeScreen: [0, 0, 0, 0] };
}

/**
 * The vignette at `weight` on a frame `width` by `height`, as Babylon.js's
 * image processing binds it: multiplied into the frame, centred, never
 * stretched, in the game's colour.
 */
export function vignetteVectors(weight: number, width: number, height: number, out: VignetteVectors = emptyVignetteVectors()): VignetteVectors {
  const scaleY = Math.tan(VIGNETTE_CAMERA_FOV * 0.5);
  const scaleX = scaleY * (width / height);
  out.gradeVignette1[0] = scaleX;
  out.gradeVignette1[1] = scaleY;
  out.gradeVignette1[2] = 0;
  out.gradeVignette1[3] = 0;
  out.gradeVignette2[0] = VIGNETTE_COLOUR.r;
  out.gradeVignette2[1] = VIGNETTE_COLOUR.g;
  out.gradeVignette2[2] = VIGNETTE_COLOUR.b;
  out.gradeVignette2[3] = -2.0 * weight;
  out.gradeScreen[0] = 1 / width;
  out.gradeScreen[1] = 1 / height;
  out.gradeScreen[2] = 0.5 * DITHER_INTENSITY;
  out.gradeScreen[3] = 0;
  return out;
}

/** The material path's grade, a frame: the curves' three vectors and the vignette's and the dither's three. */
export type MaterialGradeUniforms = CurveVectors & VignetteVectors;

export function emptyMaterialGradeUniforms(): MaterialGradeUniforms {
  return { ...emptyCurveVectors(), ...emptyVignetteVectors() };
}

/**
 * The material path's grade for a frame `width` by `height` under `weather`,
 * from the grade's `record` (its vignette's weight and the chase's cast).
 * Fills and returns `out`.
 */
export function materialGradeUniforms(
  weather: WeatherParams, record: Pick<GradeRecord, "vignetteWeight" | "chase">, width: number, height: number, out: MaterialGradeUniforms = emptyMaterialGradeUniforms(),
): MaterialGradeUniforms {
  curveVectors(curveSettingsUnder(weather, record.chase), out);
  vignetteVectors(record.vignetteWeight, width, height, out);
  return out;
}
