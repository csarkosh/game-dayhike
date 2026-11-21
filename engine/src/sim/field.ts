/**
 * Field primitives for procedural generation. Deliberately knows nothing about
 * chunks, levels or the world.
 *
 * Every function here uses only `+ - * /`, `Math.floor` and `Math.imul`, all of
 * which are exactly specified by IEEE 754 and the ECMAScript spec. No
 * trigonometry and no `Math.pow`: those are implementation-defined and would let
 * two browsers generate different forests from the same seed.
 */

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/**
 * Derives an independent RNG stream per (chunk, pass).
 *
 * Streams are derived rather than sequential so that inserting a new pass leaves
 * every existing pass bit-identical. A single shared sequential stream would
 * shift every later draw and silently rewrite every existing forest.
 */
export function passSeed(worldSeed: number, cx: number, cz: number, passId: number): number {
  let h = FNV_OFFSET ^ (worldSeed | 0);
  h = Math.imul(h ^ (cx | 0), FNV_PRIME);
  h = Math.imul(h ^ (cz | 0), FNV_PRIME);
  h = Math.imul(h ^ (passId | 0), FNV_PRIME);
  return h | 0;
}

function mix(h: number): number {
  let x = h;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491);
  x ^= x >>> 13;
  x = Math.imul(x, 0x27d4eb2d);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Integer lattice hash to [0, 1). */
export function hash2(x: number, z: number, seed: number): number {
  let h = FNV_OFFSET ^ (seed | 0);
  h = Math.imul(h ^ (x | 0), FNV_PRIME);
  h = Math.imul(h ^ (z | 0), FNV_PRIME);
  return mix(h) / 4294967296;
}

/** Three-input variant, for "which of N variants is this feature". */
export function hash3(x: number, z: number, i: number, seed: number): number {
  let h = FNV_OFFSET ^ (seed | 0);
  h = Math.imul(h ^ (x | 0), FNV_PRIME);
  h = Math.imul(h ^ (z | 0), FNV_PRIME);
  h = Math.imul(h ^ (i | 0), FNV_PRIME);
  return mix(h) / 4294967296;
}

/**
 * Smoothstep, the interpolant for `valueNoise2`. Its derivative peaks at 1.5,
 * so a value-noise octave's slope is bounded by 1.5 per unit lattice cell —
 * see `fbm2`, which sums that bound over octaves. Continuous in value and
 * first derivative but not the second, which is why the montane pipeline uses
 * `gradientNoise2`'s quintic fade instead and this pair stays on the shading
 * side of the codebase.
 */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise on the unit lattice, to [0, 1). */
export function valueNoise2(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(z - zi);

  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);

  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

/**
 * Fractal sum of `valueNoise2` with gain 0.5 and lacunarity 2, normalized to
 * [0, 1).
 *
 * WHAT THIS IS FOR NOW. Neither this nor `valueNoise2` has a caller left in
 * `sim/` — the elevation field is `montane.ts`, built on `gradientNoise2` and
 * `fbm2d`, because it needs exact second derivatives that the cubic `fade`
 * cannot supply. The only consumer is `game/terrainSurface.ts`: `fbm2` for the
 * snow-line perturbation and `valueNoise2` for ground mottle. Both want a
 * cheap, smoothly varying scalar in [0, 1) and neither wants a derivative, so
 * the cheaper primitive is the right one. Kept, along with `hash2`/`hash3`, as
 * the shading-side noise vocabulary for future feature passes.
 *
 * gain * lacunarity == 1, so every octave contributes the same slope: for
 * `octaves` octaves over wavelength L the derivative cannot exceed
 * 1.5 * octaves / L, or 3.2/L at four octaves after dividing by the amplitude
 * sum. That bound used to be load-bearing — it was how the old forest terrain
 * guaranteed walkable ground without a gradient clamp. `MAX_GRADIENT` and the
 * field it bounded are gone (see `forestConstants.ts`), and montane ground has
 * no bounded slope at all, so the bound is now just a property of this
 * function rather than an invariant of the world.
 *
 * The reason it was never a clamp is still worth knowing, because it still
 * governs how generation is written here: a clamp is a sweep, a sweep is
 * order-dependent, and order-dependence would destroy the pure-point-function
 * property that makes chunk seams impossible. Everything in `sim/` is a
 * function of a coordinate alone, and nothing post-processes a neighbourhood.
 */
export function fbm2(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, z * freq, seed + i * 0x9e37);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Gradient (Perlin) noise with exact analytic derivatives up to second order.
 *
 * Value noise interpolates hashed lattice VALUES; this interpolates dot
 * products with hashed lattice GRADIENT vectors, which removes value noise's
 * blobby grid alignment. The quintic fade (t⁵ terms) rather than the cubic in
 * `valueNoise2` is load-bearing: its second derivative vanishes at the cell
 * borders, so `dxx`/`dxz`/`dzz` are continuous everywhere — and the montane
 * pipeline builds the first derivative of its height field out of them.
 *
 * Determinism: only + - * /, Math.floor, Math.imul (via hash2) and literal
 * constants. Math.SQRT1_2 and Math.SQRT2 are fixed spec'd doubles, not
 * computed. No Math.sqrt is needed here.
 */
