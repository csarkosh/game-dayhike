import { clamp01, type Rgb } from "./colour.js";
import { sunPositionAt, twilightT } from "./sky.js";
import {
  dreadLensUnder, dreadWorldUnder, exposureUnder, moodUnder, saturationUnder, vignetteWeightUnder,
  GRADE_SHADOW_HUE, GRADE_SHADOW_DENSITY, GRADE_SHADOW_SATURATION,
  GRADE_MIDTONE_HUE, GRADE_MIDTONE_DENSITY, GRADE_MIDTONE_SATURATION,
  GRADE_HIGHLIGHT_HUE, GRADE_HIGHLIGHT_DENSITY, GRADE_HIGHLIGHT_SATURATION,
  type WeatherParams,
} from "./weather.js";

/**
 * The pure arithmetic of the grade pass. Babylon-free and on the architecture
 * test's BABYLON_FREE_FILES list; `post.ts` binds it. Matrices are
 * column-major in GLSL order, so a `Mat3` uploads with setMatrix3x3 unchanged.
 */

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
export type Tint = { r: number; g: number; b: number; density: number; saturation: number };

export type GradeRecord = {
  exposure: number;
  whitePoint: Mat3;
  purkinje: Mat3;
  purkinjeThreshold: number;
  purkinjeStrength: number;
  shadows: Tint;
  midtones: Tint;
  highlights: Tint;
  /** The colour the shadows lift toward: `c = lift + c·(1 − lift)`. Black at clear. */
  lift: Rgb;
  /** Global saturation as the pass's −1..0 uniform (Babylon's −100..0 over 100). 0 at clear. */
  saturation: number;
  vignetteWeight: number;
  vignetteColour: Rgb;
  halationStrength: number;
  aberrationAmount: number;
};

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---- AgX (three.js port, MIT). Column-major, mirrored in grade.fragment.fx. ----
// Constants are copied verbatim from three.js `tonemapping_pars_fragment.glsl.js`
// (src/renderers/shaders/ShaderChunk); the lockstep test pins the GLSL to these.
export const SRGB_TO_REC2020: Mat3 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956];
export const REC2020_TO_SRGB: Mat3 = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
export const AGX_INSET: Mat3 = [
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859,
];
export const AGX_OUTSET: Mat3 = [
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
];
export const AGX_MIN_EV = -12.47393;
export const AGX_MAX_EV = 4.026069;

/** GLSL `mat3 * vec3` with a column-major matrix. */
export function mulMat3(m: Mat3, v: Rgb): Rgb {
  return {
    r: m[0] * v.r + m[3] * v.g + m[6] * v.b,
    g: m[1] * v.r + m[4] * v.g + m[7] * v.b,
    b: m[2] * v.r + m[5] * v.g + m[8] * v.b,
  };
}

/**
 * The AgX contrast sigmoid's seven coefficients, x^6 down to x^0, mirrored
 * verbatim in the GLSL `agxContrast` and pinned there by a lockstep test —
 * this was duplicated with no such test until the final review.
 */
export const AGX_CONTRAST: readonly [number, number, number, number, number, number, number] =
  [15.5, -40.14, 31.96, -6.868, 0.4298, 0.1191, -0.00232];

function agxContrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  const [c6, c5, c4, c3, c2, c1, c0] = AGX_CONTRAST;
  return c6 * x4 * x2 + c5 * x4 * x + c4 * x4 + c3 * x2 * x + c2 * x2 + c1 * x + c0;
}

