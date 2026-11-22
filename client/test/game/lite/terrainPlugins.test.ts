import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { ATMOSPHERE_PRIORITY } from "@csarkosh/engine/game/lite/atmospherePlugin";
import {
  TERRAIN_ARRAY_TEXTURES, TERRAIN_FIELDS, TERRAIN_TEXTURE_ORDER, TERRAIN_VERTEX_FLOATS, TERRAIN_VERTEX_LAYOUT, TERRAIN_WET_FIELDS,
  emptyTerrainMaterialUniforms, terrainPlugin, terrainSplitPlugin, terrainVertexData, terrainVertexDataSlices, terrainWetPlugin,
  type TerrainPaints, type TerrainTextures,
} from "@csarkosh/engine/game/lite/terrainPlugins";
import {
  FAR_BARE_AO, FAR_CANOPY_SHADE, FAR_CLUMP_AO, FAR_CLUMP_CELL, FAR_CLUMP_SALT, FAR_CLUMP_TILT, FAR_CLUMP_WEIGHT, FAR_CLUMP_WRAP, FAR_COVER_BAND, FAR_COVER_BAND_LOW,
  FAR_COVER_TILT, FAR_DRIFT_AO, FAR_DRIFT_CELL, FAR_DRIFT_SALT, FAR_DRIFT_TILT, FAR_DRIFT_WEIGHT, FAR_LITTER, FAR_MACRO_CELL, FAR_MACRO_SALT, FAR_MACRO_WEIGHT,
  FAR_SELF_SHADOW, FAR_SPEC_CUT, FAR_SUN_GAIN_MAX, FAR_SWARD, FAR_SWARD_COVER, FAR_SWARD_MAX,
  HEX_LATTICE, HEX_SHARPNESS, HEX_SKEW, HEX_UNSKEW, MACRO_DRY, MACRO_LUSH, MACRO_SLOPE, MACRO_WAVE, MACRO_WEIGHT,
} from "@csarkosh/engine/game/groundHexParams";
import { runBySlices } from "@csarkosh/engine/testing/sliceRun";
import { ROAD_ASPHALT_HALF, ROAD_PAINT_END, ROAD_SHOULDER_HALF } from "@csarkosh/engine/game/roadPaint";
import { NEEDLE_BED } from "@csarkosh/engine/game/terrainSurface";
import { emptyTerrainUniforms, terrainUniforms, type TerrainUniformInputs } from "@csarkosh/engine/game/terrainUniforms";
import {
  TRAIL_BED_EARTH, TRAIL_BED_FLOOR, TRAIL_BENCH_SHADE, TRAIL_CORE_GAIN, TRAIL_DRIFT_BAND, TRAIL_MARGIN_GAIN, TRAIL_WASH_BAND, TRAIL_WASH_DARK_LITTER,
  TRAIL_WASH_DARK_OPEN, TRAIL_WASH_ROUGH, TRAIL_WASH_WAVE,
} from "@csarkosh/engine/game/trailBenchParams";
import { TRAIL_PAINT_BUCKET_MAX, TRAIL_PAINT_INDEX_ROW } from "@csarkosh/engine/game/trailPaint";
import { TRAIL_CORRIDOR_HALF } from "@csarkosh/engine/sim/trail";
import { TERRAIN_ATTRIBUTES, TERRAIN_VERTEX_SIZES, type TerrainVertices } from "@csarkosh/engine/game/terrainVertices";
import { WET_SWASH_VECS, emptyWetUniforms, wetUniforms } from "@csarkosh/engine/game/wetSurface";
import { laidOut, readUniform, standInTexture } from "@csarkosh/engine/testing/pluginFixture";

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

/**
 * The ground's hex tiling, its macro tint and its far cover are written in
 * the plugin's WGSL with their numbers as literals. Each is the number
 * `groundHexParams.ts` holds, which the arithmetic the tests read is made
 * with: a change to one without the other fails here.
 */
