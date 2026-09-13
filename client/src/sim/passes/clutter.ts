import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { clutterInRect, CLUTTER_BOULDER, CLUTTER_TUNABLES } from "../clutter.js";

/** Boulder collider shape at scale 1, PER VARIANT: half-extent (m), height
 * (m), and the fraction of that height buried for visual seating. The
 * collider spans ground to the boulder's visible top: h · (1 − SINK).
 *
 * The two boulder variants are no longer close enough in
 * proportion to share one worst-case box (that was the pre-existing bug —
 * sharing capped the whole class at the SQUAT variant's height, so nothing
 * ever read as cover). Each variant now gets its own half-extent and height,
 * derived from ITS OWN mesh only, and the pass picks the pair by `b.variant`.
 *
 * Measured via NodeIO getBounds() against the shipped models
 * (client/assets/models/clutter.boulder_{a,b}.glb):
 *   clutter.boulder_a (variant 0): [x, y, z] = [1.268, 1.003, 1.829] m
 *   clutter.boulder_b (variant 1): [x, y, z] = [2.516, 1.890, 2.480] m
 * (3 dp, from the unrounded getBounds() min/max — boulder_b is the model
 * that replaced an earlier flat-slab collider; it is now the
 * tall, blocky variant instead of the squat one.)
 *
 * For each variant: BASE_HALF = half of THAT mesh's SMALLER horizontal
 * extent min(x, z) (so its own box never claims ground outside its own
 * silhouette), floored to 3 dp against the unrounded measurement so the
 * "inside its own mesh" bound holds past display rounding. BASE_H = that
 * mesh's own height (y), floored to 3 dp for the same reason.
 *
 * boulder_a: min(x, z) = min(1.268, 1.829) = 1.268 (x binds); half =
 * 0.6339464… → floored 0.633. Height y = 1.0029029… → floored 1.002.
 *
 * boulder_b: min(x, z) = min(2.516, 2.480) = 2.480 (z binds); half =
 * 1.2398356… → floored 1.239. Height y = 1.890428… → floored 1.89.
 *
 * BOULDER_SINK: unchanged at 0.25, shared across both variants — it depends
 * only on BASE_H and itself (see the embedding-depth argument in
 * clutterMeshes.ts `writeInstanceMatrix`), never on a mesh's small negative
 * minY, so there is no per-variant reason to split it. */
export const BOULDER_A_BASE_HALF = 0.633;
export const BOULDER_A_BASE_H = 1.002;
export const BOULDER_B_BASE_HALF = 1.239;
export const BOULDER_B_BASE_H = 1.89;
export const BOULDER_SINK = 0.25;

/** Pass 7. Boulders are the only clutter that collides: one axis-aligned
 * brush per boulder, the trees-pass idiom. Everything
 * else — rocks, grass, driftwood, fungus — is set dressing you walk through.
 * `world.boxes` is the chunk grid, so movement and AI sight both see
 * these brushes.
 *
 * With per-variant extents the two boulder variants now behave differently,
 * across the shared scale range CLUTTER_BOULDER_SCALE_MIN–MAX (0.60–1.39,
 * sim/clutter.ts):
 *
 * variant 0 (boulder_a, BASE_H = 1.002): box height spans
 * 1.002 · scale · 0.75, i.e. 0.451–1.045 m. Below STEP_HEIGHT (0.5 m) at the
 * bottom of the range (steppable), and never reaches a standing eye line
 * (PLAYER_HALF.y + PLAYER_EYE_OFFSET = 0.9 + 0.7 = 1.6 m) even at the top —
 * this variant stays a low brush at every scale, same as before.
 *
 * variant 1 (boulder_b, BASE_H = 1.89): box height spans 1.89 · scale · 0.75,
 * i.e. 0.850–1.971 m. ALWAYS clears STEP_HEIGHT (never steppable, unlike
 * variant 0's low end), and clears the 1.6 m standing eye line once scale
 * exceeds 1.6 / (1.89 · 0.75) ≈ 1.128 — roughly the top quarter of the scale
 * range. So a large variant-1 boulder is now real cover: it blocks AI
 * line-of-sight for a standing actor, which is what large boulders need to
 * do to work as cover. Small variant-1 boulders and every
 * variant-0 boulder still read as low rubble a standing actor can see
 * over — intentional: not every boulder should be full cover. */
registerPass({
  id: 7,
  name: "clutter",
  get tunables() {
    return {
      ...CLUTTER_TUNABLES,
      BOULDER_A_BASE_HALF,
      BOULDER_A_BASE_H,
      BOULDER_B_BASE_HALF,
      BOULDER_B_BASE_H,
      BOULDER_SINK,
    };
  },
  run(chunk, worldSeed) {
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    for (const b of clutterInRect(worldSeed, CLUTTER_BOULDER, minX, minZ, maxX, maxZ)) {
      const baseHalf = b.variant === 1 ? BOULDER_B_BASE_HALF : BOULDER_A_BASE_HALF;
      const baseH = b.variant === 1 ? BOULDER_B_BASE_H : BOULDER_A_BASE_H;
      const half = baseHalf * b.scale;
      // Clamped to the chunk footprint for the same reason trees.ts clamps:
      // the broadphase surfaces only the chunks a query overlaps, so an
      // overhanging box would be invisible to queries stopping short of its
      // owner. Boulder cells (48 m) never align with chunk borders (32 m).
      chunk.props.push({
        material: "rock",
        box: {
          min: { x: Math.max(minX, b.x - half), y: b.groundH, z: Math.max(minZ, b.z - half) },
          max: {
            x: Math.min(maxX, b.x + half),
            y: b.groundH + baseH * b.scale * (1 - BOULDER_SINK),
            z: Math.min(maxZ, b.z + half),
          },
        },
      });
    }
  },
});
