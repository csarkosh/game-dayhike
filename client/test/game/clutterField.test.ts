import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import {
  CLUTTER_BLADE_HANDOFF, CLUTTER_BUDGETS, CLUTTER_FADE_FRACTION, CLUTTER_MEADOW_NEAR_IN,
  CLUTTER_FADE_MIN_RAMP, CLUTTER_FAR_SPLIT, CLUTTER_RADII, COLLECTOR_SWEEP_SIZE, clutterFadeEdges,
  clutterSeamEdges, collectClutter, collectClutterWithBudgets, createClutterCollector,
} from "../../src/game/clutterField.js";
import {
  CLUTTER_CLASS_COUNT, clutterCell, CLUTTER_DRIFTWOOD, CLUTTER_GRASS, CLUTTER_GRASS_CELL, CLUTTER_JITTER,
  CLUTTER_MEADOW,
} from "../../src/sim/clutter.js";

const SEED = 0x5eed;
const CAM = { x: 1800.5, z: -950.5 }; // inland mixed ground, verified non-empty

describe("clutter band properties", () => {
  it("carries a radius and a budget for every class", () => {
    expect(CLUTTER_RADII.length).toBe(CLUTTER_CLASS_COUNT);
    expect(CLUTTER_BUDGETS.length).toBe(CLUTTER_CLASS_COUNT);
  });

  it("dithers the meadow's near cards in from the eye, clear of the seam", () => {
    // Under the blade field the meadow's near cards are the cover and the
    // blades the detail. Inside 1 m a card would stand as a flat plane at the
    // feet, so it is absent there and thickens in by 2.5 m, where the fine
    // blade tier is densest. The in-band ends well inside the seam's start.
    expect(CLUTTER_MEADOW_NEAR_IN).toEqual([1, 2.5]);
    expect(clutterSeamEdges(CLUTTER_MEADOW).start).toBeGreaterThan(2.5);
  });

  it("budget clears the hard geometric ceiling for every class but driftwood", () => {
    // The CLUTTER_BUDGETS comment claims every budget clears the
    // jitter-inclusive HARD ceiling (π·r²/cell²) specifically, not merely
    // the weaker of the hard/mean-density pair — so assert against hard.
    // Driftwood is the documented exception: its budget deliberately sits
    // below both because the coastal strip is far narrower than its disc
    // (see the CLUTTER_BUDGETS comment).
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      if (cls === CLUTTER_DRIFTWOOD) continue;
      const r = CLUTTER_RADII[cls]!;
      const cell = clutterCell(cls);
      // Cells whose centres lie up to √2·(CLUTTER_JITTER/2)·cell past the
      // radius can still land an instance inside the disc (the jitter can
      // pull it back in), so the true hard ceiling widens the radius by
      // that amount before squaring — not the bare π·r²/cell².
      const hard = (Math.PI * Math.pow(r + Math.SQRT2 * (CLUTTER_JITTER / 2) * cell, 2)) / (cell * cell);
      expect(CLUTTER_BUDGETS[cls]!).toBeGreaterThanOrEqual(hard);
    }
  });
});

describe("edge fade ramp", () => {
  it("carries a fraction for every class, inside (0, 1)", () => {
    expect(CLUTTER_FADE_FRACTION.length).toBe(CLUTTER_CLASS_COUNT);
    for (const f of CLUTTER_FADE_FRACTION) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("ends at the scaled radius and starts a fraction inside it", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const { start, end } = clutterFadeEdges(cls);
      expect(end).toBe(CLUTTER_RADII[cls]);
      expect(start).toBeCloseTo(end * (1 - CLUTTER_FADE_FRACTION[cls]!), 9);
      expect(start).toBeLessThan(end);
      const low = clutterFadeEdges(cls, 0.6);
      expect(low.end).toBeCloseTo(end * 0.6, 9);
      expect(low.start).toBeLessThan(low.end);
    }
  });

  it("gives the meadow a ramp wider than the disc boundary's snap jitter", () => {
    // The disc snaps to the grass cell, not the eye, so its boundary sits up
    // to √2·CELL past or short of the eye's own edge. The ramp must cover it
    // or the jitter shows as instances appearing at non-zero weight, on
    // every quality tier — not just full scale (1), where the fractional
    // ramp already clears it, but also the low tier (0.6), where it would
    // not without the floor.
    const full = clutterFadeEdges(CLUTTER_MEADOW);
    expect(full.end - full.start).toBeGreaterThan(Math.SQRT2 * CLUTTER_GRASS_CELL);
    // Meadow radius 20 → 40, so end/start move 20/14 → 40/28.
    expect(full.end).toBe(40);
    expect(full.start).toBe(28);

    const low = clutterFadeEdges(CLUTTER_MEADOW, 0.6);
    // At the grown 40 m radius the low tier is no longer floor-bound: its
    // own fractional term (end 24 · (1 − 0.3) = 16.8) already clears
    // CLUTTER_FADE_MIN_RAMP (4.24 m) on its own, so clutterFadeEdges's
    // Math.min takes the fractional branch, not the floor — unlike the old
    // 20 m radius, where this exact case was the floor. Still comfortably
    // wider than the jitter, just not pinned to it; the floor property
    // itself is covered generically by the "floors every class's low-tier
    // ramp" test below.
    expect(low.end).toBe(24);
    expect(low.start).toBeCloseTo(16.8, 9);
    expect(low.end - low.start).toBeGreaterThan(Math.SQRT2 * CLUTTER_GRASS_CELL);
  });

  it("floors every class's low-tier ramp at the jitter minimum, leaving the classes already above it unchanged", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const { start, end } = clutterFadeEdges(cls, 0.6);
      expect(end - start).toBeGreaterThanOrEqual(CLUTTER_FADE_MIN_RAMP - 1e-9);
    }
    // Grass's fractional ramp (0.2 · end) already exceeds the floor at 0.6,
    // so it is untouched by the Math.min clamp.
    const grass = clutterFadeEdges(CLUTTER_GRASS, 0.6);
    expect(grass.start).toBe(grass.end * 0.8);
  });
});

