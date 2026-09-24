import { latticeHash, valueNoise2 } from "./groundHexParams.js";
import { luma, type Rgb } from "./colour.js";
import { NEEDLE_BED } from "./terrainSurface.js";
import { TRAIL_BED_HALF } from "../sim/trail.js";

/**
 * The trail bench's constants and the pure mirrors of its band, wear and
 * trample functions, Babylon-free so the tests and the clutter rebuild
 * share them with trailPaint.ts's GLSL. Renderer-only: nothing here may
 * migrate into sim/.
 */

/** Width factor at a node of degree three or more and at the trailhead. */
export const TRAIL_JUNCTION_W = 1.35;
/** Along-length wear: two octaves of 1-D value noise on the node parameter u (m). */
export const TRAIL_WEAR_WAVE: readonly [number, number] = [12, 3];
export const TRAIL_WEAR_WEIGHT: readonly [number, number] = [0.6, 0.4];
/** Band width scale at wear 0 and 1. */
export const TRAIL_WEAR_W0 = 0.8;
export const TRAIL_WEAR_W1 = 1.25;
/** Core darkness scale at wear 0 and 1. */
export const TRAIL_WEAR_D0 = 0.85;
export const TRAIL_WEAR_D1 = 1.1;
/** The ragged edge: metres of two-octave lattice noise added to the across distance. */
export const TRAIL_EDGE_NOISE = 0.25;
export const TRAIL_EDGE_WAVE: readonly [number, number] = [1.5, 0.4];
export const TRAIL_EDGE_WEIGHT: readonly [number, number] = [0.6, 0.4];
/** Metres a band boundary moves per unit of the pebble height's offset from 0.5. */
export const TRAIL_HEIGHT_SHIFT = 0.3;
/** The four bands from the centre, in metres of shifted distance. TRAIL_MARGIN_HALF is TRAIL_BED_HALF. */
export const TRAIL_CORE_HALF = 0.45;
export const TRAIL_MARGIN_HALF: number = TRAIL_BED_HALF;
export const TRAIL_TRAMPLE_HALF = 1.35;
/** Boundary softness (m), widened to the fragment footprint in the shader. */
export const TRAIL_PAINT_EDGE = 0.08;
export const TRAIL_CORE_GAIN = 0.45;
/** The bench's darker band, compacted by footfall. About half the margin's brightness. */
export const TRAIL_CORE_TINT: Rgb = { r: 0.3, g: 0.26, b: 0.21 };
export const TRAIL_MARGIN_GAIN = 0.75;
/** The bench's loose, pale band. About twice the core's brightness. */
export const TRAIL_MARGIN_TINT: Rgb = { r: 0.4, g: 0.36, b: 0.3 };
export const TRAIL_TRAMPLE_TINT: Rgb = { r: 0.9, g: 0.88, b: 0.8 };
/** The fraction of the ground's vertex colour (the palette's darkness and
 * canopy tint) the bench colours take: at 1 the bench goes black under
 * canopy and the core/margin contrast is lost, at 0 the margin reads as a
 * chalk line in the open. */
export const TRAIL_BENCH_SHADE = 0.6;
/** Wet: the core's albedo loss and roughness loss at wetness 1; puddles. */
export const TRAIL_WET_DARK = 0.35;
export const TRAIL_WET_GLOSS = 0.5;
export const TRAIL_PUDDLE_WET: readonly [number, number] = [0.55, 0.8];
export const TRAIL_PUDDLE_LOW: readonly [number, number] = [0.62, 0.75];
export const TRAIL_PUDDLE_WAVE = 6;
/** The trampled cards beside the bench. */
export const TRAMPLE_HEIGHT = 0.73;
export const TRAMPLE_LEAN = 0.21;
/** Weakened to 0.6 of its former strength { r: 0.85, g: 0.8, b: 0.65 }, the
 * same 0.6 TRAMPLE_HEIGHT and TRAMPLE_LEAN are already at: a tint's strength
 * is its distance from white, so each channel is `1 - 0.6 * (1 - c)`. */
export const TRAMPLE_TINT: Rgb = { r: 0.91, g: 0.88, b: 0.79 };
export const TRAMPLE_BAND: readonly [number, number] = [0.75, 1.6];

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** One octave of 1-D value noise on the lattice hash. Mirrors trailValueNoise1 in the GLSL. */
export function valueNoise1(u: number, wave: number): number {
  const q = u / wave;
  const c = Math.floor(q);
  const f = smoothstep(0, 1, q - c);
  const a = latticeHash(c, 0), b = latticeHash(c + 1, 0);
  return a + (b - a) * f;
}

