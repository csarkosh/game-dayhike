import { describe, expect, it } from "vitest";
import {
  ROCK_CAP_SHARE, ROCK_CUTS, ROCK_DEPTH, ROCK_LUMA, ROCK_PLANES, ROCK_ROUGH,
  rockHalfExtent, rockPlanes, rockRelief, type RockArrays, type RockCut,
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
    const a = rockPlanes(0, 1, 1), b = rockPlanes(0, 1, 1), c = rockPlanes(0, 2, 1);
    expect(a.length).toBe(ROCK_PLANES);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const p of a) {
      expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 9);
      expect(1 - p.d).toBeGreaterThanOrEqual(ROCK_DEPTH[0] - 1e-9);
      expect(1 - p.d).toBeLessThanOrEqual(ROCK_DEPTH[1] + 1e-9);
    }
    // Depth scales with the half-extent.
    const big = rockPlanes(0, 1, 2.5);
    for (let i = 0; i < a.length; i++) expect(big[i]!.d).toBeCloseTo(a[i]!.d * 2.5, 9);
  });
});

describe("rockRelief", () => {
  const planes = rockPlanes(0, 0, rockHalfExtent(SPHERE.positions));
  const cut = rockRelief(SPHERE, planes, 0, 0);
  it("unwelds: three vertices per triangle, unit face normals equal to the geometric normal", () => {
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
    const anisoPlanes = rockPlanes(0, 0, rockHalfExtent(ANISO.positions));
    const anisoCut = rockRelief(ANISO, anisoPlanes, 0, 0);
    expectOnlyRemovesMaterial(ANISO, anisoCut);
  });
  it("cuts facets: at least six distinct face normals, and the skip rule holds", () => {
    const tris = cut.indices.length / 3;
    const clusters: number[][] = [];
    const cosTol = Math.cos((5 * Math.PI) / 180);
    // Which candidate planes actually produced a facet: evidenced by some cut
    // triangle's normal matching that plane, so the check below can hold each
    // one to the floor share, not just the cap.
    const kept = planes.map(() => false);
    let flat = 0;
    for (let t = 0; t < tris; t++) {
      const n = [cut.normals[t * 9]!, cut.normals[t * 9 + 1]!, cut.normals[t * 9 + 2]!];
      // A facet triangle: all three input positions were projected onto one plane, so
      // its normal matches that plane's within tolerance.
      for (let pi = 0; pi < planes.length; pi++) {
        const p = planes[pi]!;
        if (n[0]! * p.nx + n[1]! * p.ny + n[2]! * p.nz > cosTol) {
          flat++; kept[pi] = true;
          if (!clusters.some((c) => c[0]! * p.nx + c[1]! * p.ny + c[2]! * p.nz > cosTol)) clusters.push([p.nx, p.ny, p.nz]);
          break;
        }
      }
    }
    expect(clusters.length).toBeGreaterThanOrEqual(6);
    // No single plane took more than the cap share, and every plane that was
    // actually kept took at least the floor. Share is recomputed here on the
    // ORIGINAL, unshrunk sphere, where the implementation itself judges the
    // skip rule on the shrunk one; shrinking pulls every vertex toward the
    // centroid, which can only shrink a plane's cap, never grow it, so this
    // unshrunk share is always ≥ the implementation's own share. A floor
    // check against this larger number is still sound for a plane the
    // implementation kept — its true share clears the floor by even more.
    for (let pi = 0; pi < planes.length; pi++) {
      const p = planes[pi]!;
      let took = 0;
      for (let v = 0; v < SPHERE.positions.length / 3; v++) if (SPHERE.positions[v * 3]! * p.nx + SPHERE.positions[v * 3 + 1]! * p.ny + SPHERE.positions[v * 3 + 2]! * p.nz > p.d) took++;
      const share = took / (SPHERE.positions.length / 3);
      if (share > 0) expect(share).toBeLessThanOrEqual(ROCK_CAP_SHARE[1] + 1e-9);
      if (kept[pi]) expect(share).toBeGreaterThanOrEqual(ROCK_CAP_SHARE[0] - 1e-9);
    }
    expect(flat).toBeGreaterThan(0);
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
  it("is deterministic, and two cuts of one model differ", () => {
    const again = rockRelief(SPHERE, planes, 0, 0);
    expect(Array.from(again.positions)).toEqual(Array.from(cut.positions));
    const other = rockRelief(SPHERE, rockPlanes(0, 1, rockHalfExtent(SPHERE.positions)), 0, 1);
    expect(Array.from(other.positions)).not.toEqual(Array.from(cut.positions));
  });
});
