import { describe, it } from "vitest";
import { PLACEMENT_PARTS, checkPlacementPart } from "./cliffFieldSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the placement over 200 worlds, part 2 of ${PLACEMENT_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's fifty worlds take 65 to 90 s on a CI runner.
  it("carries no module further from its cell than CLIFF_RUN_REACH", () => {
    checkPlacementPart(2);
  }, timeLimit(420_000));
});
