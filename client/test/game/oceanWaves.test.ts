import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { coveFor } from "../../src/sim/olympic.js";
import { elevationAt } from "../../src/sim/terrain.js";
import {
  OCEAN_BORE_RATIO, OCEAN_BREAK_FULL, SHELTER_CHOP, SHELTER_SWELL, SHELTER_WIDTH,
  atlasRead, boreArrivals, coastRead, crestAt, oceanFieldFor, oceanFieldFromState, shelterAt, swellAt, swellNormal,
  swellPhases, type OceanField,
} from "../../src/game/oceanWaves.js";
import {
  OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_DRY_DEPTH, OCEAN_PHASE_BLEND, OCEAN_ROW_BAY_FIRST, OCEAN_ROW_COAST,
  OCEAN_ROW_COVE_FIRST, OCEAN_ROW_COVE_PROFILE, coastProfilesFor, writeCoastRow,
} from "../../src/game/oceanTables.js";
import { SWELL_Q_SUM_MAX, type SwellState } from "../../src/game/oceanSwell.js";
import { WEGGEL_GAMMA_MAX, breakerIndex } from "../../src/game/oceanPhysics.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = LOBBY_SEEDS[0] as number;
/** The typical day: Hs 2.0 m, Tp 11 s, square on to the shore. */
const TYPICAL: SwellState = { hs: 2, tp: 11, dirFromDeg: 270, gamma: 3.3, spread: 25 };

/** The coastline's x at z, as the field reads it. */
const shoreX = (field: OceanField, z: number): number => coastRead(field.tables, z)[0];

/** The first lobby world whose headland `i` reaches at least 140 m past the waterline. */
function longHeadland(i: 0 | 1): number {
  const seed = LOBBY_SEEDS.find((s) => (coveFor(s).heads[i] as { reach: number }).reach >= 140);
  if (seed === undefined) throw new Error("no such headland");
  return seed;
}

describe("swellPhases", () => {
  it("folds (phase0 − ω·t) into [0, 2π) in double precision, zeros past the count", () => {
    const field = oceanFieldFor(SEED, 8);
    const phases = swellPhases(field, 3600.25);
    expect(phases).toHaveLength(12);
    for (let c = 0; c < 8; c++) {
      const comp = field.components[c]!;
      const v = comp.phase0 - comp.omega * 3600.25;
      expect(phases[c]).toBe(Math.fround(v - 2 * Math.PI * Math.floor(v / (2 * Math.PI))));
      expect(phases[c]).toBeGreaterThanOrEqual(0);
      expect(phases[c]).toBeLessThanOrEqual(Math.fround(2 * Math.PI));
    }
    expect([...phases.subarray(8)]).toEqual([0, 0, 0, 0]);
  });

  it("writes the same into an array it is given, the renderer's binding each frame, and returns that array", () => {
    const field = oceanFieldFor(SEED, 8);
    const kept = new Float32Array(12).fill(9);
    expect(swellPhases(field, 3600.25, kept)).toBe(kept);
    expect(kept).toEqual(swellPhases(field, 3600.25));
    expect([...kept.subarray(8)]).toEqual([0, 0, 0, 0]);
  });
});

