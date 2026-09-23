# Rock Relief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rocks and boulders read as fractured, angular, three-dimensional stone instead of smooth loaves with a texture on them, with no per-frame cost of their own and no change to collision.

**Architecture:** A Babylon-free geometry pass (`rockRelief.ts`) cuts a model's vertex arrays with seeded planes, unwelds the triangles, gives each its face normal, roughens along it, and writes a per-facet luma as vertex colour. The clutter shell runs the pass four ways on each rock and boulder LOD mesh as its GLB lands, and gains a cut dimension in those classes' buckets so instances spread across the cuts by hash. The sim is untouched.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`VertexData`, thin instances, NullEngine in tests), vitest.

**Spec:** `docs/rendering/2026-09-23-rock-relief-design.md`. One amendment (Task 3 records it): the clutter shell uses two LODs (`LOD0` near, `LOD1` far; `LOD2` is loaded and left unused), so the pass cuts two, not three.

## Global Constraints

- The repository is public. Code, comments, docs and commit messages describe the change and the running game, nothing about how the work was done.
- Stage explicit paths only. Never `git add -A` or `git add .`.
- Commit messages: a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then a parsing `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that wrote the commit.
- A cut only removes material: no output vertex lies outside the input hull. Boulder collision boxes in the sim are untouched.
- `rockRelief.ts` imports nothing from Babylon and nothing from `sim/`.
- Frame: a 4× pixel pair at TRAILSIDE and EDGE against `main` within noise (≤ +0.3 ms); every game page blanked before each sample. Load-time: the pass on all sixteen meshes under 50 ms, timed once in the verification note.
- Docs live in `docs/rendering/` named `YYYY-MM-DD-<topic>.md`.

---

## File map

| file | task | responsibility |
| --- | --- | --- |
| `client/src/game/rockRelief.ts` | 1 | the cut on plain arrays |
| `client/test/game/rockRelief.test.ts` | 1 | its properties on an icosphere |
| `client/src/game/clutterMeshes.ts` | 2 | cutting the rock and boulder LOD meshes four ways; the cut dimension; vertex colours on |
| `client/test/game/clutterMeshes.test.ts` | 2 | routing by hash, counts, materials |
| `ARCHITECTURE.md`, the spec, the verification note | 3 | docs and gates |

---

### Task 1: The cut

**Files:**
- Create: `client/src/game/rockRelief.ts`
- Test: `client/test/game/rockRelief.test.ts`

**Interfaces:**
- Consumes: `latticeHash` from `./groundHexParams.js`; `valueNoise2` from `./groundHexParams.js` (the `(x, z, wave)` form).
- Produces:
  ```ts
  export const ROCK_PLANES = 10;
  export const ROCK_DEPTH: readonly [number, number] = [0.08, 0.28];
  export const ROCK_CAP_SHARE: readonly [number, number] = [0.03, 0.35];
  export const ROCK_ROUGH = 0.02;
  export const ROCK_ROUGH_WAVE = 0.35;
  export const ROCK_LUMA = 0.08;
  export const ROCK_CUTS = 4;
  export type RockArrays = { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; indices: Uint32Array | Uint16Array };
  export type RockCut = RockArrays & { colors: Float32Array; indices: Uint32Array };
  export type RockPlane = { nx: number; ny: number; nz: number; d: number };
  export function rockPlanes(model: number, cut: number, halfExtent: number): RockPlane[]; // ROCK_PLANES candidates, before the skip rule
  export function rockRelief(input: RockArrays, planes: RockPlane[], model: number, cut: number): RockCut;
  export function rockHalfExtent(positions: Float32Array): number; // max |p − centroid| over the vertices
  ```
  `rockPlanes` is what makes LOD1 receive LOD0's planes: the shell calls it once per (model, cut) with LOD0's half-extent and passes the same list to every LOD.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  ROCK_CAP_SHARE, ROCK_CUTS, ROCK_DEPTH, ROCK_LUMA, ROCK_PLANES, ROCK_ROUGH,
  rockHalfExtent, rockPlanes, rockRelief, type RockArrays,
} from "../../src/game/rockRelief.js";

/** A unit icosphere with `sub` subdivisions, as the arrays a GLB mesh hands over. */
function icosphere(sub: number): RockArrays {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = Math.hypot(...v); return v.map((c) => c / l); });
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
        expect(n[0]! * g[0]! + n[1]! * g[1]! + n[2]! * g[2]!).toBeCloseTo(gl, 5);
      }
    }
  });
  it("only removes material: every output vertex lies inside the input hull", () => {
    const he = rockHalfExtent(SPHERE.positions);
    for (let v = 0; v < cut.positions.length / 3; v++) {
      expect(Math.hypot(cut.positions[v * 3]!, cut.positions[v * 3 + 1]!, cut.positions[v * 3 + 2]!)).toBeLessThanOrEqual(he + 1e-6);
    }
  });
  it("cuts facets: at least six distinct face normals, and the skip rule holds", () => {
    const tris = cut.indices.length / 3;
    const clusters: number[][] = [];
    const cosTol = Math.cos((5 * Math.PI) / 180);
    let flat = 0;
    for (let t = 0; t < tris; t++) {
      const n = [cut.normals[t * 9]!, cut.normals[t * 9 + 1]!, cut.normals[t * 9 + 2]!];
      // A facet triangle: all three input positions were projected onto one plane, so
      // its normal matches that plane's within tolerance.
      for (const p of planes) {
        if (n[0]! * p.nx + n[1]! * p.ny + n[2]! * p.nz > cosTol) { flat++; if (!clusters.some((c) => c[0]! * p.nx + c[1]! * p.ny + c[2]! * p.nz > cosTol)) clusters.push([p.nx, p.ny, p.nz]); break; }
      }
    }
    expect(clusters.length).toBeGreaterThanOrEqual(6);
    // No single plane took more than the cap share, and every kept plane took at least the floor.
    for (const p of planes) {
      let took = 0;
      for (let v = 0; v < SPHERE.positions.length / 3; v++) if (SPHERE.positions[v * 3]! * p.nx + SPHERE.positions[v * 3 + 1]! * p.ny + SPHERE.positions[v * 3 + 2]! * p.nz > p.d) took++;
      const share = took / (SPHERE.positions.length / 3);
      if (share > 0) expect(share).toBeLessThanOrEqual(ROCK_CAP_SHARE[1] + 1e-9);
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
  it("is deterministic, and two cuts of one model differ", () => {
    const again = rockRelief(SPHERE, planes, 0, 0);
    expect(Array.from(again.positions)).toEqual(Array.from(cut.positions));
    const other = rockRelief(SPHERE, rockPlanes(0, 1, rockHalfExtent(SPHERE.positions)), 0, 1);
    expect(Array.from(other.positions)).not.toEqual(Array.from(cut.positions));
  });
});
```

