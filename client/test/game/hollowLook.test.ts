import { describe, it, expect } from "vitest";
import {
  HOLLOW_ALBEDO, HOLLOW_EMISSIVE, HOLLOW_MATERIAL, HOLLOW_ROUGHNESS,
} from "../../src/game/hollowLook.js";

// The Hollow is a very dark, lit shape: every colour channel is above zero
// (a pure black is invisible at full dark, whatever the lamp does) and at
// most a tenth (any brighter and it stops reading as a hole in the night).
describe("the Hollow's look", () => {
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
