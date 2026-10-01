/**
 * Geometry clipmap over the terrain field: concentric rings of
 * fixed vertex count, each at double the sample spacing of the ring inside
 * it. Because elevation is a pure function of world coordinates, distant
 * terrain needs no chunk generation — each ring samples the field at whatever
 * spacing it wants, and the whole ~8 km view is 7 draw calls. The drawn
 * surface is an upper envelope of the field, not the exact sample: each
 * vertex carries a chord-excess lift, blended toward the next coarser ring
 * at its border so seams stay watertight.
 *
 * Pure and Babylon-free; `renderer.ts` is the shell that uploads the output.
 */
import { groundCover } from "../sim/clutter.js";
import { elevationSampleAt } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { classifySurface } from "./terrainSurface.js";
import { waterGroundAt } from "./waterGround.js";

export const RING_CELLS = 128;
export const RING_COUNT = 7;
export const BASE_SPACING = 1;
/** Components per vertex in `weights2`/`terrainWeights2`: pebble, detail,
 * duff, canopy density. Every allocation, write and copy of that buffer is
 * sized off this constant so a stride change cannot silently corrupt the
 * vertex stream at a site this file forgot. */
export const WEIGHTS2_STRIDE = 4;
/** Cells of a ring covered by the next finer ring: 64 coarse = 128 fine. */
export const HOLE_CELLS = RING_CELLS / 2;
const SIDE = RING_CELLS + 1;
/** Half-lattice side: every vertex plus the midpoint between each pair —
 * the sample set the ridge lift reads. */
export const HALF_SIDE = 2 * RING_CELLS + 1;

export type RingSamples = {
  level: number;
  spacing: number;
  /** Min-corner vertex, world metres — always a multiple of 2·spacing. */
  originX: number;
  originZ: number;
  /** SIDE² per-vertex samples, row-major by (iz, ix). */
  h: Float32Array;
  /** HALF_SIDE² exact heights on the half-lattice (spacing/2), row-major by
   * (jz, jx). Vertex (ix, iz) is half-lattice point (2ix, 2iz) and its entry
   * equals `h[iz * SIDE + ix]` by construction — one sample, written to
   * both. The odd entries are what the chord-excess lift reads. */
  hh: Float32Array;
  dx: Float32Array;
  dz: Float32Array;
  /** RGBA per vertex, from classifySurface's albedo half at fill time. */
  colors: Float32Array;
  /** (grass, forestFloor, rock, sand) per vertex, from classifySurface's
   * weights half. */
  weights: Float32Array;
  /** (pebble, detail, duff, canopy) per vertex — the rest of TerrainWeights,
   * split out so the GPU attribute pair matches a fixed (vec4, vec4) layout.
   * Duff is groundCover's own duff fraction, riding along unclassified so the
   * paint agrees with where the litter pieces themselves stand. Canopy is the
   * forestDensity value the classification was fed: no class weight carries
   * it (it only tints the colour), so the trail paint reads it here to tell
   * ground under the trees from open ground. */
  weights2: Float32Array;
  /** The ground cover's grass at the vertex, clamped to 1 — the blade
   * field's own strength. The terrain's sward floor keys on it. */
  cover: Float32Array;
  /** SIDE² × 3 unit normals, from `dx`/`dz` at fill time: what `ringGeometry`
   * uploads, kept with the samples so a re-emit copies them. */
  normals: Float32Array;
  /** SIDE² × `liftedHeight` of each vertex, kept at full precision so a
   * re-emit, and the finer ring's border blend (`coarseHeight`), read the
   * very doubles `liftedHeight` returns. A move copies the lift of every
   * vertex that is interior in both the old ring and the new, and computes
   * only the rest (`ringSampleSlices`). */
  lift: Float64Array;
  /** Vertices whose lift the last move or fill computed. For the tests. */
  lifted: number;
  /** Moves committed: what a move prepared ahead (`prepareRingMove`) checks
   * that the arrays it read are still the ring's. */
  moves: number;
};

/** A ring's sample arrays, as a move writes them before they replace the
 * ring's own. */
export type RingArrays = Pick<RingSamples, "h" | "hh" | "dx" | "dz" | "colors" | "weights" | "weights2" | "cover" | "normals" | "lift">;

