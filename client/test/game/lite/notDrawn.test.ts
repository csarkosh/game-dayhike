import { describe, expect, it } from "vitest";
import { NOT_DRAWN, notDrawnMembers } from "../../../src/game/lite/notDrawn.js";
import { QUALITY } from "@csarkosh/engine/game/quality";

describe("what the renderer on Babylon Lite does not draw yet", () => {
  it("answers as nothing exactly the members its list names, each named once", () => {
    const named = NOT_DRAWN.flatMap((part) => part.members);
    expect(new Set(named).size).toBe(named.length);
    expect([...named].sort()).toEqual(Object.keys(notDrawnMembers().members).sort());
    for (const part of NOT_DRAWN) expect(part.what.length, part.what).toBeGreaterThan(10);
  });

  it("names every part of the world it leaves out", () => {
    const all = NOT_DRAWN.map((part) => part.what).join("; ");
    for (const word of ["skin's shading", "shadows", "wireframe"]) {
      expect(all, word).toContain(word);
    }
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
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/post chain|grade|anti-aliasing|far softening|palette|chase|depth of field|vignette|dither/);
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
    // Nothing of the Hollow is left: its figure is in the mask on every tier, the grade's to read or the veil's.
    expect(NOT_DRAWN.filter((part) => /Hollow|veil|mask|stare/.test(part.what))).toEqual([]);
    // The skin's shading is held, and shows on no surface the game ships.
    expect(NOT_DRAWN.filter((part) => /skin/.test(part.what)).map((part) => part.members)).toEqual([["setSkinShading"]]);
  });

  it("leaves the scenery a hike places once to the renderer: the posts, the trailhead's car and board and the body are drawn", () => {
    const all = NOT_DRAWN.map((part) => part.what).join("; ");
    expect(all).not.toMatch(/posts|board|body at the crest|trailhead/);
    // The car the end scene drives is drawn too: no part names a car.
    expect(NOT_DRAWN.filter((part) => /\bcar\b/.test(part.what))).toEqual([]);
  });

  it("names the sun's cast shadows as what no tier draws: the game casts none either", () => {
    const shadows = NOT_DRAWN.filter((part) => /shadows/.test(part.what));
    expect(shadows.map((part) => part.members)).toEqual([[]]);
    expect(shadows[0]?.what).toMatch(/no tier has one/);
    // What the game's settings say today: a shadow map of no size on every tier.
    for (const tier of ["low", "medium", "high"] as const) expect(QUALITY[tier].shadowMapSize).toBe(0);
  });

  it("leaves the rain to the renderer: its streaks, drips, splashes and cover are drawn, and the canopy's read-outs are its own", () => {
    const { members } = notDrawnMembers();
    for (const name of ["canopyWater", "canopyOver"]) expect(name in members, name).toBe(false);
    // The rain on the lens is the post chain's, which is drawn too: no part names any rain.
    expect(NOT_DRAWN.filter((part) => /rain|splash|drip|canopy|lens/.test(part.what))).toEqual([]);
  });

  it("leaves the lakes' water, its calm, its plants, its life, its shore's panorama and its mirror to the renderer: nothing of a lake is left", () => {
    const { members } = notDrawnMembers();
    for (const name of ["setWeatherName", "hasWaterLife", "waterLifeSound"]) expect(name in members, name).toBe(false);
    expect(NOT_DRAWN.filter((part) => /lake/.test(part.what))).toEqual([]);
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/insects|frogs|midges|dragonfl|plants|reeds|lil|panorama|mirror|calm/);
  });

  it("leaves the sea's swell, its wind waves by the loop or the FFT, its white water, its swash, its lip's curl, its spray, its surf and its water read through its surface to the renderer: nothing of the sea is left", () => {
    const { members } = notDrawnMembers();
    for (const name of ["hasSea", "surfSound"]) expect(name in members, name).toBe(false);
    const sea = NOT_DRAWN.filter((part) => /\bsea\b/.test(part.what));
    expect(sea).toEqual([]);
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/through the surface|reads what lies under/);
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/FFT|curl|spray|swash|surf's sound|swell|loop/);
  });

  it("leaves the scenes and the endings to the renderer: their cameras, the local hiker's own body, the death's dark and the end scene's car are played", () => {
    const { members, held } = notDrawnMembers();
    for (const name of ["setScene", "setEnding", "endScene", "clearEnding"]) expect(name in members, name).toBe(false);
    for (const name of ["scene", "ending", "endScene"]) expect(name in held, name).toBe(false);
    const all = NOT_DRAWN.map((part) => part.what).join("; ");
    expect(all).not.toMatch(/cameras|summit|\bcap\b|endings?|own body|scenes?\b/);
  });

  it("leaves a hand-authored level's brushes to the renderer: what is left of the debugging views is the wireframe, held", () => {
    const { members, held } = notDrawnMembers();
    expect(NOT_DRAWN.filter((part) => /brush/.test(part.what))).toEqual([]);
    expect(NOT_DRAWN.filter((part) => /wireframe/.test(part.what)).map((part) => part.members)).toEqual([["setWireframe"]]);
    members.setWireframe(true);
    expect(held.wireframe).toBe(true);
  });

  it("leaves the engine's read-outs to the renderer: a shader's compile, kept shaders and the GPU's time are its own", () => {
    const { members } = notDrawnMembers();
    for (const name of ["onShaderCompiled", "keepShaders", "gpuTime"]) expect(name in members, name).toBe(false);
    expect(NOT_DRAWN.map((part) => part.what).join("; ")).not.toMatch(/compile|kept shaders|timings/);
  });

  it("holds each renderer's own", () => {
    const a = notDrawnMembers();
    const b = notDrawnMembers();
    a.members.setWireframe(true);
    expect(b.held.wireframe).toBe(false);
  });
});
