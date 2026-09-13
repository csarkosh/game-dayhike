/**
 * The bowl region and the trailhead pad.
 *
 * "Bowl" is the region of the road frame (u, z) the trail graph and the
 * landmarks own — a bounding box, used as the single cheap gate in front of
 * the trail stages. It has NO wall: the cliff face that once stood between the
 * highway and the forest was removed; the road and the forest now meet over
 * the base terrain's own hillside, and an invisible wall in the game layer
 * will keep the player off the road.
 *
 * The pad is a flat disc at the trailhead for the car and the sign, held at
 * the pre-pad field's height at its own centre and blended over its fade.
 *
 * This module knows nothing about the coast or the road: the signed offset
 * `u` and its z-derivative `uDz` arrive as parameters, exactly as `road.ts`
 * and `cliffs.ts` are composed by `olympic.ts` without a dependency cycle.
 *
 * THE CONTRACT (same as montane.ts): dx/dz are the EXACT analytic derivatives
 * of h, and outside the window the base sample is returned AS THE SAME OBJECT.
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { TerrainSample } from "./terrain.js";
import { UNIT_KEEP } from "./cliffs.js";

// ---- Tunables -------------------------------------------
export const TRAIL_Z_ANCHOR = 0;
/** 2026-09-11: 30 → 8, the pavement's own shoulder — the
 * pad now sits INSIDE the road corridor (|u| < ROAD_CORRIDOR_HALF = 30), so
 * the bowl gate must open early enough for the grid to cover it. */
export const BOWL_U_MIN = 8;
export const BOWL_U_MAX = 1000;
export const BOWL_Z_HALF = 600;

/** Disc centre: 9 m from the road centreline — a car's
 * worth off the pavement, not out past the corridor's far edge. That puts the
 * pad, and its whole fade ring (RADIUS + FADE = 14 m), inside the road
 * corridor (|u| < ROAD_CORRIDOR_HALF = 30), so its height is the ROAD's own
 * grade (`padHeightFor` in olympic.ts) rather than the pre-road terrain's —
 * the corridor stage would have overwritten anything else there anyway. */
export const TRAILHEAD_U = 9;
export const TRAILHEAD_RADIUS = 8;
export const TRAILHEAD_FADE = 6;

/** Quintic smootherstep with derivative — same shape as olympic.ts's. */
function smootherstepD(edge0: number, edge1: number, x: number): { v: number; d: number } {
  const span = edge1 - edge0;
  if (x <= edge0) return { v: 0, d: 0 };
  if (x >= edge1) return { v: 1, d: 0 };
  const t = (x - edge0) / span;
  return {
    v: t * t * t * (t * (t * 6 - 15) + 10),
    d: (30 * t * t * (t - 1) * (t - 1)) / span,
  };
}

// ---- The apron --------------------------
/** The z-window in which the coast blend is pulled out to APRON_BLEND_END and
 * the terraces are faded off the ground near the road: the region's
 * BOWL_Z_HALF plus margin, fading to nothing over APRON_Z_FADE beyond it. */
export const APRON_Z_HALF = 700;
export const APRON_Z_FADE = 100;
/** Coast distance at which the shore→montane blend ends inside the window
 * (≈ 500 m inland of the road). Outside the window the blend end is the
 * headland/bay value it always was. */
export const APRON_BLEND_END = 600;
/** Road offset past which the terraces return inside the window, and the fade
 * over which they do. */
export const APRON_CLIFF_U = 450;
export const APRON_CLIFF_FADE = 60;

export const BOWL_TUNABLES: Readonly<Record<string, number>> = {
  TRAIL_Z_ANCHOR, BOWL_U_MIN, BOWL_U_MAX, BOWL_Z_HALF,
  TRAILHEAD_U, TRAILHEAD_RADIUS, TRAILHEAD_FADE,
  APRON_Z_HALF, APRON_Z_FADE, APRON_BLEND_END, APRON_CLIFF_U, APRON_CLIFF_FADE,
};

/** W(z): 1 inside the apron's z-window, 0 beyond, smootherstep across the fade,
 * with its z-derivative. Symmetric about the anchor; the derivative is exactly 0
 * there because the window is flat there, so the |z| has no kink to expose. */
