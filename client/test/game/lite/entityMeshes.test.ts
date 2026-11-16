import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../../../src/sim/constants.js";
import { SHADE_EYES_DULL, SHADE_EYES_SHADE, eyeLevelOf } from "../../../src/game/entityPoses.js";
import { HOLLOW_EYE_INTENSITY } from "../../../src/game/hollowLook.js";
import { ATMOSPHERE_PRIORITY } from "../../../src/game/lite/atmospherePlugin.js";
import { DRAW_ORDER, DRAW_PLACES, SEE_THROUGH_ORDER } from "../../../src/game/lite/drawOrder.js";
import {
  BODY_PLACES, CAPSULE_COLOUR, CAPSULE_ROUGHNESS, EYE_LEVEL_BYTES, HOLLOW_CAPACITY, RANGER_CAPACITY, eyeLevelPlugin, setEyeLevel,
} from "../../../src/game/lite/entityMeshes.js";
import { inOrder, tight } from "./wgslText.js";

describe("the hikers' bodies and the Hollows' eyes on Babylon Lite", () => {
  it("has room for every hiker in one ranger, and for a haunt's shades", () => {
    expect(RANGER_CAPACITY).toBeGreaterThanOrEqual(MAX_PLAYERS);
    expect(HOLLOW_CAPACITY).toBeGreaterThanOrEqual(8);
  });

  it("stands the rangers' primitives at the same places among the draws and the capsule after them, within the bodies' own run", () => {
    // A place a primitive by its order in the model, the same for every ranger: four at the most, then the capsule.
    expect(BODY_PLACES).toEqual({ rangers: 0, capsule: 4, figure: 5, eyes: 6 });
    // The Hollow's figure is the mask's: its primitives are drawn there, and in the frame's own pass as nothing, yet
    // they stand in the scene: they have a place in the bodies' run, after the capsule, and are not left at Lite's
    // own among the forest's. The Hollows' eyes, which the frame does show, are the last of the run.
    expect(BODY_PLACES.figure).toBeGreaterThan(BODY_PLACES.capsule);
    expect(Math.max(...Object.values(BODY_PLACES))).toBe(BODY_PLACES.eyes);
    expect((BODY_PLACES.eyes + 1) / DRAW_PLACES).toBeLessThan(DRAW_ORDER.cap - DRAW_ORDER.bodies);
  });

  it("draws the capsule in the game's blue, matt", () => {
    expect(CAPSULE_COLOUR).toEqual([0.3, 0.7, 0.95]);
    expect(CAPSULE_ROUGHNESS).toBe(0.85);
  });
});

describe("the Hollows' eyes at their level on Babylon Lite", () => {
  it("scales the light a pair gives off by its level, before the lights, and nothing else of the fragment", () => {
    const plugin = eyeLevelPlugin();
    const fragment = plugin.getCustomCode?.("fragment") as Record<string, string>;
    // The point after the material's own emissive is read and before the lights are summed with it.
    expect(Object.keys(fragment)).toEqual(["CUSTOM_FRAGMENT_UPDATE_DIFFUSE"]);
    expect(tight(fragment.CUSTOM_FRAGMENT_UPDATE_DIFFUSE as string)).toBe("emissive*=input.vEyeLevel;");
    // What the eye reflects, the lit colour and the alpha are left alone, and the fragment runs on to the air and the
    // tier's curve: it is not handed back here.
    for (const left of ["color", "alpha", "baseColor", "surfaceAlbedo", "return"]) expect(fragment.CUSTOM_FRAGMENT_UPDATE_DIFFUSE).not.toContain(left);
    expect(plugin.getUniforms).toBeUndefined();
    expect(plugin.getSamplers).toBeUndefined();
    // The real one's eyes, resolved, give off the dulled glow and a shade's next to nothing: the level times the eye's whole light.
    expect(eyeLevelOf(0, 1) * HOLLOW_EYE_INTENSITY).toBeCloseTo(SHADE_EYES_DULL, 12);
    expect(eyeLevelOf(1, 1) * HOLLOW_EYE_INTENSITY).toBeCloseTo(SHADE_EYES_SHADE, 12);
  });

  it("carries a pair's level in its instance, one float, hands it to the fragment, and puts a pair at no level outside the view", () => {
    const plugin = eyeLevelPlugin();
    expect(EYE_LEVEL_BYTES).toBe(Float32Array.BYTES_PER_ELEMENT);
    expect(plugin.getInstanceAttributes?.()).toEqual([{ name: "eyeLevel", type: "f32", format: "float32", stride: EYE_LEVEL_BYTES, offset: 0 }]);
    expect(plugin.getVaryings?.()).toEqual([{ name: "vEyeLevel", type: "f32" }]);
    const vertex = plugin.getCustomCode?.("vertex") as Record<string, string>;
    expect(Object.keys(vertex)).toEqual(["CUSTOM_VERTEX_MAIN_END"]);
    expect(inOrder(tight(vertex.CUSTOM_VERTEX_MAIN_END as string), ["out.vEyeLevel=eyeLevel;", "if(eyeLevel<=0.0){out.clipPos=vec4<f32>(2.0,2.0,2.0,1.0);}"])).toBe(true);
    // Last of the material's plugins, past the air: nothing after it moves a pair at no level back into the view.
    expect(plugin.priority).toBeGreaterThan(ATMOSPHERE_PRIORITY);
  });

  it("keeps a pair's level as the float it is sent as, and says whether the level changed", () => {
    const levels = new Float32Array(3);
    const dull = eyeLevelOf(0, 1);
    const shade = eyeLevelOf(1, 1);
    expect(dull).toBeCloseTo(SHADE_EYES_DULL / HOLLOW_EYE_INTENSITY, 12);
    expect(shade).toBeCloseTo(SHADE_EYES_SHADE / HOLLOW_EYE_INTENSITY, 12);
    expect(setEyeLevel(levels, 0, dull)).toBe(true);
    expect(setEyeLevel(levels, 2, shade)).toBe(true);
    expect([...levels]).toEqual([Math.fround(dull), 0, Math.fround(shade)]);
    // A level that stands is no change, so nothing is written for it: a level is compared as the float it is sent as.
    expect(setEyeLevel(levels, 0, dull)).toBe(false);
    expect(setEyeLevel(levels, 2, shade)).toBe(false);
    // On the way in the level rises with the figure, and each rise is a change.
    expect(setEyeLevel(levels, 1, eyeLevelOf(0, 0.75))).toBe(true);
    expect(setEyeLevel(levels, 1, eyeLevelOf(0, 0.85))).toBe(true);
    expect(levels[1]).toBeGreaterThan(0);
    expect(levels[1]).toBeLessThan(levels[0] as number);
  });

  it("stands the eyes among the opaque draws, so every see-through draw follows them: the motes, the mist and the rain are laid over the eyes", () => {
    const place = DRAW_ORDER.bodies + BODY_PLACES.eyes / DRAW_PLACES;
    expect(place).toBeLessThan(DRAW_ORDER.cap);
    expect(place).toBeLessThan(Math.min(...Object.values(SEE_THROUGH_ORDER)));
    // No place among the see-through draws is the eyes' any more: they are not blended.
    expect(Object.keys(SEE_THROUGH_ORDER)).not.toContain("eyes");
  });
});
