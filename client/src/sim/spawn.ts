import type { Vec3 } from "./types.js";
import type { BoxSource } from "@csarkosh/engine/sim/boxSource";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import { activeTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { carSite, trailheadSpawn, type Start } from "./trailhead.js";
import { groundSpawn } from "./spawnGround.js";

export { trailheadSpawn, type Start } from "./trailhead.js";
// A hull's place on the ground is no game's: Day Hike's rules name it from here, as they did.
export { SPAWN_FREEBOARD, SPAWN_LAKE_MARGIN, groundSpawn, ringSample, spiralSpawn } from "./spawnGround.js";

/**
 * The start on the active terrain's world for a seed, or null where the
 * world has no trail or no road. A pure function of the seed, so the sim
 * that places a player and the game that aims their view agree on every
 * peer with nothing exchanged.
 */
export function trailheadStart(seed: number): Start | null {
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  const roadCenterX = variant.roadCenterX;
  if (graph === undefined || roadCenterX === undefined) return null;
  return trailheadSpawn(graph, carSite(graph, roadCenterX, seed));
}

/**
 * The chunk cells a world's first spawn reads: the cells the box a hull of
 * `half` is tested against covers at `trailheadStart(seed)`, one to four of
 * them, where the spiral's first place is tried. None where the terrain has
 * no trailhead. A head start for whoever generates chunks ahead, never a
 * promise: a spawn that goes on to another place reads whatever cells it needs.
 */
export function spawnChunkCells(seed: number, half: Vec3): { cx: number; cz: number }[] {
  const start = trailheadStart(seed);
  if (start === null) return [];
  const cells = new Map<string, { cx: number; cz: number }>();
  // The spiral's own first test, against a source that only notes what it is asked for.
  const noting: BoxSource = {
    near(min, max) {
      for (let cx = Math.floor(min.x / CHUNK_SIZE); cx <= Math.floor(max.x / CHUNK_SIZE); cx++) {
        for (let cz = Math.floor(min.z / CHUNK_SIZE); cz <= Math.floor(max.z / CHUNK_SIZE); cz++) cells.set(`${cx},${cz}`, { cx, cz });
      }
      return [];
    },
  };
  groundSpawn(noting, seed, start.x, start.z, half);
  return [...cells.values()];
}
