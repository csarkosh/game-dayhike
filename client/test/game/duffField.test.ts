import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { CLUTTER_GRASS, CLUTTER_LITTER, groundCover } from "../../src/sim/clutter.js";
import { instanceMatrixFor, LITTER_VARIANT_SCALE } from "../../src/game/clutterMeshes.js";
import { bladeCellAt } from "../../src/game/bladeField.js";
import { DUFF_CHARACTER_COUNT } from "../../src/game/duffClump.js";
import {
  DUFF_CELL, DUFF_CHARACTER_WEIGHTS, DUFF_COLLAPSE_BAND, DUFF_JITTER, DUFF_PAD, DUFF_REACH, DUFF_REBUILD_CELL,
  DUFF_STRENGTH_FLOOR, DUFF_SWEEP_SIZE, DUFF_TIER_BAND, DUFF_TIER_EDGE,
  collectDuffCells, createDuffCollector, duffCellAt, duffCharacterFor, duffTierBands, type DuffCell,
} from "../../src/game/duffField.js";

const SEED = 1;
// A point deep under forest canopy, well off the trail: measured, the
// ground-cover field's duff sits at its full-canopy plateau — the share
// term `1 - grass / CLUTTER_GRASS_BOOST` at the closed canopy's grass of
// 0.9375, three eighths — at 1680 of the 1681 points of its 40 m
// neighbourhood at 1 m spacing — the one exception, (460, -615), is
// 0.38563991224989613 — so every cell the tests below touch is non-null, and
// all but that one exception carry the same strength.
const CAM = { x: 480, z: -600 };
const REACH = DUFF_REACH.high;

function d2From(ox: number, oz: number, c: { x: number; z: number }): number {
  return (c.x - ox) ** 2 + (c.z - oz) ** 2;
}
function origin(v: number): number {
  return Math.floor(v / DUFF_CELL) * DUFF_CELL;
}

describe("the duff field's constants", () => {
  it("pads for a 1 m rebuild on a 1 m lattice, and reaches by quality tier", () => {
    expect(DUFF_CELL).toBe(1);
    expect(DUFF_REBUILD_CELL).toBe(1);
    expect(DUFF_PAD).toBeCloseTo(Math.SQRT2 * (DUFF_REBUILD_CELL + DUFF_CELL), 12);
    expect(DUFF_REACH).toEqual({ high: 24, medium: 16 });
    expect(DUFF_TIER_EDGE).toBe(6);
    expect(DUFF_TIER_BAND).toBe(1.5);
    expect(DUFF_COLLAPSE_BAND).toBe(2);
    expect(DUFF_STRENGTH_FLOOR).toBe(0.05);
    expect(DUFF_JITTER).toBe(0.4);
  });

  it("hands off near → far over the spec's bands, collapsing at the reach", () => {
    // The near band ends at the tier edge; the far band ends a collapse
    // band short of the reach: DUFF_TIER_EDGE (6) minus DUFF_TIER_BAND (1.5)
    // is 4.5, and reach (12) minus DUFF_COLLAPSE_BAND (2) is 10.
    expect(duffTierBands(12)).toEqual([
      [-2, -1, 4.5, 6],
      [4.5, 6, 10, 12],
    ]);
    const [near, far] = duffTierBands(REACH);
    expect(near.slice(2)).toEqual([DUFF_TIER_EDGE - DUFF_TIER_BAND, DUFF_TIER_EDGE]);
    expect(near[0]).toBeLessThan(near[1]);
    expect(near[1]).toBeLessThan(0); // a no-op in-band: every distance is past it
    expect(far).toEqual([DUFF_TIER_EDGE - DUFF_TIER_BAND, DUFF_TIER_EDGE, REACH - DUFF_COLLAPSE_BAND, REACH]);
  });

  it("picks characters by the spec's weights: 0.15 twig, 0.75 leaf, 0.10 branch", () => {
    expect(DUFF_CHARACTER_WEIGHTS).toEqual([0.15, 0.75, 0.1]);
    expect(DUFF_CHARACTER_COUNT).toBe(3);
    const counts = new Array<number>(DUFF_CHARACTER_COUNT).fill(0);
    const n = 10000;
    for (let i = 0; i < n; i++) counts[duffCharacterFor(i / n)]!++;
    for (let c = 0; c < DUFF_CHARACTER_COUNT; c++) expect(counts[c]! / n).toBeCloseTo(DUFF_CHARACTER_WEIGHTS[c]!, 2);
    // The three named examples.
    expect(duffCharacterFor(0.1)).toBe(0); // twig
    expect(duffCharacterFor(0.7)).toBe(1); // leaf
    expect(duffCharacterFor(0.95)).toBe(2); // branch
    // The cumulative boundaries themselves (0.15, 0.90, 1.00): just under a
    // boundary is the lower tier, just at or over it is the next.
    expect(duffCharacterFor(0.149999)).toBe(0);
    expect(duffCharacterFor(0.15)).toBe(1);
    expect(duffCharacterFor(0.899999)).toBe(1);
    expect(duffCharacterFor(0.9)).toBe(2);
    expect(duffCharacterFor(0.999999)).toBe(2);
    expect(duffCharacterFor(0)).toBe(0);
  });

  it("keeps the widest padded reach inside the collector's cache", () => {
    const cells = (Math.PI * (DUFF_REACH.high + DUFF_PAD) ** 2) / (DUFF_CELL * DUFF_CELL);
    expect(cells).toBeLessThan(DUFF_SWEEP_SIZE);
  });
});

