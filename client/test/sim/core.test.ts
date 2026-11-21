import { describe, expect, it } from "vitest";
import { MoveButton, cloneVec3, nextRandom } from "../../src/sim/core.js";
import * as types from "../../src/sim/types.js";
import { Button } from "../../src/sim/types.js";

describe("what the engine's simulation and Day Hike's share", () => {
  it("reads the same bits of a command's byte for movement: Day Hike's buttons keep the engine's three where they are", () => {
    expect([Button.Jump, Button.Crouch, Button.Sprint]).toEqual([MoveButton.Jump, MoveButton.Crouch, MoveButton.Sprint]);
    // Day Hike's own bits are the byte's others, none on top of the engine's.
    const own = [Button.Interact, Button.Lamp, Button.Taken];
    const moves = MoveButton.Jump | MoveButton.Crouch | MoveButton.Sprint;
    for (const bit of own) expect(bit & moves).toBe(0);
    expect(own.reduce((all, bit) => all | bit, moves)).toBeLessThan(256);
  });

  it("names the engine's pieces from Day Hike's records as it always did, the same functions and not copies", () => {
    expect(types.nextRandom).toBe(nextRandom);
    expect(types.cloneVec3).toBe(cloneVec3);
  });

  it("draws the random stream it always drew", () => {
    const state = { rngSeed: 12345 };
    const drawn = [nextRandom(state), nextRandom(state), nextRandom(state)];
    expect(drawn).toEqual([0.9797282677609473, 0.3067522644996643, 0.484205421525985]);
    expect(state.rngSeed).toBe(12345 + 3 * 0x6d2b79f5 | 0);
  });
});
