import { describe, expect, it } from "vitest";
import {
  CULL_MARGIN, CULL_MOVE, CULL_PUSHBACK, CULL_RADIUS, CULL_TURN,
  cullInvalidate, cullPlanes, cullPrefix, cullSet, needsCull, type CullPose,
} from "../../src/game/grassCull.js";
import { inCone } from "../../src/game/wildlifeDirector.js";
import { CLUTTER_CULLED } from "../../src/game/clutterMeshes.js";
import { bladeReach, cardReach, CULLED_MODELS, seen, WIND_FRACTION } from "./helpers/cullReach.js";

const POSE: CullPose = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, fov: 1.4, aspect: 1200 / 2029 };

/** n instances: translations at (x, y, z) (y 0 when a point gives two
 * coordinates) in the matrix and the origins, a vec4 stream holding the index
 * and a scalar stream holding it again. */
function field(points: ([number, number] | [number, number, number])[]) {
  const n = points.length;
  const cap = n + (n % 2);
  const src = new Float32Array(cap * 16), origins = new Float32Array(cap * 3), vec = new Float32Array(cap * 4), one = new Float32Array(cap);
  points.forEach((p, i) => {
    const y = p.length === 3 ? p[1] : 0, z = p.length === 3 ? p[2] : p[1];
    src[i * 16] = src[i * 16 + 5] = src[i * 16 + 10] = src[i * 16 + 15] = 1;
    src[i * 16 + 12] = origins[i * 3] = p[0];
    src[i * 16 + 13] = origins[i * 3 + 1] = y;
    src[i * 16 + 14] = origins[i * 3 + 2] = z;
    vec[i * 4] = i;
    vec[i * 4 + 1] = -i;
    one[i] = i + 0.5;
  });
  const dst = new Float32Array(cap * 16), vecDst = new Float32Array(cap * 4), oneDst = new Float32Array(cap);
  const set = cullSet(cap, origins, { src, dst }, [{ src: vec, dst: vecDst }], [{ src: one, dst: oneDst }]);
  return { n, set, src, dst, vec, vecDst, one, oneDst };
}
function kept(points: ([number, number] | [number, number, number])[], pose: CullPose): number[] {
  const f = field(points);
  const planes = new Float32Array(20);
  cullPlanes(pose, planes);
  expect(cullPrefix(planes, f.n, f.set)).toBe(true);
  const k = f.set.kept;
  // Every stream's prefix carries the same instances, in order.
  for (let j = 0; j < k; j++) {
    const i = f.vecDst[j * 4]!;
    expect(Array.from(f.dst.subarray(j * 16, j * 16 + 16))).toEqual(Array.from(f.src.subarray(i * 16, i * 16 + 16)));
    expect(Array.from(f.vecDst.subarray(j * 4, j * 4 + 4))).toEqual(Array.from(f.vec.subarray(i * 4, i * 4 + 4)));
    expect(f.oneDst[j]).toBe(i + 0.5);
  }
  return Array.from(f.vecDst.subarray(0, k * 4)).filter((_, j) => j % 4 === 0);
}

