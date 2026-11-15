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
 * showing, at the matrices' capacity. The mesh holds the whole array, so
 * the buffer on the GPU is made again only when a list outgrows it, and a
 * showing names the floats of the instances shown
 * (`markThinInstancePluginData`): Lite sends those at the next frame, the
 * mesh shown or hidden, and records no draw again for them. An array that
 * has outgrown the buffer is sent whole, into a buffer made for it.
 *
 * A showing is counted on the renderer's record of its uploads
 * (`frameUploads.ts`), as streamed: the matrices of the instances shown and
 * the plugin data Lite will send for them.
 */
import { addToScene, markThinInstancePluginData, setMeshVisible, setThinInstanceCount, setThinInstances, type Mesh, type SceneContext } from "@babylonjs/lite";
import type { ListBuffers } from "../instanceLists.js";
import { writeVegetationInstances, type VegetationInstanceLayout } from "./forestPlugins.js";
import type { FrameUploads } from "./frameUploads.js";

/** Bytes an instance's matrix is on the GPU. */
export const MATRIX_BYTES = 64;

/** The bytes showing `count` instances hands over on a mesh whose plugin data is `floats` an instance. */
export function listBytes(count: number, floats: number): number {
  return count * (MATRIX_BYTES + floats * 4);
}

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
  /** Floats of the streams the mesh's buffer on the GPU has room for: an array longer than it is sent whole. */
  room: number;
  /** Instances shown. */
  count: number;
};

/** `mesh` as a bucket of `scene`, hidden and holding no instance until its first list. Its material is already assigned. */
export function listMesh(scene: SceneContext, mesh: Mesh, layout: VegetationInstanceLayout): ListMesh {
  const matrices = new Float32Array(FIRST_CAPACITY * 16);
  const data = layout.floats > 0 ? new Float32Array(FIRST_CAPACITY * layout.floats) : null;
  setThinInstances(mesh, matrices, FIRST_CAPACITY);
  if (mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = data;
  setThinInstanceCount(mesh, 0);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);
  return { mesh, layout, matrices, data, room: data?.length ?? 0, count: 0 };
}

/**
 * Draws the first `count` instances of `from` (a list's collected buffers,
 * or a culled list's drawn ones): the mesh takes the matrices' array where
 * it is not the one it holds, the streams are interleaved for the instances
 * shown, and a bucket shown nothing is hidden. What it hands over is
 * counted on `uploads`, as streamed.
 */
export function showList(target: ListMesh, from: ListBuffers, count: number, uploads?: FrameUploads): void {
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
    if (instances.pluginData !== data) instances.pluginData = data;
    markThinInstancePluginData(mesh, 0, count * layout.floats);
    if (data.length > target.room) {
      target.room = data.length;
      uploads?.stream("pluginInstances", data.byteLength);
    } else if (count > 0) uploads?.stream("pluginInstances", count * layout.floats * 4);
  }
  if (count > 0) uploads?.stream("instances", count * MATRIX_BYTES);
  uploads?.composed(count);
  target.count = count;
  setThinInstanceCount(mesh, count);
  setMeshVisible(mesh, count > 0);
}
