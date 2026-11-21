import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The terrain field lives behind the variant registry; a test that builds a
// forest without `app.ts` has to register the passes itself.
import "../../src/sim/passes/index.js";
import { PLAYER_EYE_OFFSET } from "@csarkosh/engine/sim/constants";
import { createForest } from "@csarkosh/engine/sim/forest";
import { createForestWorld, serializeWorldState, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { Level } from "@csarkosh/engine/sim/level";
import { createEntityPoses, type EntityModels } from "../../src/game/entityPoses.js";
import { GAME_FOV } from "@csarkosh/engine/game/gameLens";
import { createHikeRenderer } from "../../src/game/hikeRenderer.js";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import { bodiesInShot } from "../../src/game/shotBodies.js";
import { createPlayerSlots } from "../../src/game/waterLifeInputs.js";
import { createWildlifeInputs } from "../../src/game/wildlifeInputs.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { timeLimit } from "../helpers/timeLimit.js";

const LEVEL: Level = { id: "tier-determinism", brushes: [], playerSpawns: [], enemySpawns: [] };
const CANVAS = { clientWidth: 1600, clientHeight: 900 } as unknown as HTMLCanvasElement;
const ATMO = 627994160;
/** Every body drawn as its model: the poses then take the path that reads the most of the state. */
const MODELS: EntityModels = { player: () => true, hollow: () => true };

/**
 * One forest world, one player walking for 120 ticks, and after every tick
 * the frame the hike's renderer makes of it on `tier`, or none. Under Node no
 * WebGPU device can be had, so the renderer runs what a frame does before
 * anything is drawn (the wind, the scene's play, the camera) and stands
 * empty; what a frame hands the world's state to once its engine stands is
 * run here beside it, each reader as the renderer makes and calls it: the
 * bodies' poses, a scene's change of who is shown, the wildlife's view of
 * the match and the lake's life's seats. `wrote` counts the ticks after which
 * any of them left the state other than it found it.
 */
function run(tier: QualityTier | null): { state: string; passHash: number; wrote: number } {
  const forest = createForest(ATMO);
  const world = createForestWorld(forest);
  const player = spawnPlayer(world);
  let clock = 0;
  const renderer = tier === null ? null : createHikeRenderer(CANVAS, LEVEL, forest, { tier, skyTable: skyFixture(), clock: () => clock });
  const poses = createEntityPoses();
  const wildlife = createWildlifeInputs();
  const slots = createPlayerSlots(5);
  let wrote = 0;
  try {
    for (let t = 0; t < 120; t++) {
      tickWorld(world, new Map([[player.id, { seq: t + 1, moveX: 0, moveZ: 1, yaw: 0.3, pitch: 0, buttons: 0 }]]));
      if (renderer === null) continue;
      const state = world.state;
      const before = serializeWorldState(state);
      clock += 1000 / 60;
      renderer.sync(state, player.id, 0.5, { dt: 1 / 60, sprinting: false });
      renderer.drawFrame();
      const posed = poses.step(state, player.id, 0.5, 1 / 60, MODELS);
      // A scene that shows the local body on one frame and not on the next: the bodies are posed again each time.
      bodiesInShot(poses, posed, { showLocal: t % 2 === 0, hideNear: null }, state, player.id, 0.5, MODELS);
      const local = state.players.get(player.id);
      if (local === undefined) throw new Error("the player left the world");
      wildlife.look(state, local.pos.x, local.pos.y + PLAYER_EYE_OFFSET, local.pos.z, local.yaw, local.pitch, GAME_FOV, 16 / 9, 12, 0);
      wildlife.players(state);
      wildlife.findHollow(state, local.pos.x, local.pos.z);
      slots.fill(state.players);
      if (serializeWorldState(state) !== before) wrote++;
    }
    return { state: serializeWorldState(world.state), passHash: forest.passHash, wrote };
  } finally {
    renderer?.dispose();
  }
}

describe("the tier is drawing only", () => {
  // Each renderer says on the console, once it has asked, that no engine could be made under Node.
  const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
  afterEach(() => void said.mockClear());

  it("steps one world, to the byte, whatever tier draws it or none", () => {
    const bare = run(null);
    // The pass hash `groundGradient.test.ts` pins: the world with the car at
    // the pad and the board at the trail's entrance.
    // 2026-10-12: -190240058 before the cliff modules left the faces.
    // 2026-10-15: 1527270963 before the fallen logs collided.
    expect(bare.passHash).toBe(64181734);
    const drawn = { low: run("low"), medium: run("medium"), high: run("high") };
    for (const got of [drawn.low, drawn.medium, drawn.high]) {
      expect(got.state).toBe(bare.state);
      expect(got.passHash).toBe(64181734);
      // Nor did any frame write the state and a later tick cover it.
      expect(got.wrote).toBe(0);
    }
  }, timeLimit(120_000));

  /**
   * What the run above cannot reach is the part of a frame that draws, which
   * needs a device. It is held here by what a frame may do with the state at
   * all: it reads the tick, the players and the enemies, hands the state
   * whole to the readers run above and to no one else, and assigns to
   * nothing it took out of it.
   */
  it("reads the world's state in a frame and hands it only to the readers held above: no frame assigns to it", () => {
    const text = readFileSync(fileURLToPath(new URL("../../src/game/lite/renderer.ts", import.meta.url)), "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
    const from = code.indexOf("    sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {");
    const to = code.indexOf("\n    cameraPosition() {", from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    // The frame's body, past the line that names what it is given.
    const frame = code.slice(code.indexOf("\n", from), to);
    // The one function of the renderer that is given the state: it is named nowhere else but on that line.
    expect([...code.matchAll(/(?<![.\w])state(?![\w:])/g)].length).toBe([...frame.matchAll(/(?<![.\w])state(?![\w:])/g)].length + 1);
    // What it reads of it.
    const members = [...new Set([...frame.matchAll(/(?<![.\w])state\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(members).toEqual(["enemies", "players", "tick"]);
    const asked = [...new Set([...frame.matchAll(/(?<![.\w])state\.(?:players|enemies)\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(asked).toEqual(["get", "has", "size", "values"]);
    // Who is handed it whole, and who its players.
    const whole = [...new Set([...frame.matchAll(/([\w.]+)\((?:[^()]*,\s*)?state(?=[,)])/g)].map((m) => m[1]))].sort();
    expect(whole).toEqual(["bodiesInShot", "poses.step", "wildlifeInputs.look", "wildlifeInputs.players"]);
    const players = [...new Set([...frame.matchAll(/([\w.]+)\((?:[^()]*,\s*)?state\.players(?=[,)])/g)].map((m) => m[1]))].sort();
    expect(players).toEqual(["play.step", "playerSlots.fill"]);
    // Nothing taken out of it is assigned to: a player, an enemy, or a place or a lamp of one (`centre` is a player's place).
    const taken = [...new Set([...frame.matchAll(/\b(?:const|let) (\w+) = [^;\n]*(?<![.\w])state\.(?:players|enemies)\.get\(|for \(const (\w+) of state\.(?:players|enemies)\.values\(\)\)/g)].map((m) => m[1] ?? m[2]))].sort();
    expect(taken).toEqual(["enemy", "local", "player", "starer"]);
    expect(frame).toContain("centre = (shownId === undefined ? undefined : state.players.get(shownId))?.pos ?? local.pos;");
    for (const name of [...taken, "centre"]) {
      expect(frame, name).not.toMatch(new RegExp(`\\b${name}(?:\\.\\w+)+\\s*(?:[-+*/]?=(?!=)|\\+\\+|--)`));
    }
    expect(frame).not.toMatch(/(?<![.\w])state(?:\.\w+)+\s*(?:[-+*/]?=(?!=)|\+\+|--)/);
    expect(frame).not.toMatch(/(?<![.\w])state\.(?:players|enemies)\.(?:set|delete|clear)\(/);
  });
});
