import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

describe("the hike's renderer on Babylon Lite, before its engine stands", () => {
  it("says nothing of the lake's life until a frame of its own has stepped it: the silent sound, which the hike's audio fades the old renderer's hums out by: the engine's half", () => {
    const text = sourceText("game/lite/renderer.ts");
    expect(text).toContain("      return heardLife !== null && waterLifeStepped ? heardLife.sound() : SILENT_WATER_LIFE;");
    expect(text).toContain("  let waterLifeStepped = false;");
    // Stepped in one place, by a frame that drew a lake's life; a frame that did not takes the word back.
    expect([...text.matchAll(/\bwaterLifeStepped = true;/g)].length).toBe(1);
    expect([...text.matchAll(/\bwaterLifeStepped = false;/g)].length).toBe(2);
  });

  it("says nothing of the surf until a frame of its own has stepped the sea: silence, never the last frame's record again: the engine's half", () => {
    const text = sourceText("game/lite/renderer.ts");
    expect(text).toContain("      return surfStepped ? surf : SILENT_SURF_SOUND;");
    // Stepped in one place, by a frame that stepped the sea's edge; every frame takes the word back first.
    expect([...text.matchAll(/\bsurfStepped = true;/g)].length).toBe(1);
    expect([...text.matchAll(/\bsurfStepped = false;/g)].length).toBe(2);
  });
});
