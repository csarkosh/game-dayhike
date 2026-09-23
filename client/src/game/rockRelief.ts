import { latticeHash, valueNoise2 } from "./groundHexParams.js";

/**
 * Rock relief: cuts a rounded model into fractured, angular stone at load.
 * Seeded planes flatten caps into facets with sharp edges; the triangles are
 * unwelded so each shades by its own face normal; a small noise along the
 * input's vertex normal roughens the facets without opening a seam at a
 * shared edge; a per-facet luma is written as vertex colour. A cut only
 * removes material — nothing leaves the input hull — so the sim's collision
 * boxes for boulders stay right. Babylon-free: arrays in, arrays out.
 */

export const ROCK_PLANES = 10;
/** A plane's depth into the model, as a fraction of the half-extent along its normal. */
export const ROCK_DEPTH: readonly [number, number] = [0.08, 0.28];
/** A plane is skipped if its cap would take fewer than the first or more than the second share of the vertices. */
export const ROCK_CAP_SHARE: readonly [number, number] = [0.03, 0.35];
/** Roughening amplitude as a fraction of the half-extent; the model is shrunk by it first. */
export const ROCK_ROUGH = 0.02;
/** Wavelength (m) of the roughening noise, in the model's own units. */
export const ROCK_ROUGH_WAVE = 0.35;
/** Per-facet luma spread, ±. */
export const ROCK_LUMA = 0.08;
/** Cuts per model. */
export const ROCK_CUTS = 4;

export type RockArrays = { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; indices: Uint32Array | Uint16Array };
export type RockCut = { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; colors: Float32Array; indices: Uint32Array };
export type RockPlane = { nx: number; ny: number; nz: number; d: number };

function hash(model: number, cut: number, i: number, salt: number): number {
  return latticeHash(model * 977 + cut * 131 + i, salt * 173 + 7);
}

export function rockHalfExtent(positions: Float32Array): number {
  const n = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < n; v++) { cx += positions[v * 3]!; cy += positions[v * 3 + 1]!; cz += positions[v * 3 + 2]!; }
  cx /= n; cy /= n; cz /= n;
  let r = 0;
  for (let v = 0; v < n; v++) r = Math.max(r, Math.hypot(positions[v * 3]! - cx, positions[v * 3 + 1]! - cy, positions[v * 3 + 2]! - cz));
  return r;
}

/** The candidate planes for (model, cut): unit normals from the hash, offsets
 * `d = halfExtent · (1 − depth)`. LOD1 must receive LOD0's list, so the shell
 * calls this once per (model, cut) with LOD0's half-extent. */
export function rockPlanes(model: number, cut: number, halfExtent: number): RockPlane[] {
  const out: RockPlane[] = [];
  for (let i = 0; i < ROCK_PLANES; i++) {
    const u = hash(model, cut, i, 1), v = hash(model, cut, i, 2), w = hash(model, cut, i, 3);
    const z = 2 * u - 1, phi = 2 * Math.PI * v, rxy = Math.sqrt(Math.max(0, 1 - z * z));
    const depth = ROCK_DEPTH[0] + (ROCK_DEPTH[1] - ROCK_DEPTH[0]) * w;
    out.push({ nx: rxy * Math.cos(phi), ny: rxy * Math.sin(phi), nz: z, d: halfExtent * (1 - depth) });
  }
  return out;
}

