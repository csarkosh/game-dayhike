/**
 * The water material's maths, Babylon-free and testable under Node, the way
 * `water.ts` and `sky.ts` are. Every constant here that the GLSL in
 * shaders/water*.fx repeats is pinned by the lockstep test in
 * waterPlugin.test.ts; tune them here and there together.
 *
 * Trigonometry and exp are fine here (renderer-only; nothing crosses the
 * wire). See docs/rendering/2026-09-29-water-material-design.md §5.
 */
import { clamp01 } from "./colour.js";
import { CLUTTER_WATER_MURK_HI, CLUTTER_WATER_MURK_LO } from "../sim/clutter.js";
import { WATER_BASE_SPACING, WATER_RING_CELLS } from "./water.js";
import { OCEAN_ROLL_WIDTH } from "./oceanWaves.js";

/** One body of water, from the world at build time (spec §7). */
export type WaterBody = {
  /** Surface height, world metres. */
  level: number;
  /** Diffuse attenuation per channel, per metre (research doc §2.3). */
  kd: [number, number, number];
  /** Deep-water colour as an albedo the sky lights. */
  lInf: [number, number, number];
  /** 0..1 scale on Cox and Munk's slope variance: 1 open sea, 0.1 a lake in old growth. */
  shelter: number;
};

export type WaterRow = Omit<WaterBody, "level">;

/** The measured rows of spec §5.2. L∞ is small: the water body itself returns
 * under 1 % in brown water and a few percent in clear or sea water. */
export const WATER_ROWS: { sea: WaterRow; lowlandLake: WaterRow; highLake: WaterRow } = {
  sea: { kd: [0.34, 0.18, 0.26], lInf: [0.02, 0.05, 0.05], shelter: 1 },
  lowlandLake: { kd: [1.1, 1.5, 3.5], lInf: [0.009, 0.006, 0.003], shelter: 0.1 },
  highLake: { kd: [0.2, 0.12, 0.2], lInf: [0.01, 0.025, 0.05], shelter: 0.3 },
};

/** Kd of the research's clear lake (§2.3, a 5.5 m Secchi depth): the row a
 * lake takes halfway between the very clear high lake and the humic one. */
export const CLEAR_LAKE_KD: [number, number, number] = [0.75, 0.8, 1.6];

function mix3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  // a·(1 − t) + b·t, so t = 0 and t = 1 give a and b exactly.
  return [a[0]! * (1 - t) + b[0]! * t, a[1]! * (1 - t) + b[1]! * t, a[2]! * (1 - t) + b[2]! * t];
}

/**
 * A lake's water from its murk (the sim's `murkFor`): Kd through the very
 * clear, the clear and the humic rows the research measured, piecewise
 * linear; L∞ and the shelter straight from the clear high lake to the humic
 * lowland one. Murk 0 is `WATER_ROWS.highLake`, murk 1 `WATER_ROWS.lowlandLake`.
 */
export function lakeWaterRow(murk: number): WaterRow {
  const m = clamp01(murk);
  const high = WATER_ROWS.highLake;
  const low = WATER_ROWS.lowlandLake;
  const kd = m <= 0.5 ? mix3(high.kd, CLEAR_LAKE_KD, m / 0.5) : mix3(CLEAR_LAKE_KD, low.kd, (m - 0.5) / 0.5);
  return { kd, lInf: mix3(high.lInf, low.lInf, m), shelter: high.shelter * (1 - m) + low.shelter * m };
}

/** How much of a lake's surface may carry the duckweed and algae skin: none
 * up to murk 0.5, all of it from 0.8: the two numbers the clutter field
 * gates the reeds and lilies by (`CLUTTER_WATER_MURK_LO`/`_HI`). */
export function lakeSkin(murk: number): number {
  const t = clamp01((murk - CLUTTER_WATER_MURK_LO) / (CLUTTER_WATER_MURK_HI - CLUTTER_WATER_MURK_LO));
  return t * t * (3 - 2 * t);
}

