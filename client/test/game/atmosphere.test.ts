import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/ShadersInclude/fogFragment.js";
import atmosphereFragment from "../../src/game/shaders/atmosphereFog.fragment.fx?raw";
import { ATMOSPHERE_FOG_ANCHOR, createAtmosphere, type Atmosphere } from "../../src/game/atmosphere.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { fogGradientUnder, GRADIENT_BIAS, GRADIENT_NEAR_DIM, GRADIENT_STEPS } from "../../src/game/atmosphereParams.js";
import { CLOUD_NOISE_SIZE } from "../../src/game/cloudParams.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { skyFixture } from "./helpers/skyFixture.js";

let engine: NullEngine;
let scene: Scene;
let atmosphere: Atmosphere;
const table = skyFixture();

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  atmosphere = createAtmosphere(scene, 4000);
});

afterEach(() => {
  atmosphere.dispose();
  scene.dispose();
  engine.dispose();
});

describe("the fog anchor", () => {
  it("matches the installed fogFragment include once `color` is renamed to `finalColor`", () => {
    const include = ShaderStore.IncludesShadersStore["fogFragment"] as string;
    const expanded = include.replace(/\bcolor\b/g, "finalColor");
    const re = new RegExp(ATMOSPHERE_FOG_ANCHOR.slice(1));
    expect(re.test(expanded)).toBe(true);
  });

  it("the GLSL declares the function the replacement calls", () => {
    expect(atmosphereFragment).toContain("vec3 atmosphereFog(vec3 lit, float fog)");
    expect(atmosphereFragment).toContain("float atmHeightFog(");
  });
});

