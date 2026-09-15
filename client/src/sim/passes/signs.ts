import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import { SIGN_POST_HALF, SIGN_POST_OFFSET, signPosts } from "../signs.js";

/** Pass 9. The sign posts' collision boxes, one per junction, emitted into the
 * chunk holding the post's centre, like the trailhead pass. The arms and
 * their names are render-only (`game/signMeshes.ts`), so the pass needs the
 * graph and nothing about the book. */
registerPass({
  id: 9,
  name: "signs",
  get tunables() {
    return { SIGN_POST_OFFSET, SIGN_POST_HALF_X: SIGN_POST_HALF.x, SIGN_POST_HALF_Y: SIGN_POST_HALF.y };
  },
  run(chunk, worldSeed) {
    const graph = activeTerrainVariant().trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE, minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
    for (const p of signPosts(graph, [])) {
      if (p.x < minX || p.x >= maxX || p.z < minZ || p.z >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, p.x, p.z).h;
      chunk.props.push({
        material: "signpost",
        box: {
          min: { x: p.x - SIGN_POST_HALF.x, y: ground, z: p.z - SIGN_POST_HALF.z },
          max: { x: p.x + SIGN_POST_HALF.x, y: ground + 2 * SIGN_POST_HALF.y, z: p.z + SIGN_POST_HALF.z },
        },
      });
    }
  },
});
