import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { createMistMeshes, MIST_CAP_BY_TIER, MIST_DRIFT } from "../../src/game/mistMeshes.js";
import { collectMistBanks, MIST_CELL } from "../../src/game/mistField.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";
// Terrain variants register via import side effects (see mistField.test.ts);
// collectMistBanks needs one active before it can sample elevation.
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";

setActiveTerrainVariant("olympic");

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});
function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

const SEED = 1;
const STILL = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);

function coastalOrigin(): { x: number; z: number } {
  for (let x = -350; x <= -100; x += 50) {
    for (let z = -400; z <= 400; z += 100) {
      if (collectMistBanks(SEED, x, z).length > 0) return { x, z };
    }
  }
  throw new Error("no banks on the coastal strip");
}

describe("createMistMeshes", () => {
  it("creates MIST_CAP_BY_TIER[tier] disabled quads that never pick or cast", () => {
    const s = scene();
    const mist = createMistMeshes(s, SEED, "high");
    expect(mist.meshes.length).toBe(MIST_CAP_BY_TIER.high);
    for (const m of mist.meshes) {
      expect(m.isEnabled()).toBe(false);
      expect(m.isPickable).toBe(false);
      expect(m.billboardMode).toBe(Mesh.BILLBOARDMODE_Y);
    }
    mist.dispose();
  });

  it("creates fewer quads on the low tier", () => {
    const s = scene();
    const mist = createMistMeshes(s, SEED, "low");
    expect(mist.meshes.length).toBe(MIST_CAP_BY_TIER.low);
    expect(mist.meshes.length).toBe(6);
    mist.dispose();
  });

  it("clear weather keeps everything disabled even over banks", () => {
    const s = scene();
    const mist = createMistMeshes(s, SEED, "high");
    const { x, z } = coastalOrigin();
    mist.update(x, z, WEATHER_PRESETS.clear, { r: 0.5, g: 0.5, b: 0.5 }, STILL, 0);
    for (const m of mist.meshes) expect(m.isEnabled()).toBe(false);
    mist.dispose();
  });

  it("mist weather positions quads on the collected banks with bounded visibility", () => {
    const s = scene();
    const mist = createMistMeshes(s, SEED, "high");
    const { x, z } = coastalOrigin();
    mist.update(x, z, WEATHER_PRESETS.mist, { r: 0.5, g: 0.5, b: 0.5 }, STILL, 0);
    const banks = collectMistBanks(SEED, x, z);
    const enabled = mist.meshes.filter((m) => m.isEnabled());
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.length).toBeLessThanOrEqual(banks.length);
    for (const m of enabled) {
      expect(m.visibility).toBeGreaterThan(0);
      expect(m.visibility).toBeLessThanOrEqual(0.55);
      const match = banks.find((b) => b.x === m.position.x && b.z === m.position.z);
      expect(match).toBeDefined();
    }
    mist.dispose();
  });

  it("colours the banks from the air colour it is handed", () => {
    const mist = createMistMeshes(scene(), 1, "high");
    mist.update(0, 0, WEATHER_PRESETS.mist, { r: 0.2, g: 0.4, b: 0.6 }, STILL, 0);
    const mat = mist.meshes[0]?.material as StandardMaterial;
    expect(mat.emissiveColor.r).toBeCloseTo(0.2, 6);
    expect(mat.emissiveColor.b).toBeCloseTo(0.6, 6);
    mist.dispose();
  });

  it("banks drift downwind by MIST_DRIFT·speed·t and wrap inside their cell", () => {
    const s = scene();
    const mist = createMistMeshes(s, SEED, "high");
    const { x, z } = coastalOrigin();
    const wind = { ...windRecordUnder(WEATHER_PRESETS.mist, 0, 1), dirX: 1, dirZ: 0 };
    mist.update(x, z, WEATHER_PRESETS.mist, { r: 0.5, g: 0.5, b: 0.5 }, wind, 0);
    const before = mist.meshes
      .filter((m) => m.isEnabled())
      .map((m) => ({ mesh: m, x0: m.position.x, z0: m.position.z }));
    expect(before.length).toBeGreaterThan(0);

    mist.update(x, z, WEATHER_PRESETS.mist, { r: 0.5, g: 0.5, b: 0.5 }, wind, 10);
    for (const { mesh, x0, z0 } of before) {
      expect(mesh.isEnabled()).toBe(true);
      expect(mesh.position.x - x0).toBeCloseTo(MIST_DRIFT * wind.speed * 10, 6);
      expect(mesh.position.z).toBeCloseTo(z0, 6);
      expect(Math.abs(mesh.position.x - x0)).toBeLessThanOrEqual(MIST_CELL / 2);
    }
    mist.dispose();
  });
});