/** The seed's offset (m) for the skin's noise, so two worlds' lakes do not
 * wear the same pattern. Render-only, but seeded: every peer sees one skin. */
export function waterSkinOffset(seed: number): number {
  return ((seed >>> 0) % 4096) * 0.731;
}

/** Fresnel reflectance of water at normal incidence, n = 1.33. Mirrored in shaders/water.fragment.fx. */
export const WATER_F0 = 0.02;
/** The reflected ray's least y (spec §5.1). Mirrored in shaders/water.fragment.fx. */
export const WATER_HORIZON = 0.02;
/** Metres per second the game's wind of 1 stands for (spec §5.1). */
export const WATER_WIND_MAX = 12;
/**
 * Metres per second the murky lakes' skin slides along the wind, per unit of the wind's direction: duckweed
 * pushed over the surface, its rafts keeping their shape. Mirrored in shaders/water.fragment.fx. The offset is
 * the wind's integral over the run, a few thousand metres after a day, the order of the world coordinates
 * the skin's hash already takes, so no fold is added.
 */
export const WATER_SKIN_DRIFT = 0.04;
/** Screen-space refraction offset per unit of ripple slope, in uv, at 1 m of depth. Mirrored in shaders/water.fragment.fx. */
export const WATER_REFRACT = 0.02;
/** Depth at which the refraction offset stops growing (spec §5.2). Mirrored in shaders/water.fragment.fx. */
export const WATER_REFRACT_DEPTH = 1;

/** Schlick's approximation to Fresnel reflectance; stays within 6 % absolute of the exact unpolarised curve for n = 1.33 (the worst is 0.058 at 85°). */
export function fresnelSchlick(cosTheta: number): number {
  const c = clamp01(cosTheta);
  const m = 1 - c;
  return WATER_F0 + (1 - WATER_F0) * m * m * m * m * m;
}

/** Exact unpolarised Fresnel reflectance from air into a medium of index n. */
export function fresnelExact(cosTheta: number, n = 1.33): number {
  const ci = clamp01(cosTheta);
  const si = Math.sqrt(Math.max(0, 1 - ci * ci));
  const st = si / n;
  if (st >= 1) return 1;
  const ct = Math.sqrt(1 - st * st);
  const rs = (ci - n * ct) / (ci + n * ct);
  const rp = (n * ci - ct) / (n * ci + ct);
  return 0.5 * (rs * rs + rp * rp);
}

/** e^(−2 Kd d) per channel: the bed's share of the pixel at depth d (§5.2). */
export function transmission(kd: readonly [number, number, number], depth: number): [number, number, number] {
  const d = Math.max(0, depth);
  return [Math.exp(-2 * kd[0] * d), Math.exp(-2 * kd[1] * d), Math.exp(-2 * kd[2] * d)];
}

export function meanKd(kd: readonly [number, number, number]): number {
  return (kd[0] + kd[1] + kd[2]) / 3;
}

/**
 * The medium and low tiers' single alpha: 1 − (1 − F)·e^(−2 K̄ d) (§5.2). The
 * blend scales the reflection too, so the reflected share F (Schlick on the
 * view cosine) is kept out of the transmission.
 */
export function alphaFor(kd: readonly [number, number, number], depth: number, cosTheta = 1): number {
  return 1 - (1 - fresnelSchlick(cosTheta)) * Math.exp(-2 * meanKd(kd) * Math.max(0, depth));
}

/** Cox and Munk's slope variance for a wind of U m/s: σ² = A + B·U. Mirrored in shaders/oceanShade.fragment.fx. */
export const WATER_COX_MUNK_A = 0.003;
export const WATER_COX_MUNK_B = 0.00512;

/** Cox and Munk's slope variance for a wind of `u10` m/s, the whole sea's. */
export function coxMunkVariance(u10: number): number {
  return WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10;
}