export type NoiseSample = {
  v: number;
  dx: number;
  dz: number;
  dxx: number;
  dxz: number;
  dzz: number;
};

const SQ = Math.SQRT1_2;
const GRAD_X = [1, -1, 0, 0, SQ, SQ, -SQ, -SQ] as const;
const GRAD_Z = [0, 0, 1, -1, SQ, -SQ, SQ, -SQ] as const;
/** 2D Perlin with unit gradients peaks at √2/2; this rescales to [-1, 1]. */
const NOISE_NORM = Math.SQRT2;

export function gradientNoise2(x: number, z: number, seed: number): NoiseSample {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;

  const ia = (hash2(xi, zi, seed) * 8) | 0;
  const ib = (hash2(xi + 1, zi, seed) * 8) | 0;
  const ic = (hash2(xi, zi + 1, seed) * 8) | 0;
  const id = (hash2(xi + 1, zi + 1, seed) * 8) | 0;
  const gax = GRAD_X[ia] as number;
  const gaz = GRAD_Z[ia] as number;
  const gbx = GRAD_X[ib] as number;
  const gbz = GRAD_Z[ib] as number;
  const gcx = GRAD_X[ic] as number;
  const gcz = GRAD_Z[ic] as number;
  const gdx = GRAD_X[id] as number;
  const gdz = GRAD_Z[id] as number;

  const va = gax * fx + gaz * fz;
  const vb = gbx * (fx - 1) + gbz * fz;
  const vc = gcx * fx + gcz * (fz - 1);
  const vd = gdx * (fx - 1) + gdz * (fz - 1);

  // Quintic fade and its first two derivatives.
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const du = 30 * fx * fx * (fx - 1) * (fx - 1);
  const ddu = 60 * fx * (2 * fx - 1) * (fx - 1);
  const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const dw = 30 * fz * fz * (fz - 1) * (fz - 1);
  const ddw = 60 * fz * (2 * fz - 1) * (fz - 1);

  // value = va + u·B + w·C + u·w·D, with B/C/D the bilinear residuals. The
  // corner dot products are linear in (fx, fz), so their own derivatives are
  // the gradient components — Bx below is ∂B/∂fx, a constant per cell.
  const B = vb - va;
  const C = vc - va;
  const D = va - vb - vc + vd;
  const Bx = gbx - gax;
  const Cx = gcx - gax;
  const Dx = gax - gbx - gcx + gdx;
  const Bz = gbz - gaz;
  const Cz = gcz - gaz;
  const Dz = gaz - gbz - gcz + gdz;

  const value = va + u * B + w * C + u * w * D;
  const dx = gax + u * Bx + w * Cx + u * w * Dx + du * (B + w * D);
  const dz = gaz + u * Bz + w * Cz + u * w * Dz + dw * (C + u * D);
  const dxx = 2 * du * (Bx + w * Dx) + ddu * (B + w * D);
  const dzz = 2 * dw * (Cz + u * Dz) + ddw * (C + u * D);
  const dxz = du * (Bz + dw * D + w * Dz) + dw * (Cx + u * Dx);

  return {
    v: value * NOISE_NORM,
    dx: dx * NOISE_NORM,
    dz: dz * NOISE_NORM,
    dxx: dxx * NOISE_NORM,
    dxz: dxz * NOISE_NORM,
    dzz: dzz * NOISE_NORM,
  };
}

/**
 * Fractal sum of gradient noise with gain 0.5 and lacunarity 2, normalized to
 * [-1, 1], carrying exact derivatives through the frequency chain rule:
 * an octave sampled at p·f has derivatives ×f and second derivatives ×f².
 * Same per-octave seed convention as `fbm2`.
 */
export function fbm2d(x: number, z: number, seed: number, octaves: number): NoiseSample {
  let v = 0;
  let dx = 0;
  let dz = 0;
  let dxx = 0;
  let dxz = 0;
  let dzz = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = gradientNoise2(x * freq, z * freq, seed + i * 0x9e37);
    v += amp * n.v;
    dx += amp * freq * n.dx;
    dz += amp * freq * n.dz;
    dxx += amp * freq * freq * n.dxx;
    dxz += amp * freq * freq * n.dxz;
    dzz += amp * freq * freq * n.dzz;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return { v: v / norm, dx: dx / norm, dz: dz / norm, dxx: dxx / norm, dxz: dxz / norm, dzz: dzz / norm };
}
