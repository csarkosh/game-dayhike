import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the mode group", () => {
  it("keeps settings.ts and pauseMenu.ts free of the game's modes", () => {
    expect(sourceText("game/settings.ts")).not.toContain("gameMode.js");
    expect(sourceText("game/pauseMenu.ts")).not.toContain("gameMode.js");
  });
});
