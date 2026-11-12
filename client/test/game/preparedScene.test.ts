import { afterEach, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { activeTerrainVariant, activeTerrainVariantName, elevationAt, setActiveTerrainVariant, type LakeSource } from "../../src/sim/terrain.js";
import { trailheadStart } from "../../src/sim/spawn.js";
import { firstPondWorld } from "../sim/helpers/lakes.js";
import { BASE_SPACING_BY_TIER, RING_COUNT, createRingSamples } from "../../src/game/clipmap.js";
import { WATER_RING_COUNT, createWaterRingSamples, seaFaceZ, waterHoleCellsFor, waterRingGeometry, wetBounds } from "../../src/game/water.js";
import { SWASH_FACE_LIFT_M } from "../../src/game/swashRunUp.js";
import { BED_GRID, bakeBed, createBedGrid } from "../../src/game/bedHeight.js";
import { oceanFieldFor } from "../../src/game/oceanWaves.js";
import { SWELL_COMPONENTS, SWELL_COMPONENTS_LOW } from "../../src/game/oceanSwell.js";
import { waterLifeBed, waterLifeLayout, type WaterLifeLayout } from "../../src/game/waterLifeField.js";
import { skylineElevations, skylineTrees } from "../../src/game/lakeSkyline.js";
import { lakeSurfaceGrid } from "../../src/game/lakeSurfaceGrid.js";
import { waterPlantPlacements } from "../../src/game/waterPlantField.js";
import { prepareScene, sceneTransfer, type PreparedScene } from "../../src/game/preparedScene.js";
import { waterBumpData } from "../../src/game/waterBump.js";
import { featureTableFor } from "../../src/game/featureTable.js";
import { timeLimit } from "../helpers/timeLimit.js";

const before = activeTerrainVariantName();
afterEach(() => setActiveTerrainVariant(before));

/** A lobby world with a lake, found once: each world tried is a bowl build. */
let pondSeed: number | null = null;
const seedWithLake = (): number => (pondSeed ??= firstPondWorld().seed);
/** The world's lakes, in the variant's order, read as the renderer reads them. */
const lakesOf = (seed: number): LakeSource[] => {
  setActiveTerrainVariant("olympic");
  return (activeTerrainVariant().waterBodies?.(seed) ?? []).filter((b): b is LakeSource => b.kind === "lake");
};

/** The low tier's scene of the lake world, sampled once for the tests that only read it. */
let lowScene: PreparedScene | null = null;
const low = (): PreparedScene => (lowScene ??= prepareScene(seedWithLake(), "olympic", "low"));

describe("a hike's first scene, sampled ahead", () => {
  it("samples the rings, the water and each lake as the builders do, around the hike's start", () => {
    const seed = seedWithLake();
    const scene = low();
    setActiveTerrainVariant("olympic");
    const start = trailheadStart(seed) ?? { x: 0, z: 0 };
    expect(scene.seed).toBe(seed);
    expect(scene.variant).toBe("olympic");
    expect(scene.tier).toBe("low");
    expect(scene.start).toEqual({ x: start.x, z: start.z });
    expect(scene.rings).toHaveLength(RING_COUNT);
    expect(scene.rings[3]).toEqual(createRingSamples(seed, 3, start.x, start.z, BASE_SPACING_BY_TIER.low));
    expect(scene.waterRings).toHaveLength(WATER_RING_COUNT);
    expect(scene.waterRings?.[2]).toEqual(createWaterRingSamples(seed, 2, start.x, start.z));
    // Each water ring's first geometry and wet box, as the water's own first emit makes them.
    expect(scene.waterFirst).toHaveLength(WATER_RING_COUNT);
    const waterLevel = activeTerrainVariant().waterLevel as number;
    for (const level of [0, 2]) {
      const ring = createWaterRingSamples(seed, level, start.x, start.z);
      const finer = level > 0 ? createWaterRingSamples(seed, level - 1, start.x, start.z) : null;
      const geometry = waterRingGeometry(ring, finer === null ? null : waterHoleCellsFor(ring, finer), waterLevel);
      expect(scene.waterFirst?.[level]).toEqual({ geometry, bounds: wetBounds(geometry, ring.h, SWASH_FACE_LIFT_M, seaFaceZ(seed)) });
    }
    const bed = createBedGrid(BED_GRID.low.texels, BED_GRID.low.spacing);
    bakeBed(bed, seed, start.x, start.z);
    expect(scene.bed).toEqual(bed);
    expect(scene.ocean).toEqual(oceanFieldFor(seed, SWELL_COMPONENTS_LOW));
    expect(scene.waterBump).toEqual(waterBumpData());
    expect(scene.featureTable).toEqual(featureTableFor(seed));
    expect(scene.featureTable).not.toBeNull();
    const lakes = lakesOf(seed);
    expect(lakes.length).toBeGreaterThan(0);
    expect(scene.lakes.map((l) => [l.cx, l.cz])).toEqual(lakes.map((l) => [l.shape.cx, l.shape.cz]));
    const lake = lakes[0] as LakeSource;
    expect(scene.lakes[0]?.plants).toEqual(waterPlantPlacements(seed, lake));
    const layout = waterLifeLayout(seed, lake);
    const life: Partial<WaterLifeLayout> = { ...layout };
    delete life.lake;
    // The life's layout, and with it the far chorus's two places on the shore.
    expect(scene.lakes[0]?.life).toEqual({ ...life, bed: waterLifeBed(lake, layout.voices) });
    expect(scene.lakes[0]?.skyline).toEqual(skylineElevations(lake, seed, skylineTrees(lake, seed)));
  }, timeLimit(180_000));

  it("makes the lake's surface as the renderer's own grid and depths", () => {
    const seed = seedWithLake();
    const surface = low().lakes[0]!.surface;
    const lake = lakesOf(seed)[0] as LakeSource;
    const grid = lakeSurfaceGrid(lake.shape);
    expect(surface.positions).toEqual(grid.positions);
    expect(surface.normals).toEqual(grid.normals);
    expect(surface.uvs).toEqual(grid.uvs);
    expect(surface.indices).toEqual(grid.indices);
    const count = grid.positions.length / 3;
    expect(surface.depths).toHaveLength(count);
    for (const i of [0, 1, Math.floor(count / 2), count - 1]) {
      const wx = lake.shape.cx + (grid.positions[i * 3] as number);
      const wz = lake.shape.cz + (grid.positions[i * 3 + 2] as number);
      expect(surface.depths[i]).toBe(Math.fround(Math.max(0, lake.level - elevationAt(seed, wx, wz))));
    }
    expect(Math.max(...surface.depths)).toBeGreaterThan(0);
  }, timeLimit(180_000));

  it("draws no skyline for the high tier, and takes its base spacing, its bed and its swell from the tier", () => {
    const seed = seedWithLake();
    const scene = prepareScene(seed, "olympic", "high");
    expect(scene.tier).toBe("high");
    expect(scene.lakes.length).toBeGreaterThan(0);
    for (const lake of scene.lakes) expect(lake.skyline).toBeNull();
    expect(scene.rings[0]?.spacing).toBe(BASE_SPACING_BY_TIER.high);
    expect(scene.bed?.texels).toBe(BED_GRID.high.texels);
    expect(scene.bed?.spacing).toBe(BED_GRID.high.spacing);
    expect(scene.ocean?.count).toBe(SWELL_COMPONENTS);
  }, timeLimit(180_000));

  it("has no water and no lakes on a terrain without them, and leaves that terrain active", () => {
    const scene = prepareScene(7, "montane", "low");
    expect(activeTerrainVariantName()).toBe("montane");
    expect(scene.start).toEqual({ x: 0, z: 0 });
    expect(scene.rings).toHaveLength(RING_COUNT);
    expect(scene.rings[0]).toEqual(createRingSamples(7, 0, 0, 0, BASE_SPACING_BY_TIER.low));
    expect(scene.waterRings).toBeNull();
    expect(scene.waterFirst).toBeNull();
    expect(scene.waterBump).toBeNull();
    expect(scene.featureTable).toBeNull();
    expect(scene.bed).toBeNull();
    expect(scene.ocean).toBeNull();
    expect(scene.lakes).toEqual([]);
  }, timeLimit(180_000));

  it("refuses a terrain the sim does not know", () => {
    expect(() => prepareScene(7, "nowhere", "low")).toThrow(/unknown terrain variant/);
  });

  it("survives a structured clone with its buffers transferred, and lists each buffer once", () => {
    const scene = prepareScene(seedWithLake(), "olympic", "low");
    const copy = structuredClone(scene);
    const transfer = sceneTransfer(scene);
    expect(new Set(transfer).size).toBe(transfer.length);
    // A ring's ten arrays, a water ring's one and its first geometry's seven, the bed, the ocean's table, the
    // ripple bump, the feature table, and a lake's surface (five) and skyline.
    expect(transfer.length).toBe(RING_COUNT * 10 + WATER_RING_COUNT * 8 + 4 + scene.lakes.length * 6);
    const moved = structuredClone(scene, { transfer });
    expect(moved).toEqual(copy);
    // Moved, not copied: no typed array anywhere in what was sent still holds its bytes.
    const left: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (ArrayBuffer.isView(value)) {
        if (value.byteLength > 0) left.push(path);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(scene, "scene");
    expect(left).toEqual([]);
    expect(scene.rings[0]?.h.byteLength).toBe(0);
  }, timeLimit(180_000));
});
