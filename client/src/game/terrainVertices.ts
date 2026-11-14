/**
 * A terrain mesh's vertex data: what a clipmap ring (`clipmap.ts`) and a
 * steep-ground patch (`facePatches.ts`) hand the renderer to draw, one typed
 * array an attribute and the triangles' indices. Both are made as plain
 * buffers (a ring's on the main thread or ahead by the world's worker, a
 * patch's in its own job); this names the one shape the two share, with how
 * many floats a vertex each attribute is and the names the terrain's
 * material reads its own three under.
 *
 * Positions and normals are in world space: a terrain mesh stands at the
 * origin, unrotated and unscaled. The colour is the palette's albedo with
 * alpha 1, which the material multiplies into its own white albedo. The
 * triangles wind as the game's other meshes do, for a left-handed world.
 *
 * Babylon-free: `renderer.ts` uploads a ring's and `facePatchMeshes.ts` a
 * patch's.
 */
import { WEIGHTS2_STRIDE, type RingGeometry } from "./clipmap.js";
import type { FacePatch } from "./facePatches.js";

export type TerrainVertices = {
  /** World-space positions, three a vertex. */
  positions: Float32Array;
  /** Unit normals, three a vertex. */
  normals: Float32Array;
  /** RGBA a vertex: `classifySurface`'s albedo, alpha 1. */
  colors: Float32Array;
  /** (grass, forest floor, rock, sand) a vertex. */
  weights: Float32Array;
  /** (pebble, detail, duff, canopy) a vertex. */
  weights2: Float32Array;
  /** min(1, grass cover) a vertex: the blade field's own strength. */
  cover: Float32Array;
  /** The triangles drawn, three indices each, 16-bit. */
  indices: Uint16Array;
};

/** Floats a vertex in each attribute's array. */
export const TERRAIN_VERTEX_SIZES = {
  positions: 3,
  normals: 3,
  colors: 4,
  weights: 4,
  weights2: WEIGHTS2_STRIDE,
  cover: 1,
} as const;

/** The names the terrain material's vertex stage reads the weights and the
 * cover under (`terrainTexture.ts`); the position, the normal and the colour
 * are the mesh's own. */
export const TERRAIN_ATTRIBUTES = {
  weights: "terrainWeights",
  weights2: "terrainWeights2",
  cover: "terrainCover",
} as const;

/**
 * A ring's vertex data. A ring's index buffer is sized for every triangle of
 * the ring, and under covered ground some are left out: `indices` is the
 * drawn ones alone, a view of the ring's buffer, not a copy. The other
 * arrays are the ring's own.
 */
export function ringVertices(geometry: RingGeometry): TerrainVertices {
  return {
    positions: geometry.positions,
    normals: geometry.normals,
    colors: geometry.colors,
    weights: geometry.weights,
    weights2: geometry.weights2,
    cover: geometry.cover,
    indices: geometry.indexCount === geometry.indices.length
      ? geometry.indices
      : geometry.indices.subarray(0, geometry.indexCount),
  };
}

/** A patch's vertex data: its own arrays, every index drawn. */
export function facePatchVertices(patch: FacePatch): TerrainVertices {
  return {
    positions: patch.positions,
    normals: patch.normals,
    colors: patch.colors,
    weights: patch.weights,
    weights2: patch.weights2,
    cover: patch.cover,
    indices: patch.indices,
  };
}
