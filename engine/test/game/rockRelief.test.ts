import { describe, expect, it } from "vitest";
import {
  ROCK_CAP_SHARE, ROCK_CUTS, ROCK_DEPTH, ROCK_LUMA, ROCK_PLANES, ROCK_ROUGH,
  rockPlaneCandidates, rockPlanes, rockRelief, type RockArrays, type RockCut, type RockPlane,
} from "../../src/game/rockRelief.js";

/** A unit icosphere with `sub` subdivisions, as the arrays a GLB mesh hands over. */
function icosphere(sub: number): RockArrays {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = Math.hypot(...v); return v.map((c) => c / l); });
  let faces: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const had = mid.get(key); if (had !== undefined) return had;
      const m = verts[a]!.map((c, i) => (c + verts[b]![i]!) / 2); const l = Math.hypot(...m);
      verts.push(m.map((c) => c / l)); mid.set(key, verts.length - 1); return verts.length - 1;
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = midpoint(a!, b!), bc = midpoint(b!, c!), ca = midpoint(c!, a!); return [[a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]]; });
  }
  return {
    positions: new Float32Array(verts.flat()),
    normals: new Float32Array(verts.flat()),
    uvs: new Float32Array(verts.flatMap((v) => [0.5 + Math.atan2(v[2]!, v[0]!) / (2 * Math.PI), 0.5 - Math.asin(v[1]!) / Math.PI])),
    indices: new Uint32Array(faces.flat()),
  };
}
const SPHERE = icosphere(4); // 2,562 vertices, 5,120 triangles

/** The icosphere stretched ×1/×0.45/×2.2 on its three axes, so its vertices
 * sit at widely different distances from the centroid. A uniform sphere
 * cannot expose a roughening amplitude scaled by the model's global
 * half-extent rather than each vertex's own distance from the centroid,
 * because every one of its vertices IS at the half-extent; this fixture
 * has plenty that aren't. */
function anisoSphere(): RockArrays {
  const [sx, sy, sz] = [1, 0.45, 2.2];
  const n = SPHERE.positions.length / 3;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const x = SPHERE.positions[v * 3]!, y = SPHERE.positions[v * 3 + 1]!, z = SPHERE.positions[v * 3 + 2]!;
    positions[v * 3] = x * sx; positions[v * 3 + 1] = y * sy; positions[v * 3 + 2] = z * sz;
    // A sphere's own normal is its (unit) position; an anisotropic scale
    // carries a surface normal by the INVERSE scale, not the scale itself.
    const nx = x / sx, ny = y / sy, nz = z / sz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    normals[v * 3] = nx / nl; normals[v * 3 + 1] = ny / nl; normals[v * 3 + 2] = nz / nl;
  }
  return { positions, normals, uvs: SPHERE.uvs, indices: SPHERE.indices };
}
const ANISO = anisoSphere();

/** The seeded direction `SLAB` below is built square to. A candidate's normal
 * comes from the (model, cut, plane) hash alone, so this is the same unit
 * vector whatever positions it is asked about. */
const SLAB_MODEL = 0, SLAB_CUT = 0;
const SLAB_AXIS = rockPlaneCandidates(SLAB_MODEL, SLAB_CUT, SPHERE.positions)[0]!;

/**
 * The icosphere pressed FLAT either side of `SLAB_AXIS` — a coin 0.12 thick
 * and 2 across, lying square to that one seeded plane direction.
 *
 * Nothing among the shipped models comes near the cap-share CEILING, so
 * without a fixture shaped to provoke it the ceiling half of the rule would be
 * stated and never exercised. Two things about provoking it are worth writing
 * down, because both were tried and neither works:
 *
 * - Merely SCALING the sphere flat does nothing. A scaled icosphere keeps the
 *   sphere's uniform spread of vertices, so a plane's cap holds the same share
 *   of them at any scaling, and `ROCK_DEPTH` caps that share near 14 %. What
 *   overruns the ceiling is a genuine flat FACE at the model's full reach:
 *   every vertex on it sits at the support distance, so one plane takes the
 *   whole face. Each of this coin's faces carries about 47 % of the vertices.
 *
 * - A coin in some arbitrary orientation is not enough either. A plane only
 *   takes the whole face when its normal is within a few degrees of the face's
 *   own, and outside that narrow cone the coin's RIM sets the reach instead,
 *   putting the plane out at the rim where its cap is small again. Ten
 *   seeded normals per cut would hit that cone only now and then, which is a
 *   test that passes or fails by luck. Building the coin around a normal the
 *   seed actually produces makes the ceiling fire by construction.
 */
