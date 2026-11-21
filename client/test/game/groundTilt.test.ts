import { describe, expect, it } from "vitest";
import { groundNormalTilt, groundNormalY, seatOnGround, seatOnGroundCapped } from "@csarkosh/engine/game/groundTilt";
import { babylonValues } from "../helpers/babylonFixture.js";
import { dot, turned, type Quat, type Vec } from "../helpers/ruler.js";

const vec = (x: number, y: number, z: number): Vec => ({ x, y, z });
/** A quaternion to write a rotation into: no turn, as a new one of Babylon.js's is. */
const quat = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
const UP = vec(0, 1, 0);

/** `v` turned by `q`, by the tests' ruler, which the first test below holds to Babylon.js's. */
const applied = turned;

/**
 * What Babylon.js's `Quaternion` and `Vector3` gave as these tests' ruler, recorded: every vector the tests below
 * turn by a quaternion (`q` as `groundTilt.ts` wrote it, `v`, and `out`, what `applyRotationQuaternionToRef` made
 * of them), their two dot products, and the one turn Babylon.js composed itself: a lean of 0.35 about the axis
 * `Quaternion.RotationAxis` was given, times a yaw of 0.9 about up, and +X turned by the product (`want`).
 */
const BABYLON = babylonValues<{
  turned: { q: number[]; v: number[]; out: number[] }[];
  dots: { a: number[]; b: number[]; out: number }[];
  composed: { axis: number[]; lean: number; yaw: number; point: number[]; want: number[] };
}>("numbers/groundTilt.json");

describe("the ruler these tests measure with", () => {
  it("turns a vector by a quaternion and takes a dot product as Babylon.js did for every case below, bit for bit", () => {
    // One turn for each of the first two cases, 4 x 16 for the disc, 2 for the yaw, 7 with no cap, 3 and 1 for the leans.
    expect([BABYLON.turned.length, BABYLON.dots.length]).toEqual([1 + 1 + 64 + 2 + 7 + 3 + 1, 2]);
    let same = 0;
    for (const { q, v, out } of BABYLON.turned) {
      const got = turned({ x: q[0] as number, y: q[1] as number, z: q[2] as number, w: q[3] as number }, vec(v[0] as number, v[1] as number, v[2] as number));
      if (Object.is(got.x, out[0]) && Object.is(got.y, out[1]) && Object.is(got.z, out[2])) same++;
    }
    expect(same).toBe(BABYLON.turned.length);
    for (const { a, b, out } of BABYLON.dots) {
      expect(Object.is(dot(vec(a[0] as number, a[1] as number, a[2] as number), vec(b[0] as number, b[1] as number, b[2] as number)), out)).toBe(true);
    }
    // Neither is a ruler that agrees because nothing turns: the recorded turns move their vectors.
    const moved = BABYLON.turned.filter(({ v, out }) => Math.hypot((out[0] as number) - (v[0] as number), (out[1] as number) - (v[1] as number), (out[2] as number) - (v[2] as number)) > 0.01);
    expect(moved.length).toBeGreaterThan(70);
  });
});

describe("groundNormalTilt", () => {
  it("carries world up onto the ground normal", () => {
    const q = quat();
    groundNormalTilt(0.3, -0.4, q);
    const inv = 1 / Math.sqrt(1 + 0.3 * 0.3 + 0.4 * 0.4);
    const got = applied(q, UP);
    expect(got.x).toBeCloseTo(-0.3 * inv, 6);
    expect(got.y).toBeCloseTo(inv, 6);
    expect(got.z).toBeCloseTo(0.4 * inv, 6);
  });

  it("is the identity on flat ground", () => {
    const q = quat();
    groundNormalTilt(0, 0, q);
    const got = applied(q, vec(1, 2, 3));
    expect(got.x).toBeCloseTo(1, 6);
    expect(got.y).toBeCloseTo(2, 6);
    expect(got.z).toBeCloseTo(3, 6);
  });

  it("lays a flat disc exactly on the tangent plane, up to the steepest ground measured", () => {
    // A point p in the model's XZ plane lands, after the tilt, on the plane
    // through the origin perpendicular to n = (-dx, 1, -dz). That plane is
    // -dx·px + py - dz·pz = 0, i.e. py = dx·px + dz·pz — the local ground
    // plane itself. Asserting that for a ring of points IS the seating claim.
    for (const [dx, dz] of [[0.05, 0], [0.28, -0.12], [-0.5, 0.6], [0.61, 0.61]]) {
      const q = quat();
      groundNormalTilt(dx as number, dz as number, q);
      for (let i = 0; i < 16; i++) {
        const th = (i / 16) * Math.PI * 2;
        const p = applied(q, vec(Math.cos(th) * 2.4, 0, Math.sin(th) * 2.4));
        expect(p.y).toBeCloseTo((dx as number) * p.x + (dz as number) * p.z, 6);
      }
    }
  });
});