describe("one cell", () => {
  it("carries the sim's duff gate as its strength, the terrain under it, and is deterministic", () => {
    // Scan a 40 m square around a point deep under canopy for the first
    // non-null cell — every cell here clears the floor, so the very first
    // one visited already qualifies.
    const ci0 = Math.floor(CAM.x / DUFF_CELL) - 20, cj0 = Math.floor(CAM.z / DUFF_CELL) - 20;
    let found: DuffCell | null = null;
    for (let ci = ci0; ci <= ci0 + 40 && found === null; ci++) {
      for (let cj = cj0; cj <= cj0 + 40 && found === null; cj++) {
        found = duffCellAt(SEED, ci, cj);
      }
    }
    expect(found).not.toBeNull();
    const c = found as DuffCell;
    expect(c.strength).toBeCloseTo(groundCover(SEED, c.x, c.z).duff, 9);
    expect(c.strength).toBeGreaterThanOrEqual(DUFF_STRENGTH_FLOOR);
    expect(c.cls).toBe(CLUTTER_LITTER);
    expect(c.scale).toBe(1);
    expect(c.variant).toBe(DUFF_CHARACTER_COUNT);
    expect(c.hash).toBeGreaterThanOrEqual(0);
    expect(c.hash).toBeLessThan(1);
    expect(c.character).toBe(duffCharacterFor(c.characterDraw));
    expect(duffCellAt(SEED, Math.floor(c.x / DUFF_CELL), Math.floor(c.z / DUFF_CELL))).toEqual(c);
    // This point's own local plateau — the field's share term under a
    // closed canopy, `1 - 0.9375 / CLUTTER_GRASS_BOOST` (three eighths; two
    // thirds while the canopy floor was 0.5 and the boost had not started) —
    // holds at all but one of the 1681 points across its 40 m neighbourhood
    // at 1 m spacing (see the comment on CAM above) — not a hard ceiling the
    // field enforces: rarer points elsewhere on this same seed run well above
    // it, toward the field's true mathematical bound of 1. Pinned as a
    // literal, and with a bound below the 0.15 floor's 0.9 plateau.
    expect(c.strength).toBe(0.375);
    expect(c.strength).toBeLessThan(0.8); // the old 0.15 floor's 0.9 plateau fails this
  });

  it("ties the strength at a cell whose duff sits strictly between the floor and its own local plateau", () => {
    // (400, -484) is deliberately off both rails: `duffCellAt(1, 400, -484)`
    // measures strength 0.20112063523691187, clear of DUFF_STRENGTH_FLOOR
    // (0.05) and of the three-eighths plateau above, and stable across its
    // own neighbourhood (measured 0.17975068155818372 to 0.22346091792616454
    // over the ±1 m square around the cell's own jittered point) — so the tie
    // holds for a representative mid-band cell, not only a pinned extreme.
    // With the canopy floor at 0.5 it read 0.40994507745996644.
    const ci = 400, cj = -484;
    const c = duffCellAt(SEED, ci, cj);
    expect(c).not.toBeNull();
    const cell = c as DuffCell;
    expect(cell.strength).toBe(groundCover(SEED, cell.x, cell.z).duff);
    expect(cell.strength).toBeGreaterThan(0.1);
    expect(cell.strength).toBeLessThan(0.3);
  });

  it("emits nothing where the gate is under the floor, and every emitted cell clears it", () => {
    // A 100 m x 100 m window around the trailhead-adjacent census point
    // clutter.test.ts uses: the bed and its low-canopy margins carry no
    // duff floor in places, so some cells are null; every cell that is not
    // null clears the floor.
    const ci0 = 0, cj0 = 21285;
    let nulls = 0, cells = 0;
    for (let ci = ci0; ci < ci0 + 200; ci += 2) {
      for (let cj = cj0; cj < cj0 + 200; cj += 2) {
        const c = duffCellAt(SEED, ci, cj);
        if (c === null) nulls++;
        else {
          cells++;
          expect(c.strength).toBeGreaterThanOrEqual(DUFF_STRENGTH_FLOOR);
        }
      }
    }
    expect(cells + nulls).toBeGreaterThan(1000);
    // Measured: 4873 nulls, 5127 cells in this window — both sides are real,
    // not one vacuously empty.
    expect(cells).toBeGreaterThan(500);
    expect(nulls).toBeGreaterThan(500);
  });

  it("is shaped for instanceMatrixFor's litter path: no pebble scale, laid on the ground normal", () => {
    // variant is DUFF_CHARACTER_COUNT (3), one past LITTER_VARIANT_SCALE's
    // own indices (0, 1, 2) — deliberately out of range, so the lookup
    // `LITTER_VARIANT_SCALE[inst.variant] ?? 1` falls back to 1 (no pebble
    // scale) rather than reusing rock's or driftwood's own factor.
    expect(LITTER_VARIANT_SCALE[DUFF_CHARACTER_COUNT]).toBeUndefined();
    const IDENTITY_FRAME = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };
    const colLen = (buf: Float32Array, col: number): number => Math.hypot(buf[col * 4]!, buf[col * 4 + 1]!, buf[col * 4 + 2]!);
    const base = { x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 0.5, hash: 0.2 };
    const buf = new Float32Array(16);
    // Not scaled down the way a driftwood-variant litter piece (variant 2,
    // factor 0.3) would be — the column length equals the sim's own scale.
    instanceMatrixFor({ ...base, cls: CLUTTER_LITTER, variant: DUFF_CHARACTER_COUNT }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5, 6);
    instanceMatrixFor({ ...base, cls: CLUTTER_LITTER, variant: 2 }, IDENTITY_FRAME, buf);
    expect(colLen(buf, 0)).toBeCloseTo(0.5 * 0.3, 6);

    // Seated on the ground normal: on sloped ground, litter's Y column
    // tips away from purely vertical, unlike a standing class (grass).
    const sloped = { x: 0, z: 0, groundH: 0, groundDx: 0.6, groundDz: 0, scale: 0.4, hash: 0, variant: DUFF_CHARACTER_COUNT };
    instanceMatrixFor({ ...sloped, cls: CLUTTER_LITTER }, IDENTITY_FRAME, buf);
    expect(Math.abs(buf[4]!) + Math.abs(buf[6]!)).toBeGreaterThan(0.01);
    instanceMatrixFor({ ...sloped, cls: CLUTTER_GRASS }, IDENTITY_FRAME, buf);
    expect(buf[4]).toBeCloseTo(0, 9);
    expect(buf[6]).toBeCloseTo(0, 9);
  });
});

