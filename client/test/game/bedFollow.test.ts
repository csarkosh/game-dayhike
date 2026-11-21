import { beforeAll, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import "@csarkosh/engine/sim/olympic";
import { setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { BED_ROWS_PER_FRAME, createBedFollow } from "@csarkosh/engine/game/bedFollow";
import { BED_GRID, bakeBed, bedOriginFor, createBedGrid } from "@csarkosh/engine/game/bedHeight";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 0x5eed;
beforeAll(() => setActiveTerrainVariant("olympic"));

describe("the bed's square following the camera", { timeout: timeLimit(60_000) }, () => {
  it("is filled at once where it is made, at the tier's size", () => {
    const bed = createBedFollow("low", SEED, [], 0, 10, -20);
    expect([bed.texels, bed.spacing]).toEqual([BED_GRID.low.texels, BED_GRID.low.spacing]);
    const whole = createBedGrid(bed.texels, bed.spacing);
    bakeBed(whole, SEED, 10, -20);
    expect([bed.grid.originX, bed.grid.originZ]).toEqual([whole.originX, whole.originZ]);
    expect(bed.grid.heights).toEqual(whole.heights);
  });

  it("takes a grid baked ahead as its own, and fills it again at once if the first frame's camera is outside it", () => {
    const ahead = createBedGrid(BED_GRID.low.texels, BED_GRID.low.spacing);
    bakeBed(ahead, SEED, 0, 0);
    const bed = createBedFollow("low", SEED, [], 0, 0, 0, ahead);
    expect(bed.grid).toBe(ahead);
    expect(bed.step(0, 0)).toBe(false);
    const far = createBedFollow("low", SEED, [], 0, 0, 0, ahead);
    expect(far.step(5000, 5000)).toBe(true);
    expect(far.grid.originX).toBe(bedOriginFor(5000, far.texels, far.spacing));
  });

  it("keeps its square where no water can reach the next one", () => {
    // A sea far below every ground and no lake: no square has water.
    const bed = createBedFollow("low", SEED, [], -1e9, 0, 0);
    const grid = bed.grid;
    bed.step(0, 0);
    for (let frame = 0; frame < 3 * BED_GRID.low.texels; frame++) expect(bed.step(100, 0)).toBe(false);
    expect(bed.grid).toBe(grid);
  });

  it("bakes the next square a row a frame into its spare grid, and swaps it in whole", () => {
    // A sea over every ground: every square has water.
    const bed = createBedFollow("low", SEED, [], 1e9, 0, 0);
    const first = bed.grid;
    bed.step(0, 0);
    const rows = BED_GRID.low.texels / BED_ROWS_PER_FRAME;
    for (let frame = 1; frame < rows; frame++) expect(bed.step(100, 0), `frame ${frame}`).toBe(false);
    expect(bed.grid).toBe(first);
    expect(bed.step(100, 0)).toBe(true);
    expect(bed.grid).not.toBe(first);
    const whole = createBedGrid(bed.texels, bed.spacing);
    bakeBed(whole, SEED, 100, 0);
    expect([bed.grid.originX, bed.grid.originZ]).toEqual([whole.originX, whole.originZ]);
    expect(bed.grid.heights).toEqual(whole.heights);
  });

  it("starts over when the camera leaves the square a bake is for", () => {
    const bed = createBedFollow("low", SEED, [], 1e9, 0, 0);
    bed.step(0, 0);
    for (let frame = 0; frame < 20; frame++) bed.step(100, 0);
    // A teleport: the bake for the square about (100, 0) is dropped, and one for the new place runs its whole length.
    const rows = BED_GRID.low.texels / BED_ROWS_PER_FRAME;
    for (let frame = 1; frame < rows; frame++) expect(bed.step(3000, 3000)).toBe(false);
    expect(bed.step(3000, 3000)).toBe(true);
    expect(bed.grid.originX).toBe(bedOriginFor(3000, bed.texels, bed.spacing));
  });
});
