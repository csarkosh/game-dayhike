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
    for (const word of ["props", "sea", "lakes", "animals", "bodies", "dome", "shadows", "mist", "rain", "post chain", "scenes", "endings", "posts", "body at the crest"]) {
      expect(all, word).toContain(word);
    }
  });

  it("reads out nothing: no animal, no water to hear, no scene, no stare, a canopy with no water", () => {
    const { members } = notDrawnMembers();
    expect(members.hasWildlife).toBe(false);
    expect(members.wildlifeEvents()).toEqual([]);
    expect(members.wildlifeDirectorLog()).toEqual([]);
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
    expect(members.canopyWater()).toBe(0);
    expect(members.canopyOver()).toBe(0);
    expect(members.gpuTime).toBeNull();
  });

  it("keeps what its setters are told, held to the range each takes", () => {
    const { members, held } = notDrawnMembers();
    members.setChase(2);
    members.setHaunt(-1);
    members.setMistIn(0.25);
    members.setUnsettle(0.5);
    members.setPalette("dusk" as never);
    members.setWeatherName("rain");
    members.setWireframe(true);
    members.setSkinShading(false);
    members.setDepthOfField(true);
    expect(held).toMatchObject({
      chase: 1, haunt: 0, mistIn: 0.25, unsettle: 0.5, palette: "dusk", weatherName: "rain", wireframe: true, skinShading: false, depthOfField: true,
    });
    // The ground cloud's density is held and none is drawn.
    expect(members.setMist(0.7)).toBe(0);
    expect(held.mist).toBe(0.7);
    expect(members.setMist(null)).toBe(0);
    expect(held.mist).toBeNull();
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
