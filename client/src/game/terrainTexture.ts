/**
 * Ground textures for the terrain. The clipmap
 * writes per-vertex material weights; this plugin turns them into a tiled
 * texture blend multiplied over the palette colour the vertex already carries.
 *
 * Renderer-only by construction: no constant here may migrate into sim/, and
 * none is a level-id tunable — the ground looking different must never make two
 * peers disagree about the world.
 *
 * Projection: planar XZ for grass, forest floor, sand and pebble,
 * which are gated onto gentle ground where an XZ projection has no meaningful
 * distortion; triplanar for rock alone, which is the one layer that lives on
 * cliff faces.
 *
 * Relief: near the eye, `groundMaps.ts`'s two
 * texture arrays (`terrainNormals`, tangent-space; `terrainRAH` = roughness /
 * AO / height) add per-texel normal perturbation, a height-aware reblend of
 * the six layer weights, and per-fragment roughness/F0 on top of the flat
 * palette shading above. Both arrays are always bound — never gated on
 * ROADPAINT — because the ground blend they feed runs whether or not this
 * world has a road. `terrainRough`/`terrainF0` are read back into the PBR
 * reflectivity block through a regex custom-code key (the only hook that can
 * reach `vReflectivityColor`'s inputs before the BRDF consumes them).
 *
 * The road is a sixth layer, injected AFTER the five
 * above and gated on its own ROADPAINT define: a 1-D centerline table
 * (`roadCenter`) and an asphalt texture (`roadAsphalt`) sampled in the road's
 * own (u, z) frame, painted per fragment at exact resolution regardless of
 * distance, including its own slice of the normal/RAH arrays. Twelve samplers
 * total on the material (five ground layers, the two relief arrays, asphalt,
 * the centerline table, plus the PBR environment, BRDF and shadow samplers) —
 * inside WebGL2's sixteen. Road-less variants (no `roadCenterX` hook) leave
 * ROADPAINT false and never register the two road-only samplers, so they
 * compile today's shader unchanged.
 *
 * The grass floor is the one layer that is not plainly tiled. Grass is what
 * most of the ground is, so its 2 m repeat reads as a printed grid the moment
 * the eye is above it: `shaders/groundHex.fragment.fx` breaks that up by
 * sampling the grass albedo and its two relief slices through a triangular
 * lattice — three fetches at hashed offsets and rotations, blended by
 * sharpened barycentric weights — so the repeat exists but no line of it does.
 * The lattice and its hashed uvs are computed ONCE per scale (`hexSetup`) and
 * handed to each fetcher, not recomputed per map. On top of that, a second
 * grass scale at DETAIL_TILING fades in within DETAIL_FADE of the eye, adding
 * blade-level normal and between-blade occlusion where the eye can resolve
 * them and costing nothing past the fade. Two tints finish it: a
 * lush/dry macro noise over tens of metres (mirrored on the CPU in
 * `groundHexParams.ts`, so `clutterMeshes.ts` tints each tuft to match by
 * construction), and a pull toward TUFT_ALBEDO past HORIZON, where the floor
 * should read as the same vegetation the clutter thins out of rather than as
 * bare palette.
 *
 * No parallax on grass, deliberately: the rock march below works because stone
 * is a rigid surface whose height field is the shape. Grass height is blades,
 * and marching an eye ray through them drags the texture sideways as the
 * player walks — the warping-underfoot defect the rock depth had to be capped
 * to cure. The detail scale's normal and occlusion buy the same depth cue
 * without moving a texel.
 *
 * The multiply is normalised by TEXTURE_MEAN, the mean luminance every layer was
 * normalised to when the texture was made, so a flat texture
 * is exactly neutral and the palette's tuning survives.
 *
 * GLSL only. The injected code below is hand-written GLSL ES, and the base
 * class's `isCompatible` accepts GLSL alone, so attaching this to a WGSL
 * material would throw from `_addPlugin` rather than render wrongly. Nothing in
 * this project constructs a WebGPU engine, so that path is unreachable today.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Nullable } from "@babylonjs/core/types.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";

import { activeTerrainVariant } from "../sim/terrain.js";
import {
  ROAD_FRAGMENT_DEFS, ROAD_FRAGMENT_PAINT, ROAD_TABLE_N, ROAD_TABLE_STEP,
  buildRoadTable, roadTableStale, roadTableZ0, type RoadCenterX,
} from "./roadPaint.js";
import {
  TRAIL_FRAGMENT_DEFS, TRAIL_FRAGMENT_PAINT, TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_GRID, TRAIL_PAINT_BUCKET,
  buildTrailTable, trailSegments,
} from "./trailPaint.js";
import {
  FEATURE_FRAGMENT_DEFS, FEATURE_FRAGMENT_PAINT, FEATURE_PAINT_MAX, createFeatureTexture,
} from "./featurePaint.js";
import type { TrailGraph } from "../sim/trail.js";
import type { Feature } from "../sim/features.js";
import { loadGroundArrays, type GroundArrays, type GroundArraysFactory } from "./groundMaps.js";
import {
  DETAIL_TILING, DETAIL_FADE, DETAIL_NORMAL, DETAIL_AO, DETAIL_AO_RANGE,
  HORIZON, HORIZON_MAX, TUFT_ALBEDO,
} from "./groundHexParams.js";
import groundHexFx from "./shaders/groundHex.fragment.fx?raw";

import grassUrl from "../../assets/textures/ground.grass.webp?url";
import floorUrl from "../../assets/textures/ground.forest_floor.webp?url";
import rockUrl from "../../assets/textures/ground.rock.webp?url";
import sandUrl from "../../assets/textures/ground.sand.webp?url";
import pebbleUrl from "../../assets/textures/ground.pebble.webp?url";
import asphaltUrl from "../../assets/textures/ground.asphalt.webp?url";

/** Mean luminance every ground texture was normalised to when it was made.
 * Measured back off the five committed WebPs as
 * 0.4984 / 0.4985 / 0.4983 / 0.4980 / 0.4981 — the encode's rounding, not a
 * different target. Dividing the blend by this makes a flat texture exactly
 * neutral, so the palette keeps its tuning. */
const TEXTURE_MEAN = 0.5;

/**
 * Each ground albedo's own mean COLOUR, measured off the committed 512² WebPs
 * (`client/test/game/groundMeans.test.ts` recomputes them and fails if a
 * rebuilt texture drifts). Each layer was scaled by ONE scalar
 * gain until its mean over R, G and B is TEXTURE_MEAN, which neutralises
 * luminance but NOT chroma: grass lands at (0.61, 0.53, 0.36) and forest floor
 * at (0.65, 0.49, 0.35), both strongly warm. Dividing the blend by the scalar
 * therefore left a tan cast multiplying the palette — a grass field's dark
 * green (0.09, 0.15, 0.06) rendered as olive dirt, which is why bare ground
 * beyond the clutter discs read as dirt and stone rather than as field.
 * Dividing each layer by its OWN mean makes a flat
 * texture exactly neutral in colour as well as brightness: the texture
 * contributes variation, the palette decides the hue.
 */
