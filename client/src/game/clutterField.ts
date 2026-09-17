/**
 * Pure per-class clutter band math:
 * walks each of the nine clutter grids — grass, rock, boulder, driftwood, fungus,
 * bush, meadow, flower, litter — around the camera out to that class's own radius, splits
 * the disc at CLUTTER_FAR_SPLIT into a near (full-detail) and far (impostor) LOD
 * hint, and clamps each class to its instance budget, dropping the far tail first.
 * All comparisons are on squared distances: cheap, exact, trig-free — rotation and
 * any other trig is the renderer's job, same division of labour as `forestField.ts`.
 *
 * Output is a pure function of nine class-specific cell-snapped origins (one
 * per class, since the nine grids don't share a lattice) — the forestField
 * `bandsOrigin` idiom, just applied once per class instead of once overall.
 * `collectClutter` is the pure one-shot; `createClutterCollector` is the
 * renderer's hot path, memoizing `clutterInCell` results per (class, cell)
 * across rebuilds so a camera move re-samples only the cells newly inside
 * some class's disc. Pure and Babylon-free, like `forestField.ts`.
 */
import {
  clutterInCell,
  clutterCell,
  CLUTTER_CLASS_COUNT,
  CLUTTER_GRASS_CELL,
  CLUTTER_MEADOW,
  CLUTTER_MEADOW_CELL,
  type ClutterInstance,
} from "../sim/clutter.js";

/**
 * Per-class scatter radius (m), indexed by class id (CLUTTER_GRASS = 0 ..
 * CLUTTER_BUSH = 5, CLUTTER_MEADOW = 6, CLUTTER_FLOWER = 7, CLUTTER_LITTER = 8). Fungus is
 * short-range ground texture; rock and driftwood read at mid-range; boulders
 * are large and rare enough to matter from far off. Grass ran to 115 m
 * (launch value 70) once dense, always-full ground cover became the goal:
 * with saturated presence, the grass horizon — where tufts stop and bare
 * ground texture begins — was the dominant "field looks empty" signal, so it
 * was pushed to where individual tufts stop resolving at typical FOVs. Cut to
 * 75 m when frame time was measured, because the current foliage
 * costs alpha overdraw the earlier flat geometry did not. Now 110 m, to match
 * bush and rock: bush grew 45 → 110 and left
 * grass at 75, so between those horizons a world showed shrubs and stones
 * standing on bare ground with nothing growing under them — measured on one
 * seed as 549 bushes and 54 rocks against 0 grass in the 75–110 m
 * annulus, which reads as a rocky field that turns to grass as the player walks
 * into it. The dither seam that let bush widen carries grass's edge too. Rock 110 m
 * (was 160) and driftwood 110 m (was 160): reduced at the same
 * frame-time check, for the same alpha-overdraw reason — the
 * current meshes that replaced their flat earlier stand-ins cost more
 * per instance. Bush 45 m (was 55, before that 85, before that 120, then 100):
 * the edge belt must read from across a field; canopy occludes deeper
 * bushes. Reduced in one performance pass, then again in another,
 * then again in a
 * frame-time check for the alpha-overdraw reason above, then cut again (55→45, an
 * open-field/forest-edge viewpoint): that second
 * frame-time check's viewpoint still missed the no-regression bar (18.96 ms /
 * p95 33.4 vs main's 16.63 ms) even after the first cut, because
 * clutter.bush_a's 1196-triangle LOD0 draws in the hundreds — the binding
 * cost there is alpha-masked foliage overdraw, not triangle count alone, so
 * the radius (and thus instance count) was cut again rather than swapping
 * LOD0 geometry. Grown back to 110 (a no-visible-
 * spawn design): the near/far LOD seam dithers the near/far
 * swap instead of popping it, so the disc can widen again without the pop
 * the earlier cuts were fighting — the far band now reads at a few pixels
 * rather than close underfoot. Litter (index 8) gets 40 m: it is pebble-sized,
 * and nothing that small reads past 40 m.
 */
export const CLUTTER_RADII: readonly number[] = [110, 110, 400, 110, 70, 110, 40, 50, 40];

/**
 * Fraction of a class's radius inside which the near (full-detail) LOD
 * applies; beyond it and out to the class radius, the far (impostor) LOD
 * applies. One split fraction for every class — simpler than per-class
 * tuning, and nothing calls for more.
 */
