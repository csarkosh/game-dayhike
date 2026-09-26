import { describe, it, expect } from "vitest";
import {
  HOLLOW_ALBEDO, HOLLOW_EMISSIVE, HOLLOW_EYE_COLOR, HOLLOW_EYE_INTENSITY, HOLLOW_MATERIAL, HOLLOW_ROUGHNESS,
  HOLLOW_SCALE, HOLLOW_WALK_CLIP_SPEED, RANGER_WALK_CLIP_SPEED,
} from "../../src/game/hollowLook.js";

describe("the Hollow's model", () => {
  it("is drawn at twice the model's player height", () => {
    expect(HOLLOW_SCALE).toBe(2);
  });

  it("has saturated red eyes bright enough to bleed a glow at night", () => {
    expect(HOLLOW_EYE_COLOR).toEqual({ r: 1, g: 0.04, b: 0.02 });
    expect(HOLLOW_EYE_INTENSITY).toBe(4);
    // Red's luminance weight × intensity × the night exposure, over the
    // halation threshold of 1; the same at the day exposure, under it.
    expect(0.2126 * HOLLOW_EYE_INTENSITY * 1.6).toBeGreaterThan(1);
    expect(0.2126 * HOLLOW_EYE_INTENSITY * 0.9).toBeLessThan(1);
  });

  it("scales its walk clips from 1.5 m/s at rate 1, the Hollow's and the rangers' alike", () => {
    expect(HOLLOW_WALK_CLIP_SPEED).toBe(1.5);
    expect(RANGER_WALK_CLIP_SPEED).toBe(1.5);
  });
});

// The capsule fallback is a very dark, lit shape: every colour channel is above zero
// (a pure black is invisible at full dark, whatever the lamp does) and at
// most a tenth (any brighter and it stops reading as a hole in the night).
describe("the Hollow's fallback capsule", () => {
  it("has a near-black albedo on every channel", () => {
    for (const channel of [HOLLOW_ALBEDO.r, HOLLOW_ALBEDO.g, HOLLOW_ALBEDO.b]) {
      expect(channel).toBeGreaterThan(0);
      expect(channel).toBeLessThanOrEqual(0.1);
    }
  });

  it("has a faint emissive floor on every channel", () => {
    for (const channel of [HOLLOW_EMISSIVE.r, HOLLOW_EMISSIVE.g, HOLLOW_EMISSIVE.b]) {
      expect(channel).toBeGreaterThan(0);
      expect(channel).toBeLessThanOrEqual(0.1);
    }
  });

  it("is fully rough, so the lamp shows form and never a highlight", () => {
    expect(HOLLOW_ROUGHNESS).toBe(1);
  });

  it("names the material the atmosphere plugin leaves alone", () => {
    expect(HOLLOW_MATERIAL).toBe("mat_hollow");
  });
});
