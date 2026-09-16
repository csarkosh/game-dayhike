# Blade Clumps Near the Eye Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real blade geometry inside 12 m of the eye on the meadow lattice, handing off to today's cards over 7.5–12 m with no pop, plus 4× MSAA on the first pass of the post chain for the high and medium tiers.

**Architecture:** A pure module generates one clump mesh (24 blades, one static `blade` vec4 per vertex). The meadow clutter class gets a third, renderer-only thin-instance bucket of that mesh on its own instances, sorted nearest-first, collected out to 12 m plus the stale-origin pad. The foliage plugin gains a `blades` profile flag: under it each blade shrinks to its root by eye distance in the order of its random, while the meadow near card bucket dithers in over the same band. `post.ts` sets `samples` on the chain's first pass. No sim change, no level id.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`MaterialPluginBase`, thin instances, `VertexData`, `PostProcess.samples`), GLSL in `shaders/*.fx`, vitest with `NullEngine`.

**Spec:** `docs/rendering/2026-09-16-blade-clumps-design.md`

## Global Constraints

- Renderer-only: nothing touches `client/src/sim/`, `windParams.ts`, `distanceFadePlugin.ts`, the foliage plugin's fragment stage, or any tunables registry. The level id does not move; `client/test/sim/groundGradient.test.ts` stays green untouched.
- No new asset, no LFS object, no catalog or credits entry: the clump mesh is built in code. No texture on the blade material, no alpha, no `discard` anywhere in a shader the blade material compiles.
- `bladeClump.ts` is Babylon-free and on `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`. It may import `groundHexParams.ts` and `colour.ts` (both Babylon-free).
- Constants, verbatim from the spec: `BLADE_RADIUS = 12`, `bladeEdges() = { start: 7.5, end: 12 }`, `BLADE_PAD = √2·(3 + 0.7)`, `BLADE_COUNT = 24`, `BLADE_RINGS = 4` (9 vertices and 7 triangles per blade; 216 vertices, 168 triangles per clump), `BLADE_CLUMP_RADIUS = 0.3`, `BLADE_HEIGHT = [0.35, 0.6]`, `BLADE_WIDTH = 0.02`, `BLADE_DROOP = [0.1, 0.5]`, `BLADE_ROUND = 0.5`, `BLADE_TIP_TINT = (1.05, 1.0, 0.8)`, `BLADE_LUMA = 0.2`, `BLADE_SOFT = 0.15` (`FOLIAGE_BLADE_SOFT` in GLSL), `MSAA_SAMPLES = 4`, profile `BLADES = { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: true }`, material albedo `TUFT_ALBEDO`, metallic 0, roughness 0.8, two-sided.
- GLSL rules (`shaderHygiene.test.ts`): no comment spelling a preprocessor directive, no semicolon inside a trailing comment on a code line. Every new uniform (there are none in this plan) would need both the `getUniforms().ubo` list and the non-UBO string. Shader constants are mirrored in TypeScript and pinned by the lockstep test with the `glslFloat` printer.
- Plugin attach stays idempotent (`attachFoliage`, `attachFoliageLight`, `attachDistanceFade` all return early on a second call). The blade material never receives `attachDistanceFade`.
- Public repository: no code comment, doc or commit message mentions how an asset was made, the private design process, sessions, agents, reviews, screenshots or "the owner".
- Commit messages: type-prefixed subject under 72 chars, a `## What` paragraph, a `## How` list led by backticked paths, then one blank line, then the final line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Stage explicit paths only (never `git add -A` or `git add .`). Tests are run per file (`npx vitest run <file>`); the full suite is the controller's.
- Docs under `docs/` are named `YYYY-MM-DD-<topic>.md`; new docs here are dated 2026-09-16.

---

## File map

| File | Task | Change |
| --- | --- | --- |
| `client/src/game/bladeClump.ts` (new) | 1 | The constants, `bladeClumpGeometry()`, `bladeAlive()`. |
| `client/test/game/bladeClump.test.ts` (new), `client/test/architecture.test.ts` | 1 | Geometry shape; Babylon-free listing. |
| `client/src/game/clutterField.ts` | 2 | `BLADE_RADIUS`, `BLADE_BAND`, `BLADE_PAD`, `bladeEdges()`; the `blades` list on `ClutterBands`; `bladeReach` on the walk, both wrappers and the collector. |
| `client/test/game/clutterField.test.ts` | 2 | Membership, order, the pad property, the edges. |
| `client/src/game/foliagePlugin.ts`, `shaders/foliage.vertex.fx`, `shaders/foliageWorldPos.vertex.fx` | 3 | `blades` on the profile, `FOLIAGE_BLADES`, the `blade` attribute, the collapse, the motion weight and sink under the gate. |
| `client/test/game/foliagePlugin.test.ts` | 3 | Profile table, defines, attribute gating, lockstep, both-path compile. |
| `client/src/game/clutterMeshes.ts`, `client/src/game/renderer.ts` | 4 | The blade mesh and material, the meadow's third bucket, the `blades` option, the card in-band; the tier wiring. |
| `client/test/game/clutterMeshes.test.ts` | 4 | Bucket presence, matrices, bands, plugins, the mirrored collapse. |
| `client/src/game/postParams.ts`, `client/src/game/post.ts` | 5 | `MSAA_SAMPLES`; `samples` on the first pass. |
| `client/test/game/post.test.ts` | 5 | The first pass carries the count when the caps allow. |
| `ARCHITECTURE.md`, `docs/rendering/2026-09-16-blade-clumps-verification.md` (new) | 6 | One sentence; the verification record. |

---

### Task 1: the clump geometry

**Files:**
- Create: `client/src/game/bladeClump.ts`
- Modify: `client/test/architecture.test.ts:105-128` (`BABYLON_FREE_FILES`)
- Test: `client/test/game/bladeClump.test.ts` (new)

**Interfaces:**
- Consumes: `latticeHash(ci, cj): number` from `./groundHexParams.js` (`fract(0.618034·ci + 0.381966·cj + 0.0113·ci·cj)`), `clamp01` and `type Rgb` from `./colour.js`.
- Produces: every constant in the Global Constraints' geometry list; `BLADE_VERTS = 9`, `BLADE_TRIS = 7`; `export type BladeClumpGeometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array; blade: Float32Array }`; `export function bladeClumpGeometry(): BladeClumpGeometry`; `export function bladeAlive(random: number, thin: number): number`. Task 3 imports `BLADE_SOFT` and `bladeAlive`; Task 4 imports `bladeClumpGeometry` and `BLADE_VERTS`.

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/bladeClump.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BLADE_CLUMP_RADIUS, BLADE_COUNT, BLADE_HEIGHT, BLADE_RINGS, BLADE_SOFT, BLADE_TRIS, BLADE_VERTS,
  bladeAlive, bladeClumpGeometry,
} from "../../src/game/bladeClump.js";

