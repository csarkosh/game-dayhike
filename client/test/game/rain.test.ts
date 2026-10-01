import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { createRain, RAIN_TEX_H, RAIN_TEX_W, rainStreakMap, type RainLamp } from "../../src/game/rain.js";
import { RainPlugin } from "../../src/game/rainPlugin.js";
import { createRainMap, type RainMap } from "../../src/game/rainMap.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";

const STILL = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);
const CAM = { x: 10, y: 5, z: -20 };
const LAMP_OFF: RainLamp = { x: 10, y: 5, z: -20, dx: 0, dy: 0, dz: 1, intensity: 0, angle: 1.5, r: 1, g: 0.9, b: 0.8 };
const LAMP_ON: RainLamp = { ...LAMP_OFF, intensity: 400 };
const DT = 1 / 60;

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });
function scene(): Scene { engine = new NullEngine(); return new Scene(engine); }

describe("rainStreakMap", () => {
  it("is a 4 by 16 white streak whose alpha peaks mid-column and dies at the ends and edges", () => {
    const data = rainStreakMap();
    expect(data.length).toBe(RAIN_TEX_W * RAIN_TEX_H * 4);
    expect(data.length).toBe(256);
    const alpha = (x: number, y: number) => data[(y * 4 + x) * 4 + 3] as number;
    expect(alpha(1, 8)).toBeGreaterThan(alpha(1, 0));
    expect(alpha(1, 8)).toBeGreaterThan(alpha(0, 8));
    expect(alpha(1, 0)).toBeLessThan(40);
    expect(Math.max(alpha(1, 7), alpha(1, 8))).toBeGreaterThan(180);
    for (let i = 0; i < 64; i++) expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]).toEqual([255, 255, 255]);
  });
});