function ringArrays(): RingArrays {
  return {
    h: new Float32Array(SIDE * SIDE),
    hh: new Float32Array(HALF_SIDE * HALF_SIDE),
    dx: new Float32Array(SIDE * SIDE),
    dz: new Float32Array(SIDE * SIDE),
    colors: new Float32Array(SIDE * SIDE * 4),
    weights: new Float32Array(SIDE * SIDE * 4),
    weights2: new Float32Array(SIDE * SIDE * WEIGHTS2_STRIDE),
    cover: new Float32Array(SIDE * SIDE),
    normals: new Float32Array(SIDE * SIDE * 3),
    lift: new Float64Array(SIDE * SIDE),
  };
}

export type RingGeometry = {
  positions: Float32Array;
  /** 16-bit: the largest index is SIDE² − 1 = 16640, well inside 65535. */
  indices: Uint16Array;
  normals: Float32Array;
  colors: Float32Array;
  /** (grass, forestFloor, rock, sand) per vertex — see RingSamples.weights. */
  weights: Float32Array;
  /** (pebble, detail, duff, canopy) per vertex — see RingSamples.weights2. */
  weights2: Float32Array;
  /** One float per vertex, min(1, grass) — see RingSamples.cover. */
  cover: Float32Array;
};

export function ringSpacing(level: number): number {
  let s = BASE_SPACING;
  for (let i = 0; i < level; i++) s *= 2;
  return s;
}

/**
 * Min corner of the ring for a camera position: centred, then snapped DOWN to
 * a multiple of 2·spacing. Snapping to the ring's own lattice is what stops
 * vertices sliding between sample positions as the camera moves (the classic
 * swim artifact); snapping to TWICE it puts every vertex of this ring on the
 * next coarser ring's lattice too, which is what keeps the coarser ring's
 * hole aligned to whole coarse cells at all times.
 */
export function snapOrigin(cam: number, spacing: number): number {
  const step = 2 * spacing;
  return Math.floor((cam - (RING_CELLS / 2) * spacing) / step) * step;
}

/** Where a fill writes: the arrays, and the ring's origin and spacing they
 * are sampled at. */
type Target = { a: RingArrays; originX: number; originZ: number; spacing: number };

function sampleInto(t: Target, seed: number, ix: number, iz: number): void {
  const { a } = t;
  const x = t.originX + ix * t.spacing;
  const z = t.originZ + iz * t.spacing;
  const s = elevationSampleAt(seed, x, z);
  const at = iz * SIDE + ix;
  a.h[at] = s.h;
  a.dx[at] = s.dx;
  a.dz[at] = s.dz;
  a.hh[2 * iz * HALF_SIDE + 2 * ix] = s.h;
  // Heightfield normal (-dh/dx, 1, -dh/dz), normalised — from the EXACT
  // analytic gradient, which is the payoff of the derivative discipline in
  // sim/montane.ts: it yields smooth true normals. Read back from the stored
  // float32 gradient, as `ringGeometry` reads it. Handedness does not enter
  // here; the index winding is where it does.
  const gx = a.dx[at] as number;
  const gz = a.dz[at] as number;
  const len = Math.hypot(gx, 1, gz);
  a.normals[at * 3] = -gx / len;
  a.normals[at * 3 + 1] = 1 / len;
  a.normals[at * 3 + 2] = -gz / len;
  // Passing the sample skips forestDensity and groundCover re-deriving the
  // terrain field. groundCover's own duff fraction rides along so the paint
  // agrees with where the duff pieces themselves stand, and the canopy
  // density rides with it — both kept in locals so they can also be written
  // to weights2 below, unclassified. Its grass, clamped to 1, is the cover
  // channel the terrain's sward floor reads.
  const gc = groundCover(seed, x, z, s);
  const duff = gc.duff;
  const canopy = forestDensity(seed, x, z, s);
  const { albedo, weights } = classifySurface(
    seed, x, z, s.h, Math.hypot(s.dx, s.dz), canopy, duff, waterGroundAt(seed, x, z, s.h),
  );
  const c = at * 4;
  a.colors[c] = albedo.r;
  a.colors[c + 1] = albedo.g;
  a.colors[c + 2] = albedo.b;
  a.colors[c + 3] = 1;
  // Material weights ride the same traversal: the
  // classification is already computed for the colour, so this is free.
  a.weights[c] = weights.grass;
  a.weights[c + 1] = weights.forestFloor;
  a.weights[c + 2] = weights.rock;
  a.weights[c + 3] = weights.sand;
  const w2 = at * WEIGHTS2_STRIDE;
  a.weights2[w2] = weights.pebble;
  a.weights2[w2 + 1] = weights.detail;
  a.weights2[w2 + 2] = duff;
  a.weights2[w2 + 3] = canopy;
  a.cover[at] = Math.min(1, gc.grass);
}

