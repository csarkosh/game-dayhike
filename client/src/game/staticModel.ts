import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import { modelUrl } from "./assetUrls.js";
import { orientationRoot } from "./characterModel.js";

/**
 * How a model's GLB becomes a container, keyed by the catalog's `output`
 * (relative to `client/assets/`). The default fetches it by URL; a test hands
 * in a reader of the file on disk.
 */
export type ModelLoader = (output: string) => Promise<AssetContainer>;

export function defaultModelLoader(scene: Scene): ModelLoader {
  return (output) => {
    registerBuiltInLoaders();
    return loadAssetContainerAsync(modelUrl(output), scene);
  };
}

/** The LOD roots a static model carries; only the first is ever drawn here. */
const LOD_ROOTS = ["LOD0", "LOD1", "LOD2"] as const;

export type PlacedModel = {
  /** The node that carries the placement; the model's origin sits at it. */
  node: TransformNode;
  /** Every mesh with geometry under `LOD0`: what enters the shadow map. */
  meshes: Mesh[];
  dispose(): void;
};

/**
 * Puts a loaded static model into the scene once, at `(x, y, z)` turned by
 * `yaw` in the sim's convention (yaw 0 faces +z, PI/2 faces +x), with only its
 * `LOD0` root enabled.
 *
 * These models are placed once and seen up close — a car at the pad, a kiosk,
 * the body at the crest — so there is no distance ring to hand the coarser
 * levels to, and switching them on would draw the same object three times
 * over. The loader's own root is wrapped rather than turned
 * (`orientationRoot`): it carries the right- to left-handed conversion as a
 * quaternion, which would silently swallow an Euler yaw set on it.
 */
export function placeStaticModel(
  container: AssetContainer,
  name: string,
  x: number, y: number, z: number, yaw: number,
): PlacedModel {
  container.addAllToScene();
  const loaded = container.rootNodes.find((n) => n.parent === null) as TransformNode | undefined;
  if (loaded === undefined) {
    container.dispose();
    throw new Error(`model ${name} has no root node`);
  }
  const node = orientationRoot(loaded, name);
  node.position.set(x, y, z);
  node.rotation.y = yaw;

  let meshes: Mesh[] = [];
  for (const lod of LOD_ROOTS) {
    const root = [...container.transformNodes, ...container.meshes].find((n) => n.name === lod);
    if (root === undefined) continue;
    root.setEnabled(lod === "LOD0");
    if (lod === "LOD0") meshes = root.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  }
  for (const m of meshes) m.isPickable = false;
  return {
    node,
    meshes,
    dispose() {
      container.dispose();
      node.dispose();
    },
  };
}
