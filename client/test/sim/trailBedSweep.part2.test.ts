import { describe, it } from "vitest";
import { BED_PARTS, checkBedBucketsPart, checkBedFlushPart, checkBedWalkPart } from "./trailBedSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

// A limit for a hang, not a bar on speed: the first test builds the part's 38 worlds, in about a minute
// on a CI runner, and the two after it read the same worlds again.
describe(`every trail bed is walkable on the composed field, part 2 of ${BED_PARTS}`, () => {
  it("never exceeds MAX_WALKABLE_GRADIENT on any edge of any seed, and reports the fallbacks", () => {
    checkBedWalkPart(2);
  }, timeLimit(420_000));

  it("is FLUSH: the bed the player stands on is the ground, to half a metre at p95", () => {
    checkBedFlushPart(2);
  }, timeLimit(420_000));

  it("fits every world's segments in the paint's buckets", () => {
    checkBedBucketsPart(2);
  }, timeLimit(300_000));
});