export function trailWear(u: number): number {
  return TRAIL_WEAR_WEIGHT[0] * valueNoise1(u, TRAIL_WEAR_WAVE[0]) + TRAIL_WEAR_WEIGHT[1] * valueNoise1(u, TRAIL_WEAR_WAVE[1]);
}

/** Signed metres to add to the across distance, in [−TRAIL_EDGE_NOISE, TRAIL_EDGE_NOISE]. */
export function trailEdgeNoise(x: number, z: number): number {
  const n = TRAIL_EDGE_WEIGHT[0] * valueNoise2(x, z, TRAIL_EDGE_WAVE[0]) + TRAIL_EDGE_WEIGHT[1] * valueNoise2(x, z, TRAIL_EDGE_WAVE[1]);
  return TRAIL_EDGE_NOISE * (2 * n - 1);
}

/** Band weights of the shifted distance dB, each boundary a smoothstep of TRAIL_PAINT_EDGE. */
export function trailBands(dB: number): { core: number; margin: number; trample: number } {
  const e = TRAIL_PAINT_EDGE;
  const inCore = 1 - smoothstep(TRAIL_CORE_HALF, TRAIL_CORE_HALF + e, dB);
  const inMargin = 1 - smoothstep(TRAIL_MARGIN_HALF, TRAIL_MARGIN_HALF + e, dB);
  const trampleFade = 1 - smoothstep(TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, dB);
  return { core: inCore, margin: inMargin - inCore, trample: (1 - inMargin) * trampleFade };
}

/** The trampled card's height scale, lean (rad, away from the bench) and tint at trail distance rt. */
export function trampleAt(rt: number): { height: number; lean: number; tint: Rgb } {
  const s = smoothstep(TRAMPLE_BAND[0], TRAMPLE_BAND[1], rt);
  return {
    height: TRAMPLE_HEIGHT + (1 - TRAMPLE_HEIGHT) * s,
    lean: TRAMPLE_LEAN * (1 - s),
    tint: { r: TRAMPLE_TINT.r + (1 - TRAMPLE_TINT.r) * s, g: TRAMPLE_TINT.g + (1 - TRAMPLE_TINT.g) * s, b: TRAMPLE_TINT.b + (1 - TRAMPLE_TINT.b) * s },
  };
}

/** Neglect: leaf-and-needle drifts on the bed where the ground cover's own
 * duff lies thick, and gravel washed out to bare dirt in patches of the
 * bed's own noise. Both are smoothsteps of a continuous field — no thresholds. */
export const TRAIL_DRIFT_BAND: readonly [number, number] = [0.25, 0.7];
/** The drift's brightness relative to the floor texture, the value the
 * paired stills were judged at. */
export const TRAIL_DRIFT_LUM = 0.5154;
/** Needle-and-leaf bed over the floor texture: the needle bed's own hue
 * (`NEEDLE_BED`) at TRAIL_DRIFT_LUM's brightness, so a retune of NEEDLE_BED
 * carries through here automatically. */
const TRAIL_DRIFT_K = TRAIL_DRIFT_LUM / luma(NEEDLE_BED);
export const TRAIL_DRIFT_TINT: Rgb = {
  r: NEEDLE_BED.r * TRAIL_DRIFT_K,
  g: NEEDLE_BED.g * TRAIL_DRIFT_K,
  b: NEEDLE_BED.b * TRAIL_DRIFT_K,
};
export const TRAIL_WASH_WAVE = 4;
export const TRAIL_WASH_BAND: readonly [number, number] = [0.55, 0.8];
export const TRAIL_WASH_DARK = 0.7;
export const TRAIL_WASH_ROUGH = 1.15;

/** Drift weight from the vertex's duff: the same smoothstep the shader applies. */
export function trailDriftWeight(duff: number): number {
  return smoothstep(TRAIL_DRIFT_BAND[0], TRAIL_DRIFT_BAND[1], Math.min(1, Math.max(0, duff)));
}

/** Gravel washed out to dirt: a 4 m value noise, the shader's macroValueNoise at the same wave. */
export function trailWashoutNoise(x: number, z: number): number {
  return valueNoise2(x, z, TRAIL_WASH_WAVE);
}

export function trailWashoutWeight(x: number, z: number): number {
  return smoothstep(TRAIL_WASH_BAND[0], TRAIL_WASH_BAND[1], trailWashoutNoise(x, z));
}

/** Both patches at a point; where both are high the wash-out wins — dirt
 * under leaves is still dirt at the drift's edge. */
export function trailPatches(duff: number, x: number, z: number): { drift: number; wash: number } {
  const wash = trailWashoutWeight(x, z);
  return { drift: trailDriftWeight(duff) * (1 - wash), wash };
}
