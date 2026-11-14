/**
 * The numbers the terrain's material is drawn with: every uniform of the
 * ground blend, the road, trail and feature paints, the sward floor and the
 * far cover, by the name the fragment stage reads it under
 * (`terrainTexture.ts` has the GLSL and binds these).
 *
 * Most are the look's constants, here and in `groundHexParams.ts`. What
 * moves with a frame is where the eye stands, the weather's wetness and rain
 * and the running time; what moves with a world is its tables
 * (`terrainTables.ts`); what moves with the quality tier is whether the
 * sward floor is pulled. Babylon-free, and renderer-only like the plugin: no
 * value here reaches the simulation.
 */
import {
  DETAIL_TILING, DETAIL_FADE, DETAIL_NORMAL, DETAIL_AO, DETAIL_AO_RANGE,
  HORIZON, HORIZON_MAX, TUFT_ALBEDO,
  SWARD_FLOOR, SWARD_MAX, SWARD_COVER, SWARD_FADE,
} from "./groundHexParams.js";
import { rippleTime } from "./rainParams.js";
import { ROAD_TABLE_N, ROAD_TABLE_STEP, roadTableZ0 } from "./roadPaint.js";
import type { FeaturePaintTable, RoadCentreTable, TrailPaintTable } from "./terrainTables.js";
import { TRAIL_PAINT_BUCKET, TRAIL_PAINT_GRID } from "./trailPaint.js";
import { wetSurfaceUnder, type WeatherParams } from "./weather.js";

/** Mean luminance every ground texture was normalised to when it was made.
 * Measured back off the five committed WebPs as
 * 0.4984 / 0.4985 / 0.4983 / 0.4980 / 0.4981 — the encode's rounding, not a
 * different target. Dividing the blend by this makes a flat texture exactly
 * neutral, so the palette keeps its tuning. */
export const TEXTURE_MEAN = 0.5;

/**
 * Metres of world per texture repeat, per layer. These are each source
 * texture's own recorded real-world footprint (grass 2.00 m,
 * forest floor 2.07 m, sand 1.80 m, pebble 2.00 m): tiled at its
 * own size, each texture renders at that real-world size. Measured,
 * not guessed — the original 2/2/3/3/4 values were pre-survey estimates. Retuned by eye
 * in the running game.
 *
 * Rock is the exception: its source covers 1.80 m, but at that size the
 * steep faces read as a field of small cobbles over the relief's joints. It
 * repeats every 5.40 m, three times its footprint, so a stone is three times
 * larger: fewer, larger rocks on every face, the scree and the steep ground
 * alike, since the layer is one wherever it is drawn. The parallax keeps its
 * depth in metres (`ROCK_PARALLAX_DEPTH` is scaled to the repeat in the
 * shader), so the stones are as deep as before.
 *
 * `asphalt` is its own 3.00 m footprint. It tiles in the road's own (u, z) frame — signed u across the
 * centerline, world z along it — not world XZ like the five layers above.
 */
export const TILING_METRES = { grass: 2.0, floor: 2.07, rock: 5.4, sand: 1.8, pebble: 2.0, asphalt: 3.0 };

/** Distance band (m) over which the detail fades to the flat palette colour.
 * Design values ("faded to the flat palette beyond ~80 m"), tuned
 * by eye in the running game; they buy back fragment cost at range where the
 * texture is below a pixel anyway. */
export const FADE_START = 80;
export const FADE_END = 140;

/** Six values, grass/floor/rock/sand/pebble/asphalt in order — a fixed-length
 * tuple rather than a plain `readonly number[]` because this repo's
 * tsconfig sets `noUncheckedIndexedAccess`: a plain array's index type is
 * `number | undefined`, which would not typecheck where `terrainUniforms`
 * reads `LAYER_ROUGHNESS[0..5]`. `toEqual` in the test does not care either way. */
export type LayerSix = readonly [number, number, number, number, number, number];
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

type V1 = [number];
type V2 = [number, number];
type V3 = [number, number, number];
type V4 = [number, number, number, number];

/**
 * The material's uniforms by name, each its components in order, the names
 * in the order the plugin declares them in its uniform block.
 */