export const LAYER_MEAN_RGB: Readonly<Record<"grass" | "floor" | "rock" | "sand" | "pebble", readonly [number, number, number]>> = {
  grass: [0.608, 0.529, 0.358],
  floor: [0.647, 0.495, 0.353],
  rock: [0.540, 0.506, 0.449],
  sand: [0.587, 0.512, 0.395],
  pebble: [0.541, 0.497, 0.457],
};

/** A GLSL float literal with a decimal point, whatever the value. */
function f2(n: number): string { return Number.isInteger(n) ? n.toFixed(1) : String(n); }

/** `vec3` of 1/mean for one layer, for the blend above. */
function meanInv(layer: keyof typeof LAYER_MEAN_RGB): string {
  const m = LAYER_MEAN_RGB[layer];
  return `vec3(${(1 / m[0]).toFixed(4)}, ${(1 / m[1]).toFixed(4)}, ${(1 / m[2]).toFixed(4)})`;
}

/**
 * Metres of world per texture repeat, per layer. These are each source
 * texture's own recorded real-world footprint (grass 2.00 m,
 * forest floor 2.07 m, rock 1.80 m, sand 1.80 m, pebble 2.00 m): tiled at its
 * own size, each texture renders at that real-world size. Measured,
 * not guessed — the original 2/2/3/3/4 values were pre-survey estimates. Retuned by eye
 * in the running game.
 *
 * `asphalt` is its own 3.00 m footprint. It tiles in the road's own (u, z) frame — signed u across the
 * centerline, world z along it — not world XZ like the five layers above.
 */
const TILING_METRES = { grass: 2.0, floor: 2.07, rock: 1.8, sand: 1.8, pebble: 2.0, asphalt: 3.0 };

/** Distance band (m) over which the detail fades to the flat palette colour.
 * Design values ("faded to the flat palette beyond ~80 m"), tuned
 * by eye in the running game; they buy back fragment cost at range where the
 * texture is below a pixel anyway. */
const FADE_START = 80;
const FADE_END = 140;

/** Six values, grass/floor/rock/sand/pebble/asphalt in order — a fixed-length
 * tuple rather than a plain `readonly number[]` because this repo's
 * tsconfig sets `noUncheckedIndexedAccess`: a plain array's index type is
 * `number | undefined`, which would not typecheck at `bindForSubMesh`'s
 * `LAYER_ROUGHNESS[0..5]`. `toEqual` in the test does not care either way. */
type LayerSix = readonly [number, number, number, number, number, number];
/** Per-layer base roughness, grass, floor, rock, sand, pebble,
 * asphalt — the far-field value, and still the base near the eye: the RAH
 * map there is a MODULATION on top of it (map / 0.5, its neutral value),
 * not a replacement, so a flat 0.5 placeholder (or a failed decode) leaves
 * this table's value exactly as the near-field answer too (an earlier
 * R/0.95-replaces-R form flashed every layer to ~0.5
 * roughness until the WebPs decoded). */
export const LAYER_ROUGHNESS: LayerSix = [1.0, 1.0, 0.85, 0.95, 0.9, 0.9];
/** Per-layer F0 multiplier on the dielectric 4%: rough
 * vegetation and soil self-occlude grazing reflection; this is the sheen's
 * cure and it is NOT distance-faded. */
export const LAYER_F0: LayerSix = [0.5, 0.5, 1.0, 0.7, 0.85, 1.0];
/** Height-blend depth: how far below the tallest layer another still shows. */
export const HEIGHT_BLEND_DEPTH = 0.2;
/** Mirror of the GLSL height blend, for the test. `reliefOn` mirrors the
 * shader's `terrainReliefOn` uniform: at 1 (the default)
 * this returns the height-blended weights exactly as before; at 0 it
 * `mix`es back to the plain input weights `w`, unchanged, the same way
 * `b0 = mix(w0, b0 / bs, terrainReliefOn)` does in TERRAIN_FRAGMENT_BLEND. */
export function heightBlendWeights(w: number[], h: number[], reliefOn = 1, depth = HEIGHT_BLEND_DEPTH): number[] {
  const m = Math.max(...w.map((wi, i) => wi + (h[i] ?? 0.5))) - depth;
  const b = w.map((wi, i) => Math.max(wi + (h[i] ?? 0.5) - m, 0));
  const s = b.reduce((a, x) => a + x, 0);
  return w.map((wi, i) => wi + ((b[i] ?? 0) / s - wi) * reliefOn);
}

/**
 * Parallax occlusion for the rock layer (steep faces
 * read as a cobble decal on a smooth mesh). The rock layer already ships a
 * height in `terrainRAH` layer 2's blue channel (mean-normalised to 0.5, 1 at
 * the top of the stones), so the fragment can march the eye ray down through
 * it and sample the rock where the ray actually meets stone. Only the
 * DOMINANT triplanar projection is marched — the two minority faces keep
 * their flat samples — and only on fragments carrying rock weight, inside the
 * detail fade, so the cost lands on cliffs and scree and nowhere else.
 * ROCK_PARALLAX_DEPTH is the height range in metres; per projection it
 * becomes depth × repeats-per-metre in that face's uv.
 */
export const ROCK_PARALLAX_DEPTH = 0.03;
export const ROCK_PARALLAX_STEPS = 12;
export const ROCK_PARALLAX_MIN_WEIGHT = 0.05;
/**
 * OFFSET LIMITED (Welsh 2004), and shallow. The first version marched the ray
 * at its true slope, depth/|view·normal|, with a grazing fade: at walking
 * distance that dragged the texture about a stone's width and changed the
 * drag by a third of a stone per metre walked, and the fade made the drag
 * peak at ~4 m and turn back — walking through it showed the rock warping underfoot, and at
 * 0.12 m the twelve depth layers showed as stair-stepped streaks on every
 * stone (2026-09-10). Now the march spans depth·|in-plane direction| — never
 * more than the relief itself, monotonic as the ground recedes, no fade to
 * fold it back — and the depth is 3 cm, a fifth of a 0.15-0.25 m stone.
 */

/**
 * Mirror of the GLSL march, for the tests. `height(u, v)` is the rock height
 * at a uv OFFSET from the fragment (1 = surface, 0 = deepest); `dirAb` and
 * `dirC` are the eye→fragment ray's in-plane and along-normal components;
 * `depthUv` is the height range in this projection's uv units. Returns the
 * uv offset at which the ray meets the surface: ROCK_PARALLAX_STEPS equal
 * depth layers, then one linear refinement between the last two samples.
 */
export function rockParallaxOffset(
  height: (u: number, v: number) => number,
  dirAb: readonly [number, number],
  dirC: number,
  depthUv: number,
): [number, number] {
  void dirC; // offset limited: the along-normal component no longer scales the march
  const stepU = dirAb[0] * depthUv / ROCK_PARALLAX_STEPS;
  const stepV = dirAb[1] * depthUv / ROCK_PARALLAX_STEPS;
  const layer = 1 / ROCK_PARALLAX_STEPS;
  let u = 0, v = 0, depth = 0;
  let prevDiff = 0 - (1 - height(0, 0)); // ray depth minus surface depth at the start
  if (prevDiff >= 0) return [0, 0];
  for (let i = 0; i < ROCK_PARALLAX_STEPS; i++) {
    const nu = u + stepU, nv = v + stepV, nd = depth + layer;
    const diff = nd - (1 - height(nu, nv));
    if (diff >= 0) {
      // Linear refinement between (u, prevDiff) and (nu, diff).
      const t = prevDiff / (prevDiff - diff);
      return [u + stepU * t, v + stepV * t];
    }
    u = nu; v = nv; depth = nd; prevDiff = diff;
  }
  return [u, v];
}

