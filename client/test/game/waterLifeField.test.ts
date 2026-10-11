import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { lakeOf } from "../sim/helpers/lakes.js";
import { marshWeightAt } from "../../src/sim/features.js";
import { lakeShoreInto, newLakeShore } from "../../src/sim/lakeShape.js";
import { elevationAt, type LakeSource } from "../../src/sim/terrain.js";
import { COHORT_SNAG, treesInRect } from "../../src/sim/vegetation.js";
import { CLUTTER_BUSH, CLUTTER_DRIFTLOG, CLUTTER_REED, CLUTTER_SHRUB, clutterInRect } from "../../src/sim/clutter.js";
import {
  BEAT_LENGTH, FROG_SPACING, FROGS_MAX, FROGS_MIN, MARKER_SPACING, MARKERS_MAX, PERCH_SPACING, SHORE_BAND_IN, SHORE_BAND_OUT, SHORE_STEP,
  STEM_AREA, STEMS_MAX, WATER_LIFE_SALT, arcOf, inShoreBand, marshMid, shoreWalk, waterLifeLayout, type WaterLifeLayout,
} from "../../src/game/waterLifeField.js";
import { HEAD_ROW0 } from "../../src/game/midgeMotion.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { stadiumLake, type StadiumOptions } from "../helpers/lakeShapes.js";

/** Room-12's world: its murky lake, with a marsh. */
const SEED = -1458473702;
/** Room-33's world: another murky lake with a marsh. */
const OTHER_SEED = -1844064749;
/** Room-1's world: a clear lake, no marsh. */
const DOWNHILL_SEED = -1098592628;

const R = newLakeShore();
/** The shore distance at (x, z): above 0 in the water. */
const sAt = (lake: LakeSource, x: number, z: number): number => lakeShoreInto(R, lake.shape, x, z).s;
/** A stadium lake at the murky lake's own place, level and murk, no marsh. */
const at = (o: Omit<StadiumOptions, "cx" | "cz">): LakeSource => {
  const lake = lakeOf(SEED);
  return stadiumLake({ cx: lake.x, cz: lake.z, level: lake.level, murk: lake.murk, ...o });
};
/** Nearly round, 25 m across its middle: its shore 2π · 25 + 2 = 159.1 m long. */
const ROUND = { halfLen: 0.5, w: 25 };
/** Long, 20 m in half-width about a 60 m spine: its shore 2π · 20 + 120 = 245.7 m long. */
const LONG = { halfLen: 30, w: 20 };

/** Every number in a layout but the lake's, flattened. */
function numbersOf(layout: WaterLifeLayout): number[] {
  const out: number[] = [];
  for (const m of layout.markers) out.push(m.x, m.y, m.z, m.midges, m.radius, m.height, m.seed);
  for (const b of layout.beats) {
    out.push(b.seed);
    for (const p of b.points) out.push(p.x, p.y, p.z);
    for (const h of b.hovers) out.push(h.x, h.y, h.z, h.faceX, h.faceZ);
  }
  for (const p of [...layout.perches, ...layout.stems]) out.push(p.x, p.y, p.z, p.seed);
  for (const v of layout.voices) out.push(v.x, v.y, v.z, v.seed);
  return out;
}

describe("the shore's walk", () => {
  it("runs the outline by arc length, its total the shore's length to the 2 m march", () => {
    const round = at(ROUND), long = at(LONG);
    expect(shoreWalk(round.shape).total).toBeCloseTo(2 * Math.PI * 25 + 2, 0);
    expect(shoreWalk(long.shape).total).toBeCloseTo(2 * Math.PI * 20 + 120, 0);
    const w = shoreWalk(long.shape);
    expect(w.at[0]).toBe(0);
    for (let i = 1; i < w.xs.length; i++) expect(w.at[i]!).toBeGreaterThanOrEqual(w.at[i - 1]!);
    // A point's arc is its nearest outline point's.
    expect(arcOf(w, w.xs[7]!, w.zs[7]!)).toBe(w.at[7]);
  });
});