describe("seatOnGround", () => {
  it("applies the yaw first, then the tilt", () => {
    const yaw = 0.9;
    const q = quat();
    seatOnGround(yaw, 0.3, -0.4, q);
    // Yawing model +X about world Y by `yaw` lands it on (cos, -sin) in xz —
    // the convention forestMeshes' log ends already rely on. The tilt then
    // takes that vector off the horizontal plane, so its xz DIRECTION is
    // unchanged in sign pattern while y picks up the plane term.
    const got = applied(q, vec(1, 0, 0));
    expect(got.y).toBeCloseTo(0.3 * got.x + -0.4 * got.z, 6);
    const flat = quat();
    seatOnGround(yaw, 0, 0, flat);
    const flatGot = applied(flat, vec(1, 0, 0));
    expect(flatGot.x).toBeCloseTo(Math.cos(yaw), 6);
    expect(flatGot.z).toBeCloseTo(-Math.sin(yaw), 6);
  });
});

describe("seatOnGroundCapped", () => {
  const GRADIENTS: readonly (readonly [number, number])[] = [
    [0, 0], [0.05, 0], [0.28, -0.12], [-0.5, 0.6], [1, 0], [0.61, 0.61], [-1.4, 0.9],
  ];

  it("is the uncapped seating when the cap is wider than any slope", () => {
    for (const [dx, dz] of GRADIENTS) {
      const capped = quat();
      const plain = quat();
      seatOnGroundCapped(0.9, dx as number, dz as number, Math.PI, capped);
      seatOnGround(0.9, dx as number, dz as number, plain);
      expect(capped.x).toBeCloseTo(plain.x, 9);
      expect(capped.y).toBeCloseTo(plain.y, 9);
      expect(capped.z).toBeCloseTo(plain.z, 9);
      expect(capped.w).toBeCloseTo(plain.w, 9);
    }
  });

  it("is the plain yaw when the cap is zero", () => {
    for (const [dx, dz] of GRADIENTS) {
      const capped = quat();
      seatOnGroundCapped(0.9, dx as number, dz as number, 0, capped);
      const got = applied(capped, vec(1, 0, 0));
      expect(got.x).toBeCloseTo(Math.cos(0.9), 9);
      expect(got.y).toBeCloseTo(0, 9);
      expect(got.z).toBeCloseTo(-Math.sin(0.9), 9);
    }
  });

  it("leans by exactly the cap on ground steeper than it, in the plane of up and the normal", () => {
    // A 45° gradient: acos(ny) is 0.7854 rad, well past the 0.35 cap.
    const dx = 1, dz = 0;
    const q = quat();
    seatOnGroundCapped(0.9, dx, dz, 0.35, q);
    const up = applied(q, UP);
    expect(up.y).toBeCloseTo(Math.cos(0.35), 6);
    // The rotation axis is up × normal, so the tilted up keeps no component
    // along it: it stays in the plane the two span.
    const len = Math.hypot(dx, dz);
    const axis = vec(-dz / len, 0, dx / len);
    expect(dot(up, axis)).toBeCloseTo(0, 9);
    // And it leans the way the ground falls: the normal's own xz direction.
    const inv = groundNormalY(dx, dz);
    const n = vec(-dx * inv, inv, -dz * inv);
    expect(dot(up, n)).toBeCloseTo(Math.cos(Math.acos(inv) - 0.35), 6);
    // The yaw still runs first: model +X is yawed before the lean, so a point
    // on the model's own axis comes back where tilt·yaw puts it.
    // Babylon.js's own tilt·yaw, recorded: a lean of 0.35 about this axis times a yaw of 0.9 about up, and +X turned by it.
    const { composed } = BABYLON;
    expect([composed.axis, composed.lean, composed.yaw, composed.point]).toEqual([[axis.x, axis.y, axis.z], 0.35, 0.9, [1, 0, 0]]);
    const [wantX, wantY, wantZ] = composed.want as [number, number, number];
    const got = applied(q, vec(1, 0, 0));
    expect(got.x).toBeCloseTo(wantX, 9);
    expect(got.y).toBeCloseTo(wantY, 9);
    expect(got.z).toBeCloseTo(wantZ, 9);
  });

  it("leans by the slope itself where the slope is inside the cap", () => {
    const dx = 0.1, dz = -0.05;
    const q = quat();
    seatOnGroundCapped(0, dx, dz, 0.35, q);
    const up = applied(q, UP);
    const inv = groundNormalY(dx, dz);
    expect(Math.acos(inv)).toBeLessThan(0.35);
    expect(up.x).toBeCloseTo(-dx * inv, 6);
    expect(up.y).toBeCloseTo(inv, 6);
    expect(up.z).toBeCloseTo(-dz * inv, 6);
  });
});

describe("groundNormalY", () => {
  it("is the normal's y component", () => {
    expect(groundNormalY(0, 0)).toBe(1);
    expect(groundNormalY(0.3, -0.4)).toBeCloseTo(1 / Math.sqrt(1.25), 12);
  });
});
