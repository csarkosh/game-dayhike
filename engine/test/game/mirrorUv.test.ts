import { describe, it, expect } from "vitest";
import { MIRROR_DEPTH_FULL, MIRROR_OFFSET_K, mirrorUv } from "../../src/game/mirrorView.js";

/** A surface point the mirrored camera sees at clip (0.2, −0.4, ·, 2): the texel (0.55, 0.4) before any ripple. */
const CLIP: [number, number, number] = [0.2, -0.4, 2];
const K = MIRROR_OFFSET_K;

describe("mirrorUv, the twin of the lake's mirror read", () => {
  it("maps the clip position to 0..1 as Babylon reads a target, v up the screen", () => {
    expect(mirrorUv(0, 0, 1, 0, 0, 1, 1, K)).toEqual([0.5, 0.5]);
    expect(mirrorUv(-1, -1, 1, 0, 0, 1, 1, K)).toEqual([0, 0]);
    expect(mirrorUv(2, 2, 2, 0, 0, 1, 1, K)).toEqual([1, 1]);
    const [u, v] = mirrorUv(...CLIP, 0, 0, 1, 1, K);
    expect(u).toBeCloseTo(0.55, 12);
    expect(v).toBeCloseTo(0.4, 12);
  });

  it("does not move at the contact line, moves by half at 25 cm of water, and by the whole from 50 cm down", () => {
    expect(MIRROR_OFFSET_K).toBe(0.05);
    expect(MIRROR_DEPTH_FULL).toBe(0.5);
    // A slope of (0.1, −0.2) at a view depth of 1 m: the whole offset is (0.005, −0.01).
    const at = (depth: number) => mirrorUv(...CLIP, 0.1, -0.2, depth, 1, K);
    const [u0, v0] = at(0);
    expect(u0).toBeCloseTo(0.55, 12);
    expect(v0).toBeCloseTo(0.4, 12);
    const [uHalf, vHalf] = at(0.25);
    expect(uHalf).toBeCloseTo(0.5525, 12);
    expect(vHalf).toBeCloseTo(0.395, 12);
    for (const depth of [0.5, 5]) {
      const [u, v] = at(depth);
      expect(u, `${depth} m`).toBeCloseTo(0.555, 12);
      expect(v, `${depth} m`).toBeCloseTo(0.39, 12);
    }
  });

  it("moves by the offset over the view depth, never more than at 1 m", () => {
    const [u10, v10] = mirrorUv(...CLIP, 0.1, -0.2, 5, 10, K);
    expect(u10).toBeCloseTo(0.5505, 12);
    expect(v10).toBeCloseTo(0.399, 12);
    // Nearer than a metre the offset holds at its 1 m size.
    const [uNear, vNear] = mirrorUv(...CLIP, 0.1, -0.2, 5, 0.3, K);
    expect(uNear).toBeCloseTo(0.555, 12);
    expect(vNear).toBeCloseTo(0.39, 12);
  });

  it("never moves the read up the screen, however the ripple leans", () => {
    for (const depth of [0, 0.25, 0.5, 5]) {
      for (const viewDepth of [1, 10]) {
        const [, v] = mirrorUv(...CLIP, 0.1, 0.2, depth, viewDepth, K);
        expect(v, `${depth} m deep, ${viewDepth} m off`).toBeCloseTo(0.4, 12);
      }
    }
    // Across the screen it still moves.
    const [u] = mirrorUv(...CLIP, 0.1, 0.2, 5, 1, K);
    expect(u).toBeCloseTo(0.555, 12);
  });
});