export type TerrainUniforms = {
  /** (grass, floor, sand, pebble) repeats per metre: the reciprocal of TILING_METRES. */
  terrainTiling: V4;
  /** (rock repeats per metre, TEXTURE_MEAN). */
  terrainRock2: V2;
  /** The detail's fade band, metres from the eye. */
  terrainFade: V2;
  /** The eye's world position. */
  terrainEye: V3;
  /** (z0, step, N, asphalt repeats per metre) for the road's centreline table; zero in a world with no road, whose paint is compiled out. */
  roadTable: V4;
  /** (x0, z0, 1 / bucket, grid) for the trail's table; zero in a world with no trail. */
  trailInfo: V4;
  /** The weather's wetness, [0, 1]. */
  terrainWet: V1;
  /** The weather's rain, [0, 1]. */
  terrainRain: V1;
  /** The running time the puddles' ripples read, seconds, folded (`rippleTime`). */
  terrainTime: V1;
  /** (features painted, 0, 0, 0) for the feature table; zero in a world with none. */
  featureInfo: V4;
  /** Per-layer roughness: (grass, floor, rock, sand), then (pebble, asphalt). */
  terrainLayerRough: V4;
  terrainLayerRough2: V2;
  /** Per-layer F0: (grass, floor, rock, sand), then (pebble, asphalt). */
  terrainLayerF0: V4;
  terrainLayerF02: V2;
  /** 1 once the decoded relief maps are bound, 0 while their flat placeholders are. */
  terrainReliefOn: V1;
  /** The grass detail: (repeats per metre, fade start, fade end, normal weight). */
  terrainDetail: V4;
  /** (AO strength, AO curve's low band, AO curve's high band). */
  terrainDetail2: V3;
  /** The macro tint's gate: on. */
  terrainMacroOn: V1;
  /** (horizon start, end, max). */
  terrainHorizon: V3;
  /** The tuft colour the horizon blends toward. */
  terrainTuft: V3;
  /** (thatch colour, pull at full cover): the pull is 0 where no blade field is drawn. */
  terrainSward: V4;
  /** (cover band, eye-distance fade band). */
  terrainSwardBand: V4;
};

/** What the uniforms are made from. */
export type TerrainUniformInputs = {
  /** Where the eye stands, world metres; absent (nothing is being drawn) it reads as the origin. */
  eye: { readonly x: number; readonly y: number; readonly z: number } | null | undefined;
  /** The weather's wetness and rain; each is held to [0, 1]. */
  wetness: number;
  rain: number;
  /** The running time, seconds, unfolded. */
  seconds: number;
  /** Whether the sward floor is pulled: only where the blade field is drawn. */
  sward: boolean;
  /** Whether the decoded relief maps are the ones bound (`groundMaps.ts`'s placeholders are not). */
  relief: boolean;
  /** The world's tables (`terrainTables.ts`), null where the world has none. */
  road: RoadCentreTable | null;
  trail: TrailPaintTable | null;
  features: FeaturePaintTable | null;
};

/** A record of the right shape, every component zero, for `terrainUniforms` to fill. */
export function emptyTerrainUniforms(): TerrainUniforms {
  return {
    terrainTiling: [0, 0, 0, 0],
    terrainRock2: [0, 0],
    terrainFade: [0, 0],
    terrainEye: [0, 0, 0],
    roadTable: [0, 0, 0, 0],
    trailInfo: [0, 0, 0, 0],
    terrainWet: [0],
    terrainRain: [0],
    terrainTime: [0],
    featureInfo: [0, 0, 0, 0],
    terrainLayerRough: [0, 0, 0, 0],
    terrainLayerRough2: [0, 0],
    terrainLayerF0: [0, 0, 0, 0],
    terrainLayerF02: [0, 0],
    terrainReliefOn: [0],
    terrainDetail: [0, 0, 0, 0],
    terrainDetail2: [0, 0, 0],
    terrainMacroOn: [0],
    terrainHorizon: [0, 0, 0],
    terrainTuft: [0, 0, 0],
    terrainSward: [0, 0, 0, 0],
    terrainSwardBand: [0, 0, 0, 0],
  };
}

function set2(v: V2, a: number, b: number): void {
  v[0] = a; v[1] = b;
}
function set3(v: V3, a: number, b: number, c: number): void {
  v[0] = a; v[1] = b; v[2] = c;
}
function set4(v: V4, a: number, b: number, c: number, d: number): void {
  v[0] = a; v[1] = b; v[2] = c; v[3] = d;
}

