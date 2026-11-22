import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import environmentBrdf from "../../../src/game/lite/environmentBrdf.png?inline";
import { sourceText } from "../../helpers/source.js";

describe("the sky's capture on Babylon Lite", () => {
  it("weighs the reflection by the table the game keeps: a PNG of 256 by 256, held to its size and its bytes", () => {
    const png = readFileSync(new URL("../../../src/game/lite/environmentBrdf.png", import.meta.url));
    // The PNG's signature, and its header's size.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
    expect(png.length).toBe(23_494);
    expect(createHash("sha256").update(png).digest("hex")).toBe("f10818901fccd58cd708fef7979daa3a37294b0bca53f450dc37e1589419813d");
    // The renderer is handed those bytes as a data URL, and nothing else.
    expect(environmentBrdf).toBe(`data:image/png;base64,${png.toString("base64")}`);
    const capture = sourceText("game/lite/skyCapture.ts");
    expect(capture).toContain('import environmentBrdf from "./environmentBrdf.png?inline";');
    expect(capture).toContain("brdfUrl: environmentBrdf,");
  });
});
