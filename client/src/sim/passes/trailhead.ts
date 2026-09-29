import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import type { Vec3 } from "../types.js";
import {
  BOARD_ALONG, BOARD_ALONG_MIN, BOARD_ALONG_STEP, BOARD_BED_CLEAR, BOARD_BOX_HALF, BOARD_BOX_STEP, BOARD_BOXES, BOARD_OFFSET, BOARD_ROAD_CLEAR,
  CAR_BED_CLEAR, CAR_HALF, CAR_MATERIAL, CAR_ROAD_U, CAR_ROAD_Z, CAR_SLIDE_MAX, CAR_SLIDE_STEP,
  KIOSK_MATERIAL, SPAWN_GAP, boardBoxes, trailheadPlaces,
} from "../trailhead.js";

/** Pass 8. Emits the car's box and the board's five, each into the chunk
 * that contains its own centre, so a box is emitted exactly once even when
 * it straddles a chunk edge — the collision broadphase surfaces every chunk
 * a query overlaps. Where they stand is `sim/trailhead.ts`'s to say. */
registerPass({
  id: 8,
  name: "trailhead",
  get tunables() {
    return {
      CAR_HALF_X: CAR_HALF.x, CAR_HALF_Y: CAR_HALF.y, CAR_HALF_Z: CAR_HALF.z,
      CAR_ROAD_U, CAR_ROAD_Z, CAR_BED_CLEAR, CAR_SLIDE_STEP, CAR_SLIDE_MAX, SPAWN_GAP,
      BOARD_ALONG, BOARD_ALONG_MIN, BOARD_ALONG_STEP, BOARD_OFFSET, BOARD_BED_CLEAR, BOARD_ROAD_CLEAR,
      BOARD_BOX_HALF_X: BOARD_BOX_HALF.x, BOARD_BOX_HALF_Y: BOARD_BOX_HALF.y, BOARD_BOX_HALF_Z: BOARD_BOX_HALF.z,
      BOARD_BOX_STEP, BOARD_BOXES,
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
    const places = trailheadPlaces(graph, roadCenterX, worldSeed);
    const boxes: { material: string; half: Vec3; x: number; z: number }[] = [
      { material: CAR_MATERIAL, half: CAR_HALF, x: places.car.x, z: places.car.z },
      ...boardBoxes(places.board).map((b) => ({ material: KIOSK_MATERIAL, half: BOARD_BOX_HALF, x: b.x, z: b.z })),
    ];
    for (const b of boxes) {
      if (b.x < minX || b.x >= maxX || b.z < minZ || b.z >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, b.x, b.z).h;
      chunk.props.push({
        material: b.material,
        box: {
          min: { x: b.x - b.half.x, y: ground, z: b.z - b.half.z },
          max: { x: b.x + b.half.x, y: ground + 2 * b.half.y, z: b.z + b.half.z },
        },
      });
    }
  },
});
