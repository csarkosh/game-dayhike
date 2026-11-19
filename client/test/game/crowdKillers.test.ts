import { describe, expect, it } from "vitest";
import { CROWD_FADE_S, CROWD_RISE_S, figureOf, presenceOf, type CrowdFigure } from "../../src/game/crowdField.js";
import { KILLER_SIZE, createKillerShadows } from "../../src/game/crowdKillers.js";

const pose = (id: number, x: number, z: number, level = 1, shadow = true, reach = 0) => ({ id, x, z, level, shadow, reach });
const crowd = (id: number): CrowdFigure => ({ id, x: id, z: 0, born: 0, gone: -1, rise: 0, ...figureOf(id, 1) });

describe("the chase's killers among the crowd", () => {
  it("each is a figure of the crowd's kind that kills: a Hollow's size and a little, its eyes whole, where its body is drawn this frame", () => {
    const killers = createKillerShadows();
    killers.step([pose(7, 10, 20), pose(9, -3, 4)], 50);
    const shown = killers.shown([]);
    expect(shown.length).toBe(2);
    expect(KILLER_SIZE).toBe(1.15);
    expect(shown[0]).toMatchObject({ x: 10, z: 20, size: KILLER_SIZE, eyes: 1, kills: true, gone: -1 });
    // Numbers of their own, never one of the crowd's (which count up from 1).
    expect(shown.every((f) => f.id < 0)).toBe(true);
    expect(new Set(shown.map((f) => f.id)).size).toBe(2);
    killers.step([pose(7, 11, 21), pose(9, -3, 4)], 50.1);
    expect(killers.shown([])[0]).toMatchObject({ x: 11, z: 21 });
  });

  it("reaches as its body does: a lunge in its last metres and a strike have both arms out, as the model's were", () => {
    const killers = createKillerShadows();
    killers.step([pose(1, 0, 0, 1, true, 0), pose(2, 5, 0, 1, true, 0.6)], 50);
    expect(killers.shown([]).map((f) => f.reach)).toEqual([0, 0.6]);
    killers.step([pose(1, 0, 0, 1, true, 1), pose(2, 5, 0, 1, true, 0)], 50.1);
    expect(killers.shown([]).map((f) => f.reach)).toEqual([1, 0]);
  });

  it("is as far in as its body is: one that stands at once is whole, one coming up out of the mist comes in with it", () => {
    const killers = createKillerShadows();
    killers.step([pose(1, 0, 0, 1), pose(2, 5, 0, 0.25)], 50);
    const [whole, rising] = killers.shown([]) as [CrowdFigure, CrowdFigure];
    expect(presenceOf(whole, 50)).toBeCloseTo(1, 9);
    expect(presenceOf(rising, 50)).toBeCloseTo(0.25, 6);
    expect(presenceOf(rising, 50 + CROWD_RISE_S * 0.75)).toBeCloseTo(1, 6);
  });

  it("only what is drawn as a shadow: a body the model still draws is none of it", () => {
    const killers = createKillerShadows();
    killers.step([pose(1, 0, 0, 1, false), pose(2, 5, 0)], 50);
    expect(killers.shown([]).length).toBe(1);
  });

  it("one gone from the frame goes as a figure of the crowd goes, over its fade, and is then forgotten", () => {
    const killers = createKillerShadows();
    killers.step([pose(1, 0, 0)], 50);
    killers.step([], 51);
    const going = killers.shown([])[0] as CrowdFigure;
    expect(going.gone).toBe(51);
    expect(presenceOf(going, 51 + CROWD_FADE_S / 2)).toBeCloseTo(0.5, 6);
    killers.step([], 51 + CROWD_FADE_S + 0.01);
    expect(killers.shown([]).length).toBe(0);
  });

  it("stands first among what is shown, so that no killer is ever the figure a full crowd leaves out", () => {
    const killers = createKillerShadows();
    killers.step([pose(4, 0, 0)], 50);
    const figures = [crowd(1), crowd(2)];
    const shown = killers.shown(figures);
    expect(shown.map((f) => f.id)).toEqual([-5, 1, 2]);
    // The crowd's own list is left as it was, and the list handed back is reused.
    expect(figures.length).toBe(2);
    expect(killers.shown(figures)).toBe(shown);
  });

  it("forgets every one when told to", () => {
    const killers = createKillerShadows();
    killers.step([pose(1, 0, 0)], 50);
    killers.clear();
    expect(killers.shown([]).length).toBe(0);
  });
});
