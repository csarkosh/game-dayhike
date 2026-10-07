import { describe, it, expect } from "vitest";
import { DUSK_AT, NIGHT_SPAN, WET_AT, WET_SPAN, actsUnder, smootherstep } from "../../src/sim/acts.js";

describe("the acts", () => {
  it("turn wet at a tenth of the way and go dark from three tenths, each over a short stretch: most of the climb is night", () => {
    expect(WET_AT).toBe(0.1);
    expect(DUSK_AT).toBe(0.3);
    expect(WET_AT + WET_SPAN).toBeLessThan(DUSK_AT);
    expect(DUSK_AT + NIGHT_SPAN).toBeLessThan(0.45);
    expect(actsUnder(0)).toEqual({ wet: 0, night: 0 });
    expect(actsUnder(WET_AT + WET_SPAN).wet).toBeCloseTo(1, 12);
    expect(actsUnder(DUSK_AT).night).toBe(0);
    expect(actsUnder(DUSK_AT + NIGHT_SPAN).night).toBeCloseTo(1, 12);
    expect(actsUnder(0.7)).toEqual({ wet: 1, night: 1 });
    expect(actsUnder(-1)).toEqual({ wet: 0, night: 0 });
    expect(actsUnder(2)).toEqual({ wet: 1, night: 1 });
  });

  it("eases each with smootherstep, flat at both ends", () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(0.5)).toBe(0.5);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.1)).toBeLessThan(0.1);
    expect(smootherstep(0.9)).toBeGreaterThan(0.9);
  });
});
