import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import "@babylonjs/core/Shaders/pbr.fragment.js";
import vertexDefs from "../../src/game/shaders/moss.vertex.fx?raw";
import vertexFoot from "../../src/game/shaders/mossFoot.vertex.fx?raw";
import fragmentDefs from "../../src/game/shaders/moss.fragment.fx?raw";
import fragmentLights from "../../src/game/shaders/mossLights.fragment.fx?raw";
import {
  attachMoss, MossPlugin, MOSS_ROUGHNESS_INJECTION_CODE, MOSS_ROUGHNESS_INJECTION_POINT, MOSS_SAMPLER,
} from "../../src/game/mossPlugin.js";
import {
  MOSS_AMOUNT, MOSS_BAND, MOSS_EDGE, MOSS_LUMA, MOSS_OUTPUT, MOSS_ROUGHNESS, MOSS_SIDE, MOSS_SIDE_EDGE, MOSS_TILE, MOSS_TINT,
  mossWeight,
} from "../../src/game/mossParams.js";
import { attachWet, WET_CAP, WET_ROUGHNESS_ANCHOR, WET_ROUGHNESS_CODE } from "../../src/game/wetPlugin.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterAll(() => {
  scene.dispose();
  engine.dispose();
});

const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const mossMap = (s: Scene): BaseTexture => RawTexture.CreateRGBATexture(new Uint8Array([60, 110, 40, 255]), 1, 1, s);

/** Babylon's roughness statement, as pbr.fragment carries it: the moss writes
 * before it, the wet plugin rewrites it. */
const ROUGHNESS_LINE = "float roughness=reflectivityOut.roughness;";
const MOSS_LINE = "reflectivityOut.roughness=mix(reflectivityOut.roughness,MOSS_ROUGHNESS,mossW);";