/**
 * The material's uniforms for `inputs`. Fills and returns `out` (a record
 * of its own when none is given), so a caller that draws every frame keeps
 * one record and makes nothing.
 */
export function terrainUniforms(inputs: TerrainUniformInputs, out: TerrainUniforms = emptyTerrainUniforms()): TerrainUniforms {
  set4(out.terrainTiling, 1 / TILING_METRES.grass, 1 / TILING_METRES.floor, 1 / TILING_METRES.sand, 1 / TILING_METRES.pebble);
  set2(out.terrainRock2, 1 / TILING_METRES.rock, TEXTURE_MEAN);
  set2(out.terrainFade, FADE_START, FADE_END);
  const eye = inputs.eye;
  set3(out.terrainEye, eye?.x ?? 0, eye?.y ?? 0, eye?.z ?? 0);
  if (inputs.road === null) set4(out.roadTable, 0, 0, 0, 0);
  else set4(out.roadTable, roadTableZ0(inputs.road.centreZ), ROAD_TABLE_STEP, ROAD_TABLE_N, 1 / TILING_METRES.asphalt);
  if (inputs.trail === null) set4(out.trailInfo, 0, 0, 0, 0);
  else set4(out.trailInfo, inputs.trail.x0, inputs.trail.z0, 1 / TRAIL_PAINT_BUCKET, TRAIL_PAINT_GRID);
  out.terrainWet[0] = Math.min(1, Math.max(0, inputs.wetness));
  out.terrainRain[0] = Math.min(1, Math.max(0, inputs.rain));
  out.terrainTime[0] = rippleTime(inputs.seconds);
  set4(out.featureInfo, inputs.features === null ? 0 : inputs.features.count, 0, 0, 0);
  set4(out.terrainLayerRough, LAYER_ROUGHNESS[0], LAYER_ROUGHNESS[1], LAYER_ROUGHNESS[2], LAYER_ROUGHNESS[3]);
  set2(out.terrainLayerRough2, LAYER_ROUGHNESS[4], LAYER_ROUGHNESS[5]);
  set4(out.terrainLayerF0, LAYER_F0[0], LAYER_F0[1], LAYER_F0[2], LAYER_F0[3]);
  set2(out.terrainLayerF02, LAYER_F0[4], LAYER_F0[5]);
  out.terrainReliefOn[0] = inputs.relief ? 1.0 : 0.0;
  set4(out.terrainDetail, 1 / DETAIL_TILING, DETAIL_FADE[0], DETAIL_FADE[1], DETAIL_NORMAL);
  set3(out.terrainDetail2, DETAIL_AO, DETAIL_AO_RANGE[0], DETAIL_AO_RANGE[1]);
  out.terrainMacroOn[0] = 1;
  set3(out.terrainHorizon, HORIZON[0], HORIZON[1], HORIZON_MAX);
  set3(out.terrainTuft, TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b);
  set4(out.terrainSward, SWARD_FLOOR.r, SWARD_FLOOR.g, SWARD_FLOOR.b, inputs.sward ? SWARD_MAX : 0);
  set4(out.terrainSwardBand, SWARD_COVER[0], SWARD_COVER[1], SWARD_FADE[0], SWARD_FADE[1]);
  return out;
}

/**
 * The material's own surface, under everything above: a white albedo, since
 * a terrain mesh carries the palette's colour a vertex and the two are
 * multiplied (a tint here would apply the palette twice); rough; and no
 * metal, as nothing in this world is.
 */
export const TERRAIN_SURFACE = { albedo: [1, 1, 1], roughness: 0.95, metallic: 0 } as const;

export type TerrainSurface = { albedo: [number, number, number]; roughness: number; metallic: number };

/**
 * The material's surface under `w`: wet ground reads darker and glossier, a
 * luminance scale on the albedo and a scale on the roughness
 * (`wetSurfaceUnder`), each from the dry value, never compounded.
 */
export function terrainSurfaceUnder(w: WeatherParams): TerrainSurface {
  const { albedoScale, roughnessScale } = wetSurfaceUnder(w);
  return {
    albedo: [TERRAIN_SURFACE.albedo[0] * albedoScale, TERRAIN_SURFACE.albedo[1] * albedoScale, TERRAIN_SURFACE.albedo[2] * albedoScale],
    roughness: TERRAIN_SURFACE.roughness * roughnessScale,
    metallic: TERRAIN_SURFACE.metallic,
  };
}
