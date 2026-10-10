import { clamp01, type Rgb } from "./colour.js";

/**
 * The grass floor's arithmetic, Babylon-free: hex tiling of the grass layer
 * (the lattice, the barycentric and sharpened weights), the lattice hash the
 * macro noise is built on, the lush/dry macro tint, and the horizon tint's
 * weight. `shaders/groundHex.fragment.fx` carries the GLSL twins and a
 * lockstep test pins them to these constants; `terrainTexture.ts` binds the
 * uniforms; `clutterMeshes.ts` and `forestMeshes.ts` multiply each card's
 * ground colour by `macroTint` so tuft and floor agree where the ground is
 * grass and inside the relief fade (the paragraph below says where not).
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 *
 * The hex offsets and rotations are hashed on the GPU with a sin hash that is
 * NOT mirrored here: nothing on the CPU needs them. The macro noise IS
 * mirrored, so its hash is a multiply-add-fract on integer cell indices that
 * both sides compute exactly (a sin hash differs across GPUs by more than the
 * tint could hide).
 *
 * The tuft and the ground under it agree only where the code holds that up:
 * on grass ground, inside the 80–140 m relief fade. On non-grass ground the
 * card still carries the tint from `macroTint` but the floor never applies
 * one there, and past the fade the floor's own tint has faded out while the
 * cards keep theirs all the way to their own draw horizon.
 */

/** Lattice cells per texture repeat. 1 = one hex cell is about one repeat. */
export const HEX_LATTICE = 1;
/** Weight sharpening exponent: two of three samples dominate anywhere. */
export const HEX_SHARPNESS = 8;
/** Metres per repeat of the near-eye detail scale of the grass maps. */
export const DETAIL_TILING = 1.0;
/** Distance band (m) over which the detail scale fades out. */
export const DETAIL_FADE: readonly [number, number] = [8, 20];
/** Weight of the detail normal in the perturbation. */
export const DETAIL_NORMAL = 0.5;
/** Between-blades occlusion strength from the detail height. */
export const DETAIL_AO = 0.7;
/** The occlusion curve's input band, against the packed height channel: it is
 * centred on 0.5, so the curve must straddle it to have any contrast. */
export const DETAIL_AO_RANGE: readonly [number, number] = [0.3, 0.7];
/** Macro noise wavelengths (m) and their weights. */
export const MACRO_WAVE: readonly [number, number] = [18, 6];
export const MACRO_WEIGHT: readonly [number, number] = [0.65, 0.35];
/** How far slope pushes the macro toward dry (added to the noise per unit of 1 − n.y). */
export const MACRO_SLOPE = 0.6;
export const MACRO_LUSH: Rgb = { r: 0.82, g: 1.06, b: 0.84 };
export const MACRO_DRY: Rgb = { r: 1.18, g: 0.98, b: 0.7 };
/** The tuft colour the far floor blends toward (linear albedo): the mean
 * albedo a lit tuft card reads at, measured against the far field in the
 * running game, not the card texture's own mean. */
export const TUFT_ALBEDO: Rgb = { r: 0.18, g: 0.22, b: 0.11 };
/** Distance band (m) of the horizon tint, and its cap. */
export const HORIZON: readonly [number, number] = [35, 90];
export const HORIZON_MAX = 0.5;
/** The sward floor: inside the blade field's reach, ground carrying a sward
 * reads as the shaded thatch between the blades (linear albedo) rather than
 * as bare ground. Dark and green-brown, between the blades' own albedo and
 * the grass floor's. */
export const SWARD_FLOOR: Rgb = { r: 0.05, g: 0.065, b: 0.03 };
/** The pull toward SWARD_FLOOR at full cover. */
export const SWARD_MAX = 0.6;
/** The ground cover (the blade field's strength, min(1, grass)) the pull
 * ramps over: nothing where the field stops growing, full from half cover,
 * which every closed canopy's sward is above. */
