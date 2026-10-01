import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { createRain, RAIN_TEX_H, RAIN_TEX_W, rainStreakMap, type RainLamp } from "../../src/game/rain.js";
import { RainPlugin } from "../../src/game/rainPlugin.js";
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
