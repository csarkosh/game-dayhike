import { describe, expect, it } from "vitest";
import "../../src/game/dayhikeAssets.js";
import { HIKE_PAGE } from "../../src/hikePageGame.js";
import { HIKE_GAME } from "../../src/hikeGame.js";
import { createHikePage } from "../../src/hikePage.js";
import { startHikeWorldWorker } from "../../src/game/hikeWorldWorker.js";
import { runLiteSceneRoute } from "../../src/game/lite/sceneRoute.js";
import { PROTOCOL_VERSION } from "../../src/net/protocol.js";
import { sourceText } from "../helpers/source.js";

/**
 * The page's shell (`main.ts`: the routes, the lobby, the start of a session) is handed the game as
 * one definition and names nothing of Day Hike's by itself: the game a session is of, Day Hike's own
 * of the page, the wire's version, the status line, the world's worker, the staged scenes and the
 * tier check's steps reach it through that object.
 */

describe("Day Hike as the page's shell is handed it", () => {
  it("is one definition that holds the game, its own of the page and what the shell starts for it", () => {
    expect(HIKE_PAGE.game).toBe(HIKE_GAME);
    expect(HIKE_PAGE.side).toBe(createHikePage);
    expect(HIKE_PAGE.protocol).toBe(PROTOCOL_VERSION);
    expect(HIKE_PAGE.worldWorker).toBe(startHikeWorldWorker);
    expect(HIKE_PAGE.scene).toBe(runLiteSceneRoute);
    expect(typeof HIKE_PAGE.statusLine).toBe("function");
    expect(typeof HIKE_PAGE.probe).toBe("function");
  });

  it("is typed by the engine's definition of a page's game, as Day Hike's own of the page is by its side and host", () => {
    expect(sourceText("hikePageGame.ts")).toContain("export const HIKE_PAGE: PageGame<World, WorldState, PlayerState, Renderer, HikeAudio, Hud, HostSession, ClientSession> = {");
    const own = sourceText("hikePage.ts");
    expect(own).toContain("export function createHikePage(h: PageHost): PageSide {");
    expect(own).toMatch(/import type \{[^}]*\bPageHost\b[^}]*\} from "@csarkosh\/engine\/game\/pageGame";/);
    // The types the shell and the game's own share are the engine's, declared once.
    for (const type of ["HikePageHost", "export type Opening", "export type LandingShell"]) expect(own, type).not.toContain(type);
  });

  it("keeps a mode only where it is one of the hike's", () => {
    expect(sourceText("hikePage.ts")).toMatch(/saveMode: \(mode: string\): void => \{\n\s+if \(isGameMode\(mode\)\) saveMode\(mode\);\n\s+\},/);
  });
});

describe("the page's shell", () => {
  const shell = sourceText("main.ts");

  it("imports nothing of Day Hike's but its registrations and the one definition", () => {
    const specs = [...shell.matchAll(/^import [^\n]*?"([^"]+)";$/gm)].map((m) => m[1] as string);
    expect(specs.length).toBeGreaterThan(30);
    expect(specs.filter((spec) => spec.startsWith("."))).toEqual(["./game/dayhikeAssets.js", "./sim/passes/index.js", "./hikePageGame.js"]);
    // A multi-line import is the engine's router alone.
    expect([...shell.matchAll(/^\} from "([^"]+)";$/gm)].map((m) => m[1])).toEqual(["@csarkosh/engine/game/router", "@csarkosh/engine/game/tierChoice"]);
  });

  it("reaches the game through the definition at every point it once named Day Hike", () => {
    expect(shell).toContain("const hikePage = page.side({");
    expect(shell).toContain("    proto: page.protocol,");
    expect(shell.split("page.statusLine(container)").length - 1).toBe(3);
    expect(shell).toContain("startWorldPrep(worldInputs(route.token, location.search), page.worldWorker)");
    expect(shell).toContain("const scene = page.scene({ canvas, container, tier }, parseSceneSearch(location.search), route.name);");
    expect(shell).toContain("const probe = page.probe(container);");
    expect(shell).toMatch(/const handle = startGame\(onCanvas\.canvas, worldToken, \{[\s\S]*?\n {2}\}, page\.game\);/);
    for (const named of ["createHud", "PROTOCOL_VERSION", "startHikeWorldWorker", "runLiteSceneRoute", "liteProbeDeps", "HIKE_GAME", "createHikePage"]) {
      expect(shell, named).not.toMatch(new RegExp(`\\b${named}\\b`));
    }
  });
});
