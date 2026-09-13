import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";

import { createLighting, DEFAULT_HOUR } from "../../src/game/lighting.js";
import {
  exposureFor,
  FILL_DAY,
  fogDensityFor,
  skyColourAt,
  sunPositionAt,
} from "../../src/game/sky.js";
import { QUALITY } from "../../src/game/quality.js";
import {
  WEATHER_PRESETS,
  fogDensityUnder,
  sunIntensityUnder,
  exposureUnder,
  gradeUnder,
  SATURATION_DROP,
} from "../../src/game/weather.js";

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

describe("createLighting", () => {
  it("survives an engine with no shadow support", () => {
    // NullEngine reports textureFloatRender false, so CascadedShadowGenerator
    // throws on construction. Real hardware at the low tier is the same case.
    // If this throws, the renderer cannot be tested headlessly at all.
    const s = scene();
    const lighting = createLighting(s, { tier: "high", viewDistance: 70 });
    expect(lighting.shadows).toBeNull();
    lighting.dispose();
  });

  it("never builds a shadow generator at the low tier", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "low", viewDistance: 70 });
    expect(lighting.shadows).toBeNull();
    lighting.dispose();
  });

  it("points the sun light along the direction light travels", () => {
    // The sign trap. sunPositionAt points TOWARD the sun; a DirectionalLight
    // wants the opposite. Getting this backwards lights the world from
    // underground at noon and is invisible to any test that only checks the axis.
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70, hour: 12 });
    const sun = s.getLightByName("sun");
    expect(sun).not.toBeNull();
    const toSun = sunPositionAt(12);
    const direction = (sun as unknown as { direction: { x: number; y: number; z: number } }).direction;
    expect(direction.x).toBeCloseTo(-toSun.x, 5);
    expect(direction.y).toBeCloseTo(-toSun.y, 5);
    expect(direction.z).toBeCloseTo(-toSun.z, 5);
    expect(direction.y).toBeLessThan(0);
    lighting.dispose();
  });

  it("defaults to DEFAULT_HOUR, which matches the /time command's default", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70 });
    expect(lighting.hour).toBe(DEFAULT_HOUR);
    lighting.dispose();
  });

  it("moves the sun when the hour changes", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70, hour: 12 });
    const sun = s.getLightByName("sun") as unknown as {
      direction: { x: number; y: number; z: number };
    };
    const noon = { ...sun.direction };
    lighting.setHour(7);
    expect(sun.direction.y).not.toBeCloseTo(noon.y, 3);
    expect(lighting.hour).toBe(7);
    lighting.dispose();
  });

  it("keeps fog colour and clear colour agreeing with the sky", () => {
    const s = scene();
    const lighting = createLighting(s, {
      tier: "medium", viewDistance: 70, hour: 8, weather: WEATHER_PRESETS.clear,
    });
    const expected = skyColourAt(8);
    expect(s.fogColor.r).toBeCloseTo(expected.r, 5);
    expect(s.fogColor.g).toBeCloseTo(expected.g, 5);
    expect(s.fogColor.b).toBeCloseTo(expected.b, 5);
    // All three channels, not just r: Color4(air.r, air.r, air.r, 1) would pass
    // a red-only check without actually matching the sky.
    expect(s.clearColor.r).toBeCloseTo(expected.r, 5);
    expect(s.clearColor.g).toBeCloseTo(expected.g, 5);
    expect(s.clearColor.b).toBeCloseTo(expected.b, 5);
    lighting.setHour(21);
    const night = skyColourAt(21);
    expect(s.fogColor.r).toBeCloseTo(night.r, 5);
    expect(s.fogColor.g).toBeCloseTo(night.g, 5);
    expect(s.fogColor.b).toBeCloseTo(night.b, 5);
    lighting.dispose();
  });

  it("keeps the skybox out of fog, so the sky and probe stay directional", () => {
    // SkyMaterial participates in fog like any other material, and
    // infiniteDistance only translates the box with the camera rather than
    // shrinking it — a face centre is still ~4000m out at SKYBOX_SIZE = 8000,
    // where EXP2 fog saturates at any usable view distance. NullEngine compiles
    // no shaders, so this cannot catch the visual effect (a flat wash instead of
    // a sun disc and gradient); it only pins the intent against a future
    // "tidy-up" that removes the line because it looks redundant.
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70 });
    const skybox = s.getMeshByName("skybox");
    expect(skybox).not.toBeNull();
    expect(skybox!.applyFog).toBe(false);
    // One word away from a skybox that slides off with the camera instead of
    // staying centred on it.
    expect(skybox!.infiniteDistance).toBe(true);
    lighting.dispose();
  });

  it("sets the fill light to the day intensity at the default hour", () => {
    const s = scene();
    const lighting = createLighting(s, {
      tier: "medium", viewDistance: 70, weather: WEATHER_PRESETS.clear,
    });
    const fill = s.getLightByName("fill");
    expect(fill).not.toBeNull();
    expect((fill as unknown as { intensity: number }).intensity).toBeCloseTo(FILL_DAY, 6);
    lighting.dispose();
  });

  it("sets exponential-squared fog at the requested view distance", () => {
    const s = scene();
    const lighting = createLighting(s, {
      tier: "medium", viewDistance: 250, weather: WEATHER_PRESETS.clear,
    });
    expect(s.fogMode).toBe(Scene.FOGMODE_EXP2);
    expect(s.fogDensity).toBeCloseTo(fogDensityFor(250), 10);
    lighting.dispose();
  });

  it("enables ACES tone mapping and tracks exposure to the sun", () => {
    const s = scene();
    const lighting = createLighting(s, {
      tier: "medium", viewDistance: 70, hour: 12, weather: WEATHER_PRESETS.clear,
    });
    const ip = s.imageProcessingConfiguration;
    expect(ip.toneMappingEnabled).toBe(true);
    expect(ip.toneMappingType).toBe(ImageProcessingConfiguration.TONEMAPPING_ACES);
    expect(ip.exposure).toBeCloseTo(exposureFor(sunPositionAt(12).y), 5);
    lighting.setHour(0);
    expect(ip.exposure).toBeCloseTo(exposureFor(sunPositionAt(0).y), 5);
    // Night must be the brighter exposure, or /time 0 renders as pure black.
    expect(ip.exposure).toBeGreaterThan(exposureFor(sunPositionAt(12).y));
    lighting.dispose();
  });

  it("installs an environment texture, so PBR has something to reflect", () => {
    // Without this, PBR metals read as flat grey and everything looks like
    // plastic.
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70 });
    expect(s.environmentTexture).not.toBeNull();
    lighting.dispose();
  });

  it("applies the tier's hardware scaling to the engine", () => {
    // A spy on the call, not a readback of the engine's state: NullEngine's
    // getHardwareScalingLevel() is hardcoded to 1.0 in 9.18.0 and ignores
    // whatever the setter stored, so a readback assertion would be vacuous at
    // "medium" (1 either way) and impossible at "low" (never reads back 1.5).
    // Two tiers, not one, because low and medium are the only distinct values
    // in the table (high matches medium at 1) — a single-tier assertion would
    // pass against an implementation that hardcodes 1.5.
    const low = scene();
    const setLow = vi.spyOn(low.getEngine(), "setHardwareScalingLevel");
    const lightingLow = createLighting(low, { tier: "low", viewDistance: 70 });
    expect(setLow).toHaveBeenCalledWith(QUALITY.low.hardwareScaling);
    lightingLow.dispose();
    // scene() reassigns the shared `engine` tracker, and afterEach disposes only
    // the last one — dispose this engine now rather than leak it.
    low.getEngine().dispose();

    const medium = scene();
    const setMedium = vi.spyOn(medium.getEngine(), "setHardwareScalingLevel");
    const lightingMedium = createLighting(medium, { tier: "medium", viewDistance: 70 });
    expect(setMedium).toHaveBeenCalledWith(QUALITY.medium.hardwareScaling);
    lightingMedium.dispose();
  });

  it("disposes every object it created", () => {
    // Named for what it actually checks: dispose() releases the objects
    // createLighting created (meshes, the sun light, the environment texture).
    // It does not restore borrowed scene state — fog, tone-mapping, exposure and
    // hardware scaling are left as set, which is documented on `Lighting.dispose`
    // rather than tested here, since the renderer disposes the whole Scene in
    // practice and restoring would be dead code.
    const s = scene();
    const before = s.meshes.length;
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70 });
    expect(s.meshes.length).toBeGreaterThan(before);
    lighting.dispose();
    expect(s.meshes.length).toBe(before);
    expect(s.getLightByName("sun")).toBeNull();
    // ReflectionProbe.dispose() disposes its render target and nulls its own
    // reference, but never touches scene.environmentTexture — left unguarded,
    // the scene would keep pointing at a disposed cube texture that
    // scene.pure.js re-adds to _renderTargets every frame.
    expect(s.environmentTexture).toBeNull();
  });

  it("tolerates addShadowMesh when there are no shadows", () => {
    // The low tier and any engine without float render targets both take this
    // path, so the caller must not have to check.
    const s = scene();
    const lighting = createLighting(s, { tier: "low", viewDistance: 70 });
    const box = s.meshes[0];
    expect(box).toBeDefined();
    expect(() => lighting.addShadowMesh(box!)).not.toThrow();
    lighting.dispose();
  });

  it("tolerates removeShadowMesh when there are no shadows", () => {
    // The inverse of addShadowMesh, needed because Babylon's own
    // `AbstractMesh.dispose` does NOT take the mesh out of a shadow
    // generator's render list — pooled casters that come and go (the wildlife
    // creatures) would otherwise leave the generator holding every disposed
    // animal. What it does to a LIVE generator cannot be checked here:
    // NullEngine reports `textureFloatRender` false, so `shadows` is null at
    // every tier (the two cases at the top of this block). The add/remove
    // pairing itself is covered from the caller's side, against a recording
    // stand-in, in wildlifeMeshes.test.ts.
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70 });
    expect(lighting.shadows).toBeNull();
    const box = s.meshes[0];
    expect(box).toBeDefined();
    lighting.addShadowMesh(box!);
    expect(() => lighting.removeShadowMesh(box!)).not.toThrow();
    lighting.dispose();
  });

  it("marks a registered mesh as a shadow receiver, not just a caster", () => {
    // The wiring gap this closes: casting and receiving landed on different
    // call sites in `renderer.ts` and only one of them was ever wired.
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70 });
    const box = s.meshes[0];
    expect(box).toBeDefined();
    box!.receiveShadows = false;
    lighting.addShadowMesh(box!);
    expect(box!.receiveShadows).toBe(true);
    lighting.dispose();
  });
});