describe("near/far seam", () => {
  it("ends at the split and starts 15% of the near disc inside it, floored at the jitter width", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const { start, end } = clutterSeamEdges(cls);
      const split = CLUTTER_RADII[cls]! * CLUTTER_FAR_SPLIT;
      expect(end).toBeCloseTo(split, 9);
      expect(end - start).toBeGreaterThanOrEqual(CLUTTER_FADE_MIN_RAMP - 1e-9);
      expect(start).toBeLessThan(end);
      const low = clutterSeamEdges(cls, 0.6);
      expect(low.end).toBeCloseTo(split * 0.6, 9);
      expect(low.end - low.start).toBeGreaterThanOrEqual(CLUTTER_FADE_MIN_RAMP - 1e-9);
    }
    const grass = clutterSeamEdges(CLUTTER_GRASS);
    expect(grass.start).toBeCloseTo(grass.end * 0.85, 9); // 15% of a 33.75 m near disc clears the floor
    // The meadow's seam is the blade field's hand-off: it opens to
    // CLUTTER_BLADE_HANDOFF so the swap from blades to card tufts plays out
    // as a fade rather than a line, and it scales with the tier's disc.
    const meadow = clutterSeamEdges(CLUTTER_MEADOW);
    expect(meadow.end).toBeCloseTo(18, 9);
    expect(meadow.start).toBeCloseTo(meadow.end - CLUTTER_BLADE_HANDOFF, 9);
    const meadowLow = clutterSeamEdges(CLUTTER_MEADOW, 0.6);
    expect(meadowLow.start).toBeCloseTo(meadowLow.end - CLUTTER_BLADE_HANDOFF * 0.6, 9);
    expect(meadowLow.start).toBeGreaterThan(0);
  });

  it("emits an instance inside the padded seam to BOTH bands, and nothing else twice", () => {
    const bands = collectClutter(SEED, 2500, 2500);
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const { near, far } = bands[cls]!;
      const key = (i: { x: number; z: number }) => `${i.x}:${i.z}`;
      const nearKeys = new Set(near.map(key));
      const farKeys = new Set(far.map(key));
      const both = far.filter((i) => nearKeys.has(key(i)));
      const seam = clutterSeamEdges(cls);
      const split = CLUTTER_RADII[cls]! * CLUTTER_FAR_SPLIT;
      const cell = clutterCell(cls);
      const ax = Math.floor(2500 / cell) * cell;
      const az = Math.floor(2500 / cell) * cell;
      for (const i of both) {
        const d = Math.hypot(i.x - ax, i.z - az);
        expect(d).toBeGreaterThanOrEqual(seam.start - CLUTTER_FADE_MIN_RAMP - 1e-9);
        expect(d).toBeLessThan(seam.end + CLUTTER_FADE_MIN_RAMP + 1e-9);
      }
      // Forward direction, both ways — fixed from a tautological self-check
      // that only verified one direction: a near instance inside the padded low
      // side of the seam must also be in far, and a far instance inside the
      // padded high side must also be in near, i.e. no seam-band instance
      // is ever in only one list.
      for (const i of near) {
        const d = Math.hypot(i.x - ax, i.z - az);
        if (d >= seam.start - CLUTTER_FADE_MIN_RAMP && d < split) expect(farKeys.has(key(i))).toBe(true);
      }
      for (const i of far) {
        const d = Math.hypot(i.x - ax, i.z - az);
        if (d >= split && d < seam.end + CLUTTER_FADE_MIN_RAMP) expect(nearKeys.has(key(i))).toBe(true);
      }
    }
  });
});

