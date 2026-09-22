import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { PROPS, propSite } from "../../src/sim/passes/trailhead.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { buildRegister } from "../../src/sim/register.js";
import { SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/**
 * The register on real worlds. `register.test.ts` pins the rule at known
 * numbers on a hand-built graph; only a sweep over the generator's own worlds
 * can say the crest and the stem's last edge are there to read on every seed
 * a lobby can draw.
 *
 * Ten minutes, not because the sweep takes them — 227 worlds build in about
 * 170 s on their own — but because vitest runs this file beside the other
 * sweeps, and the contention stretches it past a 300 s guard. The timeout is
 * there to catch a hang, not to fence the run time.
 */
describe("the register over the 227-seed sweep", { timeout: 600_000 }, () => {
  it("names one hiker on every world and puts the body on the crest, facing back down the stem", () => {
    for (const seed of SEEDS) {
      const { graph } = bowlFor(seed);
      const site = (i: number) => propSite(graph, activeTerrainVariant().roadCenterX!, seed, PROPS[i]!);
      const r = buildRegister({ seed, graph, groundH: (x, z) => elevationAt(seed, x, z), box: site(0), car: site(2) });
      expect(r.hiker.name.length, `seed ${seed}`).toBeGreaterThan(0);
      const crest = graph.nodes[graph.summit]!;
      expect(r.body.pos.x).toBe(crest.x);
      expect(r.body.pos.z).toBe(crest.z);
      expect(Number.isFinite(r.body.yaw)).toBe(true);
    }
  });
});
