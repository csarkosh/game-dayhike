import type { PluginUniformBlock } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { ATMOSPHERE_PRIORITY } from "@csarkosh/engine/game/lite/atmospherePlugin";
import { FRAME_BLOCK, FRAME_FIELDS, inFrameBlock } from "@csarkosh/engine/game/lite/frameBlock";
import { WATER_PRIORITY, lakePlugin } from "@csarkosh/engine/game/lite/lakePlugin";
import { lakeWaterRow } from "@csarkosh/engine/game/waterShading";
import { createWaterSurface, emptyLakeMirrorUniforms, emptyLakeUniforms, emptyWaterFrameUniforms, lakeUniforms, setWaterCalm, setWaterLakeBody } from "@csarkosh/engine/game/waterSurface";
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

  it("carries the frame behind it only on the tier that reads through: two pictures of the pass's own, the read in the alpha's place, and the bed's light after the fog", () => {
    const code = (plugin: ReturnType<typeof lakePlugin>): string => Object.values(plugin.getCustomCode?.("fragment") ?? {}).join("\n");
    const without = lakePlugin(emptyLakeUniforms(), TEXTURES, SHARED);
    expect(code(without)).not.toMatch(/waterKept|wTransmit|lakeLens/);
    const colour = standInTexture("kept");
    const depth = standInTexture("keptDepth");
    let asked = 0;
    const behind = { colour: () => (asked++, colour), depth: () => depth, breaks: 0 };
    const plugin = lakePlugin(emptyLakeUniforms(), { ...TEXTURES, behind }, SHARED);
    expect(plugin.getSamplers?.().slice(-2)).toEqual([{ texture: "waterKept", sampler: "waterKeptSampler" }, { texture: "waterKeptDepth", sampleType: "unfilterable-float" }]);
    // Handed on as they stand each time the bindings are made, and never counted among the material's own.
    for (let i = 0; i < 2; i++) {
      const bound: { texture: unknown; sampler?: boolean }[] = [];
      plugin.bindTextures?.(bound as never);
      expect(bound.slice(-2)).toEqual([{ texture: colour }, { texture: depth, sampler: false }]);
    }
    expect(asked).toBe(2);
    const active: unknown[] = [];
    plugin.getActiveTextures?.(active as never);
    expect(active).toEqual([TEXTURES.bump, TEXTURES.bed, TEXTURES.skyline]);
    const points = plugin.getCustomCode?.("fragment") ?? {};
    expect(Object.keys(points)).toEqual([
      "CUSTOM_FRAGMENT_DEFINITIONS", "CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION", "CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR",
    ]);
    expect(points.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color+=wTransmit;");
    expect(code(plugin)).toContain("fn lakeLens(");
    expect(code(plugin)).not.toContain("alpha=1.0-(1.0-wF)*exp(");
    // The projection's terms and the sun's share are the frame's, read from the block.
    expect(code(plugin)).toContain(`${FRAME_BLOCK}.frameProjection[3].z`);
    expect(code(plugin)).toContain(`${FRAME_BLOCK}.waterSun`);
    expect(code(plugin)).not.toContain("material.frameProjection");
    // The uniforms are the same record either way.
    expect(plugin.getUniforms?.().ubo).toEqual(without.getUniforms?.().ubo);
  });

  it("carries the mirror only where it is handed one: its picture as it stands when the bindings are made, the read of it, and its numbers after the lake's own", () => {
    const code = (plugin: ReturnType<typeof lakePlugin>): string => Object.values(plugin.getCustomCode?.("fragment") ?? {}).join("\n");
    const without = lakePlugin(emptyLakeUniforms(), TEXTURES, SHARED);
    expect(code(without)).not.toMatch(/waterMirrorUv|waterMirrorSample|waterMirrorVP/);
    const first = standInTexture("mirror");
    const second = standInTexture("mirrorResized");
    let now = first;
    const numbers = emptyLakeMirrorUniforms();
    const plugin = lakePlugin(emptyLakeUniforms(), { ...TEXTURES, mirror: { picture: () => now, uniforms: numbers } }, SHARED);
    expect(plugin.getSamplers?.().at(-1)).toEqual({ texture: "waterMirror", sampler: "waterMirrorSampler" });
    const bound: { texture: unknown; sampler?: boolean }[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound.at(-1)).toEqual({ texture: first });
    now = second;
    const again: { texture: unknown; sampler?: boolean }[] = [];
    plugin.bindTextures?.(again as never);
    expect(again.at(-1)).toEqual({ texture: second });
    const active: unknown[] = [];
    plugin.getActiveTextures?.(active as never);
    expect(active).toEqual([TEXTURES.bump, TEXTURES.bed, TEXTURES.skyline]);
    const fields = plugin.getUniforms?.().ubo ?? [];
    const own = without.getUniforms?.().ubo ?? [];
    expect(fields.slice(0, own.length)).toEqual(own);
    expect(fields.slice(own.length)).toEqual([
      { name: "waterMirrorVP", type: "mat4x4<f32>" }, { name: "waterMirrorOn", type: "f32" }, { name: "waterMirrorK", type: "f32" }, { name: "waterMirrorSmearPx", type: "f32" },
      { name: "waterMirrorMotion", type: "f32" },
    ]);
    // Written with the lake's own, wherever Lite lays them.
    numbers.waterMirrorVP.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    numbers.waterMirrorOn[0] = 1;
    const { data, offsets } = laidOut(plugin);
    plugin.writeUbo?.(data, offsets as never);
    expect(readUniform(data, offsets, "waterMirrorVP", 16)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(readUniform(data, offsets, "waterMirrorOn", 1)).toEqual([1]);
    expect(code(plugin)).toContain("fn waterMirrorUv(");
    expect(code(plugin)).toContain(`${FRAME_BLOCK}.fadeRows`);
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
