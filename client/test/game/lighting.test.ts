import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import type { SkyState } from "../../src/game/skyState.js";

/**
 * What the lighting asks of the dome, recorded on the way through to the
 * real one: each update's state and exposure, each turn of the capture
 * branch, and each dispose.
 */
const dome = vi.hoisted(() => ({
  updates: [] as { state: SkyState; exposure: number }[],
  captures: [] as boolean[],
  disposed: 0,
}));
vi.mock("../../src/game/skyDome.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/skyDome.js")>();
  return {
    ...mod,
    createSkyDome: (...args: Parameters<typeof mod.createSkyDome>) => {
      const made = mod.createSkyDome(...args);
      const update = made.update.bind(made);
      const setCapture = made.setCapture.bind(made);
      const dispose = made.dispose.bind(made);
      made.update = (state, exposure) => {
        dome.updates.push({ state, exposure });
        update(state, exposure);
      };
      made.setCapture = (on) => {
        dome.captures.push(on);
        setCapture(on);
      };
      made.dispose = () => {
        dome.disposed += 1;
        dispose();
      };
      return made;
    },
  };
});

import { createLighting, DEFAULT_HOUR, sunAltitudeDeg, type Lighting, type LightingOptions } from "../../src/game/lighting.js";
import { SKY_DOME_NAME } from "../../src/game/skyDome.js";
import { createSkyTable } from "../../src/game/skyTable.js";
import { SKY_IBL_SCALE, skyStateFor } from "../../src/game/skyState.js";
import { exposureFor, fogDensityFor, sunPositionAt } from "../../src/game/sky.js";
import { QUALITY } from "../../src/game/quality.js";
import { WEATHER_PRESETS, fogDensityUnder, exposureUnder, ambientCollapseUnder } from "../../src/game/weather.js";
import { skyFixture } from "./helpers/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
  dome.updates.length = 0;
  dome.captures.length = 0;
  dome.disposed = 0;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

/** The lighting on `s`: the medium tier, 70 m of fog, the material path and
 * the fixture's sky, with `options` over those. */
function light(s: Scene, options: Partial<LightingOptions> = {}): Lighting {
  return createLighting(s, { tier: "medium", viewDistance: 70, colourPath: "material", sky: skyFixture(), ...options });
}

const sunOf = (s: Scene): DirectionalLight => s.getLightByName("sun") as DirectionalLight;
const fillOf = (s: Scene): HemisphericLight => s.getLightByName("fill") as HemisphericLight;
const captureOf = (s: Scene): RenderTargetTexture => s.environmentTexture as RenderTargetTexture;