/**
 * Declarations for both stages.
 *
 * ── How Babylon 9.18 actually treats the strings in this file ──
 *
 * Plugin custom code is handed to the shader pipeline as
 * `processCodeAfterIncludes` (pbrBaseMaterial.pure.js:1193-1194), and `Process`
 * calls that hook immediately after include resolution and BEFORE
 * `ProcessShaderConversion` (shaderProcessor.js:31-37). So everything below is
 * ordinary shader source as far as the engine is concerned: it is fully
 * preprocessed and fully migrated.
 *
 * Two consequences, both load-bearing:
 *
 * 1. WRITE PLAIN GLSL ES 1.00 — `attribute`, `varying`, `texture2D(...)` — the
 *    same dialect every Babylon core shader is written in. On a WebGL2 context
 *    the processor migrates it: `attribute`/`varying` at the node level
 *    (shaderCodeNode.js:28-33 dispatching to webGL2ShaderProcessors.js's
 *    `attributeProcessor`/`varyingProcessor`) and `texture2D(`→`texture(` in
 *    that same file's `postProcessor`. Hand-writing the GLSL ES 3.00 spelling
 *    would be redundant at best; `terrainTexture.test.ts` runs these very
 *    strings through the real `Process()` and asserts the migrated output.
 *
 * 2. COMMENT PROSE IN THESE STRINGS IS NOT INERT. The preprocessor is
 *    line-based: `MoveCursorRegex` (shaderProcessor.js:20) matches a hashed
 *    conditional keyword ANYWHERE in a line, and `ShaderCodeCursor` passes
 *    `//` lines through verbatim (shaderCodeCursor.js:26-29). A comment that
 *    merely spells one is therefore parsed as a real directive and swallows
 *    every line up to the next real endif. That is not hypothetical — it ate
 *    this file's triplanar rock branch once already, and it ate a shader
 *    before that. So: never spell a hashed preprocessor keyword inside a
 *    GLSL comment here. Same rule for every `.fx` file in the repo, enforced
 *    by `client/test/game/shaderHygiene.test.ts`, and `terrainTexture.test.ts`
 *    enforces it again for every string this plugin injects. (TypeScript
 *    comments like this one are outside the template literals and never
 *    reach the shader, so they are free to name the directives.)
 *
 * 3. The samplers are declared here rather than through `getUniforms().fragment`
 *    because that string lands at `#define ADDITIONAL_FRAGMENT_DECLARATION`,
 *    which exists only in `pbrFragmentDeclaration` — the NON-uniform-buffer
 *    path. With UBOs supported (every WebGL2 context) `__decl__pbrFragment`
 *    resolves to `pbrUboDeclaration` instead, which carries only
 *    `ADDITIONAL_UBO_DECLARATION`, and samplers cannot live in a UBO. The
 *    scalar uniforms are declared both ways for exactly that reason: the `ubo`
 *    list covers the UBO path, the `fragment` string covers the other.
 */
const TERRAIN_FRAGMENT_DEFS = `
#ifdef TERRAINTEX
varying vec4 vTerrainW;
varying vec2 vTerrainW2;
uniform sampler2D terrainGrass;
uniform sampler2D terrainFloor;
uniform sampler2D terrainRock;
uniform sampler2D terrainSand;
uniform sampler2D terrainPebble;
// highp is required, not decorative: GLSL ES 3.00 has no default fragment
// precision for sampler2DArray, so omitting it is a compile error on real
// WebGL2 ("'sampler2DArray' : No precision specified") that NullEngine's
// string-only preprocessor can never see. Babylon's own array-sampler code
// uses highp for the same reason.
uniform highp sampler2DArray terrainNormals;
uniform highp sampler2DArray terrainRAH;
#endif
`;

/**
 * The hex/macro/horizon GLSL, spliced straight after the declarations above and
 * gated with them. The gate is load-bearing: `horizonWeight` reads
 * `terrainHorizon`, which only exists inside the TERRAINTEX block (in the UBO
 * on one path, in `getUniforms().fragment` on the other), so an ungated include
 * would not compile wherever this plugin's define is off.
 */
const TERRAIN_HEX_DEFS = `
#ifdef TERRAINTEX
${groundHexFx}
#endif
`;

const TERRAIN_VERTEX_DEFS = `
#ifdef TERRAINTEX
attribute vec4 terrainWeights;
attribute vec2 terrainWeights2;
varying vec4 vTerrainW;
varying vec2 vTerrainW2;
#endif
`;

/** A ring that never got the attributes uploaded reads the WebGL default
 * (0, 0, 0, 1) for a vec4 and (0, 0) for a vec2, so `vTerrainW2.y` — the
 * detail strength — is 0: albedo, normal perturbation and AO are all true
 * no-ops there (every `mix(..., strength)` collapses to the untouched
 * value). Roughness/F0 are the one exception — they run
 * outside that `strength` gate, and the default reads as pure sand (w3 = 1,
 * every other class weight 0), so such a ring's roughness/F0 land on sand's
 * table values (0.95, 0.7) rather than doing nothing. Harmless: this plugin
 * only ever attaches to the terrain mesh, and every real ring does carry the
 * attributes — failing to flat palette is still the right failure here. */
const TERRAIN_VERTEX_MAIN_END = `
#ifdef TERRAINTEX
vTerrainW = terrainWeights;
vTerrainW2 = terrainWeights2;
#endif
`;

/** Unconditional: the reflectivity-block regex rewrite below references these
 * locals whatever the defines say, so a define-guarded declaration (which
 * would compile in only one define state) is not an option. */
const TERRAIN_FRAGMENT_MAIN_BEGIN = `
float terrainRough = 1.0;
float terrainF0 = 1.0;
`;

