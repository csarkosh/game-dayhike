import { describe, expect, it } from "vitest";
import { CAP_RADIUS } from "../../../src/game/droppedCap.js";
import { cameraAxes, restAxes, restPlanes, viewPlanes, type CameraPose } from "@csarkosh/engine/game/lite/cameraPose";
import { CAP_SPHERE_M, sphereInView } from "../../../src/game/lite/capMesh.js";

describe("the dropped cap on Babylon Lite", () => {
  it("is taken to fill a sphere that holds its crown and its brim", () => {
    // The brim is pushed forward by over half a radius and stretched past the crown's edge.
    expect(CAP_SPHERE_M).toBeGreaterThan(CAP_RADIUS * (0.55 + 1.05 * 1.1));
    expect(CAP_SPHERE_M).toBeLessThan(1);
  });

  it("is drawn while the view's planes hold it: ahead of the eye, and not behind it or far off to a side", () => {
    const eye: CameraPose = { x: 10, y: 2, z: -5, yaw: 0, pitch: 0, roll: 0 };
    const planes = viewPlanes(eye, cameraAxes(0, 0, 0, restAxes()), 1.4, 1.5, 0.1, 600, restPlanes());
    expect(sphereInView(planes, 10, 1, 5, CAP_SPHERE_M)).toBe(true);
    expect(sphereInView(planes, 10, 1, -15, CAP_SPHERE_M)).toBe(false);
    expect(sphereInView(planes, 200, 1, 5, CAP_SPHERE_M)).toBe(false);
    expect(sphereInView(planes, 10, 1, 700, CAP_SPHERE_M)).toBe(false);
    // Just outside a side plane by less than the sphere: still held, by the sphere's margin. The left plane holds
    // the eye, so a point ahead on it and then half a sphere out along its outward normal is such a point.
    const left = planes[2] as { normal: { x: number; y: number; z: number }; d: number };
    const on = { x: eye.x - left.normal.z * 20, z: eye.z + left.normal.x * 20 };
    expect(sphereInView(planes, on.x - left.normal.x * CAP_SPHERE_M * 0.5, 2, on.z - left.normal.z * CAP_SPHERE_M * 0.5, CAP_SPHERE_M)).toBe(true);
    expect(sphereInView(planes, on.x - left.normal.x * CAP_SPHERE_M * 1.5, 2, on.z - left.normal.z * CAP_SPHERE_M * 1.5, CAP_SPHERE_M)).toBe(false);
  });
});