describe("the blade clump geometry", () => {
  const g = bladeClumpGeometry();
  const vertexCount = g.positions.length / 3;

  it("has 24 blades of 9 vertices and 7 triangles: 216 vertices, 168 triangles", () => {
    expect(BLADE_VERTS).toBe(BLADE_RINGS * 2 + 1);
    expect(BLADE_TRIS).toBe((BLADE_RINGS - 1) * 2 + 1);
    expect(vertexCount).toBe(BLADE_COUNT * BLADE_VERTS);
    expect(vertexCount).toBe(216);
    expect(g.indices.length).toBe(BLADE_COUNT * BLADE_TRIS * 3);
    expect(g.indices.length / 3).toBe(168);
    expect(g.normals.length).toBe(vertexCount * 3);
    expect(g.colors.length).toBe(vertexCount * 4);
    expect(g.blade.length).toBe(vertexCount * 4);
    for (const i of g.indices) expect(i).toBeLessThan(vertexCount);
  });

  it("roots every blade at y = 0 inside the clump radius, and the attribute carries that root", () => {
    for (let b = 0; b < BLADE_COUNT; b++) {
      const v0 = b * BLADE_VERTS;
      for (const v of [v0, v0 + 1]) {
        expect(g.positions[v * 3 + 1]).toBe(0);
        const rx = g.blade[v * 4]!, rz = g.blade[v * 4 + 1]!;
        expect(Math.hypot(rx, rz)).toBeLessThanOrEqual(BLADE_CLUMP_RADIUS + 1e-9);
        // The two root vertices straddle the root by the half-width.
        expect(Math.hypot(g.positions[v * 3]! - rx, g.positions[v * 3 + 2]! - rz)).toBeCloseTo(0.02, 9);
      }
      // Every vertex of the blade names the same root.
      for (let v = v0; v < v0 + BLADE_VERTS; v++) {
        expect(g.blade[v * 4]).toBe(g.blade[v0 * 4]);
        expect(g.blade[v * 4 + 1]).toBe(g.blade[v0 * 4 + 1]);
        expect(g.blade[v * 4 + 2]).toBe(g.blade[v0 * 4 + 2]);
      }
    }
  });

  it("puts the tip at the blade's own height inside BLADE_HEIGHT, with the height fraction rising ring by ring", () => {
    const heights = new Set<number>();
    for (let b = 0; b < BLADE_COUNT; b++) {
      const v0 = b * BLADE_VERTS;
      const tip = v0 + BLADE_VERTS - 1;
      const h = g.positions[tip * 3 + 1]!;
      expect(h).toBeGreaterThanOrEqual(BLADE_HEIGHT[0]);
      expect(h).toBeLessThanOrEqual(BLADE_HEIGHT[1]);
      heights.add(Math.round(h * 1e6));
      for (let k = 0; k < BLADE_RINGS; k++) {
        expect(g.blade[(v0 + 2 * k) * 4 + 3]).toBeCloseTo(k / BLADE_RINGS, 9);
        expect(g.blade[(v0 + 2 * k + 1) * 4 + 3]).toBeCloseTo(k / BLADE_RINGS, 9);
      }
      expect(g.blade[tip * 4 + 3]).toBe(1);
      // The tip tapers to a point: the tip is one vertex, not a pair.
      expect(g.positions[tip * 3]).not.toBeNaN();
    }
    expect(heights.size).toBeGreaterThan(BLADE_COUNT / 2);
  });

  it("gives every blade a random in [0, 1), spread across the clump", () => {
    const randoms: number[] = [];
    for (let b = 0; b < BLADE_COUNT; b++) randoms.push(g.blade[b * BLADE_VERTS * 4 + 2]!);
    for (const r of randoms) { expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThan(1); }
    expect(Math.min(...randoms)).toBeLessThan(0.2);
    expect(Math.max(...randoms)).toBeGreaterThan(0.8);
  });

  it("has unit normals rolled to both sides of the strip", () => {
    for (let v = 0; v < vertexCount; v++) {
      const n = Math.hypot(g.normals[v * 3]!, g.normals[v * 3 + 1]!, g.normals[v * 3 + 2]!);
      expect(n).toBeCloseTo(1, 6);
    }
    // The two root vertices of a blade carry different normals (the roll).
    const dot = g.normals[0]! * g.normals[3]! + g.normals[1]! * g.normals[4]! + g.normals[2]! * g.normals[5]!;
    expect(dot).toBeLessThan(0.999);
    expect(dot).toBeGreaterThan(0);
  });

  it("tints the tip paler and yellower than the root, with a per-blade luma spread", () => {
    const rootB = g.colors.subarray(0, 4), tipB = g.colors.subarray((BLADE_VERTS - 1) * 4, BLADE_VERTS * 4);
    expect(tipB[2]! / tipB[0]!).toBeLessThan(rootB[2]! / rootB[0]!);
    expect(rootB[3]).toBe(1);
    const lumas = new Set<number>();
    for (let b = 0; b < BLADE_COUNT; b++) lumas.add(Math.round(g.colors[b * BLADE_VERTS * 4]! * 1e6));
    expect(lumas.size).toBeGreaterThan(BLADE_COUNT / 2);
  });

  it("is deterministic", () => {
    const h = bladeClumpGeometry();
    expect(Array.from(h.positions)).toEqual(Array.from(g.positions));
    expect(Array.from(h.blade)).toEqual(Array.from(g.blade));
  });
});

describe("bladeAlive, the mirror of the collapse", () => {
  it("keeps every blade whole at thin 0 and collapses every blade at thin 1", () => {
    for (const r of [0, 0.01, 0.5, 0.85, 0.999]) {
      expect(bladeAlive(r, 0)).toBe(1);
      expect(bladeAlive(r, 1)).toBe(0);
    }
  });
  it("is non-increasing in thin and later for a larger random", () => {
    for (const r of [0.2, 0.6]) {
      let prev = 1;
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const a = bladeAlive(r, t);
        expect(a).toBeLessThanOrEqual(prev + 1e-12);
        prev = a;
      }
    }
    expect(bladeAlive(0.6, 0.5)).toBeGreaterThan(bladeAlive(0.2, 0.5));
    // A blade begins to shrink at thin = random / (1 + BLADE_SOFT).
    expect(bladeAlive(0.5, 0.5 / (1 + BLADE_SOFT) - 1e-6)).toBe(1);
    expect(bladeAlive(0.5, 0.5 / (1 + BLADE_SOFT) + 1e-6)).toBeLessThan(1);
  });
});
```

Add `join(SRC, "game", "bladeClump.ts"),` to `BABYLON_FREE_FILES` in `client/test/architecture.test.ts` (after the `escalation.ts` line).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/bladeClump.test.ts client/test/architecture.test.ts`
Expected: FAIL — cannot resolve `../../src/game/bladeClump.js`; the architecture test fails on the missing file.

- [ ] **Step 3: Implement**

Create `client/src/game/bladeClump.ts`:

```ts
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
```

`clamp01` is exported by `client/src/game/colour.ts` (`groundHexParams.ts` imports it the same way).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/bladeClump.test.ts client/test/architecture.test.ts`
Expected: PASS. If the "spread" assertions on randoms or heights fail, the lattice hash's salts 1–6 collided for these 24 indices: change the salts to 11, 13, 17, 19, 23, 29 and rerun; do not weaken the assertions.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/bladeClump.ts client/test/game/bladeClump.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: build the blade clump geometry in code

## What

The mesh the meadow will draw near the eye instead of its card: 24 tapered, drooping
blades on a 0.3 m disc, each a strip of four rings and a tip with its normal rolled to
either side and a per-vertex record of its root, its random and its height fraction.
Generated from constants, so it ships no asset and retunes in one place.

## How

- `client/src/game/bladeClump.ts` — the constants, `bladeClumpGeometry()` (positions,
  normals, vertex colours, indices, the `blade` vec4) and `bladeAlive`, the mirror of
  the shader's per-blade collapse.
- `client/test/game/bladeClump.test.ts` — counts, roots at y = 0 inside the disc, tip
  heights, the monotonic height fraction, unit normals, the tint gradient, determinism,
  and `bladeAlive` at both ends of the band.
- `client/test/architecture.test.ts` — the file is Babylon-free.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: the blade list in the field

**Files:**
- Modify: `client/src/game/clutterField.ts` (constants near `CLUTTER_FADE_MIN_RAMP` at line 200; `ClutterBands` at 232; `collectClutterCore` 252–350; `collectClutter` 359; `collectClutterWithBudgets` 373; `ClutterCollector.collect` 385 and 453)
- Test: `client/test/game/clutterField.test.ts`

**Interfaces:**
- Consumes: `CLUTTER_MEADOW`, `CLUTTER_MEADOW_CELL` (0.7), `CLUTTER_GRASS_CELL` (3) from `../sim/clutter.js`.
- Produces: `export const BLADE_RADIUS = 12`, `export const BLADE_BAND = 4.5`, `export const BLADE_PAD = Math.SQRT2 * (CLUTTER_GRASS_CELL + CLUTTER_MEADOW_CELL)`, `export function bladeEdges(): { start: number; end: number }`; `ClutterBands = { near; far; blades: ClutterInstance[] }[]`; `collectClutter(seed, camX, camZ, radiusScale = 1, bladeReach = 0)`, `collectClutterWithBudgets(seed, camX, camZ, budgets, radiusScale = 1, bladeReach = 0)`, `ClutterCollector.collect(camX, camZ, radiusScale = 1, bladeReach = 0)`. Task 4 passes `BLADE_RADIUS + BLADE_PAD` as `bladeReach` and reads `bands[CLUTTER_MEADOW].blades`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/clutterField.test.ts` (add `BLADE_BAND, BLADE_PAD, BLADE_RADIUS, bladeEdges` to the existing import from `../../src/game/clutterField.js`, and `CLUTTER_GRASS_CELL, CLUTTER_MEADOW, CLUTTER_MEADOW_CELL` to the import from `../../src/sim/clutter.js`; `SEED`, `CAM`, `collectClutter`, `createClutterCollector` and `CLUTTER_FADE_MIN_RAMP` are already there):

