import { describe, expect, it } from "vitest";
import { pointBoxGap, pointSegmentGap, segmentBoxGap } from "../../src/sim/boxGap.js";

const unit = { x: 1, z: 1 };
const origin = { x: 0, z: 0 };

describe("pointBoxGap", () => {
  it("is 0 inside the box, the face's distance beside it, the corner's beyond it", () => {
    expect(pointBoxGap(0.5, 0.5, origin, unit)).toBe(0);
    expect(pointBoxGap(3, 0, origin, unit)).toBe(2);
    expect(pointBoxGap(3, 4, origin, unit)).toBeCloseTo(3.605551275463989, 12);
  });
});

describe("pointSegmentGap", () => {
  it("measures to the segment's line within its ends and to an end beyond them", () => {
    expect(pointSegmentGap(0, 3, { x: -1, z: 0 }, { x: 1, z: 0 })).toBe(3);
    expect(pointSegmentGap(4, 4, { x: -1, z: 0 }, { x: 1, z: 0 })).toBe(5);
  });

  it("treats a segment of no length as a point", () => {
    expect(pointSegmentGap(2, 2, origin, origin)).toBeCloseTo(2.8284271247461903, 12);
  });
});

describe("segmentBoxGap", () => {
  it("is 0 for a segment that crosses the box or lies inside it", () => {
    expect(segmentBoxGap({ x: -5, z: 0 }, { x: 5, z: 0.5 }, origin, unit)).toBe(0);
    expect(segmentBoxGap({ x: -0.2, z: 0 }, { x: 0.2, z: 0 }, origin, unit)).toBe(0);
  });

  it("measures from a face, from a corner, and from the segment's own end", () => {
    expect(segmentBoxGap({ x: 3, z: -5 }, { x: 3, z: 5 }, origin, unit)).toBe(2);
    expect(segmentBoxGap({ x: 2, z: 4 }, { x: 4, z: 2 }, origin, unit)).toBeCloseTo(2.8284271247461903, 12);
    expect(segmentBoxGap({ x: 4, z: 0 }, { x: 9, z: 0 }, origin, { x: 1, z: 2 })).toBe(3);
  });
});
