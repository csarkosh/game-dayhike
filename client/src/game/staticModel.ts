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

/**
 * Enables the `LOD0` root among `nodes` and disables the others, returning
 * every mesh with geometry under `LOD0`, made unpickable. `named` maps a root's
 * name in the file to the name it carries among `nodes`.
 */
function enableFirstLod(nodes: readonly TransformNode[], named: (lod: string) => string): Mesh[] {
  let meshes: Mesh[] = [];
  for (const lod of LOD_ROOTS) {
    const root = nodes.find((n) => n.name === named(lod));
    if (root === undefined) continue;
    root.setEnabled(lod === "LOD0");
    if (lod === "LOD0") meshes = root.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  }
  for (const m of meshes) m.isPickable = false;
  return meshes;
}

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

  const meshes = enableFirstLod([...container.transformNodes, ...container.meshes], (lod) => lod);
  return {
    node,
    meshes,
    dispose() {
      container.dispose();
      node.dispose();
    },
  };
}

/**
 * Puts one more copy of a loaded static model into the scene, for a model that
 * stands in many places — a fingerpost at every junction, an arm on every
 * branch. The copies share the container's geometry and materials, so a
 * hundred arms cost one upload; only `LOD0` is copied at all, for the same
 * reason `placeStaticModel` draws only it. The container stays out of the
 * scene as the template and is the caller's to dispose after the last copy.
 */
export function instantiateStaticModel(
  container: AssetContainer,
  name: string,
  x: number, y: number, z: number, yaw: number,
): PlacedModel {
  const skipped = new Set<string>(LOD_ROOTS.filter((lod) => lod !== "LOD0"));
  const entries = container.instantiateModelsToScene((n) => `${name}_${n}`, false, {
    predicate: (entity: { name?: string }) => !skipped.has(entity.name ?? ""),
  });
  const loaded = entries.rootNodes[0] as TransformNode | undefined;
  if (loaded === undefined) {
    entries.dispose();
    throw new Error(`model ${name} has no root node`);
  }
  const node = orientationRoot(loaded, name);
  node.position.set(x, y, z);
  node.rotation.y = yaw;
  const meshes = enableFirstLod(loaded.getDescendants(false) as TransformNode[], (lod) => `${name}_${lod}`);
  return {
    node,
    meshes,
    dispose() {
      entries.dispose();
      node.dispose();
    },
  };
}
