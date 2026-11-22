import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the renderer and the app", () => {
  const app = sourceText("app.ts");

  it("the app reports the way once it is settled: its length, its straight line and whether it is the fallback: the engine's half", () => {
    // Once in all: in `hike.ts`, and not again in `app.ts`.
    expect(app).not.toContain('telemetry.event("way"');
  });
});
