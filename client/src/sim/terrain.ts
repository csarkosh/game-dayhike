/**
 * Terrain variant registry. A variant is a named elevation pipeline —
 * `/terrain <name>` swaps between registrations at runtime, because comparing
 * candidates side by side is how terrain actually gets tuned.
 *
 * The active variant is module state, set once per world initialisation by
 * `app.ts` before `createForest` runs. It is part of world identity: the name
 * goes into the level id directly, and the variant's tunables reach the level
 * id through the elevation pass (see `passes/elevation.ts`), so peers on
 * different variants or constants refuse each other instead of desyncing.
 */

import type { TrailGraph } from "./trail.js";
import type { LandmarkMask } from "./landmarks.js";
import type { FeatureMask } from "./features.js";

export type TerrainSample = {
  /** Height in metres. */
  h: number;
  /** Exact analytic ∂h/∂x — the montane pipeline guarantees exactness. */
  dx: number;
  /** Exact analytic ∂h/∂z. */
  dz: number;
};

export type TerrainVariant = {
  name: string;
  /** Every constant steering the pipeline, by name — the level-id contract. */
  tunables: Readonly<Record<string, number>>;
  /** Sea level in metres for worlds built on this variant; absent = no water
   * anywhere. `world.ts` copies it onto `World.waterLevel` at creation. */
  waterLevel?: number;
  /** Signed distance to the coastline in metres, positive inland — the same d
   * the variant's own sample uses. Absent = no coast (treated as infinitely
   * inland by consumers). Pure and deterministic like sample. */
  coastDistance?: (seed: number, x: number, z: number) => number;
  /** Absolute distance to the road centerline in metres (the |u| coordinate
   * the road math uses). Absent = no road (treated as infinitely far by
   * consumers). Pure and deterministic like sample. */
  roadDistance?: (seed: number, x: number, z: number) => number;
  /** World x of the road centerline at z — the point where `roadDistance`
   * is zero (x_r = coastlineX(z) + d_r(z)). Absent = no
   * road. Pure and deterministic like sample. A function, not a tunable, so
   * it never enters the level id. */
  roadCenterX?: (seed: number, z: number) => number;
  /** Distance (m) to the nearest trail edge, or absent = no trail (consumers
   * treat as Infinity). Pure and deterministic like sample. */
  trailDistance?: (seed: number, x: number, z: number) => number;
  /** The seeded trail graph for this world, memoized per seed. */
  trailGraph?: (seed: number) => TrailGraph;
  /** Per-point multipliers and floors carved landmarks apply to tree and
   * boulder density; identity (`{1, 1, 0, 0}`) where nothing is carved. */
  landmarkMask?: (seed: number, x: number, z: number) => LandmarkMask;
  /** Per-point mask from the made features (the peak, the loop features):
   * tree/clutter multipliers, the meadow and bare flags. `h`, the ground
   * height AFTER the feature stage, is needed for the peak's treeline (a
   * height, not a radius) — a caller that already holds it should pass it;
   * the hook samples the composed field itself only when it is omitted. */
  featureMask?: (seed: number, x: number, z: number, h?: number) => FeatureMask;
  sample(worldSeed: number, x: number, z: number): TerrainSample;
};

export const DEFAULT_TERRAIN_VARIANT = "olympic";

const VARIANTS = new Map<string, TerrainVariant>();
let activeName = DEFAULT_TERRAIN_VARIANT;

export function registerTerrainVariant(variant: TerrainVariant): void {
  if (VARIANTS.has(variant.name)) {
    throw new Error(`terrain variant "${variant.name}" is already registered`);
  }
  VARIANTS.set(variant.name, variant);
}

export function terrainVariantNames(): readonly string[] {
  return [...VARIANTS.keys()];
}

export function terrainVariant(name: string): TerrainVariant | undefined {
  return VARIANTS.get(name);
}

export function setActiveTerrainVariant(name: string): void {
  if (!VARIANTS.has(name)) throw new Error(`unknown terrain variant "${name}"`);
  activeName = name;
}

export function activeTerrainVariantName(): string {
  return activeName;
}

export function activeTerrainVariant(): TerrainVariant {
  const v = VARIANTS.get(activeName);
  if (v === undefined) {
    throw new Error(`terrain variant "${activeName}" is not registered — import sim/passes/index.js first`);
  }
  return v;
}

/**
 * The continuous elevation field of the active variant, in metres. A pure
 * function of world coordinates, which is what makes chunk seams impossible:
 * neighbouring chunks evaluate this at the same coordinates and so agree.
 */
export function elevationAt(worldSeed: number, x: number, z: number): number {
  return activeTerrainVariant().sample(worldSeed, x, z).h;
}

/** Height plus its exact gradient — for normals, colours and spawn margins. */
export function elevationSampleAt(worldSeed: number, x: number, z: number): TerrainSample {
  return activeTerrainVariant().sample(worldSeed, x, z);
}
