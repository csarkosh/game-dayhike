import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import "../../src/sim/passes/index.js";
import { setActiveTerrainVariant, activeTerrainVariant, elevationSampleAt } from "../../src/sim/terrain.js";
import { forestDensity, treeInCell, TREE_CELL, COHORT_GIANT, COHORT_SNAG } from "../../src/sim/vegetation.js";
import { clutterInRect, clutterDensity, CLUTTER_BUSH, CLUTTER_FLOWER, CLUTTER_GRASS_CANOPY_LO } from "../../src/sim/clutter.js";
import { MAX_WALKABLE_GRADIENT } from "../../src/sim/ground.js";
import { SAND_TOP } from "../../src/game/terrainSurface.js";
import {
  SPECIES_COUNT, SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_ROOST,
  SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_EAGLE, SPECIES_BUTTERFLY, WILDLIFE_CELL, WILDLIFE_RADIUS, ELK_ROAD_CLEAR,
  RABBIT_COVER_RADIUS, RABBIT_GRASS_FLOOR, RABBIT_CANOPY_MAX, GULL_BAND, GIANT_MODEL_HEIGHT, RAVEN_ROOST_ALT_FLOOR, RAVEN_ROOST_CLEARANCE,
  wildlifeUnitInCell, wildlifeUnitsInDisc, createWildlifeCollector,
  groundAnchor,
  type WildlifeUnit,
  GROUND_ROAD_CLEAR, GROUND_SHORE_ALT, forestGround, lastAllowed, speciesGround,
} from "../../src/game/wildlifeField.js";
import { shoreHeight } from "../../src/sim/shoreStrip.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");
const SEEDS = [1, 388817, -1117907922];
/**
 * The tallest canopy giant within `radius` of (x, z), as a height above `groundH` — an
 * independent re-derivation of what `wildlifeField`'s own `canopyTopNear` computes, written
 * out here on purpose so that a mutation to that helper (wrong cohort, wrong species table,
 * a dropped valley boost, a bounding box that misses a cell) fails this test rather than
 * moving both sides together.
 */
describe("the canopy table the roost altitude is derived from", () => {
  it("carries the shipped heights, fir first, as forestMeshes maps the species", () => {
    // tree.giant_fir 14.70 m, tree.giant_pine 17.18 m, in the species order forestMeshes.ts maps to
    // those two models (0 fir, 1 pine). Pinned as VALUES because every other roost-altitude test
    // re-derives the canopy from this same table.
    expect(GIANT_MODEL_HEIGHT).toEqual([14.70, 17.18]);
  });
  it("matches the top of each shipped giant's LOD0 within half a metre", () => {
    // The shipped trunks bend their base below y = 0 to meet sloped ground, so the LOD0 top sits a
    // little under the nominal height (fir 14.54, pine 17.10); a rebuilt model that changed height
    // by more than that would leave the roost altitude reading a stale canopy.
    const topOf = (id: string): number => {
      const bytes = readFileSync(new URL(`../../assets/models/${id}.glb`, import.meta.url));
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")) as {
        nodes: { name?: string; mesh?: number; children?: number[] }[];
        meshes: { primitives: { attributes: { POSITION: number } }[] }[];
        accessors: { max?: number[] }[];
      };
      const lod0 = json.nodes.find((n) => n.name === "LOD0")!;
      let top = -Infinity;
      for (const child of lod0.children ?? []) {
        for (const p of json.meshes[json.nodes[child]!.mesh!]!.primitives) top = Math.max(top, json.accessors[p.attributes.POSITION]!.max![1]!);
      }
      return top;
    };
    expect(Math.abs(topOf("tree.giant_fir") - GIANT_MODEL_HEIGHT[0]!)).toBeLessThan(0.5);
    expect(Math.abs(topOf("tree.giant_pine") - GIANT_MODEL_HEIGHT[1]!)).toBeLessThan(0.5);
  });
});