describe("atlasRead and coastRead", () => {
  const field = oceanFieldFor(SEED);
  const t = field.tables;
  const raw = (row: number, i: number) => [0, 1, 2, 3].map((ch) => t.data[(row * t.width + i) * 4 + ch] as number);

  it("read a texel at its column, the mean halfway, and clamp to the row", () => {
    expect(atlasRead(t, OCEAN_ROW_COVE_PROFILE, 700)).toEqual(raw(OCEAN_ROW_COVE_PROFILE, 700));
    const mid = atlasRead(t, OCEAN_ROW_COVE_FIRST, 700.5);
    raw(OCEAN_ROW_COVE_FIRST, 700).forEach((v, ch) =>
      expect(mid[ch]).toBeCloseTo((v + (raw(OCEAN_ROW_COVE_FIRST, 701)[ch] as number)) / 2, 6));
    expect(atlasRead(t, OCEAN_ROW_COVE_PROFILE, -20)).toEqual(raw(OCEAN_ROW_COVE_PROFILE, 0));
    expect(atlasRead(t, OCEAN_ROW_COVE_PROFILE, 5000)).toEqual(raw(OCEAN_ROW_COVE_PROFILE, t.width - 1));
  });

  it("read the coastline row by z from its origin: its four channels and the phase weight's slope to the +z side", () => {
    for (const i of [359, 540, 560]) {
      const z = t.coastOriginZ + i * OCEAN_COAST_STEP;
      const here = raw(OCEAN_ROW_COAST, i);
      const next = raw(OCEAN_ROW_COAST, i + 1);
      const slope = ((next[3] as number) - (here[3] as number)) / OCEAN_COAST_STEP;
      expect(coastRead(t, z)).toEqual([...here, slope]);
      // Halfway to the next texel: the mean, with the same slope.
      const mid = coastRead(t, z + OCEAN_COAST_STEP / 2);
      here.forEach((v, ch) => expect(mid[ch]).toBeCloseTo((v + (next[ch] as number)) / 2, 7));
      expect(mid[4]).toBe(slope);
    }
    // The flank of the cove's phase window has a slope to read: the weight falls from 1 to 0 over 385 m.
    expect(coastRead(t, t.coastOriginZ + 540 * OCEAN_COAST_STEP)[4]).toBeLessThan(-0.0005);
  });

  it("holds the phase weight's slope at 0 where the read is clamped, before the row's first texel", () => {
    const f = oceanFieldFor(SEED, 1);
    writeCoastRow(f.tables, coastProfilesFor(SEED), 6432);
    expect(f.tables.coastOriginZ).toBe(192);
    const first = coastRead(f.tables, 192);
    expect(first[3]).toBeGreaterThan(0.4);
    expect(first[4]).toBeLessThan(-0.001);
    const before = coastRead(f.tables, 100);
    expect(before[3]).toBe(first[3]);
    expect(before[4]).toBe(0);
  });
});

