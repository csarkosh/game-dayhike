import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the renderer and the app", () => {
  const app = sourceText("app.ts");

  it("the console holds the crowd on, off or at a count, as it holds the way's mist: the engine's half", () => {
    // The hike applies its own commands (`applyOwnView`, `hike.ts`), which the page asks before its own.
    expect(app).toContain("if (side.applyOwnView(name, args)) return;");
  });
});