function slab(): RockArrays {
  const n = SPHERE.positions.length / 3;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const { nx, ny, nz } = SLAB_AXIS;
  for (let v = 0; v < n; v++) {
    const x = SPHERE.positions[v * 3]!, y = SPHERE.positions[v * 3 + 1]!, z = SPHERE.positions[v * 3 + 2]!;
    const along = x * nx + y * ny + z * nz;
    const flat = Math.max(-0.06, Math.min(0.06, along));
    const push = along - flat;
    positions[v * 3] = x - push * nx; positions[v * 3 + 1] = y - push * ny; positions[v * 3 + 2] = z - push * nz;
    if (push !== 0) {
      const s = Math.sign(along);
      normals[v * 3] = nx * s; normals[v * 3 + 1] = ny * s; normals[v * 3 + 2] = nz * s;
    } else {
      // On the rim: the part of the sphere normal that lies in the coin's plane.
      const tx = x - along * nx, ty = y - along * ny, tz = z - along * nz;
      const tl = Math.hypot(tx, ty, tz) || 1;
      normals[v * 3] = tx / tl; normals[v * 3 + 1] = ty / tl; normals[v * 3 + 2] = tz / tl;
    }
  }
  return { positions, normals, uvs: SPHERE.uvs, indices: SPHERE.indices };
}
const SLAB = slab();

/** The share of `input`'s vertices a plane would flatten, computed here rather
 * than imported so the assertions measure the rule's effect independently of
 * the arithmetic the rule itself used. */
function capShareOf(input: RockArrays, plane: RockPlane): number {
  const n = input.positions.length / 3;
  let took = 0;
  for (let v = 0; v < n; v++) {
    if (input.positions[v * 3]! * plane.nx + input.positions[v * 3 + 1]! * plane.ny + input.positions[v * 3 + 2]! * plane.nz > plane.d) took++;
  }
  return took / n;
}

/** The depth a plane's offset implies against the fixture's own reach along
 * that plane's normal — the number `ROCK_DEPTH` bands. */
function depthOf(input: RockArrays, plane: RockPlane): number {
  const [cx, cy, cz] = centroidOf(input.positions);
  let support = 0;
  for (let v = 0; v < input.positions.length / 3; v++) {
    support = Math.max(support, (input.positions[v * 3]! - cx) * plane.nx + (input.positions[v * 3 + 1]! - cy) * plane.ny + (input.positions[v * 3 + 2]! - cz) * plane.nz);
  }
  return 1 - (plane.d - (cx * plane.nx + cy * plane.ny + cz * plane.nz)) / support;
}

/** The centroid rockRelief itself computes: the mean of the input vertices. */
function centroidOf(positions: Float32Array): [number, number, number] {
  const n = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < n; v++) { cx += positions[v * 3]!; cy += positions[v * 3 + 1]!; cz += positions[v * 3 + 2]!; }
  return [cx / n, cy / n, cz / n];
}

/** The load-bearing bound a cut must never break: no output vertex may end up
 * farther from the centroid than the input vertex it came from was. Checked
 * per vertex, not against the model's global half-extent — a bound scaled by
 * the half-extent is looser than this everywhere except at the half-extent
 * itself, so it would miss a vertex that started closer in and got pushed
 * past its own starting distance without ever reaching the model's overall
 * extreme. */
function expectOnlyRemovesMaterial(input: RockArrays, cut: RockCut): void {
  const [cx, cy, cz] = centroidOf(input.positions);
  const tris = cut.indices.length / 3;
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      const src = input.indices[t * 3 + k]!;
      const d = Math.hypot(input.positions[src * 3]! - cx, input.positions[src * 3 + 1]! - cy, input.positions[src * 3 + 2]! - cz);
      const pd = Math.hypot(cut.positions[v * 3]! - cx, cut.positions[v * 3 + 1]! - cy, cut.positions[v * 3 + 2]! - cz);
      expect(pd).toBeLessThanOrEqual(d + 1e-6);
    }
  }
}

