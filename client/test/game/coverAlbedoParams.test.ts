import { describe, it, expect } from "vitest";
import {
  COVER_ALBEDO_GAIN_MAX,
  COVER_ALBEDO_GAIN_MIN,
  COVER_ALBEDO_RGB,
  COVER_ALBEDO_TARGET,
  COVER_ALBEDO_Y,
  COVER_GREEN,
  COVER_PAINT,
  COVER_TINT_MAX,
  COVER_TINT_MIN,
  FOLIAGE_ALBEDO_FLOOR,
  FOLIAGE_CARD_CONTRAST,
  FOLIAGE_SHADOW_FLOOR,
  coverAlbedoGain,
  coverAlbedoTint,
} from "../../src/game/coverAlbedoParams.js";

describe("the cover's albedo gain", () => {
  it("holds the target, the measured table and the gain's range as literals", () => {
    expect(COVER_ALBEDO_TARGET).toBe(0.0775);
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

  it("takes the main tuft and the fern a little down, and holds the pale tuft at the floor", () => {
    // 0.0775 / 0.0942: the main tuft at 0.85 of its own under the painted tint's luminance.
    expect(coverAlbedoGain("clutter.grass_a")).toBeCloseTo(0.82272, 5);
    expect(coverAlbedoGain("clutter.meadow")).toBeCloseTo(0.82272, 5);
    // 0.0775 / 0.2909 = 0.26641, held at the floor of 0.4.
    expect(coverAlbedoGain("clutter.grass_b")).toBe(0.4);
    // 0.0775 / 0.0901
    expect(coverAlbedoGain("understory.fern")).toBeCloseTo(0.86016, 5);
  });

  it("takes the flowers and the bushes to about half their own", () => {
    // 0.0775 / 0.1796, 0.0775 / 0.184, 0.0775 / 0.1543: over the floor of 0.4.
    expect(coverAlbedoGain("clutter.flower_a")).toBeCloseTo(0.43151, 5);
    expect(coverAlbedoGain("clutter.flower_b")).toBeCloseTo(0.42120, 5);
    expect(coverAlbedoGain("clutter.bush_a")).toBeCloseTo(0.50227, 5);
    expect(coverAlbedoGain("clutter.bush_b")).toBeCloseTo(0.50227, 5);
  });

  it("is 1 for a model not in the table", () => {
    expect(coverAlbedoGain("clutter.rock_a")).toBe(1);
    expect(coverAlbedoGain("deadwood.snag")).toBe(1);
    expect(coverAlbedoGain("")).toBe(1);
  });
});

describe("the cover's green", () => {
  it("is the main tuft's own colour at 0.85 of its luminance under the painted tint, as a literal", () => {
    expect(COVER_GREEN).toEqual({ r: 0.0791, g: 0.0815, b: 0.0328 });
    // The main tuft's texture mean (0.1001, 0.0989, 0.0297), Y 0.0942,
    // times 0.85 on each channel and the painted tint (0.93, 0.97, 1.3,
    // 2026-10-17: toward a sage), recomputed here from those numbers.
    expect(COVER_PAINT).toEqual({ r: 0.93, g: 0.97, b: 1.3 });
    expect(COVER_GREEN.r).toBeCloseTo(0.1001 * 0.85 * 0.93, 4);
    expect(COVER_GREEN.g).toBeCloseTo(0.0989 * 0.85 * 0.97, 4);
    expect(COVER_GREEN.b).toBeCloseTo(0.0297 * 0.85 * 1.3, 4);
    // And so its own luminance is the target, under the tint.
    expect(0.2126 * COVER_GREEN.r + 0.7152 * COVER_GREEN.g + 0.0722 * COVER_GREEN.b).toBeCloseTo(0.0775, 4);
  });

  it("holds the albedo's floor at five eighths of the green and the shadow's at 0.75, as literals", () => {
    expect(FOLIAGE_ALBEDO_FLOOR).toEqual({ r: 0.0494, g: 0.0509, b: 0.0205 });
    // 0.0791, 0.0815, 0.0328 × 5 / 8 = 0.04944, 0.05094, 0.02050.
    expect(FOLIAGE_ALBEDO_FLOOR.r).toBeCloseTo(0.0791 * 0.625, 3);
    expect(FOLIAGE_ALBEDO_FLOOR.g).toBeCloseTo(0.0815 * 0.625, 3);
    expect(FOLIAGE_ALBEDO_FLOOR.b).toBeCloseTo(0.0328 * 0.625, 3);
    expect(FOLIAGE_SHADOW_FLOOR).toBe(0.75);
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

  it("puts each green card's mean on the green, channel by channel, the cap reached by none", () => {
    // (0.0791, 0.0815, 0.0328) / (0.0700, 0.1035, 0.0165): the fern, its red
    // and blue lifted and its green cut; the blue at 1.988, under the cap of 3.
    const fern = tint("understory.fern");
    expect(fern[0]).toBeCloseTo(1.13000, 5);
    expect(fern[1]).toBeCloseTo(0.78744, 5);
    expect(fern[2]).toBeCloseTo(1.98788, 5);
    expect(fern[2]).toBeLessThan(3);
    // / (0.1001, 0.0989, 0.0297): the main tuft, 0.85 on every channel times the painted tint.
    const grassA = tint("clutter.grass_a");
    expect(grassA[0]).toBeCloseTo(0.79021, 5);
    expect(grassA[1]).toBeCloseTo(0.82406, 5);
    expect(grassA[2]).toBeCloseTo(1.10438, 5);
    expect(tint("clutter.meadow")).toEqual(tint("clutter.grass_a"));
    // / (0.3108, 0.3001, 0.1415): the pale tuft, 0.274, 0.280 and 0.178,
    // each held at the floor of 0.3.
    expect(tint("clutter.grass_b")).toEqual([0.3, 0.3, 0.3]);
    // / (0.1802, 0.1530, 0.0899): the bushes, their blue at 0.365 over the floor since the tint.
    const bush = tint("clutter.bush_a");
    expect(bush[0]).toBeCloseTo(0.43896, 5);
    expect(bush[1]).toBeCloseTo(0.53268, 5);
    expect(bush[2]).toBeCloseTo(0.36485, 5);
    expect(tint("clutter.bush_b")).toEqual(tint("clutter.bush_a"));
  });

  it("gives the flowers the grey gain on all three channels, so the petals keep their colour", () => {
    for (const c of tint("clutter.flower_a")) expect(c).toBeCloseTo(0.43151, 5);
    for (const c of tint("clutter.flower_b")) expect(c).toBeCloseTo(0.42120, 5);
  });

  it("is (1, 1, 1) for a model in neither table", () => {
    expect(tint("clutter.rock_a")).toEqual([1, 1, 1]);
    expect(tint("deadwood.snag")).toEqual([1, 1, 1]);
    expect(tint("")).toEqual([1, 1, 1]);
  });
});