const TERRAIN_FRAGMENT_BLEND = `
#ifdef TERRAINTEX
{
  vec2 uvXZ = vPositionW.xz;
  vec2 uvG = uvXZ * terrainTiling.x;
  vec2 uvF = uvXZ * terrainTiling.y;
  vec2 uvS = uvXZ * terrainTiling.z;
  vec2 uvP = uvXZ * terrainTiling.w;
  // Gradients of the UNROTATED uv, and the lattice they index, computed once
  // per scale: a hex seam then changes which texel is fetched but not the mip
  // level, so no seam shows as a blur line. Both pairs are taken here, in
  // uniform control flow, rather than inside the gates that use them —
  // a derivative taken in non-uniform flow is undefined by the spec.
  vec2 gdx = dFdx(uvG); vec2 gdy = dFdy(uvG);
  vec2 uvD = uvXZ * terrainDetail.x;
  vec2 ddx = dFdx(uvD); vec2 ddy = dFdy(uvD);
  // The 2 m hex lattice is grass-only work: gated on the raw vertex weight so
  // non-grass ground never pays for a lattice walk and three hashed fetches.
  vec2 g1 = vec2(0.0); vec2 g2 = vec2(0.0); vec2 g3 = vec2(0.0); vec3 gw = vec3(0.0);
  if (vTerrainW.x > 0.0) {
    hexSetup(uvG, g1, g2, g3, gw);
  }
  float rt = terrainRock2.x;
  vec3 terrainN = vec3(0.0, 1.0, 0.0);
#ifdef NORMAL
  terrainN = normalize(vNormalW);
#endif
  vec3 an = abs(terrainN);
  vec3 bw = an / max(an.x + an.y + an.z, 1e-4);
  float dist = distance(vPositionW.xyz, terrainEye);
  float strength = vTerrainW2.y * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist));

  // Plain weights (today's blend) — grass, floor, rock, sand, pebble.
  float w0 = vTerrainW.x; float w1 = vTerrainW.y; float w2 = vTerrainW.z; float w3 = vTerrainW.w; float w4 = vTerrainW2.x;
  vec3 rah0 = vec3(0.5, 1.0, 0.5); vec3 rah1 = rah0; vec3 rah2 = rah0; vec3 rah3 = rah0; vec3 rah4 = rah0;
  vec3 nrm = terrainN;
  // Declared out here so the AO line below still compiles — and stays a true
  // no-op — on fragments where the relief gate never runs.
  float detailAo = 1.0;
  // Rock parallax: march the eye ray through the rock height on the dominant
  // triplanar face. The three offsets start at zero and only the dominant
  // face's moves, so the minority faces stay flat.
  vec2 rpX = vec2(0.0); vec2 rpY = vec2(0.0); vec2 rpZ = vec2(0.0);
  if (strength > 0.0 && w2 > ${f2(ROCK_PARALLAX_MIN_WEIGHT)}) {
    vec3 rDir = normalize(vPositionW.xyz - terrainEye);
    float rDepth = ${f2(ROCK_PARALLAX_DEPTH)} * rt;
    vec2 rAb; vec2 rUv;
    if (bw.y >= bw.x && bw.y >= bw.z) { rAb = rDir.xz; rUv = vPositionW.xz * rt; }
    else if (bw.x >= bw.z) { rAb = rDir.yz; rUv = vPositionW.yz * rt; }
    else { rAb = rDir.xy; rUv = vPositionW.xy * rt; }
    vec2 rStep = rAb * rDepth / ${ROCK_PARALLAX_STEPS}.0;
    float rLayer = 1.0 / ${ROCK_PARALLAX_STEPS}.0;
    vec2 rOff = vec2(0.0); float rD = 0.0;
    float rPrev = -(1.0 - texture2D(terrainRAH, vec3(rUv, 2.0)).b);
    bool rHit = rPrev >= 0.0;
    for (int ri = 0; ri < ${ROCK_PARALLAX_STEPS}; ri++) {
      if (rHit) break;
      vec2 nOff = rOff + rStep; float nD = rD + rLayer;
      float rDiff = nD - (1.0 - texture2D(terrainRAH, vec3(rUv + nOff, 2.0)).b);
      if (rDiff >= 0.0) { float rT = rPrev / (rPrev - rDiff); rOff = rOff + rStep * rT; rHit = true; }
      else { rOff = nOff; rD = nD; rPrev = rDiff; }
    }
    // Fade the offset with the detail strength so the far edge of the fade
    // has no seam, then hand it to the dominant face.
    rOff *= strength;
    if (bw.y >= bw.x && bw.y >= bw.z) rpY = rOff; else if (bw.x >= bw.z) rpX = rOff; else rpZ = rOff;
  }
  if (strength > 0.0) {
    // The height blend below can hand grass a nonzero share even where its
    // vertex weight is zero: wherever the other layers split the weight and
    // a grass texel's height tops theirs, b0 comes out positive. So every
    // grass term needs a real value here — the hex is skipped only because a
    // single plain fetch is enough for a share this small.
    if (vTerrainW.x > 0.0) {
      rah0 = hexFetchArray(terrainRAH, g1, g2, g3, gw, 0.0, gdx, gdy);
    } else {
      rah0 = textureGrad(terrainRAH, vec3(uvG, 0.0), gdx, gdy).rgb;
    }
    rah1 = texture2D(terrainRAH, vec3(uvF, 1.0)).rgb;
    rah2 = texture2D(terrainRAH, vec3(vPositionW.xz * rt + rpY, 2.0)).rgb;
    rah3 = texture2D(terrainRAH, vec3(uvS, 3.0)).rgb;
    rah4 = texture2D(terrainRAH, vec3(uvP, 4.0)).rgb;
    // Height blend: the tallest layer within the depth constant
    // below still shows through.
    float m = max(max(w0 + rah0.b, w1 + rah1.b), max(max(w2 + rah2.b, w3 + rah3.b), w4 + rah4.b)) - ${HEIGHT_BLEND_DEPTH.toFixed(3)};
    float b0 = max(w0 + rah0.b - m, 0.0); float b1 = max(w1 + rah1.b - m, 0.0); float b2 = max(w2 + rah2.b - m, 0.0);
    float b3 = max(w3 + rah3.b - m, 0.0); float b4 = max(w4 + rah4.b - m, 0.0);
    float bs = max(b0 + b1 + b2 + b3 + b4, 1e-4);
    // terrainReliefOn: 0 until the real RAH array has
    // landed, so a flat placeholder height (equal on every layer) can never
    // sharpen the class weights into hard edges the way the raw formula
    // above would (0.5/0.3/0.2 -> 1/0/0). With it 0, b collapses back to w
    // before the strength fade below ever runs.
    b0 = mix(w0, b0 / bs, terrainReliefOn); b1 = mix(w1, b1 / bs, terrainReliefOn); b2 = mix(w2, b2 / bs, terrainReliefOn);
    b3 = mix(w3, b3 / bs, terrainReliefOn); b4 = mix(w4, b4 / bs, terrainReliefOn);
    w0 = mix(w0, b0, strength); w1 = mix(w1, b1, strength); w2 = mix(w2, b2, strength);
    w3 = mix(w3, b3, strength); w4 = mix(w4, b4, strength);
    // Normals, UDN-style: the map's xy is added to the world normal in the
    // projection's frame. Planar layers: uv is world XZ, so x -> X, y -> Z.
    vec3 t0;
    if (vTerrainW.x > 0.0) {
      t0 = hexFetchArray(terrainNormals, g1, g2, g3, gw, 0.0, gdx, gdy) * 2.0 - 1.0;
    } else {
      t0 = textureGrad(terrainNormals, vec3(uvG, 0.0), gdx, gdy).rgb * 2.0 - 1.0;
    }
    vec3 t1 = texture2D(terrainNormals, vec3(uvF, 1.0)).rgb * 2.0 - 1.0;
    vec3 t3 = texture2D(terrainNormals, vec3(uvS, 3.0)).rgb * 2.0 - 1.0;
    vec3 t4 = texture2D(terrainNormals, vec3(uvP, 4.0)).rgb * 2.0 - 1.0;
    vec3 tx = texture2D(terrainNormals, vec3(vPositionW.yz * rt + rpX, 2.0)).rgb * 2.0 - 1.0;
    vec3 ty = texture2D(terrainNormals, vec3(vPositionW.xz * rt + rpY, 2.0)).rgb * 2.0 - 1.0;
    vec3 tz = texture2D(terrainNormals, vec3(vPositionW.xy * rt + rpZ, 2.0)).rgb * 2.0 - 1.0;
    vec2 planar = t0.xy * w0 + t1.xy * w1 + t3.xy * w3 + t4.xy * w4;
    // The near-eye detail scale: the same grass maps at DETAIL_TILING, hex
    // tiled again so the small repeat does not draw its own grid either. Gated
    // on grass weight AND its own fade, inside the relief gate, so the two
    // extra fetches land on grass within DETAIL_FADE of the eye and nowhere
    // else — and on terrainReliefOn, since a flat placeholder normal/height
    // would only add noise. The finer scale adds a normal and a
    // between-blades occlusion; an albedo term was tried and could not be
    // seen with these maps, so it is not fetched.
    float detailStrength = w0 * (1.0 - smoothstep(terrainDetail.y, terrainDetail.z, dist)) * terrainReliefOn;
    if (detailStrength > 0.0) {
      vec2 d1; vec2 d2; vec2 d3; vec3 dw;
      hexSetup(uvD, d1, d2, d3, dw);
      vec3 tD = hexFetchArray(terrainNormals, d1, d2, d3, dw, 0.0, ddx, ddy) * 2.0 - 1.0;
      planar += tD.xy * terrainDetail.w * detailStrength;
      float hD = hexFetchArray(terrainRAH, d1, d2, d3, dw, 0.0, ddx, ddy).b;
      detailAo = mix(1.0, smoothstep(terrainDetail2.y, terrainDetail2.z, hD), terrainDetail2.x * detailStrength);
    }
    // Rock's X-facing projection samples vPositionW.yz, so the map's x runs
    // along world Y and its y along world Z: x,y order,
    // same rule as the other two faces (ty samples xz -> x,y; tz samples
    // xy -> x,y).
    vec3 pert = vec3(planar.x, 0.0, planar.y)
      + w2 * (vec3(0.0, tx.x, tx.y) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z);
    nrm = normalize(terrainN + pert * strength);
    // Written here, inside the gate, not unconditionally below: when strength
    // is 0 this branch never runs at all, so Babylon's own normalW is left
    // exactly as it was rather than being overwritten with terrainN, which
    // contributes nothing new in that case.
    normalW = nrm;
  }

  // Same story as the relief fetch above: the height blend can still hand
  // grass a nonzero share here even at zero vertex weight, wherever the
  // other layers split the weight and a grass texel's height tops theirs, so
  // this needs a real value too — one plain fetch is enough for a share
  // this small, without paying for the three-tap hex.
  vec3 grassAlbedo;
  if (vTerrainW.x > 0.0) { grassAlbedo = hexFetch2D(terrainGrass, g1, g2, g3, gw, gdx, gdy) * ${meanInv("grass")}; }
  else { grassAlbedo = textureGrad(terrainGrass, uvG, gdx, gdy).rgb * ${meanInv("grass")}; }
  vec3 blended =
      grassAlbedo * w0
    + texture2D(terrainFloor,  uvF).rgb * ${meanInv("floor")} * w1
    + texture2D(terrainSand,   uvS).rgb * ${meanInv("sand")} * w3
    + texture2D(terrainPebble, uvP).rgb * ${meanInv("pebble")} * w4
    + w2 * ${meanInv("rock")} * (
      texture2D(terrainRock, vPositionW.yz * rt + rpX).rgb * bw.x
    + texture2D(terrainRock, vPositionW.xz * rt + rpY).rgb * bw.y
    + texture2D(terrainRock, vPositionW.xy * rt + rpZ).rgb * bw.z);
  float ao = rah0.g * w0 + rah1.g * w1 + rah2.g * w2 + rah3.g * w3 + rah4.g * w4;
  // AO: the packed channel is normalised to a mean of 0.5 per
  // layer when the texture was made, so dividing the blended
  // value back by 0.5 turns it into a mean-1 multiplier — every layer darkens
  // around its own occlusion variation rather than around wherever its raw
  // source map's mean happened to land.
  surfaceAlbedo *= mix(vec3(1.0), blended, strength) * mix(1.0, ao / 0.5, strength) * detailAo;
  // Macro tint: the lush/dry variation over tens of metres, on grass only and
  // faded out with the rest of the detail. A multiplicative tint of
  // surfaceAlbedo, never a write to the material constant.
  vec3 macro = macroTint(macroNoise(vPositionW.xz), 1.0 - terrainN.y);
  surfaceAlbedo *= mix(vec3(1.0), macro, w0 * terrainMacroOn * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist)));
  // Horizon tint: past HORIZON the floor reads as the vegetation the clutter
  // has thinned out of, not as bare palette.
  surfaceAlbedo = mix(surfaceAlbedo, terrainTuft, w0 * horizonWeight(dist));
  // Roughness: the blended per-layer base,
  // modulated near the eye by the blended map over its own 0.5 neutral (so a
  // flat 0.5 placeholder or a failed decode is the identity, not a flash of
  // gloss); F0: per layer, never faded.
  float rBase = terrainLayerRough.x * w0 + terrainLayerRough.y * w1 + terrainLayerRough.z * w2 + terrainLayerRough.w * w3 + terrainLayerRough2.x * w4;
  float rMap = rah0.r * w0 + rah1.r * w1 + rah2.r * w2 + rah3.r * w3 + rah4.r * w4;
  terrainRough = clamp(rBase * mix(1.0, rMap / 0.5, strength), 0.0, 1.0);
  terrainF0 = terrainLayerF0.x * w0 + terrainLayerF0.y * w1 + terrainLayerF0.z * w2 + terrainLayerF0.w * w3 + terrainLayerF02.x * w4;
}
#endif
`;

