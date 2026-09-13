/**
 * Pure forest band math: walks the tree field around the camera and
 * sorts every tree into the band its distance earns — three near LOD rings,
 * an understory disc, and an impostor band (GIANT, SAPLING and SNAG alike)
 * that is fully unthinned out to IMPOSTOR_FULL_RADIUS and stride-thinned
 * beyond it out to IMPOSTOR_RADIUS — then clamps the near and impostor bands
 * to hard instance budgets, dropping the far tail first. Every ring/band
 * boundary is padded by SEAM_PAD: a tree within the pad of
 * an edge is duplicated into both bands so the dither plugin can cross-fade
 * it instead of popping. All comparisons are on squared distances: cheap,
 * exact, trig-free.
 *
 * Output is a pure function of the cell-snapped `bandsOrigin`, so the Babylon
 * shell rebuilds only when the camera crosses a tree-cell boundary.
 * Pure and Babylon-free, like `clipmap.ts` and `water.ts`. `collectBands` is
 * the pure one-shot; `createBandCollector` is the renderer's hot path — same
 * loop, with per-cell `treeInCell` results memoized across rebuilds so a
 * crossing re-samples only the disc's leading edge.
 */
import {
  treeInCell,
  TREE_CELL,
  COHORT_SAPLING,
  COHORT_SNAG,
  COHORT_LOG,
  type TreeInstance,
} from "../sim/vegetation.js";

/** Near band radius (m) — full-geometry trees; quality tiers may shrink it
 * via `collectBands`' `nearRadius` parameter (low runs 140 m).
 * Shrunk from 240 (a performance check) to 200, then to 120: the
 * full-geometry bands end at 120 m and
 * impostors take over from there — the LOD2 band beyond 120 m cost ~0.3M
 * triangles for trees indistinguishable-at-range anyway. */
export const NEAR_RADIUS = 120;
/** LOD 0 (full detail) out to here, LOD 1 to LOD_RING_1, LOD 2 to the near
 * radius. Rings tightened (was 60/120): LOD1 at 42 m
 * reads clean even in dense stands. */
export const LOD_RING_0 = 42;
export const LOD_RING_1 = 85;
/** Ferns and ground cover render only this close (m). Re-anchored:
 * was 50, then reduced to 65 in a performance
 * check — 2.6× the pre-retune understory instance count at the D = 0.01
 * measurement (π·65²·0.01 ≈ 133 vs old π·50²·0.006 ≈ 47); with D pulled back
 * to 0.008 the same 65 m radius now yields
 * π·65²·0.008 ≈ 106, still well above the old count. Stays 65 at this point —
 * only the tree bands and TREE_DENSITY_MAX moved. */
export const UNDERSTORY_RADIUS = 65;
/** Beyond the near band, billboard impostors out to here (m). */
export const IMPOSTOR_RADIUS = 2000;
/** The impostor band samples every 2nd cell in each axis — ×4 distance
 * thinning where individual trees can no longer be told apart. */
export const IMPOSTOR_CELL_STRIDE = 2;
/** Every cell is sampled inside this radius: a 41–70 m
 * giant is 32–54 px at 1 km, so the stride's three-in-four missing trees
 * would appear from nothing there. Beyond it the stride lattice continues. */
export const IMPOSTOR_FULL_RADIUS = 1000;
/** Off-lattice impostors inside IMPOSTOR_FULL_RADIUS: their own budget,
 * nearest-first like the others. The unthinned kilometre holds about as
 * many quads as the whole stride band. Derivation: off-lattice cells
 * inside 1014 m (IMPOSTOR_FULL_RADIUS + SEAM_PAD)
 * number ¾·π·1014²/100 ≈ 24,220 at the hard geometric ceiling (¾ because
 * the stride-2 lattice already claims one cell in four), the mean-density
 * estimate is ≈19,380, and the measured worst inland camera reaches only
 * 14,466 — the clamp cannot bind on any measured ground, and if it ever
 * did, the tail it would drop sits at ~1 km, inside SEAM_FILL's own
 * fade-out ramp. */