export function apronWindowD(z: number): { v: number; dz: number } {
  const zr = z - TRAIL_Z_ANCHOR;
  const s = smootherstepD(APRON_Z_HALF - APRON_Z_FADE, APRON_Z_HALF, Math.abs(zr));
  return { v: 1 - s.v, dz: -s.d * (zr < 0 ? -1 : 1) };
}

/** A(u, z): the cliff-free factor — 1 near the road inside the window, 0 past
 * APRON_CLIFF_U + APRON_CLIFF_FADE or outside the window. Partials in the road
 * frame; `dz` is the EXPLICIT z-partial (the caller adds du·uDz). */
export function apronCliffFreeD(u: number, z: number): { v: number; du: number; dz: number } {
  const w = apronWindowD(z);
  const su = smootherstepD(APRON_CLIFF_U, APRON_CLIFF_U + APRON_CLIFF_FADE, u);
  return { v: (1 - su.v) * w.v, du: -su.d * w.v, dz: (1 - su.v) * w.dz };
}

/** keep = 1 − A as a multiplier on the cliff mask, with WORLD partials
 * (∂/∂x = ∂/∂u; ∂/∂z = explicit ∂z + ∂u·uDz). The cliff stage multiplies its
 * mask by this, so inside the apron the mask is exactly 0 and the stage
 * returns its base as the same object. Returns the SHARED `UNIT_KEEP`
 * outside the apron (`a.v === 0` implies `a.du === 0` and `a.dz === 0` by
 * apronCliffFreeD's own construction, so keep is exactly {1, 0, 0} there) —
 * cliffD's fast path then matches it by value, not by reference, so this
 * costs nothing when olympic.ts constructs a fresh MaskKeep every call. */
export function apronKeepD(u: number, uDz: number, z: number): { v: number; dx: number; dz: number } {
  const a = apronCliffFreeD(u, z);
  if (a.v === 0 && a.du === 0) return UNIT_KEEP;
  return { v: 1 - a.v, dx: -a.du, dz: -(a.dz + a.du * uDz) };
}

/** The bowl's bounding box in the road frame — the outer gate for every bowl stage. */
export function inBowl(u: number, z: number): boolean {
  return u >= BOWL_U_MIN && u <= BOWL_U_MAX && Math.abs(z - TRAIL_Z_ANCHOR) <= BOWL_Z_HALF;
}

/**
 * The trailhead pad stage. `u` is the signed road offset, `uDz` its
 * z-derivative from the caller's chain rule, `padH` the height the disc is held
 * at (the pre-pad field at the disc centre, memoised per seed by the caller).
 * Returns `base` unchanged (same object) outside RADIUS + FADE.
 */
export function padD(u: number, uDz: number, z: number, padH: number, base: TerrainSample): TerrainSample {
  const qu = u - TRAILHEAD_U;
  const zr = z - TRAIL_Z_ANCHOR;
  const q2 = qu * qu + zr * zr;
  const R = TRAILHEAD_RADIUS + TRAILHEAD_FADE;
  if (q2 >= R * R) return base;
  const q = Math.sqrt(q2);
  const ds = smootherstepD(TRAILHEAD_RADIUS, R, q);
  const disc = 1 - ds.v;
  // ∇q is undefined at q = 0, but ds.d is 0 for q < TRAILHEAD_RADIUS, so the
  // product is 0 there whatever ∇q would have been.
  const qdu = q > 1e-9 ? qu / q : 0;
  const qdz = q > 1e-9 ? zr / q : 0;
  const discDu = -ds.d * qdu;
  const discDz = -ds.d * qdz;
  // Partials in (u, z) first. base.dx is ∂/∂x = ∂/∂u; base's explicit ∂/∂z is
  // base.dz − base.dx·uDz.
  const baseDzExplicit = base.dz - base.dx * uDz;
  const h = (1 - disc) * base.h + disc * padH;
  const hdu = -discDu * base.h + (1 - disc) * base.dx + discDu * padH;
  const hdz = -discDz * base.h + (1 - disc) * baseDzExplicit + discDz * padH;
  // Back to world derivatives: ∂/∂x = ∂/∂u, ∂/∂z = explicit ∂/∂z + ∂/∂u·uDz.
  return { h, dx: hdu, dz: hdz + hdu * uDz };
}
