import { describe, expect, it } from "vitest";
import {
  composeInto, quatAboutAxis, quatFromEuler, quatFromUnitVectors, quatMultiply, transformPoint, type Quat,
} from "../../src/game/instancePose.js";
import { babylonValues } from "../helpers/babylonFixture.js";

const fresh = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
const parts = (q: { x: number; y: number; z: number; w: number }): number[] => [q.x, q.y, q.z, q.w];
const quat = (q: readonly number[]): Quat => ({ x: q[0] as number, y: q[1] as number, z: q[2] as number, w: q[3] as number });
const vec = (v: readonly number[]): { x: number; y: number; z: number } => ({ x: v[0] as number, y: v[1] as number, z: v[2] as number });
/** Angles and offsets over a spread of signs and sizes, none of them round. */
const SPREAD = [-7.3, -2.11, -0.4, 0, 0.013, 0.9, 1.5707963267948966, 3.3, 11.9];
/**
 * What Babylon.js's quaternions, matrices and vectors gave over that spread, recorded: each case in the order the
 * tests below walk it, with the unit vectors and the quaternions Babylon.js itself made for a case's inputs.
 */
const BABYLON = babylonValues<{
  spread: number[];
  axis: number[][];
  euler: number[][];
  unit: { from: number[]; to: number[]; q: number[] }[];
  opposed: number[][];
  product: { a: number[]; b: number[]; want: number[] };
  compose: { q: number[]; want: number[] }[];
  point: { m: number[]; wants: number[][] };
}>("numbers/instancePose.json");

describe("an instance's pose with no engine", () => {
  it("is held to what Babylon.js gave for every case of the spread", () => {
    expect(BABYLON.spread).toEqual(SPREAD);
    expect([BABYLON.axis.length, BABYLON.euler.length, BABYLON.unit.length, BABYLON.opposed.length, BABYLON.compose.length, BABYLON.point.wants.length]).toEqual([9, 81, 81, 3, 9, 9]);
  });

  it("turns about an axis, from Euler angles and between unit vectors as Babylon's quaternions do, bit for bit", () => {
    let i = 0;
    let k = 0;
    for (const a of SPREAD) {
      const axis = { x: 0.3 + a, y: 1, z: -0.2 * a };
      expect(parts(quatAboutAxis(axis, a, fresh()))).toEqual(BABYLON.axis[i++]);
      for (const b of SPREAD) {
        expect(parts(quatFromEuler(a, b, a - b, fresh()))).toEqual(BABYLON.euler[k]);
        // The unit vectors as Babylon.js normalised (a, 1, b) and (-b, 1 + a * a, 0.5).
        const { from, to, q } = BABYLON.unit[k] as (typeof BABYLON.unit)[number];
        expect(Math.hypot(from[0] as number, from[1] as number, from[2] as number)).toBeCloseTo(1, 12);
        expect((from[0] as number) / (from[1] as number)).toBeCloseTo(a, 9);
        expect((to[0] as number) / (to[2] as number)).toBeCloseTo(-b / 0.5, 9);
        expect(parts(quatFromUnitVectors(vec(from), vec(to), fresh()))).toEqual(q);
        k++;
      }
    }
    expect([i, k]).toEqual([9, 81]);
  });

  it("turns between opposed unit vectors by the half turn Babylon picks", () => {
    for (const [i, from] of [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }].entries()) {
      const to = { x: from.x * -1, y: from.y * -1, z: from.z * -1 };
      expect(parts(quatFromUnitVectors(from, to, fresh()))).toEqual(BABYLON.opposed[i]);
    }
  });

  it("multiplies as the Hamilton product, into either operand", () => {
    const a = quat(BABYLON.product.a);
    const b = quat(BABYLON.product.b);
    const want = BABYLON.product.want;
    expect(parts(quatMultiply(a, b, fresh()))).toEqual(want);
    const left = { x: a.x, y: a.y, z: a.z, w: a.w };
    expect(parts(quatMultiply(left, b, left))).toEqual(want);
    const right = { x: b.x, y: b.y, z: b.z, w: b.w };
    expect(parts(quatMultiply(a, right, right))).toEqual(want);
  });

  it("composes scale, turn and place into the sixteen floats Babylon's matrix holds, at any offset", () => {
    const out = new Float32Array(48);
    SPREAD.forEach((a, i) => {
      const { q, want } = BABYLON.compose[i] as (typeof BABYLON.compose)[number];
      const scale = { x: 1.5 + i, y: 0.25 * (i + 1), z: -(2 + i) };
      const place = { x: 100.5 * a, y: -3 + a, z: 7777.125 - a };
      out.fill(9);
      composeInto(out, 16, scale.x, scale.y, scale.z, quat(q), place.x, place.y, place.z);
      expect([...out.subarray(16, 32)]).toEqual(want);
      // Nothing beside its sixteen floats is written.
      expect([...out.subarray(0, 16), ...out.subarray(32)].every((v) => v === 9)).toBe(true);
    });
  });

  it("carries a point by a matrix as Babylon transforms coordinates", () => {
    const floats = new Float32Array(32);
    floats.set(BABYLON.point.m, 16);
    for (const [i, a] of SPREAD.entries()) {
      const want = BABYLON.point.wants[i] as number[];
      const got = transformPoint(floats, 16, a, 1 - a, 2 * a, { x: 0, y: 0, z: 0 });
      expect([got.x, got.y, got.z]).toEqual(want);
    }
  });
});
