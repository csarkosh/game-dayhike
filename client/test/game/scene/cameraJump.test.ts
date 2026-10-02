import { describe, expect, it } from "vitest";
import { cameraJumped } from "../../../src/game/scene/cameraJump.js";

describe("a jump of the camera", () => {
  it("is a move of more than 50 m between two drawn frames; the first drawn frame has nothing to jump from", () => {
    expect(cameraJumped(null, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(cameraJumped({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 40 })).toBe(false);
    expect(cameraJumped({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 41 })).toBe(true);
  });
});
