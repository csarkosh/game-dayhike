import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { lakeOf } from "../sim/helpers/lakes.js";
import { marshWeightAt } from "../../src/sim/features.js";
import { elevationAt, type LakeSource } from "../../src/sim/terrain.js";
import { COHORT_SNAG, treesInRect } from "../../src/sim/vegetation.js";
import { CLUTTER_BUSH, CLUTTER_DRIFTLOG, CLUTTER_REED, CLUTTER_SHRUB, clutterInRect } from "../../src/sim/clutter.js";
import {
  BEAT_LENGTH, FROG_SPACING, FROGS_MAX, FROGS_MIN, MARKER_SPACING, PERCH_SPACING, SHORE_BAND_IN, SHORE_BAND_OUT,
  STEM_AREA, STEMS_MAX, WATER_LIFE_SALT, inShoreBand, waterLifeLayout, type WaterLifeLayout,
} from "../../src/game/waterLifeField.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** The first lobby world with a murky lake (`firstPondWorld`'s pick for
 * murk ≥ 0.8, the water plants' world): radius 26 m, with a marsh. */
const SEED = -1065037390;
/** Another lobby world's murky lake, radius 30.5 m. */
const OTHER_SEED = -1458473702;
/** Lobby worlds whose lakes have banks that fall away from the water: in the
 * first, 6 of the 21 perches are on shrubs and bushes 1 to 9 m below it; in
 * the second (radius 26.1 m), 16 stems are wet plants of the outer bank 7 m
 * below it, on dry ground. */
const DOWNHILL_SEED = -1098592628;
const FALLING_SEED = -1048259771;

/** The lake at another radius, the rest of it as it is. */
const sized = (lake: LakeSource, radius: number): LakeSource => ({ ...lake, radius });
const TAU = 2 * Math.PI;
const angleOf = (lake: LakeSource, x: number, z: number): number => {
  const a = Math.atan2(z - lake.z, x - lake.x);
  return a < 0 ? a + TAU : a;
};
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

