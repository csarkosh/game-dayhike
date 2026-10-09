/**
 * The swash on the cove's pebble face: how far a bore's sheet runs up, how
 * its front climbs and falls back, and how thick it is behind the front.
 * Babylon-free (on BABYLON_FREE_FILES); the swash table evaluates it for
 * every metre of the cove's shore each frame.
 *
 * Distances are along the face from the still waterline (d = 0), positive up
 * the beach. The vertical run-up is Hunt's rule, the Iribarren number times
 * the bore's height; along the face it is that over the face's grade. The
 * front leaves the waterline at the bore's speed √(g·h) and slows evenly to
 * its reach, so it takes tUp = 2·reach/√(g·h) to get there; it then falls
 * back from rest, gathering speed, over SWASH_DOWN_RATIO times as long. The
 * sheet is a wedge, thickest at the waterline and nothing at the front, and
 * thins as it falls back because the pebbles take it.
 */

export const SWASH_G = 9.81;
/** The retreat takes this many times as long as the climb. */
export const SWASH_DOWN_RATIO = 2.0;
/** The sheet's thickness at the waterline as a share of the bore's height. */
export const SWASH_THICK_K = 0.3;
/** The share of the sheet the pebbles have taken by the end of the retreat. */
export const SWASH_SINK = 0.6;
/** The farthest a front runs along the face (m); the sea's rings reach this far past the waterline. */
export const SWASH_REACH_MAX_M = 12;

/** Hunt's rule: the vertical run-up (m) is the Iribarren number times the bore's height. */
export function runUpVertical(boreHeight: number, iribarren: number): number {
  const rise = iribarren * boreHeight;
  return Number.isFinite(rise) ? rise : 0;
}

/** The run-up along the face (m): the vertical run-up over the face's grade. */
export function runUpAlongFace(boreHeight: number, iribarren: number, faceGrade: number): number {
  if (!(Number.isFinite(faceGrade) && faceGrade > 0)) return 0;
  const along = runUpVertical(boreHeight, iribarren) / faceGrade;
  return Number.isFinite(along) ? along : 0;
}

/** The climb's time (s): the front's mean speed is half the bore's √(g·h). */
export function tUpOf(reach: number, boreHeight: number): number {
  if (!(Number.isFinite(reach) && Number.isFinite(boreHeight) && boreHeight > 0)) return 0;
  const tUp = (2 * reach) / Math.sqrt(SWASH_G * boreHeight);
  return Number.isFinite(tUp) ? tUp : 0;
}

/**
 * The front's distance up the face (m, from the waterline) `t` seconds after
 * the sheet set off: reach·u·(2 − u) over the climb (u = t/tUp), then
 * reach·(1 − u²) over the retreat (u = (t − tUp)/tDown, tDown =
 * SWASH_DOWN_RATIO·tUp); 0 before and after, and 0 for a sheet with no reach
 * or no height.
 */
export function frontAt(t: number, reach: number, boreHeight: number): number {
  if (!(Number.isFinite(reach) && reach > 0) || !(Number.isFinite(boreHeight) && boreHeight > 0)) return 0;
  const tUp = tUpOf(reach, boreHeight);
  if (!(tUp > 0)) return 0;
  const tDown = SWASH_DOWN_RATIO * tUp;
  if (!(t >= 0) || t > tUp + tDown) return 0;
  if (t <= tUp) {
    const u = t / tUp;
    return reach * u * (2 - u);
  }
  const u = (t - tUp) / tDown;
  return reach * (1 - u * u);
}

/**
 * The sheet's thickness (m) at `s` metres up the face when its front is at
 * `front`: SWASH_THICK_K·boreHeight·(1 − s/front) between the waterline and
 * the front, 0 outside, thinned by (1 − SWASH_SINK·retreating), `retreating`
 * the share of the retreat run (0 while climbing, 1 at its end). Any value
 * that is not a finite number gives 0, never NaN.
 */
export function thicknessAt(s: number, front: number, boreHeight: number, retreating: number): number {
  if (!(Number.isFinite(front) && front > 0) || !(Number.isFinite(boreHeight) && boreHeight > 0)) return 0;
  if (!(s >= 0) || s >= front || Number.isNaN(retreating)) return 0;
  const sink = 1 - SWASH_SINK * (retreating > 0 ? Math.min(retreating, 1) : 0);
  return SWASH_THICK_K * boreHeight * (1 - s / front) * sink;
}

/** Two sheets over one place: the greater front and the greater thickness, into `out`. */
export function overlap(
  aFront: number, aThick: number, bFront: number, bThick: number, out: { front: number; thick: number },
): void {
  out.front = Math.max(aFront, bFront);
  out.thick = Math.max(aThick, bThick);
}