describe("createAtmosphere", () => {
  it("attaches to PBR materials created afterwards and declines everything else", () => {
    const pbr = new PBRMaterial("pbr", scene);
    const std = new StandardMaterial("std", scene);
    expect(pbr.pluginManager?.getPlugin("Atmosphere")).toBeTruthy();
    expect(std.pluginManager?.getPlugin("Atmosphere") ?? null).toBeNull();
  });

  // The Hollow's material keeps fog off, and the plugin's spliced code reads
  // `vFogColor`, declared only while FOG is set, so the plugin would stop it
  // compiling. The factory leaves it alone by name; that null is the rule.
  it("leaves the Hollow's PBR material alone and attaches to any other", async () => {
    const hollow = new PBRMaterial("mat_hollow", scene);
    hollow.fogEnabled = false;
    const other = new PBRMaterial("mat_other", scene);
    expect(hollow.pluginManager?.getPlugin("Atmosphere") ?? null).toBeNull();
    expect(other.pluginManager?.getPlugin("Atmosphere")).toBeTruthy();
    // And, with the plugin registered, the fog-off material still readies.
    // NullEngine compiles no GLSL, so this guards the material's own pipeline,
    // not the skip: the null above is what pins the skip.
    const box = CreateBox("hollow_box", {}, scene);
    box.material = hollow;
    await hollow.forceCompilationAsync(box);
    expect(hollow.isReady(box)).toBe(true);
  });

  it("leaves the plugin off and holds no record before its first update", () => {
    expect(atmosphere.record).toBeNull();
    expect(atmosphere.gradientBuilds).toBe(0);
  });

  it("update writes the record, keeps scene.fogColor on the sky state's mist air, and rebuilds the gradient only for a new state or a weather change", () => {
    const sky = skyStateFor(table, 12, WEATHER_PRESETS.clear);
    atmosphere.update(WEATHER_PRESETS.clear, sky);
    expect(scene.fogColor.r).toBeCloseTo(sky.mistAir.r, 6);
    expect(scene.fogColor.g).toBeCloseTo(sky.mistAir.g, 6);
    expect(scene.fogColor.b).toBeCloseTo(sky.mistAir.b, 6);
    expect(scene.fogDensity).toBe(atmosphere.record!.baseDensity);
    expect(atmosphere.record!.sunWeight).toBe(sky.glowWeight);
    expect(atmosphere.record!.sunPower).toBe(sky.glowPower);
    expect(atmosphere.gradientBuilds).toBe(1);
    // The same state, a still frame: nothing rebuilt.
    atmosphere.update(WEATHER_PRESETS.clear, sky);
    expect(atmosphere.gradientBuilds).toBe(1);
    // A new state object, as each apply of the lighting makes, even with equal values.
    const again = { ...sky };
    atmosphere.update(WEATHER_PRESETS.clear, again);
    expect(atmosphere.gradientBuilds).toBe(2);
    // A weather axis moved under the same state.
    atmosphere.update(WEATHER_PRESETS.eerie, again);
    expect(atmosphere.gradientBuilds).toBe(3);
  });

  it("midColour is between the gradient's ends", () => {
    const sky = skyStateFor(table, 12, WEATHER_PRESETS.mist);
    atmosphere.update(WEATHER_PRESETS.mist, sky);
    const g = fogGradientUnder(WEATHER_PRESETS.mist, sky);
    const mid = atmosphere.midColour();
    expect(mid.r).toBeGreaterThanOrEqual(Math.min(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
    expect(mid.r).toBeLessThanOrEqual(Math.max(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
  });

  it("nearColour is the gradient's near end", () => {
    const sky = skyStateFor(table, 12, WEATHER_PRESETS.mist);
    atmosphere.update(WEATHER_PRESETS.mist, sky);
    const g = fogGradientUnder(WEATHER_PRESETS.mist, sky);
    expect(atmosphere.nearColour()).toEqual(g[0]);
  });
});

describe("GLSL literals stay in lockstep with atmosphereParams.ts", () => {
  it("carries the level-slope clamp the TS mirror uses", () => {
    expect(atmosphereFragment).toContain("const float ATM_LEVEL_SLOPE = 1.0e-3;");
  });
  it("draws the gradient with the TS mirror's near dim and bias, and reads the cloud map half a texel inside its edge", () => {
    expect(atmosphereFragment).toContain(`const float ATM_NEAR_DIM = ${GRADIENT_NEAR_DIM};`);
    expect(atmosphereFragment).toContain(`const float ATM_GRADIENT_BIAS = ${GRADIENT_BIAS};`);
    expect(atmosphereFragment).toContain(`const float ATM_CLOUD_EDGE = 0.5 / ${CLOUD_NOISE_SIZE}.0;`);
  });
});

describe("F1 regression: atmCloudMap compiles into the fragment source on both paths", () => {
  // The sampler moved out of getUniforms().fragment (ADDITIONAL_FRAGMENT_DECLARATION,
  // non-UBO only) into atmosphereFog.fragment.fx (CUSTOM_FRAGMENT_DEFINITIONS, both
  // paths). This proves the declaration actually reaches the compiled fragment
  // source under both a UBO-supporting and a non-UBO NullEngine.
  const ATM_IDENTIFIERS = [
    "atmOn", "atmHeightDensity", "atmHeightFalloff", "atmReferenceLevel",
    "atmGradientScale", "atmSunPower", "atmSunWeight", "atmSunDir", "atmSunColour", "atmFarColour", "atmCloudMap", "atmCloudSteps",
  ];

  async function compiledFragmentSource(targetScene: Scene): Promise<string> {
    const material = new PBRMaterial("pbr-f1", targetScene);
    const mesh = CreateBox("box-f1", {}, targetScene);
    mesh.material = material;
    // forceCompilationAsync compiles on a scratch SubMesh it builds with
    // addToMesh=false and never exposes, so its effect is unreachable from
    // outside. Poll isReadyForSubMesh directly on the mesh's own (real)
    // submesh instead, the same loop forceCompilation runs internally, so the
    // compiled effect lands on `mesh.subMeshes[0]` where this test can read it.
    const subMesh = mesh.subMeshes[0]!;
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (material.isReadyForSubMesh(mesh, subMesh, false)) {
          resolve();
          return;
        }
        setTimeout(tick, 16);
      };
      tick();
    });
    // Effect.fragmentSourceCode (the public getter): under NullEngine,
    // createShaderProgram is stubbed with no real shader object, so the
    // pipeline context's own _getFragmentShaderCode() returns null and the
    // getter falls back to the private _fragmentSourceCode field — the
    // migrated code _processShaderCodeAsync already produced, the same text
    // a real driver would compile.
    return subMesh.effect?.fragmentSourceCode ?? "";
  }

  it("non-UBO path (the default NullEngine from beforeEach)", async () => {
    expect(engine.supportsUniformBuffers).toBe(false);
    const source = await compiledFragmentSource(scene);
    expect((source.match(/uniform sampler2D atmCloudMap;/g) ?? []).length).toBe(1);
    expect(source).not.toContain("atmGradient;");
    for (const name of ATM_IDENTIFIERS) expect(source).toContain(name);
  });

  it("UBO path (a NullEngine forced to webGLVersion 2)", async () => {
    const uboEngine = new NullEngine();
    (uboEngine as unknown as { _webGLVersion: number })._webGLVersion = 2;
    expect(uboEngine.supportsUniformBuffers).toBe(true);
    const uboScene = new Scene(uboEngine);
    const uboAtmosphere = createAtmosphere(uboScene, 4000);
    try {
      const source = await compiledFragmentSource(uboScene);
      expect((source.match(/uniform sampler2D atmCloudMap;/g) ?? []).length).toBe(1);
      for (const name of ATM_IDENTIFIERS) expect(source).toContain(name);
    } finally {
      uboAtmosphere.dispose();
      uboScene.dispose();
      uboEngine.dispose();
    }
  });
});

describe("the fog's shader text", () => {
  it("is byte for byte the text every PBR material's stage is built with", () => {
    // The scattering sky changes no PBR shader: the glow's new shape is all in
    // the values the plugin binds (`atmosphereParams.ts`).
    expect(createHash("sha256").update(atmosphereFragment).digest("hex")).toBe(
      "4769023adf97e99e61c873999a9a1f1cec31493dec98421d4d3d709d572a0025",
    );
  });
});
