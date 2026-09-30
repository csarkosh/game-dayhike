import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptionPanel } from "../../../src/game/scene/captions.js";
import { asHtml, installStandInDom } from "../helpers/standInDom.js";

afterEach(() => vi.unstubAllGlobals());

describe("the caption panel", () => {
  it("writes the caption's text and marks the radio, and clears", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const panel = createCaptionPanel(asHtml(container));
    panel.set({ from: 1, to: 2, text: "Four-one, dispatch.", radio: true });
    const node = container.querySelector("div.scene-caption");
    expect(node?.textContent).toBe("Four-one, dispatch.");
    expect(node?.classList.contains("radio")).toBe(true);
    panel.set(null);
    expect(node?.textContent).toBe("");
    expect(node?.classList.contains("radio")).toBe(false);
    panel.dispose();
    expect(container.querySelector("div.scene-caption")).toBeNull();
  });
});
