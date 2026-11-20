// What a rebuild a crossing starts looks up and lifts: the collectors keep
// their squares and the rings their samples, so a step computes the strip it
// adds and no more. With no engine: these are the counts every shell's
// rebuild is made of.
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { collectBladeCells, createBladeCollector } from "../../src/game/bladeField.js";
import { createRingSamples, updateRingSamples } from "../../src/game/clipmap.js";
import { collectClutter, createClutterCollector } from "../../src/game/clutterField.js";
import { DUFF_REACH, collectDuffCells, createDuffCollector } from "../../src/game/duffField.js";
import { finish as finishSlices } from "@csarkosh/engine/game/syncJobs";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 1;

describe("rebuilds as jobs: what is computed", () => {
  it("lifts 766 vertices at a ring-0 step, where a ring made whole lifts every one", () => {
    // The step moves ring 0 by one snap (two cells) along x and nothing else.
    // Its new columns, the old border column, the new border column and the
    // two border rows are lifted (4 × 127 + 2 × 129); every other vertex is
    // interior to both rings and keeps its lift.
    const ring = createRingSamples(SEED, 0, 0.5, 0.5);
    expect(ring.lifted).toBe(129 * 129);
    expect(updateRingSamples(ring, SEED, 2.5, 0.5)).toBe(true);
    expect(ring.lifted).toBe(766);
  }, timeLimit(60_000));

  it("looks up 2,115 clutter cells a grass cell on, where a walk of every cell looks up 127,281", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(100.5, 100.5);
    expect(collector.walked).toBe(127281);
    const bands = collector.collect(103.5, 100.5);
    // The strips the fourteen classes' squares add, a column or a few each,
    // the meadow's 287 cells high since its far band.
    expect(collector.walked).toBe(2115);
    expect(bands).toEqual(collectClutter(SEED, 103.5, 100.5));
  }, timeLimit(60_000));

  it("looks up 164 blade cells and 54 duff cells a metre on, where a walk of every cell looks up 6,724 and 2,916", () => {
    const blades = createBladeCollector(SEED);
    blades.collect(35.5, 21335.5);
    expect(blades.walked).toBe(6724);
    const tiers = blades.collect(36.5, 21335.5);
    // Two columns of the half-metre lattice, 82 cells high.
    expect(blades.walked).toBe(164);
    expect(tiers).toEqual(collectBladeCells(SEED, 36.5, 21335.5));
    const duff = createDuffCollector(SEED);
    duff.collect(480.5, -599.5, DUFF_REACH.high);
    expect(duff.walked).toBe(2916);
    const pieces = duff.collect(481.5, -599.5, DUFF_REACH.high);
    // One column of the metre lattice, 54 cells high.
    expect(duff.walked).toBe(54);
    expect(pieces).toEqual(collectDuffCells(SEED, 481.5, -599.5, DUFF_REACH.high));
  }, timeLimit(60_000));

  it("looks up again, after a sweep, the cells it let go inside a square, and lists what a walk of every cell lists", () => {
    // The sweep lets go every cell whose nearest point is past the eviction
    // radius, and a square's corner cells can be: a walk of every cell looks
    // them up again at the next collect, and the collectors that keep their
    // squares must too, or they would list instances the cache no longer
    // holds.
    const blades = createBladeCollector(SEED);
    let x = 35.5;
    blades.collect(x, 21335.5);
    let size = blades.size;
    for (;;) {
      x += 1;
      blades.collect(x, 21335.5);
      if (blades.size < size) break;
      size = blades.size;
    }
    const swept = x;
    // The sweep 142 m on; the collect after it looks up the strip's 164
    // cells and the 300 the sweep let go in the square's corners.
    const tiers = blades.collect(x + 1, 21335.5);
    expect([swept, blades.walked]).toEqual([177.5, 464]);
    expect(tiers).toEqual(collectBladeCells(SEED, x + 1, 21335.5));
    expect(blades.collect(x + 2, 21335.5)).toEqual(collectBladeCells(SEED, x + 2, 21335.5));

    const clutter = createClutterCollector(SEED);
    let cx = 100.5;
    clutter.collect(cx, 100.5);
    size = clutter.size;
    for (;;) {
      cx += 3;
      clutter.collect(cx, 100.5);
      if (clutter.size < size) break;
      size = clutter.size;
    }
    // The sweep 150 m on (the meadow's square, 287 cells a side since its far
    // band, fills the cache sooner); the collect after it looks up the
    // fourteen strips and the corner cells the sweep let go, 14,985 in all,
    // most of them the meadow square's corners past its disc.
    const bands = clutter.collect(cx + 3, 100.5);
    expect([cx, clutter.walked]).toEqual([250.5, 14985]);
    expect(bands).toEqual(collectClutter(SEED, cx + 3, 100.5));
  }, timeLimit(120_000));

  it("looks up ahead the strip the next collect adds, which then samples nothing and lists what a walk of every cell lists", () => {
    // Walking along +x: the next collects are those of the first frame past
    // the next grass-cell line (102 m) and the next metre line (36 m).
    const clutter = createClutterCollector(SEED);
    clutter.collect(100.5, 100.5);
    const cold = clutter.size;
    finishSlices(clutter.prefetchSlices(100.5, 100.5, 0.0875, 0, 1));
    const ahead = clutter.size;
    const bands = clutter.collect(102.05, 100.5);
    expect([ahead - cold, clutter.size - ahead]).toEqual([1171, 0]);
    expect(bands).toEqual(collectClutter(SEED, 102.05, 100.5));

    const blades = createBladeCollector(SEED);
    blades.collect(35.5, 21335.5);
    const found: unknown[] = [];
    finishSlices(blades.prefetchSlices(35.5, 21335.5, 0.0875, 0, (c) => {
      found.push(c);
      return 1;
    }));
    const size = blades.size;
    const tiers = blades.collect(36.05, 21335.5);
    expect([found.length, blades.size - size]).toEqual([77, 0]);
    expect(tiers).toEqual(collectBladeCells(SEED, 36.05, 21335.5));
  }, timeLimit(60_000));
});
