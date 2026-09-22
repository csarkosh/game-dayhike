import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { createBodyMesh } from "../../src/game/bodyMesh.js";

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

describe("createBodyMesh", () => {
  it("stands at the body's place, facing its yaw, with three parts", () => {
    const body = { pos: { x: 4, y: 1.1, z: -7 }, yaw: 0.6 };
    const { node, dispose } = createBodyMesh(scene, body);
    expect(node.position.asArray()).toEqual([4, 1.1, -7]);
    expect(node.rotation.y).toBe(0.6);
    const children = node.getChildMeshes();
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.material).toBeInstanceOf(StandardMaterial);
    }
    dispose();
    expect(node.isDisposed()).toBe(true);
  });
});