/** One half-lattice point that is NOT a vertex: a midpoint or a cell centre.
 * Height only — normals, colours and weights live at vertex resolution. */
function sampleHalfInto(t: Target, seed: number, jx: number, jz: number): void {
  const half = t.spacing / 2;
  t.a.hh[jz * HALF_SIDE + jx] = elevationSampleAt(seed, t.originX + jx * half, t.originZ + jz * half).h;
}

export function createRingSamples(seed: number, level: number, camX: number, camZ: number): RingSamples {
  const spacing = ringSpacing(level);
  const originX = snapOrigin(camX, spacing);
  const originZ = snapOrigin(camZ, spacing);
  const target: Target = { a: ringArrays(), originX, originZ, spacing };
  for (let jz = 0; jz < HALF_SIDE; jz++) {
    for (let jx = 0; jx < HALF_SIDE; jx++) {
      if ((jx & 1) === 0 && (jz & 1) === 0) sampleInto(target, seed, jx >> 1, jz >> 1);
      else sampleHalfInto(target, seed, jx, jz);
    }
  }
  const { a } = target;
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) a.lift[iz * SIDE + ix] = liftOf(a.h, a.hh, ix, iz);
  }
  return { level, spacing, originX, originZ, ...a, lifted: SIDE * SIDE, moves: 0 };
}

/** Rough cost of one vertex sample against one half-lattice height sample:
 * the vertex also asks for the ground cover, the canopy and the class. */
const VERTEX_SAMPLE_COST = 5;
/** Half-lattice samples' worth of work a slice of a ring's move does before
 * it yields: about a tenth of a millisecond. */
const MOVE_SLICE_COST = 80;
/** Lifts a slice computes before it yields: about as long. */
const LIFT_SLICE = 1024;

/**
 * Re-centres the ring on the camera if its snapped origin moved. Samples are
 * functions of ABSOLUTE world position, so every vertex still inside the ring
 * keeps its values — copied by index shift — and only the strips that entered
 * the ring are sampled. A full ring is ~66k height samples. Measured in the browser:
 * about +105 ms per ring at startup, ~+750 ms across seven — under two-page CPU
 * contention, so an upper bound — and about +1.8 ms per scroll step, ~+0.67 ms per frame
 * while walking, zero at rest. The scroll-equals-fresh-build test in
 * clipmap.test.ts is what keeps this path honest.
 *
 * The move writes a second set of arrays and swaps it in whole at its end,
 * so a job dropped between two of its slices leaves the ring as it was.
 * `spare` holds sets to write into: one is taken (or made), and the ring's
 * old set is put back, so rings moved one after another share one spare set.
 * The surviving samples are copied a row at a time; the lift of a vertex
 * interior to both the old ring and the new is copied too, since every
 * sample it reads survived with it, and only the lifts of the new strips and
 * of the rows and columns on either ring's border (whose edges past the
 * border `liftedHeight` skips) are computed. Returns whether the ring moved.
 */
export function* ringSampleSlices(
  ring: RingSamples,
  seed: number,
  camX: number,
  camZ: number,
  spare: RingArrays[] = [],
): Generator<void, boolean, void> {
  const ox = snapOrigin(camX, ring.spacing);
  const oz = snapOrigin(camZ, ring.spacing);
  if (ox === ring.originX && oz === ring.originZ) return false;
  const to = spare.pop() ?? ringArrays();
  let committed = false;
  try {
    const lifted = yield* ringMoveSlices(ring, seed, ox, oz, to);
    commitRingMove(ring, { moves: ring.moves, originX: ox, originZ: oz, arrays: to, lifted }, spare);
    committed = true;
  } finally {
    // A move dropped half done hands its arrays back.
    if (!committed) spare.push(to);
  }
  return true;
}

/** A move worked out and not yet committed: the arrays for the ring at
 * (originX, originZ), made from the ring as it stood after `moves` moves. */
export type RingMove = { moves: number; originX: number; originZ: number; arrays: RingArrays; lifted: number };

/** Makes `move` the ring's, in one step: its arrays become the ring's, and
 * the ring's old ones go to `spare`. */
