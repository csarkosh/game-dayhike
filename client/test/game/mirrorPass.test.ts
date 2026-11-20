import { describe, expect, it } from "vitest";
import {
  MIRROR_EVERY, MIRROR_FOV_MARGIN, MIRROR_LIFT, MIRROR_MAX_HEIGHT, MIRROR_MAX_WIDTH, MIRROR_MOTION_SMEAR, MIRROR_MOTION_SMOOTH, MIRROR_MOTION_STEP_MAX_M,
  MIRROR_REACH_M, MIRROR_SCALE, createMirrorCadence, mirrorArmed, mirrorMotion, mirrorProjection, mirrorRead, mirrorScale, mirrorTargetSize, mirroredPose, poseView,
  type MirrorPose,
} from "@csarkosh/engine/game/mirrorPass";
import { obliqueProjectionReversed, reflectionMatrix } from "@csarkosh/engine/game/mirrorView";

/** A perspective projection whose depth runs from 1 at `near` to 0 at `far`, for a view whose z runs forward. */
function reversedPerspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const m = new Float32Array(16);
  const t = 1 / Math.tan(fov / 2);
  m[0] = t / aspect;
  m[5] = t;
  m[10] = -near / (far - near);
  m[11] = 1;
  m[14] = (near * far) / (far - near);
  return m;
}

/** A view whose z runs along the aim: right is up cross forward. */
function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const sub = (a: number[], b: number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
  const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const unit = (a: number[]): number[] => { const l = Math.hypot(a[0]!, a[1]!, a[2]!); return [a[0]! / l, a[1]! / l, a[2]! / l]; };
  const f = unit(sub(target, eye));
  const r = unit(cross(up, f));
  const u = cross(f, r);
  return new Float32Array([r[0]!, u[0]!, f[0]!, 0, r[1]!, u[1]!, f[1]!, 0, r[2]!, u[2]!, f[2]!, 0, -dot(r, eye), -dot(u, eye), -dot(f, eye), 1]);
}

/** Two arrays the same to five places. */
function close(a: ArrayLike<number>, b: ArrayLike<number>): void {
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i] as number, 5);
}

