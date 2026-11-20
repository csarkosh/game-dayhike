import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import "../../src/sim/passes/index.js";

// Every call a rebuild makes to compute an instance's values is counted
// through these two modules: the trample frame, the matrix and the tint
// writer every list imports, and the ground colour inside the tint writer.
// The wrappers pass straight through, so every value is the real one.
vi.mock("../../src/game/clutterInstances.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/game/clutterInstances.js")>();
  return { ...m, trampleFrame: vi.fn(m.trampleFrame), writeFoliage: vi.fn(m.writeFoliage), instanceMatrixFor: vi.fn(m.instanceMatrixFor) };
});
vi.mock("../../src/game/terrainSurface.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/game/terrainSurface.js")>();
  return { ...m, surfaceAlbedo: vi.fn(m.surfaceAlbedo) };
});

import {
  CLUTTER_BUSH, CLUTTER_CLASS_COUNT, CLUTTER_FERN, CLUTTER_FLOWER, CLUTTER_GRASS, CLUTTER_GRASS_CELL, CLUTTER_HIGHPLANT, CLUTTER_MEADOW, CLUTTER_SHRUB,
  CLUTTER_WETPLANT, type ClutterInstance,
} from "../../src/sim/clutter.js";
import { BLADE_REBUILD_CELL, createBladeCollector, type BladeTiers } from "../../src/game/bladeField.js";
import { createBladeLists } from "../../src/game/bladeInstances.js";
import { createClutterCollector, type ClutterBands } from "../../src/game/clutterField.js";
import { cutsFor, instanceMatrixFor, trampleFrame, writeFoliage } from "../../src/game/clutterInstances.js";
import { createClutterLists } from "../../src/game/clutterLists.js";
import { DUFF_REACH, DUFF_REBUILD_CELL, createDuffCollector, type DuffTiers } from "../../src/game/duffField.js";
import { createDuffLists } from "../../src/game/duffInstances.js";
import type { InstanceList } from "@csarkosh/engine/game/instanceLists";
import { finish, type Slices } from "@csarkosh/engine/game/syncJobs";
import { surfaceAlbedo } from "../../src/game/terrainSurface.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 1;

/** The distinct objects of several lists. */
function unique<T>(...lists: T[][]): Set<T> {
  const out = new Set<T>();
  for (const list of lists) for (const x of list) out.add(x);
  return out;
}
function newIn<T>(now: Set<T>, before: Set<T>): number {
  let n = 0;
  for (const x of now) if (!before.has(x)) n++;
  return n;
}

/**
 * What a set of lists holds, which is what its shell hands the GPU: each
 * list's count and the bits of every stream it carries, up to that count.
 */
function held(lists: readonly InstanceList[]): string {
  const hash = createHash("sha256");
  const bits = (a: Float32Array, floats: number): void => void hash.update(Buffer.from(a.buffer, a.byteOffset, floats * 4));
  for (const list of lists) {
    hash.update(`|${list.count}|`);
    const slots = list.buf.length / 16;
    bits(list.buf, list.count * 16);
    for (const stream of [list.bands, list.foliage, list.strength]) {
      if (slots > 0 && stream.length > 0) bits(stream, list.count * (stream.length / slots));
    }
  }
  return hash.digest("hex");
}
/** How many floats the lists hold in all their streams. */
function floatsOf(lists: readonly InstanceList[]): number {
  let n = 0;
  for (const list of lists) {
    const slots = list.buf.length / 16;
    n += list.count * 16;
    for (const stream of [list.bands, list.foliage, list.strength]) if (slots > 0) n += list.count * (stream.length / slots);
  }
  return n;
}

type Lists = { readonly all: readonly InstanceList[]; rebuild(x: number, z: number): Slices; readonly kept: number };
/** A rebuild at a view, run to its end, and what the lists then hold. */
function step(lists: Lists, x: number, z: number): string {
  finish(lists.rebuild(x, z));
  return held(lists.all);
}

// ---------------------------------------------------------------- blades

// The open-field census point: every tier, every character and size present.
const BLADE_CAM = { x: 35.5, z: 21335.5 };
function bladeUnique(t: BladeTiers): Set<object> {
  return unique<object>(t.fine, t.mid, t.coarse);
}

