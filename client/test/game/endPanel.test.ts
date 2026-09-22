import { describe, expect, it } from "vitest";
import { endPanelModel } from "../../src/game/endPanel.js";
import { END_PASSAGES } from "../../src/game/passages.js";

describe("endPanelModel", () => {
  const p = (id: number, name: string, safe: boolean, dead: boolean) => ({ id, name, safe, dead });
  it("groups the survived and the perished in join order and picks the passage by the groups", () => {
    const view = endPanelModel([p(3, "Wren", true, false), p(1, "You", false, true), p(2, "Ash", true, false)]);
    expect(view.survived).toEqual(["Ash", "Wren"]);
    expect(view.perished).toEqual(["You"]);
    expect(view.passage).toBe(END_PASSAGES.some);
  });
  it("reads all when nobody died and none when nobody came down", () => {
    expect(endPanelModel([p(1, "You", true, false)]).passage).toBe(END_PASSAGES.all);
    expect(endPanelModel([p(1, "You", false, true), p(2, "Ash", false, true)]).passage).toBe(END_PASSAGES.none);
  });
});
