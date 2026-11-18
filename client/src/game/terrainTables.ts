/**
 * The float tables the terrain's fragment stage reads for a world: the road's
 * centreline, the trail's segments and bucket grid, and the made features
 * over the lakes' shore atlas. Each is a typed array with its size in texels;
 * the stage reads a table at a texel it computes itself (the road lerps two
 * by hand, the trail and the features fetch one), so a table is 32-bit float,
 * read at the nearest texel, clamped at its edges, one level and no mips.
 *
 * Babylon-free: `lite/groundTextures.ts` makes its textures from these, and what
 * each puts in the material's uniforms (where the road's is centred, where the
 * trail's grid stands, how many features are painted) is `terrainUniforms.ts`'s.
 */
import type { Feature } from "../sim/features.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import type { TrailGraph } from "../sim/trail.js";
import { FEATURE_PAINT_MAX, FEATURE_TEX_ROWS, FEATURE_TEX_WIDTH, featureTable, paintedLakes } from "./featureTable.js";
import { ROAD_TABLE_N, buildRoadTable, roadTableStale, type RoadCenterX } from "./roadPaint.js";
import { bakeShoreAtlas } from "./shoreAtlas.js";
import { TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_TABLE_ROWS, buildTrailTable, trailSegments } from "./trailPaint.js";

/** A table as its texture is made: `width` × `height` texels of `channels`
 * floats each, row-major. */
export type FloatTable = {
  data: Float32Array;
  width: number;
  height: number;
  /** 1: a red-only table. 4: RGBA. */
  channels: 1 | 4;
};

/**
 * The road's centreline (`roadPaint.ts`): one row, texel i the centreline's x
 * at `roadTableZ0(centreZ)` + i · ROAD_TABLE_STEP. It follows the eye
 * (`followRoadCentre`), so it keeps the seed and the hook it is filled from.
 */
export type RoadCentreTable = FloatTable & {
  seed: number;
  centerX: RoadCenterX;
  /** The world z the table is centred on. */
  centreZ: number;
};

/** The table of `seed`'s road, centred on z = 0. */
export function roadCentreTable(seed: number, centerX: RoadCenterX): RoadCentreTable {
  return { data: buildRoadTable(seed, 0, centerX), width: ROAD_TABLE_N, height: 1, channels: 1, seed, centerX, centreZ: 0 };
}

/**
 * Keeps the table round the eye: once `eyeZ` is more than
 * ROAD_TABLE_RECENTRE from the table's centre, the table is centred on it
 * and filled again, in place. True when it was, and its texture is to be
 * written again.
 */
export function followRoadCentre(table: RoadCentreTable, eyeZ: number): boolean {
  if (!roadTableStale(table.centreZ, eyeZ)) return false;
  table.centreZ = eyeZ;
  buildRoadTable(table.seed, eyeZ, table.centerX, table.data);
  return true;
}

/**
 * The trail's one table (`trailPaint.ts`): the segment list in its first two
 * rows and the bucket grid below them, with where the grid stands.
 */
export type TrailPaintTable = FloatTable & {
  /** The grid's min corner, world metres. */
  x0: number;
  z0: number;
  /** A segment did not fit its bucket, the list or the grid: some of the trail is unpainted. */
  overflow: boolean;
};

/** The table of a world's trail graph. */
export function trailPaintTable(graph: TrailGraph): TrailPaintTable {
  const table = buildTrailTable(trailSegments(graph));
  return {
    data: table.data, width: TRAIL_PAINT_MAX_SEGMENTS, height: TRAIL_PAINT_TABLE_ROWS, channels: 4,
    x0: table.x0, z0: table.z0, overflow: table.overflow,
  };
}

/**
 * The made features' table (`featureTable.ts`): the features' row, the shared
 * constants' row, and the shore atlas below them, with how many features the
 * paint walks.
 */
export type FeaturePaintTable = FloatTable & {
  /** The features painted: the world's, at most FEATURE_PAINT_MAX. */
  count: number;
};

/**
 * The table of a world's features. `made` is the same table made already
 * (by the world's worker, or for another material of the same world); absent
 * or null, it is baked here over the shore atlas of the lakes among them.
 */
export function featurePaintTable(features: readonly Feature[], made?: Float32Array | null): FeaturePaintTable {
  return {
    data: made ?? featureTable(features, bakeShoreAtlas(paintedLakes(features))),
    width: FEATURE_TEX_WIDTH, height: FEATURE_TEX_ROWS, channels: 4,
    count: Math.min(features.length, FEATURE_PAINT_MAX),
  };
}

/** The tables of one world: null where the world has no road, or no trail graph (and so no made features). */
export type TerrainTables = {
  road: RoadCentreTable | null;
  trail: TrailPaintTable | null;
  features: FeaturePaintTable | null;
};

/**
 * The tables of `seed`'s world on the active terrain: its road where the
 * terrain has a centreline, its trail and its features where it has a trail
 * graph (the made features travel on the trail's graph). `features` is the
 * world's feature table made already (`featureTableFor`), as `featurePaintTable` takes it.
 */
export function terrainTablesFor(seed: number, features?: Float32Array | null): TerrainTables {
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  return {
    road: variant.roadCenterX === undefined ? null : roadCentreTable(seed, variant.roadCenterX),
    trail: graph === undefined ? null : trailPaintTable(graph),
    features: graph === undefined ? null : featurePaintTable(graph.features, features),
  };
}