describe("rockPlanes", () => {
  it("gives ROCK_PLANES unit normals with depths inside the band, deterministic per (model, cut), different across cuts", () => {
    expect(ROCK_CUTS).toBe(4);
    const a = rockPlaneCandidates(0, 1, SPHERE.positions);
    const b = rockPlaneCandidates(0, 1, SPHERE.positions);
    const c = rockPlaneCandidates(0, 2, SPHERE.positions);
    expect(a.length).toBe(ROCK_PLANES);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const p of a) {
      expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 9);
      expect(depthOf(SPHERE, p)).toBeGreaterThanOrEqual(ROCK_DEPTH[0] - 1e-6);
      expect(depthOf(SPHERE, p)).toBeLessThanOrEqual(ROCK_DEPTH[1] + 1e-6);
    }
    // Every candidate survives on a sphere, which is the whole reason a sphere
    // cannot be the only fixture: a plane offset by the reach in its own
    // direction and a plane offset by the model's largest reach in any
    // direction are the same plane here, and only here.
    expect(rockPlanes(0, 1, SPHERE.positions).length).toBe(ROCK_PLANES);
  });

  it("offsets a plane by the fixture's reach along that plane's own normal, not by its largest reach anywhere", () => {
    // On the anisotropic fixture the two readings differ by a factor of
    // several, and it is the per-direction one the offsets have to follow.
    const [cx, cy, cz] = centroidOf(ANISO.positions);
    let largestAnywhere = 0;
    for (let v = 0; v < ANISO.positions.length / 3; v++) {
      largestAnywhere = Math.max(largestAnywhere, Math.hypot(ANISO.positions[v * 3]! - cx, ANISO.positions[v * 3 + 1]! - cy, ANISO.positions[v * 3 + 2]! - cz));
    }
    let sawDirectionMuchShorter = false;
    for (const p of rockPlaneCandidates(3, 1, ANISO.positions)) {
      const reachHere = (p.d - (cx * p.nx + cy * p.ny + cz * p.nz)) / (1 - depthOf(ANISO, p));
      expect(reachHere).toBeLessThanOrEqual(largestAnywhere + 1e-6);
      if (reachHere < largestAnywhere * 0.5) sawDirectionMuchShorter = true;
      expect(depthOf(ANISO, p)).toBeGreaterThanOrEqual(ROCK_DEPTH[0] - 1e-6);
      expect(depthOf(ANISO, p)).toBeLessThanOrEqual(ROCK_DEPTH[1] + 1e-6);
    }
    // Non-vacuous: this fixture really does have directions where its reach is
    // under half its largest, which is where a global offset would have put
    // the plane clean outside the surface and left the cap empty.
    expect(sawDirectionMuchShorter).toBe(true);
  });

  it("drops a candidate whose cap would swallow more than ROCK_CAP_SHARE allows", () => {
    // The ceiling, on a fixture flat enough to provoke it (see `SLAB`). The
    // shipped models only ever trip the floor, so without this the ceiling
    // would be a branch no test ever took.
    let over = 0;
    for (const cut of [SLAB_CUT]) {
      const kept = rockPlanes(SLAB_MODEL, cut, SLAB.positions);
      for (const candidate of rockPlaneCandidates(SLAB_MODEL, cut, SLAB.positions)) {
        const share = capShareOf(SLAB, candidate);
        const isKept = kept.some((k) => k.d === candidate.d && k.nx === candidate.nx);
        expect(isKept, `cut${cut} share ${share}`).toBe(share >= ROCK_CAP_SHARE[0] && share <= ROCK_CAP_SHARE[1]);
        if (share > ROCK_CAP_SHARE[1]) over++;
      }
    }
    expect(over, "the slab fixture must actually produce over-ceiling candidates").toBeGreaterThan(0);
    // And the effect of dropping them: nothing in the cut geometry lies on a
    // plane the rule refused.
    const cosTol = Math.cos((5 * Math.PI) / 180);
    for (const cut of [SLAB_CUT]) {
      const kept = rockPlanes(SLAB_MODEL, cut, SLAB.positions);
      const refused = rockPlaneCandidates(SLAB_MODEL, cut, SLAB.positions).filter((c) => capShareOf(SLAB, c) > ROCK_CAP_SHARE[1]);
      const out = rockRelief(SLAB, kept, SLAB_MODEL, cut);
      for (const bad of refused) {
        let onIt = 0;
        for (let t = 0; t < out.indices.length / 3; t++) {
          const nx = out.normals[t * 9]!, ny = out.normals[t * 9 + 1]!, nz = out.normals[t * 9 + 2]!;
          // A facet the refused plane produced would both face the way it
          // faces and sit at its offset.
          if (nx * bad.nx + ny * bad.ny + nz * bad.nz > cosTol) {
            const px = out.positions[t * 9]!, py = out.positions[t * 9 + 1]!, pz = out.positions[t * 9 + 2]!;
            if (Math.abs(px * bad.nx + py * bad.ny + pz * bad.nz - bad.d) < 1e-6) onIt++;
          }
        }
        expect(onIt, `cut${cut}`).toBe(0);
      }
    }
  });
});

