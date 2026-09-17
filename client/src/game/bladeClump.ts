import { clamp01, type Rgb } from "./colour.js";
import { latticeHash } from "./groundHexParams.js";

/**
 * The blade clump: the mesh the meadow class draws inside BLADE_RADIUS
 * (clutterField.ts) in place of its card, built here from constants and a
 * lattice hash so it needs no asset and every value can be retuned in one
 * place. Babylon-free: the shell (clutterMeshes.ts) wraps the arrays in a
 * mesh, and the tests read them directly.
 *
 * A blade is a strip of BLADE_RINGS cross-sections plus one tip vertex, its
 * root on a disc of BLADE_CLUMP_RADIUS at y = 0 (the model convention: origin
 * at the base). It drooping outward as a parabola, tapers to the tip, and
 * carries its face normal rolled to either side so it shades as a
 * half-cylinder. One static vec4 per vertex, `blade`, names the root the
 * blade collapses to, the blade's random (its place in the thinning order)
 * and the vertex's fraction of its own blade's height.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 */

export const BLADE_COUNT = 24;
/** Cross-sections below the tip. */
export const BLADE_RINGS = 4;
export const BLADE_VERTS = BLADE_RINGS * 2 + 1;
export const BLADE_TRIS = (BLADE_RINGS - 1) * 2 + 1;
/** Roots lie on a disc of this radius (m). */
export const BLADE_CLUMP_RADIUS = 0.3;
/** A blade's height (m) by its random. */
export const BLADE_HEIGHT: readonly [number, number] = [0.35, 0.6];
/** Half-width (m) at the root; the strip tapers linearly to the tip. */
export const BLADE_WIDTH = 0.02;
/** Outward lean (rad) applied as a parabola of the height fraction. */
export const BLADE_DROOP: readonly [number, number] = [0.1, 0.5];
/** The face normal is rolled this far (rad) about the blade's axis, one way per side. */
export const BLADE_ROUND = 0.5;
/** Vertex colour at the tip, from white at the root. */
export const BLADE_TIP_TINT: Rgb = { r: 1.05, g: 1.0, b: 0.8 };
/** Per-blade luminance spread: `1 + BLADE_LUMA · (random − 0.5)`. */
export const BLADE_LUMA = 0.2;
/** Width of one blade's shrink window in units of the thinning ramp;
 * FOLIAGE_BLADE_SOFT in the GLSL. */
export const BLADE_SOFT = 0.15;

export type BladeClumpGeometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
  /** (rootX, rootZ, random, heightFraction) per vertex. */
  blade: Float32Array;
};

/** One of a blade's draws: the lattice hash on (blade index, salt). */
function draw(i: number, salt: number): number {
  return latticeHash(i, salt);
}

export function bladeClumpGeometry(): BladeClumpGeometry {
  const n = BLADE_COUNT * BLADE_VERTS;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  const blade = new Float32Array(n * 4);
  const indices = new Uint16Array(BLADE_COUNT * BLADE_TRIS * 3);
  let ii = 0;
  for (let b = 0; b < BLADE_COUNT; b++) {
    const random = draw(b, 1);
    const rho = BLADE_CLUMP_RADIUS * Math.sqrt(draw(b, 2));
    const phi = 2 * Math.PI * draw(b, 3);
    const rootX = rho * Math.cos(phi);
    const rootZ = rho * Math.sin(phi);
    const height = BLADE_HEIGHT[0] + (BLADE_HEIGHT[1] - BLADE_HEIGHT[0]) * draw(b, 4);
    const droop = BLADE_DROOP[0] + (BLADE_DROOP[1] - BLADE_DROOP[0]) * draw(b, 5);
    const yaw = 2 * Math.PI * draw(b, 6);
    // Outward from the clump centre through the root; the yaw when the root is at the centre.
    const outX = rho > 1e-6 ? Math.cos(phi) : Math.cos(yaw);
    const outZ = rho > 1e-6 ? Math.sin(phi) : Math.sin(yaw);
    // The strip's width direction and its face normal, perpendicular in XZ.
    const wX = Math.cos(yaw), wZ = Math.sin(yaw);
    const nX = -wZ, nZ = wX;
    const luma = 1 + BLADE_LUMA * (random - 0.5);
    const v0 = b * BLADE_VERTS;
    const write = (v: number, h: number, side: number): void => {
      const cx = rootX + outX * height * droop * h * h;
      const cy = height * h;
      const cz = rootZ + outZ * height * droop * h * h;
      const hw = BLADE_WIDTH * (1 - h);
      positions[v * 3] = cx + wX * hw * side;
      positions[v * 3 + 1] = cy;
      positions[v * 3 + 2] = cz + wZ * hw * side;
      const c = Math.cos(BLADE_ROUND * side), s = Math.sin(BLADE_ROUND * side);
      normals[v * 3] = c * nX + s * wX;
      normals[v * 3 + 1] = 0;
      normals[v * 3 + 2] = c * nZ + s * wZ;
      colors[v * 4] = luma * (1 + (BLADE_TIP_TINT.r - 1) * h);
      colors[v * 4 + 1] = luma * (1 + (BLADE_TIP_TINT.g - 1) * h);
      colors[v * 4 + 2] = luma * (1 + (BLADE_TIP_TINT.b - 1) * h);
      colors[v * 4 + 3] = 1;
      blade[v * 4] = rootX;
      blade[v * 4 + 1] = rootZ;
      blade[v * 4 + 2] = random;
      blade[v * 4 + 3] = h;
    };
    for (let k = 0; k < BLADE_RINGS; k++) {
      write(v0 + 2 * k, k / BLADE_RINGS, -1);
      write(v0 + 2 * k + 1, k / BLADE_RINGS, 1);
    }
    const tip = v0 + BLADE_VERTS - 1;
    write(tip, 1, 0);
    for (let k = 0; k + 1 < BLADE_RINGS; k++) {
      const a = v0 + 2 * k;
      indices[ii++] = a; indices[ii++] = a + 2; indices[ii++] = a + 1;
      indices[ii++] = a + 1; indices[ii++] = a + 2; indices[ii++] = a + 3;
    }
    const last = v0 + 2 * (BLADE_RINGS - 1);
    indices[ii++] = last; indices[ii++] = tip; indices[ii++] = last + 1;
  }
  return { positions, normals, colors, indices, blade };
}

/**
 * How much of a blade with this `random` remains at thinning `thin` (0 at
 * the band's start, 1 at its end): 1 for every blade at 0, 0 for every blade
 * at 1, and in between each blade shrinks over a window BLADE_SOFT wide in
 * the order of its random. Mirrors the collapse in foliageWorldPos.vertex.fx
 * token for token.
 */
export function bladeAlive(random: number, thin: number): number {
  return clamp01((random - thin * (1 + BLADE_SOFT)) / BLADE_SOFT + 1);
}
