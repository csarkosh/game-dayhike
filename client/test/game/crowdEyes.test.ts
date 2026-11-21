import { describe, expect, it } from "vitest";
import {
  CROWD_EYE_APART_M, CROWD_EYE_DIM_M, CROWD_EYE_EMBER, CROWD_EYE_FLOATS, CROWD_EYE_GAIN, CROWD_EYE_HEIGHT, CROWD_EYE_KILLS_GAIN, CROWD_EYE_KILLS_SIZE, CROWD_EYE_M, CROWD_EYE_PALE,
  CROWD_EYE_VERTICES,
  crowdEyeColour, crowdEyeIndices, crowdEyeVertices, writeCrowdEyes, CROWD_EYE_REACH_GAIN, CROWD_EYE_REACH_SIZE,
} from "../../src/game/crowdEyes.js";
import { CROWD_RISE_S, figureOf, type CrowdFigure } from "../../src/game/crowdField.js";
import { HOLLOW_EYE_COLOR, HOLLOW_FIGURE_M } from "@csarkosh/engine/game/hollowLook";

const EYE = { x: 0, y: 11.7, z: 0 };
const figure = (id: number, x: number, z: number, over: Partial<CrowdFigure> = {}): CrowdFigure => ({ id, x, z, born: 0, gone: -1, rise: 0, ...figureOf(id, 1), ...over });
const share = (c: { r: number; g: number; b: number }): number[] => { const sum = c.r + c.g + c.b; return [c.r / sum, c.g / sum, c.b / sum]; };

describe("the crowd's eyes", () => {
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

  it("gives a figure that kills the Hollow's own red, brighter and larger than any of the crowd's: that is what tells it", () => {
    expect([CROWD_EYE_KILLS_GAIN, CROWD_EYE_KILLS_SIZE]).toEqual([2, 1.7]);
    const out = crowdEyeVertices(2);
    const crowd = figure(1, 10, 0, { size: 1, eyes: 1, warm: 1 }), killer = figure(2, 12, 0, { size: 1, eyes: 1, warm: 1, kills: true });
    expect(writeCrowdEyes(out, 2, [crowd, killer], [3, 3], EYE, 100, new Set())).toBe(2);
    const eye = out.eyes, colour = out.colours;
    expect([colour[8 * 4], colour[8 * 4 + 1], colour[8 * 4 + 2]]).toEqual([HOLLOW_EYE_COLOR.r, HOLLOW_EYE_COLOR.g, HOLLOW_EYE_COLOR.b].map(Math.fround));
    expect(colour[8 * 4 + 3]).toBeCloseTo(colour[3]! * CROWD_EYE_KILLS_GAIN, 5);
    expect(eye[8 * 4 + 2]).toBeCloseTo(eye[2]! * CROWD_EYE_KILLS_SIZE, 6);
    // Its pair is as far apart as any figure's of its size.
    expect(eye[8 * 4 + 3]).toBeCloseTo(eye[3]!, 6);
  });

  it("opens a reaching figure's eyes: twice as bright and half as large again at the whole reach, where they were", () => {
    expect([CROWD_EYE_REACH_GAIN, CROWD_EYE_REACH_SIZE]).toEqual([2, 1.5]);
    const out = crowdEyeVertices(2);
    const stands = figure(1, 10, 0, { size: 1, eyes: 1, warm: 0.5 }), reaches = figure(2, 12, 0, { size: 1, eyes: 1, warm: 0.5, reach: 1 });
    expect(writeCrowdEyes(out, 2, [stands, reaches], [3, 3], EYE, 100, new Set())).toBe(2);
    expect(out.colours[8 * 4 + 3]).toBeCloseTo(out.colours[3]! * CROWD_EYE_REACH_GAIN, 5);
    expect(out.eyes[8 * 4 + 2]).toBeCloseTo(out.eyes[2]! * CROWD_EYE_REACH_SIZE, 6);
    expect(out.positions[8 * 3 + 1]).toBe(out.positions[1]);
  });

  it("have room for every pair there may be: two eyes a figure, a quad an eye", () => {
    const v = crowdEyeVertices(4);
    expect(CROWD_EYE_VERTICES).toBe(8);
    expect(v.positions.length).toBe(4 * CROWD_EYE_VERTICES * CROWD_EYE_FLOATS.position);
    expect(v.eyes.length).toBe(4 * CROWD_EYE_VERTICES * CROWD_EYE_FLOATS.eye);
    expect(v.colours.length).toBe(4 * CROWD_EYE_VERTICES * CROWD_EYE_FLOATS.colour);
    const indices = crowdEyeIndices(4);
    expect(indices.length).toBe(4 * 2 * 6);
    expect([...indices.subarray(0, 6)]).toEqual([0, 2, 1, 1, 2, 3]);
    expect(Math.max(...indices)).toBe(4 * CROWD_EYE_VERTICES - 1);
  });

  it("puts each figure's two eyes at its head, either side of its middle, in its own colour, by how much of it is there", () => {
    const out = crowdEyeVertices(4);
    const a = figure(1, 10, 0, { size: 1, eyes: 0.8, warm: 1 }), b = figure(2, -20, 5, { size: 0.5, eyes: 1, warm: 0, born: 100 });
    expect(writeCrowdEyes(out, 4, [a, b], [3, 7], EYE, 100 + CROWD_RISE_S / 2, new Set())).toBe(2);
    const at = out.positions, eye = out.eyes, colour = out.colours;
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
    const out = crowdEyeVertices(2);
    writeCrowdEyes(out, 2, [figure(1, 0, 40, { eyes: 1 }), figure(2, 0, 200, { eyes: 1 })], [0, 0], { x: 0, y: 0, z: 0 }, 50, new Set());
    expect(out.colours[3]).toBeCloseTo(CROWD_EYE_GAIN, 2);
    expect(out.colours[8 * 4 + 3]).toBeGreaterThan(0.3 * CROWD_EYE_GAIN);
    expect(out.colours[8 * 4 + 3]).toBeLessThan(0.7 * CROWD_EYE_GAIN);
  });

  it("leaves out the figures another drawer holds, writes nothing with none, and never more than there is room for", () => {
    const out = crowdEyeVertices(2);
    const three = [figure(1, 5, 0), figure(2, 6, 0), figure(3, 7, 0)];
    expect(writeCrowdEyes(out, 2, three, [0, 0, 0], EYE, 50, new Set([2]))).toBe(2);
    expect([out.positions[0], out.positions[8 * 3]]).toEqual([5, 7]);
    expect(writeCrowdEyes(out, 2, three, [0, 0, 0], EYE, 50, new Set())).toBe(2);
    expect(writeCrowdEyes(out, 2, [], [], EYE, 50, new Set())).toBe(0);
    // Every pair is nothing again.
    expect(out.eyes.every((v) => v === 0)).toBe(true);
    expect(out.colours.every((v) => v === 0)).toBe(true);
  });
});
