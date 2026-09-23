import { latticeHash, valueNoise2 } from "./groundHexParams.js";

/**
 * Rock relief: cuts a rounded model into fractured, angular stone at load.
 * Seeded planes flatten caps into facets with sharp edges; the triangles are
 * unwelded so each shades by its own face normal; a small inward noise along
 * the input's vertex normal roughens the facets without opening a seam at a
 * shared edge; a per-facet luma is written as vertex colour. A cut only
 * removes material — no output vertex ends up farther from the model's
 * centroid than the input vertex it came from — so the sim's collision boxes
 * for boulders stay right. Babylon-free: arrays in, arrays out.
 */

export const ROCK_PLANES = 10;
/** A plane's depth into the model, as a fraction of the model's own reach in
 * that plane's direction (see `rockPlanes`). */
export const ROCK_DEPTH: readonly [number, number] = [0.08, 0.28];
/** A candidate plane is dropped if its cap would take fewer than the first or
 * more than the second share of the vertices. */
export const ROCK_CAP_SHARE: readonly [number, number] = [0.02, 0.35];
/** Roughening amplitude, as a fraction of each vertex's own distance from the
 * centroid. The displacement is INWARD only, so no vertex can finish farther
 * from the centroid than it started and the model keeps its full reach where
 * the noise is quiet. */
export const ROCK_ROUGH = 0.02;
/** Wavelength (m) of the roughening noise, in the model's own units. */
export const ROCK_ROUGH_WAVE = 0.35;
/** Per-facet luma spread, ±. */
export const ROCK_LUMA = 0.08;
/** Cuts per model. */
export const ROCK_CUTS = 4;

export type RockArrays = { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; indices: Uint32Array | Uint16Array };
export type RockCut = { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; colors: Float32Array; indices: Uint32Array };
/** A cutting plane in the model's own space: everything in the half-space
 * `p·n > d` is projected onto the plane. `d` is an absolute offset from the
 * model's origin, not from its centroid, so one list cuts every LOD of a
 * model identically however their centroids differ. */
export type RockPlane = { nx: number; ny: number; nz: number; d: number };

function hash(model: number, cut: number, i: number, salt: number): number {
  return latticeHash(model * 977 + cut * 131 + i, salt * 173 + 7);
}

/** The mean of the input vertices — the centre the depths, the roughening
 * scale and the "only removes material" bound are all measured from. */
function centroidOf(positions: Float32Array): [number, number, number] {
  const n = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < n; v++) { cx += positions[v * 3]!; cy += positions[v * 3 + 1]!; cz += positions[v * 3 + 2]!; }
  return [cx / n, cy / n, cz / n];
}

/** How many of `positions` the plane would flatten, as a share of all of them. */
function capShare(positions: Float32Array, plane: RockPlane): number {
  const n = positions.length / 3;
  let took = 0;
  for (let v = 0; v < n; v++) {
    if (positions[v * 3]! * plane.nx + positions[v * 3 + 1]! * plane.ny + positions[v * 3 + 2]! * plane.nz > plane.d) took++;
  }
  return took / n;
}

/**
 * The `ROCK_PLANES` candidate planes for (model, cut), before the cap-share
 * rule drops any: a unit normal from the (model, cut, plane) hash, offset so
 * that it slices off the outermost `ROCK_DEPTH` fraction of the model's reach
 * IN THAT DIRECTION.
 *
 * That direction-by-direction reach — the support distance, the largest
 * `(p − centroid)·n` over the model's vertices — is what makes the cut bite
 * the same way on any shape. Offsetting instead by one global number (the
 * largest distance of any vertex from the centroid, whatever direction it lay
 * in) is only equivalent on a sphere, where every vertex sits at that one
 * distance. A real rock is nowhere near a sphere: its longest axis can be
 * several times its shortest, so a global offset puts every plane far outside
 * the surface in every direction but the longest, their caps come out empty,
 * and the cap-share floor then drops them — the planes are seeded, judged and
 * discarded without ever cutting anything.
 *
 * Exported so a test can hold the cap-share rule below to the candidates it
 * actually judged, rather than only to the ones it let through.
 */
export function rockPlaneCandidates(model: number, cut: number, positions: Float32Array): RockPlane[] {
  const n = positions.length / 3;
  const [cx, cy, cz] = centroidOf(positions);
  const out: RockPlane[] = [];
  for (let i = 0; i < ROCK_PLANES; i++) {
    const u = hash(model, cut, i, 1), v = hash(model, cut, i, 2), w = hash(model, cut, i, 3);
    const z = 2 * u - 1, phi = 2 * Math.PI * v, rxy = Math.sqrt(Math.max(0, 1 - z * z));
    const nx = rxy * Math.cos(phi), ny = rxy * Math.sin(phi), nz = z;
    let support = 0;
    for (let k = 0; k < n; k++) {
      support = Math.max(support, (positions[k * 3]! - cx) * nx + (positions[k * 3 + 1]! - cy) * ny + (positions[k * 3 + 2]! - cz) * nz);
    }
    const depth = ROCK_DEPTH[0] + (ROCK_DEPTH[1] - ROCK_DEPTH[0]) * w;
    out.push({ nx, ny, nz, d: cx * nx + cy * ny + cz * nz + support * (1 - depth) });
  }
  return out;
}

/**
 * The planes that actually cut (model, cut) on `positions`: the candidates
 * above, minus the ones whose cap would hold too few vertices to read as a
 * facet or so many that it would take the silhouette apart.
 *
 * The rule is applied HERE, once, rather than inside `rockRelief`, and the
 * caller hands the surviving list to every LOD of the model. Judging it per
 * LOD instead would let one plane fall on either side of the floor for two
 * levels of the same rock — they carry different vertex counts and different
 * distributions — and the rock would change shape, not merely detail, the
 * moment its LOD swapped.
 */
