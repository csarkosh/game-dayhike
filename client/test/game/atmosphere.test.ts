import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/ShadersInclude/fogFragment.js";
import atmosphereFragment from "../../src/game/shaders/atmosphereFog.fragment.fx?raw";
import { ATMOSPHERE_FOG_ANCHOR, createAtmosphere, type Atmosphere } from "../../src/game/atmosphere.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { fogGradientUnder, GRADIENT_STEPS } from "../../src/game/atmosphereParams.js";

let engine: NullEngine;
let scene: Scene;
let atmosphere: Atmosphere;

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

  it("update writes the record, keeps scene.fogColor on the gradient's far end, and rebuilds the gradient only on change", () => {
    atmosphere.update(WEATHER_PRESETS.clear, 12);
    const far = fogGradientUnder(WEATHER_PRESETS.clear, 12)[GRADIENT_STEPS - 1]!;
    expect(scene.fogColor.r).toBeCloseTo(far.r, 6);
    expect(atmosphere.record.sunWeight).toBe(1);
    const before = atmosphere.gradientBuilds;
    atmosphere.update(WEATHER_PRESETS.clear, 12);
    expect(atmosphere.gradientBuilds).toBe(before);
    atmosphere.update(WEATHER_PRESETS.eerie, 12);
    expect(atmosphere.gradientBuilds).toBe(before + 1);
    expect(atmosphere.record.sunWeight).toBeLessThan(1);
  });

  it("midColour is between the gradient's ends", () => {
    atmosphere.update(WEATHER_PRESETS.mist, 12);
    const g = fogGradientUnder(WEATHER_PRESETS.mist, 12);
    const mid = atmosphere.midColour();
    expect(mid.r).toBeGreaterThanOrEqual(Math.min(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
    expect(mid.r).toBeLessThanOrEqual(Math.max(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
  });
});

describe("GLSL literals stay in lockstep with atmosphereParams.ts", () => {
  it("carries the level-slope clamp the TS mirror uses", () => {
    expect(atmosphereFragment).toContain("const float ATM_LEVEL_SLOPE = 1.0e-3;");
  });
});
