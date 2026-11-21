import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import {
  FADE_END, FADE_START, LAYER_F0, LAYER_ROUGHNESS, TEXTURE_MEAN, TILING_METRES,
  TERRAIN_SURFACE, emptyTerrainUniforms, terrainCoverFor, terrainSurfaceUnder, terrainUniforms, type TerrainUniformInputs,
} from "@csarkosh/engine/game/terrainUniforms";
import { WEATHER_PRESETS, WET_ALBEDO_LOSS, WET_ROUGHNESS_LOSS } from "@csarkosh/engine/game/weather";
import { featurePaintTable, followRoadCentre, roadCentreTable, trailPaintTable } from "@csarkosh/engine/game/terrainTables";
import { FEATURE_TEX_ROWS, FEATURE_TEX_WIDTH } from "@csarkosh/engine/game/featureTable";
import { ROAD_TABLE_HALF_SPAN, ROAD_TABLE_N, ROAD_TABLE_RECENTRE, ROAD_TABLE_STEP } from "@csarkosh/engine/game/roadPaint";
import { TRAIL_PAINT_BUCKET, TRAIL_PAINT_GRID } from "@csarkosh/engine/game/trailPaint";
import type { Feature } from "@csarkosh/engine/sim/features";
import type { TrailGraph } from "@csarkosh/engine/sim/trail";

/** A world with no road, trail or features, in dry weather, nothing drawn yet. */
const BARE: TerrainUniformInputs = {
  eye: null, wetness: 0, rain: 0, seconds: 0, sward: true, relief: false, road: null, trail: null, features: null,
};

describe("the terrain's uniforms", () => {
  it("are the look's constants by name, in the order the material declares them", () => {
    // The numbers the material was drawn with before they were made here.
    expect(terrainUniforms(BARE)).toEqual({
      terrainTiling: [1 / 2.0, 1 / 2.07, 1 / 1.8, 1 / 2.0],
      terrainRock2: [1 / 5.4, 0.5],
      terrainFade: [80, 140],
      terrainEye: [0, 0, 0],
      roadTable: [0, 0, 0, 0],
      trailInfo: [0, 0, 0, 0],
      terrainWet: [0],
      terrainRain: [0],
      terrainTime: [0],
      featureInfo: [0, 0, 0, 0],
      terrainLayerRough: [1.0, 1.0, 0.85, 0.95],
      terrainLayerRough2: [0.9, 0.9],
      terrainLayerF0: [0.5, 0.5, 1.0, 0.7],
      terrainLayerF02: [0.85, 1.0],
      terrainReliefOn: [0],
      terrainDetail: [1, 8, 20, 0.5],
      terrainDetail2: [0.7, 0.3, 0.7],
      terrainMacroOn: [1],
      terrainHorizon: [35, 90, 0.5],
      terrainTuft: [0.165, 0.205, 0.125],
      terrainSward: [0.047, 0.06, 0.036, 0.6],
      terrainSwardBand: [0.05, 0.5, 12, 18],
    });
    expect(Object.keys(terrainUniforms(BARE))).toEqual([
      "terrainTiling", "terrainRock2", "terrainFade", "terrainEye", "roadTable", "trailInfo", "terrainWet",
      "terrainRain", "terrainTime", "featureInfo", "terrainLayerRough", "terrainLayerRough2", "terrainLayerF0",
      "terrainLayerF02", "terrainReliefOn", "terrainDetail", "terrainDetail2", "terrainMacroOn", "terrainHorizon",
      "terrainTuft", "terrainSward", "terrainSwardBand",
    ]);
  });

  it("read the constants they are named for", () => {
    const u = terrainUniforms(BARE);
    expect(u.terrainTiling).toEqual([1 / TILING_METRES.grass, 1 / TILING_METRES.floor, 1 / TILING_METRES.sand, 1 / TILING_METRES.pebble]);
    expect(u.terrainRock2).toEqual([1 / TILING_METRES.rock, TEXTURE_MEAN]);
    expect(u.terrainFade).toEqual([FADE_START, FADE_END]);
    expect([...u.terrainLayerRough, ...u.terrainLayerRough2]).toEqual([...LAYER_ROUGHNESS]);
    expect([...u.terrainLayerF0, ...u.terrainLayerF02]).toEqual([...LAYER_F0]);
  });

  it("carry where the eye stands, the origin with no eye", () => {
    expect(terrainUniforms({ ...BARE, eye: { x: 12.5, y: 3, z: -400 } }).terrainEye).toEqual([12.5, 3, -400]);
    expect(terrainUniforms({ ...BARE, eye: undefined }).terrainEye).toEqual([0, 0, 0]);
  });

  it("hold the weather's wetness and rain to [0, 1] and fold the running time at an hour", () => {
    const u = terrainUniforms({ ...BARE, wetness: 0.4, rain: 0.5, seconds: 3601.25 });
    expect([u.terrainWet, u.terrainRain, u.terrainTime]).toEqual([[0.4], [0.5], [1.25]]);
    const over = terrainUniforms({ ...BARE, wetness: 2, rain: 7, seconds: 12 });
    expect([over.terrainWet, over.terrainRain, over.terrainTime]).toEqual([[1], [1], [12]]);
    const under = terrainUniforms({ ...BARE, wetness: -1, rain: -0.1 });
    expect([under.terrainWet, under.terrainRain]).toEqual([[0], [0]]);
  });

  it("pull the sward floor only where the blade field is drawn, the colour and the bands kept", () => {
    const off = terrainUniforms({ ...BARE, sward: false });
    expect(off.terrainSward).toEqual([0.047, 0.06, 0.036, 0]);
    expect(off.terrainSwardBand).toEqual([0.05, 0.5, 12, 18]);
  });

  it("turn the relief's height blend on once the decoded maps are bound", () => {
    expect(terrainUniforms({ ...BARE, relief: true }).terrainReliefOn).toEqual([1]);
  });

  it("carry where the road's table is centred, and follow it as the table follows the eye", () => {
    const road = roadCentreTable(7, (_seed, z) => 0.25 * z);
    const inputs = { ...BARE, road };
    expect(terrainUniforms(inputs).roadTable).toEqual([-ROAD_TABLE_HALF_SPAN, ROAD_TABLE_STEP, ROAD_TABLE_N, 1 / TILING_METRES.asphalt]);
    const eyeZ = ROAD_TABLE_RECENTRE + 100;
    expect(followRoadCentre(road, eyeZ)).toBe(true);
    expect(terrainUniforms(inputs).roadTable).toEqual([eyeZ - ROAD_TABLE_HALF_SPAN, 4, 2560, 1 / 3.0]);
  });

  it("carry where the trail's grid stands and how many features are painted", () => {
    const graph = {
      nodes: [{ x: 0, z: 0, h: 0, u: 0 }, { x: 120, z: 40, h: 0, u: 0 }],
      edges: [{ a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 1 }],
      trailhead: { x: 0, z: 0, u: 0 }, summit: 1, stem: [0], loops: [], features: [], stemLen: 126, fallbacks: 0,
    } as unknown as TrailGraph;
    const trail = trailPaintTable(graph);
    expect(terrainUniforms({ ...BARE, trail }).trailInfo).toEqual([trail.x0, trail.z0, 1 / TRAIL_PAINT_BUCKET, TRAIL_PAINT_GRID]);
    const features: Feature[] = [
      { id: 0, kind: "peak", x: 10, z: 20, radius: 220, height: 75, crestH: 300 },
      { id: 1, kind: "meadow", x: 500, z: 0, radius: 90, height: 60 },
    ];
    const table = featurePaintTable(features, new Float32Array(FEATURE_TEX_WIDTH * FEATURE_TEX_ROWS * 4));
    expect(terrainUniforms({ ...BARE, features: table }).featureInfo).toEqual([2, 0, 0, 0]);
  });

  it("fill the record handed in, every component again, and make none of their own", () => {
    const out = emptyTerrainUniforms();
    const tiling = out.terrainTiling;
    expect(terrainUniforms({ ...BARE, wetness: 1, eye: { x: 1, y: 2, z: 3 }, relief: true }, out)).toBe(out);
    expect(out.terrainTiling).toBe(tiling);
    expect([out.terrainWet, out.terrainEye, out.terrainReliefOn]).toEqual([[1], [1, 2, 3], [1]]);
    // A second fill leaves nothing of the first.
    terrainUniforms(BARE, out);
    expect(out).toEqual(terrainUniforms(BARE));
  });
});

