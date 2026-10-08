// client/test/game/waterPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { OCEAN_ROUGHNESS_ANCHOR, WaterPlugin, attachWater, oceanArrayPlaceholder, type OceanBinding } from "../../src/game/waterPlugin.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { WATER_ROWS, WATER_F0, WATER_HORIZON, WATER_REFRACT, WATER_REFRACT_DEPTH, WATER_SKIN_DRIFT } from "../../src/game/waterShading.js";
import { RIPPLE_INSET, RIPPLE_LAYERS, RIPPLE_RADIUS, RIPPLE_TIME_WRAP } from "../../src/game/rainParams.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => engine.dispose());

describe("water plugin", () => {
  it("attaches once, idempotently, and activates", () => {
    const mat = new PBRMaterial("w", scene);
    const a = attachWater(mat, WATER_ROWS.sea);
    const b = attachWater(mat, WATER_ROWS.sea);
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(WaterPlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof WaterPlugin)).toHaveLength(1);
  });

  it("declares the bedDepth attribute, its samplers and the sea's, and its hook points", () => {
    const mat = new PBRMaterial("w2", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    const attributes: string[] = [];
    p.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["bedDepth"]);
    const samplers: string[] = [];
    p.getSamplers(samplers);
    expect(samplers).toEqual(["waterBedHeight", "waterScene", "waterDepth", "oceanAtlas", "oceanWindDisp", "oceanWindSlope"]);
    const v = p.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_POSITION", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual([
      OCEAN_ROUGHNESS_ANCHOR,
      "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION",
      "CUSTOM_FRAGMENT_BEFORE_LIGHTS",
      "CUSTOM_FRAGMENT_DEFINITIONS",
    ]);
    // a lake's roughness line is left to Babylon
    expect(f[OCEAN_ROUGHNESS_ANCHOR]).toBe("");
    expect(p.getCustomCode("compute")).toBeNull();
  });

  it("injects exactly the GLSL the .fx files hold, with the constants in lockstep", () => {
    const mat = new PBRMaterial("w3", scene);
    const p = attachWater(mat, WATER_ROWS.sea);
    // a lake's (no ocean) carries the lake's ripples after the water's; the sea's never does
    expect(p.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS).toBe(
      fx("water.fragment.fx") + fx("lakeRipples.fragment.fx") + fx("ocean.fragment.fx") + fx("oceanSurface.fx") + fx("oceanShade.fragment.fx"),
    );
    p.ocean = testOcean();
    const f = p.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("water.fragment.fx") + fx("ocean.fragment.fx") + fx("oceanSurface.fx") + fx("oceanShade.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("waterLights.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe(fx("waterCompose.fragment.fx"));
    const v = p.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx") + fx("ocean.vertex.fx") + fx("oceanSurface.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_POSITION).toBe(fx("oceanDisplace.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("waterWorldPos.vertex.fx"));
    // the water's files end their last line, so the sea's never join it
    expect(fx("water.vertex.fx").endsWith(";\n")).toBe(true);
    expect(fx("water.fragment.fx").endsWith("}\n")).toBe(true);
    expect(fx("lakeRipples.fragment.fx").endsWith("}\n")).toBe(true);
    const d = f.CUSTOM_FRAGMENT_DEFINITIONS;
    expect(d).toContain(`const float WATER_F0 = ${glslFloat(WATER_F0)};`);
    expect(d).toContain(`const float WATER_HORIZON = ${glslFloat(WATER_HORIZON)};`);
    expect(d).toContain(`const float WATER_REFRACT = ${glslFloat(WATER_REFRACT)};`);
    expect(d).toContain(`const float WATER_REFRACT_DEPTH = ${glslFloat(WATER_REFRACT_DEPTH)};`);
    expect(d).toContain("const float WATER_OCTAVE2_TILE = 3.0;");
    expect(fx("water.fragment.fx")).toContain("#ifdef BUMP");
    expect(d).toContain("vec3 n = texture2D(bumpSampler, uv).xyz * 2.0 - 1.0;");
    expect(fx("waterLights.fragment.fx")).toContain("if (waterOctaves > 1.5) {");
    // the sampler lives in the .fx, never in getUniforms().fragment (the UBO-path trap)
    expect(d).toContain("uniform sampler2D waterBedHeight;");
    expect(p.getUniforms().fragment).not.toContain("sampler2D");
    expect(p.getUniforms().vertex).not.toContain("sampler");
  });

  it("discards on land and saturates alpha where the bed texture does not reach", () => {
    const l = fx("waterLights.fragment.fx");
    expect(l).toContain("if (wDepth <= 0.0) discard;");
    // outside the square the vertex depth stands in, never zero
    expect(fx("water.fragment.fx")).toContain("return outside ? vBedDepth : waterLevel - h;");
    expect(l).toContain("alpha = 1.0 - (1.0 - wF) * exp(-2.0 * wKdMean * wDepth);");
    expect(l).toContain("float wF = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - wNdV, 5.0);");
  });

  it("sets F0 to water's and the row's kd on the material, and roughness from the wind and shelter", () => {
    const mat = new PBRMaterial("w4", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    expect(mat.metallicF0Factor).toBeCloseTo(WATER_F0 / 0.04, 6);
    expect(mat.metallic).toBe(0);
    expect(mat.albedoColor.asArray()).toEqual(WATER_ROWS.lowlandLake.lInf);
    p.setWind(0, [1, 0]);
    expect(mat.roughness).toBeLessThan(0.2);
    p.setWind(1, [1, 0]);
    expect(mat.roughness).toBeGreaterThan(0.2);
  });

  it("leaves the roughness alone for a wind change under 1e-3, and moves it for a real one", () => {
    const mat = new PBRMaterial("w4b", scene);
    const p = attachWater(mat, WATER_ROWS.sea);
    p.setWind(0.5, [1, 0]);
    const r = mat.roughness;
    p.setWind(0.5001, [1, 0]);
    expect(mat.roughness).toBe(r);
    p.setWind(1, [1, 0]);
    expect(mat.roughness).not.toBe(r);
  });

  it("declares the bed texel size as a vec2", () => {
    expect(fx("water.fragment.fx")).toContain("vec2 texel = vec2(1.0 / waterBedTexels);");
  });

  it("is not ready until the bed texture exists", () => {
    const mat = new PBRMaterial("w5", scene);
    const p = attachWater(mat, WATER_ROWS.sea);
    expect(p.isReadyForSubMesh()).toBe(false);
    p.bedTexture = RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    // NullEngine never uploads, so its internal texture reports not ready
    expect(p.isReadyForSubMesh()).toBe(false);
    p.bedTexture.getInternalTexture()!.isReady = true;
    expect(p.isReadyForSubMesh()).toBe(true);
  });

  it("reads the scene depth as device depth linearised, and d as the depth below the surface on the eye ray", () => {
    const mat = new PBRMaterial("w6", scene);
    const p = attachWater(mat, WATER_ROWS.sea);
    const u = p.getUniforms();
    const names = u.ubo.map((e) => e.name);
    expect(names).toContain("waterNearFar");
    expect(u.fragment).toContain("uniform vec2 waterNearFar;");
    expect(names).not.toContain("waterDepthLinear");
    expect(p.nearFar).toEqual([0.05, 1000]);
    const d = fx("water.fragment.fx");
    expect(d).not.toContain("float waterViewDepth = 0.0;");
    expect(d).toContain("varying float vWaterViewDepth;");
    expect(fx("water.vertex.fx")).toContain("varying float vWaterViewDepth;");
    // Babylon's view space is left-handed here: +z is forward, so the depth is +z
    expect(fx("waterWorldPos.vertex.fx")).toContain("vWaterViewDepth = (view * worldPos).z;");
    const l = fx("waterLights.fragment.fx");
    expect(l).not.toContain("waterViewDepth");
    expect(l).toContain("float wSceneDepth = waterNearFar.x * waterNearFar.y / (waterNearFar.y - wRaw * (waterNearFar.y - waterNearFar.x));");
    expect(l).not.toContain("mix(wLin");
    // the scene point on the same eye ray, its depth below the surface (spec §4.2)
    expect(l).toContain("float wRayOn = wSceneDepth / max(vWaterViewDepth, 1.0e-3) - 1.0;");
    expect(l).toContain("float wBehind = max(0.0, min(wDepth, (vEyePosition.y - vPositionW.y) * wRayOn));");
  });

  it("lights the water's own colour and adds the bed as radiance after lighting, on the high path", () => {
    const l = fx("waterLights.fragment.fx");
    // one Fresnel before the branch, for both paths
    const fresnel = "float wF = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - wNdV, 5.0);";
    expect(l.split(fresnel)).toHaveLength(2);
    expect(l.indexOf(fresnel)).toBeLessThan(l.indexOf("if (waterHigh < 0.5) {"));
    expect(l.indexOf("vec3 wTransmit = vec3(0.0);")).toBeLessThan(l.indexOf("if (waterHigh < 0.5) {"));
    // the copied bed is already lit: never an albedo
    expect(l).not.toContain("surfaceAlbedo = mix(surfaceAlbedo, wBed, wT);");
    expect(l).toContain("surfaceAlbedo *= 1.0 - wT;");
    expect(l).toContain("wTransmit = wBed * wT * (1.0 - wF);");
    expect(fx("waterCompose.fragment.fx")).toContain("finalEmissive += wTransmit;");
  });

  it("is ready on the high tier as soon as the bed is, whatever the frame's scene and depth report", () => {
    const mat = new PBRMaterial("w7", scene);
    const p = attachWater(mat, WATER_ROWS.sea);
    // a scene copy and a depth with no texture behind them: neither is ready
    const sceneCopy = new BaseTexture(scene);
    const depth = new BaseTexture(scene);
    p.sceneTexture = sceneCopy;
    p.depthTexture = depth;
    expect(sceneCopy.isReady()).toBe(false);
    expect(depth.isReady()).toBe(false);
    // no bed: not ready
    expect(p.isReadyForSubMesh()).toBe(false);
    p.bedTexture = RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    expect(p.isReadyForSubMesh()).toBe(false);
    // the bed ready: ready, with the scene and depth still not
    p.bedTexture.getInternalTexture()!.isReady = true;
    expect(p.isReadyForSubMesh()).toBe(true);
    expect(sceneCopy.isReady() || depth.isReady()).toBe(false);
    // and the high path stays on: both are bound
    const floats: [string, number][] = [];
    const record = (): void => undefined;
    const ubo = {
      updateFloat: (name: string, v: number) => { floats.push([name, v]); },
      updateFloat2: record, updateFloat3: record, updateFloat4: record, updateFloatArray: record, setTexture: vi.fn(),
    } as unknown as UniformBuffer;
    p.bindForSubMesh(ubo);
    expect(floats).toContainEqual(["waterHigh", 1]);
    const setTexture = (ubo as unknown as { setTexture: ReturnType<typeof vi.fn> }).setTexture;
    expect(setTexture).toHaveBeenCalledWith("waterScene", sceneCopy);
    expect(setTexture).toHaveBeenCalledWith("waterDepth", depth);
  });

  it("writes each mesh's own level on every draw (hardBind), not only when the material rebinds", () => {
    const mat = new PBRMaterial("w8", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    // the manager calls hardBindForSubMesh only for plugins registered for the extra events
    expect(p.registerForExtraEvents).toBe(true);
    const extra = (mat.pluginManager as unknown as { _activePluginsForExtraEvents: unknown[] })._activePluginsForExtraEvents;
    expect(extra).toContain(p);
    const updateFloat = vi.fn();
    const ubo = { updateFloat } as unknown as UniformBuffer;
    const pond = (level: number) => ({ getMesh: () => ({ metadata: { waterLevel: level } }) }) as unknown as SubMesh;
    p.hardBindForSubMesh(ubo, scene, engine, pond(42));
    p.hardBindForSubMesh(ubo, scene, engine, pond(17));
    expect(updateFloat.mock.calls).toEqual([["waterLevel", 42], ["waterLevel", 17]]);
    // and bindForSubMesh, skipped between back-to-back draws, no longer writes it
    const writes: string[] = [];
    const record = (name: string) => { writes.push(name); };
    const full = {
      updateFloat: record, updateFloat2: record, updateFloat3: record, updateFloat4: record, updateFloatArray: record, setTexture: record,
    } as unknown as UniformBuffer;
    p.bindForSubMesh(full);
    expect(writes).toContain("waterKd");
    expect(writes).not.toContain("waterLevel");
  });

  it("declares and binds the skin, off by default", () => {
    const mat = new PBRMaterial("wSkin", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    expect(p.skin).toEqual([0, 0]);
    expect(p.getUniforms().ubo.map((u) => u.name)).toContain("waterSkin");
    expect(p.getUniforms().fragment).toContain("uniform vec2 waterSkin;");
    p.skin = [0.75, 123.5];
    const pairs: [string, number, number][] = [];
    const record = (): void => undefined;
    const ubo = {
      updateFloat: record, updateFloat3: record, updateFloat4: record, updateFloatArray: record, setTexture: vi.fn(),
      updateFloat2: (name: string, a: number, b: number) => { pairs.push([name, a, b]); },
    } as unknown as UniformBuffer;
    p.bindForSubMesh(ubo);
    expect(pairs).toContainEqual(["waterSkin", 0.75, 123.5]);
  });

  it("lays the skin over the water after the transmission, and takes the reflection off it", () => {
    const l = fx("waterLights.fragment.fx");
    const skin = l.indexOf("float wSkin = waterSkinMask(vPositionW.xz, wDepth);");
    expect(skin).toBeGreaterThan(l.indexOf("wTransmit = wBed * wT * (1.0 - wF);"));
    expect(l).toContain("wTransmit *= 1.0 - wSkin;");
    expect(l).toContain("if (waterSkin.x > 0.0) {");
    expect(l.indexOf("if (waterSkin.x > 0.0) {")).toBeGreaterThan(skin);
    const c = fx("waterCompose.fragment.fx");
    expect(c).toContain("finalRadianceScaled *= 1.0 - wSkin;");
    expect(c).toContain("finalSpecularScaled *= 1.0 - wSkin;");
    expect(c.indexOf("finalRadianceScaled")).toBeLessThan(c.indexOf("finalEmissive += wTransmit;"));
    const d = fx("water.fragment.fx");
    expect(d).toContain("float waterSkinMask(vec2 xz, float depth)");
    expect(d).toContain("vec3 waterSkinColour(vec2 xz, float viewDepth)");
  });

  it("slides the skin along the wind in both its mask and its colour, and the second octave downwind", () => {
    const d = fx("water.fragment.fx");
    const colour = d.indexOf("vec3 waterSkinColour(");
    const mask = d.slice(d.indexOf("float waterSkinMask("), colour);
    const col = d.slice(colour);
    const drift = "vec2 p = xz + waterSkin.y - waterWindTime * WATER_SKIN_DRIFT;";
    expect(mask).toContain(drift);
    expect(col).toContain(drift);
    const lake = fx("lakeRipples.fragment.fx");
    const ripple = lake.slice(lake.indexOf("vec2 lakeRipple2("));
    expect(ripple).toContain("vec2 uv = xz / WATER_OCTAVE2_TILE - waterWindTime * WATER_OCTAVE2_DRIFT;");
    expect(fx("waterLights.fragment.fx")).toContain("vec2 wSlope = lakeRipple2(vPositionW.xz);");
    expect(fx("waterLights.fragment.fx")).not.toContain("waterRipple2(");
    // A texel at uv0 is drawn where xz = TILE * (uv0 + waterWindTime * DRIFT), and waterWindTime runs along
    // the wind's direction times its speed: the octave's pattern travels downwind at TILE * DRIFT m/s at full wind.
    const octave = (name: string): number => Number(new RegExp(`const float ${name} = ([^;]+);`).exec(d)![1]);
    expect(octave("WATER_OCTAVE2_TILE") * octave("WATER_OCTAVE2_DRIFT")).toBeCloseTo(0.12, 12);
    for (const part of [mask, col, ripple]) {
      expect(part).not.toContain("waterWind * (waterTime");
      expect(part).not.toContain("waterWind * waterTime");
    }
    expect(fx("water.fragment.fx")).toContain(`const float WATER_SKIN_DRIFT = ${glslFloat(WATER_SKIN_DRIFT)};`);
  });
});

describe("the rain's rings on the water", () => {
  it("declares and binds the rain, off by default", () => {
    const mat = new PBRMaterial("wRain", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    expect(p.rain).toBe(0);
    const names = p.getUniforms().ubo.map((u) => u.name);
    expect(names).toContain("waterRain");
    expect(names.indexOf("waterRain")).toBe(names.indexOf("waterSkin") + 1);
    expect(p.getUniforms().fragment).toContain("uniform float waterRain;");
    p.rain = 0.6;
    const floats: [string, number][] = [];
    const record = (): void => undefined;
    const ubo = {
      updateFloat2: record, updateFloat3: record, updateFloat4: record, updateFloatArray: record, setTexture: vi.fn(),
      updateFloat: (name: string, v: number) => { floats.push([name, v]); },
    } as unknown as UniformBuffer;
    p.bindForSubMesh(ubo);
    expect(floats).toContainEqual(["waterRain", 0.6]);
  });

  it("rings the normal before the horizon clamp and before the skin, on a uniform branch: the lake's near the eye, the sea's four layers", () => {
    const d = fx("water.fragment.fx");
    expect(d).toContain("vec2 waterRainSlope(vec2 xz)");
    expect(d).toContain(`mod(waterTime, ${glslFloat(RIPPLE_TIME_WRAP)})`);
    expect(d).toContain("if (waterRain <= 0.0) return vec2(0.0);");
    const l = fx("waterLights.fragment.fx");
    const lake = l.indexOf("vec2 wRs = lakeRainSlope(vPositionW.xz, waterLakeTime, waterRain, length(vPositionW - vEyePosition.xyz));");
    const sea = l.indexOf("vec2 wRs = waterRainSlope(vPositionW.xz);");
    // the lake's in the gate's lake branch, after its octaves; the sea's in a gate of its own after it
    expect(lake).toBeGreaterThan(l.indexOf("lakeRipple2(vPositionW.xz)"));
    // the normal's gate: the sea's branch, then the lake's
    const lakeBranch = l.indexOf("#else", l.indexOf("float wOceanVar ="));
    expect(lakeBranch).toBeGreaterThan(-1);
    expect(lake).toBeGreaterThan(lakeBranch);
    expect(l.slice(lakeBranch, lake)).not.toContain("#endif");
    expect(l.slice(lake, sea)).toContain("#endif\n#ifdef OCEAN\n");
    expect(l.slice(sea)).toContain("normalW = normalize(normalW + vec3(wRs.x, 0.0, wRs.y) * waterRain);\n}\n#endif\n");
    for (const rings of [lake, sea]) {
      expect(rings).toBeGreaterThan(-1);
      expect(l.lastIndexOf("if (waterRain > 0.0) {", rings)).toBeGreaterThan(-1);
      expect(rings).toBeLessThan(l.indexOf("waterHorizonNormal("));
      expect(rings).toBeLessThan(l.indexOf("float wSkin ="));
    }
    // the lake's rings carry their own scale by the rain
    expect(l).toContain("normalW = normalize(normalW + vec3(wRs.x, 0.0, wRs.y));");
  });

  it("draws the puddles' four layers, their numbers those of rainParams.ts", () => {
    const d = fx("water.fragment.fx");
    const num = String.raw`(-?\d+(?:\.\d+)?)`;
    const call = new RegExp(
      String.raw`waterRainLayer\(xz, t, ${num}, ${num}, vec2\(${num}, ${num}\), ${num}, ${num}\)`,
      "g",
    );
    const layers = [...d.matchAll(call)].map((m) => m.slice(1).map(Number));
    expect(layers).toHaveLength(RIPPLE_LAYERS.length);
    layers.forEach(([index, scale, ox, oy, timeMul, timeAdd], i) => {
      const want = RIPPLE_LAYERS[i]!;
      expect(index).toBe(i);
      expect(Math.abs(scale! - want.scale)).toBeLessThan(1e-9);
      expect(Math.abs(ox! - want.offset[0])).toBeLessThan(1e-9);
      expect(Math.abs(oy! - want.offset[1])).toBeLessThan(1e-9);
      expect(Math.abs(timeMul! - want.timeMul)).toBeLessThan(1e-9);
      expect(Math.abs(timeAdd! - want.timeAdd)).toBeLessThan(1e-9);
    });
    const radius = /const float WATER_RAIN_RADIUS = ([\d.]+);/.exec(d);
    const inset = /const float WATER_RAIN_INSET = ([\d.]+);/.exec(d);
    expect(Math.abs(Number(radius?.[1]) - RIPPLE_RADIUS)).toBeLessThan(1e-9);
    expect(Math.abs(Number(inset?.[1]) - RIPPLE_INSET)).toBeLessThan(1e-9);
    expect(d).toContain("rainParams.ts");
  });

  it("integrates the wind's velocity, its direction times its speed, over the clock, turning with it", () => {
    const p = attachWater(new PBRMaterial("wInt", scene), WATER_ROWS.lowlandLake);
    expect(p.windTime).toEqual([0, 0]);
    expect(p.windSpeed).toBe(0);
    p.setWind(0.5, [1, 0]);
    expect(p.windSpeed).toBe(0.5);
    p.advance(1);
    p.advance(2);
    expect(p.windTime[0]).toBeCloseTo(0.5, 9);
    p.advance(3);
    expect(p.windTime[0]).toBeCloseTo(1, 9);
    p.setWind(0.5, [0, 1]);
    p.advance(4);
    expect(p.windTime[0]).toBeCloseTo(1, 9);
    expect(p.windTime[1]).toBeCloseTo(0.5, 9);
    // a stronger wind drifts it faster, a still one not at all
    p.setWind(1, [0, 1]);
    p.advance(6);
    expect(p.windTime[1]).toBeCloseTo(2.5, 9);
    p.setWind(0, [0, 1]);
    p.advance(10);
    expect(p.windTime[1]).toBeCloseTo(2.5, 9);
    expect(p.time).toBe(10);
  });

  it("binds the wind's integral on both paths", () => {
    const p = attachWater(new PBRMaterial("wInt", scene), WATER_ROWS.lowlandLake);
    expect(p.getUniforms().ubo.map((u) => u.name)).toContain("waterWindTime");
    expect(p.getUniforms().fragment).toContain("uniform vec2 waterWindTime;");
    p.windTime = [3, 4];
    const pairs: [string, number, number][] = [];
    const record = (): void => undefined;
    const ubo = {
      updateFloat: record, updateFloat3: record, updateFloat4: record, updateFloatArray: record, setTexture: vi.fn(),
      updateFloat2: (name: string, a: number, b: number) => { pairs.push([name, a, b]); },
    } as unknown as UniformBuffer;
    p.bindForSubMesh(ubo);
    expect(pairs).toContainEqual(["waterWindTime", 3, 4]);
  });
});

describe("the lake's ripples in the water plugin", () => {
  it("declares the lake's time and the paws' cover before the sea's uniforms and binds them on every draw, on a lake alone", () => {
    const lake = attachWater(new PBRMaterial("wL1", scene), WATER_ROWS.lowlandLake);
    const u = lake.getUniforms();
    const names = u.ubo.map((e) => e.name);
    expect(names.slice(names.indexOf("waterRain"), names.indexOf("waterRain") + 3)).toEqual(["waterRain", "waterLakeTime", "waterPawCover"]);
    expect(u.ubo).toContainEqual({ name: "waterLakeTime", size: 1, type: "float" });
    expect(u.ubo).toContainEqual({ name: "waterPawCover", size: 1, type: "float" });
    expect(u.fragment).toContain("uniform float waterLakeTime;");
    expect(u.fragment).toContain("uniform float waterPawCover;");
    expect(u.vertex).not.toContain("waterLakeTime");
    expect(lake.lakeTime).toBe(0);
    // rough until the renderer first sets it
    expect(lake.pawCover).toBe(1);
    const sea = attachWater(new PBRMaterial("wL2", scene), WATER_ROWS.sea);
    sea.ocean = testOcean();
    // the sea's uniforms are as they were before the lake's ripples
    const seaU = sea.getUniforms();
    expect(seaU.ubo).toHaveLength(24);
    const seaNames = seaU.ubo.map((e) => e.name);
    expect(seaNames.slice(seaNames.indexOf("waterRain"), seaNames.indexOf("waterRain") + 2)).toEqual(["waterRain", "oceanPhase0"]);
    expect(seaU.fragment).not.toContain("waterLakeTime");
    expect(seaU.fragment).not.toContain("waterPawCover");
    for (const [p, time, cover, bound] of [[lake, 12.5, 0.25, true], [sea, 7, 0.5, false]] as const) {
      p.setLakeTime(time);
      p.setPawCover(cover);
      for (let draw = 0; draw < 2; draw++) {
        const floats: Record<string, number> = {};
        const ubo = new Proxy(
          {},
          { get: (_t, key) => (key === "updateFloat" ? (n: string, v: number) => void (floats[n] = v) : () => undefined) },
        ) as unknown as UniformBuffer;
        p.bindForSubMesh(ubo);
        expect(floats.waterLakeTime).toBe(bound ? time : undefined);
        expect(floats.waterPawCover).toBe(bound ? cover : undefined);
        expect(floats.waterRain).toBe(0);
      }
    }
    // taken off its ocean, a material is a lake's again, and declares them
    sea.ocean = null;
    expect(sea.getUniforms().ubo).toHaveLength(26);
  });

  it("wraps the lake's time as the wind's and clamps the paws' cover to 0..1, either 0 when it is not finite", () => {
    const p = attachWater(new PBRMaterial("wL3", scene), WATER_ROWS.lowlandLake);
    p.setLakeTime(301.5);
    expect(p.lakeTime).toBeCloseTo(1.5, 9);
    p.setLakeTime(299);
    expect(p.lakeTime).toBe(299);
    p.setLakeTime(900);
    expect(p.lakeTime).toBe(0);
    p.setLakeTime(-1);
    expect(p.lakeTime).toBe(299);
    p.setPawCover(1.4);
    expect(p.pawCover).toBe(1);
    p.setPawCover(-0.2);
    expect(p.pawCover).toBe(0);
    p.setPawCover(0.35);
    expect(p.pawCover).toBe(0.35);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      p.setLakeTime(42);
      p.setLakeTime(bad);
      expect(p.lakeTime, String(bad)).toBe(0);
      p.setPawCover(0.35);
      p.setPawCover(bad);
      expect(p.pawCover, String(bad)).toBe(0);
    }
  });

  it("assembles the lake's normal from the paws: the octaves at the mask's amplitude, glass where it is 0, then the rings", () => {
    const l = fx("waterLights.fragment.fx");
    // the normal's gate: the sea's branch, then the lake's
    const branch = l.indexOf("#else", l.indexOf("float wOceanVar ="));
    const lake = l.slice(branch, l.indexOf("#endif", branch));
    const order = [
      "float wPaw = lakePaw(vPositionW.xz, waterLakeTime, waterWind, waterPawCover, lakeGust(vPositionW.xz, waterLakeTime, waterWind));",
      "float wOctave = octaveAmplitude(wPaw);",
      "normalW = normalize(vec3(normalW.x * wOctave, normalW.y, normalW.z * wOctave));",
      "if (waterOctaves > 1.5) {",
      "normalW = normalize(normalW + vec3(wSlope.x, 0.0, wSlope.y) * wOctave);",
      "if (waterRain > 0.0) {",
      "vec2 wRs = lakeRainSlope(",
    ].map((needle) => lake.indexOf(needle));
    expect(order.every((at) => at >= 0)).toBe(true);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1] as number);
    // the four stamped layers are the sea's alone
    expect(lake).not.toContain("waterRainSlope(");
  });
});

/** The ten vec4 uniforms the sea's waves read, in their order, before the components' array. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
  "oceanWindStats", "oceanWindPivot",
];

/** An ocean as `oceanRender.ts` binds one, with values to tell apart. */
function testOcean(): OceanBinding {
  return {
    atlas: RawTexture.CreateRGBATexture(new Float32Array(4), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT),
    windDisp: oceanArrayPlaceholder(scene),
    windSlope: oceanArrayPlaceholder(scene),
    phases: Float32Array.from({ length: 12 }, (_, i) => i + 0.5),
    components: Float32Array.from({ length: 48 }, (_, i) => i + 0.25),
    swell: [0.96, 0.28, 11, 2],
    tips: [-520, -150, -505, 160],
    coast: [-6240, 12, 12, 0],
    wind: [0.4, 0.81, 0, 0.01],
    windDir: [0.6, -0.8, 9, 0.35],
    windStats: [0.7, 0.02, 0.03, 0.04],
    windPivot: [-412.5, 37, 0, 0],
  };
}

/** A bed texture, as every drawn water material has one. */
const bedTexture = (): RawTexture =>
  RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);