export function commitRingMove(ring: RingSamples, move: RingMove, spare: RingArrays[]): void {
  spare.push({
    h: ring.h, hh: ring.hh, dx: ring.dx, dz: ring.dz, colors: ring.colors, weights: ring.weights,
    weights2: ring.weights2, cover: ring.cover, normals: ring.normals, lift: ring.lift,
  });
  Object.assign(ring, move.arrays);
  ring.originX = move.originX;
  ring.originZ = move.originZ;
  ring.lifted = move.lifted;
  ring.moves++;
}

/**
 * The move to (ox, oz) worked out ahead, while the ring stays where it is:
 * `ringSampleSlices`' work, into arrays taken from `spare`, in slices. Null
 * if the ring moves before it is done — it reads the ring's own arrays, which
 * a move hands to `spare` — and then its arrays go back to `spare`. Committed
 * later by `commitRingMove` while `ring.moves` is still the one it records,
 * it makes the ring exactly what a move made then would: the same inputs,
 * the same arithmetic.
 */
export function* prepareRingMove(
  ring: RingSamples,
  seed: number,
  ox: number,
  oz: number,
  spare: RingArrays[],
): Generator<void, RingMove | null, void> {
  const moves = ring.moves;
  const to = spare.pop() ?? ringArrays();
  const slices = ringMoveSlices(ring, seed, ox, oz, to);
  let made = false;
  try {
    for (;;) {
      if (ring.moves !== moves) return null;
      const step = slices.next();
      if (step.done === true) {
        made = true;
        return { moves, originX: ox, originZ: oz, arrays: to, lifted: step.value };
      }
      yield;
    }
  } finally {
    // Outrun by a move, or dropped half done: the arrays go back.
    if (!made) spare.push(to);
  }
}

/** The work of a move to (ox, oz), from the ring's arrays into `to`, in
 * slices; the ring itself is not touched. Returns the lifts it computed. */
function* ringMoveSlices(ring: RingSamples, seed: number, ox: number, oz: number, to: RingArrays): Generator<void, number, void> {
  const sx = Math.round((ox - ring.originX) / ring.spacing);
  const sz = Math.round((oz - ring.originZ) / ring.spacing);
  const from: RingArrays = ring;
  const target: Target = { a: to, originX: ox, originZ: oz, spacing: ring.spacing };
  let cost = 0;

  // Vertices, a row at a time: the span whose old index is inside the old
  // ring is copied, the rest sampled.
  const ixLo = Math.max(0, -sx);
  const ixHi = Math.min(SIDE - 1, SIDE - 1 - sx);
  for (let iz = 0; iz < SIDE; iz++) {
    const fz = iz + sz;
    const kept = fz >= 0 && fz < SIDE && ixLo <= ixHi;
    if (kept) copyVertexSpan(from, to, iz * SIDE + ixLo, fz * SIDE + ixLo + sx, ixHi - ixLo + 1);
    for (let ix = 0; ix < SIDE; ix++) {
      if (kept && ix === ixLo) {
        ix = ixHi;
        continue;
      }
      sampleInto(target, seed, ix, iz);
      cost += VERTEX_SAMPLE_COST;
      if (cost >= MOVE_SLICE_COST) {
        cost = 0;
        yield;
      }
    }
  }
  // The half-lattice, likewise: a vertex shift of k cells is 2k half cells,
  // so the copied span keeps every point's parity, and the vertex points
  // outside it were written by `sampleInto` above.
  const jxLo = Math.max(0, -2 * sx);
  const jxHi = Math.min(HALF_SIDE - 1, HALF_SIDE - 1 - 2 * sx);
  for (let jz = 0; jz < HALF_SIDE; jz++) {
    const fjz = jz + 2 * sz;
    const kept = fjz >= 0 && fjz < HALF_SIDE && jxLo <= jxHi;
    if (kept) {
      const at = fjz * HALF_SIDE + jxLo + 2 * sx;
      to.hh.set(from.hh.subarray(at, at + jxHi - jxLo + 1), jz * HALF_SIDE + jxLo);
    }
    for (let jx = 0; jx < HALF_SIDE; jx++) {
      if (kept && jx === jxLo) {
        jx = jxHi;
        continue;
      }
      if ((jx & 1) === 0 && (jz & 1) === 0) continue;
      sampleHalfInto(target, seed, jx, jz);
      cost += 1;
      if (cost >= MOVE_SLICE_COST) {
        cost = 0;
        yield;
      }
    }
  }
  // Lifts: copied where the vertex is interior to both rings, computed
  // elsewhere, from the new samples.
  let lifted = 0;
  let liftedAtYield = 0;
  const cxLo = Math.max(1, 1 - sx);
  const cxHi = Math.min(RING_CELLS - 1, RING_CELLS - 1 - sx);
  for (let iz = 0; iz < SIDE; iz++) {
    const fz = iz + sz;
    const kept = iz >= 1 && iz <= RING_CELLS - 1 && fz >= 1 && fz <= RING_CELLS - 1 && cxLo <= cxHi;
    if (kept) {
      const at = fz * SIDE + cxLo + sx;
      to.lift.set(from.lift.subarray(at, at + cxHi - cxLo + 1), iz * SIDE + cxLo);
    }
    for (let ix = 0; ix < SIDE; ix++) {
      if (kept && ix === cxLo) {
        ix = cxHi;
        continue;
      }
      to.lift[iz * SIDE + ix] = liftOf(to.h, to.hh, ix, iz);
      lifted++;
    }
    // Checked a row at a time: a row's lifts are a few microseconds each.
    if (lifted - liftedAtYield >= LIFT_SLICE) {
      liftedAtYield = lifted;
      yield;
    }
  }
  return lifted;
}

