import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the keys the page keeps in the browser", () => {
  it("are made from the identity where they are used: the engine's source holds no key of Day Hike's", () => {
    for (const file of ["game/tierChoice.ts", "game/muteButton.ts", "net/telemetry.ts"]) {
      const literals = sourceText(file).match(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect(literals.filter((text) => text.includes("dayhike.")), file).toEqual([]);
    }
  });
});

describe("the shell's line for a last session ended by a graphics restart", () => {
  it("is made from the game's session word, and reads as Day Hike's always has: the engine's half", () => {
    expect(sourceText("shell.ts")).toContain("`The last ${page.identity.session} ended because the graphics could not be restarted.`");
  });
});

describe("the desktop app's token in its user agent", () => {
  it("is read from the identity: the engine's platform source holds no DayHike", () => {
    expect(sourceText("game/platform.ts")).not.toContain("DayHike");
  });
});

describe("the engine's console and error lines that name a session", () => {
  it("hold no word of Day Hike's: each is made from the game's session word", () => {
    for (const file of ["shell.ts", "game/frameProbe.ts", "game/rendererSwap.ts", "game/engineFailure.ts", "game/lite/renderer.ts"]) {
      const code = sourceText(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const literals = code.match(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect(literals.filter((text) => /hike/i.test(text.replaceAll("hikeFrame", ""))), file).toEqual([]);
    }
  });
});
