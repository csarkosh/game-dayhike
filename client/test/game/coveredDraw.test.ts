import { describe, expect, it } from "vitest";
import { COVERED_DRAW_MS, createCoveredDraw } from "../../src/game/coveredDraw.js";

describe("the hike's draws under the intro's film", () => {
  it("draws every frame with no film over the hike", () => {
    const draw = createCoveredDraw();
    expect([0, 16, 33, 50].map((t) => draw.due(t))).toEqual([true, true, true, true]);
  });

  it("draws a covered hike once every COVERED_DRAW_MS, the first covered frame at once", () => {
    const draw = createCoveredDraw();
    const lift = draw.cover();
    expect(COVERED_DRAW_MS).toBe(250);
    // Sixty frames a second for a second: the frames at 0, 250, 500 and 750 ms draw.
    const drawn: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      const t = 1000 + (frame * 1000) / 60;
      if (draw.due(t)) drawn.push(frame);
    }
    expect(drawn).toEqual([0, 15, 30, 45]);
    // The cut: every frame again, from the next.
    lift();
    expect([2000, 2016, 2033].map((t) => draw.due(t))).toEqual([true, true, true]);
  });

  it("stays slow until every cover is lifted, and a cover lifted twice lifts once", () => {
    const draw = createCoveredDraw();
    const first = draw.cover();
    const second = draw.cover();
    expect(draw.due(0)).toBe(true);
    first();
    first();
    expect(draw.due(16)).toBe(false);
    second();
    expect(draw.due(33)).toBe(true);
  });
});
