import { describe, it, expect } from "vitest";
import {
  RENDER_SCALE_DROP_WINDOWS,
  RENDER_SCALE_FAST_HZ,
  RENDER_SCALE_REDUCED,
  RENDER_SCALE_RISE_WINDOWS,
  RENDER_SCALE_SLOW_HZ,
  RENDER_SCALE_STALL_S,
  RENDER_SCALE_STEPS,
  RENDER_SCALE_WINDOW_S,
  createRenderScale,
  type RenderScale,
} from "../../src/game/renderScale.js";

/** Feeds `seconds` of play at `hz`; how many times the scale changed. */
function play(r: RenderScale, hz: number, seconds: number): number {
  let changes = 0;
  const frames = Math.round(seconds * hz);
  for (let i = 0; i < frames; i++) if (r.frame(1 / hz)) changes++;
  return changes;
}

describe("the render scale under the paint", () => {
  it("holds the tuned values", () => {
    expect(RENDER_SCALE_STEPS).toEqual([1, 0.87, 0.75]);
    expect(RENDER_SCALE_REDUCED).toBe(0.87);
    expect(RENDER_SCALE_SLOW_HZ).toBe(48);
    expect(RENDER_SCALE_FAST_HZ).toBe(57);
    expect(RENDER_SCALE_WINDOW_S).toBe(2);
    expect(RENDER_SCALE_DROP_WINDOWS).toBe(2);
    expect(RENDER_SCALE_RISE_WINDOWS).toBe(3);
    expect(RENDER_SCALE_STALL_S).toBe(0.25);
  });

  it("stays at full scale while the frames hold, however long", () => {
    const r = createRenderScale();
    expect(r.scale).toBe(1);
    expect(play(r, 60, 60)).toBe(0);
    expect(play(r, 50, 60)).toBe(0);
    expect(r.scale).toBe(1);
  });

  it("drops a step after two slow windows in a row, not one, and a second step after two more", () => {
    const r = createRenderScale();
    expect(play(r, 40, 2.1)).toBe(0);
    expect(r.scale).toBe(1);
    expect(play(r, 40, 2)).toBe(1);
    expect(r.scale).toBe(0.87);
    // Still slow at 87 %: two more windows and it takes the second step.
    expect(play(r, 40, 2.1)).toBe(0);
    expect(play(r, 40, 2)).toBe(1);
    expect(r.scale).toBe(0.75);
    // There is no step below the last: it holds there however slow.
    expect(play(r, 30, 20)).toBe(0);
    expect(r.scale).toBe(0.75);
  });

  it("a fast window between two slow ones breaks the run", () => {
    const r = createRenderScale();
    play(r, 40, 2.1);
    play(r, 60, 2);
    play(r, 40, 2.1);
    expect(r.scale).toBe(1);
    play(r, 40, 2);
    expect(r.scale).toBe(0.87);
  });

  it("rises a step after three fast windows, and holds between the two rates", () => {
    const r = createRenderScale();
    play(r, 40, 8.4);
    expect(r.scale).toBe(0.75);
    // Between the rates: held.
    expect(play(r, 52, 30)).toBe(0);
    expect(r.scale).toBe(0.75);
    expect(play(r, 60, 4.1)).toBe(0);
    expect(play(r, 60, 2.1)).toBe(1);
    expect(r.scale).toBe(0.87);
    expect(play(r, 60, 6.2)).toBe(1);
    expect(r.scale).toBe(1);
    // At full scale a fast window counts toward nothing.
    expect(play(r, 60, 30)).toBe(0);
  });

  it("does not count a window that holds a stall, and the stall breaks the run", () => {
    const r = createRenderScale();
    play(r, 40, 2.1);
    expect(r.frame(RENDER_SCALE_STALL_S + 0.01)).toBe(false);
    play(r, 40, 2);
    expect(r.scale).toBe(1);
    play(r, 40, 4.1);
    expect(r.scale).toBe(0.87);
  });

  it("ignores frames of no time, takes its own steps, and reset brings it back to full with the windows afresh", () => {
    const r = createRenderScale();
    expect(r.frame(0)).toBe(false);
    expect(r.frame(-1)).toBe(false);
    expect(r.frame(Number.NaN)).toBe(false);
    play(r, 40, 8.4);
    expect(r.scale).toBe(0.75);
    r.reset();
    expect(r.scale).toBe(1);
    play(r, 40, 2.1);
    expect(r.scale).toBe(1);
    // One step only: the old rule.
    const one = createRenderScale([1, 0.87]);
    play(one, 40, 20);
    expect(one.scale).toBe(0.87);
  });
});
