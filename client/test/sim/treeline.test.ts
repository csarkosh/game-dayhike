import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { segmentDistance } from "../../src/sim/trail.js";
import { treesInRect } from "../../src/sim/vegetation.js";
import { CLUTTER_BOULDER, CLUTTER_BUSH, CLUTTER_FUNGUS, CLUTTER_ROCK, clutterInRect } from "../../src/sim/clutter.js";
import { shoreHeight } from "../../src/sim/shoreStrip.js";
import { SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the trail from the treeline, over the 227-seed sweep", () => {
  it("leaves the pad inland, on no sand, into a wood, through a clearing", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const v = activeTerrainVariant();
    const most = { turn: 0, lateral: 0, alongOnSand: 0, fallbacks: 0, tall: 0, treesByTrail: 0 };
    const least = { shore: Infinity, bedShore: Infinity, trees: Infinity };
    for (const seed of SEEDS) {
      const g = v.trailGraph!(seed);
      const pad = g.trailhead;
      const road = (z: number): number => v.roadCenterX!(seed, z);
      most.fallbacks = Math.max(most.fallbacks, g.fallbacks);

      // The stem, from the pad to where it is off the shore: past 30 m from the road on ground 9 m up.
      const chain = stemNodes(g);
      let alongOnSand = 0, lateral = NaN, off = false;
      for (let k = 0; k + 1 < chain.length && !off; k++) {
        const a = g.nodes[chain[k]!]!, b = g.nodes[chain[k + 1]!]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const h = elevationAt(seed, x, z), u = x - road(z);
          if (Number.isNaN(lateral) && u >= 30) lateral = Math.abs(z - pad.z);
          if (h >= 9 && u >= 30) { off = true; break; }
          least.bedShore = Math.min(least.bedShore, shoreHeight(seed, x, z, h));
          if (h < 4) alongOnSand += (Math.abs(b.z - a.z) / len) * (len / n);
        }
      }
      most.lateral = Math.max(most.lateral, lateral);
      most.alongOnSand = Math.max(most.alongOnSand, alongOnSand);
      const a0 = g.nodes[chain[0]!]!, b0 = g.nodes[chain[1]!]!;
      most.turn = Math.max(most.turn, (Math.atan2(Math.abs(b0.z - a0.z), b0.x - a0.x) * 180) / Math.PI);

      // Every edge of every kind, each metre: the height the shore's rules read under it.
      for (const e of g.edges) {
        const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
        for (let i = 0; i <= n; i++) {
          const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
          least.shore = Math.min(least.shore, shoreHeight(seed, x, z, elevationAt(seed, x, z)));
        }
      }

      // The wood and the clearing about the pad.
      let trees = 0;
      for (const t of treesInRect(seed, pad.x - 40, pad.z - 40, pad.x + 40, pad.z + 40)) {
        if (Math.hypot(t.x - pad.x, t.z - pad.z) > 40) continue;
        trees++;
        for (const e of g.edges) {
          const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
          if (segmentDistance(a.x, a.z, b.x, b.z, t.x, t.z) < 8) most.treesByTrail++;
        }
      }
      least.trees = Math.min(least.trees, trees);
      for (const cls of [CLUTTER_ROCK, CLUTTER_BOULDER, CLUTTER_FUNGUS, CLUTTER_BUSH]) {
        for (const c of clutterInRect(seed, cls, pad.x - 24, pad.z - 24, pad.x + 24, pad.z + 24)) {
          if (Math.hypot(c.x - pad.x, c.z - pad.z) < 24) most.tall++;
        }
      }
    }
    console.info(`[treeline] first edge ${most.turn.toFixed(2)} deg from inland at most, the stem ${most.lateral.toFixed(2)} m from the pad's line 30 m from the road, ${most.alongOnSand.toFixed(2)} m along the road on ground under 4 m; the shore's rules read ${least.shore.toFixed(2)} m at the least under any edge and ${least.bedShore.toFixed(2)} m under the stem's first stretch; ${least.trees} trees within 40 m of the pad at the least`);
    expect(most.fallbacks).toBe(0);
    expect(most.turn).toBeLessThanOrEqual(21);
    expect(most.lateral).toBeLessThanOrEqual(7);
    expect(most.alongOnSand).toBeLessThanOrEqual(3.5);
    expect(least.shore).toBeGreaterThanOrEqual(8.8);
    expect(least.bedShore).toBeGreaterThanOrEqual(9);
    expect(least.trees).toBeGreaterThanOrEqual(4);
    expect(most.treesByTrail).toBe(0);
    expect(most.tall).toBe(0);
  }, timeLimit(300_000));
});