describe("the two lattices do not correlate", () => {
  it("draws the blade and duff fields' jitter, hash and character from uncorrelated sequences", () => {
    // Same cell indices, both fields, over a wide area; a real correlation
    // coefficient rather than a by-eye check, so a future salt collision
    // cannot slip past unnoticed.
    const pearson = (as: number[], bs: number[]): number => {
      const n = as.length;
      const ma = as.reduce((a, b) => a + b, 0) / n;
      const mb = bs.reduce((a, b) => a + b, 0) / n;
      let cov = 0, va = 0, vb = 0;
      for (let i = 0; i < n; i++) {
        const da = as[i]! - ma, db = bs[i]! - mb;
        cov += da * db;
        va += da * da;
        vb += db * db;
      }
      return cov / Math.sqrt(va * vb);
    };
    const bx: number[] = [], bz: number[] = [], bh: number[] = [];
    const dx: number[] = [], dz: number[] = [], dh: number[] = [];
    // Blade cells are on a 0.5 m lattice, duff on a 1 m lattice, so index
    // the SAME lattice cell of each field at its own cell size — the
    // comparison that matters is whether the two fields' own draws move
    // together, not whether their coordinate grids line up.
    for (let ci = 0; ci < 400; ci++) {
      for (let cj = 0; cj < 4; cj++) {
        const b = bladeCellAt(SEED, ci, cj);
        const d = duffCellAt(SEED, ci, cj);
        if (b) { bx.push(b.x % 1); bz.push(b.z % 1); bh.push(b.hash); }
        if (d) { dx.push(d.x % 1); dz.push(d.z % 1); dh.push(d.hash); }
      }
    }
    const n = Math.min(bx.length, dx.length);
    expect(n).toBeGreaterThan(200);
    expect(Math.abs(pearson(bx.slice(0, n), dx.slice(0, n)))).toBeLessThan(0.15);
    expect(Math.abs(pearson(bz.slice(0, n), dz.slice(0, n)))).toBeLessThan(0.15);
    expect(Math.abs(pearson(bh.slice(0, n), dh.slice(0, n)))).toBeLessThan(0.15);
  });
});