```ts
describe("the blade list", () => {
  const REACH = BLADE_RADIUS + BLADE_PAD;

  it("spans a band at least the snap floor wide, ending at BLADE_RADIUS", () => {
    const e = bladeEdges();
    expect(e.end).toBe(BLADE_RADIUS);
    expect(e.start).toBe(BLADE_RADIUS - BLADE_BAND);
    expect(e.end - e.start).toBeGreaterThanOrEqual(CLUTTER_FADE_MIN_RAMP);
    expect(BLADE_PAD).toBeCloseTo(Math.SQRT2 * (CLUTTER_GRASS_CELL + CLUTTER_MEADOW_CELL), 12);
  });

  it("is empty for every class when the reach is 0, and for every class but the meadow otherwise", () => {
    const off = collectClutter(SEED, CAM.x, CAM.z);
    for (const band of off) expect(band.blades).toEqual([]);
    const on = collectClutter(SEED, CAM.x, CAM.z, 1, REACH);
    for (let cls = 0; cls < on.length; cls++) {
      if (cls !== CLUTTER_MEADOW) expect(on[cls]!.blades).toEqual([]);
    }
    expect(on[CLUTTER_MEADOW]!.blades.length).toBeGreaterThan(100);
  });

  it("holds exactly the meadow instances within the reach of the snapped origin, nearest first", () => {
    const on = collectClutter(SEED, CAM.x, CAM.z, 1, REACH);
    const meadow = on[CLUTTER_MEADOW]!;
    const ox = Math.floor(CAM.x / CLUTTER_MEADOW_CELL) * CLUTTER_MEADOW_CELL;
    const oz = Math.floor(CAM.z / CLUTTER_MEADOW_CELL) * CLUTTER_MEADOW_CELL;
    const d2 = (i: { x: number; z: number }) => (i.x - ox) ** 2 + (i.z - oz) ** 2;
    const all = new Set([...meadow.near, ...meadow.far]);
    const want = [...all].filter((i) => d2(i) < REACH * REACH);
    expect(meadow.blades.length).toBe(want.length);
    for (const i of meadow.blades) expect(want).toContain(i);
    for (let k = 1; k < meadow.blades.length; k++) {
      expect(d2(meadow.blades[k]!)).toBeGreaterThanOrEqual(d2(meadow.blades[k - 1]!));
    }
  });

  it("never lets a blade pop: every meadow instance under BLADE_RADIUS of any eye in the rebuild cell is present", () => {
    const collector = createClutterCollector(SEED);
    const bands = collector.collect(CAM.x, CAM.z, 1, REACH);
    const meadow = bands[CLUTTER_MEADOW]!;
    const present = new Set(meadow.blades);
    const cx = Math.floor(CAM.x / CLUTTER_GRASS_CELL) * CLUTTER_GRASS_CELL;
    const cz = Math.floor(CAM.z / CLUTTER_GRASS_CELL) * CLUTTER_GRASS_CELL;
    const eyes = [[0, 0], [2.999, 0], [0, 2.999], [2.999, 2.999], [1.5, 1.5]];
    let checked = 0;
    for (const [ex, ez] of eyes) {
      const eyeX = cx + ex!, eyeZ = cz + ez!;
      for (const inst of [...meadow.near, ...meadow.far]) {
        if (Math.hypot(inst.x - eyeX, inst.z - eyeZ) < BLADE_RADIUS) {
          expect(present.has(inst), `${inst.x},${inst.z} from eye ${eyeX},${eyeZ}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("the memoized collector agrees with the pure function on the blade list", () => {
    const collector = createClutterCollector(SEED);
    const a = collector.collect(CAM.x, CAM.z, 1, REACH)[CLUTTER_MEADOW]!.blades;
    const b = collectClutter(SEED, CAM.x, CAM.z, 1, REACH)[CLUTTER_MEADOW]!.blades;
    expect(a.map((i) => [i.x, i.z])).toEqual(b.map((i) => [i.x, i.z]));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/clutterField.test.ts`
Expected: FAIL — `bladeEdges` is not exported; `band.blades` is undefined.

- [ ] **Step 3: Implement**

In `client/src/game/clutterField.ts`:

1. Extend the import from `../sim/clutter.js` with `CLUTTER_MEADOW` and `CLUTTER_MEADOW_CELL`.

2. After `CLUTTER_FADE_MIN_RAMP` add:

```ts
/** The blade clumps (bladeClump.ts) draw the meadow's instances inside this
 * distance (m) of the eye, on the tiers that create the bucket; the cards
 * take over across the last BLADE_BAND metres. */
export const BLADE_RADIUS = 12;
/** Width (m) of the hand-off band: each blade shrinks to its root and the
 * card at the same cell dithers in across it. Wider than
 * CLUTTER_FADE_MIN_RAMP, as every fade here must be. */
export const BLADE_BAND = 4.5;
/** How far (m) the true eye can sit from the origin the blade distances were
 * measured against: the bucket is rebuilt only on a 3 m grass-cell crossing
 * and its origin is floored to the meadow's own 0.7 m cell, so the worst
 * offset is the diagonal of both. A clump collected out to
 * BLADE_RADIUS + BLADE_PAD is present for every eye inside the rebuild cell,
 * so a blade never pops at the eye; clumps past BLADE_RADIUS are fully
 * collapsed by the shader and cost vertices only. */
export const BLADE_PAD = Math.SQRT2 * (CLUTTER_GRASS_CELL + CLUTTER_MEADOW_CELL);

/** The hand-off band (m of true eye distance): blades whole at `start`, gone
 * at `end`; the meadow near card bucket's in-band is the same pair. */
export function bladeEdges(): { start: number; end: number } {
  return { start: BLADE_RADIUS - BLADE_BAND, end: BLADE_RADIUS };
}
```

3. Change the bands type:

```ts
/** Per class: the near and far LOD lists, and — for the meadow class only,
 * when a blade reach was given — the instances the blade bucket draws,
 * nearest first. Empty otherwise. */
export type ClutterBands = { near: ClutterInstance[]; far: ClutterInstance[]; blades: ClutterInstance[] }[];
```

4. `collectClutterCore` gains a sixth parameter `bladeReach: number` (after `sample`). Inside the class loop, after `const seamHi2 = seamHi * seamHi;`:

```ts
    // The blade list: the meadow's instances within the reach of the snapped
    // origin, gathered on the same walk. Squared like the rest.
    const bladeReach2 = cls === CLUTTER_MEADOW && bladeReach > 0 ? bladeReach * bladeReach : 0;
    const blades: { inst: ClutterInstance; d2: number }[] = [];
```

In the inner loop, right after `if (d2 >= r2) continue;`:

```ts
        if (d2 < bladeReach2) blades.push({ inst, d2 });
```

In the over-budget path, after `near.length = 0; far.length = 0;` add `blades.length = 0;`, and inside its `for (const p of unique)` loop add as the first line `if (p.d2 < bladeReach2) blades.push(p);`. Replace the class's final push with:

```ts
    // Nearest first, so the single-draw blade bucket resolves its own
    // overdraw by the depth test rather than by shading every layer.
    blades.sort((a, b) => a.d2 - b.d2);
    bands.push({ near: near.map((p) => p.inst), far: far.map((p) => p.inst), blades: blades.map((p) => p.inst) });
```

5. Thread the parameter through the three callers:

```ts
export function collectClutter(seed: number, camX: number, camZ: number, radiusScale: number = 1, bladeReach: number = 0): ClutterBands {
  return collectClutterCore(camX, camZ, radiusScale, CLUTTER_BUDGETS, (cls, cx, cz) =>
    clutterInCell(seed, cls, cx, cz), bladeReach,
  );
}
```

`collectClutterWithBudgets` gains `bladeReach: number = 0` after `radiusScale` and passes it last. `ClutterCollector.collect`'s type becomes `collect(camX: number, camZ: number, radiusScale?: number, bladeReach?: number): ClutterBands;` and the implementation `collect(camX: number, camZ: number, radiusScale: number = 1, bladeReach: number = 0)` passes `bladeReach` as the last argument of `collectClutterCore`. Update the `collectClutter` doc comment: "`bladeReach` (m, 0 for none) also fills the meadow class's `blades` list; see `BLADE_PAD`."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/clutterField.test.ts client/test/game/clutterMeshes.test.ts`
Expected: PASS (the meshes test still compiles: it reads `near`/`far` only).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/clutterField.ts client/test/game/clutterField.test.ts
git commit -F - <<'EOF'
feat: collect the meadow's blade list nearest-first

## What

The clutter walk can now also list the meadow instances the blade clumps will draw:
those within a reach of the snapped origin, sorted nearest first so a single draw resolves
its overdraw by depth. The reach the renderer passes is the blade radius plus the worst
stale-origin offset between rebuilds, so every clump under the radius of any eye in the
rebuild cell is present and a blade can never pop at the eye.

## How

- `client/src/game/clutterField.ts` — `BLADE_RADIUS`, `BLADE_BAND`, `BLADE_PAD` and
  `bladeEdges()`; `ClutterBands` gains `blades`; `collectClutterCore` gathers and sorts
  the list on its existing walk and rebuilds it through the budget clamp; the pure
  function, the budgets sibling and the memoizing collector take `bladeReach`.
- `client/test/game/clutterField.test.ts` — the band's width, membership and order, the
  no-pop property over the rebuild cell, and collector/pure agreement.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: the blades profile and the collapse in the foliage plugin

**Files:**
- Modify: `client/src/game/foliagePlugin.ts` (the `FoliageProfile` type at 51–62, `FOLIAGE_PROFILES` 64–71, the constructor defines at 101, `prepareDefines` 112–115, `getAttributes` 118–120)
- Modify: `client/src/game/shaders/foliage.vertex.fx` (the attribute block at the top)
- Modify: `client/src/game/shaders/foliageWorldPos.vertex.fx` (the consts, the motion weight, the sink, the end of the block)
- Test: `client/test/game/foliagePlugin.test.ts`

**Interfaces:**
- Consumes: `BLADE_SOFT` from `./bladeClump.js` (Task 1).
- Produces: `FoliageProfile.blades: boolean`; `FOLIAGE_PROFILES.BLADES`; the define `FOLIAGE_BLADES`; the vertex attribute `blade` (vec4); `export { BLADE_SOFT as FOLIAGE_BLADE_SOFT }`. Task 4 attaches `FOLIAGE_PROFILES.BLADES` to the blade material.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/foliagePlugin.test.ts`:

1. Add `FOLIAGE_BLADE_SOFT` to the import from `../../src/game/foliagePlugin.js`, and `import { BLADE_SOFT } from "../../src/game/bladeClump.js";`.

2. Replace the body of `"FOLIAGE_PROFILES matches the spec's table exactly"` with:

```ts
    expect(FOLIAGE_PROFILES).toEqual({
      GRASS: { amp: 1.0, groundTint: 0.6, rootAO: 0.45, normalRoot: 0, tilt: true, bend: true, blades: false },
      MEADOW: { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: false },
      FLOWER: { amp: 0.83, groundTint: 0.4, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: false },
      BUSH: { amp: 0.5, groundTint: 0.3, rootAO: 0.6, normalRoot: 0, tilt: false, bend: true, blades: false },
      UNDERSTORY: { amp: 0.67, groundTint: 0.4, rootAO: 0.55, normalRoot: 0, tilt: false, bend: true, blades: false },
      TREE: { amp: 0.33, groundTint: 0, rootAO: 1, normalRoot: 0.6, tilt: false, bend: false, blades: false },
      BLADES: { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: true },
    });
```

3. In `"sets FOLIAGE always and FOLIAGE_TINT only for a tinting profile"`, every defines object gains `FOLIAGE_BLADES: false` in its initial value and in its `toEqual` expectation (GRASS: `{ FOLIAGE: true, FOLIAGE_TINT: true, FOLIAGE_BLADES: false }`; TREE: `{ FOLIAGE: true, FOLIAGE_TINT: false, FOLIAGE_BLADES: false }`).

4. Add after that test:

```ts
  it("sets FOLIAGE_BLADES and pushes the blade attribute for the BLADES profile only", () => {
    const blades = new PBRMaterial("b", scene);
    attachFoliage(blades, FOLIAGE_PROFILES.BLADES, 0.6);
    const plugin = blades.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const d: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false };
    plugin.prepareDefines(d as never, scene, undefined as never);
    expect(d).toEqual({ FOLIAGE: true, FOLIAGE_TINT: true, FOLIAGE_BLADES: true });
    const a: string[] = [];
    plugin.getAttributes(a, scene, undefined as never);
    expect(a).toEqual(["foliage", "blade"]);
  });

  it("declares the blade attribute only under FOLIAGE_BLADES, and collapses after the wind", () => {
    expect((vertexDefs.match(/attribute vec4 blade;/g) ?? []).length).toBe(1);
    const attr = vertexDefs.indexOf("attribute vec4 blade;");
    const before = vertexDefs.slice(0, attr);
    expect(before.lastIndexOf("#ifdef FOLIAGE_BLADES")).toBeGreaterThan(before.lastIndexOf("#ifdef FOLIAGE\n"));
    expect(before.slice(before.lastIndexOf("#ifdef FOLIAGE_BLADES"))).not.toContain("#endif");
    // The collapse: the root through finalWorld with no displacement, the
    // thinning on the edges, the alive window, then the vertex pulled to the root.
    expect(vertexWorldPos).toContain(`const float FOLIAGE_BLADE_SOFT = ${glslFloat(FOLIAGE_BLADE_SOFT)};`);
    expect(FOLIAGE_BLADE_SOFT).toBe(BLADE_SOFT);
    expect(vertexWorldPos).toContain("vec3 bRoot = (finalWorld * vec4(blade.x, 0.0, blade.y, 1.0)).xyz;");
    expect(vertexWorldPos).toContain("float bThin = smoothstep(foliageEdges.x, foliageEdges.y, fDist);");
    expect(vertexWorldPos).toContain("float bAlive = clamp((blade.z - bThin * (1.0 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1.0, 0.0, 1.0);");
    expect(vertexWorldPos).toContain("worldPos.xyz = bRoot + (worldPos.xyz - bRoot) * bAlive;");
    // After every displacement: the bend loop and the flutter precede it.
    expect(vertexWorldPos.indexOf("bAlive")).toBeGreaterThan(vertexWorldPos.indexOf("windPlayers[i]"));
    expect(vertexWorldPos.indexOf("bAlive")).toBeGreaterThan(vertexWorldPos.indexOf("fFlutter"));
    // The motion weight ignores the edge term under the gate, and the sink is skipped.
    expect(vertexWorldPos).toContain("float fEdge = 1.0 - smoothstep(foliageEdges.x, foliageEdges.y, fDist);");
    expect(vertexWorldPos).toContain("fEdge = 1.0;");
    expect(vertexWorldPos).toContain("float fM = foliageAmp * fH2 * foliageHeight * fScale * fEdge;");
    expect(vertexWorldPos.indexOf("#ifndef FOLIAGE_BLADES")).toBeLessThan(vertexWorldPos.indexOf("FOLIAGE_SINK * foliageHeight"));
  });
```

5. In the both-paths `describe`, widen `compiledSources` to accept `"GRASS" | "TREE" | "BLADES"` and, when the key is `"BLADES"`, give the box a blade buffer so the attribute has a source: after `mesh.material = material;` add

```ts
    if (profileKey === "BLADES") {
      mesh.setVerticesData("blade", new Float32Array(mesh.getTotalVertices() * 4), false, 4);
    }
```

Then inside the per-version `it`, after the `tree` assertions:

```ts
        const blades = await compiledSources(s, "BLADES");
        expect(blades.vertex).toContain("bAlive");
        expect(blades.vertex).toContain("blade");
        expect(grass.vertex).not.toContain("bAlive");
        expect(blades.fragment).not.toContain("discard");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/foliagePlugin.test.ts`
Expected: FAIL — the profile table has no `blades` fields and no `BLADES`; `FOLIAGE_BLADE_SOFT` is not exported; the GLSL has no `bAlive`.

- [ ] **Step 3: Implement**

`client/src/game/foliagePlugin.ts`:

1. Add `import { BLADE_SOFT } from "./bladeClump.js";` and, beside the other mirrored constants, `export { BLADE_SOFT as FOLIAGE_BLADE_SOFT };` with the comment `/** The per-blade shrink window; lives in bladeClump.ts, mirrored in foliageWorldPos.vertex.fx. */`.

2. `FoliageProfile` gains

```ts
  /** The blade clump mesh: the `blade` attribute is declared, each blade
   * shrinks to its root across `edges` in place of the far sink, and the
   * motion weight ignores the edge term. */
  blades: boolean;
```

3. Every existing profile gains `blades: false`; add `BLADES: { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: true },` after `TREE`.

4. The constructor's defines become `{ FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false }`. `prepareDefines` adds `defines.FOLIAGE_BLADES = this._profile.blades;`. `getAttributes` adds `if (this._profile.blades) attributes.push("blade");` after the `foliage` push.

5. Update the file-head comment's first paragraph: after "(lean, gust, flutter, camera tilt, player bend, far sink)" add "— or, for the blade clumps, a per-blade collapse to the root across the band in place of the sink".

`client/src/game/shaders/foliage.vertex.fx`: after the existing `#endif` pair that closes the `foliage` attribute (before `varying vec4 vFoliage;`), add

```
#ifdef FOLIAGE_BLADES
attribute vec4 blade;
#endif
```

`client/src/game/shaders/foliageWorldPos.vertex.fx`, inside the block:

1. After `const float FOLIAGE_SINK = 0.5;` add `const float FOLIAGE_BLADE_SOFT = 0.15;`.

2. Replace the `fM` line with

```
  float fEdge = 1.0 - smoothstep(foliageEdges.x, foliageEdges.y, fDist);
#ifdef FOLIAGE_BLADES
  fEdge = 1.0;
#endif
  float fM = foliageAmp * fH2 * foliageHeight * fScale * fEdge;
```

3. Wrap the sink line so it reads

```
#ifndef FOLIAGE_BLADES
  worldPos.y -= FOLIAGE_SINK * foliageHeight * smoothstep(foliageEdges.x, foliageEdges.y, fDist);
#endif
```

(it stays inside the existing `FOLIAGE_TINT` gate).

4. Immediately before `vFoliageH = fH;` add

```
#ifdef FOLIAGE_BLADES
  vec3 bRoot = (finalWorld * vec4(blade.x, 0.0, blade.y, 1.0)).xyz;
  float bThin = smoothstep(foliageEdges.x, foliageEdges.y, fDist);
  float bAlive = clamp((blade.z - bThin * (1.0 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1.0, 0.0, 1.0);
  worldPos.xyz = bRoot + (worldPos.xyz - bRoot) * bAlive;
#endif
```

5. Extend the file-head comment's order line to end "…, player bend, far sink, then for the blade clumps the collapse: each blade pulled toward its root by its share of the thinning, last so a collapsed blade's vertices coincide exactly (the root is taken through finalWorld with no displacement)". Keep the COMMENT RULES: no hashed keyword and no semicolon in comment prose.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/foliagePlugin.test.ts client/test/game/shaderHygiene.test.ts client/test/game/foliageLightPlugin.test.ts client/test/game/forestMeshes.test.ts`
Expected: PASS. A `shaderHygiene` failure names the offending comment line: fix the comment, never the rule.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/foliagePlugin.ts client/src/game/shaders/foliage.vertex.fx client/src/game/shaders/foliageWorldPos.vertex.fx client/test/game/foliagePlugin.test.ts
git commit -F - <<'EOF'
feat: give the foliage plugin a blades profile that collapses per blade

## What

A material with the BLADES profile reads the clump mesh's per-vertex `blade` record and,
across the plugin's edge band, shrinks each blade to its own root in the order of its
random instead of sinking the whole instance: the geometric hand-off an opaque mesh needs,
with no discard. The collapse runs after the wind so a collapsed blade is one point, and
blades in the band keep the full wind the cards taking over from them have.

## How

- `client/src/game/foliagePlugin.ts` — `blades` on the profile, the BLADES profile, the
  FOLIAGE_BLADES define, the `blade` attribute, `FOLIAGE_BLADE_SOFT` re-exported from
  bladeClump.ts.
- `client/src/game/shaders/foliage.vertex.fx` — the attribute under the gate.
- `client/src/game/shaders/foliageWorldPos.vertex.fx` — the edge-free motion weight and
  the skipped sink under the gate; the collapse as the block's last displacement.
- `client/test/game/foliagePlugin.test.ts` — the profile table, the define and attribute
  gating, the collapse text and its order, and both shader paths compiling with the gate on.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: the blade bucket, its material and the card in-band

**Files:**
- Modify: `client/src/game/clutterMeshes.ts` (imports 36–83; `ClutterMeshesOptions` 165–174; `Bucket` 194–224; `applyBucket` ~295–320; `rebuild` 480–528; `adopt` 617–668; `dispose` at the end)
- Modify: `client/src/game/renderer.ts:783-786` (the `createClutterMeshes` call)
- Test: `client/test/game/clutterMeshes.test.ts`

**Interfaces:**
- Consumes: `bladeClumpGeometry()`, `BLADE_VERTS`, `bladeAlive` (Task 1); `BLADE_RADIUS`, `BLADE_PAD`, `bladeEdges()`, `ClutterBands.blades`, `collect(x, z, radiusScale, bladeReach)` (Task 2); `FOLIAGE_PROFILES.BLADES` (Task 3); `TUFT_ALBEDO` from `./groundHexParams.js`; `Color3` from `@babylonjs/core/Maths/math.color.js`; `VertexData` from `@babylonjs/core/Meshes/mesh.vertexData.js`; `PBRMaterial` from `@babylonjs/core/Materials/PBR/pbrMaterial.js`.
- Produces: `ClutterMeshesOptions.blades?: boolean`; `export const BLADE_MESH_NAME = "clutter_blades"`; `export const BLADE_BUCKET = 2` (the meadow variant 0's third bucket index); `export function createBladeMesh(scene: Scene): Mesh` (the mesh with its material, before `prepBucketMesh`).

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/clutterMeshes.test.ts` (extend the import from `../../src/game/clutterMeshes.js` with `BLADE_MESH_NAME, createBladeMesh`; add `import { CLUTTER_MEADOW } from "../../src/sim/clutter.js";` — merge into the existing sim import — `import { bladeEdges, BLADE_PAD, BLADE_RADIUS, createClutterCollector } from "../../src/game/clutterField.js";` merged likewise, `import { bladeAlive, bladeClumpGeometry, BLADE_VERTS } from "../../src/game/bladeClump.js";`, `import { FOLIAGE_PROFILES } from "../../src/game/foliagePlugin.js";` merged, and `import { TUFT_ALBEDO } from "../../src/game/groundHexParams.js";` merged):

```ts
describe("the blade bucket", () => {
  function build(blades: boolean): { scene: Scene; assets: Mesh[][][][]; clutter: ReturnType<typeof createClutterMeshes>; engine: NullEngine } {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const assets: Mesh[][][][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      assets.push([0, 1].map((variant) => {
        const material = new PBRMaterial(`blade-c${cls}v${variant}`, scene);
        material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        return [0, 1].map((lod) => {
          const mesh = CreateBox(`blade-c${cls}v${variant}l${lod}`, { size: 0.5 }, scene);
          mesh.material = material;
          return [mesh];
        });
      }));
    }
    const clutter = createClutterMeshes(scene, 1, { assets, blades });
    return { scene, assets, clutter, engine };
  }

  function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
    for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
      const call = spy.mock.calls[k]!;
      if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
    }
    return null;
  }

  it("exists only when asked for, as one opaque mesh with the blade plugins and no fade", () => {
    const off = build(false);
    expect(off.scene.getMeshByName(BLADE_MESH_NAME)).toBeNull();
    off.clutter.dispose();
    off.engine.dispose();

    const on = build(true);
    const mesh = on.scene.getMeshByName(BLADE_MESH_NAME) as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.getTotalVertices()).toBe(bladeClumpGeometry().positions.length / 3);
    expect(mesh.getVerticesData("blade")).not.toBeNull();
    expect(mesh.isVerticesDataPresent("color")).toBe(true);
    const mat = mesh.material as PBRMaterial;
    expect(mat.needAlphaTesting()).toBe(false);
    expect(mat.needAlphaBlending()).toBe(false);
    expect(mat.backFaceCulling).toBe(false);
    expect(mat.metallic).toBe(0);
    expect(mat.roughness).toBe(0.8);
    expect([mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b]).toEqual([TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b]);
    const foliage = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(foliage).toBeInstanceOf(FoliagePlugin);
    expect(mat.pluginManager!.getPlugin("FoliageLight")).not.toBeNull();
    expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
    const e = bladeEdges();
    expect(foliage.edges).toEqual([e.start, e.end]);
    const d: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false };
    foliage.prepareDefines(d as never, on.scene, undefined as never);
    expect(d.FOLIAGE_BLADES).toBe(true);
    on.clutter.dispose();
    // The mesh and its material are the shell's own, not a container's.
    expect(on.scene.getMeshByName(BLADE_MESH_NAME)).toBeNull();
    expect(on.scene.getMaterialByName(`${BLADE_MESH_NAME}_mat`)).toBeNull();
    on.engine.dispose();
  });

  it("draws the field's blade list with the cards' own matrices and tints, and no fadeBands", () => {
    const { scene, assets, clutter, engine } = build(true);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    clutter.update(2500, 2500);
    const mesh = scene.getMeshByName(BLADE_MESH_NAME) as Mesh;
    const blades = createClutterCollector(1).collect(2500, 2500, 1, BLADE_RADIUS + BLADE_PAD)[CLUTTER_MEADOW]!.blades;
    expect(blades.length).toBeGreaterThan(0);
    expect(mesh.thinInstanceCount).toBe(blades.length);
    const matrices = bufferFor(spy, mesh, "matrix")!;
    const tints = bufferFor(spy, mesh, "foliage")!;
    expect(bufferFor(spy, mesh, "fadeBands")).toBeNull();
    const cardNear = assets[CLUTTER_MEADOW]![0]![0]![0]!;
    const cardMatrices = bufferFor(spy, cardNear, "matrix")!;
    const cardTints = bufferFor(spy, cardNear, "foliage")!;
    const cardBlocks = new Set<string>();
    for (let i = 0; i < cardNear.thinInstanceCount; i++) {
      cardBlocks.add(Array.from(cardMatrices.subarray(i * 16, i * 16 + 16)).join(",") + "|" + Array.from(cardTints.subarray(i * 4, i * 4 + 4)).join(","));
    }
    for (let i = 0; i < blades.length; i++) {
      const key = Array.from(matrices.subarray(i * 16, i * 16 + 16)).join(",") + "|" + Array.from(tints.subarray(i * 4, i * 4 + 4)).join(",");
      expect(cardBlocks.has(key), `blade ${i}`).toBe(true);
      // The field's order is the buffer's order: nearest first.
      expect(matrices[i * 16 + 12]).toBeCloseTo(blades[i]!.x, 4);
      expect(matrices[i * 16 + 14]).toBeCloseTo(blades[i]!.z, 4);
    }
    spy.mockRestore();
    clutter.dispose();
    engine.dispose();
  });

  it("gives the meadow near cards the blade band as their in-band when blades are on, and none when off", () => {
    for (const blades of [true, false]) {
      const { scene, assets, clutter, engine } = build(blades);
      const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      clutter.update(2500, 2500);
      const cardNear = assets[CLUTTER_MEADOW]![0]![0]![0]!;
      const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
      expect(cardNear.thinInstanceCount).toBeGreaterThan(0);
      const seam = clutterSeamEdges(CLUTTER_MEADOW);
      const e = bladeEdges();
      const want = (blades ? [e.start, e.end, seam.start, seam.end] : [-2, -1, seam.start, seam.end]).map(Math.fround);
      expect(Array.from(bufferFor(spy, cardNear, "fadeBands")!.subarray(0, 4))).toEqual(want);
      // Only the meadow's near cards change.
      const grassSeam = clutterSeamEdges(CLUTTER_GRASS);
      expect(Array.from(bufferFor(spy, grassNear, "fadeBands")!.subarray(0, 4))).toEqual([-2, -1, grassSeam.start, grassSeam.end].map(Math.fround));
      spy.mockRestore();
      clutter.dispose();
      engine.dispose();
      void scene;
    }
  });

  it("collapses a blade to one world point through the instance matrix at the band's end", () => {
    const g = bladeClumpGeometry();
    const inst = { cls: CLUTTER_MEADOW, x: 3, z: -7, groundH: 12, groundDx: 0, groundDz: 0, scale: 0.8, variant: 0, hash: 0.37 };
    const buf = new Float32Array(16);
    instanceMatrixFor(inst, { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } }, buf);
    const m = Matrix.FromArray(buf);
    const root = Vector3.TransformCoordinates(new Vector3(g.blade[0]!, 0, g.blade[1]!), m);
    const random = g.blade[2]!;
    for (let v = 0; v < BLADE_VERTS; v++) {
      const world = Vector3.TransformCoordinates(new Vector3(g.positions[v * 3]!, g.positions[v * 3 + 1]!, g.positions[v * 3 + 2]!), m);
      const alive = bladeAlive(random, 1);
      const collapsed = root.add(world.subtract(root).scale(alive));
      expect(collapsed.subtract(root).length()).toBeLessThan(1e-6);
      // And whole at the band's start.
      const whole = root.add(world.subtract(root).scale(bladeAlive(random, 0)));
      expect(whole.subtract(world).length()).toBeLessThan(1e-6);
    }
    // The root itself is where the sim put the instance, sunk by CLUTTER_SINK and scaled.
    expect(root.y).toBeCloseTo(12 - CLUTTER_SINK, 6);
    expect(Math.hypot(root.x - 3, root.z + 7)).toBeLessThanOrEqual(0.3 * 0.8 + 1e-6);
  });

  it("createBladeMesh is a plain mesh: the shell adds the bucket flags", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = createBladeMesh(scene);
    expect(mesh.name).toBe(BLADE_MESH_NAME);
    expect(mesh.getIndices()!.length).toBe(bladeClumpGeometry().indices.length);
    expect(mesh.getBoundingInfo().boundingBox.maximum.y).toBeGreaterThan(0.3);
    expect(mesh.getBoundingInfo().boundingBox.maximum.y).toBeLessThanOrEqual(0.6);
    const foliage = (mesh.material as PBRMaterial).pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(foliage).toBeInstanceOf(FoliagePlugin);
    mesh.dispose(false, true);
    engine.dispose();
  });
});
```

`CLUTTER_SINK`, `instanceMatrixFor`, `Matrix`, `Vector3`, `clutterSeamEdges`, `CLUTTER_CLASS_COUNT`, `CLUTTER_GRASS`, `CreateBox`, `PBRMaterial`, `NullEngine`, `Scene`, `Mesh`, `FoliagePlugin` and `vi` are already imported at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/clutterMeshes.test.ts`
Expected: FAIL — `BLADE_MESH_NAME` and `createBladeMesh` are not exported; the `blades` option is unknown.

