import { describe, it } from "vitest";
import { WIRE_PARTS, checkWirePart } from "./wireRangeSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the wire carries the whole forest, part 5 of ${WIRE_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's forty worlds take about a minute on a CI runner.
  it("round-trips every trailhead and trail node across a 200-seed sweep", () => {
    checkWirePart(5);
  }, timeLimit(300_000));
});
