import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the hike's page, for a return", () => {
  // The return and the outcome are the hike's own (`hike.ts`, where a variable of `app.ts` is written `h.<name>`); `app.ts` is read for what must stay out of it too.
  const app = sourceText("app.ts");

  it("ends a scene's letterbox and its stilled controls when the match is decided, so neither outlives into the end scene: the engine's half", () => {
    // One timer for every scene's bars: a later scene's start takes the earlier one's off.
    expect(app).not.toContain("setTimeout(() => { hud.setBars(false); downLook = null; }, SUMMIT_SCENE_S * 1000);");
  });

  it("gives the voice the cause on the frame of the return, and reports the death's real cause: the engine's half", () => {
    expect(app).not.toContain('cause: "hollow",');
  });
});