describe("the tiers", () => {
  const tiers = collectDuffCells(SEED, CAM.x, CAM.z, REACH);
  const ox = origin(CAM.x), oz = origin(CAM.z);

  it("holds every cell of the disc exactly once per tier it belongs to, nearest first", () => {
    const lists: [DuffCell[], number, number][] = [
      [tiers.near, 0, DUFF_TIER_EDGE + DUFF_PAD],
      [tiers.far, DUFF_TIER_EDGE - DUFF_TIER_BAND - DUFF_PAD, REACH + DUFF_PAD],
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
    for (const c of [...tiers.near, ...tiers.far]) all.add(`${c.x},${c.z}`);
    const r = REACH + DUFF_PAD;
    let expected = 0;
    for (let ci = Math.floor((ox - r) / DUFF_CELL); ci <= Math.floor((ox + r) / DUFF_CELL); ci++) {
      for (let cj = Math.floor((oz - r) / DUFF_CELL); cj <= Math.floor((oz + r) / DUFF_CELL); cj++) {
        const c = duffCellAt(SEED, ci, cj);
        if (c === null || d2From(ox, oz, c) >= r * r) continue;
        expected++;
        expect(all.has(`${c.x},${c.z}`)).toBe(true);
      }
    }
    expect(all.size).toBe(expected);
  });

  it("never lets a tier pop: every cell under a tier's edge of any eye in the rebuild cell is in that tier", () => {
    const cx = Math.floor(CAM.x / DUFF_REBUILD_CELL) * DUFF_REBUILD_CELL;
    const cz = Math.floor(CAM.z / DUFF_REBUILD_CELL) * DUFF_REBUILD_CELL;
    const eyes = [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999], [0.5, 0.5]] as const;
    const near = new Set(tiers.near), far = new Set(tiers.far);
    const every = [...tiers.near, ...tiers.far];
    let checked = 0;
    for (const [ex, ez] of eyes) {
      const eyeX = cx + ex, eyeZ = cz + ez;
      for (const c of every) {
        const d = Math.hypot(c.x - eyeX, c.z - eyeZ);
        if (d < DUFF_TIER_EDGE) { expect(near.has(c)).toBe(true); checked++; }
        if (d >= DUFF_TIER_EDGE - DUFF_TIER_BAND && d < REACH) { expect(far.has(c)).toBe(true); checked++; }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("the memoized collector agrees with the pure walk and reuses cells across a crossing", () => {
    const collector = createDuffCollector(SEED);
    const a = collector.collect(CAM.x, CAM.z, REACH);
    const b = collectDuffCells(SEED, CAM.x, CAM.z, REACH);
    expect(a.near.map((c) => [c.x, c.z])).toEqual(b.near.map((c) => [c.x, c.z]));
    expect(a.far.length).toBe(b.far.length);
    const cold = collector.size;
    collector.collect(CAM.x + DUFF_REBUILD_CELL, CAM.z, REACH);
    // One metre of travel samples a ring's worth of new cells, not a disc's:
    // the growth in cache size is far smaller than the cold disc itself.
    const grown = collector.size - cold;
    expect(grown).toBeGreaterThan(0);
    expect(grown).toBeLessThan(cold * 0.2);
  });
});
