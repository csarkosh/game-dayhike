import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { CROWD_CARDS_NAME, CROWD_CARD_WIDE, createCrowdCards } from "../../src/game/crowdCards.js";
import { CROWD_RISE_S, figureOf, type CrowdFigure } from "../../src/game/crowdField.js";
import { SHADE_FAR_M, SHADE_FAR_SHARE, SHADE_NEAR_M } from "../../src/game/entityViews.js";
import { HOLLOW_FIGURE_M } from "../../src/game/hollowLook.js";
import { SHADE_LAYER } from "../../src/game/shadeSilhouette.js";

const EYE = new Vector3(0, 11.7, 0);
const figure = (id: number, x: number, z: number, over: Partial<CrowdFigure> = {}): CrowdFigure => ({ id, x, z, born: 0, gone: -1, rise: 0, ...figureOf(id, 1), ...over });

describe("the crowd's cards", () => {
  let engine: NullEngine | undefined, scene: Scene | undefined;
  const make = (most = 4) => {
    engine = new NullEngine();
    scene = new Scene(engine);
    return createCrowdCards(scene, most);
  };
  afterEach(() => { scene?.dispose(); engine?.dispose(); scene = undefined; engine = undefined; });

  it("is one mesh on the shade layer alone, so it is drawn into the mask and never into the frame", () => {
    const cards = make(4);
    const m = scene!.getMaterialByName(CROWD_CARDS_NAME) as ShaderMaterial;
    expect(m.alphaMode).toBe(Constants.ALPHA_COMBINE);
    expect(m.disableDepthWrite).toBe(true);
    expect(m.backFaceCulling).toBe(false);
    expect(m.options.attributes).toEqual(["position", "crowdCard", "crowdStir"]);
    expect(m.options.uniforms).toEqual(["view", "viewProjection", "crowdTime"]);
    expect(scene!.meshes.length).toBe(1);
    expect(cards.mesh).toBe(scene!.meshes[0]);
    expect(cards.mesh.layerMask).toBe(SHADE_LAYER);
    expect(cards.mesh.isPickable).toBe(false);
    expect(cards.mesh.getTotalVertices()).toBe(4 * 4);
    expect(cards.mesh.getTotalIndices()).toBe(4 * 6);
    expect(CROWD_CARD_WIDE).toBe(0.5);
  });

  it("stands a card on each figure's ground, as tall as the figure, whole within 20 m and fainter beyond, by how much of it is there", () => {
    const cards = make(4);
    const a = figure(1, 15, 0, { size: 1 }), b = figure(2, 0, -35, { size: 1.5, born: 100 });
    expect(cards.sync([a, b], [3, 7], EYE, 100 + CROWD_RISE_S / 2, new Set(), 0, 60)).toBe(2);
    const at = cards.mesh.getVerticesData("position")!, card = cards.mesh.getVerticesData("crowdCard")!, stir = cards.mesh.getVerticesData("crowdStir")!;
    for (let v = 0; v < 4; v++) {
      expect([at[v * 3], at[v * 3 + 1], at[v * 3 + 2]]).toEqual([15, 3, 0]);
      expect(card[v * 4 + 2]).toBeCloseTo(HOLLOW_FIGURE_M, 5);
      // Wholly there and within 20 m: whole in the mask.
      expect(card[v * 4 + 3]).toBeCloseTo(1, 5);
    }
    expect([0, 1, 2, 3].map((v) => [card[v * 4], card[v * 4 + 1]])).toEqual([[-1, 0], [1, 0], [-1, 1], [1, 1]]);
    // The second: one and a half times the size, half risen, 35 m off (and so fainter by the mist's own falloff).
    const far = 1 - (1 - SHADE_FAR_SHARE) * ((Math.hypot(35, 11.7 - 7) - SHADE_NEAR_M) / (SHADE_FAR_M - SHADE_NEAR_M));
    expect(card[4 * 4 + 2]).toBeCloseTo(HOLLOW_FIGURE_M * 1.5, 5);
    expect(card[4 * 4 + 3]).toBeCloseTo(0.5 * far, 3);
    // Each figure stirs on a beat of its own.
    expect(stir[0]).not.toBe(stir[4 * 2]);
    expect(stir[0]).toBe(stir[1 * 2]);
    // The cards not used are nothing.
    expect(card[8 * 4 + 2]).toBe(0);
    expect(card[8 * 4 + 3]).toBe(0);
  });

  it("draws only the figures in its band of distance that no other drawer holds, and says how many", () => {
    const cards = make(4);
    const figures = [figure(1, 5, 0), figure(2, 15, 0), figure(3, 25, 0), figure(4, 45, 0)];
    const heights = [11.7, 11.7, 11.7, 11.7];
    expect(cards.sync(figures, heights, EYE, 50, new Set(), 10, 30)).toBe(2);
    const at = cards.mesh.getVerticesData("position")!;
    expect([at[0], at[4 * 3]]).toEqual([15, 25]);
    expect(cards.sync(figures, heights, EYE, 50, new Set([2]), 10, 30)).toBe(1);
    expect(cards.sync(figures, heights, EYE, 50, new Set(), 0, 1000)).toBe(4);
    expect(cards.sync([], [], EYE, 50, new Set(), 0, 1000)).toBe(0);
  });

  it("gives the shader the seconds, folded so they never lose their precision", () => {
    const cards = make(1);
    cards.sync([figure(1, 5, 0)], [0], EYE, 12345.5, new Set(), 0, 100);
    const held = scene!.getMaterialByName(CROWD_CARDS_NAME) as unknown as { _floats: Record<string, number> };
    expect(held._floats.crowdTime).toBeGreaterThanOrEqual(0);
    expect(held._floats.crowdTime).toBeLessThan(1000);
  });

  it("disposes its mesh and its material", () => {
    const cards = make();
    cards.dispose();
    expect(scene!.meshes.length).toBe(0);
    expect(scene!.getMaterialByName(CROWD_CARDS_NAME)).toBeNull();
  });
});
