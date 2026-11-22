import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the tier is drawing only", () => {
  /**
   * What the run above cannot reach is the part of a frame that draws, which
   * needs a device. It is held here by what a frame may do with the state at
   * all: it reads the tick, the players and the enemies, hands the state
   * whole to the readers run above and to no one else, and assigns to
   * nothing it took out of it.
   */
  it("reads the world's state in a frame and hands it only to the readers held above: no frame assigns to it: the engine's half", () => {
    const text = sourceText("game/lite/renderer.ts");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
    const from = code.indexOf("    sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {");
    const to = code.indexOf("\n    cameraPosition() {", from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    // The frame's body, past the line that names what it is given.
    const frame = code.slice(code.indexOf("\n", from), to);
    // The one function of the renderer that is given the state: it is named nowhere else but on that line.
    expect([...code.matchAll(/(?<![.\w])state(?![\w:])/g)].length).toBe([...frame.matchAll(/(?<![.\w])state(?![\w:])/g)].length + 1);
    // What it reads of it: the tick and the players. What is Day Hike's own of the state (its enemies, a hiker's lamp
    // and stare) is read by Day Hike's side of the frame (`lite/hikeParts.ts`), held below.
    const members = [...new Set([...frame.matchAll(/(?<![.\w])state\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(members).toEqual(["players", "tick"]);
    const asked = [...new Set([...frame.matchAll(/(?<![.\w])state\.(?:players|enemies)\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(asked).toEqual(["get", "values"]);
    // Who is handed it whole, and who its players.
    const whole = [...new Set([...frame.matchAll(/([\w.]+)\((?:[^()]*,\s*)?state(?=[,)])/g)].map((m) => m[1]))].sort();
    expect(whole).toEqual(["side.begin", "side.shot", "side.stare", "side.wildlife.look", "side.wildlife.players"]);
    const players = [...new Set([...frame.matchAll(/([\w.]+)\((?:[^()]*,\s*)?state\.players(?=[,)])/g)].map((m) => m[1]))].sort();
    expect(players).toEqual(["playerSlots.fill"]);
    // Nothing taken out of it is assigned to: a player, or a place of one (`centre` is a player's place).
    const taken = [...new Set([...frame.matchAll(/\b(?:const|let) (\w+) = [^;\n]*(?<![.\w])state\.(?:players|enemies)\.get\(|for \(const (\w+) of state\.(?:players|enemies)\.values\(\)\)/g)].map((m) => m[1] ?? m[2]))].sort();
    expect(taken).toEqual(["local", "player"]);
    expect(frame).toContain("centre = shot.centre ?? local.pos;");
    for (const name of [...taken, "centre"]) {
      expect(frame, name).not.toMatch(new RegExp(`\\b${name}(?:\\.\\w+)+\\s*(?:[-+*/]?=(?!=)|\\+\\+|--)`));
    }
    expect(frame).not.toMatch(/(?<![.\w])state(?:\.\w+)+\s*(?:[-+*/]?=(?!=)|\+\+|--)/);
    expect(frame).not.toMatch(/(?<![.\w])state\.(?:players|enemies)\.(?:set|delete|clear)\(/);
  });
});