describe("the blade field's lists: values computed once per cell", () => {
  it("computes a rebuild one cell away only for the cells that came into range", () => {
    const lists = createBladeLists(SEED);
    const ref = createBladeCollector(SEED);
    step(lists, BLADE_CAM.x, BLADE_CAM.z);
    const before = bladeUnique(ref.collect(BLADE_CAM.x, BLADE_CAM.z));
    const after = bladeUnique(ref.collect(BLADE_CAM.x + BLADE_REBUILD_CELL, BLADE_CAM.z));
    vi.mocked(writeFoliage).mockClear();
    vi.mocked(trampleFrame).mockClear();
    step(lists, BLADE_CAM.x + BLADE_REBUILD_CELL, BLADE_CAM.z);
    // Every value is computed for the cells new to the lists and for no
    // other; a fill that computed every listed cell would count every entry
    // of all three tier lists.
    const fresh = newIn(after, before);
    expect(fresh).toBe(142);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(fresh);
    expect(vi.mocked(trampleFrame).mock.calls.length).toBe(fresh);
  }, timeLimit(60_000));

  it("holds, over 20 crossings, exactly what lists filled from cold hold", () => {
    const lists = createBladeLists(SEED);
    let floats = 0;
    for (let i = 0; i <= 20; i++) {
      const x = BLADE_CAM.x + i * BLADE_REBUILD_CELL, z = BLADE_CAM.z + 0.4 * i;
      const got = step(lists, x, z);
      floats += floatsOf(lists.all);
      if (i % 5 === 0) expect(got, `crossing ${i}`).toBe(step(createBladeLists(SEED), x, z));
    }
    // The walk really listed: every crossing holds tens of thousands of floats.
    expect(floats).toBeGreaterThan(2_000_000);
  }, timeLimit(120_000));

  it("keeps a cell that stepped out of range, lets it go with the collector, and computes it again the same", () => {
    const lists = createBladeLists(SEED);
    const ref = createBladeCollector(SEED);
    const first = step(lists, BLADE_CAM.x, BLADE_CAM.z);
    const start = bladeUnique(ref.collect(BLADE_CAM.x, BLADE_CAM.z));
    // Three cells out and back: the cells that left are still kept.
    for (let i = 1; i <= 3; i++) step(lists, BLADE_CAM.x + i * BLADE_REBUILD_CELL, BLADE_CAM.z);
    vi.mocked(writeFoliage).mockClear();
    expect(step(lists, BLADE_CAM.x, BLADE_CAM.z)).toBe(first);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(0);
    // 200 crossings on: the collector sweeps the start's cells, and the
    // values kept go with them.
    for (let i = 1; i <= 200; i++) {
      step(lists, BLADE_CAM.x + i * BLADE_REBUILD_CELL, BLADE_CAM.z);
      ref.collect(BLADE_CAM.x + i * BLADE_REBUILD_CELL, BLADE_CAM.z);
    }
    const inRange = bladeUnique(ref.collect(BLADE_CAM.x + 200 * BLADE_REBUILD_CELL, BLADE_CAM.z)).size;
    // Kept: the 4,994 cells in range, plus the cells the collector still
    // holds past the range since its last sweep (its 16,466 include the
    // empty ones). A kept cell is always one the collector holds, so the
    // collector's own sweep bounds the kept set.
    expect([lists.kept, inRange, ref.size]).toEqual([9296, 4994, 16466]);
    // Back at the start, every cell is computed again, to the same bits.
    vi.mocked(writeFoliage).mockClear();
    expect(step(lists, BLADE_CAM.x, BLADE_CAM.z)).toBe(first);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(start.size);
    expect(start.size).toBe(4835);
  }, timeLimit(120_000));
});

// ---------------------------------------------------------------- duff

// The forest-interior census point.
const DUFF_CAM = { x: 480.5, z: -599.5 };
function duffUnique(t: DuffTiers): Set<object> {
  return unique<object>(t.near, t.far);
}

