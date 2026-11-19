import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, BLADE_SIZE_COUNT, createBladeCollector, type BladeCell } from "../../src/game/bladeField.js";
import { BLADE_CANOPY_HEIGHT, BLADE_STRENGTH_HEIGHT, BLADE_TIER_COUNT, bladeHeightScale, createBladeLists } from "../../src/game/bladeInstances.js";
import { instanceMatrixFor, trampleFrame, writeFoliage } from "../../src/game/clutterInstances.js";
import type { CullPose } from "../../src/game/grassCull.js";
import type { InstanceList } from "../../src/game/instanceLists.js";
import { finish } from "../../src/game/syncJobs.js";
import { runBySlices } from "../helpers/sliceRun.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";

// The open-field census point: every tier and every character is present.
const SEED = 1;
const CAM = { x: 35, z: 21335 };
/** A walker's eye at the census point, looking level down +z. */
const POSE: CullPose = { x: CAM.x, y: elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.7, z: CAM.z, yaw: 0, pitch: 0, roll: 0, fov: 1, aspect: 1.5 };

describe("bladeHeightScale", () => {
  it("draws floor grass under a closed canopy at three-quarter height, from one cut not two", () => {
    expect(BLADE_CANOPY_HEIGHT).toBe(1);
    expect(BLADE_STRENGTH_HEIGHT).toEqual([0.5, 1]);
    expect(bladeHeightScale(0.5, 1)).toBeCloseTo(0.75, 6);
    expect(bladeHeightScale(1, 1)).toBeCloseTo(1, 6);
    expect(bladeHeightScale(0, 0)).toBeCloseTo(0.5, 6);
    // the canopy no longer scales height on its own
    expect(bladeHeightScale(0.5, 0)).toBeCloseTo(bladeHeightScale(0.5, 1), 6);
  });
});

