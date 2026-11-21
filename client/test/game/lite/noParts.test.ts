import { describe, expect, it } from "vitest";
import { noParts, type NoPartsApi } from "@csarkosh/engine/game/lite/noParts";
import type { RenderGame, RenderHost, RenderLamp, RenderPlayer, RenderState } from "@csarkosh/engine/game/lite/renderGame";
import { STARE_LENS_REST } from "@csarkosh/engine/game/stareLens";
import { sourceText } from "../../helpers/source.js";

/**
 * A renderer's side for a game with no parts of its own (`noParts.ts`): the renderer draws the world
 * and nothing is added to it. The look is at rest, no scene takes the camera or the lamp, the dark
 * never closes, nothing waits to load, and the animals are told of the players and of no match.
 */

const player = (id: number, x: number, z: number): RenderPlayer => ({ id, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, grounded: true });
const stateOf = (...players: RenderPlayer[]): RenderState<RenderPlayer> => ({ tick: 0, players: new Map(players.map((p) => [p.id, p])) });
/** The side reads nothing of its host. */
const host = {} as RenderHost;

describe("a renderer's side with no parts", () => {
  it("holds the look at rest, and its one method of its own turns how far dread reaches the lens", () => {
    const { side, api } = noParts(host);
    expect(side.look).toEqual({ cast: 0, unsettle: 1, dim: 1, haunt: 0, mistIn: 0 });
    api.setUnsettle(0.25);
    expect(side.look.unsettle).toBe(0.25);
    api.setUnsettle(7);
    expect(side.look.unsettle).toBe(1);
    api.setUnsettle(-1);
    expect(side.look.unsettle).toBe(0);
    expect(Object.keys(api)).toEqual(["setUnsettle"]);
  });

  it("takes neither the camera nor the lamp, and never closes the dark", () => {
    const { side } = noParts(host);
    const local = player(1, 0, 0);
    const state = stateOf(local);
    const pose = {} as Parameters<typeof side.shot>[1];
    expect(side.shot(0, pose, local, state, 1, 0)).toEqual({ fov: null, centre: null, coverAtEye: false });
    // The record is the side's own, the same each frame.
    expect(side.shot(1, pose, local, state, 1, 0)).toBe(side.shot(2, pose, local, state, 1, 0));
    expect(side.lampOn(local)).toBe(false);
    const lamp: RenderLamp = {
      at: { x: 1, y: 2, z: 3, dx: 0, dy: 0, dz: 1, angle: 0.5, range: 20 },
      lit: { on: true, state: { intensity: 3, colour: { r: 1, g: 1, b: 1 } } },
    };
    const before = JSON.stringify(lamp);
    side.lamp(lamp);
    expect(JSON.stringify(lamp)).toBe(before);
    expect(side.stare(state, 1, pose, {} as Parameters<typeof side.stare>[3], 0.016)).toBe(STARE_LENS_REST);
    expect(side.cloudPath()).toBeNull();
    expect(side.facts()).toEqual({ scene: false, ending: false, dark: 0 });
  });

  it("has nothing to load, to wait for or to build the scene again for", () => {
    const { side } = noParts(host);
    expect(side.ready()).toBeUndefined();
    expect(side.waiting()).toBe(0);
    expect(side.rebuilding()).toBe(false);
  });

  it("tells the animals where the players are and of no match", () => {
    const { side } = noParts(host);
    const state = stateOf(player(1, 3, 4), player(2, -5, 6));
    expect(side.wildlife.players(state)).toEqual([{ x: 3, z: 4 }, { x: -5, z: 6 }]);
    side.wildlife.look(state, 3, 1.6, 4, 0.5, -0.1, 1.2, 1.5, 21, 0.3);
    expect(side.wildlife.director.view).toEqual({ x: 3, y: 1.6, z: 4, yaw: 0.5, pitch: -0.1, fov: 1.2, aspect: 1.5 });
    expect(side.wildlife.director.match).toEqual({ phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 21, mist: 0.3 });
  });

  it("is made afresh for each renderer", () => {
    const a = noParts(host);
    const b = noParts(host);
    a.api.setUnsettle(0);
    expect(b.side.look.unsettle).toBe(1);
    expect(a.side.wildlife).not.toBe(b.side.wildlife);
  });

  it("serves a game whose state and players hold more than the renderer reads", () => {
    // The typecheck is the test: a game's own records are wider than the renderer's, and the side reads only the core.
    type Walker = RenderPlayer & { stamina: number };
    type Round = RenderState<Walker> & { round: number };
    const forAGame: RenderGame<Round, Walker, NoPartsApi> = noParts;
    const walker: Walker = { ...player(1, 2, 3), stamina: 1 };
    const round: Round = { tick: 0, players: new Map([[1, walker]]), round: 4 };
    expect(forAGame(host).side.wildlife.players(round)).toEqual([{ x: 2, z: 3 }]);
  });

  it("is the engine's own and names no game", () => {
    const text = sourceText("game/lite/noParts.ts");
    const specs = [...text.matchAll(/^import [^\n]*?from "([^"]+)";$/gm)].map((m) => m[1] as string);
    expect(specs.length).toBeGreaterThan(2);
    for (const spec of specs) expect(spec.startsWith("."), spec).toBe(true);
    expect(text).toContain("export const noParts: RenderGame<RenderState<RenderPlayer>, RenderPlayer, NoPartsApi> = () => {");
  });
});
