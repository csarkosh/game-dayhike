import { describe, it, expect } from "vitest";
import { FixedStepAccumulator } from "../../src/game/loop.js";
import { TICK_DT } from "../../src/sim/constants.js";

describe("FixedStepAccumulator", () => {
  it("yields no ticks for a frame shorter than one step", () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(TICK_DT / 2)).toBe(0);
  });

  it("yields exactly one tick per step-sized frame", () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(TICK_DT)).toBe(1);
  });

  it("yields multiple ticks for a long frame", () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(TICK_DT * 3.5)).toBe(3);
  });

  it("carries the remainder into the next frame", () => {
    const acc = new FixedStepAccumulator();
    acc.advance(TICK_DT * 1.5);
    expect(acc.advance(TICK_DT * 0.6)).toBe(1);
  });

  it("reports alpha as the fraction into the pending tick", () => {
    const acc = new FixedStepAccumulator();
    acc.advance(TICK_DT * 1.5);
    expect(acc.alpha).toBeCloseTo(0.5, 6);
  });

  it("clamps a huge frame so a backgrounded tab does not spiral", () => {
    const acc = new FixedStepAccumulator();
    // Ten seconds would be 600 ticks; the clamp must cap it far lower.
    expect(acc.advance(10)).toBeLessThanOrEqual(15);
  });

  it("ignores a negative frame duration", () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(-5)).toBe(0);
    expect(acc.alpha).toBe(0);
  });
});
