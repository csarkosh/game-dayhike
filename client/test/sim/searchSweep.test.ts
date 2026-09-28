import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { trailheadPlaces } from "../../src/sim/trailhead.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { buildSearch } from "../../src/sim/search.js";
import { SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/**
 * The search on real worlds. `search.test.ts` pins the rule at known
 * numbers on a hand-built graph; only a sweep over the generator's own worlds
 * can say the crest and the stem's last edge are there to read on every seed
 * a lobby can draw.
 *
 * Ten minutes, not because the sweep takes them — 227 worlds build in about
 * 170 s on their own — but because vitest runs this file beside the other
 * sweeps, and the contention stretches it past a 300 s guard. The timeout is
 * there to catch a hang, not to fence the run time.
 */
describe("the search over the 227-seed sweep", { timeout: timeLimit(600_000) }, () => {
  it("names one hiker on every world, puts the body on the crest facing back down the stem, and hangs the poster on the board's face", () => {
    for (const seed of SEEDS) {
      const { graph } = bowlFor(seed);
      const places = trailheadPlaces(graph, activeTerrainVariant().roadCenterX!, seed);
      const r = buildSearch({ seed, graph, groundH: (x, z) => elevationAt(seed, x, z), board: places.board, car: places.car });
      expect(r.hiker.name.length, `seed ${seed}`).toBeGreaterThan(0);
      const crest = graph.nodes[graph.summit]!;
      expect(r.body.pos.x).toBe(crest.x);
      expect(r.body.pos.z).toBe(crest.z);
      expect(Number.isFinite(r.body.yaw)).toBe(true);
      // The poster hangs 0.36 m along the board and 0.325 m in front of it, toward where a player arrives.
      const b = places.board;
      expect(Math.hypot(r.poster.x - b.x, r.poster.z - b.z), `seed ${seed}`).toBeCloseTo(0.485, 3);
      expect((r.poster.x - b.x) * b.fx + (r.poster.z - b.z) * b.fz, `seed ${seed}`).toBeCloseTo(0.325, 9);
    }
  });
});