/** The TS reference of `agxToneMap` in grade.fragment.fx. Input linear sRGB with exposure already applied; output linear sRGB in [0, 1]. */
export function agx(c: Rgb): Rgb {
  let v = mulMat3(AGX_INSET, mulMat3(SRGB_TO_REC2020, c));
  const enc = (x: number) => clamp01((Math.log2(Math.max(x, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV));
  v = { r: agxContrast(enc(v.r)), g: agxContrast(enc(v.g)), b: agxContrast(enc(v.b)) };
  v = mulMat3(AGX_OUTSET, v);
  const lin = (x: number) => Math.pow(Math.max(0, x), 2.2);
  v = mulMat3(REC2020_TO_SRGB, { r: lin(v.r), g: lin(v.g), b: lin(v.b) });
  return { r: clamp01(v.r), g: clamp01(v.g), b: clamp01(v.b) };
}

// ---- White point: Bradford chromatic adaptation between keyed illuminants. ----

const BRADFORD: Mat3 = [0.8951, -0.7502, 0.0389, 0.2664, 1.7135, -0.0685, -0.1614, 0.0367, 1.0296];
const BRADFORD_INV: Mat3 = [0.9869929, 0.4323053, -0.0085287, -0.1470543, 0.5183603, 0.0400428, 0.1599627, 0.0492912, 0.9684867];
const SRGB_TO_XYZ: Mat3 = [0.4124564, 0.2126729, 0.0193339, 0.3575761, 0.7151522, 0.1191920, 0.1804375, 0.0721750, 0.9503041];
const XYZ_TO_SRGB: Mat3 = [3.2404542, -0.9692660, 0.0556434, -1.5371385, 1.8760108, -0.2040259, -0.4985314, 0.0415560, 1.0572252];
/** D65, the sRGB white: the adaptation SOURCE, so noon is the identity. */
const WHITE_NOON = { x: 0.3127, y: 0.329 };
/** A warm dusk white (~4300 K) the image is adapted TOWARD at the horizon. */
export const WHITE_DUSK = { x: 0.3660, y: 0.3730 };
/** A cool night white (~8500 K). */
export const WHITE_NIGHT = { x: 0.2920, y: 0.3020 };

function mulMat3Mat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] = a[row]! * b[col * 3]! + a[3 + row]! * b[col * 3 + 1]! + a[6 + row]! * b[col * 3 + 2]!;
    }
  }
  return out as unknown as Mat3;
}

function xyToXyz(w: { x: number; y: number }): Rgb {
  return { r: w.x / w.y, g: 1, b: (1 - w.x - w.y) / w.y };
}

/** The 3x3 that adapts linear sRGB from D65 to `target`, in linear sRGB. */
export function bradfordMatrix(target: { x: number; y: number }): Mat3 {
  const src = mulMat3(BRADFORD, xyToXyz(WHITE_NOON));
  const dst = mulMat3(BRADFORD, xyToXyz(target));
  const scale: Mat3 = [dst.r / src.r, 0, 0, 0, dst.g / src.g, 0, 0, 0, dst.b / src.b];
  const cat = mulMat3Mat3(BRADFORD_INV, mulMat3Mat3(scale, BRADFORD));
  return mulMat3Mat3(XYZ_TO_SRGB, mulMat3Mat3(cat, SRGB_TO_XYZ));
}

/** Identity at noon (altitude ≥ 0.35), warm at the horizon, cool below it. */
export function whitePointMatrix(altitude: number): Mat3 {
  if (altitude >= 0.35) return IDENTITY;
  const t = twilightT(altitude);
  // t is 0 deep in the night, 1 at full day; the horizon sits where the
  // altitude is 0, i.e. t = NIGHT_ALTITUDE / (NIGHT_ALTITUDE + DAY_ALTITUDE).
  const horizon = twilightT(0);
  const target =
    t >= horizon
      ? lerpXy(WHITE_DUSK, WHITE_NOON, (t - horizon) / (1 - horizon))
      : lerpXy(WHITE_NIGHT, WHITE_DUSK, t / horizon);
  return bradfordMatrix(target);
}