describe("createLighting", () => {
  it("survives an engine with no shadow support", () => {
    // NullEngine reports textureFloatRender false, so CascadedShadowGenerator
    // throws on construction. Real hardware at the low tier is the same case.
    // If this throws, the renderer cannot be tested headlessly at all.
    const lighting = light(scene(), { tier: "high" });
    expect(lighting.shadows).toBeNull();
    lighting.dispose();
  });

  it("never builds a shadow generator at the low tier", () => {
    const lighting = light(scene(), { tier: "low" });
    expect(lighting.shadows).toBeNull();
    lighting.dispose();
  });

  it("points the sun light along the direction light travels", () => {
    // The sign trap. sunPositionAt points TOWARD the sun; a DirectionalLight
    // wants the opposite. Getting this backwards lights the world from
    // underground at noon and is invisible to any test that only checks the axis.
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const toSun = sunPositionAt(12);
    const direction = sunOf(s).direction;
    expect(direction.x).toBeCloseTo(-toSun.x, 5);
    expect(direction.y).toBeCloseTo(-toSun.y, 5);
    expect(direction.z).toBeCloseTo(-toSun.z, 5);
    expect(direction.y).toBeLessThan(0);
    lighting.dispose();
  });

  it("keeps the sun light 0 and the fill light 1: the dome adds no light", () => {
    const s = scene();
    const lighting = light(s);
    expect(s.lights.map((l) => l.name)).toEqual(["sun", "fill"]);
    lighting.dispose();
  });

  it("defaults to DEFAULT_HOUR, which matches the /time command's default", () => {
    const lighting = light(scene());
    expect(lighting.hour).toBe(DEFAULT_HOUR);
    lighting.dispose();
  });

  it("moves the sun when the hour changes", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const noonY = sunOf(s).direction.y;
    // 8, not 7: the fixture holds the slices around the hours the suite visits.
    lighting.setHour(8);
    expect(sunOf(s).direction.y).not.toBeCloseTo(noonY, 3);
    expect(lighting.hour).toBe(8);
    lighting.dispose();
  });

  it("puts the fog and the clear colour on the sky state's mist air, which at clear is the dome's horizon away from the sun", () => {
    const s = scene();
    const table = skyFixture();
    const lighting = light(s, { hour: 8, weather: CLEAR, sky: table });
    // The state applied is the one the table makes for the hour and the weather.
    expect(lighting.sky).toEqual(skyStateFor(table, 8, CLEAR));
    for (const hour of [8, 21]) {
      lighting.setHour(hour);
      const sky = lighting.sky!;
      expect(sky.hour).toBe(hour);
      expect(sky.mistAir).toEqual(sky.horizonAway);
      // All three channels, not just r: Color4(air.r, air.r, air.r, 1) would
      // pass a red-only check without matching the sky.
      expect(s.fogColor.r).toBeCloseTo(sky.mistAir.r, 6);
      expect(s.fogColor.g).toBeCloseTo(sky.mistAir.g, 6);
      expect(s.fogColor.b).toBeCloseTo(sky.mistAir.b, 6);
      expect(s.clearColor.r).toBeCloseTo(sky.mistAir.r, 6);
      expect(s.clearColor.g).toBeCloseTo(sky.mistAir.g, 6);
      expect(s.clearColor.b).toBeCloseTo(sky.mistAir.b, 6);
    }
    lighting.dispose();
  });

  it("draws the dome, riding with the camera, unpicked, and alone in the probe's capture", () => {
    const s = scene();
    const lighting = light(s);
    const mesh = s.getMeshByName(SKY_DOME_NAME);
    expect(mesh).not.toBeNull();
    expect(mesh!.infiniteDistance).toBe(true);
    expect(mesh!.isPickable).toBe(false);
    // Assigned, not left null: a null render list is the whole scene in Babylon.
    // By identity: the mesh and the probe refer to each other, which a deep
    // comparison cannot walk.
    const list = captureOf(s).renderList;
    expect(list).toHaveLength(1);
    expect(list![0]).toBe(mesh);
    lighting.dispose();
  });

  it("captures the dome gamma-flagged, 8-bit where the engine renders no half floats", () => {
    const s = scene();
    const lighting = light(s);
    expect(captureOf(s).gammaSpace).toBe(true);
    // The type the engine is asked for: NullEngine's cube render target never
    // attaches the texture it makes, so getInternalTexture() is null there.
    expect(captureOf(s).renderTargetOptions.type).toBe(Constants.TEXTURETYPE_UNSIGNED_BYTE);
    lighting.dispose();
  });

  it("captures the dome in half float where the engine renders half floats, so the dusk horizon above 1 survives", () => {
    const s = scene();
    s.getEngine().getCaps().textureHalfFloatRender = true;
    const lighting = light(s);
    expect(captureOf(s).gammaSpace).toBe(true);
    expect(captureOf(s).renderTargetOptions.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    lighting.dispose();
  });

  it("keeps the capture gamma-flagged and not RGBD, the two inputs Babylon's reflection defines read, so no PBR stage changes", () => {
    const s = scene();
    s.getEngine().getCaps().textureHalfFloatRender = true;
    const lighting = light(s);
    expect(captureOf(s).gammaSpace).toBe(true);
    expect(captureOf(s).isRGBD).toBe(false);
    lighting.dispose();
  });

  it("gives the image-based light SKY_IBL_SCALE of the dome at clear", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    expect(s.environmentIntensity).toBe(SKY_IBL_SCALE);
    lighting.dispose();
  });

  it("turns the dome's capture branch on for each face the probe draws, and off after it", () => {
    const s = scene();
    const lighting = light(s);
    captureOf(s).onBeforeRenderObservable.notifyObservers(0);
    expect(dome.captures).toEqual([true]);
    captureOf(s).onAfterRenderObservable.notifyObservers(0);
    expect(dome.captures).toEqual([true, false]);
    lighting.dispose();
  });

  it("hands the dome each state it applies, with the image's exposure, and re-arms the probe", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    expect(dome.updates.length).toBe(1);
    expect(dome.updates[0]!.state).toBe(lighting.sky);
    expect(dome.updates[0]!.exposure).toBe(s.imageProcessingConfiguration.exposure);
    captureOf(s).refreshRate = 60;
    lighting.setHour(15);
    expect(dome.updates.length).toBe(2);
    expect(dome.updates[1]!.state).toBe(lighting.sky);
    // REFRESHRATE_RENDER_ONCE: one capture of the dome as it now stands.
    expect(captureOf(s).refreshRate).toBe(0);
    lighting.dispose();
  });

  it("sets the sun from the sky state: SUN_PEAK at clear noon, its colour on its diffuse and its specular alike", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    const sun = sunOf(s);
    expect(sun.intensity).toBeCloseTo(4, 6);
    const c = lighting.sky!.sunColour;
    expect([sun.diffuse.r, sun.diffuse.g, sun.diffuse.b]).toEqual([c.r, c.g, c.b]);
    expect(sun.specular).toBe(sun.diffuse);
    // SUN_PEAK x (1 - SUN_CLOUD_LOSS x 0.9): mist's cloud takes 81 % of the noon sun.
    lighting.setWeather(WEATHER_PRESETS.mist, 0);
    expect(sun.intensity).toBeCloseTo(0.76, 6);
    // Full cloud: SUN_CLOUD_LOSS of it.
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    expect(sun.intensity).toBeCloseTo(0.4, 6);
    lighting.dispose();
  });

  it("sets the fill from the sky state: FILL_DAY at clear noon, lifted under cloud, collapsed on the top dread plateau", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    const fill = fillOf(s);
    expect(fill.intensity).toBeCloseTo(0.15, 6);
    const c = lighting.sky!.fillColour;
    expect([fill.diffuse.r, fill.diffuse.g, fill.diffuse.b]).toEqual([c.r, c.g, c.b]);
    // FILL_DAY x (1 + FILL_LIFT x 0.9).
    lighting.setWeather(WEATHER_PRESETS.mist, 0);
    expect(fill.intensity).toBeCloseTo(0.4875, 6);
    // FILL_DAY x (1 + FILL_LIFT) on the state, x (1 - AMBIENT_COLLAPSE) on the light.
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    expect(lighting.sky!.fillIntensity).toBeCloseTo(0.525, 6);
    expect(fill.intensity).toBeCloseTo(0.13125, 6);
    lighting.dispose();
  });

  it("sets exponential-squared fog at the requested view distance", () => {
    const s = scene();
    const lighting = light(s, { viewDistance: 250, weather: CLEAR });
    expect(s.fogMode).toBe(Scene.FOGMODE_EXP2);
    expect(s.fogDensity).toBeCloseTo(fogDensityFor(250), 10);
    lighting.dispose();
  });

  it("on the material path uses Khronos Neutral tone mapping with dithering and tracks exposure to the sun", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    const ip = s.imageProcessingConfiguration;
    expect(ip.toneMappingEnabled).toBe(true);
    expect(ip.toneMappingType).toBe(ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL);
    expect(ip.ditheringEnabled).toBe(true);
    expect(ip.applyByPostProcess).toBe(false);
    expect(ip.exposure).toBeCloseTo(exposureFor(sunPositionAt(12).y), 5);
    lighting.setHour(0);
    expect(ip.exposure).toBeCloseTo(exposureFor(sunPositionAt(0).y), 5);
    // Night must be the brighter exposure, or `/time 0` renders as pure black.
    expect(ip.exposure).toBeGreaterThan(exposureFor(sunPositionAt(12).y));
    lighting.dispose();
  });

  it("on the post path hands colour to the post chain", () => {
    const s = scene();
    const lighting = light(s, { tier: "high", hour: 12, colourPath: "post" });
    const ip = s.imageProcessingConfiguration;
    expect(ip.applyByPostProcess).toBe(true);
    expect(ip.toneMappingEnabled).toBe(false);
    expect(ip.colorCurvesEnabled).toBe(false);
    expect(ip.vignetteEnabled).toBe(false);
    lighting.dispose();
  });

  it("collapses the ambient on the top dread plateau", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const before = s.environmentIntensity;
    const fillBefore = fillOf(s).intensity;
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    expect(s.environmentIntensity).toBeCloseTo(before * ambientCollapseUnder(WEATHER_PRESETS.eerie), 10);
    expect(fillOf(s).intensity).toBeLessThan(fillBefore);
    lighting.dispose();
  });

  it("installs an environment texture, so PBR has something to reflect", () => {
    // Without this, PBR metals read as flat grey and everything looks like plastic.
    const s = scene();
    const lighting = light(s);
    expect(s.environmentTexture).not.toBeNull();
    lighting.dispose();
  });

  it("applies the tier's hardware scaling to the engine", () => {
    // A spy on the call, not a readback of the engine's state: NullEngine's
    // getHardwareScalingLevel() is hardcoded to 1.0 in 9.18.0 and ignores
    // whatever the setter stored, so a readback assertion would be vacuous at
    // "medium" (1 either way) and impossible at "low" (never reads back 1.5).
    // Two tiers, not one, because low and medium are the only distinct values
    // in the table (high matches medium at 1).
    const low = scene();
    const setLow = vi.spyOn(low.getEngine(), "setHardwareScalingLevel");
    const lightingLow = light(low, { tier: "low" });
    expect(setLow).toHaveBeenCalledWith(QUALITY.low.hardwareScaling);
    lightingLow.dispose();
    // scene() reassigns the shared `engine` tracker, and afterEach disposes only
    // the last one: dispose this engine now rather than leak it.
    low.getEngine().dispose();

    const medium = scene();
    const setMedium = vi.spyOn(medium.getEngine(), "setHardwareScalingLevel");
    const lightingMedium = light(medium, { tier: "medium" });
    expect(setMedium).toHaveBeenCalledWith(QUALITY.medium.hardwareScaling);
    lightingMedium.dispose();
  });

  it("disposes every object it created", () => {
    // dispose() releases the objects createLighting created (the dome, the
    // lights, the probe). It does not restore borrowed scene state, which is
    // documented on `Lighting.dispose`: the renderer disposes the whole Scene.
    const s = scene();
    const before = s.meshes.length;
    const lighting = light(s);
    expect(s.meshes.length).toBeGreaterThan(before);
    lighting.dispose();
    expect(s.meshes.length).toBe(before);
    expect(s.getLightByName("sun")).toBeNull();
    expect(s.getLightByName("fill")).toBeNull();
    expect(dome.disposed).toBe(1);
    // ReflectionProbe.dispose() disposes its render target and nulls its own
    // reference, but never touches scene.environmentTexture.
    expect(s.environmentTexture).toBeNull();
  });

  it("tolerates addShadowMesh when there are no shadows", () => {
    // The low tier and any engine without float render targets both take this
    // path, so the caller must not have to check.
    const s = scene();
    const lighting = light(s, { tier: "low" });
    const box = s.meshes[0];
    expect(box).toBeDefined();
    expect(() => lighting.addShadowMesh(box!)).not.toThrow();
    lighting.dispose();
  });

  it("tolerates removeShadowMesh when there are no shadows", () => {
    // The inverse of addShadowMesh, needed because Babylon's own
    // `AbstractMesh.dispose` does NOT take the mesh out of a shadow
    // generator's render list. The add/remove pairing itself is covered from
    // the caller's side, against a recording stand-in, in wildlifeMeshes.test.ts.
    const s = scene();
    const lighting = light(s);
    expect(lighting.shadows).toBeNull();
    const box = s.meshes[0];
    expect(box).toBeDefined();
    lighting.addShadowMesh(box!);
    expect(() => lighting.removeShadowMesh(box!)).not.toThrow();
    lighting.dispose();
  });

  it("marks a registered mesh as a shadow receiver, not just a caster", () => {
    const s = scene();
    const lighting = light(s);
    const box = s.meshes[0];
    expect(box).toBeDefined();
    box!.receiveShadows = false;
    lighting.addShadowMesh(box!);
    expect(box!.receiveShadows).toBe(true);
    lighting.dispose();
  });
});

