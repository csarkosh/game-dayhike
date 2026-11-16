import { describe, expect, it } from "vitest";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import { cameraAxes, projectToCanvas, restAxes, restPlanes, viewCorners, viewPlanes, type CameraPose } from "../../../src/game/lite/cameraPose.js";

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

describe("the view's six planes", () => {
  it("are the ones Babylon.js cuts its view by: the same points inside, the same outside", () => {
    const fov = 0.9;
    const aspect = 1470 / 956;
    const near = 0.1;
    const far = 600;
    for (const [yaw, pitch, roll] of POSES) {
      const eye: CameraPose = { x: 12, y: 30, z: -7, yaw, pitch, roll };
      const axes = cameraAxes(yaw, pitch, roll, restAxes());
      const ours = viewPlanes(eye, axes, fov, aspect, near, far, restPlanes());
      const view = Matrix.LookAtLH(
        new Vector3(eye.x, eye.y, eye.z), new Vector3(eye.x + axes.fx, eye.y + axes.fy, eye.z + axes.fz), new Vector3(axes.ux, axes.uy, axes.uz),
      );
      const theirs = Frustum.GetPlanes(view.multiply(Matrix.PerspectiveFovLH(fov, aspect, near, far)));
      for (const plane of ours) expect(Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z)).toBeCloseTo(1, 9);
      // Points all round the eye, near and far: each is inside both sets of planes or outside both.
      for (let i = 0; i < 400; i++) {
        // From behind the eye to past the far plane, never a whole step onto either.
        const along = ((i * 37) % 23) * 31.3 - 60.7;
        const p = { x: eye.x + axes.fx * along + axes.rx * (((i * 13) % 17) - 8) * 20 + axes.ux * (((i * 7) % 11) - 5) * 20,
          y: eye.y + axes.fy * along + axes.ry * (((i * 13) % 17) - 8) * 20 + axes.uy * (((i * 7) % 11) - 5) * 20,
          z: eye.z + axes.fz * along + axes.rz * (((i * 13) % 17) - 8) * 20 + axes.uz * (((i * 7) % 11) - 5) * 20 };
        const inside = (planes: readonly { normal: { x: number; y: number; z: number }; d: number }[], margin: number): boolean =>
          planes.every((plane) => plane.normal.x * p.x + plane.normal.y * p.y + plane.normal.z * p.z + plane.d > margin);
        // A point within a hair of a plane may fall either side by rounding: only the clear ones are compared.
        if (inside(theirs, 0.05) !== inside(theirs, -0.05)) continue;
        expect(inside(ours, 0), `${yaw} ${pitch} ${roll} ${i}`).toBe(inside(theirs, 0));
      }
    }
  });

  it("fills the planes it is handed: near, far, left, right, top, bottom, each facing in", () => {
    const planes = restPlanes();
    const eye: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    expect(viewPlanes(eye, restAxes(), Math.PI / 2, 1, 1, 100, planes)).toBe(planes);
    expect(planes[0]).toEqual({ normal: { x: 0, y: 0, z: 1 }, d: -1 });
    expect(planes[1]?.normal.z).toBe(-1);
    expect(planes[1]?.d).toBe(100);
    // A right angle of view: each side plane leans in by 45 degrees.
    expect(planes[2]?.normal.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(planes[3]?.normal.x).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(planes[4]?.normal.y).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(planes[5]?.normal.y).toBeCloseTo(Math.SQRT1_2, 9);
    for (const plane of planes.slice(2)) expect(plane.d).toBeCloseTo(0, 12);
  });
});

describe("the view's eight corners", () => {
  it("lie on the planes that meet at each: the near plane's four, then the far plane's", () => {
    const eye: CameraPose = { x: 12, y: 30, z: -7, yaw: 1.1, pitch: -0.3, roll: 0.05 };
    const axes = cameraAxes(eye.yaw, eye.pitch, eye.roll, restAxes());
    const planes = viewPlanes(eye, axes, 1.1, 1.5, 0.5, 900, restPlanes());
    const corners = viewCorners(eye, axes, 1.1, 1.5, 0.5, 900, new Float32Array(24));
    const on = (plane: number, corner: number): number => {
      const p = planes[plane] as (typeof planes)[number];
      return p.normal.x * (corners[corner * 3] as number) + p.normal.y * (corners[corner * 3 + 1] as number) + p.normal.z * (corners[corner * 3 + 2] as number) + p.d;
    };
    for (let c = 0; c < 8; c++) {
      // Near or far, left or right, bottom or top: a corner is on three planes and inside the other three.
      const meets = [c < 4 ? 0 : 1, c % 2 === 0 ? 2 : 3, (c >> 1) % 2 === 0 ? 5 : 4];
      for (let plane = 0; plane < 6; plane++) {
        if (meets.includes(plane)) expect(Math.abs(on(plane, c)), `corner ${c} on plane ${plane}`).toBeLessThan(2e-3);
        else expect(on(plane, c), `corner ${c} inside plane ${plane}`).toBeGreaterThan(0);
      }
    }
  });
});
