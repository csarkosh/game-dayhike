import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("input suppression", () => {
  it("is handed the hike's own bits by the hike's page, as the touch layer is: the engine's half", () => {
    const app = sourceText("app.ts");
    // The page hands both the bits of the game it is handed, which for Day Hike are the hike's own (`hikeGame.ts`).
    expect(app).toContain("{ onPause: () => input.disengage(), actions: game.actions },");
    expect(app).toContain("startYaw: start?.yaw ?? 0, actions: game.actions });");
  });
});
