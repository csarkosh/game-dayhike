import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import "../../src/sim/passes/index.js";

// Every call a rebuild makes to compute an instance's values is counted
// through these two modules: the trample frame and the tint writer the blade
// and duff shells import, and the ground colour inside the tint writer, which
// the clutter shell reaches from its own module. The wrappers pass straight
// through, so every value is the real one.
vi.mock("../../src/game/clutterMeshes.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/game/clutterMeshes.js")>();
  return { ...m, trampleFrame: vi.fn(m.trampleFrame), writeFoliage: vi.fn(m.writeFoliage) };
});
vi.mock("../../src/game/terrainSurface.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/game/terrainSurface.js")>();
  return { ...m, surfaceAlbedo: vi.fn(m.surfaceAlbedo) };
});

import { CLUTTER_GRASS_CELL, type ClutterInstance } from "../../src/sim/clutter.js";
import { createClutterMeshes, trampleFrame, writeFoliage } from "../../src/game/clutterMeshes.js";
import { surfaceAlbedo } from "../../src/game/terrainSurface.js";
import { BLADE_REBUILD_CELL, createBladeCollector, type BladeTiers } from "../../src/game/bladeField.js";
import { createBladeMeshes } from "../../src/game/bladeMeshes.js";
import { DUFF_REACH, DUFF_REBUILD_CELL, createDuffCollector, type DuffTiers } from "../../src/game/duffField.js";
import { createDuffMeshes } from "../../src/game/duffMeshes.js";
import { createClutterCollector, type ClutterBands } from "../../src/game/clutterField.js";
import {
  BLADE_KINDS, DUFF_KINDS, SEED, TINTED, clutterKinds, clutterScene, differences, expectedBlades, expectedClutter,
  expectedDuff, totalFloats, uploads, type Uploads,
} from "../helpers/groundCoverUploads.js";
import { timeLimit } from "../helpers/timeLimit.js";

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

// ---------------------------------------------------------------- blades

// The open-field census point bladeMeshes.test.ts uses: every tier, every
// character and size present.
const BLADE_CAM = { x: 35.5, z: 21335.5 };
function bladeUnique(t: BladeTiers): Set<object> {
  return unique<object>(t.fine, t.mid, t.coarse);
}

