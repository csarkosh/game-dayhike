import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sweepBox, raycast, raycastBox, expand, depenetrate } from "../../src/sim/collision.js";
import type { Aabb } from "../../src/sim/level.js";

const floor: Aabb = { min: { x: -10, y: -1, z: -10 }, max: { x: 10, y: 0, z: 10 } };
const wall: Aabb = { min: { x: 2, y: 0, z: -10 }, max: { x: 3, y: 5, z: 10 } };
const half = { x: 0.5, y: 1, z: 0.5 };

describe("expand", () => {
  it("grows a box by the mover half-extents on both sides", () => {
    const e = expand({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, half);
    expect(e.min).toEqual({ x: -0.5, y: -1, z: -0.5 });
    expect(e.max).toEqual({ x: 1.5, y: 2, z: 1.5 });
  });
});

describe("sweepBox", () => {
  it("returns null when the path is clear", () => {
    const hit = sweepBox({ x: 0, y: 5, z: 0 }, half, { x: 0, y: 0, z: 1 }, [wall]);
    expect(hit).toBeNull();
  });

  it("stops a rightward move at the wall face", () => {
    // Centre starts at x=0, half-width 0.5, wall face at x=2.
    // Contact happens when centre reaches x=1.5, so t = 1.5/3 = 0.5.
    const hit = sweepBox({ x: 0, y: 2, z: 0 }, half, { x: 3, y: 0, z: 0 }, [wall]);
    expect(hit).not.toBeNull();
    expect(hit?.t).toBeCloseTo(0.5, 6);
    expect(hit?.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it("reports an upward normal when landing on a floor", () => {
    // Centre at y=3 with half-height 1; floor top at y=0 means contact at y=1.
    const hit = sweepBox({ x: 0, y: 3, z: 0 }, half, { x: 0, y: -4, z: 0 }, [floor]);
    expect(hit).not.toBeNull();
    expect(hit?.t).toBeCloseTo(0.5, 6);
    expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("returns the nearest of several candidate boxes", () => {
    const near: Aabb = { min: { x: 1, y: 0, z: -1 }, max: { x: 1.2, y: 3, z: 1 } };
    const hit = sweepBox({ x: 0, y: 1, z: 0 }, half, { x: 5, y: 0, z: 0 }, [wall, near]);
    expect(hit?.t).toBeCloseTo((1 - 0.5) / 5, 6);
  });

  it("does not tunnel through a thin wall at high speed", () => {
    const thin: Aabb = { min: { x: 4, y: 0, z: -5 }, max: { x: 4.05, y: 5, z: 5 } };
    const hit = sweepBox({ x: 0, y: 2, z: 0 }, half, { x: 100, y: 0, z: 0 }, [thin]);
    expect(hit).not.toBeNull();
    expect(hit?.t).toBeCloseTo(3.5 / 100, 6);
  });

  it("ignores boxes already behind the mover", () => {
    const hit = sweepBox({ x: 6, y: 2, z: 0 }, half, { x: 3, y: 0, z: 0 }, [wall]);
    expect(hit).toBeNull();
  });

  it("returns null for a zero-length move", () => {
    expect(sweepBox({ x: 0, y: 2, z: 0 }, half, { x: 0, y: 0, z: 0 }, [wall])).toBeNull();
  });

  // Regression guard. A mover resting exactly on a surface is the degenerate
  // case where the slab entry time equals the initial tMin. If this returns
  // null, players fall through whatever they are standing on.
  it("still detects the floor when resting exactly on it", () => {
    const restingY = floor.max.y + half.y; // exactly touching, zero gap
    const hit = sweepBox({ x: 0, y: restingY, z: 0 }, half, { x: 0, y: -0.0067, z: 0 }, [floor]);
    expect(hit).not.toBeNull();
    expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(hit?.t).toBeLessThanOrEqual(0);
  });

  it("does not report a hit when resting on a surface and moving away from it", () => {
    const restingY = floor.max.y + half.y;
    expect(sweepBox({ x: 0, y: restingY, z: 0 }, half, { x: 0, y: 0.5, z: 0 }, [floor])).toBeNull();
  });
});

describe("depenetrate", () => {
  it("leaves a clear mover untouched", () => {
    const p = { x: 0, y: 5, z: 0 };
    expect(depenetrate(p, half, [floor, wall])).toEqual(p);
  });

  it("treats exactly touching as resting, not penetrating", () => {
    const p = { x: 0, y: floor.max.y + half.y, z: 0 };
    expect(depenetrate(p, half, [floor])).toEqual(p);
  });

  // The case that matters: snapshot positions are quantized to 1/128 m, which
  // routinely lands a reconciling client a couple of millimetres below the
  // surface it is standing on. A penetrating mover gets no collision at all,
  // so it can never become grounded and silently switches to air control.
  it("lifts a mover that quantization pushed just below the floor", () => {
    const restingY = floor.max.y + half.y;
    const sunk = { x: 0, y: restingY - 0.0026, z: 0 };
    const fixed = depenetrate(sunk, half, [floor]);
    expect(fixed.y).toBeCloseTo(restingY, 9);
    expect(fixed.x).toBe(sunk.x);
    expect(fixed.z).toBe(sunk.z);
  });

  it("pushes out along the axis of least penetration", () => {
    // Deep in y, barely inside on x: must resolve on x.
    const e = { x: 2 - half.x + 0.001, y: 2, z: 0 };
    const fixed = depenetrate(e, half, [wall]);
    expect(fixed.x).toBeCloseTo(2 - half.x, 9);
    expect(fixed.y).toBe(e.y);
  });

  it("resolves overlap against several boxes", () => {
    const restingY = floor.max.y + half.y;
    const sunk = { x: 0, y: restingY - 0.002, z: 0 };
    const fixed = depenetrate(sunk, half, [wall, floor]);
    expect(fixed.y).toBeCloseTo(restingY, 9);
  });

  it("is deterministic for a given box order", () => {
    const sunk = { x: 0, y: floor.max.y + half.y - 0.003, z: 0 };
    expect(depenetrate(sunk, half, [floor, wall])).toEqual(depenetrate(sunk, half, [floor, wall]));
  });
});

describe("raycast", () => {
  it("finds the distance to a box straight ahead", () => {
    const d = raycastBox({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 10, wall);
    expect(d).toBeCloseTo(2, 6);
  });

  it("returns null past max distance", () => {
    expect(raycastBox({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 1, wall)).toBeNull();
  });

  it("returns the nearest hit across many boxes", () => {
    const d = raycast({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 50, [wall, floor]);
    expect(d).toBeCloseTo(2, 6);
  });

  it("returns null when nothing is hit", () => {
    expect(raycast({ x: 0, y: 20, z: 0 }, { x: 0, y: 1, z: 0 }, 50, [wall, floor])).toBeNull();
  });
});

describe("no tunnelling", () => {
  it("always detects a wall crossed by the displacement, at any speed", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: 0.01, max: 2, noNaN: true }),
        (speed, thickness) => {
          const barrier: Aabb = {
            min: { x: 5, y: -5, z: -20 },
            max: { x: 5 + thickness, y: 5, z: 20 },
          };
          const start = { x: 0, y: 0, z: 0 };
          const delta = { x: speed, y: 0, z: 0 };
          const hit = sweepBox(start, half, delta, [barrier]);
          const contactX = 5 - half.x;
          if (contactX <= speed) {
            expect(hit).not.toBeNull();
            expect((hit as { t: number }).t).toBeCloseTo(contactX / speed, 6);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
