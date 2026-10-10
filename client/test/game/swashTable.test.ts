import { describe, it, expect } from "vitest";
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "../../src/sim/olympic.js";
import {
  boreArrivals, coastRead, oceanFieldFor, oceanFieldFromState, swellAt, swellPhases, type OceanField,
} from "../../src/game/oceanWaves.js";
import { seedFromToken } from "../../src/game/seed.js";
import {
  SWASH_DOWN_RATIO, SWASH_REACH_MAX_M, frontAt, reachCapAt, runUpAlongFace, thicknessAt, tUpOf,
} from "../../src/game/swashRunUp.js";
import {
  SWASH_AGE_MAX, SWASH_BACKWASH_MIN_M, SWASH_BORES_PER_COLUMN, SWASH_COLUMNS, SWASH_DRY_S, SWASH_REWET_M,
  SWASH_SPECKLE_S, SWASH_STEP_MAX_S, SWASH_STRIDE, SwashTable, type SwashCove,
} from "../../src/game/swashTable.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = seedFromToken("room-3");
const FIELD = oceanFieldFor(SEED);
const STEP = 1 / 60;

function coveOf(field: OceanField): SwashCove {
  const { z0, halfWidth } = coveFor(SEED);
  return {
    z0, halfWidth, toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE, faceGrade: COVE_FACE_GRADE,
    coastX: (z) => coastRead(field.tables, z)[0],
  };
}

type Arrival = { column: number; t: number; height: number; broken: boolean };

/** Steps a table at 60 Hz over [0, to) as the renderer would, calling `each` after every update. */
function run(table: SwashTable, field: OceanField, to: number, each?: (t: number) => void): Arrival[] {
  const phases = new Float32Array(12);
  const found: Arrival[] = [];
  for (let i = 0; i * STEP < to; i++) {
    const t = i * STEP;
    table.update(t, swellPhases(field, t, phases));
    for (let k = 0; k < table.arrivals.count; k++) {
      found.push({
        column: table.arrivals.column[k] as number, t: table.arrivals.t[k] as number,
        height: table.arrivals.height[k] as number, broken: table.arrivals.broken[k] === 1,
      });
    }
    each?.(t);
  }
  return found;
}

const column = (table: SwashTable, c: number): number[] => Array.from(table.data.subarray(c * 4, c * 4 + 4));