/** Cox and Munk's slope variance, σ² = 0.003 + 0.00512 U, scaled by the body's shelter (§5.1). */
export function slopeVariance(wind01: number, shelter: number): number {
  const u = clamp01(wind01) * WATER_WIND_MAX;
  return coxMunkVariance(u) * clamp01(shelter);
}

/** PBR perceptual roughness from the slope variance: Beckmann α = √(2σ²), roughness = √α. */
export function roughnessFor(wind01: number, shelter: number): number {
  const alpha = Math.sqrt(2 * slopeVariance(wind01, shelter));
  return Math.sqrt(alpha);
}

/**
 * The sea's roughness from the slope variance its normal leaves undrawn, per pixel in the shader (the
 * roughness line `waterPlugin.ts` rewrites): √√(2σ²) as `roughnessFor`, at most 1.
 */
export function roughnessFromVariance(variance: number): number {
  return Math.min(Math.sqrt(Math.sqrt(2 * Math.max(0, variance))), 1);
}

/**
 * The least slope variance the sea's roughness keeps however much of Cox and Munk's the drawn waves carry:
 * half their calm intercept, so a glassy sea's glint stays wider than a pixel. Mirrored in
 * shaders/oceanShade.fragment.fx.
 */
export const OCEAN_SLOPE_VAR_FLOOR = 0.0015;

/**
 * The slope variance left to the sea's roughness (spec §7.3): Cox and Munk's for the wind sea's wind
 * `u10` (m/s), scaled by the shelter, less `drawn`, the variance the drawn waves already put in the
 * normal; never under OCEAN_SLOPE_VAR_FLOOR. `oceanUndrawnVariance` in shaders/oceanShade.fragment.fx.
 */
export function undrawnSlopeVariance(u10: number, shelter: number, drawn: number): number {
  return Math.max(coxMunkVariance(u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);
}

/**
 * A drawn wave keeps all of its share while its phase turns by at most a quarter turn over one step of the
 * drawing (a pixel, or a ring's cells): four steps a wavelength; none from a half turn, two steps, where it
 * would alias. Mirrored in shaders/oceanSurface.fx.
 */
export const OCEAN_RESOLVE_PHASE_LO = Math.PI / 2;
export const OCEAN_RESOLVE_PHASE_HI = Math.PI;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The share of a wave the drawing keeps when its phase turns by `turn` radians over one step. */
export function resolvedShare(turn: number): number {
  return 1 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn);
}

/**
 * The slope variance the drawn waves carry when each is drawn over steps of `step` metres along its own
 * direction: Σ ½(a·k·share)², a sinusoid of amplitude a and wavenumber k carrying ½(a·k)², faded by
 * `resolvedShare(k·step)`. With a step of 0 it is the waves' whole variance.
 */
export function resolvedSlopeVariance(waves: readonly { amplitude: number; k: number }[], step: number): number {
  let sum = 0;
  for (const { amplitude, k } of waves) {
    const a = amplitude * resolvedShare(k * step);
    sum += 0.5 * (a * k) * (a * k);
  }
  return sum;
}

/**
 * The spacing (m) of the ring that draws a point (dx, dz) from the eye, as the vertex shader estimates it
 * (`oceanRingCell`): a ring of spacing s lies from OCEAN_RING_REACH·s to twice that from the eye, so the
 * estimate is the ring's own spacing at its inner edge and the next ring's at its outer, never under the
 * finest ring's. It depends on the point alone, so two rings drawing one point displace it alike.
 */
export const OCEAN_RING_REACH = WATER_RING_CELLS / 4;
export function oceanRingCell(dx: number, dz: number): number {
  return Math.max(WATER_BASE_SPACING, Math.max(Math.abs(dx), Math.abs(dz)) / OCEAN_RING_REACH);
}

