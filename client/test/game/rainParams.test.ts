import { describe, it, expect } from "vitest";
import {
  RAIN_BOX, RAIN_CLASSES, RAIN_DT, RAIN_FOLD_S, RAIN_LENGTH, RAIN_TIERS,
  rainBoxMin, rainClassOf, rainCountUnder, rainDrift, rainDropAt, rainFold, rainSeeds, smoothedDt, streakLength,
} from "../../src/game/rainParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";

/** A wind of `speed` blowing along +X or +Z. */
function wind(speed: number, axis: "x" | "z") {
  return { ...windRecordUnder(WEATHER_PRESETS.clear, 0, speed), dirX: axis === "x" ? 1 : 0, dirZ: axis === "z" ? 1 : 0 };
}

describe("the rain's numbers", () => {
  it("draws 3,000, 10,000 and 24,000 streaks by tier in a 24 by 20 by 24 m box", () => {
    expect(RAIN_TIERS).toEqual({ low: 3000, medium: 10000, high: 24000 });
    expect(RAIN_BOX).toEqual({ x: 24, y: 20, z: 24, forward: 6, down: 2 });
    expect(RAIN_FOLD_S).toBe(40);
  });

  it("folds every class exactly: speed times the fold is a whole number of box heights", () => {
    expect(RAIN_CLASSES.map((c) => c.speed)).toEqual([4.5, 6, 7.5, 9]);
    expect(RAIN_CLASSES.map((c) => (c.speed * 40) / 20)).toEqual([9, 12, 15, 18]);
    for (const c of RAIN_CLASSES) expect(Number.isInteger((c.speed * RAIN_FOLD_S) / RAIN_BOX.y)).toBe(true);
  });

  it("widens and brightens the classes with their speed", () => {
    expect(RAIN_CLASSES.map((c) => c.width)).toEqual([0.012, 0.018, 0.024, 0.03]);
    expect(RAIN_CLASSES.map((c) => c.alpha)).toEqual([0.35, 0.43, 0.52, 0.6]);
    expect(rainClassOf(0).speed).toBe(4.5);
    expect(rainClassOf(1 / 3).speed).toBe(6);
    expect(rainClassOf(2 / 3).speed).toBe(7.5);
    expect(rainClassOf(1).speed).toBe(9);
  });
});

