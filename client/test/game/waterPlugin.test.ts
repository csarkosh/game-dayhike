// client/test/game/waterPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe.js";
import {
  OCEAN_ROUGHNESS_ANCHOR, WaterPlugin, attachWater, oceanArrayPlaceholder, oceanSwashPlaceholder, waterMirrorPlaceholder,
  type OceanBinding,
} from "../../src/game/waterPlugin.js";
import { MIRROR_DEPTH_FULL, MIRROR_OFFSET_K } from "../../src/game/mirrorView.js";
import { PANORAMA_EYE_UP, PANORAMA_HEIGHT_M } from "../../src/game/lakePanorama.js";
import { cylinderHit } from "../../src/game/lakeSkyline.js";
import { helperFunctions } from "@babylonjs/core/Shaders/ShadersInclude/helperFunctions.js";
import { drawnEffect, probeReady, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
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
    expect(samplers).toEqual([
      "waterBedHeight", "waterScene", "waterDepth", "oceanAtlas", "oceanWindDisp", "oceanWindSlope", "waterMirror", "waterPanorama", "waterSkyline",
      "oceanSwash", "oceanLipState", "oceanLipProfile",
    ]);
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
    // a lake's (no ocean) carries the lake's ripples and the mirror's read after the water's; the sea's never does
    expect(p.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS).toBe(
      fx("water.fragment.fx") + fx("lakeRipples.fragment.fx") + fx("lakeMirror.fragment.fx") +
        fx("ocean.fragment.fx") + fx("oceanSurface.fx") + fx("oceanSwash.fx") + fx("oceanShade.fragment.fx"),
    );
    p.ocean = testOcean();
    const f = p.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(
      fx("water.fragment.fx") + fx("ocean.fragment.fx") + fx("oceanSurface.fx") + fx("oceanSwash.fx") + fx("oceanShade.fragment.fx"),
    );
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("waterLights.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe(fx("waterCompose.fragment.fx"));
    const v = p.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx") + fx("ocean.vertex.fx") + fx("oceanSurface.fx") + fx("oceanSwash.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_POSITION).toBe(fx("oceanDisplace.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("waterWorldPos.vertex.fx"));
    // the water's files end their last line, so the sea's never join it
    expect(fx("water.vertex.fx").endsWith(";\n")).toBe(true);
    expect(fx("water.fragment.fx").endsWith("}\n")).toBe(true);
    expect(fx("lakeRipples.fragment.fx").endsWith("}\n")).toBe(true);
    expect(fx("lakeMirror.fragment.fx").endsWith("}\n")).toBe(true);
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

  it("integrates the wind's direction alone on the sea, whatever its speed: its caps drift as designed", () => {
    const p = attachWater(new PBRMaterial("wIntSea", scene), WATER_ROWS.sea);
    p.ocean = testOcean();
    p.setWind(0.5, [1, 0]);
    p.advance(1);
    p.advance(3);
    expect(p.windTime[0]).toBeCloseTo(2, 9);
    p.setWind(0, [0, 1]);
    p.advance(4);
    expect(p.windTime[0]).toBeCloseTo(2, 9);
    expect(p.windTime[1]).toBeCloseTo(1, 9);
    p.setWind(1, [0, 1]);
    p.advance(6);
    expect(p.windTime[1]).toBeCloseTo(3, 9);
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
    // the sea's uniforms carry none of the lake's ripples': the water's, the sea's ten, its cove and its components
    const seaU = sea.getUniforms();
    expect(seaU.ubo).toHaveLength(25);
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
    expect(sea.getUniforms().ubo).toHaveLength(38);
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
      "float wPaw = 0.0;",
      "if (waterPawCover > 0.0) {",
      "  wPaw = lakePaw(vPositionW.xz, waterLakeTime, waterWind, waterPawCover, lakeGust(vPositionW.xz, waterLakeTime, waterWind));",
      "}\nfloat wOctave = octaveAmplitude(wPaw);",
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
    expect(u.ubo).toHaveLength(38);
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
    expect(defines()).toEqual({ WATER: true, OCEAN: false, OCEAN_LIP: false });
    expect(attributes()).toEqual(["bedDepth"]);
    p.ocean = testOcean();
    expect(defines()).toEqual({ WATER: true, OCEAN: true, OCEAN_LIP: false });
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
    // the swash's table: the scene's float placeholder until one is set, on the sea and on a lake alike
    for (const state of ["a lake", "the sea", "the high tier's sea", "the waves gone"]) {
      expect(seen[state]!.oceanSwash, state).toBe(oceanSwashPlaceholder(scene));
    }
  });

  it("declares the cove on the sea alone, after the ten and before the components, and the swash's sampler in the .fx", () => {
    // a lake's uniforms are as they were: no cove on either path
    const lake = attachWater(new PBRMaterial("wS1", scene), WATER_ROWS.lowlandLake).getUniforms();
    expect(lake.ubo.map((e) => e.name)).not.toContain("oceanCove");
    expect(lake.ubo).toHaveLength(38);
    expect(lake.fragment).not.toContain("oceanCove");
    expect(lake.vertex).not.toContain("oceanCove");
    const p = attachWater(new PBRMaterial("wS2", scene), WATER_ROWS.sea);
    p.ocean = testOcean();
    const u = p.getUniforms();
    expect(u.ubo.map((e) => e.name).slice(-12, -2)).toEqual(OCEAN_UNIFORMS);
    expect(u.ubo[u.ubo.length - 2]).toEqual({ name: "oceanCove", size: 4, type: "vec4" });
    expect(u.ubo[u.ubo.length - 1]).toEqual({ name: "oceanK", size: 4, type: "vec4", arraySize: 12 });
    expect(u.ubo).toHaveLength(25);
    // both stages read it, the vertex stage's lift and the fragment stage's depth
    expect(u.fragment).toContain("uniform vec4 oceanWindPivot;\nuniform vec4 oceanCove;\nuniform vec4 oceanK[12];");
    expect(u.vertex).toContain("uniform vec4 oceanWindPivot;\nuniform vec4 oceanCove;\nuniform vec4 oceanK[12];");
    // the table's sampler in both stages' .fx, under the sea's gate, never in getUniforms
    expect(fx("ocean.vertex.fx")).toContain("uniform highp sampler2D oceanSwash;");
    expect(fx("ocean.fragment.fx")).toContain("uniform highp sampler2D oceanSwash;");
    expect(u.fragment).not.toContain("sampler");
    expect(u.vertex).not.toContain("sampler");
  });

  it("binds the cove and the swash's table on the sea, the float placeholder without a table and on a lake", () => {
    const p = attachWater(new PBRMaterial("wS3", scene), WATER_ROWS.sea);
    p.bedTexture = bedTexture();
    const record = (): { quads: Record<string, number[]>; textures: Record<string, unknown> } => {
      const quads: Record<string, number[]> = {};
      const textures: Record<string, unknown> = {};
      const ubo = new Proxy(
        {},
        {
          get: (_t, key) => {
            if (key === "updateFloat4") return (n: string, a: number, b: number, c: number, d: number) => void (quads[n] = [a, b, c, d]);
            if (key === "setTexture") return (n: string, t: unknown) => void (textures[n] = t);
            return () => undefined;
          },
        },
      ) as unknown as UniformBuffer;
      p.bindForSubMesh(ubo);
      return { quads, textures };
    };
    const placeholder = oceanSwashPlaceholder(scene);
    // a lake declares no cove, so none is written; its swash sampler is the placeholder
    const lake = record();
    expect(lake.quads.oceanCove).toBeUndefined();
    expect(lake.textures.oceanSwash).toBe(placeholder);
    // the sea before its table and cove: zeros and the placeholder, no sheet
    p.ocean = testOcean();
    const unset = record();
    expect(unset.quads.oceanCove).toEqual([0, 0, 0, 0]);
    expect(unset.textures.oceanSwash).toBe(placeholder);
    // the table and the cove as the renderer sets them
    const table = RawTexture.CreateRGBATexture(
      new Float32Array(2048), 512, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    );
    p.setSwash(table);
    p.setCove(37, 155, -24, 0.25);
    const bound = record();
    expect(bound.quads.oceanCove).toEqual([37, 155, -24, 0.25]);
    expect(bound.textures.oceanSwash).toBe(table);
    // a cove with a number that is not finite is no cove
    p.setCove(37, Number.NaN, -24, 0.25);
    expect(record().quads.oceanCove).toEqual([0, 0, 0, 0]);
    p.setCove(37, 155, -24, Number.POSITIVE_INFINITY);
    expect(record().quads.oceanCove).toEqual([0, 0, 0, 0]);
    // the table taken away: the placeholder again
    p.setSwash(null);
    expect(record().textures.oceanSwash).toBe(placeholder);
    // the waves gone with a table still set: a lake's draw, the placeholder and no cove
    p.setSwash(table);
    p.ocean = null;
    const gone = record();
    expect(gone.quads.oceanCove).toBeUndefined();
    expect(gone.textures.oceanSwash).toBe(placeholder);
    table.dispose();
  });

  it("makes the swash's placeholder once a scene, a zero 1×1 RGBA32F texel read nearest, and again once disposed", () => {
    const own = new NullEngine();
    try {
      const s = new Scene(own);
      const made = oceanSwashPlaceholder(s);
      expect(oceanSwashPlaceholder(s)).toBe(made);
      expect(made.getSize()).toEqual({ width: 1, height: 1 });
      const internal = made.getInternalTexture()!;
      expect(internal.type).toBe(Constants.TEXTURETYPE_FLOAT);
      expect(internal.format).toBe(Constants.TEXTUREFORMAT_RGBA);
      expect(made.samplingMode).toBe(Texture.NEAREST_SAMPLINGMODE);
      expect(Array.from((internal as unknown as { _bufferView: Float32Array })._bufferView)).toEqual([0, 0, 0, 0]);
      // another scene has its own
      expect(oceanSwashPlaceholder(new Scene(own))).not.toBe(made);
      made.dispose();
      const again = oceanSwashPlaceholder(s);
      expect(again).not.toBe(made);
      expect(again.getInternalTexture()).not.toBeNull();
    } finally {
      own.dispose();
    }
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
        return { ...code, CUSTOM_FRAGMENT_DEFINITIONS: fx("water.fragment.fx") + fx("lakeRipples.fragment.fx") + fx("lakeMirror.fragment.fx") };
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
    // nor any of the swash's: no sampler, no cove, no lift
    for (const name of ["oceanSwash", "oceanCove", "swashLift"]) {
      expect(lake.vertex, name).not.toContain(name);
      expect(lake.fragment, name).not.toContain(name);
    }
    // and the sea's is not: the comparison can see the ocean's code
    const sea = await compiled((m) => new WaterPlugin(m, WATER_ROWS.sea), true);
    expect(sea.vertex).toContain("vOceanXZ = positionUpdated.xz;");
    expect(sea.fragment).toContain("vOceanXZ");
    expect(sea.vertex).toContain("positionUpdated.y += swashLift(vOceanXZ, swashDepth(vOceanXZ));");
    expect(sea.fragment).toContain("swashLift(vOceanXZ, wOceanFoam.w);");
    // The sea's whole stages, byte for byte, as the swash's sheet and the bed's fallback left them:
    // neither the lake's ripples' definitions nor their uniforms reach the sea.
    const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
    expect(sha(sea.fragment)).toBe("2222baa7f306a0ea8a9e340c6b4ca323ae26f625cf03c7c5cd1864b855701b77");
    expect(sha(sea.vertex)).toBe("849a373b3d2d72c77ba8bfcdc02cb6cdfee5d46f041d5d9e75fa208794b74a9f");
    // and a material drawn as a lake, then given its ocean, rebuilds its uniforms to the sea's
    const turned = await compiled((m) => new WaterPlugin(m, WATER_ROWS.sea), true, true);
    expect(sha(turned.fragment)).toBe("2222baa7f306a0ea8a9e340c6b4ca323ae26f625cf03c7c5cd1864b855701b77");
    expect(sha(turned.vertex)).toBe("849a373b3d2d72c77ba8bfcdc02cb6cdfee5d46f041d5d9e75fa208794b74a9f");
    // and one drawn as a sea, then taken off its ocean, rebuilds them to the lake's
    const back = await compiled((m) => new WaterPlugin(m, WATER_ROWS.lowlandLake), false, true);
    expect(back.fragment).toBe(lake.fragment);
    expect(back.vertex).toBe(lake.vertex);
    // The sea's main, as the swash's sheet and the bed's fallback left it, reads none of the lake's ripples.
    const main = (fragment: string): string => fragment.slice(fragment.indexOf("void main("));
    expect(sha(main(sea.fragment))).toBe("e9b4584519cbed8a739a66145acf20e1d8d51cbd9e72081afbaff2fa52e0b647");
    for (const name of ["lakePaw(", "lakeGust(", "lakeRainSlope(", "octaveAmplitude(", "wPaw", "waterLakeTime", "waterPawCover", "waterMirror", "waterCalmShare", "wMirror"]) {
      expect(main(sea.fragment), name).not.toContain(name);
    }
    expect(main(sea.fragment)).toContain("vec2 wRs = waterRainSlope(vPositionW.xz);");
    // and the lake's reads them in place of the four layers: the comparison can see the lake's code
    expect(main(lake.fragment)).toContain("float wPaw = 0.0;\nif (waterPawCover > 0.0) {\nwPaw = lakePaw(vPositionW.xz, waterLakeTime, waterWind, waterPawCover, lakeGust(vPositionW.xz, waterLakeTime, waterWind));\n}\n");
    expect(main(lake.fragment)).toContain("vec2 wRs = lakeRainSlope(vPositionW.xz, waterLakeTime, waterRain, length(vPositionW - vEyePosition.xyz));");
    expect(main(lake.fragment)).not.toContain("waterRainSlope(");
  }, timeLimit(30_000));
});

describe("the lake's mirror in the water plugin", () => {
  const MIRROR_UNIFORMS = ["waterMirrorVP", "waterMirrorOn", "waterMirrorK", "waterMirrorWeight", "waterMirrorSmearPx", "waterCalmShare", "waterMirrorMotion"];

  /** What one bind writes: the floats, the arrays and the textures, by name. */
  const bound = (p: WaterPlugin): { floats: Record<string, number>; arrays: Record<string, number[]>; textures: Record<string, unknown> } => {
    const floats: Record<string, number> = {};
    const arrays: Record<string, number[]> = {};
    const textures: Record<string, unknown> = {};
    const ignore = (): void => undefined;
    const ubo = {
      updateFloat2: ignore, updateFloat3: ignore, updateFloat4: ignore,
      updateFloat: (name: string, v: number) => { floats[name] = v; },
      updateFloatArray: (name: string, a: Float32Array) => { arrays[name] = Array.from(a); },
      setTexture: (name: string, t: unknown) => { textures[name] = t; },
    } as unknown as UniformBuffer;
    p.bindForSubMesh(ubo);
    return { floats, arrays, textures };
  };

  it("declares the mirror's sampler in the .fx on a lake alone, and its six uniforms on a lake alone, after the ripples' and before the sea's", () => {
    const p = attachWater(new PBRMaterial("wM1", scene), WATER_ROWS.lowlandLake);
    const samplers: string[] = [];
    p.getSamplers(samplers);
    expect(samplers).toContain("waterMirror");
    expect(fx("water.fragment.fx")).toContain(
      "uniform sampler2D waterDepth;\n#ifndef OCEAN\n// The lake's mirror (lakeMirror.fragment.fx), declared on a lake alone: the\n" +
        "// sea binds a placeholder to a name its stages never declare.\nuniform sampler2D waterMirror;\n",
    );
    const u = p.getUniforms();
    expect(u.ubo.map((e) => e.name).slice(13, 22)).toEqual(["waterLakeTime", "waterPawCover", ...MIRROR_UNIFORMS]);
    // the view-projection's four columns, an array as the sea's components are
    expect(u.ubo[15]).toEqual({ name: "waterMirrorVP", size: 4, type: "vec4", arraySize: 4 });
    expect(u.ubo[22]).toEqual({ name: "waterLakeCentre", size: 3, type: "vec3" });
    expect(u.ubo[27]).toEqual({ name: "oceanPhase0", size: 4, type: "vec4" });
    expect(u.ubo).toHaveLength(38);
    for (const name of MIRROR_UNIFORMS.slice(1)) {
      expect(u.ubo).toContainEqual({ name, size: 1, type: "float" });
      expect(u.fragment).toContain(`uniform float ${name};`);
    }
    expect(u.fragment).toContain("uniform vec4 waterMirrorVP[4];");
    expect(u.fragment).not.toContain("sampler");
    expect(u.vertex).not.toContain("waterMirror");
    // the sea declares none of them: the water's, the sea's ten, its cove and its components
    const sea = attachWater(new PBRMaterial("wM1s", scene), WATER_ROWS.sea);
    sea.ocean = testOcean();
    const seaU = sea.getUniforms();
    expect(seaU.ubo).toHaveLength(25);
    expect(seaU.ubo.map((e) => e.name).filter((name) => /waterMirror|waterCalmShare/.test(name))).toEqual([]);
    expect(seaU.fragment).not.toMatch(/waterMirror|waterCalmShare/);
  });

  it("binds the placeholder with the read off, the identity and a calm of zero until set; then the mirror, a copy of its view-projection and the calm", () => {
    const p = attachWater(new PBRMaterial("wM2", scene), WATER_ROWS.lowlandLake);
    p.bedTexture = bedTexture();
    let b = bound(p);
    expect(b.textures.waterMirror).toBe(waterMirrorPlaceholder(scene));
    expect(b.arrays.waterMirrorVP).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect([b.floats.waterMirrorOn, b.floats.waterMirrorK, b.floats.waterMirrorWeight, b.floats.waterMirrorSmearPx, b.floats.waterCalmShare, b.floats.waterMirrorMotion])
      .toEqual([0, 0.05, 0, 0, 0, 0]);
    expect(MIRROR_OFFSET_K).toBe(0.05);
    const target = new BaseTexture(scene);
    const vp = Float32Array.from({ length: 16 }, (_, i) => i + 0.5);
    p.setMirror(target, vp);
    p.setCalm(0.75, 1, 27);
    // copied, not held: the pass writes its array in place every frame
    vp[0] = 99;
    b = bound(p);
    expect(b.textures.waterMirror).toBe(target);
    expect(b.arrays.waterMirrorVP).toEqual(Array.from({ length: 16 }, (_, i) => i + 0.5));
    expect([b.floats.waterMirrorOn, b.floats.waterMirrorK, b.floats.waterMirrorWeight, b.floats.waterMirrorSmearPx, b.floats.waterCalmShare, b.floats.waterMirrorMotion])
      .toEqual([1, 0.05, 1, 27, 0.75, 0]);
    // no mirror this frame: the placeholder, the read off
    p.setMirror(null, vp);
    b = bound(p);
    expect(b.textures.waterMirror).toBe(waterMirrorPlaceholder(scene));
    expect(b.floats.waterMirrorOn).toBe(0);
    expect(b.arrays.waterMirrorVP?.[0]).toBe(99);
  });

  it("takes a calm that is not finite as 0, the share and the weight clamped to 0..1 and the smear to 0 and up", () => {
    const p = attachWater(new PBRMaterial("wM2c", scene), WATER_ROWS.lowlandLake);
    p.bedTexture = bedTexture();
    const calm = (): (number | undefined)[] => {
      const { floats } = bound(p);
      return [floats.waterCalmShare, floats.waterMirrorWeight, floats.waterMirrorSmearPx];
    };
    p.setCalm(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
    expect(calm()).toEqual([0, 0, 0]);
    p.setCalm(-1, 2, -1);
    expect(calm()).toEqual([0, 1, 0]);
    p.setCalm(2, -1, Number.NaN);
    expect(calm()).toEqual([1, 0, 0]);
    p.setCalm(0.5, 0.25, 12);
    expect(calm()).toEqual([0.5, 0.25, 12]);
  });

  it("takes the held frames' smear as 0 when it is not finite or negative, and uploads a value", () => {
    const p = attachWater(new PBRMaterial("wM2m", scene), WATER_ROWS.lowlandLake);
    p.bedTexture = bedTexture();
    const motion = (): number | undefined => bound(p).floats.waterMirrorMotion;
    expect(motion()).toBe(0);
    p.setMirrorMotion(Number.NaN);
    expect(motion()).toBe(0);
    p.setMirrorMotion(Number.POSITIVE_INFINITY);
    expect(motion()).toBe(0);
    p.setMirrorMotion(-3);
    expect(motion()).toBe(0);
    p.setMirrorMotion(36);
    expect(motion()).toBe(36);
    p.setMirrorMotion(0);
    expect(motion()).toBe(0);
  });

  it("binds every sampler it lists on a lake with and without its mirror, and on the sea, which binds the placeholder and none of the floats", () => {
    const lake = attachWater(new PBRMaterial("wM3", scene), WATER_ROWS.lowlandLake);
    const sea = attachWater(new PBRMaterial("wM4", scene), WATER_ROWS.sea);
    const target = new BaseTexture(scene);
    const states: [string, WaterPlugin, () => void][] = [
      ["a lake before its mirror", lake, () => { lake.bedTexture = bedTexture(); }],
      ["a lake with its mirror", lake, () => { lake.setMirror(target, new Float32Array(16)); }],
      ["a lake whose mirror is off", lake, () => { lake.setMirror(null, new Float32Array(16)); }],
      ["the sea", sea, () => { sea.bedTexture = bedTexture(); sea.ocean = testOcean(); sea.setMirror(target, new Float32Array(16)); }],
    ];
    const missing: string[] = [];
    const mirror: Record<string, unknown> = {};
    for (const [state, p, enter] of states) {
      enter();
      const declared: string[] = [];
      p.getSamplers(declared);
      const { textures, floats, arrays } = bound(p);
      for (const sampler of declared) if (!(sampler in textures)) missing.push(`${state}: ${sampler}`);
      mirror[state] = [textures.waterMirror, floats.waterMirrorOn, arrays.waterMirrorVP === undefined];
    }
    expect(missing).toEqual([]);
    expect(mirror).toEqual({
      "a lake before its mirror": [waterMirrorPlaceholder(scene), 0, false],
      "a lake with its mirror": [target, 1, false],
      "a lake whose mirror is off": [waterMirrorPlaceholder(scene), 0, false],
      "the sea": [waterMirrorPlaceholder(scene), undefined, true],
    });
  });

  it("makes one placeholder a scene: 1×1 RGBA bytes, black with alpha 0, made again once disposed", () => {
    const a = waterMirrorPlaceholder(scene);
    expect(waterMirrorPlaceholder(scene)).toBe(a);
    expect(a.name).toBe("waterMirrorPlaceholder");
    expect(a.getSize()).toEqual({ width: 1, height: 1 });
    const internal = a.getInternalTexture() as unknown as { format: number; type: number; _bufferView: Uint8Array };
    expect(internal.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(internal.type).toBe(Constants.TEXTURETYPE_UNSIGNED_BYTE);
    expect(Array.from(internal._bufferView)).toEqual([0, 0, 0, 0]);
    const own = new NullEngine();
    try {
      const other = new Scene(own);
      const b = waterMirrorPlaceholder(other);
      expect(b).not.toBe(a);
      b.dispose();
      expect(waterMirrorPlaceholder(other)).not.toBe(b);
    } finally {
      own.dispose();
    }
  });

  it("reads the mirror where PBR adds the probe's radiance, through PBR's own Fresnel, before the skin, on a lake alone", () => {
    const c = fx("waterCompose.fragment.fx");
    const block = /#ifndef OCEAN\n#ifdef REFLECTION\n(?:\/\/[^\n]*\n)*([^#]*)#endif\n#endif\n/.exec(c);
    // The reads run only while the weight can be above 0: both factors of the
    // test are uniforms, so the mirror's texture reads stay in uniform flow.
    expect(block?.[1]).toBe(
      "if (waterMirrorWeight * waterCalmShare > 0.0) {\n" +
        "  vec4 wMirror = waterMirrorSample(waterMirrorUv(vPositionW, normalW.xz, wDepth, vWaterViewDepth), waterMirrorSmearPx * wPaw + min(waterMirrorMotion / max(vWaterViewDepth, 1.0), LAKE_MOTION_SMEAR_CAP / waterScreen.y));\n" +
        "  vec3 wProbeRadiance = reflectionOut.environmentRadiance.rgb * vLightingIntensity.z;\n" +
        "  vec3 wShoreRay = reflect(-viewDirectionW, normalW);\n" +
        "  vec3 wShore = mix(wProbeRadiance, waterSkylineRadiance(wShoreRay, wProbeRadiance), step(0.5, waterSkylineOn));\n" +
        "  wShore = mix(wShore, waterPanoramaRadiance(vPositionW, wShoreRay, wShore), step(0.5, waterPanoramaOn));\n" +
        "  wShore = mix(wShore, wMirror.rgb, step(0.5, waterMirrorOn) * wMirror.a);\n" +
        "  float wMirrorW = waterMirrorWeight * (1.0 - wPaw) * waterCalmShare;\n" +
        "  finalRadianceScaled = mix(finalRadianceScaled, wShore * colorSpecularEnvironmentReflectance, wMirrorW);\n" +
        "}\n",
    );
    expect(c.indexOf("wMirrorW);")).toBeLessThan(c.indexOf("finalRadianceScaled *= 1.0 - wSkin;"));
    // the paw mask, 0 on glass, in the lake's branch of the lights, declared there once
    const l = fx("waterLights.fragment.fx");
    const paw = l.indexOf("float wPaw = 0.0;");
    expect(paw).toBeGreaterThan(l.indexOf("float wOceanVar ="));
    expect(paw).toBeLessThan(l.indexOf("if (waterOctaves > 1.5) {"));
    expect(l.split("float wPaw")).toHaveLength(2);
    // The smear is a full paw's scaled by that mask, none on glass, plus the
    // eye's motion's: the parallax over the water's distance, capped.
    const read0 = /waterMirrorSample\(waterMirrorUv\([^)]*\), (.*)\);/.exec(c);
    expect(read0?.[1]).toBe(
      "waterMirrorSmearPx * wPaw + min(waterMirrorMotion / max(vWaterViewDepth, 1.0), LAKE_MOTION_SMEAR_CAP / waterScreen.y)",
    );
    // A canary on the installed Babylon: PBR's Fresnel for the environment is
    // declared in main's own scope before the hook, and is what scales the
    // probe's radiance into finalRadianceScaled.
    const read = (spec: string): string => readFileSync(createRequire(import.meta.url).resolve(spec), "utf8");
    const pbr = read("@babylonjs/core/Shaders/pbr.fragment.js");
    const reflectance = pbr.indexOf("#include<pbrBlockReflectance>");
    const lit = pbr.indexOf("#include<pbrBlockFinalLitComponents>");
    const hook = pbr.indexOf("#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION");
    expect(reflectance).toBeGreaterThan(-1);
    expect(reflectance).toBeLessThan(lit);
    expect(lit).toBeLessThan(hook);
    expect(hook).toBeLessThan(pbr.indexOf("#include<pbrBlockFinalColorComposition>"));
    expect(read("@babylonjs/core/Shaders/ShadersInclude/pbrBlockReflectance.js")).toContain(
      "vec3 colorSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90,environmentBrdf);",
    );
    expect(read("@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalLitComponents.js")).toContain(
      "vec3 finalRadiance=reflectionOut.environmentRadiance.rgb;finalRadiance*=colorSpecularEnvironmentReflectance;vec3 finalRadianceScaled=finalRadiance*vLightingIntensity.z;",
    );
    // and the environment's intensity the shore's chain scales the probe and
    // the shade by, a uniform of PBR's declared before the definitions the
    // read is spliced into, on both paths (`__decl__pbrFragment` is the UBO
    // declaration or the plain one)
    const declaration = pbr.indexOf("#include<__decl__pbrFragment>");
    expect(declaration).toBeGreaterThan(-1);
    expect(declaration).toBeLessThan(pbr.indexOf("#define CUSTOM_FRAGMENT_DEFINITIONS"));
    expect(read("@babylonjs/core/Shaders/ShadersInclude/pbrFragmentDeclaration.js")).toContain("uniform vec4 vLightingIntensity;");
    expect(read("@babylonjs/core/Shaders/ShadersInclude/pbrUboDeclaration.js")).toContain("vec4 vLightingIntensity;");
  });

  it("maps a surface point to the mirror's texel as Babylon reads a target, v up, moved by the ripple and never up the screen", () => {
    const m = fx("lakeMirror.fragment.fx");
    expect(MIRROR_DEPTH_FULL).toBe(0.5);
    expect(m).toContain(`const float WATER_MIRROR_DEPTH = ${glslFloat(MIRROR_DEPTH_FULL)};`);
    // waterMirrorUv, line for line mirrorUv (mirrorView.ts)
    expect(m).toContain("mat4 vp = mat4(waterMirrorVP[0], waterMirrorVP[1], waterMirrorVP[2], waterMirrorVP[3]);");
    expect(m).toContain("vec4 clip = vp * vec4(worldPos, 1.0);");
    expect(m).toContain("vec2 uv0 = clip.xy / clip.w * 0.5 + 0.5;");
    expect(m).toContain("vec2 uv = uv0 + slope * waterMirrorK * min(depth / WATER_MIRROR_DEPTH, 1.0) / max(viewDepth, 1.0);");
    expect(m).toContain("uv.y = min(uv.y, uv0.y);");
    // four level-zero reads from the texel down, nothing outside the target
    expect(m).toContain("vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));");
    expect(m).toContain("return textureLod(waterMirror, clamp(uv, 0.0, 1.0), 0.0) * inside.x * inside.y;");
    expect(m).toContain("float stride = smearPx * waterScreen.y / 3.0;");
    expect(m).toContain("+ waterMirrorTap(uv - vec2(0.0, 3.0 * stride));");
    expect(m).toContain("return vec4(sum.rgb / max(sum.a, 1.0e-4), sum.a * 0.25);");
    // A canary on the installed Babylon: a projected target is read at
    // v = 1 − (0.5 − 0.5 · ndc.y) = 0.5 + 0.5 · ndc.y, so v runs up the screen
    // on every engine, and down the screen is down the target.
    const read = (spec: string): string => readFileSync(createRequire(import.meta.url).resolve(spec), "utf8");
    expect(read("@babylonjs/core/Materials/Textures/texture.pure.js")).toContain(
      "Matrix.FromValuesToRef(0.5, 0.0, 0.0, 0.0, 0.0, -0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 1.0, 1.0, this._projectionModeMatrix);",
    );
    expect(read("@babylonjs/core/Shaders/ShadersInclude/pbrBlockReflection.js")).toContain(
      "#ifdef REFLECTIONMAP_PROJECTION\nreflectionCoords/=reflectionVector.z;\n#endif\nreflectionCoords.y=1.0-reflectionCoords.y;",
    );
  });

  it("leaves the sea's compiled stages without a line of the mirror, and gives a lake one text whatever its mirror holds", async () => {
    /** One water material's fragment stage as WebGPU compiles it, under the sky probe, on an engine of its own. */
    const compiled = async (sea: boolean, mirrored: boolean): Promise<string> => {
      const own = webgpuProcessingEngine();
      try {
        const s = new Scene(own);
        s.activeCamera = new UniversalCamera("c", new Vector3(0, 2, -5), s);
        s.environmentTexture = new ReflectionProbe("probe", 1, s).cubeTexture;
        probeReady(s);
        const material = new PBRMaterial("water", s);
        material.backFaceCulling = false;
        const plugin = new WaterPlugin(material, sea ? WATER_ROWS.sea : WATER_ROWS.lowlandLake);
        plugin.bedTexture = RawTexture.CreateRTexture(new Float32Array(4), 2, 2, s, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
        if (sea) plugin.ocean = { ...testOcean(), atlas: plugin.bedTexture, windDisp: oceanArrayPlaceholder(s), windSlope: oceanArrayPlaceholder(s) };
        if (mirrored) {
          plugin.setMirror(RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, s), Float32Array.from({ length: 16 }, (_, i) => i));
          plugin.setCalm(1, 1, 12);
        }
        const mesh = MeshBuilder.CreateGround("ground", { width: 4, height: 4 }, s);
        const vertices = mesh.getTotalVertices();
        mesh.setVerticesData("bedDepth", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanMorph", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanCoarse", new Float32Array(vertices * 2), false, 2);
        mesh.material = material;
        return (await drawnEffect(mesh))._fragmentSourceCode;
      } finally {
        own.dispose();
      }
    };
    const mirrorLines = (text: string): string[] => text.split("\n").filter((line) => /waterMirror|waterCalmShare|wMirror|wPaw/.test(line));
    // the sea: not a line, its uniform block as it was before the lake's
    expect(mirrorLines(await compiled(true, false))).toEqual([]);
    expect(mirrorLines(await compiled(true, true))).toEqual([]);
    // a lake: the mirror read, its text the same with the mirror on or off
    const off = await compiled(false, false);
    const on = await compiled(false, true);
    expect(off).toContain("vec4 wMirror = waterMirrorSample(waterMirrorUv(vPositionW, normalW.xz, wDepth, vWaterViewDepth), waterMirrorSmearPx * wPaw + min(waterMirrorMotion / max(vWaterViewDepth, 1.0), LAKE_MOTION_SMEAR_CAP / waterScreen.y));");
    expect(off).toContain("#define waterMirror sampler2D(waterMirrorTexture, waterMirrorSampler)");
    expect(on).toBe(off);
  }, timeLimit(30_000));
});

/** What one bind writes: every float, vector and texture by its name. */
function boundBy(p: WaterPlugin): { values: Record<string, number[]>; textures: Record<string, unknown> } {
  const values: Record<string, number[]> = {};
  const textures: Record<string, unknown> = {};
  const ubo = new Proxy({}, {
    get: (_t, key) => {
      if (key === "setTexture") return (name: string, t: unknown) => void (textures[name] = t);
      return (name: string, ...rest: unknown[]) => void (values[name] = rest.map(Number));
    },
  }) as unknown as UniformBuffer;
  p.bindForSubMesh(ubo);
  return { values, textures };
}

describe("the lake's shore on medium and low in the water plugin", () => {
  const SHORE_UNIFORMS = ["waterLakeCentre", "waterLakeRadius", "waterShadeColour", "waterPanoramaOn", "waterSkylineOn"];

  it("declares the panorama's and the skyline's samplers in the .fx and lists them, never in getUniforms", () => {
    const own = new NullEngine();
    try {
      const p = attachWater(new PBRMaterial("wShore1", new Scene(own)), WATER_ROWS.lowlandLake);
      const samplers: string[] = [];
      p.getSamplers(samplers);
      const mirror = samplers.indexOf("waterMirror");
      expect(samplers.slice(mirror + 1, mirror + 3)).toEqual(["waterPanorama", "waterSkyline"]);
      // beside the mirror's, under the same gate: declared on a lake alone
      expect(fx("water.fragment.fx")).toContain(
        "uniform sampler2D waterMirror;\n// The lake's shore on medium and low (lakeMirror.fragment.fx), on a lake\n" +
          "// alone too: the panorama, half float, and the skyline, a 32-bit float a\n// texel.\n" +
          "uniform sampler2D waterPanorama;\nuniform highp sampler2D waterSkyline;\n#endif\n",
      );
      expect(p.getUniforms().fragment).not.toContain("sampler");
    } finally {
      own.dispose();
    }
  });

  it("declares the lake's body, the shade and the two flags on both paths on a lake alone, after the mirror's and before the sea's", () => {
    const own = new NullEngine();
    try {
      const s = new Scene(own);
      const u = attachWater(new PBRMaterial("wShore2", s), WATER_ROWS.lowlandLake).getUniforms();
      const names = u.ubo.map((e) => e.name);
      const at = names.indexOf("waterLakeCentre");
      expect(at).toBe(names.indexOf("waterMirrorMotion") + 1);
      expect(u.ubo.slice(at, at + 5)).toEqual([
        { name: "waterLakeCentre", size: 3, type: "vec3" },
        { name: "waterLakeRadius", size: 1, type: "float" },
        { name: "waterShadeColour", size: 3, type: "vec3" },
        { name: "waterPanoramaOn", size: 1, type: "float" },
        { name: "waterSkylineOn", size: 1, type: "float" },
      ]);
      expect(at + 5).toBe(names.indexOf("oceanPhase0"));
      for (const line of [
        "uniform vec3 waterLakeCentre;", "uniform float waterLakeRadius;", "uniform vec3 waterShadeColour;",
        "uniform float waterPanoramaOn;", "uniform float waterSkylineOn;",
      ]) expect(u.fragment).toContain(line);
      expect(u.vertex).not.toContain("waterLake");
      // the sea declares none of them: the water's, the sea's ten, its cove and its components
      const sea = attachWater(new PBRMaterial("wShore2Sea", s), WATER_ROWS.sea);
      sea.ocean = testOcean();
      const seaU = sea.getUniforms();
      expect(seaU.ubo).toHaveLength(25);
      for (const name of SHORE_UNIFORMS) {
        expect(seaU.ubo.map((e) => e.name), name).not.toContain(name);
        expect(seaU.fragment, name).not.toContain(name);
      }
    } finally {
      own.dispose();
    }
  });

  it("binds the three flags at 0, the body and the shade at 0 and the mirror's placeholder on a lake until the shore is set; the sea the placeholder and none of the floats, whatever it is given", () => {
    const own = new NullEngine();
    try {
      const s = new Scene(own);
      const lake = attachWater(new PBRMaterial("wShore3Lake", s), WATER_ROWS.lowlandLake);
      const { values, textures } = boundBy(lake);
      expect(values.waterMirrorOn).toEqual([0]);
      expect(values.waterPanoramaOn).toEqual([0]);
      expect(values.waterSkylineOn).toEqual([0]);
      expect(values.waterLakeCentre).toEqual([0, 0, 0]);
      expect(values.waterLakeRadius).toEqual([0]);
      expect(values.waterShadeColour).toEqual([0, 0, 0]);
      expect(textures.waterPanorama).toBe(waterMirrorPlaceholder(s));
      expect(textures.waterSkyline).toBe(waterMirrorPlaceholder(s));
      expect(lake.lakeBody).toEqual([0, 0, 0, 0]);
      expect(lake.shadeColour).toEqual([0, 0, 0]);
      const sea = attachWater(new PBRMaterial("wShore3Sea", s), WATER_ROWS.sea);
      sea.ocean = testOcean();
      sea.setPanorama(new BaseTexture(s));
      sea.setSkyline(new BaseTexture(s), [0.03, 0.04, 0.05]);
      sea.setLakeBody(-97.4, 50.79, 324, 26.1);
      const onSea = boundBy(sea);
      for (const name of SHORE_UNIFORMS) expect(onSea.values[name], name).toBeUndefined();
      expect(onSea.textures.waterPanorama).toBe(waterMirrorPlaceholder(s));
      expect(onSea.textures.waterSkyline).toBe(waterMirrorPlaceholder(s));
    } finally {
      own.dispose();
    }
  });

  it("binds the panorama, the skyline, the shade and the lake's body once set, and the placeholder again once cleared", () => {
    const own = new NullEngine();
    try {
      const s = new Scene(own);
      const p = attachWater(new PBRMaterial("wShore4", s), WATER_ROWS.lowlandLake);
      const panorama = new BaseTexture(s);
      const skyline = new BaseTexture(s);
      p.setPanorama(panorama);
      p.setSkyline(skyline, [0.03, 0.04, 0.05]);
      p.setLakeBody(-97.4, 50.79, 324, 26.1);
      const set = boundBy(p);
      expect(set.values.waterPanoramaOn).toEqual([1]);
      expect(set.values.waterSkylineOn).toEqual([1]);
      expect(set.textures.waterPanorama).toBe(panorama);
      expect(set.textures.waterSkyline).toBe(skyline);
      expect(set.values.waterShadeColour).toEqual([0.03, 0.04, 0.05]);
      expect(set.values.waterLakeCentre).toEqual([-97.4, 50.79, 324]);
      expect(set.values.waterLakeRadius).toEqual([26.1]);
      // The low tier: the skyline alone.
      p.setPanorama(null);
      const low = boundBy(p);
      expect(low.values.waterPanoramaOn).toEqual([0]);
      expect(low.values.waterSkylineOn).toEqual([1]);
      expect(low.textures.waterPanorama).toBe(waterMirrorPlaceholder(s));
      p.setSkyline(null, [0, 0, 0]);
      const none = boundBy(p);
      expect(none.values.waterSkylineOn).toEqual([0]);
      expect(none.textures.waterSkyline).toBe(waterMirrorPlaceholder(s));
      // The shade is copied, not kept: the caller's array is its own.
      const shade: [number, number, number] = [0.1, 0.2, 0.3];
      p.setSkyline(skyline, shade);
      shade[0] = 9;
      expect(boundBy(p).values.waterShadeColour).toEqual([0.1, 0.2, 0.3]);
    } finally {
      own.dispose();
    }
  });

  it("binds every sampler it lists on the sea and on a lake with the shore on medium, on low and with none", () => {
    const own = new NullEngine();
    try {
      const s = new Scene(own);
      const bed = (): RawTexture =>
        RawTexture.CreateRTexture(new Float32Array(4), 2, 2, s, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
      const panorama = new BaseTexture(s);
      const skyline = new BaseTexture(s);
      const sea = attachWater(new PBRMaterial("wShore5Sea", s), WATER_ROWS.sea);
      const lake = attachWater(new PBRMaterial("wShore5Lake", s), WATER_ROWS.lowlandLake);
      sea.bedTexture = bed();
      sea.ocean = testOcean();
      lake.bedTexture = bed();
      const states: [string, WaterPlugin, () => void][] = [
        ["the sea", sea, () => undefined],
        ["a lake with no shore", lake, () => undefined],
        ["a lake on medium", lake, () => { lake.setPanorama(panorama); lake.setSkyline(skyline, [0, 0, 0]); }],
        ["a lake on low", lake, () => { lake.setPanorama(null); }],
      ];
      const missing: string[] = [];
      for (const [state, p, enter] of states) {
        enter();
        const declared: string[] = [];
        p.getSamplers(declared);
        const { textures } = boundBy(p);
        for (const sampler of declared) if (!(sampler in textures)) missing.push(`${state}: ${sampler}`);
      }
      expect(missing).toEqual([]);
    } finally {
      own.dispose();
    }
  });

  it("keeps one stage text whatever the shore holds: a lake's and the sea's compile the same with and without it", async () => {
    /** One material's stages, on an engine of its own (an engine shares an
     * effect between materials of one define set), after `shore` runs. */
    const compiled = async (sea: boolean, shore: (p: WaterPlugin, s: Scene) => void): Promise<{ vertex: string; fragment: string }> => {
      const own = webgpuProcessingEngine();
      try {
        const s = new Scene(own);
        s.activeCamera = new UniversalCamera("c", new Vector3(0, 2, -5), s);
        // A sky probe, as the game's scene has: the reflection, and the read with it.
        s.environmentTexture = new ReflectionProbe("environment", 16, s, true, false, false).cubeTexture;
        probeReady(s);
        const material = new PBRMaterial("water", s);
        material.backFaceCulling = false;
        const plugin = attachWater(material, sea ? WATER_ROWS.sea : WATER_ROWS.lowlandLake);
        plugin.bedTexture = RawTexture.CreateRTexture(new Float32Array(4), 2, 2, s, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
        if (sea) plugin.ocean = { ...testOcean(), atlas: plugin.bedTexture, windDisp: oceanArrayPlaceholder(s), windSlope: oceanArrayPlaceholder(s) };
        shore(plugin, s);
        const mesh = MeshBuilder.CreateGround("ground", { width: 4, height: 4 }, s);
        const vertices = mesh.getTotalVertices();
        mesh.setVerticesData("bedDepth", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanMorph", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanCoarse", new Float32Array(vertices * 2), false, 2);
        mesh.material = material;
        const effect = await drawnEffect(mesh);
        return { vertex: effect._vertexSourceCode, fragment: effect._fragmentSourceCode };
      } finally {
        own.dispose();
      }
    };
    const none = (): void => undefined;
    const medium = (p: WaterPlugin, s: Scene): void => {
      p.setPanorama(new BaseTexture(s));
      p.setSkyline(RawTexture.CreateRTexture(new Float32Array(512), 512, 1, s, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT), [0.02, 0.03, 0.02]);
      p.setLakeBody(-97.4, 50.79, 324, 26.1);
    };
    const lake = await compiled(false, none);
    const lakeMedium = await compiled(false, medium);
    expect(lakeMedium.vertex).toBe(lake.vertex);
    expect(lakeMedium.fragment).toBe(lake.fragment);
    expect(lake.fragment).toContain("waterPanoramaRadiance(vPositionW, wShoreRay, wShore)");
    const sea = await compiled(true, none);
    const seaShore = await compiled(true, medium);
    expect(seaShore.vertex).toBe(sea.vertex);
    expect(seaShore.fragment).toBe(sea.fragment);
    // and the sea declares neither sampler nor any of the five uniforms and
    // reads none of them: its stages never meet the lake's shore
    for (const name of [
      /\bwaterPanorama\b/, /\bwaterSkyline\b/, /waterPanoramaRadiance/, /waterSkylineRadiance/, /waterCylinderHit/,
      /\bwaterLakeCentre\b/, /\bwaterLakeRadius\b/, /\bwaterShadeColour\b/, /\bwaterPanoramaOn\b/, /\bwaterSkylineOn\b/,
    ]) {
      expect(sea.fragment, String(name)).not.toMatch(name);
      expect(lake.fragment, String(name)).toMatch(name);
    }
  }, timeLimit(30_000));
});

/** The read's stage, its lines pinned below and transcribed here. */
const SHORE = fx("lakeMirror.fragment.fx");
const COMPOSE = fx("waterCompose.fragment.fx");

describe("the lake's shore read on medium and low", () => {
  const consts = Object.fromEntries(
    [...SHORE.matchAll(/const float (PANORAMA_\w+) = ([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
  const c = (name: string): number => Number(consts[name]);
  /** Babylon's 1 / 2 pi, as its helper functions declare it (pinned below). */
  const RECIPROCAL_PI2 = 0.15915494309189535;
  const fract = (x: number): number => x - Math.floor(x);
  const step = (edge: number, x: number): number => (x >= edge ? 1 : 0);
  const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
  /** waterAzimuth, transcribed. */
  const azimuth = (x: number, y: number): number => fract(Math.atan2(x, y + 1.0e-20) * RECIPROCAL_PI2 + 1);
  type V3 = [number, number, number];
  /** waterCylinderHit, transcribed: the lake's centre (x, level, z) and radius as the uniforms hold them. */
  const stageHit = (origin: V3, dir: V3, centre: V3, radius: number): V3 => {
    const o = [origin[0] - centre[0], origin[2] - centre[2]];
    const a = Math.max(dir[0] * dir[0] + dir[2] * dir[2], 1.0e-8);
    const b = o[0]! * dir[0] + o[1]! * dir[2];
    const cc = o[0]! * o[0]! + o[1]! * o[1]! - radius * radius;
    const disc = b * b - a * cc;
    const t = (Math.sqrt(Math.max(disc, 0)) - b) / a;
    return [azimuth(o[0]! + dir[0] * t, o[1]! + dir[2] * t), origin[1] + dir[1] * t - centre[1], step(0, disc) * step(0, t)];
  };
  /** How much of waterPanoramaRadiance is the panorama, transcribed, for a panorama alpha and a skyline elevation. */
  const panoramaShare = (hit: V3, radius: number, alpha: number, skyline: number): number =>
    hit[2] * step(hit[1] - c("PANORAMA_EYE_UP"), radius * Math.tan(skyline)) * alpha;
  /** Whether waterSkylineRadiance shades, transcribed, for a skyline elevation. */
  const skylineShade = (dir: V3, skyline: number): number => step(dir[1], Math.hypot(dir[0], dir[2]) * Math.tan(skyline));
  const MURKY: V3 = [-97.4, 50.79, 324];
  const unit = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

  it("holds its literals in lockstep with lakePanorama.ts, takes 1 / 2 pi from Babylon, and branches by step alone", () => {
    expect(consts).toEqual({ PANORAMA_HEIGHT_M: "64.0", PANORAMA_EYE_UP: "0.4" });
    expect(consts.PANORAMA_HEIGHT_M).toBe(glslFloat(PANORAMA_HEIGHT_M));
    expect(consts.PANORAMA_EYE_UP).toBe(glslFloat(PANORAMA_EYE_UP));
    expect(helperFunctions.shader).toContain("const float RECIPROCAL_PI2=0.15915494309189535;");
    const read = SHORE.slice(SHORE.indexOf("float waterAzimuth("));
    expect(read).not.toMatch(/\bif\s*\(/);
    expect(read).not.toContain("?");
    expect(read).not.toContain("discard");
    const chain = COMPOSE.slice(COMPOSE.indexOf("vec3 wProbeRadiance"), COMPOSE.indexOf("finalRadianceScaled *= 1.0 - wSkin;"));
    expect(chain).not.toMatch(/\bif\s*\(/);
    expect(chain).not.toContain("?");
  });

  it("pins the lines transcribed here", () => {
    for (const line of [
      "return fract(atan(d.x, d.y + 1.0e-20) * RECIPROCAL_PI2 + 1.0);",
      "vec2 o = origin.xz - waterLakeCentre.xz;",
      "float a = max(dot(dir.xz, dir.xz), 1.0e-8);",
      "float b = dot(o, dir.xz);",
      "float c = dot(o, o) - waterLakeRadius * waterLakeRadius;",
      "float disc = b * b - a * c;",
      "float t = (sqrt(max(disc, 0.0)) - b) / a;",
      "return vec3(waterAzimuth(o + dir.xz * t), origin.y + dir.y * t - waterLakeCentre.y, step(0.0, disc) * step(0.0, t));",
      "vec4 shore = texture2D(waterPanorama, vec2(hit.x, clamp(hit.y / PANORAMA_HEIGHT_M, 0.0, 1.0)));",
      "float skyline = texture2D(waterSkyline, vec2(hit.x, 0.5)).r;",
      "float below = step(hit.y - PANORAMA_EYE_UP, waterLakeRadius * tan(skyline));",
      "return mix(fallback, shore.rgb, hit.z * below * shore.a);",
      "float skyline = texture2D(waterSkyline, vec2(waterAzimuth(dir.xz), 0.5)).r;",
      "float below = step(dir.y, length(dir.xz) * tan(skyline));",
      "return mix(probeRadiance, waterShadeColour * vLightingIntensity.z, below);",
    ]) expect(SHORE, line).toContain(line);
  });

  it("meets the shore's cylinder where cylinderHit does: a ray from the murky lake's surface to its far bank", () => {
    const origin: V3 = [-90, 50.81, 330];
    const dir = unit([-0.6, 0.2, 0.75]);
    const hit = stageHit(origin, dir, MURKY, 26.1);
    const twin = cylinderHit(origin, dir, -97.4, 324, 26.1, 50.79);
    expect(twin).not.toBeNull();
    // North-north-west, 24.76 m along the ray, 5.07 m up the cylinder.
    expect(hit[0]).toBeCloseTo(0.952078, 6);
    expect(hit[1]).toBeCloseTo(5.066867, 6);
    expect(hit[2]).toBe(1);
    expect(twin!.u).toBeCloseTo(0.952078, 6);
    expect(twin!.height).toBeCloseTo(5.066867, 6);
    // The panorama's v there: 5.07 m of its 64.
    expect(clamp01(hit[1] / c("PANORAMA_HEIGHT_M"))).toBeCloseTo(0.079170, 6);
    // Under a treeline at 0.5 rad (14.26 m up the cylinder over the eye) it
    // reads the panorama; under one at 0.1 rad (2.62 m) the probe; and the
    // panorama's own alpha leaves its sky to the probe.
    expect(panoramaShare(hit, 26.1, 1, 0.5)).toBe(1);
    expect(panoramaShare(hit, 26.1, 1, 0.1)).toBe(0);
    expect(panoramaShare(hit, 26.1, 0, 0.5)).toBe(0);
  });

  it("agrees with cylinderHit round the turn and from the rim, and leaves to the probe the rays that never meet it", () => {
    const cases: [V3, V3][] = [
      [[-97.4, 50.81, 324], unit([1, 0.1, 0])],
      [[-97.4, 50.81, 324], unit([0, 0.3, -1])],
      [[-110, 50.81, 320], unit([-1, 0.05, 0.2])],
      [[-80, 50.81, 330], unit([0.3, 0.6, -0.4])],
    ];
    const want: [number, number][] = [[0.25, 2.63], [0.5, 7.85], [0.74203, 0.693364], [0.280459, 16.466948]];
    cases.forEach(([origin, dir], k) => {
      const hit = stageHit(origin, dir, MURKY, 26.1);
      const twin = cylinderHit(origin, dir, -97.4, 324, 26.1, 50.79)!;
      expect(hit[0], `case ${k}`).toBeCloseTo(want[k]![0], 6);
      expect(hit[1], `case ${k}`).toBeCloseTo(want[k]![1], 6);
      expect(twin.u, `case ${k}`).toBeCloseTo(want[k]![0], 6);
      expect(twin.height, `case ${k}`).toBeCloseTo(want[k]![1], 6);
      expect(hit[2], `case ${k}`).toBe(1);
    });
    // From outside the cylinder, pointing away: no hit, and the probe.
    const away = stageHit([-60, 50.81, 324], [1, 0, 0], MURKY, 26.1);
    expect(cylinderHit([-60, 50.81, 324], [1, 0, 0], -97.4, 324, 26.1, 50.79)).toBeNull();
    expect(away[2]).toBe(0);
    expect(panoramaShare(away, 26.1, 1, 1.5)).toBe(0);
    // Straight up: cylinderHit has none, and the stage's hit lies so far up
    // the cylinder that no skyline holds it.
    const up = stageHit([-90, 50.81, 330], [0, 1, 0], MURKY, 26.1);
    expect(cylinderHit([-90, 50.81, 330], [0, 1, 0], -97.4, 324, 26.1, 50.79)).toBeNull();
    expect(Number.isFinite(up[1])).toBe(true);
    expect(panoramaShare(up, 26.1, 1, 1.5)).toBe(0);
  });

  it("stays finite with a body of zeros, as the lake's is until it is set, so the mix that drops it never meets a NaN", () => {
    for (const [origin, dir] of [
      [[412, 0.02, -88], unit([0.3, 0.2, 0.9])],
      [[412, 0.02, -88], unit([-412, 5, 88])],
      [[0, 0.02, 0], [0, 1, 0]],
      [[0, 0.02, 0], unit([1, 0.1, 0])],
    ] as [V3, V3][]) {
      const hit = stageHit(origin, dir, [0, 0, 0], 0);
      expect(hit.every(Number.isFinite), `${origin} ${dir}`).toBe(true);
      expect(Number.isFinite(panoramaShare(hit, 0, 0, 0))).toBe(true);
    }
    expect(azimuth(0, 0)).toBe(0);
  });

  it("shades the low tier's reflection below the skyline at the ray's own azimuth and elevation", () => {
    // A ray 0.3 rad up, facing +x: azimuth a quarter turn.
    const dir: V3 = [Math.cos(0.3), Math.sin(0.3), 0];
    expect(azimuth(dir[0], dir[2])).toBeCloseTo(0.25, 12);
    expect(skylineShade(dir, 0.35)).toBe(1);
    expect(skylineShade(dir, 0.25)).toBe(0);
    // Straight up is never under a skyline.
    expect(skylineShade([0, 1, 0], 1.5)).toBe(0);
    // Facing -z is half a turn, facing -x three quarters.
    expect(azimuth(0, -1)).toBeCloseTo(0.5, 12);
    expect(azimuth(-1, 0)).toBeCloseTo(0.75, 12);
  });

  it("falls back on medium, where the panorama drew nothing, to the skyline's shade below the treeline and the probe above it", () => {
    // The chain's mixes, transcribed from the pinned lines, by colour channel.
    const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;
    const shore = (flags: { skyline: number; panorama: number }, probe: number, shade: number, below: number, pano: number, share: number): number => {
      const skyline = mix(probe, shade, below);
      const first = mix(probe, skyline, step(0.5, flags.skyline));
      return mix(first, mix(first, pano, share), step(0.5, flags.panorama));
    };
    const medium = { skyline: 1, panorama: 1 };
    // Below the treeline with no texel of the panorama: the shade, never the sky.
    expect(shore(medium, 0.9, 0.05, 1, 0.3, 0)).toBe(0.05);
    // Above it: the probe's sky.
    expect(shore(medium, 0.9, 0.05, 0, 0.3, 0)).toBe(0.9);
    // Where the panorama drew: the panorama.
    expect(shore(medium, 0.9, 0.05, 1, 0.3, 1)).toBe(0.3);
    expect(COMPOSE).toContain("vec3 wShore = mix(wProbeRadiance, waterSkylineRadiance(wShoreRay, wProbeRadiance), step(0.5, waterSkylineOn));");
    expect(COMPOSE).toContain("wShore = mix(wShore, waterPanoramaRadiance(vPositionW, wShoreRay, wShore), step(0.5, waterPanoramaOn));");
    expect(SHORE).toContain("vec3 waterPanoramaRadiance(vec3 origin, vec3 dir, vec3 fallback) {");
    expect(SHORE).toContain("return mix(fallback, shore.rgb, hit.z * below * shore.a);");
  });

  it("substitutes the shore before the skin's scaling, the mirror over the panorama over the skyline over the probe", () => {
    const lines = [
      "vec3 wProbeRadiance = reflectionOut.environmentRadiance.rgb * vLightingIntensity.z;",
      "vec3 wShoreRay = reflect(-viewDirectionW, normalW);",
      "vec3 wShore = mix(wProbeRadiance, waterSkylineRadiance(wShoreRay, wProbeRadiance), step(0.5, waterSkylineOn));",
      "wShore = mix(wShore, waterPanoramaRadiance(vPositionW, wShoreRay, wShore), step(0.5, waterPanoramaOn));",
      "wShore = mix(wShore, wMirror.rgb, step(0.5, waterMirrorOn) * wMirror.a);",
      "float wMirrorW = waterMirrorWeight * (1.0 - wPaw) * waterCalmShare;",
      "finalRadianceScaled = mix(finalRadianceScaled, wShore * colorSpecularEnvironmentReflectance, wMirrorW);",
    ];
    const at = lines.map((line) => COMPOSE.indexOf(line));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(at[at.length - 1]).toBeLessThan(COMPOSE.indexOf("finalRadianceScaled *= 1.0 - wSkin;"));
    // One substitution of the reflection: the line it replaced is gone.
    expect(COMPOSE.match(/finalRadianceScaled = mix\(/g)).toHaveLength(1);
  });
});

describe("the plunging lip in the water plugin", () => {
  it("sets OCEAN_LIP on the lip's material with an ocean alone, and never on the sea's", () => {
    const lip = new WaterPlugin(new PBRMaterial("wL1", scene), WATER_ROWS.sea, { lip: true });
    const sea = attachWater(new PBRMaterial("wL1s", scene), WATER_ROWS.sea);
    const defines = (p: WaterPlugin): Record<string, unknown> => {
      const d: Record<string, unknown> = {};
      p.prepareDefines(d as never, scene, undefined as never);
      return d;
    };
    expect([lip.lip, sea.lip]).toEqual([true, false]);
    expect(defines(lip)).toEqual({ WATER: true, OCEAN: false, OCEAN_LIP: false });
    lip.ocean = testOcean();
    sea.ocean = testOcean();
    expect(defines(lip)).toEqual({ WATER: true, OCEAN: true, OCEAN_LIP: true });
    expect(defines(sea)).toEqual({ WATER: true, OCEAN: true, OCEAN_LIP: false });
    // the lip draws with the sea's attributes: the strip supplies the rings' three
    const attributes: string[] = [];
    lip.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["bedDepth", "oceanMorph", "oceanCoarse"]);
  });

  it("places the lip's vertices with its own code, after the sea's definitions, and shades them with the sea's", () => {
    const lip = new WaterPlugin(new PBRMaterial("wL2", scene), WATER_ROWS.sea, { lip: true });
    const sea = attachWater(new PBRMaterial("wL2s", scene), WATER_ROWS.sea);
    lip.ocean = testOcean();
    sea.ocean = testOcean();
    const v = lip.getCustomCode("vertex")!;
    const seaV = sea.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(Object.keys(seaV).sort());
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx") + fx("ocean.vertex.fx") + fx("oceanSurface.fx") + fx("oceanSwash.fx") + fx("oceanLipShape.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_POSITION).toBe(fx("oceanLip.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(seaV.CUSTOM_VERTEX_UPDATE_WORLDPOS);
    // the sea's own: the rings' displacement, no lip
    expect(seaV.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx") + fx("ocean.vertex.fx") + fx("oceanSurface.fx") + fx("oceanSwash.fx"));
    expect(seaV.CUSTOM_VERTEX_UPDATE_POSITION).toBe(fx("oceanDisplace.vertex.fx"));
    expect(lip.getCustomCode("fragment")).toEqual(sea.getCustomCode("fragment"));
    // the level, for the vertex stage where uniform buffers are not supported, on the lip alone
    expect(lip.getUniforms().vertex).toContain("uniform float waterLevel;");
    expect(sea.getUniforms().vertex).not.toContain("waterLevel");
    expect(lip.getUniforms().ubo).toEqual(sea.getUniforms().ubo);
    expect(lip.getUniforms().fragment).toBe(sea.getUniforms().fragment);
  });

  it("gates every line of the lip's GLSL on OCEAN_LIP and declares its samplers there, never in getUniforms", () => {
    for (const name of ["oceanLipShape.vertex.fx", "oceanLip.vertex.fx"]) {
      const lines = fx(name).trimEnd().split("\n");
      expect(lines[0], name).toBe("#ifdef OCEAN_LIP");
      expect(lines[lines.length - 1], name).toBe("#endif");
      expect(lines.filter((line) => line.trimStart().startsWith("#")), name).toEqual(["#ifdef OCEAN_LIP", "#endif"]);
      expect(fx(name).endsWith("#endif\n"), name).toBe(true);
    }
    expect(fx("oceanLipShape.vertex.fx")).toContain("uniform highp sampler2D oceanLipState;");
    expect(fx("oceanLipShape.vertex.fx")).toContain("uniform highp sampler2D oceanLipProfile;");
    const u = new WaterPlugin(new PBRMaterial("wL3", scene), WATER_ROWS.sea, { lip: true }).getUniforms();
    expect(u.vertex).not.toContain("sampler");
    expect(u.fragment).not.toContain("sampler");
  });

  it("binds the lip's two textures on its material once set, and the bed texture everywhere else and before", () => {
    const lip = new WaterPlugin(new PBRMaterial("wL4", scene), WATER_ROWS.sea, { lip: true });
    const sea = attachWater(new PBRMaterial("wL4s", scene), WATER_ROWS.sea);
    const lake = attachWater(new PBRMaterial("wL4l", scene), WATER_ROWS.lowlandLake);
    const state = new BaseTexture(scene);
    const profile = new BaseTexture(scene);
    const bound = (p: WaterPlugin): Record<string, unknown> => {
      const textures: Record<string, unknown> = {};
      const ubo = new Proxy(
        {},
        { get: (_t, key) => (key === "setTexture" ? (n: string, t: unknown) => void (textures[n] = t) : () => undefined) },
      ) as unknown as UniformBuffer;
      p.bindForSubMesh(ubo);
      return textures;
    };
    for (const p of [lip, sea, lake]) p.bedTexture = bedTexture();
    lip.ocean = testOcean();
    sea.ocean = testOcean();
    expect([bound(lip).oceanLipState, bound(lip).oceanLipProfile]).toEqual([lip.bedTexture, lip.bedTexture]);
    lip.setLip(state, profile);
    sea.setLip(state, profile);
    const missing: string[] = [];
    for (const [name, p] of [["the lip", lip], ["the sea", sea], ["a lake", lake]] as const) {
      const declared: string[] = [];
      p.getSamplers(declared);
      const textures = bound(p);
      for (const sampler of declared) if (!(sampler in textures)) missing.push(`${name}: ${sampler}`);
    }
    expect(missing).toEqual([]);
    expect(bound(lip).oceanLipState).toBe(state);
    expect(bound(lip).oceanLipProfile).toBe(profile);
    // the sea's stages declare neither: it keeps the placeholder whatever it is handed
    expect(bound(sea).oceanLipState).toBe(sea.bedTexture);
    expect(bound(lake).oceanLipProfile).toBe(lake.bedTexture);
    lip.setLip(null, null);
    expect(bound(lip).oceanLipState).toBe(lip.bedTexture);
  });
});