export class TerrainTexturePlugin extends MaterialPluginBase {
  private readonly _scene: Scene;
  private readonly _grass: Texture;
  private readonly _floor: Texture;
  private readonly _rock: Texture;
  private readonly _sand: Texture;
  private readonly _pebble: Texture;
  private readonly _asphalt: Texture;
  private readonly _textures: readonly Texture[];
  private readonly _arrays: GroundArrays;
  private _roadCenter: RawTexture | null = null;
  private _roadData: Float32Array | null = null;
  private _roadSeed = 0;
  private _roadCentreZ = 0;
  private _roadCenterX: RoadCenterX | null = null;
  private _trailSegs: RawTexture | null = null;
  private _trailIndex: RawTexture | null = null;
  private _trailInfo: [number, number, number, number] = [0, 0, 0, 0];
  private _featureTex: RawTexture | null = null;
  private _featureInfo: [number, number, number, number] = [0, 0, 0, 0];

  constructor(material: PBRMaterial, scene: Scene, options: { groundArrays?: GroundArraysFactory } = {}) {
    // Priority 200, matching foliagePlugin/cel — after Babylon's own plugins. The
    // TERRAINTEX define is declared here, which is what puts `#define TERRAINTEX`
    // into the compiled shader's define block; a plugin that gates injected code
    // on an UNDECLARED define compiles the whole branch out silently (the trap
    // cel.ts documents from the other side). ROADPAINT starts false the same
    // way — `enableRoad` is what flips it once a centerline hook exists.
    super(material, "TerrainTexture", 200, { TERRAINTEX: false, ROADPAINT: false, TRAILPAINT: false, FEATUREPAINT: false });
    this._scene = scene;
    this._grass = loadGroundTexture(grassUrl, "terrainGrass", scene);
    this._floor = loadGroundTexture(floorUrl, "terrainFloor", scene);
    this._rock = loadGroundTexture(rockUrl, "terrainRock", scene);
    this._sand = loadGroundTexture(sandUrl, "terrainSand", scene);
    this._pebble = loadGroundTexture(pebbleUrl, "terrainPebble", scene);
    this._asphalt = loadGroundTexture(asphaltUrl, "roadAsphalt", scene);
    this._textures = [this._grass, this._floor, this._rock, this._sand, this._pebble, this._asphalt];
    this._arrays = (options.groundArrays ?? loadGroundArrays)(scene);
    this._enable(true);
  }

