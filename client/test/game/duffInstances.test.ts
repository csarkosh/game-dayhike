import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { CLUTTER_SINK, instanceMatrixFor, trampleFrame, writeFoliage } from "@csarkosh/engine/game/clutterInstances";
import { DUFF_CHARACTER_COUNT } from "@csarkosh/engine/game/duffClump";
import { DUFF_REACH, DUFF_REBUILD_CELL, createDuffCollector, type DuffCell } from "@csarkosh/engine/game/duffField";
import { DUFF_ROUGHNESS, DUFF_TIER_COUNT, createDuffLists } from "@csarkosh/engine/game/duffInstances";
import type { InstanceList } from "@csarkosh/engine/game/instanceLists";
import { finish } from "@csarkosh/engine/game/syncJobs";

const SEED = 1;
const CAM = { x: 35, z: 21335 };

describe("the duff field's lists", () => {
  it("are one a tier and a character, with a tint and a strength, no fade bands and no cut to the view", () => {
    const lists = createDuffLists(SEED, DUFF_REACH.high);
    expect(lists.all.length).toBe(DUFF_TIER_COUNT * DUFF_CHARACTER_COUNT);
    expect(lists.all[DUFF_CHARACTER_COUNT + 1]).toBe(lists.lists[1]![1]);
    for (const list of lists.all) {
      expect(list.streams).toEqual({ bands: false, foliage: true, strength: true });
      expect(list.culled).toBe(false);
    }
    expect(DUFF_ROUGHNESS).toBe(0.9);
  });

  it("fill each list with its tier's cells of its character, nearest first, each lying on the ground with its tint and its strength", () => {
    const lists = createDuffLists(SEED, DUFF_REACH.high);
    finish(lists.rebuild(CAM.x, CAM.z));
    expect(lists.view).toEqual(CAM);
    const tiers = createDuffCollector(SEED).collect(CAM.x, CAM.z, DUFF_REACH.high);
    const scratch = new Float32Array(16);
    const tint = new Float32Array(4);
    let listed = 0;
    for (const [tier, cells] of [tiers.near, tiers.far].entries()) {
      expect(cells.length).toBeGreaterThan(0);
      const cursor = new Map<InstanceList, number>();
      for (const c of cells as DuffCell[]) {
        const list = lists.lists[tier]![c.character]!;
        const i = cursor.get(list) ?? 0;
        cursor.set(list, i + 1);
        listed++;
        if (listed % 8 !== 0) continue;
        const frame = trampleFrame(SEED, c);
        instanceMatrixFor(c, frame, scratch);
        // The cards' two-centimetre sink is taken back: a piece's root ring lies at the ground's own height.
        scratch[13] = (scratch[13] as number) + CLUTTER_SINK;
        writeFoliage(SEED, c, tint, 0, frame);
        expect([...list.buf.subarray(i * 16, i * 16 + 16)]).toEqual([...scratch]);
        expect(list.buf[i * 16 + 13]).toBeCloseTo(c.groundH, 4);
        expect([...list.foliage.subarray(i * 4, i * 4 + 4)]).toEqual([...tint]);
        expect(list.strength[i]).toBe(Math.fround(c.strength));
      }
      for (const [list, count] of cursor) expect(list.count).toBe(count);
    }
    expect(lists.all.reduce((sum, list) => sum + list.count, 0)).toBe(listed);
    expect(lists.kept).toBe(new Set([...tiers.near, ...tiers.far]).size);
  });

  it("list fewer cells at a shorter reach, and say which lists outgrew their arrays", () => {
    const high = createDuffLists(SEED, DUFF_REACH.high);
    const medium = createDuffLists(SEED, DUFF_REACH.medium);
    finish(high.rebuild(CAM.x, CAM.z));
    finish(medium.rebuild(CAM.x, CAM.z));
    const count = (lists: typeof high): number => lists.all.reduce((sum, list) => sum + list.count, 0);
    expect(count(medium)).toBeLessThan(count(high));
    // The first fill of a list that holds a cell takes its arrays; a step of a metre fills the same arrays again.
    expect(high.all.filter((list) => list.count > 0).every((list) => list.grown)).toBe(true);
    const before = high.kept;
    finish(high.rebuild(CAM.x + DUFF_REBUILD_CELL, CAM.z));
    expect(high.all.some((list) => list.grown)).toBe(false);
    expect(high.kept - before).toBeLessThan(before / 4);
  });
});