describe("rainSeeds", () => {
  it("fills xyz in [0, 1) and cycles the class through the four lanes", () => {
    const seeds = rainSeeds(1000, 7);
    expect(seeds.length).toBe(4000);
    for (let i = 0; i < 1000; i++) {
      for (const j of [0, 1, 2]) {
        const v = seeds[i * 4 + j] as number;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      expect(seeds[i * 4 + 3]).toBeCloseTo((i % 4) / 3, 6);
    }
  });

  it("is deterministic in the seed, and spread rather than clustered", () => {
    expect(rainSeeds(64, 7)).toEqual(rainSeeds(64, 7));
    expect(rainSeeds(64, 7)).not.toEqual(rainSeeds(64, 8));
    const seeds = rainSeeds(4000, 7);
    // Every tenth of each axis holds some of the drops.
    for (const j of [0, 1, 2]) {
      const bins = new Array<number>(10).fill(0);
      for (let i = 0; i < 4000; i++) bins[Math.floor((seeds[i * 4 + j] as number) * 10)]!++;
      for (const n of bins) expect(n).toBeGreaterThan(300);
    }
  });
});

describe("the folds", () => {
  it("rainFold wraps the running time modulo 40 s", () => {
    expect(rainFold(0)).toBe(0);
    expect(rainFold(41)).toBe(1);
    expect(rainFold(80)).toBe(0);
    expect(rainFold(39.5)).toBe(39.5);
  });

  it("rainDrift accumulates the wind's displacement in units of the box and folds each component to [0, 1)", () => {
    // 3 m/s per unit of wind, 2 s, along X: 6 m of a 24 m box is a quarter.
    expect(rainDrift({ x: 0, z: 0 }, wind(1, "x"), 2)).toEqual({ x: 0.25, z: 0 });
    const wrapped = rainDrift({ x: 0.9, z: 0.5 }, wind(1, "x"), 2);
    expect(wrapped.x).toBeCloseTo(0.15, 9);
    expect(wrapped.z).toBe(0.5);
    const back = rainDrift({ x: 0.1, z: 0 }, { ...wind(1, "x"), dirX: -1 }, 2);
    expect(back.x).toBeCloseTo(0.85, 9);
    expect(rainDrift({ x: 0.2, z: 0.2 }, wind(0.5, "z"), 1).z).toBeCloseTo(0.2625, 9);
    expect(rainDrift({ x: 0.2, z: 0.2 }, wind(0, "z"), 1)).toEqual({ x: 0.2, z: 0.2 });
  });

  it("rainDrift and rainBoxMin write into `out`, and rainDrift may step in place", () => {
    const drift = { x: 0.9, z: 0.5 };
    expect(rainDrift(drift, wind(1, "x"), 2, drift)).toBe(drift);
    expect(drift.x).toBeCloseTo(0.15, 9);
    expect(drift.z).toBe(0.5);
    const out = { x: 0, y: 0, z: 0 };
    expect(rainBoxMin({ x: 10, y: 5, z: -20 }, 0, out)).toBe(out);
    expect(out).toEqual({ x: -2, y: -7, z: -26 });
  });
});

describe("the streak's length", () => {
  it("is the speed times the frame times 1.5, clamped to 8 to 50 cm", () => {
    expect(RAIN_LENGTH).toEqual([0.08, 0.5]);
    expect(streakLength(9, 1 / 60)).toBeCloseTo(0.225, 9);
    expect(streakLength(4.5, 1 / 120)).toBe(0.08);
    expect(streakLength(9, 1 / 30)).toBeCloseTo(0.45, 9);
    expect(streakLength(9, 0.1)).toBe(0.5);
  });

  it("smoothedDt eases a tenth of the way to the clamped frame each frame", () => {
    expect(RAIN_DT).toEqual([1 / 120, 1 / 30]);
    expect(smoothedDt(1 / 60, 1 / 60)).toBeCloseTo(1 / 60, 12);
    // A one-second stall counts as a thirtieth, and a tenth of the gap is taken.
    expect(smoothedDt(1 / 60, 1)).toBeCloseTo(11 / 600, 12);
    expect(smoothedDt(1 / 30, 0)).toBeCloseTo(1 / 30 - 1 / 400, 12);
    let dt = 1 / 60;
    for (let i = 0; i < 200; i++) dt = smoothedDt(dt, 1 / 30);
    expect(dt).toBeCloseTo(1 / 30, 9);
    expect(smoothedDt(1 / 120, 1 / 120)).toBe(1 / 120);
  });
});

describe("rainBoxMin", () => {
  it("puts the box 6 m ahead along the view and 2 m down, centred", () => {
    // Yaw 0 faces +Z.
    expect(rainBoxMin({ x: 10, y: 5, z: -20 }, 0)).toEqual({ x: -2, y: -7, z: -26 });
    // Yaw π/2 faces +X.
    const side = rainBoxMin({ x: 10, y: 5, z: -20 }, Math.PI / 2);
    expect(side.x).toBeCloseTo(4, 9);
    expect(side.y).toBe(-7);
    expect(side.z).toBeCloseTo(-32, 9);
  });
});

describe("rainDropAt — the vertex stage's placement, mirrored", () => {
  const seed = { x: 0.3, y: 0.6, z: 0.4 };
  const still = { x: 0, z: 0 };

  it("places a drop inside the box from its seed", () => {
    const boxMin = rainBoxMin({ x: 0, y: 0, z: 0 }, 0);
    expect(boxMin).toEqual({ x: -12, y: -12, z: -6 });
    const p = rainDropAt(seed, 0, still, 0, boxMin);
    expect(p.x).toBeCloseTo(7.2, 9);
    expect(p.y).toBeCloseTo(-8, 9);
    expect(p.z).toBeCloseTo(9.6, 9);
  });

  it("stands still in the world when the camera moves: the box slides over the field", () => {
    const before = rainDropAt(seed, 0, still, 0, rainBoxMin({ x: 0, y: 0, z: 0 }, 0));
    // The drop is in both boxes, so it is the same drop, at the same place.
    const after = rainDropAt(seed, 0, still, 0, rainBoxMin({ x: 2, y: 1, z: 1 }, 0));
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
    // A turn is a move of the box too.
    const turned = rainDropAt(seed, 0, still, 0, rainBoxMin({ x: 0, y: 0, z: 0 }, Math.PI / 2));
    expect(turned.x).toBeCloseTo(before.x, 9);
    expect(turned.y).toBeCloseTo(before.y, 9);
    expect(turned.z).toBeCloseTo(before.z, 9);
  });

  it("wraps a drop the box leaves behind by exactly one box, so a sprinting player never outruns it", () => {
    const before = rainDropAt(seed, 0, still, 0, rainBoxMin({ x: 0, y: 0, z: 0 }, 0));
    const after = rainDropAt(seed, 0, still, 0, rainBoxMin({ x: 0, y: 0, z: -20 }, 0));
    expect(after.z - before.z).toBeCloseTo(-24, 9);
    expect(after.x).toBeCloseTo(before.x, 9);
  });

  it("falls at the class speed and folds every class exactly at 40 s", () => {
    const boxMin = rainBoxMin({ x: 0, y: 0, z: 0 }, 0);
    for (const k of [0, 1 / 3, 2 / 3, 1]) {
      const at0 = rainDropAt(seed, k, still, 0, boxMin);
      const at1 = rainDropAt(seed, k, still, 1, boxMin);
      const fell = at0.y - at1.y;
      // Either the fall itself or the fall less one box height, once wrapped.
      expect(Math.min(Math.abs(fell - rainClassOf(k).speed), Math.abs(fell + 20 - rainClassOf(k).speed))).toBeLessThan(1e-9);
      const at40 = rainDropAt(seed, k, still, 40, boxMin);
      expect(at40.y).toBeCloseTo(at0.y, 9);
    }
  });

  it("drifts with the folded wind: a whole box of drift is no drift", () => {
    const boxMin = rainBoxMin({ x: 0, y: 0, z: 0 }, 0);
    const p0 = rainDropAt(seed, 0, { x: 0, z: 0 }, 0, boxMin);
    const p1 = rainDropAt(seed, 0, { x: 0.1, z: 0 }, 0, boxMin);
    expect(p1.x - p0.x).toBeCloseTo(2.4, 9);
    expect(rainDropAt(seed, 0, { x: 1, z: 0 }, 0, boxMin).x).toBeCloseTo(p0.x, 9);
  });
});

describe("rainCountUnder", () => {
  it("is the rain value's share of the tier's streaks, rounded and clamped", () => {
    expect(rainCountUnder(1, "high")).toBe(24000);
    expect(rainCountUnder(0.5, "low")).toBe(1500);
    expect(rainCountUnder(0, "medium")).toBe(0);
    expect(rainCountUnder(2, "medium")).toBe(10000);
    expect(rainCountUnder(0.00001, "low")).toBe(0);
  });
});