/**
 * The white water's look, two things apart (spec §5). A foam's brightness, its albedo, is OCEAN_FOAM_ALBEDO
 * when fresh (fresh foam reflects about 40 %) and falls toward OCEAN_FOAM_ALBEDO_OLD with the time since its
 * crest, by a factor e every OCEAN_FOAM_FADE seconds: 4.7 s puts it at 0.1 ten seconds on, inside spec §5's
 * 3 to 10 % for old foam and near the 3.85 s laboratory decay (`foamWhite`). Its cover, the share of the
 * surface it whitens, thins from a sheet to a lace with the foam's amount, which itself thins over
 * OCEAN_FOAM_LIFE (`swellAt`), down to the inner surf's floor: where the broken swell renews the foam every
 * period, OCEAN_INNER_COVER of the surface stays in foam, weighted by the breaking weight B (spec §5: foam
 * over 0.35 to 0.55 of the surf zone on average, nearly all of its inner part) (`foamShare`). The lace's
 * cell (m), its drift along the swell's travel (m/s) and its edge's softness. Mirrored in
 * shaders/oceanShade.fragment.fx.
 */
export const OCEAN_FOAM_ALBEDO = 0.4;
export const OCEAN_FOAM_ALBEDO_OLD = 0.06;
export const OCEAN_FOAM_FADE = 4.7;
export const OCEAN_INNER_COVER = 0.6;
export const OCEAN_LACE_TILE = 3;
export const OCEAN_LACE_DRIFT = 0.4;
export const OCEAN_LACE_SOFT = 0.06;

/**
 * The lace's noise (`oceanLace`): the coarse octave's weight (the fine octave has the rest), the fine
 * octave's cell as a fraction of the coarse one's, and its shift. OCEAN_LACE_FIT_A to E: the level a share
 * c of the lace lies above, for shares from none to all: 1 - s (A + s (B + s C)) - p (D + p E), for s the
 * share's square root and p one less the fourth root of what the share leaves, 1 - (1 - c)^(1/4). The first
 * fits the noise's top tail and the second its bottom. Fitted to the noise's quantiles measured over 2^20
 * points of a square kilometre (`laceLevel`, which gives the mean cover within 0.002 of the share with the
 * soft edge centred on it). OCEAN_LACE_ONSET: the share under which the lace is held back. OCEAN_DETAIL_LO and
 * HI: a pattern is drawn whole while a pixel spans under the first of its size and has faded to its mean by
 * the second. Mirrored in shaders/oceanShade.fragment.fx.
 */
export const OCEAN_LACE_WEIGHT = 0.65;
export const OCEAN_LACE_FINE = 0.37;
export const OCEAN_LACE_FINE_SHIFT = 19;
export const OCEAN_LACE_FIT_A = 0.4334;
export const OCEAN_LACE_FIT_B = -0.1923;
export const OCEAN_LACE_FIT_C = 0.1369;
export const OCEAN_LACE_FIT_D = 0.5144;
export const OCEAN_LACE_FIT_E = 0.1083;
export const OCEAN_LACE_ONSET = 0.01;
export const OCEAN_DETAIL_LO = 0.1;
export const OCEAN_DETAIL_HI = 0.4;

/**
 * The whitecaps where no wind sea is drawn (the low tier, `oceanCapCells`): a cap a cell (m), each cell's
 * cycle (s), a cap's radius and its centre's least inset (in cells), the cells' drift down the wind (m/s
 * of the wind's integral), and OCEAN_CAP_SHARE, the cover a cell gives when its cap fires every cycle:
 * the cap's profile integrated over the cell (`capProfile`, 0.2056 of it) times its mean brightness over
 * the cycle (it fades linearly, ½). A cap fires with the chance coverage / OCEAN_CAP_SHARE, so the mean
 * cover is Callaghan's coverage by construction. OCEAN_CAP_CYCLES: the cycles after which the hashed
 * pattern of which caps fire repeats, the clock folded by that many periods. And OCEAN_CAP_SOFT, the soft
 * edge (in standard deviations of its height) of the caps on a drawn wind sea (`oceanWhitecap`). Mirrored
 * in shaders/oceanShade.fragment.fx.
 */