export const IMPOSTOR_FILL_BUDGET_MAX = 20000;
/** The most the cell snap can move a distance: bandsOrigin snaps to the
 * tree cell, the shader measures from the eye. */
export const SEAM_PAD = Math.SQRT2 * TREE_CELL;
/** LOD0 → LOD1 giant/sapling geometry seam: LOD0's full mesh fades out and
 * LOD1's mid mesh fades in across [36, LOD_RING_0). A 6 m span is enough —
 * this close, silhouette detail is still resolvable, so the swap only needs
 * to hide behind a couple of frames' worth of dither, not a wide band. */
export const SEAM_LOD0: readonly [number, number] = [36, LOD_RING_0];
/** LOD1 → LOD2 geometry seam, same fade direction as SEAM_LOD0, across
 * [76, LOD_RING_1). Wider than SEAM_LOD0 (9 m) because LOD1's mid mesh reads
 * coarser detail than LOD0's, so a mismatch is more visible mid-fade and
 * wants a longer cross-fade to hide it. */
export const SEAM_LOD1: readonly [number, number] = [76, LOD_RING_1];
/** `impostorsFill` (off-lattice, unthinned) → `impostors` (on-lattice,
 * stride-thinned) seam, across [900, IMPOSTOR_FULL_RADIUS). Fill's unthinned
 * quads fade out and the sparser stride lattice fades in. Needs its full
 * 100 m width: a 41–70 m giant is still
 * 32–54 px at 1 km under 17% haze — clearly resolvable — so thinning three
 * in four trees away over a short span would read as billboards visibly
 * popping out of existence, not fading. */
export const SEAM_FILL: readonly [number, number] = [900, IMPOSTOR_FULL_RADIUS];
/** The impostor billboard's fade-to-nothing seam at the edge of the world
 * the renderer draws, across [1800, IMPOSTOR_RADIUS) — nothing fades in
 * beyond it, only out. Can afford to be this wide (200 m) precisely because
 * so little is being hidden: the same
 * 41–70 m giant is only 16–27 px at 2 km under 47% haze, already close to
 * sub-pixel, so the fade only has to finish erasing an already-faint shape. */
export const SEAM_FAR: readonly [number, number] = [1800, IMPOSTOR_RADIUS];
/** The near/impostor seam ends at the (tier-scaled) near radius. */
export function seamNear(nearRadius: number): readonly [number, number] {
  return [nearRadius - 20, nearRadius];
}
/**
 * Near-band instance ceiling. Re-anchored again (was
 * 1300 at radius 200; 1850 before that at radius 240): with NEAR_RADIUS at
 * 120 m and TREE_DENSITY_MAX pulled back to 0.008/m², the mean-density cap
 * π·120²·0.008 ≈ 362 now binds ahead of the hard geometric ceiling
 * π·120²/100 ≈ 452 (one tree per TREE_CELL² = 100 m² cell) — D no longer
 * saturates the cell cap at this radius. 460 clears both.
 *
 * This bounds UNIQUE near picks only (the clamp runs on `nearPicks` before
 * `ringSplit` duplicates a tree across a padded seam) — it does NOT grow for
 * the seam padding. The seam duplicates ride on top: `near.flat().length`
 * can run ~50% over this measured (the three seam bands plus padding cover
 * that much of the near disc's area) — 625 flat / 419 unique (+49%) at the
 * worst-case scanned camera, 298 flat / 203 unique (+47%) at (2500, 2500)
 * (both measured 2026-09-03).
 */
export const NEAR_BUDGET_MAX = 460;
/**
 * Impostor instance ceiling. Re-anchored again (was 32000):
 * stride-2 sampling visits a quarter of the cells, so the hard ceiling is
 * π·2000²/100/2² ≈ 31.4k, but the mean-density cap π·2000²·0.008/2² ≈ 25.1k
 * now binds since TREE_DENSITY_MAX no longer saturates the cell cap. 26000
 * clears it.
 */