/** Copies `n` vertices' samples from `from` at vertex index `fromAt` to `to`
 * at `toAt`: every per-vertex array, lifts aside. */
function copyVertexSpan(from: RingArrays, to: RingArrays, toAt: number, fromAt: number, n: number): void {
  to.h.set(from.h.subarray(fromAt, fromAt + n), toAt);
  to.dx.set(from.dx.subarray(fromAt, fromAt + n), toAt);
  to.dz.set(from.dz.subarray(fromAt, fromAt + n), toAt);
  to.cover.set(from.cover.subarray(fromAt, fromAt + n), toAt);
  to.colors.set(from.colors.subarray(fromAt * 4, (fromAt + n) * 4), toAt * 4);
  to.weights.set(from.weights.subarray(fromAt * 4, (fromAt + n) * 4), toAt * 4);
  to.weights2.set(from.weights2.subarray(fromAt * WEIGHTS2_STRIDE, (fromAt + n) * WEIGHTS2_STRIDE), toAt * WEIGHTS2_STRIDE);
  to.normals.set(from.normals.subarray(fromAt * 3, (fromAt + n) * 3), toAt * 3);
}

/** `ringSampleSlices` at once. */
export function updateRingSamples(ring: RingSamples, seed: number, camX: number, camZ: number, spare?: RingArrays[]): boolean {
  const slices = ringSampleSlices(ring, seed, camX, camZ, spare);
  for (;;) {
    const step = slices.next();
    if (step.done === true) return step.value;
  }
}

/** The finer ring's footprint in this ring's cell indices — always integral
 * and strictly interior, guaranteed by snapOrigin's 2·spacing snap. */
export function holeCellsFor(ring: RingSamples, finer: RingSamples): { x0: number; z0: number } {
  return {
    x0: Math.round((finer.originX - ring.originX) / ring.spacing),
    z0: Math.round((finer.originZ - ring.originZ) / ring.spacing),
  };
}

function insideHole(hole: { x0: number; z0: number } | null, ix: number, iz: number): boolean {
  if (hole === null) return false;
  return ix >= hole.x0 && ix < hole.x0 + HOLE_CELLS && iz >= hole.z0 && iz < hole.z0 + HOLE_CELLS;
}

/**
 * Below this, an excess is float32 rounding of the stored samples, not
 * terrain: on a perfect plane the three samples round independently and
 * can manufacture a few 1e-5 m of "crest". A millimetre is invisible at any
 * ring and keeps planes exactly planar, which the plane test pins.
 */
const LIFT_DEADBAND = 1e-3;

/**
 * The six drawn edges from a vertex, as (dx, dz) in cells: the four axis
 * neighbours and the two partners across the drawn diagonal. `ringGeometry`
 * triangulates cell (ix, iz) as (a, b, c), (b, d, c) with a = (ix, iz),
 * b = (ix+1, iz), c = (ix, iz+1), so the drawn diagonal is b–c. Vertex P is
 * b of the cell to its west, partner (-1, +1), and c of the cell to its
 * south, partner (+1, -1). A winding change below must change these two
 * entries with it — the cell-centre check in the guarantee test is what
 * catches a mismatch.
 */
