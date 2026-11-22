import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("a game's own of the name", () => {
  it("is Day Hike's key and word for Day Hike, as they have always been: the engine's half", () => {
    expect(sourceText("shell.ts")).toContain("{ key: `${page.identity.storage}.playerName`, prefix: page.identity.player }");
    // The shell loads and saves it under whatever key the game hands it.
    expect(sourceText("shell.ts")).toContain("  let selfName = loadName(selfNameOf);");
    expect(sourceText("shell.ts")).toContain("      selfName = saveName(selfNameOf, raw);");
  });
});