export const CLUTTER_FAR_SPLIT = 0.45;

/**
 * Per-class instance budget — a clamp, not a target. Each is checked below
 * against both ceilings from the field math: the hard geometric ceiling
 * (π·r²/cell², one instance per cell within the disc — impossible in
 * practice since presence is Bernoulli) and the mean-density ceiling
 * (π·r²·D_MAX, D_MAX the peak per-m² density constant from sim/clutter.ts,
 * reached only where every gate — altitude, slope, canopy, road, coast — is
 * fully open across the whole disc, which none of the nine classes' gates
 * allow). Cells whose CENTRES lie up to √2·(CLUTTER_JITTER/2)·CELL past the
 * radius can still jitter an instance back inside the disc, so the hard
 * ceiling below widens r by that margin before squaring — the true worst
 * case, not the bare π·r²/cell². Every budget below is chosen to clear the
 * jitter-inclusive HARD ceiling specifically (not merely the weaker of the
 * two), so the clamp can never bind even in a hypothetical gate-fully-open
 * disc — a binding clamp drops the far tail as the camera moves, which
 * pops.
 *
 * All six radii were shrunk when frame time was measured: the
 * current meshes that replaced the flat earlier
 * geometry cost far more per instance than the props they
 * replaced, and grass/bush now carry alpha-masked cutout cards whose
 * overdraw is a fill-rate cost the old flat props did not have. Budgets
 * below are re-derived against the new, smaller radii.
 *
 * grass:     hard π·(110+1.48)²/3²  ≈ 4339, density π·110²·0.12   ≈ 4562 —
 *            with D above the one-per-cell cap (1/9 per m²), the hard
 *            geometric ceiling is the tighter of the two; budget 4400
 *            clears it. (Radius 115→75, budget 4800→2100 in a
 *            later tuning pass; launch was radius 70, D 0.08, budget
 *            1600, before dense, always-full ground cover became the goal
 *            and pushed radius/budget up. Radius 75→110, budget 2100→4400
 *            on 2026-09-10 to close the cover/prop horizon gap — see the
 *            CLUTTER_RADII comment; re-derived against the jitter-widened
 *            hard ceiling only, as bush's was.)
 * rock:      hard π·(110+4.46)²/9²   ≈  508, density π·110²·0.012 ≈  456 —
 *            budget 550 clears BOTH ceilings; this class's clamp can never
 *            bind, same shape as forestField's NEAR_BUDGET_MAX. (Radius
 *            160→110, budget 1300→550 in the same pass.)
 * boulder:   hard π·(400+23.76)²/48² ≈  245, density π·400²·0.0002 ≈ 101 —
 *            budget 260 clears BOTH ceilings, same shape as rock. (Radius
 *            unchanged at 400; budget raised 160→260 in the same pass — 160
 *            cleared only the weaker mean-density ceiling, not the hard
 *            geometric one.)
 * driftwood: hard π·(110+2.97)²/6²   ≈ 1114, density π·110²·0.02   ≈  760 —
 *            budget 700 sits BELOW both, unlike the others: driftwood's gate
 *            (CLUTTER_DRIFT_INLAND + FADE = 40 m) confines it to a coastal
 *            strip far narrower than the (now 110 m, was 160 m) disc, so the
 *            uniform-disc density estimate above overstates any real
 *            camera's load — 700 is generous against the strip's actual
 *            yield and still a genuine backstop against a pathological
 *            coastline shape. Radius shrank 160→110 with the rest of the
 *            current mesh set in the same pass, but the budget deliberately
 *            stays at 700 rather than being re-derived off the disc
 *            ceiling, for the same coastal-strip reason as before.
 * fungus:    hard π·(70+2.97)²/6²    ≈  465, density π·70²·0.015   ≈  231 —
 *            budget 500 clears BOTH ceilings, same shape as rock. (Radius
 *            unchanged at 70; budget raised 350→500 in the same pass — 350
 *            cleared only the weaker mean-density ceiling, not the hard
 *            geometric one.)
 * bush:      hard π·(110+1.98)²/4²   ≈ 2462, density π·110²·0.07   ≈ 2661 —
 *            D above the one-per-cell cap (1/16 per m²), so as with grass
 *            the jitter-widened hard geometric ceiling is the tighter of
 *            the two; budget 2500 clears it. Radius cut again 55→45 at an
 *            open-field/forest-edge viewpoint that still missed the
 *            frame-time check's no-regression bar after the 85→55 cut below,
 *            because alpha-masked foliage overdraw — not triangle count
 *            alone — was the binding cost, so the radius (and instance
 *            count) was cut again rather than swapping clutter.bush_a's
 *            LOD0. Continuing the 120→100 reduction in one pass
 *            (budget 2000 at radius 100), the 100→85 reduction in another
 *            pass (budget 1500 at radius 85), and the 85→55 reduction in
 *            a frame-time check (budget 650 at radius 55), then 650→445 at
 *            the cut above. Grown 45→110: the near/far
 *            LOD seam now dithers the swap
 *            instead of popping it, so the earlier pop concern no longer
 *            blocks a wider disc; budget 445→2500 re-derived against the
 *            jitter-widened hard ceiling only — no separate seam-duplicate
 *            share, since a budget bounds UNIQUE instances
 *            and seam duplicates cost nothing against it.
 * meadow:    hard π·(40+0.35)²/0.7²  ≈ 10437, density π·40²·2.05 ≈ 10304 —
 *            D 2.05 stays above the one-per-cell cap 1/0.49 ≈ 2.04 (a
 *            property of D and cell, unaffected by radius), so as before
 *            the jitter-widened hard geometric ceiling is the binding one;
 *            budget 10600 clears it. Radius grown 20→40 (the launch
 *            value was 20 m): the carpet's near/far seam (`clutterSeamEdges`)
 *            now sits at 18 m and floors at the fixed 4.24 m
 *            (√2·CLUTTER_GRASS_CELL) jitter width instead of the 15%
 *            cushion.
 * flower:    hard π·(50+0.74)²/1.5²  ≈ 3595, density π·50²·0.5    ≈ 3927 —
 *            mean-density ceiling still exceeds the hard one; the
 *            jitter-widened hard geometric ceiling ≈3595 is binding (same
 *            grass/meadow saturated-presence convention); budget 3650
 *            clears it. Radius grown 35→50 (the launch value was 35 m).
 *            The drift
 *            gate keeps real counts far lower than either ceiling
 *            regardless of radius.
 * litter:    hard π·(40+0.495)²/1²    ≈ 5153, density π·40²·0.6    ≈ 3016 —
 *            with D (0.6) below the one-per-cell cap (1/1 per m²), the hard
 *            geometric ceiling is still the tighter of the two once jitter
 *            widens it; budget 5200 clears it, same shape as rock/fungus.
 *            The litter band confines real counts to a thin strip either side
 *            of the trail, far below this uniform-disc estimate — the
 *            driftwood coastal-strip reasoning above, but the clamp is left
 *            at the disc-clearing value anyway since litter's own radius (40 m)
 *            is already small.
 */