describe("clutter bands", () => {
  it("assigns every instance to the right band by distance", () => {
    const bands = collectClutter(SEED, CAM.x, CAM.z);
    expect(bands.length).toBe(CLUTTER_CLASS_COUNT);
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const r = CLUTTER_RADII[cls]!;
      const seam = clutterSeamEdges(cls);
      // Seam duplication: an instance inside the padded seam
      // band around clutterSeamEdges is emitted to BOTH near and far, so near
      // can now extend past the bare split out to seam.end +
      // CLUTTER_FADE_MIN_RAMP, and far can start as close in as seam.start -
      // CLUTTER_FADE_MIN_RAMP. The extra +/- clutterCell(cls) slack is
      // unrelated to the seam: distances here are measured from raw CAM, but
      // the field walk measures from each class's own cell-snapped origin, up
      // to one cell away (see the "clamps to budget" test below).
      for (const inst of bands[cls]!.near) {
        const d = Math.hypot(inst.x - CAM.x, inst.z - CAM.z);
        expect(d).toBeLessThanOrEqual(seam.end + CLUTTER_FADE_MIN_RAMP + clutterCell(cls));
      }
      for (const inst of bands[cls]!.far) {
        const d = Math.hypot(inst.x - CAM.x, inst.z - CAM.z);
        expect(d).toBeGreaterThan(seam.start - CLUTTER_FADE_MIN_RAMP - clutterCell(cls));
        expect(d).toBeLessThanOrEqual(r + clutterCell(cls));
      }
    }
  });

  it("clamps to budget far-tail-first", () => {
    const bands = collectClutter(SEED, CAM.x, CAM.z);
    const posKey = (inst: { x: number; z: number }) => `${inst.x},${inst.z}`;
    // Budget bounds UNIQUE instances, not list entries: a
    // seam duplicate holds one entry in each of near/far, so counting
    // concatenated entries can legitimately run past the budget even though
    // the walk kept at most `budget` unique instances — de-dup by position
    // before counting.
    const uniqueOf = (list: { x: number; z: number }[]) => {
      const seen = new Set<string>();
      const out: { x: number; z: number }[] = [];
      for (const inst of list) {
        const k = posKey(inst);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(inst);
        }
      }
      return out;
    };
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const unique = uniqueOf([...bands[cls]!.near, ...bands[cls]!.far]);
      expect(unique.length).toBeLessThanOrEqual(CLUTTER_BUDGETS[cls]!);
    }

    // CAM's real load clears every real budget with margin (measured), so
    // none of the above actually clamps. Force the clamp to bind, through
    // the SAME clamp logic collectClutter runs, via a tiny synthetic budget
    // — collectClutterWithBudgets is exported test-only for exactly this.
    // "Drop the over-budget sort (clamp without ordering)" would still pass
    // every count-bound check above (and the total === TINY_BUDGET check
    // below) while scrambling which instances survive; the ordering
    // assertion below is what catches that mutant.
    const TINY_BUDGET = 5;
    const tinyBudgets = CLUTTER_BUDGETS.map(() => TINY_BUDGET);
    const full = bands; // unclamped at CAM against every real budget
    const tiny = collectClutterWithBudgets(SEED, CAM.x, CAM.z, tinyBudgets);
    const dist = (inst: { x: number; z: number }) => Math.hypot(inst.x - CAM.x, inst.z - CAM.z);
    let clampedSomeClass = false;
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      // Unique instances again, both sides: a seam pair kept by the clamp
      // shows up as two entries in `kept` (one per band), which would
      // otherwise look like two kept instances instead of one.
      const fullAll = uniqueOf([...full[cls]!.near, ...full[cls]!.far]);
      if (fullAll.length <= TINY_BUDGET) continue; // this class didn't clamp even at TINY_BUDGET
      clampedSomeClass = true;
      const kept = uniqueOf([...tiny[cls]!.near, ...tiny[cls]!.far]);
      expect(kept.length).toBe(TINY_BUDGET);
      const keptPositions = new Set(kept.map(posKey));
      const dropped = fullAll.filter((inst) => !keptPositions.has(posKey(inst)));
      expect(dropped.length).toBe(fullAll.length - TINY_BUDGET);
      const maxKept = Math.max(...kept.map(dist));
      const minDropped = Math.min(...dropped.map(dist));
      // Slack of one class cell, exactly like the band-assignment test above:
      // ordering is decided against the class's own cell-snapped origin, not
      // raw CAM, so a real, correctly-ordered clamp can still show a small
      // gap here.
      expect(maxKept).toBeLessThanOrEqual(minDropped + clutterCell(cls));
    }
    expect(clampedSomeClass).toBe(true); // guard: the forced clamp actually fired somewhere
  });

  it("keeps a seam pair in both bands across the budget clamp", () => {
    // A single TINY_BUDGET applied to every class (the "clamps to budget
    // far-tail-first" test's own shape) does NOT reach this bug: at CAM
    // every class's near count is in the hundreds, so the 5 closest
    // instances of any class sit well inside the split, nowhere near the
    // seam where duplicates live — measured, that shape alone never
    // exercises the defect this test targets. Instead, size each class's synthetic
    // budget to its own (real, unclamped) near count: `near.length >=
    // budget` then holds for every class by construction, landing
    // deterministically on the clamp's near-saturated branch — the one
    // this defect hits first ("far.length = 0 … wipes every far entry —
    // including the far half of a seam pair whose near half survives").
    const full = collectClutter(SEED, CAM.x, CAM.z);
    const budgets = full.map((b) => b.near.length);
    const clamped = collectClutterWithBudgets(SEED, CAM.x, CAM.z, budgets);
    const key = (i: { x: number; z: number }) => `${i.x}:${i.z}`;
    let exercisedSomeClass = false;
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      if (full[cls]!.far.length === 0) continue; // nothing a far-wipe could have broken
      exercisedSomeClass = true;
      const { near, far } = clamped[cls]!;
      const nearKeys = new Set(near.map(key));
      const farKeys = new Set(far.map(key));
      const seam = clutterSeamEdges(cls);
      const split = CLUTTER_RADII[cls]! * CLUTTER_FAR_SPLIT;
      const cell = clutterCell(cls);
      const ax = Math.floor(CAM.x / cell) * cell;
      const az = Math.floor(CAM.z / cell) * cell;
      for (const i of near) {
        const d = Math.hypot(i.x - ax, i.z - az);
        if (d >= seam.start - CLUTTER_FADE_MIN_RAMP && d < split) expect(farKeys.has(key(i))).toBe(true);
      }
      for (const i of far) {
        const d = Math.hypot(i.x - ax, i.z - az);
        if (d >= split && d < seam.end + CLUTTER_FADE_MIN_RAMP) expect(nearKeys.has(key(i))).toBe(true);
      }
    }
    expect(exercisedSomeClass).toBe(true); // guard: the budget-bound scenario actually applied somewhere
  });

  it("memoized collector agrees with the pure function and reuses cells", () => {
    const collector = createClutterCollector(SEED);
    const a = collector.collect(CAM.x, CAM.z);
    const b = collectClutter(SEED, CAM.x, CAM.z);
    expect(a).toEqual(b);
    // A second collect from the same cell-snapped origin is identity-stable.
    const c = collector.collect(CAM.x + 0.4, CAM.z + 0.4);
    expect(c).toEqual(a);
  });

  it("radiusScale shrinks every band (the quality-tier hook)", () => {
    const full = collectClutter(SEED, CAM.x, CAM.z);
    const low = collectClutter(SEED, CAM.x, CAM.z, 0.6);
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const nf = full[cls]!.near.length + full[cls]!.far.length;
      const nl = low[cls]!.near.length + low[cls]!.far.length;
      expect(nl).toBeLessThanOrEqual(nf);
    }
  });

  it("keeps the cold cache comfortably under the eviction-sweep threshold, with margin", () => {
    // Regression guard: the OLD threshold (20000) sat BELOW the cold cache's
    // own size (the full circumscribing-square total across all eight
    // classes, camera-independent — 26,837 measured against the current
    // radii, see the COLLECTOR_SWEEP_SIZE doc comment), so the eviction
    // sweep ran on literally every collect instead of periodically. This
    // pins the fix's actual shape: a cold collect stays well under the
    // (now-raised) threshold, with real margin for leading-edge growth to
    // accumulate before the next sweep — not just barely under it.
    const collector = createClutterCollector(SEED);
    collector.collect(1, 1);
    expect(collector.size).toBeGreaterThan(25000); // guard: a real, large cold disc
    expect(collector.size).toBeLessThan(COLLECTOR_SWEEP_SIZE);
    // Margin: at least ~50 crossings' worth (measured ~770 entries/crossing)
    // of headroom remains before the threshold binds.
    expect(COLLECTOR_SWEEP_SIZE - collector.size).toBeGreaterThan(50 * 770);
  });

  it("carries only the near and far lists per class", () => {
    const bands = collectClutter(SEED, CAM.x, CAM.z);
    for (const band of bands) expect(Object.keys(band).sort()).toEqual(["far", "near"]);
  });
});
