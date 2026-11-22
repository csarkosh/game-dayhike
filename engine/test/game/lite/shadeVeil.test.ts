import { describe, expect, it } from "vitest";
import { holdTexture } from "../../../src/game/lite/shadeVeil.js";
import { binder, picture } from "../../../testing/textureClaims.js";
import { sourceText } from "../../helpers/source.js";

const src = sourceText("game/lite/shadeVeil.ts");

describe("the shade veil on Babylon Lite", () => {
  it("is multiplied into the frame, over everything, and writes no depth", () => {
    expect(src).toContain('color: { srcFactor: "dst", dstFactor: "zero", operation: "add" }');
    expect(src).toContain('depthCompare: "always"');
    expect(src).toContain("depthWrite: false");
    expect(src).toContain("mesh.renderOrder = SEE_THROUGH_ORDER.veil;");
  });

  it("holds the black texel through the mask's binding in its place, which is otherwise its last release", () => {
    // Lite destroys a texture when the last claim on it is let go, and a texel only the veil's material ever bound
    // has no other: the first figure in the mask would destroy it, and the stare's darkness read it after.
    const unheld = picture();
    const mask = picture();
    const loose = binder();
    loose(unheld);
    loose(mask);
    expect(unheld.texture.destroyed).toBe(true);
    // Held, it stands through every figure that comes and goes, and goes when the veil lets it.
    const black = picture();
    const letGo = holdTexture(black);
    const bind = binder();
    for (let figure = 0; figure < 3; figure++) {
      bind(black);
      bind(mask);
      expect(black.texture.destroyed).toBe(false);
    }
    letGo();
    expect(black.texture.destroyed).toBe(true);
    // Let go once and no more: the claim is one.
    const again = picture();
    const once = holdTexture(again);
    const other = holdTexture(again);
    once();
    once();
    expect(again.texture.destroyed).toBe(false);
    other();
    expect(again.texture.destroyed).toBe(true);
    // The veil holds its texel from the start and lets it go with itself.
    expect(src).toContain("const letGo = holdTexture(black);");
    expect(src).toContain("letGo();");
  });
});
