import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../../../src/sim/constants.js";
import { RANGER_IDS } from "../../../src/game/entityPoses.js";
import { DRAW_ORDER, DRAW_PLACES } from "../../../src/game/lite/drawOrder.js";
import { CAPSULE_COLOUR, CAPSULE_ROUGHNESS, HOLLOW_CAPACITY, RANGER_CAPACITY } from "../../../src/game/lite/entityMeshes.js";

describe("the hikers' bodies and the Hollows' eyes on Babylon Lite", () => {
  it("has room for every hiker in one ranger, and for a haunt's shades", () => {
    expect(RANGER_CAPACITY).toBeGreaterThanOrEqual(MAX_PLAYERS);
    expect(HOLLOW_CAPACITY).toBeGreaterThanOrEqual(8);
  });

  it("places every ranger's primitives, the capsule and the Hollow's among the draws, within the bodies' own run", () => {
    expect((RANGER_IDS.length * 4 + 1 + 4) / DRAW_PLACES).toBeLessThan(DRAW_ORDER.cap - DRAW_ORDER.bodies);
  });

  it("draws the capsule in the game's blue, matt", () => {
    expect(CAPSULE_COLOUR).toEqual([0.3, 0.7, 0.95]);
    expect(CAPSULE_ROUGHNESS).toBe(0.85);
  });
});