describe("the terrain's plugin on Babylon Lite: its constants stay in lockstep with groundHexParams.ts", () => {
  const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
  const vec2 = (v: readonly [number, number]): string => `vec2<f32>(${f(v[0])},${f(v[1])})`;
  const vec3 = (c: { r: number; g: number; b: number }): string => `vec3<f32>(${f(c.r)},${f(c.g)},${f(c.b)})`;
  const code = fragment(ALL);

  it("carries the hex lattice, its sharpness and its skew matrices verbatim", () => {
    expect(code).toContain(`const HEX_LATTICE:f32=${f(HEX_LATTICE)};`);
    expect(code).toContain(`const HEX_SHARPNESS:f32=${f(HEX_SHARPNESS)};`);
    expect(code).toContain(`const HEX_SKEW:mat2x2<f32>=mat2x2<f32>(${HEX_SKEW.map(f).join(",")});`);
    expect(code).toContain(`const HEX_UNSKEW:mat2x2<f32>=mat2x2<f32>(${HEX_UNSKEW.map(f).join(",")});`);
  });

  it("carries the lattice hash token for token", () => {
    expect(code).toContain("fn latticeHash(c:vec2<f32>)->f32{return fract(0.618034*c.x+0.381966*c.y+0.0113*c.x*c.y);}");
  });

  it("carries the macro octaves, weights, slope push and tints verbatim", () => {
    expect(code).toContain(`const MACRO_WAVE:vec2<f32>=${vec2(MACRO_WAVE)};`);
    expect(code).toContain(`const MACRO_WEIGHT:vec2<f32>=${vec2(MACRO_WEIGHT)};`);
    expect(code).toContain(`const MACRO_SLOPE:f32=${f(MACRO_SLOPE)};`);
    expect(code).toContain(`const MACRO_LUSH:vec3<f32>=${vec3(MACRO_LUSH)};`);
    expect(code).toContain(`const MACRO_DRY:vec3<f32>=${vec3(MACRO_DRY)};`);
  });

  it("fetches a hex's three taps with explicit gradients, so the seams carry no mip discontinuity", () => {
    const fetch = code.slice(code.indexOf("fn hexFetch("), code.indexOf("fn latticeHash("));
    expect([...fetch.matchAll(/textureSampleGrad\(tex,terrainSmp,h\.u[123],layer,dx,dy\)\.rgb\*h\.s\.[xyz]/g)].length).toBe(3);
    expect(fetch).not.toMatch(/textureSample\(|textureSampleLevel\(/);
  });

  it("carries every constant of the far cover verbatim, the band of each tier among them", () => {
    expect(fragment(ALL, true)).toContain(`const FAR_COVER_BAND:vec2<f32>=${vec2(FAR_COVER_BAND_LOW)};`);
    expect(fragment(ALL, false)).toContain(`const FAR_COVER_BAND:vec2<f32>=${vec2(FAR_COVER_BAND)};`);
    for (const line of [
      `const FAR_SWARD_COVER:vec2<f32>=${vec2(FAR_SWARD_COVER)};`,
      `const FAR_SWARD_MAX:f32=${f(FAR_SWARD_MAX)};`,
      `const FAR_SWARD:vec3<f32>=${vec3(FAR_SWARD)};`,
      `const FAR_LITTER:vec3<f32>=${vec3(FAR_LITTER)};`,
      `const FAR_CANOPY_SHADE:f32=${f(FAR_CANOPY_SHADE)};`,
      `const FAR_CLUMP_CELL:vec2<f32>=${vec2(FAR_CLUMP_CELL)};`,
      `const FAR_CLUMP_WEIGHT:vec2<f32>=${vec2(FAR_CLUMP_WEIGHT)};`,
      `const FAR_CLUMP_SALT:vec2<f32>=${vec2(FAR_CLUMP_SALT)};`,
      `const FAR_CLUMP_WRAP:f32=${f(FAR_CLUMP_WRAP)};`,
      `const FAR_CLUMP_AO:f32=${f(FAR_CLUMP_AO)};`,
      `const FAR_CLUMP_TILT:f32=${f(FAR_CLUMP_TILT)};`,
      `const FAR_COVER_TILT:f32=${f(FAR_COVER_TILT)};`,
      `const FAR_SPEC_CUT:f32=${f(FAR_SPEC_CUT)};`,
      `const FAR_DRIFT_CELL:vec2<f32>=${vec2(FAR_DRIFT_CELL)};`,
      `const FAR_DRIFT_WEIGHT:vec2<f32>=${vec2(FAR_DRIFT_WEIGHT)};`,
      `const FAR_DRIFT_SALT_A:vec2<f32>=${vec2(FAR_DRIFT_SALT[0])};`,
      `const FAR_DRIFT_SALT_B:vec2<f32>=${vec2(FAR_DRIFT_SALT[1])};`,
      `const FAR_DRIFT_AO:f32=${f(FAR_DRIFT_AO)};`,
      `const FAR_DRIFT_TILT:f32=${f(FAR_DRIFT_TILT)};`,
      `const FAR_BARE_AO:f32=${f(FAR_BARE_AO)};`,
      `const FAR_MACRO_CELL:vec2<f32>=${vec2(FAR_MACRO_CELL)};`,
      `const FAR_MACRO_WEIGHT:vec2<f32>=${vec2(FAR_MACRO_WEIGHT)};`,
      `const FAR_MACRO_SALT_A:vec2<f32>=${vec2(FAR_MACRO_SALT[0])};`,
      `const FAR_MACRO_SALT_B:vec2<f32>=${vec2(FAR_MACRO_SALT[1])};`,
    ]) expect(code, line).toContain(line);
  });

  it("hashes the far cover on the wrapped cells with the macro noise's hash, band-limits with a rising smoothstep, and reads no texture for it", () => {
    const far = code.slice(code.indexOf("fn farCoverWeight("), code.indexOf("fn trailValueNoise1("));
    expect(far.length).toBeGreaterThan(1000);
    expect(far).toContain("let c0=gmod2(c+salt,FAR_CLUMP_WRAP);");
    expect(far).toContain("let a=latticeHash(c0);");
    expect(far.split("1.0-smoothstep(0.5,1.0,").length - 1).toBe(4);
    expect(far).not.toMatch(/texture|discard|material\./);
    for (const name of ["fn farCoverWeight(", "fn farClumpOctave(", "fn farClump(", "fn farDrift(", "fn farMacro("]) expect(far, name).toContain(name);
  });

  it("gives the sun's line on the far cover its two constants", () => {
    expect(code).toContain(
      `min(clamp(dot(terrainFarN,pl.L),0.0,1.0)/max(pl.NdotL,0.0000001),${f(FAR_SUN_GAIN_MAX)})*mix(${f(FAR_SELF_SHADOW)},1.0,clamp(dot(V,pl.L),0.0,1.0))`,
    );
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

  it("interleaves the same floats in slices ended at every reading of the scheduler's clock", () => {
    // A ring's worth of vertices, each array a ramp of its own.
    const n = 16_641;
    const ramp = (floats: number, seed: number): Float32Array => Float32Array.from({ length: n * floats }, (_, i) => Math.fround(Math.sin(i * 0.37 + seed)));
    const vertices: TerrainVertices = {
      positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), colors: ramp(4, 1), weights: ramp(4, 2), weights2: ramp(4, 3), cover: ramp(1, 4),
      indices: new Uint16Array(3),
    };
    const whole = terrainVertexData(vertices);
    const sliced = runBySlices(terrainVertexDataSlices(vertices));
    expect(sliced.slices).toBeGreaterThan(8);
    expect(Buffer.from(sliced.value.buffer).equals(Buffer.from(whole.buffer))).toBe(true);
    // Into an array the right length it fills that array, as it does at once.
    expect(runBySlices(terrainVertexDataSlices(vertices, whole)).value).toBe(whole);
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

/**
 * The road's and the trail's paint, statement by statement: what each rule
 * of the two is, read in the WGSL the terrain is drawn with. Their bands'
 * arithmetic is mirrored and tested in `roadPaint.ts` and `trailPaint.ts`;
 * these hold the statements a mirror cannot see, with their numbers as the
 * literals the two modules' constants print.
 */
describe("the terrain's plugin on Babylon Lite: the road's and the trail's rules", () => {
  /** The fragment's statements with the uniforms bare, as the plugin's source writes them. */
  const code = fragment(ALL).replaceAll("material.", "");
  const lit = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  /** The trail's own statements among them. */
  const trail = code.slice(code.indexOf("let tb=clamp("), code.indexOf("surfaceAlbedo=tCol;"));

  it("measures the road's footprint before its branch, and paints inside the band its mirror ends at", () => {
    // A derivative inside control flow that is not uniform is undefined: `fwidth` runs first.
    const footprint = code.indexOf("let raa=fwidth(rau);");
    expect(footprint).toBeGreaterThan(0);
    expect(footprint).toBeLessThan(code.indexOf(`if(rau<${lit(ROAD_PAINT_END)}){`));
    expect(code).toContain(`let rGravel=1.0-smoothstep(${lit(ROAD_ASPHALT_HALF)},${lit(ROAD_SHOULDER_HALF)},rau);`);
    // Every colour of the road is multiplied by the material's albedo, so the wet look's darkening still reaches it.
    expect(code.match(/\*terrainAlbedo,r(?:Verge|Gravel|Asphalt|Line)\);/g)).toHaveLength(4);
  });

  it("takes the ground's own form for the asphalt's roughness and occlusion: its constant times a map over 0.5", () => {
    expect(code).toContain("terrainRough=mix(terrainRough,clamp(terrainLayerRough2.y*mix(1.0,rAsphaltRAH.r/0.5,rk),0.0,1.0),rAsphalt);");
    // Not the map in the constant's place: a step against the ground's formula at the asphalt's edge.
    expect(code).not.toMatch(/mix\(terrainLayerRough2\.y,rAsphaltRAH\.r,rk\)\/0\.95/);
    // The occlusion is a multiplier about 1, the packed channel over its mean of 0.5, not the raw value.
    expect(code).toContain("rAsphaltTex*=mix(1.0,rAsphaltRAH.g/0.5,rk);");
    expect(code).not.toMatch(/rAsphaltTex\*=mix\(1\.0,rAsphaltRAH\.g,rk\);/);
  });

  it("has the far cover step aside on the road and on the trail: each writes its weight once, after what it rests on", () => {
    // The gravel shoulder's weight, which holds the asphalt, after the asphalt's F0.
    expect(code).toContain("    terrainF0=mix(terrainF0,terrainLayerF02.y,rAsphalt);\n    terrainPaintW=max(terrainPaintW,rGravel);\n");
    // The larger of the bank and the bench, core and margin, once the bench's weight is known.
    expect(code).toContain("    let tGravel=tOnBench*(1.0-tSnow);\n    terrainPaintW=max(terrainPaintW,max(tBank,tOnBench));\n");
    expect(code.split("terrainPaintW=max(terrainPaintW,").length - 1).toBe(2);
  });

  it("reads the trail's one table three times at its texels, and measures its footprint before its branch", () => {
    // The bucket on the grid's rows, each candidate on row 0, then row 1 once for the nearest.
    expect(code).toContain(`let tIdx=textureLoad(trailTable,vec2<i32>(i32(floor(tb.x)),${TRAIL_PAINT_INDEX_ROW}+i32(floor(tb.y))),0).xy;`);
    expect(code).toContain("let ts=textureLoad(trailTable,vec2<i32>(tc,0),0);");
    expect(code.split("textureLoad(trailTable,vec2<i32>(tcBest,1),0)").length).toBe(2);
    expect(code.match(/textureLoad\(trailTable/g)).toHaveLength(3);
    expect(code).toContain(`for(var ti=0;ti<${TRAIL_PAINT_BUCKET_MAX};ti++){`);
    const footprint = code.indexOf("let taa=fwidth(tdBest);");
    expect(footprint).toBeGreaterThan(0);
    expect(footprint).toBeLessThan(code.indexOf(`if(tdBest<${lit(TRAIL_CORRIDOR_HALF)}+taa){`));
  });

  it("paints the bank only where the ground is soil, under the ground's own vertex colour", () => {
    // The grass and forest-floor weights the blend already carries.
    expect(code).toContain("let tSoil=clamp(input.vTerrainW.x+input.vTerrainW.y,0.0,1.0);");
    // The ground's darkness and its canopy's tint are in the vertex colour, not the material's albedo.
    expect(code).toContain("let tBankBase=input.vTerrainColor.rgb;");
    const bank = code.split("\n").find((line) => line.includes("tFloorTex*") && line.includes("tBank);")) as string;
    expect(bank).toContain("tFloorTex*mix(1.0,tFloorRAH.g/0.5,tk)*tBankBase,tBank);");
    // The bank is ground beside the bed: it reads the raw base, never the bed's lifted one.
    expect(bank).not.toContain("tBedBase");
    expect(bank).not.toContain("terrainAlbedo");
  });

  it("lifts the bed toward the litter floor under the canopy, and keys the wash-out's darkness on the canopy too", () => {
    const bedLine = `let tBedBase=mix(tBankBase,vec3<f32>(${NEEDLE_BED.r},${NEEDLE_BED.g},${NEEDLE_BED.b}),${lit(TRAIL_BED_FLOOR)}*clamp(input.vTerrainW2.w,0.0,1.0));`;
    expect(code.split(bedLine)).toHaveLength(2);
    // One bed base, after the bank's and before the bench base that reads it.
    expect(code.indexOf(bedLine)).toBeGreaterThan(code.indexOf("let tBankBase=input.vTerrainColor.rgb;"));
    expect(code.indexOf(bedLine)).toBeLessThan(code.indexOf("let tBenchBase="));
    expect(code).toContain(`let tBenchBase=mix(vec3<f32>(1.0),tBedBase,${lit(TRAIL_BENCH_SHADE)});`);
    expect(code).not.toMatch(/tBankBase=mix\(tBankBase/);
    expect(code).toContain(`let tWashDark=mix(${lit(TRAIL_WASH_DARK_OPEN)},${lit(TRAIL_WASH_DARK_LITTER)},clamp(input.vTerrainW2.w,0.0,1.0));`);
    expect(code).toContain("let tWashCol=tFloorTex*tWashDark*");
    // Neither keys on the forest-floor weight or the litter weight, which are high beside a meadow's trail too.
    expect(code).not.toContain("clamp(input.vTerrainW.y,0.0,1.0)");
    expect(code).not.toContain(`mix(${lit(TRAIL_WASH_DARK_OPEN)},${lit(TRAIL_WASH_DARK_LITTER)},clamp(input.vTerrainW2.z`);
  });

  it("is packed snow, not dirt, above the snow line", () => {
    // The blend's detail weight is 1 on bare ground and 0 under full snow: the bed blends to a darker, bluer copy of the
    // ground, the gravel's normal, roughness and F0 fade with it, and the bare-floor bank goes with the soil it exposes.
    expect(code).toContain("let tSnow=1.0-clamp(input.vTerrainW2.y,0.0,1.0);");
    expect(code).toContain("*tSoil*(1.0-tSnow);");
    expect(code).toContain("let tPacked=surfaceAlbedo*vec3<f32>(0.86,0.88,0.94);");
    expect(code).toContain("tPacked,tSnow),tOnBench);");
    expect(code).toContain("let tGravel=tOnBench*(1.0-tSnow);");
    expect(trail.length).toBeGreaterThan(3000);
    const gravelSwaps = trail.split("\n").filter((line) => line.includes("tBedN.x") || line.includes("terrainLayerRough2.x") || line.includes("terrainLayerF02.x"));
    expect(gravelSwaps).toHaveLength(3);
    expect(code).toContain("mix(tLipN,tBenchN,tGravel*tk)");
    expect(code).toContain("mix(terrainRough,tRoughBench,tGravel)");
  });

  it("lays the bed as earth, its relief with its colour, and paints drifts and wash-outs over the bands without touching their weights", () => {
    // The floor's texture over the pebbles' at one share, for the colour, the normal, the occlusion and the roughness alike.
    const earth = lit(TRAIL_BED_EARTH);
    expect(code).toContain(`let tBedTex=mix(tGravelTex,tFloorTex,${earth});`);
    expect(code).toContain(`let tBedN=mix(tGravelN,tFloorN,${earth});`);
    expect(code).toContain(`let tBedRAH=mix(tGravelRAH,tFloorRAH,${earth});`);
    expect(code).toContain("let tAo=mix(1.0,tBedRAH.g/0.5,tk);");
    const core = (/var tCoreCol=[^\n]*/.exec(code) as RegExpExecArray)[0];
    const margin = (/var tMarginCol=[^\n]*/.exec(code) as RegExpExecArray)[0];
    expect(core).toContain(`*tBedTex*${lit(TRAIL_CORE_GAIN)}*tAo*tBenchBase;`);
    expect(margin).toContain(`*tBedTex*${lit(TRAIL_MARGIN_GAIN)}*tAo*tBenchBase;`);
    for (const line of [core, margin]) expect(line).not.toContain("tGravelTex");
    const bench = (/let tBenchN=[^\n]*/.exec(code) as RegExpExecArray)[0];
    expect(bench).toBe("let tBenchN=normalize(N+vec3<f32>(tBedN.x,0.0,tBedN.y)*mix(1.0,0.5,tInCore)*(1.0-tDrift)*(1.0-tWash)+vec3<f32>(tFloorN.x,0.0,tFloorN.y)*tDrift);");
    const rough = (/var tRoughBench=[^\n]*/.exec(code) as RegExpExecArray)[0];
    expect(rough).toContain("tBedRAH.r/0.5");
    expect(rough).not.toContain("tGravelRAH");
    // Drifts from the vertex's duff, wash-outs from the bed's own noise, a wash-out clearing the drift.
    expect(code).toContain(`var tDrift=smoothstep(${lit(TRAIL_DRIFT_BAND[0])},${lit(TRAIL_DRIFT_BAND[1])},clamp(input.vTerrainW2.z,0.0,1.0));`);
    expect(code).toContain(`let tWash=smoothstep(${lit(TRAIL_WASH_BAND[0])},${lit(TRAIL_WASH_BAND[1])},macroValueNoise(P.xz,${lit(TRAIL_WASH_WAVE)}));`);
    expect(code).toContain("tDrift*=1.0-tWash;");
    expect(code).toContain("tCoreCol=mix(mix(tCoreCol,tDriftCol,tDrift),tWashCol,tWash);");
    expect(code).toContain("tMarginCol=mix(mix(tMarginCol,tDriftCol,tDrift),tWashCol,tWash);");
    expect(code).toContain("tRoughBench=mix(tRoughBench,clamp(terrainLayerRough.y*mix(1.0,tFloorRAH.r/0.5,tk),0.0,1.0),tDrift);");
    expect(code).toContain(`tRoughBench=mix(tRoughBench,clamp(tRoughBench*${lit(TRAIL_WASH_ROUGH)},0.0,1.0),tWash);`);
    // The band's weights are made before the patches and are not multiplied by them: the core stays traceable.
    expect(code).toContain("    let tOnBench=tInMargin;\n");
  });
});