function lerpXy(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  const k = clamp01(t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// ---- Purkinje: an approximation, not Patry's opponent-space model. ----
// Below PURKINJE_THRESHOLD of pixel luma the colour blends toward a
// rod-weighted grey tinted blue: rods peak in the blue-green and see no red.
export const PURKINJE_THRESHOLD = 0.08;
export const PURKINJE_MAX = 0.8;
/** Column-major: each column is what one input channel contributes to (r, g, b). */
export const PURKINJE_MATRIX: Mat3 = [0.02, 0.03, 0.05, 0.35, 0.45, 0.60, 0.20, 0.25, 0.40];

// ---- Lens-side gains. Browser-tunable; `clear` identity is not. ----
export const HALATION_BASE = 0.04;
export const HALATION_DREAD_GAIN = 4;
export const ABERRATION_BASE = 10;
export const ABERRATION_DREAD_GAIN = 3;
export const VIGNETTE_COLOUR: Rgb = { r: 0.01, g: 0.02, b: 0.03 };
/** The vignette's breathing under dread: ±VIGNETTE_PULSE of its weight on a
 * VIGNETTE_PULSE_PERIOD-second cycle, scaled by the lens dread (Amnesia's
 * screen pulse). Zero amplitude at clear, so the vignette holds still there. */
export const VIGNETTE_PULSE = 0.12;
export const VIGNETTE_PULSE_PERIOD = 7;
/** Vignette weight added at a full stare, on top of the weather's. */
export const STARE_VIGNETTE = 3;

// ---- World-side sickness. Browser-tunable; `clear` identity is not. ----
/** The green-grey the shadows lift toward on the top dread plateau (the Alan
 * Wake 2 knob): blacks go faintly milky and wrong rather than black. These
 * are LINEAR values applied before the sRGB encode, so they are tiny: 0.011
 * linear is ~0.11 in display terms. A first pass at 0.04–0.07 turned the
 * whole night frame into a grey-green wash and erased the sky. */
export const LIFT_DREAD: Rgb = { r: 0.005, g: 0.011, b: 0.008 };

// ---- Split-tone response. Scales the ColorCurves-era densities/saturations
// onto the analytic bands; browser-tuned. ----
export const SPLIT_TONE_DENSITY_SCALE = 0.35;
export const SPLIT_TONE_SATURATION_SCALE = 0.5;

/** Pure hue to a unit-saturation RGB, HSB with S = B = 1. */
export function hueToRgb(hueDeg: number): Rgb {
  const h = (((hueDeg % 360) + 360) % 360) / 60;
  const i = Math.floor(h);
  const f = h - i;
  const q = 1 - f;
  switch (i) {
    case 0: return { r: 1, g: f, b: 0 };
    case 1: return { r: q, g: 1, b: 0 };
    case 2: return { r: 0, g: 1, b: f };
    case 3: return { r: 0, g: q, b: 1 };
    case 4: return { r: f, g: 0, b: 1 };
    default: return { r: 1, g: 0, b: q };
  }
}

function tint(hue: number, density: number, saturation: number, mood: number): Tint {
  const c = hueToRgb(hue);
  // Babylon's curves take density 0..100 and saturation -100..100; the pass
  // takes 0..1 and -1..1 so the same constants keep their tuning.
  return { r: c.r, g: c.g, b: c.b, density: mood === 0 ? 0 : (density / 100) * mood, saturation: mood === 0 ? 0 : (saturation / 100) * mood };
}

/**
 * The grade pass's record. `timeSeconds` only drives the vignette's breath;
 * it defaults to 0 so callers that do not animate (and every identity test)
 * see the resting weight. `stare` (hollow.ts) darkens the image toward black
 * at 1 and closes the vignette.
 */
export function gradeRecordUnder(w: WeatherParams, hour: number, unsettle: number, timeSeconds = 0, stare = 0): GradeRecord {
  const altitude = sunPositionAt(hour).y;
  const lens = dreadLensUnder(w) * clamp01(unsettle);
  const world = dreadWorldUnder(w);
  const mood = moodUnder(w);
  const night = 1 - clamp01(twilightT(altitude) / twilightT(0));
  // The resting weight, then the breath: at lens 0 the multiplier is exactly 1.
  const restingVignette = lens === 0 ? vignetteWeightUnder({ ...w, dread: 0 }) : vignetteWeightUnder({ ...w, dread: lens });
  const breath = lens === 0 ? 1 : 1 + VIGNETTE_PULSE * lens * Math.sin((2 * Math.PI * timeSeconds) / VIGNETTE_PULSE_PERIOD);
  const sight = (1 - clamp01(stare)) * (1 - clamp01(stare));
  return {
    exposure: exposureUnder(w, altitude) * sight,
    whitePoint: whitePointMatrix(altitude),
    purkinje: PURKINJE_MATRIX,
    purkinjeThreshold: PURKINJE_THRESHOLD,
    purkinjeStrength: night === 0 ? 0 : PURKINJE_MAX * night,
    shadows: tint(GRADE_SHADOW_HUE, GRADE_SHADOW_DENSITY, GRADE_SHADOW_SATURATION, mood),
    midtones: tint(GRADE_MIDTONE_HUE, GRADE_MIDTONE_DENSITY, GRADE_MIDTONE_SATURATION, mood),
    highlights: tint(GRADE_HIGHLIGHT_HUE, GRADE_HIGHLIGHT_DENSITY, GRADE_HIGHLIGHT_SATURATION, mood),
    lift: world === 0 ? { r: 0, g: 0, b: 0 } : { r: LIFT_DREAD.r * world, g: LIFT_DREAD.g * world, b: LIFT_DREAD.b * world },
    saturation: saturationUnder(w) / 100,
    // The dread share of the vignette is lens-side: at unsettle 0 the base weight stands.
    vignetteWeight: restingVignette * breath + STARE_VIGNETTE * clamp01(stare),
    vignetteColour: VIGNETTE_COLOUR,
    halationStrength: lens === 0 ? HALATION_BASE : HALATION_BASE * (1 + HALATION_DREAD_GAIN * lens),
    aberrationAmount: lens === 0 ? ABERRATION_BASE : ABERRATION_BASE * (1 + ABERRATION_DREAD_GAIN * lens),
  };
}