const LIFT_EDGES: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [-1, 1], [1, -1],
];

/**
 * Chord-excess lift: the vertex's exact height plus
 * the most the field rises above the drawn chord at the midpoint of any of
 * its six drawn edges, clamped at zero. Zero on a plane and in a bowl;
 * positive only where a crest runs between this vertex and a neighbour.
 *
 * Guarantee: the drawn surface is at or above the exact field at every
 * half-lattice point. At a vertex, own ≥ h. At a midpoint m of P–Q, both
 * endpoints were lifted by at least hh(m) − (h(P) + h(Q))/2, so the chord
 * passes at or above hh(m); a cell centre lies on the drawn diagonal and
 * the same argument covers it. What remains is the field's excursion
 * between half-lattice points.
 *
 * Edges whose far vertex lies outside the ring are skipped. Only the
 * outermost ring's border row ever exercises that: every other border is
 * overridden by the coarser ring in ringGeometry.
 */
export function liftedHeight(ring: RingSamples, ix: number, iz: number): number {
  return liftOf(ring.h, ring.hh, ix, iz);
}

/** `liftedHeight` on a ring's two height arrays. */
function liftOf(h: Float32Array, hh: Float32Array, ix: number, iz: number): number {
  const own = h[iz * SIDE + ix] as number;
  let lift = LIFT_DEADBAND;
  for (const [ex, ez] of LIFT_EDGES) {
    const qx = ix + ex;
    const qz = iz + ez;
    if (qx < 0 || qx > RING_CELLS || qz < 0 || qz > RING_CELLS) continue;
    const mid = hh[(2 * iz + ez) * HALF_SIDE + (2 * ix + ex)] as number;
    const excess = mid - (own + (h[qz * SIDE + qx] as number)) / 2;
    if (excess > lift) lift = excess;
  }
  return lift > LIFT_DEADBAND ? own + lift : own;
}

/**
 * What the coarser ring C draws at this ring's vertex (ix, iz): its own
 * lifted vertex where the two lattices coincide (even, even), otherwise its
 * chord — the mean of two lifted C vertices along the edge (one odd index)
 * or across the drawn diagonal b–c of the C cell whose centre this is (both
 * odd). `x0`/`z0` are this ring's offset in C's cells, `holeCellsFor(C,
 * ring)`. This ring's origin is a multiple of 2·spacing, so its even-even
 * vertices lie on C's lattice by construction (snapOrigin). The chord
 * averages the unrounded doubles `liftedHeight` returns, where the old
 * odd-vertex crack fix averaged the stored float32 heights directly; the
 * difference is under one float32 ulp and is deliberate, not an oversight.
 */
export function coarseHeight(coarser: RingSamples, x0: number, z0: number, ix: number, iz: number): number {
  const cx = x0 + (ix >> 1);
  const cz = z0 + (iz >> 1);
  const oddX = ix & 1;
  const oddZ = iz & 1;
  if (oddX === 0 && oddZ === 0) return liftedHeight(coarser, cx, cz);
  if (oddZ === 0) return (liftedHeight(coarser, cx, cz) + liftedHeight(coarser, cx + 1, cz)) / 2;
  if (oddX === 0) return (liftedHeight(coarser, cx, cz) + liftedHeight(coarser, cx, cz + 1)) / 2;
  // Cell centre: on the drawn diagonal from b = (cx+1, cz) to c = (cx, cz+1).
  return (liftedHeight(coarser, cx + 1, cz) + liftedHeight(coarser, cx, cz + 1)) / 2;
}

/**
 * Blend weight from this ring's own lift (0, at the hole boundary) to the
 * coarser ring's value (1, at the border), by Chebyshev cell distance.
 * Ring 0 has no hole and measures from its centre
 * vertex. Vertices inside the hole get 0 and are never indexed.
 */
export function blendWeight(hole: { x0: number; z0: number } | null, ix: number, iz: number): number {
  const dOut = Math.min(ix, RING_CELLS - ix, iz, RING_CELLS - iz);
  let dIn: number;
  if (hole === null) {
    dIn = Math.max(Math.abs(ix - RING_CELLS / 2), Math.abs(iz - RING_CELLS / 2));
  } else {
    const dx = Math.max(hole.x0 - ix, ix - (hole.x0 + HOLE_CELLS), 0);
    const dz = Math.max(hole.z0 - iz, iz - (hole.z0 + HOLE_CELLS), 0);
    dIn = Math.max(dx, dz);
  }
  const span = dIn + dOut;
  return span === 0 ? 1 : dIn / span;
}

