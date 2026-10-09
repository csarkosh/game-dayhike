/**
 * Pure water-ring math: a clipmap of rings at the water level, mirroring
 * `clipmap.ts` but for the ocean surface. Each ring stores only the TERRAIN
 * height under each vertex and writes the depth below the surface per vertex
 * (`bedDepth`), the fragment stage's fallback outside the bed height texture.
 * Seven rings at 1, 2, 4, 8, 16, 32 and 64 m spacing cover 8,192 m in seven
 * draw calls. Their vertices stay at the level: the waves are the vertex
 * stage's, and each vertex carries what that stage needs to stitch a ring's
 * outer edge to the coarser ring around it (`oceanMorph`, `oceanCoarse`), as
 * the terrain's rings stitch their heights.
 *
 * Pure and Babylon-free; the water shell uploads the output.
 */
import { elevationAt } from "../sim/terrain.js";
import { HOLE_CELLS, blendWeight, snapOrigin } from "./clipmap.js";

/** Same cell count as the terrain clipmap's RING_CELLS, so `snapOrigin` and
 * `HOLE_CELLS` (both parameterised by spacing only beyond that count) can be
 * imported rather than re-derived. */
export const WATER_RING_CELLS = 128;
export const WATER_RING_COUNT = 7;
export const WATER_BASE_SPACING = 1;
/** Metres per bump-texture tile. */
export const WATER_UV_SCALE = 24;
/**
 * How far the drawn sea may stand off its flat plane, in metres, on every
 * axis. The largest significant height the swell is given is 4 m, and the
 * largest crest a wave reaches as it breaks is twice that, 8 m, taken whole on
 * either side of the level; the wind sea adds 4 m in a storm: 12 m. Up and
 * down for the crest and the trough; sideways too, since a trochoid carries
 * its vertices along the wave as well as up. Each ring's culling box is grown
 * by it (`wetBounds`).
 */
export const OCEAN_BOUND = 12;
const SIDE = WATER_RING_CELLS + 1;

export type WaterRingSamples = {
  level: number;
  spacing: number;
  /** Min-corner vertex, world metres — always a multiple of 2·spacing. */
  originX: number;
  originZ: number;
  /** SIDE² terrain heights under the water plane, row-major by (iz, ix). */
  h: Float32Array;
};

export type WaterGeometry = {
  positions: Float32Array;
  /** 16-bit: the largest index is SIDE² − 1 = 16640, well inside 65535. */
  indices: Uint16Array;
  normals: Float32Array;
  /** Water level minus the bed's height, clamped at 0 where the ground is above the surface. */
  bedDepth: Float32Array;
  uvs: Float32Array;
  /**
   * The terrain's border blend (`blendWeight`) per vertex: 0 where the ring
   * draws its own waves (the edge of its hole, or ring 0's centre), rising
   * linearly to 1 on its outer edge, where it draws the coarser ring's. 0
   * throughout the outermost ring, which has no coarser ring.
   */
  oceanMorph: Float32Array;
  /**
   * Per vertex, (x, z) in metres: the half-edge to the coarser ring's
   * lattice. The coarser ring's two vertices joined by the drawn edge this
   * vertex lies at the middle of are at its position minus and plus it, so
   * the coarser ring's surface here is the mean of what it draws at those
   * two. (0, 0) on a vertex of the coarser lattice, where both are the vertex
   * itself, and throughout the outermost ring.
   */
  oceanCoarse: Float32Array;
};

export function waterRingSpacing(level: number): number {
  let s = WATER_BASE_SPACING;
  for (let i = 0; i < level; i++) s *= 2;
  return s;
}

function sampleInto(ring: WaterRingSamples, seed: number, ix: number, iz: number): void {
  const x = ring.originX + ix * ring.spacing;
  const z = ring.originZ + iz * ring.spacing;
  ring.h[iz * SIDE + ix] = elevationAt(seed, x, z);
}

export function createWaterRingSamples(
  seed: number,
  level: number,
  camX: number,
  camZ: number,
): WaterRingSamples {
  const spacing = waterRingSpacing(level);
  const ring: WaterRingSamples = {
    level,
    spacing,
    originX: snapOrigin(camX, spacing),
    originZ: snapOrigin(camZ, spacing),
    h: new Float32Array(SIDE * SIDE),
  };
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) sampleInto(ring, seed, ix, iz);
  }
  return ring;
}

