import { describe, expect, it } from "vitest";
import { WHEEL_RADIUS, carAlong, roadPose, stopAt } from "../../../src/game/scene/roadPath.js";

const road = { centerX: (z: number) => 100 + 0.1 * z, groundY: (x: number, z: number) => 5 + 0.01 * x + 0.001 * z };

describe("the road path", () => {
  it("puts the car on the centreline plus its lane, to its right, headed the way it drives", () => {
    const up = roadPose(road, 40, 1.8, 1);
    expect(up.x).toBeCloseTo(105.8, 6);
    expect(up.z).toBe(40);
    expect(up.yaw).toBeCloseTo(Math.atan2(0.1, 1), 6);
    expect(up.y).toBeCloseTo(5 + 1.058 + 0.04, 6);
    const down = roadPose(road, 40, 1.8, -1);
    expect(down.x).toBeCloseTo(102.2, 6);
    expect(down.yaw).toBeCloseTo(Math.PI + Math.atan2(0.1, 1), 6);
  });

  it("drives a distance along z from a start, the wheels spinning with the distance", () => {
    const car = carAlong(road, -100, (t) => 10 * t, 1.8, 1);
    expect(car(0).z).toBe(-100);
    expect(car(5).z).toBe(-50);
    expect(car(5).wheelSpin).toBeCloseTo(50 / WHEEL_RADIUS, 6);
    expect(car(5).doorOpen).toBe(0);
    expect(WHEEL_RADIUS).toBe(0.36);
  });

  it("takes a lane that changes with time, so a car can ease onto the shoulder as it stops", () => {
    const car = carAlong(road, 0, (t) => 10 * t, (t) => 1.8 + t, 1);
    expect(car(0).x).toBeCloseTo(101.8, 6);
    expect(car(2).x).toBeCloseTo(100 + 2 + 3.8, 6);
  });

  it("cruises then brakes to a stop at the total, with no motion after", () => {
    const d = stopAt(470, 12, 7);
    expect(d(0)).toBe(0);
    expect(d(10)).toBe(120);
    const cruiseEnd = (470 - 12 * 7 / 2) / 12;
    expect(d(cruiseEnd)).toBeCloseTo(428, 6);
    expect(d(cruiseEnd + 7)).toBeCloseTo(470, 6);
    expect(d(cruiseEnd + 3.5)).toBeGreaterThan(428);
    expect(d(cruiseEnd + 3.5)).toBeLessThan(470);
    expect(d(99)).toBe(470);
  });
});
