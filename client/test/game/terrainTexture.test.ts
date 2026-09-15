import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import {
  attachTerrainTexture, enableRoadPaint, enableFeaturePaint, TerrainTexturePlugin,
  heightBlendWeights, HEIGHT_BLEND_DEPTH, LAYER_ROUGHNESS, LAYER_F0,
  rockParallaxOffset, ROCK_PARALLAX_DEPTH, ROCK_PARALLAX_STEPS, ROCK_PARALLAX_MIN_WEIGHT,
} from "../../src/game/terrainTexture.js";
import { FEATURE_PAINT_MAX } from "../../src/game/featurePaint.js";
import type { Feature } from "../../src/sim/features.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import "../../src/sim/passes/index.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

/** A stand-in for `loadGroundArrays`: NullEngine cannot build a real
 * `RawTexture2DArray`, so every test that attaches the plugin passes this
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
    // the gap windPlugin.test.ts had to be corrected for.
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
    expect(attrs).toEqual(expect.arrayContaining(["terrainWeights", "terrainWeights2"]));
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toEqual(expect.arrayContaining([
      "terrainGrass", "terrainFloor", "terrainRock", "terrainSand", "terrainPebble",
      "terrainNormals", "terrainRAH",
    ]));
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
    expect(glsl.match(/texture2D\(\s*terrainGrass/g)!.length).toBe(1);
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
    // Hence 10 and 10, not the ground blend's own 7 and 5 + 2.
    expect(blend.match(/texture2D\(\s*terrainNormals/g)!.length).toBe(10);
    expect(blend.match(/texture2D\(\s*terrainRAH/g)!.length).toBe(10);
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