/**
 * Re-centres the ring on the camera if its snapped origin moved. Heights are
 * functions of ABSOLUTE world position, so every vertex still inside the ring
 * keeps its value — copied by index shift — and only the strips that entered
 * the ring are sampled. The scroll-equals-fresh-build test in water.test.ts
 * is what keeps this path honest.
 */
export function updateWaterRingSamples(
  ring: WaterRingSamples,
  seed: number,
  camX: number,
  camZ: number,
): boolean {
  const ox = snapOrigin(camX, ring.spacing);
  const oz = snapOrigin(camZ, ring.spacing);
  if (ox === ring.originX && oz === ring.originZ) return false;
  const shiftX = Math.round((ox - ring.originX) / ring.spacing);
  const shiftZ = Math.round((oz - ring.originZ) / ring.spacing);
  const oldH = ring.h;
  ring.h = new Float32Array(SIDE * SIDE);
  ring.originX = ox;
  ring.originZ = oz;
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const fromIx = ix + shiftX;
      const fromIz = iz + shiftZ;
      if (fromIx >= 0 && fromIx < SIDE && fromIz >= 0 && fromIz < SIDE) {
        ring.h[iz * SIDE + ix] = oldH[fromIz * SIDE + fromIx] as number;
      } else {
        sampleInto(ring, seed, ix, iz);
      }
    }
  }
  return true;
}

/** The finer ring's footprint in this ring's cell indices — always integral
 * and strictly interior, guaranteed by snapOrigin's 2·spacing snap. */
