/**
 * The trail's corridor and the bed's profile.
 *
 * THE BED IS THE GROUND. An edge carries a PROFILE — the pre-trail ground
 * sampled every TRAIL_PROFILE_STEP along it, smoothed by a small triangular
 * kernel, its two ends pinned to the node heights — and the corridor lays that
 * profile down. Nothing here plans a grade: where the trail may run at all is
 * the walkability grid's answer (`trailGrid.ts`), and which cells it runs
 * through is the Dijkstra tree's (`trailBuild.ts`). The eased CHORD this module
 * used to lay, with its fill/cut predicate, its bench cut and its fallback
 * tiers, is gone (2026-09-09): a chord is a line between two points, and on
 * real ground it either floats over a gully or cuts into a bank, which is what
 * every one of those mechanisms was there to bound. A profile has nothing to
 * bound — it is the ground, minus the clods.
 *
 * `trailCorridorD` is the union-of-corridors construction with ONE weight per
 * edge (the two-weight bench-cut split went with the bench): w_i = 1 −
 * smootherstep(BED, CORRIDOR, d_i), w = 1 − Π(1 − w_i), g = Σ w_i g_i / Σ w_i
 * with g_i the edge's own profile at τ_i, h = (1 − w)·base + w·g. Product not
 * max (C¹), and ∇d_i is never needed on the bed where w_i is flat. Two edges
 * meeting at a node agree there exactly — both profiles are pinned to that
 * node's height — so the union has nothing to reconcile at a junction, which
 * is what the eased chord's flat ends used to buy at the cost of following
 * nothing. Beyond an edge's ends the profile extrapolates LINEARLY on the end
 * tangent, so a corridor that reaches past a node (they do, by
 * TRAIL_CORRIDOR_HALF) sees no kink there.
 *
 * Bit-identity outside every corridor by early return: `prod === 1` means every
 * weight was 0, so `base` comes back as the same object.
 *
 * Generic: knows nothing about the coast, the road or the landmarks — it may
 * import `trailGrid.ts` (for the grid's tunables) and nothing else of the
 * trail. `trailBuild.ts` is the one module that composes the three.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { TerrainSample } from "./terrain.js";
import type { Feature } from "./features.js";
import { TRAIL_GRID_TUNABLES } from "./trailGrid.js";

// ---- Tunables ---------------------------------------------------------------
/**
 * The HARD ceiling on the slope of every edge's bed — the fine check.
 * 0.9 under MAX_WALKABLE_GRADIENT (1.0202, ground.ts): the bed the player walks
 * is the profile blended with the ground and with any corridor that overlaps
 * it, so the cap needs real headroom. The grid's own cap (TRAIL_GRID_CAP) sits
 * lower still, because a cell's centre gradient under-reads the ground between
 * centres.
 */
export const TRAIL_HARD_SLOPE_MAX = 0.9;
/** Clear ground between two beds that do not share a node, on top of the two
 * corridor half-widths. Held STRUCTURALLY by the search's two-cell rule
 * (2·TRAIL_GRID_CELL ≥ TRAIL_EDGE_MIN_GAP, asserted by the tests) and by the
 * simplifier, which keeps a vertex rather than let a merged segment come
 * within TRAIL_EDGE_MIN_GAP of an edge it is not adjacent to.
 * Widened from 4 to 7: the smootherstep blend from the bed edge to here is the bench's SHOULDER, and over 3 m its peak cross-grade was 0.625 of the lift per metre — steep enough that the 1 m inner clipmap ring aliased it into light/dark stripes flanking every trail, and under the old rock thresholds the shoulder itself painted as cobbles. Over 6 m the peak is 0.3125 of the lift per metre.
 * 4 → 2 on 2026-09-10 with TRAIL_CORRIDOR_HALF 4 → 7: the grid's two-cell rule guarantees 2·TRAIL_GRID_CELL = 16 m between non-adjacent edges, so TRAIL_EDGE_MIN_GAP = 2·7 + gap must stay ≤ 16 — two metres of untouched ground between two fully faded corridors. */
export const TRAIL_EDGE_GAP = 2;
/** The flat bench's half-width: a 0.9 m compacted core plus a 0.3 m loose
 * margin each side. 1 → 0.75 on 2026-09-16, narrowed from a 2 m bench to a
 * walked footpath — TRAIL_SINK and TRAIL_SINK_RAMP pick up past here. */
