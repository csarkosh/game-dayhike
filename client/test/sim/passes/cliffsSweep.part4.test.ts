import { describe, it } from "vitest";
import { COLLIDER_PARTS, checkColliderPart } from "./cliffsSweep.js";
import { timeLimit } from "../../helpers/timeLimit.js";

describe(`the colliders over the 200-world sweep, part 4 of ${COLLIDER_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's fifty worlds take 50 to 90 s on a CI runner.
  it("contain the drawn solid, and bury their uphill faces in the hill, over the 200-world sweep", () => {
    checkColliderPart(4);
  }, timeLimit(420_000));
});