/**
 * Draws the ring's field as an upper envelope: the chord-excess lift,
 * blended toward what the coarser ring draws so the
 * two agree exactly at the border — the old odd-vertex crack fix is
 * now the t = 1 case. Normals stay the exact analytic gradient and colours
 * and weights are untouched; only the drawn height moves.
 */
export function ringGeometry(
  ring: RingSamples,
  hole: { x0: number; z0: number } | null,
  coarser: RingSamples | null,
): RingGeometry {
  const positions = new Float32Array(SIDE * SIDE * 3);
  const normals = new Float32Array(SIDE * SIDE * 3);
  const colors = new Float32Array(SIDE * SIDE * 4);
  const weights = new Float32Array(SIDE * SIDE * 4);
  const weights2 = new Float32Array(SIDE * SIDE * WEIGHTS2_STRIDE);
  const cover = new Float32Array(SIDE * SIDE);
  const outer = coarser === null ? null : holeCellsFor(coarser, ring);

  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const at = iz * SIDE + ix;
      // Ridge lift: this ring's chord-excess lift,
      // blended toward what the coarser ring draws so the two agree exactly
      // at the border for even (its vertex) and odd (its chord) vertices
      // alike — the old crack fix is now the t = 1 case. The explicit
      // t >= 1 branch keeps that agreement bit-exact rather than one
      // rounding away. The outermost ring has no neighbour and draws its
      // own lift throughout.
      let y = liftedHeight(ring, ix, iz);
      if (coarser !== null && outer !== null) {
        const t = blendWeight(hole, ix, iz);
        if (t >= 1) y = coarseHeight(coarser, outer.x0, outer.z0, ix, iz);
        else if (t > 0) y += (coarseHeight(coarser, outer.x0, outer.z0, ix, iz) - y) * t;
      }
      const p = at * 3;
      positions[p] = ring.originX + ix * ring.spacing;
      positions[p + 1] = y;
      positions[p + 2] = ring.originZ + iz * ring.spacing;

      // Heightfield normal (-dh/dx, 1, -dh/dz), normalised — from the EXACT
      // analytic gradient, which is the payoff of the derivative discipline in
      // sim/montane.ts: it yields smooth true normals. Handedness does
      // not enter here; winding below is where it does.
      const gx = ring.dx[at] as number;
      const gz = ring.dz[at] as number;
      const len = Math.hypot(gx, 1, gz);
      normals[p] = -gx / len;
      normals[p + 1] = 1 / len;
      normals[p + 2] = -gz / len;

      colors[at * 4] = ring.colors[at * 4] as number;
      colors[at * 4 + 1] = ring.colors[at * 4 + 1] as number;
      colors[at * 4 + 2] = ring.colors[at * 4 + 2] as number;
      colors[at * 4 + 3] = ring.colors[at * 4 + 3] as number;

      weights[at * 4] = ring.weights[at * 4] as number;
      weights[at * 4 + 1] = ring.weights[at * 4 + 1] as number;
      weights[at * 4 + 2] = ring.weights[at * 4 + 2] as number;
      weights[at * 4 + 3] = ring.weights[at * 4 + 3] as number;
      const w2 = at * WEIGHTS2_STRIDE;
      weights2[w2] = ring.weights2[w2] as number;
      weights2[w2 + 1] = ring.weights2[w2 + 1] as number;
      weights2[w2 + 2] = ring.weights2[w2 + 2] as number;
      weights2[w2 + 3] = ring.weights2[w2 + 3] as number;
      cover[at] = ring.cover[at] as number;
    }
  }

  const quadCount = RING_CELLS * RING_CELLS - (hole === null ? 0 : HOLE_CELLS * HOLE_CELLS);
  // 16-bit, not 32: the largest index is SIDE² − 1 = 16640, so Uint16Array has
  // 3.9× headroom and Babylon's IndicesArray accepts it. Halves index memory
  // (~2.16 MB → ~1.08 MB over seven rings) and halves the upload on the ring-0
  // re-emit path, which at a 144 m/s boost against ring 0's 2 m snap step can
  // run on essentially every frame.
  const indices = new Uint16Array(quadCount * 6);
  let k = 0;
  for (let iz = 0; iz < RING_CELLS; iz++) {
    for (let ix = 0; ix < RING_CELLS; ix++) {
      if (insideHole(hole, ix, iz)) continue;
      const a = iz * SIDE + ix;
      const b = a + 1;
      const c = a + SIDE;
      const d = c + 1;
      // Winding matters and is easy to get backwards. Babylon uses a
      // LEFT-handed system; the reverse of this order yields normals of
      // (0, -1, 0) and the terrain back-face culls into nothing while every
      // other mesh still draws. Guarded by the winding test.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }

  return { positions, indices, normals, colors, weights, weights2, cover };
}

/** Buffers a re-emit writes into, sized for a ring with or without a hole. */
export function ringGeometryBuffers(hole: boolean): RingGeometry {
  const quadCount = RING_CELLS * RING_CELLS - (hole ? HOLE_CELLS * HOLE_CELLS : 0);
  return {
    positions: new Float32Array(SIDE * SIDE * 3),
    indices: new Uint16Array(quadCount * 6),
    normals: new Float32Array(SIDE * SIDE * 3),
    colors: new Float32Array(SIDE * SIDE * 4),
    weights: new Float32Array(SIDE * SIDE * 4),
    weights2: new Float32Array(SIDE * SIDE * WEIGHTS2_STRIDE),
    cover: new Float32Array(SIDE * SIDE),
  };
}

/** Rows of positions a slice of a re-emit writes before it yields: a whole
 * ring's positions are about a tenth of a millisecond. */
const EMIT_SLICE_ROWS = 64;

/** `coarseHeight` from the coarser ring's kept lifts: the same doubles,
 * averaged the same way. */
function coarseLift(lift: Float64Array, x0: number, z0: number, ix: number, iz: number): number {
  const cx = x0 + (ix >> 1);
  const cz = z0 + (iz >> 1);
  const oddX = ix & 1;
  const oddZ = iz & 1;
  const at = cz * SIDE + cx;
  if (oddX === 0 && oddZ === 0) return lift[at] as number;
  if (oddZ === 0) return ((lift[at] as number) + (lift[at + 1] as number)) / 2;
  if (oddX === 0) return ((lift[at] as number) + (lift[at + SIDE] as number)) / 2;
  return ((lift[at + 1] as number) + (lift[at + SIDE] as number)) / 2;
}

/**
 * `ringGeometry` into `out`, in slices: the same buffers, bit for bit, from
 * what the ring keeps rather than computed again. The normals, colours,
 * weights and cover are the ring's own arrays, copied whole; each vertex's
 * height is its kept lift, blended toward the coarser ring's kept lifts
 * exactly as `ringGeometry` blends the ones `liftedHeight` returns; the
 * indices are written again, since the hole moves with the finer ring.
 */
export function* ringGeometrySlices(
  ring: RingSamples,
  hole: { x0: number; z0: number } | null,
  coarser: RingSamples | null,
  out: RingGeometry,
): Generator<void, void, void> {
  out.normals.set(ring.normals);
  out.colors.set(ring.colors);
  out.weights.set(ring.weights);
  out.weights2.set(ring.weights2);
  out.cover.set(ring.cover);
  const { positions } = out;
  const outer = coarser === null ? null : holeCellsFor(coarser, ring);
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const at = iz * SIDE + ix;
      let y = ring.lift[at] as number;
      if (coarser !== null && outer !== null) {
        const t = blendWeight(hole, ix, iz);
        if (t >= 1) y = coarseLift(coarser.lift, outer.x0, outer.z0, ix, iz);
        else if (t > 0) y += (coarseLift(coarser.lift, outer.x0, outer.z0, ix, iz) - y) * t;
      }
      const p = at * 3;
      positions[p] = ring.originX + ix * ring.spacing;
      positions[p + 1] = y;
      positions[p + 2] = ring.originZ + iz * ring.spacing;
    }
    if ((iz + 1) % EMIT_SLICE_ROWS === 0) yield;
  }
  const { indices } = out;
  let k = 0;
  for (let iz = 0; iz < RING_CELLS; iz++) {
    for (let ix = 0; ix < RING_CELLS; ix++) {
      if (insideHole(hole, ix, iz)) continue;
      const a = iz * SIDE + ix;
      const b = a + 1;
      const c = a + SIDE;
      const d = c + 1;
      // `ringGeometry`'s winding, which the winding test there guards.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
}
