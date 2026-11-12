import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seedFromToken } from "../../src/game/seed.js";
import { worldInputs } from "../../src/game/worldInputs.js";

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

  it("is the rule the build itself reads its seed and terrain by", () => {
    const code = (file: string): string => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const app = code("app.ts");
    expect(app).toContain("const { seed, variant } = worldInputs(token, location.search);");
    expect(app).toContain("setActiveTerrainVariant(variant);");
    // One place reads a seed from the token.
    expect(app).not.toContain("seedFromToken(");
  });

  it("is what the page starts the world's worker with, which the start waits for and a start left ends", () => {
    const main = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(main.match(/\bstartWorldPrep\(/g)).toEqual(["startWorldPrep("]);
    expect(main).toContain("const prep = startWorldPrep(worldInputs(route.token, location.search));");
    expect(main).toContain("prepOutcome = await prep.ready;");
    // A render that moves on, and a start that fails, end the worker.
    expect(main.match(/prep\.dispose\(\);/g)).toHaveLength(2);
  });
});
