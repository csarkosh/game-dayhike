/**
 * Pure water-ring math: a clipmap of flat rings at the water level, mirroring
 * `clipmap.ts` but for the ocean surface. Each ring stores only the
 * TERRAIN height under each vertex — the water itself is flat — and write the
 * depth below the surface per vertex (`bedDepth`), the fragment stage's
 * fallback outside the bed height texture. Four rings at 8/16/32/64 m spacing cover 8,192 m in four
 * draw calls, within a budget of ≤ 4.
 *
 * Pure and Babylon-free; the water shell uploads the output.
 */
import { elevationAt } from "../sim/terrain.js";
import { HOLE_CELLS, snapOrigin } from "./clipmap.js";

/** Same cell count as the terrain clipmap's RING_CELLS, so `snapOrigin` and
 * `HOLE_CELLS` (both parameterised by spacing only beyond that count) can be
 * imported rather than re-derived. */
export const WATER_RING_CELLS = 128;
export const WATER_RING_COUNT = 4;
export const WATER_BASE_SPACING = 8;
/** Metres per bump-texture tile. */
export const WATER_UV_SCALE = 24;
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
 * Flat plane at `waterLevel` carrying the bed depth per vertex.
 * No border clamping (a flat plane cannot crack) and no gradient normals —
 * every normal is (0, 1, 0); the bump texture supplies the ripple.
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

  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const at = iz * SIDE + ix;
      const x = ring.originX + ix * ring.spacing;
      const z = ring.originZ + iz * ring.spacing;
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

  return { positions, indices, normals, bedDepth, uvs };
}
