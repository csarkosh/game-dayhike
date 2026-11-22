import { describe, it, expect } from "vitest";
import { PositionHistory } from "../../src/sim/history.js";
import { LAG_COMP_HISTORY_TICKS } from "../../src/sim/constants.js";

describe("PositionHistory", () => {
  it("returns what was recorded for a tick", () => {
    const h = new PositionHistory();
    h.recordPositions(10, new Map([[1, { x: 1, y: 2, z: 3 }]]));
    expect(h.at(10)?.get(1)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("returns undefined for a tick never recorded", () => {
    expect(new PositionHistory().at(5)).toBeUndefined();
  });

  it("forgets ticks older than the buffer", () => {
    const h = new PositionHistory();
    for (let t = 0; t < LAG_COMP_HISTORY_TICKS * 2; t++) {
      h.recordPositions(t, new Map([[1, { x: t, y: 0, z: 0 }]]));
    }
    expect(h.at(0)).toBeUndefined();
    expect(h.at(LAG_COMP_HISTORY_TICKS * 2 - 1)?.get(1)?.x).toBe(LAG_COMP_HISTORY_TICKS * 2 - 1);
  });

  it("copies positions so later mutation does not rewrite history", () => {
    const h = new PositionHistory();
    const pos = { x: 1, y: 1, z: 1 };
    h.recordPositions(1, new Map([[7, pos]]));
    pos.x = 999;
    expect(h.at(1)?.get(7)?.x).toBe(1);
  });
});