describe("swellAt", () => {
  it("is the same for the same seed and time, on any page", () => {
    const a = oceanFieldFor(SEED);
    const b = oceanFieldFor(SEED);
    const pa = swellPhases(a, 1234.5);
    const pb = swellPhases(b, 1234.5);
    expect(pa).toEqual(pb);
    for (const [x, z] of [[-1500, 40], [-600, -300], [shoreX(a, 0) - 80, 0], [shoreX(a, 0) - 5, 10]] as const) {
      expect(swellAt(a, pa, x, z)).toEqual(swellAt(b, pb, x, z));
    }
  });

  it("is the plane wave far out, continuous across the table's seaward end", () => {
    const field = oceanFieldFor(SEED);
    const phases = swellPhases(field, 77);
    for (const [x, z] of [[-2500, 300], [-3100, -700], [-1900, 1200]] as const) {
      let plane = 0;
      field.components.forEach((c, i) => { plane += c.a0 * Math.cos(c.k0x * x + c.k0z * z + (phases[i] as number)); });
      expect(Math.abs(swellAt(field, phases, x, z).height - plane)).toBeLessThan(1e-3);
    }
    const z = 250;
    const edge = shoreX(field, z) + OCEAN_D_MIN;
    expect(Math.abs(swellAt(field, phases, edge - 1e-3, z).height - swellAt(field, phases, edge + 1e-3, z).height)).toBeLessThan(1e-4);
  });

  it("carries the world's Hs far out: 4·std of the height over 2 km × 2 km within 10 %", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFor(seed);
      const phases = swellPhases(field, 0);
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let x = -4000; x <= -2000; x += 20) {
        for (let z = -1000; z <= 1000; z += 20) {
          const h = swellAt(field, phases, x, z).height;
          sum += h;
          sq += h * h;
          n++;
        }
      }
      const std = Math.sqrt(sq / n - (sum / n) * (sum / n));
      expect(Math.abs(4 * std - field.hs) / field.hs).toBeLessThan(0.1);
    }
  }, timeLimit(60_000));

  it("breaks the typical day's significant wave 55 to 83 m out on the cove's centre line: the research's 69 m within 20 %", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFromState(seed, TYPICAL);
      let first = Number.NaN;
      for (let d = -400; d <= 0; d++) {
        const column = d - OCEAN_D_MIN;
        let energy = 0;
        field.components.forEach((c, i) => {
          energy += (c.a0 * atlasRead(field.tables, OCEAN_ROW_COVE_FIRST + i, column)[2]) ** 2 / 2;
        });
        const height = 4 * Math.sqrt(energy);
        const depth = atlasRead(field.tables, OCEAN_ROW_COVE_PROFILE, column)[0];
        if (height > breakerIndex(0.02, height, 11) * depth) {
          first = d;
          break;
        }
      }
      expect(first).toBeGreaterThanOrEqual(-83);
      expect(first).toBeLessThanOrEqual(-55);
    }
  });

  it("at a set's peak breaks farther out, 70 to 160 m (a typical day's line runs 50 to 160 m), and caps the surf to the bore", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFromState(seed, TYPICAL);
      const z = coveFor(seed).z0;
      const cx = shoreX(field, z);
      // The set's peak: the largest unbroken crest 69 m out over two set periods.
      let peak = 0;
      let at = 0;
      for (let t = 0; t < 400; t += 0.25) {
        const s = swellAt(field, swellPhases(field, t), cx - 69, z);
        if (s.unbroken > peak) [peak, at] = [s.unbroken, t];
      }
      expect(peak).toBeGreaterThan(2.6);
      const phases = swellPhases(field, at);
      let first = Number.NaN;
      for (let d = -400; d <= -1; d++) {
        if (swellAt(field, phases, cx + d, z).ratio > 1) {
          first = d;
          break;
        }
      }
      expect(first).toBeGreaterThanOrEqual(-160);
      expect(first).toBeLessThanOrEqual(-70);
      // Shoreward, through the set: the drawn crest never stands taller than
      // γ_b·h (= unbroken/ratio), and where the cap is full it is the bore's.
      let over = 0;
      let bores = 0;
      let boreMiss = 0;
      for (let t = at; t < at + 30; t += 1.5) {
        const p = swellPhases(field, t);
        for (let d = -200; d <= -1; d += 1) {
          const s = swellAt(field, p, cx + d, z);
          if (!(s.ratio > 1)) continue;
          const crest = crestAt(field, p, cx + d, z);
          const cap = s.unbroken / s.ratio;
          if (!crest.broken || crest.height > cap + 1e-6 || s.height > cap + 1e-6) over++;
          if (s.ratio >= OCEAN_BREAK_FULL) {
            bores++;
            boreMiss = Math.max(boreMiss, Math.abs(crest.height / s.depth - OCEAN_BORE_RATIO));
          }
        }
      }
      expect(over).toBe(0);
      expect(boreMiss).toBeLessThan(0.15 * OCEAN_BORE_RATIO);
      expect(bores).toBeGreaterThan(50);
    }
  }, timeLimit(60_000));

  it("over dry sand falls to the shallowest bore's couple of centimetres and meets the waterline without a step", () => {
    const field = oceanFieldFromState(SEED, TYPICAL);
    const z = coveFor(SEED).z0;
    let dry = 0;
    let full = 0;
    let worst = 0;
    let worstFull = 0;
    for (let t = 0; t < 200; t += 0.25) {
      const phases = swellPhases(field, t);
      for (const along of [z - 60, z, z + 60]) {
        const cx = shoreX(field, along);
        for (let d = 0.5; d <= 39; d += 0.5) {
          const s = swellAt(field, phases, cx + d, along);
          if (!(s.depth < 0)) continue;
          dry++;
          worst = Math.max(worst, Math.abs(s.height));
          if (s.ratio >= OCEAN_BREAK_FULL) {
            full++;
            worstFull = Math.max(worstFull, Math.abs(s.height));
          }
        }
      }
    }
    expect(dry).toBeGreaterThan(50_000);
    // The shallowest bore, OCEAN_BORE_RATIO·OCEAN_DRY_DEPTH crest to trough, wherever
    // the cap is full: all but the moments the envelope nearly cancels, when the
    // cap is between γ_b and the bore's and the crest no taller than γ_b·OCEAN_DRY_DEPTH.
    expect(full / dry).toBeGreaterThan(0.99);
    expect(worstFull).toBeLessThanOrEqual((OCEAN_BORE_RATIO * OCEAN_DRY_DEPTH * 1.0001) / 2);
    expect(worst).toBeLessThanOrEqual((WEGGEL_GAMMA_MAX * OCEAN_DRY_DEPTH * 1.0001) / 2);
    // Across the waterline at a set's peak, a quarter metre at a time.
    const cx = shoreX(field, z);
    let peak = 0;
    let at = 0;
    for (let t = 0; t < 400; t += 0.25) {
      const s = swellAt(field, swellPhases(field, t), cx - 69, z);
      if (s.unbroken > peak) [peak, at] = [s.unbroken, t];
    }
    const phases = swellPhases(field, at);
    let step = 0;
    let prev = swellAt(field, phases, cx - 6, z).height;
    for (let d = -5.75; d <= 6; d += 0.25) {
      const next = swellAt(field, phases, cx + d, z).height;
      step = Math.max(step, Math.abs(next - prev));
      prev = next;
    }
    expect(step).toBeLessThan(0.05);
  }, timeLimit(60_000));

  it("holds the phase's change along z across the cove's ends under 0.75 of kn at every wet sample, from the tables", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFor(seed);
      const t = field.tables;
      const { z0, halfWidth } = coveFor(seed);
      let wet = 0;
      let worst = 0;
      for (const d of [-30, -120, -250, -400]) {
        const column = d - OCEAN_D_MIN;
        const bay = atlasRead(t, OCEAN_ROW_BAY_FIRST, column);
        const cove = atlasRead(t, OCEAN_ROW_COVE_FIRST, column);
        for (const end of [-1, 1]) {
          // From OCEAN_PHASE_BLEND short of the cove's end to OCEAN_PHASE_BLEND past it, a quarter metre at a time.
          const from = z0 + end * (halfWidth - OCEAN_PHASE_BLEND);
          const to = z0 + end * (halfWidth + OCEAN_PHASE_BLEND);
          const steps = Math.round(Math.abs(to - from) / 0.25);
          for (let i = 0; i <= steps; i++) {
            const z = from + (end * i) / 4;
            const [cx, , , wp, wpDz] = coastRead(t, z);
            if (!(elevationAt(seed, cx + d, z) < -OCEAN_DRY_DEPTH)) continue;
            wet++;
            const kn = (bay[1] as number) + ((cove[1] as number) - (bay[1] as number)) * wp;
            worst = Math.max(worst, Math.abs(((cove[0] as number) - (bay[0] as number)) * wpDz) / kn);
          }
        }
      }
      expect(wet).toBeGreaterThan(14_000);
      expect(worst).toBeLessThanOrEqual(0.75);
    }
  }, timeLimit(60_000));

  it("returns the slope of the phase it sums across the cove's ends: 250 m out, one component, a central difference of the height along z to 10 % and 0.002", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFromState(seed, TYPICAL, 1);
      const phases = swellPhases(field, 40);
      const { z0, halfWidth } = coveFor(seed);
      let wet = 0;
      let misses = 0;
      // On the centre line the phase weight is 1 and flat: its read there is the texel difference to the +z side,
      // about 2e-5 per metre over the row's 12 m step.
      const centre = coastRead(field.tables, z0);
      expect(centre[3]).toBe(1);
      expect(centre[4]).toBeGreaterThan(-0.00005);
      expect(centre[4]).toBeLessThanOrEqual(0);
      for (const end of [-1, 1]) {
        // Each end from the cove's centre line to OCEAN_PHASE_BLEND past the end.
        const from = z0;
        const to = z0 + end * (halfWidth + OCEAN_PHASE_BLEND);
        const steps = Math.round(Math.abs(to - from) / 0.25);
        for (let i = 0; i <= steps; i++) {
          const z = from + (end * i) / 4;
          const x = coastRead(field.tables, z)[0] - 250;
          if (!(elevationAt(seed, x, z) < -OCEAN_DRY_DEPTH)) continue;
          wet++;
          const along = (swellAt(field, phases, x, z + 0.05).height - swellAt(field, phases, x, z - 0.05).height) / 0.1;
          // The sample's slope is minus the height's gradient: the normal's terms are (−∂h/∂x, 1, −∂h/∂z).
          const slope = -swellAt(field, phases, x, z).slopeZ;
          if (Math.abs(along - slope) > 0.1 * Math.abs(along) + 0.002) misses++;
        }
      }
      expect(wet).toBeGreaterThan(1800);
      expect(misses).toBe(0);
    }
  }, timeLimit(60_000));

  it("keeps B, the foam and its age in range, the normal unit and upright, the sideways reach and Σ Q|K|A capped", () => {
    const field = oceanFieldFromState(SEED, { hs: 4, tp: 14, dirFromDeg: 290, gamma: 7, spread: 75 });
    const cx = shoreX(field, 0);
    const lo = { breaking: Infinity, foam: Infinity, foamAge: Infinity, normalY: Infinity };
    const hi = { breaking: -Infinity, foam: -Infinity, foamAge: -Infinity, steepness: -Infinity, unit: 0, reach: -Infinity };
    let broken = 0;
    for (let t = 0; t < 120; t += 7.3) {
      const phases = swellPhases(field, t);
      for (let d = -1200; d <= 30; d += 3.7) {
        for (const z of [-400, -150, -60, 0, 90, 170, 600]) {
          const s = swellAt(field, phases, cx + d, z);
          lo.breaking = Math.min(lo.breaking, s.breaking);
          hi.breaking = Math.max(hi.breaking, s.breaking);
          lo.foam = Math.min(lo.foam, s.foam);
          hi.foam = Math.max(hi.foam, s.foam);
          lo.foamAge = Math.min(lo.foamAge, s.foamAge);
          hi.foamAge = Math.max(hi.foamAge, s.foamAge);
          lo.normalY = Math.min(lo.normalY, s.normalY);
          hi.steepness = Math.max(hi.steepness, s.steepness);
          hi.unit = Math.max(hi.unit, Math.abs(Math.hypot(...swellNormal(s)) - 1));
          hi.reach = Math.max(hi.reach, Math.hypot(s.dx, s.dz) - s.reach);
          if (s.broken) broken++;
        }
      }
    }
    expect(lo.breaking).toBeGreaterThanOrEqual(0);
    expect(hi.breaking).toBeLessThanOrEqual(1);
    expect(hi.breaking).toBe(1);
    expect(lo.foam).toBeGreaterThanOrEqual(0);
    expect(hi.foam).toBeLessThanOrEqual(1);
    expect(lo.foamAge).toBeGreaterThanOrEqual(0);
    expect(hi.foamAge).toBeLessThan(14);
    expect(hi.unit).toBeLessThan(1e-12);
    expect(hi.steepness).toBeLessThanOrEqual(SWELL_Q_SUM_MAX + 1e-9);
    expect(lo.normalY).toBeGreaterThanOrEqual(1 - SWELL_Q_SUM_MAX - 1e-9);
    expect(hi.reach).toBeLessThanOrEqual(1e-9);
    expect(broken).toBeGreaterThan(100);
  }, timeLimit(60_000));
});

