import { describe, it, expect } from "vitest";
import {
  DIED_CLOSE_FROM_S, DIED_CLOSE_S, DIED_EYE_HEIGHT, DIED_FALL_S, DIED_PITCH, DIED_ROLL, WON_BLUR_FROM_S, WON_BLUR_S,
  WON_LIFT_PITCH, WON_LIFT_S, easeIn, easeOut, endingPose, type EndingBase,
} from "../../src/game/ending.js";

const BASE: EndingBase = { x: 10, y: 3.6, z: -4, yaw: 0.7, pitch: 0.1, feetY: 2 };

describe("the eases", () => {
  it("run 0 to 1, the out fast then slow, the in slow then fast, and clamp", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(easeIn(0)).toBe(0);
    expect(easeIn(1)).toBe(1);
    expect(easeIn(0.5)).toBeLessThan(0.5);
    expect(easeOut(2)).toBe(1);
    expect(easeIn(-1)).toBe(0);
  });
});

describe("the win", () => {
  it("starts from the pose it was given, lifts the look to the sky, fast then slow, and holds the eye where it stood", () => {
    const start = endingPose("won", 0, BASE);
    expect([start.x, start.y, start.z, start.yaw, start.pitch, start.roll]).toEqual([10, 3.6, -4, 0.7, 0.1, 0]);
    expect(start.blur).toBe(0);
    expect(start.close).toBe(0);
    const half = endingPose("won", WON_LIFT_S / 2, BASE);
    expect(half.pitch).toBeLessThan(BASE.pitch + (WON_LIFT_PITCH - BASE.pitch) * 0.5);
    const done = endingPose("won", WON_LIFT_S, BASE);
    expect(done.pitch).toBeCloseTo(WON_LIFT_PITCH, 12);
    expect([done.x, done.y, done.z, done.yaw]).toEqual([10, 3.6, -4, 0.7]);
    expect(endingPose("won", 60, BASE).pitch).toBeCloseTo(WON_LIFT_PITCH, 12);
  });

  it("softens the picture from WON_BLUR_FROM_S over WON_BLUR_S, and never closes the dark", () => {
    expect(endingPose("won", WON_BLUR_FROM_S, BASE).blur).toBe(0);
    expect(endingPose("won", WON_BLUR_FROM_S + WON_BLUR_S / 2, BASE).blur).toBeCloseTo(0.5, 12);
    expect(endingPose("won", WON_BLUR_FROM_S + WON_BLUR_S, BASE).blur).toBe(1);
    expect(endingPose("won", 60, BASE).blur).toBe(1);
    expect(endingPose("won", 60, BASE).close).toBe(0);
  });
});

describe("the death", () => {
  it("drops the eye to just off the ground on its back, slow then fast, the look to the sky and the head a little over", () => {
    const start = endingPose("died", 0, BASE);
    expect([start.x, start.y, start.z, start.pitch, start.roll]).toEqual([10, 3.6, -4, 0.1, 0]);
    const half = endingPose("died", DIED_FALL_S / 2, BASE);
    expect(half.y).toBeGreaterThan(BASE.y + (BASE.feetY + DIED_EYE_HEIGHT - BASE.y) * 0.5);
    const down = endingPose("died", DIED_FALL_S, BASE);
    expect(down.y).toBeCloseTo(BASE.feetY + DIED_EYE_HEIGHT, 12);
    expect(down.pitch).toBeCloseTo(DIED_PITCH, 12);
    expect(down.roll).toBeCloseTo(DIED_ROLL, 12);
    expect([down.x, down.z, down.yaw]).toEqual([10, -4, 0.7]);
    expect(endingPose("died", 60, BASE).y).toBeCloseTo(BASE.feetY + DIED_EYE_HEIGHT, 12);
  });

  it("closes the dark from DIED_CLOSE_FROM_S over DIED_CLOSE_S, and never softens", () => {
    expect(endingPose("died", DIED_CLOSE_FROM_S, BASE).close).toBe(0);
    expect(endingPose("died", DIED_CLOSE_FROM_S + DIED_CLOSE_S / 2, BASE).close).toBeCloseTo(0.5, 12);
    expect(endingPose("died", DIED_CLOSE_FROM_S + DIED_CLOSE_S, BASE).close).toBe(1);
    expect(endingPose("died", 60, BASE).blur).toBe(0);
  });
});
