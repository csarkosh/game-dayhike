import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("whose voices are whose", () => {
  it("the bus names none of a game's voices and hands its side the graph after the world's is wired", () => {
    const text = sourceText("game/ambientAudio.ts");
    expect(text).not.toMatch(/stareAudio|chaseAudio|oddSounds|carAudio|hikeAudio|woodsVoice/);
    const wired = text.indexOf("limiter.connect(scene);");
    const handed = text.indexOf("side.unlocked({ ctx, noise, world, scene, master, ear, random, muffle });");
    const applied = text.indexOf("applyGains(pending);", handed);
    expect(wired).toBeGreaterThan(0);
    expect(handed).toBeGreaterThan(wired);
    expect(applied).toBeGreaterThan(handed);
  });

  it("the hike's bus is the bus made with the hike's side, and the hike makes that one: the engine's half", () => {
    // The page makes the bus of the game it is handed, which for Day Hike is the hike's (`hikeGame.ts`).
    expect(sourceText("app.ts")).toContain("const ambient = game.audio();");
  });
});