/** A point through a matrix: clip j is the sum over i of p_i m[4i + j]. */
function through(m: ArrayLike<number>, p: number[]): number[] {
  const q = [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
  return [0, 1, 2, 3].map((j) => q[0]! * m[j]! + q[1]! * m[4 + j]! + q[2]! * m[8 + j]! + q[3]! * m[12 + j]!);
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[4 * i + j] = out[4 * i + j]! + a[4 * i + k]! * b[4 * k + j]!;
  return out;
}

describe("the lake's mirror as arithmetic", () => {
  it("keeps the game's numbers", () => {
    expect(MIRROR_SCALE).toBe(0.5);
    expect([MIRROR_MAX_WIDTH, MIRROR_MAX_HEIGHT]).toEqual([960, 540]);
    expect(MIRROR_EVERY).toBe(3);
    expect(MIRROR_FOV_MARGIN).toBe(1.2);
    expect([MIRROR_MOTION_SMEAR, MIRROR_MOTION_SMOOTH, MIRROR_MOTION_STEP_MAX_M]).toEqual([0.5, 0.3, 5]);
    expect(MIRROR_LIFT).toBe(0.02);
    expect(MIRROR_REACH_M).toBe(200);
  });

  it("sizes the picture at half the frame, capped, and says the same as one scale of the frame", () => {
    expect(mirrorTargetSize(1470, MIRROR_MAX_WIDTH)).toBe(735);
    expect(mirrorTargetSize(956, MIRROR_MAX_HEIGHT)).toBe(478);
    expect(mirrorTargetSize(3840, MIRROR_MAX_WIDTH)).toBe(960);
    expect(mirrorTargetSize(1, MIRROR_MAX_WIDTH)).toBe(1);
    expect(mirrorScale(1470, 956)).toBe(0.5);
    expect(mirrorScale(3840, 2160)).toBe(0.25);
    // A tall frame is held by its height.
    expect(mirrorScale(1600, 1600) * 1600).toBeCloseTo(540, 9);
  });

  it("lags by the eye's travel over the held frames, smoothed, and not by a teleport", () => {
    expect(mirrorMotion(0, 0.1)).toBeCloseTo(0.06, 6);
    expect(mirrorMotion(0.06, 0.1)).toBeCloseTo(0.102, 6);
    expect(mirrorMotion(0.1, 6)).toBeCloseTo(0.07, 6);
  });

  it("arms the pass only with the lake's glass in view, the eye over the plane and within reach", () => {
    expect(mirrorArmed(true, 0.5, 2, 1, 0)).toBe(true);
    expect(mirrorArmed(false, 0.5, 2, 1, 0)).toBe(false);
    expect(mirrorArmed(true, 0, 2, 1, 0)).toBe(false);
    expect(mirrorArmed(true, 0.5, 1, 1, 0)).toBe(false);
    expect(mirrorArmed(true, 0.5, 2, 1, MIRROR_REACH_M)).toBe(false);
    expect(mirrorArmed(true, 0.5, 2, 1, MIRROR_REACH_M - 0.01)).toBe(true);
  });

  it("draws on the first armed frame and then every third, and again at once after a rest", () => {
    const cadence = createMirrorCadence();
    expect([true, true, true, true, true, true, true].map((on) => cadence.step(on))).toEqual([true, false, false, true, false, false, true]);
    expect(cadence.armed).toBe(true);
    expect(cadence.step(false)).toBe(false);
    expect(cadence.armed).toBe(false);
    expect(cadence.step(true)).toBe(true);
    expect(cadence.step(true)).toBe(false);
    cadence.rest();
    expect(cadence.step(true)).toBe(true);
  });

  it("mirrors the camera in the plane: its place, its aim and its up", () => {
    const pose: MirrorPose = { eye: [0, 0, 0], target: [0, 0, 0], up: [0, 0, 0] };
    mirroredPose(10, { x: 3, y: 12, z: -4 }, { fx: 0.6, fy: -0.8, fz: 0, ux: 0.8, uy: 0.6, uz: 0 }, 10, pose);
    expect(pose.eye).toEqual([3, 8, -4]);
    expect(pose.target[0]).toBeCloseTo(9, 9);
    expect(pose.target[1]).toBeCloseTo(16, 9);
    expect(pose.target[2]).toBeCloseTo(-4, 9);
    expect(pose.up[0]).toBeCloseTo(0.8, 9);
    expect(pose.up[1]).toBeCloseTo(-0.6, 9);
    expect(pose.up[2]).toBeCloseTo(0, 9);
  });

  it("makes a pose's view as a look-at camera's: the eye at the origin, the aim along z", () => {
    const pose: MirrorPose = { eye: [3, 8, -4], target: [9, 16, -4], up: [0.8, -0.6, 0] };
    const view = poseView(pose, new Float32Array(16));
    close(view, lookAt(pose.eye, pose.target, pose.up));
    close(through(view, pose.eye), [0, 0, 0, 1]);
    close(through(view, pose.target), [0, 0, 10, 1]);
  });

  it("draws the reflection's own picture turned over left to right, and reads it back through the reflection's view", () => {
    const level = 10;
    const eye = { x: 3, y: 12, z: -4 };
    const axes = { fx: 0.6, fy: -0.48, fz: 0.64, ux: 0.3283, uy: 0.8773, uz: 0.3502 };
    const player = lookAt([eye.x, eye.y, eye.z], [eye.x + axes.fx, eye.y + axes.fy, eye.z + axes.fz], [0, 1, 0]);
    // The up the look-at leaves: the pose is handed the camera's own.
    const up = { ux: player[1]!, uy: player[5]!, uz: player[9]! };
    const pose: MirrorPose = { eye: [0, 0, 0], target: [0, 0, 0], up: [0, 0, 0] };
    mirroredPose(level, eye, { ...axes, ...up }, 10, pose);
    const view = lookAt(pose.eye, pose.target, pose.up);
    const projection = reversedPerspective(1.2, 1.5, 0.1, 500);
    const drawn = mirrorProjection(projection, view, level, new Float32Array(16));
    const read = mirrorRead(view, drawn, new Float32Array(16));
    // The reflection's own camera: the world mirrored, then the player's view; the same projection, its plane found in that camera's space.
    const reflected = multiply(reflectionMatrix(level, new Float32Array(16)), player);
    for (const p of [[20, 14, 30], [-8, 30, 50], [3, 10.5, 9], [40, 11, 80]]) {
      const a = through(read, p);
      const viaPose = through(multiply(view, drawn), p);
      // The read is the pose's own clip with x turned over.
      expect(a[0]).toBeCloseTo(-viaPose[0]!, 4);
      expect(a[1]).toBeCloseTo(viaPose[1]!, 4);
      expect(a[3]).toBeCloseTo(viaPose[3]!, 4);
      // And it is where the reflection's camera sees the point: the same x and y over w.
      const b = through(multiply(reflected, projection), p);
      expect(a[0]! / a[3]!).toBeCloseTo((b[0]! / b[3]!) / MIRROR_FOV_MARGIN, 4);
      expect(a[1]! / a[3]!).toBeCloseTo((b[1]! / b[3]!) / MIRROR_FOV_MARGIN, 4);
    }
    // A point of the plane is at the near depth, one over it inside, one under it cut off.
    const on = through(multiply(view, drawn), [20, level, 30]);
    expect(on[2]! / on[3]!).toBeCloseTo(1, 4);
    const over = through(multiply(view, drawn), [20, level + 5, 30]);
    expect(over[2]! / over[3]!).toBeLessThan(1);
    expect(over[2]! / over[3]!).toBeGreaterThan(0);
    const under = through(multiply(view, drawn), [20, level - 1, 30]);
    expect(under[2]! / under[3]!).toBeGreaterThan(1);
  });

  it("makes the near plane the water's where depth runs from 1 to 0, and leaves the rest of the projection", () => {
    const projection = reversedPerspective(1.0, 1.6, 0.1, 400);
    // A plane under the eye, tilted, its normal into the kept half: the eye (the origin) is on the other side.
    const plane = [0.1, 0.9, 0.4, -3];
    const out = obliqueProjectionReversed(projection, plane, new Float32Array(16));
    for (let i = 0; i < 16; i++) if (i % 4 !== 2) expect(out[i]).toBe(projection[i]);
    // On the plane the depth is 1; on the kept side it falls from there.
    const on = [0, 0, 7.5];
    expect(plane[0]! * on[0]! + plane[1]! * on[1]! + plane[2]! * on[2]! + plane[3]!).toBeCloseTo(0, 6);
    const clipOn = through(out, on);
    expect(clipOn[2]! / clipOn[3]!).toBeCloseTo(1, 5);
    const kept = through(out, [0, 2, 30]);
    expect(kept[2]! / kept[3]!).toBeLessThan(1);
    expect(kept[2]! / kept[3]!).toBeGreaterThan(0);
    const cut = through(out, [0, -1, 5]);
    expect(cut[2]! / cut[3]!).toBeGreaterThan(1);
    // The far corner on the plane's side is at depth 0: the corner the projection takes to (+1, +1) at its far plane.
    const t = Math.tan(0.5);
    const corner = [400 * t * 1.6, 400 * t, 400];
    const far = through(out, corner);
    expect(far[2]! / far[3]!).toBeCloseTo(0, 5);
    // A plane the far corner lies behind leaves the projection as it was.
    expect([...obliqueProjectionReversed(projection, [0, -1, 0, -1e6], new Float32Array(16))]).toEqual([...projection]);
  });
});
