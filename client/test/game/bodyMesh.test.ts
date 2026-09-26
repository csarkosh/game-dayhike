import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Node } from "@babylonjs/core/node.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { createBodyMesh } from "../../src/game/bodyMesh.js";

registerBuiltInLoaders();

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});
function freshScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

/** The shipped GLB, read from disk, held until `release` is called. */
function gatedLoader(scene: Scene) {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  return {
    loader: async (output: string): Promise<AssetContainer> => {
      await gate;
      const bytes = readFileSync(new URL(`../../assets/${output}`, import.meta.url));
      return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
    },
    release: () => open(),
  };
}

function descendantNamed(root: Node, name: string): Node {
  const found = root.getDescendants(false).find((n) => n.name === name);
  if (found === undefined) throw new Error(`no ${name} under ${root.name}`);
  return found;
}

const BODY = { pos: { x: 4, y: 1.1, z: -7 }, yaw: 0.6 };

describe("createBodyMesh", () => {
  it("stands a three-part placeholder at the body's place until the model arrives, then the model", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const shadowed = new Set<AbstractMesh>();
    const body = createBodyMesh(scene, BODY, {
      loader: gate.loader,
      shadows: { add: (m) => shadowed.add(m), remove: (m) => shadowed.delete(m) },
    });
    expect(body.node.position.asArray()).toEqual([4, 1.1, -7]);
    expect(body.node.rotation.y).toBe(0.6);
    const placeholder = body.node.getChildMeshes();
    expect(placeholder).toHaveLength(3);
    for (const child of placeholder) expect(child.material).toBeInstanceOf(StandardMaterial);

    gate.release();
    await body.ready;

    expect(body.node.getChildMeshes()).toHaveLength(0);
    for (const child of placeholder) expect(child.isDisposed()).toBe(true);
    const model = scene.getTransformNodeByName("body_0_model") ?? scene.transformNodes.find((n) => n.name.endsWith("_model"))!;
    expect(model.position.asArray()).toEqual([4, 1.1, -7]);
    expect(model.rotation.y).toBe(0.6);
    expect(descendantNamed(model, "LOD0").isEnabled(false)).toBe(true);
    expect(descendantNamed(model, "LOD1").isEnabled(false)).toBe(false);
    expect(descendantNamed(model, "LOD2").isEnabled(false)).toBe(false);
    const lod0 = descendantNamed(model, "LOD0").getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    expect(lod0).toHaveLength(2);
    expect([...shadowed].sort((a, b) => a.uniqueId - b.uniqueId)).toEqual(lod0.sort((a, b) => a.uniqueId - b.uniqueId));

    // The hiker hangs on the front of the pole: turned by yaw 0.6, the model's
    // +z points along (sin 0.6, cos 0.6), and the figure's bulk lies that way.
    const figure = lod0.map((m) => m.getBoundingInfo().boundingBox.centerWorld).reduce((a, c) => (a.y > c.y ? a : c));
    const ahead = (figure.x - 4) * Math.sin(0.6) + (figure.z + 7) * Math.cos(0.6);
    expect(ahead).toBeGreaterThan(0.05);

    body.dispose();
    expect(shadowed.size).toBe(0);
    expect(scene.meshes.filter((m) => m.getTotalVertices() > 0)).toHaveLength(0);
    expect(body.node.isDisposed()).toBe(true);
  });

  it("keeps the placeholder when the model never loads", async () => {
    const scene = freshScene();
    const body = createBodyMesh(scene, BODY, { loader: () => Promise.reject(new Error("offline")) });
    await body.ready;
    expect(body.node.getChildMeshes()).toHaveLength(3);
    body.dispose();
    expect(scene.meshes).toHaveLength(0);
  });

  it("drops the model if disposed while it loads", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const body = createBodyMesh(scene, BODY, { loader: gate.loader });
    body.dispose();
    expect(body.node.isDisposed()).toBe(true);
    gate.release();
    await body.ready;
    expect(scene.meshes).toHaveLength(0);
    expect(scene.transformNodes).toHaveLength(0);
  });
});
