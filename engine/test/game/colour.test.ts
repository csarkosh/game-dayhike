import { describe, it, expect } from "vitest";
import { clamp01, desaturateRgb, luma, mixRgb } from "../../src/game/colour.js";

describe("clamp01", () => {
  it("passes values inside the range through", () => {
    expect(clamp01(0.4)).toBe(0.4);
  });

  it("clamps both ends", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(9)).toBe(1);
  });
});

describe("mixRgb", () => {
  it("returns the endpoints exactly", () => {
    const a = { r: 0.1, g: 0.2, b: 0.3 };
    const b = { r: 0.7, g: 0.8, b: 0.9 };
    expect(mixRgb(a, b, 0)).toEqual(a);
    expect(mixRgb(a, b, 1)).toEqual(b);
  });

  it("interpolates each channel independently", () => {
    const c = mixRgb({ r: 0, g: 1, b: 0.5 }, { r: 1, g: 0, b: 0.5 }, 0.25);
    expect(c.r).toBeCloseTo(0.25, 10);
    expect(c.g).toBeCloseTo(0.75, 10);
    expect(c.b).toBeCloseTo(0.5, 10);
  });

  it("returns a copy at the endpoints, not the source object itself", () => {
    // The endpoint fast paths promise a copy specifically so palette constants
    // fed in as `a` or `b` cannot be aliased and then mutated through the
    // returned object. `toEqual` alone cannot tell a copy from the same
    // reference, since both compare equal by value.
    const a = { r: 0.1, g: 0.2, b: 0.3 };
    const b = { r: 0.7, g: 0.8, b: 0.9 };
    const atStart = mixRgb(a, b, 0);
    atStart.r = 999;
    expect(a.r).toBe(0.1);
    const atEnd = mixRgb(a, b, 1);
    atEnd.r = 999;
    expect(b.r).toBe(0.7);
  });
});

describe("desaturateRgb", () => {
  it("k=0 returns an exact copy; k=1 returns pure luma grey", () => {
    const c = { r: 0.8, g: 0.4, b: 0.2 };
    expect(desaturateRgb(c, 0)).toEqual(c);
    expect(desaturateRgb(c, 0)).not.toBe(c);
    const grey = desaturateRgb(c, 1);
    const l = luma(c);
    expect(grey).toEqual({ r: l, g: l, b: l });
  });

  it("luma weights sum to 1 so grey stays grey", () => {
    expect(luma({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 10);
  });
});
