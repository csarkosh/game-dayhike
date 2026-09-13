import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { treesInRect, VEGETATION_TUNABLES, COHORT_LOG } from "../vegetation.js";

export const TRUNK_HALF = 0.35;
export const TRUNK_COLLIDER_HEIGHT = 3;

/** Pass 6. Ids 2-5 are retired with the old forest generator and never return;
 * this is the first of the new passes. One slim axis-aligned brush per trunk —
 * players slip between trees but not through them. Understory never collides. */
registerPass({
  id: 6,
  name: "trees",
  get tunables() {
    return { ...VEGETATION_TUNABLES, TRUNK_HALF, TRUNK_COLLIDER_HEIGHT };
  },
  run(chunk, worldSeed) {
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    for (const t of treesInRect(worldSeed, minX, minZ, maxX, maxZ)) {
      // A nurse log lies along the ground; an upright box around it would be an
      // invisible 7 m wall. Set dressing you can walk through beats a wall you
      // cannot see — the same call `understory` makes. Snags DO collide: they
      // are standing trunks.
      if (t.cohort === COHORT_LOG) continue;
      const half = TRUNK_HALF * t.scale;
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
