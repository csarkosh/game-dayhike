import { describe, it } from "vitest";
import { HOLLOW_WALK_PARTS, checkHollowWalkPart } from "./hollowWalkSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the Hollow walks the stem on real terrain, part 1 of ${HOLLOW_WALK_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's 25 worlds take about a minute and a half on a CI runner.
  it("reaches its target at the treeline from the crest on 50 seeds", () => {
    checkHollowWalkPart(1);
  }, timeLimit(300_000));
});