describe("moss plugin", () => {
  it("attaches once per material with the forest's map, and declines nothing twice", () => {
    const mat = new PBRMaterial("m-once", scene);
    const map = mossMap(scene);
    attachMoss(mat, map);
    attachMoss(mat, mossMap(scene));
    const plugins = (mat.pluginManager as unknown as { _plugins: { name: string }[] })._plugins.filter((p) => p.name === "Moss");
    expect(plugins).toHaveLength(1);
    expect((plugins[0] as MossPlugin).texture).toBe(map);
    expect((plugins[0] as MossPlugin).getClassName()).toBe("MossPlugin");
    // After the foliage plugin (200) and before the wet plugin (240).
    expect((plugins[0] as MossPlugin).priority).toBe(215);
  });

  it("injects the .fx files verbatim at the four points and the roughness anchor, and nothing else", () => {
    const mat = new PBRMaterial("m-points", scene);
    attachMoss(mat, mossMap(scene));
    const plugin = mat.pluginManager!.getPlugin("Moss")!;
    expect(plugin.getCustomCode("vertex")).toEqual({ CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_MAIN_END: vertexFoot });
    const f = plugin.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual([MOSS_ROUGHNESS_INJECTION_POINT, "CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fragmentDefs);
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fragmentLights);
    expect(f[MOSS_ROUGHNESS_INJECTION_POINT]).toBe(MOSS_ROUGHNESS_INJECTION_CODE);
  });

  it("declares one varying, written at the vertex's end from the model height and the foot's hash, read by both stages", () => {
    expect(vertexDefs.split("varying vec2 vMoss;").length - 1).toBe(1);
    expect(fragmentDefs.split("varying vec2 vMoss;").length - 1).toBe(1);
    expect(vertexDefs).not.toContain("varying vec4");
    expect(vertexFoot).toContain("vMoss = vec2(positionUpdated.y, mossHash(finalWorld[3].xz));");
    // The hash is the wet speckle's, without sine.
    expect(vertexDefs).toContain("float mossHash(vec2 p) {");
    expect(vertexDefs).toContain("vec3 p3 = fract(vec3(p.xyx) * 0.1031);");
    expect(vertexDefs).not.toContain("sin(");
    // Every line under the plugin's define.
    for (const text of [vertexDefs, vertexFoot, fragmentDefs]) {
      expect(text.trimStart().startsWith("//") || text.trimStart().startsWith("#ifdef MOSS")).toBe(true);
      expect(text.trimEnd().endsWith("#endif")).toBe(true);
    }
  });

  it("declares the sampler in the fragment definitions, which both uniform paths reach, lists it and binds it in every state", () => {
    const mat = new PBRMaterial("m-sampler", scene);
    const map = mossMap(scene);
    attachMoss(mat, map);
    const plugin = mat.pluginManager!.getPlugin("Moss") as MossPlugin;
    expect(MOSS_SAMPLER).toBe("mossSampler");
    expect(fragmentDefs.split("uniform sampler2D mossSampler;").length - 1).toBe(1);
    // No scalar uniform on either path: the constants are literals.
    expect(plugin.getUniforms()).toEqual({ ubo: [], vertex: "", fragment: "" });
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toEqual(["mossSampler"]);
    const bound: [string, BaseTexture][] = [];
    plugin.bindForSubMesh({ setTexture: (n: string, t: BaseTexture) => bound.push([n, t]) } as never, scene, engine, undefined as never);
    expect(bound).toEqual([["mossSampler", map]]);
    // The material knows the map as its own, for readiness and disposal walks.
    expect(mat.getActiveTextures()).toContain(map);
    expect(mat.hasTexture(map)).toBe(true);
    const defines: Record<string, boolean> = {};
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines).toEqual({ MOSS: true });
  });

  it("never disposes the forest's map with a material, even when the material's textures are forced", () => {
    const s = new Scene(new NullEngine());
    try {
      const map = mossMap(s);
      const mat = new PBRMaterial("m-dispose", s);
      attachMoss(mat, map);
      mat.dispose(false, true);
      expect(s.textures).toContain(map);
      expect(map.getInternalTexture()).not.toBeNull();
    } finally {
      s.getEngine().dispose();
    }
  });

  it("keeps every constant in lockstep with the GLSL", () => {
    expect(MOSS_OUTPUT).toBe("textures/moss.wood.1k.ktx2");
    expect(MOSS_SIDE).toEqual({ x: -0.5486, y: 0.2494, z: 0.798 });
    expect(Math.hypot(MOSS_SIDE.x, MOSS_SIDE.y, MOSS_SIDE.z)).toBeCloseTo(1, 3);
    expect(MOSS_SIDE_EDGE).toBe(0.6);
    expect(MOSS_BAND).toEqual([1.0, 2.5]);
    expect(MOSS_AMOUNT).toEqual([0.25, 1.0]);
    expect(MOSS_EDGE).toEqual([0.35, 0.65]);
    expect(MOSS_TILE).toBe(3.0);
    expect(MOSS_TINT).toEqual({ r: 0.85, g: 1.0, b: 0.75 });
    expect(MOSS_ROUGHNESS).toBe(0.95);
    expect(MOSS_LUMA).toEqual({ r: 0.2126, g: 0.7152, b: 0.0722 });
    expect(fragmentDefs).toContain(`const vec3 MOSS_SIDE = vec3(${MOSS_SIDE.x}, ${MOSS_SIDE.y}, ${MOSS_SIDE.z});`);
    expect(fragmentDefs).toContain("const vec3 MOSS_SIDE = vec3(-0.5486, 0.2494, 0.798);");
    expect(fragmentDefs).toContain(`const float MOSS_SIDE_EDGE = ${glslFloat(MOSS_SIDE_EDGE)};`);
    expect(fragmentDefs).toContain(`const vec2 MOSS_BAND = vec2(${glslFloat(MOSS_BAND[0])}, ${glslFloat(MOSS_BAND[1])});`);
    expect(fragmentDefs).toContain("const vec2 MOSS_BAND = vec2(1.0, 2.5);");
    expect(fragmentDefs).toContain(`const vec2 MOSS_AMOUNT = vec2(${glslFloat(MOSS_AMOUNT[0])}, ${glslFloat(MOSS_AMOUNT[1])});`);
    expect(fragmentDefs).toContain("const vec2 MOSS_AMOUNT = vec2(0.25, 1.0);");
    expect(fragmentDefs).toContain(`const vec2 MOSS_EDGE = vec2(${glslFloat(MOSS_EDGE[0])}, ${glslFloat(MOSS_EDGE[1])});`);
    expect(fragmentDefs).toContain("const vec2 MOSS_EDGE = vec2(0.35, 0.65);");
    expect(fragmentDefs).toContain(`const float MOSS_TILE = ${glslFloat(MOSS_TILE)};`);
    expect(fragmentDefs).toContain("const float MOSS_TILE = 3.0;");
    expect(fragmentDefs).toContain(`const vec3 MOSS_TINT = vec3(${glslFloat(MOSS_TINT.r)}, ${glslFloat(MOSS_TINT.g)}, ${glslFloat(MOSS_TINT.b)});`);
    expect(fragmentDefs).toContain("const vec3 MOSS_TINT = vec3(0.85, 1.0, 0.75);");
    expect(fragmentDefs).toContain(`const float MOSS_ROUGHNESS = ${glslFloat(MOSS_ROUGHNESS)};`);
    expect(fragmentDefs).toContain("const float MOSS_ROUGHNESS = 0.95;");
    expect(fragmentDefs).toContain(`const vec3 MOSS_LUMA = vec3(${MOSS_LUMA.r}, ${MOSS_LUMA.g}, ${MOSS_LUMA.b});`);
  });

  it("builds the mask as the twin does: the band, the side off the geometric normal, the tree's draw, the map's growth, then the edge", () => {
    const block = fragmentLights.slice(fragmentLights.indexOf("{"), fragmentLights.lastIndexOf("}"));
    const lines = block.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("//") && line !== "{");
    expect(lines).toEqual([
      "float mossBand = 1.0 - smoothstep(MOSS_BAND.x, MOSS_BAND.y, vMoss.x);",
      "float mossSide = smoothstep(0.0, MOSS_SIDE_EDGE, dot(normalize(vNormalW), MOSS_SIDE));",
      "float mossTree = mix(MOSS_AMOUNT.x, MOSS_AMOUNT.y, vMoss.y);",
      "vec3 mossColour = texture2D(mossSampler, vAlbedoUV * MOSS_TILE).rgb;",
      "#ifdef GAMMAALBEDO",
      "mossColour = toLinearSpace(mossColour);",
      "#endif",
      "float mossLuma = dot(mossColour, MOSS_LUMA);",
      "float mossRaw = mossBand * mossSide * mossTree;",
      "mossW = smoothstep(MOSS_EDGE.x, MOSS_EDGE.y, mossRaw * (0.5 + mossLuma));",
      "surfaceAlbedo = mix(surfaceAlbedo, mossColour * MOSS_TINT, mossW);",
    ]);
    // The weight is declared under the define and outside the braces, so the
    // roughness reads it later, and the bumped normal is not read.
    expect(fragmentLights).toContain("#ifdef MOSS\nfloat mossW = 0.0;\n{\n");
    expect(block).not.toMatch(/[^v]normalW/);
    expect(block).not.toContain("vMainUV1");
  });

  it("the twin: full on the wet side low on a mossy tree, none three model metres up, none on the dry side, less on a bare tree", () => {
    // Low on the trunk, facing the wet side, the mossiest tree, the map's
    // mean growth: the raw mask is 1 and the edge is passed.
    expect(mossWeight(0.5, 1, 1, 0.5)).toBe(1);
    expect(mossWeight(1.0, 1, 1, 0.5)).toBe(1);
    // Above the band: nothing, whatever the side or the tree.
    expect(mossWeight(2.5, 1, 1, 0.5)).toBe(0);
    expect(mossWeight(3, 1, 1, 1)).toBe(0);
    // The dry side: nothing.
    expect(mossWeight(0.5, 0, 1, 0.5)).toBe(0);
    expect(mossWeight(0.5, -0.8, 1, 0.5)).toBe(0);
    // The barest tree carries a quarter: 0.25 of the mask, times the growth
    // (1.0 at mean luma), is under the edge's start, so no moss at all.
    expect(mossWeight(0.5, 1, 0, 0.5)).toBe(0);
    // Where the map's own moss is bright it comes through on that tree.
    expect(mossWeight(0.5, 1, 0, 1)).toBeGreaterThan(0);
    expect(mossWeight(0.5, 1, 0, 1)).toBeCloseTo(0.0197, 3);
    // Half-way up the band on the mossiest tree, or a black texel low on it:
    // the raw mask at a half, the edge's middle.
    expect(mossWeight(1.75, 1, 1, 0.5)).toBeCloseTo(0.5, 6);
    expect(mossWeight(1.0, 1, 1, 0)).toBeCloseTo(0.5, 6);
    // Half-way up, three quarters round, a middling tree, a dark texel: under the edge.
    expect(mossWeight(1.75, 0.3, 0.5, 0.2)).toBe(0);
    // Monotone in each term.
    expect(mossWeight(1.5, 1, 1, 0.5)).toBeGreaterThan(mossWeight(2.0, 1, 1, 0.5));
    expect(mossWeight(0.5, 0.6, 1, 0.5)).toBeGreaterThan(mossWeight(0.5, 0.3, 1, 0.5));
    expect(mossWeight(0.5, 1, 0.8, 0.5)).toBeGreaterThan(mossWeight(0.5, 1, 0.4, 0.5));
  });

  it("anchors the roughness on the statement before Babylon's roughness line, once in the installed engine's PBR fragment", () => {
    const pbr = ShaderStore.ShadersStore["pbrPixelShader"] as string;
    expect(pbr).toBeDefined();
    expect(MOSS_ROUGHNESS_INJECTION_POINT).toBe("!float microSurface=reflectivityOut\\.microSurface;");
    const re = new RegExp(MOSS_ROUGHNESS_INJECTION_POINT.slice(1), "g");
    expect(pbr.match(re)).toEqual(["float microSurface=reflectivityOut.microSurface;"]);
    // On the one line with Babylon's roughness statement, the wet plugin's
    // anchor, so the moss writes before it and the anchor never overlaps.
    const line = pbr.split("\n").find((l) => l.includes("float microSurface=reflectivityOut.microSurface;")) as string;
    expect(line).toContain(`float microSurface=reflectivityOut.microSurface;${ROUGHNESS_LINE}`);
    expect(pbr.split(ROUGHNESS_LINE).length - 1).toBe(1);
    expect(WET_ROUGHNESS_ANCHOR).toBe("!float roughness=reflectivityOut\\.roughness;");
    expect(MOSS_ROUGHNESS_INJECTION_POINT).not.toBe(WET_ROUGHNESS_ANCHOR);
  });

  it("the roughness code writes the moss's roughness into the block's output under the define, then re-emits Babylon's statement on its own line", () => {
    expect(MOSS_ROUGHNESS_INJECTION_CODE).toBe(
      "\n#ifdef MOSS\n" + MOSS_LINE + "\n#endif\n" + "float microSurface=reflectivityOut.microSurface;",
    );
    const pbr = ShaderStore.ShadersStore["pbrPixelShader"] as string;
    const injected = pbr.replace(new RegExp(MOSS_ROUGHNESS_INJECTION_POINT.slice(1), "g"), () => MOSS_ROUGHNESS_INJECTION_CODE);
    expect(injected.split(MOSS_LINE).length - 1).toBe(1);
    expect(injected.split("float microSurface=reflectivityOut.microSurface;").length - 1).toBe(1);
    expect(injected.split(ROUGHNESS_LINE).length - 1).toBe(1);
    expect(injected.indexOf(MOSS_LINE)).toBeLessThan(injected.indexOf(ROUGHNESS_LINE));
    // The directive begins its own line, since the anchor sits mid-line.
    expect(injected).toContain(");\n#ifdef MOSS\n");
    // With the wet plugin's rewrite on the same source, as a trunk compiles:
    // one declaration of roughness, the wet's, reading the mossed value.
    const both = injected.replace(new RegExp(WET_ROUGHNESS_ANCHOR.slice(1), "g"), () => WET_ROUGHNESS_CODE);
    expect(both.split("float roughness=").length - 1).toBe(1);
    expect(both).toContain(WET_ROUGHNESS_CODE);
    expect(both.indexOf(MOSS_LINE)).toBeLessThan(both.indexOf(WET_ROUGHNESS_CODE));
  });

  /** A bark as the forest dresses it, as far as the shader is concerned: a
   * colour map read through a transform (`vAlbedoUV` a varying of its own),
   * a normal map, and the moss. */
  function bark(s: Scene, name: string): PBRMaterial {
    const mat = new PBRMaterial(name, s);
    const colour = RawTexture.CreateRGBATexture(new Uint8Array([120, 90, 60, 255]), 1, 1, s);
    colour.uScale = 1.7;
    colour.vScale = 6.3;
    mat.albedoTexture = colour;
    mat.bumpTexture = RawTexture.CreateRGBATexture(new Uint8Array([128, 128, 255, 255]), 1, 1, s);
    attachMoss(mat, mossMap(s));
    return mat;
  }

  it("compiled with the define, the fragment carries the moss's roughness line once before Babylon's own, which stays once", async () => {
    const e = webgpuProcessingEngine();
    const s = new Scene(e);
    try {
      new UniversalCamera("camera", new Vector3(0, 2, -5), s);
      const mat = bark(s, "compiled");
      const box = CreateBox("compiled-box", {}, s);
      box.material = mat;
      const effect = await drawnEffect(box);
      const defines = (effect as unknown as { defines: string }).defines;
      expect(defines).toContain("#define MOSS\n");
      expect(defines).toContain("#define ALBEDODIRECTUV 0\n");
      const source = effect._fragmentSourceCode;
      expect(source.split(MOSS_LINE).length - 1).toBe(1);
      expect(source.split(ROUGHNESS_LINE).length - 1).toBe(1);
      expect(source.indexOf(MOSS_LINE)).toBeLessThan(source.indexOf(ROUGHNESS_LINE));
      // One declaration in main (the reflectivity block's own local is the function's).
      expect(source.slice(source.indexOf("void main")).split("float roughness=").length - 1).toBe(1);
      // The mask before the lights, reading the bark's own UV and the map,
      // and the weight declared before the roughness reads it.
      expect(source).toContain("surfaceAlbedo = mix(surfaceAlbedo, mossColour * MOSS_TINT, mossW);");
      expect(source).toContain("vAlbedoUV * MOSS_TILE");
      expect(source.indexOf("float mossW = 0.0;")).toBeLessThan(source.indexOf(MOSS_LINE));
      // The varying in both stages, once each.
      expect(effect._vertexSourceCode).toMatch(/layout\(location = \d+\)\s*out vec2 vMoss;/);
      expect(effect._vertexSourceCode).toContain("vMoss = vec2(positionUpdated.y, mossHash(finalWorld[3].xz));");
      expect(source).toMatch(/layout\(location = \d+\)\s*in vec2 vMoss;/);
      // The one sampler, bound in the fragment stage.
      expect(Object.keys(effect._processingContext.availableTextures)).toContain("mossSampler");
    } finally {
      s.dispose();
      e.dispose();
    }
  }, timeLimit(10_000));

  it("compiled with the wet plugin too, as a trunk is, roughness is declared once: the wet's line, after the moss's write", async () => {
    const e = webgpuProcessingEngine();
    const s = new Scene(e);
    try {
      new UniversalCamera("camera", new Vector3(0, 2, -5), s);
      const mat = bark(s, "compiled-wet");
      attachWet(mat, WET_CAP.bark);
      const box = CreateBox("compiled-wet-box", {}, s);
      box.material = mat;
      const effect = await drawnEffect(box);
      const source = effect._fragmentSourceCode;
      expect((effect as unknown as { defines: string }).defines).toContain("#define WET\n");
      expect(source.split(MOSS_LINE).length - 1).toBe(1);
      expect(source.split(WET_ROUGHNESS_CODE).length - 1).toBe(1);
      expect(source.slice(source.indexOf("void main")).split("float roughness=").length - 1).toBe(1);
      expect(source).not.toContain(ROUGHNESS_LINE);
      expect(source.indexOf(MOSS_LINE)).toBeLessThan(source.indexOf(WET_ROUGHNESS_CODE));
    } finally {
      s.dispose();
      e.dispose();
    }
  }, timeLimit(10_000));

  it("compiled without the define but with the injection present, the fragment keeps Babylon's plain line and no moss", async () => {
    // The late reprocess the guard is for (foliageLightPlugin.ts): an effect
    // processed with the plugin's injection on the material and its define
    // off. The plugin as shipped always sets the define, so this material's
    // plugin is made to leave it off.
    const e = webgpuProcessingEngine();
    const s = new Scene(e);
    try {
      new UniversalCamera("camera", new Vector3(0, 2, -5), s);
      const mat = bark(s, "unguarded");
      const plugin = mat.pluginManager!.getPlugin("Moss") as MossPlugin;
      plugin.prepareDefines = (defines) => {
        defines.MOSS = false;
      };
      const box = CreateBox("unguarded-box", {}, s);
      box.material = mat;
      const effect = await drawnEffect(box);
      const source = effect._fragmentSourceCode;
      expect((effect as unknown as { defines: string }).defines).not.toContain("#define MOSS\n");
      expect(source.split(ROUGHNESS_LINE).length - 1).toBe(1);
      expect(source.split("float microSurface=reflectivityOut.microSurface;").length - 1).toBe(1);
      expect(source).not.toContain(MOSS_LINE);
      // Neither declared nor read outside a comment.
      expect(source.replace(/\/\/.*$/gm, "")).not.toContain("mossW");
      expect(source.replace(/\/\/.*$/gm, "")).not.toContain("vMoss");
      expect(effect._vertexSourceCode.replace(/\/\/.*$/gm, "")).not.toContain("vMoss");
    } finally {
      s.dispose();
      e.dispose();
    }
  }, timeLimit(10_000));
});
