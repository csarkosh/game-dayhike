import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import {
  createHauntMist, HAUNT_MIST_ALPHA, HAUNT_MIST_BORN, HAUNT_MIST_BORN_CHASE, HAUNT_MIST_LEAVE, HAUNT_MIST_PUFFS, HAUNT_MIST_SEAT, HAUNT_MIST_SIZE, HAUNT_MIST_TALL, HAUNT_MIST_WIDE,
} from "../../src/game/hauntMist.js";

/** A small stream, so the births are the same every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe("the haunt's mist", () => {
  it("seats a dozen puffs on the ground round the eye while the haunt is on at night, each its own size, and none by day or with no haunt", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("player", new Vector3(10, 2, 5), scene);
    const ground = (x: number, z: number) => 0.1 * x - 0.05 * z;
    const mist = createHauntMist(scene, ground, lcg(7));
    const puffs = () => scene.meshes.filter((m) => m.name.startsWith("haunt_mist_"));
    expect(puffs().length).toBe(HAUNT_MIST_PUFFS);
    mist.update(camera, 1, 1, 0);
    mist.update(camera, 1, 1, 0.05);
    const sizes = new Set<number>();
    for (const p of puffs()) {
      expect(p.isEnabled()).toBe(true);
      const d = Math.hypot(p.position.x - 10, p.position.z - 5);
      expect(d).toBeGreaterThanOrEqual(HAUNT_MIST_BORN[0] - 0.1);
      expect(d).toBeLessThanOrEqual(HAUNT_MIST_BORN[1] + 0.1);
      const size = p.scaling.x / HAUNT_MIST_WIDE;
      expect(size).toBeGreaterThanOrEqual(HAUNT_MIST_SIZE[0] - 1e-9);
      expect(size).toBeLessThanOrEqual(HAUNT_MIST_SIZE[1] + 1e-9);
      // Wider than tall, seated low: the volume is on the ground.
      expect(p.scaling.y).toBeCloseTo(size * HAUNT_MIST_TALL, 9);
      expect(p.position.y).toBeCloseTo(ground(p.position.x, p.position.z) + size * HAUNT_MIST_TALL * HAUNT_MIST_SEAT, 9);
      expect(p.material!.alpha).toBe(HAUNT_MIST_ALPHA);
      expect(p.visibility).toBeGreaterThan(0);
      expect(p.visibility).toBeLessThanOrEqual(1);
      sizes.add(p.scaling.x);
    }
    expect(sizes.size).toBeGreaterThan(HAUNT_MIST_PUFFS / 2);
    // They drift: a second on, no puff is where it was.
    const before = puffs().map((p) => p.position.x);
    for (let t = 0.1; t <= 1; t += 0.05) mist.update(camera, 1, 1, t);
    const moved = puffs().filter((p, i) => p.position.x !== before[i]).length;
    expect(moved).toBeGreaterThan(HAUNT_MIST_PUFFS / 2);
    // Left behind: the eye walks on, and every puff is reborn within reach of it.
    camera.position.set(10 + HAUNT_MIST_LEAVE + 20, 2, 5);
    mist.update(camera, 1, 1, 1.05);
    for (const p of puffs()) expect(Math.hypot(p.position.x - camera.position.x, p.position.z - 5)).toBeLessThanOrEqual(HAUNT_MIST_BORN[1] + 0.1);
    // In the chase the puffs are born nearer and larger, and more opaque.
    const sizeBefore = puffs().map((p) => p.scaling.x);
    camera.position.set(camera.position.x + HAUNT_MIST_LEAVE + 20, 2, 5);
    mist.update(camera, 1, 1, 1.1, 1);
    for (const p of puffs()) {
      const d = Math.hypot(p.position.x - camera.position.x, p.position.z - 5);
      expect(d).toBeLessThanOrEqual(HAUNT_MIST_BORN_CHASE[1] + 0.1);
    }
    expect(Math.max(...puffs().map((p) => p.scaling.x))).toBeGreaterThan(Math.max(...sizeBefore) * 1.1);
    // By day, nothing, whatever the haunt; with no haunt, nothing, whatever the night.
    mist.update(camera, 1, 0, 2);
    expect(puffs().every((p) => !p.isEnabled())).toBe(true);
    mist.update(camera, 0, 1, 3);
    expect(puffs().every((p) => !p.isEnabled())).toBe(true);
    mist.dispose();
    expect(puffs().length).toBe(0);
    scene.dispose();
    engine.dispose();
  });
});