The shared-edge test keys vertices by UV because the icosphere's UVs are unique per input vertex; on a real model two input vertices can share a UV, so that assertion stays sphere-only.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run --root client test/game/rockRelief.test.ts`.

- [ ] **Step 3: Implement `client/src/game/rockRelief.ts`**

```ts
import { latticeHash, valueNoise2 } from "./groundHexParams.js";

/**
 * Rock relief: cuts a rounded model into fractured, angular stone at load.
 * Seeded planes flatten caps into facets with sharp edges; the triangles are
 * unwelded so each shades by its own face normal; a small noise along that
 * normal roughens the facets; a per-facet luma is written as vertex colour.
 * A cut only removes material — nothing leaves the input hull — so the sim's
 * collision boxes for boulders stay right. Babylon-free: arrays in, arrays out.
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
      // Roughening keyed on the ORIGINAL position so a shared edge moves as one.
      const ox = input.positions[s * 3]!, oy = input.positions[s * 3 + 1]!, oz = input.positions[s * 3 + 2]!;
      const r = ROCK_ROUGH * he * (2 * valueNoise2(ox / ROCK_ROUGH_WAVE + oy * 0.37, oz / ROCK_ROUGH_WAVE + oy * 0.61, 1 + model * 4 + cut) - 1);
      positions[v * 3] = p[s * 3]! + fx * r; positions[v * 3 + 1] = p[s * 3 + 1]! + fy * r; positions[v * 3 + 2] = p[s * 3 + 2]! + fz * r;
      normals[v * 3] = fx; normals[v * 3 + 1] = fy; normals[v * 3 + 2] = fz;
      colors[v * 4] = luma; colors[v * 4 + 1] = luma; colors[v * 4 + 2] = luma; colors[v * 4 + 3] = 1;
      if (uvs && input.uvs) { uvs[v * 2] = input.uvs[s * 2]!; uvs[v * 2 + 1] = input.uvs[s * 2 + 1]!; }
      indices[v] = v;
    }
  }
  return { positions, normals, uvs, colors, indices };
}
```

