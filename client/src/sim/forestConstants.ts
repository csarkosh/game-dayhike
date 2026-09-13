/**
 * Generation constants. Separate from `constants.ts` so gameplay tuning and
 * world tuning do not sit in one undifferentiated list.
 *
 * The montane pipeline's own constants live in `montane.ts` as variant
 * tunables — this file holds only the storage/streaming frame around it. The
 * old walkability machinery (MAX_GRADIENT, the plateau system, the feature
 * lattices) is gone with the forest generator: the gradient cap was the
 * mathematical reason the old terrain could not exceed ~11 m of relief per
 * 100 m, and this step deliberately dropped it. Playability on
 * steep ground is explicitly deferred — freecam is the intended viewer.
 */

export const CHUNK_SIZE = 32;
export const TERRAIN_CELL = 1;
export const HEIGHT_QUANTUM = 1 / 16;

/** Floor of every ground column. Deep enough that nothing gets underneath. */
export const GROUND_BASE = -16;

/**
 * Distance at which fog has all but hidden the world, in metres. Kilometre
 * scale: mountains only exist as mountains at distance, and aerial
 * perspective is the primary depth cue that makes far peaks read as far.
 * fogDensityFor solves for 5% transmittance here. The old 70 m
 * — right for a forest you could never see out of — also forced heavy haze
 * through the 20–50 m band where all content sat; that deferral closes now.
 */
export const FOG_DISTANCE = 4000;
