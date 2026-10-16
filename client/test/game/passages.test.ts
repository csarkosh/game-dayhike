import { describe, expect, it } from "vitest";
import {
  DEATH_FADE_AFTER_MS, DEATH_LINE, DEATH_SOUND_FADE_S, DEATH_TITLE, WON_LINE, WON_TITLE, ROAD_LINE_U, atRoadWall,
} from "../../src/game/passages.js";
import { DIED_CLOSE_FROM_S } from "../../src/game/ending.js";
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

describe("the death's sound", () => {
  it("fades over five seconds from the dark's closing, gone at six as the HUD's black begins", () => {
    expect(DEATH_SOUND_FADE_S).toBe(5);
    expect(DIED_CLOSE_FROM_S + DEATH_SOUND_FADE_S).toBe(6);
    expect(DEATH_FADE_AFTER_MS).toBe(6000);
  });
});

describe("atRoadWall", () => {
  it("is within half a metre of the wall on the climb, and never in the chase or on a peaceful world", () => {
    expect(atRoadWall(ROAD_LINE_U + 0.01, Phase.Climb)).toBe(false);
    expect(atRoadWall(ROAD_LINE_U, Phase.Climb)).toBe(true);
    expect(atRoadWall(ROAD_LINE_U - 1, Phase.Chase)).toBe(false);
    expect(atRoadWall(ROAD_LINE_U - 1, Phase.Climb, true)).toBe(false);
    expect(atRoadWall(-30, Phase.Climb, true)).toBe(false);
  });
});
