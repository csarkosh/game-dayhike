import { describe, it } from "vitest";
import { TREELINE_PARTS, checkTreelinePart } from "./treeline.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the trail from the treeline, over the 227-seed sweep, part 4 of ${TREELINE_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's 56 worlds take about a minute and a half on a CI runner.
  it("leaves the pad inland, on no sand, into a wood, through a clearing", () => {
    checkTreelinePart(4);
  }, timeLimit(300_000));
});
