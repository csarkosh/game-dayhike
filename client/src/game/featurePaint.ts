/**
 * The made features' paint, evaluated per fragment: meadow grass inside a
 * flat (soft over the rim, exactly the same
 * outward ramp `features.ts`'s `featureMaskAt` blends the vegetation with —
 * the ramp lies OUTSIDE the radius, over `[radius, radius + MEADOW_RIM]`),
 * bare floor on a pond's shore band, and rock above a peak's treeline (a
 * height ramp UP TO the treeline height times a RADIAL FADE over the dome's
 * outer PEAK_RIM_FADE — the mirror of `features.ts`'s own tree-cover term)
 * and on its crest (a distance test near the summit).
 *
 * Up to `FEATURE_PAINT_MAX` features are baked into a small RGBA table —
 * two texel rows: row 0 is (x, z, radius, kindCode) per feature, kindCode 1
 * peak / 2 meadow / 3 pond, 0 empty; row 1's first texel carries the shared
 * constants (treeline height, treeline band, meadow rim, pond shore) and its
 * second the peak's rim fade, the rest zero. `terrainTexture.ts` owns the texture/sampler/uniform plumbing
 * and injects the strings below after its ground blend and the road paint,
 * BEFORE the trail paint — so a trail bed crossing a
 * meadow or pond keeps its own dirt/gravel colour rather than being painted
 * over by the feature's ground class — exactly the way `roadPaint.ts` and
 * `trailPaint.ts` inject their own strings.
 *
 * Pure and Babylon-free (architecture test): GLSL as strings beside the
 * TypeScript table builder, so the tests can pin the packing.
 *
 * COMMENT PROSE IN THE GLSL STRINGS IS NOT INERT — never spell a hashed
 * preprocessor keyword inside a comment there (terrainTexture.ts, note 2).
 */
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import type { Scene } from "@babylonjs/core/scene.js";
import {
  MEADOW_RIM, POND_SHORE, TREELINE_BAND, PEAK_CREST_RADIUS, PEAK_RIM_FADE, treelineOf, type Feature,
} from "../sim/features.js";

/** Up to four features paint the ground (one peak + three loops). */
export const FEATURE_PAINT_MAX = 4;

/** Two texel rows: row 0 = (x, z, radius, kind) per feature, kind 1 peak / 2
 * meadow / 3 pond, 0 = empty; row 1 texel 0 = (treeline height, treeline
 * band, meadow rim, pond shore) and row 1 TEXEL 1 = (PEAK_RIM_FADE, 0, 0, 0)
 * — a free slot in the row the shared constants already live in, read as
 * `fRim.x` by the shader (the peak's radial fade is the
 * fifth shared constant and there was no room left in texel 0). The rest of
 * row 1 is zero. The treeline height is `treelineOf(peak)` — the same
 * function `features.ts` exports for it, rather than a second copy of
 * `crestH - TREELINE_BELOW_CREST`. With NO PEAK among the first
 * `FEATURE_PAINT_MAX` entries the treeline reads
 * 0 and is never used — the rock term only runs for a `kind == peak` entry,
 * and a peak the stem cannot reach reads as no feature at all rather than a
 * height-0 one, so this is now a reachable state rather than a latent one. */
export function featureTable(features: readonly Feature[]): Float32Array {
  const t = new Float32Array(FEATURE_PAINT_MAX * 4 * 2);
  let peak: Feature | undefined;
  features.slice(0, FEATURE_PAINT_MAX).forEach((f, i) => {
    t[i * 4] = f.x; t[i * 4 + 1] = f.z; t[i * 4 + 2] = f.radius;
    t[i * 4 + 3] = f.kind === "peak" ? 1 : f.kind === "meadow" ? 2 : 3;
    if (f.kind === "peak") peak = f;
  });
  const r = FEATURE_PAINT_MAX * 4;
  t[r] = peak === undefined ? 0 : treelineOf(peak); t[r + 1] = TREELINE_BAND; t[r + 2] = MEADOW_RIM; t[r + 3] = POND_SHORE;
  t[r + 4] = PEAK_RIM_FADE;
  return t;
}

