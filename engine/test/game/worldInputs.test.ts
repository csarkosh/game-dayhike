import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the seed and the terrain a hike's world is made from", () => {
  it("is the rule the build itself reads its seed and terrain by", () => {
    const code = (file: string): string => sourceText(`${file}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const app = code("app.ts");
    expect(app).toContain("const { seed, variant } = worldInputs(token, location.search);");
    expect(app).toContain("setActiveTerrainVariant(variant);");
    // One place reads a seed from the token.
    expect(app).not.toContain("seedFromToken(");
  });

  it("is what the page starts the world's worker with, which the start waits for and a start left ends", () => {
    const main = sourceText("shell.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(main.match(/\bstartWorldPrep\(/g)).toEqual(["startWorldPrep("]);
    expect(main).toContain("const prep = startWorldPrep(worldInputs(route.token, location.search), page.worldWorker);");
    expect(main).toContain("prepOutcome = await prep.ready;");
    // A render that moves on, and a start that fails, end the worker; a start that built lets go of it and its scene.
    expect(main.match(/prep\.dispose\(\);/g)).toHaveLength(3);
  });

  it("asks the worker for the hike's first scene once, at the tier decided, waits for it before the build and hands it to the build once", () => {
    const main = sourceText("shell.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(main.match(/prep\.scene\(/g)).toEqual(["prep.scene("]);
    expect(main).toContain("sampling = prep.scene(decided.tier);");
    // After the world is ready, so the wait for it is its own lap.
    const wait = main.slice(main.indexOf("prepOutcome = await prep.ready;"), main.indexOf("paint: () =>"));
    expect(wait).toContain("sampled = await sampling;");
    expect(wait).toContain('lap("scene");');
    // Nothing here holds the scene past the wait: the promise that carried it is let go of at once.
    expect(wait).toContain("sampled = await sampling;\n        sampling = Promise.resolve(null);");
    // The game is handed the way to take it, never the scene: the first renderer made takes it, and a start
    // made again finds none left.
    expect(main).toContain("takePrepared: takeSampled,");
    expect(main).not.toContain("takeSampled()");
    expect(main).toContain('scene: sampledFor === null ? "none" : "made",');
  });

  it("hands the scene to the hike's first renderer at the tier asked for, and to no other", () => {
    const app = sourceText("app.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // The one renderer made with it: the ladder's first attempt, which takes it as it is built.
    expect(app.match(/prepared: /g)).toEqual(["prepared: "]);
    const first = app.slice(app.indexOf("const first = buildFirstRenderer("), app.indexOf("let renderer: R = first.renderer;"));
    expect(first).toContain("prepared: options.takePrepared?.() ?? null,");
    // The game's options, which it keeps for the hike, never hold the scene itself: a renderer made later
    // would otherwise stand beside the first one's dead arrays.
    expect(app).not.toMatch(/\bprepared\?: PreparedScene/);
    expect(app).not.toContain("options.prepared");
  });

  it("does not register the game's terrain itself: the page's entry does: the engine's half", () => {
    expect(sourceText("game/worldInputs.ts")).not.toContain("passes/index");
  });

  it("is handed the way to start the world's worker by the page: the engine's half", () => {
    expect(sourceText("shell.ts")).toContain("startWorldPrep(worldInputs(route.token, location.search), page.worldWorker)");
  });
});