describe("the duff field's lists: values computed once per cell", () => {
  it("computes a rebuild one cell away only for the cells that came into range", () => {
    const lists = createDuffLists(SEED, DUFF_REACH.high);
    const ref = createDuffCollector(SEED);
    step(lists, DUFF_CAM.x, DUFF_CAM.z);
    const before = duffUnique(ref.collect(DUFF_CAM.x, DUFF_CAM.z, DUFF_REACH.high));
    const after = duffUnique(ref.collect(DUFF_CAM.x + DUFF_REBUILD_CELL, DUFF_CAM.z, DUFF_REACH.high));
    vi.mocked(writeFoliage).mockClear();
    vi.mocked(trampleFrame).mockClear();
    step(lists, DUFF_CAM.x + DUFF_REBUILD_CELL, DUFF_CAM.z);
    const fresh = newIn(after, before);
    expect(fresh).toBe(53);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(fresh);
    expect(vi.mocked(trampleFrame).mock.calls.length).toBe(fresh);
  }, timeLimit(60_000));

  it("holds, over 20 crossings at both reaches, exactly what lists filled from cold hold", () => {
    for (const quality of ["high", "medium"] as const) {
      const lists = createDuffLists(SEED, DUFF_REACH[quality]);
      let floats = 0;
      for (let i = 0; i <= 20; i++) {
        const x = DUFF_CAM.x + i * DUFF_REBUILD_CELL, z = DUFF_CAM.z + 0.4 * i;
        const got = step(lists, x, z);
        floats += floatsOf(lists.all);
        if (i % 5 === 0) expect(got, `${quality} crossing ${i}`).toBe(step(createDuffLists(SEED, DUFF_REACH[quality]), x, z));
      }
      expect(floats, quality).toBeGreaterThan(400_000);
    }
  }, timeLimit(120_000));

  it("keeps a cell that stepped out of range, lets it go with the collector, and computes it again the same", () => {
    const lists = createDuffLists(SEED, DUFF_REACH.high);
    const ref = createDuffCollector(SEED);
    const first = step(lists, DUFF_CAM.x, DUFF_CAM.z);
    const start = duffUnique(ref.collect(DUFF_CAM.x, DUFF_CAM.z, DUFF_REACH.high));
    for (let i = 1; i <= 3; i++) step(lists, DUFF_CAM.x + i * DUFF_REBUILD_CELL, DUFF_CAM.z);
    vi.mocked(writeFoliage).mockClear();
    expect(step(lists, DUFF_CAM.x, DUFF_CAM.z)).toBe(first);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(0);
    for (let i = 1; i <= 200; i++) {
      step(lists, DUFF_CAM.x + i * DUFF_REBUILD_CELL, DUFF_CAM.z);
      ref.collect(DUFF_CAM.x + i * DUFF_REBUILD_CELL, DUFF_CAM.z, DUFF_REACH.high);
    }
    const inRange = duffUnique(ref.collect(DUFF_CAM.x + 200 * DUFF_REBUILD_CELL, DUFF_CAM.z, DUFF_REACH.high)).size;
    // Kept: the 112 cells in range, plus those the collector still holds
    // past it (its 3,984 include the empty ones).
    expect([lists.kept, inRange, ref.size]).toEqual([127, 112, 3984]);
    vi.mocked(writeFoliage).mockClear();
    expect(step(lists, DUFF_CAM.x, DUFF_CAM.z)).toBe(first);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(start.size);
    expect(start.size).toBe(2260);
  }, timeLimit(120_000));
});

// ---------------------------------------------------------------- clutter