describe("weather in lighting", () => {
  it("defaults to the mist preset — fog, sun and exposure all shifted", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70, hour: 12 });
    const w = WEATHER_PRESETS.mist;
    expect(lighting.weather).toEqual(w);
    expect(s.fogDensity).toBeCloseTo(fogDensityUnder(w, 70), 12);
    const sun = s.getLightByName("sun") as unknown as { intensity: number };
    expect(sun.intensity).toBeCloseTo(sunIntensityUnder(w, 12), 12);
    expect(s.imageProcessingConfiguration.exposure).toBeCloseTo(
      exposureUnder(w, sunPositionAt(12).y), 12);
    lighting.dispose();
  });

  it("explicit clear weather reproduces the pre-weather sunny state exactly", () => {
    const s = scene();
    const lighting = createLighting(s, {
      tier: "medium", viewDistance: 70, hour: 12, weather: WEATHER_PRESETS.clear,
    });
    expect(s.fogDensity).toBe(fogDensityFor(70));
    expect(s.imageProcessingConfiguration.exposure).toBe(exposureFor(sunPositionAt(12).y));
    const sky = s.getMaterialByName("skyMaterial") as unknown as {
      turbidity: number; luminance: number;
    };
    expect(sky.turbidity).toBe(4);
    expect(sky.luminance).toBe(1);
    expect(s.imageProcessingConfiguration.colorCurves?.globalSaturation).toBe(0);
    lighting.dispose();
  });

  it("setWeather with fade 0 applies instantly; the sky material follows", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70, hour: 12 });
    lighting.setWeather(WEATHER_PRESETS.clear, 0);
    expect(lighting.weather).toEqual(WEATHER_PRESETS.clear);
    expect(s.fogDensity).toBe(fogDensityFor(70));
    lighting.setWeather(WEATHER_PRESETS.rain, 0);
    const sky = s.getMaterialByName("skyMaterial") as unknown as { turbidity: number };
    expect(sky.turbidity).toBe(20);
    expect(s.imageProcessingConfiguration.colorCurves?.globalSaturation).toBe(-SATURATION_DROP);
    lighting.dispose();
  });

  it("a timed fade does not jump: current weather is unchanged until a frame renders", () => {
    const s = scene();
    const lighting = createLighting(s, {
      tier: "medium", viewDistance: 70, hour: 12, weather: WEATHER_PRESETS.clear,
    });
    lighting.setWeather(WEATHER_PRESETS.rain, 3);
    expect(lighting.weather).toEqual(WEATHER_PRESETS.clear);
    lighting.dispose();
  });

  it("writes the split-tone grade onto colorCurves when weather changes", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70, hour: 12 });
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    const c = s.imageProcessingConfiguration.colorCurves;
    const g = gradeUnder(WEATHER_PRESETS.eerie);
    expect(c?.shadowsHue).toBe(g.shadowsHue);
    expect(c?.shadowsDensity).toBe(g.shadowsDensity);
    expect(c?.shadowsSaturation).toBe(g.shadowsSaturation);
    expect(c?.midtonesHue).toBe(g.midtonesHue);
    expect(c?.midtonesDensity).toBe(g.midtonesDensity);
    expect(c?.midtonesSaturation).toBe(g.midtonesSaturation);
    expect(c?.highlightsHue).toBe(g.highlightsHue);
    expect(c?.highlightsDensity).toBe(g.highlightsDensity);
    expect(c?.highlightsSaturation).toBe(g.highlightsSaturation);
    lighting.dispose();
  });

  it("leaves the colour filter inert under clear — the sunny frame is untouched", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70, hour: 12 });
    lighting.setWeather(WEATHER_PRESETS.clear, 0);
    const c = s.imageProcessingConfiguration.colorCurves;
    expect(c?.shadowsDensity).toBe(0);
    expect(c?.midtonesDensity).toBe(0);
    expect(c?.highlightsDensity).toBe(0);
    expect(c?.midtonesSaturation).toBe(0);
    lighting.dispose();
  });
});
