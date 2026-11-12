/**
 * A hike's first scene, sampled ahead: everything the first renderer reads
 * from the sim's ground around the hike's start before it can show a frame.
 * The terrain's seven rings, the water's seven, the bed under the water, the
 * ocean's field, and for each lake its plants, its life's layout, its surface
 * and its skyline. One pure function makes them all, by the functions the
 * builders call themselves, so the world's worker can run it while the page
 * goes on (`world.worker.ts`), and each builder then takes its piece where
 * the piece is the one it would have made (the `fitting…` functions) and
 * samples for itself where it is not.
 *
 * Babylon-free, as everything it imports is: it runs in a worker.
 */
import { trailheadStart } from "../sim/spawn.js";
import { activeTerrainVariant, activeTerrainVariantName, setActiveTerrainVariant, type LakeSource } from "../sim/terrain.js";
import { BED_GRID, bakeBed, bedOriginFor, createBedGrid, type BedGrid } from "./bedHeight.js";
import { BASE_SPACING_BY_TIER, RING_COUNT, createRingSamples, ringSpacing, snapOrigin, type RingSamples } from "./clipmap.js";
import { skylineElevations, skylineTrees } from "./lakeSkyline.js";
import { lakeSurfaceDepths, lakeSurfaceGrid } from "./lakeSurfaceGrid.js";
import { SWELL_COMPONENTS, SWELL_COMPONENTS_LOW } from "./oceanSwell.js";
import { oceanFieldFor, type OceanField } from "./oceanWaves.js";
import type { QualityTier } from "./quality.js";
import { SWASH_FACE_LIFT_M } from "./swashRunUp.js";
import {
  WATER_RING_COUNT, createWaterRingSamples, seaFaceZ, waterHoleCellsFor, waterRingGeometry, waterRingSpacing, wetBounds,
  type WaterGeometry, type WaterRingSamples,
} from "./water.js";
import { WATER_BUMP_SIZE, waterBumpData } from "./waterBump.js";
import { waterLifeLayout, type WaterLifeLayout } from "./waterLifeField.js";
import { waterPlantPlacements, type WaterPlantPlacements } from "./waterPlantField.js";

/** A lake's surface as the renderer's mesh takes it: the grid (`lakeSurfaceGrid`) and the depth under each vertex. */
export type PreparedLakeSurface = {
  positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; depths: Float32Array;
};

export type PreparedLake = {
  /** The lake's centre: the key it is matched by. */
  cx: number;
  cz: number;
  plants: WaterPlantPlacements;
  /** The life's layout without its `lake`, which is the page's own object, put back on use. */
  life: Omit<WaterLifeLayout, "lake">;
  surface: PreparedLakeSurface;
  /** The skyline's elevations; null on the high tier, which draws none. */
  skyline: Float32Array | null;
};

/** A water ring as its mesh takes it the first time: the geometry, and the box of its wet cells (null: none wet). */
export type PreparedWaterRing = { geometry: WaterGeometry; bounds: { min: number[]; max: number[] } | null };

export type PreparedScene = {
  seed: number;
  variant: string;
  tier: QualityTier;
  /** Where everything centred on the start was sampled. */
  start: { x: number; z: number };
  /** `RING_COUNT` rings on the tier's base spacing (`BASE_SPACING_BY_TIER`). */
  rings: RingSamples[];
  /** `WATER_RING_COUNT` rings; null where the terrain has no water level. */
  waterRings: WaterRingSamples[] | null;
  /** Each water ring's first geometry and wet box, made from `waterRings` as the water's first emit makes them; null with no water. */
  waterFirst: PreparedWaterRing[] | null;
  /** The water's ripple bump (`waterBumpData`), a constant picture; null with no water. */
  waterBump: Uint8Array | null;
  /** The tier's bed (`BED_GRID`), baked at the start; null with no water. */
  bed: BedGrid | null;
  /** The ocean's field with the tier's count of components; null with no water. */
  ocean: OceanField | null;
  /** In the terrain's own order. */
  lakes: PreparedLake[];
};