export const TRAIL_BED_HALF = 0.75;
export const TRAIL_CORRIDOR_HALF = 7;
/** The bench sits this far (m) below the corridor's blended bed, ramping
 * back up over TRAIL_SINK_RAMP past TRAIL_BED_HALF: a walked footpath is
 * sunk a few centimetres into the turf, and on a side-hill the uphill half
 * of the ramp is its short soil face. Applied after the corridor blend
 * (trailSinkD), as a saturating union across edges so a junction sinks once. */
export const TRAIL_SINK = 0.06;
export const TRAIL_SINK_RAMP = 0.5;
/** Trees are rejected within this of any edge (vegetation.ts): 2 m past the
 * corridor's edge, so no trunk stands on the blend.
 * 6 → 8 on 2026-09-10 with TRAIL_CORRIDOR_HALF 4 → 7, so no trunk stands on the widened shoulder (the clearance follows the corridor). */
export const TRAIL_CLEAR = 8;
/** Seeds the tie-break among equal-scoring landmark candidates (trailBuild.ts).
 * The search itself is seed-free: the seed enters the graph only through the
 * ground and through this. */
export const TRAIL_SALT = 0x7a11;
/** Douglas–Peucker tolerance (m) for the grid path → polyline. */
export const TRAIL_SIMPLIFY_TOL = 6;
/** The bed's profile: the ground sampled every TRAIL_PROFILE_STEP m along the
 * edge, interior samples smoothed by a triangular kernel of half-width
 * TRAIL_PROFILE_SMOOTH samples (8 m) — enough to take out clod-scale bumps,
 * small enough to keep a rise and a dip. The ends are pinned to the node
 * heights, so edges meeting at a node agree there exactly. */
export const TRAIL_PROFILE_STEP = 2;
export const TRAIL_PROFILE_SMOOTH = 4;
/** How many times a landmark's path is re-routed around cells its own fine
 * check found too steep before the next candidate is tried. */
export const TRAIL_REROUTE_MAX = 3;

export const TRAIL_TUNABLES: Readonly<Record<string, number>> = {
  TRAIL_HARD_SLOPE_MAX, TRAIL_EDGE_GAP, TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, TRAIL_SINK, TRAIL_SINK_RAMP, TRAIL_CLEAR, TRAIL_SALT,
  ...TRAIL_GRID_TUNABLES,
  TRAIL_SIMPLIFY_TOL, TRAIL_PROFILE_STEP, TRAIL_PROFILE_SMOOTH, TRAIL_REROUTE_MAX,
};
export const TRAIL_EDGE_MIN_GAP = 2 * TRAIL_CORRIDOR_HALF + TRAIL_EDGE_GAP;

export type TrailNode = { x: number; z: number; h: number; u: number };
/** stem: on the pad→crest chain; loop: on one of the made-feature loops.
 * Informational — the corridor and the paint treat
 * every edge alike. */
export type EdgeKind = "stem" | "loop";
export type TrailEdge = {
  a: number;
  b: number;
  kind: EdgeKind;
  /** The bed's heights every TRAIL_PROFILE_STEP along a→b, ends pinned to the node heights (buildProfile). */
  profile: Float64Array;
  /** stem edges: progress (0 pad → 1 crest) at a and b. loop edges: the
   * nearer junction's progress, at both ends. */
  progress0: number;
  progress1: number;
};
/** The two scenery landmarks: found where the seed's
 * own terrain satisfies the predicate near the trail, carved where it does
 * not. Neither is routed to and neither is a graph node. */
export type LandmarkType = "stand" | "talus";
export type TrailLoop = { kind: "meadow" | "pond"; featureId: number; edges: number[]; junctionA: number; junctionB: number };
export type TrailGraph = {
  nodes: TrailNode[];
  edges: TrailEdge[];
  /** The pad centre: node 0. */
  trailhead: { x: number; z: number; u: number };
  /** The crest node — the graph's only dead end. */
  summit: number;
  /** Edge indices, pad → summit, in order. */
  stem: number[];
  /** Loops around the made features; empty until then. */
  loops: TrailLoop[];
  /** The made features: the peak first, then the loop features in stem order. */
  features: Feature[];
  /** Metres of stem, pad to crest. */
  stemLen: number;
  /** 1 when no walkable route reached the peak's crest even after lowering
   * its rise PEAK_LOWER_TRIES times, so the stem was routed to the highest
   * reachable cell instead, with no dome; 0 across the 227-seed sweep. (The crest
   * itself may still land short of the inland band on a terraced world —
   * that is a different, unflagged fallback: see `peakCentre` in
   * trailBuild.ts.) A count, not a boolean, so loop building can add to it. */
  fallbacks: number;
};

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

