import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { activeTerrainVariant, elevationAt, setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { PROPS, propSite } from "../../src/sim/passes/trailhead.js";
import { MAX_SITES, MIN_SITES, SITE_SPACING, buildRegister, type Register } from "../../src/sim/register.js";
import { SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

describe("the register over the 227-seed sweep", { timeout: 300_000 }, () => {
  const v = activeTerrainVariant();
  const build = (seed: number): Register => {
    const bowl = bowlFor(seed);
    const site = (i: number) => propSite(bowl.graph, v.roadCenterX!, seed, PROPS[i]!);
    return buildRegister({
      seed, graph: bowl.graph, landmarks: bowl.landmarks,
      groundH: (x, z) => elevationAt(seed, x, z), box: site(0), car: site(2),
    });
  };
  const registers = SEEDS.map((seed) => ({ seed, graph: bowlFor(seed).graph, register: build(seed) }));

  it("gives every world 2 to 4 hikers, one per built loop plus the summit", () => {
    let fallbacks = 0;
    for (const { seed, graph, register } of registers) {
      const n = register.hikers.length;
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_SITES);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(MAX_SITES);
      if (graph.loops.length === 0) {
        fallbacks++;
        expect(register.hikers.map((h) => h.site.kind), `seed ${seed}`).toEqual(["summit", expect.stringMatching(/^(stand|talus)$/)]);
      } else {
        expect(n, `seed ${seed}`).toBe(1 + graph.loops.length);
      }
    }
    expect(fallbacks).toBeGreaterThan(0);
  });

  it("lays every item on the trail bed, and no two hikers at one site", () => {
    for (const { seed, graph, register } of registers) {
      for (const h of register.hikers) {
        expect(trailDistance(graph, h.site.x, h.site.z), `seed ${seed} ${h.site.name}`).toBeLessThanOrEqual(TRAIL_BED_HALF + 1e-6);
      }
      for (let i = 0; i < register.hikers.length; i++) {
        for (let j = i + 1; j < register.hikers.length; j++) {
          const a = register.hikers[i]!.site, b = register.hikers[j]!.site;
          const dx = a.x - b.x, dz = a.z - b.z;
          expect(Math.sqrt(dx * dx + dz * dz), `seed ${seed} ${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(SITE_SPACING);
        }
      }
    }
  });

  it("reads the same book twice and never repeats a site name in one world", () => {
    for (const { seed, register } of registers) {
      const again = build(seed);
      expect(again.hikers.map((h) => [h.name, h.site.name])).toEqual(register.hikers.map((h) => [h.name, h.site.name]));
      expect(new Set(register.hikers.map((h) => h.site.name)).size).toBe(register.hikers.length);
    }
  });
});
