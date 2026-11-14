import { describe, expect, it } from "vitest";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import {
  composeInto, quatAboutAxis, quatFromEuler, quatFromUnitVectors, quatMultiply, transformPoint, type Quat,
} from "../../src/game/instancePose.js";

const fresh = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
const parts = (q: { x: number; y: number; z: number; w: number }): number[] => [q.x, q.y, q.z, q.w];
/** Angles and offsets over a spread of signs and sizes, none of them round. */
const SPREAD = [-7.3, -2.11, -0.4, 0, 0.013, 0.9, 1.5707963267948966, 3.3, 11.9];

describe("an instance's pose with no engine", () => {
  it("turns about an axis, from Euler angles and between unit vectors as Babylon's quaternions do, bit for bit", () => {
    for (const a of SPREAD) {
      const axis = new Vector3(0.3 + a, 1, -0.2 * a);
      expect(parts(quatAboutAxis(axis, a, fresh()))).toEqual(parts(Quaternion.RotationAxisToRef(axis, a, new Quaternion())));
      for (const b of SPREAD) {
        expect(parts(quatFromEuler(a, b, a - b, fresh()))).toEqual(parts(Quaternion.FromEulerAnglesToRef(a, b, a - b, new Quaternion())));
        const from = new Vector3(a, 1, b).normalize();
        const to = new Vector3(-b, 1 + a * a, 0.5).normalize();
        expect(parts(quatFromUnitVectors(from, to, fresh()))).toEqual(parts(Quaternion.FromUnitVectorsToRef(from, to, new Quaternion())));
      }
    }
  });

  it("turns between opposed unit vectors by the half turn Babylon picks", () => {
    for (const from of [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
      const to = from.scale(-1);
      expect(parts(quatFromUnitVectors(from, to, fresh()))).toEqual(parts(Quaternion.FromUnitVectorsToRef(from, to, new Quaternion())));
    }
  });

  it("multiplies as the Hamilton product, into either operand", () => {
    const a = Quaternion.FromEulerAngles(0.3, -1.2, 2.2);
    const b = Quaternion.FromEulerAngles(-0.7, 0.4, 0.05);
    const want = parts(a.multiplyToRef(b, new Quaternion()));
    expect(parts(quatMultiply(a, b, fresh()))).toEqual(want);
    const left = { x: a.x, y: a.y, z: a.z, w: a.w };
    expect(parts(quatMultiply(left, b, left))).toEqual(want);
    const right = { x: b.x, y: b.y, z: b.z, w: b.w };
    expect(parts(quatMultiply(a, right, right))).toEqual(want);
  });

  it("composes scale, turn and place into the sixteen floats Babylon's matrix holds, at any offset", () => {
    const out = new Float32Array(48);
    SPREAD.forEach((a, i) => {
      const q = Quaternion.FromEulerAngles(a, 2 * a - 1, 0.5 - a);
      const scale = new Vector3(1.5 + i, 0.25 * (i + 1), -(2 + i));
      const place = new Vector3(100.5 * a, -3 + a, 7777.125 - a);
      const want = Matrix.Compose(scale, q, place);
      out.fill(9);
      composeInto(out, 16, scale.x, scale.y, scale.z, q, place.x, place.y, place.z);
      expect([...out.subarray(16, 32)]).toEqual([...want.m]);
      // Nothing beside its sixteen floats is written.
      expect([...out.subarray(0, 16), ...out.subarray(32)].every((v) => v === 9)).toBe(true);
    });
  });

  it("carries a point by a matrix as Babylon transforms coordinates", () => {
    const m = Matrix.Compose(new Vector3(2, 3, -4), Quaternion.FromEulerAngles(0.4, 1.1, -0.6), new Vector3(10, -20, 30));
    const floats = new Float32Array(32);
    floats.set(m.m, 16);
    for (const a of SPREAD) {
      const want = Vector3.TransformCoordinates(new Vector3(a, 1 - a, 2 * a), m);
      const got = transformPoint(floats, 16, a, 1 - a, 2 * a, { x: 0, y: 0, z: 0 });
      expect([got.x, got.y, got.z]).toEqual([want.x, want.y, want.z]);
    }
  });
});
