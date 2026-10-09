import { describe, expect, it } from "vitest";
import {
  SILENT_SURF_SOUND, SURF_ENVELOPE_S, SURF_EVENTS, SURF_RANGE_M, createSurfSound, fillSurfSound, type SurfSound,
} from "../../src/game/surfSound.js";
import { LIP_COLUMNS, LIP_SLOTS } from "../../src/game/oceanBreaker.js";
import { SwashTable, type SwashCove } from "../../src/game/swashTable.js";
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "../../src/sim/olympic.js";
import { coastRead, oceanFieldFor, swellPhases } from "../../src/game/oceanWaves.js";
import { seedFromToken } from "../../src/game/seed.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A cove 300 m wide about z = 100, its waterline on x = 500 + 0.1·z, the toe 24 m seaward on a 1:12 face. */
const COVE: SwashCove = { z0: 100, halfWidth: 150, toeD: -24, faceGrade: 1 / 12, coastX: (z) => 500 + 0.1 * z };
const LEVEL = 0.25;

/** The table as the record reads it: 512 columns of four, column 0 at z0 − 256, and its backwash. */
function fakeTable() {
  return {
    data: new Float32Array(512 * 4),
    columnOf: (z: number) => Math.min(511, Math.max(0, Math.round(z - COVE.z0 + 256))),
    backwash: { count: 0, column: new Int32Array(512), reach: new Float32Array(512) },
  };
}

/** The tracker as the record reads it: two slots of 512 columns of (crestD, progress, height, share), slot-major, and its plunges. */
function fakeTracker() {
  return {
    state: { data: new Float32Array(LIP_SLOTS * LIP_COLUMNS * 4) },
    plunges: { count: 0, d: new Float32Array(32), z: new Float32Array(32), height: new Float32Array(32) },
  };
}

const progress = (t: ReturnType<typeof fakeTracker>, column: number, slot: number, p: number) => {
  t.state.data[(slot * LIP_COLUMNS + column) * 4 + 1] = p;
};
const front = (t: ReturnType<typeof fakeTable>, column: number, m: number) => {
  t.data[column * 4] = m;
};
const thick = (t: ReturnType<typeof fakeTable>, column: number, m: number) => {
  t.data[column * 4 + 1] = m;
};

/** 180 m from the toe line's end at z = 250, 60 m inland. */
const NEAR = { x: 600, y: 3, z: 400 };
/** 559 m from it. */
const FAR = { x: 600, y: 3, z: 800 };

