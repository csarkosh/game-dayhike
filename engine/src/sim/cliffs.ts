/**
 * Cliff bands and lowland outcrops: a C²
 * terracing remap of the pre-road olympic field, masked by altitude, two
 * noise windows, and road suppression. This module knows nothing about the
 * coast or the road — the signed road offset `u` arrives as a parameter —
 * so `olympic.ts` composes it without a dependency cycle, exactly as it
 * composes road.ts.
 *
 * THE CONTRACT (same as montane.ts): the returned dx/dz are the EXACT
 * analytic derivatives of the returned h. Wherever the mask is exactly
 * zero, the base sample is returned AS THE SAME OBJECT — bit-identity by
 * construction, the corridorD idiom, immune to float re-association.
 *
 * The mask never reads slope: risers concentrate on steep ground anyway
 * (steep ground crosses more band boundaries per horizontal metre), and a
 * slope-keyed mask would need the composed field's second derivatives,
 * which do not exist. Everything the mask reads — the BASE height and
 * fbm2d windows — has exact first derivatives.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */

import { fbm2d } from "./field.js";
import type { TerrainSample } from "./terrain.js";

// ---- Tunables (all join the olympic variant record) --------
export const CLIFF_PERIOD = 26;
export const CLIFF_BENCH = 0.8;
export const CLIFF_RISER_HALF = 0.12;
export const CLIFF_PHASE_AMP = 14;
export const CLIFF_PHASE_WAVELENGTH = 900;
export const CLIFF_PHASE_OCTAVES = 2;
export const CLIFF_PHASE_SALT = 0xc11f;
export const CLIFF_ALT_LO = 120;
export const CLIFF_ALT_HI = 220;
export const CLIFF_MTN_STRENGTH = 1.0;
export const CLIFF_MTN_WAVELENGTH = 700;
export const CLIFF_MTN_OCTAVES = 2;
export const CLIFF_MTN_LO = 0.45;
export const CLIFF_MTN_HI = 0.75;
export const CLIFF_MTN_SALT = 0x5ca9;
export const CLIFF_OUT_STRENGTH = 1.0;
export const CLIFF_OUT_WAVELENGTH = 300;
export const CLIFF_OUT_OCTAVES = 2;
export const CLIFF_OUT_LO = 0.62;
export const CLIFF_OUT_HI = 0.72;
export const CLIFF_OUT_ALT_LO = 12;
export const CLIFF_OUT_ALT_HI = 20;
export const CLIFF_OUT_SALT = 0x0a7c;
/** = ROAD_CORRIDOR_HALF; retune together. */
export const CLIFF_ROAD_NEAR = 30;
export const CLIFF_ROAD_FAR = 90;

/** Quintic smootherstep with derivative — same shape as road.ts's. C²: its
 * second derivative is zero at both edges, which is what makes the band
 * step below C² across the wrap. */
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

/**
 * One band of the terrace: a blend of identity and a quintic
 * step, compressing CLIFF_BENCH of the band's rise into a riser of
 * half-width CLIFF_RISER_HALF around the band midpoint.
 *
 * step(0) = 0 and step(1) = 1 (the smootherstep window is interior because
 * CLIFF_RISER_HALF < 0.5), and step′ = 1 − CLIFF_BENCH at both edges with
 * step″ = 0 there — so the terrace is C² where f wraps between bands.
 * Monotone by construction: step′ ≥ 1 − CLIFF_BENCH > 0.
 */
export function terraceStepD(f: number): { v: number; d: number } {
  const s = smootherstepD(0.5 - CLIFF_RISER_HALF, 0.5 + CLIFF_RISER_HALF, f);
  return {
    v: (1 - CLIFF_BENCH) * f + CLIFF_BENCH * s.v,
    d: (1 - CLIFF_BENCH) + CLIFF_BENCH * s.d,
  };
}

