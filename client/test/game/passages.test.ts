import { describe, expect, it } from "vitest";
import { DEATH_LINE, WON_LINE, ROAD_LINE_U, roadLine } from "../../src/game/passages.js";
import { Phase } from "../../src/sim/types.js";

describe("the passages", () => {
  it("closes a player's story on death, and the match by who came down", () => {
    // Both the title's shape: three parts and a turn; the death's turn unsettling, the win's a relief.
    expect(DEATH_LINE).toMatch(/^A [^;]+; [^;]+; and [^.]+\.$/);
    expect(DEATH_LINE).toMatch(/counting/);
    expect(WON_LINE).toMatch(/^A [^;]+; [^;]+; and [^.]+\.$/);
    expect(WON_LINE).toMatch(/one fewer/);
  });
});

describe("roadLine", () => {
  it("speaks within half a metre of the wall on the climb, and never in the chase", () => {
    expect(roadLine(ROAD_LINE_U + 0.01, Phase.Climb)).toBeNull();
    expect(roadLine(ROAD_LINE_U, Phase.Climb)).toBe("Not yet. Somebody is still up there.");
    expect(roadLine(ROAD_LINE_U - 1, Phase.Chase)).toBeNull();
  });
});
