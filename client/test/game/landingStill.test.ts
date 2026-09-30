import { afterEach, describe, expect, it, vi } from "vitest";
import { landingBackdrop } from "../../src/game/landingBackdrop.js";
import { installStandInDom } from "./helpers/standInDom.js";

afterEach(() => vi.unstubAllGlobals());

describe("the title page's backdrop", () => {
  it("is the still when it ships, and nothing when it does not", () => {
    installStandInDom();
    const withStill = landingBackdrop("/assets/intro.still-abc.webp");
    expect(withStill?.tagName).toBe("IMG");
    expect(withStill?.className).toBe("landing-bg ready");
    expect(withStill?.getAttribute("src")).toBe("/assets/intro.still-abc.webp");
    expect(withStill?.getAttribute("decoding")).toBe("async");
    expect(withStill?.getAttribute("alt")).toBe("");
    expect(landingBackdrop(null)).toBeNull();
  });
});