function tallestGiantNear(seed: number, x: number, z: number, groundH: number, radius: number): number {
  let top = 0;
  for (let tz = Math.floor((z - radius) / TREE_CELL); tz <= Math.floor((z + radius) / TREE_CELL); tz++) {
    for (let tx = Math.floor((x - radius) / TREE_CELL); tx <= Math.floor((x + radius) / TREE_CELL); tx++) {
      const t = treeInCell(seed, tx, tz);
      if (t === null || t.cohort !== COHORT_GIANT) continue;
      if (Math.hypot(t.x - x, t.z - z) > radius) continue;
      const above = t.groundH + GIANT_MODEL_HEIGHT[t.species]! * t.scale - groundH;
      if (above > top) top = above;
    }
  }
  return top;
}
/** 4 km × 4 km centred on the road/coast band, in cells of each species' own size. */
function census(seed: number, species: number): WildlifeUnit[] {
  const cell = WILDLIFE_CELL[species]!;
  const units: WildlifeUnit[] = [];
  const n = Math.ceil(2000 / cell);
  for (let cz = -n; cz < n; cz++) for (let cx = -n; cx < n; cx++) {
    const u = wildlifeUnitInCell(seed, species, cx, cz);
    if (u) units.push(u);
  }
  return units;
}

describe("the rabbits and the canopy", () => {
  // Every rabbit unit of the census, split by the canopy density at its
  // anchor: open (rho <= 0.4, where the grass does not depend on the canopy
  // floor), partial (0.4 < rho < 0.85) and closed (rho >= 0.85). With the
  // canopy floor at 0.5 (main before the near-grass work) the split was
  // open 705 / 634 / 556, partial 736 / 709 / 580, closed 0 / 0 / 0. At
  // 0.75 the open ground is the same to the unit; partial canopy carries more
  // grass, so more rabbits (a total of 1664 / 1568 / 1349). Since no animal
  // stands on ground under 9 m or within 30 m of the road, the rabbits of the
  // shore's edge are gone: 7, 7 and 3 of the open ground's, and one of seed
  // 1's under a partial canopy. 2026-09-29: seed 1's were 698 and 958. A wood
  // comes down to the road at the trailhead, and four of seed 1's rabbits
  // stand in it: the ground they stand on was open and is under a canopy of
  // 0.53 to 0.6 now. With the trail leaving the pad inland, the same day,
  // seed 1 reads 693 and 960 where that left it 694 and 962: three of its
  // rabbits stood within 1.1 m of the new trail's line, where the grass is
  // 0 to 0.45 now, under a rabbit's floor, and one of them was of the four.
  // Seed -1117907922 reads 552 and 791 where it read 553 and 793: four
  // rabbits went, two from ground that has no grass now and two from ground
  // that is under a closed canopy now, and one came where a closed canopy
  // opened, each within 24 m of the new line; and one that stood under a
  // canopy of 0.84 stands in the open, 9.3 m from it.
  const want: Record<number, [number, number, number]> = {
    1: [693, 960, 0],
    388817: [627, 934, 0],
    [-1117907922]: [552, 791, 0],
  };
  for (const seed of SEEDS) {
    it(`seed ${seed}: keeps the open-ground rabbits and none under a closed canopy`, () => {
      let open = 0, partial = 0, closed = 0;
      for (const u of census(seed, SPECIES_RABBIT)) {
        const rho = forestDensity(seed, u.x, u.z, elevationSampleAt(seed, u.x, u.z));
        if (rho <= 0.4) open++;
        else if (rho < 0.85) partial++;
        else closed++;
      }
      expect([open, partial, closed]).toEqual(want[seed]);
    }, timeLimit(60_000));
  }
});

