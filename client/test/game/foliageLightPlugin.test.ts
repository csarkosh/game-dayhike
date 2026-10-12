import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/ShadersInclude/lightFragment.js";
import diffuseFx from "../../src/game/shaders/foliageDiffuse.fragment.fx?raw";
import { attachFoliageLight, FOLIAGE_LIGHT_INJECTION_POINT, FOLIAGE_WRAP } from "../../src/game/foliageLightPlugin.js";
import { attachFoliage, FOLIAGE_PROFILES } from "../../src/game/foliagePlugin.js";
import { createLighting } from "../../src/game/lighting.js";
import { skyFixture } from "./helpers/skyFixture.js";

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

  it("the sun is light 0 and the fill light 1", () => {
    const s = new Scene(new NullEngine());
    createLighting(s, { tier: "high", viewDistance: 70, colourPath: "material", sky: skyFixture() });
    expect(s.lights[0]!.name).toBe("sun");
    expect(s.lights[1]!.name).toBe("fill");
    s.getEngine().dispose();
  });

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
      "foliageDiffuseLighting(preInfo,$1,float($2),vFoliageH,viewDirectionW)",
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
    expect(code).toContain("#ifdef FOLIAGE\n");
    expect(code).toContain("#else\ninfo.diffuse=computeDiffuseLighting(preInfo,$1);\n#endif");
    const injected = include.replace(new RegExp(FOLIAGE_LIGHT_INJECTION_POINT.slice(1), "g"), code);
    expect(injected).toContain("\ninfo.diffuse=foliageDiffuseLighting(preInfo,diffuse{X}.rgb,float({X}),vFoliageH,viewDirectionW);");
    expect(injected).toContain("\ninfo.diffuse=computeDiffuseLighting(preInfo,diffuse{X}.rgb);");
  });

  it("the wrap term never exceeds Lambert at full light and returns the stock result off the sun", () => {
    expect(diffuseFx).toContain("if (lightIndex > 0.5) {");
    expect(diffuseFx).toContain(`const float FOLIAGE_WRAP = ${FOLIAGE_WRAP};`);
    // (ndotl + w) / ((1 + w)^2) <= ndotl for ndotl = 1: 1/(1+w) <= 1.
    expect((1 + FOLIAGE_WRAP) / ((1 + FOLIAGE_WRAP) * (1 + FOLIAGE_WRAP))).toBeLessThanOrEqual(1);
  });
});
