import { describe, it } from "vitest";
import { WAY_PARTS, checkWayPart } from "./waySweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the way down on fifty worlds, part 4 of ${WAY_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's five worlds are each built, drawn and run down.
  it("draws a way that keeps the design's rules, and a runner sprints down it to the road", () => {
    checkWayPart(4);
  }, timeLimit(600_000));
});