export function waterHoleCellsFor(
  ring: WaterRingSamples,
  finer: WaterRingSamples,
): { x0: number; z0: number } {
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
 * The plane at `waterLevel` carrying the bed depth per vertex, and what the
 * vertex stage needs to stitch the waves it adds: every normal is (0, 1, 0)
 * and every vertex at the level, the waves displacing them there. A ring
 * other than the outermost blends its waves toward the coarser ring's across
 * its band (`oceanMorph`), and draws the coarser ring's exactly on its outer
 * edge, where `oceanCoarse` names the two coarser vertices the edge's middle
 * vertices lie between. Which ring this is comes from `ring.level`.
 */
export function waterRingGeometry(
  ring: WaterRingSamples,
  hole: { x0: number; z0: number } | null,
  waterLevel: number,
): WaterGeometry {
  const positions = new Float32Array(SIDE * SIDE * 3);
  const normals = new Float32Array(SIDE * SIDE * 3);
  const bedDepth = new Float32Array(SIDE * SIDE);
  const uvs = new Float32Array(SIDE * SIDE * 2);
  const oceanMorph = new Float32Array(SIDE * SIDE);
  const oceanCoarse = new Float32Array(SIDE * SIDE * 2);
  const stitched = ring.level < WATER_RING_COUNT - 1;
  const s = ring.spacing;

  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const at = iz * SIDE + ix;
      const x = ring.originX + ix * s;
      const z = ring.originZ + iz * s;
      const p = at * 3;
      positions[p] = x;
      positions[p + 1] = waterLevel;
      positions[p + 2] = z;
      normals[p] = 0;
      normals[p + 1] = 1;
      normals[p + 2] = 0;
      bedDepth[at] = Math.max(0, waterLevel - (ring.h[at] as number));
      uvs[at * 2] = x / WATER_UV_SCALE;
      uvs[at * 2 + 1] = z / WATER_UV_SCALE;
      if (stitched) {
        oceanMorph[at] = blendWeight(hole, ix, iz);
        // The origin is a multiple of 2·spacing (snapOrigin), so an even index
        // is on the coarser lattice. An odd one along one axis is the middle
        // of a coarser edge along it; odd along both is a coarser cell's
        // centre, on the diagonal the coarser ring draws from its cell's
        // (+x, 0) corner to its (0, +z) corner (`coarseHeight`).
        const oddX = (ix & 1) === 1;
        const oddZ = (iz & 1) === 1;
        oceanCoarse[at * 2] = oddX ? s : 0;
        oceanCoarse[at * 2 + 1] = oddZ ? (oddX ? -s : s) : 0;
      }
    }
  }

  const quadCount =
    WATER_RING_CELLS * WATER_RING_CELLS - (hole === null ? 0 : HOLE_CELLS * HOLE_CELLS);
  // 16-bit, not 32: the largest index is SIDE² − 1 = 16640 (129² = 16,641
  // vertices), well inside 65,535 — same reasoning as the terrain clipmap.
  const indices = new Uint16Array(quadCount * 6);
  let k = 0;
  for (let iz = 0; iz < WATER_RING_CELLS; iz++) {
    for (let ix = 0; ix < WATER_RING_CELLS; ix++) {
      if (insideHole(hole, ix, iz)) continue;
      const a = iz * SIDE + ix;
      const b = a + 1;
      const c = a + SIDE;
      const d = c + 1;
      // Same winding as the terrain clipmap: Babylon is left-handed, and the
      // reverse order would back-face cull the water into nothing.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }

  return { positions, indices, normals, bedDepth, uvs, oceanMorph, oceanCoarse };
}

/**
 * The box a ring's water can be drawn in, or null when it has none. Its wet
 * cells are the triangles it draws with a wet vertex (`bedDepth > 0`); outside
 * the bed texture the fragment's depth is `bedDepth` interpolated, so such a
 * triangle draws water up to its dry corners, and the box holds all three of
 * its vertices. Given the ring's ground heights (`WaterRingSamples.h`, not
 * held to the level) and a lift, a vertex is wet where its ground is below
 * the level plus the lift instead: the sea's swash climbs the cove's face
 * (`SWASH_FACE_LIFT_M`), so a ring covering only the face is still drawn.
 * Given a span of z, `[z0, z1]`, the lift is a vertex's only where its z is
 * within it (the cove's, with its ends' blends): elsewhere along the coast
 * the ground must be below the level itself. Without them, as on a lift of 0,
 * the rule is the depth's. Triangles in the
 * hole are not drawn, so they count for nothing. The box is grown by `OCEAN_BOUND` on every side, since the waves
 * carry the surface off the plane: up and down from the water level, and
 * across. Across, it is grown by the stitch's reach as well: the vertex stage
 * moves each vertex to p - `oceanMorph` * `oceanCoarse` before the waves, up to
 * a cell of the ring (the largest component of `oceanCoarse`) along either
 * axis and outward as well as in, so a wet triangle's dry corner may be drawn
 * that far past its place. Null makes the ring's mesh disabled: a plane at the
 * level is in view from almost anywhere, and a mesh in view is what asks for
 * the high tier's copy.
 */
export function wetBounds(
  geometry: WaterGeometry,
  ground: Float32Array | null = null,
  lift = 0,
  liftZ: readonly [number, number] | null = null,
): { min: [number, number, number]; max: [number, number, number] } | null {
  const { positions, indices, bedDepth, oceanCoarse } = geometry;
  // How far the stitch moves a vertex along an axis, at most: a cell of the
  // ring on rings 0 to 5, nothing on the outermost.
  let reach = 0;
  for (let i = 0; i < oceanCoarse.length; i++) reach = Math.max(reach, Math.abs(oceanCoarse[i] as number));
  const across = OCEAN_BOUND + reach;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let y = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] as number;
    const b = indices[t + 1] as number;
    const c = indices[t + 2] as number;
    if (ground === null) {
      if ((bedDepth[a] as number) <= 0 && (bedDepth[b] as number) <= 0 && (bedDepth[c] as number) <= 0) continue;
    } else {
      // every vertex is at the level: the ground below the level, plus the lift within its span, is wet
      const level = positions[a * 3 + 1] as number;
      let wet = false;
      for (const v of [a, b, c]) {
        const z = positions[v * 3 + 2] as number;
        const lifted = liftZ === null || (z >= liftZ[0] && z <= liftZ[1]) ? lift : 0;
        if ((ground[v] as number) < level + lifted) wet = true;
      }
      if (!wet) continue;
    }
    for (const v of [a, b, c]) {
      const x = positions[v * 3] as number;
      const z = positions[v * 3 + 2] as number;
      y = positions[v * 3 + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (minX === Infinity) return null;
  return {
    min: [minX - across, y - OCEAN_BOUND, minZ - across],
    max: [maxX + across, y + OCEAN_BOUND, maxZ + across],
  };
}