- [ ] **Step 3: Implement**

`client/src/game/clutterMeshes.ts`:

1. Imports: add `import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";`, `import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";`, `import { Color3 } from "@babylonjs/core/Maths/math.color.js";`, `import { bladeClumpGeometry } from "./bladeClump.js";`; extend the `./clutterField.js` import with `bladeEdges, BLADE_PAD, BLADE_RADIUS`; extend the `./groundHexParams.js` import with `TUFT_ALBEDO`.

2. After `LITTER_VARIANT_SCALE` add:

```ts
/** The blade clump mesh's name, and its bucket's index in the meadow class's
 * variant-0 list, after the two LOD buckets. The bucket exists only when
 * `ClutterMeshesOptions.blades` is set (the tiers above low). */
export const BLADE_MESH_NAME = "clutter_blades";
export const BLADE_BUCKET = 2;
```

3. `ClutterMeshesOptions` gains

```ts
  /** Draw the meadow's near instances as blade clumps (bladeClump.ts) inside
   * BLADE_RADIUS, handing off to the cards across `bladeEdges()`. Off on the
   * low tier, which keeps the cards alone. */
  blades?: boolean;
```

4. `Bucket` gains, after `tints`:

```ts
  /** Set for every GLB bucket, which dithers and so uploads `fadeBands`; the
   * blade bucket is opaque, carries no fade plugin, and uploads none. */
  fades: boolean;
```