export const IMPOSTOR_BUDGET_MAX = 26000;

/** `bandForDistanceSq` result for the impostor annulus. */
export const BAND_IMPOSTOR = 3;
/** `bandForDistanceSq` result past the impostor radius: not rendered. */
export const BAND_BEYOND = 4;

export type ForestBands = {
  /** GIANT only. index = LOD 0..2, each sorted nearest-first, seam-padded:
   * a tree within SEAM_PAD of a ring edge appears in both rings so the
   * dither plugin can cross-fade it. */
  near: TreeInstance[][];
  /** COHORT_SAPLING only. index = LOD 0..2 on the same ring edges as `near`,
   * same seam padding. Near band only for full geometry — regeneration is
   * nearly sub-pixel past NEAR_RADIUS at full detail, but a sapling still
   * crosses into the impostor band via `impostors`/`impostorsFill` beyond
   * that. Ring-split because a flat LOD0-only bucket measured 1.7-2.5 ms/frame
   * of GPU cost at a deep-forest camera on production (2026-08-26): ~87% of
   * near-band saplings sit past LOD_RING_1, where LOD2's 380 triangles
   * replace LOD0's 2,171. */
  saplings: TreeInstance[][];
  /** COHORT_SNAG and COHORT_LOG, one bucket, inside the near radius (seam-
   * padded). LOG carries the near out-band only — a ~1 m log is sub-pixel
   * past the near radius and is never an impostor. SNAG cross-fades to its
   * own impostor beyond the near radius, in `impostors`/`impostorsFill`. */
  deadwood: TreeInstance[];
  understory: TreeInstance[];
  /** On-lattice cells, near radius → IMPOSTOR_RADIUS: GIANT, SAPLING and
   * SNAG. */
  impostors: TreeInstance[];
  /** Off-lattice cells inside IMPOSTOR_FULL_RADIUS — GIANT, SAPLING and
   * SNAG, like `impostors`. */
  impostorsFill: TreeInstance[];
};

/**
 * The band a squared camera distance earns: 0..2 = near LOD ring,
 * BAND_IMPOSTOR, or BAND_BEYOND. Every ring edge is half-open — a tree
 * exactly on an edge belongs to the farther band — and this is the ONLY
 * place that rule lives, so `collectBands` cannot disagree with the tests
 * that pin the edges exactly.
 */
export function bandForDistanceSq(d2: number, nearRadius: number = NEAR_RADIUS): number {
  if (d2 >= IMPOSTOR_RADIUS * IMPOSTOR_RADIUS) return BAND_BEYOND;
  if (d2 >= nearRadius * nearRadius) return BAND_IMPOSTOR;
  if (d2 < LOD_RING_0 * LOD_RING_0) return 0;
  if (d2 < LOD_RING_1 * LOD_RING_1) return 1;
  return 2;
}

/**
 * The cell-snapped anchor all band distances are measured from. Snapping to
 * the tree-cell lattice makes `collectBands` a pure function of the snapped
 * origin: callers compare this against the last build and rebuild only when
 * it moves.
 */
export function bandsOrigin(camX: number, camZ: number): { x: number; z: number } {
  return {
    x: Math.floor(camX / TREE_CELL) * TREE_CELL,
    z: Math.floor(camZ / TREE_CELL) * TREE_CELL,
  };
}

/** Squared distance from (ax, az) to the nearest point of cell (cx, cz) —
 * the conservative bound that decides whether a cell could hold a near-band
 * tree and whether it can be skipped entirely. */
function cellMinDistSq(ax: number, az: number, cx: number, cz: number): number {
  const dx = Math.max(cx * TREE_CELL - ax, 0, ax - (cx + 1) * TREE_CELL);
  const dz = Math.max(cz * TREE_CELL - az, 0, az - (cz + 1) * TREE_CELL);
  return dx * dx + dz * dz;
}

