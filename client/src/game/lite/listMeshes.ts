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
 * **A short list shown again as it stands hands nothing over.** A shell's
 * rebuild fills every one of its lists, whichever of them the view's move
 * changed, and most of the short ones (a class laid on a wide cell, a
 * bucket far from the view) come out as they were. So a list of up to
 * `KEPT_INSTANCES` is kept as it was last handed over, its matrices in a
 * copy and its streams in the mesh's own array, and a showing is compared
 * with it: what is the same is not marked, and Lite sends none of it.
 *
 * A showing is counted on the renderer's record of its uploads
 * (`frameUploads.ts`), as streamed: the matrices of the instances shown and
 * the plugin data Lite will send for them.
 */
import { addToScene, markThinInstancePluginData, setMeshVisible, setThinInstanceCount, setThinInstances, type Mesh, type SceneContext } from "@babylonjs/lite";
import type { ListBuffers } from "@csarkosh/engine/game/instanceLists";
import { writeVegetationInstances, type VegetationInstanceLayout } from "./forestPlugins.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";

/** Bytes an instance's matrix is on the GPU. */
export const MATRIX_BYTES = 64;

/** The bytes showing `count` instances hands over on a mesh whose plugin data is `floats` an instance. */
export function listBytes(count: number, floats: number): number {
  return count * (MATRIX_BYTES + floats * 4);
}

/** Instances a mesh's arrays hold before its first list: a bucket in view of nothing still stands, hidden. */
const FIRST_CAPACITY = 16;

/** The longest list kept as it was last handed over, to tell a showing that hands the same over again: a compare of
 * up to this many instances is cheaper than the two buffer writes it saves, and longer lists seldom come out the same. */
export const KEPT_INSTANCES = 256;

/** Whether the first `length` floats of `a` and of `b` are the same. */
export function sameFloats(a: Float32Array, b: Float32Array, length: number): boolean {
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Where a short list's streams are interleaved before they are compared with what a mesh holds. */
let beside = new Float32Array(0);

/**
 * The streams of `count` instances interleaved into `data` as `layout` lays them (`writeVegetationInstances`), and
 * whether that changed a float of `data`. With `compare`, for a short list that may be the one `data` holds, they
 * are interleaved beside it and compared first, and `data` is written only where they differ; without it `data` is
 * written and said to have changed.
 */
export function writeListData(
  layout: VegetationInstanceLayout, count: number, from: Parameters<typeof writeVegetationInstances>[2], data: Float32Array, compare: boolean,
): boolean {
  // A list of none changes nothing a mesh already empty holds.
  if (count === 0) return !compare;
  if (!compare) {
    writeVegetationInstances(layout, count, from, data);
    return true;
  }
  const floats = count * layout.floats;
  if (beside.length < floats) beside = new Float32Array(KEPT_INSTANCES * layout.floats);
  writeVegetationInstances(layout, count, from, beside);
  if (sameFloats(beside, data, floats)) return false;
  data.set(beside.subarray(0, floats));
  return true;
}

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
  /** The matrices last handed over, where they were a short list's (`KEPT_INSTANCES`); null after a longer one. */
  kept: Float32Array | null;
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
  return { mesh, layout, matrices, data, room: data?.length ?? 0, kept: null, count: 0 };
}

/**
 * Draws the first `count` instances of `from` (a list's collected buffers,
 * or a culled list's drawn ones): the mesh takes the matrices' array where
 * it is not the one it holds, the streams are interleaved for the instances
 * shown, and a bucket shown nothing is hidden. A short list that is the one
 * the mesh last took is handed over no more than it differs. What is handed
 * over is counted on `uploads`, as streamed.
 */
export function showList(target: ListMesh, from: ListBuffers, count: number, uploads?: FrameUploads): void {
  const { mesh, layout } = target;
  const capacity = from.buf.length / 16;
  let replaced = false;
  if (from.buf !== target.matrices && capacity > 0) {
    target.matrices = from.buf;
    target.data = layout.floats > 0 ? new Float32Array(capacity * layout.floats) : null;
    setThinInstances(mesh, from.buf, capacity);
    replaced = true;
  }
  const instances = mesh.thinInstances;
  const data = target.data;
  const short = count <= KEPT_INSTANCES;
  // The list may be the one the mesh last took: as long, in the arrays it holds, and short enough to have been kept.
  const kept = !replaced && short && count === target.count ? target.kept : null;
  if (data !== null && instances !== undefined && instances !== null) {
    const changed = writeListData(layout, count, { fadeBands: from.bands, foliage: from.foliage, bladeStrength: from.strength }, data, kept !== null);
    if (instances.pluginData !== data) instances.pluginData = data;
    if (changed) {
      markThinInstancePluginData(mesh, 0, count * layout.floats);
      if (data.length > target.room) {
        target.room = data.length;
        uploads?.stream("pluginInstances", data.byteLength);
      } else if (count > 0) uploads?.stream("pluginInstances", count * layout.floats * 4);
    }
  }
  if (kept === null || !sameFloats(from.buf, kept, count * 16)) {
    if (count > 0) uploads?.stream("instances", count * MATRIX_BYTES);
    uploads?.composed(count);
    setThinInstanceCount(mesh, count);
    if (short) {
      if (target.kept === null || target.kept.length < count * 16) target.kept = new Float32Array(Math.max(FIRST_CAPACITY, count) * 16);
      target.kept.set(from.buf.subarray(0, count * 16));
    } else target.kept = null;
  }
  target.count = count;
  setMeshVisible(mesh, count > 0);
}