/**
 * The bed's profile along an edge: heights every TRAIL_PROFILE_STEP
 * m from a to b, interior samples smoothed by a triangular kernel of half-width
 * TRAIL_PROFILE_SMOOTH samples, the two end samples pinned to the node heights.
 * `groundH` is the pre-trail ground WITH any dome.
 *
 * The kernel runs at FULL WIDTH everywhere, reading the ground BEYOND both ends
 * along the edge's own line rather than shrinking as it approaches them (a
 * departure from how this used to work, 2026-09-09, which shrank it). Shrinking
 * keeps a plane exact — which is all the pre-flight measured — but it leaves a
 * short edge barely smoothed at all, and the short edges are where the smoothing
 * is needed: the trail's FIRST edge runs 14 m from the pad's centre across the
 * pad's own 6 m fade ring, whose slope is ~1.9 × the hillside's (padD holds the
 * disc at its centre height), and with a shrinking kernel the bed reproduced it
 * — measured 1.507 on the composed field, seed −1098592628, against
 * MAX_WALKABLE_GRADIENT. Reading past the ends keeps a plane exact too (every
 * sample in the window is on the plane), and it has a second virtue: two edges
 * meeting at a node smooth over overlapping neighbourhoods, so they agree in
 * SLOPE near the junction and not only in height at it.
 */
export function buildProfile(
  groundH: (x: number, z: number) => number,
  ax: number, az: number, ah: number, bx: number, bz: number, bh: number,
): Float64Array {
  const ex = bx - ax, ez = bz - az;
  const L = Math.sqrt(ex * ex + ez * ez);
  const n = Math.max(1, Math.ceil(L / TRAIL_PROFILE_STEP));
  const S = TRAIL_PROFILE_SMOOTH;
  // raw[k + S] is the ground at sample k ∈ [−S, n + S]; the two node heights
  // are pinned into it so the smoothing sees the bed's own ends.
  const raw = new Float64Array(n + 1 + 2 * S);
  for (let k = -S; k <= n + S; k++) {
    raw[k + S] = k === 0 ? ah : k === n ? bh : groundH(ax + (ex * k) / n, az + (ez * k) / n);
  }
  const out = new Float64Array(n + 1);
  out[0] = ah;
  out[n] = bh;
  for (let k = 1; k < n; k++) {
    let sum = 0, wsum = 0;
    for (let m = -S; m <= S; m++) {
      const w = S + 1 - Math.abs(m);
      sum += w * (raw[k + m + S] as number);
      wsum += w;
    }
    out[k] = sum / wsum;
  }
  return out;
}

/**
 * The profile at τ ∈ ℝ along its edge (τ = 0 at a, 1 at b), Catmull–Rom
 * between samples — C¹ along the edge — and LINEAR beyond the ends with the
 * end tangent, so a corridor that reaches past a node (they do, by
 * TRAIL_CORRIDOR_HALF) sees no kink there. `dTau` is d(value)/dτ.
 */
export function profileAt(p: Float64Array, tau: number): { v: number; dTau: number } {
  const n = p.length - 1;
  if (n <= 0) return { v: p[0] as number, dTau: 0 };
  const s = tau * n; // position in samples
  // Phantom points beyond the ends by LINEAR extrapolation: a clamped index
  // (p[−1] = p[0]) halves the spline's tangent at the ends (pre-flight: 20
  // for a ramp of 40), and the corridor's extrapolation rides that tangent.
  const at = (k: number): number => {
    if (k < 0) return 2 * (p[0] as number) - (p[1] as number);
    if (k > n) return 2 * (p[n] as number) - (p[n - 1] as number);
    return p[k] as number;
  };
  const seg = (k: number, t: number): { v: number; dt: number } => {
    const p0 = at(k - 1);
    const p1 = at(k);
    const p2 = at(k + 1);
    const p3 = at(k + 2);
    const b = p2 - p0, c = 2 * p0 - 5 * p1 + 4 * p2 - p3, d = -p0 + 3 * p1 - 3 * p2 + p3;
    return { v: 0.5 * (2 * p1 + b * t + c * t * t + d * t * t * t), dt: 0.5 * (b + 2 * c * t + 3 * d * t * t) };
  };
  if (s <= 0) {
    const e = seg(0, 0);
    return { v: e.v + s * e.dt, dTau: e.dt * n };
  }
  if (s >= n) {
    const e = seg(n - 1, 1);
    return { v: e.v + (s - n) * e.dt, dTau: e.dt * n };
  }
  const k = Math.min(n - 1, Math.floor(s));
  const e = seg(k, s - k);
  return { v: e.v, dTau: e.dt * n };
}

