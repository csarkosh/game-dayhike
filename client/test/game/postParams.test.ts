import { describe, it, expect } from "vitest";
import {
  postFeaturesFor,
  PAINT_JOINT_SHARPNESS, PAINT_RADIUS_HIGH, PAINT_RADIUS_MEDIUM, PAINT_REACH, PAINT_ROWS, PAINT_SCALE, paintRadiusFor, paintTargetSize, paintTexelRadius,
} from "../../src/game/postParams.js";

describe("postFeaturesFor", () => {
  it("high gets the pipeline, halation and the lens, medium the pipeline and the lens, low nothing", () => {
    expect(postFeaturesFor("high", true)).toEqual({ pipeline: true, halation: true, lens: true, colourPath: "post", paint: 3 });
    expect(postFeaturesFor("medium", true)).toEqual({ pipeline: true, halation: false, lens: true, colourPath: "post", paint: 2 });
    expect(postFeaturesFor("low", true)).toEqual({ pipeline: false, halation: false, lens: false, colourPath: "material", paint: 0 });
  });

  it("without float render targets every tier takes the material path, and no lens", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(postFeaturesFor(tier, false).colourPath).toBe("material");
      expect(postFeaturesFor(tier, false).pipeline).toBe(false);
      expect(postFeaturesFor(tier, false).lens).toBe(false);
    }
  });
});

describe("paintRadiusFor", () => {
  it("scales the tier's stroke with the frame's rows, never under 2 nor past the reach", () => {
    expect(PAINT_RADIUS_HIGH).toBe(3);
    expect(PAINT_RADIUS_MEDIUM).toBe(2);
    expect(PAINT_ROWS).toBe(675);
    expect(PAINT_REACH).toBe(6);
    expect(paintRadiusFor(0, 675)).toBe(0);
    expect(paintRadiusFor(3, 675)).toBe(3);
    expect(paintRadiusFor(3, 1350)).toBe(6);
    expect(paintRadiusFor(3, 4000)).toBe(6);
    expect(paintRadiusFor(2, 338)).toBe(2);
    // A laptop's 982 rows: 4 px on high, 3 on medium.
    expect(paintRadiusFor(3, 982)).toBe(4);
    expect(paintRadiusFor(2, 982)).toBe(3);
  });

  it("paints at half the frame's pixels, the stroke the same share of the picture in the half-size frame's pixels", () => {
    expect(PAINT_SCALE).toBe(0.5);
    expect(PAINT_JOINT_SHARPNESS).toBe(60);
    expect(paintTexelRadius(2, 982)).toBe(1.5);
    expect(paintTexelRadius(3, 982)).toBe(2);
    expect(paintTexelRadius(2, 675)).toBe(1);
    expect(paintTexelRadius(0, 675)).toBe(0);
    // Babylon's own truncation of the frame's size times the ratio.
    expect(paintTargetSize(1512, 982)).toEqual({ width: 756, height: 491 });
    expect(paintTargetSize(1201, 675)).toEqual({ width: 600, height: 337 });
    expect(paintTargetSize(1, 1)).toEqual({ width: 1, height: 1 });
  });
});