/**
 * Δ(g) = T(g) − g where T(g) = PERIOD·(n + step(f)) terraces the
 * phase-shifted altitude g. Returned d is dΔ/dg = step′(f) − 1; the caller
 * chains it onto ∂g/∂x. |Δ| ≤ PERIOD·CLIFF_BENCH/2 — the census bound,
 * derived from the terrace's own geometry.
 */
export function terraceDeltaD(g: number): { v: number; d: number } {
  const s = g / CLIFF_PERIOD;
  const n = Math.floor(s);
  const st = terraceStepD(s - n);
  return {
    v: CLIFF_PERIOD * (n + st.v) - g,
    d: st.d - 1,
  };
}

/**
 * The cliff mask m ∈ [0, 1] with its exact gradient:
 *
 *   m = smootherstep(0, 1, M + O) · R
 *
 * M — mountain component: altitude ramp × patchy noise window.
 * O — outcrop component: sparse noise threshold × altitude floor (so sand
 *     and shore are never terraced).
 * R — road suppression on u², exactly 0 for |u| ≤ CLIFF_ROAD_NEAR, so the
 *     grade lattice at the centerline is untouched and the road census
 *     keeps its measured behaviour.
 *
 * Reads the BASE height only — never the terraced output, never slope.
 */
export function cliffMaskD(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  base: TerrainSample,
): { v: number; dx: number; dz: number } {
  const r = smootherstepD(
    CLIFF_ROAD_NEAR * CLIFF_ROAD_NEAR,
    CLIFF_ROAD_FAR * CLIFF_ROAD_FAR,
    u * u,
  );
  if (r.v === 0) return { v: 0, dx: 0, dz: 0 };

  const aM = smootherstepD(CLIFF_ALT_LO, CLIFF_ALT_HI, base.h);
  const aO = smootherstepD(CLIFF_OUT_ALT_LO, CLIFF_OUT_ALT_HI, base.h);
  if (aM.v === 0 && aO.v === 0) return { v: 0, dx: 0, dz: 0 };

  // Mountain component M = STRENGTH · altRamp(h) · window(wm). The altitude
  // ramp chains through the base gradient; the window through fbm2d's own.
  let mV = 0;
  let mDx = 0;
  let mDz = 0;
  if (aM.v > 0) {
    const n = fbm2d(x / CLIFF_MTN_WAVELENGTH, z / CLIFF_MTN_WAVELENGTH, seed ^ CLIFF_MTN_SALT, CLIFF_MTN_OCTAVES);
    const w = smootherstepD(CLIFF_MTN_LO, CLIFF_MTN_HI, 0.5 + 0.5 * n.v);
    const wDx = (w.d * 0.5 * n.dx) / CLIFF_MTN_WAVELENGTH;
    const wDz = (w.d * 0.5 * n.dz) / CLIFF_MTN_WAVELENGTH;
    mV = CLIFF_MTN_STRENGTH * aM.v * w.v;
    mDx = CLIFF_MTN_STRENGTH * (aM.d * base.dx * w.v + aM.v * wDx);
    mDz = CLIFF_MTN_STRENGTH * (aM.d * base.dz * w.v + aM.v * wDz);
  }

  // Outcrop component O — same shape, sparse threshold. Its altitude gate
  // saturates at 1 above CLIFF_OUT_ALT_HI, so outcrops also add on mountain
  // ground; the saturating clamp below absorbs the overlap.
  let oV = 0;
  let oDx = 0;
  let oDz = 0;
  if (aO.v > 0) {
    const n = fbm2d(x / CLIFF_OUT_WAVELENGTH, z / CLIFF_OUT_WAVELENGTH, seed ^ CLIFF_OUT_SALT, CLIFF_OUT_OCTAVES);
    const w = smootherstepD(CLIFF_OUT_LO, CLIFF_OUT_HI, 0.5 + 0.5 * n.v);
    const wDx = (w.d * 0.5 * n.dx) / CLIFF_OUT_WAVELENGTH;
    const wDz = (w.d * 0.5 * n.dz) / CLIFF_OUT_WAVELENGTH;
    oV = CLIFF_OUT_STRENGTH * aO.v * w.v;
    oDx = CLIFF_OUT_STRENGTH * (aO.d * base.dx * w.v + aO.v * wDx);
    oDz = CLIFF_OUT_STRENGTH * (aO.d * base.dz * w.v + aO.v * wDz);
  }

  // C² saturating clamp (exactly 1 with zero derivative above 1), then the
  // road factor. ∂R/∂x = r.d·2u·∂u/∂x with ∂u/∂x = 1 and ∂u/∂z = uDz.
  const s = smootherstepD(0, 1, mV + oV);
  const rDx = r.d * 2 * u;
  const rDz = r.d * 2 * u * uDz;
  return {
    v: s.v * r.v,
    dx: s.d * (mDx + oDx) * r.v + s.v * rDx,
    dz: s.d * (mDz + oDz) * r.v + s.v * rDz,
  };
}

