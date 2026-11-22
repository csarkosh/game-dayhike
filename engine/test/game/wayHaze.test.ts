import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the renderer", () => {
  // The engine's renderer alone: Day Hike's side of it (`lite/hikeParts.ts`) is read by the game's suite.
  const renderer = sourceText("game/lite/renderer.ts");

  it("lays the haze on the frame's air only where no chain grades the frame, in the mist's own colour under the chase's cast: the engine's half", () => {
    expect(renderer).toContain("if (made.chain === null) side.haze(airValues);");
    // After the air's record is written for the frame, so it never builds on itself.
    expect(renderer.indexOf("atmosphereUniforms(light.air, cloud,")).toBeLessThan(renderer.indexOf("side.haze(airValues"));
    // The engine's renderer names no haze of its own: the one `wayHazeInto(` is Day Hike's.
    expect(renderer.match(/wayHazeInto\(/g) ?? []).toHaveLength(0);
  });
});
