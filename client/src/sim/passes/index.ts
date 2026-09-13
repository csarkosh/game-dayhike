/**
 * Importing this file registers the terrain variants and every pass. Passes
 * register themselves into `chunk.ts`, so they cannot be imported from it
 * without a cycle — this module is the seam.
 *
 * Pass ids are never reused: ramps (2), trees (3), boulders (4) and logs (5)
 * are retired with the forest generator, and their ids retire with them. When
 * trees return they take id 6 or higher — reusing an id would shift the RNG
 * streams of every pass registered after it. Elevation (1), trees (6), clutter
 * (7) are registered. Pass 8, trailhead, emits the placeholder props on the flat.
 */
import "../montane.js";
import "../olympic.js";
import "./elevation.js";
import "./trees.js";
import "./clutter.js";
import "./trailhead.js";
