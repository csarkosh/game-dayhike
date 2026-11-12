import { describe, expect, it } from "vitest";
import { clockSteps, filmEnd, filmRate, pictureSkips, playing } from "../lib/film.mjs";

// The first rows of a run on a Pixel 9 (cool-both-1, 2026-11-11): the world build stopped the page 3.7 s.
const VIDEO = [
  { t: 4151.8, at: 0.062255, total: 4, dropped: 0 },
  { t: 7972.7, at: 3.671037, total: 91, dropped: 0 },
  { t: 8164.1, at: 3.862109, total: 97, dropped: 0 },
  { t: 8407.5, at: 4.105797, total: 103, dropped: 0 },
];
const ENDED = [...VIDEO, { t: 76000, at: 71.95, total: 1727, dropped: 0 }, { t: 76250, at: 72.0, total: 1727, dropped: 0 }, { t: 80000, at: 72.0, total: 1727, dropped: 0 }];
// The same stop as the frame callbacks heard it: the fourth arrived after the stop with a timestamp from before it.
const SHOWN = [[4128, 0, 1], [4145, 0.041667, 2], [4195, 0.083333, 3], [4212, 3.583333, 87], [7907, 3.625, 88]];

describe("the film's clock", () => {
  it("finds the one step the clock fell behind, and its size", () => {
    const steps = clockSteps(VIDEO);
    expect(steps).toHaveLength(1);
    expect(steps[0].t).toBe(4151.8);
    expect(steps[0].behind).toBeCloseTo(0.212, 2);
  });
  it("does not read the film's end as falling behind", () => {
    expect(filmEnd(ENDED)).toBe(72);
    expect(playing(ENDED).at(-1).at).toBe(4.105797);
    expect(clockSteps(ENDED)).toHaveLength(1);
  });
  it("has nothing to say of a run with no film", () => {
    expect(filmEnd([])).toBeNull();
    expect(playing([])).toEqual([]);
    expect(clockSteps([])).toEqual([]);
  });
});

describe("the film's picture", () => {
  it("is not fooled by a late callback after a page stop", () => {
    expect(pictureSkips(SHOWN)).toEqual([]);
  });
  it("finds film time that passed with no frame presented", () => {
    const skips = pictureSkips([[1000, 10.0, 240], [1500, 10.5, 242]]);
    expect(skips).toHaveLength(1);
    expect(skips[0].skipped).toBeCloseTo(0.4167, 3);
    expect(skips[0].t).toBe(1500);
  });
  it("places a skip by the frame's presentation time when the run has it", () => {
    expect(pictureSkips([[1000, 10.0, 240, 990], [1500, 10.5, 242, 1480]])[0].t).toBe(1480);
  });
  it("reads the film's rate from frames one apart, and takes 24 where there are none", () => {
    expect(filmRate(SHOWN)).toBeCloseTo(24, 1);
    expect(filmRate([])).toBe(24);
  });
});
