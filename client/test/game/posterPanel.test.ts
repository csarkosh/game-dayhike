import { describe, expect, it } from "vitest";
import { posterModel } from "../../src/game/posterPanel.js";

describe("posterModel", () => {
  it("reads MISSING, the name, and where they were last seen", () => {
    const view = posterModel({ hiker: { name: "Dana Whitcombe" }, body: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }, box: { x: 0, y: 1, z: 0 }, car: { x: 0, y: 0, z: 0 } });
    expect(view.title).toBe("MISSING");
    expect(view.name).toBe("Dana Whitcombe");
    expect(view.lines).toEqual(["Last seen on the summit trail.", "If you have seen them, call the ranger station."]);
  });
});
