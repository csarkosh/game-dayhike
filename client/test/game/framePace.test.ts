import { describe, expect, it } from "vitest";
import { PHONE_FRAME_MS, createFramePace } from "../../src/game/framePace.js";

/** The times (ms) a display at `hz` gives its refreshes, `n` of them from 1000. */
function refreshes(hz: number, n: number, jitter: (i: number) => number = () => 0): number[] {
  return Array.from({ length: n }, (_, i) => 1000 + (i * 1000) / hz + jitter(i));
}

/** The gaps (ms) between the frames a pace draws of `times`. */
function drawnGaps(times: number[], frameMs = PHONE_FRAME_MS): number[] {
  const pace = createFramePace(frameMs);
  const drawn = times.filter((t) => pace.due(t));
  return drawn.slice(1).map((t, i) => t - (drawn[i] as number));
}

describe("frame pace", () => {
  it("draws every second refresh of a 120 Hz display, evenly", () => {
    const gaps = drawnGaps(refreshes(120, 240));
    expect(gaps.length).toBe(119);
    for (const gap of gaps) expect(gap).toBeCloseTo(1000 / 60, 6);
  });

  it("draws every refresh of a 60 Hz display, jitter and all", () => {
    const times = refreshes(60, 120, (i) => ((i * 7) % 5) * 0.15 - 0.3);
    const pace = createFramePace(PHONE_FRAME_MS);
    expect(times.every((t) => pace.due(t))).toBe(true);
  });

  it("holds sixty a second on a 90 Hz display", () => {
    const gaps = drawnGaps(refreshes(90, 900));
    const seconds = gaps.reduce((a, b) => a + b, 0) / 1000;
    expect(gaps.length / seconds).toBeCloseTo(60, 0);
    // One refresh or two apart: no frame waits longer than it must.
    for (const gap of gaps) expect([1, 2]).toContain(Math.round(gap / (1000 / 90)));
  });

  it("goes back to every second refresh after a late frame, without a run to catch up", () => {
    const times = refreshes(120, 60).filter((_, i) => i < 10 || i > 14);
    const gaps = drawnGaps(times);
    // The refreshes 10 to 14 were missed (a busy page): one long gap, then the even pace again.
    const long = gaps.filter((g) => g > 20);
    expect(long.length).toBe(1);
    for (const gap of gaps.filter((g) => g <= 20)) expect(gap).toBeCloseTo(1000 / 60, 6);
  });

  it("starts afresh after a hidden tab's long pause", () => {
    const pace = createFramePace(PHONE_FRAME_MS);
    expect(pace.due(1000)).toBe(true);
    expect(pace.due(61000)).toBe(true);
    expect(pace.due(61000 + 1000 / 120)).toBe(false);
    expect(pace.due(61000 + 1000 / 60)).toBe(true);
  });

  it("draws every frame with no pace", () => {
    const pace = createFramePace(0);
    expect(refreshes(120, 20).every((t) => pace.due(t))).toBe(true);
  });
});