describe("createRain", () => {
  it("builds one thin-instanced quad per streak of the tier, disabled, with the plugin attached once", () => {
    const s = scene();
    const rain = createRain(s, "medium");
    expect(rain.mesh.name).toBe("rain_streaks");
    expect(rain.mesh.thinInstanceCount).toBe(10000);
    expect(rain.mesh.isEnabled()).toBe(false);
    expect(rain.mesh.isPickable).toBe(false);
    expect(rain.mesh.receiveShadows).toBe(false);
    expect(rain.mesh.alwaysSelectAsActiveMesh).toBe(true);
    expect(rain.mesh.doNotSyncBoundingInfo).toBe(true);
    // Unsynced bounds sort it by the world origin otherwise: last in its group.
    expect(rain.mesh.alphaIndex).toBe(Number.MAX_SAFE_INTEGER);
    expect(rain.plugin).toBeInstanceOf(RainPlugin);
    const mat = rain.mesh.material as StandardMaterial;
    expect(mat.name).toBe("mat_rain");
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof RainPlugin)).toHaveLength(1);
    expect(mat.pluginManager?.getPlugin("Rain")).toBe(rain.plugin);
    rain.dispose();
  });

  it("is unlit, alpha-blended from the streak map, depth-tested but not written, two-sided and fogged", () => {
    const s = scene();
    const rain = createRain(s, "low");
    const mat = rain.mesh.material as StandardMaterial;
    expect(mat.disableLighting).toBe(true);
    // Black diffuse: unlit, the colour is the diffuse plus the emissive, so
    // the emissive set each frame is the colour only with the diffuse black.
    expect([mat.diffuseColor.r, mat.diffuseColor.g, mat.diffuseColor.b]).toEqual([0, 0, 0]);
    expect(mat.diffuseTexture?.hasAlpha).toBe(true);
    expect(mat.useAlphaFromDiffuseTexture).toBe(true);
    expect(mat.needAlphaBlending()).toBe(true);
    expect(mat.needAlphaTesting()).toBe(false);
    expect(mat.backFaceCulling).toBe(false);
    expect(mat.disableDepthWrite).toBe(true);
    expect(mat.fogEnabled).toBe(true);
    rain.dispose();
  });

  it("is disabled at clear, enabled at rain with the tier's count, and scales the count with the rain value", () => {
    const s = scene();
    const rain = createRain(s, "high");
    rain.update(CAM, 0, WEATHER_PRESETS.clear, STILL, DT, LAMP_OFF);
    expect(rain.mesh.isEnabled()).toBe(false);
    rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF);
    expect(rain.mesh.isEnabled()).toBe(true);
    expect(rain.mesh.thinInstanceCount).toBe(24000);
    rain.update(CAM, 0, { ...WEATHER_PRESETS.rain, rain: 0.25 }, STILL, DT, LAMP_OFF);
    expect(rain.mesh.isEnabled()).toBe(true);
    expect(rain.mesh.thinInstanceCount).toBe(6000);
    rain.update(CAM, 0, WEATHER_PRESETS.clear, STILL, DT, LAMP_OFF);
    expect(rain.mesh.isEnabled()).toBe(false);
    rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF);
    expect(rain.mesh.isEnabled()).toBe(true);
    expect(rain.mesh.thinInstanceCount).toBe(24000);
    rain.dispose();
  });

  it("hands the plugin the box, the eye, the wind's slant, the lamp and the fog's milk", () => {
    const s = scene();
    s.fogColor.set(0.5, 0.5, 0.5);
    const rain = createRain(s, "high");
    const wind = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 0, dirZ: 1 };
    rain.update(CAM, 0, WEATHER_PRESETS.rain, wind, DT, LAMP_ON);
    const p = rain.plugin;
    // Yaw 0 faces +Z: 6 m ahead, 2 m down, the box's half-size off each axis.
    expect([p.boxMinX, p.boxMinY, p.boxMinZ]).toEqual([-2, -7, -26]);
    expect([p.camX, p.camY, p.camZ]).toEqual([10, 5, -20]);
    expect(p.windX).toBe(0);
    expect(p.windZ).toBeCloseTo(3 * wind.speed, 9);
    expect([p.lampX, p.lampY, p.lampZ]).toEqual([10, 5, -20]);
    expect([p.lampDirX, p.lampDirY, p.lampDirZ]).toEqual([0, 0, 1]);
    // 400 light units at the gain of 0.005 is 2; the cone's edge is cos(0.75).
    expect(p.lampIntensity).toBeCloseTo(2, 9);
    expect(p.lampCosHalf).toBeCloseTo(Math.cos(0.75), 9);
    expect([p.lampR, p.lampG, p.lampB]).toEqual([1, 0.9, 0.8]);
    const mat = rain.mesh.material as StandardMaterial;
    expect(mat.emissiveColor.r).toBeCloseTo(0.625, 9);
    expect(mat.emissiveColor.g).toBeCloseTo(0.625, 9);
    expect(mat.emissiveColor.b).toBeCloseTo(0.625, 9);
    rain.update(CAM, 0, WEATHER_PRESETS.rain, wind, DT, LAMP_OFF);
    expect(p.lampIntensity).toBe(0);
    rain.dispose();
  });

  it("folds the time at 40 s, steps the drift with the wind, and smooths the frame", () => {
    const s = scene();
    const rain = createRain(s, "low");
    const wind = { ...windRecordUnder(WEATHER_PRESETS.rain, 0, 1), dirX: 1, dirZ: 0 };
    for (let i = 0; i < 41; i++) rain.update(CAM, 0, WEATHER_PRESETS.rain, wind, 1, LAMP_OFF);
    const p = rain.plugin;
    expect(p.fold).toBe(1);
    // 41 s of 3 m/s along X is 123 m, 5.125 boxes: an eighth of a box over.
    expect(p.driftX).toBeCloseTo(0.125, 6);
    expect(p.driftZ).toBe(0);
    // A one-second frame reads as a thirtieth once smoothed.
    expect(p.dt).toBeCloseTo(1 / 30, 3);
    // The clocks step through clear too, so the rain resumes where it would have been.
    rain.update(CAM, 0, WEATHER_PRESETS.clear, wind, 1, LAMP_OFF);
    rain.update(CAM, 0, WEATHER_PRESETS.rain, wind, 0, LAMP_OFF);
    expect(p.fold).toBe(2);
    rain.dispose();
  });

  it("turns the box with the camera", () => {
    const s = scene();
    const rain = createRain(s, "low");
    rain.update(CAM, Math.PI / 2, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF);
    expect(rain.plugin.boxMinX).toBeCloseTo(4, 9);
    expect(rain.plugin.boxMinZ).toBeCloseTo(-32, 9);
    rain.dispose();
  });

  it("setMap hands the plugin the cover map and its centre and turns RAIN_OCCLUSION on; null turns it off", () => {
    const s = scene();
    const map = createRainMap(s, "high") as RainMap;
    const rain = createRain(s, "high");
    const defines = (): Record<string, boolean> => {
      const d: Record<string, boolean> = { RAIN: false, RAIN_DRIP: false, RAIN_OCCLUSION: false };
      rain.plugin.prepareDefines(d as never, s, undefined as never);
      return d;
    };
    expect(defines()).toEqual({ RAIN: true, RAIN_DRIP: false, RAIN_OCCLUSION: false });
    expect(rain.plugin.map).toBeNull();
    rain.setMap(map);
    expect(rain.plugin.map).toBe(map.texture);
    expect(defines()).toEqual({ RAIN: true, RAIN_DRIP: false, RAIN_OCCLUSION: true });
    map.update({ x: 10, y: 5, z: -20 });
    rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF);
    expect([rain.plugin.mapCentreX, rain.plugin.mapCentreZ]).toEqual([10, -20]);
    map.update({ x: 30, y: 5, z: -20 });
    rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_OFF);
    expect([rain.plugin.mapCentreX, rain.plugin.mapCentreZ]).toEqual([30, -20]);
    rain.setMap(null);
    expect(rain.plugin.map).toBeNull();
    expect(defines()).toEqual({ RAIN: true, RAIN_DRIP: false, RAIN_OCCLUSION: false });
    rain.dispose();
    map.dispose();
  });

  it("dispose takes the mesh, the material and the texture out of the scene", () => {
    const s = scene();
    const rain = createRain(s, "low");
    const mat = rain.mesh.material as StandardMaterial;
    const tex = mat.diffuseTexture!;
    expect(s.materials).toContain(mat);
    expect(s.textures).toContain(tex);
    rain.dispose();
    expect(rain.mesh.isDisposed()).toBe(true);
    expect(s.materials).not.toContain(mat);
    expect(s.textures).not.toContain(tex);
  });
});

