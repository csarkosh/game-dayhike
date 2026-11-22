import { describe, it, expect } from "vitest";
import {
  postFeaturesFor,
  PAINT_JOINT_SHARPNESS, PAINT_RADIUS_HIGH, PAINT_RADIUS_MEDIUM, PAINT_REACH, PAINT_ROWS, PAINT_SCALE, paintRadiusFor, paintTargetSize, paintTexelRadius,
  TAA_BLEND, TAA_BLEND_STILL, TAA_CLIP, TAA_MOVING_PX, TAA_NEAR, TAA_SAMPLES, TAA_SHARPEN, halton, taaBlendFor, taaCameraPixels, taaJitter,
} from "../../src/game/postParams.js";

describe("postFeaturesFor", () => {
  it("high gets the pipeline, halation, the lens and the temporal anti-aliasing, medium the pipeline, the lens and the anti-aliasing, low nothing", () => {
    expect(postFeaturesFor("high", true)).toEqual({ pipeline: true, halation: true, lens: true, colourPath: "post", paint: 3, taa: true });
    expect(postFeaturesFor("medium", true)).toEqual({ pipeline: true, halation: false, lens: true, colourPath: "post", paint: 2, taa: true });
    expect(postFeaturesFor("low", true)).toEqual({ pipeline: false, halation: false, lens: false, colourPath: "material", paint: 0, taa: false });
  });

  it("without float render targets every tier takes the material path, and no lens", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(postFeaturesFor(tier, false).colourPath).toBe("material");
      expect(postFeaturesFor(tier, false).pipeline).toBe(false);
      expect(postFeaturesFor(tier, false).lens).toBe(false);
      expect(postFeaturesFor(tier, false).taa).toBe(false);
    }
  });
});

describe("the temporal anti-aliasing's jitter", () => {
  it("holds the measured blend, the clip, the sharpen and an eight-step walk", () => {
    expect(TAA_BLEND).toBe(0.1);
    expect(TAA_CLIP).toBe(1.25);
    expect(TAA_SHARPEN).toBe(0.5);
    expect(TAA_SAMPLES).toBe(8);
  });

  it("walks the Halton sequence in bases 2 and 3", () => {
    expect([1, 2, 3, 4].map((i) => halton(i, 2))).toEqual([0.5, 0.25, 0.75, 0.125]);
    expect([1, 2, 3].map((i) => halton(i, 3))).toEqual([1 / 3, 2 / 3, 1 / 9]);
    expect(halton(0, 2)).toBe(0);
  });

  it("offsets the projection by under half a pixel on each axis, from the first step, round again after the walk", () => {
    const width = 1920;
    const height = 1080;
    for (let frame = 0; frame < 2 * TAA_SAMPLES; frame++) {
      const { x, y } = taaJitter(frame, width, height);
      // Half a pixel in clip space is 1 / width.
      expect(Math.abs(x)).toBeLessThan(1 / width);
      expect(Math.abs(y)).toBeLessThan(1 / height);
      expect(taaJitter(frame + TAA_SAMPLES, width, height)).toEqual({ x, y });
    }
    expect(taaJitter(0, width, height)).toEqual({ x: 0, y: ((1 / 3 - 0.5) * 2) / height });
    expect(taaJitter(1, width, height)).toEqual({ x: ((0.25 - 0.5) * 2) / width, y: ((2 / 3 - 0.5) * 2) / height });
    // Eight distinct steps.
    expect(new Set(Array.from({ length: TAA_SAMPLES }, (_, f) => JSON.stringify(taaJitter(f, width, height)))).size).toBe(TAA_SAMPLES);
  });
});

describe("the temporal anti-aliasing's blend", () => {
  it("holds the measured still blend, below the moving one, reached at a pixel of motion", () => {
    expect(TAA_BLEND_STILL).toBe(0.03);
    expect(TAA_BLEND_STILL).toBeLessThan(TAA_BLEND);
    expect(TAA_MOVING_PX).toBe(1);
    expect(TAA_NEAR).toBe(2);
  });

  it("takes the still blend for a camera that has not moved and the full blend from a pixel of motion on", () => {
    expect(taaBlendFor(0)).toBe(TAA_BLEND_STILL);
    expect(taaBlendFor(TAA_MOVING_PX)).toBe(TAA_BLEND);
    expect(taaBlendFor(40)).toBe(TAA_BLEND);
    expect(taaBlendFor(-1)).toBe(TAA_BLEND_STILL);
  });

  it("rises steadily between the two", () => {
    let last = taaBlendFor(0);
    for (let px = 0.1; px <= TAA_MOVING_PX; px += 0.1) {
      const b = taaBlendFor(px);
      expect(b).toBeGreaterThan(last);
      last = b;
    }
    expect(taaBlendFor(TAA_MOVING_PX / 2)).toBeCloseTo((TAA_BLEND_STILL + TAA_BLEND) / 2, 10);
  });

  it("measures the camera's motion in pixels: a turn by its angle, a step as seen at TAA_NEAR", () => {
    const fovY = 0.8;
    const height = 776;
    const pixel = fovY / height;
    expect(taaCameraPixels(0, 0, fovY, height)).toBe(0);
    expect(taaCameraPixels(pixel, 0, fovY, height)).toBeCloseTo(1, 10);
    expect(taaCameraPixels(0, TAA_NEAR * pixel, fovY, height)).toBeCloseTo(1, 10);
    expect(taaCameraPixels(3 * pixel, TAA_NEAR * 2 * pixel, fovY, height)).toBeCloseTo(5, 10);
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

