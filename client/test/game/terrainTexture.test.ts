import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import {
  attachTerrainTexture, enableRoadPaint, enableFeaturePaint, setTerrainRain, TerrainTexturePlugin,
  heightBlendWeights, HEIGHT_BLEND_DEPTH, LAYER_ROUGHNESS, LAYER_F0,
  rockParallaxOffset, ROCK_PARALLAX_DEPTH, ROCK_PARALLAX_STEPS, ROCK_PARALLAX_MIN_WEIGHT,
  terrainFarCoverDefs, TERRAIN_FRAGMENT_FAR_COVER, TERRAIN_MACRO_OCTAVES, HEX_FETCH_MACROS, TERRAIN_UNIFORMITY_OFF,
  TERRAIN_FRAGMENT_FAR_LIGHT, TERRAIN_SPEC_INJECTION_POINT, TERRAIN_SPEC_INJECTION_CODE, TERRAIN_SUN_INJECTION_CODE,
} from "../../src/game/terrainTexture.js";
import { FEATURE_FRAGMENT_PAINT, FEATURE_PAINT_MAX } from "../../src/game/featurePaint.js";
import {
  DETAIL_TILING, DETAIL_FADE, DETAIL_NORMAL, DETAIL_AO, DETAIL_AO_RANGE,
  HORIZON, HORIZON_MAX, TUFT_ALBEDO, swardWeight,
} from "../../src/game/groundHexParams.js";
import type { Feature } from "../../src/sim/features.js";
import type { TrailGraph } from "../../src/sim/trail.js";
import { TRAIL_FRAGMENT_PAINT, TRAIL_PAINT_MAX_SEGMENTS } from "../../src/game/trailPaint.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import "../../src/sim/passes/index.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { ROAD_FRAGMENT_DEFS, ROAD_FRAGMENT_PAINT } from "../../src/game/roadPaint.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/pbr.fragment.js";
import "@babylonjs/core/Shaders/ShadersInclude/lightFragment.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { FOLIAGE_LIGHT_INJECTION_POINT } from "../../src/game/foliageLightPlugin.js";
import { attachWet } from "../../src/game/wetPlugin.js";
import groundHexNoise from "../../src/game/shaders/groundHexNoise.fragment.fx?raw";
import { timeLimit } from "../helpers/timeLimit.js";

/** The cover's factor on the sun's diffuse line, as the line carries it. */
const FAR_SUN_FACTOR =
  "*mix(1.0,min(clamp(dot(terrainFarN,preInfo.L),0.0,1.0)/preInfo.NdotL,2.0)*mix(0.5,1.0,clamp(dot(viewDirectionW,preInfo.L),0.0,1.0)),terrainFarW)";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

/** A stand-in for `loadGroundArrays`, whose real loader fetches and decodes
 * the ground's layer images: every test that attaches the plugin passes this
 * factory instead of letting the constructor call the real loader. */
const stubArrays = (s: Scene) => {
  const tex = (name: string) => { const t = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, s); t.name = name; return t; };
  return { normals: tex("terrainNormals"), rah: tex("terrainRAH"), ready: Promise.resolve(), dispose() {} };
};