describe("SwashTable", () => {
  it("holds its constants", () => {
    expect([
      SWASH_COLUMNS, SWASH_STRIDE, SWASH_AGE_MAX, SWASH_DRY_S, SWASH_SPECKLE_S, SWASH_BORES_PER_COLUMN,
      SWASH_BACKWASH_MIN_M, SWASH_REWET_M, SWASH_STEP_MAX_S,
    ]).toEqual([512, 4, 600, 60, 10, 4, 2, 0.1, 1]);
  });

  it("maps a world z to the nearest column about the cove's centre, clamped to the row, never NaN", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    // room-3's cove is centred on z = 0.
    expect(coveFor(SEED).z0).toBe(0);
    expect(table.columnOf(0)).toBe(256);
    expect(table.columnOf(0.49)).toBe(256);
    expect(table.columnOf(0.5)).toBe(257);
    expect(table.columnOf(-0.5)).toBe(256);
    expect(table.columnOf(-256)).toBe(0);
    expect(table.columnOf(-300)).toBe(0);
    expect(table.columnOf(255)).toBe(511);
    expect(table.columnOf(300)).toBe(511);
    expect(table.columnOf(Number.NaN)).toBe(0);
  });

  it("starts dry: no front, no sheet, no reach and the never-wetted age in every column", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    expect(table.data).toHaveLength(2048);
    for (let c = 0; c < SWASH_COLUMNS; c++) expect(column(table, c)).toEqual([0, 0, 0, 600]);
  });

  it("takes the face's Iribarren number from the field's Hs and deep wavelength, and the crests' crossing from toe to waterline", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    expect(FIELD.hs).toBeCloseTo(1.361836, 6);
    expect(FIELD.tp).toBeCloseTo(10.260012, 6);
    expect(table.iribarren).toBeCloseTo(0.915480, 6);
    expect(table.transit[256]).toBeCloseTo(8.6854, 4);
    // The cove's columns are 62..450 (its half-width 164.1 m and the 30 m end blends); the rest hold no swell.
    expect(table.transit[62]).toBeGreaterThan(0);
    expect(table.transit[450]).toBeGreaterThan(0);
    expect(table.transit[61]).toBe(0);
    expect(table.transit[451]).toBe(0);
  });

  it("finds the crests boreArrivals finds at the toe, within one step and 1e-6 m, at every 16th column of the cove over 120 s", () => {
    const cove = coveOf(FIELD);
    const table = new SwashTable(FIELD, cove);
    const found = run(table, FIELD, 120);
    let all = 0;
    let broken = 0;
    for (let c = 64; c <= 448; c += 16) {
      const z = cove.z0 - 256 + c;
      const want = boreArrivals(FIELD, cove.coastX(z) + cove.toeD, z, 0, 120, STEP);
      const here = found.filter((a) => a.column === c);
      const got = here.filter((a) => a.broken);
      all += here.length;
      broken += got.length;
      expect(got.length).toBe(want.length);
      got.forEach((a, i) => {
        const w = want[i] as { t: number; height: number };
        expect(Math.abs(a.t - w.t)).toBeLessThanOrEqual(STEP);
        expect(Math.abs(a.height - w.height)).toBeLessThanOrEqual(1e-6);
      });
    }
    // Every crest that reaches the toe is found; boreArrivals' broken ones among them.
    expect(all).toBe(310);
    expect(broken).toBe(67);
  }, timeLimit(60_000));

  it("sets each sheet off as its crest reaches the waterline: transit after the toe, within 0.1 s, at the cove's centre", () => {
    const cove = coveOf(FIELD);
    const table = new SwashTable(FIELD, cove);
    const atToe = run(table, FIELD, 120).filter((a) => a.column === 256);
    expect(atToe).toHaveLength(13);
    // The crest phase wrapping through 0 at the waterline itself (d = 0).
    const shore: number[] = [];
    let prev = -1;
    for (let i = 0; i * STEP < 130; i++) {
      const s = swellAt(FIELD, swellPhases(FIELD, i * STEP), cove.coastX(0), 0);
      const q = s.crestPhase - 2 * Math.PI * Math.floor(s.crestPhase / (2 * Math.PI));
      if (prev >= 0 && q - prev > Math.PI) shore.push(i * STEP);
      prev = q;
    }
    for (const a of atToe) {
      const launch = a.t + (table.transit[256] as number);
      const nearest = shore.reduce((best, t) => (Math.abs(t - launch) < Math.abs(best - launch) ? t : best), Infinity);
      expect(Math.abs(nearest - launch)).toBeLessThan(0.1);
    }
  }, timeLimit(60_000));

  it("lays the live sheets' run-ups over each other: the front and the waterline thickness are the greatest of swashRunUp's", () => {
    const cove = coveOf(FIELD);
    const table = new SwashTable(FIELD, cove);
    const seen: { t: number; height: number }[] = [];
    let wet = 0;
    let worst = 0;
    run(table, FIELD, 120, (t) => {
      for (let k = 0; k < table.arrivals.count; k++) {
        if (table.arrivals.column[k] === 300) seen.push({ t: table.arrivals.t[k] as number, height: table.arrivals.height[k] as number });
      }
      let front = 0;
      let thick = 0;
      for (const a of seen) {
        const reach = Math.min(runUpAlongFace(a.height, table.iribarren, cove.faceGrade), reachCapAt(300));
        const age = t - (a.t + (table.transit[300] as number));
        const f = frontAt(age, reach, a.height);
        if (!(f > 0)) continue;
        const tUp = tUpOf(reach, a.height);
        const retreating = age > tUp ? (age - tUp) / (SWASH_DOWN_RATIO * tUp) : 0;
        front = Math.max(front, f);
        thick = Math.max(thick, thicknessAt(0, f, a.height, retreating));
      }
      const [gotFront, gotThick] = column(table, 300) as [number, number];
      worst = Math.max(worst, Math.abs(gotFront - front), Math.abs(gotThick - thick));
      if (front > 0) wet++;
    });
    expect(seen.length).toBeGreaterThan(8);
    expect(wet).toBeGreaterThan(3000);
    expect(worst).toBeLessThan(1e-5);
  }, timeLimit(60_000));

  it("raises the wet reach with the front, holds it as the sheet falls back, and keeps every value in range", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    let rewetted = 0;
    let prevAge = 600;
    run(table, FIELD, 120, () => {
      for (const c of [100, 256, 400]) {
        const [front, thick, reach, age] = column(table, c) as [number, number, number, number];
        expect(front).toBeGreaterThanOrEqual(0);
        expect(front).toBeLessThanOrEqual(SWASH_REACH_MAX_M);
        expect(thick).toBeGreaterThanOrEqual(0);
        expect(reach).toBeGreaterThanOrEqual(front - 1e-6);
        expect(reach).toBeLessThanOrEqual(SWASH_REACH_MAX_M);
        expect(age).toBeGreaterThanOrEqual(0);
        expect(age).toBeLessThanOrEqual(SWASH_AGE_MAX);
        if (c === 256) {
          if (age === 0) rewetted++;
          else if (prevAge < 600) expect(age).toBeCloseTo(prevAge + STEP, 4);
          prevAge = age;
        }
      }
    });
    expect(rewetted).toBeGreaterThan(100);
    expect(column(table, 256).map((v) => Math.round(v * 1e4) / 1e4)).toEqual([2.9324, 0.0415, 8.6303, 10.4]);
  }, timeLimit(60_000));

  it("ends the sheets in lobes: the wet reaches across the central columns are not all equal", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    run(table, FIELD, 120);
    const reaches: number[] = [];
    for (let c = 156; c <= 356; c++) reaches.push(column(table, c)[2] as number);
    for (let c = 156; c <= 356; c++) expect(reaches[c - 156]).toBeLessThanOrEqual(reachCapAt(c) + 1e-6);
    expect(new Set(reaches.map((r) => r.toFixed(3))).size).toBeGreaterThan(10);
  }, timeLimit(60_000));

  it("dries: with the swell held still the line holds for SWASH_DRY_S after its last wetting, then falls, and the age runs to SWASH_AGE_MAX", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    let wetAt = Number.NaN;
    run(table, FIELD, 40, (t) => {
      if (table.data[256 * 4 + 3] === 0) wetAt = t;
    });
    const held = swellPhases(FIELD, 40);
    // The sheets already set off run their course over the next 30 s, the last time a front stands within SWASH_REWET_M of the line among them.
    for (let i = 1; i <= 300; i++) {
      const t = 40 + i / 10;
      table.update(t, held);
      expect(table.arrivals.count).toBe(0);
      if (table.data[256 * 4 + 3] === 0) wetAt = t;
    }
    expect(wetAt).toBeCloseTo(47.7, 4);
    for (let i = 301; i <= 7600; i++) {
      const t = 40 + i / 10;
      table.update(t, held);
      expect(table.arrivals.count).toBe(0);
      const [front, , reach, age] = column(table, 256) as [number, number, number, number];
      expect(age).toBeCloseTo(Math.min(t - wetAt, SWASH_AGE_MAX), 3);
      if (t - wetAt < SWASH_DRY_S) expect(reach).toBeCloseTo(8.6303, 4);
      else expect(reach).toBe(front);
    }
    expect(column(table, 256)).toEqual([0, 0, 0, 600]);
  }, timeLimit(60_000));

  it("reports a backwash once a bore, where its front turns from a reach over 2 m", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    const events: [number, number][] = [];
    run(table, FIELD, 40, (t) => {
      for (let k = 0; k < table.backwash.count; k++) {
        if (table.backwash.column[k] === 256) events.push([t, table.backwash.reach[k] as number]);
      }
    });
    expect(events.map(([t, r]) => [Math.round(t * 1000) / 1000, Math.round(r * 1e4) / 1e4])).toEqual([
      [15.95, 7.4651], [25, 8.6303], [32.833, 8.6303],
    ]);
    for (const [, reach] of events) expect(reach).toBeGreaterThan(SWASH_BACKWASH_MIN_M);
  }, timeLimit(60_000));

  it("holds zeros and the never-wetted age past the cove's end blends", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    const found = run(table, FIELD, 60);
    expect(found.every((a) => a.column >= 62 && a.column <= 450)).toBe(true);
    for (const c of [0, 61, 451, 511]) expect(column(table, c)).toEqual([0, 0, 0, 600]);
  }, timeLimit(60_000));

  it("with no swell finds no crest and stays dry; under a calm long swell every value stays finite and in range", () => {
    const flat = oceanFieldFromState(SEED, { hs: 0, tp: 10, dirFromDeg: 270, gamma: 3.3, spread: 25 });
    const still = new SwashTable(flat, coveOf(flat));
    expect(run(still, flat, 60)).toHaveLength(0);
    for (let c = 0; c < SWASH_COLUMNS; c++) expect(column(still, c)).toEqual([0, 0, 0, 600]);

    const calm = oceanFieldFromState(SEED, { hs: 0.8, tp: 14, dirFromDeg: 270, gamma: 3.3, spread: 25 });
    const table = new SwashTable(calm, coveOf(calm));
    expect(table.iribarren).toBeCloseTo(1.629845, 6);
    let bad = 0;
    run(table, calm, 60, () => {
      for (let i = 0; i < table.data.length; i++) {
        const v = table.data[i] as number;
        if (!Number.isFinite(v) || v < 0 || v > (i % 4 === 3 ? SWASH_AGE_MAX : SWASH_REACH_MAX_M)) bad++;
      }
    });
    expect(bad).toBe(0);
  }, timeLimit(60_000));

  it("keeps the clock: a repeated time changes nothing, a long step finds no crest, a clock run back starts again", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    const phases = new Float32Array(12);
    run(table, FIELD, 30);
    const t = 1799 * STEP;
    const kept = Array.from(table.data);
    table.update(t, swellPhases(FIELD, t, phases));
    expect(Array.from(table.data)).toEqual(kept);
    expect(table.arrivals.count).toBe(0);
    expect(table.backwash.count).toBe(0);
    table.update(Number.NaN, phases);
    expect(Array.from(table.data)).toEqual(kept);
    // 30 s on in one step: crests passed, none is reported.
    table.update(t + 30, swellPhases(FIELD, t + 30, phases));
    expect(table.arrivals.count).toBe(0);
    expect(table.backwash.count).toBe(0);
    // Back to the start: dry again, nothing found on that update.
    table.update(1, swellPhases(FIELD, 1, phases));
    expect(table.arrivals.count).toBe(0);
    for (let c = 0; c < SWASH_COLUMNS; c++) expect(column(table, c).slice(2)).toEqual([0, 600]);
  }, timeLimit(60_000));

  it("holds through a reconciled tick's step back: a 2-tick step changes nothing and loses no crest, a 5 s jump back starts again", () => {
    const seed5 = seedFromToken("room-5");
    const field5 = oceanFieldFor(seed5);
    const { z0, halfWidth } = coveFor(seed5);
    const cove5: SwashCove = {
      z0, halfWidth, toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE, faceGrade: COVE_FACE_GRADE,
      coastX: (z) => coastRead(field5.tables, z)[0],
    };
    const held = new SwashTable(field5, cove5);
    const kept = new SwashTable(field5, cove5);
    const phases = new Float32Array(12);
    run(held, field5, 90);
    run(kept, field5, 90);
    const last = 5399 * STEP;
    const wet = (table: SwashTable): number => {
      let n = 0;
      for (let c = 0; c < SWASH_COLUMNS; c++) if ((table.data[c * SWASH_STRIDE + 2] as number) > 0) n++;
      return n;
    };
    expect(wet(held)).toBeGreaterThan(100);
    const before = Array.from(held.data);
    // Two ticks back, then one back: each a hold, nothing reported.
    for (const t of [last - 2 * STEP, last - STEP, last]) {
      held.update(t, swellPhases(field5, t, phases));
      expect(Array.from(held.data)).toEqual(before);
      expect(held.arrivals.count).toBe(0);
      expect(held.backwash.count).toBe(0);
    }
    // On past the latest counted: the same crests and the same row as a table never stepped back.
    let found = 0;
    for (let i = 1; i <= 600; i++) {
      const t = last + i * STEP;
      held.update(t, swellPhases(field5, t, phases));
      kept.update(t, swellPhases(field5, t, phases));
      expect(held.arrivals.count).toBe(kept.arrivals.count);
      expect(Array.from(held.arrivals.t.subarray(0, held.arrivals.count))).toEqual(
        Array.from(kept.arrivals.t.subarray(0, kept.arrivals.count)),
      );
      expect(held.backwash.count).toBe(kept.backwash.count);
      found += held.arrivals.count;
    }
    expect(found).toBeGreaterThan(0);
    expect(Array.from(held.data)).toEqual(Array.from(kept.data));
    // A jump back past SWASH_STEP_MAX_S: dry again.
    const back = last + 600 * STEP - 5;
    held.update(back, swellPhases(field5, back, phases));
    expect(held.arrivals.count).toBe(0);
    expect(wet(held)).toBe(0);
    for (let c = 0; c < SWASH_COLUMNS; c++) expect(column(held, c)).toEqual([0, 0, 0, 600]);
  }, timeLimit(60_000));

  it("reports no backwash across a stalled page's long step, and never more events than columns", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    const phases = new Float32Array(12);
    run(table, FIELD, 65);
    table.update(80, swellPhases(FIELD, 80, phases));
    expect(table.arrivals.count).toBe(0);
    expect(table.backwash.count).toBe(0);
    // Stepping on from there at 60 Hz the watch is back: no update reports more than the arrays hold.
    let most = 0;
    for (let i = 1; i <= 1200; i++) {
      const t = 80 + i * STEP;
      table.update(t, swellPhases(FIELD, t, phases));
      most = Math.max(most, table.backwash.count);
    }
    expect(most).toBeLessThanOrEqual(SWASH_COLUMNS);
  }, timeLimit(60_000));

  it("allocates nothing a frame: the same row and the same event arrays after 1,200 updates", () => {
    const table = new SwashTable(FIELD, coveOf(FIELD));
    const { data, arrivals, backwash } = table;
    const arrays = [arrivals.column, arrivals.t, arrivals.height, arrivals.broken, backwash.column, backwash.reach];
    run(table, FIELD, 20);
    expect(table.data).toBe(data);
    expect(table.arrivals).toBe(arrivals);
    expect(table.backwash).toBe(backwash);
    const after = [
      table.arrivals.column, table.arrivals.t, table.arrivals.height, table.arrivals.broken,
      table.backwash.column, table.backwash.reach,
    ];
    after.forEach((a, i) => expect(a).toBe(arrays[i]));
  }, timeLimit(60_000));

  it("costs under 0.2 ms an update on average over 600 updates of the widest cove", { tags: ["wall-clock"], timeout: timeLimit(20_000) }, () => {
    const cove = { ...coveOf(FIELD), halfWidth: 180 };
    const table = new SwashTable(FIELD, cove);
    const phases = new Float32Array(12);
    // Warm the update first.
    for (let i = 0; i < 600; i++) table.update(i * STEP, swellPhases(FIELD, i * STEP, phases));
    let spent = 0;
    for (let i = 600; i < 1200; i++) {
      const t = i * STEP;
      swellPhases(FIELD, t, phases);
      const t0 = performance.now();
      table.update(t, phases);
      spent += performance.now() - t0;
    }
    expect(spent / 600).toBeLessThan(0.2);
  });
});