export const OCEAN_CAP_CELL = 5;
export const OCEAN_CAP_PERIOD = 5;
export const OCEAN_CAP_RADIUS = 0.3;
export const OCEAN_CAP_INSET = 0.3;
export const OCEAN_CAP_DRIFT = 2;
export const OCEAN_CAP_SHARE = 0.1028;
export const OCEAN_CAP_CYCLES = 97;
export const OCEAN_CAP_SOFT = 0.4;

/** GLSL's mod: x less y times floor(x / y), never negative for a positive y. */
function glslMod(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The water's sine-free hash of a lattice point (`waterSkinHash`, shaders/water.fragment.fx), in doubles:
 * the GPU's floats differ in the last bits and no more.
 */
export function waterSkinHash(x: number, z: number): number {
  let a = fract(x * 0.1031);
  let b = fract(z * 0.1031);
  let c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

/** The water's value noise (`waterSkinNoise`, shaders/water.fragment.fx): the hash on the unit lattice, smoothly interpolated. */
export function waterSkinNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = waterSkinHash(ix, iz);
  const b = waterSkinHash(ix + 1, iz);
  const c = waterSkinHash(ix, iz + 1);
  const d = waterSkinHash(ix + 1, iz + 1);
  const m1 = a + (b - a) * ux;
  const m2 = c + (d - c) * ux;
  return m1 + (m2 - m1) * uz;
}

/**
 * The foam's lace at (x, z) (`oceanLace`): two octaves of ridged noise, near 1 along the lines of a net,
 * drifting with the swell's travel (swellX, swellZ, a unit vector) at `time` seconds and offset by the
 * world's seed (`waterSkinOffset`).
 */
export function oceanLace(x: number, z: number, skinOffset: number, swellX: number, swellZ: number, time: number): number {
  const qx = x + skinOffset - swellX * (OCEAN_LACE_DRIFT * time);
  const qz = z + skinOffset - swellZ * (OCEAN_LACE_DRIFT * time);
  const a = 1 - Math.abs(2 * waterSkinNoise(qx / OCEAN_LACE_TILE, qz / OCEAN_LACE_TILE) - 1);
  const fine = OCEAN_LACE_FINE * OCEAN_LACE_TILE;
  const b = 1 - Math.abs(2 * waterSkinNoise(qx / fine + OCEAN_LACE_FINE_SHIFT, qz / fine + OCEAN_LACE_FINE_SHIFT) - 1);
  return OCEAN_LACE_WEIGHT * a + (1 - OCEAN_LACE_WEIGHT) * b;
}

/**
 * The age (s) the foam's look goes by, given the swell's `foamAge` and its peak period `tp`: the time since
 * the crest passed, except on the spilling roll at the crest's front face, where that age has wrapped to
 * nearly a whole period and the foam is fresh (`oceanFoamLookAge`).
 */
export function foamLookAge(foamAge: number, tp: number): number {
  const ahead = 2 * Math.PI - foamAge * ((2 * Math.PI) / tp);
  return foamAge * smoothstep(0, OCEAN_ROLL_WIDTH, ahead);
}

/** The foam's albedo at an age (s): fresh foam's, falling to old foam's by a factor e every OCEAN_FOAM_FADE seconds (`oceanFoamWhite`). */
export function foamWhite(foamAge: number): number {
  const fresh = Math.exp(-foamAge / OCEAN_FOAM_FADE);
  return OCEAN_FOAM_ALBEDO_OLD + (OCEAN_FOAM_ALBEDO - OCEAN_FOAM_ALBEDO_OLD) * fresh;
}

/**
 * The share of the surface a foam covers on average (`oceanFoamShare`): the foam's amount `foam` (0 to 1),
 * a sheet at the roll and thinning with the time since the crest, or the inner surf's floor, the breaking
 * weight `breaking` (0 to 1) times OCEAN_INNER_COVER, whichever is the more. The inner surf's foam is
 * renewed by every bore, so the floor does not thin with age.
 */
export function foamShare(foam: number, breaking: number): number {
  return Math.max(foam, breaking * OCEAN_INNER_COVER);
}

/** The lace's value that a `share` (0 to 1) of the surface lies above: the fitted quantile at one less the share (`oceanLaceLevel`). */
export function laceLevel(share: number): number {
  const c = Math.min(Math.max(share, 0), 1);
  const s = Math.sqrt(c);
  const p = 1 - Math.sqrt(Math.sqrt(1 - c));
  return 1 - s * (OCEAN_LACE_FIT_A + s * (OCEAN_LACE_FIT_B + s * OCEAN_LACE_FIT_C)) - p * (OCEAN_LACE_FIT_D + p * OCEAN_LACE_FIT_E);
}

/**
 * The lace's cover where the ridged noise is `ridge` (0 to 1) and the foam's mean `share`: the lace above
 * the level that leaves that share of it, its soft edge centred there, held back to nothing as the share
 * goes to none. The mean cover over the lace is the share (`oceanFoamCover`'s near value).
 */
export function laceCover(ridge: number, share: number): number {
  const level = laceLevel(share);
  return (
    smoothstep(level - 0.5 * OCEAN_LACE_SOFT, level + 0.5 * OCEAN_LACE_SOFT, ridge) * smoothstep(0, OCEAN_LACE_ONSET, share)
  );
}

/**
 * The foam's cover at a point where the lace is `ridge`, its amount `foam`, the breaking weight `breaking`
 * and a pixel spans `pixel` metres (`oceanFoamCover`): the lace, faded to the share it averages to where a
 * pixel spans more than a tenth of its cell.
 */
export function foamCover(ridge: number, foam: number, breaking: number, pixel: number): number {
  const share = foamShare(foam, breaking);
  return mix(laceCover(ridge, share), share, smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / OCEAN_LACE_TILE));
}