export const SWARD_COVER: readonly [number, number] = [0.05, 0.5];
/** Eye distance (m) the pull fades out over: gone by the blade field's
 * reach, so the open floor beyond 18 m is unchanged. */
export const SWARD_FADE: readonly [number, number] = [12, 18];

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

/** Only multiplies, adds and fract — but the bound on CPU/GPU agreement is
 * narrower than that suggests. The `0.0113·ci·cj` term must stay exactly
 * representable in float32 for `fract` to land on the same value the CPU's
 * float64 does; that holds for |ci·cj| up to about 1e4 (|c| ≲ 100 in both
 * axes at once). Every scale this world uses stays well inside it — the 6 m
 * octave over the level's extent gives |c| of a few hundred at most in one
 * axis with the other kept small — and past the bound the two sides drift
 * apart gracefully rather than failing outright. */
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

/** One octave of value noise on the lattice hash at wavelength `wave` (m), in
 * [0, 1]. Mirrors macroValueNoise in groundHex.fragment.fx token for token;
 * trailBenchParams.ts shares it at the trail's own wavelengths. */
export function valueNoise2(x: number, z: number, wave: number): number {
  const px = x / wave, pz = z / wave;
  const ci = Math.floor(px), cj = Math.floor(pz);
  const fx = smoothstep(0, 1, px - ci), fz = smoothstep(0, 1, pz - cj);
  const a = latticeHash(ci, cj), b = latticeHash(ci + 1, cj);
  const c = latticeHash(ci, cj + 1), d = latticeHash(ci + 1, cj + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

/** Two octaves at MACRO_WAVE, weighted by MACRO_WEIGHT; in [0, 1]. */
export function macroNoise(x: number, z: number): number {
  return MACRO_WEIGHT[0] * valueNoise2(x, z, MACRO_WAVE[0]) + MACRO_WEIGHT[1] * valueNoise2(x, z, MACRO_WAVE[1]);
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

/** The sward pull at a fragment, mirroring the terrain blend's swardW. */
export function swardWeight(cover: number, dist: number): number {
  return SWARD_MAX * smoothstep(SWARD_COVER[0], SWARD_COVER[1], cover) * (1 - smoothstep(SWARD_FADE[0], SWARD_FADE[1], dist));
}

/*
 * The far ground's cover: past the band where the meadow cards thin out,
 * ground under any cover the near field draws, grass or litter, takes the
 * colour the cover renders at, a clump pattern that shades with the sun, and
 * the cover's own answer to the sun. `shaders/groundFarCover.fragment.fx`
 * carries the GLSL twins and `groundFarCover.test.ts` pins them to these
 * constants. FAR_SELF_SHADOW and FAR_SUN_GAIN_MAX live here and in the sun's
 * line (`terrainTexture.ts`), not in the include.
 */

/** Eye distance (m) the far cover ramps in over on high and medium: from 4 m
 * before the meadow cards begin to dither at 28 m to 2 m into the dither. */
export const FAR_COVER_BAND: readonly [number, number] = [24, 30];
/** The same band on low, where every clutter edge comes at 0.6 of its distance. */
export const FAR_COVER_BAND_LOW: readonly [number, number] = [14.4, 18];
/** The cover key (grass plus litter, clamped) the weight ramps over. */
export const FAR_SWARD_COVER: readonly [number, number] = [0.05, 0.5];
/** The pull toward the far target at full weight. Fitted 2026-10-10: with the
 * pull at 0.8 a fifth of the ground's own colour stays, and at the meadow pose
 * at noon that fifth with the sky's light already matched the card band's
 * luminance, so the colour at its floor met the luminance bar and missed chroma
 * and G/R. At 1.0 the fit lands within 1 % of the band. */
export const FAR_SWARD_MAX = 1;
/** The sward as the cards render it (linear albedo). Fitted 2026-10-10: solved
 * at (0.0066, 0.0235, 0.005) and committed at its +10 % edge for the low sun.
 * At the meadow pose at noon the far crops read Y 0.04177 against the card
 * band's 0.03814, chroma 0.2103 against 0.2128. */
export const FAR_SWARD: Rgb = { r: 0.0073, g: 0.0258, b: 0.0055 };
/** The litter as the near field renders it (linear albedo). Not fitted 2026-10-10:
 * kept at its start, the needle bed (0.15, 0.105, 0.06) × 0.54: the canopy fit
 * reached its target through the canopy shade alone, and the litter share along
 * the far crops was not read from the simulation. */
export const FAR_LITTER: Rgb = { r: 0.081, g: 0.057, b: 0.032 };
/** The target × (1 − FAR_CANOPY_SHADE × ρ), ρ the forest density. Fitted
 * 2026-10-10: at the canopy pose at noon the far crops read Y 0.02630 against
 * the card band's 0.02573. At the canopy pose at 16:00 far over near reached
 * 0.77 with the cut at 0.25 and the colour at its +10 % edge, short of 0.8. The
 * canopy far crops' chroma reads 0.23 of the band's because those crops carry
 * trunks and fog. */
export const FAR_CANOPY_SHADE = 0.4615;
/** The clumps' two octaves: tussocks and patches (m), their shares, and the
 * 3 m octave's lattice offset so the two are not aligned. */
export const FAR_CLUMP_CELL: readonly [number, number] = [0.8, 3];
export const FAR_CLUMP_WEIGHT: readonly [number, number] = [0.6, 0.4];
export const FAR_CLUMP_SALT: readonly [number, number] = [41, 17];
/** Cells per repeat: keeps latticeHash's 0.0113·ci·cj term under 96² = 9,216,
 * inside the 10⁴ where float32 and float64 agree, anywhere in the world. */
export const FAR_CLUMP_WRAP = 97;
/** The clumps' troughs at this share of the target, their crowns at 1. */
export const FAR_CLUMP_AO = 0.65;
/** The clumps' slope per unit of gradient (in cell units). */
export const FAR_CLUMP_TILT = 0.67;
/** How far the cover's normal leans toward the eye, of its horizontal: the
 * meadow cards' mean normal turned to the viewer, 16.7°. */
export const FAR_COVER_TILT = 0.3;
/** The share of the cover's sunlit surface the eye sees with the sun to the
 * side or ahead; all of it with the sun straight behind. Fitted 2026-10-10: at
 * the meadow pose at 16:00 the far crops read Y 0.05725 against the card band's
 * 0.07329, with the self-shadow at its 0.8 ceiling. */
export const FAR_SELF_SHADOW = 0.8;
/** The cap on the cover's gain over the ground's own N·L, where the sun grazes. */
export const FAR_SUN_GAIN_MAX = 2;
/** The specular weight's cut at full weight on dry ground. Fitted 2026-10-10:
 * at the canopy pose at 16:00 far over near is 0.77 at a cut of 0.25. */
export const FAR_SPEC_CUT = 0.25;

/** GLSL's mod: never negative for a positive divisor. */
function glslMod(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

/** GLSL's mix, spelled as GLSL computes it, so a weight of 0 gives `a` exactly. */
function mixNum(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** The far cover's weight in [0, 1] at a fragment: any cover, grass or
 * litter, over the tier's band of eye distance. Mirrors farCoverWeight. */
export function farCoverWeight(cover: number, duff: number, dist: number, low = false): number {
  const band = low ? FAR_COVER_BAND_LOW : FAR_COVER_BAND;
  const key = clamp01(cover + duff);
  return smoothstep(FAR_SWARD_COVER[0], FAR_SWARD_COVER[1], key) * smoothstep(band[0], band[1], dist);
}

/** A clump octave or the two together: the value and its gradient in cell units. */
export type FarClump = { n: number; gx: number; gz: number };

/** One octave: value in [0, 1] and its gradient in cell units. The wrap is
 * GLSL's mod, never negative. Mirrors farClumpOctave term for term. */
export function farClumpOctave(x: number, z: number, cell: number, salt: readonly [number, number]): FarClump {
  const qx = x / cell, qz = z / cell;
  const cx = Math.floor(qx), cz = Math.floor(qz);
  const fx = qx - cx, fz = qz - cz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const dux = 6 * fx * (1 - fx), duz = 6 * fz * (1 - fz);
  const c0x = glslMod(cx + salt[0], FAR_CLUMP_WRAP), c0z = glslMod(cz + salt[1], FAR_CLUMP_WRAP);
  const c1x = glslMod(cx + salt[0] + 1, FAR_CLUMP_WRAP), c1z = glslMod(cz + salt[1] + 1, FAR_CLUMP_WRAP);
  const a = latticeHash(c0x, c0z), b = latticeHash(c1x, c0z);
  const d = latticeHash(c0x, c1z), e = latticeHash(c1x, c1z);
  const k = a - b - d + e;
  return {
    n: a + (b - a) * ux + (d - a) * uz + k * ux * uz,
    gx: dux * (b - a + k * uz),
    gz: duz * (d - a + k * ux),
  };
}

/** The two octaves band-limited by the pixel footprint `foot` (m): each faded
 * to its mean, value 0.5 and gradient 0, where its cell spans under two
 * pixels. Mirrors farClump. */
export function farClump(x: number, z: number, foot: number): FarClump {
  const o1 = farClumpOctave(x, z, FAR_CLUMP_CELL[0], [0, 0]);
  const o2 = farClumpOctave(x, z, FAR_CLUMP_CELL[1], FAR_CLUMP_SALT);
  const b1 = FAR_CLUMP_WEIGHT[0] * (1 - smoothstep(0.5, 1, foot / FAR_CLUMP_CELL[0]));
  const b2 = FAR_CLUMP_WEIGHT[1] * (1 - smoothstep(0.5, 1, foot / FAR_CLUMP_CELL[1]));
  return {
    n: 0.5 + b1 * (o1.n - 0.5) + b2 * (o2.n - 0.5),
    gx: b1 * o1.gx + b2 * o2.gx,
    gz: b1 * o1.gz + b2 * o2.gz,
  };
}

/** The far target before the pull: the sward and the litter mixed by the
 * litter weight, times the macro tint, the canopy's shade by ρ (`canopy`) and
 * the clumps' trough darkening by the clump value. Mirrors the fcTarget lines
 * of the terrain's far block. */
export function farCoverTarget(duff: number, canopy: number, macro: Rgb, clump: number): Rgb {
  const l = clamp01(duff);
  const shade = 1 - FAR_CANOPY_SHADE * clamp01(canopy);
  const ao = mixNum(FAR_CLUMP_AO, 1, clump);
  return {
    r: mixNum(FAR_SWARD.r, FAR_LITTER.r, l) * macro.r * shade * ao,
    g: mixNum(FAR_SWARD.g, FAR_LITTER.g, l) * macro.g * shade * ao,
    b: mixNum(FAR_SWARD.b, FAR_LITTER.b, l) * macro.b * shade * ao,
  };
}

/** The sun's diffuse factor on the far cover: mix(1, gain × visibility, w),
 * the gain the cover normal's N·L over the ground's own (`groundNdotL`, never
 * 0 in the shader: Babylon's saturateEps), capped at FAR_SUN_GAIN_MAX, the
 * visibility mix(FAR_SELF_SHADOW, 1, V·L). Mirrors the sun's line in
 * `terrainTexture.ts`. */
export function farSunFactor(coverNdotL: number, groundNdotL: number, vDotL: number, w: number): number {
  const gain = Math.min(clamp01(coverNdotL) / groundNdotL, FAR_SUN_GAIN_MAX);
  const seen = mixNum(FAR_SELF_SHADOW, 1, clamp01(vDotL));
  return mixNum(1, gain * seen, w);
}

/** The specular weight: 1 − FAR_SPEC_CUT × w × (1 − wet). Mirrors
 * terrainSpecW in `terrainTexture.ts`. */
export function farSpecWeight(w: number, wet: number): number {
  return 1 - FAR_SPEC_CUT * w * (1 - wet);
}
