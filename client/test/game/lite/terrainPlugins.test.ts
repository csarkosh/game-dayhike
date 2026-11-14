import { describe, expect, it } from "vitest";
import { ATMOSPHERE_PRIORITY } from "../../../src/game/lite/atmospherePlugin.js";
import {
  TERRAIN_ARRAY_TEXTURES, TERRAIN_FIELDS, TERRAIN_TEXTURE_ORDER, TERRAIN_VERTEX_FLOATS, TERRAIN_VERTEX_LAYOUT, TERRAIN_WET_FIELDS,
  emptyTerrainMaterialUniforms, terrainPlugin, terrainSplitPlugin, terrainVertexData, terrainWetPlugin,
  type TerrainPaints, type TerrainTextures,
} from "../../../src/game/lite/terrainPlugins.js";
import { emptyTerrainUniforms, terrainUniforms, type TerrainUniformInputs } from "../../../src/game/terrainUniforms.js";
import { TERRAIN_ATTRIBUTES, TERRAIN_VERTEX_SIZES, type TerrainVertices } from "../../../src/game/terrainVertices.js";
import { WET_SWASH_VECS, emptyWetUniforms, wetUniforms } from "../../../src/game/wetSurface.js";
import { laidOut, readUniform, standInTexture } from "./pluginFixture.js";

const TEXTURES = Object.fromEntries(TERRAIN_TEXTURE_ORDER.map(([, key]) => [key, standInTexture(key)])) as unknown as TerrainTextures;
const ALL: TerrainPaints = { road: true, trail: true, features: true };
const NONE: TerrainPaints = { road: false, trail: false, features: false };

const INPUTS: TerrainUniformInputs = {
  eye: { x: 12, y: 34, z: -56 }, wetness: 0.4, rain: 0.7, seconds: 123.5, sward: true, relief: true,
  road: null, trail: null, features: null,
};

const fragment = (paints: TerrainPaints, farLow = true): string =>
  Object.values(terrainPlugin(emptyTerrainMaterialUniforms(), TEXTURES, farLow, paints).getCustomCode?.("fragment") ?? {}).join("\n");

describe("the terrain's plugin on Babylon Lite: its uniforms", () => {
  it("declares a field for every uniform the terrain is drawn with, by its name and size, and the material's albedo", () => {
    const own = emptyTerrainUniforms();
    expect(TERRAIN_FIELDS.map((field) => field.name)).toEqual([...Object.keys(own), "terrainAlbedo"]);
    for (const field of TERRAIN_FIELDS) {
      const floats = field.name === "terrainAlbedo" ? 3 : (own as Record<string, number[]>)[field.name]?.length;
      expect(field.type, field.name).toBe(floats === 1 ? "f32" : `vec${floats}<f32>`);
    }
    expect(terrainPlugin(emptyTerrainMaterialUniforms(), TEXTURES, true, ALL).getUniforms?.().ubo).toEqual(TERRAIN_FIELDS);
  });

  it("writes the record it was given as it stands at each write, each value at its field", () => {
    const values = emptyTerrainMaterialUniforms();
    const plugin = terrainPlugin(values, TEXTURES, true, ALL);
    const { data, offsets } = laidOut(plugin);
    terrainUniforms(INPUTS, values);
    values.terrainAlbedo = [0.9, 0.8, 0.7];
    plugin.writeUbo?.(data, offsets);
    for (const [name, value] of Object.entries(values)) {
      expect(readUniform(data, offsets, name, value.length), name).toEqual(value.map((x) => Math.fround(x)));
    }
    expect(readUniform(data, offsets, "terrainEye", 3)).toEqual([12, 34, -56]);
    // The same record filled again for another frame is what the next write carries.
    terrainUniforms({ ...INPUTS, eye: { x: 1, y: 2, z: 3 } }, values);
    plugin.writeUbo?.(data, offsets);
    expect(readUniform(data, offsets, "terrainEye", 3)).toEqual([1, 2, 3]);
  });

  it("reads every uniform it declares as the material's, and none bare", () => {
    const code = fragment(ALL);
    const read = new Set([...code.matchAll(/\bmaterial\.(\w+)/g)].map((m) => m[1] as string));
    for (const field of TERRAIN_FIELDS) expect(read.has(field.name), field.name).toBe(true);
    // Beside its own, the far cover's sun term reads the material's direct intensity, which is Lite's.
    expect([...read].filter((name) => !TERRAIN_FIELDS.some((field) => field.name === name))).toEqual(["directIntensity"]);
    for (const field of TERRAIN_FIELDS) {
      expect(code, field.name).not.toMatch(new RegExp(`(?<![.\\w])${field.name}\\b`));
    }
  });
});

