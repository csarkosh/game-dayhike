import { setThinInstanceCount, setThinInstances, type Mesh } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import type { ListBuffers } from "@csarkosh/engine/game/instanceLists";
import { createFrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { KEPT_INSTANCES, MATRIX_BYTES, listBytes, sameFloats, showList, writeListData, type ListMesh } from "../../../src/game/lite/listMeshes.js";
import type { VegetationInstanceLayout } from "../../../src/game/lite/forestPlugins.js";

/** A layout whose instances read their fade bands alone: four floats. */
const BANDS: VegetationInstanceLayout = { fadeBands: 0, groundGrad: -1, foliage: -1, deadwoodRole: -1, bladeStrength: -1, floats: 4 };

/** A list of `count` instances in arrays with room for `capacity`, every float a function of its place and `salt`. */
function list(count: number, capacity: number, salt = 0): ListBuffers & { count: number } {
  const buf = new Float32Array(capacity * 16);
  const bands = new Float32Array(capacity * 4);
  for (let i = 0; i < count * 16; i++) buf[i] = i + salt;
  for (let i = 0; i < count * 4; i++) bands[i] = 1000 + i + salt;
  return { buf, bands, foliage: new Float32Array(0), strength: new Float32Array(0), count };
}

/** A bucket as `listMesh` leaves one, less the scene: a mesh that is Lite's as far as its instance list goes. */
function bucket(): ListMesh {
  const mesh = { children: [] } as unknown as Mesh;
  const matrices = new Float32Array(16 * 16);
  const data = new Float32Array(16 * 4);
  setThinInstances(mesh, matrices, 16);
  (mesh.thinInstances as NonNullable<Mesh["thinInstances"]>).pluginData = data;
  setThinInstanceCount(mesh, 0);
  return { mesh, layout: BANDS, matrices, data, room: data.length, kept: null, count: 0 };
}

/** What Lite will send of a bucket's mesh: the versions its two buffers are written by. */
const versions = (target: ListMesh): { matrices: number; plugin: number } => {
  const instances = target.mesh.thinInstances as unknown as { _version: number; pluginVersion?: number };
  return { matrices: instances._version, plugin: instances.pluginVersion ?? 0 };
};

describe("a ground-cover bucket on Babylon Lite", () => {
  it("says what a showing hands over: a matrix and the plugin data of each instance shown", () => {
    expect(MATRIX_BYTES).toBe(64);
    // No plugin data: the matrices alone.
    expect(listBytes(100, 0)).toBe(100 * 64);
    // Four floats an instance, sent for the hundred shown and no more.
    expect(listBytes(100, 4)).toBe(100 * 64 + 100 * 4 * 4);
    // A bucket shown nothing sends nothing.
    expect(listBytes(0, 4)).toBe(0);
    expect(listBytes(3000, 8)).toBe(3000 * (64 + 8 * 4));
  });

  it("hands a list to its mesh whole the first time, the plugin data's array with it, and counts what Lite will send", () => {
    const target = bucket();
    const uploads = createFrameUploads();
    const from = list(40, 64);
    showList(target, from, 40, uploads);
    const instances = target.mesh.thinInstances as NonNullable<Mesh["thinInstances"]>;
    expect(instances.matrices).toBe(from.buf);
    expect(instances.count).toBe(40);
    expect(target.mesh.visible).not.toBe(false);
    // The streams are interleaved at the matrices' capacity, in an array the mesh holds whole.
    expect(instances.pluginData).toBe(target.data);
    expect((target.data as Float32Array).length).toBe(64 * 4);
    expect([...(target.data as Float32Array).subarray(0, 8)]).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007]);
    // The new array is longer than the mesh's buffer: Lite sends it whole. The matrices, of the forty shown.
    expect(uploads.now.byKind.pluginInstances).toBe(64 * 4 * 4);
    expect(uploads.now.byKind.instances).toBe(40 * 64);
    expect(uploads.now.instances).toBe(40);
  });

  it("hands a short list shown again as it stands to nothing: no matrix and no plugin data is marked, and nothing is counted", () => {
    const target = bucket();
    const from = list(40, 64);
    showList(target, from, 40);
    const before = versions(target);
    const uploads = createFrameUploads();
    // A rebuild fills the list's own arrays again with what they held.
    from.buf.set(list(40, 64).buf);
    showList(target, from, 40, uploads);
    expect(versions(target)).toEqual(before);
    expect(uploads.now.bytes).toBe(0);
    expect(uploads.now.writes).toBe(0);
    expect(uploads.now.instances).toBe(0);
    // An empty bucket shown nothing again, the same.
    const empty = bucket();
    showList(empty, list(0, 64), 0);
    const emptied = versions(empty);
    showList(empty, empty.matrices === empty.mesh.thinInstances?.matrices ? { ...list(0, 64), buf: empty.matrices } : list(0, 64), 0, uploads);
    expect(versions(empty)).toEqual(emptied);
    expect(empty.mesh.visible).toBe(false);
    expect(uploads.now.bytes).toBe(0);
  });

  it("hands over what of a short list differs: its matrices, its streams, or both", () => {
    const target = bucket();
    const from = list(40, 64);
    showList(target, from, 40);
    let before = versions(target);
    const uploads = createFrameUploads();
    // One matrix moved: the matrices go, the streams do not.
    (from.buf as Float32Array)[16 * 7 + 12] = -5;
    showList(target, from, 40, uploads);
    expect(versions(target).matrices).toBeGreaterThan(before.matrices);
    expect(versions(target).plugin).toBe(before.plugin);
    expect(uploads.now.byKind).toMatchObject({ instances: 40 * 64, pluginInstances: 0 });
    // One band moved: the streams go, the matrices do not.
    before = versions(target);
    uploads.close();
    (from.bands as Float32Array)[9] = 0.5;
    showList(target, from, 40, uploads);
    expect(versions(target).matrices).toBe(before.matrices);
    expect(versions(target).plugin).toBeGreaterThan(before.plugin);
    expect(uploads.now.byKind).toMatchObject({ instances: 0, pluginInstances: 40 * 4 * 4 });
    expect((target.data as Float32Array)[9]).toBe(0.5);
    // Fewer shown: the count is the mesh's again, though every float left is the same.
    before = versions(target);
    showList(target, from, 39, uploads);
    expect(versions(target).matrices).toBeGreaterThan(before.matrices);
    expect(target.mesh.thinInstances?.count).toBe(39);
  });

  it("keeps no long list: one past the short ones' length is handed over at every showing", () => {
    const target = bucket();
    const count = KEPT_INSTANCES + 1;
    const from = list(count, 512);
    showList(target, from, count);
    expect(target.kept).toBeNull();
    const before = versions(target);
    const uploads = createFrameUploads();
    showList(target, from, count, uploads);
    expect(versions(target).matrices).toBeGreaterThan(before.matrices);
    expect(versions(target).plugin).toBeGreaterThan(before.plugin);
    expect(uploads.now.byKind).toMatchObject({ instances: count * 64, pluginInstances: count * 4 * 4 });
    // A short one after it is kept again, and the one after that told from it.
    showList(target, from, KEPT_INSTANCES);
    expect(target.kept).not.toBeNull();
    const kept = versions(target);
    showList(target, from, KEPT_INSTANCES);
    expect(versions(target)).toEqual(kept);
  });

  it("takes a list's new arrays whole, whatever it kept of the old", () => {
    const target = bucket();
    showList(target, list(40, 64), 40);
    const before = versions(target);
    const uploads = createFrameUploads();
    // The same forty, in arrays the list outgrew its old ones into.
    const grown = list(40, 128);
    showList(target, grown, 40, uploads);
    expect(target.mesh.thinInstances?.matrices).toBe(grown.buf);
    expect(target.mesh.thinInstances?.pluginData).toBe(target.data);
    expect((target.data as Float32Array).length).toBe(128 * 4);
    expect(versions(target).plugin).toBeGreaterThan(before.plugin);
    expect(uploads.now.byKind).toMatchObject({ instances: 40 * 64, pluginInstances: 128 * 4 * 4 });
  });

  it("compares a short list's streams beside the mesh's array, and writes that only where they differ", () => {
    const data = new Float32Array(8).fill(7);
    const bands = Float32Array.from([7, 7, 7, 7, 7, 7, 7, 7]);
    expect(writeListData(BANDS, 2, { fadeBands: bands }, data, true)).toBe(false);
    bands[5] = 8;
    expect(writeListData(BANDS, 2, { fadeBands: bands }, data, true)).toBe(true);
    expect([...data]).toEqual([7, 7, 7, 7, 7, 8, 7, 7]);
    // Without the compare it is written and said to have changed; a list of none changes nothing to compare.
    expect(writeListData(BANDS, 2, { fadeBands: bands }, data, false)).toBe(true);
    expect(writeListData(BANDS, 0, {}, data, true)).toBe(false);
    expect(writeListData(BANDS, 0, {}, data, false)).toBe(true);
    expect(sameFloats(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2, 4]), 2)).toBe(true);
    expect(sameFloats(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2, 4]), 3)).toBe(false);
  });
});