/** The multiplier a caller may put on the cliff mask, with world partials.
 * The default leaves the mask alone; olympic.ts passes the apron's keep. */
export type MaskKeep = { v: number; dx: number; dz: number };
export const UNIT_KEEP: MaskKeep = { v: 1, dx: 0, dz: 0 };

/**
 * The cliff stage: h′ = h + m·Δ(g) over the phase-shifted
 * altitude g = h + φ. Cheapest gates first — these early-outs ARE the
 * bit-identity guarantee, and they cost zero noise calls on sea, beach and
 * road-corridor ground. `keep` (default UNIT_KEEP) multiplies the mask —
 * the apron's `1 − A(u, z)`, exactly 0 inside the apron so the stage returns
 * base as the same object there.
 */
export function cliffD(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  base: TerrainSample,
  keep: MaskKeep = UNIT_KEEP,
): TerrainSample {
  if (u * u <= CLIFF_ROAD_NEAR * CLIFF_ROAD_NEAR) return base;
  if (base.h < CLIFF_OUT_ALT_LO) return base;
  if (keep.v === 0) return base; // the apron: the mask is exactly 0 here
  const m0 = cliffMaskD(seed, x, z, u, uDz, base);
  if (m0.v === 0) return base;
  // The caller's multiplier, product rule in world partials. Value-based,
  // not `keep === UNIT_KEEP`: olympic.ts constructs a fresh MaskKeep on
  // every call (apronKeepD returns the shared UNIT_KEEP only outside the
  // apron), so a reference check would never take this fast path there.
  const m = (keep.v === 1 && keep.dx === 0 && keep.dz === 0) ? m0 : {
    v: m0.v * keep.v,
    dx: m0.dx * keep.v + m0.v * keep.dx,
    dz: m0.dz * keep.v + m0.v * keep.dz,
  };

  // Phase-shifted bands: scarps must not ring the world at the
  // same altitudes — the perturbed-snow-line reasoning, applied to rock.
  const ph = fbm2d(x / CLIFF_PHASE_WAVELENGTH, z / CLIFF_PHASE_WAVELENGTH, seed ^ CLIFF_PHASE_SALT, CLIFF_PHASE_OCTAVES);
  const g = base.h + CLIFF_PHASE_AMP * ph.v;
  const gDx = base.dx + (CLIFF_PHASE_AMP * ph.dx) / CLIFF_PHASE_WAVELENGTH;
  const gDz = base.dz + (CLIFF_PHASE_AMP * ph.dz) / CLIFF_PHASE_WAVELENGTH;
  const del = terraceDeltaD(g);
  return {
    h: base.h + m.v * del.v,
    dx: base.dx + m.dx * del.v + m.v * del.d * gDx,
    dz: base.dz + m.dz * del.v + m.v * del.d * gDz,
  };
}
