import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sourceText } from "../helpers/source.js";

/**
 * The page that runs a hike (`app.ts`) is handed the game as one definition and names nothing of
 * Day Hike's by itself: every maker, list and rule of the game's reaches it through that object.
 */
describe("the page that runs a hike", () => {
  const app = sourceText("app.ts");

  it("is the engine's and names no game: every module it imports is the engine's own: the engine's half", () => {
    // It stands in the engine's package, where no module may import the game's (`architecture.test.ts`), and
    // its own imports are of its neighbours there alone.
    expect(existsSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)))).toBe(true);
    const specs = [...app.matchAll(/^import [^\n]*?from "([^"]+)";$/gm)].map((m) => m[1] as string);
    expect(specs.length).toBeGreaterThan(40);
    for (const spec of specs) expect(spec.startsWith("./"), spec).toBe(true);
  });

  it("is handed the game, and the game's page hands it Day Hike: the engine's half", () => {
    // Whatever game: its world, state, player, renderer, bus, HUD and sessions are the definition's type parameters.
    expect(app).toContain(">(canvas: HTMLCanvasElement, token: string, options: GameOptions, game: SessionGame<W, S, P, R, A, H, HostS, ClientS>): GameHandle {");
    expect(sourceText("shell.ts")).toMatch(/const handle = startGame\(onCanvas\.canvas, worldToken, \{[\s\S]*?\n {4}\}, page\.game\);/);
  });

  it("makes its renderer, its bus, its HUD, its sessions and the game's half of the hike through the definition", () => {
    for (const call of ["game.renderer(", "game.audio()", "game.hud(", "game.side({", "game.host(", "game.join(", "game.startOf(seed)", "parseLevel(game.level)"]) expect(app, call).toContain(call);
    expect(app.split("game.renderer(").length - 1).toBe(2);
    expect(app.split("actions: game.actions").length - 1).toBe(2);
  });
});
