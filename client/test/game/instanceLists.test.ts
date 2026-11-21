import { describe, expect, it } from "vitest";
import { CULL_MOVE, CULL_TURN, type CullPose } from "@csarkosh/engine/game/grassCull";
import {
  KEPT_FOLIAGE, KEPT_STRIDE, LIST_MIN_INSTANCES, commitStaged, createInstanceList, createViewCut, cutList, ensureCapacity, ensureStaging,
  stageKept, writeKept,
} from "@csarkosh/engine/game/instanceLists";

/** A kept slab of `n` instances standing along x, a metre apart from `x0`, each tinted by its index. */
function slab(n: number, x0 = 0): Float32Array {
  const data = new Float32Array(n * KEPT_STRIDE);
  for (let i = 0; i < n; i++) {
    const at = i * KEPT_STRIDE;
    data[at] = 1;
    data[at + 5] = 1;
    data[at + 10] = 1;
    data[at + 15] = 1;
    data[at + 12] = x0 + i;
    data[at + 14] = 5;
    data[at + KEPT_FOLIAGE] = i;
    data[at + KEPT_FOLIAGE + 3] = 1;
  }
  return data;
}

const ALL = { bands: true, foliage: true, strength: true };
const POSE: CullPose = { x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 1, aspect: 1.5 };

describe("an instance list", () => {
  it("holds nothing, and no array, until an instance lands", () => {
    const list = createInstanceList(ALL, false);
    expect([list.buf.length, list.bands.length, list.foliage.length, list.strength.length]).toEqual([0, 0, 0, 0]);
    expect(list.cull).toBeNull();
    expect(createInstanceList(ALL, true).cull).not.toBeNull();
  });

  it("grows by doubling from its floor, each stream beside the matrices, and says when it grew", () => {
    const list = createInstanceList({ bands: false, foliage: true, strength: true }, false);
    list.count = 1;
    ensureCapacity(list);
    expect(list.grown).toBe(true);
    expect(list.buf.length).toBe(LIST_MIN_INSTANCES * 16);
    expect(list.foliage.length).toBe(LIST_MIN_INSTANCES * 4);
    expect(list.strength.length).toBe(LIST_MIN_INSTANCES);
    // A stream the list does not carry takes no array.
    expect(list.bands.length).toBe(0);
    const held = list.buf;
    list.count = LIST_MIN_INSTANCES;
    ensureCapacity(list);
    expect(list.grown).toBe(false);
    expect(list.buf).toBe(held);
    list.count = LIST_MIN_INSTANCES * 2 + 1;
    ensureCapacity(list);
    expect(list.grown).toBe(true);
    expect(list.buf.length).toBe(LIST_MIN_INSTANCES * 4 * 16);
  });

  it("writes an instance's kept matrix and tint where it is told, and its place where the list is cut", () => {
    const data = slab(3, 10);
    const list = createInstanceList(ALL, true);
    list.count = 3;
    ensureCapacity(list);
    writeKept(list, list, 2, data, KEPT_STRIDE);
    expect([...list.buf.subarray(32, 48)]).toEqual([...data.subarray(KEPT_STRIDE, KEPT_STRIDE + 16)]);
    expect([...list.foliage.subarray(8, 12)]).toEqual([1, 0, 0, 1]);
    expect([...list.origins.subarray(6, 9)]).toEqual([11, 0, 5]);
  });

  it("changes nothing that is drawn until its staged instances are committed", () => {
    const data = slab(4);
    const list = createInstanceList(ALL, false);
    list.stagedCount = 4;
    ensureStaging(list);
    list.stagedCount = 0;
    for (let i = 0; i < 4; i++) {
      const at = stageKept(list, data, i * KEPT_STRIDE);
      list.staged.bands[at * 4] = 7;
      list.staged.strength[at] = 0.5;
    }
    expect([list.stagedCount, list.count, list.buf.length]).toEqual([4, 0, 0]);
    commitStaged(list);
    expect([list.count, list.grown]).toEqual([4, true]);
    expect([...list.buf.subarray(0, 64)]).toEqual([...list.staged.buf.subarray(0, 64)]);
    expect(list.buf[3 * 16 + 12]).toBe(3);
    expect(list.bands[4]).toBe(7);
    expect(list.foliage[3 * 4]).toBe(3);
    expect(list.strength[2]).toBe(0.5);
    // The next commit of as many writes the same arrays in place.
    const held = list.buf;
    commitStaged(list);
    expect([list.grown, list.buf === held]).toEqual([false, true]);
  });

  it("cuts a culled list to the instances the planes keep, at the front of its drawn buffers and in order", () => {
    // Ahead of a camera looking down +z from the origin: x from -40 to 39, five metres out.
    const data = slab(80, -40);
    const list = createInstanceList({ bands: false, foliage: true, strength: true }, true);
    list.stagedCount = 80;
    ensureStaging(list);
    list.stagedCount = 0;
    for (let i = 0; i < 80; i++) list.staged.strength[stageKept(list, data, i * KEPT_STRIDE)] = i / 80;
    commitStaged(list);
    const cut = createViewCut();
    cut.invalidate();
    const planes = cut.planesFor(POSE) as Float32Array;
    expect(cutList(list, planes)).toBe(true);
    const kept = list.cull!.kept;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(80);
    const xs = Array.from({ length: kept }, (_, k) => list.drawn.buf[k * 16 + 12] as number);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    // Each stream follows its instance.
    for (let k = 0; k < kept; k++) {
      const i = (xs[k] as number) + 40;
      expect(list.drawn.foliage[k * 4]).toBe(i);
      expect(list.drawn.strength[k]).toBeCloseTo(i / 80, 6);
    }
    // The same cut again copies nothing; a commit forgets it.
    expect(cutList(list, planes)).toBe(false);
    commitStaged(list);
    expect(cutList(list, planes)).toBe(true);
    // A list that is not culled is never cut.
    expect(cutList(createInstanceList(ALL, false), planes)).toBe(false);
  });
});

describe("when the lists are cut again", () => {
  it("cuts once for a view, again past a threshold or after a rebuild, and keeps everything for no pose", () => {
    const cut = createViewCut();
    const first = cut.planesFor(POSE);
    expect(first).not.toBeNull();
    expect(cut.planesFor(POSE)).toBeNull();
    expect(cut.planesFor({ ...POSE, yaw: CULL_TURN * 0.5, x: CULL_MOVE * 0.5 })).toBeNull();
    expect(cut.planesFor({ ...POSE, yaw: CULL_TURN * 1.5 })).not.toBeNull();
    expect(cut.planesFor({ ...POSE, yaw: CULL_TURN * 1.5 })).toBeNull();
    cut.invalidate();
    expect(cut.planesFor({ ...POSE, yaw: CULL_TURN * 1.5 })).not.toBeNull();
    // No pose: every instance kept, by planes that are all zero, once.
    const all = cut.planesFor(null) as Float32Array;
    expect([...all]).toEqual(new Array(20).fill(0));
    expect(cut.planesFor(null)).toBeNull();
    expect(cut.planesFor(POSE)).not.toBeNull();
  });
});
