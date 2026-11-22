import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

const src = (name: string): string => sourceText(`game/${name}`);

describe("what the post chain's passes are drawn with", () => {
  it("names nothing of Babylon.js", () => {
    expect(src("postFrame.ts")).not.toMatch(/@babylonjs/);
  });
});
