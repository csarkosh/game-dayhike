import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { signPosts, SIGN_POST_HALF } from "../../src/sim/signs.js";
import { signSites } from "../../src/sim/placeNames.js";
import { hikerNames } from "../../src/sim/hikerNames.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { PROBE_SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

describe("sign posts on real worlds", { timeout: 120_000 }, () => {
  it("names the summit on some arm, names at most two places an arm, keeps every post off the bed, and emits each post once as a prop", () => {
    for (const seed of PROBE_SEEDS) {
      const { graph } = bowlFor(seed);
      const crest = graph.nodes[graph.summit]!;
      // The sites the game names: the summit and every pond and meadow.
      const first = hikerNames(seed, 1)[0]!.split(" ")[0]!;
      const posts = signPosts(graph, signSites(seed, graph.features, first, crest));
      const degree = new Map<number, number>();
      for (const e of graph.edges) { degree.set(e.a, (degree.get(e.a) ?? 0) + 1); degree.set(e.b, (degree.get(e.b) ?? 0) + 1); }
      const junctions = [...degree.values()].filter((d) => d >= 3).length;
      expect(posts, `seed ${seed}`).toHaveLength(junctions);
      if (junctions > 0) {
        const named = new Set(posts.flatMap((p) => p.arms.flatMap((a) => a.names)));
        for (const p of posts) for (const a of p.arms) expect(a.names.length, `seed ${seed}`).toBeLessThanOrEqual(2);
        expect(named.has("Summit"), `seed ${seed}`).toBe(true);
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
