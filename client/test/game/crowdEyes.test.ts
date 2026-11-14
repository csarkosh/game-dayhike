import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import {
  CROWD_EYES_NAME, CROWD_EYE_APART_M, CROWD_EYE_DIM_M, CROWD_EYE_EMBER, CROWD_EYE_GAIN, CROWD_EYE_HEIGHT, CROWD_EYE_M, CROWD_EYE_PALE, crowdEyeColour, createCrowdEyes,
} from "../../src/game/crowdEyes.js";
import { CROWD_RISE_S, figureOf, type CrowdFigure } from "../../src/game/crowdField.js";
import { HOLLOW_EYE_COLOR, HOLLOW_FIGURE_M } from "../../src/game/hollowLook.js";

const EYE = new Vector3(0, 11.7, 0);
const figure = (id: number, x: number, z: number, over: Partial<CrowdFigure> = {}): CrowdFigure => ({ id, x, z, born: 0, gone: -1, rise: 0, ...figureOf(id, 1), ...over });
const share = (c: { r: number; g: number; b: number }): number[] => { const sum = c.r + c.g + c.b; return [c.r / sum, c.g / sum, c.b / sum]; };

describe("the crowd's eyes", () => {
  let engine: NullEngine | undefined, scene: Scene | undefined;
  const make = (most = 4) => {
    engine = new NullEngine();
    scene = new Scene(engine);
    return createCrowdEyes(scene, most);
  };
  afterEach(() => { scene?.dispose(); engine?.dispose(); scene = undefined; engine = undefined; });

  it("are never the Hollow's red: a dull ember to pale, each far from it in hue", () => {
    const red = share(HOLLOW_EYE_COLOR);
    for (const c of [CROWD_EYE_EMBER, CROWD_EYE_PALE, crowdEyeColour(0.5)]) {
      const s = share(c);
      expect(Math.max(...s.map((v, i) => Math.abs(v - red[i]!)))).toBeGreaterThanOrEqual(0.25);
    }
    for (const k of ["r", "g", "b"] as const) {
      expect(crowdEyeColour(0)[k]).toBeCloseTo(CROWD_EYE_PALE[k], 9);
      expect(crowdEyeColour(1)[k]).toBeCloseTo(CROWD_EYE_EMBER[k], 9);
    }
    expect([CROWD_EYE_M, CROWD_EYE_APART_M, CROWD_EYE_HEIGHT, CROWD_EYE_GAIN]).toEqual([0.09, 0.34, 0.72, 1.6]);
    expect(CROWD_EYE_DIM_M).toEqual([40, 120]);
  });

  it("is one mesh and one additive material that writes no depth, for every pair there may be", () => {
    make(4);
    const m = scene!.getMaterialByName(CROWD_EYES_NAME) as ShaderMaterial;
    expect(m.alphaMode).toBe(Constants.ALPHA_ADD);
    expect(m.disableDepthWrite).toBe(true);
    expect(m.options.attributes).toEqual(["position", "crowdEye", "crowdColour"]);
    expect(m.options.uniforms).toEqual(["view", "projection"]);
    expect(scene!.meshes.length).toBe(1);
    const mesh = scene!.meshes[0]!;
    // Two eyes a figure, a quad an eye.
    expect(mesh.getTotalVertices()).toBe(4 * 2 * 4);
    expect(mesh.getTotalIndices()).toBe(4 * 2 * 6);
    expect(mesh.isPickable).toBe(false);
    expect(mesh.isEnabled()).toBe(false);
  });

  it("puts each figure's two eyes at its head, either side of its middle, in its own colour, by how much of it is there", () => {
    const eyes = make(4);
    const a = figure(1, 10, 0, { size: 1, eyes: 0.8, warm: 1 }), b = figure(2, -20, 5, { size: 0.5, eyes: 1, warm: 0, born: 100 });
    expect(eyes.sync([a, b], [3, 7], EYE, 100 + CROWD_RISE_S / 2, new Set())).toBe(2);
    const mesh = scene!.meshes[0]!;
    expect(mesh.isEnabled()).toBe(true);
    const at = mesh.getVerticesData("position")!, eye = mesh.getVerticesData("crowdEye")!, colour = mesh.getVerticesData("crowdColour")!;
    // Figure a: eight vertices, all at its head; the first quad one side of its middle, the second the other.
    for (let v = 0; v < 8; v++) {
      expect([at[v * 3], at[v * 3 + 1], at[v * 3 + 2]]).toEqual([10, Math.fround(3 + HOLLOW_FIGURE_M * CROWD_EYE_HEIGHT), 0]);
      expect(eye[v * 4 + 2]).toBeCloseTo(CROWD_EYE_M, 6);
      expect(eye[v * 4 + 3]).toBeCloseTo(v < 4 ? -CROWD_EYE_APART_M / 2 : CROWD_EYE_APART_M / 2, 6);
      expect([colour[v * 4], colour[v * 4 + 1], colour[v * 4 + 2]]).toEqual([CROWD_EYE_EMBER.r, CROWD_EYE_EMBER.g, CROWD_EYE_EMBER.b].map(Math.fround));
      // Wholly there, 10 m off: its eyes' own brightness times the gain.
      expect(colour[v * 4 + 3]).toBeCloseTo(0.8 * CROWD_EYE_GAIN, 5);
    }
    // The corners of a quad are its four.
    expect([0, 1, 2, 3].map((v) => [eye[v * 4], eye[v * 4 + 1]])).toEqual([[-1, -1], [1, -1], [-1, 1], [1, 1]]);
    // Figure b: half the size, half risen.
    expect(at[8 * 3 + 1]).toBeCloseTo(7 + HOLLOW_FIGURE_M * 0.5 * CROWD_EYE_HEIGHT, 4);
    expect(eye[8 * 4 + 2]).toBeCloseTo(CROWD_EYE_M * 0.5, 6);
    expect(colour[8 * 4 + 3]).toBeCloseTo(0.5 * CROWD_EYE_GAIN, 5);
    // The pairs not used are nothing.
    expect(eye[16 * 4 + 2]).toBe(0);
    expect(colour[16 * 4 + 3]).toBe(0);
  });

  it("dims with the metres from the eye and never goes out: eyes carry through the mist", () => {
    const eyes = make(2);
    eyes.sync([figure(1, 0, 40, { eyes: 1 }), figure(2, 0, 200, { eyes: 1 })], [0, 0], new Vector3(0, 0, 0), 50, new Set());
    const colour = scene!.meshes[0]!.getVerticesData("crowdColour")!;
    expect(colour[3]).toBeCloseTo(CROWD_EYE_GAIN, 2);
    expect(colour[8 * 4 + 3]).toBeGreaterThan(0.3 * CROWD_EYE_GAIN);
    expect(colour[8 * 4 + 3]).toBeLessThan(0.7 * CROWD_EYE_GAIN);
  });

  it("leaves out the figures another drawer holds, draws nothing with none, and never more than it was made for", () => {
    const eyes = make(2);
    expect(eyes.sync([figure(1, 5, 0), figure(2, 6, 0), figure(3, 7, 0)], [0, 0, 0], EYE, 50, new Set([2]))).toBe(2);
    const at = scene!.meshes[0]!.getVerticesData("position")!;
    expect([at[0], at[8 * 3]]).toEqual([5, 7]);
    expect(eyes.sync([figure(1, 5, 0), figure(2, 6, 0), figure(3, 7, 0)], [0, 0, 0], EYE, 50, new Set())).toBe(2);
    expect(eyes.sync([], [], EYE, 50, new Set())).toBe(0);
    expect(scene!.meshes[0]!.isEnabled()).toBe(false);
  });

  it("disposes its mesh and its material", () => {
    const eyes = make();
    eyes.dispose();
    expect(scene!.meshes.length).toBe(0);
    expect(scene!.getMaterialByName(CROWD_EYES_NAME)).toBeNull();
  });
});
