import type { PluginTextureBinding, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { ATMOSPHERE_PRIORITY } from "../../../src/game/lite/atmospherePlugin.js";
import { FRAME_BLOCK, FRAME_FIELDS, SEA_RINGS_NAME, inFrameBlock } from "../../../src/game/lite/frameBlock.js";
import { WATER_PRIORITY } from "../../../src/game/lite/lakePlugin.js";
import { seaLookFor } from "../../../src/game/lite/seaMeshes.js";
import { seaFields, seaPlugin, seaRestPlugin } from "../../../src/game/lite/seaPlugin.js";
import { SEA_COMPONENT_VECS, emptySeaFrameUniforms, emptySeaUniforms } from "../../../src/game/seaUniforms.js";
import { WATER_RING_COUNT } from "../../../src/game/water.js";
import { laidOut, readUniform, standInTexture } from "./pluginFixture.js";

const SHARED = { name: FRAME_BLOCK } as unknown as PluginUniformBlock;
const TABLES = { atlas: standInTexture("atlas"), swash: standInTexture("swash"), ringBeds: standInTexture("ringBeds"), bed: standInTexture("bed") };
const LOW = { ...TABLES, bump: standInTexture("bump"), loop: null };
const LOOP = { ...TABLES, bump: null, loop: standInTexture("loop") };
const codeOf = (plugin: ReturnType<typeof seaPlugin>): string =>
  (["vertex", "fragment"] as const).map((stage) => Object.values(plugin.getCustomCode?.(stage) ?? {}).join("\n")).join("\n");

describe("the sea's water as a plugin on Babylon Lite", () => {
  it("draws the wind sea with the ripple bump on low, and with the baked loop above it", () => {
    expect(seaLookFor("low")).toEqual({ bump: true, loop: false });
    expect(seaLookFor("medium")).toEqual({ bump: false, loop: true });
    // The tier whose own field is the FFT draws the loop, as the game does where the FFT is not to be had.
    expect(seaLookFor("high")).toEqual({ bump: false, loop: true });
  });

  it("declares the sea's own uniforms by the names its record gives them, for both stages, and leaves the frame's to the block", () => {
    const uniforms = emptySeaUniforms();
    const plugin = seaPlugin(uniforms, LOW, SHARED, seaLookFor("low"));
    const fields = plugin.getUniforms?.().ubo ?? [];
    expect(fields).toEqual(seaFields(uniforms));
    expect(fields.map((field) => field.name)).toEqual(Object.keys(uniforms));
    expect(Object.fromEntries(fields.map((field) => [field.name, field.type]))).toMatchObject({
      waterLevel: "f32", waterKd: "vec3<f32>", waterBed: "vec4<f32>", waterSkin: "vec2<f32>", oceanSwell: "vec4<f32>", oceanCove: "vec4<f32>",
      oceanK: `array<vec4<u32>,${SEA_COMPONENT_VECS}>`,
    });
    // The vertex stage sums the swell too.
    for (const field of fields) {
      expect(field.visibility, field.name).toBe("vertex-fragment");
      expect(inFrameBlock(field.name), field.name).toBe(false);
    }
    // What moves the sea is the frame's, under the names the sea's own module gives it, the rings' records as bits.
    for (const [name, value] of Object.entries(emptySeaFrameUniforms())) {
      expect(inFrameBlock(name), name).toBe(true);
      const type = FRAME_FIELDS.find((field) => field.name === name)?.type;
      expect(type).toBe(name === SEA_RINGS_NAME ? `array<vec4<u32>,${WATER_RING_COUNT}>` : ["f32", "vec2<f32>", "vec3<f32>", "vec4<f32>"][value.length - 1]);
    }
    expect(plugin.getUniformBlocks?.()).toEqual([SHARED]);
  });

  it("reads in its WGSL exactly the uniforms it declares as the material's, and the frame's from the block", () => {
    for (const [textures, look] of [[LOW, { bump: true, loop: false }], [LOOP, { bump: false, loop: true }]] as const) {
      const code = codeOf(seaPlugin(emptySeaUniforms(), textures, SHARED, look));
      const own = new Set([...code.matchAll(/\bmaterial\.([A-Za-z0-9]+)/g)].map((m) => m[1] as string));
      const declared = Object.keys(emptySeaUniforms());
      // Lite's own material fields aside, every read is of a declared field, and every declared field is read.
      for (const name of own) if (/^(water|ocean|sea)/.test(name)) expect(declared, name).toContain(name);
      // The wind sea's pivot is read where its field is turned to the wind.
      for (const name of declared) expect(own.has(name), name).toBe(look.loop || name !== "oceanWindPivot");
      const framed = new Set([...code.matchAll(new RegExp(`\\b${FRAME_BLOCK}\\.([A-Za-z0-9]+)`, "g"))].map((m) => m[1] as string));
      const wanted = ["oceanCoast", "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanWind", "oceanWindDir", "seaRings", "seaTime", "seaWindTime", "waterRain"];
      // The bump's drift where the bump is read, the wind sea's statistics where its field is; a lake's wind integral
      // is named by the skin's functions, which the sea never calls.
      expect([...framed].filter((name) => name !== "waterWindTime").sort()).toEqual([...wanted, ...(look.bump ? ["seaBumpOffset"] : ["oceanWindStats"])].sort());
    }
  });

  it("writes the record it was given as it stands at each write, the swell's components float for float", () => {
    const uniforms = emptySeaUniforms();
    const plugin = seaPlugin(uniforms, LOW, SHARED, seaLookFor("low"));
    const { data, offsets } = laidOut(plugin);
    uniforms.waterLevel[0] = 0.25;
    uniforms.waterBed.set([-512, 64, 1 / 256, 2]);
    uniforms.oceanCove.set([0, 179.4, -24, 1 / 12]);
    uniforms.oceanK.set(Float32Array.from({ length: SEA_COMPONENT_VECS * 4 }, (_, i) => 0.01 * (i + 1)));
    plugin.writeUbo?.(data, offsets);
    for (const [name, value] of Object.entries(uniforms)) expect(readUniform(data, offsets, name, value.length), name).toEqual([...value]);
  });

  it("binds its tables with no sampler, for the stages that read them, and its pictures by the look", () => {
    const low = seaPlugin(emptySeaUniforms(), LOW, SHARED, { bump: true, loop: false });
    expect(low.getSamplers?.()).toEqual([
      { texture: "oceanAtlas", sampleType: "unfilterable-float", visibility: "vertex-fragment" },
      { texture: "oceanSwash", sampleType: "unfilterable-float", visibility: "vertex-fragment" },
      { texture: "seaBed", textureType: "texture_2d_array<f32>", sampleType: "unfilterable-float", visibility: "vertex" },
      { texture: "waterBedHeight", sampleType: "unfilterable-float" },
      { texture: "waterBump", sampler: "waterBumpSampler" },
    ]);
    const bound: PluginTextureBinding[] = [];
    low.bindTextures?.(bound);
    expect(bound).toEqual([
      { texture: LOW.atlas, sampler: false }, { texture: LOW.swash, sampler: false }, { texture: LOW.ringBeds, sampler: false }, { texture: LOW.bed, sampler: false },
      { texture: LOW.bump },
    ]);
    const loop = seaPlugin(emptySeaUniforms(), LOOP, SHARED, { bump: false, loop: true });
    expect(loop.getSamplers?.()?.at(-1)).toEqual({ texture: "oceanWindDisp", sampler: "oceanWindDispSampler", textureType: "texture_2d_array<f32>", visibility: "vertex-fragment" });
    const active: Texture2D[] = [];
    loop.getActiveTextures?.(active);
    expect(active).toEqual([LOOP.atlas, LOOP.swash, LOOP.ringBeds, LOOP.bed, LOOP.loop]);
    // A look and its pictures are handed together.
    expect(() => seaPlugin(emptySeaUniforms(), LOOP, SHARED, { bump: true, loop: false })).toThrow(/disagree/);
  });

  it("carries no vertex data: a vertex is its place in the lattice, and the stage hands on the swell it sums", () => {
    const plugin = seaPlugin(emptySeaUniforms(), LOW, SHARED, seaLookFor("low"));
    expect(plugin.getVertexAttributes).toBeUndefined();
    expect(plugin.getVaryings?.()).toEqual([
      { name: "vBedDepth", type: "f32" }, { name: "vWaterViewDepth", type: "f32" }, { name: "vOceanXZ", type: "vec2<f32>" },
      { name: "vOceanSwellA", type: "vec4<f32>" }, { name: "vOceanSwellB", type: "vec4<f32>" },
    ]);
    const vertex = plugin.getCustomCode?.("vertex") ?? {};
    expect(Object.keys(vertex).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_MAIN_END"]);
    // Both stages evaluate one surface.
    expect(plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_DEFINITIONS).toContain(vertex.CUSTOM_VERTEX_DEFINITIONS as string);
  });

  it("stands before the air among a material's plugins, and takes its derivatives where it finds them", () => {
    const plugin = seaPlugin(emptySeaUniforms(), LOW, SHARED, seaLookFor("low"));
    expect(plugin.priority).toBe(WATER_PRIORITY);
    expect(WATER_PRIORITY).toBeLessThan(ATMOSPHERE_PRIORITY);
    expect(plugin.getFragmentDirectives?.()).toBe("diagnostic(off,derivative_uniformity);");
  });

  it("places the lattice at rest for the rain's cover map: the rings' records from the frame's block, the level its own, no wave", () => {
    const plugin = seaRestPlugin(SHARED, 0.25);
    expect(plugin.getUniformBlocks?.()).toEqual([SHARED]);
    expect(plugin.getUniforms).toBeUndefined();
    expect(plugin.getSamplers).toBeUndefined();
    expect(plugin.getCustomCode?.("fragment")).toBeNull();
    const vertex = plugin.getCustomCode?.("vertex")?.CUSTOM_VERTEX_MAIN_END ?? "";
    expect(vertex).toContain(`${FRAME_BLOCK}.seaRings[seaRing]`);
    expect(vertex).toContain("out.worldPos=vec3<f32>(seaAt.x,0.2500,seaAt.y);");
    expect(vertex).not.toMatch(/oceanDisplace|swashLift|material\./);
    // Another level is another shader.
    expect(seaRestPlugin(SHARED, 1).defines).not.toEqual(plugin.defines);
  });
});