/** Distance from (x, z) to the segment a→b. C⁰ across segments; used for queries, not heights. */
export function segmentDistance(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const L2 = ex * ex + ez * ez;
  const px = x - ax;
  const pz = z - az;
  const t = L2 > 0 ? Math.min(1, Math.max(0, (px * ex + pz * ez) / L2)) : 0;
  const qx = px - t * ex;
  const qz = pz - t * ez;
  return Math.sqrt(qx * qx + qz * qz);
}

/** Squared distance from (px, pz) to the segment a→b. */
function pointSegmentDistanceSq(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const L2 = ex * ex + ez * ez;
  const rx = px - ax;
  const rz = pz - az;
  const t = L2 > 0 ? Math.min(1, Math.max(0, (rx * ex + rz * ez) / L2)) : 0;
  const qx = rx - t * ex;
  const qz = rz - t * ez;
  return qx * qx + qz * qz;
}

/**
 * Squared minimum XZ distance between the segments a→b and c→d.
 *
 * In the plane, two segments that do not cross attain their minimum at an
 * endpoint of one of them — so the four point-to-segment distances are the whole
 * answer, and the only extra case is a proper crossing, which is zero. The
 * orientation test below is the standard four-cross-product one; touching and
 * collinear-overlap cases fall out of the endpoint distances as zero anyway, so
 * it only has to catch the strictly-interior crossing.
 *
 * Squared, so the caller never takes a root to compare against a threshold.
 */
export function segmentSegmentDistanceSq(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): number {
  const cross = (ox: number, oz: number, px: number, pz: number, qx: number, qz: number): number =>
    (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    Math.min(pointSegmentDistanceSq(cx, cz, dx, dz, ax, az), pointSegmentDistanceSq(cx, cz, dx, dz, bx, bz)),
    Math.min(pointSegmentDistanceSq(ax, az, bx, bz, cx, cz), pointSegmentDistanceSq(ax, az, bx, bz, dx, dz)),
  );
}

/**
 * The corridor stage over EVERY graph edge. `base` is the post-pad, post-dome
 * sample at (x, z); returned unchanged (same object) outside every edge's
 * corridor. TRAIL_BED_HALF is the flat tread's half-width, TRAIL_CORRIDOR_HALF
 * where the field is the ground again.
 *
 * ONE weight per edge, symmetric in the distance from the centreline. There is
 * no cut/fill asymmetry to model any more: the bed IS the ground's own profile,
 * so the depth it cuts is the clod it smoothed out, not a bench.
 */
export function trailCorridorD(
  nodes: readonly TrailNode[],
  edges: readonly TrailEdge[],
  x: number,
  z: number,
  base: TerrainSample,
): TerrainSample {
  let prod = 1, prodDx = 0, prodDz = 0;
  let sw = 0, swDx = 0, swDz = 0;
  let swg = 0, swgDx = 0, swgDz = 0;
  for (const e of edges) {
    const a = nodes[e.a] as TrailNode;
    const b = nodes[e.b] as TrailNode;
    // AABB early-out: four compares, no sqrt. An edge it skips has
    // d ≥ TRAIL_CORRIDOR_HALF and would have contributed w = 0.
    if (x < Math.min(a.x, b.x) - TRAIL_CORRIDOR_HALF || x > Math.max(a.x, b.x) + TRAIL_CORRIDOR_HALF) continue;
    if (z < Math.min(a.z, b.z) - TRAIL_CORRIDOR_HALF || z > Math.max(a.z, b.z) + TRAIL_CORRIDOR_HALF) continue;
    const ex = b.x - a.x, ez = b.z - a.z;
    const L2 = ex * ex + ez * ez;
    if (L2 === 0) continue;
    const px = x - a.x, pz = z - a.z;
    const tau = (px * ex + pz * ez) / L2;
    const tauDx = ex / L2, tauDz = ez / L2;
    const t = Math.min(1, Math.max(0, tau));
    const qx = px - t * ex, qz = pz - t * ez;
    const d = Math.sqrt(qx * qx + qz * qz);
    const wS = smootherstepD(TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, d);
    const w = 1 - wS.v;
    if (w === 0) continue;
    // ∇d = q/d exactly; never needed where d < BED, where wS.d is 0.
    const dDx = d > 1e-9 ? qx / d : 0, dDz = d > 1e-9 ? qz / d : 0;
    const wDx = -wS.d * dDx, wDz = -wS.d * dDz;
    // The bed: the edge's own profile at τ (unclamped: linear beyond the ends).
    const g = profileAt(e.profile, tau);
    const gi = g.v, giDx = g.dTau * tauDx, giDz = g.dTau * tauDz;
    prodDx = prodDx * (1 - w) - prod * wDx;
    prodDz = prodDz * (1 - w) - prod * wDz;
    prod *= 1 - w;
    sw += w; swDx += wDx; swDz += wDz;
    swg += w * gi; swgDx += wDx * gi + w * giDx; swgDz += wDz * gi + w * giDz;
  }
  if (prod === 1) return base;
  const w = 1 - prod, wDx = -prodDx, wDz = -prodDz;
  const g = swg / sw;
  const gDx = (swgDx * sw - swg * swDx) / (sw * sw);
  const gDz = (swgDz * sw - swg * swDz) / (sw * sw);
  return {
    h: (1 - w) * base.h + w * g,
    dx: -wDx * base.h + (1 - w) * base.dx + wDx * g + w * gDx,
    dz: -wDz * base.h + (1 - w) * base.dz + wDz * g + w * gDz,
  };
}