/**
 * THE TYPESCRIPT TWIN OF `FEATURE_FRAGMENT_PAINT` — mirror of the GLSL
 * below; the lockstep test is
 * `client/test/game/featurePaint.test.ts`.
 *
 * Earlier tests asserted only on the SHADER'S SOURCE TEXT
 * (`expect(FEATURE_FRAGMENT_PAINT).toContain(...)`), which cannot tell "the
 * ramp runs the right way" from "the ramp runs the right way and has no
 * distance gate" — exactly how a bug survived a source-text-only review.
 * This evaluates the same maths in TypeScript so the tests
 * can measure what the paint actually COVERS, the way
 * `terrainTexture.ts`'s `rockParallaxOffset` mirrors its GLSL march.
 *
 * It reads the same packed table the shader samples — `featureTable` — so the
 * constants cannot drift between the two; only the arithmetic is duplicated,
 * and the GLSL is written line-for-line as this reads. The string assertions
 * stay as the tie between them.
 *
 * The returned weights are the shader's own per-class terms BEFORE the
 * per-class strength the `mix` applies (0.5 meadow, 0.8 shore, 0.85 rock), so
 * a meadow's centre reads 1. Only the WEIGHTS are mirrored: the colour each
 * weight applies is a multiplicative tint of the ground the blend produced,
 * never an absolute colour (the "shiny trail" fix below). Two features of one class compose the way
 * successive `mix`es toward one colour do: `1 - (1 - w1)(1 - w2)`.
 */
export type FeaturePaintWeights = { meadow: number; shore: number; rock: number };

/** GLSL's `smoothstep`: clamped Hermite, identical to `features.ts`'s own. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function featurePaintWeights(
  features: readonly Feature[], x: number, z: number, y: number,
): FeaturePaintWeights {
  const t = featureTable(features);
  const r = FEATURE_PAINT_MAX * 4;
  const fMeta = { x: t[r] as number, y: t[r + 1] as number, z: t[r + 2] as number, w: t[r + 3] as number };
  const fRim = { x: t[r + 4] as number };
  const count = Math.min(features.length, FEATURE_PAINT_MAX);
  let meadow = 0, shore = 0, rock = 0;
  for (let fi = 0; fi < FEATURE_PAINT_MAX; fi++) {
    if (fi >= count) break;
    const f = { x: t[fi * 4] as number, y: t[fi * 4 + 1] as number, z: t[fi * 4 + 2] as number, w: t[fi * 4 + 3] as number };
    const fd = Math.hypot(x - f.x, z - f.y);
    if (f.w > 1.5 && f.w < 2.5) {
      const w = 1 - smoothstep(f.z, f.z + fMeta.z, fd);
      meadow = 1 - (1 - meadow) * (1 - w);
    } else if (f.w > 2.5) {
      const w = 1 - smoothstep(f.z + fMeta.w, f.z + fMeta.w + 2.0, fd);
      shore = 1 - (1 - shore) * (1 - w);
    } else if (f.w > 0.5) {
      const above = smoothstep(fMeta.x - fMeta.y, fMeta.x, y);
      const near = 1 - smoothstep(f.z - fRim.x, f.z, fd);
      const crest = 1 - smoothstep(PEAK_CREST_RADIUS, 40.0, fd);
      const w = Math.max(above * near, crest);
      rock = 1 - (1 - rock) * (1 - w);
    }
  }
  return { meadow, shore, rock };
}

export function createFeatureTexture(scene: Scene, features: readonly Feature[]): RawTexture {
  return RawTexture.CreateRGBATexture(
    featureTable(features), FEATURE_PAINT_MAX, 2, scene,
    false, false, Texture.NEAREST_SAMPLINGMODE, Engine.TEXTURETYPE_FLOAT,
  );
}

/** Declared once, both paths (a sampler cannot live in a UBO); `featureInfo`
 * (the live count) is a plain vec4 and lives beside `trailInfo` in
 * `terrainTexture.ts`'s own UBO list and non-UBO fragment string instead. */
export const FEATURE_FRAGMENT_DEFS = `
#ifdef FEATUREPAINT
uniform sampler2D featureTex;
#endif
`;

