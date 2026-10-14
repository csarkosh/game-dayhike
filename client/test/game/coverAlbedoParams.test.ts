import { describe, it, expect } from "vitest";
import {
  COVER_ALBEDO_GAIN_MAX,
  COVER_ALBEDO_GAIN_MIN,
  COVER_ALBEDO_TARGET,
  COVER_ALBEDO_Y,
  coverAlbedoGain,
} from "../../src/game/coverAlbedoParams.js";

describe("the cover's albedo gain", () => {
  it("holds the target, the measured table and the gain's range as literals", () => {
    expect(COVER_ALBEDO_TARGET).toBe(0.18);
    expect(COVER_ALBEDO_Y).toEqual({
      "clutter.grass_a": 0.0942,
      "clutter.meadow": 0.0942,
      "clutter.grass_b": 0.2909,
      "clutter.flower_a": 0.1796,
      "clutter.flower_b": 0.184,
      "clutter.bush_a": 0.1543,
      "clutter.bush_b": 0.1543,
      "understory.fern": 0.0901,
    });
    expect(COVER_ALBEDO_GAIN_MIN).toBe(0.4);
    expect(COVER_ALBEDO_GAIN_MAX).toBe(2);
  });

  it("lifts the main tuft and the fern short of the cap, and cuts the pale tuft", () => {
    // 0.18 / 0.0942: under the cap of 2, which is not reached.
    expect(coverAlbedoGain("clutter.grass_a")).toBeCloseTo(1.91083, 5);
    expect(coverAlbedoGain("clutter.grass_a")).toBeLessThan(2);
    expect(coverAlbedoGain("clutter.meadow")).toBeCloseTo(1.91083, 5);
    // 0.18 / 0.2909
    expect(coverAlbedoGain("clutter.grass_b")).toBeCloseTo(0.61877, 5);
    // 0.18 / 0.0901
    expect(coverAlbedoGain("understory.fern")).toBeCloseTo(1.99778, 5);
    expect(coverAlbedoGain("understory.fern")).toBeLessThan(2);
  });

  it("leaves the flowers and the bushes near their own", () => {
    expect(coverAlbedoGain("clutter.flower_a")).toBeCloseTo(1.00223, 5);
    expect(coverAlbedoGain("clutter.flower_b")).toBeCloseTo(0.97826, 5);
    expect(coverAlbedoGain("clutter.bush_a")).toBeCloseTo(1.16656, 5);
    expect(coverAlbedoGain("clutter.bush_b")).toBeCloseTo(1.16656, 5);
  });

  it("is 1 for a model not in the table", () => {
    expect(coverAlbedoGain("clutter.rock_a")).toBe(1);
    expect(coverAlbedoGain("deadwood.snag")).toBe(1);
    expect(coverAlbedoGain("")).toBe(1);
  });
});