The roughening displaces along the *face* normal, so the two sides of a shared edge — which lie on different faces — move along different normals by the same scalar; the shared-edge test on the sphere tolerates this at 1e-5 because `ROCK_ROUGH · he` is 0.02 and the normals of adjacent sphere faces differ by a few degrees. If the test fails on that tolerance, displace along the input's *vertex* normal instead (`input.normals[s]`), which is identical on both sides — say so in the commit.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/rockRelief.test.ts test/architecture.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add client/src/game/rockRelief.ts client/test/game/rockRelief.test.ts`, subject `feat: cut rocks into fractured, angular stone at load`.

---

### Task 2: Four cuts per model in the clutter shell

**Files:**
- Modify: `client/src/game/clutterMeshes.ts` (`bucketFor`, `adopt`, the mesh preparation for the rock and boulder classes; the materials)
- Test: `client/test/game/clutterMeshes.test.ts`

**Interfaces:**
- Consumes: `rockPlanes`, `rockRelief`, `rockHalfExtent`, `ROCK_CUTS` (Task 1); Babylon `VertexData`, `VertexBuffer` kinds.
- Produces: `export const CUT_CLASSES: ReadonlySet<number>` = `{ CLUTTER_ROCK, CLUTTER_BOULDER }`; `export function cutsFor(cls: number): number` (`ROCK_CUTS` for those classes, 1 otherwise); `export function cutOf(inst: ClutterInstance): number` (`inst.hash & (ROCK_CUTS - 1)` masked to `cutsFor(inst.cls)`); buckets for the cut classes are `[cls][variant * cuts + cut][lod]`; `export function reliefMesh(source: Mesh, model: number, cut: number, planes: RockPlane[]): Mesh` — a new mesh with the cut arrays, the source's material, vertex colours on.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/clutterMeshes.test.ts`, using the file's `buildWithAssets()` helper (synthetic box meshes per class → variant → LOD):