/**
 * Injected after the road paint and BEFORE the trail paint inside
 * CUSTOM_FRAGMENT_BEFORE_LIGHTS — so a trail bed crossing
 * a meadow or a pond's shore keeps its own dirt/gravel colour, painted on
 * top by TRAIL_FRAGMENT_PAINT afterwards, rather than losing it to this
 * block's meadow/shore tint. This block reads nothing TRAIL_FRAGMENT_PAINT
 * declares — only `vPositionW`, `surfaceAlbedo`, `vAlbedoColor` (already in
 * scope from Babylon's own PBR fragment body) and this file's own
 * `featureTex`/`featureInfo` — so the two paints are independent regardless
 * of order; only their relative blend priority changes.
 *
 * Reads the table with a fixed loop bound (FEATURE_PAINT_MAX, a compile-time
 * constant) and blends surfaceAlbedo toward the feature's class: meadow
 * grass inside a flat (soft OUTSIDE the radius, over the rim — the same
 * direction `features.ts`'s meadow mask ramps), bare floor on a pond's
 * shore band, rock ramping UP TO a peak's treeline height and staying full
 * above it (the mirror of `features.ts`'s own tree-cover ramp — an earlier
 * version had this backwards: full bare only 60 m ABOVE the
 * treeline, which is above the summit on every reachable profile) TIMES the
 * peak's radial fade, plus a flat disc of rock at the bare crest platform
 * itself (`PEAK_CREST_RADIUS`, a distance test, independent of height).
 *
 * MIRROR OF `featurePaintWeights` ABOVE; the lockstep test is
 * `client/test/game/featurePaint.test.ts`. The two read the same packed
 * table and are written line-for-line the same way, so a change to one that
 * is not made to the other fails a numeric test rather than passing a string
 * one.
 *
 * THE RADIAL FADE IS WHAT MAKES THE ROCK TERM DISC-LOCAL.
 * `above` reads only `vPositionW.y`, so without a distance gate
 * every fragment in the world above the treeline painted rock: measured on
 * one seeded world, the ground 570 m from the peak (and 3 km from it, and
 * 4 km) painted full rock while `featureMask.tree` read 1.00 — kilometres of
 * grey-painted full forest, the render layer assuming a geometry the sim
 * does not have. `near` is character-for-character the fade `featureMaskAt`
 * multiplies its own tree thinning by, from the same PEAK_RIM_FADE in the
 * same table.
 * featureInfo.x is the live feature count, bound alongside the texture by
 * `enableFeatures`.
 *
 * EVERY TERM TINTS THE GROUND IT FINDS; NONE REPLACES IT. An earlier
 * version mixed surfaceAlbedo toward
 * ABSOLUTE colours (a saturated 0.36/0.46/0.20 meadow green, a 0.30/0.25/0.20
 * shore, a 0.42/0.40/0.38 rock) scaled by vAlbedoColor — which is the
 * material's constant white (babylon-valbedocolor-trap), not the vertex
 * colour, so a meadow read +10 green / +5 brighter than the palette's own
 * ground under a green sky and looked like a sheen from below. Now the
 * meadow and the shore are MULTIPLICATIVE tints of whatever the ground blend
 * produced (palette darkness, canopy tint and snow included), and the rock
 * desaturates that colour toward its own luminance and lifts it a tenth —
 * so a peak in the snow stays snow and a meadow keeps its palette.
 */
export const FEATURE_FRAGMENT_PAINT = `
#ifdef FEATUREPAINT
{
  vec4 fMeta = texture2D(featureTex, vec2(0.5 / ${FEATURE_PAINT_MAX}.0, 0.75));
  vec4 fRim = texture2D(featureTex, vec2(1.5 / ${FEATURE_PAINT_MAX}.0, 0.75));
  for (int fi = 0; fi < ${FEATURE_PAINT_MAX}; fi++) {
    if (float(fi) >= featureInfo.x) break;
    vec4 f = texture2D(featureTex, vec2((float(fi) + 0.5) / ${FEATURE_PAINT_MAX}.0, 0.25));
    float fd = length(vPositionW.xz - f.xy);
    if (f.w > 1.5 && f.w < 2.5) {
      float meadow = 1.0 - smoothstep(f.z, f.z + fMeta.z, fd);
      surfaceAlbedo *= mix(vec3(1.0), vec3(0.92, 1.06, 0.82), meadow * 0.5);
    } else if (f.w > 2.5) {
      float shore = 1.0 - smoothstep(f.z + fMeta.w, f.z + fMeta.w + 2.0, fd);
      surfaceAlbedo *= mix(vec3(1.0), vec3(0.85, 0.78, 0.70), shore * 0.8);
    } else if (f.w > 0.5) {
      float above = smoothstep(fMeta.x - fMeta.y, fMeta.x, vPositionW.y);
      float near = 1.0 - smoothstep(f.z - fRim.x, f.z, fd);
      float crest = 1.0 - smoothstep(${PEAK_CREST_RADIUS.toFixed(1)}, 40.0, fd);
      float rock = max(above * near, crest);
      float fLum = dot(surfaceAlbedo, vec3(0.299, 0.587, 0.114));
      surfaceAlbedo = mix(surfaceAlbedo, vec3(fLum) * 1.1, rock * 0.85);
    }
  }
}
#endif
`;
