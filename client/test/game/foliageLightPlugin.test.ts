import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import "@babylonjs/core/Shaders/ShadersInclude/lightFragment.js";
import diffuseFx from "../../src/game/shaders/foliageDiffuse.fragment.fx?raw";
import {
  attachFoliageLight, FOLIAGE_LIGHT_INJECTION_POINT, FOLIAGE_SHADOW_INJECTION_POINT, FOLIAGE_WRAP,
} from "../../src/game/foliageLightPlugin.js";
import { attachFoliage, FOLIAGE_PROFILES } from "../../src/game/foliagePlugin.js";
import { createLighting } from "../../src/game/lighting.js";
import { createHeadlamp } from "../../src/game/headlamp.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { drawnEffect, probeReady, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
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

describe("foliage light plugin", () => {
  it("anchors on Babylon's per-light diffuse line and captures the light index", () => {
    const include = ShaderStore.IncludesShadersStore["lightFragment"] as string;
    const re = new RegExp(FOLIAGE_LIGHT_INJECTION_POINT.slice(1));
    const m = re.exec(include);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("diffuse{X}.rgb");
    expect(m![2]).toBe("{X}");
  });

  it("anchors the shadow's floor on Babylon's own line that applies a light's shadow to its diffuse, and re-emits it after the floor", () => {
    const include = ShaderStore.IncludesShadersStore["lightFragment"] as string;
    expect(FOLIAGE_SHADOW_INJECTION_POINT).toBe("!diffuseBase\\+=info\\.diffuse\\*shadow;");
    // The pattern matches Babylon's line, once in the include, and none of
    // the include's other diffuse lines (the debug cascade's, the lightmap's,
    // the custom lighting's).
    const re = new RegExp(FOLIAGE_SHADOW_INJECTION_POINT.slice(1), "g");
    expect(include.match(re)).toEqual(["diffuseBase+=info.diffuse*shadow;"]);
    expect(include.split("diffuseBase+=info.diffuse*shadow;").length - 1).toBe(1);
    const mat = new PBRMaterial("shadow-floor", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
    attachFoliageLight(mat);
    const code = mat.pluginManager!.getPlugin("FoliageLight")!.getCustomCode("fragment")![FOLIAGE_SHADOW_INJECTION_POINT]!;
    // The floor under the foliage define, then Babylon's own line, so an
    // effect processed without the define keeps the line alone.
    expect(code).toBe("#ifdef FOLIAGE\nshadow=max(shadow,0.75);\n#endif\ndiffuseBase+=info.diffuse*shadow;");
    const injected = include.replace(re, code);
    expect(injected.split("shadow=max(shadow,0.75);").length - 1).toBe(1);
    expect(injected.split("diffuseBase+=info.diffuse*shadow;").length - 1).toBe(1);
    expect(injected.indexOf("shadow=max(shadow,0.75);")).toBeLessThan(injected.indexOf("diffuseBase+=info.diffuse*shadow;"));
  });

  /** The game's lights in the game's order: the local headlamp first
   * (renderer.ts), then the sun and the fill (`createLighting`). */
  function gameLights(s: Scene): void {
    new UniversalCamera("camera", new Vector3(0, 2, 0), s);
    createHeadlamp(s, "lamp_local");
    createLighting(s, { tier: "high", viewDistance: 70, colourPath: "material", sky: skyFixture() });
  }

  /** The block the injection leaves on light `n`'s diffuse line. */
  const block = (n: number | string): string =>
    `#if defined(FOLIAGE) && defined(DIRLIGHT${n})\n` +
    `info.diffuse=foliageDiffuseLighting(preInfo,diffuse${n}.rgb,vFoliageH,viewDirectionW);\n` +
    "#else\n" +
    `info.diffuse=computeDiffuseLighting(preInfo,diffuse${n}.rgb);\n` +
    "#endif";

  it("in the game's light order the sun is light 1, the only directional light, and each line's block keys on its own light", () => {
    const s = new Scene(new NullEngine());
    try {
      gameLights(s);
      expect(s.lights.map((light) => light.name)).toEqual(["lamp_local", "sun", "fill"]);
      expect(s.lights[0]).toBeInstanceOf(SpotLight);
      expect(s.lights[1]).toBeInstanceOf(DirectionalLight);
      expect(s.lights[2]).toBeInstanceOf(HemisphericLight);
      expect(s.lights.filter((light) => light instanceof DirectionalLight)).toHaveLength(1);
      // Each light's type define, as Babylon names it for the light's digit.
      const defines: Record<string, boolean> = {};
      s.lights.forEach((light, n) => light.prepareLightSpecificDefines(defines, n));
      expect(Object.keys(defines).filter((name) => defines[name]).sort()).toEqual(["DIRLIGHT1", "HEMILIGHT2", "SPOTLIGHT0"]);
      // The light include unrolled for lights 0 and 1 in one source, then
      // injected, as Babylon orders the two: each line's block keys on its
      // own light's digit, never the other's, so the call compiles into the
      // sun's line alone (the compiled tests below resolve it).
      const include = ShaderStore.IncludesShadersStore["lightFragment"] as string;
      const code = (() => {
        const mat = new PBRMaterial("order", s);
        attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
        attachFoliageLight(mat);
        return mat.pluginManager!.getPlugin("FoliageLight")!.getCustomCode("fragment")![FOLIAGE_LIGHT_INJECTION_POINT]!;
      })();
      const unrolled = include.replaceAll("{X}", "0") + include.replaceAll("{X}", "1");
      const injected = unrolled.replace(new RegExp(FOLIAGE_LIGHT_INJECTION_POINT.slice(1), "g"), code);
      expect(injected.split(block(0)).length - 1).toBe(1);
      expect(injected.split(block(1)).length - 1).toBe(1);
      expect(injected.split("#if defined(FOLIAGE) && defined(DIRLIGHT").length - 1).toBe(2);
    } finally {
      s.getEngine().dispose();
    }
  });

  it("compiled in the game's light order, the sun's line takes the foliage call and the headlamp's keeps Babylon's", async () => {
    // Babylon's WebGPU processing resolves the conditionals, so the effect's
    // source holds the line each light compiled to.
    const e = webgpuProcessingEngine();
    const s = new Scene(e);
    try {
      gameLights(s);
      const mat = new PBRMaterial("compiled", s);
      attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
      attachFoliageLight(mat);
      const box = CreateBox("compiled-box", {}, s);
      box.material = mat;
      probeReady(s);
      const effect = await drawnEffect(box);
      const source = effect._fragmentSourceCode;
      const defines = (effect as unknown as { defines: string }).defines;
      expect(defines).toContain("#define FOLIAGE\n");
      expect(defines).toContain("#define SPOTLIGHT0\n");
      expect(defines).toContain("#define DIRLIGHT1\n");
      expect(source).toContain("\ninfo.diffuse=computeDiffuseLighting(preInfo,diffuse0.rgb);");
      expect(source).toContain("\ninfo.diffuse=foliageDiffuseLighting(preInfo,diffuse1.rgb,vFoliageH,viewDirectionW);");
      expect(source.split("=foliageDiffuseLighting(").length - 1).toBe(1);
    } finally {
      s.dispose();
      e.dispose();
    }
  }, timeLimit(10_000));

  it("compiled in the game's light order, every light's shadow on a FOLIAGE material is held at the floor before its diffuse", async () => {
    const e = webgpuProcessingEngine();
    const s = new Scene(e);
    try {
      gameLights(s);
      const mat = new PBRMaterial("compiled-shadow", s);
      attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
      attachFoliageLight(mat);
      const box = CreateBox("compiled-shadow-box", {}, s);
      box.material = mat;
      probeReady(s);
      const effect = await drawnEffect(box);
      const source = effect._fragmentSourceCode;
      expect((effect as unknown as { defines: string }).defines).toContain("#define FOLIAGE\n");
      // Three lights (the headlamp, the sun, the fill), each with its floor
      // and its line, the floor first.
      expect(s.lights).toHaveLength(3);
      expect(source.split("\nshadow=max(shadow,0.75);\ndiffuseBase+=info.diffuse*shadow;").length - 1).toBe(3);
      expect(source.split("shadow=max(shadow,0.75);").length - 1).toBe(3);
      expect(source.split("diffuseBase+=info.diffuse*shadow;").length - 1).toBe(3);
    } finally {
      s.dispose();
      e.dispose();
    }
  }, timeLimit(10_000));

  it("compiled without the FOLIAGE define but with the injection present, every light keeps Babylon's own diffuse", async () => {
    // The late reprocess the guard is for (`foliageLightPlugin.ts`): an
    // effect whose defines lack FOLIAGE, processed while the FoliageLight
    // injection is on the material. A real compile cannot reach it with the
    // Foliage plugin as shipped, which always sets FOLIAGE, so this material's
    // Foliage plugin is made to leave its defines off: the effect then goes
    // through Babylon's WebGPU processing with the injection and without the
    // define, as the reprocessed effect does.
    const e = webgpuProcessingEngine();
    const s = new Scene(e);
    try {
      gameLights(s);
      const mat = new PBRMaterial("unguarded", s);
      attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
      attachFoliageLight(mat);
      const foliage = mat.pluginManager!.getPlugin("Foliage")!;
      foliage.prepareDefines = (defines) => {
        defines.FOLIAGE = false;
        defines.FOLIAGE_TINT = false;
        defines.FOLIAGE_BLADES = false;
      };
      const box = CreateBox("unguarded-box", {}, s);
      box.material = mat;
      probeReady(s);
      const effect = await drawnEffect(box);
      const source = effect._fragmentSourceCode;
      const defines = (effect as unknown as { defines: string }).defines;
      expect(defines).not.toContain("#define FOLIAGE\n");
      expect(defines).toContain("#define SPOTLIGHT0\n");
      expect(defines).toContain("#define DIRLIGHT1\n");
      // The injection reached this effect: its definitions are in the source.
      expect(source).toContain("vec3 foliageDiffuseLighting(preLightingInfo info, vec3 lightColor, float h, vec3 viewDir) {");
      expect(source).toContain("\ninfo.diffuse=computeDiffuseLighting(preInfo,diffuse0.rgb);");
      expect(source).toContain("\ninfo.diffuse=computeDiffuseLighting(preInfo,diffuse1.rgb);");
      expect(source.split("=foliageDiffuseLighting(").length - 1).toBe(0);
      // The shadow keeps Babylon's line on every light, with no floor.
      expect(source).not.toContain("shadow=max(shadow,");
      expect(source.split("diffuseBase+=info.diffuse*shadow;").length - 1).toBe(3);
      // Neither declared nor read outside a comment: the Foliage plugin's
      // own lines are off with its define, and nothing else asks for it.
      expect(source.replace(/\/\/.*$/gm, "")).not.toContain("vFoliageH");
    } finally {
      s.dispose();
      e.dispose();
    }
  }, timeLimit(10_000));

  it("declines a material without the foliage plugin", () => {
    const mat = new PBRMaterial("no-foliage", scene);
    attachFoliageLight(mat);
    expect(mat.pluginManager?.getPlugin("FoliageLight") ?? null).toBeNull();
  });

  it("attaches idempotently and only modifies the fragment", () => {
    const mat = new PBRMaterial("m", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
    attachFoliageLight(mat);
    attachFoliageLight(mat);
    const plugin = mat.pluginManager!.getPlugin("FoliageLight")!;
    expect(plugin.getCustomCode("vertex")).toBeNull();
    const f = plugin.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(diffuseFx);
    expect(f[FOLIAGE_LIGHT_INJECTION_POINT]).toContain(
      "foliageDiffuseLighting(preInfo,$1,vFoliageH,viewDirectionW)",
    );
  });

  it("the injected call is guarded: compiled without FOLIAGE it is Babylon's own line", () => {
    const include = ShaderStore.IncludesShadersStore["lightFragment"] as string;
    const mat = new PBRMaterial("guard", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
    attachFoliageLight(mat);
    const code = mat.pluginManager!.getPlugin("FoliageLight")!.getCustomCode("fragment")![FOLIAGE_LIGHT_INJECTION_POINT]!;
    // Babylon processes an effect's source again on a draw whose vertex
    // buffers are not of floats, reading the plugins of that moment: an
    // effect compiled before the plugins attached (no FOLIAGE define) takes
    // this injection too, so without FOLIAGE it must compile to the line the
    // pattern matched, not read the undeclared vFoliageH.
    expect(code).toContain("#if defined(FOLIAGE) && defined(DIRLIGHT$2)\n");
    expect(code).toContain("#else\ninfo.diffuse=computeDiffuseLighting(preInfo,$1);\n#endif");
    const injected = include.replace(new RegExp(FOLIAGE_LIGHT_INJECTION_POINT.slice(1), "g"), code);
    expect(injected.split(block("{X}")).length - 1).toBe(1);
  });

  it("the wrap term is a half-Lambert: Lambert at full light, half at the terminator, and the function is the sun's alone", () => {
    // No light index to branch on: the injected line chooses the sun.
    expect(diffuseFx).toContain("vec3 foliageDiffuseLighting(preLightingInfo info, vec3 lightColor, float h, vec3 viewDir) {");
    expect(diffuseFx).not.toContain("lightIndex");
    expect(diffuseFx).not.toContain("computeDiffuseLighting(");
    expect(FOLIAGE_WRAP).toBe(1);
    expect(diffuseFx).toContain("const float FOLIAGE_WRAP = 1.0;");
    expect(diffuseFx).toContain("return clamp((ndotl + wrap) / (1.0 + wrap), 0.0, 1.0);");
    // (ndotl + w) / (1 + w) at ndotl = 1 is exactly 1, Lambert's own.
    expect((1 + FOLIAGE_WRAP) / (1 + FOLIAGE_WRAP)).toBe(1);
    // At the terminator the lift is w / (1 + w), a half, and the term reaches
    // zero at ndotl = -w, a face turned fully from the sun.
    expect((0 + FOLIAGE_WRAP) / (1 + FOLIAGE_WRAP)).toBe(0.5);
    expect(Math.max(0, (-FOLIAGE_WRAP + FOLIAGE_WRAP) / (1 + FOLIAGE_WRAP))).toBe(0);
  });

  it("takes the canopy's share of the sun from the material's uniform and the instance's openness, under the foliage define", () => {
    // The wrapped term and the backlight together, by the material's share
    // (0 where the meshes receive cast shadows) of the canopy over the
    // instance, read from the openness the foliage plugin writes in vFoliage.a.
    expect(diffuseFx).toContain("fSun = 1.0 - foliageCanopySun * (1.0 - vFoliage.a);");
    expect(diffuseFx).toContain("return (wrapped + unit * FOLIAGE_BACK * back * thickness) * fSun;");
    // The varying and the uniform exist only under the foliage plugin's
    // define, and the function's text does not: processed without the define,
    // the reads are stripped and the factor stays 1.
    const read = diffuseFx.indexOf("fSun = 1.0 - foliageCanopySun");
    const before = diffuseFx.slice(0, read);
    expect(before).toContain("float fSun = 1.0;");
    expect(before.lastIndexOf("#ifdef FOLIAGE")).toBeGreaterThan(before.lastIndexOf("float fSun = 1.0;"));
    expect(before.slice(before.lastIndexOf("#ifdef FOLIAGE"))).not.toContain("#endif");
    expect(diffuseFx.slice(read).indexOf("#endif")).toBeGreaterThan(-1);
    expect(diffuseFx.slice(read, read + diffuseFx.slice(read).indexOf("#endif"))).not.toContain("vec3 unit");
  });
});
