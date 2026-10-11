/**
 * The shore atlas: every lake's signed shore distance (`lakeShoreInto`'s s)
 * baked once at load, so the terrain's shader reads how far a fragment
 * stands from the shore where the CPU asks the basin field (spec §10.2).
 * SHORE_ATLAS_SIZE texels square, a 2 × 2 grid of SHORE_ATLAS_TILE-texel
 * tiles, one a lake in the order the lakes are given (up to
 * SHORE_ATLAS_LAKES), tile i at column i mod 2 and row ⌊i / 2⌋; each tile
 * covers its lake's square of side 2 · `bound` about its centre, texel k's
 * centre at (k + ½) of 2 · bound / SHORE_ATLAS_TILE. Every texel no lake
 * reaches holds SHORE_ATLAS_FAR, as does a lake's square past its bound.
 *
 * The terrain's fragment stage binds WebGPU's default 16 textures already
 * (`stageBindings.test.ts`), so the atlas has no texture of its own: it rides
 * in the feature table's float texture below the table's two rows
 * (`featurePaint.ts`), read texel by texel with the bilinear blend done by
 * hand. `shoreAtlasRead` is the TypeScript twin of the shader's
 * `featureShoreAt`: inside the tile, its texel coordinate held half a texel
 * in from the tile's edges so no neighbour's texel enters, and
 * SHORE_ATLAS_FAR off the lake's square. Babylon-free (architecture test).
 */
import { lakeShoreInto, newLakeShore, type LakeShape } from "../sim/lakeShape.js";

export const SHORE_ATLAS_TILE = 128;
export const SHORE_ATLAS_SIZE = 256;
export const SHORE_ATLAS_LAKES = 4;
/** What a texel holds where no lake is, and what the read gives off a lake's square (m): far outside every shore. */
export const SHORE_ATLAS_FAR = -1000;

/** The atlas: one float a texel, row by row from v = 0. */
export type ShoreAtlas = { readonly values: Float32Array };

/** Bakes the first SHORE_ATLAS_LAKES of `lakes` (65,536 shore reads at most). */
export function bakeShoreAtlas(lakes: readonly LakeShape[]): ShoreAtlas {
  const values = new Float32Array(SHORE_ATLAS_SIZE * SHORE_ATLAS_SIZE).fill(SHORE_ATLAS_FAR);
  const r = newLakeShore();
  for (let i = 0; i < Math.min(lakes.length, SHORE_ATLAS_LAKES); i++) {
    const lake = lakes[i] as LakeShape;
    const ox = (i % 2) * SHORE_ATLAS_TILE, oz = Math.floor(i / 2) * SHORE_ATLAS_TILE;
    const step = (2 * lake.bound) / SHORE_ATLAS_TILE;
    for (let v = 0; v < SHORE_ATLAS_TILE; v++) {
      const z = lake.cz - lake.bound + (v + 0.5) * step;
      for (let u = 0; u < SHORE_ATLAS_TILE; u++) {
        const x = lake.cx - lake.bound + (u + 0.5) * step;
        const s = lakeShoreInto(r, lake, x, z).s;
        values[(oz + v) * SHORE_ATLAS_SIZE + ox + u] = s === Number.NEGATIVE_INFINITY ? SHORE_ATLAS_FAR : Math.max(SHORE_ATLAS_FAR, s);
      }
    }
  }
  return { values };
}

/**
 * The shore distance tile `tile`'s lake gives at (x, z), its square centred on
 * (cx, cz) with half-side `bound`, as the shader reads it: a bilinear blend of
 * the four texels about the point, its texel coordinate held half a texel in
 * from the tile's edges; SHORE_ATLAS_FAR off the square.
 */
export function shoreAtlasRead(
  values: Float32Array, tile: number, cx: number, cz: number, bound: number, x: number, z: number,
): number {
  const lx = (x - (cx - bound)) / (2 * bound), lz = (z - (cz - bound)) / (2 * bound);
  if (lx < 0 || lz < 0 || lx > 1 || lz > 1) return SHORE_ATLAS_FAR;
  const px = Math.min(SHORE_ATLAS_TILE - 0.5, Math.max(0.5, lx * SHORE_ATLAS_TILE)) - 0.5 + (tile % 2) * SHORE_ATLAS_TILE;
  const pz = Math.min(SHORE_ATLAS_TILE - 0.5, Math.max(0.5, lz * SHORE_ATLAS_TILE)) - 0.5 + Math.floor(tile / 2) * SHORE_ATLAS_TILE;
  const i0 = Math.floor(px), j0 = Math.floor(pz);
  const fx = px - i0, fz = pz - j0;
  const i1 = Math.min(i0 + 1, SHORE_ATLAS_SIZE - 1), j1 = Math.min(j0 + 1, SHORE_ATLAS_SIZE - 1);
  const at = (i: number, j: number): number => values[j * SHORE_ATLAS_SIZE + i] as number;
  const near = at(i0, j0) + (at(i1, j0) - at(i0, j0)) * fx;
  const far = at(i0, j1) + (at(i1, j1) - at(i0, j1)) * fx;
  return near + (far - near) * fz;
}