export const CLUTTER_BUDGETS: readonly number[] = [4400, 550, 260, 700, 500, 2500, 10600, 3650, 5200];

/**
 * Edge-fade ramp per class, as a fraction of the effective radius (this
 * used to describe the deleted clutterFadePlugin.ts shrink-toward-the-base
 * mechanism): the width of the
 * dither dissolve band — `distanceFadePlugin.ts`'s `fadeBands` out-band —
 * as a fraction of the disc radius. An instance dissolves from full
 * visibility to fully discarded across the last `fraction × radius` metres
 * of the disc; nothing shrinks. Renderer-side, never a tunable. Meadow's
 * 0.3 is 12 m of its 40 m disc, chosen to clear the √2·CLUTTER_GRASS_CELL ≈
 * 4.2 m jitter of a disc boundary that snaps to the grass cell rather than
 * following the eye — an instance that exists only because it is inside
 * the snapped disc but past the eye's edge must already be at dither
 * visibility zero. Every other class starts at 0.2 and is judged in the
 * browser; boulders (80 m of 400) are the one to watch.
 */
export const CLUTTER_FADE_FRACTION: readonly number[] = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.2, 0.2];

/** The floor on the fade ramp's width, on every quality tier. The disc
 * boundary snaps to the grass cell (`maybeBuild`'s fixed 3 m rebuild grid)
 * rather than following the eye continuously, so an instance can sit up to
 * this far past the eye's edge and still be inside the disc. If the ramp is
 * narrower than this, an instance at the disc edge is not yet at dither
 * visibility zero: a visible pop rather than a dissolve, because the snap
 * jitter outran the band meant to hide it. `CLUTTER_FADE_FRACTION` clears
 * this at radiusScale 1, but the ramp width scales with the tier while the
 * jitter does not, so a low-tier disc (0.6×) can shrink the ramp below the
 * floor unless `clutterFadeEdges` clamps it back up.
 */