/** The swell components a tier's sea draws: `createOcean`'s own rule. */
export function swellCountFor(tier: QualityTier): number {
  return tier === "low" ? SWELL_COMPONENTS_LOW : SWELL_COMPONENTS;
}

/** The terrain's lakes for `seed`, in its own order: the renderer's own reading of its water bodies. */
export function lakesFor(seed: number): LakeSource[] {
  return activeTerrainVariant().waterBodies?.(seed).filter((b): b is LakeSource => b.kind === "lake") ?? [];
}

/**
 * Samples it all, the active terrain set to `variant` first (an unknown one
 * throws). Everything centred on the camera is sampled where the hike's
 * player starts, `trailheadStart(seed)`, or at the origin on a terrain with
 * no trailhead.
 */
export function prepareScene(seed: number, variant: string, tier: QualityTier): PreparedScene {
  setActiveTerrainVariant(variant);
  const at = trailheadStart(seed);
  const start = { x: at?.x ?? 0, z: at?.z ?? 0 };
  const rings: RingSamples[] = [];
  for (let level = 0; level < RING_COUNT; level++) {
    rings.push(createRingSamples(seed, level, start.x, start.z, BASE_SPACING_BY_TIER[tier]));
  }
  const watered = activeTerrainVariant().waterLevel !== undefined;
  let waterRings: WaterRingSamples[] | null = null;
  let waterFirst: PreparedWaterRing[] | null = null;
  let waterBump: Uint8Array | null = null;
  let bed: BedGrid | null = null;
  let ocean: OceanField | null = null;
  if (watered) {
    waterRings = [];
    for (let level = 0; level < WATER_RING_COUNT; level++) {
      waterRings.push(createWaterRingSamples(seed, level, start.x, start.z));
    }
    const waterLevel = activeTerrainVariant().waterLevel as number;
    const faceZ = seaFaceZ(seed);
    waterFirst = waterRings.map((ring, level) => {
      const finer = level > 0 ? (waterRings as WaterRingSamples[])[level - 1] as WaterRingSamples : null;
      const geometry = waterRingGeometry(ring, finer === null ? null : waterHoleCellsFor(ring, finer), waterLevel);
      return { geometry, bounds: wetBounds(geometry, ring.h, SWASH_FACE_LIFT_M, faceZ) };
    });
    waterBump = waterBumpData();
    bed = createBedGrid(BED_GRID[tier].texels, BED_GRID[tier].spacing);
    bakeBed(bed, seed, start.x, start.z);
    ocean = oceanFieldFor(seed, swellCountFor(tier));
  }
  const lakes = lakesFor(seed).map((lake): PreparedLake => {
    const grid = lakeSurfaceGrid(lake.shape);
    const layout = waterLifeLayout(seed, lake);
    return {
      cx: lake.shape.cx,
      cz: lake.shape.cz,
      plants: waterPlantPlacements(seed, lake),
      life: { markers: layout.markers, beats: layout.beats, perches: layout.perches, stems: layout.stems, voices: layout.voices },
      surface: { ...grid, depths: lakeSurfaceDepths(seed, lake, grid.positions) },
      skyline: watered && tier !== "high" ? skylineElevations(lake, seed, skylineTrees(lake, seed)) : null,
    };
  });
  return { seed, variant, tier, start, rings, waterRings, waterFirst, waterBump, bed, ocean, lakes };
}

/**
 * Every typed array's buffer in `scene`, each once: the transfer list of the
 * message that carries it. Found by walking the scene, so a field added to a
 * piece later crosses by transfer too, never by copy.
 */
export function sceneTransfer(scene: PreparedScene): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const walk = (value: unknown): void => {
    if (ArrayBuffer.isView(value)) buffers.add(value.buffer as ArrayBuffer);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(scene);
  return [...buffers];
}

/** `scene` when it was sampled for this world: `seed` on the terrain that is active now. Else null. */
function sceneOf(scene: PreparedScene | null | undefined, seed: number): PreparedScene | null {
  if (scene === null || scene === undefined) return null;
  return scene.seed === seed && scene.variant === activeTerrainVariantName() ? scene : null;
}

