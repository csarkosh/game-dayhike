import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { elevationAt } from "../terrain.js";
import { treesInRect, VEGETATION_TUNABLES, COHORT_LOG, LOG_HALF_LENGTH, LOG_SCALE_MAX, SPECIES_ALDER, logAxis } from "../vegetation.js";

export const TRUNK_HALF = 0.35;
export const TRUNK_COLLIDER_HEIGHT = 3;
/** An alder's trunk is a pole beside a conifer's: its box's half-width a unit of its scale (m). */
export const ALDER_TRUNK_HALF = 0.09;
/**
 * A fallen log's trunk, a unit of its scale (m): its radius (the model's
 * trunk is about 0.6 m across at scale 1, under the root flare's 1.05 m), how
 * far along its axis each box of the chain reaches either way of its station
 * (a square on the ground, so a log lying across the grid is a row of
 * squares, bulging at most a corner past the trunk), and how much of the
 * trunk's diameter stands over the ground once the log has settled into it
 * (the renderer sinks it a fifth, `logSeat.ts`). Every log is a big one
 * (LOG_SCALE_MIN 2.2: a trunk 1.3 m across and more), over STEP_HEIGHT.
 */
export const LOG_RADIUS = 0.3;
export const LOG_BOX_HALF = 0.3;
export const LOG_STAND_SHARE = 0.8;

/** Pass 6. Ids 2-5 are retired with the old forest generator and never return;
 * this is the first of the new passes. One slim axis-aligned brush per trunk —
 * players slip between trees but not through them — and a chain of them
 * along every fallen log, so no one walks through a trunk lying across the
 * way. Understory never collides. */
registerPass({
  id: 6,
  name: "trees",
  get tunables() {
    return { ...VEGETATION_TUNABLES, TRUNK_HALF, TRUNK_COLLIDER_HEIGHT, ALDER_TRUNK_HALF, LOG_RADIUS, LOG_BOX_HALF, LOG_STAND_SHARE };
  },
  run(chunk, worldSeed) {
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    // A log reaches this far from its origin at most: the query for logs is
    // widened by it, so a log rooted in the chunk next door still lays the
    // part of its chain that crosses into this one (clamped, below).
    const logReach = (LOG_HALF_LENGTH + LOG_RADIUS) * LOG_SCALE_MAX;
    for (const t of treesInRect(worldSeed, minX - logReach, minZ - logReach, maxX + logReach, maxZ + logReach)) {
      if (t.cohort === COHORT_LOG) {
        logChain(chunk.props, worldSeed, t.x, t.z, t.hash, t.scale, minX, minZ, maxX, maxZ);
        continue;
      }
      // A standing trunk's box: only the trees rooted in this chunk, as the
      // logs' widened query would otherwise lay them twice.
      if (t.x < minX || t.x >= maxX || t.z < minZ || t.z >= maxZ) continue;
      const half = (t.species === SPECIES_ALDER ? ALDER_TRUNK_HALF : TRUNK_HALF) * t.scale;
      // Clamped to the chunk footprint: `near` only surfaces the props of
      // chunks in a query's range, so a box overhanging its owning chunk
      // would be invisible to queries that stop short of that chunk. Tree
      // cells (12 m) do not align with chunk borders (32 m), so trunks DO
      // land within `half` of a border. The clamp trades a sliver of
      // trunk collision (< half, only at borders) for a broadphase that
      // never misses; the tree itself sits strictly inside the chunk, so
      // the box never degenerates.
      chunk.props.push({
        material: "trunk",
        box: {
          min: { x: Math.max(minX, t.x - half), y: t.groundH, z: Math.max(minZ, t.z - half) },
          max: {
            x: Math.min(maxX, t.x + half),
            y: t.groundH + TRUNK_COLLIDER_HEIGHT,
            z: Math.min(maxZ, t.z + half),
          },
        },
      });
    }
  },
});

/**
 * The chain of boxes along a log lying at (x, z) along `logAxis(hash)`'s
 * direction at `scale`: a square box 2 · LOG_BOX_HALF · scale across at every
 * LOG_BOX_HALF · scale along the trunk, each from the ground under its station (the log follows the ground
 * along its length, as the renderer seats it) to LOG_STAND_SHARE of the
 * trunk's diameter above it, clamped to the chunk's footprint and dropped
 * where less than half of it is left inside. Pushed in station order from
 * the flare's end, so a chunk's props are the same on every regeneration.
 */
function logChain(
  props: { material: string; box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } }[],
  worldSeed: number,
  x: number,
  z: number,
  hash: number,
  scale: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): void {
  const axis = logAxis(hash);
  const half = LOG_HALF_LENGTH * scale;
  const boxHalf = LOG_BOX_HALF * scale;
  const stand = 2 * LOG_RADIUS * scale * LOG_STAND_SHARE;
  // Stations a box's half apart, so the squares overlap by half and a log
  // lying diagonally across the grid is covered without gaps at the corners;
  // rounded, not ceiled, so no station lands on another (2.1 / 0.3 is 7 to a
  // rounding error).
  const count = Math.round(half / boxHalf);
  for (let i = -count; i <= count; i++) {
    const along = i * boxHalf;
    const sx = x + axis.x * along;
    const sz = z + axis.z * along;
    const lo = { x: Math.max(minX, sx - boxHalf), z: Math.max(minZ, sz - boxHalf) };
    const hi = { x: Math.min(maxX, sx + boxHalf), z: Math.min(maxZ, sz + boxHalf) };
    // A box the chunk's border leaves less than half of is the next chunk's
    // (its own query reaches this log too): no slivers, no box twice.
    if (hi.x - lo.x < boxHalf || hi.z - lo.z < boxHalf) continue;
    const ground = elevationAt(worldSeed, sx, sz);
    props.push({ material: "trunk", box: { min: { x: lo.x, y: ground, z: lo.z }, max: { x: hi.x, y: ground + stand, z: hi.z } } });
  }
}