/**
 * Every tree the renderer should draw around the camera, banded by distance
 * from the snapped origin. Beyond the near radius, every cell out to
 * IMPOSTOR_FULL_RADIUS is sampled (the `impostorsFill` list, off-lattice) —
 * a giant impostor is still tens of pixels wide at 1 km, so stride-thinning
 * that close would pop trees in and out of nothing. Past IMPOSTOR_FULL_RADIUS
 * only every IMPOSTOR_CELL_STRIDE-th cell in each axis is sampled (the
 * on-lattice `impostors` list), out to IMPOSTOR_RADIUS. GIANT, SAPLING and
 * SNAG all take the same near/LOD/impostor routing; LOG is near-field only.
 * Every ring and band edge is padded by SEAM_PAD: a tree within the pad of
 * an edge is filed into both sides of it, so the dither plugin can cross-fade
 * a tree across the seam instead of popping it.
 *
 * The near and impostor bands are clamped to their budgets nearest-first:
 * trees are sorted by squared distance and the far tail is dropped. The
 * clamp runs before the seam padding duplicates picks across a ring edge, so
 * the padded output can hold more instances than the budget — see
 * `NEAR_BUDGET_MAX`.
 */
export function collectBands(
  seed: number,
  camX: number,
  camZ: number,
  nearRadius: number = NEAR_RADIUS,
): ForestBands {
  return collectBandsWith(camX, camZ, nearRadius, (cx, cz) => treeInCell(seed, cx, cz));
}

/**
 * The band walk itself, parameterised over the cell sampler so the memoizing
 * collector below and the pure `collectBands` share one loop — the collector
 * cannot drift from the pure function because they ARE the same function.
 */
