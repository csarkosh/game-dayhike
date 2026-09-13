import { mixRgb, type Rgb } from "./colour.js";
import type { QualityTier } from "./quality.js";
import { fbm2 } from "../sim/field.js";

/**
 * The pure arithmetic of the stylization layer. Babylon-free
 * and on the architecture test's BABYLON_FREE_FILES list; `stylize.ts` is the
 * shell that applies it — the `weather.ts` / `lighting.ts` split, repeated.
 */

export type OutlineMode = "off" | "depth" | "normal";
export type StylizeFeatures = { pipeline: boolean; outline: OutlineMode };

/** The tier ladder as data, in the `QUALITY` table's spirit. */
export function stylizeFeaturesFor(tier: QualityTier): StylizeFeatures {
  if (tier === "low") return { pipeline: false, outline: "off" };
  if (tier === "medium") return { pipeline: true, outline: "depth" };
  return { pipeline: true, outline: "normal" };
}

/** How far the line colour is pulled from black toward the air:
 * lines sit IN the atmosphere, never pure black on top of it. */
export const LINE_FOG_TINT = 0.25;

/** Line colour tinted by fog if the air isn't black. */
export function outlineLineColour(fog: Rgb): Rgb {
  return mixRgb({ r: 0, g: 0, b: 0 }, fog, LINE_FOG_TINT);
}

// ---- Outline tuning. Browser-tunable, like weather's magnitudes. -----------

/** Outline effect tuning constants. */
export const OUTLINE = Object.freeze({
  /** Master line opacity before the etch noise and fog fade bite. */
  lineStrength: 0.6,
  /** Relative depth step (|Δd|/d) that starts reading as an edge. */
  depthThreshold: 0.02,
  /** 1 − dot(n0, n1) that starts reading as a crease (high tier only). */
  normalThreshold: 0.35,
  /** Screen-space tiling of the etch noise. */
  noiseScale: 3,
});

/** DefaultRenderingPipeline aberrationAmount — small and radial. */
export const CHROMATIC_ABERRATION_AMOUNT = 10;

/**
 * DefaultRenderingPipeline chromaticAberration.radialIntensity — the exponent
 * in Babylon's `pow(radius, radialIntensity)` falloff (CA lives at
 * the screen edges, not the centre). Babylon defaults this to 0
 * (`ThinChromaticAberrationPostProcess`'s constructor), and pow(radius, 0) is
 * 1 everywhere — a flat, screen-uniform shift with no falloff at all. This
 * constant is what makes the effect radial rather than uniform; at 2, the
 * shift is a quarter strength at half-radius and zero at screen centre.
 */
export const CHROMATIC_ABERRATION_RADIAL = 2;

export const ETCH_NOISE_SIZE = 256;

/**
 * Tileable-enough etch noise from `fbm2` (normalized [0, 1)) — the
 * `createWaterBump` pattern: deterministic, generated at startup, no asset.
 * RGBA because RawTexture.CreateRGBATexture is the one upload path already in
 * use; the shader reads .r only.
 */
export function etchNoiseTexels(size = ETCH_NOISE_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const f = 24 / size; // ~24 noise cells across the tile
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(fbm2(x * f, y * f, 0xe7c4, 3) * 255);
      const at = (y * size + x) * 4;
      data[at] = v;
      data[at + 1] = v;
      data[at + 2] = v;
      data[at + 3] = 255;
    }
  }
  return data;
}

// ---- Cel spike. Browser-tunable magnitudes. -------------

export const STYLE_NAMES = ["etched", "cel"] as const;
export type StyleName = (typeof STYLE_NAMES)[number];
export const DEFAULT_STYLE: StyleName = "etched";

/** Painted-light band count. Retuned 2026-08-29: two hard plates instead of
 * three soft ones, for a more graphic, harder-edged cel look. */
export const CEL_BANDS = 2;
/** Fraction of a band occupied by the soft rising transition at its top edge.
 * Retuned 2026-08-29 alongside CEL_BANDS. This is also the band edge's
 * anti-aliasing width — lowering it further risks shimmer as the camera
 * moves across a lit terminator. */
export const CEL_SOFTNESS = 0.05;
/** How far banding displaces the original intensity: 1 is full cel, 0 is off.
 * Full strength (1.0) — an etched-vs-cel comparison across fresh seeds showed a
 * ~3/255 full-frame mean diff at 0.75, subtle enough to read as "not working"
 * at a glance; 1.0 is the only knob that sharpens the comparison without
 * pushing CEL_BANDS toward cartoon or touching the CEL_SOFTNESS transition
 * shape. */
export const CEL_STRENGTH = 1.0;
/** Folded-intensity width over which darkness fades in from black, so unlit
 * surfaces (night, full shadow) are never lifted toward a band centre. */
export const CEL_ZERO_GUARD = 0.08;

/** GLSL-equivalent smoothstep(0, 1, x) with the caller pre-scaling x. */
function smoothstep01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * TS reference of the GLSL `celBand` intensity curve in
 * `shaders/celBand.fragment.fx` — a lockstep test asserts the numeric
 * literals agree. Bands direct-light intensity in a Reinhard-folded domain
 * (t = l/(1+l)) so HDR sunlight cannot blow out the top band: quantize t to
 * band centres with a soft rise near each band's top edge (no rise past the
 * top band, which caps the quantized target strictly below 1), blend toward
 * the quantized value by CEL_STRENGTH, kill true darkness with the zero
 * guard, then unfold. Every reachable folded value stays below 1, so the
 * unfold t/(1-t) cannot divide by zero; the 0.98 clamp is belt-and-braces.
 */
export function celBandCurve(intensity: number): number {
  if (intensity <= 0) return 0;
  const t = intensity / (1 + intensity);
  const i = Math.floor(t * CEL_BANDS);
  const f = t * CEL_BANDS - i;
  const rise = i < CEL_BANDS - 1 ? smoothstep01((f - (1 - CEL_SOFTNESS)) / CEL_SOFTNESS) : 0;
  const q = (i + 0.5 + rise) / CEL_BANDS;
  const guard = smoothstep01(t / CEL_ZERO_GUARD);
  const tq = Math.min(0.98, (t + (q - t) * CEL_STRENGTH) * guard);
  return tq / (1 - tq);
}