describe("wildlife placement census", () => {
  const variant = activeTerrainVariant();
  for (const seed of SEEDS) {
    it(`seed ${seed}: elk herds are on meadow ground, off the road, above the beach, on walkable slopes`, () => {
      const herds = census(seed, SPECIES_ELK);
      // Measured 2026-09-02 at the starting densities: seeds 1, 388817,
      // -1117907922 gave 64, 61, 50 herds over the 4 km × 4 km census.
      // [floor(0.5·min), ceil(1.5·max)] — re-anchor from fresh measurements,
      // never fit to make a red bar green.
      expect(herds.length).toBeGreaterThanOrEqual(25);
      expect(herds.length).toBeLessThanOrEqual(96);
      for (const h of herds) {
        expect(h.members).toBeGreaterThanOrEqual(4);
        expect(h.members).toBeLessThanOrEqual(8);
        expect(variant.roadDistance!(seed, h.x, h.z)).toBeGreaterThanOrEqual(ELK_ROAD_CLEAR);
        const s = elevationSampleAt(seed, h.x, h.z);
        expect(s.h).toBeGreaterThan(SAND_TOP);
        expect(Math.hypot(s.dx, s.dz)).toBeLessThanOrEqual(MAX_WALKABLE_GRADIENT);
        expect(forestDensity(seed, h.x, h.z, s)).toBeLessThan(0.6);
      }
    });
    it(`seed ${seed}: deer stand at the forest edge, off the road, above the beach, on walkable slopes`, () => {
      const deer = census(seed, SPECIES_DEER);
      // Measured 2026-09-02 at the starting densities: seeds 1, 388817,
      // -1117907922 gave 127, 134, 124 deer over the 4 km × 4 km census.
      // [floor(0.5·min), ceil(1.5·max)].
      expect(deer.length).toBeGreaterThanOrEqual(62);
      expect(deer.length).toBeLessThanOrEqual(201);
      for (const d of census(seed, SPECIES_DEER)) {
        const rho = forestDensity(seed, d.x, d.z);
        expect(rho).toBeGreaterThanOrEqual(0.15);
        expect(rho).toBeLessThanOrEqual(0.5);
        expect(variant.roadDistance!(seed, d.x, d.z)).toBeGreaterThanOrEqual(ELK_ROAD_CLEAR);
        const s = elevationSampleAt(seed, d.x, d.z);
        expect(s.h).toBeGreaterThan(SAND_TOP);
        expect(Math.hypot(s.dx, s.dz)).toBeLessThanOrEqual(MAX_WALKABLE_GRADIENT);
      }
    });
    it(`seed ${seed}: nothing that walks is anchored on ground under 9 m or within 30 m of the road`, () => {
      let counted = 0;
      for (const species of [SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL]) {
        for (const u of census(seed, species)) {
          counted++;
          expect(shoreHeight(seed, u.x, u.z, elevationSampleAt(seed, u.x, u.z).h), `species ${species} at ${u.x}, ${u.z}`).toBeGreaterThanOrEqual(9);

          expect(variant.roadDistance!(seed, u.x, u.z), `species ${species} at ${u.x}, ${u.z}`).toBeGreaterThanOrEqual(30);
          // A rabbit bolts to its bush, so the bush is on the forest's ground too.
          if (species === SPECIES_RABBIT) expect(forestGround(seed, u.refugeX, u.refugeZ), `the bush at ${u.refugeX}, ${u.refugeZ}`).toBe(true);
        }
      }
      expect(counted).toBeGreaterThan(1000);
    }, timeLimit(60_000));
    it(`seed ${seed}: every rabbit unit has a bush within ${RABBIT_COVER_RADIUS} m, and its refuge is that bush`, () => {
      const units = census(seed, SPECIES_RABBIT);
      // Measured 2026-09-02: seeds 1, 388817, -1117907922 gave 1168, 1132, 974
      // rabbit units over the 4 km × 4 km census. [floor(0.5·min), ceil(1.5·max)].
      // Re-measured 2026-09-24 at RABBIT_GRASS_FLOOR 0.55, after the forest floor
      // put grass under the canopy: 1441, 1343, 1136 — inside the same band.
      // Re-measured 2026-09-26 after the canopy floor rose to 0.75 and a
      // closed canopy's grass to 0.9375, with RABBIT_GRASS_FLOOR kept at 0.55
      // and closed canopy (RABBIT_CANOPY_MAX 0.85) excluded: see the split
      // test below. Without the canopy gate the census rose to 4084, 4576,
      // 3158, most of them under closed canopy, and this band caught it.
      expect(RABBIT_GRASS_FLOOR).toBe(0.55);
      expect(RABBIT_CANOPY_MAX).toBe(0.85);
      expect(units.length).toBeGreaterThanOrEqual(487);
      expect(units.length).toBeLessThanOrEqual(1752);
      for (const r of units) {
        const bushes = clutterInRect(seed, CLUTTER_BUSH, r.x - RABBIT_COVER_RADIUS, r.z - RABBIT_COVER_RADIUS, r.x + RABBIT_COVER_RADIUS, r.z + RABBIT_COVER_RADIUS);
        const near = bushes.filter((b) => Math.hypot(b.x - r.x, b.z - r.z) <= RABBIT_COVER_RADIUS);
        expect(near.length).toBeGreaterThan(0);
        expect(near.some((b) => b.x === r.refugeX && b.z === r.refugeZ)).toBe(true);
      }
    });
    it(`seed ${seed}: every squirrel's home trunk is a giant in its cell, and no two squirrels share a trunk`, () => {
      const squirrels = census(seed, SPECIES_SQUIRREL);
      // Re-measured 2026-09-02, after closing a scan-window coverage gap,
      // at the starting densities: seeds 1, 388817,
      // -1117907922 gave 4908, 5674, 3918 squirrels over the 4 km × 4 km
      // census (up slightly from an earlier measurement of 4899, 5668, 3915,
      // now that no giant a cell owns by position goes unreached).
      // [floor(0.5·min), ceil(1.5·max)].
      expect(squirrels.length).toBeGreaterThanOrEqual(1959);
      expect(squirrels.length).toBeLessThanOrEqual(8511);
      for (const s of squirrels) {
        const t = treeInCell(seed, Math.floor(s.homeX / TREE_CELL), Math.floor(s.homeZ / TREE_CELL));
        expect(t).not.toBeNull();
        expect(t!.cohort).toBe(COHORT_GIANT);
        expect(t!.x).toBe(s.homeX);
        expect(t!.z).toBe(s.homeZ);
      }
      // The 24 m squirrel cell is not a multiple of TREE_CELL (10 m), so
      // neighbouring cells' tree-scan windows overlap; without an ownership
      // filter two units could claim the same giant.
      const homes = new Set(squirrels.map((s) => `${s.homeX}:${s.homeZ}`));
      expect(homes.size).toBe(squirrels.length);
    });
    it(`seed ${seed}: every raven roost is a snag`, () => {
      const roosts = census(seed, SPECIES_RAVEN_ROOST);
      // Measured 2026-09-02: seeds 1, 388817, -1117907922 gave 887, 1075, 711
      // roosts over the 4 km × 4 km census. [floor(0.5·min), ceil(1.5·max)].
      expect(roosts.length).toBeGreaterThanOrEqual(355);
      expect(roosts.length).toBeLessThanOrEqual(1613);
      // Half the placed roosts belong to dread (presenceDraw in [1, 2)); every other species draws below 1.
      expect(roosts.filter((r) => r.presenceDraw < 1).length).toBeGreaterThan(0);
      for (const s of [SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_EAGLE]) {
        for (const u of census(seed, s)) expect(u.presenceDraw).toBeLessThan(1);
      }
      // The circling flock has to clear the stand it roosts in, which a flat
      // altitude range could not do (a giant pine reaches ~88 m, so [55, 75]
      // was still inside the canopy at ~99% of roosts).
      // The altitude is now the tallest giant within the loop plus RAVEN_ROOST_CLEARANCE,
      // floored at RAVEN_ROOST_ALT_FLOOR. Re-derived here from `treeInCell` directly rather
      // than by calling the field's own helper, so a mutation to that helper is caught.
      let floorBound = 0, canopyBound = 0;
      for (const r of roosts) {
        const t = treeInCell(seed, Math.floor(r.homeX / TREE_CELL), Math.floor(r.homeZ / TREE_CELL));
        expect(t?.cohort).toBe(COHORT_SNAG);
        const top = tallestGiantNear(seed, r.homeX, r.homeZ, r.homeH, r.radius);
        const lo = Math.max(RAVEN_ROOST_ALT_FLOOR, top + RAVEN_ROOST_CLEARANCE[0]);
        const hi = Math.max(RAVEN_ROOST_ALT_FLOOR, top + RAVEN_ROOST_CLEARANCE[1]);
        expect(r.altitude).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(r.altitude).toBeLessThanOrEqual(hi + 1e-9);
        if (top + RAVEN_ROOST_CLEARANCE[1] <= RAVEN_ROOST_ALT_FLOOR) floorBound++;
        else {
          canopyBound++;
          // The margin is written as a literal, not as RAVEN_ROOST_CLEARANCE[0]: the bounds
          // above are computed FROM that constant, so on their own they would still hold if
          // the clearance were shrunk to nothing. Ten metres is what it takes for a
          // circling flock to read as being above the trees rather than in them.
          expect(r.altitude - top).toBeGreaterThanOrEqual(10 - 1e-9);
        }
      }
      // Both arms of the max are exercised by the real field, so neither is dead: a roost in
      // a clearing takes the floor (measured: 8-9 per seed), a roost in a stand takes the
      // canopy (700-1,070 per seed).
      expect(floorBound).toBeGreaterThan(0);
      expect(canopyBound).toBeGreaterThan(0);
    });
    it(`seed ${seed}: gulls stay within ${GULL_BAND} m of the coastline`, () => {
      const gulls = census(seed, SPECIES_GULL);
      // Measured 2026-09-02: seeds 1, 388817, -1117907922 gave 784, 795, 774
      // gulls over the 4 km × 4 km census. [floor(0.5·min), ceil(1.5·max)].
      expect(gulls.length).toBeGreaterThanOrEqual(387);
      expect(gulls.length).toBeLessThanOrEqual(1193);
      for (const g of gulls) expect(Math.abs(variant.coastDistance!(seed, g.homeX, g.homeZ))).toBeLessThanOrEqual(GULL_BAND);
    });
    it(`seed ${seed}: an eagle circles the highest of its cell's samples`, () => {
      const eagles = census(seed, SPECIES_EAGLE);
      // Measured 2026-09-02 at the starting densities: seeds 1, 388817,
      // -1117907922 gave 32, 41, 33 eagles over the 4 km × 4 km census.
      // [floor(0.5·min), ceil(1.5·max)].
      expect(eagles.length).toBeGreaterThanOrEqual(16);
      expect(eagles.length).toBeLessThanOrEqual(62);
      for (const e of eagles) {
        expect(e.altitude).toBeGreaterThanOrEqual(120);
        expect(e.altitude).toBeLessThanOrEqual(250);
        expect(e.homeH).toBe(elevationSampleAt(seed, e.homeX, e.homeZ).h);
      }
    });
  }
  it("squirrel's tree-cell scan window covers the whole 24 m cell (no coverage gap at the far edge)", () => {
    const seed = 388817;
    const species = SPECIES_SQUIRREL;
    const cell = WILDLIFE_CELL[species]!;
    let sawUnit = false;
    // The misalignment between the 24 m cell and the 10 m tree grid repeats
    // with period 5 in cx and in cz, and affects ~20% of cells (one residue
    // each) — but the gap only shows up as a wrong home when the TRUE
    // nearest giant specifically sits in the missed strip, which is rarer
    // still. A small contiguous block can easily land on zero such cells by
    // chance. This domain (cx ∈ [-10, 15), cz ∈ [-35, 40): 1875 cells) was
    // checked during development to contain several real mismatches for
    // seed 388817 under the old fixed-width window, so the mutation below
    // is guaranteed to be caught, not merely likely to be.
    for (let cx = -10; cx < 15; cx++) {
      for (let cz = -35; cz < 40; cz++) {
        // Independently enumerate every giant that belongs to this cell by
        // position, using a generously oversized tree-cell window (one whole
        // extra tree cell on every side of the production window's true
        // bounds) so this enumeration cannot itself have the coverage gap
        // under test.
        const t0x = Math.floor((cx * cell) / TREE_CELL) - 1;
        const t1x = Math.ceil(((cx + 1) * cell) / TREE_CELL) + 1;
        const t0z = Math.floor((cz * cell) / TREE_CELL) - 1;
        const t1z = Math.ceil(((cz + 1) * cell) / TREE_CELL) + 1;
        const anchor = groundAnchor(seed, species, cx, cz);
        let nearest: { x: number; z: number } | null = null;
        let nearestD = Infinity;
        for (let tz = t0z; tz < t1z; tz++) for (let tx = t0x; tx < t1x; tx++) {
          const t = treeInCell(seed, tx, tz);
          if (t === null || t.cohort !== COHORT_GIANT) continue;
          if (Math.floor(t.x / cell) !== cx || Math.floor(t.z / cell) !== cz) continue;
          // A giant by the shore or the road is no squirrel's home.
          if (!forestGround(seed, t.x, t.z)) continue;
          const d = Math.hypot(t.x - anchor.x, t.z - anchor.z);
          if (d < nearestD) { nearestD = d; nearest = t; }
        }
        const u = wildlifeUnitInCell(seed, species, cx, cz);
        if (u === null) continue; // the density gate can reject regardless of tree coverage
        sawUnit = true;
        // If a unit exists, its home trunk must be the TRUE nearest giant
        // belonging to this cell that stands on the forest's own ground
        // (found by the generous window above), not
        // merely whatever the production scan window happened to reach.
        expect(nearest).not.toBeNull();
        expect(u.homeX).toBe(nearest!.x);
        expect(u.homeZ).toBe(nearest!.z);
      }
    }
    expect(sawUnit).toBe(true);
  });
  it("is a pure function of (seed, species, cell)", () => {
    const a = wildlifeUnitInCell(388817, SPECIES_ELK, 3, -7);
    const b = wildlifeUnitInCell(388817, SPECIES_ELK, 3, -7);
    expect(a).toEqual(b);
    // wildlifeUnitInCell(388818, ELK, 3, -7) can be null, which would make
    // `not.toEqual(a)` pass vacuously against a non-null `a`. Scan cells
    // until seed 388817 places a non-null unit and compare against the same
    // cell under seed 388818 instead. `id` is NOT the field to compare: it is
    // positional now (see `unitId`), so the same cell keeps it across seeds
    // on purpose. `hash` is the per-cell draw, and it must move.
    let checked = false;
    for (let cx = -50; cx < 50 && !checked; cx++) {
      for (let cz = -50; cz < 50 && !checked; cz++) {
        const u1 = wildlifeUnitInCell(388817, SPECIES_ELK, cx, cz);
        if (u1 === null) continue;
        const u2 = wildlifeUnitInCell(388818, SPECIES_ELK, cx, cz);
        expect(u2?.hash).not.toBe(u1.hash);
        if (u2 !== null && u2 !== undefined) expect(u2.id).toBe(u1.id);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it("gives every unit an id unique across all species and cells", () => {
    // The id names a unit everywhere downstream: `wildlifeMeshes.ts` keys its
    // state and pool slots on it, and every per-unit random in
    // `wildlifeBehaviour.ts` is drawn from `hash3(unit.id, ...)`. Two live
    // units sharing one meant a missing animal and a shared dwell, wander and
    // call schedule — which is what the drawn id used to produce routinely.
    const seed = 388817;
    const seen = new Map<number, string>();
    for (let species = 0; species < SPECIES_COUNT; species++) {
      const cell = WILDLIFE_CELL[species]!;
      const n = Math.ceil(2000 / cell);
      for (let cz = -n; cz < n; cz++) for (let cx = -n; cx < n; cx++) {
        const u = wildlifeUnitInCell(seed, species, cx, cz);
        if (u === null) continue;
        const where = `species ${species} cell ${cx},${cz}`;
        expect(seen.get(u.id) ?? where).toBe(where);
        seen.set(u.id, where);
        // Positive int32: the packing is 14 + 14 + 3 bits, so the sign bit is
        // never set and `hash3(id, ...)`'s `| 0` cannot wrap it.
        expect(u.id).toBeGreaterThanOrEqual(0);
        expect(u.id).toBeLessThanOrEqual(0x7fffffff);
      }
    }
    expect(seen.size).toBeGreaterThan(1000);
  });
  it("the disc walk returns exactly the units inside each species' radius", () => {
    const seed = 388817;
    const units = wildlifeUnitsInDisc(seed, 120, -300);
    for (const u of units) {
      const r = WILDLIFE_RADIUS[u.species]!;
      const cx = u.species >= SPECIES_RAVEN_ROOST ? u.homeX : u.x;
      const cz = u.species >= SPECIES_RAVEN_ROOST ? u.homeZ : u.z;
      expect(Math.hypot(cx - 120, cz + 300)).toBeLessThanOrEqual(r);
    }
    // low tier: 0.6 radius yields a subset
    const low = wildlifeUnitsInDisc(seed, 120, -300, 0.6);
    for (const u of low) expect(units.some((v) => v.id === u.id)).toBe(true);
    expect(low.length).toBeLessThanOrEqual(units.length);
  });
  it("the memoized collector matches the pure walk and re-samples only the edge", () => {
    const seed = 388817;
    const c = createWildlifeCollector(seed);
    const first = c.collect(0, 0, 1);
    expect(first.map((u) => u.id).sort()).toEqual(wildlifeUnitsInDisc(seed, 0, 0).map((u) => u.id).sort());
    const before = c.cellsSampled;
    c.collect(8, 0, 1);
    expect(c.cellsSampled - before).toBeLessThan(before / 4);
  });
  it("names every species once", () => {
    expect(new Set([
      SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_ROOST,
      SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_EAGLE, SPECIES_BUTTERFLY,
    ]).size).toBe(SPECIES_COUNT);
  });
  for (const seed of SEEDS) {
    it(`seed ${seed}: every butterfly sits over open ground with flowers on it`, () => {
      const butterflies = census(seed, SPECIES_BUTTERFLY);
      // A census this fine (16 m cells) over 4 km × 4 km is ~250,000 cells; the two habitat
      // gates plus the coin-flip density leave a modest fraction of them occupied, which is
      // the point of a lower bound here — an empty result would mean the gates never pass.
      expect(butterflies.length).toBeGreaterThan(0);
      for (const b of butterflies) {
        expect(b.members).toBe(1);
        const s = elevationSampleAt(seed, b.x, b.z);
        expect(forestDensity(seed, b.x, b.z, s)).toBeLessThan(CLUTTER_GRASS_CANOPY_LO);
        expect(clutterDensity(seed, CLUTTER_FLOWER, b.x, b.z, s)).toBeGreaterThan(0);
      }
    });
  }
});

describe("the ground an animal may stand on", () => {
  // The world "hollow": the road's centreline is at x = -322.73 where z = 0, and the pad 9 m inland of it.
  const HOLLOW = 2032433950;

  it("is not the road, the pad, the verge, or the sand to either side of the strip", () => {
    setActiveTerrainVariant("olympic");
    expect(forestGround(HOLLOW, -323, 0)).toBe(false); // the road
    expect(forestGround(HOLLOW, -314, 0)).toBe(false); // the pad
    expect(forestGround(HOLLOW, -302.7267739768348, 0)).toBe(false); // 20 m from the centreline: the road's strip
    expect(forestGround(HOLLOW, -287.06319004698264, 60)).toBe(false); // 60 m along the road, 40 m inland, 7.17 m up: sand
    expect(forestGround(HOLLOW, -287.5514467082555, -60)).toBe(false); // 60 m the other way, 31 m inland, 5.88 m up: sand
  });

  it("is the ground above the sand, and the strip inland of the pad, clear of the road's strip", () => {
    setActiveTerrainVariant("olympic");
    expect(forestGround(HOLLOW, -291.7267739768348, 0)).toBe(true); // 31 m inland on the pad's line, 5.89 m up, read as 14.89 m
    expect(forestGround(HOLLOW, -283, 0)).toBe(true); // 40 m inland, 7.00 m up
    expect(forestGround(HOLLOW, -263, 0)).toBe(true); // 60 m inland, 10.10 m up
    expect(forestGround(HOLLOW, -203, 0)).toBe(true); // 120 m inland, 24.60 m up
    expect(GROUND_SHORE_ALT).toBe(9);
    expect(GROUND_ROAD_CLEAR).toBe(30);
  });
});

describe("the ground each species keeps to", () => {
  const HOLLOW = 2032433950;
  const WALKERS = [SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL];
  const BIRDS = [SPECIES_RAVEN_ROOST, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_EAGLE];

  it("holds the four that walk, and the butterfly, off the sand and the road", () => {
    setActiveTerrainVariant("olympic");
    for (const species of [...WALKERS, SPECIES_BUTTERFLY]) {
      expect(speciesGround(HOLLOW, species, -323, 0), `species ${species} on the road`).toBe(false);
      // 60 m along the road from the pad, to either side of the strip.
      expect(speciesGround(HOLLOW, species, -287.5514467082555, -60), `species ${species} on the sand`).toBe(false);
      expect(speciesGround(HOLLOW, species, -287.06319004698264, 60), `species ${species} where the sand is fading`).toBe(false);
      expect(speciesGround(HOLLOW, species, -263, 0), `species ${species} in the forest`).toBe(true);
      // Inland of the pad, 31 m from the road's centreline on ground 5.89 m up: the strip.
      expect(speciesGround(HOLLOW, species, -291.7267739768348, 0), `species ${species} in the strip`).toBe(true);
    }
  });

  it("holds none of them off a slope: how steep the ground is decides where one is anchored, not where it may go", () => {
    setActiveTerrainVariant("olympic");
    // 112.46 m up and 369.5 m from the road, on a slope of 1.04.
    const s = elevationSampleAt(HOLLOW, 47, 240);
    expect(Math.hypot(s.dx, s.dz)).toBeGreaterThan(MAX_WALKABLE_GRADIENT);
    for (const species of [...WALKERS, SPECIES_BUTTERFLY]) expect(speciesGround(HOLLOW, species, 47, 240), `species ${species}`).toBe(true);
    expect(forestGround(HOLLOW, 47, 240)).toBe(true);
  });

  it("holds no bird anywhere", () => {
    setActiveTerrainVariant("olympic");
    for (const species of BIRDS) {
      expect(speciesGround(HOLLOW, species, -323, 0), `species ${species} over the road`).toBe(true);
      expect(speciesGround(HOLLOW, species, -291, 0), `species ${species} over the sand`).toBe(true);
      expect(speciesGround(HOLLOW, species, -340, 0), `species ${species} over the water's edge`).toBe(true);
    }
  });
});

describe("lastAllowed", () => {
  const inland = (x: number): boolean => x <= 10;

  it("is the goal itself where the whole way there is allowed", () => {
    expect(lastAllowed((x) => inland(x), 0, 0, 8, 6)).toEqual({ x: 8, z: 6 });
  });

  it("stops at the edge of the allowed ground, to a quarter of a metre", () => {
    const p = lastAllowed((x) => inland(x), 0, 0, 30, 0);
    expect(p.x).toBeGreaterThanOrEqual(9.75);
    expect(p.x).toBeLessThanOrEqual(10);
    expect(p.z).toBe(0);
    const q = lastAllowed((x) => inland(x), 0, 0, 30, 40);
    expect(q.x).toBeGreaterThanOrEqual(9.75);
    expect(q.x).toBeLessThanOrEqual(10);
    expect(q.z / q.x).toBeCloseTo(40 / 30, 9);
  });

  it("stops at the first edge it meets, though the goal lies on allowed ground beyond", () => {
    const p = lastAllowed((x) => x <= 10 || x >= 20, 0, 0, 30, 0);
    expect(p.x).toBeGreaterThanOrEqual(9.75);
    expect(p.x).toBeLessThanOrEqual(10);
  });

  it("finds a strip of forbidden ground a metre and a half wide", () => {
    const p = lastAllowed((x) => x <= 10 || x >= 11.5, 0, 0, 30, 0);
    expect(p.x).toBeLessThanOrEqual(10);
    expect(p.x).toBeGreaterThanOrEqual(9.75);
  });

  it("stays where it is when it starts on forbidden ground", () => {
    expect(lastAllowed(() => false, 3, 4, 30, 0)).toEqual({ x: 3, z: 4 });
  });
});