// Near the origin, where grass grows reliably.
const CLUTTER_CAM = { x: 100.5, z: 100.5 };
/** The classes whose instances carry a ground colour. */
const TINTED = new Set([CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_FLOWER, CLUTTER_BUSH, CLUTTER_FERN, CLUTTER_SHRUB, CLUTTER_WETPLANT, CLUTTER_HIGHPLANT]);
/** Two models a class, the stones' each cut four ways. */
const ROWS = Array.from({ length: CLUTTER_CLASS_COUNT }, (_, cls) => 2 * cutsFor(cls));
/** The clutter's lists as the others are held: every bucket's list. */
function clutterLists(): Lists {
  const lists = createClutterLists(SEED, { radiusScale: 1, nearBlades: false, cull: false, rows: ROWS });
  return {
    all: lists.all.map((bucket) => bucket.list),
    rebuild: (x, z) => lists.rebuild(x, z),
    get kept() {
      return lists.kept;
    },
  };
}
function clutterUnique(bands: ClutterBands): Set<ClutterInstance> {
  const out = new Set<ClutterInstance>();
  for (const band of bands) {
    for (const inst of band.near) out.add(inst);
    for (const inst of band.far) out.add(inst);
  }
  return out;
}
function tintedOf(set: Set<ClutterInstance>): Set<ClutterInstance> {
  return new Set([...set].filter((inst) => TINTED.has(inst.cls)));
}

describe("the clutter's lists: values computed once per instance", () => {
  it("computes a rebuild one grass cell away only for the instances that came into range", () => {
    const lists = clutterLists();
    const ref = createClutterCollector(SEED);
    step(lists, CLUTTER_CAM.x, CLUTTER_CAM.z);
    const before = clutterUnique(ref.collect(CLUTTER_CAM.x, CLUTTER_CAM.z));
    const after = clutterUnique(ref.collect(CLUTTER_CAM.x + CLUTTER_GRASS_CELL, CLUTTER_CAM.z));
    vi.mocked(instanceMatrixFor).mockClear();
    vi.mocked(surfaceAlbedo).mockClear();
    step(lists, CLUTTER_CAM.x + CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
    const matrices = vi.mocked(instanceMatrixFor).mock.calls.length;
    const fresh = newIn(after, before);
    const freshTinted = newIn(tintedOf(after), tintedOf(before));
    expect([fresh, freshTinted]).toEqual([868, 853]);
    // One matrix, and so one trample frame, per new instance; one ground
    // colour per new instance of a tinted class.
    expect(matrices).toBe(fresh);
    expect(vi.mocked(surfaceAlbedo).mock.calls.length).toBe(freshTinted);
  }, timeLimit(60_000));

  it("holds, over 20 crossings, exactly what lists filled from cold hold", () => {
    const lists = clutterLists();
    let floats = 0;
    for (let i = 0; i <= 20; i++) {
      const x = CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, z = CLUTTER_CAM.z + 1.2 * i;
      const got = step(lists, x, z);
      floats += floatsOf(lists.all);
      if (i % 10 === 0) expect(got, `crossing ${i}`).toBe(step(clutterLists(), x, z));
    }
    expect(floats).toBeGreaterThan(20_000_000);
  }, timeLimit(180_000));

  it("keeps an instance that stepped out of range, lets it go with the collector, and computes it again the same", () => {
    const lists = clutterLists();
    const ref = createClutterCollector(SEED);
    const first = step(lists, CLUTTER_CAM.x, CLUTTER_CAM.z);
    const start = tintedOf(clutterUnique(ref.collect(CLUTTER_CAM.x, CLUTTER_CAM.z)));
    for (let i = 1; i <= 3; i++) step(lists, CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
    vi.mocked(surfaceAlbedo).mockClear();
    expect(step(lists, CLUTTER_CAM.x, CLUTTER_CAM.z)).toBe(first);
    expect(vi.mocked(surfaceAlbedo).mock.calls.length).toBe(0);
    for (let i = 1; i <= 200; i++) {
      step(lists, CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
      ref.collect(CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
    }
    const inRange = clutterUnique(ref.collect(CLUTTER_CAM.x + 200 * CLUTTER_GRASS_CELL, CLUTTER_CAM.z)).size;
    // Kept: the 42,182 instances in range, plus those the collector still
    // holds past it (its 136,849 include the empty cells).
    expect([lists.kept, inRange, ref.size]).toEqual([51567, 42182, 136849]);
    vi.mocked(surfaceAlbedo).mockClear();
    expect(step(lists, CLUTTER_CAM.x, CLUTTER_CAM.z)).toBe(first);
    expect(vi.mocked(surfaceAlbedo).mock.calls.length).toBe(start.size);
    expect(start.size).toBe(49389);
  }, timeLimit(240_000));
});
