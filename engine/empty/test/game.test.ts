import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { noGameSound } from "@csarkosh/engine/game/ambientAudio";
import { isMode } from "@csarkosh/engine/game/modeList";
import { NO_ACTIONS, type InputCommand } from "@csarkosh/engine/sim/core";
import { parseLevel } from "@csarkosh/engine/sim/level";
import { EMPTY_GAME, WALK_MODES, WALK_SIDE } from "../src/game.js";
import { WALK } from "../src/net.js";
import { EMPTY_PAGE, createEmptyPage } from "../src/page.js";
import type { WalkState, Walker } from "../src/sim.js";

/**
 * The empty game as the engine's page and its shell are handed it: two definitions of a game of
 * nothing, and a folder that reaches the engine only by the package's name, as a game's does.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const text = (name: string): string => readFileSync(SRC + name, "utf8");
const code = (name: string): string => text(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the empty game as the page that runs a session is handed it", () => {
  it("has a level the parser takes, one mode, no actions of its own, no start and no weather of its own", () => {
    const level = parseLevel(EMPTY_GAME.level);
    expect([level.id, level.brushes.length, level.playerSpawns.length]).toEqual(["empty-yard", 1, 1]);
    expect(EMPTY_GAME.modes).toBe(WALK_MODES);
    expect(isMode(WALK_MODES, WALK_MODES.initial)).toBe(true);
    expect(WALK_MODES.key.startsWith("empty.")).toBe(true);
    expect(EMPTY_GAME.actions).toBe(NO_ACTIONS);
    expect(EMPTY_GAME.startOf(7)).toBeNull();
    expect(EMPTY_GAME.weatherIsOwn("walk")).toBe(false);
  });

  it("is drawn and heard with the engine's own and no parts or voices of a game's", () => {
    const game = code("game.ts");
    expect(game).toContain("renderer: (canvas, level, forest, options) => createLiteRenderer<WalkState, Walker, NoPartsApi>(canvas, level, forest, options, noParts),");
    expect(game).toContain("audio: () => createAmbientAudio(noGameSound),");
    expect(typeof noGameSound).toBe("function");
  });

  it("does nothing at every point of a session, and lets every command through as it came", () => {
    const side = EMPTY_GAME.side(undefined as never);
    expect(side).toBe(WALK_SIDE);
    const sample: InputCommand = { seq: 4, moveX: 1, moveZ: -1, yaw: 0.2, pitch: 0.1, buttons: 3 };
    expect(side.command(sample, undefined, undefined as never)).toBe(sample);
    expect([side.decided(), side.over(), side.holdsFrame(), side.extrasStand(), side.lampOn(undefined), side.applyOwnView("anything", [])]).toEqual([false, false, false, false, false, false]);
    expect([side.progress(), side.matchEnd()]).toEqual([0, {}]);
    const walker = (id: number): Walker => ({ id, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, grounded: true, lastProcessedInput: 0 });
    const state: WalkState = { tick: 0, players: new Map([[1, walker(1)], [2, walker(2)]]), nextEntityId: 3, rngSeed: 1 };
    expect(side.entities(state)).toBe(2);
  });
});

describe("the empty game as the page's shell is handed it", () => {
  it("holds the game, its own of the page, and the version its two ends must share", () => {
    expect(EMPTY_PAGE.game).toBe(EMPTY_GAME);
    expect(EMPTY_PAGE.side).toBe(createEmptyPage);
    expect(EMPTY_PAGE.protocol).toBe(WALK.protocolVersion);
    // No scene is staged: a scene's address is answered with nothing to let go.
    expect(typeof EMPTY_PAGE.scene({ canvas: undefined as never, container: undefined as never, tier: "low" }, { t: null, step: null }, "intro").dispose).toBe("function");
  });

  it("plays nothing before a session and carries nothing into it", () => {
    const page = code("page.ts");
    for (const line of ["played: () => undefined,", "carriesToGame: () => false,", "keepOpening: () => undefined,", "openingFor: () => null,", "muteChanged: () => undefined,"]) {
      expect(page, line).toContain(line);
    }
  });

  it("draws its own page for a visitor turned away and leaves what goes before it to the shell", () => {
    const page = code("page.ts");
    expect(page).toContain("    showTurnedAway(container: HTMLDivElement, why: TurnedAway) {\n      landing = null;\n");
    expect(page).not.toMatch(/\bh\.(renderToken|running|game|paused|roster|shownPage|mute|veil)\b/);
    expect(page).not.toContain("replaceChildren");
  });

  it("is started by an entry that registers the shipped files and the terrain first", () => {
    expect(code("main.ts").trim()).toBe(
      ['import "./assets.js";', 'import "./terrain.js";', 'import { startShell } from "@csarkosh/engine/shell";', 'import { EMPTY_PAGE } from "./page.js";', "", "startShell(EMPTY_PAGE);"].join("\n"),
    );
    // The worker registers the terrain for itself, before it serves the world's work.
    expect(code("world.worker.ts").trim().startsWith('import "./terrain.js";')).toBe(true);
  });
});

describe("the empty game's folder", () => {
  it("reaches the engine by the package's name alone, and nothing of another game but the shipped files' folder", () => {
    const files = readdirSync(SRC).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(8);
    const outside = new Set<string>();
    let seen = 0;
    for (const name of files) {
      // Every module a file names: a bare import, an import or export from, and a worker's entry.
      const specs = [
        ...[...code(name).matchAll(/^import\s+["']([^"']+)["'];/gm)].map((m) => m[1] as string),
        ...[...code(name).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] as string),
        ...[...code(name).matchAll(/new URL\(\s*["']([^"']+)["']/g)].map((m) => m[1] as string),
      ];
      seen += specs.length;
      for (const spec of specs) {
        const own = spec.startsWith("./") || spec.startsWith("../levels/");
        if (!own && !spec.startsWith("@csarkosh/engine/")) outside.add(`${name}: ${spec}`);
      }
    }
    expect(seen).toBeGreaterThan(40);
    // The one reach outside: the engine's assets stand in Day Hike's folder until the engine is lifted.
    expect([...outside]).toEqual(["assets.ts: ../../../client/assets/catalog.json"]);
    const globs = [...text("assets.ts").matchAll(/"(\.\.\/[^"]+)"/g)].map((m) => m[1] as string);
    expect(globs.length).toBeGreaterThan(8);
    for (const path of globs) expect(path.startsWith("../../../client/assets/"), path).toBe(true);
    // Nothing of Day Hike's own is asked for: no ranger, no car, no sign, no voice, no film.
    expect(code("assets.ts")).not.toMatch(/ranger|hollow|intro|summit|trailhead|sign\.|voice|video|board/);
  });
});
