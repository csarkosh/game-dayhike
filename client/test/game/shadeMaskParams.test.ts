import { describe, expect, it } from "vitest";
import {
  SHADE_MASK_RATIO, SHADE_SMOKE_FOLD_S, SHADE_SMOKE_FRAY, SHADE_SMOKE_SWELL_M, shadeMaskColour, shadeMaskSide, shadeMaskSize, shadeSmokeSeconds, shadeSmokeUniforms,
} from "@csarkosh/engine/game/shadeMaskParams";

import { babylonValues } from "../helpers/babylonFixture.js";


describe("what the haunt's figures are drawn into their mask with", () => {
  it("sizes the mask as Babylon.js sizes a render target given the mask's ratio, at every frame's size", () => {
    // The size Babylon.js gave a render target made with that ratio under an engine drawing each frame's size, recorded.
    const babylon = babylonValues<{ ratio: number; sizes: { width: number; height: number; target: { width: number; height: number } }[] }>("numbers/shadeMask.json");
    expect(babylon.ratio).toBe(SHADE_MASK_RATIO);
    expect(babylon.sizes.map((size) => [size.width, size.height])).toEqual([[1470, 956], [1920, 1080], [2560, 1440], [1280, 720], [975, 776], [640, 360], [390, 844], [300, 150], [3840, 2160]]);
    for (const { width, height, target } of babylon.sizes) {
      expect(shadeMaskSize(width, height), `${width} by ${height}`).toEqual({ width: target.width, height: target.height });
    }
    // A laptop's window: half of 1470 is 735, taken to 512, the nearer power of two.
    expect(shadeMaskSize(1470, 956)).toEqual({ width: 512, height: 512 });
    expect(shadeMaskSide(1920)).toBe(1024);
  });

  it("colours a figure by its softness and how near it is: red the shade, blue the real thing, no green", () => {
    expect(shadeMaskColour(1, 1)).toEqual([1, 0, 0]);
    expect(shadeMaskColour(0, 1)).toEqual([0, 0, 1]);
    expect(shadeMaskColour(0.5, 0.4)).toEqual([0.2, 0, 0.5]);
    const out: [number, number, number] = [9, 9, 9];
    expect(shadeMaskColour(1, 0.25, out)).toBe(out);
    expect(out).toEqual([0.25, 0, 0]);
  });

  it("gives the smoke its figure's values and its own two, and folds its clock at an hour", () => {
    expect(shadeSmokeUniforms(0.25, 12, 140, 5.4)).toEqual({ shadeSmoke: [0.25, 12, 140, 5.4], shadeSmokeEdge: [SHADE_SMOKE_FRAY, SHADE_SMOKE_SWELL_M] });
    expect(shadeSmokeSeconds(12_500)).toBe(12.5);
    expect(shadeSmokeSeconds((SHADE_SMOKE_FOLD_S + 3) * 1000)).toBe(3);
  });
});