function collectBandsWith(
  camX: number,
  camZ: number,
  nearRadius: number,
  sample: (cx: number, cz: number) => TreeInstance | null,
): ForestBands {
  const { x: ax, z: az } = bandsOrigin(camX, camZ);
  const impostorR2 = IMPOSTOR_RADIUS * IMPOSTOR_RADIUS;
  // The near/impostor seam scales with nearRadius (tier-dependent); every
  // other seam below is fixed. Each *PadR2 bound is squared once here so the
  // per-tree hot path in `visit` never re-derives it.
  const nearSeam = seamNear(nearRadius);
  const nearPadLo2 = (nearSeam[0] - SEAM_PAD) ** 2;
  const nearPadHi2 = (nearRadius + SEAM_PAD) ** 2;
  const fillPadR2 = (IMPOSTOR_FULL_RADIUS + SEAM_PAD) ** 2;
  const farPadR2 = (IMPOSTOR_RADIUS + SEAM_PAD) ** 2;
  // Understory membership was the one edge NOT
  // padded by SEAM_PAD, while its out-band [52, 65] (0.8·UNDERSTORY_RADIUS to
  // UNDERSTORY_RADIUS, 13 m wide) is narrower than SEAM_PAD itself
  // (√2 · TREE_CELL ≈ 14.14 m) — the most the snap origin can sit from the
  // real eye. Membership is decided from the SNAPPED origin but the shader's
  // dither reads the true eye distance, so an unpadded fern could still be
  // EXCLUDED from the list while its real distance already sits inside the
  // 13 m band: at up to SEAM_PAD short of the snap-origin cutoff, the real
  // eye can already be as close as 55 m — 86% dither visibility — with no
  // instance in the buffer at all. The moment the camera crosses into the
  // fern's cell it appears already 86% visible: a pop, not a fade-in from
  // zero. Padding this edge like every other one admits the fern up to
  // SEAM_PAD earlier, so by the time it could possibly be visible it has
  // been in the buffer — at dither visibility 0 — long enough to fade in.
  const understoryPadR2 = (UNDERSTORY_RADIUS + SEAM_PAD) ** 2;

  const c0x = Math.floor((ax - IMPOSTOR_RADIUS) / TREE_CELL);
  const c1x = Math.floor((ax + IMPOSTOR_RADIUS) / TREE_CELL);
  const c0z = Math.floor((az - IMPOSTOR_RADIUS) / TREE_CELL);
  const c1z = Math.floor((az + IMPOSTOR_RADIUS) / TREE_CELL);

  const nearPicks: { t: TreeInstance; d2: number }[] = [];
  const impostorPicks: { t: TreeInstance; d2: number }[] = [];
  const saplingPicks: { t: TreeInstance; d2: number }[] = [];
  const deadwoodPicks: { t: TreeInstance; d2: number }[] = [];
  const fillPicks: { t: TreeInstance; d2: number }[] = [];
  const understory: TreeInstance[] = [];

  /** Shared per-cell tail: sample, band, and file the tree. `stridePass` is
   * decided by which loop visited the cell — the two loops below partition
   * the candidate cells exactly as the flags of a full-square walk would. */
  const visit = (cx: number, cz: number, stridePass: boolean): void => {
    const t = sample(cx, cz);
    if (t === null) return;
    const dx = t.x - ax;
    const dz = t.z - az;
    const d2 = dx * dx + dz * dz;
    // Understory (ferns/shrubs) rides under every cohort, not just giants —
    // collected before the cohort routing below so no early-return can skip
    // it, exactly as it worked prior to the cohort split. Padded by SEAM_PAD
    // — see the comment at `understoryPadR2`.
    if (d2 < understoryPadR2) understory.push(t);
    if (t.cohort === COHORT_LOG) {
      // Logs are ~1 m high: near-field only, dithering out across the near
      // seam. Nothing draws them further out.
      if (d2 < nearPadHi2) deadwoodPicks.push({ t, d2 });
      return;
    }
    // Giants, saplings and snags all take the full band/LOD/impostor routing:
    // a sapling is 70 px at 120 m, so it still reads as a
    // shape in the impostor band — only logs are near-field-only.
    const band = bandForDistanceSq(d2, nearRadius);
    // Each cohort's near-band picks file into its own list; anything that
    // isn't a sapling or a snag here is a giant.
    let nearList: { t: TreeInstance; d2: number }[];
    if (t.cohort === COHORT_SAPLING) nearList = saplingPicks;
    else if (t.cohort === COHORT_SNAG) nearList = deadwoodPicks;
    else nearList = nearPicks;
    // Padded on both sides of the near/impostor seam: a tree just past
    // nearRadius still files into `nearList` (nearPadHi2), and one just
    // inside seamNear's inner edge already qualifies for the impostor lists
    // (nearPadLo2) — the dither plugin cross-fades whichever bucket ages out.
    if (band < BAND_IMPOSTOR || d2 < nearPadHi2) nearList.push({ t, d2 });
    if (band >= BAND_IMPOSTOR || d2 >= nearPadLo2) {
      // BAND_BEYOND trees just past IMPOSTOR_RADIUS are kept only within the
      // pad, so the far out-band (SEAM_FAR) has something to fade against.
      if (d2 >= farPadR2) return;
      if (stridePass) impostorPicks.push({ t, d2 });
      else if (d2 < fillPadR2) fillPicks.push({ t, d2 });
    }
  };

  // Stride lattice over the whole disc: every IMPOSTOR_CELL_STRIDE-th cell in
  // each axis. Walking only the lattice (instead of testing every cell of the
  // ~112k-cell bounding square for alignment) is what keeps a warm collect
  // cheap; `Math.ceil` finds the first aligned index at or after the corner.
  const s = IMPOSTOR_CELL_STRIDE;
  for (let cz = Math.ceil(c0z / s) * s; cz <= c1z; cz += s) {
    for (let cx = Math.ceil(c0x / s) * s; cx <= c1x; cx += s) {
      if (cellMinDistSq(ax, az, cx, cz) >= impostorR2) continue; // square corner, outside the disc
      visit(cx, cz, true);
    }
  }

  // Off-lattice cells: everything the stride lattice above skipped, out to
  // IMPOSTOR_FULL_RADIUS (+ pad) — near-band trees route through `nearList`
  // as before, and GIANT/SAPLING/SNAG trees beyond the near radius but
  // inside the fill reach route into `fillPicks` (`visit`'s `stridePass`
  // false branch), giving `impostorsFill` an unthinned kilometre. This walks
  // a ~31k-cell square instead of the near band's ~1.1k, but the memoizing
  // collector (`createBandCollector`) caches every `treeInCell` sample by
  // cell, so a warm one-cell camera move only re-samples the disc's leading
  // edge here too — the wider walk costs iteration, not fresh terrain
  // sampling.
  const fillReach = IMPOSTOR_FULL_RADIUS + SEAM_PAD;
  const n0x = Math.floor((ax - fillReach) / TREE_CELL);
  const n1x = Math.floor((ax + fillReach) / TREE_CELL);
  const n0z = Math.floor((az - fillReach) / TREE_CELL);
  const n1z = Math.floor((az + fillReach) / TREE_CELL);
  for (let cz = n0z; cz <= n1z; cz++) {
    for (let cx = n0x; cx <= n1x; cx++) {
      if (cx % s === 0 && cz % s === 0) continue; // the lattice already visited it
      if (cellMinDistSq(ax, az, cx, cz) >= fillPadR2) continue;
      visit(cx, cz, false);
    }
  }

  nearPicks.sort((a, b) => a.d2 - b.d2);
  impostorPicks.sort((a, b) => a.d2 - b.d2);
  saplingPicks.sort((a, b) => a.d2 - b.d2);
  deadwoodPicks.sort((a, b) => a.d2 - b.d2);
  fillPicks.sort((a, b) => a.d2 - b.d2);
  // Same nearest-first clamp as the other budgets: the far tail of the
  // unthinned kilometre drops first.
  if (fillPicks.length > IMPOSTOR_FILL_BUDGET_MAX) fillPicks.length = IMPOSTOR_FILL_BUDGET_MAX;
  if (nearPicks.length > NEAR_BUDGET_MAX) nearPicks.length = NEAR_BUDGET_MAX;
  if (impostorPicks.length > IMPOSTOR_BUDGET_MAX) impostorPicks.length = IMPOSTOR_BUDGET_MAX;
  if (saplingPicks.length > NEAR_BUDGET_MAX) saplingPicks.length = NEAR_BUDGET_MAX;
  if (deadwoodPicks.length > NEAR_BUDGET_MAX) deadwoodPicks.length = NEAR_BUDGET_MAX;

  /** Split sorted near-band picks into the three LOD rings — the one ring
   * rule (`bandForDistanceSq`) applied to giants and saplings alike — but
   * seam-aware: a pick within SEAM_LOD0/SEAM_LOD1 (each further widened by
   * SEAM_PAD) of a ring edge is duplicated into the neighbouring ring too,
   * so the dither plugin has both LODs on hand to cross-fade across the
   * edge. A pick beyond nearRadius (the near-seam padding admitted it into
   * `picks` in the first place) always lands in ring 2 via `Math.min`. */
  const ringSplit = (picks: { t: TreeInstance; d2: number }[]): TreeInstance[][] => {
    const rings: TreeInstance[][] = [[], [], []];
    const seams = [SEAM_LOD0, SEAM_LOD1] as const;
    for (const pick of picks) {
      const ring = bandForDistanceSq(pick.d2, nearRadius);
      const r = Math.min(ring, 2);
      rings[r]!.push(pick.t);
      // Padded seam duplicates, one ring outward and one inward.
      if (r < 2) {
        const [lo] = seams[r]!;
        if (pick.d2 >= (lo - SEAM_PAD) ** 2) rings[r + 1]!.push(pick.t);
      }
      if (r > 0) {
        const [, hi] = seams[r - 1]!;
        if (pick.d2 < (hi + SEAM_PAD) ** 2) rings[r - 1]!.push(pick.t);
      }
    }
    return rings;
  };

  return {
    near: ringSplit(nearPicks),
    saplings: ringSplit(saplingPicks),
    deadwood: deadwoodPicks.map((pick) => pick.t),
    understory,
    impostors: impostorPicks.map((pick) => pick.t),
    impostorsFill: fillPicks.map((pick) => pick.t),
  };
}

