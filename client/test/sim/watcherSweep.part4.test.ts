import { describe, it } from "vitest";
import { WATCHER_PARTS, checkWatcherPart } from "./watcherSweep.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe(`the watcher on fifty seeds, part 4 of ${WATCHER_PARTS}`, () => {
  // A limit for a hang, not a bar on speed: a part's six or seven worlds take up to about two minutes on a CI runner.
  it("stands only where every rule holds, and shows within 120 ticks as often as the part did when pinned", () => {
    checkWatcherPart(4);
  }, timeLimit(300_000));
});
