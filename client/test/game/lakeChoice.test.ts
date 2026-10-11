import { describe, expect, it } from "vitest";
import { LAKE_LIFE_REACH, LAKE_RETARGET_LEAD, createLakeChoice } from "../../src/game/lakeChoice.js";
import { timeLimit } from "../helpers/timeLimit.js";

// Two lakes 300 m apart, each its ground 50 m about its centre: the camera
// stands equally far past both bounds at x = 150.
const TWO = [{ x: 0, z: 0, bound: 50 }, { x: 300, z: 0, bound: 50 }];

describe("the lake served", { timeout: timeLimit(10_000) }, () => {
  it("states its lead and its reach", () => {
    expect([LAKE_RETARGET_LEAD, LAKE_LIFE_REACH]).toEqual([20, 250]);
  });

  it("serves the nearest lake by the distance past its bound", () => {
    expect(createLakeChoice(TWO).choose(10, 0)!.index).toBe(0);
    expect(createLakeChoice(TWO).choose(290, 40)!.index).toBe(1);
    // Inside a bound counts as 0, not less: the first such holds.
    const nested = createLakeChoice([{ x: 0, z: 0, bound: 100 }, { x: 10, z: 0, bound: 50 }]);
    expect(nested.choose(10, 0)!.index).toBe(0);
  });

  it("holds through a camera swinging 5 m either side of the midpoint, and moves only once another is 20 m nearer", () => {
    const c = createLakeChoice(TWO);
    const first = c.choose(0, 0)!;
    expect(first.index).toBe(0);
    for (let k = 0; k < 40; k++) {
      // 145 to 155: 95 to 105 m past each bound, never 20 m between them
      expect(c.choose(150 + 5 * Math.sin(k), 0)).toBe(first);
    }
    // At 159: 109 past the first, 91 past the second, 18 nearer. At 161: 22 nearer.
    expect(c.choose(159, 0)).toBe(first);
    const second = c.choose(161, 0)!;
    expect(second.index).toBe(1);
    // And back: held until the first is 20 m nearer, at 139.
    for (let k = 0; k < 40; k++) expect(c.choose(150 + 5 * Math.sin(k), 0)).toBe(second);
    expect(c.choose(141, 0)).toBe(second);
    expect(c.choose(139, 0)).toBe(first);
  });

  it("hands back the same record for a lake on every call, and fills one set of flags", () => {
    const c = createLakeChoice(TWO);
    const live = c.live;
    const a = c.choose(0, 0);
    expect(c.choose(1, 2)).toBe(a);
    expect(c.lakes[0]).toBe(a);
    expect(c.live).toBe(live);
    expect(a).toEqual({ index: 0, x: 0, z: 0, bound: 50 });
  });

  it("runs a lake's life within 250 m past its bound", () => {
    const c = createLakeChoice(TWO);
    // At the first's centre: 250 m past the second's bound, still in reach.
    c.choose(0, 0);
    expect(Array.from(c.live)).toEqual([1, 1]);
    c.choose(-1, 0);
    expect(Array.from(c.live)).toEqual([1, 0]);
    // 400 m out past both, along z.
    c.choose(150, 400);
    expect(Array.from(c.live)).toEqual([0, 0]);
  });

  it("serves none in a world with no lake", () => {
    const c = createLakeChoice([]);
    expect(c.choose(0, 0)).toBeNull();
    expect(c.live).toHaveLength(0);
  });
});