describe("the sky's table", () => {
  it("reads the sun's altitude in degrees, the deep night's below the lowest slice", () => {
    expect(sunAltitudeDeg(12)).toBeCloseTo(75.96375653207352, 10);
    expect(sunAltitudeDeg(15)).toBeCloseTo(43.31385665828306, 10);
    expect(sunAltitudeDeg(18.25)).toBeCloseTo(-3.6378813445700504, 10);
    expect(sunAltitudeDeg(0)).toBeCloseTo(-75.96375653207352, 10);
  });

  it("applies nothing before the table holds the slices either side of noon and of the hour, and applies once it does", () => {
    const s = scene();
    const table = createSkyTable();
    const lighting = light(s, { hour: 12, weather: CLEAR, sky: table });
    expect(lighting.sky).toBeNull();
    expect(dome.updates).toEqual([]);
    // Babylon's defaults stand: nothing of the sky has been applied.
    expect(sunOf(s).intensity).toBe(1);
    expect(fillOf(s).intensity).toBe(1);
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    expect(lighting.sky).toBeNull();
    table.add(fixture.blendAt(76));
    expect(lighting.sky).not.toBeNull();
    expect(dome.updates.length).toBe(1);
    expect(sunOf(s).intensity).toBeCloseTo(4, 6);
    lighting.dispose();
  });

  it("waits again for an hour whose slices are not in, keeping the last state, and applies when they arrive", () => {
    const s = scene();
    const table = createSkyTable();
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    table.add(fixture.blendAt(76));
    const lighting = light(s, { hour: 12, weather: CLEAR, sky: table });
    const noon = lighting.sky;
    expect(noon?.hour).toBe(12);
    lighting.setHour(15);
    expect(lighting.sky).toBe(noon);
    expect(dome.updates.length).toBe(1);
    // 15:00's sun stands at 43.3 degrees, between the slices at 42 and 44.
    table.add(fixture.blendAt(42));
    table.add(fixture.blendAt(44));
    expect(lighting.sky?.hour).toBe(15);
    expect(dome.updates.length).toBe(2);
    // Once the hour's slices are in, a slice for another hour changes nothing.
    table.add(fixture.blendAt(28));
    expect(dome.updates.length).toBe(2);
    lighting.dispose();
  });

  it("reads the deep night from the lowest slice", () => {
    const s = scene();
    const table = createSkyTable();
    const fixture = skyFixture();
    for (const deg of [74, 76, -18]) table.add(fixture.blendAt(deg));
    const lighting = light(s, { hour: 0, weather: CLEAR, sky: table });
    expect(lighting.sky?.hour).toBe(0);
    lighting.dispose();
  });

  it("sets the fog's density from its weather before the table holds a slice", () => {
    const s = scene();
    // Babylon's own default, which would fog a frame drawn before the sky.
    expect(s.fogDensity).toBe(0.1);
    const lighting = light(s, { hour: 12, sky: createSkyTable() });
    expect(lighting.sky).toBeNull();
    // The default weather's (mist's) density at this file's 70 m.
    expect(s.fogDensity).toBeCloseTo(0.29671172273182034, 12);
    lighting.dispose();
  });

  it("moves the fog's density with a weather set while the table waits", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, sky: createSkyTable() });
    lighting.setWeather(WEATHER_PRESETS.rain, 0);
    expect(lighting.sky).toBeNull();
    // Rain's density at this file's 70 m.
    expect(s.fogDensity).toBeCloseTo(0.2818761365952293, 12);
    lighting.dispose();
  });

  it("stops listening to the table when disposed", () => {
    const s = scene();
    const table = createSkyTable();
    const lighting = light(s, { hour: 12, sky: table });
    lighting.dispose();
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    table.add(fixture.blendAt(76));
    expect(dome.updates).toEqual([]);
  });
});

