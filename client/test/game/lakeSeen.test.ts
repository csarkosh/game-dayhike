import { describe, expect, it } from "vitest";
import {
  LAKE_NEAR_SHORE_M, boxInPlanes, cornersPastBox, lakeDrawnFrom, lakeInViewFrom, lakeUnderEye, lakeViewPoints, shoreInPlanes, squareInPlanes, type ViewPlane,
} from "@csarkosh/engine/game/lakeSeen";
import { cameraAxes, restAxes, restPlanes, viewCorners, viewPlanes } from "@csarkosh/engine/game/lite/cameraPose";
import type { LakeShape } from "@csarkosh/engine/sim/lakeShape";
import { stadiumShape } from "../helpers/lakeShapes.js";

/** A diagonal lake: its spine from (−30, −30) to (30, 30), 8 m to the shore either side, at level 0. */
const DIAGONAL: LakeShape = { ...stadiumShape({ cx: 0, cz: 0, halfLen: 42, w: 8, level: 0 }), px: [-30, 30], pz: [-30, 30] };
const POINTS = lakeViewPoints(DIAGONAL, 0);
const HALF = DIAGONAL.shoreMax + 5;

/** The view's planes from (x, y, z) toward (tx, ty, tz), through a 60 degree lens 1.5 wide. */
function view(x: number, y: number, z: number, tx: number, ty: number, tz: number): { planes: ViewPlane[]; f: [number, number, number] } {
  const dx = tx - x, dy = ty - y, dz = tz - z;
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  const axes = cameraAxes(yaw, pitch, 0, restAxes());
  const planes = viewPlanes({ x, y, z, yaw, pitch, roll: 0 }, axes, Math.PI / 3, 1.5, 0.1, 2500, restPlanes());
  return { planes, f: [axes.fx, axes.fy, axes.fz] };
}
function drawn(x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean {
  const { planes, f } = view(x, y, z, tx, ty, tz);
  return lakeDrawnFrom(DIAGONAL, 0, HALF, POINTS, planes, x, y, z, f[0], f[1], f[2]);
}

describe("a lake's water in a view, read with no engine", () => {
  it("answers at once for an eye over the water, and for a centre ray that meets the level over water", () => {
    expect(lakeUnderEye(DIAGONAL, 0, 2, 0, 0, 0, 1)).toBe(true);
    // From the bank, 20 m off the spine, looking down at the middle of the lake.
    const len = Math.hypot(-14, -2, 14);
    expect(lakeUnderEye(DIAGONAL, 14, 2, -14, -14 / len, -2 / len, 14 / len)).toBe(true);
    // The same eye looking level, or away: no.
    expect(lakeUnderEye(DIAGONAL, 14, 2, -14, -Math.SQRT1_2, 0, Math.SQRT1_2)).toBe(false);
    expect(lakeUnderEye(DIAGONAL, 14, 2, -14, Math.SQRT1_2, -0.1, -Math.SQRT1_2)).toBe(false);
  });

  it("finds a shore point inside every plane only where the shore is in the view", () => {
    expect(shoreInPlanes(POINTS, view(30, 2, -30, 0, 0, 0).planes)).toBe(true);
    expect(shoreInPlanes(POINTS, view(30, 2, -30, 60, 0, -60).planes)).toBe(false);
  });

  it("culls a level square only when all of it is outside one plane", () => {
    const toward = view(200, 5, 0, 0, 0, 0).planes;
    const away = view(200, 5, 0, 400, 0, 0).planes;
    expect(squareInPlanes(0, 0, 0, 50, toward)).toBe(true);
    expect(squareInPlanes(0, 0, 0, 50, away)).toBe(false);
    // A square the eye stands in is in every view.
    expect(squareInPlanes(200, 0, 0, 50, away)).toBe(true);
  });

  it("draws the lake from the bank facing the water and not from the bank inside its square facing away", () => {
    // 42 m from the spine, 34 m from the water: inside the surface's square.
    expect(drawn(30, 2, -30, 0, 0, 0)).toBe(true);
    expect(squareInPlanes(DIAGONAL.cx, 0, DIAGONAL.cz, HALF, view(30, 2, -30, 60, 0, -60).planes)).toBe(true);
    expect(drawn(30, 2, -30, 60, 0, -60)).toBe(false);
  });

  it("draws the lake by its square alone from within a few metres of the shore", () => {
    // 3 m outside the shore, back turned to the water: a corner of the view can still hold a strip of it.
    const off = (8 + 3) * Math.SQRT1_2;
    expect(3).toBeLessThan(LAKE_NEAR_SHORE_M);
    expect(drawn(off, 2, -off, off + 30, 2, -off - 30)).toBe(true);
  });

  it("says the water is in the view only by its shore: not from the bank with the back turned, where the surface is still drawn", () => {
    const inView = (x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean => {
      const { planes, f } = view(x, y, z, tx, ty, tz);
      return lakeInViewFrom(DIAGONAL, 0, HALF, POINTS, planes, x, y, z, f[0], f[1], f[2]);
    };
    const off = (8 + 3) * Math.SQRT1_2;
    // 3 m outside the shore, back turned: drawn, and not in the view; turned to the water: both.
    expect(drawn(off, 2, -off, off + 30, 2, -off - 30)).toBe(true);
    expect(inView(off, 2, -off, off + 30, 2, -off - 30)).toBe(false);
    expect(inView(off, 2, -off, 0, 0, 0)).toBe(true);
    // From farther off the two say the same.
    expect(inView(30, 2, -30, 0, 0, 0)).toBe(true);
    expect(inView(30, 2, -30, 60, 0, -60)).toBe(false);
    expect(inView(300, 2, 300, 600, 2, 600)).toBe(false);
  });

  it("does not draw a lake whose square the view does not hold", () => {
    expect(drawn(300, 2, 300, 600, 2, 600)).toBe(false);
  });
});

describe("a box far larger than the view", () => {
  // The forest's view of the western sea: the eye inland looking north-east, the sea's outermost ring's box kilometres
  // long behind its left shoulder.
  const eye = { x: 250, y: 60, z: -500, yaw: 1.09, pitch: 0, roll: 0 };
  const axes = cameraAxes(eye.yaw, eye.pitch, eye.roll, restAxes());
  const lens = [1.0, 1470 / 956, 0.1, 4000] as const;
  const planes = viewPlanes(eye, axes, ...lens, restPlanes());
  const corners = viewCorners(eye, axes, ...lens, new Float32Array(24));
  const sea = [-3980, -12, -4620, -308, 12, 3596] as const;

  it("is kept by the planes alone though the view holds none of it, and told apart by the view's corners", () => {
    expect(boxInPlanes(...sea, planes)).toBe(true);
    expect(cornersPastBox(...sea, corners)).toBe(true);
  });

  it("is not told apart where the view reaches into it, or where it lies round the view", () => {
    // The same box seen from the beach, looking out to sea.
    const beach = { x: -366, y: 3, z: 0, yaw: -1.571, pitch: 0, roll: 0 };
    const out = cameraAxes(beach.yaw, beach.pitch, beach.roll, restAxes());
    expect(boxInPlanes(...sea, viewPlanes(beach, out, ...lens, restPlanes()))).toBe(true);
    expect(cornersPastBox(...sea, viewCorners(beach, out, ...lens, new Float32Array(24)))).toBe(false);
    // With its back to the sea within the box's reach, and from the headland looking down along it.
    const back = cameraAxes(1.571, 0, 0, restAxes());
    expect(cornersPastBox(...sea, viewCorners({ ...beach, x: -320, yaw: 1.571 }, back, ...lens, new Float32Array(24)))).toBe(false);
    // A box the view stands inside.
    expect(cornersPastBox(-5000, -5000, -5000, 5000, 5000, 5000, corners)).toBe(false);
  });

  it("is told apart on each axis and each side", () => {
    const unit = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1]);
    for (let axis = 0; axis < 3; axis++) {
      for (const side of [-1, 1]) {
        const min = [-10, -10, -10];
        const max = [10, 10, 10];
        if (side < 0) {
          min[axis] = 1.5;
          max[axis] = 9;
        } else {
          min[axis] = -9;
          max[axis] = -0.5;
        }
        expect(cornersPastBox(min[0] as number, min[1] as number, min[2] as number, max[0] as number, max[1] as number, max[2] as number, unit), `axis ${axis} side ${side}`).toBe(true);
      }
    }
    expect(cornersPastBox(0.5, 0.5, 0.5, 2, 2, 2, unit)).toBe(false);
  });
});