export function rockRelief(input: RockArrays, planes: RockPlane[], model: number, cut: number): RockCut {
  const n = input.positions.length / 3;
  // Centre the work on the centroid so planes and the shrink are about the model's middle.
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < n; v++) { cx += input.positions[v * 3]!; cy += input.positions[v * 3 + 1]!; cz += input.positions[v * 3 + 2]!; }
  cx /= n; cy /= n; cz /= n;
  const he = rockHalfExtent(input.positions);
  const p = new Float32Array(n * 3);
  const shrink = 1 - ROCK_ROUGH;
  for (let v = 0; v < n; v++) {
    p[v * 3] = cx + (input.positions[v * 3]! - cx) * shrink;
    p[v * 3 + 1] = cy + (input.positions[v * 3 + 1]! - cy) * shrink;
    p[v * 3 + 2] = cz + (input.positions[v * 3 + 2]! - cz) * shrink;
  }
  // Planes, with the skip rule judged on the shrunk positions.
  for (const pl of planes) {
    let took = 0;
    for (let v = 0; v < n; v++) if ((p[v * 3]! - cx) * pl.nx + (p[v * 3 + 1]! - cy) * pl.ny + (p[v * 3 + 2]! - cz) * pl.nz > pl.d) took++;
    const share = took / n;
    if (share < ROCK_CAP_SHARE[0] || share > ROCK_CAP_SHARE[1]) continue;
    for (let v = 0; v < n; v++) {
      const s = (p[v * 3]! - cx) * pl.nx + (p[v * 3 + 1]! - cy) * pl.ny + (p[v * 3 + 2]! - cz) * pl.nz - pl.d;
      if (s > 0) { p[v * 3] = p[v * 3]! - s * pl.nx; p[v * 3 + 1] = p[v * 3 + 1]! - s * pl.ny; p[v * 3 + 2] = p[v * 3 + 2]! - s * pl.nz; }
    }
  }
  // Unweld, face normals, roughen, luma.
  const tris = input.indices.length / 3;
  const positions = new Float32Array(tris * 9), normals = new Float32Array(tris * 9), colors = new Float32Array(tris * 12);
  const uvs = input.uvs ? new Float32Array(tris * 6) : null;
  const indices = new Uint32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const i0 = input.indices[t * 3]!, i1 = input.indices[t * 3 + 1]!, i2 = input.indices[t * 3 + 2]!;
    const ax = p[i0 * 3]!, ay = p[i0 * 3 + 1]!, az = p[i0 * 3 + 2]!;
    const bx = p[i1 * 3]!, by = p[i1 * 3 + 1]!, bz = p[i1 * 3 + 2]!;
    const qx = p[i2 * 3]!, qy = p[i2 * 3 + 1]!, qz = p[i2 * 3 + 2]!;
    let fx = (by - ay) * (qz - az) - (bz - az) * (qy - ay);
    let fy = (bz - az) * (qx - ax) - (bx - ax) * (qz - az);
    let fz = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    const fl = Math.hypot(fx, fy, fz);
    if (fl > 1e-12) { fx /= fl; fy /= fl; fz /= fl; } else { fx = input.normals[i0 * 3]!; fy = input.normals[i0 * 3 + 1]!; fz = input.normals[i0 * 3 + 2]!; }
    const luma = 1 + ROCK_LUMA * (2 * hash(model, cut, t, 5) - 1);
    const src = [i0, i1, i2];
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k, s = src[k]!;
      // Roughening displaces along the INPUT's vertex normal, not this
      // triangle's face normal: two triangles sharing an edge have different
      // face normals, so moving each copy of a shared vertex along its own
      // face normal would pull the copies apart by the roughening amount and
      // open a crack. The vertex normal is identical on both sides of every
      // shared edge, so no crack can open by construction. The scalar itself
      // is keyed on the original (unshrunk) position so a shared edge's two
      // copies draw the same noise value too.
      const ox = input.positions[s * 3]!, oy = input.positions[s * 3 + 1]!, oz = input.positions[s * 3 + 2]!;
      const vnx = input.normals[s * 3]!, vny = input.normals[s * 3 + 1]!, vnz = input.normals[s * 3 + 2]!;
      const r = ROCK_ROUGH * he * (2 * valueNoise2(ox / ROCK_ROUGH_WAVE + oy * 0.37, oz / ROCK_ROUGH_WAVE + oy * 0.61, 1 + model * 4 + cut) - 1);
      positions[v * 3] = p[s * 3]! + vnx * r; positions[v * 3 + 1] = p[s * 3 + 1]! + vny * r; positions[v * 3 + 2] = p[s * 3 + 2]! + vnz * r;
      normals[v * 3] = fx; normals[v * 3 + 1] = fy; normals[v * 3 + 2] = fz;
      colors[v * 4] = luma; colors[v * 4 + 1] = luma; colors[v * 4 + 2] = luma; colors[v * 4 + 3] = 1;
      if (uvs && input.uvs) { uvs[v * 2] = input.uvs[s * 2]!; uvs[v * 2 + 1] = input.uvs[s * 2 + 1]!; }
      indices[v] = v;
    }
  }
  return { positions, normals, uvs, colors, indices };
}
