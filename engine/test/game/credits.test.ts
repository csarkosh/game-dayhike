import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { sourceText } from "../helpers/source.js";

describe("creditsModel", () => {
  it("credits the library the game is drawn with, its environment BRDF table and its tone map, each under its licence and each for something the tree holds: the engine's half", () => {
    // What each names: the dependency pinned to that source, the table as a file of the game's, and the tone map's notice beside its numbers.
    expect(existsSync(new URL("../../src/game/lite/environmentBrdf.png", import.meta.url))).toBe(true);
    expect(sourceText("game/gradeParams.ts")).toContain("ported from three.js, MIT License, Copyright 2010-2024 three.js authors");
  });
});
