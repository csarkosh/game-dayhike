import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import {
  createNearMist, nearMistDensity, NEAR_MIST_ALPHA, NEAR_MIST_BORN, NEAR_MIST_CHASE_DENSITY, NEAR_MIST_CROSS_M, NEAR_MIST_LEAVE,
  NEAR_MIST_NIGHT_DENSITY, NEAR_MIST_PUFFS, NEAR_MIST_RISE, NEAR_MIST_SIZE,
} from "../../src/game/nearMist.js";
import { HAUNT_MIST_GREY } from "../../src/game/hauntMist.js";

/** A small stream, so the births are the same every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe("the near mist", () => {
  it("is the night's density, lifted by the haunt, the chase's by its cast, and nothing by day", () => {
    expect(nearMistDensity(0, 1, 1)).toBe(0);
    expect(nearMistDensity(1, 0, 0)).toBeCloseTo(NEAR_MIST_NIGHT_DENSITY, 9);
    expect(nearMistDensity(1, 1, 0)).toBeGreaterThan(NEAR_MIST_NIGHT_DENSITY);
    expect(nearMistDensity(1, 1, 0)).toBeLessThan(NEAR_MIST_CHASE_DENSITY);
    expect(nearMistDensity(1, 0, 1)).toBeCloseTo(NEAR_MIST_CHASE_DENSITY, 9);
    expect(nearMistDensity(0.5, 0, 0)).toBeCloseTo(NEAR_MIST_NIGHT_DENSITY * 0.5, 9);
  });

  it("stands its puffs round and ahead of the eye, fades one crossing it, reborn ahead once behind, and holds a density from the console", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("player", new Vector3(10, 2, 5), scene);
    camera.setTarget(new Vector3(10, 2, 50));
    camera.getViewMatrix(true);
    const mist = createNearMist(scene, lcg(3));
    const puffs = () => scene.meshes.filter((m) => m.name.startsWith("near_mist_"));
    expect(puffs().length).toBe(NEAR_MIST_PUFFS);
    mist.update(camera, 1, 0, 0, 0);
    mist.update(camera, 1, 0, 0, 0.05);
    expect(mist.density()).toBeCloseTo(NEAR_MIST_NIGHT_DENSITY, 9);
    let ahead = 0;
    for (const p of puffs()) {
      expect(p.isEnabled()).toBe(true);
      const d = Math.hypot(p.position.x - 10, p.position.z - 5);
      expect(d).toBeGreaterThanOrEqual(NEAR_MIST_BORN[0] - 0.1);
      expect(d).toBeLessThanOrEqual(NEAR_MIST_BORN[1] + 0.1);
      expect(Math.abs(p.position.y - 2)).toBeLessThanOrEqual(NEAR_MIST_RISE + 0.1);
      expect(p.scaling.x).toBeGreaterThanOrEqual(NEAR_MIST_SIZE[0] - 1e-9);
      expect(p.scaling.x).toBeLessThanOrEqual(NEAR_MIST_SIZE[1] + 1e-9);
      expect(p.material!.alpha).toBe(NEAR_MIST_ALPHA);
      expect((p.material as StandardMaterial).fogEnabled).toBe(false);
      expect((p.material as StandardMaterial).emissiveColor.toHexString().toLowerCase()).toBe(HAUNT_MIST_GREY);
      if (p.position.z > 5) ahead++;
    }
    // Born ahead of the eye, to be walked into.
    expect(ahead).toBe(NEAR_MIST_PUFFS);
    // Walked through: the eye steps to a puff, and that puff fades as it crosses rather than pops.
    const first = puffs()[0]!;
    camera.position.set(first.position.x, 2, first.position.z);
    mist.update(camera, 1, 0, 0, 0.1);
    expect(first.visibility).toBeLessThan(0.05);
    // Past it: it is behind the eye beyond its crossing, so it is reborn ahead.
    camera.position.set(first.position.x, 2, first.position.z + NEAR_MIST_CROSS_M + 0.5);
    mist.update(camera, 1, 0, 0, 0.15);
    expect(first.position.z).toBeGreaterThan(camera.position.z - NEAR_MIST_CROSS_M);
    // Left behind: the eye walks on, and every puff is reborn within reach of it.
    camera.position.set(10, 2, 5 + NEAR_MIST_LEAVE + 20);
    mist.update(camera, 1, 0, 0, 0.2);
    for (const p of puffs()) expect(Math.hypot(p.position.x - 10, p.position.z - camera.position.z)).toBeLessThanOrEqual(NEAR_MIST_BORN[1] + 0.1);
    // Held from the console, the density is the held one whatever the night; let go, the night's again.
    mist.hold(1);
    mist.update(camera, 0.2, 0, 0, 0.25);
    expect(mist.density()).toBe(1);
    expect(puffs().every((p) => p.isEnabled())).toBe(true);
    mist.hold(null);
    mist.update(camera, 0.2, 0, 0, 0.3);
    expect(mist.density()).toBeCloseTo(NEAR_MIST_NIGHT_DENSITY * 0.2, 9);
    // By day, nothing.
    mist.update(camera, 0, 1, 1, 0.35);
    expect(puffs().every((p) => !p.isEnabled())).toBe(true);
    mist.dispose();
    expect(puffs().length).toBe(0);
    scene.dispose();
  });
});