describe("the water life's layout", { timeout: timeLimit(60_000) }, () => {
  it("states its spacings and salts", () => {
    expect([SHORE_BAND_IN, SHORE_BAND_OUT, MARKER_SPACING, BEAT_LENGTH, PERCH_SPACING, STEM_AREA, STEMS_MAX, FROG_SPACING, FROGS_MIN, FROGS_MAX])
      .toEqual([8, 15, 10, 20, 8, 4, 40, 25, 6, 12]);
    expect(WATER_LIFE_SALT).toEqual({ marker: 60, beat: 61, perch: 62, bed: 63, stem: 64, stemDraw: 65, voice: 66, head: 67 });
    expect(Object.isFrozen(WATER_LIFE_SALT)).toBe(true);
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

  it("puts every count in its range for lakes of 25 and 40 m", () => {
    const lake = lakeOf(SEED);
    // [radius, markers, beats, perches, stems, voices]
    const table: [number, number, number, number, number, number][] = [
      [25, 16, 8, 20, 40, 7],
      [40, 25, 13, 31, 40, 11],
    ];
    for (const [radius, markers, beats, perches, stems, voices] of table) {
      const layout = waterLifeLayout(SEED, sized(lake, radius));
      expect([radius, layout.markers.length, layout.beats.length, layout.perches.length, layout.stems.length, layout.voices.length])
        .toEqual([radius, markers, beats, perches, stems, voices]);
      expect(layout.markers.length).toBeGreaterThanOrEqual(16);
      expect(layout.markers.length).toBeLessThanOrEqual(25);
      expect(layout.voices.length).toBeGreaterThanOrEqual(6);
      expect(layout.voices.length).toBeLessThanOrEqual(12);
      expect(layout.stems.length).toBeLessThanOrEqual(40);
      for (const b of layout.beats) {
        expect(b.points.length).toBe(5);
        expect(b.hovers.length).toBeGreaterThanOrEqual(2);
        expect(b.hovers.length).toBeLessThanOrEqual(3);
      }
      for (const v of numbersOf(layout)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("sizes and shapes each swarm: 60 to 400 midges, a ball below 200, a column above", () => {
    const layout = waterLifeLayout(SEED, sized(lakeOf(SEED), 40));
    expect(layout.markers.map((m) => m.midges)).toEqual([
      135, 283, 88, 60, 172, 83, 179, 206, 82, 60, 67, 119, 184, 173, 160, 172, 63, 197, 251, 128, 165, 121, 70, 63, 131,
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
    // [seed, lake, markers, on shrubs and bushes, on reeds, logs and snags, over open water]
    const cases: [number, LakeSource, number, number, number, number][] = [
      [SEED, lakeOf(SEED), 16, 11, 0, 5],
      // a murky lake of radius 30.5 m drawn in to 25 m, its band reaching over the reeds of its shallows
      [OTHER_SEED, sized(lakeOf(OTHER_SEED), 25), 16, 7, 4, 5],
    ];
    for (const [seed, lake, markers, shrubbed, otherwise, water] of cases) {
      const layout = waterLifeLayout(seed, lake);
      const reach = lake.radius + 20;
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
      const stretchOf = (x: number, z: number): number => Math.min(n - 1, Math.floor((angleOf(lake, x, z) / TAU) * n));
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

  it("holds an open-water swarm 2 to 8 m in from the rim, 1 to 2 m over the water", () => {
    const lake = lakeOf(SEED);
    for (const radius of [25, 40]) {
      const layout = waterLifeLayout(SEED, sized(lake, radius));
      const water = layout.markers.filter((m) => m.water);
      expect(water.length).toBeGreaterThan(0);
      for (const m of water) {
        const r = Math.hypot(m.x - lake.x, m.z - lake.z);
        expect(r).toBeGreaterThanOrEqual(radius - 8);
        expect(r).toBeLessThanOrEqual(radius - 2);
        expect(m.y - lake.level).toBeGreaterThanOrEqual(1);
        expect(m.y - lake.level).toBeLessThanOrEqual(2);
      }
    }
  });

  it("still gives a lake whose band holds nothing open-water swarms, and no perch or stem", () => {
    // Far out to sea, 1.1 km past the coast: no shrub, reed, log or tree.
    const lake: LakeSource = { kind: "lake", level: 0, x: -1500, z: 0, radius: 26, murk: 0.2, lobe: null };
    const reach = lake.radius + 20;
    const box = [lake.x - reach, lake.z - reach, lake.x + reach, lake.z + reach] as const;
    for (const cls of [CLUTTER_SHRUB, CLUTTER_BUSH, CLUTTER_REED, CLUTTER_DRIFTLOG]) expect(clutterInRect(SEED, cls, ...box)).toEqual([]);
    expect(treesInRect(SEED, ...box)).toEqual([]);
    const layout = waterLifeLayout(SEED, lake);
    expect(layout.markers.length).toBe(16);
    for (const m of layout.markers) {
      expect(m.water).toBe(true);
      const r = Math.hypot(m.x - lake.x, m.z - lake.z);
      expect(r).toBeGreaterThanOrEqual(lake.radius - 8);
      expect(r).toBeLessThanOrEqual(lake.radius - 2);
    }
    expect([layout.perches.length, layout.stems.length, layout.beats.length, layout.voices.length]).toEqual([0, 0, 8, 7]);
  });

  it("runs every darner's beat 1 to 3 m out over the water, its hovers facing the shore", () => {
    const lake = lakeOf(SEED);
    for (const radius of [25, 40]) {
      const layout = waterLifeLayout(SEED, sized(lake, radius));
      const over = (p: { x: number; y: number; z: number }): void => {
        const r = Math.hypot(p.x - lake.x, p.z - lake.z);
        expect(r).toBeGreaterThanOrEqual(radius - 3);
        expect(r).toBeLessThanOrEqual(radius - 1);
        expect(p.y - lake.level).toBeGreaterThanOrEqual(0.5);
        expect(p.y - lake.level).toBeLessThanOrEqual(2);
      };
      layout.beats.forEach((b, i) => {
        for (const p of b.points) over(p);
        for (const h of b.hovers) {
          over(h);
          const r = Math.hypot(h.x - lake.x, h.z - lake.z);
          expect(Math.hypot(h.faceX, h.faceZ)).toBeCloseTo(1, 12);
          expect((h.faceX * (h.x - lake.x) + h.faceZ * (h.z - lake.z)) / r).toBeCloseTo(1, 12);
        }
        // the beats share their ends, so the rim is covered all round
        const next = layout.beats[(i + 1) % layout.beats.length]!;
        const end = b.points[b.points.length - 1]!, start = next.points[0]!;
        const gap = Math.abs(angleOf(lake, end.x, end.z) - angleOf(lake, start.x, start.z));
        expect(Math.min(gap, TAU - gap)).toBeLessThan(1e-9);
      });
    }
  });

  it("perches the skimmers on the band's reeds and shrubs and stands the damselflies in its beds", () => {
    const lake = lakeOf(SEED);
    const layout = waterLifeLayout(SEED, lake);
    for (const p of layout.perches) {
      expect(inShoreBand(lake, p.x, p.z)).toBe(true);
      // 0.3 to 1.5 m up, and 0.6 m more for a reed in the shallows, lifted to the water
      expect(p.y - elevationAt(SEED, p.x, p.z)).toBeGreaterThanOrEqual(0.3);
      expect(p.y - elevationAt(SEED, p.x, p.z)).toBeLessThanOrEqual(2.1);
    }
    for (const s of layout.stems) {
      expect(inShoreBand(lake, s.x, s.z)).toBe(true);
      expect(s.y - lake.level).toBeGreaterThanOrEqual(0.3);
    }
    // a few beds, not forty scattered stems: most stems have another within 3 m
    const near = layout.stems.filter((s) => layout.stems.some((t) => t !== s && Math.hypot(t.x - s.x, t.z - s.z) < 3)).length;
    expect([layout.perches.length, layout.stems.length, near]).toEqual([20, 40, 36]);
  });

  it("stands a perch or a stem on its footing: the water's level only where there is water under a reed", () => {
    // [seed, perches, stems, perches on reeds, perches on land over 1 m below the water, stems on dry ground over 1 m below it]
    const cases: [number, number, number, number, number, number][] = [
      [DOWNHILL_SEED, 21, 40, 0, 6, 0],
      [FALLING_SEED, 20, 40, 0, 11, 16],
      [SEED, 20, 40, 19, 0, 0],
      [OTHER_SEED, 24, 40, 24, 0, 0],
    ];
    for (const [seed, perches, stems, onReeds, onLandBelow, onDryBelow] of cases) {
      const lake = lakeOf(seed);
      const layout = waterLifeLayout(seed, lake);
      const reach = lake.radius + SHORE_BAND_OUT;
      const reeds = clutterInRect(seed, CLUTTER_REED, lake.x - reach, lake.z - reach, lake.x + reach, lake.z + reach)
        .filter((c) => inShoreBand(lake, c.x, c.z));
      const onReed = (p: { x: number; z: number }): boolean => reeds.some((c) => c.x === p.x && c.z === p.z);
      const ground = (p: { x: number; z: number }): number => elevationAt(seed, p.x, p.z);
      // water under it: inside the rim or on the marsh
      const wet = (p: { x: number; z: number }): boolean => Math.hypot(p.x - lake.x, p.z - lake.z) < lake.radius || marshWeightAt(lake, p.x, p.z) > 0;
      const footing = (p: { x: number; z: number }): number => (wet(p) ? Math.max(ground(p), lake.level) : ground(p));
      const reedPerches = layout.perches.filter(onReed);
      const landPerches = layout.perches.filter((p) => !onReed(p));
      expect([
        seed, layout.perches.length, layout.stems.length, reedPerches.length,
        landPerches.filter((p) => lake.level - ground(p) > 1).length,
        layout.stems.filter((st) => !wet(st) && lake.level - ground(st) > 1).length,
      ]).toEqual([seed, perches, stems, onReeds, onLandBelow, onDryBelow]);
      // a perch is 0.3 to 1.5 m up from its footing, a stem 0.3 to 1 m: the ground for a shrub, bush or log,
      // however far the bank falls below the water; for a reed or a stem the ground too, unless it is
      // inside the rim or on the marsh, where the water's level if that is above the ground
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
    const lake = sized(lakeOf(SEED), 40);
    expect(lake.lobe).not.toBeNull();
    const marshy = waterLifeLayout(SEED, lake);
    const plain = waterLifeLayout(SEED, { ...lake, lobe: null });
    for (const v of [...marshy.voices, ...plain.voices]) {
      expect(v.y).toBe(lake.level);
      const r = Math.hypot(v.x - lake.x, v.z - lake.z);
      if (v.marsh) {
        // in the marsh's middle, 5 m in, where it is all water's edge
        expect(r).toBeCloseTo(lake.radius - 5, 9);
        expect(marshWeightAt(lake, v.x, v.z)).toBeGreaterThan(0);
      } else {
        expect(Math.abs(r - lake.radius)).toBeLessThanOrEqual(0.5);
      }
    }
    expect(plain.voices.some((v) => v.marsh)).toBe(false);
    // the voices whose bearing crosses the marsh: half again as many with it as without
    const alongMarsh = (v: { x: number; z: number }): boolean => {
      const a = angleOf(lake, v.x, v.z);
      return marshWeightAt(lake, lake.x + (lake.radius - 5) * Math.cos(a), lake.z + (lake.radius - 5) * Math.sin(a)) > 0;
    };
    expect([marshy.voices.length, marshy.voices.filter(alongMarsh).length, marshy.voices.filter((v) => v.marsh).length])
      .toEqual([11, 2, 2]);
    expect([plain.voices.length, plain.voices.filter(alongMarsh).length]).toEqual([10, 1]);
  });

  it("bands the shore from 8 m in to 15 m out, and the marsh beyond it", () => {
    const lake = lakeOf(SEED);
    const R = lake.radius;
    const lobe = lake.lobe!;
    // away from the marsh, at right angles to it
    const at = (r: number, dirX: number, dirZ: number): [number, number] => [lake.x + r * dirX, lake.z + r * dirZ];
    const side = [-lobe.dirZ, lobe.dirX] as const;
    expect(inShoreBand(lake, lake.x, lake.z)).toBe(false);
    expect(inShoreBand(lake, ...at(R, ...side))).toBe(true);
    expect(inShoreBand(lake, ...at(R - 7.9, ...side))).toBe(true);
    expect(inShoreBand(lake, ...at(R - 8.1, ...side))).toBe(false);
    expect(inShoreBand(lake, ...at(R + 14.9, ...side))).toBe(true);
    expect(inShoreBand(lake, ...at(R + 15.1, ...side))).toBe(false);
    // 9 m in: past the band, but on the marsh along its direction, not across the lake from it
    expect(inShoreBand(lake, ...at(R - 9, lobe.dirX, lobe.dirZ))).toBe(true);
    expect(inShoreBand(lake, ...at(R - 9, -lobe.dirX, -lobe.dirZ))).toBe(false);
  });
});
