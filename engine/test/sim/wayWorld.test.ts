import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the world's way down", () => {
  it("the app steps the draw every frame on the host and on a client, from ten seconds in: the engine's half", () => {
    const app = sourceText("app.ts");
    // One frame, which the host and a client both run (`appFrame.test.ts`).
    expect(app).toContain("    side.beforeSync(live.world, state, live.localEntityId, dt);");
    expect(app).toContain("frame(host, state, cmd, dt);");
    expect(app).toContain("frame(client, state, cmd, dt);");
  });

  it("the app has the way drawn by the threshold, and turns the player to it and runs them down it, wherever it then lies: the engine's half", () => {
    const app = sourceText("app.ts");
    // One tick step, which the host and a client both run (`appFrame.test.ts`).
    expect(app).toContain("cmd = side.command(input.sample(++seq), me, live.world);");
    expect(app).toContain("const cmd = stepTicks(host, ticks);");
    expect(app).toContain("const cmd = stepTicks(client, ticks);");
  });
});