```ts
describe("rock relief in the shell", () => {
  it("cuts the rock and boulder LOD meshes four ways and leaves every other class alone", () => {
    const { meshes: clutter, scene, engine } = buildWithAssets();
    const rockMeshes = scene.meshes.filter((m) => /^clutter\.rock_[ab]\.|^clutter\.boulder_[ab]\./.test(m.name));
    // 2 models × 2 LODs × 4 cuts per class, two classes
    expect(rockMeshes.filter((m) => /_cut[0-3]$/.test(m.name)).length).toBe(2 * 2 * 2 * ROCK_CUTS);
    for (const m of rockMeshes) if (/_cut[0-3]$/.test(m.name)) {
      expect((m as Mesh).useVertexColors).toBe(true);
      expect((m as Mesh).getVerticesData("color")).not.toBeNull();
      expect((m as Mesh).getTotalIndices()).toBe((m as Mesh).getTotalVertices()); // unwelded
    }
    expect(scene.meshes.filter((m) => /^clutter\.grass_/.test(m.name) && /_cut/.test(m.name)).length).toBe(0);
    clutter.dispose(); engine.dispose();
  });

  it("routes each rock instance to the cut its hash names, and the four cuts share the instances", () => {
    const { meshes: clutter, scene, seed, engine } = buildWithAssets();
    clutter.update(35, 21335);
    const counts = [0, 0, 0, 0];
    for (let cut = 0; cut < ROCK_CUTS; cut++) {
      const m = scene.getMeshByName(`clutter.rock_a.node0_cut${cut}`) as Mesh;
      counts[cut] = m.thinInstanceCount;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    // With a uniform hash no cut holds more than 70 % of the instances.
    for (const c of counts) expect(c).toBeLessThanOrEqual(total * 0.7);
    // Each instance's cut is its hash's low bits.
    const insts = collectClutter(seed, 35, 21335)[CLUTTER_ROCK]!.near.filter((i) => i.variant === 0);
    for (let cut = 0; cut < ROCK_CUTS; cut++) expect(counts[cut]).toBe(insts.filter((i) => cutOf(i) === cut).length);
    clutter.dispose(); engine.dispose();
  });

  it("gives LOD1 the same planes as LOD0", () => {
    // reliefMesh is called with the planes the shell derived from LOD0; the
    // shell exposes them through the mesh's metadata for this test.
    const { meshes: clutter, scene, engine } = buildWithAssets();
    const near = scene.getMeshByName("clutter.boulder_a.node0_cut2") as Mesh;
    const far = scene.getMeshByName("clutter.boulder_a.node1_cut2") as Mesh;
    expect((near.metadata as { planes: unknown }).planes).toEqual((far.metadata as { planes: unknown }).planes);
    clutter.dispose(); engine.dispose();
  });
});
```

