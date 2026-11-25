import { describe, expect, it } from "vitest";
import { COVERED_DRAW_MS, createCoveredDraw } from "@csarkosh/engine/game/coveredDraw";
import { asksPerDraw, drawEveryMs, type LoadPace } from "@csarkosh/engine/game/loadPace";

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

  it("draws a covered hike as often as its film's pace says, the pace told of every frame", () => {
    const draw = createCoveredDraw();
    const told: number[] = [];
    let level = 0;
    const pace: LoadPace = {
      frame: (now) => void told.push(now),
      level: () => level,
      drawEveryMs: () => drawEveryMs(level),
      asksPerDraw: () => asksPerDraw(level),
      course: () => ({ peak: level, level, windows: 0, missed: 0, slips: 0, frames: 0, stops: 0 }),
    };
    // No film over the hike: nothing paces a draw's asks.
    expect(draw.asks()).toBeUndefined();
    const lift = draw.cover(pace);
    const drawnIn = (from: number): number[] => {
      const drawn: number[] = [];
      for (let frame = 0; frame < 60; frame++) if (draw.due(from + (frame * 1000) / 60)) drawn.push(frame);
      return drawn;
    };
    // At the floor: what a cover with no pace draws, and four asks a draw.
    expect(drawnIn(1000)).toEqual([0, 15, 30, 45]);
    expect(draw.asks()).toBe(4);
    expect(told).toHaveLength(60);
    // At the top: every frame, one ask a draw.
    level = 1;
    expect(drawnIn(3000)).toHaveLength(60);
    expect(draw.asks()).toBe(1);
    // Between: more draws than the floor's, fewer than every frame.
    level = 0.5;
    const between = drawnIn(5000).length;
    expect(between).toBeGreaterThan(4);
    expect(between).toBeLessThan(60);
    // The cut: every frame, the pace told of none, and nothing pacing the asks.
    lift();
    const before = told.length;
    expect([7000, 7016, 7033].map((t) => draw.due(t))).toEqual([true, true, true]);
    expect(told).toHaveLength(before);
    expect(draw.asks()).toBeUndefined();
  });

  it("paces nothing under a cover with no film to read: a draw every COVERED_DRAW_MS, its asks the renderer's own", () => {
    const draw = createCoveredDraw();
    const lift = draw.cover();
    expect(draw.asks()).toBeUndefined();
    expect([0, 100, 249, 250].map((t) => draw.due(t))).toEqual([true, false, false, true]);
    lift();
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