export const CLUTTER_FADE_MIN_RAMP = Math.SQRT2 * CLUTTER_GRASS_CELL;

/** The blade clumps (bladeClump.ts) draw the meadow's instances inside this
 * distance (m) of the eye, on the tiers that create the bucket; the cards
 * take over across the last BLADE_BAND metres. */
export const BLADE_RADIUS = 12;
/** Width (m) of the hand-off band: each blade shrinks to its root and the
 * card at the same cell dithers in across it. Wider than
 * CLUTTER_FADE_MIN_RAMP, as every fade here must be. */
export const BLADE_BAND = 4.5;
/** How far (m) the true eye can sit from the origin the blade distances were
 * measured against: the bucket is rebuilt only on a 3 m grass-cell crossing
 * and its origin is floored to the meadow's own 0.7 m cell, so the worst
 * offset is the diagonal of both. A clump collected out to
 * BLADE_RADIUS + BLADE_PAD is present for every eye inside the rebuild cell,
 * so a blade never pops at the eye; clumps past BLADE_RADIUS are fully
 * collapsed by the shader and cost vertices only. */
export const BLADE_PAD = Math.SQRT2 * (CLUTTER_GRASS_CELL + CLUTTER_MEADOW_CELL);

/** The coupling this pad relies on: `BLADE_RADIUS + BLADE_PAD` (≈ 17.2 m)
 * must stay under the meadow's near split (`CLUTTER_RADII[CLUTTER_MEADOW] ·
 * CLUTTER_FAR_SPLIT` = 18 m), so every instance the blade bucket reaches is
 * also a near-card instance — the card the blade hands off to at
 * `bladeEdges().end` is always drawn. Neither side of this scales with
 * `radiusScale`: blades exist only at scale 1, so the reach and the band are
 * fixed while the near split they must clear moves with the tier. */

/** The hand-off band (m of true eye distance): blades whole at `start`, gone
 * at `end`; the meadow near card bucket's in-band is the same pair. */
export function bladeEdges(): { start: number; end: number } {
  return { start: BLADE_RADIUS - BLADE_BAND, end: BLADE_RADIUS };
}

/** The fade's edges for a class: end at the tier-scaled radius, start a
 * fraction inside it, but never closer to `end` than `CLUTTER_FADE_MIN_RAMP`
 * — and never below zero for a disc smaller than the
 * floor. */
export function clutterFadeEdges(cls: number, radiusScale = 1): { start: number; end: number } {
  const end = (CLUTTER_RADII[cls] as number) * radiusScale;
  const fractional = end * (1 - (CLUTTER_FADE_FRACTION[cls] as number));
  const start = Math.max(0, Math.min(fractional, end - CLUTTER_FADE_MIN_RAMP));
  return { start, end };
}

/** The near/far LOD seam for a class: ends at the split,
 * starts 15% of the near disc inside it, floored at the snap-jitter width
 * like the edge fade. The far LOD dithers IN across it, the near LOD OUT. */
export function clutterSeamEdges(cls: number, radiusScale = 1): { start: number; end: number } {
  const end = (CLUTTER_RADII[cls] as number) * radiusScale * CLUTTER_FAR_SPLIT;
  const start = Math.max(0, Math.min(end * 0.85, end - CLUTTER_FADE_MIN_RAMP));
  return { start, end };
}

/** Per class: the near and far LOD lists, and — for the meadow class only,
 * when a blade reach was given — the instances the blade bucket draws,
 * nearest first. Empty otherwise. */
export type ClutterBands = { near: ClutterInstance[]; far: ClutterInstance[]; blades: ClutterInstance[] }[];

/** The cell-snapped anchor class `cls`'s distances are measured from — the
 * forestField `bandsOrigin` idiom, but keyed to that class's own cell size
 * since the nine clutter grids don't share one lattice. Snapping makes the
 * band walk a pure function of the snapped origin: two cameras in the same
 * cell of a given class yield identical bands for that class. */
