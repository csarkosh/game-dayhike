import { describe, it, expect } from "vitest";
import { blendedEye, capturedEye, EYE_SNAP_M, type EyePose } from "../../src/game/eyeBlend.js";

const pose = (x: number, y: number, z: number, yaw: number, pitch: number): EyePose => ({ x, y, z, yaw, pitch });
const player = (x: number, y: number, z: number, yaw: number, pitch: number) => ({ pos: { x, y, z }, yaw, pitch });
const out = (): EyePose => pose(-9, -9, -9, -9, -9);

describe("the eye between two ticks", () => {
  it("captures a player's pose into the record it is given", () => {
    const o = out();
    expect(capturedEye(player(1, 2, 3, 0.4, -0.1), o)).toBe(o);
    expect(o).toEqual(pose(1, 2, 3, 0.4, -0.1));
    expect(capturedEye(player(5, 6, 7, 1, 2))).toEqual(pose(5, 6, 7, 1, 2));
  });

  it("is the player's own pose with no pose before, and at or past the next tick", () => {
    expect(blendedEye(null, player(1, 2, 3, 0.4, 0.2), 0.5, out())).toEqual(pose(1, 2, 3, 0.4, 0.2));
    expect(blendedEye(pose(0, 0, 0, 0, 0), player(1, 2, 3, 0.4, 0.2), 1, out())).toEqual(pose(1, 2, 3, 0.4, 0.2));
    expect(blendedEye(pose(0, 0, 0, 0, 0), player(1, 2, 3, 0.4, 0.2), 1.5, out())).toEqual(pose(1, 2, 3, 0.4, 0.2));
  });

  it("moves alpha of the way from the pose before to the pose now, and holds at the pose before under 0", () => {
    const b = pose(10, 1, -4, 0.2, 0.1);
    const p = player(10.1, 1.02, -3.9, 0.3, 0);
    const o = blendedEye(b, p, 0.25, out());
    expect(o.x).toBeCloseTo(10.025, 12);
    expect(o.y).toBeCloseTo(1.005, 12);
    expect(o.z).toBeCloseTo(-3.975, 12);
    expect(o.yaw).toBeCloseTo(0.225, 12);
    expect(o.pitch).toBeCloseTo(0.075, 12);
    expect(blendedEye(b, p, 0, out())).toEqual(b);
    expect(blendedEye(b, p, -0.5, out())).toEqual(b);
  });

  it("turns the yaw the shorter way round the wrap", () => {
    // From just under π to just over -π: a small turn through π, not a sweep back through 0.
    const o = blendedEye(pose(0, 0, 0, Math.PI - 0.1, 0), player(0, 0, 0, -Math.PI + 0.1, 0), 0.5, out());
    expect(o.yaw).toBeCloseTo(Math.PI, 12);
    const back = blendedEye(pose(0, 0, 0, -Math.PI + 0.1, 0), player(0, 0, 0, Math.PI - 0.1, 0), 0.5, out());
    expect(back.yaw).toBeCloseTo(-Math.PI, 12);
    // A plain turn, no wrap, blends plainly.
    expect(blendedEye(pose(0, 0, 0, 1, 0), player(0, 0, 0, 2, 0), 0.5, out()).yaw).toBeCloseTo(1.5, 12);
  });

  it("snaps to the pose now across a teleport, and blends up to the snap's edge", () => {
    expect(EYE_SNAP_M).toBe(3);
    const b = pose(0, 0, 0, 0, 0);
    expect(blendedEye(b, player(0, 0, 3.01, 1, 0), 0.5, out())).toEqual(pose(0, 0, 3.01, 1, 0));
    expect(blendedEye(b, player(0, 0, 2.99, 1, 0), 0.5, out()).z).toBeCloseTo(1.495, 12);
  });
});
