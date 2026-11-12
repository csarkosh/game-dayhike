import { afterEach, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { activeTerrainVariantName, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { BASE_SPACING_BY_TIER, RING_COUNT, createRingSamples } from "../../src/game/clipmap.js";
import { WATER_RING_COUNT, createWaterRingSamples } from "../../src/game/water.js";
import { BED_GRID, bakeBed, createBedGrid } from "../../src/game/bedHeight.js";
import { oceanFieldFor } from "../../src/game/oceanWaves.js";
import { SWELL_COMPONENTS, SWELL_COMPONENTS_LOW } from "../../src/game/oceanSwell.js";
import {
  fittingBed, fittingOcean, fittingRings, fittingWaterRings, type PreparedScene,
} from "../../src/game/preparedScene.js";
import type { QualityTier } from "../../src/game/quality.js";
import { timeLimit } from "../helpers/timeLimit.js";

const before = activeTerrainVariantName();
afterEach(() => setActiveTerrainVariant(before));

const SEED = 0x7e44a1;
const START = { x: 437.25, z: -1290.5 };

/** A scene made by hand, piece by piece, as `prepareScene` makes one: cheap enough to make per test. */
function sceneAt(start: { x: number; z: number }, tier: QualityTier = "low", seed = SEED): PreparedScene {
  setActiveTerrainVariant("olympic");
  const bed = createBedGrid(BED_GRID[tier].texels, BED_GRID[tier].spacing);
  bakeBed(bed, seed, start.x, start.z);
  return {
    seed, variant: "olympic", tier, start,
    rings: Array.from({ length: RING_COUNT }, (_, level) => createRingSamples(seed, level, start.x, start.z, BASE_SPACING_BY_TIER[tier])),
    waterRings: Array.from({ length: WATER_RING_COUNT }, (_, level) => createWaterRingSamples(seed, level, start.x, start.z)),
    bed,
    ocean: oceanFieldFor(seed, tier === "low" ? SWELL_COMPONENTS_LOW : SWELL_COMPONENTS),
    lakes: [],
  };
}

describe("whether a piece sampled ahead is the one a builder would make", () => {
  it("takes the rings made for the builder's start, seed and base spacing", () => {
    const scene = sceneAt(START);
    expect(fittingRings(scene, SEED, START, BASE_SPACING_BY_TIER.low)).toBe(scene.rings);
    // Anywhere every ring snaps to the same origin is the same build: ring 0 snaps every 4 m on the low tier.
    expect(fittingRings(scene, SEED, { x: START.x + 0.5, z: START.z }, BASE_SPACING_BY_TIER.low)).toBe(scene.rings);
  }, timeLimit(60_000));

  it("refuses rings for another start, base spacing, seed or terrain, a short list, and no scene", () => {
    const scene = sceneAt(START);
    const base = BASE_SPACING_BY_TIER.low;
    expect(fittingRings(scene, SEED, { x: START.x + 8, z: START.z }, base)).toBeNull();
    expect(fittingRings(scene, SEED, { x: 0, z: 0 }, base)).toBeNull();
    expect(fittingRings(scene, SEED, START, BASE_SPACING_BY_TIER.high)).toBeNull();
    expect(fittingRings(scene, SEED + 1, START, base)).toBeNull();
    expect(fittingRings({ ...scene, rings: scene.rings.slice(1) }, SEED, START, base)).toBeNull();
    expect(fittingRings({ ...scene, rings: [...scene.rings].reverse() }, SEED, START, base)).toBeNull();
    expect(fittingRings(null, SEED, START, base)).toBeNull();
    expect(fittingRings(undefined, SEED, START, base)).toBeNull();
    setActiveTerrainVariant("montane");
    expect(fittingRings(scene, SEED, START, base)).toBeNull();
  }, timeLimit(60_000));

  it("takes the water's rings where the camera's snapped origins are theirs, and refuses them elsewhere", () => {
    const scene = sceneAt(START);
    expect(fittingWaterRings(scene, SEED, START.x, START.z)).toBe(scene.waterRings);
    expect(fittingWaterRings(scene, SEED, START.x + 64, START.z)).toBeNull();
    expect(fittingWaterRings(scene, SEED + 1, START.x, START.z)).toBeNull();
    expect(fittingWaterRings({ ...scene, waterRings: null }, SEED, START.x, START.z)).toBeNull();
    expect(fittingWaterRings({ ...scene, waterRings: (scene.waterRings ?? []).slice(0, 3) }, SEED, START.x, START.z)).toBeNull();
    expect(fittingWaterRings(null, SEED, START.x, START.z)).toBeNull();
    setActiveTerrainVariant("montane");
    expect(fittingWaterRings(scene, SEED, START.x, START.z)).toBeNull();
  }, timeLimit(60_000));

  it("takes the bed of the builder's tier baked where a bake at the camera would stand, and refuses another", () => {
    const scene = sceneAt(START);
    expect(fittingBed(scene, SEED, "low", START.x, START.z)).toBe(scene.bed);
    // The high tier's bed is another size.
    expect(fittingBed(scene, SEED, "high", START.x, START.z)).toBeNull();
    // A camera a whole extent away bakes another square.
    expect(fittingBed(scene, SEED, "low", START.x + BED_GRID.low.texels * BED_GRID.low.spacing, START.z)).toBeNull();
    expect(fittingBed(scene, SEED + 1, "low", START.x, START.z)).toBeNull();
    expect(fittingBed({ ...scene, bed: null }, SEED, "low", START.x, START.z)).toBeNull();
    expect(fittingBed(null, SEED, "low", START.x, START.z)).toBeNull();
  }, timeLimit(60_000));

  it("takes the ocean's field where the tier draws as many swell components as it was made with", () => {
    const scene = sceneAt(START);
    expect(fittingOcean(scene, SEED, "low")).toBe(scene.ocean);
    expect(fittingOcean(scene, SEED, "medium")).toBeNull();
    expect(fittingOcean(scene, SEED + 1, "low")).toBeNull();
    expect(fittingOcean({ ...scene, ocean: null }, SEED, "low")).toBeNull();
    expect(fittingOcean(null, SEED, "low")).toBeNull();
    // Medium and high draw the same twelve: a field made for one fits the other.
    const medium = sceneAt(START, "medium");
    expect(fittingOcean(medium, SEED, "high")).toBe(medium.ocean);
  }, timeLimit(60_000));
});