describe("rockRelief", () => {
  const planes = rockPlanes(0, 0, SPHERE.positions);
  const cut = rockRelief(SPHERE, planes, 0, 0);
  it("unwelds: three vertices per triangle, unit face normals within 5% of the geometric normal", () => {
    const tris = cut.indices.length / 3;
    expect(cut.positions.length).toBe(tris * 9);
    expect(cut.normals.length).toBe(tris * 9);
    expect(cut.colors.length).toBe(tris * 12);
    for (let t = 0; t < tris; t++) {
      const i = [cut.indices[t * 3]!, cut.indices[t * 3 + 1]!, cut.indices[t * 3 + 2]!];
      expect(i).toEqual([t * 3, t * 3 + 1, t * 3 + 2]);
      const p = i.map((k) => [cut.positions[k * 3]!, cut.positions[k * 3 + 1]!, cut.positions[k * 3 + 2]!]);
      const e1 = p[1]!.map((c, k) => c - p[0]![k]!), e2 = p[2]!.map((c, k) => c - p[0]![k]!);
      const g = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const gl = Math.hypot(...g);
      if (gl < 1e-9) continue; // a degenerate sliver on a cap edge is allowed to exist, not to matter
      for (const k of i) {
        const n = [cut.normals[k * 3]!, cut.normals[k * 3 + 1]!, cut.normals[k * 3 + 2]!];
        expect(Math.hypot(...n)).toBeCloseTo(1, 6);
        // The stored normal is deliberately the FLAT facet's normal from
        // before roughening, not the roughened triangle's own geometric
        // normal: each vertex is displaced along its own input vertex
        // normal rather than this triangle's face normal, so the three
        // displacements aren't parallel and can tip the roughened triangle
        // slightly off the plane it was cut to. Recomputing the normal after
        // roughening would shade each roughened triangle by its own tilt
        // instead, which would show as neighbouring facets no longer reading
        // as one flat plane — exactly the look this is meant to produce. So
        // this checks the two stay close (a 5% relative tolerance; the
        // measured peak here is under 1.5%), not that they're ever meant to
        // match exactly, while still catching a normal that is flatly wrong
        // (a different plane, a flipped sign, a non-unit length).
        const dot = n[0]! * g[0]! + n[1]! * g[1]! + n[2]! * g[2]!;
        expect(Math.abs(dot - gl)).toBeLessThanOrEqual(gl * 0.05 + 1e-9);
      }
    }
  });
  it("only removes material: every output vertex is no farther from the centroid than the input vertex it came from", () => {
    expectOnlyRemovesMaterial(SPHERE, cut);
    // A sphere is the one shape where every vertex sits at the half-extent,
    // so it cannot tell a global-half-extent-scaled roughening apart from a
    // per-vertex-distance-scaled one. This fixture can: its vertices sit at
    // widely different distances from the centroid.
    const anisoPlanes = rockPlanes(0, 0, ANISO.positions);
    const anisoCut = rockRelief(ANISO, anisoPlanes, 0, 0);
    expectOnlyRemovesMaterial(ANISO, anisoCut);
  });
  it("cuts facets: every plane it was given shows as a flat face, at least six of them distinct", () => {
    const tris = cut.indices.length / 3;
    const clusters: number[][] = [];
    const cosTol = Math.cos((5 * Math.PI) / 180);
    const shown = planes.map(() => false);
    let flat = 0;
    for (let t = 0; t < tris; t++) {
      const n = [cut.normals[t * 9]!, cut.normals[t * 9 + 1]!, cut.normals[t * 9 + 2]!];
      // A facet triangle: all three of its corners were projected onto one
      // plane, so its normal matches that plane's within tolerance.
      for (let pi = 0; pi < planes.length; pi++) {
        const p = planes[pi]!;
        if (n[0]! * p.nx + n[1]! * p.ny + n[2]! * p.nz > cosTol) {
          flat++; shown[pi] = true;
          if (!clusters.some((c) => c[0]! * p.nx + c[1]! * p.ny + c[2]! * p.nz > cosTol)) clusters.push([p.nx, p.ny, p.nz]);
          break;
        }
      }
    }
    expect(clusters.length).toBeGreaterThanOrEqual(6);
    expect(flat).toBeGreaterThan(0);
    // `rockPlanes` hands back only the planes that cleared the cap-share rule,
    // so on this fixture every one of them has to leave a visible face — a
    // plane with nothing to cut cannot have cleared the floor. Checked against
    // an independently computed share so the two are not the same arithmetic.
    for (let pi = 0; pi < planes.length; pi++) {
      const share = capShareOf(SPHERE, planes[pi]!);
      expect(share).toBeGreaterThanOrEqual(ROCK_CAP_SHARE[0] - 1e-9);
      expect(share).toBeLessThanOrEqual(ROCK_CAP_SHARE[1] + 1e-9);
      expect(shown[pi], `plane ${pi} cleared the floor but left no facet`).toBe(true);
    }
  });
  it("roughens without cracks and keeps facet luma within the band, equal across a triangle", () => {
    expect(ROCK_ROUGH).toBe(0.02);
    for (let t = 0; t < cut.indices.length / 3; t++) {
      const l = cut.colors[t * 12]!;
      expect(l).toBeGreaterThanOrEqual(1 - ROCK_LUMA - 1e-9);
      expect(l).toBeLessThanOrEqual(1 + ROCK_LUMA + 1e-9);
      expect(cut.colors[t * 12 + 4]).toBe(l);
      expect(cut.colors[t * 12 + 8]).toBe(l);
      expect(cut.colors[t * 12 + 3]).toBe(1);
    }
    // Shared-edge vertices (same input position) land in the same place after roughening.
    const byKey = new Map<string, number[]>();
    for (let v = 0; v < cut.positions.length / 3; v++) {
      const k = `${cut.uvs![v * 2]!.toFixed(6)},${cut.uvs![v * 2 + 1]!.toFixed(6)}`;
      const p = [cut.positions[v * 3]!, cut.positions[v * 3 + 1]!, cut.positions[v * 3 + 2]!];
      const had = byKey.get(k);
      if (had) { for (let i = 0; i < 3; i++) expect(p[i]).toBeCloseTo(had[i]!, 5); } else byKey.set(k, p);
    }
  });
  it("takes the side the input's vertex normals call out, whichever way the input winds", () => {
    // The same sphere with every triangle's last two corners swapped: an
    // identical solid with identical outward vertex normals, wound the other
    // way. Models ship with either winding — the glTF loader's meshes wind
    // with their normals, a mesh built in Babylon against them — so a facet
    // normal taken straight from the cross product of the triangle's edges
    // points OUT of one and INTO the other. A rock whose facets all face
    // inward is not invisible: with two-sided lighting it lights by an
    // inward normal, which is to say it renders black.
    const indices = new Uint32Array(SPHERE.indices);
    for (let t = 0; t < indices.length / 3; t++) {
      const swap = indices[t * 3 + 1]!;
      indices[t * 3 + 1] = indices[t * 3 + 2]!;
      indices[t * 3 + 2] = swap;
    }
    const reversed = rockRelief({ ...SPHERE, indices }, planes, 0, 0);
    for (const c of [cut, reversed]) {
      const tris = c.indices.length / 3;
      let inward = 0;
      for (let t = 0; t < tris; t++) {
        const src = t * 3;
        // A sphere's vertex normal is its own unit position, and a cut only
        // ever moves a vertex inward, so "outward" here is just the facet
        // normal agreeing with the vertex it was cut from.
        const i = c.indices[src]!;
        const d = c.normals[i * 3]! * c.positions[i * 3]! + c.normals[i * 3 + 1]! * c.positions[i * 3 + 1]! + c.normals[i * 3 + 2]! * c.positions[i * 3 + 2]!;
        if (d < 0) inward++;
      }
      expect(inward).toBe(0);
    }
    // Reversing the winding reverses nothing else: the same solid comes out.
    // Compared as a multiset of coordinates, since reversing a triangle's last
    // two corners reorders the unwelded output without moving anything. The
    // comparator is explicit because the default `sort` orders as strings.
    const byValue = (a: number, b: number): number => a - b;
    expect(Array.from(reversed.positions).sort(byValue)).toEqual(Array.from(cut.positions).sort(byValue));
  });
  it("is deterministic in every output array, and two cuts of one model differ", () => {
    const again = rockRelief(SPHERE, planes, 0, 0);
    expect(Array.from(again.positions)).toEqual(Array.from(cut.positions));
    expect(Array.from(again.normals)).toEqual(Array.from(cut.normals));
    expect(Array.from(again.colors)).toEqual(Array.from(cut.colors));
    expect(Array.from(again.uvs!)).toEqual(Array.from(cut.uvs!));
    expect(Array.from(again.indices)).toEqual(Array.from(cut.indices));
    const other = rockRelief(SPHERE, rockPlanes(0, 1, SPHERE.positions), 0, 1);
    expect(Array.from(other.positions)).not.toEqual(Array.from(cut.positions));
  });
});