/** Cells whose nearest point sits this far past IMPOSTOR_RADIUS are evicted
 * from the collector cache — far enough that a camera dithering across one
 * cell boundary never evicts-and-resamples the same trailing edge. */
export const COLLECTOR_EVICT_MARGIN = 8 * TREE_CELL;
/** Cache size that triggers an eviction sweep. Since the padded-seams change
 * widened the off-lattice walk to IMPOSTOR_FULL_RADIUS,
 * one full disc now caches ~56k entries (measured: 56,148 after a single
 * cold collect at (1, 1) — was ~24k/~32k before that change), growing by
 * ~244 entries per one-cell warm crossing (measured: 58,592 after 10
 * crossings). 84k lets ~114 crossings of leading-edge growth accumulate
 * before a sweep — comfortably over the ~100-crossing headroom this had
 * before, at the new disc size — and the sweep is still ~1 ms of Map
 * arithmetic, gating it keeps the common warm collect from paying it every
 * crossing. The hard memory bound is this threshold plus one disc of fresh
 * samples (~84k + ~56k ≈ 140k entries). */
const COLLECTOR_SWEEP_SIZE = 84000;

// Numeric cell key: exact for |cell index| < 2^20 (±12,582 km of world — far
// beyond anywhere a camera can stand). A packed number keeps the hot cache
// lookup off string building.
const CELL_KEY_HALF = 1 << 20;
const CELL_KEY_SPAN = 1 << 21;

