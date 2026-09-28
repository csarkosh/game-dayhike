import { describe, expect, it } from "vitest";
import { POSTER_LAST_SEEN, posterBoardLines, posterModel } from "../../src/game/posterPanel.js";

const search = { hiker: { name: "Dana Whitcombe" }, body: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }, poster: { x: 0, y: 1, z: 0 }, car: { x: 0, y: 0, z: 0 } };

describe("posterModel", () => {
  it("reads MISSING, the name, and where they were last seen", () => {
    const view = posterModel(search);
    expect(view.title).toBe("MISSING");
    expect(view.name).toBe("Dana Whitcombe");
    expect(view.lines).toEqual(["Last seen at Trail 14.", "If you have seen them, call the ranger station."]);
  });
});

describe("the poster painted on the board", () => {
  it("names the trail as the panel does", () => {
    expect(POSTER_LAST_SEEN).toBe("Last seen at Trail 14.");
    expect(posterBoardLines(search)).toEqual(["MISSING", "Dana Whitcombe", "Last seen at Trail 14."]);
  });
});
