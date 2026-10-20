import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { trailheadPlaces } from "../../src/sim/trailhead.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { buildSearch } from "../../src/sim/search.js";
import { SEEDS } from "./trailGateSeeds.js";
import { seedPart } from "../helpers/seedPart.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/** The parts the sweep is split into, one test file each (`searchSweep.part<k>.test.ts`). */
export const SEARCH_PARTS = 3;

/**
 * The search on real worlds. `search.test.ts` pins the rule at known
 * numbers on a hand-built graph; only a sweep over the generator's own worlds
 * can say the crest and the stem's last edge are there to read on every seed
 * a lobby can draw. Every check is a seed's own, so the parts check together
 * what the sweep whole did (`seedPart`): 227 worlds build in about 170 s on
 * this machine and 360 s on a CI runner, which made the sweep, as one test,
 * one of the two floors under the client suite.
 */
export function checkSearchPart(part: number): void {
  for (const seed of seedPart(SEEDS, part, SEARCH_PARTS)) {
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
}
