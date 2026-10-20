import { describe, it } from "vitest";
import { SEARCH_PARTS, checkSearchPart } from "./searchSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

// A limit for a hang, not a bar on speed: a part's 76 worlds build in about a minute here.
describe(`the search over the 227-seed sweep, part 2 of ${SEARCH_PARTS}`, { timeout: timeLimit(300_000) }, () => {
  it("names one hiker on every world, puts the body on the crest facing back down the stem, and hangs the poster on the board's face", () => {
    checkSearchPart(2);
  });
});
