import { clamp01, type Rgb } from "./colour.js";

/**
 * The grass floor's arithmetic, Babylon-free: hex tiling of the grass layer
 * (the lattice, the barycentric and sharpened weights), the lattice hash the
 * macro noise is built on, the lush/dry macro tint, and the horizon tint's
 * weight. `shaders/groundHex.fragment.fx` carries the GLSL twins and a
 * lockstep test pins them to these constants; `terrainTexture.ts` binds the
 * uniforms; `clutterMeshes.ts` multiplies each tuft's ground colour by
 * `macroTint` so tuft and floor agree by construction.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 *
 * The hex offsets and rotations are hashed on the GPU with a sin hash that is
 * NOT mirrored here: nothing on the CPU needs them. The macro noise IS
 * mirrored, so its hash is a multiply-add-fract on integer cell indices that
 * both sides compute exactly (a sin hash differs across GPUs by more than the
 * tint could hide).
 */

/** Lattice cells per texture repeat. 1 = one hex cell is about one repeat. */
export const HEX_LATTICE = 1;
/** Weight sharpening exponent: two of three samples dominate anywhere. */
export const HEX_SHARPNESS = 8;
/** Metres per repeat of the near-eye detail scale of the grass maps. */
export const DETAIL_TILING = 0.5;
/** Distance band (m) over which the detail scale fades out. */
export const DETAIL_FADE: readonly [number, number] = [8, 20];
/** Albedo modulation strength of the detail scale. */
export const DETAIL_STRENGTH = 0.5;
/** Weight of the detail normal in the perturbation. */
export const DETAIL_NORMAL = 0.5;
/** Between-blades occlusion strength from the detail height. */
export const DETAIL_AO = 0.6;
/** Macro noise wavelengths (m) and their weights. */
export const MACRO_WAVE: readonly [number, number] = [18, 6];
export const MACRO_WEIGHT: readonly [number, number] = [0.65, 0.35];
/** How far slope pushes the macro toward dry (added to the noise per unit of 1 − n.y). */
export const MACRO_SLOPE = 0.6;
export const MACRO_LUSH: Rgb = { r: 0.92, g: 1.03, b: 0.9 };
export const MACRO_DRY: Rgb = { r: 1.08, g: 1.0, b: 0.82 };
/** The tuft colour the far floor blends toward (linear albedo). */
export const TUFT_ALBEDO: Rgb = { r: 0.36, g: 0.42, b: 0.24 };
/** Distance band (m) of the horizon tint, and its cap. */
export const HORIZON: readonly [number, number] = [35, 90];
export const HORIZON_MAX = 0.5;

/** Skew (uv → triangular lattice) and its inverse, column-major as GLSL's mat2. */
export const HEX_SKEW: readonly [number, number, number, number] = [1, 0, -0.57735027, 1.15470054];
export const HEX_UNSKEW: readonly [number, number, number, number] = [1, 0, 0.5, 0.8660254];

function fract(v: number): number {
  return v - Math.floor(v);
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Exact on both CPU and GPU for |ci|, |cj| < 1e4: only multiplies, adds and fract. */
export function latticeHash(ci: number, cj: number): number {
  return fract(0.618034 * ci + 0.381966 * cj + 0.0113 * ci * cj);
}

export type HexTriangle = {
  /** The point in skewed lattice space. */
  skewed: readonly [number, number];
  /** The three lattice vertices (integer, in skewed space). */
  v: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
  /** Their barycentric weights, non-negative, summing to one. */
  w: readonly [number, number, number];
};

/** The triangle of the lattice the uv point falls in, with barycentric weights.
 * Mirrors `hexTriangle` in groundHex.fragment.fx. */
export function hexTriangle(u: number, v: number): HexTriangle {
  const x = u * HEX_LATTICE, y = v * HEX_LATTICE;
  const sx = HEX_SKEW[0] * x + HEX_SKEW[2] * y;
  const sy = HEX_SKEW[1] * x + HEX_SKEW[3] * y;
  const bx = Math.floor(sx), by = Math.floor(sy);
  const fx = sx - bx, fy = sy - by;
  if (fx + fy < 1) {
    return { skewed: [sx, sy], v: [[bx, by], [bx + 1, by], [bx, by + 1]], w: [1 - fx - fy, fx, fy] };
  }
  return { skewed: [sx, sy], v: [[bx + 1, by + 1], [bx + 1, by], [bx, by + 1]], w: [fx + fy - 1, 1 - fy, 1 - fx] };
}

/** The sharpened, renormalised blend weights. */
export function hexWeights(w: readonly [number, number, number]): [number, number, number] {
  const a = Math.pow(Math.max(w[0], 0), HEX_SHARPNESS);
  const b = Math.pow(Math.max(w[1], 0), HEX_SHARPNESS);
  const c = Math.pow(Math.max(w[2], 0), HEX_SHARPNESS);
  const s = Math.max(a + b + c, 1e-9);
  return [a / s, b / s, c / s];
}

/** Value noise on the lattice hash at one wavelength, in [0, 1]. */
function valueNoise(x: number, z: number, wave: number): number {
  const px = x / wave, pz = z / wave;
  const ci = Math.floor(px), cj = Math.floor(pz);
  const fx = smoothstep(0, 1, px - ci), fz = smoothstep(0, 1, pz - cj);
  const a = latticeHash(ci, cj), b = latticeHash(ci + 1, cj);
  const c = latticeHash(ci, cj + 1), d = latticeHash(ci + 1, cj + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

/** Two octaves at MACRO_WAVE, weighted by MACRO_WEIGHT; in [0, 1]. */
export function macroNoise(x: number, z: number): number {
  return MACRO_WEIGHT[0] * valueNoise(x, z, MACRO_WAVE[0]) + MACRO_WEIGHT[1] * valueNoise(x, z, MACRO_WAVE[1]);
}

/** The lush→dry tint at a point: `noise` is `macroNoise(x, z)` (passed in so a
 * test can pin the ends), `slope` is 1 − n.y of the ground normal. */
export function macroTint(noise: number, slope: number): Rgb {
  const m = clamp01(noise + MACRO_SLOPE * clamp01(slope));
  return {
    r: MACRO_LUSH.r + (MACRO_DRY.r - MACRO_LUSH.r) * m,
    g: MACRO_LUSH.g + (MACRO_DRY.g - MACRO_LUSH.g) * m,
    b: MACRO_LUSH.b + (MACRO_DRY.b - MACRO_LUSH.b) * m,
  };
}

/** The horizon tint's weight at an eye distance (m), before the grass weight. */
export function horizonWeight(dist: number): number {
  return HORIZON_MAX * smoothstep(HORIZON[0], HORIZON[1], dist);
}