`applyBucket` guards both `fadeBands` calls with `if (bucket.fades)`.

5. Add, before `createClutterMeshes`:

```ts
/**
 * The blade clump as a Babylon mesh: the pure geometry through `VertexData`,
 * the `blade` record as a custom vertex buffer (set after `applyToMesh`,
 * which rebuilds the mesh's buffers), and an opaque two-sided PBR material
 * in the tuft colour whose vertex colours carry the per-blade tint. No
 * texture and no alpha, so the material never alpha-tests and never carries
 * a discard: early depth rejection stays on for the whole draw. The foliage
 * plugins attach here with the BLADES profile; the bucket flags and the
 * plugin's edges are the shell's.
 */
export function createBladeMesh(scene: Scene): Mesh {
  const g = bladeClumpGeometry();
  const mesh = new Mesh(BLADE_MESH_NAME, scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.setVerticesData("blade", g.blade, false, 4);
  const mat = new PBRMaterial(`${BLADE_MESH_NAME}_mat`, scene);
  mat.albedoColor = new Color3(TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b);
  mat.metallic = 0;
  mat.roughness = 0.8;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.refreshBoundingInfo();
  attachFoliage(mat, FOLIAGE_PROFILES.BLADES, mesh.getBoundingInfo().boundingBox.maximum.y);
  attachFoliageLight(mat);
  return mesh;
}
```