describe("shelterAt", () => {
  const lee = (field: OceanField, head: number, inward: number): [number, number] => {
    const z = (field.tips[head] as [number, number])[1] + inward;
    return [shoreX(field, z) - 10, z];
  };

  it("leaves SHELTER_SWELL deep in the lee of the up-swell headland of a swell 30° from the south-west", () => {
    expect([SHELTER_SWELL, SHELTER_CHOP, SHELTER_WIDTH]).toEqual([0.3, 0.15, 40]);
    const seed = longHeadland(0);
    const field = oceanFieldFromState(seed, { hs: 2, tp: 11, dirFromDeg: 300, gamma: 7, spread: 75 });
    expect(field.travel[1]).toBeGreaterThan(0.4);
    const [x, z] = lee(field, 0, 25);
    expect(Math.abs(shelterAt(field, x, z, SHELTER_SWELL) - 0.3)).toBeLessThan(0.05);
    expect(Math.abs(shelterAt(field, x, z, SHELTER_CHOP) - 0.15)).toBeLessThan(0.05);
    // The same place behind the other headland is its weather side: open.
    const [ox, oz] = lee(field, 1, -25);
    expect(shelterAt(field, ox, oz, SHELTER_SWELL)).toBe(1);
  });

  it("turns the other way under a swell 30° from the north-west", () => {
    const seed = longHeadland(1);
    const field = oceanFieldFromState(seed, { hs: 2, tp: 11, dirFromDeg: 240, gamma: 7, spread: 75 });
    expect(field.travel[1]).toBeLessThan(-0.4);
    const [x, z] = lee(field, 1, -25);
    expect(Math.abs(shelterAt(field, x, z, SHELTER_SWELL) - 0.3)).toBeLessThan(0.05);
    const [ox, oz] = lee(field, 0, 25);
    expect(shelterAt(field, ox, oz, SHELTER_SWELL)).toBe(1);
  });

  it("is 1 on the open coast, in front of the tips and where there are no tips, and fades without a step", () => {
    const seed = longHeadland(0);
    const field = oceanFieldFromState(seed, { hs: 2, tp: 11, dirFromDeg: 300, gamma: 7, spread: 75 });
    for (const z of [-1500, 1500]) expect(shelterAt(field, shoreX(field, z) - 50, z, SHELTER_SWELL)).toBe(1);
    const [ux, uz] = field.travel;
    for (const [tx, tz] of field.tips) {
      expect(shelterAt(field, tx - 30 * ux, tz - 30 * uz, SHELTER_SWELL)).toBe(1);
      expect(shelterAt(field, tx - 60, tz, SHELTER_SWELL)).toBe(1);
    }
    expect(shelterAt({ ...field, tips: [] }, ...lee(field, 0, 25), SHELTER_SWELL)).toBe(1);
    // Along the beach out of the lee: from 0.3 to 1 with no jump.
    let prev = shelterAt(field, ...lee(field, 0, 25), SHELTER_SWELL);
    for (let inward = 25.5; inward <= 200; inward += 0.5) {
      const next = shelterAt(field, ...lee(field, 0, inward), SHELTER_SWELL);
      expect(Math.abs(next - prev)).toBeLessThan(0.03);
      prev = next;
    }
    expect(prev).toBe(1);
  });
});