export type BandCollector = {
  /** Identical output to `collectBands(seed, camX, camZ, nearRadius)`. */
  collect(camX: number, camZ: number, nearRadius?: number): ForestBands;
  /** Cached cell count — exposed so tests can pin the eviction bound. */
  readonly size: number;
};

/**
 * Stateful, memoizing counterpart to `collectBands` — the hot path the
 * renderer uses. `treeInCell` is a pure function of (seed, cx, cz), so its
 * results are cached across rebuilds: a warm collect after a one-cell camera
 * move re-samples only the disc's leading edge (~200 cells) instead of paying
 * fresh terrain samples for the whole ~112k-cell impostor disc (25–33 ms of
 * main-thread stall per 12 m crossing — the bug this exists to prevent).
 * Memory stays bounded by sweeping cells beyond IMPOSTOR_RADIUS +
 * COLLECTOR_EVICT_MARGIN whenever the cache outgrows COLLECTOR_SWEEP_SIZE.
 */
export function createBandCollector(seed: number): BandCollector {
  const cache = new Map<number, TreeInstance | null>();
  return {
    collect(camX: number, camZ: number, nearRadius: number = NEAR_RADIUS): ForestBands {
      const bands = collectBandsWith(camX, camZ, nearRadius, (cx, cz) => {
        const key = (cx + CELL_KEY_HALF) * CELL_KEY_SPAN + (cz + CELL_KEY_HALF);
        let t = cache.get(key);
        if (t === undefined) {
          t = treeInCell(seed, cx, cz);
          cache.set(key, t);
        }
        return t;
      });
      // Evict everything the disc can no longer reach, but only once enough
      // stale growth has accumulated — the sweep itself costs ~1 ms of Map
      // arithmetic, which should not be paid on every 12 m crossing.
      if (cache.size > COLLECTOR_SWEEP_SIZE) {
        const { x: ax, z: az } = bandsOrigin(camX, camZ);
        const evictR = IMPOSTOR_RADIUS + COLLECTOR_EVICT_MARGIN;
        const evictR2 = evictR * evictR;
        for (const key of cache.keys()) {
          const czPart = key % CELL_KEY_SPAN;
          const cz = czPart - CELL_KEY_HALF;
          const cx = (key - czPart) / CELL_KEY_SPAN - CELL_KEY_HALF;
          if (cellMinDistSq(ax, az, cx, cz) >= evictR2) cache.delete(key);
        }
      }
      return bands;
    },
    get size(): number {
      return cache.size;
    },
  };
}
