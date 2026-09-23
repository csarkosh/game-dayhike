import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { CLUTTER_MEADOW, groundCover } from "../../src/sim/clutter.js";
import { CLUTTER_FAR_SPLIT, CLUTTER_RADII, clutterSeamEdges } from "../../src/game/clutterField.js";
import {
  BLADE_CELL, BLADE_CHARACTER_COUNT, BLADE_CHARACTER_WEIGHTS, BLADE_FINE, BLADE_FLOWER, BLADE_FLOWER_MIN_STRENGTH,
  BLADE_FULL_BAND, BLADE_PAD, BLADE_REACH, BLADE_REBUILD_CELL, BLADE_SIZE_BASE, BLADE_SIZE_FULL, BLADE_SIZE_THIN,
  BLADE_STRENGTH_FLOOR, BLADE_THIN_BAND, BLADE_TIER_BAND, BLADE_TIER_EDGE,
  bladeCellAt, bladeCharacterFor, bladeSizeFor, bladeTierBands, collectBladeCells, createBladeCollector, type BladeCell,
} from "../../src/game/bladeField.js";

// An open-field point where the grass gate is high across a wide neighbourhood
// (the census point clutter.test.ts uses), so every tier holds cells.
const SEED = 1;
const CAM = { x: 35, z: 21335 };

function d2From(ox: number, oz: number, c: { x: number; z: number }): number {
  return (c.x - ox) ** 2 + (c.z - oz) ** 2;
}
function origin(v: number): number {
  return Math.floor(v / BLADE_CELL) * BLADE_CELL;
}

describe("the blade field's constants", () => {
  it("reaches the meadow's own near/far split and pads for a 1 m rebuild on a 0.5 m lattice", () => {
    expect(BLADE_REACH).toBe(CLUTTER_RADII[CLUTTER_MEADOW]! * CLUTTER_FAR_SPLIT);
    expect(BLADE_REACH).toBe(18);
    expect(BLADE_PAD).toBeCloseTo(Math.SQRT2 * (BLADE_REBUILD_CELL + BLADE_CELL), 12);
    expect(BLADE_TIER_EDGE).toEqual([4, 8]);
    expect(BLADE_TIER_BAND).toBe(1.5);
  });

  it("hands off fine → mid → coarse → cards over the spec's bands, the last being the meadow seam", () => {
    const [fine, mid, coarse] = bladeTierBands();
    expect(fine.slice(2)).toEqual([BLADE_TIER_EDGE[0] - BLADE_TIER_BAND, BLADE_TIER_EDGE[0]]);
    expect(fine[0]).toBeLessThan(fine[1]);
    expect(fine[1]).toBeLessThan(0); // a no-op in-band: every distance is past it
    expect(mid).toEqual([BLADE_TIER_EDGE[0] - BLADE_TIER_BAND, BLADE_TIER_EDGE[0], BLADE_TIER_EDGE[1] - BLADE_TIER_BAND, BLADE_TIER_EDGE[1]]);
    const seam = clutterSeamEdges(CLUTTER_MEADOW);
    expect(coarse).toEqual([BLADE_TIER_EDGE[1] - BLADE_TIER_BAND, BLADE_TIER_EDGE[1], seam.start, seam.end]);
  });

  it("picks characters by the spec's weights, and flowers only in thick grass", () => {
    expect(BLADE_CHARACTER_WEIGHTS).toEqual([0.6, 0.2, 0.12, 0.08]);
    expect(BLADE_CHARACTER_COUNT).toBe(4);
    const counts = new Array<number>(BLADE_CHARACTER_COUNT).fill(0);
    const n = 10000;
    for (let i = 0; i < n; i++) counts[bladeCharacterFor(i / n, 1)]!++;
    for (let c = 0; c < BLADE_CHARACTER_COUNT; c++) expect(counts[c]! / n).toBeCloseTo(BLADE_CHARACTER_WEIGHTS[c]!, 2);
    for (let i = 0; i < n; i++) expect(bladeCharacterFor(i / n, BLADE_FLOWER_MIN_STRENGTH - 0.01)).not.toBe(BLADE_FLOWER);
    expect(bladeCharacterFor(0.99, 1)).toBe(BLADE_FLOWER);
    expect(bladeCharacterFor(0.1, 0.1)).toBe(BLADE_FINE);
  });

  it("sizes a clump by its cover, dithered across the spec's bands so no contour forms", () => {
    expect(BLADE_THIN_BAND).toEqual([0.4, 0.6]);
    expect(BLADE_FULL_BAND).toEqual([1.0, 1.25]);
    // Outside both bands the choice is certain.
    for (let d = 0; d < 1; d += 0.05) {
      expect(bladeSizeFor(d, 0.2)).toBe(BLADE_SIZE_THIN);
      expect(bladeSizeFor(d, 0.8)).toBe(BLADE_SIZE_BASE);
      expect(bladeSizeFor(d, 1.5)).toBe(BLADE_SIZE_FULL);
    }
    // Inside a band the thin (or full) share falls (rises) monotonically and
    // continuously with cover: over 200 draws per step, no step of the share
    // is larger than 0.15.
    const share = (cover: number, size: number): number => {
      let n = 0;
      for (let i = 0; i < 200; i++) if (bladeSizeFor((i + 0.5) / 200, cover) === size) n++;
      return n / 200;
    };
    let prev = share(0.35, BLADE_SIZE_THIN);
    expect(prev).toBe(1);
    for (let c = 0.36; c <= 0.65; c += 0.01) {
      const cur = share(c, BLADE_SIZE_THIN);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - cur).toBeLessThan(0.15);
      prev = cur;
    }
    expect(prev).toBe(0);
    prev = share(0.95, BLADE_SIZE_FULL);
    expect(prev).toBe(0);
    for (let c = 0.96; c <= 1.3; c += 0.01) {
      const cur = share(c, BLADE_SIZE_FULL);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(cur - prev).toBeLessThan(0.15);
      prev = cur;
    }
    expect(prev).toBe(1);
  });
});

