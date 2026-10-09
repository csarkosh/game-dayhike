import { describe, it, expect } from "vitest";
import {
  SWASH_DOWN_RATIO, SWASH_G, SWASH_REACH_MAX_M, SWASH_SINK, SWASH_THICK_K,
  frontAt, overlap, runUpAlongFace, runUpVertical, thicknessAt, tUpOf,
} from "../../src/game/swashRunUp.js";

describe("swashRunUp", () => {
  it("holds its constants", () => {
    expect([SWASH_G, SWASH_DOWN_RATIO, SWASH_THICK_K, SWASH_SINK, SWASH_REACH_MAX_M]).toEqual([9.81, 2, 0.3, 0.6, 12]);
  });

  it("runs a 1 m bore at Iribarren 0.8 up the 1:12 face 0.8 m vertical, 9.6 m along it", () => {
    expect(runUpVertical(1, 0.8)).toBe(0.8);
    expect(runUpVertical(0.5, 0.8)).toBe(0.4);
    expect(runUpAlongFace(1, 0.8, 1 / 12)).toBeCloseTo(9.6, 12);
    expect(runUpAlongFace(2, 0.6, 1 / 12)).toBeCloseTo(14.4, 12);
  });

  it("climbs from the bore's speed to its reach at tUp, then falls back to the waterline over twice that", () => {
    const tUp = tUpOf(9.6, 1);
    expect(tUp).toBeCloseTo(6.130088, 6);
    expect(frontAt(0, 9.6, 1)).toBe(0);
    // It sets off at √(g·h): 3.132 m/s for a 1 m bore.
    expect(frontAt(1e-4, 9.6, 1) / 1e-4).toBeCloseTo(3.132, 3);
    expect(frontAt(tUp / 2, 9.6, 1)).toBeCloseTo(7.2, 12);
    expect(frontAt(tUp, 9.6, 1)).toBeCloseTo(9.6, 12);
    expect(frontAt(tUp + tUp, 9.6, 1)).toBeCloseTo(7.2, 12);
    expect(frontAt(tUp + 2 * tUp, 9.6, 1)).toBeCloseTo(0, 12);
    expect(frontAt(3 * tUp + 0.001, 9.6, 1)).toBe(0);
    expect(frontAt(-0.1, 9.6, 1)).toBe(0);
    // Up, then down: no step anywhere.
    let prev = 0;
    let turned = false;
    for (let t = 0.05; t <= 3 * tUp; t += 0.05) {
      const f = frontAt(t, 9.6, 1);
      if (f < prev) turned = true;
      expect(turned ? f <= prev : f >= prev).toBe(true);
      expect(Math.abs(f - prev)).toBeLessThan(0.16);
      prev = f;
    }
    expect(turned).toBe(true);
  });

  it("gives no front, and no NaN, for a sheet with no reach or no height", () => {
    expect(frontAt(1, 0, 1)).toBe(0);
    expect(frontAt(1, 9.6, 0)).toBe(0);
    expect(frontAt(1, Number.NaN, 1)).toBe(0);
    expect(frontAt(Number.NaN, 9.6, 1)).toBe(0);
  });

  it("is a wedge: 0.3 of the bore's height at the waterline while climbing, nothing at the front or past it, thinned as it falls back", () => {
    expect(thicknessAt(0, 6, 1, 0)).toBeCloseTo(0.3, 12);
    expect(thicknessAt(3, 6, 1, 0)).toBeCloseTo(0.15, 12);
    expect(thicknessAt(6, 6, 1, 0)).toBe(0);
    expect(thicknessAt(7, 6, 1, 0)).toBe(0);
    expect(thicknessAt(-1, 6, 1, 0)).toBe(0);
    expect(thicknessAt(0, 6, 2, 0)).toBeCloseTo(0.6, 12);
    expect(thicknessAt(0, 6, 1, 0.5)).toBeCloseTo(0.21, 12);
    expect(thicknessAt(0, 6, 1, 1)).toBeCloseTo(0.12, 12);
    expect(thicknessAt(0, 6, 1, 3)).toBeCloseTo(0.12, 12);
    expect(thicknessAt(0, 0, 1, 0)).toBe(0);
  });

  it("overlaps two sheets as the greater front and the greater thickness", () => {
    const out = { front: -1, thick: -1 };
    overlap(5, 0.1, 3, 0.2, out);
    expect(out).toEqual({ front: 5, thick: 0.2 });
    overlap(0, 0, 4, 0.05, out);
    expect(out).toEqual({ front: 4, thick: 0.05 });
  });
});
