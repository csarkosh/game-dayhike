import { describe, expect, it } from "vitest";
import {
  featurePaintTable, followRoadCentre, roadCentreTable, terrainTablesFor, trailPaintTable,
} from "@csarkosh/engine/game/terrainTables";
import { FEATURE_PAINT_MAX, FEATURE_TEX_ROWS, FEATURE_TEX_WIDTH, featureTable, featureTableFor, paintedLakes } from "@csarkosh/engine/game/featureTable";
import { ROAD_TABLE_N, ROAD_TABLE_RECENTRE, ROAD_TABLE_STEP, buildRoadTable, roadTableZ0 } from "@csarkosh/engine/game/roadPaint";
import { bakeShoreAtlas } from "@csarkosh/engine/game/shoreAtlas";
import { TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_TABLE_ROWS, buildTrailTable, trailSegments } from "@csarkosh/engine/game/trailPaint";
import type { Feature } from "@csarkosh/engine/sim/features";
import "../../src/sim/passes/index.js";
import { activeTerrainVariant, activeTerrainVariantName, setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import type { TrailGraph } from "@csarkosh/engine/sim/trail";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";

const centerX = (_seed: number, z: number): number => -300 + 0.25 * z;

describe("the road's centreline table", () => {
  it("is one row of ROAD_TABLE_N floats, the centreline about z = 0", () => {
    const road = roadCentreTable(7, centerX);
    expect([road.width, road.height, road.channels]).toEqual([ROAD_TABLE_N, 1, 1]);
    expect(road.data).toHaveLength(road.width * road.height * road.channels);
    expect(road.centreZ).toBe(0);
    expect(road.data).toEqual(buildRoadTable(7, 0, centerX));
    // Texel i is the hook at z0 + i · step.
    expect(road.data[10]).toBe(Math.fround(centerX(7, roadTableZ0(0) + 10 * ROAD_TABLE_STEP)));
  });

  it("stays where it is while the eye is within the recentre distance, then is filled again about the eye, in place", () => {
    const road = roadCentreTable(7, centerX);
    const data = road.data;
    expect(followRoadCentre(road, ROAD_TABLE_RECENTRE)).toBe(false);
    expect(followRoadCentre(road, -ROAD_TABLE_RECENTRE)).toBe(false);
    expect(road.centreZ).toBe(0);
    expect(followRoadCentre(road, ROAD_TABLE_RECENTRE + 1)).toBe(true);
    expect(road.centreZ).toBe(ROAD_TABLE_RECENTRE + 1);
    expect(road.data).toBe(data);
    expect(road.data).toEqual(buildRoadTable(7, ROAD_TABLE_RECENTRE + 1, centerX));
    // From the new centre, the same distance again.
    expect(followRoadCentre(road, 2 * ROAD_TABLE_RECENTRE + 1)).toBe(false);
    expect(followRoadCentre(road, 0)).toBe(true);
    expect(road.centreZ).toBe(0);
  });
});

describe("the trail's table", () => {
  const graph = {
    nodes: [{ x: 0, z: 0, h: 0, u: 0 }, { x: 120, z: 40, h: 0, u: 0 }, { x: 260, z: 10, h: 0, u: 0 }],
    edges: [
      { a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 0.5 },
      { a: 1, b: 2, kind: "stem", profile: new Float64Array(2), progress0: 0.5, progress1: 1 },
    ],
    trailhead: { x: 0, z: 0, u: 0 }, summit: 2, stem: [0, 1], loops: [], features: [], stemLen: 270, fallbacks: 0,
  } as unknown as TrailGraph;

  it("is the segment list and the bucket grid in one RGBA table, with where the grid stands", () => {
    const table = trailPaintTable(graph);
    const built = buildTrailTable(trailSegments(graph));
    expect([table.width, table.height, table.channels]).toEqual([TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_TABLE_ROWS, 4]);
    expect(table.data).toHaveLength(table.width * table.height * table.channels);
    expect(table.data).toEqual(built.data);
    expect([table.x0, table.z0, table.overflow]).toEqual([built.x0, built.z0, false]);
  });
});

describe("the made features' table", () => {
  const features: Feature[] = [
    { id: 0, kind: "peak", x: 10, z: 20, radius: 220, height: 75, crestH: 300 },
    { id: 1, kind: "meadow", x: 500, z: 0, radius: 90, height: 60 },
  ];

  it("is the features over their shore atlas, baked when none is handed in", () => {
    const table = featurePaintTable(features);
    expect([table.width, table.height, table.channels]).toEqual([FEATURE_TEX_WIDTH, FEATURE_TEX_ROWS, 4]);
    expect(table.data).toHaveLength(table.width * table.height * table.channels);
    expect(table.data).toEqual(featureTable(features, bakeShoreAtlas(paintedLakes(features))));
    expect(table.count).toBe(2);
  });

  it("takes a table made already as it is, and counts at most FEATURE_PAINT_MAX features", () => {
    const made = new Float32Array(FEATURE_TEX_WIDTH * FEATURE_TEX_ROWS * 4);
    expect(featurePaintTable(features, made).data).toBe(made);
    expect(featurePaintTable(features, null).data).not.toBe(made);
    const many: Feature[] = Array.from({ length: FEATURE_PAINT_MAX + 2 }, (_, i) => ({
      id: i, kind: "meadow", x: i * 100, z: 0, radius: 50, height: 10,
    }));
    expect(featurePaintTable(many, made).count).toBe(FEATURE_PAINT_MAX);
    expect(featurePaintTable([], made).count).toBe(0);
  });
});

describe("a world's tables, made from its seed alone", { timeout: timeLimit(120_000) }, () => {
  it("are the road, the trail and the features of the active terrain, and none on a terrain with neither road nor trail", () => {
    const before = activeTerrainVariantName();
    try {
      setActiveTerrainVariant("olympic");
      const seed = 388817;
      const variant = activeTerrainVariant();
      const graph = variant.trailGraph!(seed);
      const tables = terrainTablesFor(seed);
      expect(tables.road!.data).toEqual(buildRoadTable(seed, 0, variant.roadCenterX!));
      expect(tables.trail!.data).toEqual(buildTrailTable(trailSegments(graph)).data);
      expect(tables.features!.data).toEqual(featureTableFor(seed));
      expect(tables.features!.count).toBe(Math.min(graph.features.length, FEATURE_PAINT_MAX));
      // The feature table the world's worker made is taken, not baked again.
      const made = featureTableFor(seed)!;
      expect(terrainTablesFor(seed, made).features!.data).toBe(made);
      setActiveTerrainVariant("montane");
      expect(terrainTablesFor(seed)).toEqual({ road: null, trail: null, features: null });
    } finally {
      setActiveTerrainVariant(before);
    }
  });
});
