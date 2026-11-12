/**
 * The made features' paint as data: the table the terrain's fragment stage
 * reads (`featurePaint.ts` has the GLSL and the texture), the (x, z, radius,
 * kind) of each feature, the shared constants, and below them the shore
 * atlas of the lakes among them. Babylon-free, so the world's worker can make
 * a world's table ahead of the build (`preparedScene.ts`).
 */
import {
  MEADOW_RIM, POND_SHORE, TREELINE_BAND, PEAK_RIM_FADE, treelineOf, type Feature,
} from "../sim/features.js";
import type { LakeShape } from "../sim/lakeShape.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { SHORE_ATLAS_LAKES, SHORE_ATLAS_SIZE, bakeShoreAtlas, type ShoreAtlas } from "./shoreAtlas.js";

/** Up to eight features paint the ground (spec §10.3: one peak, three loops, three tarns). */
export const FEATURE_PAINT_MAX = 8;
/** The table texture: SHORE_ATLAS_SIZE texels wide, the table's two rows and then the shore atlas's rows. */
export const FEATURE_TEX_WIDTH = SHORE_ATLAS_SIZE;
export const FEATURE_TEX_ROWS = 2 + SHORE_ATLAS_SIZE;

/** The shape a pond paints by: one whose bound is finite (a placement's shape
 * carries an infinite one, and the atlas would bake NaN from it). */
function paintedShape(f: Feature): LakeShape | undefined {
  return f.kind === "pond" && f.shape !== undefined && Number.isFinite(f.shape.bound) ? f.shape : undefined;
}

/** The lakes among the first FEATURE_PAINT_MAX features, in order, up to
 * SHORE_ATLAS_LAKES: the shore atlas's tiles, which the shader counts off as
 * it walks the table. A lake past the atlas's last tile is not painted. */
export function paintedLakes(features: readonly Feature[]): LakeShape[] {
  const out: LakeShape[] = [];
  for (const f of features.slice(0, FEATURE_PAINT_MAX)) {
    const shape = paintedShape(f);
    if (shape !== undefined && out.length < SHORE_ATLAS_LAKES) out.push(shape);
  }
  return out;
}

/** The table texture's data: row 0 = (x, z, radius, kind) per feature, kind
 * 1 peak / 2 meadow / 3 lake, 0 = empty, a lake's entry its shape's centre
 * and bound (a pond with no shape, an unbounded one, or one past the
 * atlas's SHORE_ATLAS_LAKES tiles is left empty); row 1 texel 0 = (treeline
 * height, treeline band, meadow rim, pond shore) and row 1 TEXEL 1 =
 * (PEAK_RIM_FADE, 0, 0, 0) — a free slot in the row the shared constants
 * already live in, read as `fRim.x` by the shader (the peak's radial fade is
 * the fifth shared constant and there was no room left in texel 0); rows 2 on,
 * the shore atlas (`shoreAtlas.ts`), one shore distance a texel in the red
 * channel. The treeline height is `treelineOf(peak)` — the same function
 * `features.ts` exports for it. With NO PEAK among the first
 * `FEATURE_PAINT_MAX` entries the treeline reads 0 and is never used — the
 * rock term only runs for a `kind == peak` entry. */
export function featureTable(features: readonly Feature[], atlas: ShoreAtlas): Float32Array {
  const t = new Float32Array(FEATURE_TEX_WIDTH * FEATURE_TEX_ROWS * 4);
  let peak: Feature | undefined;
  let lakes = 0;
  features.slice(0, FEATURE_PAINT_MAX).forEach((f, i) => {
    if (f.kind === "pond") {
      const shape = paintedShape(f);
      if (shape === undefined || lakes >= SHORE_ATLAS_LAKES) return;
      lakes += 1;
      t[i * 4] = shape.cx; t[i * 4 + 1] = shape.cz; t[i * 4 + 2] = shape.bound; t[i * 4 + 3] = 3;
      return;
    }
    t[i * 4] = f.x; t[i * 4 + 1] = f.z; t[i * 4 + 2] = f.radius;
    t[i * 4 + 3] = f.kind === "peak" ? 1 : 2;
    if (f.kind === "peak") peak = f;
  });
  const r = FEATURE_TEX_WIDTH * 4;
  t[r] = peak === undefined ? 0 : treelineOf(peak); t[r + 1] = TREELINE_BAND; t[r + 2] = MEADOW_RIM; t[r + 3] = POND_SHORE;
  t[r + 4] = PEAK_RIM_FADE;
  for (let k = 0; k < SHORE_ATLAS_SIZE * SHORE_ATLAS_SIZE; k++) t[(2 * FEATURE_TEX_WIDTH + k) * 4] = atlas.values[k] as number;
  return t;
}

/**
 * The table of `seed`'s world on the active terrain: its trail graph's
 * features over the shore atlas of the lakes among them. Null on a terrain
 * with no trail graph, which paints none.
 */
export function featureTableFor(seed: number): Float32Array | null {
  const graphOf = activeTerrainVariant().trailGraph;
  if (graphOf === undefined) return null;
  const features = graphOf(seed).features;
  return featureTable(features, bakeShoreAtlas(paintedLakes(features)));
}
