import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../../../src/sim/constants.js";
import { SHADE_EYES_DULL, SHADE_EYES_SHADE, eyeLevelOf } from "../../../src/game/entityPoses.js";
import { HOLLOW_EYE_INTENSITY, HOLLOW_SCALE } from "../../../src/game/hollowLook.js";
import { writeBodyMatrix } from "../../../src/game/skinInstances.js";
import { ATMOSPHERE_PRIORITY } from "../../../src/game/lite/atmospherePlugin.js";
import { DRAW_ORDER, DRAW_PLACES, SEE_THROUGH_ORDER } from "../../../src/game/lite/drawOrder.js";
import {
  BODY_PLACES, CAPSULE_COLOUR, CAPSULE_ROUGHNESS, EYE_LEVEL_BYTES, HOLLOW_CAPACITY, RANGER_CAPACITY, eyeLevelPlugin, liftBody, setEyeLevel,
} from "../../../src/game/lite/entityMeshes.js";
import { tight } from "./wgslText.js";

/** Where the body whose matrix is `m` (sixteen floats, by columns) puts the point `p` of its model. */
function placed(m: Float32Array, p: readonly [number, number, number]): number[] {
  return [0, 1, 2].map((row) => (m[row] as number) * p[0] + (m[4 + row] as number) * p[1] + (m[8 + row] as number) * p[2] + (m[12 + row] as number));
}

describe("the hikers' bodies and the Hollows' eyes on Babylon Lite", () => {
  it("has room for every hiker in one ranger, and for a haunt's shades", () => {
    expect(RANGER_CAPACITY).toBeGreaterThanOrEqual(MAX_PLAYERS);
    expect(HOLLOW_CAPACITY).toBeGreaterThanOrEqual(8);
  });

  it("stands the rangers' primitives at the same places among the draws and the capsule after them, within the bodies' own run", () => {
    // A place a primitive by its order in the model, the same for every ranger: four at the most, then the capsule.
    expect(BODY_PLACES).toEqual({ rangers: 0, capsule: 4, figure: 5 });
    // The Hollow's figure is the mask's: its primitives are drawn there, and in the frame's own pass as nothing, yet
    // they stand in the scene: they have a place in the bodies' run, the last, and are not left at Lite's own among
    // the forest's.
    expect(Math.max(...Object.values(BODY_PLACES))).toBe(BODY_PLACES.figure);
    expect((BODY_PLACES.figure + 1) / DRAW_PLACES).toBeLessThan(DRAW_ORDER.cap - DRAW_ORDER.bodies);
  });

  it("draws the capsule in the game's blue, matt", () => {
    expect(CAPSULE_COLOUR).toEqual([0.3, 0.7, 0.95]);
    expect(CAPSULE_ROUGHNESS).toBe(0.85);
  });
});

describe("the Hollows' eyes at their level on Babylon Lite", () => {
  it("blends a pair by its level alone: the fragment is handed back with the alpha its instance's colour left, before Lite adds what the surface reflects", () => {
    const plugin = eyeLevelPlugin();
    const fragment = plugin.getCustomCode?.("fragment") as Record<string, string>;
    expect(Object.keys(fragment)).toEqual(["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR"]);
    expect(tight(fragment.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR as string)).toBe("returnvec4<f32>(color,alpha*material.materialAlpha);");
    expect(plugin.getCustomCode?.("vertex")).toBeNull();
    expect(plugin.getUniforms).toBeUndefined();
    // Last at its point: the air has been laid over the colour by then.
    expect(plugin.priority).toBeGreaterThan(ATMOSPHERE_PRIORITY);
  });

  it("carries a pair's level as its colour's alpha, the colour left white, and says whether the level changed", () => {
    const colours = new Float32Array(3 * 4).fill(1);
    expect(EYE_LEVEL_BYTES).toBe(4 * Float32Array.BYTES_PER_ELEMENT);
    const dull = eyeLevelOf(0, 1);
    const shade = eyeLevelOf(1, 1);
    expect(dull).toBeCloseTo(SHADE_EYES_DULL / HOLLOW_EYE_INTENSITY, 12);
    expect(shade).toBeCloseTo(SHADE_EYES_SHADE / HOLLOW_EYE_INTENSITY, 12);
    expect(setEyeLevel(colours, 0, dull)).toBe(true);
    expect(setEyeLevel(colours, 2, shade)).toBe(true);
    expect([...colours]).toEqual([1, 1, 1, Math.fround(dull), 1, 1, 1, 1, 1, 1, 1, Math.fround(shade)]);
    // A level that stands is no change, so nothing is written for it: a level is compared as the float it is sent as.
    expect(setEyeLevel(colours, 0, dull)).toBe(false);
    expect(setEyeLevel(colours, 2, shade)).toBe(false);
    // On the way in the level rises with the figure, and each rise is a change.
    expect(setEyeLevel(colours, 1, eyeLevelOf(0, 0.75))).toBe(true);
    expect(setEyeLevel(colours, 1, eyeLevelOf(0, 0.85))).toBe(true);
    expect(colours[7]).toBeGreaterThan(0);
    expect(colours[7]).toBeLessThan(colours[3] as number);
  });

  it("carries the lift a model's root gives its mesh in each body's matrix, so the mesh can stand at the world's origin", () => {
    // Lite draws a body as its instance's matrix times the mesh's: a mesh lifted by `lift` under a body's matrix is
    // the mesh at the origin under that matrix times the lift.
    const lift: [number, number, number] = [0.25, 0.9726, -0.5];
    const body = new Float32Array(16);
    writeBodyMatrix(body, 0, 250, 80, -500, 1.09, HOLLOW_SCALE);
    const lifted = body.slice();
    liftBody(lifted, lift);
    for (const p of [[0, 0, 0], [0.1, 1.7, -0.2], [-3, 0.5, 4]] as const) {
      const want = placed(body, [p[0] + lift[0], p[1] + lift[1], p[2] + lift[2]]);
      const got = placed(lifted, p);
      for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i] as number, 3);
    }
    // The turn and the scale are the body's own.
    expect([...lifted.subarray(0, 12)]).toEqual([...body.subarray(0, 12)]);
    expect(lifted[15]).toBe(1);
    // A model with no lift is left where it stood.
    const still = body.slice();
    liftBody(still, [0, 0, 0]);
    expect([...still]).toEqual([...body]);
  });

  it("takes the first place among the see-through draws: the motes, the mist and the rain are laid over the eyes", () => {
    expect(SEE_THROUGH_ORDER.eyes).toBe(Math.min(...Object.values(SEE_THROUGH_ORDER)));
    expect(SEE_THROUGH_ORDER.eyes).toBeGreaterThan(Math.max(...Object.values(DRAW_ORDER)));
  });
});
