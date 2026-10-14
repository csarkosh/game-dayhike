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
import { attachFoliageLight, FOLIAGE_LIGHT_INJECTION_POINT, FOLIAGE_WRAP } from "../../src/game/foliageLightPlugin.js";
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

  it("in the game's light order the sun is light 1, the only directional light, and the injection keys on that", () => {
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
      // The light include unrolled for lights 0 and 1, then injected, as
      // Babylon orders the two: the same block on each line, keyed on that
      // light's own directional define, so the call is the sun's alone.
      const include = ShaderStore.IncludesShadersStore["lightFragment"] as string;
      const code = (() => {
        const mat = new PBRMaterial("order", s);
        attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 1);
        attachFoliageLight(mat);
        return mat.pluginManager!.getPlugin("FoliageLight")!.getCustomCode("fragment")![FOLIAGE_LIGHT_INJECTION_POINT]!;
      })();
      for (const [n, sun] of [[0, false], [1, true]] as const) {
        const injected = include.replaceAll("{X}", String(n)).replace(new RegExp(FOLIAGE_LIGHT_INJECTION_POINT.slice(1), "g"), code);
        expect(injected.split(block(n)).length - 1, `light ${n}`).toBe(1);
        expect(injected.split("foliageDiffuseLighting(").length - 1, `light ${n}`).toBe(1);
        expect(defines[`DIRLIGHT${n}`] === true, `light ${n}`).toBe(sun);
      }
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

  it("the wrap term never exceeds Lambert at full light, and the function is the sun's alone", () => {
    // No light index to branch on: the injected line chooses the sun.
    expect(diffuseFx).toContain("vec3 foliageDiffuseLighting(preLightingInfo info, vec3 lightColor, float h, vec3 viewDir) {");
    expect(diffuseFx).not.toContain("lightIndex");
    expect(diffuseFx).not.toContain("computeDiffuseLighting(");
    expect(diffuseFx).toContain(`const float FOLIAGE_WRAP = ${FOLIAGE_WRAP};`);
    // (ndotl + w) / ((1 + w)^2) <= ndotl for ndotl = 1: 1/(1+w) <= 1.
    expect((1 + FOLIAGE_WRAP) / ((1 + FOLIAGE_WRAP) * (1 + FOLIAGE_WRAP))).toBeLessThanOrEqual(1);
  });
});