describe("the blade field's lists", () => {
  it("are one a tier, a character and a size, each cut to the view, with a tint and a strength and no fade bands", () => {
    const lists = createBladeLists(SEED);
    expect(lists.all.length).toBe(BLADE_TIER_COUNT * BLADE_CHARACTER_COUNT * BLADE_SIZE_COUNT);
    expect(lists.all[BLADE_CHARACTER_COUNT * BLADE_SIZE_COUNT + BLADE_SIZE_COUNT + 2]).toBe(lists.lists[1]![1]![2]);
    for (const list of lists.all) {
      expect(list.streams).toEqual({ bands: false, foliage: true, strength: true });
      expect(list.culled).toBe(true);
    }
    expect(Number.isNaN(lists.view.x)).toBe(true);
  });

  it("fill each list with its tier's cells of its character and size, nearest first, with the cards' matrix and tint and the cell's strength", () => {
    const lists = createBladeLists(SEED);
    finish(lists.rebuild(CAM.x, CAM.z));
    expect(lists.view).toEqual(CAM);
    const tiers = createBladeCollector(SEED).collect(CAM.x, CAM.z);
    const scratch = new Float32Array(16);
    const tint = new Float32Array(4);
    let listed = 0;
    for (const [tier, cells] of [tiers.fine, tiers.mid, tiers.coarse].entries()) {
      expect(cells.length).toBeGreaterThan(0);
      const cursor = new Map<InstanceList, number>();
      for (const c of cells as BladeCell[]) {
        const list = lists.lists[tier]![c.character]![c.size]!;
        const i = cursor.get(list) ?? 0;
        cursor.set(list, i + 1);
        listed++;
        // Spot-checked one cell in sixteen: each is several walks through the terrain's noise.
        if (listed % 16 !== 0) continue;
        const frame = trampleFrame(SEED, c);
        const scaled = { ...frame, height: frame.height * bladeHeightScale(c.strength, c.canopy) };
        writeFoliage(SEED, c, tint, 0, frame);
        instanceMatrixFor(c, scaled, scratch);
        expect([...list.buf.subarray(i * 16, i * 16 + 16)]).toEqual([...scratch]);
        expect([...list.foliage.subarray(i * 4, i * 4 + 4)]).toEqual([...tint]);
        expect(list.strength[i]).toBe(Math.fround(c.strength));
        expect([...list.origins.subarray(i * 3, i * 3 + 3)]).toEqual([scratch[12], scratch[13], scratch[14]]);
      }
      for (const [list, count] of cursor) expect(list.count).toBe(count);
    }
    expect(lists.all.reduce((sum, list) => sum + list.count, 0)).toBe(listed);
    // Every cell listed is kept once, however many tiers list it.
    expect(lists.kept).toBe(new Set([...tiers.fine, ...tiers.mid, ...tiers.coarse]).size);
  });

  it("are filled the same in slices cut at every reading of the scheduler's clock, over three crossings", () => {
    const whole = createBladeLists(SEED);
    const sliced = createBladeLists(SEED);
    let cut = 0;
    for (const [x, z] of [[CAM.x, CAM.z], [CAM.x + BLADE_REBUILD_CELL, CAM.z], [CAM.x + BLADE_REBUILD_CELL, CAM.z - BLADE_REBUILD_CELL]] as const) {
      finish(whole.rebuild(x, z));
      cut += runBySlices(sliced.rebuild(x, z)).slices;
      expect(sliced.view).toEqual(whole.view);
      expect(sliced.kept).toBe(whole.kept);
      sliced.all.forEach((list, i) => {
        const a = whole.all[i] as InstanceList;
        expect(list.count).toBe(a.count);
        for (const key of ["buf", "foliage"] as const) {
          const n = Math.min(list[key].length, a.count * 16);
          expect(Buffer.from(list[key].buffer, list[key].byteOffset, n * 4).equals(Buffer.from(a[key].buffer, a[key].byteOffset, n * 4))).toBe(true);
        }
        expect([...list.strength.subarray(0, a.count)]).toEqual([...a.strength.subarray(0, a.count)]);
      });
    }
    expect(cut).toBeGreaterThan(30);
  }, timeLimit(60_000));

  it("report each list whose drawn prefix changed: all of them after a rebuild, none for a view that stands, fewer for a view than for none", () => {
    const lists = createBladeLists(SEED);
    finish(lists.rebuild(CAM.x, CAM.z));
    const holding = lists.all.filter((list) => list.count > 0).length;
    const changed: number[] = [];
    const note = (_list: InstanceList, index: number): void => void changed.push(index);
    lists.cut(null, note);
    expect(changed.length).toBe(lists.all.length);
    expect(lists.all.every((list) => list.cull!.kept === list.count)).toBe(true);
    changed.length = 0;
    lists.cut(null, note);
    expect(changed).toEqual([]);
    // A camera looking one way keeps a part of what stands round it.
    lists.cut(POSE, note);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(holding);
    const kept = lists.all.reduce((sum, list) => sum + list.cull!.kept, 0);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(lists.all.reduce((sum, list) => sum + list.count, 0));
    changed.length = 0;
    lists.cut(POSE, note);
    expect(changed).toEqual([]);
    // A rebuild forgets the cut, whatever the view; so does handing the drawn buffers back.
    finish(lists.rebuild(CAM.x + BLADE_REBUILD_CELL, CAM.z));
    lists.cut(POSE, note);
    expect(changed.length).toBeGreaterThan(0);
    changed.length = 0;
    lists.forgetCuts();
    lists.cut(POSE, note);
    expect(changed.length).toBe(lists.all.filter((list) => list.drawn.buf.length > 0).length);
  });

  it("compute a cell's values once: a rebuild a cell away computes only what came into range, and idle work computes ahead", () => {
    const lists = createBladeLists(SEED);
    finish(lists.rebuild(CAM.x, CAM.z));
    const before = lists.kept;
    expect(before).toBeGreaterThan(0);
    finish(lists.rebuild(CAM.x + BLADE_REBUILD_CELL, CAM.z));
    const stepped = lists.kept;
    // A step of one cell brings a rim of cells into range, not the field again.
    expect(stepped - before).toBeLessThan(before / 4);
    finish(lists.prefetch(CAM.x + BLADE_REBUILD_CELL, CAM.z, 1, 0));
    expect(lists.kept).toBeGreaterThan(stepped);
  });
});
