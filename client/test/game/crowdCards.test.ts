import { describe, expect, it } from "vitest";
import {
  CROWD_CARDS_TO_M, CROWD_CARD_FLOATS, CROWD_CARD_FOLD_S, CROWD_CARD_VERTICES, CROWD_CARD_WIDE, crowdCardIndices, crowdCardTime, crowdCardVertices, writeCrowdCards, CROWD_CARD_KILLS,
} from "../../src/game/crowdCards.js";
import { CROWD_MIST_M, CROWD_RISE_S, figureOf, type CrowdFigure } from "../../src/game/crowdField.js";
import { SHADE_FAR_M, SHADE_FAR_SHARE, SHADE_NEAR_M } from "../../src/game/entityPoses.js";
import { HOLLOW_FIGURE_M } from "../../src/game/hollowLook.js";

const EYE = { x: 0, y: 11.7, z: 0 };
const figure = (id: number, x: number, z: number, over: Partial<CrowdFigure> = {}): CrowdFigure => ({ id, x, z, born: 0, gone: -1, rise: 0, ...figureOf(id, 1), ...over });

describe("the crowd's cards", () => {
  it("have room for every card there may be: a quad a figure, half as wide as it is tall, out past the mist's reach", () => {
    const v = crowdCardVertices(4);
    expect(CROWD_CARD_VERTICES).toBe(4);
    expect(v.positions.length).toBe(4 * CROWD_CARD_VERTICES * CROWD_CARD_FLOATS.position);
    expect(v.cards.length).toBe(4 * CROWD_CARD_VERTICES * CROWD_CARD_FLOATS.card);
    expect(v.stirs.length).toBe(4 * CROWD_CARD_VERTICES * CROWD_CARD_FLOATS.stir);
    const indices = crowdCardIndices(4);
    expect(indices.length).toBe(4 * 6);
    expect([...indices.subarray(0, 6)]).toEqual([0, 2, 1, 1, 2, 3]);
    expect(CROWD_CARD_WIDE).toBe(0.5);
    // The body is gone into the mist before the card is.
    expect(CROWD_CARDS_TO_M).toBe(36);
    expect(CROWD_CARDS_TO_M).toBeGreaterThan(CROWD_MIST_M);
  });

  it("stands a card on each figure's ground, as tall as the figure, whole within 20 m and fainter beyond, by how much of it is there", () => {
    const out = crowdCardVertices(4);
    const a = figure(1, 15, 0, { size: 1 }), b = figure(2, 0, -35, { size: 1.5, born: 100 });
    expect(writeCrowdCards(out, 4, [a, b], [3, 7], EYE, 100 + CROWD_RISE_S / 2, new Set(), 0, 60)).toBe(2);
    const at = out.positions, card = out.cards, stir = out.stirs;
    for (let v = 0; v < 4; v++) {
      expect([at[v * 3], at[v * 3 + 1], at[v * 3 + 2]]).toEqual([15, 3, 0]);
      expect(card[v * 4 + 2]).toBeCloseTo(HOLLOW_FIGURE_M, 5);
      // Wholly there and within 20 m: whole.
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

  it("draws a figure that kills darker than the crowd's: a solid body where theirs is a veil", () => {
    expect(CROWD_CARD_KILLS).toBe(1.3);
    const out = crowdCardVertices(2);
    const crowd = figure(1, 15, 0, { size: 1 }), killer = figure(2, 0, 15, { size: 1, kills: true });
    expect(writeCrowdCards(out, 2, [crowd, killer], [3, 3], EYE, 100, new Set(), 0, 60)).toBe(2);
    expect(out.cards[4 * 4 + 3]).toBeCloseTo(out.cards[3]! * CROWD_CARD_KILLS, 5);
  });

  it("tells the shader a figure's reach in the length of its corner's x, and draws one that reaches as solid as one that kills, no taller", () => {
    const out = crowdCardVertices(3);
    const stands = figure(1, 15, 0, { size: 1 }), half = figure(2, 0, 15, { size: 1, reach: 0.5 }), whole = figure(3, -15, 0, { size: 1, reach: 1 });
    expect(writeCrowdCards(out, 3, [stands, half, whole], [3, 3, 3], EYE, 100, new Set(), 0, 60)).toBe(3);
    const card = out.cards;
    // The corners' x: its sign the corner, its length one and the reach.
    expect([0, 1, 2, 3].map((v) => card[v * 4])).toEqual([-1, 1, -1, 1]);
    expect([0, 1, 2, 3].map((v) => card[(4 + v) * 4])).toEqual([-1.5, 1.5, -1.5, 1.5]);
    expect([0, 1, 2, 3].map((v) => card[(8 + v) * 4])).toEqual([-2, 2, -2, 2]);
    expect(card[8 * 4 + 2]).toBeCloseTo(HOLLOW_FIGURE_M, 5);
    expect(card[8 * 4 + 3]).toBeCloseTo(card[3]! * CROWD_CARD_KILLS, 5);
    expect(card[4 * 4 + 3]).toBeCloseTo(card[3]! * (1 + (CROWD_CARD_KILLS - 1) / 2), 5);
  });

  it("writes only the figures in its band of distance that no other drawer holds, and says how many", () => {
    const out = crowdCardVertices(4);
    const figures = [figure(1, 5, 0), figure(2, 15, 0), figure(3, 25, 0), figure(4, 45, 0)];
    const heights = [11.7, 11.7, 11.7, 11.7];
    expect(writeCrowdCards(out, 4, figures, heights, EYE, 50, new Set(), 10, 30)).toBe(2);
    expect([out.positions[0], out.positions[4 * 3]]).toEqual([15, 25]);
    expect(writeCrowdCards(out, 4, figures, heights, EYE, 50, new Set([2]), 10, 30)).toBe(1);
    expect(writeCrowdCards(out, 4, figures, heights, EYE, 50, new Set(), 0, 1000)).toBe(4);
    expect(writeCrowdCards(out, 2, figures, heights, EYE, 50, new Set(), 0, 1000)).toBe(2);
    expect(writeCrowdCards(out, 4, [], [], EYE, 50, new Set(), 0, 1000)).toBe(0);
    expect(out.cards.every((v) => v === 0)).toBe(true);
  });

  it("gives the shader the seconds, folded so they never lose their precision", () => {
    expect(CROWD_CARD_FOLD_S).toBe(1000);
    expect(crowdCardTime(12345.5)).toBeCloseTo(345.5, 6);
    expect(crowdCardTime(999.9)).toBeCloseTo(999.9, 6);
    expect(crowdCardTime(1000)).toBe(0);
  });
});
