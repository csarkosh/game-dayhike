/**
 * A ground-cover bucket on Babylon Lite: one mesh drawn as thin instances
 * from an instance list (`instanceLists.ts`), the list's matrices and the
 * per-instance streams its material's plugin reads.
 *
 * **The matrices are the list's own array.** Lite keeps the array a mesh's
 * instances were set from and sends the first `count` of them again when the
 * count is set, so a list written in place costs no copy here; only a list
 * that outgrew its arrays hands the mesh new ones.
 *
 * **The streams are interleaved** into one array an instance, as Lite's
 * plugin instance data is laid out (`vegetationInstanceLayout`), at each
 * showing. Lite sends the whole of the array it is handed, so it is handed
 * a view of the instances shown, rounded up to a power of two: what is sent
 * is at most twice what is drawn, and the buffer on the GPU is made again
 * only when a list first reaches a size, not at every list.
 *
 * Plugin instance data goes up when its draw is recorded, so whoever shows
 * a list records the draws again once it has shown all it will
 * (`invalidateRenderBundles`).
 */
import { addToScene, setMeshVisible, setThinInstanceCount, setThinInstances, type Mesh, type SceneContext } from "@babylonjs/lite";
import type { ListBuffers } from "../instanceLists.js";
import { writeVegetationInstances, type VegetationInstanceLayout } from "./forestPlugins.js";

/** Instances a mesh's arrays hold before its first list: a bucket in view of nothing still stands, hidden. */
const FIRST_CAPACITY = 16;

/** One bucket's mesh, and what of its list it last took. */
export type ListMesh = {
  readonly mesh: Mesh;
  /** The per-instance attributes the mesh's material reads, and where each sits in an instance's data. */
  readonly layout: VegetationInstanceLayout;
  /** The matrices the mesh's instances were last set from. */
  matrices: Float32Array;
  /** The interleaved streams, at the matrices' capacity; null for a material that reads none. */
  data: Float32Array | null;
  /** Instances shown. */
  count: number;
};

/** The instances a view of the plugin data covers for `count` shown: the next power of two, within `capacity`. */
export function sentInstances(count: number, capacity: number): number {
  let sent = FIRST_CAPACITY;
  while (sent < count) sent *= 2;
  return Math.min(sent, capacity);
}

/** `mesh` as a bucket of `scene`, hidden and holding no instance until its first list. Its material is already assigned. */
export function listMesh(scene: SceneContext, mesh: Mesh, layout: VegetationInstanceLayout): ListMesh {
  const matrices = new Float32Array(FIRST_CAPACITY * 16);
  const data = layout.floats > 0 ? new Float32Array(FIRST_CAPACITY * layout.floats) : null;
  setThinInstances(mesh, matrices, FIRST_CAPACITY);
  if (mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = data;
  setThinInstanceCount(mesh, 0);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);
  return { mesh, layout, matrices, data, count: 0 };
}

/**
 * Draws the first `count` instances of `from` (a list's collected buffers,
 * or a culled list's drawn ones): the mesh takes the matrices' array where
 * it is not the one it holds, the streams are interleaved for the instances
 * shown, and a bucket shown nothing is hidden. True where the mesh's plugin
 * data changed: the draws want recording again.
 */
export function showList(target: ListMesh, from: ListBuffers, count: number): boolean {
  const { mesh, layout } = target;
  const capacity = from.buf.length / 16;
  if (from.buf !== target.matrices && capacity > 0) {
    target.matrices = from.buf;
    target.data = layout.floats > 0 ? new Float32Array(capacity * layout.floats) : null;
    setThinInstances(mesh, from.buf, capacity);
  }
  const instances = mesh.thinInstances;
  const data = target.data;
  if (data !== null && instances !== undefined && instances !== null) {
    if (count > 0) writeVegetationInstances(layout, count, { fadeBands: from.bands, foliage: from.foliage, bladeStrength: from.strength }, data);
    instances.pluginData = data.subarray(0, sentInstances(count, data.length / layout.floats) * layout.floats);
    instances.pluginVersion = (instances.pluginVersion ?? 0) + 1;
  }
  target.count = count;
  setThinInstanceCount(mesh, count);
  setMeshVisible(mesh, count > 0);
  return data !== null;
}