describe("the terrain's plugin on Babylon Lite: what it compiles", () => {
  it("leaves out the statements of a paint the world has none of, and reads its table nowhere", () => {
    const whole = fragment(ALL);
    const bare = fragment(NONE);
    expect(whole).toContain("textureLoad(roadCenter,");
    expect(whole).toContain("textureLoad(trailTable,");
    expect(whole).toContain("let fMeta=textureLoad(featureTex,");
    expect(bare).not.toContain("textureLoad(roadCenter,");
    expect(bare).not.toContain("textureLoad(trailTable,");
    expect(bare).not.toContain("let fMeta=textureLoad(featureTex,");
    // The blend and the far cover's light are in every terrain.
    for (const code of [whole, bare]) {
      expect(code).toContain("surfaceAlbedo=baseColor*input.vTerrainColor.rgb;");
      expect(code).toContain("terrainFarW*=1.0-terrainPaintW;");
    }
    expect(fragment({ ...NONE, road: true })).toContain("textureLoad(roadCenter,");
  });

  it("takes the low tier's far band or the other tiers', as a literal", () => {
    expect(fragment(ALL, true)).toContain("const FAR_COVER_BAND:vec2<f32>=vec2<f32>(14.4,18.0);");
    expect(fragment(ALL, false)).toContain("const FAR_COVER_BAND:vec2<f32>=vec2<f32>(24.0,30.0);");
    expect(fragment(ALL)).not.toContain("FAR_BAND)");
  });

  it("keys its pipeline by what it compiles: the far band and each paint", () => {
    expect(terrainPlugin(emptyTerrainMaterialUniforms(), TEXTURES, true, { road: true, trail: false, features: true }).defines).toEqual({
      farLow: true, road: true, trail: false, features: true,
    });
  });

  it("turns the derivative-uniformity diagnostic off for its fragment module", () => {
    expect(terrainPlugin(emptyTerrainMaterialUniforms(), TEXTURES, true, ALL).getFragmentDirectives?.()).toBe("diagnostic(off,derivative_uniformity);");
  });

  it("declares eleven textures on one sampler: eight layer arrays, then three float tables fetched by texel", () => {
    const plugin = terrainPlugin(emptyTerrainMaterialUniforms(), TEXTURES, true, ALL);
    const declared = plugin.getSamplers?.() ?? [];
    expect(declared.map((d) => d.texture)).toEqual([
      "terrainGrass", "terrainFloor", "terrainRock", "terrainSand", "terrainPebble", "terrainNormals", "terrainRAH", "roadAsphalt",
      "roadCenter", "trailTable", "featureTex",
    ]);
    expect(declared.map((d) => d.sampler)).toEqual(["terrainSmp", ...Array.from({ length: 10 }, () => undefined)]);
    expect(TERRAIN_ARRAY_TEXTURES).toBe(8);
    declared.forEach((d, i) => {
      expect(d.textureType, d.texture).toBe(i < 8 ? "texture_2d_array<f32>" : undefined);
      expect(d.sampleType, d.texture).toBe(i < 8 ? undefined : "unfilterable-float");
    });
    // Bound in the order declared, the first alone with its sampler.
    const bound: { texture: unknown; sampler?: false }[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound.map((b) => b.texture)).toEqual(TERRAIN_TEXTURE_ORDER.map(([, key]) => TEXTURES[key]));
    expect(bound.map((b) => b.sampler)).toEqual([undefined, ...Array.from({ length: 10 }, () => false)]);
    const active: unknown[] = [];
    plugin.getActiveTextures?.(active as never);
    expect(active).toEqual(bound.map((b) => b.texture));
  });
});

