import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { seedFromToken } from "../../src/game/seed.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer } from "../../src/sim/world.js";
import { expectSurvives } from "./wireRangeSweep.js";

// Every trailhead and trail node of a 200-seed sweep round-trips too, in parts (`wireRangeSweep.ts`).
describe("the wire carries the whole forest", () => {
  it("round-trips a player spawned in the forest on seed token probe1 (the live repro)", () => {
    const seed = seedFromToken("probe1");
    const world = createForestWorld(createForest(seed));
    const player = spawnPlayer(world);
    // The trailhead on this seed sits near x = -384: beyond the +/-256 m an
    // int16 at 1/128 m can carry. A joiner here used to be pinned to -256.
    expect(player.pos.x).toBeLessThan(-256);
    expectSurvives(player.pos, "probe1 spawn");
  });
});