describe("one cell", () => {
  it("carries the sim's grass gate as its strength, the terrain under it, and is deterministic", () => {
    const ci = Math.floor(CAM.x / BLADE_CELL), cj = Math.floor(CAM.z / BLADE_CELL);
    const a = bladeCellAt(SEED, ci, cj);
    expect(a).not.toBeNull();
    const c = a as BladeCell;
    expect(c.cover).toBeCloseTo(groundCover(SEED, c.x, c.z).grass, 9);
    expect(c.strength).toBe(Math.min(1, c.cover));
    expect(c.size).toBe(bladeSizeFor(c.sizeDraw, c.cover));
    expect(c.strength).toBeGreaterThanOrEqual(BLADE_STRENGTH_FLOOR);
    // Jittered inside its own cell.
    expect(c.x).toBeGreaterThanOrEqual(ci * BLADE_CELL);
    expect(c.x).toBeLessThan((ci + 1) * BLADE_CELL);
    expect(c.z).toBeGreaterThanOrEqual(cj * BLADE_CELL);
    expect(c.z).toBeLessThan((cj + 1) * BLADE_CELL);
    expect(c.cls).toBe(CLUTTER_MEADOW);
    expect(c.scale).toBe(1);
    expect(c.variant).toBe(0);
    expect(c.hash).toBeGreaterThanOrEqual(0);
    expect(c.hash).toBeLessThan(1);
    expect(c.character).toBe(bladeCharacterFor(c.characterDraw, c.strength));
    expect(bladeCellAt(SEED, ci, cj)).toEqual(a);
  });

  it("emits nothing where the gate is under the floor, and every emitted cell clears it", () => {
    // A 100 m × 100 m window around the census point: the trail bed inside
    // it clears the grass gate to 0, so some cells are null; every cell that
    // is not null clears the floor.
    const ci0 = Math.floor(CAM.x / BLADE_CELL) - 100, cj0 = Math.floor(CAM.z / BLADE_CELL) - 100;
    let nulls = 0, cells = 0;
    for (let ci = ci0; ci < ci0 + 200; ci += 2) {
      for (let cj = cj0; cj < cj0 + 200; cj += 2) {
        const c = bladeCellAt(SEED, ci, cj);
        if (c === null) {
          nulls++;
          // The jitter moves the sample by at most 0.2 m from the cell centre.
          const x = (ci + 0.5) * BLADE_CELL, z = (cj + 0.5) * BLADE_CELL;
          expect(groundCover(SEED, x, z).grass).toBeLessThan(0.5);
        } else {
          cells++;
          expect(c.strength).toBeGreaterThanOrEqual(BLADE_STRENGTH_FLOOR);
        }
      }
    }
    expect(cells).toBeGreaterThan(1000);
    // Not asserted > 0: whether a null cell falls inside this window is the
    // world's business; the gate test above is what matters.
    void nulls;
  });
});

