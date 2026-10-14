import { describe, it, expect } from "vitest";
import {
  COVER_ALBEDO_GAIN_MAX,
  COVER_ALBEDO_GAIN_MIN,
  COVER_ALBEDO_RGB,
  COVER_ALBEDO_TARGET,
  COVER_ALBEDO_Y,
  COVER_GREEN,
  COVER_TINT_MAX,
  COVER_TINT_MIN,
  FOLIAGE_CARD_CONTRAST,
  coverAlbedoGain,
  coverAlbedoTint,
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

describe("the cover's green", () => {
  it("is the floor's grass colour scaled to the target luminance, as a literal", () => {
    expect(COVER_GREEN).toEqual({ r: 0.1237, g: 0.2061, b: 0.0824 });
    // `terrainSurface.ts` GRASS (0.09, 0.15, 0.06), luminance 0.131, scaled
    // by 0.18 / 0.131 on each channel, recomputed here from those numbers.
    const scale = 0.18 / 0.131;
    expect(COVER_GREEN.r).toBeCloseTo(0.09 * scale, 4);
    expect(COVER_GREEN.g).toBeCloseTo(0.15 * scale, 4);
    expect(COVER_GREEN.b).toBeCloseTo(0.06 * scale, 4);
    // And so its own luminance is the target.
    expect(0.2126 * COVER_GREEN.r + 0.7152 * COVER_GREEN.g + 0.0722 * COVER_GREEN.b).toBeCloseTo(0.18, 3);
  });

  it("holds the measured mean colours, the tint's range and the cards' contrast as literals", () => {
    expect(COVER_ALBEDO_RGB).toEqual({
      "clutter.grass_a": { r: 0.1001, g: 0.0989, b: 0.0297 },
      "clutter.meadow": { r: 0.1001, g: 0.0989, b: 0.0297 },
      "clutter.grass_b": { r: 0.3108, g: 0.3001, b: 0.1415 },
      "clutter.bush_a": { r: 0.1802, g: 0.153, b: 0.0899 },
      "clutter.bush_b": { r: 0.1802, g: 0.153, b: 0.0899 },
      "understory.fern": { r: 0.07, g: 0.1035, b: 0.0165 },
    });
    // The flowers keep their colour: a luminance row and no colour row.
    expect(COVER_ALBEDO_RGB["clutter.flower_a"]).toBeUndefined();
    expect(COVER_ALBEDO_RGB["clutter.flower_b"]).toBeUndefined();
    expect(COVER_TINT_MIN).toBe(0.3);
    expect(COVER_TINT_MAX).toBe(3);
    expect(FOLIAGE_CARD_CONTRAST).toBe(0.6);
  });
});

describe("the cover's albedo tint", () => {
  const tint = (id: string): [number, number, number] => {
    const t = coverAlbedoTint(id);
    return [t.r, t.g, t.b];
  };

  it("puts each green card's mean on the green, channel by channel, the fern's blue at the cap", () => {
    // (0.1237, 0.2061, 0.0824) / (0.0700, 0.1035, 0.0165): the blue would be
    // 4.994 and is held at 3.
    const fern = tint("understory.fern");
    expect(fern[0]).toBeCloseTo(1.76714, 5);
    expect(fern[1]).toBeCloseTo(1.9913, 5);
    expect(fern[2]).toBe(3);
    // / (0.1001, 0.0989, 0.0297): the yellow tuft, its blue lifted most.
    const grassA = tint("clutter.grass_a");
    expect(grassA[0]).toBeCloseTo(1.23576, 5);
    expect(grassA[1]).toBeCloseTo(2.08392, 5);
    expect(grassA[2]).toBeCloseTo(2.77441, 5);
    expect(tint("clutter.meadow")).toEqual(tint("clutter.grass_a"));
    // / (0.3108, 0.3001, 0.1415): the pale tuft, cut on every channel.
    const grassB = tint("clutter.grass_b");
    expect(grassB[0]).toBeCloseTo(0.39801, 5);
    expect(grassB[1]).toBeCloseTo(0.68677, 5);
    expect(grassB[2]).toBeCloseTo(0.58233, 5);
    // / (0.1802, 0.1530, 0.0899): the bushes, their red cut and green lifted.
    const bush = tint("clutter.bush_a");
    expect(bush[0]).toBeCloseTo(0.68646, 5);
    expect(bush[1]).toBeCloseTo(1.34706, 5);
    expect(bush[2]).toBeCloseTo(0.91657, 5);
    expect(tint("clutter.bush_b")).toEqual(tint("clutter.bush_a"));
  });

  it("gives the flowers the grey gain on all three channels, so the petals keep their colour", () => {
    for (const c of tint("clutter.flower_a")) expect(c).toBeCloseTo(1.00223, 5);
    for (const c of tint("clutter.flower_b")) expect(c).toBeCloseTo(0.97826, 5);
  });

  it("is (1, 1, 1) for a model in neither table", () => {
    expect(tint("clutter.rock_a")).toEqual([1, 1, 1]);
    expect(tint("deadwood.snag")).toEqual([1, 1, 1]);
    expect(tint("")).toEqual([1, 1, 1]);
  });
});
