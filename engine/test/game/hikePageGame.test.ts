import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sourceText } from "../helpers/source.js";

/**
 * The page's shell (`shell.ts`: the routes, the lobby, the start of a session) is handed the game as
 * one definition and names nothing of Day Hike's by itself: the game a session is of, Day Hike's own
 * of the page, the wire's version, the status line, the world's worker, the staged scenes and the
 * tier check's steps reach it through that object. Day Hike's definition is read by Day Hike's suite
 * (`client/test/game/hikePageGame.test.ts`).
 */

describe("the page's shell", () => {
  const shell = sourceText("shell.ts");

  it("is one function a game's entry calls with the game, and imports nothing of a game's: the engine's half", () => {
    expect(shell).toContain(">(page: PageGame<W, S, P, R, A, H, HostS, ClientS>): void {");
    expect(shell.split("export function startShell<").length - 1).toBe(1);
    // Nothing of it runs as it is imported: every statement but its imports stands inside the function.
    const after = shell.slice(shell.indexOf("export function startShell<"));
    expect(after.slice(after.indexOf("): void {\n")).split("\n").filter((line) => line !== "" && !line.startsWith("  ") && line !== "): void {" && line !== "}")).toEqual([]);
    // It stands in the engine's package, where no module may import the game's (`architecture.test.ts`), and its
    // own imports are of its neighbours there alone.
    expect(existsSync(fileURLToPath(new URL("../../src/shell.ts", import.meta.url)))).toBe(true);
    const specs = [...shell.matchAll(/^(?:import [^\n]*?|\} from )"([^"]+)";$/gm)].map((m) => m[1] as string);
    expect(specs.length).toBeGreaterThan(30);
    expect(specs.filter((spec) => !spec.startsWith("./"))).toEqual([]);
  });

  it("reaches the game through the definition at every point it once named Day Hike", () => {
    expect(shell).toContain("  const side = page.side({");
    expect(shell).toContain("      proto: page.protocol,");
    expect(shell.split("page.statusLine(container)").length - 1).toBe(3);
    expect(shell).toContain("startWorldPrep(worldInputs(route.token, location.search), page.worldWorker)");
    expect(shell).toContain("const scene = page.scene({ canvas, container, tier }, parseSceneSearch(location.search), route.name);");
    expect(shell).toContain("const probe = liteProbeDeps(container, { level: page.game.level, renderer: page.game.renderer, state: page.probeState });");
    expect(shell).toMatch(/const handle = startGame\(onCanvas\.canvas, worldToken, \{[\s\S]*?\n {4}\}, page\.game\);/);
    for (const named of ["createHud", "PROTOCOL_VERSION", "startHikeWorldWorker", "runLiteSceneRoute", "createWorld", "sandbox01", "hikeParts", "HIKE_GAME", "HIKE_PAGE", "createHikePage"]) {
      expect(shell, named).not.toMatch(new RegExp(`\\b${named}\\b`));
    }
  });
});
