import type { Brush } from "./level.js";
import { CHUNK_SIZE, HEIGHT_QUANTUM, TERRAIN_CELL } from "./forestConstants.js";

export const CELLS_PER_CHUNK = CHUNK_SIZE / TERRAIN_CELL;

export type Chunk = {
  cx: number;
  cz: number;
  /**
   * Column top heights in HEIGHT_QUANTUM units, row-major by (iz, ix).
   *
   * No longer a collision surface. Collision reads the continuous elevation
   * field directly (`ground.ts`) — these quantized columns *were* the ground
   * the player walked on, and the mismatch between them and the field the
   * renderer draws is what made walking feel jagged. What they still are is the
   * generation digest: `forest.ts` hashes them into the level id, so a retuned
   * elevation pass refuses peers still running the old one.
   */
  columns: Int16Array;
  /**
   * Whatever feature passes emit, in generation order — which the ordered pass
   * registry makes canonical. The old forest generator's prop passes (ids 2-5)
   * are retired; the first of the new passes is `passes/trees.ts` (id 6),
   * which fills this with trunk collision brushes.
   *
   * `Brush`, not `Aabb`: the renderer needs to tell a trunk from a boulder to
   * colour it, and `Brush` is the existing `{ box, material }` pair that
   * `game/renderer.ts` already keys `MATERIAL_COLORS` on.
   */
  props: Brush[];
};

export type Pass = {
  /** Never reused and never renumbered: this is the identity of an RNG stream. */
  id: number;
  name: string;
  /**
   * Every constant that steers what this pass emits, by name.
   *
   * Folded into the level id, so retuning one refuses peers still running the old
   * value instead of letting them disagree about the world in silence. Declared
   * rather than inferred because the alternative — noticing the change in a sample
   * of the terrain a pass produces — provably misses thresholds on rare features: measured
   * on the retired ramp pass, whose gate rolled only at plateau edges, a 0.16 to
   * 0.17 change flipped none of the 93 rolls in the probe region. See `forest.ts`.
   *
   * Add to this whenever you add a constant. What is left out is not covered here,
   * only by whatever trace it happens to leave in the geometry digest.
   */
  tunables: Readonly<Record<string, number>>;
  run(chunk: Chunk, worldSeed: number): void;
};

/** Rounds metres to a whole number of HEIGHT_QUANTUM units. */
export function quantize(metres: number): number {
  return Math.round(metres / HEIGHT_QUANTUM);
}

/** World coordinate of a cell's centre, where its column is sampled. */
export function cellCenter(chunk: Chunk, ix: number, iz: number): { x: number; z: number } {
  return {
    x: chunk.cx * CHUNK_SIZE + ix * TERRAIN_CELL + TERRAIN_CELL / 2,
    z: chunk.cz * CHUNK_SIZE + iz * TERRAIN_CELL + TERRAIN_CELL / 2,
  };
}

/** Kept sorted by id, so generation order is a property of the registry. */
const PASSES: Pass[] = [];

export function registerPass(pass: Pass): void {
  if (PASSES.some((p) => p.id === pass.id)) {
    throw new Error(`pass id ${pass.id} is already registered`);
  }
  PASSES.push(pass);
  PASSES.sort((a, b) => a.id - b.id);
}

export function registeredPasses(): readonly Pass[] {
  return PASSES;
}

/**
 * Generates a chunk using an explicit pass list rather than the registry.
 *
 * The seam exists for `forest.ts`'s coverage check, which proves its probe region
 * actually exercises every pass by generating the probe with one pass removed and
 * requiring the result to differ. Without a way to run a subset, that check would
 * have to trust the probe instead of testing it.
 */
export function generateChunkWith(
  passes: readonly Pass[],
  worldSeed: number,
  cx: number,
  cz: number,
): Chunk {
  const chunk: Chunk = {
    cx,
    cz,
    columns: new Int16Array(CELLS_PER_CHUNK * CELLS_PER_CHUNK),
    props: [],
  };
  for (const pass of passes) pass.run(chunk, worldSeed);
  return chunk;
}

export function generateChunk(worldSeed: number, cx: number, cz: number): Chunk {
  return generateChunkWith(PASSES, worldSeed, cx, cz);
}
