import { describe, expect, it } from "vitest";
import "../../src/game/dayhikeAssets.js";
import { HIKE_GAME } from "../../src/hikeGame.js";
import { createHike } from "../../src/hike.js";
import { createHikeAudio } from "../../src/game/hikeAudio.js";
import { createHikeRenderer } from "../../src/game/hikeRenderer.js";
import { createHud } from "../../src/game/hud.js";
import { HIKE_MODES } from "../../src/game/gameMode.js";
import { trailheadStart } from "../../src/sim/spawn.js";
import { HIKE_ACTIONS } from "../../src/sim/types.js";
import { findCommand } from "@csarkosh/engine/game/commands";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sourceText } from "../helpers/source.js";

/**
 * The page that runs a hike (`app.ts`) is handed the game as one definition and names nothing of
 * Day Hike's by itself: every maker, list and rule of the game's reaches it through that object.
 */

describe("Day Hike as the page is handed it", () => {
  it("is one definition that holds the game's makers, lists and rules", () => {
    expect(HIKE_GAME.renderer).toBe(createHikeRenderer);
    expect(HIKE_GAME.audio).toBe(createHikeAudio);
    expect(HIKE_GAME.hud).toBe(createHud);
    expect(HIKE_GAME.side).toBe(createHike);
    expect(HIKE_GAME.startOf).toBe(trailheadStart);
    expect(HIKE_GAME.modes).toBe(HIKE_MODES);
    expect(HIKE_GAME.actions).toBe(HIKE_ACTIONS);
    expect(typeof HIKE_GAME.host).toBe("function");
    expect(typeof HIKE_GAME.join).toBe("function");
  });

  it("says whose the weather is by the mode: the explore day's own in the peaceful modes, the console's in the hike", () => {
    expect(HIKE_GAME.weatherIsOwn("game")).toBe(false);
    expect(HIKE_GAME.weatherIsOwn("explore")).toBe(true);
    expect(HIKE_GAME.weatherIsOwn("freecam")).toBe(true);
    expect(HIKE_GAME.weatherIsOwn("nothing")).toBe(false);
  });

  it("registers the hike's console commands where it is imported", () => {
    expect(findCommand("crowd")?.name).toBe("crowd");
    expect(sourceText("hikeGame.ts")).toContain('import "./game/hikeCommands.js";');
  });
});

describe("the page that runs a hike", () => {
  const app = sourceText("app.ts");

  it("is the engine's and names no game: every module it imports is the engine's own", () => {
    // It stands in the engine's package, where no module may import the game's (`architecture.test.ts`), and
    // its own imports are of its neighbours there alone.
    expect(existsSync(fileURLToPath(new URL("../../../engine/src/app.ts", import.meta.url)))).toBe(true);
    expect(existsSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)))).toBe(false);
    const specs = [...app.matchAll(/^import [^\n]*?from "([^"]+)";$/gm)].map((m) => m[1] as string);
    expect(specs.length).toBeGreaterThan(40);
    for (const spec of specs) expect(spec.startsWith("./"), spec).toBe(true);
  });

  it("is handed the game, and the game's page hands it Day Hike", () => {
    // Whatever game: its world, state, player, renderer, bus, HUD and sessions are the definition's type parameters.
    expect(app).toContain(">(canvas: HTMLCanvasElement, token: string, options: GameOptions, game: SessionGame<W, S, P, R, A, H, HostS, ClientS>): GameHandle {");
    expect(sourceText("hikeGame.ts")).toContain("export const HIKE_GAME: SessionGame<World, WorldState, PlayerState, Renderer, HikeAudio, Hud, HostSession, ClientSession> = {");
    expect(sourceText("main.ts")).toMatch(/const handle = startGame\(onCanvas\.canvas, worldToken, \{[\s\S]*?\n {2}\}, page\.game\);/);
    expect(sourceText("main.ts")).toContain('import { HIKE_PAGE } from "./hikePageGame.js";');
    expect(sourceText("hikePageGame.ts")).toContain("  game: HIKE_GAME,");
  });

  it("makes its renderer, its bus, its HUD, its sessions and the game's half of the hike through the definition", () => {
    for (const call of ["game.renderer(", "game.audio()", "game.hud(", "game.side({", "game.host(", "game.join(", "game.startOf(seed)", "parseLevel(game.level)"]) expect(app, call).toContain(call);
    expect(app.split("game.renderer(").length - 1).toBe(2);
    expect(app.split("actions: game.actions").length - 1).toBe(2);
  });
});