6. In `createClutterMeshes`: `const blades = options.blades ?? false;` and `const bladeReach = blades ? BLADE_RADIUS + BLADE_PAD : 0;` beside `radiusScale`. Keep `let bladeMesh: Mesh | null = null;` beside `buckets`.

7. `rebuild`: `collector.collect(x, z, radiusScale, bladeReach)`. In the count pass, after the two near/far loops for a class, add

```ts
      if (cls === CLUTTER_MEADOW && bladeMesh !== null) {
        (variants[0] as Bucket[])[BLADE_BUCKET]!.count += band.blades.length;
      }
```

and in the fill pass, after the far loop:

```ts
      if (cls === CLUTTER_MEADOW && bladeMesh !== null) {
        const bucket = (variants[0] as Bucket[])[BLADE_BUCKET] as Bucket;
        for (const inst of band.blades) {
          const frame = trampleFrame(seed, inst);
          writeInstanceMatrix(inst, bucket.buf, bucket.count * 16, frame);
          writeFoliage(seed, inst, bucket.foliage, bucket.count * 4, frame);
          bucket.count++;
        }
      }
```

The `band` variable's type annotation in both passes becomes `{ near: ClutterInstance[]; far: ClutterInstance[]; blades: ClutterInstance[] }`.

8. `adopt`: every returned bucket gains `fades: true`. After the `buckets = loaded.map(...)` statement and before `maybeBuild()`:

