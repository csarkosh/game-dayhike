/**
 * The sea's seven rings as one lattice that never changes, with no engine.
 *
 * `water.ts` makes a ring's geometry again each time the ring moves: every
 * vertex's place, its depth of water, its stitch to the coarser ring, and
 * the triangles round the hole the finer ring fills. All of it but the depth
 * is arithmetic on three things: which ring a vertex is of, its column and
 * row in that ring, and where the ring and its hole stand. So a renderer
 * that places its vertices in the vertex stage can hold the seven rings as
 * one mesh made once (`seaLattice`), hand the stage each ring's origin and
 * hole a frame (`seaRingRecords`), and send, when a ring moves, only the
 * depths under its vertices (`seaBedDepths`). `seaVertexAt` is that stage's
 * arithmetic here, which the tests hold to `waterRingGeometry` vertex for
 * vertex.
 *
 * **A vertex is its place in its ring's lattice**: its column in x, its row
 * in z, and its ring in y.
 *
 * **The hole.** A ring's hole is the finer ring's footprint: 64 of its cells
 * a side, its least corner at column and row 32 or 33 as the two rings'
 * origins snap (`snapOrigin`). The 63 by 63 cells every such hole covers are
 * left out of the triangles. The frame of 256 cells round them, which a hole
 * covers or not as it stands, are drawn with four vertices of their own each,
 * which carry their cell's column and row in their texture coordinate (the
 * shared vertices carry -1): the vertex stage draws a cell the hole covers
 * as nothing. The triangles keep the order `waterRingGeometry` gives them,
 * row by row, so what is drawn over what within a ring is the same.
 *
 * **The rings are laid outermost first**, so the far water is drawn before
 * the near.
 *
 * `seaWetBounds` is `wetBounds` of a ring's geometry, read from the ring's
 * samples without making the geometry. `seaWetRun` is the run of the
 * lattice's triangles a draw is held to so that no ring past the wet ones
 * is drawn.
 */
import { HOLE_CELLS, blendWeight } from "./clipmap.js";
import { OCEAN_BOUND, WATER_RING_CELLS, WATER_RING_COUNT, WATER_UV_SCALE, waterHoleCellsFor, waterRingSpacing, type WaterRingSamples } from "./water.js";

/** Vertices a side of a ring. */
export const SEA_SIDE = WATER_RING_CELLS + 1;
/** The least column and row a hole's least corner takes; the greatest is one more. */
export const SEA_HOLE_LOW = WATER_RING_CELLS / 4;
/** The floats of `seaRingRecords` a ring: its origin (x, z) and its hole's least corner (column, row). */
export const SEA_RING_FLOATS = 4;

/** Whether cell (cx, cz) lies in every hole a ring can have. */
function alwaysHole(cx: number, cz: number): boolean {
  const lo = SEA_HOLE_LOW + 1;
  const hi = SEA_HOLE_LOW + HOLE_CELLS;
  return cx >= lo && cx < hi && cz >= lo && cz < hi;
}

/** Whether cell (cx, cz) lies in some hole a ring can have, and not in every one: the frame. */
function inFrame(cx: number, cz: number): boolean {
  const lo = SEA_HOLE_LOW;
  const hi = SEA_HOLE_LOW + HOLE_CELLS + 1;
  return cx >= lo && cx < hi && cz >= lo && cz < hi && !alwaysHole(cx, cz);
}

/** Where a ring's vertices and triangles lie in the lattice's arrays. */
export type SeaRingRange = { level: number; firstVertex: number; vertexCount: number; firstIndex: number; indexCount: number };

export type SeaLattice = {
  /** (column, ring, row) a vertex. */
  positions: Float32Array;
  /** (0, 1, 0) a vertex. */
  normals: Float32Array;
  /** A frame cell's (column, row) on its four vertices; (-1, -1) on a vertex cells share. */
  uvs: Float32Array;
  indices: Uint32Array;
  /** The rings' ranges, in the order they are laid: outermost first. */
  rings: SeaRingRange[];
};

