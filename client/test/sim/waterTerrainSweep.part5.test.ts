import { describe, it } from "vitest";
import { WATER_CHECKS, WATER_PARTS } from "./waterTerrainSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

// A limit for a hang, not a bar on speed: a part's worlds build and are scanned in about a minute on a CI runner.
describe(`the water terrain over 200 worlds, part 5 of ${WATER_PARTS}`, { timeout: timeLimit(1_200_000) }, () => {
  for (const [name, check] of WATER_CHECKS) it(name, () => check(5));
});
