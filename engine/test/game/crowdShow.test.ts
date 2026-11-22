import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the renderer and the app", () => {
  const app = sourceText("app.ts");

  it("the app steps this screen's crowd every frame on the host and on a client, before the renderer's own sync: the engine's half", () => {
    expect(app).toContain("    side.beforeSync(live.world, state, live.localEntityId, dt);");
    expect(app.match(/\bframe\((?:host|client), state, cmd, dt\);/g)).toHaveLength(2);
    // A player their crowd has says so to the host in every command until their death is seen, on the host and on a client alike.
    expect(app).toContain("cmd = side.command(input.sample(++seq), me, live.world);");
    expect(app.match(/const cmd = stepTicks\((?:host|client), ticks\);/g)).toHaveLength(2);
  });

  it("the console holds the crowd on, off or at a count, as it holds the way's mist: the engine's half", () => {
    // The hike applies its own commands (`applyOwnView`, `hike.ts`), which the page asks before its own.
    expect(app).toContain("if (side.applyOwnView(name, args)) return;");
  });
});
