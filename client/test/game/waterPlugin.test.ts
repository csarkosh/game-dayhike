// client/test/game/waterPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { WaterPlugin, attachWater } from "../../src/game/waterPlugin.js";
import { WATER_ROWS, WATER_F0, WATER_HORIZON, WATER_REFRACT, WATER_REFRACT_DEPTH, WATER_SKIN_DRIFT } from "../../src/game/waterShading.js";

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

  it("declares the bedDepth attribute, the bed sampler, and the four hook points", () => {
    const mat = new PBRMaterial("w2", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    const attributes: string[] = [];
    p.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["bedDepth"]);
    const samplers: string[] = [];
    p.getSamplers(samplers);
    expect(samplers).toEqual(["waterBedHeight", "waterScene", "waterDepth"]);
    const v = p.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual([
      "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION",
      "CUSTOM_FRAGMENT_BEFORE_LIGHTS",
      "CUSTOM_FRAGMENT_DEFINITIONS",
    ]);
    expect(p.getCustomCode("compute")).toBeNull();
  });

  it("injects exactly the GLSL the .fx files hold, with the constants in lockstep", () => {
    const mat = new PBRMaterial("w3", scene);
    const p = attachWater(mat, WATER_ROWS.sea);
    const f = p.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("water.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("waterLights.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe(fx("waterCompose.fragment.fx"));
    const v = p.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("waterWorldPos.vertex.fx"));
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
      updateFloat2: record, updateFloat3: record, updateFloat4: record, setTexture: vi.fn(),
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
    const full = { updateFloat: record, updateFloat2: record, updateFloat3: record, updateFloat4: record, setTexture: record } as unknown as UniformBuffer;
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
      updateFloat: record, updateFloat3: record, updateFloat4: record, setTexture: vi.fn(),
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

  it("slides the skin along the wind in both its mask and its colour", () => {
    const d = fx("water.fragment.fx");
    const colour = d.indexOf("vec3 waterSkinColour(");
    const mask = d.slice(d.indexOf("float waterSkinMask("), colour);
    const col = d.slice(colour);
    const drift = "vec2 p = xz + waterSkin.y - waterWind * (waterTime * WATER_SKIN_DRIFT);";
    expect(mask).toContain(drift);
    expect(col).toContain(drift);
    expect(mask).toContain("- waterWind * (waterTime * ");
    expect(col).toContain("- waterWind * (waterTime * ");
    expect(fx("water.fragment.fx")).toContain(`const float WATER_SKIN_DRIFT = ${glslFloat(WATER_SKIN_DRIFT)};`);
  });
});