function clutterOrigin(camX: number, camZ: number, cell: number): { x: number; z: number } {
  return {
    x: Math.floor(camX / cell) * cell,
    z: Math.floor(camZ / cell) * cell,
  };
}

/**
 * The band walk itself, parameterised over the cell sampler and the budgets
 * so the pure one-shot, the memoizing collector, and the budget-clamp
 * mutation-test hook below share one loop — none of the three can drift from
 * each other because they ARE the same function.
 */
function collectClutterCore(
  camX: number,
  camZ: number,
  radiusScale: number,
  budgets: readonly number[],
  sample: (cls: number, cx: number, cz: number) => ClutterInstance | null,
  bladeReach: number,
): ClutterBands {
  const bands: ClutterBands = [];
  for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
    const cell = clutterCell(cls);
    const r = CLUTTER_RADII[cls]! * radiusScale;
    const split = r * CLUTTER_FAR_SPLIT;
    const r2 = r * r;
    const split2 = split * split;
    const seam = clutterSeamEdges(cls, radiusScale);
    const seamLo = Math.max(0, seam.start - CLUTTER_FADE_MIN_RAMP);
    const seamHi = seam.end + CLUTTER_FADE_MIN_RAMP;
    const seamLo2 = seamLo * seamLo;
    const seamHi2 = seamHi * seamHi;
    // The blade list: the meadow's instances within the reach of the snapped
    // origin, gathered on the same walk. Squared like the rest.
    const bladeReach2 = cls === CLUTTER_MEADOW && bladeReach > 0 ? bladeReach * bladeReach : 0;
    const blades: { inst: ClutterInstance; d2: number }[] = [];
    const { x: ax, z: az } = clutterOrigin(camX, camZ, cell);

    // The cell square circumscribing the disc — every cell that could hold
    // an in-range instance, plus a few corner cells that can't (trimmed
    // below by the actual squared-distance test on the sampled instance).
    const c0x = Math.floor((ax - r) / cell);
    const c1x = Math.floor((ax + r) / cell);
    const c0z = Math.floor((az - r) / cell);
    const c1z = Math.floor((az + r) / cell);

    const near: { inst: ClutterInstance; d2: number }[] = [];
    const far: { inst: ClutterInstance; d2: number }[] = [];
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const inst = sample(cls, cx, cz);
        if (inst === null) continue;
        const dx = inst.x - ax;
        const dz = inst.z - az;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        if (d2 < bladeReach2) blades.push({ inst, d2 });
        // Seam duplication: an instance inside the seam
        // band, padded by the snap jitter on each side, is emitted to BOTH
        // LOD buckets — the shader fades one out and the other in from the
        // true eye distance, so a padded one draws once. Squared, like the
        // rest of the walk.
        if (d2 < split2) {
          near.push({ inst, d2 });
          if (d2 >= seamLo2) far.push({ inst, d2 });
        } else {
          far.push({ inst, d2 });
          if (d2 < seamHi2) near.push({ inst, d2 });
        }
      }
    }

    const budget = budgets[cls]!;
    // The budget bounds UNIQUE instances, not list entries: a seam duplicate
    // holds one entry in each of `near`/`far`, and clamping either list on
    // its own (entry-counted, as this used to) can drop only ONE half of a
    // kept pair — exactly the pop the seam duplication exists to prevent.
    // So the over-budget path collapses near ∪ far to its unique instances
    // (identity-deduped: a duplicate's two entries share the same `inst`
    // object and the same `d2`), sorts once by distance — nearest first, so
    // the far tail still drops first by construction — keeps the closest
    // `budget` of them, then rebuilds BOTH lists from the survivors with the
    // exact near/far membership rule the walk above just used, so a kept
    // seam pair is rebuilt as a pair and a dropped one is dropped from both.
    if (near.length + far.length > budget) {
      const seen = new Set<ClutterInstance>();
      const unique: { inst: ClutterInstance; d2: number }[] = [];
      for (const p of near) {
        if (!seen.has(p.inst)) {
          seen.add(p.inst);
          unique.push(p);
        }
      }
      for (const p of far) {
        if (!seen.has(p.inst)) {
          seen.add(p.inst);
          unique.push(p);
        }
      }
      unique.sort((a, b) => a.d2 - b.d2);
      unique.length = Math.min(unique.length, budget);
      near.length = 0;
      far.length = 0;
      blades.length = 0;
      for (const p of unique) {
        if (p.d2 < bladeReach2) blades.push(p);
        if (p.d2 < split2) {
          near.push(p);
          if (p.d2 >= seamLo2) far.push(p);
        } else {
          far.push(p);
          if (p.d2 < seamHi2) near.push(p);
        }
      }
    }

    // Nearest first, so the single-draw blade bucket resolves its own
    // overdraw by the depth test rather than by shading every layer.
    blades.sort((a, b) => a.d2 - b.d2);
    bands.push({ near: near.map((p) => p.inst), far: far.map((p) => p.inst), blades: blades.map((p) => p.inst) });
  }
  return bands;
}