describe("the terrain's plugin on Babylon Lite: a vertex's own data", () => {
  it("is the two weight sets, the cover and the colour, interleaved in that order under the names the mesh's attributes have", () => {
    expect(TERRAIN_VERTEX_LAYOUT.map((part) => [part.name, part.floats, part.offset])).toEqual([
      [TERRAIN_ATTRIBUTES.weights, TERRAIN_VERTEX_SIZES.weights, 0],
      [TERRAIN_ATTRIBUTES.weights2, TERRAIN_VERTEX_SIZES.weights2, 4],
      [TERRAIN_ATTRIBUTES.cover, TERRAIN_VERTEX_SIZES.cover, 8],
      ["terrainColor", TERRAIN_VERTEX_SIZES.colors, 9],
    ]);
    expect(TERRAIN_VERTEX_FLOATS).toBe(13);
  });

  it("declares each as a vertex attribute at its bytes of one stride, and hands each on as a varying of its type", () => {
    const plugin = terrainPlugin(emptyTerrainMaterialUniforms(), TEXTURES, true, ALL);
    expect(plugin.getVertexAttributes?.()).toEqual([
      { name: "terrainWeights", type: "vec4<f32>", format: "float32x4", stride: 52, offset: 0 },
      { name: "terrainWeights2", type: "vec4<f32>", format: "float32x4", stride: 52, offset: 16 },
      { name: "terrainCover", type: "f32", format: "float32", stride: 52, offset: 32 },
      { name: "terrainColor", type: "vec4<f32>", format: "float32x4", stride: 52, offset: 36 },
    ]);
    expect(plugin.getVaryings?.()).toEqual([
      { name: "vTerrainW", type: "vec4<f32>" }, { name: "vTerrainW2", type: "vec4<f32>" },
      { name: "vTerrainCover", type: "f32" }, { name: "vTerrainColor", type: "vec4<f32>" },
    ]);
    expect(plugin.getCustomCode?.("vertex")).toEqual({
      CUSTOM_VERTEX_MAIN_END: "out.vTerrainW=terrainWeights;out.vTerrainW2=terrainWeights2;out.vTerrainCover=terrainCover;out.vTerrainColor=terrainColor;",
    });
    // The fragment stage reads each varying it is handed.
    const code = fragment(ALL);
    for (const part of TERRAIN_VERTEX_LAYOUT) expect(code, part.varying).toContain(`input.${part.varying}`);
  });

  it("interleaves a mesh's arrays a vertex, and fills the array it is handed when that is the right length", () => {
    const vertices: TerrainVertices = {
      positions: new Float32Array(6), normals: new Float32Array(6),
      colors: Float32Array.from([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1]),
      weights: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      weights2: Float32Array.from([11, 12, 13, 14, 15, 16, 17, 18]),
      cover: Float32Array.from([0.25, 0.75]),
      indices: new Uint16Array(3),
    };
    const data = terrainVertexData(vertices);
    expect([...data]).toEqual([
      1, 2, 3, 4, 11, 12, 13, 14, 0.25, 0.1, 0.2, 0.3, 1,
      5, 6, 7, 8, 15, 16, 17, 18, 0.75, 0.4, 0.5, 0.6, 1,
    ].map((x) => Math.fround(x)));
    vertices.cover[1] = 0.5;
    expect(terrainVertexData(vertices, data)).toBe(data);
    expect(data[13 + 8]).toBe(0.5);
    // An array of another mesh's length is not written: the data is an array of its own.
    const other = new Float32Array(13);
    const made = terrainVertexData(vertices, other);
    expect(made).not.toBe(other);
    expect(made).toHaveLength(26);
    expect([...other]).toEqual(Array.from({ length: 13 }, () => 0));
    expect(terrainVertexData(vertices, null)).toHaveLength(26);
  });
});

describe("the terrain's wet look and its split on Babylon Lite", () => {
  it("declares the wet look's uniforms by name, the swash's table as its vec4s of bits", () => {
    const own = emptyWetUniforms();
    expect(TERRAIN_WET_FIELDS.map((field) => field.name)).toEqual(Object.keys(own));
    expect(TERRAIN_WET_FIELDS.at(-1)).toEqual({ name: "wetSwash", type: `array<vec4<u32>,${WET_SWASH_VECS}>` });
    expect(Object.fromEntries(TERRAIN_WET_FIELDS.map((field) => [field.name, field.type]))).toMatchObject({
      wetLine: "f32", wetCentre: "vec2<f32>", wetKd: "vec3<f32>", wetCove: "vec4<f32>",
    });
  });

  it("writes a surface's wet line and the swash's table, float for float", () => {
    const values = emptyWetUniforms();
    const plugin = terrainWetPlugin(values);
    const { data, offsets } = laidOut(plugin);
    wetUniforms({ line: 1.3, level: 1, centre: [10, 20], radius: 300, kd: [0.3, 0.2, 0.1], attenuate: true, cap: 0 }, values);
    plugin.writeUbo?.(data, offsets);
    expect(readUniform(data, offsets, "wetLine", 1)).toEqual([Math.fround(1.3)]);
    expect(readUniform(data, offsets, "wetCentre", 2)).toEqual([10, 20]);
    expect(readUniform(data, offsets, "wetKd", 3)).toEqual([0.3, 0.2, 0.1].map((x) => Math.fround(x)));
    expect(readUniform(data, offsets, "wetAttenuate", 1)).toEqual([1]);
    expect(readUniform(data, offsets, "wetCap", 1)).toEqual([0]);
    expect(readUniform(data, offsets, "wetSwash", WET_SWASH_VECS * 4)).toEqual([...values.wetSwash]);
  });

  it("reads in its WGSL only uniforms that are declared: its own, and the terrain's count of features", () => {
    const code = Object.values(terrainWetPlugin(emptyWetUniforms()).getCustomCode?.("fragment") ?? {}).join("\n");
    const read = new Set([...code.matchAll(/\bmaterial\.(\w+)/g)].map((m) => m[1] as string));
    expect([...read].sort()).toEqual([...TERRAIN_WET_FIELDS.map((field) => field.name), "featureInfo"].sort());
    expect(TERRAIN_FIELDS.some((field) => field.name === "featureInfo")).toBe(true);
  });

  it("runs the terrain's statements, then the wet look, then the split, then the air", () => {
    const terrain = terrainPlugin(emptyTerrainMaterialUniforms(), TEXTURES, true, ALL);
    const wet = terrainWetPlugin(emptyWetUniforms());
    const split = terrainSplitPlugin();
    const order = [terrain.priority, wet.priority, split.priority, ATMOSPHERE_PRIORITY];
    expect(order).toEqual([200, 240, 250, 900]);
    expect(split.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("colorF0=vec3<f32>(tF0);");
    expect(split.getCustomCode?.("vertex")).toBeNull();
    expect(wet.getCustomCode?.("vertex")).toBeNull();
  });
});
