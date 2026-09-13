import { seedFromToken } from "../../src/game/seed.js";

/**
 * The 227-seed sweep set shared by every test that has to hold on the REAL,
 * realistic seed population rather than a handful of probes — pulled out of
 * `trailBed.test.ts` so `trailhead.test.ts`'s departure-frame
 * check can hold every seed the bed scan does, without shortening it or
 * drifting from it. Not itself a `*.test.ts` file, so vitest never collects
 * it as a suite of its own.
 */

/** The five seeds the graph and landmark tests probe. */
export const PROBE_SEEDS = [0x5eed, 1, 12345, 777, 4242];
/**
 * The sequential seeds measured to carry a broken bed — or an unbuildable
 * world. The second row joined on 2026-09-09:
 * 29 (3.13), 305 (2.76), 81 (1.10), 221 (1.08) and 483 (1.04)
 * carried a bed over MAX_WALKABLE_GRADIENT under the profile-only fine check —
 * three of them with `fallbacks` reading 0, which is why the composed check had
 * to replace it; 79, 108 and 282 could not be built at all before the spacing
 * tiers and the pad's doorway. The gate set must contain the seeds that found
 * the defects, or the next round measures the same 219 that never saw them.
 */
export const REVIEW_SEEDS = [
  13, 18, 28, 90, 119, 173, 195, 231, 243, 308, 331, 349, 443, 460,
  29, 79, 81, 108, 221, 282, 305, 483,
];
/** 200 lobby-shaped tokens, hashed the way `app.ts` hashes a room id. */
export const LOBBY_SEEDS = Array.from({ length: 200 }, (_, i) => seedFromToken(`room-${i}`));
export const SEEDS = [...PROBE_SEEDS, ...REVIEW_SEEDS, ...LOBBY_SEEDS];