describe("crestAt", () => {
  it("hands the breaker the crest's period, the deep wavelength, the bed and the Iribarren number on them", () => {
    const field = oceanFieldFromState(SEED, TYPICAL);
    const z = coveFor(SEED).z0;
    const x = shoreX(field, z) - 100;
    const crest = crestAt(field, swellPhases(field, 40), x, z);
    expect(crest.period).toBe(11);
    expect(crest.offshoreLength).toBeCloseTo(188.9185, 4);
    expect(crest.slope).toBeCloseTo(0.02, 4);
    expect(crest.depth).toBeCloseTo(3.52, 4);
    expect(crest.iribarren).toBeCloseTo(crest.slope / Math.sqrt(crest.offshoreHeight / crest.offshoreLength), 12);
    expect(Math.hypot(...crest.direction)).toBeCloseTo(1, 12);
    expect(crest.direction[0]).toBeGreaterThan(0.9);
    expect(crest.phase).toBe(swellAt(field, swellPhases(field, 40), x, z).crestPhase);
    // Spilling on the 1:50 bed: ξ0 well under 0.5 for a crest of about Hs.
    expect(crest.offshoreHeight).toBeGreaterThan(0.5);
    expect(crest.iribarren).toBeLessThan(0.5);
  });
});

describe("boreArrivals", () => {
  it("finds the broken crests passing the cove's toe about one peak period apart", () => {
    const field = oceanFieldFromState(SEED, TYPICAL);
    const z = coveFor(SEED).z0;
    const arrivals = boreArrivals(field, shoreX(field, z) - 24, z, 0, 600, 0.1);
    expect(arrivals.length).toBeGreaterThan(10);
    const gaps = arrivals.slice(1).map((a, i) => a.t - (arrivals[i] as { t: number }).t);
    // Within a set the broken crests come one period apart; between sets the
    // smaller crests reach the toe unbroken and leave a longer gap.
    const inSet = gaps.filter((g) => g < 1.5 * 11);
    expect(inSet.length).toBeGreaterThan(8);
    for (const g of inSet) {
      expect(g).toBeGreaterThan(0.8 * 11);
      expect(g).toBeLessThan(1.2 * 11);
    }
    for (const a of arrivals) {
      expect(a.t).toBeGreaterThanOrEqual(0);
      expect(a.t).toBeLessThan(600);
      // A bore in 2 m of water: no taller than γ_b·h on the toe.
      expect(a.height).toBeGreaterThan(0);
      expect(a.height).toBeLessThan(1.56 * 2.1);
    }
  }, timeLimit(60_000));
});