  override getClassName(): string {
    return "TerrainTexturePlugin";
  }

  /** Whether the road branch is compiled in. */
  get roadEnabled(): boolean {
    return this._roadCenter !== null;
  }

  /**
   * Turn the road on for this world: bake the centerline table for a first
   * centre at z = 0 and flip the ROADPAINT define. A 1-D R32F texture with
   * NEAREST sampling — the shader lerps two texels by hand, so no
   * float-linear extension is needed. Idempotent per plugin: the first
   * call's seed wins and a later call with a different seed is silently
   * ignored (the early `return` above), which is unreachable today because
   * `createClipmap` calls this once per scene. If that ever changes — a
   * scene reused across worlds, say — this must dispose `_roadCenter` and
   * rebuild the table for the new seed instead of returning early.
   */
  enableRoad(seed: number, centerX: RoadCenterX): void {
    if (this._roadCenter !== null) return;
    this._roadSeed = seed;
    this._roadCenterX = centerX;
    this._roadCentreZ = 0;
    this._roadData = buildRoadTable(seed, 0, centerX);
    const table = RawTexture.CreateRTexture(
      this._roadData, ROAD_TABLE_N, 1, this._scene,
      false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    );
    table.name = "roadCenter";
    table.wrapU = Texture.CLAMP_ADDRESSMODE;
    table.wrapV = Texture.CLAMP_ADDRESSMODE;
    this._roadCenter = table;
    // The define changed after the material may already have compiled.
    this.markAllDefinesAsDirty();
  }

  /** Turn the trail on for this world: bake the bucketed segment table once. */
  enableTrail(graph: TrailGraph): void {
    if (this._trailSegs !== null) return;
    const table = buildTrailTable(trailSegments(graph));
    if (table.overflow) console.warn("trail paint: segment table overflowed; some of the trail is unpainted");
    const segs = RawTexture.CreateRGBATexture(
      table.list, TRAIL_PAINT_MAX_SEGMENTS, 1, this._scene,
      false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    );
    segs.name = "trailSegs"; segs.wrapU = Texture.CLAMP_ADDRESSMODE; segs.wrapV = Texture.CLAMP_ADDRESSMODE;
    const index = RawTexture.CreateRGBATexture(
      table.index, TRAIL_PAINT_GRID, TRAIL_PAINT_GRID, this._scene,
      false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    );
    index.name = "trailIndex"; index.wrapU = Texture.CLAMP_ADDRESSMODE; index.wrapV = Texture.CLAMP_ADDRESSMODE;
    this._trailSegs = segs;
    this._trailIndex = index;
    this._trailInfo = [table.x0, table.z0, 1 / TRAIL_PAINT_BUCKET, TRAIL_PAINT_GRID];
    this.markAllDefinesAsDirty();
  }

  /** Turn feature paint on for this world: bake the (x, z, radius, kind) +
   * treeline table once. Idempotent, same story as `enableRoad`/`enableTrail`. */
  enableFeatures(features: readonly Feature[]): void {
    if (this._featureTex !== null) return;
    this._featureTex = createFeatureTexture(this._scene, features);
    this._featureTex.name = "featureTex";
    this._featureTex.wrapU = Texture.CLAMP_ADDRESSMODE;
    this._featureTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this._featureInfo = [Math.min(features.length, FEATURE_PAINT_MAX), 0, 0, 0];
    this.markAllDefinesAsDirty();
  }

