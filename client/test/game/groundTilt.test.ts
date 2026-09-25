import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { groundNormalTilt, groundNormalY, seatOnGround, seatOnGroundCapped } from "../../src/game/groundTilt.js";

const UP = new Vector3(0, 1, 0);

function applied(q: Quaternion, v: Vector3): Vector3 {
  const out = new Vector3();
  v.applyRotationQuaternionToRef(q, out);
  return out;
}

describe("groundNormalTilt", () => {
  it("carries world up onto the ground normal", () => {
    const q = new Quaternion();
    groundNormalTilt(0.3, -0.4, q);
    const inv = 1 / Math.sqrt(1 + 0.3 * 0.3 + 0.4 * 0.4);
    const got = applied(q, UP);
    expect(got.x).toBeCloseTo(-0.3 * inv, 6);
    expect(got.y).toBeCloseTo(inv, 6);
    expect(got.z).toBeCloseTo(0.4 * inv, 6);
  });

  it("is the identity on flat ground", () => {
    const q = new Quaternion();
    groundNormalTilt(0, 0, q);
    const got = applied(q, new Vector3(1, 2, 3));
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
      const q = new Quaternion();
      groundNormalTilt(dx as number, dz as number, q);
      for (let i = 0; i < 16; i++) {
        const th = (i / 16) * Math.PI * 2;
        const p = applied(q, new Vector3(Math.cos(th) * 2.4, 0, Math.sin(th) * 2.4));
        expect(p.y).toBeCloseTo((dx as number) * p.x + (dz as number) * p.z, 6);
      }
    }
  });
});

describe("seatOnGround", () => {
  it("applies the yaw first, then the tilt", () => {
    const yaw = 0.9;
    const q = new Quaternion();
    seatOnGround(yaw, 0.3, -0.4, q);
    // Yawing model +X about world Y by `yaw` lands it on (cos, -sin) in xz —
    // the convention forestMeshes' log ends already rely on. The tilt then
    // takes that vector off the horizontal plane, so its xz DIRECTION is
    // unchanged in sign pattern while y picks up the plane term.
    const got = applied(q, new Vector3(1, 0, 0));
    expect(got.y).toBeCloseTo(0.3 * got.x + -0.4 * got.z, 6);
    const flat = new Quaternion();
    seatOnGround(yaw, 0, 0, flat);
    const flatGot = applied(flat, new Vector3(1, 0, 0));
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
      const capped = new Quaternion();
      const plain = new Quaternion();
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
      const capped = new Quaternion();
      seatOnGroundCapped(0.9, dx as number, dz as number, 0, capped);
      const got = applied(capped, new Vector3(1, 0, 0));
      expect(got.x).toBeCloseTo(Math.cos(0.9), 9);
      expect(got.y).toBeCloseTo(0, 9);
      expect(got.z).toBeCloseTo(-Math.sin(0.9), 9);
    }
  });

  it("leans by exactly the cap on ground steeper than it, in the plane of up and the normal", () => {
    // A 45° gradient: acos(ny) is 0.7854 rad, well past the 0.35 cap.
    const dx = 1, dz = 0;
    const q = new Quaternion();
    seatOnGroundCapped(0.9, dx, dz, 0.35, q);
    const up = applied(q, UP);
    expect(up.y).toBeCloseTo(Math.cos(0.35), 6);
    // The rotation axis is up × normal, so the tilted up keeps no component
    // along it: it stays in the plane the two span.
    const len = Math.hypot(dx, dz);
    const axis = new Vector3(-dz / len, 0, dx / len);
    expect(Vector3.Dot(up, axis)).toBeCloseTo(0, 9);
    // And it leans the way the ground falls: the normal's own xz direction.
    const inv = groundNormalY(dx, dz);
    const n = new Vector3(-dx * inv, inv, -dz * inv);
    expect(Vector3.Dot(up, n)).toBeCloseTo(Math.cos(Math.acos(inv) - 0.35), 6);
    // The yaw still runs first: model +X is yawed before the lean, so a point
    // on the model's own axis comes back where tilt·yaw puts it.
    const tilt = Quaternion.RotationAxis(axis, 0.35);
    const yaw = Quaternion.RotationAxis(UP, 0.9);
    const want = applied(tilt.multiply(yaw), new Vector3(1, 0, 0));
    const got = applied(q, new Vector3(1, 0, 0));
    expect(got.x).toBeCloseTo(want.x, 9);
    expect(got.y).toBeCloseTo(want.y, 9);
    expect(got.z).toBeCloseTo(want.z, 9);
  });

  it("leans by the slope itself where the slope is inside the cap", () => {
    const dx = 0.1, dz = -0.05;
    const q = new Quaternion();
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
