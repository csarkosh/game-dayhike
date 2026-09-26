import { describe, expect, it } from "vitest";
import {
  CULL_MARGIN, CULL_MOVE, CULL_PUSHBACK, CULL_RADIUS, CULL_TURN,
  cullPlanes, cullPrefix, needsCull, type CullPose,
} from "../../src/game/grassCull.js";
import { inCone } from "../../src/game/wildlifeDirector.js";

const POSE: CullPose = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, fov: 1.4, aspect: 1200 / 2029 };

/** n instances: translations at (x, y, z) (y 0 when a point gives two
 * coordinates), one attribute of stride 4 holding the index. */
function field(points: ([number, number] | [number, number, number])[]) {
  const n = points.length;
  const src = new Float32Array(n * 16), attr = new Float32Array(n * 4);
  points.forEach((p, i) => {
    src[i * 16] = src[i * 16 + 5] = src[i * 16 + 10] = src[i * 16 + 15] = 1;
    src[i * 16 + 12] = p[0];
    src[i * 16 + 13] = p.length === 3 ? p[1] : 0;
    src[i * 16 + 14] = p.length === 3 ? p[2] : p[1];
    attr[i * 4] = i;
  });
  return { n, matrix: { src, dst: new Float32Array(n * 16), stride: 16 }, attrs: [{ src: attr, dst: new Float32Array(n * 4), stride: 4 }] };
}
function kept(points: ([number, number] | [number, number, number])[], pose: CullPose): number[] {
  const f = field(points);
  const planes = new Float32Array(20);
  cullPlanes(pose, planes);
  const k = cullPrefix(planes, f.n, f.matrix, f.attrs);
  // The matrix prefix carries the same instances as the attribute prefix.
  for (let j = 0; j < k; j++) {
    const i = f.attrs[0]!.dst[j * 4]!;
    expect(Array.from(f.matrix.dst.subarray(j * 16, j * 16 + 16))).toEqual(Array.from(f.matrix.src.subarray(i * 16, i * 16 + 16)));
  }
  return Array.from(f.attrs[0]!.dst.subarray(0, k * 4)).filter((_, j) => j % 4 === 0);
}

describe("grass cull", () => {
  it("pins the margins and thresholds", () => {
    expect(CULL_MARGIN).toBeCloseTo(0.0872665, 7);
    expect([CULL_PUSHBACK, CULL_RADIUS, CULL_MOVE]).toEqual([1, 0.75, 0.5]);
    expect(CULL_TURN).toBeCloseTo(0.0698132, 7);
  });

  it("keeps what the widened frustum holds, in order", () => {
    // Yaw 0 faces +Z. The portrait still's half-width is 26.49°, 31.49° widened,
    // from an apex 1 m behind the eye.
    const pts: ([number, number] | [number, number, number])[] = [
      [0, 10],                                   // ahead: kept
      [10 * Math.tan((30 * Math.PI) / 180), 10], // inside the widened edge: kept
      [10 * Math.tan((40 * Math.PI) / 180), 10], // 1.41 m past it: dropped
      [0, 1.6, -1.5],                            // behind the eye at its height, inside the pushback: kept
      [0, 1.6, -2.5],                            // behind the pushback by more than the radius: dropped
      [0, -10],                                  // behind: dropped
      [-2, 20],                                  // ahead: kept
      [0, -0.5],                                 // at the feet, 73° below a level gaze: dropped
    ];
    expect(kept(pts, POSE)).toEqual([0, 1, 3, 6]);
    // Looking down at the feet, the same point is kept.
    expect(kept([[0, -0.5]], { ...POSE, pitch: 0.9 })).toEqual([0]);
  });

  it("keeps everything against all-zero planes", () => {
    const f = field([[0, 10], [0, -10], [100, 100]]);
    expect(cullPrefix(new Float32Array(20), f.n, f.matrix, f.attrs)).toBe(3);
  });

  it("is a pure function of the pose and the collected set", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 400; i++) pts.push([Math.sin(i * 12.9898) * 30, Math.cos(i * 78.233) * 30]);
    const a = kept(pts, POSE);
    kept(pts, { ...POSE, yaw: 2 }); // another pose in between changes nothing
    expect(kept(pts, POSE)).toEqual(a);
    expect(a.length).toBe(58);
  });

  it("never drops an instance the camera can see within the thresholds", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 2000; i++) pts.push([Math.sin(i * 12.9898) * 25, Math.cos(i * 78.233) * 25]);
    let checked = 0;
    for (const base of [POSE, { ...POSE, yaw: 1.571, pitch: 0.3 }, { ...POSE, yaw: 3, pitch: 0.9, aspect: 16 / 9 }, { ...POSE, yaw: -2, pitch: -0.6, aspect: 16 / 9 }]) {
      const keep = new Set(kept(pts, base));
      for (const [dyaw, dpitch, dx, dz] of [[0.0698, 0, 0, 0], [-0.0698, 0.0698, 0, 0], [0.0698, -0.0698, 0, 0], [0, 0, 0.5, 0], [0.05, -0.05, -0.35, 0.35], [-0.0698, -0.0698, 0.35, -0.35]]) {
        const view = { x: base.x + dx!, y: base.y, z: base.z + dz!, yaw: base.yaw + dyaw!, pitch: base.pitch + dpitch!, fov: base.fov, aspect: base.aspect };
        pts.forEach(([x, z], i) => {
          if (inCone(view, x, 0, z, 0) || inCone(view, x, 0.8, z, 0)) {
            expect(keep.has(i)).toBe(true);
            checked++;
          }
        });
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 20_000);

  it("refilters past a threshold, not below", () => {
    expect(needsCull(null, POSE)).toBe(true);
    expect(needsCull(POSE, { ...POSE })).toBe(false);
    expect(needsCull(POSE, { ...POSE, yaw: 0.05 })).toBe(false);
    expect(needsCull(POSE, { ...POSE, yaw: 0.08 })).toBe(true);
    expect(needsCull(POSE, { ...POSE, pitch: -0.08 })).toBe(true);
    expect(needsCull(POSE, { ...POSE, x: 0.4 })).toBe(false);
    expect(needsCull(POSE, { ...POSE, x: 0.4, z: 0.4 })).toBe(true);
    // A turn across the ±π seam is the small turn it is.
    expect(needsCull({ ...POSE, yaw: 3.13 }, { ...POSE, yaw: -3.13 })).toBe(false);
    // A resized window or a changed field of view reshapes the frustum itself.
    expect(needsCull(POSE, { ...POSE, aspect: 16 / 9 })).toBe(true);
    expect(needsCull(POSE, { ...POSE, fov: 1.2 })).toBe(true);
  });
});