describe("weather in lighting", () => {
  it("defaults to the mist preset — fog, sun and exposure all shifted", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const w = WEATHER_PRESETS.mist;
    expect(lighting.weather).toEqual(w);
    expect(s.fogDensity).toBeCloseTo(fogDensityUnder(w, 70), 12);
    // SUN_PEAK x (1 - SUN_CLOUD_LOSS x 0.9).
    expect(sunOf(s).intensity).toBeCloseTo(0.76, 6);
    expect(s.imageProcessingConfiguration.exposure).toBeCloseTo(exposureUnder(w, sunPositionAt(12).y), 12);
    lighting.dispose();
  });

  it("explicit clear weather keeps the clear anchors exactly", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    expect(s.fogDensity).toBe(fogDensityFor(70));
    expect(s.imageProcessingConfiguration.exposure).toBe(exposureFor(sunPositionAt(12).y));
    expect(lighting.sky!.cloud).toBe(0);
    expect(sunOf(s).intensity).toBeCloseTo(4, 6);
    expect(fillOf(s).intensity).toBeCloseTo(0.15, 6);
    expect(s.imageProcessingConfiguration.colorCurves?.globalSaturation).toBe(0);
    lighting.dispose();
  });

  it("setWeather with fade 0 applies instantly; the dome follows", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    lighting.setWeather(CLEAR, 0);
    expect(lighting.weather).toEqual(CLEAR);
    expect(s.fogDensity).toBe(fogDensityFor(70));
    expect(dome.updates.at(-1)!.state.cloud).toBe(0);
    lighting.setWeather(WEATHER_PRESETS.rain, 0);
    expect(dome.updates.at(-1)!.state.cloud).toBe(1);
    expect(dome.updates.at(-1)!.exposure).toBe(s.imageProcessingConfiguration.exposure);
    lighting.dispose();
  });

  it("a timed fade does not jump: current weather is unchanged until a frame renders", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    lighting.setWeather(WEATHER_PRESETS.rain, 3);
    expect(lighting.weather).toEqual(CLEAR);
    lighting.dispose();
  });
});
