# The grass floor: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the ground under the grass never repeats, has depth near the eye, varies lush-to-dry across the land, and keeps the tufts' density into the distance, all inside the 60 Hz contract and with no new sampler.

**Architecture:** one new GLSL include (`shaders/groundHex.fragment.fx`) holds hex tiling, the lattice hash, the macro noise and the tint; a Babylon-free `groundHexParams.ts` mirrors the constants and the noise for the tufts; the ground plugin's blend block (`terrainTexture.ts`) samples the grass layer through the hex function, folds in a 0.5 m detail scale near the eye, and applies the macro and horizon tints; `clutterMeshes.ts` multiplies each tuft's ground colour by the same macro tint.

**Tech Stack:** Babylon.js 9.18 (`MaterialPluginBase`, GLSL ES 3.00 on WebGL2 — the ground shader already requires WebGL2 for its `sampler2DArray`, so `textureGrad` is available unconditionally), TypeScript, vitest under `NullEngine`.

**Spec:** `docs/rendering/2026-09-16-grass-floor-design.md`. Read it first; every value here comes from it.

## Global Constraints

- Renderer-only: nothing touches `client/src/sim/`; no new sim tunable; the level id is unchanged.
- No new sampler on the terrain material (it is at WebGL2's sixteen); no new texture asset.
- No parallax on the grass layer; hex tiling on the grass layer only.
- GLSL in `client/src/game/shaders/*.fx` where it is a definition block (the hygiene test's glob); the blend block stays a TypeScript template literal as today, because it interpolates constants. In GLSL comments never spell a hashed preprocessor keyword and never put a semicolon in a trailing comment. No `discard`.
- The macro noise and tint are evaluated on the CPU (`groundHexParams.ts`) and the GPU (the `.fx`) from one lattice hash that both compute exactly: `fract(0.618034·ci + 0.381966·cj + 0.0113·ci·cj)` on integer cell indices. The hex offsets/rotations use a GPU-only `sin` hash and are never mirrored.
- `vAlbedoColor` is the material constant; every tint multiplies or `mix`es `surfaceAlbedo`.
- Constants (starting points): `HEX_LATTICE = 1.0` (lattice cells per texture repeat), `HEX_SHARPNESS = 8`, `DETAIL_TILING = 0.5` m, `DETAIL_FADE = [8, 20]` m, `DETAIL_STRENGTH = 0.5`, `DETAIL_NORMAL = 0.5`, `DETAIL_AO = 0.6`, `MACRO_WAVE = [18, 6]` m with weights `[0.65, 0.35]`, `MACRO_SLOPE = 0.6`, `MACRO_LUSH = (0.92, 1.03, 0.90)`, `MACRO_DRY = (1.08, 1.00, 0.82)`, `TUFT_ALBEDO = (0.36, 0.42, 0.24)`, `HORIZON = [35, 90]` m, `HORIZON_MAX = 0.5`.
- Babylon-free files go on `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`.
- Work in a fresh worktree off `origin/main`; stage explicit paths; commit per task with the `github-push` message format and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` verbatim; push only when asked; leak scan before any push.
- Browser gates are paired branch-versus-control samples in both orders; a visual claim needs a control frame.

## File map

| File | Task | Change |
| --- | --- | --- |
| `client/src/game/groundHexParams.ts` | 1 | New. Constants, `latticeHash`, `hexTriangle`, `hexWeights`, `macroNoise`, `macroTint`, `horizonWeight`. |
| `client/test/game/groundHexParams.test.ts` | 1 | New. |
| `client/test/architecture.test.ts` | 1 | Add `groundHexParams.ts`. |
| `client/src/game/shaders/groundHex.fragment.fx` | 2 | New. |
| `client/test/game/groundHex.test.ts` | 2 | New. Lockstep of the GLSL against `groundHexParams.ts`. |
| `client/src/game/terrainTexture.ts` | 3 | Hex-sampled grass layer, the detail scale, the tints, the uniforms. |
| `client/test/game/terrainTexture.test.ts` | 3 | Blend text, uniforms, both-path compile. |
| `client/src/game/clutterMeshes.ts`, `client/test/game/clutterMeshes.test.ts` | 4 | `writeFoliage` × `macroTint`. |
| `ARCHITECTURE.md`, `docs/rendering/2026-09-16-grass-floor-verification.md` | 5 | One sentence; the gate record. |

---

### Task 1: `groundHexParams.ts`, the Babylon-free constants and mirrors

**Files:**
- Create: `client/src/game/groundHexParams.ts`
- Test: `client/test/game/groundHexParams.test.ts`
- Modify: `client/test/architecture.test.ts` (`BABYLON_FREE_FILES`)

**Interfaces:**
- Consumes: `type Rgb` and `clamp01` from `./colour.js`.
- Produces: everything below; Tasks 2, 3 and 4 import from it.

- [ ] **Step 1: Write the failing test**

```ts
// client/test/game/groundHexParams.test.ts
import { describe, it, expect } from "vitest";
import {
  HEX_LATTICE, HEX_SHARPNESS, DETAIL_TILING, DETAIL_FADE, DETAIL_STRENGTH, DETAIL_NORMAL, DETAIL_AO,
  MACRO_WAVE, MACRO_WEIGHT, MACRO_SLOPE, MACRO_LUSH, MACRO_DRY, TUFT_ALBEDO, HORIZON, HORIZON_MAX,
  latticeHash, hexTriangle, hexWeights, macroNoise, macroTint, horizonWeight,
} from "../../src/game/groundHexParams.js";

describe("constants are the spec's", () => {
  it("carries the spec values", () => {
    expect(HEX_LATTICE).toBe(1);
    expect(HEX_SHARPNESS).toBe(8);
    expect(DETAIL_TILING).toBe(0.5);
    expect(DETAIL_FADE).toEqual([8, 20]);
    expect(DETAIL_STRENGTH).toBe(0.5);
    expect(DETAIL_NORMAL).toBe(0.5);
    expect(DETAIL_AO).toBe(0.6);
    expect(MACRO_WAVE).toEqual([18, 6]);
    expect(MACRO_WEIGHT).toEqual([0.65, 0.35]);
    expect(MACRO_SLOPE).toBe(0.6);
    expect(MACRO_LUSH).toEqual({ r: 0.92, g: 1.03, b: 0.9 });
    expect(MACRO_DRY).toEqual({ r: 1.08, g: 1.0, b: 0.82 });
    expect(TUFT_ALBEDO).toEqual({ r: 0.36, g: 0.42, b: 0.24 });
    expect(HORIZON).toEqual([35, 90]);
    expect(HORIZON_MAX).toBe(0.5);
  });
});

describe("latticeHash", () => {
  it("is in [0, 1) and differs between neighbouring cells", () => {
    for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) {
      const h = latticeHash(i, j);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(Math.abs(h - latticeHash(i + 1, j))).toBeGreaterThan(0.01);
      expect(Math.abs(h - latticeHash(i, j + 1))).toBeGreaterThan(0.01);
    }
  });
});

describe("hex lattice", () => {
  it("barycentric weights are non-negative and sum to one everywhere; sharpened weights too", () => {
    for (let y = -3; y < 3; y += 0.093) for (let x = -3; x < 3; x += 0.097) {
      const t = hexTriangle(x, y);
      expect(t.w[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[0] + t.w[1] + t.w[2]).toBeCloseTo(1, 9);
      const s = hexWeights(t.w);
      expect(s[0] + s[1] + s[2]).toBeCloseTo(1, 9);
    }
  });
  it("the three vertices are distinct lattice points and the point lies in their triangle", () => {
    const t = hexTriangle(0.3, 0.2);
    const keys = new Set(t.v.map(([a, b]) => `${a},${b}`));
    expect(keys.size).toBe(3);
    // Reconstruct the skewed point from the vertices and weights.
    const sx = t.v[0][0] * t.w[0] + t.v[1][0] * t.w[1] + t.v[2][0] * t.w[2];
    const sy = t.v[0][1] * t.w[0] + t.v[1][1] * t.w[1] + t.v[2][1] * t.w[2];
    expect(sx).toBeCloseTo(t.skewed[0], 9);
    expect(sy).toBeCloseTo(t.skewed[1], 9);
  });
  it("sharpening keeps two samples dominant: the smallest weight vanishes away from a vertex", () => {
    const s = hexWeights([0.5, 0.4, 0.1]);
    expect(s[2]).toBeLessThan(0.001);
    expect(s[0]).toBeGreaterThan(s[1]);
  });
});

describe("macroNoise and macroTint", () => {
  it("is bounded in [0, 1] and continuous", () => {
    let last = macroNoise(0, 0);
    for (let x = 0; x < 200; x += 0.1) {
      const v = macroNoise(x, 37.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - last)).toBeLessThan(0.05);
      last = v;
    }
  });
  it("varies across a meadow: not constant over 100 m", () => {
    let lo = 1, hi = 0;
    for (let x = 0; x < 100; x += 2) for (let z = 0; z < 100; z += 2) {
      const v = macroNoise(x, z);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeGreaterThan(0.4);
  });
  it("tint is exactly lush at 0 and dry at 1 on flat ground, and slope pushes toward dry", () => {
    expect(macroTint(0, 0, 0, 0)).toEqual(MACRO_LUSH);
    expect(macroTint(0, 0, 1, 0)).toEqual(MACRO_DRY);
    const flat = macroTint(0, 0, 0.3, 0);
    const steep = macroTint(0, 0, 0.3, 0.5);
    expect(steep.r).toBeGreaterThan(flat.r);
    expect(steep.b).toBeLessThan(flat.b);
  });
});

describe("horizonWeight", () => {
  it("is 0 inside HORIZON[0], HORIZON_MAX at and beyond HORIZON[1], smooth between", () => {
    expect(horizonWeight(10)).toBe(0);
    expect(horizonWeight(90)).toBeCloseTo(HORIZON_MAX, 10);
    expect(horizonWeight(200)).toBeCloseTo(HORIZON_MAX, 10);
    const mid = horizonWeight(62.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root client test/game/groundHexParams.test.ts`
Expected: FAIL, cannot resolve `../../src/game/groundHexParams.js`.

- [ ] **Step 3: Write the module**

```ts
// client/src/game/groundHexParams.ts
import { clamp01, type Rgb } from "./colour.js";

/**
 * The grass floor's arithmetic, Babylon-free: hex tiling of the grass layer
 * (the lattice, the barycentric and sharpened weights), the lattice hash the
 * macro noise is built on, the lush/dry macro tint, and the horizon tint's
 * weight. `shaders/groundHex.fragment.fx` carries the GLSL twins and a
 * lockstep test pins them to these constants; `terrainTexture.ts` binds the
 * uniforms; `clutterMeshes.ts` multiplies each tuft's ground colour by
 * `macroTint` so tuft and floor agree by construction.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 *
 * The hex offsets and rotations are hashed on the GPU with a sin hash that is
 * NOT mirrored here: nothing on the CPU needs them. The macro noise IS
 * mirrored, so its hash is a multiply-add-fract on integer cell indices that
 * both sides compute exactly (a sin hash differs across GPUs by more than the
 * tint could hide).
 */

/** Lattice cells per texture repeat. 1 = one hex cell is about one repeat. */
export const HEX_LATTICE = 1;
/** Weight sharpening exponent: two of three samples dominate anywhere. */
export const HEX_SHARPNESS = 8;
/** Metres per repeat of the near-eye detail scale of the grass maps. */
export const DETAIL_TILING = 0.5;
/** Distance band (m) over which the detail scale fades out. */
export const DETAIL_FADE: readonly [number, number] = [8, 20];
/** Albedo modulation strength of the detail scale. */
export const DETAIL_STRENGTH = 0.5;
/** Weight of the detail normal in the perturbation. */
export const DETAIL_NORMAL = 0.5;
/** Between-blades occlusion strength from the detail height. */
export const DETAIL_AO = 0.6;
/** Macro noise wavelengths (m) and their weights. */
export const MACRO_WAVE: readonly [number, number] = [18, 6];
export const MACRO_WEIGHT: readonly [number, number] = [0.65, 0.35];
/** How far slope pushes the macro toward dry (added to the noise per unit of 1 − n.y). */
export const MACRO_SLOPE = 0.6;
export const MACRO_LUSH: Rgb = { r: 0.92, g: 1.03, b: 0.9 };
export const MACRO_DRY: Rgb = { r: 1.08, g: 1.0, b: 0.82 };
/** The tuft colour the far floor blends toward (linear albedo). */
export const TUFT_ALBEDO: Rgb = { r: 0.36, g: 0.42, b: 0.24 };
/** Distance band (m) of the horizon tint, and its cap. */
export const HORIZON: readonly [number, number] = [35, 90];
export const HORIZON_MAX = 0.5;

/** Skew (uv → triangular lattice) and its inverse, column-major as GLSL's mat2. */
export const HEX_SKEW: readonly [number, number, number, number] = [1, 0, -0.57735027, 1.15470054];
export const HEX_UNSKEW: readonly [number, number, number, number] = [1, 0, 0.5, 0.8660254];

function fract(v: number): number {
  return v - Math.floor(v);
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Exact on both CPU and GPU for |ci|, |cj| < 1e4: only multiplies, adds and fract. */
export function latticeHash(ci: number, cj: number): number {
  return fract(0.618034 * ci + 0.381966 * cj + 0.0113 * ci * cj);
}

export type HexTriangle = {
  /** The point in skewed lattice space. */
  skewed: readonly [number, number];
  /** The three lattice vertices (integer, in skewed space). */
  v: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
  /** Their barycentric weights, non-negative, summing to one. */
  w: readonly [number, number, number];
};

/** The triangle of the lattice the uv point falls in, with barycentric weights.
 * Mirrors `hexTriangle` in groundHex.fragment.fx. */
export function hexTriangle(u: number, v: number): HexTriangle {
  const x = u * HEX_LATTICE, y = v * HEX_LATTICE;
  const sx = HEX_SKEW[0] * x + HEX_SKEW[2] * y;
  const sy = HEX_SKEW[1] * x + HEX_SKEW[3] * y;
  const bx = Math.floor(sx), by = Math.floor(sy);
  const fx = sx - bx, fy = sy - by;
  if (fx + fy < 1) {
    return { skewed: [sx, sy], v: [[bx, by], [bx + 1, by], [bx, by + 1]], w: [1 - fx - fy, fx, fy] };
  }
  return { skewed: [sx, sy], v: [[bx + 1, by + 1], [bx + 1, by], [bx, by + 1]], w: [fx + fy - 1, 1 - fy, 1 - fx] };
}

/** The sharpened, renormalised blend weights. */
export function hexWeights(w: readonly [number, number, number]): [number, number, number] {
  const a = Math.pow(Math.max(w[0], 0), HEX_SHARPNESS);
  const b = Math.pow(Math.max(w[1], 0), HEX_SHARPNESS);
  const c = Math.pow(Math.max(w[2], 0), HEX_SHARPNESS);
  const s = Math.max(a + b + c, 1e-9);
  return [a / s, b / s, c / s];
}

/** Value noise on the lattice hash at one wavelength, in [0, 1]. */
function valueNoise(x: number, z: number, wave: number): number {
  const px = x / wave, pz = z / wave;
  const ci = Math.floor(px), cj = Math.floor(pz);
  const fx = smoothstep(0, 1, px - ci), fz = smoothstep(0, 1, pz - cj);
  const a = latticeHash(ci, cj), b = latticeHash(ci + 1, cj);
  const c = latticeHash(ci, cj + 1), d = latticeHash(ci + 1, cj + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

/** Two octaves at MACRO_WAVE, weighted by MACRO_WEIGHT; in [0, 1]. */
export function macroNoise(x: number, z: number): number {
  return MACRO_WEIGHT[0] * valueNoise(x, z, MACRO_WAVE[0]) + MACRO_WEIGHT[1] * valueNoise(x, z, MACRO_WAVE[1]);
}

/** The lush→dry tint at a point: `noise` is `macroNoise(x, z)` (passed in so a
 * test can pin the ends), `slope` is 1 − n.y of the ground normal. */
export function macroTint(x: number, z: number, noise: number, slope: number): Rgb {
  const m = clamp01(noise + MACRO_SLOPE * clamp01(slope));
  return {
    r: MACRO_LUSH.r + (MACRO_DRY.r - MACRO_LUSH.r) * m,
    g: MACRO_LUSH.g + (MACRO_DRY.g - MACRO_LUSH.g) * m,
    b: MACRO_LUSH.b + (MACRO_DRY.b - MACRO_LUSH.b) * m,
  };
}

/** The horizon tint's weight at an eye distance (m), before the grass weight. */
export function horizonWeight(dist: number): number {
  return HORIZON_MAX * smoothstep(HORIZON[0], HORIZON[1], dist);
}
```

`macroTint(x, z, noise, slope)` takes the noise as an argument so `writeFoliage` computes it once and the test pins the ends; the `x, z` parameters are kept for symmetry with the GLSL signature and may be dropped if lint objects to unused parameters (then drop them from the test calls too).

- [ ] **Step 4: Add to `BABYLON_FREE_FILES`** in `client/test/architecture.test.ts` (beside `windParams.ts`).

- [ ] **Step 5: Run** `npx vitest run --root client test/game/groundHexParams.test.ts test/architecture.test.ts` → PASS; `npm run lint && npm run typecheck`.

- [ ] **Step 6: Commit** `feat: the grass floor's hex lattice, macro noise and tints, Babylon-free`.

---

### Task 2: `groundHex.fragment.fx`, the GLSL twins

**Files:**
- Create: `client/src/game/shaders/groundHex.fragment.fx`
- Test: `client/test/game/groundHex.test.ts`

**Interfaces:**
- Consumes: the constants of Task 1 (mirrored as literals).
- Produces: GLSL functions `hexTriangle`, `hexUv`, `hexWeightsSharp`, `hexSample2D`, `hexSampleArray`, `macroNoise`, `macroTint`, `horizonWeight`, used by Task 3. The uniforms they read (`terrainMacro`, `terrainHorizon`) are declared by the plugin (Task 3) before the definitions block, as the wind's are.

- [ ] **Step 1: Write the failing test**

```ts
// client/test/game/groundHex.test.ts
import { describe, it, expect } from "vitest";
import hexFx from "../../src/game/shaders/groundHex.fragment.fx?raw";
import {
  HEX_LATTICE, HEX_SHARPNESS, HEX_SKEW, HEX_UNSKEW, MACRO_WAVE, MACRO_WEIGHT, MACRO_SLOPE,
  MACRO_LUSH, MACRO_DRY,
} from "../../src/game/groundHexParams.js";

function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }
function glslVec3(c: { r: number; g: number; b: number }): string { return `vec3(${glslFloat(c.r)}, ${glslFloat(c.g)}, ${glslFloat(c.b)})`; }

describe("groundHex.fragment.fx stays in lockstep with groundHexParams.ts", () => {
  it("carries the lattice, sharpness and skew matrices verbatim", () => {
    expect(hexFx).toContain(`const float HEX_LATTICE = ${glslFloat(HEX_LATTICE)};`);
    expect(hexFx).toContain(`const float HEX_SHARPNESS = ${glslFloat(HEX_SHARPNESS)};`);
    expect(hexFx).toContain(`const mat2 HEX_SKEW = mat2(${HEX_SKEW.map(glslFloat).join(", ")});`);
    expect(hexFx).toContain(`const mat2 HEX_UNSKEW = mat2(${HEX_UNSKEW.map(glslFloat).join(", ")});`);
  });
  it("carries the lattice hash token for token", () => {
    expect(hexFx).toContain("fract(0.618034 * c.x + 0.381966 * c.y + 0.0113 * c.x * c.y)");
  });
  it("carries the macro octaves, weights, slope push and tints verbatim", () => {
    expect(hexFx).toContain(`const vec2 MACRO_WAVE = vec2(${glslFloat(MACRO_WAVE[0])}, ${glslFloat(MACRO_WAVE[1])});`);
    expect(hexFx).toContain(`const vec2 MACRO_WEIGHT = vec2(${glslFloat(MACRO_WEIGHT[0])}, ${glslFloat(MACRO_WEIGHT[1])});`);
    expect(hexFx).toContain(`const float MACRO_SLOPE = ${glslFloat(MACRO_SLOPE)};`);
    expect(hexFx).toContain(`const vec3 MACRO_LUSH = ${glslVec3(MACRO_LUSH)};`);
    expect(hexFx).toContain(`const vec3 MACRO_DRY = ${glslVec3(MACRO_DRY)};`);
  });
  it("samples with explicit gradients so the hex seams carry no mip discontinuity, and never discards", () => {
    expect(hexFx).toContain("textureGrad(");
    expect(hexFx).not.toContain("discard");
    expect(hexFx).not.toContain("uniform sampler");
  });
});
```

- [ ] **Step 2: Run it to verify it fails** (module missing).

- [ ] **Step 3: Write the shader**

```glsl
// client/src/game/shaders/groundHex.fragment.fx
// The grass floor's GLSL: hex tiling (a triangular lattice over the texture
// repeat, three samples at hashed offsets and rotations, sharpened weights),
// the lattice hash and the two-octave macro noise the lush/dry tint rides on,
// and the horizon tint's weight. Spliced by TerrainTexturePlugin at
// CUSTOM_FRAGMENT_DEFINITIONS after its own uniform declarations, so the
// functions below may read terrainMacro and terrainHorizon. Every constant
// mirrors groundHexParams.ts and a lockstep test asserts they agree.
//
// The hex offsets use a sin hash that only the GPU evaluates. The macro noise
// uses the multiply-add-fract lattice hash the CPU mirrors exactly, because the
// tufts sample the same tint on the CPU and must agree with the floor.
//
// Samples take explicit gradients of the UNROTATED uv, so a hex seam changes
// the texel fetched but not the mip level, and no seam shows as a blur line.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

const float HEX_LATTICE = 1.0;
const float HEX_SHARPNESS = 8.0;
const mat2 HEX_SKEW = mat2(1.0, 0.0, -0.57735027, 1.15470054);
const mat2 HEX_UNSKEW = mat2(1.0, 0.0, 0.5, 0.8660254);
const vec2 MACRO_WAVE = vec2(18.0, 6.0);
const vec2 MACRO_WEIGHT = vec2(0.65, 0.35);
const float MACRO_SLOPE = 0.6;
const vec3 MACRO_LUSH = vec3(0.92, 1.03, 0.9);
const vec3 MACRO_DRY = vec3(1.08, 1.0, 0.82);
const float HEX_TAU = 6.28318531;

// GPU-only: offsets and rotations per lattice vertex. Not mirrored.
float hexHash(vec2 v, float salt) {
  return fract(sin(dot(v + salt, vec2(127.1, 311.7))) * 43758.5453);
}

// The lattice triangle the uv falls in: three integer vertices in skewed
// space and their barycentric weights. Mirrors hexTriangle in groundHexParams.ts.
void hexTriangle(vec2 uv, out vec2 v1, out vec2 v2, out vec2 v3, out vec3 w) {
  vec2 s = HEX_SKEW * (uv * HEX_LATTICE);
  vec2 b = floor(s);
  vec2 f = s - b;
  if (f.x + f.y < 1.0) {
    v1 = b;
    v2 = b + vec2(1.0, 0.0);
    v3 = b + vec2(0.0, 1.0);
    w = vec3(1.0 - f.x - f.y, f.x, f.y);
  } else {
    v1 = b + vec2(1.0, 1.0);
    v2 = b + vec2(1.0, 0.0);
    v3 = b + vec2(0.0, 1.0);
    w = vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
  }
}

// The uv to fetch for vertex v: rotate about the vertex, then offset, both hashed.
vec2 hexUv(vec2 uv, vec2 v) {
  vec2 vp = (HEX_UNSKEW * v) / HEX_LATTICE;
  float a = hexHash(v, 0.0) * HEX_TAU;
  float ca = cos(a);
  float sa = sin(a);
  vec2 d = uv - vp;
  vec2 o = vec2(hexHash(v, 7.3), hexHash(v, 13.1));
  return vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y) + o;
}

vec3 hexWeightsSharp(vec3 w) {
  vec3 s = pow(max(w, vec3(0.0)), vec3(HEX_SHARPNESS));
  return s / max(s.x + s.y + s.z, 1.0e-9);
}

// One hex-tiled fetch of a 2D texture. dx, dy are the gradients of the plain uv.
vec3 hexSample2D(sampler2D tex, vec2 uv, vec2 dx, vec2 dy) {
  vec2 v1; vec2 v2; vec2 v3; vec3 w;
  hexTriangle(uv, v1, v2, v3, w);
  vec3 s = hexWeightsSharp(w);
  return textureGrad(tex, hexUv(uv, v1), dx, dy).rgb * s.x
       + textureGrad(tex, hexUv(uv, v2), dx, dy).rgb * s.y
       + textureGrad(tex, hexUv(uv, v3), dx, dy).rgb * s.z;
}

// The same for one layer of a 2D array (the relief maps).
vec3 hexSampleArray(highp sampler2DArray tex, vec2 uv, float layer, vec2 dx, vec2 dy) {
  vec2 v1; vec2 v2; vec2 v3; vec3 w;
  hexTriangle(uv, v1, v2, v3, w);
  vec3 s = hexWeightsSharp(w);
  return textureGrad(tex, vec3(hexUv(uv, v1), layer), dx, dy).rgb * s.x
       + textureGrad(tex, vec3(hexUv(uv, v2), layer), dx, dy).rgb * s.y
       + textureGrad(tex, vec3(hexUv(uv, v3), layer), dx, dy).rgb * s.z;
}

// Mirrored exactly by latticeHash in groundHexParams.ts.
float latticeHash(vec2 c) {
  return fract(0.618034 * c.x + 0.381966 * c.y + 0.0113 * c.x * c.y);
}

float macroValueNoise(vec2 p, float wave) {
  vec2 q = p / wave;
  vec2 c = floor(q);
  vec2 f = smoothstep(0.0, 1.0, q - c);
  float a = latticeHash(c);
  float b = latticeHash(c + vec2(1.0, 0.0));
  float d = latticeHash(c + vec2(0.0, 1.0));
  float e = latticeHash(c + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

float macroNoise(vec2 p) {
  return MACRO_WEIGHT.x * macroValueNoise(p, MACRO_WAVE.x) + MACRO_WEIGHT.y * macroValueNoise(p, MACRO_WAVE.y);
}

// slope is 1 minus the ground normal's y. Mirrors macroTint in groundHexParams.ts.
vec3 macroTint(float noise, float slope) {
  float m = clamp(noise + MACRO_SLOPE * clamp(slope, 0.0, 1.0), 0.0, 1.0);
  return mix(MACRO_LUSH, MACRO_DRY, m);
}

// terrainHorizon = (start, end, max). Mirrors horizonWeight.
float horizonWeight(float dist) {
  return terrainHorizon.z * smoothstep(terrainHorizon.x, terrainHorizon.y, dist);
}
```

The `highp sampler2DArray` parameter precision matches the plugin's own declaration (see the comment in `TERRAIN_FRAGMENT_DEFS`). `terrainHorizon` is declared by Task 3's uniforms; under NullEngine the shader is never compiled, and the hygiene test only preprocesses, so Task 2's tests pass before Task 3 lands.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/groundHex.test.ts test/game/shaderHygiene.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat: hex tiling, macro noise and the floor tints in GLSL`.

---

### Task 3: the ground plugin samples the grass layer through the hex, adds detail and the tints

**Files:**
- Modify: `client/src/game/terrainTexture.ts` (`TERRAIN_FRAGMENT_DEFS` ~279, `TERRAIN_FRAGMENT_BLEND` ~332–450, `getUniforms` ~600–670, `bindForSubMesh` ~660–700, `getCustomCode` ~767–780)
- Test: `client/test/game/terrainTexture.test.ts`

**Interfaces:**
- Consumes: the constants from Task 1, the GLSL from Task 2 (`?raw` import, spliced into `CUSTOM_FRAGMENT_DEFINITIONS` after `TERRAIN_FRAGMENT_DEFS`).
- Produces: uniforms `terrainDetail` (vec4: repeats per metre of the detail scale, fade start, fade end, strength), `terrainDetail2` (vec2: normal weight, AO strength), `terrainMacro` (vec2: 1, 0 reserved — the macro constants are GLSL literals; this uniform is the on/off gate `terrainMacroOn`), `terrainHorizon` (vec3: start, end, max), `terrainTuft` (vec3: TUFT_ALBEDO).

- [ ] **Step 1: Write the failing tests** (append to `client/test/game/terrainTexture.test.ts`, using its existing plugin construction)

```ts
describe("the grass floor", () => {
  it("declares the floor uniforms and splices the hex include after its own definitions", () => {
    const plugin = makePlugin(); // the file's existing helper that attaches the plugin to a PBRMaterial
    const names = plugin.getUniforms().ubo!.map((u: { name: string }) => u.name);
    expect(names).toEqual(expect.arrayContaining(["terrainDetail", "terrainDetail2", "terrainMacroOn", "terrainHorizon", "terrainTuft"]));
    const defs = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!;
    expect(defs.indexOf("uniform vec3 terrainHorizon;")).toBeLessThan(defs.indexOf("float horizonWeight("));
    expect(defs).toContain("vec3 hexSample2D(");
  });
  it("hex-samples the grass layer and no other, adds the detail scale under its fade, and tints", () => {
    const blend = makePlugin().getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    expect(blend).toContain("hexSample2D(terrainGrass, uvG, gdx, gdy)");
    expect(blend).not.toContain("hexSample2D(terrainFloor");
    expect(blend).not.toContain("hexSample2D(terrainSand");
    expect(blend).not.toContain("hexSample2D(terrainPebble");
    expect(blend).toContain("hexSampleArray(terrainNormals, uvG, 0.0, gdx, gdy)");
    expect(blend).toContain("hexSampleArray(terrainRAH, uvG, 0.0, gdx, gdy)");
    expect(blend).toContain("smoothstep(terrainDetail.y, terrainDetail.z, dist)");
    expect(blend).toContain("macroTint(macroNoise(vPositionW.xz), 1.0 - terrainN.y)");
    expect(blend).toContain("horizonWeight(dist)");
    expect(blend).not.toContain("discard");
  });
  it("binds the floor constants", () => {
    const { plugin, ubo, writes } = makeBoundPlugin(); // the file's fake-UBO idiom, or extend it: record updateFloat2/3/4 by name
    expect(writes.terrainDetail).toEqual([1 / DETAIL_TILING, DETAIL_FADE[0], DETAIL_FADE[1], DETAIL_STRENGTH]);
    expect(writes.terrainDetail2).toEqual([DETAIL_NORMAL, DETAIL_AO]);
    expect(writes.terrainHorizon).toEqual([HORIZON[0], HORIZON[1], HORIZON_MAX]);
    expect(writes.terrainTuft).toEqual([TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b]);
    expect(writes.terrainMacroOn).toBe(1);
  });
});
```

`makePlugin()` and `makeBoundPlugin()` do not exist in the file yet: write them at the top of the new `describe` — `makePlugin` attaches `TerrainTexturePlugin` to a fresh `PBRMaterial` the way the file's first test does and returns the plugin; `makeBoundPlugin` additionally calls `bindForSubMesh` with a fake uniform buffer (an object whose `updateFloat`, `updateFloat2`, `updateFloat3`, `updateFloat4` record `[args...]` by name, and whose `setTexture` is a no-op), the pattern `foliagePlugin.test.ts` uses. Keep the existing both-path compile test (or add one on the `atmosphere.test.ts` pattern if the file lacks it) so the new identifiers are proven to reach the compiled fragment on WebGL 1 and 2 under NullEngine.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

1. Imports: `import groundHexFx from "./shaders/groundHex.fragment.fx?raw";` and the constants from `./groundHexParams.js`.
2. `getUniforms().ubo` gains `terrainDetail` (vec4), `terrainDetail2` (vec2), `terrainMacroOn` (float), `terrainHorizon` (vec3), `terrainTuft` (vec3); the non-UBO declaration string gains the matching `uniform` lines inside the `TERRAINTEX` block.
3. `bindForSubMesh`: `updateFloat4("terrainDetail", 1 / DETAIL_TILING, DETAIL_FADE[0], DETAIL_FADE[1], DETAIL_STRENGTH)`, `updateFloat2("terrainDetail2", DETAIL_NORMAL, DETAIL_AO)`, `updateFloat("terrainMacroOn", 1)`, `updateFloat3("terrainHorizon", HORIZON[0], HORIZON[1], HORIZON_MAX)`, `updateFloat3("terrainTuft", TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b)`.
4. `getCustomCode("fragment").CUSTOM_FRAGMENT_DEFINITIONS` becomes `TERRAIN_FRAGMENT_DEFS + groundHexFx + ROAD_FRAGMENT_DEFS + …` (the hex include after the plugin's uniforms, before the paints).
5. In `TERRAIN_FRAGMENT_BLEND`:
   - Right after `vec2 uvP = …;` add `vec2 gdx = dFdx(uvG); vec2 gdy = dFdy(uvG);`.
   - Inside the `if (strength > 0.0)` relief block replace the grass fetches:
     `rah0 = hexSampleArray(terrainRAH, uvG, 0.0, gdx, gdy);` and
     `vec3 t0 = hexSampleArray(terrainNormals, uvG, 0.0, gdx, gdy) * 2.0 - 1.0;`.
   - In `blended` replace `texture2D(terrainGrass, uvG).rgb` with `hexSample2D(terrainGrass, uvG, gdx, gdy)`.
   - **Detail scale**, inside the relief block after the normals are read and before `nrm = normalize(...)`:
     ```glsl
     float detailStrength = w0 * (1.0 - smoothstep(terrainDetail.y, terrainDetail.z, dist)) * terrainReliefOn;
     vec3 detailAlbedo = vec3(1.0);
     float detailAo = 1.0;
     if (detailStrength > 0.0) {
       vec2 uvD = uvXZ * terrainDetail.x;
       vec2 ddx = dFdx(uvD); vec2 ddy = dFdy(uvD);
       detailAlbedo = mix(vec3(1.0), hexSample2D(terrainGrass, uvD, ddx, ddy) * ${meanInv("grass")}, terrainDetail.w * detailStrength);
       vec3 tD = hexSampleArray(terrainNormals, uvD, 0.0, ddx, ddy) * 2.0 - 1.0;
       planar += tD.xy * terrainDetail2.x * detailStrength;
       float hD = hexSampleArray(terrainRAH, uvD, 0.0, ddx, ddy).b;
       detailAo = mix(1.0, smoothstep(0.0, 0.6, hD), terrainDetail2.y * detailStrength);
     }
     ```
     (`planar` is the existing planar normal sum; add the detail term before `pert` is formed.) Then multiply `detailAlbedo` and `detailAo` into the albedo line: `surfaceAlbedo *= mix(vec3(1.0), blended, strength) * detailAlbedo * mix(1.0, ao / 0.5, strength) * detailAo;`. Declare `detailAlbedo`/`detailAo` before the `if (strength > 0.0)` block so they exist when it does not run.
   - **Macro tint**, after the albedo multiply: `vec3 macro = macroTint(macroNoise(vPositionW.xz), 1.0 - terrainN.y); surfaceAlbedo *= mix(vec3(1.0), macro, w0 * terrainMacroOn * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist)));`.
   - **Horizon tint**, next line: `surfaceAlbedo = mix(surfaceAlbedo, terrainTuft, w0 * horizonWeight(dist));`.
6. The file-head comment gains one paragraph on the floor (hex tiling of the grass layer, the detail scale, the two tints) and why no parallax on grass.

- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npx vitest run --root client test/game/terrainTexture.test.ts test/game/shaderHygiene.test.ts test/game/groundHex.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat: the grass floor never repeats, gains depth near the eye and varies across the land`.

---

### Task 4: the tufts agree with the floor

**Files:**
- Modify: `client/src/game/clutterMeshes.ts` (`writeFoliage` ~339)
- Test: `client/test/game/clutterMeshes.test.ts` (the "writes the ground colour and the canopy shade per grass instance" test)

- [ ] **Step 1: Extend the test**: for a known instance, the written rgb equals `surfaceAlbedo(...) × macroTint(x, z, macroNoise(x, z), 1 − ny)` component-wise, where `ny = 1 / sqrt(1 + dx² + dz²)` from the instance's `groundDx/groundDz` (the same slope the ground's vertex normal expresses). Run: FAIL.

- [ ] **Step 2: Implement** in `writeFoliage`:
```ts
const ny = 1 / Math.sqrt(1 + inst.groundDx * inst.groundDx + inst.groundDz * inst.groundDz);
const tint = macroTint(inst.x, inst.z, macroNoise(inst.x, inst.z), 1 - ny);
buf[offset] = c.r * tint.r; buf[offset + 1] = c.g * tint.g; buf[offset + 2] = c.b * tint.b;
```
with a comment: the floor applies the same tint in `terrainTexture.ts`, so a tuft and the ground under it agree by construction. `forestMeshes.ts`'s `treeFoliageBuffer` (the understory) gets the same two lines.

- [ ] **Step 3: Run** `npx vitest run --root client test/game/clutterMeshes.test.ts test/game/forestMeshes.test.ts` → PASS; lint; typecheck.

- [ ] **Step 4: Commit** `feat: the tufts take the floor's lush and dry patches`.

---

### Task 5: docs and the browser gates

- [ ] **Step 1: `ARCHITECTURE.md`**, Rendering paragraph, after the wind sentence: "The grass floor is hex-tiled from the same 2 m texture (`groundHexParams.ts`, `shaders/groundHex.fragment.fx`), gains a finer scale near the eye, and carries a lush-to-dry macro tint the tufts share."
- [ ] **Step 2: The gates**, run by the controller with the rig from the previous round (both builds on their own ports, the gate hooks reverted before commit, the chrome-devtools CLI, one page at a time), at the viewpoints the previous verification doc lists, paired in both orders, plus a crop of the floor at 5–15 m and a 60–110 m look-out at the meadow: (1) meadow noon — repeat, blade mat, horizon, the frame gate at native and 1.5× scaling; (2) forest edge — patches and tuft/floor agreement; (3) trail eerie 20 h lamp on — no sparkle or banding from the detail term; (4) deep forest — frame pair.
- [ ] **Step 3: `docs/rendering/2026-09-16-grass-floor-verification.md`** with the pairs, verdicts, frame names and any constant changed by tuning (also recorded in the spec's amendments section).
- [ ] **Step 4: Gates** `npm run typecheck && npm run lint && npm test`, leak scan, blob check. Commit `docs: grass floor — architecture note and browser verification`. Do not push; report.

---

## Self-review

**Spec coverage.** §4 hex tiling → Tasks 1–3. §5 detail scale → Tasks 1–3. §6 macro and horizon tints → Tasks 1–4 (the tufts' agreement is Task 4). §7 cost → the gate in Task 5. §8 tests → each task's step 1 plus the both-path compile in Task 3. §9 gates and §10 fallbacks → Task 5. §11 follow-ups need no task.

**Placeholders.** Task 3's tests name `makePlugin`/`makeBoundPlugin` as the file's helpers and say what to write if they are missing. No "TBD".

**Type consistency.** `macroTint(x, z, noise, slope)` and `macroNoise(x, z)` are used identically in Tasks 1, 3 (GLSL `macroTint(noise, slope)` takes two arguments — the GLSL has no `x, z`; the lockstep test pins constants, not signatures) and 4. `HORIZON`, `HORIZON_MAX`, `DETAIL_*`, `TUFT_ALBEDO` appear in Tasks 1 and 3 with the same names.

## Amendments (decisions made during execution)

- **Task 1, `macroTint`.** The signature is `macroTint(noise, slope)`; the plan's unused `x, z` parameters were dropped (this repo's lint rejects unused parameters).
- **Task 2 → 3, the lattice is computed once per scale.** `hexSample2D`/`hexSampleArray` each recompute the triangle, the sharpened weights and the three hashed uvs, and the blend would have called them six times per pixel. The GLSL gained `hexSetup(uv, out u1, u2, u3, out s)` and thin `hexFetch2D`/`hexFetchArray` fetchers; the blend sets up once for the 2 m scale and once for the detail scale. The wrappers stay for the lockstep tests.
- **Task 3, the macro uniform.** There is one macro uniform, `terrainMacroOn` (a float gate); the tint constants are GLSL literals.
- **Task 5, the browser gates retuned the floor.** The near-eye detail term could not be seen at any strength: the grass maps are 512 px over 2 m, their albedo carries about ±3 % visible contrast at a 3–6 m footprint, and `smoothstep(0.0, 0.6, h)` sits near 1 over a height channel packed around 0.5. The detail albedo term and `DETAIL_STRENGTH` are gone; `DETAIL_TILING` is 1 m; the occlusion curve is `smoothstep(DETAIL_AO_RANGE[0], DETAIL_AO_RANGE[1], h)` with `DETAIL_AO_RANGE = [0.3, 0.7]` and `DETAIL_AO = 0.7`. The macro range widened to `MACRO_LUSH = (0.82, 1.06, 0.84)`, `MACRO_DRY = (1.18, 0.98, 0.70)`. `TUFT_ALBEDO` is `(0.18, 0.22, 0.11)`: the far field is already brighter than the tufted band, so a bright target widened the step. The 2 m hex lattice and its fetches are gated on the grass vertex weight; non-grass fragments take one plain fetch of the grass relief so the height blend keeps its shape.
