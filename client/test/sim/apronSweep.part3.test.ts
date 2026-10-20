import { describe, it } from "vitest";
import { APRON_PARTS, checkApronPart } from "./apronSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the apron over 205 seeds, part 3 of ${APRON_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's 34 worlds take about a minute on a CI runner.
  it("climbs from the road at a hillside's grade, is walkable on most of its width, and lets the trailhead reach the plateau", () => {
    checkApronPart(3);
  }, timeLimit(300_000));
});