describe("grass cull", () => {
  it("pins the margins and thresholds", () => {
    expect(CULL_MARGIN).toBeCloseTo(0.1047198, 7);
    expect([CULL_PUSHBACK, CULL_RADIUS, CULL_MOVE]).toEqual([1, 1.5, 0.5]);
    expect(CULL_TURN).toBeCloseTo(0.0698132, 7);
  });

  it("keeps what the widened frustum holds, in order", () => {
    // Yaw 0 faces +Z. The portrait still's half-width is 26.49°, 32.49° widened,
    // from an apex 1 m behind the eye, with a 1.5 m radius.
    const pts: ([number, number] | [number, number, number])[] = [
      [0, 10],                                   // ahead: kept
      [10 * Math.tan((30 * Math.PI) / 180), 10], // inside the widened edge: kept
      [10, 10],                                  // 45° out, 2.53 m past the widened edge: dropped
      [0, 1.6, -1.5],                            // behind the eye at its height, inside the pushback: kept
      [0, 1.6, -3],                              // 2 m behind the apex: dropped
      [0, -10],                                  // behind: dropped
      [-2, 20],                                  // ahead: kept
      [0, -4, 0],                                // 5.6 m straight down from a level gaze: dropped
    ];
    expect(kept(pts, POSE)).toEqual([0, 1, 3, 6]);
    // Looking steeply down, the point below is kept.
    expect(kept([[0, -4, 0]], { ...POSE, pitch: 1.2 })).toEqual([0]);
  });

  it("keeps everything against all-zero planes", () => {
    const f = field([[0, 10], [0, -10], [100, 100]]);
    expect(cullPrefix(new Float32Array(20), f.n, f.set)).toBe(true);
    expect(f.set.kept).toBe(3);
  });

  it("copies every kept float bit for bit, the odd ones included", () => {
    // Pairs of float32 move as one float64 word: -0, a subnormal, the largest
    // float, both infinities and the canonical NaN, in every slot of a pair.
    const special = [-0, 1e-40, -1e-40, 3.4028234663852886e38, Infinity, -Infinity, NaN, 1.5, -2.25];
    const f = field([[0, 10], [1, 12], [0, -10], [-1, 14]]);
    // The cut reads the origins, so every stream can hold anything.
    let s = 0;
    for (const a of [f.src, f.vec, f.one]) for (let i = 0; i < a.length; i++) a[i] = special[s++ % special.length]!;
    const planes = new Float32Array(20);
    cullPlanes(POSE, planes);
    expect(cullPrefix(planes, f.n, f.set)).toBe(true);
    const keptIdx = [0, 1, 3];
    expect(f.set.kept).toBe(3);
    const bits = (a: Float32Array, from: number, to: number) => Array.from(new Uint32Array(a.buffer, a.byteOffset + from * 4, to - from));
    keptIdx.forEach((i, j) => {
      expect(bits(f.dst, j * 16, j * 16 + 16)).toEqual(bits(f.src, i * 16, i * 16 + 16));
      expect(bits(f.vecDst, j * 4, j * 4 + 4)).toEqual(bits(f.vec, i * 4, i * 4 + 4));
      expect(bits(f.oneDst, j, j + 1)).toEqual(bits(f.one, i, i + 1));
    });
  });

  it("leaves the drawn buffers alone when a cut keeps exactly the last cut's instances", () => {
    const pts: [number, number][] = [[0, 10], [3, 10], [10, 10], [0, -10], [-2, 20]];
    const f = field(pts);
    const planes = new Float32Array(20);
    cullPlanes(POSE, planes);
    expect(cullPrefix(planes, f.n, f.set)).toBe(true);
    expect(f.set.kept).toBe(3);
    // Mark the drawn buffers: an unchanged cut must not write them.
    f.dst[0] = 99;
    expect(cullPrefix(planes, f.n, f.set)).toBe(false);
    // A slightly turned view that keeps the same three: still nothing to do.
    cullPlanes({ ...POSE, yaw: 0.02 }, planes);
    expect(cullPrefix(planes, f.n, f.set)).toBe(false);
    expect(f.dst[0]).toBe(99);
    expect(f.set.kept).toBe(3);
    // A view that keeps others, then the first view again: cut each time.
    cullPlanes({ ...POSE, yaw: 0.9 }, planes);
    expect(cullPrefix(planes, f.n, f.set)).toBe(true);
    expect(f.set.kept).toBe(2);
    cullPlanes(POSE, planes);
    expect(cullPrefix(planes, f.n, f.set)).toBe(true);
    expect(f.dst[0]).toBe(1);
    // After the collected buffers change, the same cut is a new one.
    cullInvalidate(f.set);
    expect(cullPrefix(planes, f.n, f.set)).toBe(true);
    expect(f.set.kept).toBe(3);
  });

  it("is a pure function of the pose and the collected set", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 400; i++) pts.push([Math.sin(i * 12.9898) * 30, Math.cos(i * 78.233) * 30]);
    const a = kept(pts, POSE);
    kept(pts, { ...POSE, yaw: 2 }); // another pose in between changes nothing
    expect(kept(pts, POSE)).toEqual(a);
    expect(a.length).toBe(68);
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

describe("the cull radius", () => {
  it("covers the furthest any culled instance reaches from its translation", () => {
    expect([...CLUTTER_CULLED].every((cls) => CULLED_MODELS.has(cls))).toBe(true);
    const card = cardReach(), blade = bladeReach();
    expect(WIND_FRACTION).toBeCloseTo(0.7581, 4);
    expect(card.horiz).toBeCloseTo(1.2392, 3);
    expect(card.top).toBeCloseTo(0.5957, 3);
    expect(blade.horiz).toBeCloseTo(1.2955, 3);
    expect(blade.top).toBeCloseTo(0.4993, 3);
    expect(Math.hypot(card.horiz, card.top)).toBeLessThanOrEqual(CULL_RADIUS);
    expect(Math.hypot(blade.horiz, blade.top)).toBeLessThanOrEqual(CULL_RADIUS);
  });
});

describe("the widened frustum against what a moved camera sees", () => {
  it("keeps every instance with any part in view on the ground, after any turn, roll and move under the thresholds, out to 110 m", () => {
    const EPS = 1e-4;
    const turn = CULL_TURN - EPS, move = CULL_MOVE - 0.01, roll = (0.6 * Math.PI) / 180;
    const planes = new Float32Array(20);
    let checked = 0, dropped = 0, worst = 0;
    for (const reach of [cardReach(), bladeReach()]) {
      // An instance whose extent holds the visible point p: its origin is p
      // less a reach sideways in any of 16 directions, at the root or the top.
      const offsets: [number, number, number][] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        for (const h of [0, reach.top]) offsets.push([-reach.horiz * Math.cos(a), -h, -reach.horiz * Math.sin(a)]);
      }
      for (const aspect of [1200 / 2029, 16 / 9]) {
        for (let pi = -8; pi <= 12; pi++) {
          for (const yaw of [0.3, 2.2]) {
            const base: CullPose = { x: 0, y: 1.6, z: 0, yaw, pitch: pi / 10, fov: 1.4, aspect };
            cullPlanes(base, planes);
            for (const [dyaw, dpitch, rl, mx, mz] of [
              [turn, turn, roll, 0, 0], [turn, -turn, -roll, 0, 0], [-turn, turn, -roll, 0, 0], [-turn, -turn, roll, 0, 0],
              [turn, turn, roll, move, 0], [-turn, -turn, -roll, -move, 0], [turn, -turn, roll, 0, move], [-turn, turn, -roll, 0, -move],
              [0, 0, roll, move * Math.SQRT1_2, move * Math.SQRT1_2],
            ] as const) {
              const view = { ...base, x: mx, z: mz, yaw: yaw + dyaw, pitch: base.pitch + dpitch, roll: rl };
              expect(needsCull(base, view)).toBe(false);
              // Points on the four edges of the view's true frustum, at depths out to 110 m.
              const sy = Math.sin(view.yaw), cy = Math.cos(view.yaw), sp = Math.sin(view.pitch), cp = Math.cos(view.pitch);
              const sr = Math.sin(rl), cr = Math.cos(rl);
              const f = [sy * cp, -sp, cy * cp], r0 = [cy, 0, -sy], u0 = [sy * sp, cp, cy * sp];
              const r = r0.map((v, i) => v * cr + u0[i]! * sr), u = u0.map((v, i) => v * cr - r0[i]! * sr);
              const ty = Math.tan(view.fov / 2), tx = ty * view.aspect;
              // Points on the four edges of the view's true frustum where they
              // meet the ground 1.6 m under the eye, flat or sloping by a
              // quarter up or down, or 0.6 m above it, out to 110 m.
              for (let e = 0; e < 4; e++) {
                for (let s = 0; s <= 16; s++) {
                  const t = -1 + s / 8;
                  const [a, b] = e === 0 ? [tx, t * ty] : e === 1 ? [-tx, t * ty] : e === 2 ? [t * tx, ty] : [t * tx, -ty];
                  // A hair inside the edge, so the point is in view to rounding.
                  const dir = f.map((v, i) => v + 0.9999 * (a * r[i]! + b * u[i]!));
                  const hxz = Math.hypot(dir[0]!, dir[2]!);
                  for (const slope of [-0.25, 0, 0.25]) {
                    for (const lift of [0, 0.6]) {
                      const along = (lift - view.y) / (dir[1]! - slope * hxz);
                      if (!(along > 0.1) || along * hxz > 110) continue;
                      const p = [view.x + dir[0]! * along, view.y + dir[1]! * along, view.z + dir[2]! * along];
                      expect(seen(view, p[0]!, p[1]!, p[2]!)).toBe(true);
                      for (const [ox, oy, oz] of offsets) {
                        const x = p[0]! + ox, y = p[1]! + oy, z = p[2]! + oz;
                        let d = Infinity;
                        for (let q = 0; q < 20; q += 4) d = Math.min(d, planes[q]! * x + planes[q + 1]! * y + planes[q + 2]! * z + planes[q + 3]!);
                        checked++;
                        if (d < -CULL_RADIUS) { dropped++; worst = Math.max(worst, -d - CULL_RADIUS); }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500_000);
    expect({ dropped, worst: Number(worst.toFixed(2)) }).toEqual({ dropped: 0, worst: 0 });
  }, 60_000);
});
