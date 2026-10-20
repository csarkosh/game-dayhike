import { describe, it } from "vitest";
import { CUT_PARTS, checkCutPart } from "./cutSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the cut on fifty seeds, part 1 of ${CUT_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's sixteen or seventeen worlds take about a minute on a CI runner.
  it("walks the guide home on every seed, and cuts only what the guide reaches", () => {
    checkCutPart(1);
  }, timeLimit(300_000));
});