describe("blade shell: values computed once per cell", () => {
  function build() {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    const step = (x: number, z: number): Uploads => {
      blades.update(x, z);
      blades.cull(null);
      return uploads(spy, blades.meshes, () => BLADE_KINDS);
    };
    return { engine, spy, blades, step };
  }

  it("computes a rebuild one cell away only for the cells that came into range", () => {
    const { engine, spy, blades, step } = build();
    const ref = createBladeCollector(SEED);
    step(BLADE_CAM.x, BLADE_CAM.z);
    const before = bladeUnique(ref.collect(BLADE_CAM.x, BLADE_CAM.z));
    const after = bladeUnique(ref.collect(BLADE_CAM.x + BLADE_REBUILD_CELL, BLADE_CAM.z));
    vi.mocked(writeFoliage).mockClear();
    vi.mocked(trampleFrame).mockClear();
    step(BLADE_CAM.x + BLADE_REBUILD_CELL, BLADE_CAM.z);
    // Every value is computed for the cells new to the lists and for no
    // other; a fill that computed every listed cell would count every entry
    // of all three tier lists.
    const fresh = newIn(after, before);
    expect(fresh).toBe(142);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(fresh);
    expect(vi.mocked(trampleFrame).mock.calls.length).toBe(fresh);
    blades.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(60_000));

  it("uploads, over 20 crossings, exactly the buffers the fill computed from cold makes", () => {
    const { engine, spy, blades, step } = build();
    const ref = createBladeCollector(SEED);
    let floats = 0;
    for (let i = 0; i <= 20; i++) {
      const x = BLADE_CAM.x + i * BLADE_REBUILD_CELL, z = BLADE_CAM.z + 0.4 * i;
      const got = step(x, z);
      expect(differences(got, expectedBlades(blades.meshes, ref.collect(x, z))), `crossing ${i}`).toEqual([]);
      floats += totalFloats(got);
    }
    // The walk really drew: every crossing uploads tens of thousands of floats.
    expect(floats).toBe(2797158);
    blades.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(120_000));

  it("keeps a cell that stepped out of range, lets it go with the collector, and computes it again the same", () => {
    const { engine, spy, blades, step } = build();
    const ref = createBladeCollector(SEED);
    const first = step(BLADE_CAM.x, BLADE_CAM.z);
    const start = bladeUnique(ref.collect(BLADE_CAM.x, BLADE_CAM.z));
    // Three cells out and back: the cells that left are still kept.
    for (let i = 1; i <= 3; i++) step(BLADE_CAM.x + i * BLADE_REBUILD_CELL, BLADE_CAM.z);
    vi.mocked(writeFoliage).mockClear();
    expect(differences(step(BLADE_CAM.x, BLADE_CAM.z), first)).toEqual([]);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(0);
    // 200 crossings on: the collector sweeps the start's cells, and the
    // values kept go with them.
    for (let i = 1; i <= 200; i++) {
      step(BLADE_CAM.x + i * BLADE_REBUILD_CELL, BLADE_CAM.z);
      ref.collect(BLADE_CAM.x + i * BLADE_REBUILD_CELL, BLADE_CAM.z);
    }
    const inRange = bladeUnique(ref.collect(BLADE_CAM.x + 200 * BLADE_REBUILD_CELL, BLADE_CAM.z)).size;
    // Kept: the 4,994 cells in range, plus the cells the collector still
    // holds past the range since its last sweep (its 16,466 include the
    // empty ones). A kept cell is always one the collector holds, so the
    // collector's own sweep bounds the kept set.
    expect([blades.kept, inRange, ref.size]).toEqual([9296, 4994, 16466]);
    // Back at the start, every cell is computed again, to the same bits.
    vi.mocked(writeFoliage).mockClear();
    expect(differences(step(BLADE_CAM.x, BLADE_CAM.z), first)).toEqual([]);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(start.size);
    expect(start.size).toBe(4835);
    blades.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(120_000));
});

// ---------------------------------------------------------------- duff

// The forest-interior census point duffMeshes.test.ts uses.
const DUFF_CAM = { x: 480.5, z: -599.5 };
function duffUnique(t: DuffTiers): Set<object> {
  return unique<object>(t.near, t.far);
}

describe("duff shell: values computed once per cell", () => {
  function build(quality: "high" | "medium") {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const duff = createDuffMeshes(scene, SEED, { quality });
    const step = (x: number, z: number): Uploads => {
      duff.update(x, z);
      return uploads(spy, duff.meshes, () => DUFF_KINDS);
    };
    return { engine, spy, duff, step };
  }

  it("computes a rebuild one cell away only for the cells that came into range", () => {
    const { engine, spy, duff, step } = build("high");
    const ref = createDuffCollector(SEED);
    step(DUFF_CAM.x, DUFF_CAM.z);
    const before = duffUnique(ref.collect(DUFF_CAM.x, DUFF_CAM.z, DUFF_REACH.high));
    const after = duffUnique(ref.collect(DUFF_CAM.x + DUFF_REBUILD_CELL, DUFF_CAM.z, DUFF_REACH.high));
    vi.mocked(writeFoliage).mockClear();
    vi.mocked(trampleFrame).mockClear();
    step(DUFF_CAM.x + DUFF_REBUILD_CELL, DUFF_CAM.z);
    const fresh = newIn(after, before);
    expect(fresh).toBe(53);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(fresh);
    expect(vi.mocked(trampleFrame).mock.calls.length).toBe(fresh);
    duff.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(60_000));

  it("uploads, over 20 crossings at both reaches, exactly the buffers the fill computed from cold makes", () => {
    for (const quality of ["high", "medium"] as const) {
      const { engine, spy, duff, step } = build(quality);
      const ref = createDuffCollector(SEED);
      let floats = 0;
      for (let i = 0; i <= 20; i++) {
        const x = DUFF_CAM.x + i * DUFF_REBUILD_CELL, z = DUFF_CAM.z + 0.4 * i;
        const got = step(x, z);
        expect(differences(got, expectedDuff(duff.meshes, ref.collect(x, z, DUFF_REACH[quality]))), `${quality} crossing ${i}`).toEqual([]);
        floats += totalFloats(got);
      }
      expect([quality, floats]).toEqual([quality, { high: 1103676, medium: 598647 }[quality]]);
      duff.dispose();
      spy.mockRestore();
      engine.dispose();
    }
  }, timeLimit(120_000));

  it("keeps a cell that stepped out of range, lets it go with the collector, and computes it again the same", () => {
    const { engine, spy, duff, step } = build("high");
    const ref = createDuffCollector(SEED);
    const first = step(DUFF_CAM.x, DUFF_CAM.z);
    const start = duffUnique(ref.collect(DUFF_CAM.x, DUFF_CAM.z, DUFF_REACH.high));
    for (let i = 1; i <= 3; i++) step(DUFF_CAM.x + i * DUFF_REBUILD_CELL, DUFF_CAM.z);
    vi.mocked(writeFoliage).mockClear();
    expect(differences(step(DUFF_CAM.x, DUFF_CAM.z), first)).toEqual([]);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(0);
    for (let i = 1; i <= 200; i++) {
      step(DUFF_CAM.x + i * DUFF_REBUILD_CELL, DUFF_CAM.z);
      ref.collect(DUFF_CAM.x + i * DUFF_REBUILD_CELL, DUFF_CAM.z, DUFF_REACH.high);
    }
    const inRange = duffUnique(ref.collect(DUFF_CAM.x + 200 * DUFF_REBUILD_CELL, DUFF_CAM.z, DUFF_REACH.high)).size;
    // Kept: the 112 cells in range, plus those the collector still holds
    // past it (its 3,984 include the empty ones).
    expect([duff.kept, inRange, ref.size]).toEqual([127, 112, 3984]);
    vi.mocked(writeFoliage).mockClear();
    expect(differences(step(DUFF_CAM.x, DUFF_CAM.z), first)).toEqual([]);
    expect(vi.mocked(writeFoliage).mock.calls.length).toBe(start.size);
    expect(start.size).toBe(2260);
    duff.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(120_000));
});

// ---------------------------------------------------------------- clutter

// Near the origin, where clutterMeshes.test.ts finds grass reliably.
const CLUTTER_CAM = { x: 100.5, z: 100.5 };
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

describe("clutter shell: values computed once per instance", () => {
  /** `cull` as the medium and high tiers build it, with every card drawn
   * (`cull(null)`), so the grass class's drawn buffers are its collected ones. */
  function build(cull = false) {
    const { engine, scene, assets, bucketMeshes } = clutterScene();
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const clutter = createClutterMeshes(scene, SEED, { assets, cull });
    // The bucket meshes: every class's own, except the cut classes', whose
    // buckets are the cut copies.
    const meshes = bucketMeshes();
    const step = (x: number, z: number): Uploads => {
      clutter.update(x, z);
      clutter.cull(null);
      return uploads(spy, meshes, clutterKinds);
    };
    return { engine, spy, clutter, meshes, step };
  }

  it("computes a rebuild one grass cell away only for the instances that came into range", () => {
    const { engine, spy, clutter, step } = build();
    const ref = createClutterCollector(SEED);
    step(CLUTTER_CAM.x, CLUTTER_CAM.z);
    const before = clutterUnique(ref.collect(CLUTTER_CAM.x, CLUTTER_CAM.z));
    const after = clutterUnique(ref.collect(CLUTTER_CAM.x + CLUTTER_GRASS_CELL, CLUTTER_CAM.z));
    const compose = vi.spyOn(Matrix, "ComposeToRef");
    vi.mocked(surfaceAlbedo).mockClear();
    step(CLUTTER_CAM.x + CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
    const matrices = compose.mock.calls.length;
    compose.mockRestore();
    const fresh = newIn(after, before);
    const freshTinted = newIn(tintedOf(after), tintedOf(before));
    expect([fresh, freshTinted]).toEqual([600, 585]);
    // One matrix, and so one trample frame, per new instance; one ground
    // colour per new instance of a tinted class.
    expect(matrices).toBe(fresh);
    expect(vi.mocked(surfaceAlbedo).mock.calls.length).toBe(freshTinted);
    clutter.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(60_000));

  it("uploads, over 20 crossings, exactly the buffers the fill computed from cold makes", () => {
    const { engine, spy, clutter, meshes, step } = build(true);
    const ref = createClutterCollector(SEED);
    let floats = 0;
    for (let i = 0; i <= 20; i++) {
      const x = CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, z = CLUTTER_CAM.z + 1.2 * i;
      const got = step(x, z);
      expect(differences(got, expectedClutter(meshes, ref.collect(x, z))), `crossing ${i}`).toEqual([]);
      floats += totalFloats(got);
    }
    expect(floats).toBe(12095460);
    clutter.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(180_000));

  it("keeps an instance that stepped out of range, lets it go with the collector, and computes it again the same", () => {
    const { engine, spy, clutter, step } = build();
    const ref = createClutterCollector(SEED);
    const first = step(CLUTTER_CAM.x, CLUTTER_CAM.z);
    const start = tintedOf(clutterUnique(ref.collect(CLUTTER_CAM.x, CLUTTER_CAM.z)));
    for (let i = 1; i <= 3; i++) step(CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
    vi.mocked(surfaceAlbedo).mockClear();
    expect(differences(step(CLUTTER_CAM.x, CLUTTER_CAM.z), first)).toEqual([]);
    expect(vi.mocked(surfaceAlbedo).mock.calls.length).toBe(0);
    for (let i = 1; i <= 200; i++) {
      step(CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
      ref.collect(CLUTTER_CAM.x + i * CLUTTER_GRASS_CELL, CLUTTER_CAM.z);
    }
    const inRange = clutterUnique(ref.collect(CLUTTER_CAM.x + 200 * CLUTTER_GRASS_CELL, CLUTTER_CAM.z)).size;
    // Kept: the 17,932 instances in range, plus those the collector still
    // holds past it (its 98,361 include the empty cells).
    expect([clutter.kept, inRange, ref.size]).toEqual([37310, 17932, 98361]);
    vi.mocked(surfaceAlbedo).mockClear();
    expect(differences(step(CLUTTER_CAM.x, CLUTTER_CAM.z), first)).toEqual([]);
    expect(vi.mocked(surfaceAlbedo).mock.calls.length).toBe(start.size);
    expect(start.size).toBe(19435);
    clutter.dispose();
    spy.mockRestore();
    engine.dispose();
  }, timeLimit(240_000));
});
