/**
 * A lake's surface as numbers: its grid and the depth of the bed under each
 * vertex. Babylon-free, so the world's worker can make them ahead of the
 * build (`preparedScene.ts`); the renderer makes the mesh (`lakeSurface`).
 */
import { elevationAt, type LakeSource } from "../sim/terrain.js";
import { lakeShoreInto, newLakeShore, type LakeShape } from "../sim/lakeShape.js";
import { LAKE_SURFACE_REACH } from "./bedHeight.js";
import { WATER_UV_SCALE } from "./water.js";

/** Spacing (m) of a lake surface's vertices: fine enough that the per-vertex
 * depth follows the shelf and its drop. */
export const LAKE_SURFACE_SPACING = 2;

const SURFACE_SHORE = newLakeShore();

/**
 * A lake's surface grid, its positions relative to the shape's centre: the
 * square of half-side `shoreMax + LAKE_SURFACE_REACH + LAKE_SURFACE_SPACING`
 * about it every `LAKE_SURFACE_SPACING` metres, each grid square kept whose
 * four corners lie within `LAKE_SURFACE_REACH` of the shore, the vertices the
 * kept squares use and no others; wound as `CreateGround` winds its faces, to
 * face up. Its UVs are the rings' (`waterRingGeometry`): the vertex's world
 * position over `WATER_UV_SCALE`.
 */
export function lakeSurfaceGrid(
  shape: LakeShape,
): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const half = shape.shoreMax + LAKE_SURFACE_REACH + LAKE_SURFACE_SPACING;
  const n = Math.ceil((2 * half) / LAKE_SURFACE_SPACING) + 1;
  const x0 = -half, z0 = -half;
  const inside = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s = lakeShoreInto(SURFACE_SHORE, shape, shape.cx + x0 + i * LAKE_SURFACE_SPACING, shape.cz + z0 + j * LAKE_SURFACE_SPACING).s;
      inside[j * n + i] = s > -LAKE_SURFACE_REACH ? 1 : 0;
    }
  }
  const index = new Int32Array(n * n).fill(-1);
  const pos: number[] = [];
  const tris: number[] = [];
  const vertex = (i: number, j: number): number => {
    const k = j * n + i;
    if ((index[k] as number) < 0) {
      index[k] = pos.length / 3;
      pos.push(x0 + i * LAKE_SURFACE_SPACING, 0, z0 + j * LAKE_SURFACE_SPACING);
    }
    return index[k] as number;
  };
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      if (!inside[j * n + i] || !inside[j * n + i + 1] || !inside[(j + 1) * n + i] || !inside[(j + 1) * n + i + 1]) continue;
      const p00 = vertex(i, j), p10 = vertex(i + 1, j), p01 = vertex(i, j + 1), p11 = vertex(i + 1, j + 1);
      tris.push(p00, p10, p01, p10, p11, p01);
    }
  }
  const positions = Float32Array.from(pos);
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v++) {
    normals[v * 3 + 1] = 1;
    uvs[v * 2] = (shape.cx + (positions[v * 3] as number)) / WATER_UV_SCALE;
    uvs[v * 2 + 1] = (shape.cz + (positions[v * 3 + 2] as number)) / WATER_UV_SCALE;
  }
  return { positions, normals, uvs, indices: Uint32Array.from(tris) };
}

/**
 * The depth of the water over each of the grid's vertices (`positions`, as
 * `lakeSurfaceGrid` gives them): the lake's level less the sim's own ground
 * there, 0 where the ground stands above it.
 */
export function lakeSurfaceDepths(seed: number, lake: LakeSource, positions: Float32Array): Float32Array {
  const vertexCount = positions.length / 3;
  const depths = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const wx = lake.shape.cx + (positions[i * 3] as number);
    const wz = lake.shape.cz + (positions[i * 3 + 2] as number);
    depths[i] = Math.max(0, lake.level - elevationAt(seed, wx, wz));
  }
  return depths;
}