/** The lattice: made once, the same for every world. */
export function seaLattice(): SeaLattice {
  const frameCells = (HOLE_CELLS + 1) * (HOLE_CELLS + 1) - (HOLE_CELLS - 1) * (HOLE_CELLS - 1);
  const holed = WATER_RING_COUNT - 1;
  const vertexCount = WATER_RING_COUNT * SEA_SIDE * SEA_SIDE + holed * frameCells * 4;
  const cells = WATER_RING_CELLS * WATER_RING_CELLS;
  const indexCount = (cells + holed * (cells - (HOLE_CELLS - 1) * (HOLE_CELLS - 1))) * 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  const rings: SeaRingRange[] = [];
  let v = 0;
  let k = 0;
  const put = (ix: number, level: number, iz: number, cx: number, cz: number): number => {
    positions[v * 3] = ix;
    positions[v * 3 + 1] = level;
    positions[v * 3 + 2] = iz;
    normals[v * 3 + 1] = 1;
    uvs[v * 2] = cx;
    uvs[v * 2 + 1] = cz;
    return v++;
  };
  for (let level = WATER_RING_COUNT - 1; level >= 0; level--) {
    const firstVertex = v;
    const firstIndex = k;
    for (let iz = 0; iz < SEA_SIDE; iz++) for (let ix = 0; ix < SEA_SIDE; ix++) put(ix, level, iz, -1, -1);
    for (let iz = 0; iz < WATER_RING_CELLS; iz++) {
      for (let ix = 0; ix < WATER_RING_CELLS; ix++) {
        if (level > 0 && alwaysHole(ix, iz)) continue;
        let a = firstVertex + iz * SEA_SIDE + ix;
        let b = a + 1;
        let c = a + SEA_SIDE;
        let d = c + 1;
        if (level > 0 && inFrame(ix, iz)) {
          a = put(ix, level, iz, ix, iz);
          b = put(ix + 1, level, iz, ix, iz);
          c = put(ix, level, iz + 1, ix, iz);
          d = put(ix + 1, level, iz + 1, ix, iz);
        }
        // The winding `waterRingGeometry` gives a cell's two triangles.
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = c;
      }
    }
    rings.push({ level, firstVertex, vertexCount: v - firstVertex, firstIndex, indexCount: k - firstIndex });
  }
  return { positions, normals, uvs, indices, rings };
}

/**
 * The run of the lattice's triangles that holds every ring `wet` says has
 * water, into `out`: the first index and the one past the last, from the
 * first such ring laid to the last, the rings between them with it. The
 * rings are laid outermost first, so far from the coast the run is the
 * coarse rings alone, and at the cove's head the fine ones. With no wet
 * ring `end` is 0 and the run is empty.
 */
export function seaWetRun(rings: readonly SeaRingRange[], wet: (level: number) => boolean, out: { first: number; end: number }): { first: number; end: number } {
  let first = Infinity;
  let end = 0;
  for (const ring of rings) {
    if (!wet(ring.level)) continue;
    first = Math.min(first, ring.firstIndex);
    end = Math.max(end, ring.firstIndex + ring.indexCount);
  }
  out.first = end > 0 ? first : 0;
  out.end = end;
  return out;
}

/**
 * Each ring's record into `out` (`SEA_RING_FLOATS` a ring, by level): its
 * origin and its hole's least corner in its own cells. The finest ring has
 * no hole and is given (0, 0), which nothing reads.
 */
export function seaRingRecords(rings: readonly WaterRingSamples[], out: Float32Array): Float32Array {
  for (let level = 0; level < rings.length; level++) {
    const ring = rings[level] as WaterRingSamples;
    const hole = level > 0 ? waterHoleCellsFor(ring, rings[level - 1] as WaterRingSamples) : null;
    out[level * SEA_RING_FLOATS] = ring.originX;
    out[level * SEA_RING_FLOATS + 1] = ring.originZ;
    out[level * SEA_RING_FLOATS + 2] = hole?.x0 ?? 0;
    out[level * SEA_RING_FLOATS + 3] = hole?.z0 ?? 0;
  }
  return out;
}

/** The depth of water under each of a ring's vertices into `out` (`SEA_SIDE`² floats, row by row): `waterRingGeometry`'s `bedDepth`. */
export function seaBedDepths(ring: WaterRingSamples, waterLevel: number, out: Float32Array): Float32Array {
  const h = ring.h;
  for (let i = 0; i < h.length; i++) out[i] = Math.max(0, waterLevel - (h[i] as number));
  return out;
}

/** A lattice vertex as the vertex stage places it, before the waves. */
export type SeaVertex = {
  /** Its place on its ring's lattice, world metres. */
  latticeX: number;
  latticeZ: number;
  /** The border blend and the half-edge to the coarser lattice (`oceanMorph`, `oceanCoarse`). */
  morph: number;
  coarseX: number;
  coarseZ: number;
  /** The ripple bump's coordinate. */
  u: number;
  v: number;
  /** Whether the vertex is of a frame cell the hole covers: drawn as nothing. */
  covered: boolean;
};

