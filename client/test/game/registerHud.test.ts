import { describe, expect, it } from "vitest";
import { DEATH_LINE, LOSS_LINE, LOSS_LANDING_MS, ROAD_LINE_U, WIN_LINE, roadLine } from "../../src/game/registerHud.js";
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

describe("the passages", () => {
  it("closes a player's story on death, and the match on the loss", () => {
    expect(DEATH_LINE).toBe("The woods had counted you among the missing before you knew that you were lost.");
    expect(LOSS_LINE).toBe("Nobody signed out. The book was closed from the bottom, by a hand that was not a hand, and the woods went back to counting.");
    expect(LOSS_LANDING_MS).toBe(8000);
  });
});