(The existing `buildWithAssets` names its synthetic meshes per class/variant/lod; the test above assumes `clutter.<model>.node<lod>` — match whatever that helper produces, and give the cut meshes the source's name plus `_cut${cut}`.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

In `clutterMeshes.ts`:

```ts
import { ROCK_CUTS, rockHalfExtent, rockPlanes, rockRelief, type RockPlane } from "./rockRelief.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";

/** The classes cut into fractured stone at load. */
export const CUT_CLASSES: ReadonlySet<number> = new Set([CLUTTER_ROCK, CLUTTER_BOULDER]);
export function cutsFor(cls: number): number { return CUT_CLASSES.has(cls) ? ROCK_CUTS : 1; }
export function cutOf(inst: ClutterInstance): number { return inst.hash & (cutsFor(inst.cls) - 1); }

/** A new mesh carrying `source`'s geometry cut by `planes`, on the source's material with vertex colours on. */
export function reliefMesh(source: Mesh, model: number, cut: number, planes: RockPlane[]): Mesh {
  const positions = source.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
  const normals = source.getVerticesData(VertexBuffer.NormalKind) as Float32Array;
  const uvs = source.getVerticesData(VertexBuffer.UVKind) as Float32Array | null;
  const indices = source.getIndices() as Uint32Array | Uint16Array;
  const g = rockRelief({ positions, normals, uvs, indices }, planes, model, cut);
  const mesh = new Mesh(`${source.name}_cut${cut}`, source.getScene());
  const data = new VertexData();
  data.positions = g.positions; data.normals = g.normals; data.colors = g.colors; data.indices = g.indices;
  if (g.uvs) data.uvs = g.uvs;
  data.applyToMesh(mesh, false);
  mesh.material = source.material;
  mesh.useVertexColors = true;
  mesh.metadata = { planes };
  mesh.refreshBoundingInfo();
  return mesh;
}
```

In `adopt(loaded)`, before building buckets, expand the cut classes: for `cls` in `CUT_CLASSES`, for each variant `m`, take `perLod[0]` (LOD0) and `perLod[1]` (LOD1); derive `planes = rockPlanes(m, cut, rockHalfExtent(LOD0's positions))` per cut; replace the variant's entry by `ROCK_CUTS` entries `[reliefMesh(lod0, m, cut, planes)], [reliefMesh(lod1, m, cut, planes)]`, disable the source meshes, and set `mat.useVertexColors`-equivalent on the material (`PBRMaterial` reads `useVertexColors` from the mesh; nothing on the material). `bucketFor` becomes:

```ts
  function bucketFor(variants: Bucket[][], inst: ClutterInstance, lod: number): Bucket {
    const cuts = cutsFor(inst.cls);
    const perLod = variants[inst.variant * cuts + (inst.hash & (cuts - 1))] ?? (variants[0] as Bucket[]);
    return perLod[lod] as Bucket;
  }
```

`casterMeshes` for boulders now receives the cut meshes. `dispose` already walks every bucket's meshes. The LOD2 meshes the container brought stay disabled as today.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/clutterMeshes.test.ts test/game/renderer.test.ts test/game/bladeMeshes.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add client/src/game/clutterMeshes.ts client/test/game/clutterMeshes.test.ts`, subject `feat: four cuts of every rock and boulder, spread by hash`.

---

### Task 3: Docs and the gates

**Files:**
- Modify: `ARCHITECTURE.md`, `docs/rendering/2026-09-23-rock-relief-design.md`; Create: `docs/rendering/2026-09-23-rock-relief-verification.md`

- [ ] **Step 1: Amend the spec** — an "Amendments" section: the shell draws two LODs (`LOD0` near, `LOD1` far; `LOD2` loaded and unused), so the pass cuts two; and, if Task 1 took it, the roughening along the vertex normal rather than the face normal.
- [ ] **Step 2: `ARCHITECTURE.md`** — in the rendering paragraph, one sentence: rocks and boulders are cut into fractured stone at load (`rockRelief.ts`) — seeded planes, flat facets, a per-facet tone — four ways per model with instances spread across the cuts by hash, inside the collision boxes the sim declares.
- [ ] **Step 3: Gates** — a rock at 2 m (the meadow pose has one at (−213.5, 20.7, 406.5)) and a boulder at 4 m (found by scanning the boulder class, 48 m cells, near a gate pose), clear noon and mist, before/after against `main`; the LOD-swap walk at the boulder as three stills; the 4× pixel pair at TRAILSIDE and EDGE; the load-time pass timed once with `performance.now()` around the adoption in a dev build and reported. Record all in the verification note in the blade-field note's format.
- [ ] **Step 4: Run the whole suite** (`npx vitest run --root client --maxWorkers=3`, server, tools) and `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git add ARCHITECTURE.md docs/rendering/2026-09-23-rock-relief-design.md docs/rendering/2026-09-23-rock-relief-verification.md`, subject `docs: describe the rock relief and record its gates`.

---

## Self-review

**Spec coverage.** §4 the cut → Task 1 (planes, skip rule, shrink, unweld, face normals, roughen, luma, UVs kept, tangents dropped — `reliefMesh` writes no tangents). §5 LODs and buckets → Task 2 (one plane list per (model, cut) passed to both LODs; the cut dimension; vertex colours). §6 tests → Task 1 and Task 2 Step 1. §7 gates → Task 3. §8 fallbacks are the constants in Task 1. The LOD count amendment is recorded in Task 3.

**Placeholders.** None; the synthetic-asset helper's mesh naming is the one thing the implementer reads from the test file rather than from here.

**Type consistency.** `RockArrays` in → `RockCut` out (Task 1) is what `reliefMesh` builds `VertexData` from (Task 2); `rockPlanes(model, cut, halfExtent)` (Task 1) is called once per (model, cut) in `adopt` and stored in `metadata.planes` (Task 2's third test). `cutOf` masks by `cutsFor(cls)`, which is 1 for every class but the two, so `inst.hash & 0` is 0 there and the routing for other classes is unchanged.
