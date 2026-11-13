import { describe, expect, it } from "vitest";
import { WAY_FLOOR_M, WAY_RIM_M, WAY_STEP_M, makeWay, wayDirection, wayDistance, wayDistanceWithin, wayPoint, wayProject } from "../../src/sim/wayDown.js";

describe("the way down's geometry", () => {
  // An L: 100 m along +x, then 60 m along +z.
  const L = makeWay([{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 60 }], 116.6, false);

  it("names its widths", () => {
    expect([WAY_STEP_M, WAY_FLOOR_M, WAY_RIM_M]).toEqual([2, 4, 5.5]);
  });

  it("resamples at 2 m and keeps its ends", () => {
    expect(L.length).toBeCloseTo(160, 3);
    expect(L.xs.length).toBe(81);
    expect([L.xs[0], L.zs[0], L.xs[80], L.zs[80]]).toEqual([0, 0, 100, 60]);
    expect(L.cum[80]).toBeCloseTo(160, 3);
    expect(L.straight).toBe(116.6);
    expect(L.fallback).toBe(false);
  });

  it("projects a point to metres along and metres off", () => {
    const a = wayProject(L, 50, 7);
    expect(a.s).toBeCloseTo(50, 3);
    expect(a.d).toBeCloseTo(7, 3);
    const b = wayProject(L, 104, 30);
    expect(b.s).toBeCloseTo(130, 3);
    expect(b.d).toBeCloseTo(4, 3);
  });

  it("finds the way from far outside its cells", () => {
    // The nearest place is the L's far end, (100, 60).
    expect(wayDistance(L, 50, 400)).toBeCloseTo(Math.hypot(50, 340), 2);
    expect(wayDistance(L, -300, 0)).toBeCloseTo(300, 2);
  });

  it("gives the point and the direction at a distance along, clamped at the ends", () => {
    const p = wayPoint(L, 130, { x: 0, z: 0 });
    expect(p.x).toBeCloseTo(100, 3);
    expect(p.z).toBeCloseTo(30, 3);
    const d = wayDirection(L, 130, { x: 0, z: 0 });
    expect(d.x).toBeCloseTo(0, 3);
    expect(d.z).toBeCloseTo(1, 3);
    expect(wayPoint(L, 999, { x: 0, z: 0 }).z).toBeCloseTo(60, 3);
    expect(wayPoint(L, -5, { x: 9, z: 9 })).toEqual({ x: 0, z: 0 });
    expect(wayDirection(L, 10, { x: 0, z: 0 }).x).toBeCloseTo(1, 3);
  });

  it("asked only whether a place is within a few metres, answers from the cells beside it and says Infinity past that", () => {
    expect(wayDistanceWithin(L, 50, 3, 5.5)).toBeCloseTo(3, 4);
    expect(wayDistanceWithin(L, 104, 30, 5.5)).toBeCloseTo(4, 4);
    expect(wayDistanceWithin(L, 50, 5.5, 5.5)).toBeCloseTo(5.5, 4);
    expect(wayDistanceWithin(L, 50, 9, 5.5)).toBe(Infinity);
    expect(wayDistanceWithin(L, 50, 400, 5.5)).toBe(Infinity);
    // Never a wrong "near": every place the whole search calls within the limit, this one does too.
    for (let x = -20; x <= 120; x += 7) {
      for (let z = -20; z <= 80; z += 7) {
        const whole = wayDistance(L, x, z), near = wayDistanceWithin(L, x, z, 5.5);
        if (whole <= 5.5) expect(near).toBeCloseTo(whole, 5);
        else expect(near).toBe(Infinity);
      }
    }
  });

  it("a way of one point has no length and is still a place", () => {
    const one = makeWay([{ x: 3, z: 4 }], 0, true);
    expect(one.length).toBe(0);
    expect(wayDistance(one, 0, 0)).toBeCloseTo(5, 6);
    expect(wayProject(one, 0, 0).s).toBe(0);
  });
});