/**
 * The vertex at (column, ring, row) with texture coordinate (cellX, cellZ),
 * under the rings' `records`: the vertex stage's arithmetic, into `out`.
 */
export function seaVertexAt(ix: number, level: number, iz: number, cellX: number, cellZ: number, records: Float32Array, out: SeaVertex): SeaVertex {
  const at = level * SEA_RING_FLOATS;
  const spacing = waterRingSpacing(level);
  const holeX = records[at + 2] as number;
  const holeZ = records[at + 3] as number;
  out.latticeX = (records[at] as number) + ix * spacing;
  out.latticeZ = (records[at + 1] as number) + iz * spacing;
  out.morph = 0;
  out.coarseX = 0;
  out.coarseZ = 0;
  if (level < WATER_RING_COUNT - 1) {
    out.morph = blendWeight(level > 0 ? { x0: holeX, z0: holeZ } : null, ix, iz);
    const oddX = (ix & 1) === 1;
    const oddZ = (iz & 1) === 1;
    out.coarseX = oddX ? spacing : 0;
    out.coarseZ = oddZ ? (oddX ? -spacing : spacing) : 0;
  }
  out.u = out.latticeX / WATER_UV_SCALE;
  out.v = out.latticeZ / WATER_UV_SCALE;
  out.covered = level > 0 && cellX >= 0 && cellX >= holeX && cellX < holeX + HOLE_CELLS && cellZ >= holeZ && cellZ < holeZ + HOLE_CELLS;
  return out;
}

/**
 * The box a ring's water can be drawn in, or null when it has none:
 * `wetBounds` of the ring's geometry with its ground, the swash's `lift`
 * and the span of z the lift counts over, read from the ring's samples and
 * its `hole` (null on the finest ring). `wet` is scratch of `SEA_SIDE`²
 * bytes.
 */
export function seaWetBounds(
  ring: WaterRingSamples, hole: { x0: number; z0: number } | null, waterLevel: number, lift: number, liftZ: readonly [number, number], wet: Uint8Array,
): { min: [number, number, number]; max: [number, number, number] } | null {
  // The geometry's level is a 32-bit float, and its box is measured from it.
  const level = Math.fround(waterLevel);
  const s = ring.spacing;
  const h = ring.h;
  for (let iz = 0; iz < SEA_SIDE; iz++) {
    const z = ring.originZ + iz * s;
    const lifted = z >= liftZ[0] && z <= liftZ[1] ? lift : 0;
    for (let ix = 0; ix < SEA_SIDE; ix++) wet[iz * SEA_SIDE + ix] = (h[iz * SEA_SIDE + ix] as number) < level + lifted ? 1 : 0;
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let iz = 0; iz < WATER_RING_CELLS; iz++) {
    for (let ix = 0; ix < WATER_RING_CELLS; ix++) {
      if (hole !== null && ix >= hole.x0 && ix < hole.x0 + HOLE_CELLS && iz >= hole.z0 && iz < hole.z0 + HOLE_CELLS) continue;
      const a = iz * SEA_SIDE + ix;
      const wa = wet[a] as number;
      const wb = wet[a + 1] as number;
      const wc = wet[a + SEA_SIDE] as number;
      const wd = wet[a + SEA_SIDE + 1] as number;
      // The cell's two triangles, (a, b, c) and (b, d, c), both hold b at (ix + 1, iz) and c at (ix, iz + 1): a wet
      // one spans the cell on both axes, so the box takes the whole cell.
      if (wa + wb + wc + wd === 0) continue;
      if (ix < minX) minX = ix;
      if (ix + 1 > maxX) maxX = ix + 1;
      if (iz < minZ) minZ = iz;
      if (iz + 1 > maxZ) maxZ = iz + 1;
    }
  }
  if (minX === Infinity) return null;
  // How far the stitch moves a vertex along an axis, at most: a cell on every ring but the outermost.
  const across = OCEAN_BOUND + (ring.level < WATER_RING_COUNT - 1 ? s : 0);
  return {
    min: [ring.originX + minX * s - across, level - OCEAN_BOUND, ring.originZ + minZ * s - across],
    max: [ring.originX + maxX * s + across, level + OCEAN_BOUND, ring.originZ + maxZ * s + across],
  };
}
