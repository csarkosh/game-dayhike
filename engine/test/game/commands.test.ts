import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("a game's own commands", () => {
  it("keeps commands.ts free of the game's modes and the app registering the hike's: the engine's half", () => {
    expect(sourceText("game/commands.ts")).not.toContain("gameMode");
  });
});