describe("the drips", () => {
  it("are a second volume on medium and high, none on low, on their own material over the streak texture with their own plugin under RAIN_DRIP in the shorter box", () => {
    const s = scene();
    const low = createRain(s, "low");
    expect(low.drips).toBeNull();
    expect(low.dripPlugin).toBeNull();
    low.dispose();
    for (const [tier, count] of [["medium", 600], ["high", 1000]] as const) {
      const rain = createRain(s, tier);
      const drips = rain.drips!;
      expect(drips.name).toBe("rain_drips");
      expect(drips.thinInstanceCount).toBe(count);
      expect(drips.isEnabled()).toBe(false);
      expect(drips.isPickable).toBe(false);
      expect(drips.alwaysSelectAsActiveMesh).toBe(true);
      expect(drips.doNotSyncBoundingInfo).toBe(true);
      expect(drips.alphaIndex).toBe(Number.MAX_SAFE_INTEGER);
      const mat = drips.material as StandardMaterial;
      expect(mat.name).toBe("mat_rain_drips");
      expect(mat).not.toBe(rain.mesh.material);
      expect(mat.diffuseTexture).toBe((rain.mesh.material as StandardMaterial).diffuseTexture);
      expect(mat.needAlphaBlending()).toBe(true);
      expect(mat.fogEnabled).toBe(true);
      const plugin = rain.dripPlugin!;
      expect(plugin).toBeInstanceOf(RainPlugin);
      expect(plugin).not.toBe(rain.plugin);
      expect(mat.pluginManager?.getPlugin("Rain")).toBe(plugin);
      expect(plugin.drip).toBe(true);
      expect(rain.plugin.drip).toBe(false);
      expect([plugin.boxX, plugin.boxY, plugin.boxZ]).toEqual([24, 12, 24]);
      expect([rain.plugin.boxX, rain.plugin.boxY, rain.plugin.boxZ]).toEqual([24, 20, 24]);
      const d: Record<string, boolean> = { RAIN: false, RAIN_DRIP: false, RAIN_OCCLUSION: false };
      plugin.prepareDefines(d as never, s, undefined as never);
      expect(d).toEqual({ RAIN: true, RAIN_DRIP: true, RAIN_OCCLUSION: false });
      rain.dispose();
      expect(drips.isDisposed()).toBe(true);
      expect(s.materials).not.toContain(mat);
    }
  });

  it("follow the canopy's water: none until the rain has filled it, a minute in on high, and still dripping ten minutes after it stops", () => {
    const s = scene();
    const map = createRainMap(s, "high") as RainMap;
    const rain = createRain(s, "high");
    rain.setMap(map);
    map.update(CAM);
    const drips = rain.drips!;
    expect(rain.canopyWater).toBe(0);
    rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, 1, LAMP_OFF);
    // One second of rain 1: a sixtieth, 17 of 1,000.
    expect(rain.canopyWater).toBeCloseTo(1 / 60, 9);
    expect(drips.isEnabled()).toBe(true);
    expect(drips.thinInstanceCount).toBe(17);
    expect(rain.dripPlugin!.canopyWater).toBeCloseTo(1 / 60, 9);
    for (let i = 0; i < 59; i++) rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, 1, LAMP_OFF);
    expect(rain.canopyWater).toBeCloseTo(1, 9);
    expect(drips.thinInstanceCount).toBe(1000);
    // The rain stops: the streaks go, the drips stay and drain over ten minutes.
    rain.update(CAM, 0, WEATHER_PRESETS.clear, STILL, 1, LAMP_OFF);
    expect(rain.mesh.isEnabled()).toBe(false);
    expect(drips.isEnabled()).toBe(true);
    for (let i = 0; i < 299; i++) rain.update(CAM, 0, WEATHER_PRESETS.clear, STILL, 1, LAMP_OFF);
    expect(rain.canopyWater).toBeCloseTo(0.5, 9);
    expect(drips.thinInstanceCount).toBe(500);
    for (let i = 0; i < 300; i++) rain.update(CAM, 0, WEATHER_PRESETS.clear, STILL, 1, LAMP_OFF);
    expect(rain.canopyWater).toBeCloseTo(0, 9);
    expect(drips.isEnabled()).toBe(false);
    rain.dispose();
    map.dispose();
  });

  it("take the drip box, the eye, the lamp, the map and the milk with the streaks, and stay off without a map", () => {
    const s = scene();
    s.fogColor.set(0.5, 0.5, 0.5);
    const rain = createRain(s, "high");
    const drips = rain.drips!;
    for (let i = 0; i < 60; i++) rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, 1, LAMP_ON);
    expect(rain.canopyWater).toBeCloseTo(1, 9);
    // No map to fall under: full of water, still off.
    expect(drips.isEnabled()).toBe(false);
    const map = createRainMap(s, "high") as RainMap;
    rain.setMap(map);
    map.update({ x: 30, y: 5, z: -20 });
    rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_ON);
    expect(drips.isEnabled()).toBe(true);
    const p = rain.dripPlugin!;
    // Yaw 0 faces +Z: 6 m ahead, 2 m down, half the 24 by 12 by 24 m box off each axis.
    expect([p.boxMinX, p.boxMinY, p.boxMinZ]).toEqual([-2, -3, -26]);
    expect([rain.plugin.boxMinX, rain.plugin.boxMinY, rain.plugin.boxMinZ]).toEqual([-2, -7, -26]);
    expect([p.camX, p.camY, p.camZ]).toEqual([10, 5, -20]);
    expect(p.lampIntensity).toBeCloseTo(2, 9);
    expect(p.map).toBe(map.texture);
    expect(p.occlusion).toBe(true);
    expect([p.mapCentreX, p.mapCentreZ]).toEqual([30, -20]);
    expect(p.fold).toBe(rain.plugin.fold);
    const mat = drips.material as StandardMaterial;
    expect(mat.emissiveColor.r).toBeCloseTo(0.625, 9);
    rain.setMap(null);
    expect(p.map).toBeNull();
    expect(p.occlusion).toBe(false);
    rain.update(CAM, 0, WEATHER_PRESETS.rain, STILL, DT, LAMP_ON);
    expect(drips.isEnabled()).toBe(false);
    rain.dispose();
    map.dispose();
  });
});
