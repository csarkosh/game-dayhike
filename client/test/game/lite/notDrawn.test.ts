import { describe, expect, it } from "vitest";
import { NOT_DRAWN, notDrawnMembers } from "../../../src/game/lite/notDrawn.js";
import { STARE_LENS_REST } from "../../../src/game/stareLens.js";
import { SILENT_SURF_SOUND } from "../../../src/game/surfSound.js";

describe("what the renderer on Babylon Lite does not draw yet", () => {
  it("answers as nothing exactly the members its list names, each named once", () => {
    const named = NOT_DRAWN.flatMap((part) => part.members);
    expect(new Set(named).size).toBe(named.length);
    expect([...named].sort()).toEqual(Object.keys(notDrawnMembers().members).sort());
    for (const part of NOT_DRAWN) expect(part.what.length, part.what).toBeGreaterThan(10);
  });

  it("names every part of the world it leaves out", () => {
    const all = NOT_DRAWN.map((part) => part.what).join("; ");
    for (const word of [ "sea", "lakes", "insects", "figure in the silhouette mask", "shadows", "rain on the lens", "post chain", "scenes", "endings", "posts", "body at the crest"]) {
      expect(all, word).toContain(word);
    }
  });

  it("reads out nothing: no water to hear, no scene, no stare", () => {
    const { members } = notDrawnMembers();
    expect(members.hasSea).toBe(false);
    expect(members.surfSound()).toBe(SILENT_SURF_SOUND);
    expect(members.hasWaterLife).toBe(false);
    const life = members.waterLifeSound();
    expect(life.hums_n).toBe(0);
    expect(life.rustles).toEqual([]);
    expect(life.frogCalls).toEqual([]);
    expect(life.bed.level).toBe(0);
    expect(members.waterLifeSound()).toBe(life);
    expect(members.endScene()).toBeNull();
    expect(members.stare()).toBe(STARE_LENS_REST);
    expect(members.gpuTime).toBeNull();
  });

  it("keeps what its setters are told, held to the range each takes", () => {
    const { members, held } = notDrawnMembers();
    members.setChase(2);
    members.setUnsettle(0.5);
    members.setPalette("dusk" as never);
    members.setWeatherName("rain");
    members.setWireframe(true);
    members.setSkinShading(false);
    members.setDepthOfField(true);
    expect(held).toMatchObject({
      chase: 1, unsettle: 0.5, palette: "dusk", weatherName: "rain", wireframe: true, skinShading: false, depthOfField: true,
    });
  });

  it("leaves the air's weather to the renderer: the mist banks, the motes and the ground cloud are drawn", () => {
    const { members } = notDrawnMembers();
    for (const name of ["setHaunt", "setMist", "setMistIn"]) expect(name in members, name).toBe(false);
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/mist|motes|cloud/);
  });

  it("leaves the hikers, the Hollows' eyes, the cap and the animals to the renderer: the animals' read-outs are its own", () => {
    const { members } = notDrawnMembers();
    for (const name of ["hasWildlife", "wildlifeEvents", "wildlifeDirectorLog"]) expect(name in members, name).toBe(false);
    const all = NOT_DRAWN.map((part) => part.what).join("; ");
    expect(all).not.toMatch(/animals|bodies|lamps they wear|dropped cap/);
    // What is left of the Hollow is its figure, which the post chain's mask draws, and the skin's shading with it.
    const hollow = NOT_DRAWN.filter((part) => /Hollow/.test(part.what));
    expect(hollow).toHaveLength(1);
    expect(hollow[0]?.members).toEqual(["setSkinShading"]);
  });

  it("leaves the rain to the renderer: its streaks, drips, splashes and cover are drawn, and the canopy's read-outs are its own", () => {
    const { members } = notDrawnMembers();
    for (const name of ["canopyWater", "canopyOver"]) expect(name in members, name).toBe(false);
    // The one rain still named is the post chain's, on the lens.
    const rain = NOT_DRAWN.filter((part) => /rain|splash|drip|canopy/.test(part.what));
    expect(rain).toHaveLength(1);
    expect(rain[0]?.what).toContain("the post chain");
  });

  it("keeps the first ending it is told and lets a death be undone, and keeps the last scene", () => {
    const { members, held } = notDrawnMembers();
    members.setEnding("died");
    members.setEnding("died");
    expect(held.ending).toBe("died");
    members.clearEnding();
    expect(held.ending).toBeNull();
    members.setScene("cap", { x: 1, y: 2, z: 3 });
    expect(held.scene).toEqual({ kind: "cap", at: { x: 1, y: 2, z: 3 } });
  });

  it("tells no compile and keeps no shader: the stop it hands back does nothing", () => {
    const { members } = notDrawnMembers();
    let told = 0;
    const stop = members.onShaderCompiled(() => told++);
    members.keepShaders();
    stop();
    expect(told).toBe(0);
  });

  it("holds each renderer's own", () => {
    const a = notDrawnMembers();
    const b = notDrawnMembers();
    a.members.setChase(1);
    expect(b.held.chase).toBe(0);
  });
});