  // `scene` and `mesh` are part of MaterialPluginBase's required override
  // signature even though a constant define needs neither. Kept on ONE line:
  // `eslint-disable-next-line` covers only the following line, so a wrapped
  // parameter list would leave the unused two unsuppressed (the `cel.ts` /
  // `foliagePlugin.ts` precedent).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.TERRAINTEX = true;
    defines.ROADPAINT = this._roadCenter !== null;
    defines.TRAILPAINT = this._trailSegs !== null;
    defines.FEATUREPAINT = this._featureTex !== null;
  }

  // Same signature-vs-eslint story, same one-line rule.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("terrainWeights", "terrainWeights2");
  }

  override getSamplers(samplers: string[]): void {
    samplers.push(
      "terrainGrass", "terrainFloor", "terrainRock", "terrainSand", "terrainPebble",
      "terrainNormals", "terrainRAH",
    );
    if (this._roadCenter !== null) samplers.push("roadCenter", "roadAsphalt");
    if (this._trailSegs !== null) samplers.push("trailSegs", "trailIndex");
    if (this._featureTex !== null) samplers.push("featureTex");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        // (grass, floor, sand, pebble) repeats per metre — the shader multiplies
        // world XZ by these, so they are the reciprocal of TILING_METRES.
        { name: "terrainTiling", size: 4, type: "vec4" },
        // (rock repeats per metre, TEXTURE_MEAN). Packed together because a UBO
        // pads a lone float to a vec4 slot anyway.
        { name: "terrainRock2", size: 2, type: "vec2" },
        { name: "terrainFade", size: 2, type: "vec2" },
        { name: "terrainEye", size: 3, type: "vec3" },
        // (z0, step, N, asphalt repeats per metre) for the centerline table —
        // declared unconditionally like the rest of this UBO block; the road
        // block that reads it is itself gated on ROADPAINT.
        { name: "roadTable", size: 4, type: "vec4" },
        // (x0, z0, 1/bucket, grid) for the bucketed trail segment table —
        // declared unconditionally like roadTable; the paint that reads it is
        // gated on TRAILPAINT.
        { name: "trailInfo", size: 4, type: "vec4" },
        // (live feature count, 0, 0, 0) for the feature table — declared
        // unconditionally like trailInfo; the paint that reads it is gated
        // on FEATUREPAINT.
        { name: "featureInfo", size: 4, type: "vec4" },
        // Per-layer roughness/F0 tables: (grass, floor, rock,
        // sand) then (pebble, asphalt) — split because a UBO vec has a
        // four-component ceiling, same reasoning as terrainTiling/terrainRock2.
        { name: "terrainLayerRough", size: 4, type: "vec4" },
        { name: "terrainLayerRough2", size: 2, type: "vec2" },
        { name: "terrainLayerF0", size: 4, type: "vec4" },
        { name: "terrainLayerF02", size: 2, type: "vec2" },
        // 1 once the real RAH array has landed, 0 for the 1x1 placeholder
        // — gates the height blend off until real per-texel
        // heights exist to blend on.
        { name: "terrainReliefOn", size: 1, type: "float" },
        // The grass floor. (detail repeats per metre, fade start, fade end,
        // normal weight) and (AO strength, AO curve's low band, AO curve's
        // high band).
        { name: "terrainDetail", size: 4, type: "vec4" },
        { name: "terrainDetail2", size: 3, type: "vec3" },
        // The macro tint's on/off gate. The tint's own constants are GLSL
        // literals in the hex include, pinned to groundHexParams.ts by a
        // lockstep test, because the CPU mirror must agree exactly.
        { name: "terrainMacroOn", size: 1, type: "float" },
        // (horizon start, end, max) and the tuft colour it blends toward.
        { name: "terrainHorizon", size: 3, type: "vec3" },
        { name: "terrainTuft", size: 3, type: "vec3" },
      ],
      // Non-UBO path only; see TERRAIN_FRAGMENT_DEFS' note 2. The two array
      // samplers do NOT belong here or in TERRAIN_FRAGMENT_DEFS's non-sampler
      // uniforms: a sampler can't live in a UBO, so it is declared once, in
      // TERRAIN_FRAGMENT_DEFS, which compiles in on both paths. These four are
      // the opposite case — plain vectors that DO live in the UBO above — so,
      // like terrainTiling/terrainRock2/terrainFade/terrainEye/roadTable, they
      // are declared ONLY here (the non-UBO path); declaring them again in
      // TERRAIN_FRAGMENT_DEFS, which always compiles in, would double-declare
      // them under UBO support.
      fragment: `
#ifdef TERRAINTEX
uniform vec4 terrainTiling;
uniform vec2 terrainRock2;
uniform vec2 terrainFade;
uniform vec3 terrainEye;
uniform vec4 roadTable;
uniform vec4 trailInfo;
uniform vec4 featureInfo;
uniform vec4 terrainLayerRough;
uniform vec2 terrainLayerRough2;
uniform vec4 terrainLayerF0;
uniform vec2 terrainLayerF02;
uniform float terrainReliefOn;
uniform vec4 terrainDetail;
uniform vec3 terrainDetail2;
uniform float terrainMacroOn;
uniform vec3 terrainHorizon;
uniform vec3 terrainTuft;
#endif
`,
    };
  }

  // Only `uniformBuffer` and `scene` are used; `engine` and `subMesh` are
  // Babylon's contract. One line, for the eslint-disable reason above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat4(
      "terrainTiling",
      1 / TILING_METRES.grass,
      1 / TILING_METRES.floor,
      1 / TILING_METRES.sand,
      1 / TILING_METRES.pebble,
    );
    uniformBuffer.updateFloat2("terrainRock2", 1 / TILING_METRES.rock, TEXTURE_MEAN);
    uniformBuffer.updateFloat2("terrainFade", FADE_START, FADE_END);
    // The eye position comes from the camera rather than a Babylon-internal
    // uniform name, so the fade cannot break on an engine rename. No camera
    // means nothing is being rendered; (0,0,0) keeps the shader well-defined.
    const eye = scene.activeCamera?.globalPosition;
    uniformBuffer.updateFloat3("terrainEye", eye?.x ?? 0, eye?.y ?? 0, eye?.z ?? 0);
    uniformBuffer.updateFloat4(
      "terrainLayerRough", LAYER_ROUGHNESS[0], LAYER_ROUGHNESS[1], LAYER_ROUGHNESS[2], LAYER_ROUGHNESS[3],
    );
    uniformBuffer.updateFloat2("terrainLayerRough2", LAYER_ROUGHNESS[4], LAYER_ROUGHNESS[5]);
    uniformBuffer.updateFloat4("terrainLayerF0", LAYER_F0[0], LAYER_F0[1], LAYER_F0[2], LAYER_F0[3]);
    uniformBuffer.updateFloat2("terrainLayerF02", LAYER_F0[4], LAYER_F0[5]);
    // 1x1 is the placeholder's signature (groundMaps.ts); anything wider is a
    // real decoded array. Read every bind, same reason as the textures below.
    uniformBuffer.updateFloat("terrainReliefOn", this._arrays.rah.getSize().width > 1 ? 1.0 : 0.0);
    uniformBuffer.updateFloat4("terrainDetail", 1 / DETAIL_TILING, DETAIL_FADE[0], DETAIL_FADE[1], DETAIL_NORMAL);
    uniformBuffer.updateFloat3("terrainDetail2", DETAIL_AO, DETAIL_AO_RANGE[0], DETAIL_AO_RANGE[1]);
    uniformBuffer.updateFloat("terrainMacroOn", 1);
    uniformBuffer.updateFloat3("terrainHorizon", HORIZON[0], HORIZON[1], HORIZON_MAX);
    uniformBuffer.updateFloat3("terrainTuft", TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b);
    uniformBuffer.setTexture("terrainGrass", this._grass);
    uniformBuffer.setTexture("terrainFloor", this._floor);
    uniformBuffer.setTexture("terrainRock", this._rock);
    uniformBuffer.setTexture("terrainSand", this._sand);
    uniformBuffer.setTexture("terrainPebble", this._pebble);
    // Read every bind, not cached at construction: `loadGroundArrays` swaps
    // these fields in place once the WebPs decode (groundMaps.ts), and the
    // uniform must pick up the real array the first bind after that happens.
    uniformBuffer.setTexture("terrainNormals", this._arrays.normals);
    uniformBuffer.setTexture("terrainRAH", this._arrays.rah);
    if (this._roadCenter !== null && this._roadData !== null && this._roadCenterX !== null) {
      const camZ = eye?.z ?? 0;
      if (roadTableStale(this._roadCentreZ, camZ)) {
        this._roadCentreZ = camZ;
        buildRoadTable(this._roadSeed, camZ, this._roadCenterX, this._roadData);
        this._roadCenter.update(this._roadData);
      }
      uniformBuffer.updateFloat4(
        "roadTable", roadTableZ0(this._roadCentreZ), ROAD_TABLE_STEP, ROAD_TABLE_N, 1 / TILING_METRES.asphalt,
      );
      uniformBuffer.setTexture("roadCenter", this._roadCenter);
      uniformBuffer.setTexture("roadAsphalt", this._asphalt);
    }
    if (this._trailSegs !== null) {
      uniformBuffer.updateFloat4("trailInfo", ...this._trailInfo);
      uniformBuffer.setTexture("trailSegs", this._trailSegs);
      uniformBuffer.setTexture("trailIndex", this._trailIndex!);
    }
    if (this._featureTex !== null) {
      uniformBuffer.updateFloat4("featureInfo", ...this._featureInfo);
      uniformBuffer.setTexture("featureTex", this._featureTex);
    }
  }

  // Without this the terrain draws with unbound samplers for as long as the five
  // WebPs take to arrive, which reads as black ground rather than as loading.
  // NullEngine marks every texture ready synchronously, so this never stalls a
  // test (nullEngine.pure.js:672).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): boolean {
    return this._textures.every((t) => t.isReady()) && this._arrays.normals.isReady() && this._arrays.rah.isReady();
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(...this._textures, this._arrays.normals, this._arrays.rah);
    if (this._roadCenter !== null) activeTextures.push(this._roadCenter);
    if (this._trailSegs !== null) activeTextures.push(this._trailSegs, this._trailIndex!);
    if (this._featureTex !== null) activeTextures.push(this._featureTex);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return (
      this._textures.some((t) => t === texture)
      || texture === this._roadCenter
      || texture === this._trailSegs
      || texture === this._trailIndex
      || texture === this._featureTex
      || texture === this._arrays.normals
      || texture === this._arrays.rah
    );
  }

  override dispose(forceDisposeTextures?: boolean): void {
    // The road table is runtime data nobody else owns — dispose it whenever
    // this plugin disposes, unconditionally, unlike the shared ground textures
    // below. The normal/RAH arrays are the same story: `loadGroundArrays`
    // hands this plugin sole ownership, so they are disposed unconditionally
    // too, not gated on `forceDisposeTextures`.
    this._roadCenter?.dispose();
    this._trailSegs?.dispose();
    this._trailIndex?.dispose();
    this._featureTex?.dispose();
    this._arrays.dispose();
    // Scene disposal already reclaims these (every Texture registers itself in
    // scene.textures); this covers the explicit material.dispose(_, true) path.
    if (!forceDisposeTextures) return;
    for (const texture of this._textures) texture.dispose();
  }

  override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: TERRAIN_VERTEX_DEFS,
        CUSTOM_VERTEX_MAIN_END: TERRAIN_VERTEX_MAIN_END,
      };
    }
    if (shaderType === "fragment") {
      return {
        // The hex include sits between this plugin's own declarations and the
        // paints: after the uniforms its functions read, before the paint code
        // that has no use for them.
        CUSTOM_FRAGMENT_DEFINITIONS: TERRAIN_FRAGMENT_DEFS + TERRAIN_HEX_DEFS + ROAD_FRAGMENT_DEFS + TRAIL_FRAGMENT_DEFS + FEATURE_FRAGMENT_DEFS,
        // Unconditional locals the reflectivity rewrite below reads whatever
        // the defines say — see TERRAIN_FRAGMENT_MAIN_BEGIN.
        CUSTOM_FRAGMENT_MAIN_BEGIN: TERRAIN_FRAGMENT_MAIN_BEGIN,
        // BEFORE_LIGHTS, where `surfaceAlbedo` has just been declared and no
        // light has accumulated yet. Deliberately NOT BEFORE_FRAGCOLOR: writing
        // the final colour there would overwrite the cel plugin's banded
        // lighting. Road AFTER the ground blend, in the same block,
        // so it overrides the textured colour. Feature paint
        // runs next, BEFORE the trail paint: a
        // meadow/pond feature's ground class paints first, and the trail's
        // own bed/bank paint — which a loop feature is exactly the kind of
        // place a trail is built to reach — is what wins where the two
        // overlap, so a trail crossing a meadow keeps its dirt and gravel
        // rather than fading into grass tint.
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: TERRAIN_FRAGMENT_BLEND + ROAD_FRAGMENT_PAINT + FEATURE_FRAGMENT_PAINT + TRAIL_FRAGMENT_PAINT,
        // Plugin regex key: rewrite the reflectivity call's first argument so
        // roughness (.g) and F0 (.a) vary per fragment. Babylon
        // 9.18's vReflectivityColor is (metallic, roughness, ior, f0) in the
        // metallic workflow. A leading "!" marks the key as a regular
        // expression, matched against `reflectivityBlock(\nvReflectivityColor`
        // in Babylon's real PBR fragment source.
        "!reflectivityBlock\\(\\s*vReflectivityColor":
          "reflectivityBlock(\nvec4(vReflectivityColor.r, vReflectivityColor.g * terrainRough, vReflectivityColor.b, vReflectivityColor.a * terrainF0)",
      };
    }
    return null;
  }
}

