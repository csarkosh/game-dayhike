import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
// Side-effect import: populates ShaderStore.IncludesShadersStore["lightFragment"],
// which only loads when an effect compiles otherwise — NullEngine never does.
import "@babylonjs/core/Shaders/ShadersInclude/lightFragment.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import {
  SKIN_INJECTION_POINT, attachSkinShading, attachSkinToMaterials, createSkinShading, type SkinShading,
} from "../../src/game/skin.js";

let engine: NullEngine;
let scene: Scene;
let skin: SkinShading;

function mrMaterial(name: string): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.metallicTexture = RawTexture.CreateRGBTexture(new Uint8Array([255, 200, 0]), 1, 1, scene);
  return material;
}

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  skin = createSkinShading(scene);
});

afterEach(() => {
  skin.dispose();
  scene.dispose();
  engine.dispose();
});

describe("attachSkinShading", () => {
  it("attaches to a PBR material with an MR texture and declines everything else", () => {
    const mr = mrMaterial("mr");
    const bare = new PBRMaterial("bare", scene);
    const std = new StandardMaterial("std", scene);
    expect(attachSkinShading(mr)).toBe(true);
    expect(mr.pluginManager?.getPlugin("SkinShading")).toBeTruthy();
    expect(attachSkinShading(bare)).toBe(false);
    expect(bare.pluginManager?.getPlugin("SkinShading") ?? null).toBeNull();
    expect(attachSkinShading(std)).toBe(false);
  });

  it("is never registered globally: a fresh PBR material carries no plugin", () => {
    const late = new PBRMaterial("late", scene);
    expect(late.pluginManager?.getPlugin("SkinShading") ?? null).toBeNull();
  });

  it("attaches once per material and counts what it attached", () => {
    const a = mrMaterial("a");
    const b = mrMaterial("b");
    expect(attachSkinToMaterials([a, b, new StandardMaterial("s", scene)])).toBe(2);
    expect(attachSkinToMaterials([a])).toBe(0);
  });
});

describe("createSkinShading — toggle and tunables", () => {
  it("defaults on and toggles both ways", () => {
    expect(skin.enabled).toBe(true);
    skin.setEnabled(false);
    expect(skin.enabled).toBe(false);
    skin.setEnabled(true);
    expect(skin.enabled).toBe(true);
  });
});

/**
 * The regex injection point targets an unversioned line in Babylon's own
 * lightFragment include. A Babylon bump that renames it would match nothing
 * and silently un-wrap every light; pinning the pattern against the shader
 * store turns that into a red test at the point the dependency changes.
 */
describe("SkinShadingPlugin — injection anchor pinned against Babylon's lightFragment", () => {
  it("the per-light diffuse line still exists with the light-colour capture group", () => {
    const include = ShaderStore.IncludesShadersStore["lightFragment"];
    expect(include).toBeTruthy();
    const pattern = new RegExp(SKIN_INJECTION_POINT.slice(1), "g");
    const matches = [...(include ?? "").matchAll(pattern)];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]?.[1]).toBe("diffuse{X}.rgb");
  });

  it("declares the expected shape: null vertex code, the two fragment points, the three uniforms", () => {
    const material = mrMaterial("shape");
    attachSkinShading(material);
    const plugin = material.pluginManager?.getPlugin("SkinShading");
    expect(plugin).toBeTruthy();
    expect(plugin!.getCustomCode("vertex")).toBeNull();
    const fragment = plugin!.getCustomCode("fragment");
    expect(Object.keys(fragment ?? {}).sort()).toEqual(["CUSTOM_FRAGMENT_DEFINITIONS", SKIN_INJECTION_POINT].sort());
    expect(fragment?.[SKIN_INJECTION_POINT]).toBe(
      "info.diffuse=skinDiffuseLighting(preInfo,$1,surfaceMetallicOrReflectivityColorMap.r);",
    );
    expect(plugin!.getUniforms().ubo?.map((u) => u.name)).toEqual(["skinOn", "skinWrap", "skinScatter"]);
  });
});
