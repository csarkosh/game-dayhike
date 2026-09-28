import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import { SIGN_POST_HALF, SIGN_POST_OFFSET, signPostSites, trailSignSite } from "../signs.js";
import { KIOSK_MATERIAL, trailheadSite } from "../trailhead.js";

/** Pass 9. The sign posts' collision boxes, one per junction and one at the
 * trail's entrance, each emitted into the chunk holding the post's centre,
 * like the trailhead pass. The arms and their names are render-only
 * (`game/signMeshes.ts`), so the pass needs the graph and nothing else. */
registerPass({
  id: 9,
  name: "signs",
  get tunables() {
    return { SIGN_POST_OFFSET, SIGN_POST_HALF_X: SIGN_POST_HALF.x, SIGN_POST_HALF_Y: SIGN_POST_HALF.y, TRAIL_SIGNS: 1 };
  },
  run(chunk, worldSeed) {
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE, minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
    const sites: { x: number; z: number }[] = [...signPostSites(graph)];
    const roadCenterX = variant.roadCenterX;
    if (roadCenterX !== undefined) {
      sites.push(trailSignSite(graph, trailheadSite(graph, roadCenterX, worldSeed, KIOSK_MATERIAL)));
    }
    for (const p of sites) {
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
