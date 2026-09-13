import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { groundNormalTilt, groundNormalY, seatOnGround } from "../../src/game/groundTilt.js";

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

describe("groundNormalY", () => {
  it("is the normal's y component", () => {
    expect(groundNormalY(0, 0)).toBe(1);
    expect(groundNormalY(0.3, -0.4)).toBeCloseTo(1 / Math.sqrt(1.25), 12);
  });
});
