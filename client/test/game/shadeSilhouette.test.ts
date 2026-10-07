import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { createShadeSilhouette, MAIN_LAYER, SHADE_LAYER, SHADE_MASK_RATIO } from "../../src/game/shadeSilhouette.js";

function figure(scene: Scene, name: string): TransformNode {
  const node = new TransformNode(name, scene);
  const a = MeshBuilder.CreateBox(`${name}_a`, { size: 1 }, scene);
  const b = MeshBuilder.CreateBox(`${name}_b`, { size: 1 }, scene);
  a.parent = node;
  b.parent = node;
  return node;
}

describe("the shade mask", () => {
  it("is a render target on a camera that sees the shade layer alone, cleared to nothing, and follows the player's camera", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("player", new Vector3(3, 2, -4), scene);
    camera.rotation.set(0.1, 0.7, 0);
    camera.fov = 1.4;
    const mask = createShadeSilhouette(scene, camera);
    expect(scene.customRenderTargets).toContain(mask.texture);
    expect(mask.texture.activeCamera?.layerMask).toBe(SHADE_LAYER);
    expect(SHADE_LAYER & MAIN_LAYER).toBe(0);
    expect(mask.texture.clearColor.a).toBe(0);
    expect(mask.texture.renderList?.length).toBe(0);
    expect(SHADE_MASK_RATIO).toBeLessThanOrEqual(0.5);
    // The mask's camera copies the player's as the target renders.
    mask.texture.onBeforeRenderObservable.notifyObservers(0);
    const cam = mask.texture.activeCamera as UniversalCamera;
    expect(cam.position.equals(camera.position)).toBe(true);
    expect(cam.rotation.equals(camera.rotation)).toBe(true);
    expect(cam.fov).toBe(1.4);
    expect(mask.any()).toBe(false);
    mask.dispose();
    expect(scene.customRenderTargets).not.toContain(mask.texture);
    scene.dispose();
    engine.dispose();
  });

  it("writes a going shade's `gone` into its mask material's green, beside the softness in red", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
    const mask = createShadeSilhouette(scene, camera);
    const node = new TransformNode("shade", scene);
    const mesh = MeshBuilder.CreateBox("body", { size: 1 }, scene);
    mesh.parent = node;
    mask.sync([{ node, fade: 1, soft: 1, near: 1, gone: 0.6 }]);
    const material = scene.materials.find((m) => m.name.startsWith("mat_shade_mask_")) as StandardMaterial | undefined;
    expect(material).toBeDefined();
    expect(material!.emissiveColor.r).toBe(1);
    expect(material!.emissiveColor.g).toBeCloseTo(0.6, 12);
    mask.dispose();
    scene.dispose();
  });

  it("puts a soft shade's meshes in the list on the shade layer, gives each pass its share of the visibility, and lets a resolving one onto both layers and a gone one out", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
    const mask = createShadeSilhouette(scene, camera);
    const soft = figure(scene, "shade");
    const meshes = soft.getChildMeshes(false);
    mask.sync([{ node: soft, fade: 0.5, soft: 1, near: 1, gone: 0 }]);
    expect(mask.texture.renderList?.length).toBe(meshes.length);
    for (const m of meshes) expect(mask.texture.renderList).toContain(m);
    for (const m of meshes) {
      expect(m.layerMask).toBe(SHADE_LAYER);
      expect(m.visibility).toBe(0);
    }
    expect(mask.any()).toBe(true);
    // As the mask renders, the meshes carry fade × softness; after, fade × (1 − softness).
    mask.texture.onBeforeRenderObservable.notifyObservers(0);
    for (const m of meshes) expect(m.visibility).toBeCloseTo(0.5, 12);
    mask.texture.onAfterRenderObservable.notifyObservers(0);
    for (const m of meshes) expect(m.visibility).toBe(0);
    // Resolving: on both layers, the frame's share rising.
    mask.sync([{ node: soft, fade: 1, soft: 0.25, near: 1, gone: 0 }]);
    for (const m of meshes) {
      expect(m.layerMask).toBe(SHADE_LAYER | MAIN_LAYER);
      expect(m.visibility).toBeCloseTo(0.75, 12);
    }
    mask.texture.onBeforeRenderObservable.notifyObservers(0);
    for (const m of meshes) expect(m.visibility).toBeCloseTo(0.25, 12);
    mask.texture.onAfterRenderObservable.notifyObservers(0);
    // Resolved: nothing in the mask.
    mask.sync([{ node: soft, fade: 1, soft: 0, near: 1, gone: 0 }]);
    expect(mask.any()).toBe(false);
    // A far figure is fainter in the mask: its share there is scaled by `near`.
    mask.sync([{ node: soft, fade: 1, soft: 1, near: 0.4, gone: 0 }]);
    mask.texture.onBeforeRenderObservable.notifyObservers(0);
    for (const m of meshes) expect(m.visibility).toBeCloseTo(0.4, 12);
    mask.texture.onAfterRenderObservable.notifyObservers(0);
    // Gone: out of the list, back on the main layer, whole.
    mask.sync([]);
    expect(mask.texture.renderList?.length).toBe(0);
    for (const m of meshes) {
      expect(m.layerMask).toBe(MAIN_LAYER);
      expect(m.visibility).toBe(1);
    }
    mask.dispose();
    scene.dispose();
    engine.dispose();
  });
});