describe("surfSound", () => {
  it("holds the envelope's span and the range", () => {
    expect([SURF_ENVELOPE_S, SURF_RANGE_M, SURF_EVENTS]).toEqual([4, 400, 32]);
  });

  it("the silent default is frozen through, absent and lists nothing", () => {
    const s = SILENT_SURF_SOUND;
    expect([s.present, s.envelope, s.inland, s.canopy, s.hs, s.plunges.count, s.backwash.count])
      .toEqual([false, 0, 0, 0, 0, 0, 0]);
    expect([Object.isFrozen(s), Object.isFrozen(s.plunges), Object.isFrozen(s.backwash), Object.isFrozen(s.plunges.x)])
      .toEqual([true, true, true, true]);
    expect(() => {
      (s as { envelope: number }).envelope = 1;
    }).toThrow(TypeError);
  });

  it("a new record is silent, with room for 32 of each event, its own arrays", () => {
    const a = createSurfSound();
    const b = createSurfSound();
    expect([a.present, a.envelope, a.plunges.count, a.backwash.count]).toEqual([false, 0, 0, 0]);
    expect([a.plunges.x.length, a.plunges.height.length, a.backwash.z.length, a.backwash.reach.length]).toEqual([32, 32, 32, 32]);
    expect(a.plunges.x).not.toBe(b.plunges.x);
  });

  it("the nearest point is on the toe line at the listener's z held to the cove; inland is the coast distance", () => {
    const s = createSurfSound();
    fillSurfSound(s, NEAR, fakeTracker(), fakeTable(), COVE, LEVEL, 2, 0, 1 / 60);
    expect([s.nearX, s.nearY, s.nearZ, s.inland, s.present]).toEqual([501, 0.25, 250, 60, true]);
    // Inside the cove's width the point is abreast of the listener; over the sea, inland is negative.
    fillSurfSound(s, { x: 300, y: 3, z: 100 }, fakeTracker(), fakeTable(), COVE, LEVEL, 2, 0, 1 / 60);
    expect([s.nearX, s.nearY, s.nearZ, s.inland, s.present]).toEqual([486, 0.25, 100, -210, true]);
    // Below the cove's far end the point holds to it.
    fillSurfSound(s, { x: 520, y: 3, z: -300 }, fakeTracker(), fakeTable(), COVE, LEVEL, 2, 0, 1 / 60);
    expect([s.nearX, s.nearZ, s.inland]).toEqual([471, -50, 50]);
  });

  it("is absent beyond 400 m of the toe line, listing no events, and for a listener that is not a number", () => {
    const s = createSurfSound();
    const tracker = fakeTracker();
    tracker.plunges.count = 1;
    tracker.plunges.z[0] = 120;
    const table = fakeTable();
    table.backwash.count = 1;
    table.backwash.column[0] = 256;
    table.backwash.reach[0] = 4;
    fillSurfSound(s, FAR, tracker, table, COVE, LEVEL, 2, 0, 1 / 60);
    expect([s.present, s.plunges.count, s.backwash.count]).toEqual([false, 0, 0]);
    fillSurfSound(s, NEAR, tracker, table, COVE, LEVEL, 2, 0, 1 / 60);
    expect([s.present, s.plunges.count, s.backwash.count]).toEqual([true, 1, 1]);
    fillSurfSound(s, { x: Number.NaN, y: 3, z: 400 }, tracker, table, COVE, LEVEL, 2, 0, 1 / 60);
    expect([s.present, s.plunges.count, s.backwash.count]).toEqual([false, 0, 0]);
  });

  it("a listener or a level that is not a number leaves the record as it was: absent, no events, the envelope still running", () => {
    const s = createSurfSound();
    const tracker = fakeTracker();
    tracker.plunges.count = 1;
    tracker.plunges.z[0] = 120;
    const table = fakeTable();
    for (let c = 106; c <= 406; c++) thick(table, c, 0.3);
    fillSurfSound(s, NEAR, tracker, table, COVE, LEVEL, 2, 0.5, 1);
    const held = [s.nearX, s.nearY, s.nearZ, s.inland, s.canopy, s.hs];
    expect([held, s.present, s.plunges.count]).toEqual([[501, 0.25, 250, 60, 0.5, 2], true, 1]);
    const envelope = s.envelope;
    for (const [listener, level] of [
      [{ x: 600, y: 3, z: Number.NaN }, LEVEL],
      [{ x: Number.NaN, y: 3, z: 400 }, LEVEL],
      [{ x: 600, y: Infinity, z: 400 }, LEVEL],
      [NEAR, Number.NaN],
    ] as const) {
      fillSurfSound(s, listener, tracker, table, COVE, level, 7, 1, 1);
      expect([s.nearX, s.nearY, s.nearZ, s.inland, s.canopy, s.hs]).toEqual(held);
      expect([s.present, s.plunges.count, s.backwash.count]).toEqual([false, 0, 0]);
    }
    expect(s.envelope).toBeGreaterThan(envelope);
  });

  it("is present exactly 400 m from the nearest point, and absent a hair beyond", () => {
    const s = createSurfSound();
    // The nearest point is (486, 0.25, 100): abreast of the listener on the toe line.
    fillSurfSound(s, { x: 886, y: 0.25, z: 100 }, fakeTracker(), fakeTable(), COVE, LEVEL, 2, 0, 1 / 60);
    expect([s.nearX, s.present]).toEqual([486, true]);
    fillSurfSound(s, { x: 886.001, y: 0.25, z: 100 }, fakeTracker(), fakeTable(), COVE, LEVEL, 2, 0, 1 / 60);
    expect(s.present).toBe(false);
  });

  it("the envelope: the cove's mean sheet thickness over 0.3 · Hs, held to 1, its running mean over 4 s", () => {
    const tracker = fakeTracker();
    const table = fakeTable();
    // The cove's columns are 106 to 406: 301 of them. Under Hs 2 a full sheet is 0.6 m.
    for (let c = 106; c <= 205; c++) thick(table, c, 0.6); // 100 full
    for (let c = 206; c <= 255; c++) thick(table, c, 0.3); // 50 half
    for (let c = 256; c <= 355; c++) front(table, c, 3); // fronts with no sheet count for nothing
    for (let c = 196; c <= 245; c++) progress(tracker, c, 0, 0.5); // nor do crests on the face
    thick(table, 50, 0.6); // outside the cove
    thick(table, 450, 0.6);
    const s = createSurfSound();
    // One fill of 4 s: (60 + 15) / 301 / 0.6 of the way times 1 − 1/e.
    fillSurfSound(s, FAR, tracker, table, COVE, LEVEL, 2, 0, 4);
    expect(s.envelope).toBeCloseTo(0.262509, 6);
    // A step of no time, or not a number, leaves it.
    fillSurfSound(s, FAR, tracker, table, COVE, LEVEL, 2, 0, 0);
    fillSurfSound(s, FAR, tracker, table, COVE, LEVEL, 2, 0, Number.NaN);
    expect(s.envelope).toBeCloseTo(0.262509, 6);
    // Sheets thicker than 0.3 · Hs hold the share to 1; a height that is not a number or not above 0 gives none.
    const full = createSurfSound();
    for (let c = 106; c <= 406; c++) thick(table, c, 2);
    fillSurfSound(full, FAR, tracker, table, COVE, LEVEL, 2, 0, 4);
    expect(full.envelope).toBeCloseTo(0.632121, 6);
    for (const hs of [0, -1, Number.NaN, Infinity]) {
      const none = createSurfSound();
      fillSurfSound(none, FAR, tracker, table, COVE, LEVEL, hs, 0, 4);
      expect(none.envelope).toBe(0);
    }
  });

  it("the envelope rises 63 % of the way over 4 s of a whole cove's full sheet, and falls by 1/e over 4 s of none", () => {
    const tracker = fakeTracker();
    const table = fakeTable();
    for (let c = 0; c < 512; c++) thick(table, c, 1);
    const s = createSurfSound();
    for (let f = 0; f < 240; f++) fillSurfSound(s, NEAR, tracker, table, COVE, LEVEL, 2, 0, 1 / 60);
    expect(s.envelope).toBeCloseTo(0.632121, 6);
    table.data.fill(0);
    for (let f = 0; f < 240; f++) fillSurfSound(s, NEAR, tracker, table, COVE, LEVEL, 2, 0, 1 / 60);
    expect(s.envelope).toBeCloseTo(0.232544, 6);
  });

  it("the envelope moves with the sets: room-3's swash over 10 minutes swings it by more than 0.3", () => {
    const seed = seedFromToken("room-3");
    const field = oceanFieldFor(seed);
    const { z0, halfWidth } = coveFor(seed);
    const cove: SwashCove = {
      z0, halfWidth, toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE, faceGrade: COVE_FACE_GRADE,
      coastX: (z) => coastRead(field.tables, z)[0],
    };
    const table = new SwashTable(field, cove);
    const tracker = fakeTracker();
    const phases = new Float32Array(12);
    const s = createSurfSound();
    const step = 1 / 20;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i * step < 600; i++) {
      const t = i * step;
      table.update(t, swellPhases(field, t, phases));
      fillSurfSound(s, { x: cove.coastX(z0) + 40, y: 5, z: z0 }, tracker, table, cove, 0, field.hs, 0, step);
      if (t < 60) continue;
      low = Math.min(low, s.envelope);
      high = Math.max(high, s.envelope);
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(high - low).toBeGreaterThan(0.3);
  }, timeLimit(60_000));

  it("canopy and the swell's height pass through, held to their ranges, and a value that is not a number is 0", () => {
    const s = createSurfSound();
    const at = (hs: number, canopy: number) => {
      fillSurfSound(s, NEAR, fakeTracker(), fakeTable(), COVE, LEVEL, hs, canopy, 1 / 60);
      return [s.hs, s.canopy];
    };
    expect(at(2.5, 0.3)).toEqual([2.5, 0.3]);
    expect(at(-1, 1.4)).toEqual([0, 1]);
    expect(at(Number.NaN, Number.NaN)).toEqual([0, 0]);
    expect(at(Infinity, -0.5)).toEqual([0, 0]);
  });

  it("the plunges are the tracker's, at x = coastX(z) + d on the level", () => {
    const tracker = fakeTracker();
    tracker.plunges.count = 2;
    tracker.plunges.d.set([-10, -20]);
    tracker.plunges.z.set([120, 200]);
    tracker.plunges.height.set([1.5, 2]);
    const s = createSurfSound();
    fillSurfSound(s, NEAR, tracker, fakeTable(), COVE, LEVEL, 2, 0, 1 / 60);
    expect(s.plunges.count).toBe(2);
    expect(Array.from(s.plunges.x.subarray(0, 2))).toEqual([502, 500]);
    expect(Array.from(s.plunges.y.subarray(0, 2))).toEqual([0.25, 0.25]);
    expect(Array.from(s.plunges.z.subarray(0, 2))).toEqual([120, 200]);
    expect(Array.from(s.plunges.height.subarray(0, 2))).toEqual([1.5, 2]);
  });

  it("the backwash is the table's, at the reach up the face from the still waterline, nearest the listener first", () => {
    const table = fakeTable();
    table.backwash.count = 3;
    table.backwash.column.set([256, 300, 106]);
    table.backwash.reach.set([4, 9, 2.5]);
    const s = createSurfSound();
    fillSurfSound(s, NEAR, fakeTracker(), table, COVE, LEVEL, 2, 0, 1 / 60);
    expect(s.backwash.count).toBe(3);
    // Column 300 is z = 144, its waterline at x = 514.4: 9 m up the face, 0.75 m above the level.
    // Column 256 is z = 100, 4 m up from x = 510; column 106 is z = −50, 2.5 m up from x = 495.
    expect(s.backwash.x[0]).toBeCloseTo(523.4, 4);
    expect(Array.from(s.backwash.x.subarray(1, 3))).toEqual([514, 497.5]);
    expect(s.backwash.y[0]).toBe(1);
    expect(s.backwash.y[1]).toBeCloseTo(0.583333, 6);
    expect(s.backwash.y[2]).toBeCloseTo(0.458333, 6);
    expect(Array.from(s.backwash.z.subarray(0, 3))).toEqual([144, 100, -50]);
    expect(Array.from(s.backwash.reach.subarray(0, 3))).toEqual([9, 4, 2.5]);
  });

  it("keeps the 32 nearest of more backwash than it has room for", () => {
    const table = fakeTable();
    table.backwash.count = 40;
    for (let i = 0; i < 40; i++) {
      table.backwash.column[i] = 107 + i; // z = −49 to −10: the larger z, the nearer the listener
      table.backwash.reach[i] = 3;
    }
    const s = createSurfSound();
    fillSurfSound(s, NEAR, fakeTracker(), table, COVE, LEVEL, 2, 0, 1 / 60);
    expect(s.backwash.count).toBe(32);
    expect([s.backwash.z[0], s.backwash.z[31]]).toEqual([-10, -41]);
  });

  it("allocates nothing as it fills: the same record and arrays after 1,000 fills, every number finite", () => {
    const s = createSurfSound();
    const held = (r: SurfSound): object[] => [
      r.plunges, r.plunges.x, r.plunges.y, r.plunges.z, r.plunges.height,
      r.backwash, r.backwash.x, r.backwash.y, r.backwash.z, r.backwash.reach,
    ];
    const before = held(s);
    const tracker = fakeTracker();
    const table = fakeTable();
    for (let f = 0; f < 1000; f++) {
      front(table, 106 + (f % 301), f % 2);
      progress(tracker, 106 + ((f * 7) % 301), f % 2, (f % 5) / 4);
      tracker.plunges.count = f % 33;
      table.backwash.count = (f * 3) % 60;
      fillSurfSound(s, { x: 450 + (f % 200), y: 2, z: -100 + f }, tracker, table, COVE, LEVEL, 2, (f % 3) / 2, 1 / 60);
    }
    held(s).forEach((a, i) => expect(a).toBe(before[i]));
    const numbers: number[] = [s.nearX, s.nearY, s.nearZ, s.envelope, s.inland, s.canopy, s.hs];
    expect(numbers.every(Number.isFinite)).toBe(true);
  });
});
