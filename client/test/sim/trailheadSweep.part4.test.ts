import { describe, it } from "vitest";
import { TRAILHEAD_PARTS, checkBoardPart, checkCarPart, checkPadPart, checkPlayerPart } from "./trailheadSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

// A limit for a hang, not a bar on speed: the first test builds the part's 38 worlds, in about a minute
// on a CI runner, and the three after it read the same worlds again.
describe(`the trailhead pass, part 4 of ${TRAILHEAD_PARTS}`, () => {
  it("puts the pad centre 9 m from the road centreline on every seed, and the car on the shoulder at the pad", () => {
    checkPadPart(4);
  }, timeLimit(300_000));

  it("keeps the car off the road bed and clear of the trail bed, over the 227-seed sweep", () => {
    checkCarPart(4);
  }, timeLimit(300_000));
});

describe(`the player's place, part 4 of ${TRAILHEAD_PARTS}`, () => {
  it("stands the player in front of the car, facing the trail's entrance, on every seed", () => {
    checkPlayerPart(4);
  }, timeLimit(300_000));
});

describe(`the board's place, part 4 of ${TRAILHEAD_PARTS}`, () => {
  it("stands in the player's view, clear of the bed, the road and the car, on every seed", () => {
    checkBoardPart(4);
  }, timeLimit(300_000));
});
