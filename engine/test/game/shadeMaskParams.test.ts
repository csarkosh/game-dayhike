import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

const src = (name: string): string => sourceText(`game/${name}`);

describe("what the haunt's figures are drawn into their mask with", () => {
  it("names nothing of Babylon.js", () => {
    expect(src("shadeMaskParams.ts")).not.toMatch(/@babylonjs/);
  });
});