```ts
    if (blades) {
      // The meadow's third bucket: the clump mesh on the near instances. Its
      // material's edge band is the hand-off band, and the meadow's near CARD
      // bucket dithers in across the same band (below), so the two sides of
      // the hand-off read one pair of numbers.
      bladeMesh = createBladeMesh(scene);
      prepBucketMesh(bladeMesh);
      const band = bladeEdges();
      setFoliageEdges(bladeMesh.material as Material, [band.start, band.end]);
      (buckets[CLUTTER_MEADOW]![0] as Bucket[])[BLADE_BUCKET] = {
        meshes: [bladeMesh],
        buf: EMPTY_BUFFER,
        bands: EMPTY_BUFFER,
        foliage: EMPTY_BUFFER,
        count: 0,
        grown: false,
        fade: FADE_ALWAYS,
        tints: true,
        fades: false,
      };
    }
```

(`FADE_ALWAYS` joins the `./distanceFadePlugin.js` import; `Material` is a type import from `@babylonjs/core/Materials/material.js`.) In the per-bucket `fade` expression inside `adopt`, the near case becomes

```ts
          const fade: FadeBands = lod === NEAR_LOD
            ? fadeBands(blades && cls === CLUTTER_MEADOW ? [bladeEdges().start, bladeEdges().end] : null, [seam.start, seam.end])
            : fadeBands([seam.start, seam.end], [edge.start, edge.end]);
```

with the comment: "With blades on, the meadow's near cards dither IN across the blade band: inside it the clumps are the grass, and a card fragment there is discarded before any fetch."

9. `dispose`: after the bucket loop, `if (bladeMesh !== null) { bladeMesh.dispose(false, true); bladeMesh = null; }` — the blade mesh and its material are ours, not a container's, so the material is disposed with the mesh.

10. Update the file-head comment: the draw-call paragraph gains "plus one opaque blade-clump draw for the meadow on the tiers that create it".

`client/src/game/renderer.ts`: the call becomes

```ts
      ? createClutterMeshes(scene, forest.seed, { radiusScale: tier === "low" ? 0.6 : undefined, blades: tier !== "low" })
```

