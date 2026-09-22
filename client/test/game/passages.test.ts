import { describe, expect, it } from "vitest";
import { DEATH_LINE, END_PASSAGES, ROAD_LINE_U, roadLine } from "../../src/game/passages.js";
import { Phase } from "../../src/sim/types.js";

describe("the passages", () => {
  it("closes a player's story on death, and the match by who came down", () => {
    expect(DEATH_LINE).toMatch(/missing/);
    expect(END_PASSAGES.all).toMatch(/every one of you/);
    expect(END_PASSAGES.some).toMatch(/Not all of you/);
    expect(END_PASSAGES.none).toMatch(/Nobody came down/);
  });
});

describe("roadLine", () => {
  it("speaks within half a metre of the wall on the climb, and never in the chase", () => {
    expect(roadLine(ROAD_LINE_U + 0.01, Phase.Climb)).toBeNull();
    expect(roadLine(ROAD_LINE_U, Phase.Climb)).toBe("Not yet. Somebody is still up there.");
    expect(roadLine(ROAD_LINE_U - 1, Phase.Chase)).toBeNull();
  });
});
