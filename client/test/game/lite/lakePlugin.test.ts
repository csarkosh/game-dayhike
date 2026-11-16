import type { PluginUniformBlock } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { ATMOSPHERE_PRIORITY } from "../../../src/game/lite/atmospherePlugin.js";
import { FRAME_BLOCK, FRAME_FIELDS, inFrameBlock } from "../../../src/game/lite/frameBlock.js";
import { WATER_PRIORITY, lakePlugin } from "../../../src/game/lite/lakePlugin.js";
import { lakeWaterRow } from "../../../src/game/waterShading.js";
import { createWaterSurface, emptyLakeUniforms, emptyWaterFrameUniforms, lakeUniforms, setWaterCalm, setWaterLakeBody } from "../../../src/game/waterSurface.js";
import { laidOut, readUniform, standInTexture } from "./pluginFixture.js";

const SHARED = { name: FRAME_BLOCK } as unknown as PluginUniformBlock;
const TEXTURES = { bump: standInTexture("bump"), bed: standInTexture("bed"), skyline: standInTexture("skyline") };

describe("a lake's water as a plugin on Babylon Lite", () => {
  it("declares the lake's own uniforms by the names its record gives them, and leaves the frame's to the block", () => {
    const uniforms = emptyLakeUniforms();
    const plugin = lakePlugin(uniforms, TEXTURES, SHARED);
    const fields = plugin.getUniforms?.().ubo ?? [];
    expect(fields.map((field) => field.name)).toEqual(Object.keys(uniforms));
    expect(Object.fromEntries(fields.map((field) => [field.name, field.type]))).toMatchObject({
      waterLevel: "f32", waterKd: "vec3<f32>", waterBed: "vec4<f32>", waterSkin: "vec2<f32>", waterLakeCentre: "vec3<f32>", waterShadeColour: "vec3<f32>",
    });
    for (const field of fields) expect(inFrameBlock(field.name), field.name).toBe(false);
    // What every lake reads alike is the frame's, under the names the water's own module gives it.
    for (const [name, value] of Object.entries(emptyWaterFrameUniforms())) {
      expect(inFrameBlock(name), name).toBe(true);
      expect(FRAME_FIELDS.find((field) => field.name === name)?.type).toBe(["f32", "vec2<f32>"][value.length - 1]);
    }
    expect(plugin.getUniformBlocks?.()).toEqual([SHARED]);
  });

  it("reads in its WGSL exactly the uniforms it declares as the material's, and the frame's from the block", () => {
    const plugin = lakePlugin(emptyLakeUniforms(), TEXTURES, SHARED);
    const code = (["vertex", "fragment"] as const).map((stage) => Object.values(plugin.getCustomCode?.(stage) ?? {}).join("\n")).join("\n");
    const own = new Set([...code.matchAll(/\bmaterial\.(water[A-Za-z0-9]+)/g)].map((m) => m[1] as string));
    const declared = Object.keys(emptyLakeUniforms());
    for (const name of own) expect(declared, name).toContain(name);
    // The mirror's weight, the shore's flags and the lake's body are read by the tiers that draw them; the rest here.
    for (const name of ["waterLevel", "waterKd", "waterBed", "waterBedTexels", "waterOctaves", "waterSkin", "waterPawCover", "waterCalmShare", "waterMirrorWeight", "waterShadeColour", "waterSkylineOn"]) {
      expect(own.has(name), name).toBe(true);
    }
    const framed = new Set([...code.matchAll(new RegExp(`\\b${FRAME_BLOCK}\\.(water[A-Za-z0-9]+)`, "g"))].map((m) => m[1] as string));
    expect([...framed].sort()).toEqual(["waterBumpOffset", "waterLakeTime", "waterRain", "waterWind", "waterWindTime"]);
  });

  it("writes the record it was given as it stands at each write", () => {
    const uniforms = emptyLakeUniforms();
    const plugin = lakePlugin(uniforms, TEXTURES, SHARED);
    const { data, offsets } = laidOut(plugin);
    const surface = createWaterSurface(lakeWaterRow(0.8));
    setWaterLakeBody(surface, 254, 81.6, 72.4, 30.4);
    setWaterCalm(surface, 0.7, 1, 0);
    lakeUniforms(surface, 81.6, { panorama: false, skyline: true }, uniforms);
    plugin.writeUbo?.(data, offsets);
    for (const [name, value] of Object.entries(uniforms)) expect(readUniform(data, offsets, name, value.length), name).toEqual([...value]);
    expect(readUniform(data, offsets, "waterLevel", 1)).toEqual([Math.fround(81.6)]);
    expect(readUniform(data, offsets, "waterSkylineOn", 1)).toEqual([1]);
  });

  it("binds the ripple bump with a sampler and the two tables with none, the bed's depth a float a vertex", () => {
    const plugin = lakePlugin(emptyLakeUniforms(), TEXTURES, SHARED);
    expect(plugin.getSamplers?.()).toEqual([
      { texture: "waterBump", sampler: "waterBumpSampler" },
      { texture: "waterBedHeight", sampleType: "unfilterable-float" },
      { texture: "waterSkyline", sampleType: "unfilterable-float" },
    ]);
    const bound: { texture: unknown; sampler?: boolean }[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound).toEqual([{ texture: TEXTURES.bump }, { texture: TEXTURES.bed, sampler: false }, { texture: TEXTURES.skyline, sampler: false }]);
    const active: unknown[] = [];
    plugin.getActiveTextures?.(active as never);
    expect(active).toEqual([TEXTURES.bump, TEXTURES.bed, TEXTURES.skyline]);
    expect(plugin.getVertexAttributes?.()).toEqual([{ name: "bedDepth", type: "f32", format: "float32", stride: 4, offset: 0 }]);
    expect(plugin.getVaryings?.()).toEqual([{ name: "vBedDepth", type: "f32" }, { name: "vWaterViewDepth", type: "f32" }]);
  });

  it("carries the shore's panorama only where it is handed one: a fourth picture with a sampler of its own, and the read of it", () => {
    const code = (plugin: ReturnType<typeof lakePlugin>): string => Object.values(plugin.getCustomCode?.("fragment") ?? {}).join("\n");
    const without = lakePlugin(emptyLakeUniforms(), TEXTURES, SHARED);
    expect(code(without)).not.toContain("waterPanorama");
    const panorama = standInTexture("panorama");
    const plugin = lakePlugin(emptyLakeUniforms(), { ...TEXTURES, panorama }, SHARED);
    expect(plugin.getSamplers?.()).toEqual([
      { texture: "waterBump", sampler: "waterBumpSampler" },
      { texture: "waterBedHeight", sampleType: "unfilterable-float" },
      { texture: "waterSkyline", sampleType: "unfilterable-float" },
      { texture: "waterPanorama", sampler: "waterPanoramaSampler" },
    ]);
    const bound: { texture: unknown; sampler?: boolean }[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound[3]).toEqual({ texture: panorama });
    const active: unknown[] = [];
    plugin.getActiveTextures?.(active as never);
    expect(active).toEqual([TEXTURES.bump, TEXTURES.bed, TEXTURES.skyline, panorama]);
    // The read, the cylinder it is made on and the flag that gates it: all the material's own uniforms.
    expect(code(plugin)).toContain("textureSampleLevel(waterPanorama,waterPanoramaSampler,");
    for (const name of ["waterPanoramaOn", "waterLakeCentre", "waterLakeRadius"]) expect(code(plugin), name).toContain(`material.${name}`);
    // The uniforms are the same record either way.
    expect(plugin.getUniforms?.().ubo).toEqual(without.getUniforms?.().ubo);
  });

  it("shades before the air is laid over it, at the three points the game's plugin uses", () => {
    const plugin = lakePlugin(emptyLakeUniforms(), TEXTURES, SHARED);
    expect(WATER_PRIORITY).toBeLessThan(ATMOSPHERE_PRIORITY);
    expect(plugin.priority).toBe(WATER_PRIORITY);
    expect(Object.keys(plugin.getCustomCode?.("fragment") ?? {})).toEqual([
      "CUSTOM_FRAGMENT_DEFINITIONS", "CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION",
    ]);
    expect(Object.keys(plugin.getCustomCode?.("vertex") ?? {})).toEqual(["CUSTOM_VERTEX_MAIN_END"]);
  });
});