describe("terrain texture plugin", () => {
  it("registers once per material and activates through the manager", () => {
    const mat = new PBRMaterial("t1", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays }); // idempotent
    const plugin = mat.pluginManager?.getPlugin("TerrainTexture");
    expect(plugin).toBeInstanceOf(TerrainTexturePlugin);
    // Activation is what makes prepareDefines/bindForSubMesh/custom code run at
    // all: Babylon dispatches over _activePlugins, not _plugins. Without this
    // assertion, dropping `_enable(true)` is a silent, untested feature death —
    // the gap foliagePlugin.test.ts had to be corrected for.
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active).toContain(plugin);
    // …and activated exactly once, which is what makes `attachTerrainTexture`'s
    // early return load-bearing rather than decorative. Babylon's name dedup in
    // `_addPlugin` (materialPluginManager.pure.js:28-33) does keep `_plugins` at
    // one entry, but it returns false silently and the discarded second
    // instance's own `_enable(true)` still reaches `_activatePlugin`, which
    // dedups by IDENTITY (line 67) — so a second attach leaves TWO active
    // plugins. That injects the whole GLSL block twice (redeclaring vTerrainW,
    // which will not compile) and loads five more textures nothing disposes.
    // `toContain` alone cannot see any of it.
    expect(active.filter((p) => p instanceof TerrainTexturePlugin)).toHaveLength(1);
  });

  it("declares both weight attributes and the seven samplers", () => {
    const mat = new PBRMaterial("t2", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const attrs: string[] = [];
    plugin.getAttributes(attrs, scene, undefined as never);
    expect(attrs).toEqual(expect.arrayContaining(["terrainWeights", "terrainWeights2", "terrainCover"]));
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toEqual(expect.arrayContaining([
      "terrainGrass", "terrainFloor", "terrainRock", "terrainSand", "terrainPebble",
      "terrainNormals", "terrainRAH",
    ]));
  });

  it("declares the cover attribute and its varying as floats", () => {
    const plugin = pluginFor("tc");
    const vert = plugin.getCustomCode("vertex")!;
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).toContain("attribute float terrainCover;");
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).toContain("varying float vTerrainCover;");
    expect(vert.CUSTOM_VERTEX_MAIN_END).toContain("vTerrainCover = terrainCover;");
    expect(plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS).toContain("varying float vTerrainCover;");
  });

  it("declares the second weight attribute and varying as vec4, duff in z and canopy in w", () => {
    const plugin = pluginFor("t2b");
    const vert = plugin.getCustomCode("vertex")!;
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).toContain("attribute vec4 terrainWeights2;");
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).toContain("varying vec4 vTerrainW2;");
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).not.toContain("vec3 terrainWeights2");
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).not.toContain("vec3 vTerrainW2");
    const frag = plugin.getCustomCode("fragment")!;
    expect(frag.CUSTOM_FRAGMENT_DEFINITIONS).toContain("varying vec4 vTerrainW2;");
    expect(frag.CUSTOM_FRAGMENT_DEFINITIONS).not.toContain("vec3 vTerrainW2");
  });

  it("injects at the albedo hook and nowhere that would overwrite lighting", () => {
    const mat = new PBRMaterial("t3", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const frag = plugin.getCustomCode("fragment");
    expect(Object.keys(frag!)).toContain("CUSTOM_FRAGMENT_BEFORE_LIGHTS");
    expect(Object.keys(frag!)).toContain("CUSTOM_FRAGMENT_DEFINITIONS");
    // Albedo only: touching the final colour would fight the cel-shading plugin,
    // which bands lighting downstream of this hook.
    expect(Object.keys(frag!)).not.toContain("CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR");
    const glsl = frag!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(glsl).toContain("surfaceAlbedo");
    // Rock is the only triplanar layer: three projections of one sampler.
    expect(glsl.match(/texture2D\(\s*terrainRock/g)!.length).toBe(3);
    // Grass is the one layer that is hex tiled, so its blended albedo comes
    // through hexFetch2D and never through a plain fetch. The near-eye detail
    // scale adds a normal and an occlusion only, not a second albedo fetch.
    expect(glsl.match(/texture2D\(\s*terrainGrass/g) ?? []).toHaveLength(0);
    expect(glsl.match(/hexFetch2D\(terrainGrass/g)!.length).toBe(1);
    const vert = plugin.getCustomCode("vertex");
    expect(Object.keys(vert!)).toContain("CUSTOM_VERTEX_MAIN_END");
  });

  it("sets its define so the shader branch compiles in", () => {
    const mat = new PBRMaterial("t4", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const defines: Record<string, boolean> = { TERRAINTEX: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.TERRAINTEX).toBe(true);
  });

  it("keeps road paint off until a centerline hook is supplied", () => {
    const plugin = pluginFor("r0");
    expect(plugin.roadEnabled).toBe(false);
    const defines: Record<string, boolean> = { TERRAINTEX: false, ROADPAINT: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.ROADPAINT).toBe(false);
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).not.toContain("roadCenter");
    expect(samplers).not.toContain("roadAsphalt");
  });

  it("enables road paint with the hook: define, both samplers, the table uniform", () => {
    const plugin = pluginFor("r1");
    plugin.enableRoad(7, (_seed, z) => -300 + 0.25 * z);
    expect(plugin.roadEnabled).toBe(true);
    const defines: Record<string, boolean> = { TERRAINTEX: false, ROADPAINT: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.ROADPAINT).toBe(true);
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toEqual(expect.arrayContaining(["roadCenter", "roadAsphalt"]));
    const names = plugin.getUniforms().ubo.map((u) => u.name);
    expect(names).toContain("roadTable");
    const frag = plugin.getCustomCode("fragment")!;
    expect(frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("roadCenter");
    expect(frag.CUSTOM_FRAGMENT_DEFINITIONS).toContain("uniform sampler2D roadAsphalt;");
    // Road AFTER ground blend, so it overrides the textured colour.
    const glsl = frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(glsl.indexOf("terrainGrass")).toBeLessThan(glsl.indexOf("roadCenter"));
  });

  it("enableRoadPaint reads the active variant's hook and is a no-op without one", () => {
    setActiveTerrainVariant("montane");
    const bare = new PBRMaterial("r2", scene);
    attachTerrainTexture(scene, bare, { groundArrays: stubArrays });
    enableRoadPaint(scene, bare, 7);
    expect((bare.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin).roadEnabled).toBe(false);
    setActiveTerrainVariant("olympic");
    const road = new PBRMaterial("r3", scene);
    attachTerrainTexture(scene, road, { groundArrays: stubArrays });
    enableRoadPaint(scene, road, 7);
    expect((road.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin).roadEnabled).toBe(true);
  });
});

const testFeatures: Feature[] = [
  { id: 0, kind: "peak", x: 10, z: 20, radius: 220, height: 75, crestH: 300 },
  { id: 1, kind: "meadow", x: 500, z: 0, radius: 90, height: 60 },
];

describe("feature paint", () => {
  it("keeps feature paint off until enableFeatures is called: no define, no sampler, no texture", () => {
    const plugin = pluginFor("f0");
    const defines: Record<string, boolean> = { TERRAINTEX: false, FEATUREPAINT: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.FEATUREPAINT).toBe(false);
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).not.toContain("featureTex");
    const active: RawTexture[] = [];
    plugin.getActiveTextures(active);
    expect(active).toHaveLength(8); // six ground textures + stub normals/RAH arrays
  });

  it("enableFeatures sets the define, the sampler and the texture, clamped to FEATURE_PAINT_MAX", () => {
    const plugin = pluginFor("f1");
    plugin.enableFeatures(testFeatures);
    const defines: Record<string, boolean> = { TERRAINTEX: false, FEATUREPAINT: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.FEATUREPAINT).toBe(true);
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toContain("featureTex");
    const active: RawTexture[] = [];
    plugin.getActiveTextures(active);
    expect(active).toHaveLength(9); // six ground textures + stub normals/RAH + the feature table
    const frag = plugin.getCustomCode("fragment")!;
    expect(frag.CUSTOM_FRAGMENT_DEFINITIONS).toContain("uniform sampler2D featureTex;");
    expect(frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("featureInfo.x");
    // Feature paint runs BEFORE the trail paint: a trail
    // bed crossing a meadow or pond keeps its own dirt/gravel colour.
    const glsl = frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(glsl.indexOf("featureTex")).toBeLessThan(glsl.indexOf("trailInfo"));
    // A second call is a no-op (same idempotence story as enableRoad/enableTrail).
    plugin.enableFeatures([]);
    const active2: RawTexture[] = [];
    plugin.getActiveTextures(active2);
    expect(active2).toHaveLength(9);
  });

  it("binds featureInfo.x to the live, clamped feature count", () => {
    const plugin = pluginFor("f2");
    plugin.enableFeatures(testFeatures);
    const ubo = fakeUniformBuffer();
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(ubo.values.featureInfo).toEqual([testFeatures.length, 0, 0, 0]);
  });

  it("clamps the bound count to FEATURE_PAINT_MAX when the world has more features", () => {
    const many: Feature[] = Array.from({ length: FEATURE_PAINT_MAX + 2 }, (_, i) => ({
      id: i, kind: "meadow", x: i * 100, z: 0, radius: 50, height: 10,
    }));
    const plugin = pluginFor("f2b");
    plugin.enableFeatures(many);
    const ubo = fakeUniformBuffer();
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(ubo.values.featureInfo).toEqual([FEATURE_PAINT_MAX, 0, 0, 0]);
  });

  it("dispose() disposes the feature texture", () => {
    const mat = new PBRMaterial("f3", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    plugin.enableFeatures(testFeatures);
    const active: RawTexture[] = [];
    plugin.getActiveTextures(active as never);
    const featureTex = active.find((t) => t.name === "featureTex")!;
    expect(featureTex).toBeDefined();
    expect(plugin.hasTexture(featureTex)).toBe(true);
    const disposeSpy = vi.spyOn(featureTex, "dispose");
    plugin.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("enableFeaturePaint reads the active variant's trail graph and is a no-op without one", () => {
    setActiveTerrainVariant("montane");
    const bare = new PBRMaterial("f4", scene);
    attachTerrainTexture(scene, bare, { groundArrays: stubArrays });
    enableFeaturePaint(scene, bare, 7);
    const defines: Record<string, boolean> = { TERRAINTEX: false, FEATUREPAINT: false };
    (bare.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin).prepareDefines(defines as never, scene, undefined as never);
    expect(defines.FEATUREPAINT).toBe(false);

    setActiveTerrainVariant("olympic");
    const withFeatures = new PBRMaterial("f5", scene);
    attachTerrainTexture(scene, withFeatures, { groundArrays: stubArrays });
    enableFeaturePaint(scene, withFeatures, 7);
    const defines2: Record<string, boolean> = { TERRAINTEX: false, FEATUREPAINT: false };
    (withFeatures.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin).prepareDefines(defines2 as never, scene, undefined as never);
    expect(defines2.FEATUREPAINT).toBe(true);
  });
});

describe("height blend mirror", () => {
  it("sums to 1, keeps a lone layer at 1, and lets the higher of two equal weights win", () => {
    const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);
    expect(sum(heightBlendWeights([0.5, 0.3, 0.2, 0, 0], [0.5, 0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(1, 9);
    expect(heightBlendWeights([1, 0, 0, 0, 0], [0.1, 0.9, 0.9, 0.9, 0.9])).toEqual([1, 0, 0, 0, 0]);
    const w = heightBlendWeights([0.5, 0.5, 0, 0, 0], [0.9, 0.2, 0.5, 0.5, 0.5]);
    expect(w[0]).toBeGreaterThan(0.9);
    expect(w[1]).toBeLessThan(0.1);
  });
  it("pins HEIGHT_BLEND_DEPTH", () => { expect(HEIGHT_BLEND_DEPTH).toBe(0.2); });
  it("returns the input weights unchanged when reliefOn is 0", () => {
    const w = [0.5, 0.3, 0.2, 0, 0];
    const h = [0.9, 0.1, 0.5, 0.5, 0.5]; // would sharpen the blend hard if reliefOn were 1
    expect(heightBlendWeights(w, h, 0)).toEqual(w);
  });
});

describe("per-layer roughness and F0 tables", () => {
  it("carry the pinned six values in layer order", () => {
    expect(LAYER_ROUGHNESS).toEqual([1.0, 1.0, 0.85, 0.95, 0.9, 0.9]); // grass, floor, rock, sand, pebble, asphalt
    expect(LAYER_F0).toEqual([0.5, 0.5, 1.0, 0.7, 0.85, 1.0]);
  });
});

describe("relief plugin wiring", () => {
  it("declares the two array samplers and reads the arrays every bind", () => {
    const mat = new PBRMaterial("r4", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toEqual(expect.arrayContaining(["terrainNormals", "terrainRAH"]));
    const defs = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!;
    // highp, not just sampler2DArray: GLSL ES 3.00 has no
    // default fragment precision for sampler2DArray, so a browser's real
    // compiler rejects the unqualified form with "No precision specified" —
    // a failure NullEngine's string-only preprocessor can never see. Pinned
    // by regex so the qualifier can't quietly get dropped again.
    expect(defs).toMatch(/uniform\s+highp\s+sampler2DArray\s+terrainNormals\s*;/);
    expect(defs).toMatch(/uniform\s+highp\s+sampler2DArray\s+terrainRAH\s*;/);
  });
  it("rewrites the reflectivity call through a regex key and declares the locals at main begin", () => {
    const mat = new PBRMaterial("r5", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const frag = plugin.getCustomCode("fragment")!;
    const key = Object.keys(frag).find((k) => k.startsWith("!"));
    expect(key).toBeDefined();
    expect(new RegExp(key!.slice(1)).test("reflectivityBlock(\nvReflectivityColor")).toBe(true);
    expect(frag[key!]).toContain("vReflectivityColor.g * terrainRough");
    expect(frag[key!]).toContain("vReflectivityColor.a * terrainF0");
    expect(frag.CUSTOM_FRAGMENT_MAIN_BEGIN).toContain("float terrainRough = 1.0;");
    expect(frag.CUSTOM_FRAGMENT_MAIN_BEGIN).toContain("float terrainF0 = 1.0;");
    const blend = frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain("normalW =");
    expect(blend).toContain("terrainRough =");
    expect(blend).toContain("terrainF0 =");
    // CUSTOM_FRAGMENT_BEFORE_LIGHTS is TERRAIN_FRAGMENT_BLEND (7 normals / 5
    // RAH fetches: 4 planar + 3 triplanar rock, and 4 planar + rock's XZ)
    // concatenated with ROAD_FRAGMENT_PAINT and TRAIL_FRAGMENT_PAINT, both
    // ALWAYS present in this string (ROADPAINT/TRAILPAINT gate at
    // GLSL-compile time, not at JS-string concatenation time — see the
    // "compiles the road branch in..." test below). ROAD_FRAGMENT_PAINT adds
    // one more fetch of each for asphalt's own relief slice (roadPaint.ts);
    // TRAIL_FRAGMENT_PAINT adds two more of each, for the bank's forest-floor
    // slice and the bed's gravel slice (trailPaint.ts). The rock parallax
    // march adds two more RAH fetches — the height at the
    // fragment before the loop and one per step inside it — and no normals.
    // Hence 10 and 10, not the ground blend's own 7 and 5 + 2. Grass's own
    // slice of each array left the plain count when it became hex tiled, so
    // both are 9 now, with grass's fetches counted through hexFetchArray
    // instead: one in the blend and one at the detail scale, each array.
    expect(blend.match(/texture2D\(\s*terrainNormals/g)!.length).toBe(9);
    expect(blend.match(/texture2D\(\s*terrainRAH/g)!.length).toBe(9);
    expect(blend.match(/hexFetchArray\(terrainNormals/g)!.length).toBe(2);
    expect(blend.match(/hexFetchArray\(terrainRAH/g)!.length).toBe(2);
  });
  it("keeps rock's X-facing tangent axes in x,y order, not transposed", () => {
    const blend = pluginFor("r7").getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain("vec3(0.0, tx.x, tx.y)");
    expect(blend).not.toContain("vec3(0.0, tx.y, tx.x)");
  });
  it("computes roughness: base times a map/0.5 modulation, clamped", () => {
    const blend = pluginFor("r8").getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain("terrainRough = clamp(rBase * mix(1.0, rMap / 0.5, strength), 0.0, 1.0);");
    // An earlier form replaced the base outright at full strength
    // (mix(rBase, rMap, strength) / 0.95) — a glossy flash across the whole
    // ground at the neutral 0.5 placeholder. Regression-pinned absent.
    expect(blend).not.toMatch(/mix\(\s*rBase\s*,\s*rMap\s*,\s*strength\s*\)\s*\/\s*0\.95/);
  });
  it("computes AO: a mean-1 multiplier (blended AO / 0.5), not a raw multiply", () => {
    const blend = pluginFor("r9").getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain("mix(1.0, ao / 0.5, strength)");
    // The packed AO channel is normalised to a mean of 0.5 per layer in the
    // shipped texture; multiplying by the raw blended value
    // instead of dividing by its neutral would darken each layer unequally by
    // whatever occlusion mean its own source map happened to ship.
    expect(blend).not.toMatch(/mix\(\s*1\.0\s*,\s*ao\s*,\s*strength\s*\)/);
  });
});

/** A minimal, spy-recording stand-in for Babylon's `UniformBuffer` — just
 * enough of its surface for `bindForSubMesh` to run against, with every
 * `updateFloat*` call's arguments captured by uniform name for assertions. */
function fakeUniformBuffer() {
  const values: Record<string, number[]> = {};
  return {
    values,
    updateFloat: (name: string, x: number) => { values[name] = [x]; },
    updateFloat2: (name: string, x: number, y: number) => { values[name] = [x, y]; },
    updateFloat3: (name: string, x: number, y: number, z: number) => { values[name] = [x, y, z]; },
    updateFloat4: (name: string, x: number, y: number, z: number, w: number) => { values[name] = [x, y, z, w]; },
    setTexture: () => {},
  };
}

/** Same shape as `stubArrays`, but with an RAH array whose `getSize().width`
 * is controllable — the placeholder/real-array signature `terrainReliefOn`
 * binds off of. */
const stubArraysWithRahWidth = (width: number) => () => ({
  normals: { isReady: () => true, dispose() {} } as never,
  rah: { isReady: () => true, dispose() {}, getSize: () => ({ width, height: width }) } as never,
  ready: Promise.resolve(),
  dispose() {},
});

describe("terrainReliefOn gates the height blend until real maps exist", () => {
  it("declares the uniform in both the UBO list and the non-UBO fragment string, and the blend reads it", () => {
    const plugin = pluginFor("rel1");
    const names = plugin.getUniforms().ubo.map((u) => u.name);
    expect(names).toContain("terrainReliefOn");
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+float\s+terrainReliefOn\s*;/);
    const blend = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain("terrainReliefOn");
  });

  it("binds 0 for a 1x1 placeholder RAH array and 1 once the real array has landed", () => {
    const matOff = new PBRMaterial("rel2", scene);
    attachTerrainTexture(scene, matOff, { groundArrays: stubArraysWithRahWidth(1) });
    const pluginOff = matOff.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const uboOff = fakeUniformBuffer();
    pluginOff.bindForSubMesh(uboOff as never, scene, undefined as never, undefined as never);
    expect(uboOff.values.terrainReliefOn).toEqual([0]);

    const matOn = new PBRMaterial("rel3", scene);
    attachTerrainTexture(scene, matOn, { groundArrays: stubArraysWithRahWidth(1024) });
    const pluginOn = matOn.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const uboOn = fakeUniformBuffer();
    pluginOn.bindForSubMesh(uboOn as never, scene, undefined as never, undefined as never);
    expect(uboOn.values.terrainReliefOn).toEqual([1]);
  });
});

describe("relief array lifecycle", () => {
  it("hasTexture/getActiveTextures include both arrays, and dispose() disposes them", () => {
    const disposeNormals = vi.fn();
    const disposeRah = vi.fn();
    const normals = { isReady: () => true, dispose: disposeNormals } as never;
    const rah = { isReady: () => true, dispose: disposeRah, getSize: () => ({ width: 1, height: 1 }) } as never;
    const mat = new PBRMaterial("rel4", scene);
    attachTerrainTexture(scene, mat, {
      // `dispose()` here mirrors the real `loadGroundArrays` contract: it is
      // this object's job to dispose both fields, not the plugin's — the
      // plugin only ever calls `this._arrays.dispose()`.
      groundArrays: () => ({ normals, rah, ready: Promise.resolve(), dispose() { disposeNormals(); disposeRah(); } }),
    });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;

    expect(plugin.hasTexture(normals)).toBe(true);
    expect(plugin.hasTexture(rah)).toBe(true);
    const active: (typeof normals)[] = [];
    plugin.getActiveTextures(active);
    expect(active).toContain(normals);
    expect(active).toContain(rah);

    plugin.dispose();
    expect(disposeNormals).toHaveBeenCalledTimes(1);
    expect(disposeRah).toHaveBeenCalledTimes(1);
  });
});

/**
 * Everything above asserts on the strings the plugin RETURNS. That is necessary
 * but not sufficient, and this file learned it the hard way: the three-rock-fetch
 * assertion above passed for a whole review round while the triplanar branch was
 * dead in every browser, because a comment inside the injected GLSL spelled a
 * hashed preprocessor keyword and Babylon's line-based preprocessor read it as a
 * real directive — swallowing the real endif and the `normalize(vNormalW)` line
 * with it. NullEngine cannot see that: it compiles no GLSL. Babylon's string
 * preprocessor, however, runs perfectly well in plain Node.
 *
 * So these tests run the plugin's OWN injected strings through Babylon's real
 * `Process()` — the same function `effect.functions.js` calls on the way to the
 * driver — rather than a look-alike. `client/test/game/shaderHygiene.test.ts`
 * runs the same real `Process()` over every `.fx` file and is the precedent
 * for this approach.
 */
function processInjected(source: string, defines: string[], isFragment: boolean): Promise<string> {
  const options: _IProcessingOptions = {
    defines,
    indexParameters: {},
    isFragment,
    shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: true,
    shadersRepository: "",
    includesShadersStore: {},
    // The REAL WebGL2 processor, not a stub: this is what rewrites
    // attribute/varying and texture2D, so it is what proves the plugin may
    // safely be written in plain GLSL ES 1.00.
    processor: new WebGL2ShaderProcessor(),
    version: "300",
    platformName: "WEBGL2",
    processingContext: null,
    isNDCHalfZRange: false,
    useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => {
    Process(source, options, (migrated) => resolve(migrated));
  });
}

function pluginFor(name: string): TerrainTexturePlugin {
  const mat = new PBRMaterial(name, scene);
  attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
  return mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
}

describe("injected GLSL survives Babylon's real shader preprocessor", () => {
  it("keeps the triplanar rock branch when the NORMAL define is set", async () => {
    const plugin = pluginFor("p1");
    const frag = plugin.getCustomCode("fragment")!;
    const source = `${frag.CUSTOM_FRAGMENT_DEFINITIONS!}\nvoid main(void) {\n${frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS!}\n}\n`;
    const out = await processInjected(source, ["#define TERRAINTEX", "#define NORMAL"], true);

    // The line the bad comment ate. Its absence is exactly the shipped defect
    // this test exists to prevent: without it terrainN stays (0,1,0), the
    // blend weights collapse to (0,1,0), and two of the three rock fetches are
    // multiplied by zero — planar rock wearing a triplanar costume.
    expect(out).toContain("normalize(vNormalW)");
    // Still three real fetches AFTER preprocessing, not just in the source.
    expect(out.match(/texture\(\s*terrainRock/g)!.length).toBe(3);
    expect(out).toContain("surfaceAlbedo");
    expect(out).toContain("uniform sampler2D terrainGrass;");
  });

  it("drops the normal tap when NORMAL is absent, proving the conditional is really evaluated", async () => {
    const plugin = pluginFor("p2");
    const frag = plugin.getCustomCode("fragment")!;
    const source = `${frag.CUSTOM_FRAGMENT_DEFINITIONS!}\nvoid main(void) {\n${frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS!}\n}\n`;
    const out = await processInjected(source, ["#define TERRAINTEX"], true);
    expect(out).not.toContain("normalize(vNormalW)");
    // …while the rest of the block, which is not behind that conditional,
    // survives. Without this pair a test that deleted everything would pass.
    // `?? []` deliberately: when a stray directive swallows the whole block
    // `match` returns null, and a length assertion then names the defect where
    // a TypeError on `null.length` would only name the test.
    expect(out.match(/texture\(\s*terrainRock/g) ?? []).toHaveLength(3);
  });

  it("migrates the plain GLSL ES 1.00 spelling to ES 3.00 on a WebGL2 context", async () => {
    const vert = pluginFor("p3").getCustomCode("vertex")!;
    const out = await processInjected(
      `${vert.CUSTOM_VERTEX_DEFINITIONS!}\nvoid main(void) {\n${vert.CUSTOM_VERTEX_MAIN_END!}\n}\n`,
      ["#define TERRAINTEX"],
      false,
    );
    // This is why the plugin does NOT hand-write the ES 3.00 spelling: the
    // processor does it, because injected code is wired to
    // processCodeAfterIncludes and so runs THROUGH ProcessShaderConversion.
    expect(out).toContain("in vec4 terrainWeights;");
    expect(out).toContain("out vec4 vTerrainW;");
    expect(out).not.toContain("attribute ");
    expect(out).not.toContain("varying ");

    const frag = pluginFor("p4").getCustomCode("fragment")!;
    const fragOut = await processInjected(frag.CUSTOM_FRAGMENT_DEFINITIONS!, ["#define TERRAINTEX"], true);
    expect(fragOut).toContain("in vec4 vTerrainW;");
    expect(fragOut).not.toContain("varying ");
  });

  it("compiles the road branch in with ROADPAINT and out without it", async () => {
    const plugin = pluginFor("p6");
    plugin.enableRoad(7, (_seed, z) => z);
    const frag = plugin.getCustomCode("fragment")!;
    const source = `${frag.CUSTOM_FRAGMENT_DEFINITIONS!}\nvoid main(void) {\n${frag.CUSTOM_FRAGMENT_BEFORE_LIGHTS!}\n}\n`;
    const on = await processInjected(source, ["#define TERRAINTEX", "#define NORMAL", "#define ROADPAINT"], true);
    expect(on.match(/texture\(\s*roadCenter/g) ?? []).toHaveLength(2);
    expect(on.match(/texture\(\s*roadAsphalt/g) ?? []).toHaveLength(1);
    expect(on).toContain("fwidth(");
    expect(on).toMatch(/surfaceAlbedo\s*=\s*rCol/);
    expect(on).toContain("uniform sampler2D roadCenter;");
    const off = await processInjected(source, ["#define TERRAINTEX", "#define NORMAL"], true);
    expect(off).not.toContain("roadCenter");
    expect(off.match(/texture\(\s*terrainRock/g) ?? []).toHaveLength(3); // the ground block survives
  });

  it("spells no hashed preprocessor keyword inside a GLSL comment", () => {
    const plugin = pluginFor("p5");
    const blocks = [
      ...Object.entries(plugin.getCustomCode("vertex")!),
      ...Object.entries(plugin.getCustomCode("fragment")!),
    ];
    expect(blocks.length).toBeGreaterThan(0);
    // `MoveCursorRegex` (shaderProcessor.js) matches these anywhere in a line
    // and `ShaderCodeCursor` passes `//` lines through untouched, so prose that
    // merely names one becomes a real directive. Checked against every string
    // the plugin injects, so a future hook added to getCustomCode is covered
    // the moment it exists.
    const banned = /#\s*(ifdef|ifndef|elif|else|endif|if)\b/;
    for (const [hook, glsl] of blocks) {
      for (const [index, line] of glsl.split("\n").entries()) {
        const comment = line.indexOf("//");
        if (comment === -1) continue;
        expect(
          banned.test(line.slice(comment)),
          `${hook} line ${index + 1} spells a preprocessor directive in a comment: ${line.trim()}`,
        ).toBe(false);
      }
    }
  });
});

describe("rock parallax (the TypeScript mirror of the shader's march)", () => {
  // The march walks the eye ray down through the rock height field on ONE
  // triplanar projection: `dirAb` is the ray's two in-plane components and
  // `dirC` its component along the plane's normal, both from eye to fragment;
  // `depthUv` is ROCK_PARALLAX_DEPTH in that projection's uv units. Height 1
  // is the surface, 0 the deepest point.
  const flat = (h: number) => () => h;
  it("declares a depth in metres, a step count and a weight floor", () => {
    expect(ROCK_PARALLAX_DEPTH).toBeGreaterThan(0.01);
    expect(ROCK_PARALLAX_STEPS).toBeGreaterThanOrEqual(8);
    expect(ROCK_PARALLAX_MIN_WEIGHT).toBeGreaterThan(0);
  });
  it("moves nothing where the surface is at the top of the height range", () => {
    const [du, dv] = rockParallaxOffset(flat(1), [0.6, 0.0], -0.8, 0.1);
    expect(du).toBeCloseTo(0, 6);
    expect(dv).toBeCloseTo(0, 6);
  });
  it("shifts a flat surface at half depth by half the capped offset along the ray's in-plane direction", () => {
    // Offset limited: the full march spans depth·|dirAb| in u (0.1 · 0.6), so
    // a surface 0.5 deep is met halfway along it.
    const [du, dv] = rockParallaxOffset(flat(0.5), [0.6, 0.0], -0.8, 0.1);
    expect(du).toBeCloseTo(0.5 * 0.1 * 0.6, 3);
    expect(dv).toBeCloseTo(0, 6);
  });
  it("never shifts further than the relief itself along the ray, at any angle", () => {
    // Offset limiting: the classic 1/|dirC| march lets a 3 cm relief drag a
    // stone's width of texture at walking distance, and that drag changes
    // with every step — visible as the rock warping underfoot. Capped, the
    // deepest point moves at most depth·|dirAb|.
    for (const c of [0.95, 0.6, 0.3, 0.1, 0.01]) {
      const ab = Math.sqrt(1 - c * c);
      const [du] = rockParallaxOffset(flat(0.0), [ab, 0.0], -c, 0.1);
      expect(Math.abs(du), `dirC ${c}`).toBeLessThanOrEqual(0.1 * ab + 1e-9);
    }
  });
  it("slides only one way as the ground recedes, and barely per metre walked", () => {
    // A player's eye is 1.7 m up; ground d metres ahead is seen along
    // (d, -1.7)/L. The shift of the deepest texel must never decrease with d
    // (a shift that peaks and turns back reads as the ground bending), and a
    // metre of walking must drift it by under 2% of that metre — against the
    // 100 cm the ground itself moves. The unlimited march drifted 7 cm per
    // metre at 3 m; offset limited at 3 cm it peaks at 1.1 cm right under the
    // feet (d = 0.5 → 1.5 m) and falls to a few millimetres by 3 m. (Bound
    // stated relative to the walk after measuring the 1.1 cm; the absolute
    // 1 cm first written was arbitrary.)
    let prev = -1;
    for (let d = 0.5; d <= 30; d += 0.5) {
      const L = Math.hypot(d, 1.7);
      const [du] = rockParallaxOffset(flat(0.0), [d / L, 0.0], -1.7 / L, ROCK_PARALLAX_DEPTH);
      expect(du, `d=${d}`).toBeGreaterThanOrEqual(prev - 1e-12);
      if (d >= 1.5) {
        const L1 = Math.hypot(d - 1, 1.7);
        const [du1] = rockParallaxOffset(flat(0.0), [(d - 1) / L1, 0.0], -1.7 / L1, ROCK_PARALLAX_DEPTH);
        expect(Math.abs(du - du1), `slide per metre at d=${d}`).toBeLessThan(0.02);
      }
      prev = du;
    }
  });
  it("keeps the relief shallow against the stones it lifts", () => {
    // ground.rock.webp tiles at 1.8 m with ~8-12 stones a side, so a stone is
    // 0.15-0.25 m across; parallax deeper than about a fifth of that swims.
    expect(ROCK_PARALLAX_DEPTH).toBeLessThanOrEqual(0.04);
  });
  it("finds a ramp's intersection within one step of the exact answer", () => {
    // Height rises with u: h(u) = clamp(0.5 + 4u). Exact intersection solves
    // 1 - h(u0 + du) = du / (depth · s) with s = 0.6/0.8.
    const h = (u: number) => Math.min(1, Math.max(0, 0.5 + 4 * u));
    const s = 0.6, depth = 0.1; // offset limited: the ray's in-plane rate is |dirAb|
    const exact = 0.5 / (1 / (depth * s) + 4);
    const [du] = rockParallaxOffset((u) => h(u), [0.6, 0.0], -0.8, depth);
    expect(Math.abs(du - exact)).toBeLessThan(depth * s / ROCK_PARALLAX_STEPS);
  });
});



describe("rock parallax in the shader", () => {
  it("marches the dominant face only, applies the offset to every rock sample, and fades with strength", () => {
    const mat = new PBRMaterial("rp1", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const blend = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain(`w2 > ${ROCK_PARALLAX_MIN_WEIGHT}`);
    expect(blend).toContain(`${ROCK_PARALLAX_DEPTH} * rt`);
    expect(blend).toContain(`for (int ri = 0; ri < ${ROCK_PARALLAX_STEPS}; ri++)`);
    expect(blend).toContain("rOff *= strength;");
    // Offset limited: the step is the ray's in-plane direction times the
    // depth, never divided by the along-normal component.
    expect(blend).toContain(`vec2 rStep = rAb * rDepth / ${ROCK_PARALLAX_STEPS}.0;`);
    expect(blend).not.toContain("abs(rC)");
    // Every rock fetch — albedo on all three faces, the three tangent normals,
    // and the XZ relief slice — carries its face's offset.
    expect(blend).toContain("vPositionW.yz * rt + rpX).rgb * bw.x");
    expect(blend).toContain("vPositionW.xz * rt + rpY).rgb * bw.y");
    expect(blend).toContain("vPositionW.xy * rt + rpZ).rgb * bw.z");
    expect(blend).toContain("vec3(vPositionW.xz * rt + rpY, 2.0)).rgb;");
    expect(blend).toContain("vec3(vPositionW.yz * rt + rpX, 2.0)).rgb * 2.0 - 1.0");
    // The march's loop bound is a compile-time constant (GLSL ES 1.0).
    expect(blend).not.toMatch(/for \(int ri = 0; ri < [a-zA-Z]/);
    // No hashed preprocessor keyword inside any comment of the blend.
    for (const line of blend.split("\n")) {
      const c = line.indexOf("//");
      if (c >= 0) expect(line.slice(c), line).not.toMatch(/#\s*(if|ifdef|ifndef|else|endif|define|undef)\b/);
    }
  });
});

describe("the grass floor", () => {
  let counter = 0;
  /** A fresh material with the plugin attached, the way the first test does it. */
  function makePlugin(): TerrainTexturePlugin {
    return pluginFor(`gf${counter++}`);
  }
  /** …plus one `bindForSubMesh` against the fake uniform buffer, so the bound
   * constants can be read back by uniform name. The scene has no active camera;
   * `bindForSubMesh` already tolerates that (it binds terrainEye as the origin),
   * which is what the existing bind tests rely on too. */
  function makeBoundPlugin(): { plugin: TerrainTexturePlugin; ubo: ReturnType<typeof fakeUniformBuffer>; writes: Record<string, number[]> } {
    const plugin = makePlugin();
    const ubo = fakeUniformBuffer();
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    return { plugin, ubo, writes: ubo.values };
  }

  it("declares the floor uniforms and splices the hex include after its own definitions", () => {
    const plugin = makePlugin();
    const names = plugin.getUniforms().ubo.map((u: { name: string }) => u.name);
    expect(names).toEqual(expect.arrayContaining([
      "terrainDetail", "terrainDetail2", "terrainMacroOn", "terrainHorizon", "terrainTuft",
    ]));
    const defs = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!;
    // The include lands AFTER this plugin's own definitions (so it sees the
    // TERRAINTEX-gated declarations above it) and BEFORE the paints.
    expect(defs.indexOf("uniform sampler2D terrainGrass;")).toBeLessThan(defs.indexOf("float horizonWeight("));
    expect(defs.indexOf("float horizonWeight(")).toBeLessThan(defs.indexOf("roadAsphalt"));
    expect(defs).toContain("vec3 hexSample2D(");
    // terrainHorizon is a UBO member on the UBO path and a plain uniform on the
    // other, so it is declared ONCE, in getUniforms(), never inside the include
    // — which compiles on both paths and would double-declare it. (The brief
    // asked for `uniform vec3 terrainHorizon;` inside these definitions; that
    // cannot coexist with the UBO member the same test requires.)
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+vec3\s+terrainHorizon\s*;/);
    expect(defs).not.toContain("uniform vec3 terrainHorizon;");
  });

  it("hex-samples the grass layer and no other, adds the detail scale under its fade, and tints", () => {
    const blend = makePlugin().getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    // The lattice and its three sin-hashed uvs are computed once per scale, not
    // once per fetch: hexSetup prepares them and the fetchers reuse them.
    expect(blend).toContain("hexSetup(uvG, ");
    expect(blend).toContain("hexFetch2D(terrainGrass, ");
    expect(blend).toContain("hexFetchArray(terrainNormals, ");
    expect(blend).toContain("hexFetchArray(terrainRAH, ");
    expect(blend).not.toContain("texture2D(terrainGrass");
    // Grass alone is hex-tiled. The other four layers keep their plain fetch.
    for (const layer of ["terrainFloor", "terrainSand", "terrainPebble", "terrainRock"]) {
      expect(blend).not.toContain(`hexSample2D(${layer}`);
      expect(blend).not.toContain(`hexFetch2D(${layer}`);
    }
    expect(blend).toContain("smoothstep(terrainDetail.y, terrainDetail.z, dist)");
    expect(blend).toContain("vec3 macroRgb = macroTint(MACRO_WEIGHT.x * macroN18 + MACRO_WEIGHT.y * macroN6, 1.0 - terrainN.y);");
    expect(blend).toContain("horizonWeight(dist)");
    expect(blend).toContain("terrainTuft");
    expect(blend).not.toContain("discard");
  });

  it("gates the 2 m hex lattice and the grass fetches on the raw grass vertex weight", () => {
    const blend = makePlugin().getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    // hexSetup(uvG and the grass albedo hex fetch both sit inside their own
    // `if (vTerrainW.x > 0.0)` gate, so non-grass ground never pays for a
    // lattice walk or three hashed fetches.
    const setupGateAt = blend.search(/if \(vTerrainW\.x > 0\.0\) \{\s*hexSetup\(uvG/);
    expect(setupGateAt).toBeGreaterThan(-1);
    const albedoGateAt = blend.indexOf("if (vTerrainW.x > 0.0) { grassAlbedo = hexFetch2D(terrainGrass");
    expect(albedoGateAt).toBeGreaterThan(setupGateAt);
    // The height blend can still hand grass a nonzero share at zero vertex
    // weight (the other layers split the weight and a grass texel's height
    // tops theirs), so every grass term keeps a real plain-fetch fallback
    // rather than a placeholder.
    expect(blend).toContain("textureGrad(terrainRAH, vec3(uvG, 0.0), gdx, gdy)");
    expect(blend).toContain("textureGrad(terrainNormals, vec3(uvG, 0.0), gdx, gdy)");
    expect(blend).toContain("textureGrad(terrainGrass, uvG, gdx, gdy)");
    expect(blend).not.toContain("texture2D(terrainGrass");
  });

  it("keeps the detail fetches inside their own fade and the relief fetches inside the strength gate", () => {
    const blend = makePlugin().getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    const detailAt = blend.indexOf("if (detailStrength > 0.0) {");
    expect(detailAt).toBeGreaterThan(-1);
    const detailEnd = blend.indexOf("\n    }", detailAt);
    const detailBlock = blend.slice(detailAt, detailEnd);
    // The detail scale fetches a normal and an occlusion, never an albedo: an
    // albedo term was tried and could not be seen with these maps.
    expect(blend).not.toContain("detailAlbedo");
    expect(detailBlock).toContain("hexFetchArray(terrainNormals, d1");
    expect(detailBlock).toContain("hexFetchArray(terrainRAH, d1");
    expect(blend).toContain("smoothstep(terrainDetail2.y, terrainDetail2.z, hD)");
    expect(blend).not.toContain("smoothstep(0.0, 0.6, hD)");
    // …and the detail gate is nested inside the relief gate, so a far fragment
    // pays for neither.
    expect(blend.indexOf("if (strength > 0.0) {")).toBeLessThan(detailAt);
  });

  it("binds the floor constants", () => {
    const { writes } = makeBoundPlugin();
    expect(writes.terrainDetail).toEqual([1 / DETAIL_TILING, DETAIL_FADE[0], DETAIL_FADE[1], DETAIL_NORMAL]);
    expect(writes.terrainDetail2).toEqual([DETAIL_AO, DETAIL_AO_RANGE[0], DETAIL_AO_RANGE[1]]);
    expect(writes.terrainHorizon).toEqual([HORIZON[0], HORIZON[1], HORIZON_MAX]);
    expect(writes.terrainTuft).toEqual([TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b]);
    expect(writes.terrainMacroOn).toEqual([1]);
  });

  it("pulls the sward floor toward the thatch colour after the horizon tint", () => {
    const blend = makePlugin().getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    const w = "float swardW = terrainSward.w * smoothstep(terrainSwardBand.x, terrainSwardBand.y, vTerrainCover) * (1.0 - smoothstep(terrainSwardBand.z, terrainSwardBand.w, dist));";
    const mix = "surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);";
    expect(blend).toContain(w);
    expect(blend).toContain(mix);
    expect(blend.indexOf("horizonWeight(dist)")).toBeLessThan(blend.indexOf(w));
    expect(blend.indexOf(w)).toBeLessThan(blend.indexOf(mix));
    // The pull keys on the cover, not on the grass texture weight.
    expect(w).not.toContain("w0");
  });

  it("declares and binds the sward uniforms", () => {
    const plugin = makePlugin();
    const names = plugin.getUniforms().ubo.map((u: { name: string }) => u.name);
    expect(names).toEqual(expect.arrayContaining(["terrainSward", "terrainSwardBand"]));
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+vec4\s+terrainSward\s*;/);
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+vec4\s+terrainSwardBand\s*;/);
    const defs = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!;
    expect(defs).not.toContain("uniform vec4 terrainSward");
    const { writes } = makeBoundPlugin();
    expect(writes.terrainSward).toEqual([0.05, 0.065, 0.03, 0.6]);
    expect(writes.terrainSwardBand).toEqual([0.05, 0.5, 12, 18]);
  });

  it("binds the pull's strength as 0 while the sward is off, and keeps the rest bound", () => {
    const { plugin, ubo, writes } = makeBoundPlugin();
    expect(writes.terrainSward).toEqual([0.05, 0.065, 0.03, 0.6]);
    plugin.setSward(false);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(writes.terrainSward).toEqual([0.05, 0.065, 0.03, 0]);
    expect(writes.terrainSwardBand).toEqual([0.05, 0.5, 12, 18]);
    plugin.setSward(true);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(writes.terrainSward).toEqual([0.05, 0.065, 0.03, 0.6]);
  });

  it("rebuilds swardWeight from the bound uniforms, component for component as the GLSL reads them", () => {
    const { writes } = makeBoundPlugin();
    const [, , , max] = writes.terrainSward as [number, number, number, number];
    const [coverLo, coverHi, fadeLo, fadeHi] = writes.terrainSwardBand as [number, number, number, number];
    // GLSL smoothstep, clamped.
    const smooth = (e0: number, e1: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    // swardW = terrainSward.w * smoothstep(band.x, band.y, cover) * (1 - smoothstep(band.z, band.w, dist))
    const glsl = (cover: number, dist: number) => max * smooth(coverLo, coverHi, cover) * (1 - smooth(fadeLo, fadeHi, dist));
    const points: [number, number][] = [[1, 5], [0.3, 5], [0.2, 14], [0.8, 16.5], [0.5, 12], [0.04, 3], [1, 19]];
    for (const [cover, dist] of points) {
      expect(Math.abs(glsl(cover, dist) - swardWeight(cover, dist)), `cover ${cover}, dist ${dist}`).toBeLessThan(1e-12);
    }
  });

  it("binds terrainWet from setWet, unconditionally, clamped to [0, 1]", () => {
    const { plugin, ubo, writes } = makeBoundPlugin();
    expect(writes.terrainWet).toEqual([0]);
    plugin.setWet(1);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(writes.terrainWet).toEqual([1]);
    plugin.setWet(-1);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(writes.terrainWet).toEqual([0]);
    plugin.setWet(2);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(writes.terrainWet).toEqual([1]);
  });
});

describe("the grass floor compiles into the fragment source on both paths", () => {
  // The sampler/UBO trap from the other side: a uniform declared only through
  // getUniforms().fragment lands at ADDITIONAL_FRAGMENT_DECLARATION, which
  // exists only on the NON-uniform-buffer path, so a UBO context never sees it.
  // Each of the five is therefore declared TWICE in the plugin, once per path.
  //
  // What this test must assert is the DECLARATION, in the spelling each path
  // actually uses — never merely that the name appears. Every one of these
  // names is USED by the spliced code, so a test that only looked for the name
  // would still pass with the declaration deleted and the shader dead in every
  // browser on one of the two paths.
  const FLOOR_UNIFORMS: readonly (readonly [string, string])[] = [
    ["vec4", "terrainDetail"],
    ["vec3", "terrainDetail2"],
    ["float", "terrainMacroOn"],
    ["vec3", "terrainHorizon"],
    ["vec3", "terrainTuft"],
    ["float", "terrainWet"],
  ];
  /** The spliced code that reads them; it must survive on both paths too. */
  const FLOOR_CODE = ["hexSetup", "macroTint", "horizonWeight"];

  /** The two-node graph the trail-paint tests use. */
  const trailGraphFixture: TrailGraph = {
    nodes: [{ x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 100 }],
    edges: [{ a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 1 }],
    trailhead: { x: 0, z: 0, u: 0 }, summit: 1, stem: [0], loops: [], features: [], stemLen: 100, fallbacks: 0,
  } as unknown as TrailGraph;

  async function compiledFragmentSource(targetScene: Scene, setup?: (plugin: TerrainTexturePlugin) => void): Promise<string> {
    const material = new PBRMaterial("pbr-floor", targetScene);
    // `stubArrays` builds real 1x1 RawTextures, and NullEngine never reports
    // those ready — which would hang `isReadyForSubMesh` forever. The
    // always-ready stub the terrainReliefOn tests use is what lets the material
    // actually compile here.
    attachTerrainTexture(targetScene, material, { groundArrays: stubArraysWithRahWidth(1024) });
    if (setup) setup(material.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin);
    const mesh = CreateBox("box-floor", {}, targetScene);
    mesh.material = material;
    const subMesh = mesh.subMeshes[0]!;
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (material.isReadyForSubMesh(mesh, subMesh, false)) { resolve(); return; }
        setTimeout(tick, 16);
      };
      tick();
    });
    return subMesh.effect?.fragmentSourceCode ?? "";
  }

  it("non-UBO path (a default NullEngine): five plain uniform declarations", async () => {
    const e = new NullEngine();
    expect(e.supportsUniformBuffers).toBe(false);
    const s = new Scene(e);
    try {
      const source = await compiledFragmentSource(s);
      // This path has no Material block, so getUniforms().fragment is the only
      // thing that can declare them.
      expect(source).not.toContain("uniform Material {");
      for (const [type, name] of FLOOR_UNIFORMS) {
        expect(source, name).toMatch(new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`));
      }
      for (const name of FLOOR_CODE) expect(source, name).toContain(name);
      // Declared before the include that reads them — the whole point of
      // splicing the hex GLSL after this plugin's own definitions.
      expect(source.indexOf("terrainHorizon")).toBeLessThan(source.indexOf("float horizonWeight("));
    } finally { s.dispose(); e.dispose(); }
  });

  it("UBO path (a NullEngine forced to webGLVersion 2): five Material members", async () => {
    const e = new NullEngine();
    (e as unknown as { _webGLVersion: number })._webGLVersion = 2;
    expect(e.supportsUniformBuffers).toBe(true);
    const s = new Scene(e);
    try {
      const source = await compiledFragmentSource(s);
      // Here they are members of Babylon's Material block, with no `uniform`
      // keyword of their own — and getUniforms().fragment is dropped entirely,
      // which is why the plain declaration must NOT also be present (it would
      // redeclare a UBO member).
      const blockAt = source.indexOf("uniform Material {");
      expect(blockAt).toBeGreaterThan(-1);
      const block = source.slice(blockAt, source.indexOf("};", blockAt));
      for (const [type, name] of FLOOR_UNIFORMS) {
        expect(block, name).toMatch(new RegExp(`\\b${type} ${name};`));
        expect(source, name).not.toMatch(new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`));
      }
      for (const name of FLOOR_CODE) expect(source, name).toContain(name);
      expect(source.indexOf("terrainHorizon")).toBeLessThan(source.indexOf("float horizonWeight("));
    } finally { s.dispose(); e.dispose(); }
  });

  it("with the trail enabled: trailSegs and terrainWet each declare once on both paths, row 1 read once", async () => {
    for (const forceUbo of [false, true]) {
      const e = new NullEngine();
      if (forceUbo) (e as unknown as { _webGLVersion: number })._webGLVersion = 2;
      const s = new Scene(e);
      try {
        let trailPlugin: TerrainTexturePlugin | undefined;
        const source = await compiledFragmentSource(s, (plugin) => {
          plugin.enableTrail(trailGraphFixture);
          trailPlugin = plugin;
        });
        expect(source).toContain("trailSegs");
        expect(source).toContain("terrainWet");
        expect(source.match(/uniform sampler2D trailSegs;/g)).toHaveLength(1);
        const terrainWetDecl = forceUbo ? /\bfloat terrainWet;/g : /uniform\s+float\s+terrainWet\s*;/g;
        expect(source.match(terrainWetDecl)).toHaveLength(1);
        expect(source.match(/texture2D\(trailSegs, vec2\(tuBest, 0\.75\)\)/g)).toHaveLength(1);
        // The regression this pins: at height 1 the shader would read world
        // coordinates as u and width, and every TypeScript-side test would
        // stay green since none of them touch the real texture.
        const active: RawTexture[] = [];
        trailPlugin!.getActiveTextures(active);
        const segsTex = active.find((t) => t.name === "trailSegs")!;
        expect(segsTex.getSize()).toEqual({ width: TRAIL_PAINT_MAX_SEGMENTS, height: 2 });
        // The hex include's latticeHash is what trailValueNoise1 calls, and
        // CUSTOM_FRAGMENT_DEFINITIONS splices the include before the trail
        // defs for exactly that reason.
        expect(source.indexOf("latticeHash(")).toBeLessThan(source.indexOf("trailValueNoise1("));
      } finally { s.dispose(); e.dispose(); }
    }
  });

  it("with the trail enabled: the rain and time uniforms declare once on both paths and the four ripple layers read them", async () => {
    for (const forceUbo of [false, true]) {
      const e = new NullEngine();
      if (forceUbo) (e as unknown as { _webGLVersion: number })._webGLVersion = 2;
      const s = new Scene(e);
      try {
        const source = await compiledFragmentSource(s, (plugin) => plugin.enableTrail(trailGraphFixture));
        expect(source).not.toContain("rippleSampler");
        expect(source.match(/float tRdrop = fract\(latticeHash\(tRh\) \+ terrainTime \* /g)).toHaveLength(4);
        expect(source.indexOf("float latticeHash(")).toBeLessThan(source.indexOf("vec2 tRcentre"));
        const rainDecl = forceUbo ? /\bfloat terrainRain;/g : /uniform\s+float\s+terrainRain\s*;/g;
        const timeDecl = forceUbo ? /\bfloat terrainTime;/g : /uniform\s+float\s+terrainTime\s*;/g;
        expect(source.match(rainDecl)).toHaveLength(1);
        expect(source.match(timeDecl)).toHaveLength(1);
      } finally { s.dispose(); e.dispose(); }
    }
  });
});

describe("rain on the puddles", () => {
  it("declares terrainRain and terrainTime on both uniform lists, and adds no sampler: the terrain's sixteen are WebGPU's default", () => {
    const plugin = pluginFor("rip1");
    const names = plugin.getUniforms().ubo.map((u) => u.name);
    expect(names).toContain("terrainRain");
    expect(names).toContain("terrainTime");
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+float\s+terrainRain\s*;/);
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+float\s+terrainTime\s*;/);
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toHaveLength(7);
    expect(plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS).not.toContain("rippleSampler");
  });

  it("binds terrainRain from setRain, clamped, and terrainTime from setTime, folded at an hour", () => {
    const plugin = pluginFor("rip2");
    const ubo = fakeUniformBuffer();
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(ubo.values.terrainRain).toEqual([0]);
    expect(ubo.values.terrainTime).toEqual([0]);
    plugin.setRain(0.5);
    plugin.setTime(3601.25);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(ubo.values.terrainRain).toEqual([0.5]);
    expect(ubo.values.terrainTime).toEqual([1.25]);
    plugin.setRain(-1);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(ubo.values.terrainRain).toEqual([0]);
    plugin.setRain(2);
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(ubo.values.terrainRain).toEqual([1]);
  });

  it("setTerrainRain sets both on the material's plugin and is a no-op on a bare material", () => {
    const mat = new PBRMaterial("rip3", scene);
    attachTerrainTexture(scene, mat, { groundArrays: stubArrays });
    setTerrainRain(scene, mat, 0.25, 12);
    const plugin = mat.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    const ubo = fakeUniformBuffer();
    plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
    expect(ubo.values.terrainRain).toEqual([0.25]);
    expect(ubo.values.terrainTime).toEqual([12]);
    expect(() => setTerrainRain(scene, new PBRMaterial("rip4", scene), 1, 1)).not.toThrow();
  });

  it("tilts the puddle's normal by four ripple layers of hashed rings, one in per quarter of the rain, scaled by the rain", () => {
    expect(TRAIL_FRAGMENT_PAINT.match(/vec2 tRc = floor\(tRp\);/g)).toHaveLength(4);
    // Skipped outright under no rain: a branch on the uniform, nothing sampled inside.
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec2 tRipple = vec2(0.0);\n    if (terrainRain > 0.0) {\n");
    expect(TRAIL_FRAGMENT_PAINT.slice(TRAIL_FRAGMENT_PAINT.indexOf("if (terrainRain > 0.0) {"), TRAIL_FRAGMENT_PAINT.indexOf("vec3 tPuddleN"))).not.toContain("texture2D(");
    // The cell hashed modulo 512, so the hash keeps its precision a kilometre out.
    expect(TRAIL_FRAGMENT_PAINT.match(/vec2 tRh = mod\(tRc, 512\.0\);/g)).toHaveLength(4);
    expect(TRAIL_FRAGMENT_PAINT).not.toContain("texture2D(rippleSampler");
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec2 tRp = vPositionW.xz * 2.5 + vec2(0.0, 0.0);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec2 tRp = vPositionW.xz * 3.8 + vec2(0.19, 0.83);");
    // The centre inset a quarter from the cell's edges, the radius a quarter: the ring never leaves its cell.
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec2 tRcentre = vec2(latticeHash(tRh + vec2(37.0, 0.0)), latticeHash(tRh + vec2(0.0, 91.0))) * 0.5 + 0.25;");
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tRr = clamp(1.0 - tRdist / 0.25, 0.0, 1.0);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec2 tRdir = tRd / max(tRdist, 0.0001);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("clamp(terrainRain * 4.0 - 0.0, 0.0, 1.0)");
    expect(TRAIL_FRAGMENT_PAINT).toContain("clamp(terrainRain * 4.0 - 3.0, 0.0, 1.0)");
    expect(TRAIL_FRAGMENT_PAINT).toContain("fract(latticeHash(tRh) + terrainTime * 1.0 + 0.0)");
    expect(TRAIL_FRAGMENT_PAINT).toContain("fract(latticeHash(tRh) + terrainTime * 1.13 + 0.7)");
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tRt = tRdrop - 1.0 + tRr;");
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tRf = clamp(0.2 + tRw * 0.8 - tRdrop, 0.0, 1.0);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("tRipple += tRdir * tRf * tRr * sin(clamp(tRt * 9.0, 0.0, 3.0) * 3.14159) * 0.35;");
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tPuddleN = normalize(vec3(tRipple.x * terrainRain, 1.0, tRipple.y * terrainRain));");
    expect(TRAIL_FRAGMENT_PAINT).toContain("normalW = normalize(mix(mix(tLipN, tBenchN, tGravel * tk), tPuddleN, tPuddle));");
    // The ripples replace the flat puddle normal, not sit beside it.
    expect(TRAIL_FRAGMENT_PAINT).not.toContain("vec3(0.0, 1.0, 0.0), tPuddle)");
  });
});

describe("the far cover", () => {
  let farCount = 0;

  /** A NullEngine on one uniform path: plain uniforms (the default) or,
   * forced to WebGL2, Babylon's Material block. */
  function engineOn(ubo: boolean): NullEngine {
    const e = new NullEngine();
    if (ubo) (e as unknown as { _webGLVersion: number })._webGLVersion = 2;
    return e;
  }

  /** Until the material is ready to draw the mesh's first submesh. */
  async function whenReady(material: PBRMaterial, mesh: Mesh): Promise<void> {
    const subMesh = mesh.subMeshes[0]!;
    for (let tick = 0; tick < 500; tick++) {
      if (material.isReadyForSubMesh(mesh, subMesh, false)) return;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    throw new Error(`${material.name} never became ready`);
  }

  /** The terrain material as the game makes it (metallic 0, so its metallic
   * workflow compiles, and roughness 1) with the plugin and whatever
   * `prepare` adds, compiled on a box. On WebGL2 the effect's source keeps
   * every conditional for the driver; its defines are `effect.defines`. */
  async function compiledTerrain(
    s: Scene,
    prepare?: (material: PBRMaterial, plugin: TerrainTexturePlugin) => void,
  ): Promise<{ material: PBRMaterial; plugin: TerrainTexturePlugin; mesh: Mesh; effect: Effect }> {
    const material = new PBRMaterial(`far-${farCount++}`, s);
    material.metallic = 0;
    material.roughness = 1;
    attachTerrainTexture(s, material, { groundArrays: stubArraysWithRahWidth(1024) });
    const plugin = material.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
    prepare?.(material, plugin);
    const mesh = CreateBox(`far-box-${farCount++}`, {}, s);
    mesh.material = material;
    await whenReady(material, mesh);
    return { material, plugin, mesh, effect: mesh.subMeshes[0]!.effect! };
  }

  it("splices the far-cover include after the hex include and before the paints", () => {
    const defs = pluginFor("fc1").getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!;
    const far = terrainFarCoverDefs();
    expect(defs.split(far).length - 1).toBe(1);
    expect(defs.indexOf("float horizonWeight(")).toBeLessThan(defs.indexOf(far));
    expect(defs.indexOf(far)).toBeLessThan(defs.indexOf(ROAD_FRAGMENT_DEFS));
    expect(far.startsWith("\n#ifdef TERRAINTEX\n// The far ground's cover:")).toBe(true);
    expect(far.endsWith("}\n\n#endif\n")).toBe(true);
  }, timeLimit(5_000));

  it("splices it the same way into WebGPU's definitions, after the fetch macros", () => {
    // The material is made on WebGL2's terms (the plugin refuses a WGSL
    // material); its code is asked for as WebGPU's.
    const plugin = pluginFor("fc2");
    const flagged = engine as unknown as { _isWebGPU: boolean };
    const was = flagged._isWebGPU;
    flagged._isWebGPU = true;
    try {
      const defs = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!;
      const far = terrainFarCoverDefs();
      expect(defs.startsWith(TERRAIN_UNIFORMITY_OFF)).toBe(true);
      expect(defs.split(far).length - 1).toBe(1);
      expect(defs.indexOf(HEX_FETCH_MACROS)).toBeGreaterThan(-1);
      expect(defs.indexOf(HEX_FETCH_MACROS)).toBeLessThan(defs.indexOf(far));
      expect(defs.indexOf(far)).toBeLessThan(defs.indexOf(ROAD_FRAGMENT_DEFS));
    } finally {
      flagged._isWebGPU = was;
    }
  }, timeLimit(5_000));

  it("declares the six locals at main begin, whatever the defines say", () => {
    expect(pluginFor("fc3").getCustomCode("fragment")!.CUSTOM_FRAGMENT_MAIN_BEGIN).toBe(`
float terrainRough = 1.0;
float terrainF0 = 1.0;
float terrainSpecW = 1.0;
float terrainFarW = 0.0;
float terrainPaintW = 0.0;
vec3 terrainFarN = vec3(0.0, 1.0, 0.0);
`);
  }, timeLimit(5_000));

  it("takes the macro line apart into its octaves, the same arithmetic as macroNoise", () => {
    expect(TERRAIN_MACRO_OCTAVES).toBe(`  // Its two octaves apart, the same arithmetic as macroNoise, so the far
  // cover below can fade each to its mean where its cells fall under two
  // pixels.
  float macroN18 = macroValueNoise(vPositionW.xz, MACRO_WAVE.x);
  float macroN6 = macroValueNoise(vPositionW.xz, MACRO_WAVE.y);
  vec3 macroRgb = macroTint(MACRO_WEIGHT.x * macroN18 + MACRO_WEIGHT.y * macroN6, 1.0 - terrainN.y);
`);
    expect(groundHexNoise).toContain("return MACRO_WEIGHT.x * macroValueNoise(p, MACRO_WAVE.x) + MACRO_WEIGHT.y * macroValueNoise(p, MACRO_WAVE.y);");
    const blend = pluginFor("fc4").getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend.split(TERRAIN_MACRO_OCTAVES).length - 1).toBe(1);
    expect(blend).not.toContain("macroNoise(vPositionW.xz)");
  }, timeLimit(5_000));

  it("holds the far block whole and runs it after the sward pull, before the roughness", () => {
    expect(TERRAIN_FRAGMENT_FAR_COVER).toBe(`  // Far cover: past the band where the meadow cards thin out, ground under
  // any cover the near field draws, grass or litter, takes the colour the
  // cover renders at, clumps darker in their troughs, and the lush and dry
  // tint the cards carry. Its normal and reflectance are applied after the
  // paints, in TERRAIN_FRAGMENT_FAR_LIGHT, so the road and the trail keep
  // their own. Constants in the far-cover include.
  vec2 fcFw = fwidth(vPositionW.xz);
  float fcFoot = max(fcFw.x, fcFw.y);
  terrainFarW = farCoverWeight(vTerrainCover, vTerrainW2.z, dist);
  if (terrainFarW > 0.0) {
    vec3 fcClump = farClump(vPositionW.xz, fcFoot);
    float fcB18 = 1.0 - smoothstep(0.5, 1.0, fcFoot / MACRO_WAVE.x);
    float fcB6 = 1.0 - smoothstep(0.5, 1.0, fcFoot / MACRO_WAVE.y);
    vec3 fcMacro = macroTint(MACRO_WEIGHT.x * mix(0.5, macroN18, fcB18) + MACRO_WEIGHT.y * mix(0.5, macroN6, fcB6), 1.0 - terrainN.y);
    vec3 fcTarget = mix(FAR_SWARD, FAR_LITTER, clamp(vTerrainW2.z, 0.0, 1.0))
      * fcMacro
      * (1.0 - FAR_CANOPY_SHADE * clamp(vTerrainW2.w, 0.0, 1.0))
      * mix(FAR_CLUMP_AO, 1.0, fcClump.z);
    surfaceAlbedo = mix(surfaceAlbedo, fcTarget, FAR_SWARD_MAX * terrainFarW);
    terrainFarN = normalize(normalW + vec3(-fcClump.x, 0.0, -fcClump.y) * FAR_CLUMP_TILT);
  }
`);
    const blend = pluginFor("fc5").getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain(`  surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);\n${TERRAIN_FRAGMENT_FAR_COVER}  // Roughness: the blended per-layer base,`);
    // The footprint is taken in uniform control flow, before the branch.
    expect(TERRAIN_FRAGMENT_FAR_COVER.indexOf("fwidth(")).toBeLessThan(TERRAIN_FRAGMENT_FAR_COVER.indexOf("if (terrainFarW > 0.0)"));
    expect(TERRAIN_FRAGMENT_FAR_COVER).not.toContain("texture");
  }, timeLimit(5_000));

  it("compiles the include and the block into the fragment on both uniform paths, with no define on medium and high", async () => {
    for (const ubo of [false, true]) {
      const e = engineOn(ubo);
      const s = new Scene(e);
      try {
        const { effect } = await compiledTerrain(s);
        const source = effect.fragmentSourceCode;
        expect(source.indexOf("float latticeHash(")).toBeGreaterThan(-1);
        expect(source.indexOf("float latticeHash(")).toBeLessThan(source.indexOf("vec3 farClumpOctave("));
        expect(source).toContain("#ifdef TERRAINFARLOW\nconst vec2 FAR_COVER_BAND = vec2(14.4, 18.0);\n#else\nconst vec2 FAR_COVER_BAND = vec2(24.0, 30.0);\n#endif");
        expect(source).toContain("terrainFarW = farCoverWeight(vTerrainCover, vTerrainW2.z, dist);");
        expect(source).toContain("float terrainFarW = 0.0;");
        expect(effect.defines).not.toContain("TERRAINFARLOW");
      } finally {
        s.dispose();
        e.dispose();
      }
    }
  }, timeLimit(20_000));

  it("holds the far light whole and runs it last, after the road, feature and trail paints", () => {
    expect(TERRAIN_FRAGMENT_FAR_LIGHT).toBe(`
#ifdef TERRAINTEX
{
  // The far cover's light, after the paints: its weight steps aside wherever
  // the road or the trail painted its own surface. The clumps' normal goes to
  // every light, and the specular weight, which sets the grazing reflectance
  // as well as F0, is cut by FAR_SPEC_CUT and given back as the ground wets.
  // The sun's diffuse line reads terrainFarN and terrainFarW again for the
  // cover's own answer to the sun.
  terrainFarW *= 1.0 - terrainPaintW;
  if (terrainFarW > 0.0) {
    normalW = normalize(mix(normalW, terrainFarN, terrainFarW));
    vec3 fcEye = vec3(viewDirectionW.x, 0.0, viewDirectionW.z);
    fcEye /= max(length(fcEye), 1e-4);
    terrainFarN = normalize(normalW + fcEye * FAR_COVER_TILT);
    terrainSpecW = 1.0 - FAR_SPEC_CUT * terrainFarW * (1.0 - terrainWet);
  }
}
#endif
`);
    const lights = pluginFor("fc6").getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(lights.endsWith(TRAIL_FRAGMENT_PAINT + TERRAIN_FRAGMENT_FAR_LIGHT)).toBe(true);
    expect(lights.indexOf(TERRAIN_FRAGMENT_FAR_COVER)).toBeLessThan(lights.indexOf(ROAD_FRAGMENT_PAINT));
    expect(lights.indexOf(ROAD_FRAGMENT_PAINT)).toBeLessThan(lights.indexOf(FEATURE_FRAGMENT_PAINT));
    expect(lights.indexOf(FEATURE_FRAGMENT_PAINT)).toBeLessThan(lights.indexOf(TRAIL_FRAGMENT_PAINT));
  }, timeLimit(5_000));

  it("cuts the specular weight through a rewrite that matches Babylon's PBR fragment once", () => {
    expect(TERRAIN_SPEC_INJECTION_POINT).toBe("!vec4 metallicReflectanceFactors=vMetallicReflectanceFactors;");
    expect(TERRAIN_SPEC_INJECTION_CODE).toBe(
      "vec4 metallicReflectanceFactors=vec4(vMetallicReflectanceFactors.rgb,vMetallicReflectanceFactors.a*terrainSpecW);",
    );
    const pbr = ShaderStore.ShadersStore["pbrPixelShader"] as string;
    expect(pbr.match(new RegExp(TERRAIN_SPEC_INJECTION_POINT.slice(1), "g"))).toHaveLength(1);
    const frag = pluginFor("fc7").getCustomCode("fragment")!;
    expect(frag[TERRAIN_SPEC_INJECTION_POINT]).toBe(TERRAIN_SPEC_INJECTION_CODE);
    // The reflectivity rewrite stays the first regex key.
    expect(Object.keys(frag).filter((k) => k.startsWith("!"))[0]).toBe("!reflectivityBlock\\(\\s*vReflectivityColor");
  }, timeLimit(5_000));

  it("adds no uniform: the plugin's UBO list is the 22 names it had", () => {
    expect(pluginFor("fc8").getUniforms().ubo.map((u) => u.name)).toEqual([
      "terrainTiling", "terrainRock2", "terrainFade", "terrainEye", "roadTable", "trailInfo", "terrainWet",
      "terrainRain", "terrainTime", "featureInfo", "terrainLayerRough", "terrainLayerRough2", "terrainLayerF0",
      "terrainLayerF02", "terrainReliefOn", "terrainDetail", "terrainDetail2", "terrainMacroOn", "terrainHorizon",
      "terrainTuft", "terrainSward", "terrainSwardBand",
    ]);
  }, timeLimit(5_000));

  it("compiles the specular rewrite and the far light on both uniform paths", async () => {
    for (const ubo of [false, true]) {
      const e = engineOn(ubo);
      const s = new Scene(e);
      try {
        const { effect } = await compiledTerrain(s);
        const source = effect.fragmentSourceCode;
        expect(effect.defines).toContain("#define METALLICWORKFLOW\n");
        expect(source.split(TERRAIN_SPEC_INJECTION_CODE).length - 1).toBe(1);
        expect(source).not.toContain("vec4 metallicReflectanceFactors=vMetallicReflectanceFactors;");
        expect(source).toContain("terrainSpecW = 1.0 - FAR_SPEC_CUT * terrainFarW * (1.0 - terrainWet);");
        expect(source.indexOf("terrainFarW *= 1.0 - terrainPaintW;")).toBeLessThan(source.indexOf(TERRAIN_SPEC_INJECTION_CODE));
      } finally {
        s.dispose();
        e.dispose();
      }
    }
  }, timeLimit(20_000));

  /** The renderer's lights in the renderer's order: the local headlamp, then
   * the sun and the fill (`createLighting`), then the other hikers' lamps. */
  function gameLights(s: Scene): void {
    new SpotLight("lamp_local", Vector3.Zero(), new Vector3(0, 0, 1), 1, 2, s);
    new DirectionalLight("sun", new Vector3(0, -1, 0), s);
    new HemisphericLight("fill", new Vector3(0, 1, 0), s);
    for (let player = 1; player < 5; player++) new SpotLight(`lamp_player_${player}`, Vector3.Zero(), new Vector3(0, 0, 1), 1, 2, s);
  }

  it("holds the sun's line whole: the factor under the light's own directional define, the plain line otherwise", () => {
    expect(TERRAIN_SUN_INJECTION_CODE).toBe(
      "#ifdef DIRLIGHT$2\n" +
        `info.diffuse=computeDiffuseLighting(preInfo,$1)${FAR_SUN_FACTOR};\n` +
        "#else\n" +
        "info.diffuse=computeDiffuseLighting(preInfo,$1);\n" +
        "#endif",
    );
    expect(pluginFor("fc9").getCustomCode("fragment")![FOLIAGE_LIGHT_INJECTION_POINT]).toBe(TERRAIN_SUN_INJECTION_CODE);
  }, timeLimit(5_000));

  it("keys on each light's plain diffuse line, once in the light include", () => {
    const include = ShaderStore.IncludesShadersStore["lightFragment"] as string;
    const all = [...include.matchAll(new RegExp(FOLIAGE_LIGHT_INJECTION_POINT.slice(1), "g"))];
    expect(all).toHaveLength(1);
    expect(all[0]![1]).toBe("diffuse{X}.rgb");
    expect(all[0]![2]).toBe("{X}");
  }, timeLimit(5_000));

  it("puts the factor under each light's own directional define, and the game's sun is the only directional light, on both uniform paths", async () => {
    for (const ubo of [false, true]) {
      const e = engineOn(ubo);
      const s = new Scene(e);
      try {
        gameLights(s);
        const { effect } = await compiledTerrain(s, (material) => {
          material.maxSimultaneousLights = 7;
          attachWet(material);
        });
        const source = effect.fragmentSourceCode;
        for (let n = 0; n < 7; n++) {
          const block =
            `#ifdef DIRLIGHT${n}\n` +
            `info.diffuse=computeDiffuseLighting(preInfo,diffuse${n}.rgb)${FAR_SUN_FACTOR};\n` +
            "#else\n" +
            `info.diffuse=computeDiffuseLighting(preInfo,diffuse${n}.rgb);\n` +
            "#endif";
          expect(source.split(block).length - 1, `light ${n}`).toBe(1);
        }
        expect(source.split(FAR_SUN_FACTOR).length - 1).toBe(7);
        expect(effect.defines.split("\n").filter((line) => line.startsWith("#define DIRLIGHT"))).toEqual(["#define DIRLIGHT1"]);
        expect(effect.defines).toContain("#define SPOTLIGHT0\n");
        expect(effect.defines).toContain("#define HEMILIGHT2\n");
      } finally {
        s.dispose();
        e.dispose();
      }
    }
  }, timeLimit(20_000));
});
