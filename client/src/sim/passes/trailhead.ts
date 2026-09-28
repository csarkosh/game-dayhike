import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import {
  CAR_BED_CLEAR, CAR_HALF, CAR_ROAD_U, CAR_ROAD_Z, CAR_SLIDE_MAX, CAR_SLIDE_STEP, KIOSK_HALF, PROPS,
  SIGN_ROAD_U, SIGN_ROAD_Z, SPAWN_GAP, trailheadSite,
} from "../trailhead.js";

/** Pass 8. Emits each prop into the chunk that contains its centre, so a
 * prop is emitted exactly once even when its box straddles a chunk edge —
 * the collision broadphase surfaces every chunk a query overlaps. Where the
 * props stand is `sim/trailhead.ts`'s to say. */
registerPass({
  id: 8,
  name: "trailhead",
  get tunables() {
    return {
      CAR_HALF_X: CAR_HALF.x, CAR_HALF_Y: CAR_HALF.y, CAR_HALF_Z: CAR_HALF.z,
      KIOSK_HALF_X: KIOSK_HALF.x, KIOSK_HALF_Y: KIOSK_HALF.y, KIOSK_HALF_Z: KIOSK_HALF.z,
      CAR_ROAD_U, CAR_ROAD_Z, SIGN_ROAD_U, SIGN_ROAD_Z,
      CAR_BED_CLEAR, CAR_SLIDE_STEP, CAR_SLIDE_MAX, SPAWN_GAP,
    };
  },
  run(chunk, worldSeed) {
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const roadCenterX = variant.roadCenterX;
    if (roadCenterX === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    for (const p of PROPS) {
      const { x: cx, z: cz } = trailheadSite(graph, roadCenterX, worldSeed, p.material);
      if (cx < minX || cx >= maxX || cz < minZ || cz >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, cx, cz).h;
      chunk.props.push({
        material: p.material,
        box: {
          min: { x: cx - p.half.x, y: ground, z: cz - p.half.z },
          max: { x: cx + p.half.x, y: ground + 2 * p.half.y, z: cz + p.half.z },
        },
      });
    }
  },
});
