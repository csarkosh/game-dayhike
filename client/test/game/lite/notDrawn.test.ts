import { describe, expect, it } from "vitest";
import { NOT_DRAWN, notDrawnMembers } from "../../../src/game/lite/notDrawn.js";

describe("what the renderer on Babylon Lite does not draw yet", () => {
  it("answers as nothing exactly the members its list names, each named once", () => {
    const named = NOT_DRAWN.flatMap((part) => part.members);
    expect(new Set(named).size).toBe(named.length);
    expect([...named].sort()).toEqual(Object.keys(notDrawnMembers().members).sort());
    for (const part of NOT_DRAWN) expect(part.what.length, part.what).toBeGreaterThan(10);
  });

  it("names every part of the world it leaves out", () => {
    const all = NOT_DRAWN.map((part) => part.what).join("; ");
    for (const word of [ "sea", "lake", "Hollow's figure on the tiers with no post chain", "skin's shading", "shadows", "scenes", "endings", "posts", "body at the crest"]) {
      expect(all, word).toContain(word);
    }
  });

  it("reads out nothing: no scene", () => {
    const { members } = notDrawnMembers();
    expect(members.endScene()).toBeNull();
    expect(members.gpuTime).toBeNull();
  });

  it("keeps what its setters are told", () => {
    const { members, held } = notDrawnMembers();
    members.setWireframe(true);
    members.setSkinShading(false);
    expect(held).toMatchObject({ wireframe: true, skinShading: false });
  });

  it("leaves the post chain to the renderer: the grade's palette, the chase's cast, the unsettle, the stare and the depth of field are its own", () => {
    const { members, held } = notDrawnMembers();
    for (const name of ["setPalette", "setChase", "setUnsettle", "setDepthOfField", "stare"]) expect(name in members, name).toBe(false);
    for (const name of ["chase", "unsettle", "palette", "depthOfField"]) expect(name in held, name).toBe(false);
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/anti-aliasing|far softening|palette|chase|depth of field/);
    // The one part that names the chain is the tiers' without one: the veil's.
    expect(NOT_DRAWN.filter((part) => /post chain|grade/.test(part.what)).map((part) => part.what.slice(0, 20))).toEqual(["the Hollow's figure "]);
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
    // What is left of the Hollow is its figure where no chain's grade reads its mask: the veil's, with the stare's shade there.
    const hollow = NOT_DRAWN.filter((part) => /Hollow/.test(part.what));
    expect(hollow).toHaveLength(1);
    expect(hollow[0]?.what).toMatch(/no post chain/);
    expect(hollow[0]?.what).toMatch(/veil/);
    expect(hollow[0]?.members).toEqual([]);
    // The skin's shading is held, and shows on no surface the game ships.
    expect(NOT_DRAWN.filter((part) => /skin/.test(part.what)).map((part) => part.members)).toEqual([["setSkinShading"]]);
  });

  it("leaves the rain to the renderer: its streaks, drips, splashes and cover are drawn, and the canopy's read-outs are its own", () => {
    const { members } = notDrawnMembers();
    for (const name of ["canopyWater", "canopyOver"]) expect(name in members, name).toBe(false);
    // The rain on the lens is the post chain's, which is drawn too: no part names any rain.
    expect(NOT_DRAWN.filter((part) => /rain|splash|drip|canopy|lens/.test(part.what))).toEqual([]);
  });

  it("leaves the lakes' water, its calm, its plants and its life to the renderer: what is left of a lake is its reflections and the tier that reads through it", () => {
    const { members } = notDrawnMembers();
    for (const name of ["setWeatherName", "hasWaterLife", "waterLifeSound"]) expect(name in members, name).toBe(false);
    const lakes = NOT_DRAWN.filter((part) => /lake/.test(part.what));
    expect(lakes.map((part) => part.members)).toEqual([[]]);
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/insects|frogs|midges|dragonfl/);
    expect(lakes[0]?.what).not.toMatch(/plants|reeds|lil/);
    expect(lakes[0]?.what).toMatch(/panorama/);
    expect(lakes[0]?.what).toMatch(/mirror/);
    expect(lakes[0]?.what).not.toMatch(/calm/);
  });

  it("leaves the sea's swell, its wind sea, its white water, its swash and its surf to the renderer: what is left of the sea is the FFT, the curl and the spray", () => {
    const { members } = notDrawnMembers();
    for (const name of ["hasSea", "surfSound"]) expect(name in members, name).toBe(false);
    const sea = NOT_DRAWN.filter((part) => /\bsea\b/.test(part.what));
    expect(sea.map((part) => part.members)).toEqual([[], []]);
    expect(sea[0]?.what).toMatch(/FFT/);
    // The loop is named as what is drawn in the FFT's place.
    expect(sea[0]?.what).toMatch(/loop is drawn/);
    expect(sea[0]?.what).toMatch(/curl/);
    expect(sea[0]?.what).toMatch(/spray/);
    expect(sea[0]?.what).not.toMatch(/swash|surf's sound|swell/);
    // The tier that reads through the surface is the lakes' and the sea's alike.
    expect(sea[1]?.what).toMatch(/through the surface/);
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
    a.members.setWireframe(true);
    expect(b.held.wireframe).toBe(false);
  });
});