/** Whether `rings` are the `count` rings a build with a camera at (camX, camZ) samples, ring `level` on `spacingOf(level)`. */
function standAt(
  rings: readonly { level: number; spacing: number; originX: number; originZ: number }[],
  count: number, spacingOf: (level: number) => number, camX: number, camZ: number,
): boolean {
  if (rings.length !== count) return false;
  return rings.every((ring, level) => {
    const spacing = spacingOf(level);
    return ring.level === level && ring.spacing === spacing
      && ring.originX === snapOrigin(camX, spacing) && ring.originZ === snapOrigin(camZ, spacing);
  });
}

/**
 * The scene's rings when they are what a clipmap's first build at `start` on
 * the base spacing `base` would sample, for `seed` on the active terrain;
 * else null, and the clipmap samples its own.
 */
export function fittingRings(
  scene: PreparedScene | null | undefined, seed: number, start: { x: number; z: number }, base: number,
): RingSamples[] | null {
  const from = sceneOf(scene, seed);
  if (from === null) return null;
  return standAt(from.rings, RING_COUNT, (level) => ringSpacing(level, base), start.x, start.z) ? from.rings : null;
}

/** The scene's water rings when they are what the water samples with its camera at (camX, camZ); else null. */
export function fittingWaterRings(
  scene: PreparedScene | null | undefined, seed: number, camX: number, camZ: number,
): WaterRingSamples[] | null {
  const rings = sceneOf(scene, seed)?.waterRings ?? null;
  if (rings === null) return null;
  return standAt(rings, WATER_RING_COUNT, waterRingSpacing, camX, camZ) ? rings : null;
}

/**
 * The scene's first water geometry when its rings are the water's own for a
 * camera at (camX, camZ) (`fittingWaterRings`): it was made from them, so it
 * fits where they do. Else null, and the water makes its own.
 */
export function fittingWaterFirst(
  scene: PreparedScene | null | undefined, seed: number, camX: number, camZ: number,
): PreparedWaterRing[] | null {
  if (fittingWaterRings(scene, seed, camX, camZ) === null) return null;
  const first = scene?.waterFirst ?? null;
  return first !== null && first.length === WATER_RING_COUNT ? first : null;
}

/** The scene's ripple bump when the scene is this world's and the picture is whole; else null. */
export function fittingWaterBump(scene: PreparedScene | null | undefined, seed: number): Uint8Array | null {
  const bump = sceneOf(scene, seed)?.waterBump ?? null;
  return bump !== null && bump.length === WATER_BUMP_SIZE * WATER_BUMP_SIZE * 4 ? bump : null;
}

/** The scene's bed when it is the tier's grid (`BED_GRID`) baked where a bake for a camera at (camX, camZ) stands; else null. */
export function fittingBed(
  scene: PreparedScene | null | undefined, seed: number, tier: QualityTier, camX: number, camZ: number,
): BedGrid | null {
  const bed = sceneOf(scene, seed)?.bed ?? null;
  if (bed === null) return null;
  const { texels, spacing } = BED_GRID[tier];
  const fits = bed.texels === texels && bed.spacing === spacing && bed.heights.length === texels * texels
    && bed.originX === bedOriginFor(camX, texels, spacing) && bed.originZ === bedOriginFor(camZ, texels, spacing);
  return fits ? bed : null;
}

/** The scene's ocean field when it holds the swell components `tier` draws; else null. */
export function fittingOcean(scene: PreparedScene | null | undefined, seed: number, tier: QualityTier): OceanField | null {
  const from = sceneOf(scene, seed);
  if (from === null || from.ocean === null) return null;
  return swellCountFor(from.tier) === swellCountFor(tier) ? from.ocean : null;
}

/**
 * The scene's pieces for `lake`, the terrain's lake number `index`: the entry
 * at that place when its centre is the lake's; else null, and each of the
 * lake's builders samples for itself.
 */
export function fittingLake(
  scene: PreparedScene | null | undefined, seed: number, lake: LakeSource, index: number,
): PreparedLake | null {
  const piece = sceneOf(scene, seed)?.lakes[index];
  if (piece === undefined) return null;
  return piece.cx === lake.shape.cx && piece.cz === lake.shape.cz ? piece : null;
}