/** How many standard deviations above its mean a Gaussian sea's height stands over a `coverage` share of
 * its surface: Abramowitz and Stegun's 26.2.23, within 4.5e-4, the coverage held to [1e-6, 0.5]
 * (`oceanCapThreshold`). */
export function whitecapThreshold(coverage: number): number {
  const s = Math.sqrt(-2 * Math.log(Math.min(Math.max(coverage, 1e-6), 0.5)));
  return s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s);
}

/** A whitecap's brightness at `r` of its radius from its centre (`oceanCapCells`). */
export function capProfile(r: number): number {
  return 1 - smoothstep(0.7, 1, r);
}

/**
 * The wind sea on the rings and the pixels (spec §6, §7.1, §7.3). A ring displaces a field while its cells
 * are at most 1/OCEAN_WIND_TILE_CELLS of the field's tile, and none of it from twice that; the medium loop's
 * least scale is the wind's floor's, (WIND_SEA_U_FLOOR / WIND_SEA_U_REF)²; the high tier's crests whiten as
 * the wind sea's Jacobian falls through OCEAN_FOLD, in full by OCEAN_FOLD_FULL; the low tier's bump draws its
 * slope at OCEAN_BUMP_HS metres of the wind sea's height, scaled with it to at most OCEAN_BUMP_MAX. Mirrored in
 * shaders/oceanSurface.fx and shaders/oceanShade.fragment.fx.
 */
export const OCEAN_WIND_TILE_CELLS = 16;
export const OCEAN_LOOP_SCALE_MIN = 0.0025;
export const OCEAN_FOLD = 0.4;
export const OCEAN_FOLD_FULL = 0.3;
export const OCEAN_BUMP_HS = 1;
export const OCEAN_BUMP_MAX = 2;