/**
 * Every clutter instance the renderer should draw around the camera, banded
 * near/far per class and clamped to CLUTTER_BUDGETS. `radiusScale` shrinks
 * every class radius together — the quality-tier hook, mirroring
 * forestField's `nearRadius` parameter on `collectBands`. `bladeReach` (m, 0
 * for none) also fills the meadow class's `blades` list; see `BLADE_PAD`.
 */
export function collectClutter(
  seed: number,
  camX: number,
  camZ: number,
  radiusScale: number = 1,
  bladeReach: number = 0,
): ClutterBands {
  return collectClutterCore(
    camX,
    camZ,
    radiusScale,
    CLUTTER_BUDGETS,
    (cls, cx, cz) => clutterInCell(seed, cls, cx, cz),
    bladeReach,
  );
}

/**
 * Test-only sibling of `collectClutter` that accepts caller-supplied
 * budgets, so `clutterField.test.ts` can force the over-budget clamp path
 * through the SAME clamp logic production code runs (mutant 1's
 * far-tail-first ordering check), instead of a parallel re-implementation in
 * the test that could pass even if the real clamp broke. Deliberately
 * exported for that purpose — not part of the renderer-facing surface.
 */
export function collectClutterWithBudgets(
  seed: number,
  camX: number,
  camZ: number,
  budgets: readonly number[],
  radiusScale: number = 1,
  bladeReach: number = 0,
): ClutterBands {
  return collectClutterCore(
    camX,
    camZ,
    radiusScale,
    budgets,
    (cls, cx, cz) => clutterInCell(seed, cls, cx, cz),
    bladeReach,
  );
}

export type ClutterCollector = {
  /** Identical output to `collectClutter(seed, camX, camZ, radiusScale, bladeReach)`. */
  collect(camX: number, camZ: number, radiusScale?: number, bladeReach?: number): ClutterBands;
  /** Cached cell count — exposed so tests can pin the eviction bound (the
   * `forestField.ts` `BandCollector.size` idiom). */
  readonly size: number;
};

// Numeric cell key, class-prefixed since nine grids share one cache: exact
// for |cell index| < 2^20 per class (±12,582 km — far beyond anywhere a
// camera can stand), same packing idiom as forestField's CELL_KEY constants.
const CELL_KEY_HALF = 1 << 20;
const CELL_KEY_SPAN = 1 << 21;
const CELL_KEY_CLASS_SPAN = CELL_KEY_SPAN * CELL_KEY_SPAN;

/** Cells whose nearest point sits this far past a class's own radius are
 * evicted from the collector cache — mirrors forestField's
 * COLLECTOR_EVICT_MARGIN, scaled to each class's own cell size so a camera
 * dithering across one cell boundary never evicts-and-resamples the same
 * trailing edge. */
function evictRadius(cls: number): number {
  return CLUTTER_RADII[cls]! + 8 * clutterCell(cls);
}

