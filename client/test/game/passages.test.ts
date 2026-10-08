import { describe, expect, it } from "vitest";
import { DEATH_LINE, DEATH_TITLE, WON_LINE, WON_TITLE, ROAD_LINE_U, roadLine } from "../../src/game/passages.js";
import { Phase } from "../../src/sim/types.js";

describe("the end's titles", () => {
  it("are two words each, you and the verb, for the HUD to draw in the title screen's voice", () => {
    expect(WON_TITLE).toBe("You lived");
    expect(DEATH_TITLE).toBe("You died");
  });
});

describe("the passages", () => {
  it("closes a player's story on death, and the match by who came down", () => {
    // Both the title's shape: three parts and a turn; the counting is the title's alone. The win's
    // turn is as many words as the title's ("and the peculiar conviction that the woods were counting us.").
    for (const line of [DEATH_LINE, WON_LINE]) {
      expect(line).toMatch(/^(A|The) [^;]+; [^;]+; and [^.]+\.$/);
      expect(line).not.toMatch(/count/i);
    }
    expect(WON_LINE.split("; ")[2]?.split(" ")).toHaveLength(10);
  });
});

describe("roadLine", () => {
  it("speaks within half a metre of the wall on the climb, and never in the chase", () => {
    expect(roadLine(ROAD_LINE_U + 0.01, Phase.Climb)).toBeNull();
    expect(roadLine(ROAD_LINE_U, Phase.Climb)).toBe("Not yet. Somebody is still up there.");
    expect(roadLine(ROAD_LINE_U - 1, Phase.Chase)).toBeNull();
  });
});
