/**
 * The soft dark patch on the ground under the parked car.
 *
 * Little of the sky's light reaches the ground under a car, from any side,
 * at any hour and under any cloud, and a car drawn without that dark stands
 * on its ground like a cut-out. The sun's own shadow does not make it: it is
 * cast to one side, it is gone under cloud and at night, and the low tier
 * casts none at all. So the dark is laid here, the same on every tier: a
 * patch that is darkest under the body and fades out a little way past it.
 *
 * Pure: the shape, the texture's bytes and the grid's corners. The mesh and
 * its material are `trailheadMeshes.ts`'s.
 */
import { CAR_HALF } from "../sim/trailhead.js";

/** How far inside the body's footprint the patch is still at its darkest (m). */
export const CAR_SHADOW_CORE = 0.3;
/** How far past the footprint the patch reaches before it is gone (m). */
export const CAR_SHADOW_REACH = 0.7;
/**
 * The share of the ground's light the patch takes where it is darkest. It
 * is taken of the light itself, and the screen shows less of it: at 0.6 the
 * sand under the car's middle was 29 % darker on the screen, and past the
 * body's side the patch could not be told from the sand.
 */
export const CAR_SHADOW_DARK = 0.88;
/** The patch's half-size on the ground (m): the footprint and the reach past it. */
export const CAR_SHADOW_HALF = { x: CAR_HALF.x + CAR_SHADOW_REACH, z: CAR_HALF.z + CAR_SHADOW_REACH };
/** The texture laid across the patch: a texel is 5 cm by 4.7 cm of ground. */
export const CAR_SHADOW_TEX = { width: 64, height: 128 };
/** The longest side of a cell of the patch's grid (m). */
export const CAR_SHADOW_STEP = 0.5;
/** How far above the ground the patch is drawn (m). See `CAR_SHADOW_BIAS`. */
export const CAR_SHADOW_LIFT = 0.01;
/**
 * How far the patch is biased toward the eye, in the depth buffer's own
 * steps: what the board's paint is given (`BOARD_FACE_BIAS`), for the same
 * reason. A centimetre is the whole of what a depth can be told apart by
 * about 14 m from the eye, and the car is seen from further.
 */
export const CAR_SHADOW_BIAS = -120;

/**
 * How dark the patch is at a point, in metres from the car's centre along
 * the car's own sides: `CAR_SHADOW_DARK` over the core, then falling with
 * the distance from the core's edge, smoothly, to nothing at the reach. The
 * distance is to the core's rectangle, so the patch's corners are round.
 */
export function carShadowAt(dx: number, dz: number): number {
  const ox = Math.max(0, Math.abs(dx) - (CAR_HALF.x - CAR_SHADOW_CORE));
  const oz = Math.max(0, Math.abs(dz) - (CAR_HALF.z - CAR_SHADOW_CORE));
  const t = Math.sqrt(ox * ox + oz * oz) / (CAR_SHADOW_CORE + CAR_SHADOW_REACH);
  if (t >= 1) return 0;
  return CAR_SHADOW_DARK * (1 - t * t * (3 - 2 * t));
}

/**
 * The patch as a texture's bytes: white, with the darkness in its alpha,
 * each texel read at its own centre. Made in plain arithmetic, as the mist's
 * is (`mistAlphaMap`), so it needs no canvas.
 */
export function carShadowAlphaMap(): Uint8Array {
  const { width, height } = CAR_SHADOW_TEX;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const dz = ((y + 0.5) / height * 2 - 1) * CAR_SHADOW_HALF.z;
    for (let x = 0; x < width; x++) {
      const dx = ((x + 0.5) / width * 2 - 1) * CAR_SHADOW_HALF.x;
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(carShadowAt(dx, dz) * 255);
    }
  }
  return data;
}

export type CarShadowGrid = {
  /** Where the mesh is put: the car's place, on the ground there. */
  origin: { x: number; y: number; z: number };
  /** What the mesh is scaled by: the patch's half-size across and along. */
  scale: { x: number; y: number; z: number };
  /** About `origin`: across and along in the square's own units, -1 to 1, and up in metres. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
};

/** How many cells of `CAR_SHADOW_STEP` at most cover a length. */
function cellsOver(length: number): number {
  return Math.max(1, Math.ceil(length / CAR_SHADOW_STEP - 1e-9));
}

/**
 * The patch's grid: every corner on the ground under it, `CAR_SHADOW_LIFT`
 * above, with the texture laid across it once. The car's box is as wide one
 * way round as the other, so the patch is the same whichever way the car's
 * nose points.
 *
 * It is laid over a square two units to a side and scaled to the patch's
 * size by its mesh, and indexed in 16 bits. A shader is made for what its
 * mesh is as well as for its material, and a mesh scaled unevenly and
 * indexed in 16 bits is what each of the mist's banks is: so the patch is
 * drawn by the shader the mist is, stage for stage, and asks the page for
 * none of its own.
 */
export function carShadowGrid(site: { x: number; z: number }, groundH: (x: number, z: number) => number): CarShadowGrid {
  const nx = cellsOver(2 * CAR_SHADOW_HALF.x);
  const nz = cellsOver(2 * CAR_SHADOW_HALF.z);
  const origin = { x: site.x, y: groundH(site.x, site.z), z: site.z };
  const corners = (nx + 1) * (nz + 1);
  const positions = new Float32Array(corners * 3);
  const normals = new Float32Array(corners * 3);
  const uvs = new Float32Array(corners * 2);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const x = i / nx * 2 - 1;
      const z = j / nz * 2 - 1;
      positions[k * 3] = x;
      positions[k * 3 + 1] = groundH(site.x + x * CAR_SHADOW_HALF.x, site.z + z * CAR_SHADOW_HALF.z) + CAR_SHADOW_LIFT - origin.y;
      positions[k * 3 + 2] = z;
      normals[k * 3 + 1] = 1;
      uvs[k * 2] = i / nx;
      uvs[k * 2 + 1] = j / nz;
    }
  }
  const indices = new Uint16Array(nx * nz * 6);
  let n = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      indices[n++] = a; indices[n++] = c; indices[n++] = b;
      indices[n++] = b; indices[n++] = c; indices[n++] = d;
    }
  }
  return { origin, scale: { x: CAR_SHADOW_HALF.x, y: 1, z: CAR_SHADOW_HALF.z }, positions, normals, uvs, indices };
}