/** Trilinear + wrapped, which is what a tiled ground layer needs: mipmaps to
 * stop the distant repeat aliasing into moiré, WRAP so the repeat is seamless. */
function loadGroundTexture(url: string, name: string, scene: Scene): Texture {
  const texture = new Texture(url, scene, {
    noMipmap: false,
    samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
  });
  texture.name = name;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * Attach the ground-texture plugin to a material once; further calls are no-ops.
 *
 * The guard is load-bearing, not defensive politeness. Babylon's `_addPlugin`
 * does refuse a second plugin of the same name — but it refuses by returning
 * false, which the base constructor ignores, and the discarded instance's own
 * `_enable(true)` still reaches `_activatePlugin`, which dedups by identity. A
 * second unguarded attach therefore leaves two ACTIVE plugins: the GLSL below is
 * injected twice (redeclaring `vTerrainW`, which will not compile) and five more
 * textures are loaded that nothing disposes. `terrainTexture.test.ts` asserts the
 * active count for exactly this reason.
 */
export function attachTerrainTexture(
  scene: Scene,
  material: PBRMaterial,
  options: { groundArrays?: GroundArraysFactory } = {},
): void {
  if (material.pluginManager?.getPlugin("TerrainTexture")) return;
  new TerrainTexturePlugin(material, scene, options);
}

/**
 * Turn on per-fragment road paint for the world `seed` if the active variant
 * has a road. Montane and every road-less variant leave
 * the plugin exactly as it was, define false, and compile today's shader.
 */
export function enableRoadPaint(scene: Scene, material: PBRMaterial, seed: number): void {
  const centerX = activeTerrainVariant().roadCenterX;
  if (centerX === undefined) return;
  attachTerrainTexture(scene, material);
  (material.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin).enableRoad(seed, centerX);
}

/**
 * Turn on per-fragment trail paint for the world `seed` if the active variant
 * has a trail graph. Variants without one
 * leave the plugin exactly as it was, define false, and compile today's shader.
 */
export function enableTrailPaint(scene: Scene, material: PBRMaterial, seed: number): void {
  const graphOf = activeTerrainVariant().trailGraph;
  if (graphOf === undefined) return;
  attachTerrainTexture(scene, material);
  (material.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin).enableTrail(graphOf(seed));
}

/**
 * Turn on per-fragment feature paint for the world `seed` if the active
 * variant has a trail graph — the made features (the peak, the loop
 * features) travel on the same graph as the trail.
 * Variants without one leave the plugin exactly as it was, define false, and
 * compile today's shader.
 */
export function enableFeaturePaint(scene: Scene, material: PBRMaterial, seed: number): void {
  const graphOf = activeTerrainVariant().trailGraph;
  if (graphOf === undefined) return;
  attachTerrainTexture(scene, material);
  (material.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin).enableFeatures(graphOf(seed).features);
}
