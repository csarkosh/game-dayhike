import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the world's work and its two sides, by their source", () => {
  const code = (path: string): string => sourceText(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("names no game and no worker by path in the page's side or the work", () => {
    for (const file of ["game/worldPrep.ts", "game/worldWork.ts"]) {
      expect(sourceText(file), file).not.toContain("new URL(");
      expect(code(file), file).not.toContain("world.worker");
      expect(sourceText(file), file).not.toContain("sim/spawn");
      expect(sourceText(file), file).not.toContain("passes/index");
    }
  });
});