describe("the water life's layout", { timeout: timeLimit(60_000) }, () => {
  it("states its spacings and salts", () => {
    expect([SHORE_BAND_IN, SHORE_BAND_OUT, MARKER_SPACING, BEAT_LENGTH, PERCH_SPACING, STEM_AREA, STEMS_MAX, FROG_SPACING, FROGS_MIN, FROGS_MAX, SHORE_STEP])
      .toEqual([8, 15, 10, 20, 8, 4, 40, 25, 6, 12, 2]);
    expect(WATER_LIFE_SALT).toEqual({ marker: 60, beat: 61, perch: 62, bed: 63, stem: 64, stemDraw: 65, voice: 66, head: 67 });
    expect(Object.isFrozen(WATER_LIFE_SALT)).toBe(true);
    // No more markers than the swarms' table has rows for.
    expect(MARKERS_MAX).toBe(25);
    expect(MARKERS_MAX).toBe(HEAD_ROW0);
  });

  it("is the same for a seed and a lake, and another seed moves it", () => {
    const lake = lakeOf(SEED);
    const a = waterLifeLayout(SEED, lake);
    const b = waterLifeLayout(SEED, lake);
    expect(b).toEqual(a);
    expect(a.lake).toBe(lake);
    const other = waterLifeLayout(SEED + 1, lake);
    expect(other.markers.map((m) => m.seed)).not.toEqual(a.markers.map((m) => m.seed));
  });

  it("counts by the shore's length: a marker a 10 m (25 at most), a beat a 20 m, a perch an 8 m", () => {
    // [shape, markers, beats, perches, stems, voices]: 159.1 / 10 → 16, / 20 → 8,
    // / 8 → 20, one stretch of which holds nothing to perch on; 245.7 / 10 → 25,
    // / 20 → 12, / 8 → 31.
    const table: [typeof ROUND, number, number, number, number, number][] = [
      [ROUND, 16, 8, 19, 40, 6],
      [LONG, 25, 12, 31, 40, 10],
    ];
    for (const [shape, markers, beats, perches, stems, voices] of table) {
      const layout = waterLifeLayout(SEED, at(shape));
      expect([layout.markers.length, layout.beats.length, layout.perches.length, layout.stems.length, layout.voices.length])
        .toEqual([markers, beats, perches, stems, voices]);
      expect(layout.voices.length).toBeGreaterThanOrEqual(6);
      expect(layout.voices.length).toBeLessThanOrEqual(12);
      for (const b of layout.beats) {
        expect(b.points.length).toBe(5);
        expect(b.hovers.length).toBeGreaterThanOrEqual(2);
        expect(b.hovers.length).toBeLessThanOrEqual(3);
      }
      for (const v of numbersOf(layout)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("sizes and shapes each swarm: 60 to 400 midges, a ball below 200, a column above", () => {
    const layout = waterLifeLayout(SEED, at(LONG));
    expect(layout.markers.map((m) => m.midges)).toEqual([
      61, 221, 247, 332, 137, 70, 62, 67, 369, 135, 63, 66, 133, 112, 188, 75, 109, 72, 179, 96, 187, 389, 81, 92, 68,
    ]);
    for (const m of layout.markers) {
      expect(m.radius).toBeCloseTo(0.3 + 0.0012 * m.midges, 12);
      expect(m.column).toBe(m.midges > 200);
      if (m.column) {
        expect(m.height).toBeGreaterThanOrEqual(1);
        expect(m.height).toBeLessThanOrEqual(1.5);
      } else {
        expect(m.height).toBe(m.radius);
      }
      expect(Number.isInteger(m.seed)).toBe(true);
      expect(m.seed).toBeGreaterThanOrEqual(0);
      expect(m.seed).toBeLessThan(4096);
    }
  });

  it("sets a marker on the shore's shrubs before its reeds, logs and snags, and one in three over open water", () => {
    // [seed, markers, on shrubs and bushes, on reeds, logs and snags, over open water]
    const cases: [number, number, number, number, number][] = [
      [SEED, 25, 15, 2, 8],
      [OTHER_SEED, 25, 17, 2, 6],
    ];
    for (const [seed, markers, shrubbed, otherwise, water] of cases) {
      const lake = lakeOf(seed);
      const layout = waterLifeLayout(seed, lake);
      const walk = shoreWalk(lake.shape);
      const reach = lake.shape.shoreMax + 20;
      const box = [lake.x - reach, lake.z - reach, lake.x + reach, lake.z + reach] as const;
      // [x, z, ground, top] of every candidate the band holds, by preference
      const shrubs = [...clutterInRect(seed, CLUTTER_SHRUB, ...box), ...clutterInRect(seed, CLUTTER_BUSH, ...box)]
        .filter((c) => inShoreBand(lake, c.x, c.z)).map((c) => [c.x, c.z, c.groundH, 1.5] as const);
      const others = [
        ...clutterInRect(seed, CLUTTER_REED, ...box).filter((c) => inShoreBand(lake, c.x, c.z)).map((c) => [c.x, c.z, c.groundH, 1.5] as const),
        ...clutterInRect(seed, CLUTTER_DRIFTLOG, ...box).filter((c) => inShoreBand(lake, c.x, c.z)).map((c) => [c.x, c.z, c.groundH, 0.6] as const),
        ...treesInRect(seed, ...box).filter((t) => t.cohort === COHORT_SNAG).map((t) => [t.x, t.z, t.groundH, 6] as const),
      ];
      const n = layout.markers.length;
      const stretchOf = (x: number, z: number): number => Math.min(n - 1, Math.floor((arcOf(walk, x, z) / walk.total) * n));
      let onShrubs = 0, onOthers = 0;
      layout.markers.forEach((m, i) => {
        if (m.water) return;
        const shrub = shrubs.find(([x, z]) => x === m.x && z === m.z);
        const under = shrub ?? others.find(([x, z]) => x === m.x && z === m.z);
        expect(under).toBeDefined();
        const [x, z, ground, top] = under!;
        expect(stretchOf(x, z)).toBe(i);
        expect(m.y - ground - top).toBeGreaterThanOrEqual(1);
        expect(m.y - ground - top).toBeLessThanOrEqual(4);
        if (shrub !== undefined) {
          onShrubs++;
        } else {
          onOthers++;
          // a reed, log or snag only where the stretch holds no shrub or bush
          expect(shrubs.filter(([sx, sz]) => stretchOf(sx, sz) === i)).toEqual([]);
        }
      });
      expect([seed, n, onShrubs, onOthers, layout.markers.filter((m) => m.water).length]).toEqual([seed, markers, shrubbed, otherwise, water]);
    }
  });

  it("holds an open-water swarm 2 to 8 m in from the shore, 1 to 2 m over the water", () => {
    for (const shape of [ROUND, LONG]) {
      const lake = at(shape);
      const water = waterLifeLayout(SEED, lake).markers.filter((m) => m.water);
      expect(water.length).toBeGreaterThan(0);
      for (const m of water) {
        // Along the stadium's own normal the shore distance is the way in,
        // to the outline's few centimetres off the shore on the caps.
        expect(sAt(lake, m.x, m.z)).toBeGreaterThanOrEqual(2 - 0.05);
        expect(sAt(lake, m.x, m.z)).toBeLessThanOrEqual(8 + 0.05);
        expect(m.y - lake.level).toBeGreaterThanOrEqual(1);
        expect(m.y - lake.level).toBeLessThanOrEqual(2);
      }
    }
  });

  it("still gives a lake whose band holds nothing open-water swarms, and no perch or stem", () => {
    // Far out to sea, 1.1 km past the coast: no shrub, reed, log or tree.
    const lake: LakeSource = stadiumLake({ cx: -1500, cz: 0, halfLen: 0.5, w: 26, level: 0, murk: 0.2 });
    const reach = lake.shape.shoreMax + 20;
    const box = [lake.x - reach, lake.z - reach, lake.x + reach, lake.z + reach] as const;
    for (const cls of [CLUTTER_SHRUB, CLUTTER_BUSH, CLUTTER_REED, CLUTTER_DRIFTLOG]) expect(clutterInRect(SEED, cls, ...box)).toEqual([]);
    expect(treesInRect(SEED, ...box)).toEqual([]);
    const layout = waterLifeLayout(SEED, lake);
    // 2π · 26 + 2 = 165.4 m of shore: 17 markers, 8 beats, 7 frogs.
    expect(layout.markers.length).toBe(17);
    for (const m of layout.markers) {
      expect(m.water).toBe(true);
      expect(sAt(lake, m.x, m.z)).toBeGreaterThanOrEqual(2 - 0.05);
      expect(sAt(lake, m.x, m.z)).toBeLessThanOrEqual(8 + 0.05);
    }
    expect([layout.perches.length, layout.stems.length, layout.beats.length, layout.voices.length]).toEqual([0, 0, 8, 7]);
  });

  it("runs every darner's beat 1 to 3 m in over the water, its hovers facing the shore", () => {
    for (const shape of [ROUND, LONG]) {
      const lake = at(shape);
      const layout = waterLifeLayout(SEED, lake);
      const over = (p: { x: number; y: number; z: number }): void => {
        expect(sAt(lake, p.x, p.z)).toBeGreaterThanOrEqual(1 - 0.05);
        expect(sAt(lake, p.x, p.z)).toBeLessThanOrEqual(3 + 0.05);
        expect(p.y - lake.level).toBeGreaterThanOrEqual(0.5);
        expect(p.y - lake.level).toBeLessThanOrEqual(2);
      };
      /** Where the shore's normal through a point meets the shore. */
      const foot = (p: { x: number; z: number }): [number, number] => {
        const r = lakeShoreInto(R, lake.shape, p.x, p.z);
        const g = Math.hypot(r.sx, r.sz);
        return [p.x - (r.sx / g) * r.s, p.z - (r.sz / g) * r.s];
      };
      layout.beats.forEach((b, i) => {
        for (const p of b.points) over(p);
        for (const h of b.hovers) {
          over(h);
          // facing out along the shore's normal: down the shore distance's slope
          const r = lakeShoreInto(R, lake.shape, h.x, h.z);
          const g = Math.hypot(r.sx, r.sz);
          expect(Math.hypot(h.faceX, h.faceZ)).toBeCloseTo(1, 12);
          expect((h.faceX * -r.sx + h.faceZ * -r.sz) / g).toBeCloseTo(1, 6);
        }
        // the beats share their ends, so the shore is covered all round: the
        // last point of one and the first of the next stand on one normal
        const next = layout.beats[(i + 1) % layout.beats.length]!;
        const [ex, ez] = foot(b.points[b.points.length - 1]!), [sx, sz] = foot(next.points[0]!);
        expect(Math.hypot(ex - sx, ez - sz)).toBeLessThan(1e-6);
      });
    }
  });

  it("perches the skimmers on the band's reeds and shrubs and stands the damselflies in its beds", () => {
    const lake = lakeOf(SEED);
    const layout = waterLifeLayout(SEED, lake);
    for (const p of layout.perches) {
      expect(inShoreBand(lake, p.x, p.z)).toBe(true);
      // 0.3 to 1.5 m up from the ground, or from the water for a reed in the shallows
      expect(p.y - elevationAt(SEED, p.x, p.z)).toBeGreaterThanOrEqual(0.3);
      expect(p.y - Math.max(elevationAt(SEED, p.x, p.z), lake.level)).toBeLessThanOrEqual(1.5);
    }
    for (const s of layout.stems) {
      expect(inShoreBand(lake, s.x, s.z)).toBe(true);
      expect(s.y - lake.level).toBeGreaterThanOrEqual(0.3);
    }
    // a few beds, not forty scattered stems: most stems have another within 3 m
    const near = layout.stems.filter((s) => layout.stems.some((t) => t !== s && Math.hypot(t.x - s.x, t.z - s.z) < 3)).length;
    expect([layout.perches.length, layout.stems.length, near]).toEqual([38, 40, 39]);
  });

  it("stands a perch or a stem on its footing: the water's level only where there is water under a reed, and no perch on a bank over 1 m below it", () => {
    // Room-1's lake, and a round lake of 30 m at its place 5 m over its
    // level, its bank fallen away: 12 of its 20 perches would stand on
    // shrubs and bushes over 1 m below the water, so they are left out, and
    // 17 stems are wet plants on dry ground over 1 m below it.
    const room1 = lakeOf(DOWNHILL_SEED);
    const raised = stadiumLake({ cx: room1.x, cz: room1.z, halfLen: 0.5, w: 30, level: room1.level + 5, murk: room1.murk });
    const level = stadiumLake({ cx: room1.x, cz: room1.z, halfLen: 0.5, w: 30, level: room1.level, murk: room1.murk });
    // [seed, lake, perches, stems, perches on reeds, perches on land over 1 m below the water, stems on dry ground over 1 m below it]
    const cases: [number, LakeSource, number, number, number, number, number][] = [
      [DOWNHILL_SEED, room1, 31, 40, 0, 0, 0],
      [DOWNHILL_SEED, level, 20, 40, 0, 0, 0],
      [DOWNHILL_SEED, raised, 8, 40, 0, 0, 17],
      [SEED, lakeOf(SEED), 38, 40, 38, 0, 0],
      [OTHER_SEED, lakeOf(OTHER_SEED), 46, 40, 46, 0, 0],
    ];
    for (const [seed, lake, perches, stems, onReeds, onLandBelow, onDryBelow] of cases) {
      const layout = waterLifeLayout(seed, lake);
      const reach = lake.shape.shoreMax + SHORE_BAND_OUT;
      const reeds = clutterInRect(seed, CLUTTER_REED, lake.x - reach, lake.z - reach, lake.x + reach, lake.z + reach)
        .filter((c) => inShoreBand(lake, c.x, c.z));
      const onReed = (p: { x: number; z: number }): boolean => reeds.some((c) => c.x === p.x && c.z === p.z);
      const ground = (p: { x: number; z: number }): number => elevationAt(seed, p.x, p.z);
      // water under it: inside the shore or on the marsh
      const wet = (p: { x: number; z: number }): boolean => sAt(lake, p.x, p.z) > 0 || marshWeightAt(lake.shape, lake.lobe, p.x, p.z) > 0;
      const footing = (p: { x: number; z: number }): number => (wet(p) ? Math.max(ground(p), lake.level) : ground(p));
      const reedPerches = layout.perches.filter(onReed);
      const landPerches = layout.perches.filter((p) => !onReed(p));
      expect([
        seed, layout.perches.length, layout.stems.length, reedPerches.length,
        landPerches.filter((p) => lake.level - ground(p) > 1).length,
        layout.stems.filter((st) => !wet(st) && lake.level - ground(st) > 1).length,
      ]).toEqual([seed, perches, stems, onReeds, onLandBelow, onDryBelow]);
      // a perch is 0.3 to 1.5 m up from its footing, a stem 0.3 to 1 m: the ground for a shrub, bush or log,
      // none of which stands over 1 m below the water; for a reed or a stem the ground too, unless it is
      // inside the shore or on the marsh, where the water's level if that is above the ground
      for (const p of landPerches) {
        expect(p.y - ground(p)).toBeGreaterThanOrEqual(0.3);
        expect(p.y - ground(p)).toBeLessThanOrEqual(1.5);
      }
      for (const p of reedPerches) {
        expect(p.y - footing(p)).toBeGreaterThanOrEqual(0.3);
        expect(p.y - footing(p)).toBeLessThanOrEqual(1.5);
      }
      for (const st of layout.stems) {
        expect(st.y - footing(st)).toBeGreaterThanOrEqual(0.3);
        expect(st.y - footing(st)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("sets the frogs at the water's edge, more of them along the marsh", () => {
    const lake = lakeOf(SEED);
    expect(lake.lobe).not.toBeNull();
    const mid = marshMid(lake.shape);
    // half the shelf of min(10, 0.4 · sMax) at sMax 17.93
    expect(mid).toBeCloseTo(3.5855, 4);
    const marshy = waterLifeLayout(SEED, lake);
    const plain = waterLifeLayout(SEED, { ...lake, lobe: null });
    for (const v of [...marshy.voices, ...plain.voices]) {
      expect(v.y).toBe(lake.level);
      // Set off the walk's straight 2 m pieces along the shore's normal: the
      // shore's bend moves the distance by up to 0.07 m at the edge, and up
      // to 0.64 m at the marsh's middle, 3.59 m in.
      if (v.marsh) {
        // in the marsh's middle, where it is all water's edge
        expect(Math.abs(sAt(lake, v.x, v.z) - mid)).toBeLessThanOrEqual(0.7);
        expect(marshWeightAt(lake.shape, lake.lobe, v.x, v.z)).toBeGreaterThan(0);
      } else {
        expect(Math.abs(sAt(lake, v.x, v.z))).toBeLessThanOrEqual(0.6);
      }
    }
    expect(plain.voices.some((v) => v.marsh)).toBe(false);
    // the voices whose stretch of shore fronts the marsh: more with it than without, both at the cap of 12
    const alongMarsh = (v: { x: number; z: number }): boolean => {
      const r = lakeShoreInto(R, lake.shape, v.x, v.z);
      const g = Math.hypot(r.sx, r.sz);
      const nx = -r.sx / g, nz = -r.sz / g;
      return marshWeightAt(lake.shape, lake.lobe, v.x + nx * (r.s - mid), v.z + nz * (r.s - mid)) > 0;
    };
    expect([marshy.voices.length, marshy.voices.filter(alongMarsh).length, marshy.voices.filter((v) => v.marsh).length])
      .toEqual([12, 4, 4]);
    expect([plain.voices.length, plain.voices.filter(alongMarsh).length]).toEqual([12, 3]);
  });

  it("bands the shore from 8 m in to 15 m out by the shore distance, and the marsh beyond it", () => {
    // 30 m about a spine from z = −10 to 10, its marsh toward +z.
    const lake = stadiumLake({ cx: 0, cz: 0, halfLen: 10, w: 30, level: 0, murk: 1, lobe: { dirX: 0, dirZ: 1, width: 30 } });
    expect(inShoreBand(lake, 0, 0)).toBe(false);
    // across the spine, along +x: s = 30 − x
    expect(inShoreBand(lake, 30, 0)).toBe(true);
    expect(inShoreBand(lake, 22.1, 0)).toBe(true);
    expect(inShoreBand(lake, 21.9, 0)).toBe(false);
    expect(inShoreBand(lake, 44.9, 0)).toBe(true);
    expect(inShoreBand(lake, 45.1, 0)).toBe(false);
    // 9 m in off the +z cap: past the band, but on the marsh; off the −z cap, across the lake from it, not
    expect(inShoreBand(lake, 0, 31)).toBe(true);
    expect(inShoreBand(lake, 0, -31)).toBe(false);
  });
});
