import { describe, expect, it } from "vitest";
import { DRAW_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import { patchPlace } from "../../../src/game/lite/terrainMeshes.js";

describe("the terrain's meshes on Babylon Lite", () => {
  it("draws a patch at its cell's place, after every ring and before the trees, the same whenever its mesh was made", () => {
    for (const [ci, cj] of [[0, 0], [14, -25], [-33, 7], [1000, -1000]] as const) {
      const place = patchPlace(ci, cj);
      expect(place).toBeGreaterThanOrEqual(DRAW_ORDER.patches);
      expect(place).toBeLessThan(DRAW_ORDER.patches + 1);
      expect(place).toBeGreaterThan(DRAW_ORDER.rings + 1);
      expect(place).toBeLessThan(DRAW_ORDER.forest);
      expect(patchPlace(ci, cj)).toBe(place);
    }
  });

  it("gives the cells of one set places of their own: none within the patches' widest reach shares one", () => {
    // The high tier's wide band reaches 400 m from the camera's cell: 25 cells of 16 m a way, 51 across at most...
    // and two patches share an edge only as neighbours, which never share a place.
    const seen = new Map<number, string>();
    for (let ci = -40; ci < -40 + 32; ci++) {
      for (let cj = 90; cj < 90 + 32; cj++) {
        const place = patchPlace(ci, cj);
        expect(seen.has(place)).toBe(false);
        seen.set(place, `${ci},${cj}`);
      }
    }
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
      expect(patchPlace(-5 + di, 31 + dj)).not.toBe(patchPlace(-5, 31));
    }
  });
});