describe("the sea's waves in the water plugin", () => {
  it("declares the ten vec4 uniforms and the components' twelve on every path, ocean or none", () => {
    const p = attachWater(new PBRMaterial("wO1", scene), WATER_ROWS.lowlandLake);
    const u = p.getUniforms();
    for (const name of OCEAN_UNIFORMS) {
      expect(u.ubo).toContainEqual({ name, size: 4, type: "vec4" });
      expect(u.fragment).toContain(`uniform vec4 ${name};`);
      // the vertex stage reads them too, which takes this where uniform buffers are not supported
      expect(u.vertex).toContain(`uniform vec4 ${name};`);
    }
    expect(u.ubo.map((e) => e.name).slice(-11, -1)).toEqual(OCEAN_UNIFORMS);
    // the swell's components last, an array of twelve vec4s, on both paths
    expect(u.ubo[u.ubo.length - 1]).toEqual({ name: "oceanK", size: 4, type: "vec4", arraySize: 12 });
    expect(u.fragment).toContain("uniform vec4 oceanK[12];");
    expect(u.vertex).toContain("uniform vec4 oceanK[12];");
    expect(u.ubo).toHaveLength(26);
  });

  it("declares its samplers in the .fx and never in getUniforms, and gates every line of its GLSL on OCEAN", () => {
    const vertex = fx("ocean.vertex.fx");
    const fragment = fx("ocean.fragment.fx");
    expect(vertex).toContain("uniform highp sampler2D oceanAtlas;");
    expect(vertex).toContain("uniform highp sampler2DArray oceanWindDisp;");
    expect(vertex).not.toContain("oceanWindSlope");
    expect(fragment).toContain("uniform highp sampler2D oceanAtlas;");
    expect(fragment).toContain("uniform highp sampler2DArray oceanWindDisp;");
    expect(fragment).toContain("uniform highp sampler2DArray oceanWindSlope;");
    const u = attachWater(new PBRMaterial("wO2", scene), WATER_ROWS.sea).getUniforms();
    expect(u.fragment).not.toContain("sampler");
    expect(u.vertex).not.toContain("sampler");
    for (const name of ["ocean.vertex.fx", "oceanDisplace.vertex.fx", "ocean.fragment.fx"]) {
      const lines = fx(name).trimEnd().split("\n");
      expect(lines[0], name).toBe("#ifdef OCEAN");
      expect(lines[lines.length - 1], name).toBe("#endif");
      expect(lines.filter((line) => line.trimStart().startsWith("#")), name).toEqual(["#ifdef OCEAN", "#endif"]);
    }
  });

  it("carries the rings' stitch and the position before the waves, and moves the vertex by them", () => {
    const vertex = fx("ocean.vertex.fx");
    expect(vertex).toContain("attribute float oceanMorph;");
    expect(vertex).toContain("attribute vec2 oceanCoarse;");
    expect(vertex).toContain("varying vec2 vOceanXZ;");
    expect(fx("ocean.fragment.fx")).toContain("varying vec2 vOceanXZ;");
    // and the swell the vertex stage sums, for the fragment stage, in both
    for (const name of ["ocean.vertex.fx", "ocean.fragment.fx"]) {
      expect(fx(name), name).toContain("varying vec4 vOceanSwellA;");
      expect(fx(name), name).toContain("varying vec4 vOceanSwellB;");
    }
    const displace = fx("oceanDisplace.vertex.fx");
    expect(displace).toContain("vOceanXZ = positionUpdated.xz;");
    // the waves move it, once (oceanShader.test.ts pins how), and the swell goes on
    expect(displace).toContain("positionUpdated += oceanDisplace(positionUpdated.xz, oceanVertexSwell, oceanVertexEnv);");
    expect(displace).toContain("vOceanSwellA = oceanVertexSwell;");
    expect(displace).toContain("vOceanSwellB = vec4(oceanVertexEnv, length(oceanVertexEnv), 0.0);");
  });

  it("sets OCEAN and asks for the stitch only with an ocean, and rebuilds the effect when one comes or goes", () => {
    const p = attachWater(new PBRMaterial("wO3", scene), WATER_ROWS.sea);
    const dirty = vi.spyOn(p, "markAllDefinesAsDirty");
    const defines = (): Record<string, unknown> => {
      const d: Record<string, unknown> = {};
      p.prepareDefines(d as never, scene, undefined as never);
      return d;
    };
    const attributes = (): string[] => {
      const a: string[] = [];
      p.getAttributes(a, scene, undefined as never);
      return a;
    };
    expect(p.ocean).toBeNull();
    expect(defines()).toEqual({ WATER: true, OCEAN: false });
    expect(attributes()).toEqual(["bedDepth"]);
    p.ocean = testOcean();
    expect(defines()).toEqual({ WATER: true, OCEAN: true });
    expect(attributes()).toEqual(["bedDepth", "oceanMorph", "oceanCoarse"]);
    expect(dirty).toHaveBeenCalledTimes(1);
    // another ocean: the define stands, nothing to rebuild
    p.ocean = testOcean();
    expect(dirty).toHaveBeenCalledTimes(1);
    p.ocean = null;
    expect(defines().OCEAN).toBe(false);
    expect(dirty).toHaveBeenCalledTimes(2);
  });

  it("binds the ocean's values, and zeros without one", () => {
    const p = attachWater(new PBRMaterial("wO4", scene), WATER_ROWS.sea);
    const record = (): Record<string, number[]> => {
      const quads: Record<string, number[]> = {};
      const ignore = (): void => undefined;
      const ubo = {
        updateFloat: ignore, updateFloat2: ignore, updateFloat3: ignore, setTexture: ignore,
        updateFloat4: (name: string, a: number, b: number, c: number, d: number) => { quads[name] = [a, b, c, d]; },
        updateFloatArray: (name: string, array: Float32Array) => { quads[name] = Array.from(array); },
      } as unknown as UniformBuffer;
      p.bindForSubMesh(ubo);
      return quads;
    };
    const none = record();
    for (const name of OCEAN_UNIFORMS) expect(none[name], name).toEqual([0, 0, 0, 0]);
    expect(none.oceanK).toEqual(new Array(48).fill(0));
    p.ocean = testOcean();
    const bound = record();
    expect(bound.oceanPhase0).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(bound.oceanPhase1).toEqual([4.5, 5.5, 6.5, 7.5]);
    expect(bound.oceanPhase2).toEqual([8.5, 9.5, 10.5, 11.5]);
    expect(bound.oceanSwell).toEqual([0.96, 0.28, 11, 2]);
    expect(bound.oceanTips).toEqual([-520, -150, -505, 160]);
    expect(bound.oceanCoast).toEqual([-6240, 12, 12, 0]);
    expect(bound.oceanWind).toEqual([0.4, 0.81, 0, 0.01]);
    expect(bound.oceanWindDir).toEqual([0.6, -0.8, 9, 0.35]);
    expect(bound.oceanWindStats).toEqual([0.7, 0.02, 0.03, 0.04]);
    expect(bound.oceanWindPivot).toEqual([-412.5, 37, 0, 0]);
    expect(bound.oceanK).toEqual(Array.from({ length: 48 }, (_, i) => i + 0.25));
  });

  it("writes the components into a uniform buffer laid out from its list on every bind: the sea's twelve vec4s, a lake's zeros", () => {
    // An engine with uniform buffers, so Babylon's buffer lays the array out as std140 and writes it in place.
    const own = webgpuProcessingEngine();
    try {
      const s = new Scene(own);
      const p = attachWater(new PBRMaterial("wOK", s), WATER_ROWS.sea);
      p.bedTexture = RawTexture.CreateRTexture(new Float32Array(4), 2, 2, s, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
      // Babylon's own buffer, laid out as the plugin manager lays it out from the list
      const ubo = new UniformBuffer(own, undefined, false, "waterTest");
      for (const u of p.getUniforms().ubo) ubo.addUniform(u.name, u.size, u.arraySize ?? 0);
      ubo.create();
      // the textures go to an effect, which this buffer has none of
      ubo.setTexture = (): void => undefined;
      const view = ubo as unknown as { _bufferData: Float32Array; _uniformLocations: Record<string, number> };
      const data = (): number[] => {
        const at = view._uniformLocations.oceanK as number;
        return Array.from(view._bufferData.subarray(at, at + 48));
      };
      // the array starts on a vec4 and closes the buffer: twelve vec4s, no padding between them
      expect((view._uniformLocations.oceanK as number) % 4).toBe(0);
      expect(view._bufferData.length - (view._uniformLocations.oceanK as number)).toBe(48);
      // a lake's draw: zeros
      p.bindForSubMesh(ubo);
      expect(data()).toEqual(new Array(48).fill(0));
      // the sea's draw: the binding's components, in order, (k0x, k0z, q0, a0) each
      const ocean = { ...testOcean(), atlas: p.bedTexture, windDisp: oceanArrayPlaceholder(s), windSlope: oceanArrayPlaceholder(s) };
      p.ocean = ocean;
      p.bindForSubMesh(ubo);
      expect(data()).toEqual(Array.from(ocean.components));
      // the waves gone: zeros again
      p.ocean = null;
      p.bindForSubMesh(ubo);
      expect(data()).toEqual(new Array(48).fill(0));
      ubo.dispose();
    } finally {
      own.dispose();
    }
  });

  it("binds every sampler it lists in every state it is drawn in: a lake, the sea, the high tier's sea, the sea's waves gone", () => {
    const p = attachWater(new PBRMaterial("wO5", scene), WATER_ROWS.sea);
    const ocean = testOcean();
    const states: [string, () => void][] = [
      ["a lake", () => { p.bedTexture = bedTexture(); }],
      ["the sea", () => { p.ocean = ocean; }],
      ["the high tier's sea", () => { p.sceneTexture = new BaseTexture(scene); p.depthTexture = new BaseTexture(scene); }],
      ["the waves gone", () => { p.ocean = null; }],
    ];
    const missing: string[] = [];
    const seen: Record<string, Record<string, unknown>> = {};
    for (const [state, enter] of states) {
      enter();
      const declared: string[] = [];
      p.getSamplers(declared);
      const bound: Record<string, unknown> = {};
      const ubo = new Proxy(
        {},
        { get: (_t, key) => (key === "setTexture" ? (n: string, t: unknown) => void (bound[n] = t) : () => undefined) },
      ) as unknown as UniformBuffer;
      p.bindForSubMesh(ubo);
      for (const sampler of declared) if (!(sampler in bound)) missing.push(`${state}: ${sampler}`);
      seen[state] = bound;
    }
    expect(missing).toEqual([]);
    // the sea's own textures with an ocean; the bed and the scene's array placeholder without
    expect(seen["the sea"]!.oceanAtlas).toBe(ocean.atlas);
    expect(seen["the sea"]!.oceanWindDisp).toBe(ocean.windDisp);
    expect(seen["a lake"]!.oceanAtlas).toBe(p.bedTexture);
    expect(seen["a lake"]!.oceanWindDisp).toBe(oceanArrayPlaceholder(scene));
    expect(seen["a lake"]!.oceanWindSlope).toBe(oceanArrayPlaceholder(scene));
    expect(seen["the waves gone"]!.oceanWindSlope).toBe(oceanArrayPlaceholder(scene));
  });

  it("leaves a lake's shader as the sea's code found it and the sea's main as the lake's ripples found it, compiled as WebGPU compiles them", async () => {
    /** The water plugin with only the water's own hooks, as it was before the sea's waves. */
    class WaterAlone extends WaterPlugin {
      override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
        const code = super.getCustomCode(shaderType);
        if (code === null) return null;
        if (shaderType === "vertex") {
          return { CUSTOM_VERTEX_DEFINITIONS: fx("water.vertex.fx"), CUSTOM_VERTEX_UPDATE_WORLDPOS: fx("waterWorldPos.vertex.fx") };
        }
        return { ...code, CUSTOM_FRAGMENT_DEFINITIONS: fx("water.fragment.fx") + fx("lakeRipples.fragment.fx") };
      }
    }
    /** The stages one water material compiles to, on an engine of its own (an
     * engine shares an effect between materials of one define set); drawn
     * first as the other body, when `turned`, then given its ocean (a sea) or
     * taken off it (a lake). */
    const compiled = async (
      make: (material: PBRMaterial) => WaterPlugin,
      sea: boolean,
      turned = false,
    ): Promise<{ vertex: string; fragment: string }> => {
      const own = webgpuProcessingEngine();
      try {
        const s = new Scene(own);
        s.activeCamera = new UniversalCamera("c", new Vector3(0, 2, -5), s);
        const material = new PBRMaterial("water", s);
        material.backFaceCulling = false;
        const plugin = make(material);
        const bed = RawTexture.CreateRTexture(new Float32Array(4), 2, 2, s, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
        plugin.bedTexture = bed;
        const bindOcean = (): void => {
          plugin.ocean = { ...testOcean(), atlas: bed, windDisp: oceanArrayPlaceholder(s), windSlope: oceanArrayPlaceholder(s) };
        };
        if (sea !== turned) bindOcean();
        const mesh = MeshBuilder.CreateGround("ground", { width: 4, height: 4 }, s);
        const vertices = mesh.getTotalVertices();
        mesh.setVerticesData("bedDepth", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanMorph", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanCoarse", new Float32Array(vertices * 2), false, 2);
        mesh.material = material;
        if (turned) {
          await drawnEffect(mesh);
          if (sea) bindOcean();
          else plugin.ocean = null;
        }
        const effect = await drawnEffect(mesh);
        return { vertex: effect._vertexSourceCode, fragment: effect._fragmentSourceCode };
      } finally {
        own.dispose();
      }
    };
    const lake = await compiled((m) => new WaterPlugin(m, WATER_ROWS.lowlandLake), false);
    const before = await compiled((m) => new WaterAlone(m, WATER_ROWS.lowlandLake), false);
    expect(lake.vertex).toBe(before.vertex);
    expect(lake.fragment).toBe(before.fragment);
    expect(lake.vertex).not.toContain("vOceanXZ");
    // and the sea's is not: the comparison can see the ocean's code
    const sea = await compiled((m) => new WaterPlugin(m, WATER_ROWS.sea), true);
    expect(sea.vertex).toContain("vOceanXZ = positionUpdated.xz;");
    expect(sea.fragment).toContain("vOceanXZ");
    // The sea's whole stages, byte for byte the text they compiled to before the lake's ripples
    // (3e1942c): neither the ripples' definitions nor their uniforms reach the sea.
    const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
    expect(sha(sea.fragment)).toBe("a37171918cc2c9c3ef0b09433cc8de9060149e9448a574d0d900071aad0baf4d");
    expect(sha(sea.vertex)).toBe("f6751544362772d1905d86fa394cc5074afe09d0cfa3c1315cea90da806a3763");
    // and a material drawn as a lake, then given its ocean, rebuilds its uniforms to the sea's
    const turned = await compiled((m) => new WaterPlugin(m, WATER_ROWS.sea), true, true);
    expect(sha(turned.fragment)).toBe("a37171918cc2c9c3ef0b09433cc8de9060149e9448a574d0d900071aad0baf4d");
    expect(sha(turned.vertex)).toBe("f6751544362772d1905d86fa394cc5074afe09d0cfa3c1315cea90da806a3763");
    // and one drawn as a sea, then taken off its ocean, rebuilds them to the lake's
    const back = await compiled((m) => new WaterPlugin(m, WATER_ROWS.lowlandLake), false, true);
    expect(back.fragment).toBe(lake.fragment);
    expect(back.vertex).toBe(lake.vertex);
    // The sea's main is the text it compiled to before the lake's ripples, and reads none of them.
    const main = (fragment: string): string => fragment.slice(fragment.indexOf("void main("));
    expect(sha(main(sea.fragment))).toBe("91382f0cd2700903c0d9aae19a4e5d99e7d3382db06b0d2bc8cdf732dc8d553d");
    for (const name of ["lakePaw(", "lakeGust(", "lakeRainSlope(", "octaveAmplitude(", "wPaw", "waterLakeTime", "waterPawCover"]) {
      expect(main(sea.fragment), name).not.toContain(name);
    }
    expect(main(sea.fragment)).toContain("vec2 wRs = waterRainSlope(vPositionW.xz);");
    // and the lake's reads them in place of the four layers: the comparison can see the lake's code
    expect(main(lake.fragment)).toContain("float wPaw = lakePaw(vPositionW.xz, waterLakeTime, waterWind, waterPawCover, lakeGust(vPositionW.xz, waterLakeTime, waterWind));");
    expect(main(lake.fragment)).toContain("vec2 wRs = lakeRainSlope(vPositionW.xz, waterLakeTime, waterRain, length(vPositionW - vEyePosition.xyz));");
    expect(main(lake.fragment)).not.toContain("waterRainSlope(");
  }, timeLimit(30_000));
});