and the comment above it gains: "High and medium draw the meadow's near instances as blade clumps; low keeps the cards, whose 1.5× scaling is where blades resolve worst."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/clutterMeshes.test.ts client/test/game/clutterField.test.ts client/test/game/renderer.test.ts`
Expected: PASS. The first `describe` ("attaches the distance fade") still passes: it walks `assets` only, and every GLB bucket still uploads `fadeBands`. If `renderer.test.ts` does not exist, run `npm run typecheck` in its place.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/clutterMeshes.ts client/src/game/renderer.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: draw the meadow's near instances as opaque blade clumps

## What

On the high and medium tiers the meadow's instances inside 12 m are drawn as blade clumps
in one opaque, nearest-first thin-instance draw, with the same matrix, trample and ground
tint as the card at each cell. Across 7.5–12 m the blades shrink to their roots while the
meadow's near cards dither in over the same band, so the hand-off is one instance becoming
its own card; inside the band no card fragment is shaded. Low tier is unchanged.

## How

- `client/src/game/clutterMeshes.ts` — `createBladeMesh` (the geometry through
  `VertexData`, the `blade` buffer, the opaque two-sided tuft-coloured material with the
  BLADES profile); the `blades` option and the reach it passes to the collector; the
  meadow's third bucket, filled from the field's sorted blade list and uploading no
  `fadeBands`; the meadow near cards' in-band from `bladeEdges()`; disposal of the mesh
  and its material.
- `client/src/game/renderer.ts` — `blades: tier !== "low"`.
- `client/test/game/clutterMeshes.test.ts` — the bucket's presence and material, matrices
  and tints matching the cards, no fade buffer, the card in-band on and off, and the
  mirrored collapse to one world point.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: MSAA on the chain's first pass

**Files:**
- Modify: `client/src/game/postParams.ts` (after `postFeaturesFor`)
- Modify: `client/src/game/post.ts` (after the `finish` pass is constructed, inside `if (features.pipeline)`)
- Test: `client/test/game/post.test.ts`

**Interfaces:**
- Produces: `export const MSAA_SAMPLES = 4` in `postParams.ts`.

- [ ] **Step 1: Write the failing test**

Add `MSAA_SAMPLES` to the `postParams.js` import in `client/test/game/post.test.ts` and append inside the existing `describe`:

```ts
  it("multisamples the first pass of the chain when the engine can, and leaves the rest at 1", () => {
    expect(MSAA_SAMPLES).toBe(4);
    for (const tier of ["high", "medium"] as const) {
      // NullEngine reports no MSAA cap; raise it the way a real WebGL2 engine does.
      engine.getCaps().maxMSAASamples = 4;
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      const passes = camera._postProcesses.map((p) => p!);
      expect(passes[0]!.name).toBe(tier === "high" ? "scene" : "grade");
      expect(passes[0]!.samples).toBe(MSAA_SAMPLES);
      for (const p of passes.slice(1)) expect(p.samples, p.name).toBe(1);
      post.dispose();
      camera.dispose();
    }
  });

  it("asks for no multisampling when the engine reports no cap", () => {
    const caps = engine.getCaps() as { maxMSAASamples?: number };
    delete caps.maxMSAASamples;
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("high", true));
    expect(camera._postProcesses[0]!.samples).toBe(1);
    post.dispose();
    camera.dispose();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/test/game/post.test.ts`
Expected: FAIL — `MSAA_SAMPLES` is not exported; the first pass's `samples` is 1.

- [ ] **Step 3: Implement**

`client/src/game/postParams.ts`, after `postFeaturesFor`:

```ts
/** MSAA sample count on the first pass of the chain (the scene pass on high,
 * the grade on medium): that pass's input target is the scene render, so
 * multisampling it multisamples every opaque edge, which is what the blade
 * clumps need. The engine clamps it to its cap; the low tier has no chain
 * and gets none. */
export const MSAA_SAMPLES = 4;
```

`client/src/game/post.ts`: add `MSAA_SAMPLES` to the `./postParams.js` import. After the `finish.onApply = …;` assignment (still inside `if (features.pipeline)`):

```ts
    // The first pass owns the scene's render target. Babylon's setter clamps
    // to the engine's cap, but a NullEngine reports none at all, so ask only
    // where a cap exists; a capped engine (Safari) reads 1 and nothing else
    // changes. FXAA stays for the cards' alpha-test edges, which MSAA does
    // not touch.
    const first = scenePass ?? grade;
    if (first !== null && engine.getCaps().maxMSAASamples > 1) first.samples = MSAA_SAMPLES;
```

`maxMSAASamples` is typed as a plain `number`; on a NullEngine it is `undefined` at runtime, and `undefined > 1` is `false`, which is the guard's whole point.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run client/test/game/post.test.ts client/test/game/postParams.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/postParams.ts client/src/game/post.ts client/test/game/post.test.ts
git commit -F - <<'EOF'
feat: multisample the scene render on the high and medium tiers

## What

The first pass of the post chain now asks for 4x MSAA on its input target, which is the
scene render, so every opaque edge is multisampled before the grade. Blade edges are the
reason; the cards keep FXAA for their alpha-test edges. Engines without a cap are left
alone and the low tier, which has no chain, is unchanged.

## How

- `client/src/game/postParams.ts` — `MSAA_SAMPLES`.
- `client/src/game/post.ts` — `samples` on the scene pass (high) or the grade (medium),
  only where the engine reports an MSAA cap.
- `client/test/game/post.test.ts` — the first pass carries the count with a cap of 4, the
  rest stay at 1, and nothing is asked for without a cap.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 6: the architecture note and the verification record

**Files:**
- Modify: `ARCHITECTURE.md:25` (the rendering paragraph)
- Create: `docs/rendering/2026-09-16-blade-clumps-verification.md`

**Interfaces:** none. The browser gates of the spec's §10 are run by the controller against a control build; this task records their outcome once the controller reports it, and must not claim a result the controller has not given.

- [ ] **Step 1: ARCHITECTURE.md**

In the rendering paragraph (line 25), after "…with litter along its margin and the grass beside it trampled at rebuild." append:

> Inside 12 m on the high and medium tiers the meadow's instances are drawn as opaque blade clumps built in code (`bladeClump.ts`, one nearest-first thin-instance draw), each blade shrinking to its root across 7.5–12 m while the card at the same cell dithers in; the first pass of the post chain is multisampled (`MSAA_SAMPLES`) on those tiers.

Run: `npx vitest run tools/docs/test/docNames.test.mjs` — Expected: PASS (no doc was added yet).

- [ ] **Step 2: The verification doc**

Create `docs/rendering/2026-09-16-blade-clumps-verification.md` with this skeleton, then fill every "—" from the controller's gate report before committing (a "—" left in the file fails the task):

```markdown
# Blade clumps near the eye: verification

**Spec:** [2026-09-16-blade-clumps-design](2026-09-16-blade-clumps-design.md). **Plan:** [2026-09-16-blade-clumps-plan](2026-09-16-blade-clumps-plan.md).

## Tests

`npm test` on an idle machine: — files, — tests, all green. New: `bladeClump.test.ts` (—), and the blade cases in `clutterField.test.ts` (—), `foliagePlugin.test.ts` (—), `clutterMeshes.test.ts` (—), `post.test.ts` (—).

## Browser gates

Branch — against control — (the branch base), same seed, weather and hour on both.

| Gate | Result |
| --- | --- |
| Stills at MEADOW, EDGE, TRAIL, DEEP, noon and 16 h; rain on the trail | — |
| The hand-off: floor crop across 7.5–12 m; two stills 3 m apart; the `/wind 100` strip | — |
| Frame pairs, high tier native, all four poses, both orders, p95 | — |
| Frame pairs, medium tier native, MEADOW and DEEP | — |
| Low tier sanity pair at MEADOW | — |
| Console errors, both builds, both paths | — |

## Retunes

— (each constant changed from the spec's value, its old and new value, and why).
```

- [ ] **Step 3: Run the doc-name test and commit**

Run: `npx vitest run tools/docs/test/docNames.test.mjs`
Expected: PASS.

```bash
git add ARCHITECTURE.md docs/rendering/2026-09-16-blade-clumps-verification.md
git commit -F - <<'EOF'
docs: record the blade clumps in the architecture and their verification

## What

The architecture overview names the blade clumps and the multisampled scene render, and
the verification doc records the test counts, the browser gates against a control build,
the frame pairs and every retune the gates asked for.

## How

- `ARCHITECTURE.md` — one sentence in the rendering paragraph.
- `docs/rendering/2026-09-16-blade-clumps-verification.md` — the record.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

## Self-review

- **Spec coverage.** §4 placement and reach → Task 2 (list, pad, order) and Task 4 (bucket, matrices, tints, no fade). §5 mesh → Task 1 (geometry) and Task 4 (material, `VertexData`, the `blade` buffer). §6 hand-off → Task 3 (collapse, motion weight, sink) and Task 4 (card in-band, opaque draw, nearest-first buffer). §7 shading and wind → Task 3 (profile) and Task 4 (attach, edges); trample rides `instanceMatrixFor` and `writeFoliage` unchanged. §8 MSAA and tiers → Task 5 and Task 4's renderer line. §9 tests → Tasks 1–5 each carry the spec's cases; the architecture listing is in Task 1. §10 gates and §11 fallbacks are the controller's and are recorded by Task 6. §12 follow-ups: none implemented, by design.
- **Placeholders.** The verification skeleton's "—" marks are explicit fill-ins the task forbids leaving; no other placeholder text.
- **Type consistency.** `bladeEdges(): { start, end }` (Task 2) is what Task 4 reads and Task 3's tests reference through the plugin's `edges` pair. `ClutterBands.blades` (Task 2) is what Task 4's `rebuild` reads. `FOLIAGE_PROFILES.BLADES` and the `blades` flag (Task 3) are what Task 4's `createBladeMesh` attaches. `BLADE_SOFT` (Task 1) is re-exported as `FOLIAGE_BLADE_SOFT` (Task 3) and the GLSL literal `0.15` is pinned against it. `bladeAlive(random, thin)` (Task 1) is what Task 4's collapse test mirrors. `Bucket.fades` (Task 4) is set on every GLB bucket and cleared on the blade bucket only.
