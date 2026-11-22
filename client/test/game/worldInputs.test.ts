import { describe, expect, it } from "vitest";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import "../../src/sim/passes/index.js";
import { worldInputs } from "@csarkosh/engine/game/worldInputs";
import { sourceText } from "../helpers/source.js";

describe("the seed and the terrain a hike's world is made from", () => {
  it("takes the seed from the token, and the default terrain", () => {
    expect(worldInputs("abc-123", "")).toEqual({ seed: seedFromToken("abc-123"), variant: "olympic" });
    expect(worldInputs("abc-123", "?tier=low&engine=webgl2")).toEqual({ seed: seedFromToken("abc-123"), variant: "olympic" });
  });

  it("takes a seed and a terrain the address names, the last of each", () => {
    // The address's script: entries apart by `;`, a name and its arguments by a space.
    const search = `?cmd=${encodeURIComponent("seed first;terrain olympic;seed atmo;terrain montane")}`;
    expect(worldInputs("abc", search)).toEqual({ seed: seedFromToken("atmo"), variant: "montane" });
  });

  it("knows the terrains on a page that has parsed no script yet", () => {
    // A cold page: nothing has told the command layer the terrains' names, and an entry it cannot validate is dropped.
    expect(worldInputs("abc", "?cmd=terrain%20montane;freecam").variant).toBe("montane");
  });

  it("keeps the default terrain when the address names one that does not exist", () => {
    expect(worldInputs("abc", "?cmd=terrain%20nowhere")).toEqual({ seed: seedFromToken("abc"), variant: "olympic" });
  });

  it("does not register the game's terrain itself: the page's entry does", () => {
    expect(sourceText("main.ts")).toContain('import "./sim/passes/index.js";');
  });

  it("is handed the way to start the world's worker by the page", () => {
    expect(sourceText("hikePageGame.ts")).toContain("worldWorker: startHikeWorldWorker,");
  });
});
