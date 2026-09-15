import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { createSignMeshes, armYaw } from "../../src/game/signMeshes.js";

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

describe("signMeshes", () => {
  it("turns an arm's unit direction into the yaw the sim convention uses (0 faces +z, PI/2 faces +x)", () => {
    expect(armYaw({ dx: 0, dz: 1 })).toBeCloseTo(0, 9);
    expect(armYaw({ dx: 1, dz: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(armYaw({ dx: -1, dz: 0 })).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("builds one arm per branch at the post, and one board, all disposable", () => {
    const before = scene.meshes.length;
    const signs = createSignMeshes(
      scene,
      [{ x: 100, z: 0, arms: [{ dx: 1, dz: 0, names: ["the summit"] }, { dx: -1, dz: 0, names: ["Trailhead"] }] }],
      { x: 5, z: 7, facing: { dx: 0, dz: -1 }, lines: ["Dana Whitcombe — last seen at the summit"] },
      () => 1.8,
      // A NullEngine has no canvas to paint on; the painter is the one part
      // of this that needs a browser.
      (s, name) => new PBRMaterial(name, s),
    );
    expect(scene.meshes.length - before).toBe(3);
    const arm = scene.getMeshByName("sign_0_arm_0")!;
    expect(arm.position.x).toBeGreaterThan(100);
    expect(arm.position.y).toBeCloseTo(1.8 + 1.8, 6);
    signs.dispose();
    expect(scene.meshes.length).toBe(before);
  });
});