/** Cache size that triggers an eviction sweep (every figure below is freshly
 * measured against the CURRENT radii; an earlier version of this comment
 * still cited bush at 45 m and ~11.2k).
 *
 * A cold collect caches the full CIRCUMSCRIBING SQUARE of every class,
 * every (cls, cx, cz) the walk visits regardless of whether it holds an
 * instance or passes the disc test — not just the accepted ones. Measured
 * directly against `CLUTTER_RADII`/`clutterCell` (2026-09-04): grass 2,601
 * + rock 676 + boulder 324 + driftwood 1,444 + fungus 576 + bush 3,136 +
 * meadow 13,456 + flower 4,624 = **26,837 cells**, and — because this count
 * is a pure function of each class's r/cell ratio, never of camera
 * position — the same total at any cold camera.
 *
 * The OLD threshold (20000) sat BELOW that cold total, so the very first
 * collect already tripped the sweep, and cache.size never dropped under
 * 20000 even right after one (measured: 25,464 post-sweep — still over
 * threshold): the sweep — enumerate every cached key, recompute its
 * distance — ran on literally every 3 m crossing instead of the periodic,
 * amortized cost it exists to be, while evicting almost nothing each time
 * (the disc's own cells mostly sit inside every class's own `evictRadius`).
 *
 * Leading-edge growth, measured with eviction disabled so trailing-edge
 * loss can't mask it, axis-aligned 3 m crossings (`maybeBuild`'s rebuild
 * grid), at two different cameras: 767.3 and 766.1 entries/crossing —
 * consistently ~770. 110000 fits the cold disc (26,837) plus ~108
 * crossings of that growth (⌊(110000 − 26837) / 770⌋ = 108) before a sweep
 * pays its own Map-arithmetic cost — the sweep itself is cheap, but gating
 * it keeps a warm collect from paying it every crossing, the property the
 * old threshold had lost entirely. The hard memory bound is this threshold
 * plus one disc of fresh samples (~110k + ~27k ≈ 137k entries). Exported
 * (unlike `forestField.ts`'s own private sweep-size constant) so the test
 * that pins the cold-cache-vs-threshold margin does not hardcode a second
 * copy of this number. */
export const COLLECTOR_SWEEP_SIZE = 110000;

/**
 * Stateful, memoizing counterpart to `collectClutter` — the hot path the
 * renderer uses. `clutterInCell` is a pure function of (seed, cls, cx, cz),
 * so its results are cached across rebuilds keyed by (class, cell): a warm
 * collect after a small camera move re-samples only the cells newly inside
 * some class's disc instead of paying fresh density/terrain samples for all
 * nine grids every frame. Mirrors `forestField.ts`'s `createBandCollector`.
 */
export function createClutterCollector(seed: number): ClutterCollector {
  const cache = new Map<number, ClutterInstance | null>();
  return {
    collect(camX: number, camZ: number, radiusScale: number = 1, bladeReach: number = 0): ClutterBands {
      const bands = collectClutterCore(
        camX,
        camZ,
        radiusScale,
        CLUTTER_BUDGETS,
        (cls, cx, cz) => {
          const key = cls * CELL_KEY_CLASS_SPAN + (cx + CELL_KEY_HALF) * CELL_KEY_SPAN + (cz + CELL_KEY_HALF);
          let inst = cache.get(key);
          if (inst === undefined) {
            inst = clutterInCell(seed, cls, cx, cz);
            cache.set(key, inst);
          }
          return inst;
        },
        bladeReach,
      );
      // Evict everything every class's disc can no longer reach, but only
      // once enough stale growth has accumulated — see COLLECTOR_SWEEP_SIZE.
      if (cache.size > COLLECTOR_SWEEP_SIZE) {
        // Hoisted out of the per-key loop below:
        // `clutterOrigin` is a pure function of (camX, camZ, cell), and cell
        // takes only CLUTTER_CLASS_COUNT (9) distinct values, so computing it
        // once per class here instead of once per cached KEY (tens of
        // thousands, every sweep) was pure waste — the nine results below
        // are looked up by class inside the loop instead.
        const originByClass: { x: number; z: number }[] = [];
        for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
          originByClass.push(clutterOrigin(camX, camZ, clutterCell(cls)));
        }
        for (const key of cache.keys()) {
          const cls = Math.floor(key / CELL_KEY_CLASS_SPAN);
          const rest = key - cls * CELL_KEY_CLASS_SPAN;
          const czPart = rest % CELL_KEY_SPAN;
          const cz = czPart - CELL_KEY_HALF;
          const cx = (rest - czPart) / CELL_KEY_SPAN - CELL_KEY_HALF;
          const cell = clutterCell(cls);
          const { x: ax, z: az } = originByClass[cls]!;
          const dx = Math.max(cx * cell - ax, 0, ax - (cx + 1) * cell);
          const dz = Math.max(cz * cell - az, 0, az - (cz + 1) * cell);
          const evR = evictRadius(cls);
          if (dx * dx + dz * dz >= evR * evR) cache.delete(key);
        }
      }
      return bands;
    },
    get size(): number {
      return cache.size;
    },
  };
}