describe("the tiers", () => {
  const tiers = collectBladeCells(SEED, CAM.x, CAM.z);
  const ox = origin(CAM.x), oz = origin(CAM.z);

  it("holds every cell of the disc exactly once per tier it belongs to, nearest first", () => {
    const [e0, e1] = BLADE_TIER_EDGE;
    const lists: [BladeCell[], number, number][] = [
      [tiers.fine, 0, e0 + BLADE_PAD],
      [tiers.mid, e0 - BLADE_TIER_BAND - BLADE_PAD, e1 + BLADE_PAD],
      [tiers.coarse, e1 - BLADE_TIER_BAND - BLADE_PAD, BLADE_REACH + BLADE_PAD],
    ];
    for (const [list, lo, hi] of lists) {
      expect(list.length).toBeGreaterThan(50);
      const seen = new Set<string>();
      for (let k = 0; k < list.length; k++) {
        const c = list[k]!;
        const d = Math.sqrt(d2From(ox, oz, c));
        expect(d).toBeGreaterThanOrEqual(Math.max(0, lo) - 1e-9);
        expect(d).toBeLessThan(hi + 1e-9);
        if (k > 0) expect(d2From(ox, oz, c)).toBeGreaterThanOrEqual(d2From(ox, oz, list[k - 1]!));
        const key = `${c.x},${c.z}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("is the full lattice: every jittered cell under the reach with a gate above the floor is present", () => {
    const all = new Set<string>();
    for (const c of [...tiers.fine, ...tiers.mid, ...tiers.coarse]) all.add(`${c.x},${c.z}`);
    const r = BLADE_REACH + BLADE_PAD;
    let expected = 0;
    for (let ci = Math.floor((ox - r) / BLADE_CELL); ci <= Math.floor((ox + r) / BLADE_CELL); ci++) {
      for (let cj = Math.floor((oz - r) / BLADE_CELL); cj <= Math.floor((oz + r) / BLADE_CELL); cj++) {
        const c = bladeCellAt(SEED, ci, cj);
        if (c === null || d2From(ox, oz, c) >= r * r) continue;
        expected++;
        expect(all.has(`${c.x},${c.z}`)).toBe(true);
      }
    }
    expect(all.size).toBe(expected);
  });

  it("never lets a tier pop: every cell under a tier's edge of any eye in the rebuild cell is in that tier", () => {
    const cx = Math.floor(CAM.x / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
    const cz = Math.floor(CAM.z / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
    const eyes = [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999], [0.5, 0.5]] as const;
    const fine = new Set(tiers.fine), mid = new Set(tiers.mid), coarse = new Set(tiers.coarse);
    const every = [...tiers.fine, ...tiers.mid, ...tiers.coarse];
    let checked = 0;
    for (const [ex, ez] of eyes) {
      const eyeX = cx + ex, eyeZ = cz + ez;
      for (const c of every) {
        const d = Math.hypot(c.x - eyeX, c.z - eyeZ);
        if (d < BLADE_TIER_EDGE[0]) { expect(fine.has(c)).toBe(true); checked++; }
        if (d >= BLADE_TIER_EDGE[0] - BLADE_TIER_BAND && d < BLADE_TIER_EDGE[1]) { expect(mid.has(c)).toBe(true); checked++; }
        if (d >= BLADE_TIER_EDGE[1] - BLADE_TIER_BAND && d < BLADE_REACH) { expect(coarse.has(c)).toBe(true); checked++; }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("the memoized collector agrees with the pure walk and reuses cells across a crossing", () => {
    const collector = createBladeCollector(SEED);
    const a = collector.collect(CAM.x, CAM.z);
    const b = collectBladeCells(SEED, CAM.x, CAM.z);
    expect(a.fine.map((c) => [c.x, c.z])).toEqual(b.fine.map((c) => [c.x, c.z]));
    expect(a.coarse.length).toBe(b.coarse.length);
    const cold = collector.size;
    collector.collect(CAM.x + BLADE_REBUILD_CELL, CAM.z);
    // One metre of travel samples a ring's worth of new cells, not a disc's.
    expect(collector.size - cold).toBeLessThan(cold * 0.2);
  });
});
