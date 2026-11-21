import type { PluginTextureBinding, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { ATMOSPHERE_PRIORITY } from "@csarkosh/engine/game/lite/atmospherePlugin";
import { FRAME_BLOCK, FRAME_FIELDS, SEA_RINGS_NAME, inFrameBlock } from "@csarkosh/engine/game/lite/frameBlock";
import { WATER_PRIORITY } from "@csarkosh/engine/game/lite/lakePlugin";
import { seaLookFor } from "@csarkosh/engine/game/lite/seaMeshes";
import { seaFields, seaPlugin, seaRestPlugin } from "@csarkosh/engine/game/lite/seaPlugin";
import { SEA_COMPONENT_VECS, emptySeaFrameUniforms, emptySeaUniforms } from "@csarkosh/engine/game/seaUniforms";
import { WATER_RING_COUNT } from "@csarkosh/engine/game/water";
import { laidOut, readUniform, standInTexture } from "./pluginFixture.js";

const SHARED = { name: FRAME_BLOCK } as unknown as PluginUniformBlock;
const TABLES = { atlas: standInTexture("atlas"), swash: standInTexture("swash"), ringBeds: standInTexture("ringBeds"), bed: standInTexture("bed") };
const LOW = { ...TABLES, bump: standInTexture("bump"), windDisp: null, windSlope: null };
const LOOP = { ...TABLES, bump: null, windDisp: standInTexture("loop"), windSlope: null };
const FFT = { ...TABLES, bump: null, windDisp: standInTexture("disp"), windSlope: standInTexture("slope") };
const codeOf = (plugin: ReturnType<typeof seaPlugin>): string =>
  (["vertex", "fragment"] as const).map((stage) => Object.values(plugin.getCustomCode?.(stage) ?? {}).join("\n")).join("\n");

describe("the sea's water as a plugin on Babylon Lite", () => {
  it("draws the wind sea with the ripple bump on low, with the baked loop above it, and with the cascades computed each frame on high", () => {
    expect(seaLookFor("low")).toEqual({ bump: true, loop: false });
    expect(seaLookFor("medium")).toEqual({ bump: false, loop: true });
    // The tier whose own field is the FFT reads its cascades, and the loop after them, which the game draws where the FFT is not to be had.
    expect(seaLookFor("high")).toEqual({ bump: false, loop: true, fft: true });
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
    expect(active).toEqual([LOOP.atlas, LOOP.swash, LOOP.ringBeds, LOOP.bed, LOOP.windDisp]);
    // A look and its pictures are handed together.
    expect(() => seaPlugin(emptySeaUniforms(), LOOP, SHARED, { bump: true, loop: false })).toThrow(/disagree/);
  });

  it("binds the cascades' two pictures on the tier that computes them, the slopes through the displacement's sampler, and no tier below gains a picture", () => {
    const names = (plugin: ReturnType<typeof seaPlugin>): string[] => (plugin.getSamplers?.() ?? []).map((d) => d.texture);
    const low = seaPlugin(emptySeaUniforms(), LOW, SHARED, seaLookFor("low"));
    const loop = seaPlugin(emptySeaUniforms(), LOOP, SHARED, seaLookFor("medium"));
    expect([low.defines, loop.defines]).toEqual([{ loop: false, bump: true }, { loop: true, bump: false }]);
    expect(names(low)).toEqual(["oceanAtlas", "oceanSwash", "seaBed", "waterBedHeight", "waterBump"]);
    expect(names(loop)).toEqual(["oceanAtlas", "oceanSwash", "seaBed", "waterBedHeight", "oceanWindDisp"]);
    expect(codeOf(low) + codeOf(loop)).not.toMatch(/oceanWindSlope\b|FFT_CASCADE|oceanCoast\.w>1\.5/);
    const fft = seaPlugin(emptySeaUniforms(), FFT, SHARED, seaLookFor("high"));
    expect(fft.defines).toEqual({ loop: true, bump: false, fft: true });
    expect(names(fft)).toEqual(["oceanAtlas", "oceanSwash", "seaBed", "waterBedHeight", "oceanWindDisp", "oceanWindSlope"]);
    expect(fft.getSamplers?.()?.at(-1)).toEqual({ texture: "oceanWindSlope", textureType: "texture_2d_array<f32>" });
    const bound: PluginTextureBinding[] = [];
    fft.bindTextures?.(bound);
    expect(bound.slice(-2)).toEqual([{ texture: FFT.windDisp }, { texture: FFT.windSlope, sampler: false }]);
    // What the material binds is read when its bindings are made: the loop's frames take the displacement's place where the cascades fail.
    const textures = { ...FFT };
    const swapped = seaPlugin(emptySeaUniforms(), textures, SHARED, seaLookFor("high"));
    textures.windDisp = standInTexture("loop");
    const again: PluginTextureBinding[] = [];
    swapped.bindTextures?.(again);
    expect(again.at(-2)).toEqual({ texture: textures.windDisp });
    // The cascades are read with a field's branch, never without it; and never without their slopes.
    expect(() => seaPlugin(emptySeaUniforms(), FFT, SHARED, { bump: false, loop: true })).toThrow(/disagree/);
    expect(() => seaPlugin(emptySeaUniforms(), LOOP, SHARED, { bump: false, loop: true, fft: true })).toThrow(/disagree/);
  });

  it("reads the frame behind it only in a look that reads through, the sea and its lip's strip alike", () => {
    const colour = standInTexture("kept");
    const depth = standInTexture("keptDepth");
    const behind = { colour: () => colour, depth: () => depth, breaks: 0 };
    const look = { ...seaLookFor("high"), through: true };
    const plain = seaPlugin(emptySeaUniforms(), FFT, SHARED, seaLookFor("high"));
    expect(codeOf(plain)).not.toMatch(/waterKept|wTransmit/);
    expect(Object.keys(plain.getCustomCode?.("fragment") ?? {})).not.toContain("CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR");
    const tables = { state: standInTexture("lipState"), profile: standInTexture("lipProfile") };
    for (const plugin of [seaPlugin(emptySeaUniforms(), { ...FFT, behind }, SHARED, look), seaPlugin(emptySeaUniforms(), { ...FFT, behind }, SHARED, look, tables)]) {
      expect(plugin.defines).toMatchObject({ through: true });
      expect(plugin.getSamplers?.().slice(-2)).toEqual([{ texture: "waterKept", sampler: "waterKeptSampler" }, { texture: "waterKeptDepth", sampleType: "unfilterable-float" }]);
      const bound: PluginTextureBinding[] = [];
      plugin.bindTextures?.(bound);
      expect(bound.slice(-2)).toEqual([{ texture: colour }, { texture: depth, sampler: false }]);
      const active: Texture2D[] = [];
      plugin.getActiveTextures?.(active as never);
      expect(active).not.toContain(colour);
      expect(active).not.toContain(depth);
      const points = plugin.getCustomCode?.("fragment") ?? {};
      expect(points.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color+=wTransmit;");
      expect(points.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain(`${FRAME_BLOCK}.frameProjection[3].z`);
      expect(points.CUSTOM_FRAGMENT_BEFORE_LIGHTS).not.toContain("alpha=1.0-(1.0-wF)*exp(");
      expect(points.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("wTransmit*=1.0-wFoam;");
      expect(codeOf(plugin)).not.toMatch(/lakeLens|CAUSTIC/);
      expect(plugin.getUniforms?.().ubo).toEqual(plain.getUniforms?.().ubo);
    }
    // The look and the frame are handed together or not at all.
    expect(() => seaPlugin(emptySeaUniforms(), FFT, SHARED, look)).toThrow(/disagree/);
    expect(() => seaPlugin(emptySeaUniforms(), { ...FFT, behind }, SHARED, seaLookFor("high"))).toThrow(/disagree/);
  });

  it("is the plunging lip's strip's with the strip's two tables: another vertex stage, the crests and the cross-section in the rings' depths' place, the same shading", () => {
    const tables = { state: standInTexture("lipState"), profile: standInTexture("lipProfile") };
    const sea = seaPlugin(emptySeaUniforms(), FFT, SHARED, seaLookFor("high"));
    const lip = seaPlugin(emptySeaUniforms(), FFT, SHARED, seaLookFor("high"), tables);
    expect([sea.name, lip.name]).toEqual(["SeaWater", "SeaLip"]);
    expect(lip.defines).toEqual({ loop: true, bump: false, fft: true, lip: true });
    expect((lip.getSamplers?.() ?? []).map((d) => d.texture)).toEqual(["oceanAtlas", "oceanSwash", "oceanLipState", "oceanLipProfile", "waterBedHeight", "oceanWindDisp", "oceanWindSlope"]);
    expect((lip.getSamplers?.() ?? []).slice(2, 4)).toEqual([
      { texture: "oceanLipState", sampleType: "unfilterable-float", visibility: "vertex" }, { texture: "oceanLipProfile", sampleType: "unfilterable-float", visibility: "vertex" },
    ]);
    const bound: PluginTextureBinding[] = [];
    lip.bindTextures?.(bound);
    expect(bound).toEqual([
      { texture: FFT.atlas, sampler: false }, { texture: FFT.swash, sampler: false }, { texture: tables.state, sampler: false }, { texture: tables.profile, sampler: false },
      { texture: FFT.bed, sampler: false }, { texture: FFT.windDisp }, { texture: FFT.windSlope, sampler: false },
    ]);
    const active: Texture2D[] = [];
    lip.getActiveTextures?.(active);
    expect(active).toEqual([FFT.atlas, FFT.swash, tables.state, tables.profile, FFT.bed, FFT.windDisp, FFT.windSlope]);
    // The fragment stage is the sea's own, text for text; the vertex stage places the strip and reads no ring.
    expect(lip.getCustomCode?.("fragment")).toEqual(sea.getCustomCode?.("fragment"));
    const vertex = lip.getCustomCode?.("vertex") ?? {};
    expect(vertex.CUSTOM_VERTEX_DEFINITIONS).toContain(sea.getCustomCode?.("vertex")?.CUSTOM_VERTEX_DEFINITIONS as string);
    expect(vertex.CUSTOM_VERTEX_DEFINITIONS).toContain("fn oceanLipPlace(");
    expect(vertex.CUSTOM_VERTEX_MAIN_END).toContain("oceanLipPlace(position)");
    expect(Object.values(vertex).join("\n")).not.toMatch(/seaRings|seaBed/);
    // The cove is the sea's own uniform; the level and the swell's travel are read from where the sea reads them.
    expect(vertex.CUSTOM_VERTEX_DEFINITIONS).toContain("material.oceanCove.x+LIP_HALF");
    expect(lip.getUniforms?.()).toEqual(sea.getUniforms?.());
    // The sea itself is as it was without the strip's tables.
    expect((sea.getSamplers?.() ?? []).map((d) => d.texture)).not.toContain("oceanLipState");
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
