import { describe, expect, it } from "vitest";
import { PHONE_FRAME_MS, createFramePace, type FramePace } from "@csarkosh/engine/game/framePace";

/** A Pixel 9's jitter in the times its display gives: about a fiftieth of a refresh either way. */
const jitter = (i: number): number => (((i * 7) % 5) - 2) * 0.065;

/** The times (ms) a display at `hz` gives its refreshes, `n` of them from `from`. */
function refreshes(hz: number, n: number, from = 1000, wobble: (i: number) => number = () => 0): number[] {
  return Array.from({ length: n }, (_, i) => from + (i * 1000) / hz + wobble(i));
}

/** The frames a pace draws of `times`. */
function drawn(times: number[], pace: FramePace = createFramePace(PHONE_FRAME_MS)): number[] {
  return times.filter((t) => pace.due(t));
}

function gapsOf(times: number[]): number[] {
  return times.slice(1).map((t, i) => t - (times[i] as number));
}

describe("frame pace", () => {
  it.each([
    [60, 1],
    [72, 1],
    [75, 1],
    [90, 2],
    [120, 2],
    [144, 3],
    [165, 3],
    [240, 4],
  ])("draws a %i Hz display every %i refreshes, evenly", (hz, every) => {
    const gaps = gapsOf(drawn(refreshes(hz, 600)));
    expect(gaps.length).toBeGreaterThan(600 / every - 3);
    for (const gap of gaps) expect(gap).toBeCloseTo((every * 1000) / hz, 6);
  });

  it.each([60, 90, 120, 144])("keeps the pace of a %i Hz display through the jitter in its times", (hz) => {
    const even = gapsOf(drawn(refreshes(hz, 600)));
    const gaps = gapsOf(drawn(refreshes(hz, 600, 1000, jitter)));
    expect(gaps.length).toBe(even.length);
    for (const gap of gaps) expect(Math.abs(gap - (even[0] as number))).toBeLessThan(0.3);
  });

  it("never draws faster than sixty a second by more than three tenths", () => {
    for (let hz = 30; hz <= 360; hz++) {
      const gaps = gapsOf(drawn(refreshes(hz, 400)));
      for (const gap of gaps.slice(2)) expect(gap).toBeGreaterThan(PHONE_FRAME_MS / 1.3 - 1e-6);
    }
  });

  it("follows a display that goes to 120 Hz at a touch and back to 60 Hz", () => {
    const calm = refreshes(60, 60);
    const touched = refreshes(120, 240, (calm.at(-1) as number) + 1000 / 60);
    const lifted = refreshes(60, 60, (touched.at(-1) as number) + 1000 / 120);
    const gaps = gapsOf(drawn([...calm, ...touched, ...lifted]));
    // Sixty a second throughout: each change of the display costs no frame.
    for (const gap of gaps) expect(gap).toBeCloseTo(1000 / 60, 6);
  });

  it("follows a 90 Hz display that drops to 60 Hz within a fifth of a second", () => {
    const fast = refreshes(90, 180);
    const slow = refreshes(60, 120, (fast.at(-1) as number) + 1000 / 90);
    const frames = drawn([...fast, ...slow]);
    const after = frames.filter((t) => t > (slow[0] as number) + 200);
    for (const gap of gapsOf(after)) expect(gap).toBeCloseTo(1000 / 60, 6);
  });

  it("goes back to the even pace after a late frame, without a run to catch up", () => {
    const times = refreshes(120, 120).filter((_, i) => i < 20 || i > 24);
    const gaps = gapsOf(drawn(times));
    // The refreshes 20 to 24 were missed (a busy page): one long gap, then the even pace again.
    expect(gaps.filter((g) => g > 20).length).toBe(1);
    for (const gap of gaps.filter((g) => g <= 20)) expect(gap).toBeCloseTo(1000 / 60, 6);
  });

  it("keeps the pace on a page too busy to be asked at every refresh", () => {
    // A 120 Hz display whose page is asked at one refresh in two or three, and now and then at the very next one.
    const all = refreshes(120, 600);
    const asked = all.filter((_, i) => i % 5 === 0 || i % 5 === 2 || i % 40 === 3);
    for (const gap of gapsOf(drawn(asked))) expect(gap).toBeGreaterThan(1000 / 60 - 1e-6);
  });

  it("starts afresh after a hidden tab's long pause", () => {
    const pace = createFramePace(PHONE_FRAME_MS);
    const before = refreshes(120, 30);
    drawn(before, pace);
    const back = (before.at(-1) as number) + 60000;
    expect(pace.due(back)).toBe(true);
    expect(pace.due(back + 1000 / 120)).toBe(false);
    expect(pace.due(back + 1000 / 60)).toBe(true);
  });

  it("draws every frame with no pace", () => {
    const pace = createFramePace(0);
    expect(refreshes(120, 20).every((t) => pace.due(t))).toBe(true);
  });
});
