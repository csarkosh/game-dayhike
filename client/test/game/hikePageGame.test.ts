import { describe, expect, it } from "vitest";
import "../../src/game/dayhikeAssets.js";
import "../../src/sim/passes/index.js";
import { parseLevel } from "@csarkosh/engine/sim/level";
import { HIKE_PAGE } from "../../src/hikePageGame.js";
import { HIKE_GAME } from "../../src/hikeGame.js";
import { createHikePage } from "../../src/hikePage.js";
import { startHikeWorldWorker } from "../../src/game/hikeWorldWorker.js";
import { runLiteSceneRoute } from "../../src/game/lite/sceneRoute.js";
import { PROTOCOL_VERSION } from "../../src/net/protocol.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sourceText } from "../helpers/source.js";

/**
 * The page's shell (`shell.ts`: the routes, the lobby, the start of a session) is handed the game as
 * one definition and names nothing of Day Hike's by itself: the game a session is of, Day Hike's own
 * of the page, the wire's version, the status line, the world's worker, the staged scenes and the
 * tier check's steps reach it through that object.
 */

describe("Day Hike as the page's shell is handed it", () => {
  it("is one definition that holds the game, its own of the page and what the shell starts for it", () => {
    expect(HIKE_PAGE.game).toBe(HIKE_GAME);
    expect(HIKE_PAGE.side).toBe(createHikePage);
    expect(HIKE_PAGE.protocol).toBe(PROTOCOL_VERSION);
    // The key a hiker's name has always been kept under, so a saved name is found again.
    expect({ key: `${HIKE_PAGE.identity.storage}.playerName`, prefix: HIKE_PAGE.identity.player }).toEqual({ key: "dayhike.playerName", prefix: "Hiker" });
    // What the page for those turned away says and shows of Day Hike's: its name, the title's still, its credits.
    expect(HIKE_PAGE.identity.title).toBe("Day Hike");
    expect(typeof HIKE_PAGE.away.still).toBe("function");
    expect(HIKE_PAGE.away.credits().length).toBeGreaterThan(5);
    expect(HIKE_PAGE.worldWorker).toBe(startHikeWorldWorker);
    expect(HIKE_PAGE.scene).toBe(runLiteSceneRoute);
    expect(typeof HIKE_PAGE.statusLine).toBe("function");
    // What the tier check draws: a world on the hike's level that nothing steps, with nobody in it.
    const empty = HIKE_PAGE.probeState(parseLevel(HIKE_GAME.level), 20261121, null as never);
    expect([empty.tick, empty.players.size]).toEqual([0, 0]);
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
  const entry = sourceText("main.ts");

  it("is one function a game's entry calls with the game, and imports nothing of a game's", () => {
    // It stands in the engine's package, where no module may import the game's (`architecture.test.ts`), and its
    // own imports are of its neighbours there alone.
    expect(existsSync(fileURLToPath(new URL("../../src/shell.ts", import.meta.url)))).toBe(false);
  });

  it("is started by Day Hike's entry, after its registrations, with Day Hike's definition", () => {
    const code = entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\/\/.*\n/gm, "").trim();
    expect(code).toBe(
      [
        'import "./game/dayhikeAssets.js";',
        'import "./sim/passes/index.js";',
        'import { HIKE_PAGE } from "./hikePageGame.js";',
        'import { startShell } from "@csarkosh/engine/shell";',
        "",
        "startShell(HIKE_PAGE);",
      ].join("\n"),
    );
  });
});
