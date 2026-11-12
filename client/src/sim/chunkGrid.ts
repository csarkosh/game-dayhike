import type { Vec3 } from "./types.js";
import type { Aabb } from "./level.js";
import type { BoxSource } from "./boxSource.js";
import { CELLS_PER_CHUNK, generateChunk, type Chunk } from "./chunk.js";
import { CHUNK_SIZE } from "./forestConstants.js";
import { activeTerrainVariantName } from "./terrain.js";

export type ChunkGrid = BoxSource & {
  chunkAt(cx: number, cz: number): Chunk;
  generatedCount(): number;
  /**
   * Materializes every box in a chunk range into a fresh array. For tests and
   * benchmarks — unlike `near`, the array is the caller's and survives the next
   * query. The boxes in it are still chunk-owned references, which is safe
   * because nothing ever mutates a prop box.
   */
  allBoxesIn(minCx: number, minCz: number, maxCx: number, maxCz: number): Aabb[];
};

/** Chunks made elsewhere, waiting for the next grid of their seed on their terrain; one install at a time. */
let installed: { seed: number; variant: string; chunks: readonly Chunk[] } | null = null;

function isChunk(c: unknown): c is Chunk {
  if (c === null || typeof c !== "object") return false;
  const { cx, cz, columns, props } = c as Partial<Chunk>;
  return Number.isInteger(cx) && Number.isInteger(cz)
    && columns instanceof Int16Array && columns.length === CELLS_PER_CHUNK * CELLS_PER_CHUNK
    && Array.isArray(props);
}

/**
 * Chunks made elsewhere for `seed` on the terrain `variant` (another thread
 * running `generateChunk`, which is a pure function of the seed and the cell):
 * the next grid made for that seed while that terrain is active starts with
 * them and generates only the rest, and the install is used by that one grid.
 * It replaces any install still waiting. Refused whole (false) unless every
 * chunk has integer `cx` and `cz`, the columns `generateChunk` makes and an
 * array of props; a refusal leaves nothing waiting.
 */
export function installChunks(seed: number, variant: string, chunks: readonly Chunk[]): boolean {
  installed = null;
  if (!Array.isArray(chunks) || !chunks.every(isChunk)) return false;
  installed = { seed, variant, chunks };
  return true;
}

/**
 * A `BoxSource` over lazily generated chunks.
 *
 * This is both the chunk store and the broadphase, because chunks already are a
 * spatial partition — building a separate spatial index alongside them would be
 * two structures maintaining the same information.
 *
 * Chunks are never evicted. That is deliberate for this milestone: memory grows
 * with distance travelled, and fixing it belongs with prefetching in the
 * streaming work rather than here.
 */
export function createChunkGrid(worldSeed: number): ChunkGrid {
  const chunks = new Map<string, Chunk>();
  // What another thread made of this world ahead (`installChunks`), taken once.
  if (installed !== null && installed.seed === worldSeed && installed.variant === activeTerrainVariantName()) {
    for (const c of installed.chunks) chunks.set(`${c.cx},${c.cz}`, c);
    installed = null;
  }

  /**
   * Reused across queries so that answering one costs no allocation. Callers
   * must iterate immediately and never retain it — `boxSource.ts` states the
   * contract and `chunkGrid.test.ts` asserts it.
   */
  const scratch: Aabb[] = [];

  function chunkAt(cx: number, cz: number): Chunk {
    const key = `${cx},${cz}`;
    let c = chunks.get(key);
    if (c === undefined) {
      c = generateChunk(worldSeed, cx, cz);
      chunks.set(key, c);
    }
    return c;
  }

  /**
   * Appends one chunk's props overlapping the region, in generation order,
   * which the id-sorted pass registry makes canonical.
   *
   * Props only. The ground is not a box source at all: it is the continuous
   * elevation field, collided against analytically in `ground.ts`. It used to
   * be emitted here as a lattice of flat-topped 1 m columns quantized to
   * HEIGHT_QUANTUM, and that is exactly why walking felt jagged — the renderer
   * drew the smooth field while the player walked a staircase, stepping off a
   * column edge and landing again about five times a second. `ground.ts`
   * carries the measurements.
   *
   * Boxes are pushed by reference: they are owned by the chunk and never
   * mutated, so no copy or pooling is needed on either path.
   */
  function collect(chunk: Chunk, min: Vec3, max: Vec3, out: Aabb[]): void {
    for (const { box } of chunk.props) {
      if (box.max.x < min.x || box.min.x > max.x) continue;
      if (box.max.y < min.y || box.min.y > max.y) continue;
      if (box.max.z < min.z || box.min.z > max.z) continue;
      out.push(box);
    }
  }

  function near(min: Vec3, max: Vec3): readonly Aabb[] {
    scratch.length = 0;

    const minCx = Math.floor(min.x / CHUNK_SIZE);
    const maxCx = Math.floor(max.x / CHUNK_SIZE);
    const minCz = Math.floor(min.z / CHUNK_SIZE);
    const maxCz = Math.floor(max.z / CHUNK_SIZE);

    // Canonical (cx, cz) ascending — never visit order. Peers load chunks in
    // whatever order they walked, and `sweepBox` breaks ties on iteration order,
    // so leaking history into ordering would let two players resolve the same
    // sweep against different surfaces.
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        collect(chunkAt(cx, cz), min, max, scratch);
      }
    }
    return scratch;
  }

  function allBoxesIn(minCx: number, minCz: number, maxCx: number, maxCz: number): Aabb[] {
    const out: Aabb[] = [];
    const min: Vec3 = { x: minCx * CHUNK_SIZE, y: -Infinity, z: minCz * CHUNK_SIZE };
    const max: Vec3 = { x: (maxCx + 1) * CHUNK_SIZE, y: Infinity, z: (maxCz + 1) * CHUNK_SIZE };
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        collect(chunkAt(cx, cz), min, max, out);
      }
    }
    return out;
  }

  return { near, chunkAt, generatedCount: () => chunks.size, allBoxesIn };
}
