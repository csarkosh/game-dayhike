import { describe, expect, it } from "vitest";
import { DRAW_ORDER, DRAW_PLACES, SEE_THROUGH_ORDER, createDrawOrders } from "../../../src/game/lite/drawOrder.js";

describe("the places of the hike's meshes among the opaque draws on Babylon Lite", () => {
  it("draws the terrain first, the rings before the patches, then each shell in turn, ahead of nothing Lite places itself", () => {
    const firsts = Object.values(DRAW_ORDER);
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts);
    expect(new Set(firsts).size).toBe(firsts.length);
    expect(DRAW_ORDER.rings).toBeLessThan(DRAW_ORDER.patches);
    // Lite's own place for an opaque mesh is 100: nothing of the terrain's is drawn after an unplaced mesh.
    expect(DRAW_ORDER.patches).toBeLessThan(100);
    // The sky's dome, behind everything, after everything.
    expect(Math.max(...firsts)).toBe(DRAW_ORDER.sky);
  });

  it("gives a shell's materials the places after its first, in the order they are taken, each within the shell's own run", () => {
    const orders = createDrawOrders(DRAW_ORDER.forest);
    const [a, b, c] = [{}, {}, {}];
    orders.take(a);
    orders.take(b);
    orders.take(c);
    expect(orders.of(a)).toBe(DRAW_ORDER.forest);
    expect(orders.of(a)).toBeLessThan(orders.of(b) as number);
    expect(orders.of(b)).toBeLessThan(orders.of(c) as number);
    expect(orders.of(c)).toBeLessThan(DRAW_ORDER.clutter);
    expect(orders.of({})).toBeUndefined();
  });

  it("puts a material made late at the place it is named, whatever was taken meanwhile", () => {
    const first = createDrawOrders(DRAW_ORDER.forest);
    const second = createDrawOrders(DRAW_ORDER.forest);
    const card = {};
    // One page's bake lands before a near material is made, another's after: the card's place is the same.
    first.put(card, 512);
    first.take({});
    second.take({});
    second.take({});
    second.put(card, 512);
    expect(first.of(card)).toBe(second.of(card));
    expect(first.of(card)).toBe(DRAW_ORDER.forest + 512 / DRAW_PLACES);
    // The last place is still short of the next shell's first.
    first.put(card, DRAW_PLACES - 1);
    expect(first.of(card)).toBeLessThan(DRAW_ORDER.clutter);
    expect(() => first.put(card, DRAW_PLACES)).toThrow(/places among the draws/);
  });
});

describe("the places of the hike's see-through draws on Babylon Lite", () => {
  it("draws the motes before the mist banks, as Babylon.js draws a group's particles before its blended meshes", () => {
    const places = Object.values(SEE_THROUGH_ORDER);
    expect(new Set(places).size).toBe(places.length);
    expect(SEE_THROUGH_ORDER.motes).toBeLessThan(SEE_THROUGH_ORDER.mist);
  });

  it("draws the rain after the air's, the splashes before the drips and streaks, as the game's alpha indices order its three meshes", () => {
    expect(SEE_THROUGH_ORDER.mist).toBeLessThan(SEE_THROUGH_ORDER.splashes);
    expect(SEE_THROUGH_ORDER.splashes).toBeLessThan(SEE_THROUGH_ORDER.rain);
  });

  it("blends the water over the rain: the game leaves its surface at the default place, past the rain's", () => {
    expect(SEE_THROUGH_ORDER.rain).toBeLessThan(SEE_THROUGH_ORDER.water);
  });

  it("blends the sea over the rain too, and before the lakes that stand over it", () => {
    expect(SEE_THROUGH_ORDER.rain).toBeLessThan(SEE_THROUGH_ORDER.sea);
    expect(SEE_THROUGH_ORDER.sea).toBeLessThan(SEE_THROUGH_ORDER.water);
  });

  it("draws a lake's insects last of all, the midges before the dragonflies, as the game's highest index puts them", () => {
    expect(SEE_THROUGH_ORDER.water).toBeLessThan(SEE_THROUGH_ORDER.midges);
    expect(SEE_THROUGH_ORDER.midges).toBeLessThan(SEE_THROUGH_ORDER.dragonflies);
    expect(Math.max(...Object.values(SEE_THROUGH_ORDER))).toBe(SEE_THROUGH_ORDER.dragonflies);
  });

  it("draws the bodies, the cap and the animals after the world they stand in and before the sky", () => {
    expect(DRAW_ORDER.props).toBeLessThan(DRAW_ORDER.bodies);
    expect(DRAW_ORDER.bodies).toBeLessThan(DRAW_ORDER.cap);
    expect(DRAW_ORDER.cap).toBeLessThan(DRAW_ORDER.animals);
    expect(DRAW_ORDER.animals).toBeLessThan(DRAW_ORDER.sky);
  });

  it("draws a lake's reeds and lilies after the animals and before the sky", () => {
    expect(DRAW_ORDER.animals).toBeLessThan(DRAW_ORDER.waterPlants);
    expect(DRAW_ORDER.waterPlants).toBeLessThan(DRAW_ORDER.sky);
  });

  it("names places of their own, apart from the opaque ones", () => {
    // Lite draws its blended meshes after every opaque one whatever their places; the names stay apart all the same.
    expect(Math.min(...Object.values(SEE_THROUGH_ORDER))).toBeGreaterThan(Math.max(...Object.values(DRAW_ORDER)));
  });
});