export function rockPlanes(model: number, cut: number, positions: Float32Array): RockPlane[] {
  return rockPlaneCandidates(model, cut, positions).filter((plane) => {
    const share = capShare(positions, plane);
    return share >= ROCK_CAP_SHARE[0] && share <= ROCK_CAP_SHARE[1];
  });
}

/** Applies every plane in `planes` — they have already been judged (see
 * `rockPlanes`) — then unwelds, takes flat face normals, roughens inward and
 * writes a per-facet luma. */
export function rockRelief(input: RockArrays, planes: RockPlane[], model: number, cut: number): RockCut {
  const n = input.positions.length / 3;
  const [cx, cy, cz] = centroidOf(input.positions);
  // Float64 for the working copy, though the input and the output are both
  // Float32: a vertex can be projected by as many as ROCK_PLANES planes in
  // turn, and each projection rounded to float32 can nudge it back out by an
  // ulp. Rounded once at the end instead of ten times along the way, the
  // bound below survives in the output arrays and not only in the arithmetic.
  const p = new Float64Array(input.positions);
  for (const pl of planes) {
    for (let v = 0; v < n; v++) {
      const s = p[v * 3]! * pl.nx + p[v * 3 + 1]! * pl.ny + p[v * 3 + 2]! * pl.nz - pl.d;
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
    // Which side is "out" is the input's to say, not the index order's: the
    // cross product above points one way for a triangle wound one way and the
    // other way for the same triangle wound the other, and models do ship
    // with either winding. Take the side the input's own vertex normals agree
    // with — summed over the three corners, so one corner whose normal a cut
    // has swung far from the facet cannot decide it alone.
    const sx = input.normals[i0 * 3]! + input.normals[i1 * 3]! + input.normals[i2 * 3]!;
    const sy = input.normals[i0 * 3 + 1]! + input.normals[i1 * 3 + 1]! + input.normals[i2 * 3 + 1]!;
    const sz = input.normals[i0 * 3 + 2]! + input.normals[i1 * 3 + 2]! + input.normals[i2 * 3 + 2]!;
    if (fx * sx + fy * sy + fz * sz < 0) { fx = -fx; fy = -fy; fz = -fz; }
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
      // is keyed on the original position so a shared edge's two copies draw
      // the same noise value too.
      const ox = input.positions[s * 3]!, oy = input.positions[s * 3 + 1]!, oz = input.positions[s * 3 + 2]!;
      const vnx = input.normals[s * 3]!, vny = input.normals[s * 3 + 1]!, vnz = input.normals[s * 3 + 2]!;
      // INWARD only, and scaled by THIS vertex's own distance `d` from the
      // centroid. Inward-only is what makes "a cut only removes material"
      // exact rather than a balance: an earlier version shrank the whole model
      // by ROCK_ROUGH first and then let the noise push back out by as much
      // again, which held the bound but cost every model a uniform 2 % of its
      // reach in every direction — it lifted a prop's flat underside off the
      // ground it is sunk 2 cm into, and pulled a boulder's top down away from
      // the collider box sized around it. Displacing one way only keeps the
      // extremes where the artist put them wherever the noise happens to be
      // quiet, and still roughens the surface by the same amplitude. Scaling
      // by `d` rather than by any global extent keeps the bound true for a
      // vertex nearer the centroid than the model's most distant one.
      const d = Math.hypot(ox - cx, oy - cy, oz - cz);
      const r = -ROCK_ROUGH * d * valueNoise2(ox / ROCK_ROUGH_WAVE + oy * 0.37, oz / ROCK_ROUGH_WAVE + oy * 0.61, 1 + model * 4 + cut);
      let rx = p[s * 3]! + vnx * r, ry = p[s * 3 + 1]! + vny * r, rz = p[s * 3 + 2]! + vnz * r;
      // "Inward along the vertex normal" is only "inward toward the centroid"
      // where the surface is convex. On the concave stretches every real rock
      // has, the normal runs partly sideways, and a sideways step can carry a
      // vertex a little farther from the centroid than it began — measured at
      // 21 µm on the shipped boulders before this clamp, tiny but enough to
      // make "a cut only removes material" a near-miss rather than a fact.
      // Pulling the vertex back onto its own starting radius costs one scale
      // and makes the bound exact on any mesh, convex or not. Both unwelded
      // copies of a shared vertex clamp identically — same original position,
      // same radius, same noise — so this cannot open a crack either.
      const reach = Math.hypot(rx - cx, ry - cy, rz - cz);
      if (reach > d && reach > 0) {
        const k = d / reach;
        rx = cx + (rx - cx) * k; ry = cy + (ry - cy) * k; rz = cz + (rz - cz) * k;
      }
      positions[v * 3] = rx; positions[v * 3 + 1] = ry; positions[v * 3 + 2] = rz;
      normals[v * 3] = fx; normals[v * 3 + 1] = fy; normals[v * 3 + 2] = fz;
      colors[v * 4] = luma; colors[v * 4 + 1] = luma; colors[v * 4 + 2] = luma; colors[v * 4 + 3] = 1;
      if (uvs && input.uvs) { uvs[v * 2] = input.uvs[s * 2]!; uvs[v * 2 + 1] = input.uvs[s * 2 + 1]!; }
      indices[v] = v;
    }
  }
  return { positions, normals, uvs, colors, indices };
}
