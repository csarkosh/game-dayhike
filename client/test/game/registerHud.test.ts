import { describe, expect, it } from "vitest";
import { ROAD_LINE_U, WIN_LINE, roadLine } from "../../src/game/registerHud.js";
import { ROAD_WALL_U } from "../../src/sim/containment.js";

describe("roadLine", () => {
  it("speaks within half a metre of the wall and not beyond", () => {
    expect(ROAD_LINE_U).toBeCloseTo(ROAD_WALL_U + 0.5, 9);
    expect(roadLine(ROAD_WALL_U, false)).toBe("I need to find those missing hikers first.");
    expect(roadLine(ROAD_WALL_U + 0.49, false)).not.toBeNull();
    expect(roadLine(ROAD_WALL_U + 0.51, false)).toBeNull();
  });

  it("points at the car once every hiker is signed out", () => {
    expect(roadLine(ROAD_WALL_U, true)).toBe("Get to the car.");
  });

  it("has the win line", () => {
    expect(WIN_LINE).toBe("You signed them out.");
  });
});