describe("the terrain material's own surface", () => {
  it("is white, rough and no metal when dry", () => {
    expect(TERRAIN_SURFACE).toEqual({ albedo: [1, 1, 1], roughness: 0.95, metallic: 0 });
    expect(terrainSurfaceUnder(WEATHER_PRESETS.clear)).toEqual({ albedo: [1, 1, 1], roughness: 0.95, metallic: 0 });
  });

  it("darkens and glosses with the weather's wetness, from the dry value each time", () => {
    const soaked = terrainSurfaceUnder(WEATHER_PRESETS.rain); // wetness 1
    expect(soaked.albedo).toEqual([1 - WET_ALBEDO_LOSS, 1 - WET_ALBEDO_LOSS, 1 - WET_ALBEDO_LOSS]);
    expect(soaked.roughness).toBe(0.95 * (1 - WET_ROUGHNESS_LOSS));
    expect(soaked.metallic).toBe(0);
    const half = terrainSurfaceUnder({ ...WEATHER_PRESETS.clear, wetness: 0.5 });
    expect(half.albedo[0]).toBe(1 - WET_ALBEDO_LOSS * 0.5);
    expect(half.roughness).toBe(0.95 * (1 - WET_ROUGHNESS_LOSS * 0.5));
    // A record of its own: the dry surface is left as it is.
    expect(terrainSurfaceUnder(WEATHER_PRESETS.clear).albedo).not.toBe(TERRAIN_SURFACE.albedo);
  });
});

describe("what of the terrain's material follows the tier", () => {
  it("pulls the sward floor where the blade field is drawn, and takes the far cover's low band where the clutter is drawn short", () => {
    expect(terrainCoverFor("low")).toEqual({ sward: false, farLow: true });
    expect(terrainCoverFor("medium")).toEqual({ sward: true, farLow: false });
    expect(terrainCoverFor("high")).toEqual({ sward: true, farLow: false });
  });
});