/**
 * The bench sink: TRAIL_SINK inside TRAIL_BED_HALF of any edge, ramping to
 * zero over TRAIL_SINK_RAMP, as a saturating union across edges (a junction
 * sinks once). Same analytic derivatives as the corridor: ∇d = q/d, and
 * smootherstepD's own slope. Returns the sample untouched outside every ramp.
 */
export function trailSinkD(
  nodes: readonly TrailNode[],
  edges: readonly TrailEdge[],
  x: number,
  z: number,
  sample: TerrainSample,
): TerrainSample {
  const outer = TRAIL_BED_HALF + TRAIL_SINK_RAMP;
  let prod = 1, prodDx = 0, prodDz = 0;
  for (const e of edges) {
    const a = nodes[e.a] as TrailNode;
    const b = nodes[e.b] as TrailNode;
    if (x < Math.min(a.x, b.x) - outer || x > Math.max(a.x, b.x) + outer) continue;
    if (z < Math.min(a.z, b.z) - outer || z > Math.max(a.z, b.z) + outer) continue;
    const ex = b.x - a.x, ez = b.z - a.z;
    const L2 = ex * ex + ez * ez;
    if (L2 === 0) continue;
    const px = x - a.x, pz = z - a.z;
    const t = Math.min(1, Math.max(0, (px * ex + pz * ez) / L2));
    const qx = px - t * ex, qz = pz - t * ez;
    const d = Math.sqrt(qx * qx + qz * qz);
    if (d >= outer) continue;
    const r = smootherstepD(TRAIL_BED_HALF, outer, d);
    const s = 1 - r.v;
    const dDx = d > 1e-9 ? qx / d : 0, dDz = d > 1e-9 ? qz / d : 0;
    const sDx = -r.d * dDx, sDz = -r.d * dDz;
    prodDx = prodDx * (1 - s) - prod * sDx;
    prodDz = prodDz * (1 - s) - prod * sDz;
    prod *= 1 - s;
  }
  if (prod === 1) return sample;
  const S = 1 - prod, SDx = -prodDx, SDz = -prodDz;
  return {
    h: sample.h - TRAIL_SINK * S,
    dx: sample.dx - TRAIL_SINK * SDx,
    dz: sample.dz - TRAIL_SINK * SDz,
  };
}

/** Plain minimum over every edge — C⁰, for the leash, tree rejection and paint. */
export function trailDistance(graph: TrailGraph, x: number, z: number): number {
  let best = Infinity;
  for (const e of graph.edges) {
    const a = graph.nodes[e.a] as TrailNode;
    const b = graph.nodes[e.b] as TrailNode;
    const d = segmentDistance(a.x, a.z, b.x, b.z, x, z);
    if (d < best) best = d;
  }
  return best;
}

export function nearestTrailNode(graph: TrailGraph, x: number, z: number): number {
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i] as TrailNode;
    const dx = n.x - x;
    const dz = n.z - z;
    const sq = dx * dx + dz * dz;
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return best;
}