/** The share of a wind sea field `size` metres across that a ring of `cell` metres displaces (`oceanWindRingKeep`). */
export function windRingKeep(size: number, cell: number): number {
  return 1 - smoothstep(1, 2, (OCEAN_WIND_TILE_CELLS * cell) / size);
}

/** The share of a field `size` metres across, `n` texels a side, a pixel of `pixel` metres draws: its shortest
 * wave, of wavenumber π·n/size, turning by that times the pixel over one (`oceanWindPixelKeep`). */
export function windPixelKeep(size: number, n: number, pixel: number): number {
  return resolvedShare((Math.PI * n * pixel) / size);
}

/** How white the high tier's fold makes a crest at a Jacobian `jacobian`. */
export function foldCap(jacobian: number): number {
  return 1 - smoothstep(OCEAN_FOLD_FULL, OCEAN_FOLD, jacobian);
}

/** The low tier's bump scaled by the wind sea's height `hsCut` (m, Hs times its share near shore,
 * `windSeaShare`), cut by the break's B and the headland's shelter as the chop is (`oceanBumpScale`). */
export function bumpScale(hsCut: number, breaking: number, shelter: number): number {
  return Math.min((hsCut * (1 - breaking) * shelter) / OCEAN_BUMP_HS, OCEAN_BUMP_MAX);
}

/**
 * The most of the drawn wind sea's slopes the normal takes, so the variance they carry (`drawn`) is never
 * more than Cox and Munk's whole sea for the wind `u10` in the shelter: the medium loop, one bake scaled to
 * every wind, keeps a strong wind's steepness in a light one, where a calm sea should be glassy
 * (`oceanWindSlopeLimit`).
 */
export function windSlopeLimit(u10: number, shelter: number, drawn: number): number {
  return Math.min(1, Math.sqrt((coxMunkVariance(u10) * shelter) / Math.max(drawn, 1e-6)));
}

/**
 * A point (px, pz) in the wind's frame (`oceanWindFrame`): x down the wind (dirX, dirZ), z across it, about
 * the pivot, the cove's waterline centre (`oceanWindPivot`). Both wind sea fields are made with the wind
 * along +x and sampled here, so as the wind turns they turn about the pivot: nothing slides there, and a
 * point r metres off slides at r times the wind's turn (2π/WIND_DIR_PERIOD rad/s), 0.52 m/s at 100 m.
 */
export function windFrame(px: number, pz: number, dirX: number, dirZ: number, pivotX: number, pivotZ: number): [number, number] {
  const rx = px - pivotX;
  const rz = pz - pivotZ;
  return [rx * dirX + rz * dirZ, dirX * rz - dirZ * rx];
}

/** Whether a cap fires under `chance`, 1 or 0: only while its hash is under the chance, so a chance of none never fires (`oceanCapFire`). */
export function capFires(hash: number, chance: number): number {
  return hash < chance ? 1 : 0;
}

/**
 * A cell's cap's place in its cycles at `time` seconds, `phase` (0 to 1) its cell's hashed offset: the
 * cycle's index n, counted from 0 to OCEAN_CAP_CYCLES - 1, and how far through the cycle it is (`frac`,
 * 0 to 1). The clock folds by OCEAN_CAP_CYCLES periods, the pattern's own repeat, so no cycle is cut short.
 */
export function capCycle(time: number, phase: number): { n: number; frac: number } {
  const cycle = glslMod(time, OCEAN_CAP_CYCLES * OCEAN_CAP_PERIOD) / OCEAN_CAP_PERIOD + phase;
  const k = Math.floor(cycle);
  return { n: glslMod(k, OCEAN_CAP_CYCLES), frac: cycle - k };
}

/**
 * The hash a cell's cap fires on in cycle `n` (`oceanCapFire`): the cell's, shifted by a shift hashed from
 * the cycle, so no two cycles share a pattern or a neighbour's.
 */
