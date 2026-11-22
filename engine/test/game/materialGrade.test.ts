import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

const src = (name: string): string => sourceText(`game/${name}`);

describe("the grade on the material colour path", () => {
  it("makes a frame's whole grade from the weather and the grade's record: the engine's half", () => {
    expect(src("materialGrade.ts")).not.toMatch(/@babylonjs/);
  });
});
