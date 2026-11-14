import { describe, expect, it } from "vitest";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { cameraAxes, projectToCanvas, restAxes, type CameraPose } from "../../../src/game/lite/cameraPose.js";

const POSES: [number, number, number][] = [
  [0, 0, 0], [0.7, 0, 0], [0, 0.4, 0], [0, 0, 0.3], [1.09, -0.35, 0.0105], [-2.4, 1.1, -0.6], [3.14, 0.2, 0.5],
];

describe("the camera's axes from its yaw, pitch and roll", () => {
  it("are the ones Babylon's camera makes of the same rotation", () => {
    for (const [yaw, pitch, roll] of POSES) {
      const turned = Matrix.RotationYawPitchRoll(yaw, pitch, roll);
      const axes = cameraAxes(yaw, pitch, roll, restAxes());
      const forward = Vector3.TransformNormal(new Vector3(0, 0, 1), turned);
      const up = Vector3.TransformNormal(new Vector3(0, 1, 0), turned);
      const right = Vector3.TransformNormal(new Vector3(1, 0, 0), turned);
      const label = `${yaw} ${pitch} ${roll}`;
      expect([axes.fx, axes.fy, axes.fz].map((v, i) => v - forward.asArray()[i]!).every((d) => Math.abs(d) < 1e-6), label).toBe(true);
      expect([axes.ux, axes.uy, axes.uz].map((v, i) => v - up.asArray()[i]!).every((d) => Math.abs(d) < 1e-6), label).toBe(true);
      expect([axes.rx, axes.ry, axes.rz].map((v, i) => v - right.asArray()[i]!).every((d) => Math.abs(d) < 1e-6), label).toBe(true);
    }
  });

  it("looks along +Z at rest, toward +X as the yaw grows and down as the pitch does", () => {
    expect(Object.values(cameraAxes(0, 0, 0, restAxes())).map((v) => v + 0)).toEqual(Object.values(restAxes()));
    const east = cameraAxes(Math.PI / 2, 0, 0, restAxes());
    expect(east.fx).toBeCloseTo(1, 9);
    expect(east.fz).toBeCloseTo(0, 9);
    expect(cameraAxes(0, 0.5, 0, restAxes()).fy).toBeLessThan(0);
  });

  it("fills the axes it is handed", () => {
    const axes = restAxes();
    expect(cameraAxes(1, 0.2, 0.1, axes)).toBe(axes);
  });
});

describe("a world point on the canvas", () => {
  const pose: CameraPose = { x: 10, y: 2, z: -5, yaw: 0, pitch: 0, roll: 0 };
  const axes = cameraAxes(0, 0, 0, restAxes());
  const FOV = 1.4;

  it("is the canvas's centre for a point straight ahead, with its distance", () => {
    expect(projectToCanvas(pose, axes, FOV, 0.05, 800, 600, 10, 2, 15)).toEqual({ x: 400, y: 300, depth: 20 });
  });

  it("is the canvas's top edge at half the vertical field of view above, and right of centre for a point to the right", () => {
    const up = projectToCanvas(pose, axes, FOV, 0.05, 800, 600, 10, 2 + 10 * Math.tan(FOV / 2), 5);
    expect(up?.x).toBeCloseTo(400, 6);
    expect(up?.y).toBeCloseTo(0, 6);
    const right = projectToCanvas(pose, axes, FOV, 0.05, 800, 600, 13, 2, 5);
    expect(right?.x).toBeGreaterThan(400);
    expect(right?.y).toBeCloseTo(300, 6);
    // The horizontal reach follows the canvas's shape: the same point on a narrower canvas is farther across it.
    const narrow = projectToCanvas(pose, axes, FOV, 0.05, 400, 600, 13, 2, 5);
    expect(((narrow?.x ?? 0) - 200) / 200).toBeCloseTo((((right?.x ?? 0) - 400) / 400) * 2, 6);
  });

  it("is nowhere for a point behind the eye or nearer than the near plane", () => {
    expect(projectToCanvas(pose, axes, FOV, 0.05, 800, 600, 10, 2, -6)).toBeNull();
    expect(projectToCanvas(pose, axes, FOV, 0.05, 800, 600, 10, 2, -4.96)).toBeNull();
    expect(projectToCanvas(pose, axes, FOV, 0.05, 800, 600, 10, 2, -4.9)).not.toBeNull();
  });

  it("follows the camera's turn: a point to the east is ahead of a camera facing east", () => {
    const turned = cameraAxes(Math.PI / 2, 0, 0, restAxes());
    const at = projectToCanvas({ ...pose, yaw: Math.PI / 2 }, turned, FOV, 0.05, 800, 600, 30, 2, -5);
    expect(at?.x).toBeCloseTo(400, 6);
    expect(at?.y).toBeCloseTo(300, 6);
    expect(at?.depth).toBeCloseTo(20, 9);
  });
});