export function capCycleHash(hx: number, hz: number, n: number): number {
  const shiftX = waterSkinHash(n, 31) * 512;
  const shiftZ = waterSkinHash(n, 77) * 512;
  return waterSkinHash(hx + shiftX, hz + shiftZ);
}

/**
 * The whitecaps where no wind sea is drawn at (x, z), `time` seconds in (`oceanCapCells`): `windX` and
 * `windZ` are the wind's integral, `skinOffset` the world's seed, `coverageAt` Callaghan's coverage cut by
 * the lee (`oceanCapCoverage`), asked at the cap's centre for whether it fires, and `pixel` the metres a
 * pixel spans.
 */
export function oceanCapCells(
  x: number, z: number, time: number, windX: number, windZ: number, skinOffset: number,
  coverageAt: (x: number, z: number) => number, pixel: number,
): number {
  const qx = (x + skinOffset - windX * OCEAN_CAP_DRIFT) / OCEAN_CAP_CELL;
  const qz = (z + skinOffset - windZ * OCEAN_CAP_DRIFT) / OCEAN_CAP_CELL;
  const cx = Math.floor(qx);
  const cz = Math.floor(qz);
  const hx = glslMod(cx, 512);
  const hz = glslMod(cz, 512);
  const centreX = waterSkinHash(hx + 13, hz) * (1 - 2 * OCEAN_CAP_INSET) + OCEAN_CAP_INSET;
  const centreZ = waterSkinHash(hx, hz + 57) * (1 - 2 * OCEAN_CAP_INSET) + OCEAN_CAP_INSET;
  const atX = (cx + centreX) * OCEAN_CAP_CELL - skinOffset + windX * OCEAN_CAP_DRIFT;
  const atZ = (cz + centreZ) * OCEAN_CAP_CELL - skinOffset + windZ * OCEAN_CAP_DRIFT;
  const { n, frac } = capCycle(time, waterSkinHash(hx, hz));
  const fire = capFires(capCycleHash(hx, hz, n), coverageAt(atX, atZ) / OCEAN_CAP_SHARE);
  const r = Math.hypot(qx - cx - centreX, qz - cz - centreZ) / OCEAN_CAP_RADIUS;
  const cap = fire * (1 - frac) * capProfile(r);
  return mix(cap, coverageAt(x, z), smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / (2 * OCEAN_CAP_RADIUS * OCEAN_CAP_CELL)));
}

/**
 * Tilts a ripple normal so the reflected ray clears WATER_HORIZON: the
 * reflection r is lifted to y = WATER_HORIZON (its xz shortened to keep it
 * unit), and the normal that reflects `view` exactly onto that ray is the
 * half-vector normalize(view + r). One step, no iteration; mirrors
 * waterHorizonNormal in shaders/water.fragment.fx exactly. `view` points
 * from the surface to the eye, above the water.
 */
export function horizonSafeNormal(
  n: readonly [number, number, number],
  view: readonly [number, number, number],
): [number, number, number] {
  const d = -(view[0] * n[0] + view[1] * n[1] + view[2] * n[2]);
  let rx = -view[0] - 2 * d * n[0];
  let ry = -view[1] - 2 * d * n[1];
  let rz = -view[2] - 2 * d * n[2];
  if (ry >= WATER_HORIZON) return [n[0], n[1], n[2]];
  const h = WATER_HORIZON;
  const xz = Math.hypot(rx, rz);
  if (xz < 1e-4) {
    rx = 0; ry = 1; rz = 0;
  } else {
    const s = Math.sqrt(1 - h * h) / xz;
    rx *= s; rz *= s; ry = h;
  }
  const hx = view[0] + rx, hy = view[1] + ry, hz = view[2] + rz;
  const len = Math.hypot(hx, hy, hz);
  return [hx / len, hy / len, hz / len];
}
