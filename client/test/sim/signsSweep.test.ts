import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { activeTerrainVariant, elevationAt, setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { PROPS, propSite } from "../../src/sim/passes/trailhead.js";
import { buildRegister } from "../../src/sim/register.js";
import { signPosts, SIGN_POST_HALF } from "../../src/sim/signs.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { PROBE_SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

describe("sign posts on real worlds", { timeout: 120_000 }, () => {
  it("names every site on some arm, keeps every post off the bed, and emits each post once as a prop", () => {
    const v = activeTerrainVariant();
    for (const seed of PROBE_SEEDS) {
      const { graph, landmarks } = bowlFor(seed);
      const site = (i: number) => propSite(graph, v.roadCenterX!, seed, PROPS[i]!);
      const register = buildRegister({ seed, graph, landmarks, groundH: (x, z) => elevationAt(seed, x, z), box: site(0), car: site(2) });
      const posts = signPosts(graph, register.hikers.map((h) => h.site));
      const degree = new Map<number, number>();
      for (const e of graph.edges) { degree.set(e.a, (degree.get(e.a) ?? 0) + 1); degree.set(e.b, (degree.get(e.b) ?? 0) + 1); }
      const junctions = [...degree.values()].filter((d) => d >= 3).length;
      expect(posts, `seed ${seed}`).toHaveLength(junctions);
      if (junctions > 0) {
        const named = new Set(posts.flatMap((p) => p.arms.flatMap((a) => a.names)));
        for (const h of register.hikers) expect(named.has(h.site.name), `seed ${seed} ${h.site.name}`).toBe(true);
      }
      const grid = createChunkGrid(seed);
      for (const p of posts) {
        expect(trailDistance(graph, p.x, p.z), `seed ${seed}`).toBeGreaterThanOrEqual(TRAIL_BED_HALF);
        const chunk = grid.chunkAt(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));
        const emitted = chunk.props.filter((b) => b.material === "signpost" && Math.abs(b.box.min.x + SIGN_POST_HALF.x - p.x) < 1e-6);
        expect(emitted, `seed ${seed} post at ${p.x},${p.z}`).toHaveLength(1);
      }
    }
  });
});
