# Water material implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the water's per-vertex depth ramp with a physically based water material (per-pixel bed depth, measured attenuation, wind roughness, sky held above the horizon) and a wet look for what the water touches, on all three tiers, within the spec's frame budgets.

**Architecture:** `PBRMaterial` plus a `WaterPlugin` (`MaterialPluginBase`, the house pattern) per body row, fed per frame from a camera-local bed height texture and the weather's wind; a `WetPlugin` on the terrain, prop and character materials keyed on a wet line. The high tier adds a colour copy and a depth read of the opaque pass taken before the water draws. Pure maths lives in Babylon-free modules with Node tests; the GLSL lives in `.fx` files so the hygiene test and the WGSL corpus cover it.

**Tech Stack:** TypeScript, Babylon.js 9.18.0 (`PBRMaterial`, `MaterialPluginBase`, `RawTexture`, `RenderTargetTexture`, `CopyTextureToTexture`), Vite `?raw` shader imports, vitest with `NullEngine`, the WGSL corpus tools in `tools/wgsl/`, the chrome-devtools CLI for browser gates.

**Spec:** `docs/rendering/2026-09-29-water-material-design.md`

## Global Constraints

- Babylon 9.18.0; every shader is GLSL in `client/src/game/shaders/*.fx`, imported with `?raw`; the WGSL corpus is re-recorded after any new material or plugin (`tools/wgsl/merge-corpus.mjs`, pages recorded with `?wgsl=record`).
- No sim change: nothing in this plan touches `client/src/sim/`. The sim's `waterLevel`, `Pond` features and `elevationAt` are read only.
- Budgets (spec §8): 0.5 ms high, 0.3 ms medium, 0.15 ms low, full screen at 1080p, measured with paired frame times, never estimated.
- Spec §5.1 constants: F0 = 0.02; horizon clamp y ≥ +0.02; σ² = 0.003 + 0.00512 U; U = 12 m/s × the game's wind (0 to 1); α = √(2σ²); roughness = √α.
- Spec §5.2 rows: sea Kd (0.34, 0.18, 0.26); lowland lake (1.1, 1.5, 3.5); high lake (0.2, 0.12, 0.2). Transmission e^(−2 Kd d) per channel.
- Spec §6: wet albedo × 0.40, wet roughness 0.15, band 10 cm; `wetLine` = level + 0.3 m.
- Shader comment rules (`shaderHygiene.test.ts`): no semicolon inside a trailing comment on a code line; never spell a hashed preprocessor keyword in comment prose.
- Every `.fx` constant mirrored in TypeScript is pinned by a lockstep test (the `cliffTintPlugin.test.ts` pattern).
- Nothing in the repository describes how the reference photos were gathered or where they are kept; a gate names ids only.
- Worktree `water-spec`, branch `worktree-water-spec`; commits small, one per task step that says "Commit"; the pre-push hook's scan run by hand after the first commit, not only at the push.

## Review Focus

1. A pond whose rim is above the sea level but whose bed texture is centred elsewhere: the water plane must still discard on land (d ≤ 0) using the vertex fallback depth, never draw a grey disc. Pinned in Task 4.
2. The camera crossing a bed-texture re-centre boundary mid-frame: the uniforms (`bedOrigin`) and the texture must change in the same frame, or the waterline jumps a metre for one frame. Pinned in Task 2 (bake returns origin with data) and Task 4 (bind reads the pair atomically).
3. The far sea with no bed texture coverage: alpha must saturate to opaque at the ring's vertex depth, not fall back to 0 (a clear sea to the horizon). Pinned in Task 3's GLSL test and Task 4's mechanism test.
4. Wind at exactly 0 with shelter 1 (the sea in a dead calm): roughness must be Cox and Munk's floor, not 0 (a perfect mirror sea that flashes). Pinned in Task 1.
5. A material that receives `attachWet` twice (prop LOD buckets share materials): one active plugin, never two (double GLSL injection fails to compile). Pinned in Task 5.

---

### Task 1: The pure water maths (`waterShading.ts`)

**Files:**
- Create: `client/src/game/waterShading.ts`
- Test: `client/test/game/waterShading.test.ts`

**Interfaces:**
- Consumes: nothing from the codebase but `clamp01` from `client/src/game/colour.ts`.
- Produces:
  - `type WaterBody = { level: number; kd: [number, number, number]; lInf: [number, number, number]; shelter: number }`
  - `const WATER_ROWS: { sea: Omit<WaterBody,"level">; lowlandLake: ...; highLake: ... }`
  - `const WATER_F0 = 0.02`, `const WATER_HORIZON = 0.02`, `const WATER_WIND_MAX = 12`, `const WATER_REFRACT = 0.02`
  - `fresnelSchlick(cosTheta: number): number`, `fresnelExact(cosTheta: number, n?: number): number`
  - `transmission(kd: [n,n,n], depth: number): [number, number, number]` (the e^(−2 Kd d) factors)
  - `meanKd(kd): number`, `alphaFor(kd, depth): number`
  - `slopeVariance(wind01: number, shelter: number): number`, `roughnessFor(wind01: number, shelter: number): number`
  - `horizonSafeNormal(n: [x,y,z], view: [x,y,z]): [x,y,z]` (mirrors the GLSL of Task 3)

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/waterShading.test.ts
import { describe, it, expect } from "vitest";
import {
  WATER_ROWS, WATER_F0, WATER_HORIZON, WATER_WIND_MAX,
  fresnelSchlick, fresnelExact, transmission, meanKd, alphaFor,
  slopeVariance, roughnessFor, horizonSafeNormal,
} from "../../src/game/waterShading.js";

describe("Fresnel for water", () => {
  it("is F0 = 0.02 straight down and 1 at grazing", () => {
    expect(fresnelSchlick(1)).toBeCloseTo(WATER_F0, 6);
    expect(fresnelSchlick(0)).toBeCloseTo(1, 6);
  });
  it("stays within 3 % absolute of the exact unpolarised curve for n = 1.33", () => {
    for (const deg of [0, 45, 60, 70, 80, 85, 90]) {
      const c = Math.cos((deg * Math.PI) / 180);
      expect(Math.abs(fresnelSchlick(c) - fresnelExact(c))).toBeLessThan(0.03);
    }
  });
});

describe("transmission by depth", () => {
  it("gives the research doc's humic numbers at 0.3 m: half the red, two fifths of the green, an eighth of the blue", () => {
    const [r, g, b] = transmission(WATER_ROWS.lowlandLake.kd, 0.3);
    expect(r).toBeCloseTo(0.52, 1);
    expect(g).toBeCloseTo(0.41, 1);
    expect(b).toBeCloseTo(0.12, 1);
  });
  it("loses the bed by 10 m in every body", () => {
    for (const row of Object.values(WATER_ROWS)) {
      for (const t of transmission(row.kd, 10)) expect(t).toBeLessThan(0.1);
    }
  });
  it("is 1 at zero and negative depth", () => {
    expect(transmission(WATER_ROWS.sea.kd, 0)).toEqual([1, 1, 1]);
    expect(transmission(WATER_ROWS.sea.kd, -2)).toEqual([1, 1, 1]);
  });
  it("alpha is 1 minus the mean-Kd transmission", () => {
    const kd = WATER_ROWS.sea.kd;
    expect(meanKd(kd)).toBeCloseTo((0.34 + 0.18 + 0.26) / 3, 6);
    expect(alphaFor(kd, 1)).toBeCloseTo(1 - Math.exp(-2 * meanKd(kd)), 6);
    expect(alphaFor(kd, 0)).toBe(0);
    expect(alphaFor(kd, 100)).toBeCloseTo(1, 6);
  });
});

describe("roughness from wind", () => {
  it("has Cox and Munk's floor in a dead calm on the open sea", () => {
    expect(slopeVariance(0, 1)).toBeCloseTo(0.003, 6);
    expect(roughnessFor(0, 1)).toBeGreaterThan(0.2);
  });
  it("shelter 0.1 in calm air is under 0.2; the sea in rain is at least 0.5", () => {
    expect(roughnessFor(0, 0.1)).toBeLessThan(0.2);
    expect(roughnessFor(1, 1)).toBeGreaterThanOrEqual(0.5);
  });
  it("is monotone in wind and maps 1 to 12 m/s", () => {
    let last = -1;
    for (let w = 0; w <= 1; w += 0.05) {
      const r = roughnessFor(w, 1);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    expect(WATER_WIND_MAX).toBe(12);
    expect(slopeVariance(1, 1)).toBeCloseTo(0.003 + 0.00512 * 12, 6);
  });
  it("clamps wind and shelter to [0, 1]", () => {
    expect(roughnessFor(3, 1)).toBeCloseTo(roughnessFor(1, 1), 6);
    expect(roughnessFor(-1, 1)).toBeCloseTo(roughnessFor(0, 1), 6);
    expect(roughnessFor(0.5, 7)).toBeCloseTo(roughnessFor(0.5, 1), 6);
  });
});

describe("horizon-safe normal", () => {
  const reflectY = (n: [number, number, number], v: [number, number, number]): number => {
    // reflect(-v, n).y with v the direction from the surface to the eye
    const d = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
    return -v[1] - 2 * d * n[1];
  };
  it("leaves a normal alone when the reflection already clears the horizon", () => {
    const n: [number, number, number] = [0, 1, 0];
    const v: [number, number, number] = [0, 0.5, Math.sqrt(0.75)];
    expect(horizonSafeNormal(n, v)).toEqual(n);
  });
  it("tilts a ripple normal up until the reflection clears the horizon, for the eye above the water", () => {
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const tilt = 0.6;
      const n: [number, number, number] = [Math.sin(a) * tilt, 1, Math.cos(a) * tilt];
      const len = Math.hypot(...n);
      const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const v: [number, number, number] = [0, 0.05, Math.sqrt(1 - 0.0025)];
      const safe = horizonSafeNormal(nn, v);
      expect(reflectY(safe, v)).toBeGreaterThanOrEqual(WATER_HORIZON - 1e-6);
      expect(Math.hypot(...safe)).toBeCloseTo(1, 6);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/waterShading.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/game/waterShading.js".

- [ ] **Step 3: Write the module**

```ts
// client/src/game/waterShading.ts
/**
 * The water material's maths, Babylon-free and testable under Node, the way
 * `water.ts` and `sky.ts` are. Every constant here that the GLSL in
 * shaders/water*.fx repeats is pinned by the lockstep test in
 * waterPlugin.test.ts; tune them here and there together.
 *
 * Trigonometry and exp are fine here (renderer-only; nothing crosses the
 * wire). See docs/rendering/2026-09-29-water-material-design.md §5.
 */
import { clamp01 } from "./colour.js";

/** One body of water, from the world at build time (spec §7). */
export type WaterBody = {
  /** Surface height, world metres. */
  level: number;
  /** Diffuse attenuation per channel, per metre (research doc §2.3). */
  kd: [number, number, number];
  /** Deep-water colour as an albedo the sky lights. */
  lInf: [number, number, number];
  /** 0..1 scale on Cox and Munk's slope variance: 1 open sea, 0.1 a lake in old growth. */
  shelter: number;
};

export type WaterRow = Omit<WaterBody, "level">;

/** The measured rows of spec §5.2. L∞ is small: the water body itself returns
 * under 1 % in brown water and a few percent in clear or sea water. */
export const WATER_ROWS: { sea: WaterRow; lowlandLake: WaterRow; highLake: WaterRow } = {
  sea: { kd: [0.34, 0.18, 0.26], lInf: [0.02, 0.05, 0.05], shelter: 1 },
  lowlandLake: { kd: [1.1, 1.5, 3.5], lInf: [0.009, 0.006, 0.003], shelter: 0.1 },
  highLake: { kd: [0.2, 0.12, 0.2], lInf: [0.01, 0.025, 0.05], shelter: 0.3 },
};

/** Fresnel reflectance of water at normal incidence, n = 1.33. Mirrored in shaders/water.fragment.fx. */
export const WATER_F0 = 0.02;
/** The reflected ray's least y (spec §5.1). Mirrored in shaders/water.fragment.fx. */
export const WATER_HORIZON = 0.02;
/** Metres per second the game's wind of 1 stands for (spec §5.1). */
export const WATER_WIND_MAX = 12;
/** Screen-space refraction offset per unit of ripple slope, in uv, at 1 m of depth. Mirrored in shaders/water.fragment.fx. */
export const WATER_REFRACT = 0.02;
/** Depth at which the refraction offset stops growing (spec §5.2). Mirrored in shaders/water.fragment.fx. */
export const WATER_REFRACT_DEPTH = 1;

export function fresnelSchlick(cosTheta: number): number {
  const c = clamp01(cosTheta);
  const m = 1 - c;
  return WATER_F0 + (1 - WATER_F0) * m * m * m * m * m;
}

/** Exact unpolarised Fresnel reflectance from air into a medium of index n. */
export function fresnelExact(cosTheta: number, n = 1.33): number {
  const ci = clamp01(cosTheta);
  const si = Math.sqrt(Math.max(0, 1 - ci * ci));
  const st = si / n;
  if (st >= 1) return 1;
  const ct = Math.sqrt(1 - st * st);
  const rs = (ci - n * ct) / (ci + n * ct);
  const rp = (n * ci - ct) / (n * ci + ct);
  return 0.5 * (rs * rs + rp * rp);
}

/** e^(−2 Kd d) per channel: the bed's share of the pixel at depth d (§5.2). */
export function transmission(kd: readonly [number, number, number], depth: number): [number, number, number] {
  const d = Math.max(0, depth);
  return [Math.exp(-2 * kd[0] * d), Math.exp(-2 * kd[1] * d), Math.exp(-2 * kd[2] * d)];
}

export function meanKd(kd: readonly [number, number, number]): number {
  return (kd[0] + kd[1] + kd[2]) / 3;
}

/** The medium and low tiers' single alpha: 1 − e^(−2 K̄ d) (§5.2). */
export function alphaFor(kd: readonly [number, number, number], depth: number): number {
  return 1 - Math.exp(-2 * meanKd(kd) * Math.max(0, depth));
}

/** Cox and Munk's slope variance, σ² = 0.003 + 0.00512 U, scaled by the body's shelter (§5.1). */
export function slopeVariance(wind01: number, shelter: number): number {
  const u = clamp01(wind01) * WATER_WIND_MAX;
  return (0.003 + 0.00512 * u) * clamp01(shelter);
}

/** PBR perceptual roughness from the slope variance: Beckmann α = √(2σ²), roughness = √α. */
export function roughnessFor(wind01: number, shelter: number): number {
  const alpha = Math.sqrt(2 * slopeVariance(wind01, shelter));
  return Math.sqrt(alpha);
}

/**
 * Tilts a ripple normal toward up until the reflected ray clears
 * WATER_HORIZON. `view` points from the surface to the eye, which is above
 * the water (the camera never submerges), so the flat normal always clears
 * it and the mix always converges. Mirrors waterHorizonNormal in
 * shaders/water.fragment.fx exactly, iteration count included.
 */
export function horizonSafeNormal(
  n: readonly [number, number, number],
  view: readonly [number, number, number],
): [number, number, number] {
  let nx = n[0], ny = n[1], nz = n[2];
  for (let i = 0; i < 4; i++) {
    const d = -(view[0] * nx + view[1] * ny + view[2] * nz);
    const ry = -view[1] - 2 * d * ny;
    if (ry >= WATER_HORIZON) break;
    const t = clamp01((WATER_HORIZON - ry) * 4);
    nx = nx * (1 - t);
    ny = ny * (1 - t) + t;
    nz = nz * (1 - t);
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
  }
  return [nx, ny, nz];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/waterShading.test.ts`
Expected: PASS, 12 tests. If the horizon test fails on a few angles, raise the loop to 6 iterations in both this file and (later) the GLSL, and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/waterShading.ts client/test/game/waterShading.test.ts
git commit -m "feat: the water material's maths, Babylon-free"
```

---

### Task 2: The bed height bake (`bedHeight.ts`)

**Files:**
- Create: `client/src/game/bedHeight.ts`
- Test: `client/test/game/bedHeight.test.ts`

**Interfaces:**
- Consumes: `elevationAt(seed, x, z)` from `client/src/sim/terrain.js`; `snapOrigin` from `client/src/game/clipmap.js` is NOT reused (its cell count is the terrain's); this module has its own rule.
- Produces:
  - `type BedGrid = { texels: number; spacing: number; originX: number; originZ: number; heights: Float32Array }`
  - `BED_GRID: Record<QualityTier, { texels: number; spacing: number }>` = high/medium `{256, 1}`, low `{128, 2}`
  - `createBedGrid(texels, spacing): BedGrid`
  - `bedOriginFor(cam: number, texels: number, spacing: number): number`
  - `bedNeedsRebake(grid, camX, camZ): boolean` (true when the camera has left the inner half)
  - `bakeBed(grid, seed, camX, camZ): boolean` (re-centres and fills; returns whether it did)

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/bedHeight.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import "../../src/sim/olympic.js";
import { elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { BED_GRID, createBedGrid, bedOriginFor, bedNeedsRebake, bakeBed } from "../../src/game/bedHeight.js";

const SEED = 0x5eed;
beforeAll(() => setActiveTerrainVariant("olympic"));

describe("bed height grid", () => {
  it("has the spec's sizes per tier", () => {
    expect(BED_GRID.high).toEqual({ texels: 256, spacing: 1 });
    expect(BED_GRID.medium).toEqual({ texels: 256, spacing: 1 });
    expect(BED_GRID.low).toEqual({ texels: 128, spacing: 2 });
  });

  it("centres the grid on the camera, snapped to a quarter of its extent", () => {
    // 256 texels at 1 m: extent 256, snap step 64, origin = cam − 128 rounded down to 64
    expect(bedOriginFor(0, 256, 1)).toBe(-128);
    expect(bedOriginFor(63.9, 256, 1)).toBe(-128);
    expect(bedOriginFor(64, 256, 1)).toBe(-64);
    expect(bedOriginFor(-1, 128, 2)).toBe(-192);
  });

  it("bakes every texel equal to elevationAt at the texel's centre", () => {
    const grid = createBedGrid(256, 1);
    expect(bakeBed(grid, SEED, 10, -20)).toBe(true);
    for (const [ix, iz] of [[0, 0], [255, 255], [17, 200], [128, 128]]) {
      const x = grid.originX + (ix + 0.5) * grid.spacing;
      const z = grid.originZ + (iz + 0.5) * grid.spacing;
      expect(grid.heights[iz * 256 + ix]).toBeCloseTo(elevationAt(SEED, x, z), 4);
    }
  });

  it("does not rebake until the camera leaves the inner half", () => {
    const grid = createBedGrid(256, 1);
    bakeBed(grid, SEED, 0, 0);
    const before = grid.heights.slice();
    expect(bedNeedsRebake(grid, 30, -30)).toBe(false);
    expect(bakeBed(grid, SEED, 30, -30)).toBe(false);
    expect(grid.heights).toEqual(before);
    expect(bedNeedsRebake(grid, 70, 0)).toBe(true);
    expect(bakeBed(grid, SEED, 70, 0)).toBe(true);
    expect(grid.originX).toBe(bedOriginFor(70, 256, 1));
  });

  it("rebake changes origin and heights together, never one without the other", () => {
    const grid = createBedGrid(128, 2);
    bakeBed(grid, SEED, 0, 0);
    const o = [grid.originX, grid.originZ];
    bakeBed(grid, SEED, 500, 500);
    expect([grid.originX, grid.originZ]).not.toEqual(o);
    const x = grid.originX + 0.5 * grid.spacing;
    const z = grid.originZ + 0.5 * grid.spacing;
    expect(grid.heights[0]).toBeCloseTo(elevationAt(SEED, x, z), 4);
  });
});
```

The variant activation is the one `client/test/game/water.test.ts` does (import `olympic.js` for its side effect, then `setActiveTerrainVariant("olympic")`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/bedHeight.test.ts`
Expected: FAIL, cannot resolve `bedHeight.js`.

- [ ] **Step 3: Write the module**

```ts
// client/src/game/bedHeight.ts
/**
 * The bed height texture's contents: a square of terrain heights around the
 * camera, sampled from `elevationAt` (the same function the water rings and
 * the terrain clipmap sample, so the three agree), that the water material
 * reads per pixel for its depth (spec §4.1). Pure and Babylon-free; the
 * water shell uploads `heights` as one R32F texture.
 *
 * Re-centred when the camera leaves the inner half of the square, snapped
 * to a quarter of the extent so consecutive bakes share their alignment.
 */
import { elevationAt } from "../sim/terrain.js";
import type { QualityTier } from "./quality.js";

export type BedGrid = {
  texels: number;
  /** Metres per texel. */
  spacing: number;
  /** World x and z of the grid's min corner. */
  originX: number;
  originZ: number;
  /** texels² heights, row-major by (iz, ix), each at its texel's centre. */
  heights: Float32Array;
};

/** Spec §4.1's table. */
export const BED_GRID: Record<QualityTier, { texels: number; spacing: number }> = {
  high: { texels: 256, spacing: 1 },
  medium: { texels: 256, spacing: 1 },
  low: { texels: 128, spacing: 2 },
};

export function createBedGrid(texels: number, spacing: number): BedGrid {
  return { texels, spacing, originX: Number.NaN, originZ: Number.NaN, heights: new Float32Array(texels * texels) };
}

/** The min corner for a camera at `cam`: half an extent back, snapped down to a quarter extent. */
export function bedOriginFor(cam: number, texels: number, spacing: number): number {
  const extent = texels * spacing;
  const step = extent / 4;
  return Math.floor((cam - extent / 2) / step) * step;
}

/** True when the camera is outside the inner half of the current square (or nothing is baked). */
export function bedNeedsRebake(grid: BedGrid, camX: number, camZ: number): boolean {
  if (Number.isNaN(grid.originX)) return true;
  const extent = grid.texels * grid.spacing;
  const q = extent / 4;
  const inX = camX >= grid.originX + q && camX < grid.originX + extent - q;
  const inZ = camZ >= grid.originZ + q && camZ < grid.originZ + extent - q;
  return !(inX && inZ);
}

/** Re-centres on the camera and fills the heights; false when no rebake was due. */
export function bakeBed(grid: BedGrid, seed: number, camX: number, camZ: number): boolean {
  if (!bedNeedsRebake(grid, camX, camZ)) return false;
  const originX = bedOriginFor(camX, grid.texels, grid.spacing);
  const originZ = bedOriginFor(camZ, grid.texels, grid.spacing);
  const n = grid.texels;
  for (let iz = 0; iz < n; iz++) {
    const z = originZ + (iz + 0.5) * grid.spacing;
    for (let ix = 0; ix < n; ix++) {
      grid.heights[iz * n + ix] = elevationAt(seed, originX + (ix + 0.5) * grid.spacing, z);
    }
  }
  grid.originX = originX;
  grid.originZ = originZ;
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/bedHeight.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/bedHeight.ts client/test/game/bedHeight.test.ts
git commit -m "feat: the bed height grid the water reads its depth from"
```

---

### Task 3: The `WaterPlugin` and its GLSL (bed-depth path, all tiers)

**Files:**
- Create: `client/src/game/shaders/water.vertex.fx`, `client/src/game/shaders/waterWorldPos.vertex.fx`, `client/src/game/shaders/water.fragment.fx`, `client/src/game/shaders/waterLights.fragment.fx`
- Create: `client/src/game/waterPlugin.ts`
- Test: `client/test/game/waterPlugin.test.ts`

**Interfaces:**
- Consumes: Task 1's constants and `WaterBody`; the `bedDepth` vertex attribute (a float per vertex, Task 4 writes it).
- Produces:
  - `class WaterPlugin extends MaterialPluginBase` (name `"Water"`, priority 230, defines `WATER`, `WATER_HIGH`)
  - `attachWater(material: Material, row: WaterRow): WaterPlugin` (idempotent)
  - Plugin fields the shell sets per frame: `bedTexture: BaseTexture | null`, `bedOrigin: [number, number]`, `bedTexels: number`, `bedSpacing: number`, `time: number`, `windDir: [number, number]`; per mesh through `mesh.metadata.waterLevel: number`.
  - Uniforms: `waterLevel`, `waterKd` (vec3), `waterBed` (vec4: originX, originZ, 1/extent, spacing), `waterBedTexels`, `waterTime`, `waterWind` (vec2), `waterScreen` (vec2), `waterHigh` (float); samplers `waterBedHeight`, `waterScene`, `waterDepth` (the last two bound only under `WATER_HIGH`, Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/waterPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { WaterPlugin, attachWater } from "../../src/game/waterPlugin.js";
import { WATER_ROWS, WATER_F0, WATER_HORIZON, WATER_REFRACT, WATER_REFRACT_DEPTH } from "../../src/game/waterShading.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => engine.dispose());

describe("water plugin", () => {
  it("attaches once, idempotently, and activates", () => {
    const mat = new PBRMaterial("w", scene);
    const a = attachWater(mat, WATER_ROWS.sea);
    const b = attachWater(mat, WATER_ROWS.sea);
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(WaterPlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof WaterPlugin)).toHaveLength(1);
  });

  it("declares the bedDepth attribute, the bed sampler, and the four hook points", () => {
    const mat = new PBRMaterial("w2", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    const attributes: string[] = [];
    p.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["bedDepth"]);
    const samplers: string[] = [];
    p.getSamplers(samplers);
    expect(samplers).toEqual(["waterBedHeight", "waterScene", "waterDepth"]);
    const v = p.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(p.getCustomCode("compute")).toBeNull();
  });

  it("injects exactly the GLSL the .fx files hold, with the constants in lockstep", () => {
    const mat = new PBRMaterial("w3", scene);
    const p = attachWater(mat, WATER_ROWS.sea);
    const f = p.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("water.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("waterLights.fragment.fx"));
    const v = p.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("waterWorldPos.vertex.fx"));
    const d = f.CUSTOM_FRAGMENT_DEFINITIONS;
    expect(d).toContain(`const float WATER_F0 = ${glslFloat(WATER_F0)};`);
    expect(d).toContain(`const float WATER_HORIZON = ${glslFloat(WATER_HORIZON)};`);
    expect(d).toContain(`const float WATER_REFRACT = ${glslFloat(WATER_REFRACT)};`);
    expect(d).toContain(`const float WATER_REFRACT_DEPTH = ${glslFloat(WATER_REFRACT_DEPTH)};`);
    expect(d).toContain("const float WATER_OCTAVE2_TILE = 3.0;");
    expect(d).toContain("vec3 n = texture2D(bumpSampler, uv).xyz * 2.0 - 1.0;");
    expect(fx("waterLights.fragment.fx")).toContain("if (waterOctaves > 1.5) {");
    // the sampler lives in the .fx, never in getUniforms().fragment (the UBO-path trap)
    expect(d).toContain("uniform sampler2D waterBedHeight;");
    expect(p.getUniforms().fragment).not.toContain("sampler2D");
  });

  it("discards on land and saturates alpha where the bed texture does not reach", () => {
    const l = fx("waterLights.fragment.fx");
    expect(l).toContain("if (wDepth <= 0.0) discard;");
    // outside the square the vertex depth stands in, never zero
    expect(fx("water.fragment.fx")).toContain("return vBedDepth;");
    expect(l).toContain("alpha = 1.0 - exp(-2.0 * wKdMean * wDepth);");
  });

  it("sets F0 to water's and the row's kd on the material, and roughness from the wind and shelter", () => {
    const mat = new PBRMaterial("w4", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    expect(mat.metallicF0Factor).toBeCloseTo(WATER_F0 / 0.04, 6);
    expect(mat.metallic).toBe(0);
    expect(mat.albedoColor.asArray()).toEqual(WATER_ROWS.lowlandLake.lInf);
    p.setWind(0, [1, 0]);
    expect(mat.roughness).toBeLessThan(0.2);
    p.setWind(1, [1, 0]);
    expect(mat.roughness).toBeGreaterThan(0.2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/waterPlugin.test.ts`
Expected: FAIL, cannot resolve `waterPlugin.js`.

- [ ] **Step 3: Write the four `.fx` files**

`client/src/game/shaders/water.vertex.fx`:

```glsl
// Water plugin, vertex definitions: the ring's per-vertex bed depth (metres
// of water under the vertex, from the terrain height the ring sampled), which
// the fragment stage falls back to outside the bed height texture's square.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
attribute float bedDepth;
varying float vBedDepth;
```

`client/src/game/shaders/waterWorldPos.vertex.fx`:

```glsl
vBedDepth = bedDepth;
```

`client/src/game/shaders/water.fragment.fx`:

```glsl
// Water plugin, fragment definitions. Spliced at CUSTOM_FRAGMENT_DEFINITIONS
// on both the UBO and non-UBO paths, which is why the samplers are declared
// here and not in getUniforms().fragment (the atmosphere.ts precedent).
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror waterShading.ts and a lockstep test asserts they agree.
uniform sampler2D waterBedHeight;
uniform sampler2D waterScene;
uniform sampler2D waterDepth;

varying float vBedDepth;

const float WATER_F0 = 0.02;
const float WATER_HORIZON = 0.02;
const float WATER_REFRACT = 0.02;
const float WATER_REFRACT_DEPTH = 1.0;
// The second ripple octave: metres a tile, its share of the first's slope,
// and its drift in tiles per second along the wind (spec §5.3).
const float WATER_OCTAVE2_TILE = 3.0;
const float WATER_OCTAVE2_WEIGHT = 0.333;
const float WATER_OCTAVE2_DRIFT = 0.04;

// The second octave's slope from the same bump texture at a finer tile,
// drifting with the wind. The first octave is PBR's own bump (24 m a tile,
// scrolled by the shell). Returns an xz slope to add to the normal.
vec2 waterRipple2(vec2 xz) {
  vec2 uv = xz / WATER_OCTAVE2_TILE + waterWind * waterTime * WATER_OCTAVE2_DRIFT;
  vec3 n = texture2D(bumpSampler, uv).xyz * 2.0 - 1.0;
  return n.xy * WATER_OCTAVE2_WEIGHT;
}

// Bed height under world xz from the R32F square, bilinear by hand: r32float
// is not filterable on WebGPU and OES_texture_float_linear is not a given on
// WebGL2, so the texture is sampled nearest and blended here. Outside the
// square the ring vertex's depth stands in (it is coarse but it is deep).
float waterBedDepth(vec2 xz) {
  vec2 local = (xz - waterBed.xy) * waterBed.z;
  if (local.x <= 0.0 || local.y <= 0.0 || local.x >= 1.0 || local.y >= 1.0) {
    return vBedDepth;
  }
  vec2 t = local * waterBedTexels - 0.5;
  vec2 i = floor(t);
  vec2 f = t - i;
  vec2 texel = 1.0 / waterBedTexels;
  vec2 uv0 = (i + 0.5) * texel;
  float h00 = texture2D(waterBedHeight, uv0).r;
  float h10 = texture2D(waterBedHeight, uv0 + vec2(texel.x, 0.0)).r;
  float h01 = texture2D(waterBedHeight, uv0 + vec2(0.0, texel.y)).r;
  float h11 = texture2D(waterBedHeight, uv0 + texel).r;
  float h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  return waterLevel - h;
}

// Tilts a ripple normal toward up until the reflected ray clears the
// horizon. Mirrors horizonSafeNormal in waterShading.ts exactly.
vec3 waterHorizonNormal(vec3 n, vec3 view) {
  for (int i = 0; i < 4; i++) {
    float ry = reflect(-view, n).y;
    if (ry >= WATER_HORIZON) break;
    float t = clamp((WATER_HORIZON - ry) * 4.0, 0.0, 1.0);
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), t));
  }
  return n;
}
```

`client/src/game/shaders/waterLights.fragment.fx`:

```glsl
// Water plugin, before lights: per-pixel depth, the waterline, the medium
// and low tiers' alpha, and the horizon-safe normal. On the high tier the
// transmitted colour is read from the scene copy instead and the surface
// writes unblended (waterHigh is the gate, a uniform, since plugin code is
// applied before conditional evaluation).
float wDepth = waterBedDepth(vPositionW.xz);
if (wDepth <= 0.0) discard;
float wKdMean = (waterKd.r + waterKd.g + waterKd.b) / 3.0;
if (waterOctaves > 1.5) {
  vec2 wSlope = waterRipple2(vPositionW.xz);
  normalW = normalize(normalW + vec3(wSlope.x, 0.0, wSlope.y));
}
normalW = waterHorizonNormal(normalW, viewDirectionW);
if (waterHigh < 0.5) {
  alpha = 1.0 - exp(-2.0 * wKdMean * wDepth);
} else {
  vec2 wUv = gl_FragCoord.xy * waterScreen;
  float wSceneDepth = texture2D(waterDepth, wUv).r;
  float wBehind = max(0.0, min(wDepth, wSceneDepth - waterViewDepth));
  vec2 wOff = normalW.xz * WATER_REFRACT * min(wBehind, WATER_REFRACT_DEPTH);
  vec3 wBed = texture2D(waterScene, wUv + wOff).rgb;
  vec3 wT = exp(-2.0 * waterKd * wBehind);
  surfaceAlbedo = mix(surfaceAlbedo, wBed, wT);
  alpha = 1.0;
}
```

Notes for the implementer: `vPositionW`, `normalW`, `viewDirectionW`, `surfaceAlbedo` and `alpha` are Babylon's own locals at this hook (`pbr.fragment.js`: `CUSTOM_FRAGMENT_BEFORE_LIGHTS` comes after the albedo/opacity block and the final normal, before ambient occlusion, reflectivity and reflection). `waterViewDepth` is a varying the vertex stage must write on the high path; Task 6 adds it (`vWaterViewDepth`) and until then this branch is dead code behind `waterHigh = 0` but must compile, so declare `float waterViewDepth = 0.0;` in `water.fragment.fx` for now and Task 6 replaces it. `texture2D` is what every `.fx` in this directory uses and the WebGPU translator rewrites. `bumpSampler` is PBR's own bump sampler (declared whenever the material has a `bumpTexture`, which both water materials do; `bumpFragment.js`), so the second octave costs one more read of a texture already bound.

- [ ] **Step 4: Write the plugin**

```ts
// client/src/game/waterPlugin.ts
/**
 * The water plugin: PBR with what water is about spliced in (spec §3):
 * per-pixel bed depth from the bed height texture, the waterline, the
 * medium and low tiers' single alpha, the reflected ray held above the
 * horizon, and on the high tier a refracted read of the scene copy with
 * per-channel attenuation. Everything else — the sun's specular, the sky
 * probe, the headlamps, fog, the colour path — is PBR's own. Renderer-only.
 * The GLSL lives in shaders/water*.fx so shaderHygiene.test.ts covers it.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import vertexDefs from "./shaders/water.vertex.fx?raw";
import vertexWorldPos from "./shaders/waterWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/water.fragment.fx?raw";
import fragmentLights from "./shaders/waterLights.fragment.fx?raw";
import { WATER_F0, roughnessFor, type WaterRow } from "./waterShading.js";

/** Babylon's dielectric F0 at metallicF0Factor 1 is 0.04; water's 0.02 is half of it. */
const PBR_DIELECTRIC_F0 = 0.04;

export class WaterPlugin extends MaterialPluginBase {
  readonly row: WaterRow;
  /** The bed height square (Task 4 uploads it); null until the first bake. */
  bedTexture: BaseTexture | null = null;
  bedOrigin: [number, number] = [0, 0];
  bedTexels = 256;
  bedSpacing = 1;
  /** High tier only (Task 6): the scene copy and depth read, and the screen's 1/size. */
  sceneTexture: BaseTexture | null = null;
  depthTexture: BaseTexture | null = null;
  screen: [number, number] = [1, 1];
  time = 0;
  windDir: [number, number] = [1, 0];
  /** Ripple octaves the fragment blends: 2, or 1 on the low tier (spec §5.3). */
  octaves = 2;

  constructor(material: Material, row: WaterRow) {
    // 230: after the atmosphere's 200 and every look plugin's 205 to 220; the
    // water carries only this and the atmosphere, so the order is fixed.
    super(material, "Water", 230, { WATER: false });
    this.row = row;
    if (material instanceof PBRMaterial) {
      material.metallic = 0;
      material.metallicF0Factor = WATER_F0 / PBR_DIELECTRIC_F0;
      material.albedoColor = new Color3(row.lInf[0], row.lInf[1], row.lInf[2]);
      material.roughness = roughnessFor(0, row.shelter);
    }
    this._enable(true);
  }

  override getClassName(): string {
    return "WaterPlugin";
  }

  /** Per frame from the renderer's wind record: the game's 0..1 wind and its direction. */
  setWind(wind01: number, dir: [number, number]): void {
    const m = this._material;
    if (m instanceof PBRMaterial) m.roughness = roughnessFor(wind01, this.row.shelter);
    this.windDir = dir;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.WATER = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("bedDepth");
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("waterBedHeight", "waterScene", "waterDepth");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "waterLevel", size: 1, type: "float" },
        { name: "waterKd", size: 3, type: "vec3" },
        { name: "waterBed", size: 4, type: "vec4" },
        { name: "waterBedTexels", size: 1, type: "float" },
        { name: "waterTime", size: 1, type: "float" },
        { name: "waterWind", size: 2, type: "vec2" },
        { name: "waterScreen", size: 2, type: "vec2" },
        { name: "waterHigh", size: 1, type: "float" },
        { name: "waterOctaves", size: 1, type: "float" },
      ],
      fragment: [
        "uniform float waterLevel;",
        "uniform vec3 waterKd;",
        "uniform vec4 waterBed;",
        "uniform float waterBedTexels;",
        "uniform float waterTime;",
        "uniform vec2 waterWind;",
        "uniform vec2 waterScreen;",
        "uniform float waterHigh;",
        "uniform float waterOctaves;",
      ].join("\n"),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    const level = (subMesh.getMesh().metadata as { waterLevel?: number } | null)?.waterLevel ?? 0;
    const extent = this.bedTexels * this.bedSpacing;
    uniformBuffer.updateFloat("waterLevel", level);
    uniformBuffer.updateFloat3("waterKd", this.row.kd[0], this.row.kd[1], this.row.kd[2]);
    uniformBuffer.updateFloat4("waterBed", this.bedOrigin[0], this.bedOrigin[1], 1 / extent, this.bedSpacing);
    uniformBuffer.updateFloat("waterBedTexels", this.bedTexels);
    uniformBuffer.updateFloat("waterTime", this.time);
    uniformBuffer.updateFloat2("waterWind", this.windDir[0], this.windDir[1]);
    uniformBuffer.updateFloat2("waterScreen", this.screen[0], this.screen[1]);
    const high = this.sceneTexture !== null && this.depthTexture !== null;
    uniformBuffer.updateFloat("waterHigh", high ? 1 : 0);
    uniformBuffer.updateFloat("waterOctaves", this.octaves);
    // Every declared sampler is bound on every draw: WebGPU validates the
    // bindings a pipeline declares whether or not a branch reads them.
    if (this.bedTexture !== null) uniformBuffer.setTexture("waterBedHeight", this.bedTexture);
    uniformBuffer.setTexture("waterScene", this.sceneTexture ?? this.bedTexture);
    uniformBuffer.setTexture("waterDepth", this.depthTexture ?? this.bedTexture);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs, CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights };
    }
    return null;
  }
}

/** Attach once per material; a later call returns the plugin already there. */
export function attachWater(material: Material, row: WaterRow): WaterPlugin {
  const existing = material.pluginManager?.getPlugin("Water");
  if (existing instanceof WaterPlugin) return existing;
  return new WaterPlugin(material, row);
}
```

If `uniformBuffer.setTexture` with a `null` texture throws under `NullEngine` before Task 4 binds one, guard each `setTexture` on non-null and add to the Task 6 checklist that the high-tier draw asserts both are bound.

- [ ] **Step 5: Run the tests to verify they pass, and the hygiene test**

Run: `cd client && npx vitest run test/game/waterPlugin.test.ts test/game/shaderHygiene.test.ts`
Expected: PASS. If the hygiene test flags a comment, fix the comment, not the rule.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/waterPlugin.ts client/src/game/shaders/water.vertex.fx client/src/game/shaders/waterWorldPos.vertex.fx client/src/game/shaders/water.fragment.fx client/src/game/shaders/waterLights.fragment.fx client/test/game/waterPlugin.test.ts
git commit -m "feat: the water plugin, per-pixel bed depth and the horizon-safe normal"
```

---

### Task 4: Wire the material into the water shell

**Files:**
- Modify: `client/src/game/water.ts` (`waterRingGeometry` writes `bedDepth`, not colours; `waterColorAt` removed)
- Modify: `client/src/game/renderer.ts:597-739` (`createWater`, `pondDisc`) and the per-frame block near `renderer.ts:1412-1449` (wind) and the water's `update` call
- Test: `client/test/game/water.test.ts`, `client/test/game/waterMesh.test.ts`, `client/test/game/renderer.test.ts` (whatever asserts on `mat_water`)

**Interfaces:**
- Consumes: Task 1's `WaterBody`, `WATER_ROWS`; Task 2's `BedGrid`, `bakeBed`, `BED_GRID`; Task 3's `attachWater`, `WaterPlugin`.
- Produces:
  - `WaterGeometry = { positions, indices, normals, uvs, bedDepth: Float32Array }` (colours gone)
  - `createWater(scene, seed, waterLevel, ponds = [], tier: QualityTier = "medium"): Water` where `Water` gains `setWind(wind01: number, dir: [number, number]): void` and `update(camX, camZ, seconds)` takes the clock
  - Materials: `mat_water_sea` for the rings, `mat_water_lake` for ponds (one per row); every water mesh has `metadata.waterLevel`

- [ ] **Step 1: Change the tests first**

In `client/test/game/water.test.ts` replace the "bakes depth into colour and alpha" case and the `waterColorAt` describe with:

```ts
  it("writes the bed depth per vertex, clamped at zero on land", () => {
    const ring = createWaterRingSamples(SEED, 0, 0, 0);
    const g = waterRingGeometry(ring, null, 10);
    expect(g.bedDepth.length).toBe(g.positions.length / 3);
    expect((g as unknown as { colors?: unknown }).colors).toBeUndefined();
    for (let i = 0; i < g.bedDepth.length; i++) {
      const expected = Math.max(0, 10 - (ring.h[i] as number));
      expect(g.bedDepth[i]).toBeCloseTo(expected, 5);
    }
  });
```

In `client/test/game/waterMesh.test.ts` rewrite the two cases:

```ts
  it("builds one alpha-blended mesh per ring carrying bedDepth, no vertex colours, with the water plugin", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 0x5eed, 0);
    expect(water.meshes.length).toBe(WATER_RING_COUNT);
    for (const m of water.meshes) {
      expect(m.getTotalVertices()).toBeGreaterThan(0);
      expect(m.isVerticesDataPresent("bedDepth")).toBe(true);
      expect(m.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
      expect(m.useVertexColors).toBe(false);
      expect((m.metadata as { waterLevel: number }).waterLevel).toBe(0);
      const mat = m.material as PBRMaterial;
      expect(mat.name).toBe("mat_water_sea");
      expect(mat.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHABLEND);
      expect(mat.pluginManager?.getPlugin("Water")).toBeInstanceOf(WaterPlugin);
      expect(m.receiveShadows).toBe(false);
    }
    water.update(-500, 300, 1); // must re-emit and re-bake without throwing
    water.dispose();
  });

  it("adds one disc per pond on the lake material at the pond's level, and disposes it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [{ x: 100, z: 50, radius: 30, height: 42 }]);
    const pond = scene.getMeshByName("pond_0")!;
    expect(pond.position.y).toBeCloseTo(42.02, 5);
    expect(pond.getBoundingInfo().boundingBox.extendSizeWorld.x).toBeCloseTo(31, 0);
    expect(pond.material).toBe(scene.getMaterialByName("mat_water_lake"));
    expect((pond.metadata as { waterLevel: number }).waterLevel).toBe(42);
    expect(pond.isVerticesDataPresent("bedDepth")).toBe(true);
    expect(pond.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
    water.dispose();
    expect(scene.getMeshByName("pond_0")).toBeNull();
    expect(scene.getMaterialByName("mat_water_lake")).toBeNull();
  });

  it("the mechanism fired: the bed texture is uploaded after the first update and the plugin points at it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 7, 0, [], "low");
    water.update(0, 0, 0);
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    expect(plugin.bedTexture).not.toBeNull();
    expect(plugin.bedTexels).toBe(128);
    expect(plugin.bedSpacing).toBe(2);
    expect(plugin.bedOrigin).toEqual([bedOriginFor(0, 128, 2), bedOriginFor(0, 128, 2)]);
    expect(plugin.octaves).toBe(1);
    water.setWind(1, [0, 1]);
    expect((water.meshes[0]!.material as PBRMaterial).roughness).toBeGreaterThan(0.5);
    water.dispose();
  });
```

Add the imports (`VertexBuffer` from `@babylonjs/core/Buffers/buffer.js`, `WaterPlugin`, `bedOriginFor`). Grep `client/test/game/renderer.test.ts` for `mat_water` and `waterColorAt` and update the names.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/water.test.ts test/game/waterMesh.test.ts`
Expected: FAIL on `bedDepth`, `mat_water_sea`, the third argument of `update`.

- [ ] **Step 3: Change `water.ts`**

In `waterRingGeometry`: replace the `colors` array with `bedDepth = new Float32Array(SIDE * SIDE)`, write `bedDepth[at] = Math.max(0, waterLevel - (ring.h[at] as number))`, return it in place of `colors`; delete `waterColorAt`, `FOAM`, `SHALLOW`, `DEEP` and the `Rgba` type and the now-unused `mixRgb`/`clamp01` imports; update the header comment ("depth can be baked into per-vertex colour and alpha" becomes "the per-vertex depth is the fragment stage's fallback outside the bed height texture").

- [ ] **Step 4: Change `renderer.ts`**

`applyWaterGeometry`: `data.colors` goes; after `data.applyToMesh(mesh, true)` add `mesh.setVerticesData("bedDepth", geometry.bedDepth, true, 1);`.

`pondDisc(scene, mat, pond, index)`: keep the disc, drop the colour loop; compute `bedDepth` per vertex from the same analytic profile (`POND_DEPTH * u * u`, u = 1 − (r/R)², clamped at 0 outside R) and `disc.setVerticesData("bedDepth", depths, false, 1)`; remove `useVertexColors`/`hasVertexAlpha`; set `disc.metadata = { waterLevel: pond.height }`.

`createWater(scene, seed, waterLevel, ponds = [], tier: QualityTier = "medium")`:

```ts
  const seaMat = new PBRMaterial("mat_water_sea", scene);
  seaMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  seaMat.backFaceCulling = false;
  const seaPlugin = attachWater(seaMat, WATER_ROWS.sea);
  const lakeMat = new PBRMaterial("mat_water_lake", scene);
  lakeMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  lakeMat.backFaceCulling = false;
  const lakePlugin = attachWater(lakeMat, WATER_ROWS.lowlandLake);
  const plugins = [seaPlugin, lakePlugin];
  budgetMaterial(seaMat);
  budgetMaterial(lakeMat);

  const bump = createWaterBump(scene);
  seaMat.bumpTexture = bump;
  lakeMat.bumpTexture = bump;
  // (keep the existing scroll observer; it drives both through the one texture)

  const { texels, spacing } = BED_GRID[tier];
  const grid = createBedGrid(texels, spacing);
  let bedTexture: RawTexture | null = null;
  function uploadBed(): void {
    if (bedTexture === null) {
      bedTexture = RawTexture.CreateRTexture(grid.heights, texels, texels, scene, false, false,
        Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
      bedTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
      bedTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    } else {
      bedTexture.update(grid.heights);
    }
    // origin and texture change together, in this call, before any draw
    for (const p of plugins) {
      p.bedTexture = bedTexture;
      p.bedOrigin = [grid.originX, grid.originZ];
      p.bedTexels = texels;
      p.bedSpacing = spacing;
    }
  }
  for (const p of plugins) p.octaves = tier === "low" ? 1 : 2;
```

Ring meshes: `mesh.useVertexColors = false`, no `hasVertexAlpha`, `mesh.material = seaMat`, `mesh.metadata = { waterLevel }`. Ponds use `lakeMat`.

`update(camX, camZ, seconds)`: the existing ring logic, then `if (bakeBed(grid, seed, camX, camZ)) uploadBed();` and `for (const p of plugins) p.time = seconds;`. Add `setWind(wind01, dir) { for (const p of plugins) p.setWind(wind01, dir); }`. `dispose` disposes both materials, the bump and `bedTexture`.

`Constants` comes from `@babylonjs/core/Engines/constants.js`; `budgetMaterial` from `./headlamp.js` (already imported in the renderer? grep; import if not).

At the call site (`renderer.ts:1179`) pass `tier`; where the frame loop calls `water.update(...)` pass the world clock's seconds (the same `seconds` the wind uses at `renderer.ts:1435`); after `setFoliageWind(wind, windPlayers)` at `renderer.ts:1449` add `water?.setWind(wind.speed, [wind.dirX, wind.dirZ]);`.

- [ ] **Step 5: Run the client suite for the touched areas, then typecheck and lint**

Run: `cd client && npx vitest run test/game/water.test.ts test/game/waterMesh.test.ts test/game/renderer.test.ts test/game/rendererTeardown.test.ts test/game/pluginBindings.test.ts && cd .. && npm run typecheck && npm run lint`
Expected: PASS. `pluginBindings.test.ts` may enumerate plugins and their bound uniforms: if it asserts a fixed list, add `Water`'s.

- [ ] **Step 6: Look in the browser (bed-depth path, medium tier)**

Start the dev stack on its own ports (this worktree's `client/vite.config.ts`, the `browser-verification-recipe` memory) and open `?seed=atmo&tier=medium&time=12` with the chrome-devtools CLI; go to the pond pose (`__fcSet(294.6, 84.6, 84, 4.712, 0.25)`, spawn pose in the `water-spike` archive's `README.md`) and take a still. Expected: a sharp waterline at the pond's rim, an amber rim over the shallow bed fading to a dark mirror at the centre, no grey disc; the sea from the beach pose shows the sky, not the skybox's ground half, at grazing angles. If the pond is a hard-edged flat colour, the `discard` fired everywhere: check `waterBed` (origin, 1/extent) against the camera. Save the still to the archive folder `~/Projects/fps-sdd-archive/2026-09-29-water-material/` as `t4-pond-medium.png`.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/water.ts client/src/game/renderer.ts client/test/game/water.test.ts client/test/game/waterMesh.test.ts client/test/game/renderer.test.ts
git commit -m "feat: the water reads its depth per pixel from the bed height texture"
```

---

### Task 5: The `WetPlugin` for ground, props and the player

**Files:**
- Create: `client/src/game/shaders/wet.fragment.fx`, `client/src/game/shaders/wetLights.fragment.fx`
- Create: `client/src/game/wetPlugin.ts`
- Modify: `client/src/game/renderer.ts:136-160` (`terrainMaterialFor`), `client/src/game/characterModel.ts:169` (`attachSkinToContainer`)
- Test: `client/test/game/wetPlugin.test.ts`

**Interfaces:**
- Consumes: Task 1's `WATER_ROWS` (the lowland row's kd is the default for the tint).
- Produces:
  - `WET_ALBEDO = 0.4`, `WET_ROUGHNESS = 0.15`, `WET_BAND = 0.1`, `WET_LINE_ABOVE = 0.3` in `wetPlugin.ts`
  - `class WetPlugin extends MaterialPluginBase` (name `"Wet"`, priority 240, define `WET`)
  - `attachWet(material: Material): WetPlugin` (idempotent)
  - `setWetLine(line: number, kd: [n,n,n], attenuate: boolean): void` (module-level, reaches every attached plugin: one wet line at a time, the nearest body's)
  - `wetLineFor(bodies: readonly WaterBody[], x: number, z: number): { line: number; kd: [n,n,n] }`

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/wetPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { WetPlugin, attachWet, setWetLine, wetLineFor, WET_ALBEDO, WET_ROUGHNESS, WET_BAND, WET_LINE_ABOVE } from "../../src/game/wetPlugin.js";
import { WATER_ROWS } from "../../src/game/waterShading.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => engine.dispose());

describe("wet plugin", () => {
  it("attaches once, idempotently (LOD buckets share materials)", () => {
    const mat = new PBRMaterial("g", scene);
    expect(attachWet(mat)).toBe(attachWet(mat));
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof WetPlugin)).toHaveLength(1);
  });

  it("injects the .fx files verbatim at definitions, before-lights and the roughness line", () => {
    const mat = new PBRMaterial("g2", scene);
    const p = attachWet(mat);
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["!float roughness=reflectivityOut\\.roughness;", "CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("wet.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("wetLights.fragment.fx"));
    expect(f["!float roughness=reflectivityOut\\.roughness;"]).toBe("float roughness=mix(reflectivityOut.roughness, WET_ROUGHNESS, wetW);");
    expect(p.getCustomCode("vertex")).toBeNull();
  });

  it("keeps its constants in lockstep with the GLSL", () => {
    const d = fx("wet.fragment.fx");
    expect(WET_ALBEDO).toBe(0.4);
    expect(WET_ROUGHNESS).toBe(0.15);
    expect(WET_BAND).toBe(0.1);
    expect(WET_LINE_ABOVE).toBe(0.3);
    expect(d).toContain(`const float WET_ALBEDO = ${glslFloat(WET_ALBEDO)};`);
    expect(d).toContain(`const float WET_ROUGHNESS = ${glslFloat(WET_ROUGHNESS)};`);
    expect(d).toContain(`const float WET_BAND = ${glslFloat(WET_BAND)};`);
    // the darkening below the line, per channel, gated on wetAttenuate
    expect(fx("wetLights.fragment.fx")).toContain("surfaceAlbedo *= mix(vec3(1.0), exp(-wetKd * max(0.0, wetLine - vPositionW.y)), wetAttenuate);");
  });

  it("the regex anchor matches Babylon's real PBR fragment source", async () => {
    const src = (await import("@babylonjs/core/Shaders/pbr.fragment.js")).pbrPixelShader.shader as string;
    expect(new RegExp("float roughness=reflectivityOut\\.roughness;").test(src)).toBe(true);
  });

  it("wetLineFor picks the nearest body's level plus the still band, and its kd", () => {
    const bodies = [
      { level: 0, kd: WATER_ROWS.sea.kd, lInf: WATER_ROWS.sea.lInf, shelter: 1, x: 0, z: 0, radius: Number.POSITIVE_INFINITY },
      { level: 42, kd: WATER_ROWS.lowlandLake.kd, lInf: WATER_ROWS.lowlandLake.lInf, shelter: 0.1, x: 100, z: 50, radius: 30 },
    ];
    expect(wetLineFor(bodies, 100, 50)).toEqual({ line: 42 + WET_LINE_ABOVE, kd: WATER_ROWS.lowlandLake.kd });
    expect(wetLineFor(bodies, 500, 500)).toEqual({ line: 0 + WET_LINE_ABOVE, kd: WATER_ROWS.sea.kd });
  });

  it("setWetLine reaches every attached plugin", () => {
    const a = attachWet(new PBRMaterial("g3", scene));
    const b = attachWet(new PBRMaterial("g4", scene));
    setWetLine(12.3, [1, 2, 3], false);
    expect(a.line).toBe(12.3);
    expect(b.kd).toEqual([1, 2, 3]);
    expect(b.attenuate).toBe(false);
  });
});
```

`wetLineFor` takes bodies with a footprint (`x`, `z`, `radius`); the sea's radius is infinite. Define `type WetBody = WaterBody & { x: number; z: number; radius: number }` in `wetPlugin.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/wetPlugin.test.ts`
Expected: FAIL, cannot resolve `wetPlugin.js`.

- [ ] **Step 3: Write the GLSL**

`client/src/game/shaders/wet.fragment.fx`:

```glsl
// Wet plugin, fragment definitions: what the water touches is darker and
// glossy below the wet line, and on the medium and low tiers darkened by
// the water above it as well (spec §6). Applied on both UBO paths at
// CUSTOM_FRAGMENT_DEFINITIONS.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror wetPlugin.ts and a lockstep test asserts they agree.
const float WET_ALBEDO = 0.4;
const float WET_ROUGHNESS = 0.15;
const float WET_BAND = 0.1;

// 1 below the line, 0 above, soft over WET_BAND about it.
float wetWeight(float y, float line) {
  return 1.0 - smoothstep(line - WET_BAND * 0.5, line + WET_BAND * 0.5, y);
}
```

`client/src/game/shaders/wetLights.fragment.fx`:

```glsl
float wetW = wetWeight(vPositionW.y, wetLine);
surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW);
surfaceAlbedo *= mix(vec3(1.0), exp(-wetKd * max(0.0, wetLine - vPositionW.y)), wetAttenuate);
```

`wetAttenuate` is 1 on medium and low, 0 on high (spec §6.2). `wetW` is read again by the roughness line the plugin rewrites, which comes later in Babylon's fragment, so it must be declared here at file scope of `main` (it is: the hook is inside `main`).

- [ ] **Step 4: Write the plugin**

```ts
// client/src/game/wetPlugin.ts
/**
 * The wet plugin: below one wet line, a surface is darker (× WET_ALBEDO) and
 * glossy (WET_ROUGHNESS), and on the medium and low tiers darkened per
 * channel by the water above it (spec §6). On the terrain material, the
 * props' and the player's. One wet line at a time — the nearest body's —
 * pushed to every attached plugin by `setWetLine`. Renderer-only; the GLSL
 * lives in shaders/wet*.fx so shaderHygiene.test.ts covers it.
 *
 * The roughness is rewritten by a regex key on Babylon's own
 * `float roughness=reflectivityOut.roughness;` line rather than on the
 * reflectivity call, because the terrain plugin already rewrites that call
 * (terrainTexture.ts) and a second rewrite of it would not match.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import fragmentDefs from "./shaders/wet.fragment.fx?raw";
import fragmentLights from "./shaders/wetLights.fragment.fx?raw";
import type { WaterBody } from "./waterShading.js";

export const WET_ALBEDO = 0.4;
export const WET_ROUGHNESS = 0.15;
export const WET_BAND = 0.1;
/** The still swash band above a body's level (spec §6.1). */
export const WET_LINE_ABOVE = 0.3;

export const WET_ROUGHNESS_ANCHOR = "!float roughness=reflectivityOut\\.roughness;";
const WET_ROUGHNESS_CODE = "float roughness=mix(reflectivityOut.roughness, WET_ROUGHNESS, wetW);";

export type WetBody = WaterBody & { x: number; z: number; radius: number };

const attached = new Set<WetPlugin>();

export class WetPlugin extends MaterialPluginBase {
  line = -1e6;
  kd: [number, number, number] = [0, 0, 0];
  attenuate = true;

  constructor(material: Material) {
    super(material, "Wet", 240, { WET: false });
    attached.add(this);
    this._enable(true);
  }

  override getClassName(): string {
    return "WetPlugin";
  }

  override dispose(): void {
    attached.delete(this);
    super.dispose();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.WET = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "wetLine", size: 1, type: "float" },
        { name: "wetKd", size: 3, type: "vec3" },
        { name: "wetAttenuate", size: 1, type: "float" },
      ],
      fragment: ["uniform float wetLine;", "uniform vec3 wetKd;", "uniform float wetAttenuate;"].join("\n"),
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("wetLine", this.line);
    uniformBuffer.updateFloat3("wetKd", this.kd[0], this.kd[1], this.kd[2]);
    uniformBuffer.updateFloat("wetAttenuate", this.attenuate ? 1 : 0);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
      [WET_ROUGHNESS_ANCHOR]: WET_ROUGHNESS_CODE,
    };
  }
}

export function attachWet(material: Material): WetPlugin {
  const existing = material.pluginManager?.getPlugin("Wet");
  if (existing instanceof WetPlugin) return existing;
  return new WetPlugin(material);
}

/** The nearest body's wet line and kd for a point; the sea (infinite radius) is the fallback. */
export function wetLineFor(bodies: readonly WetBody[], x: number, z: number): { line: number; kd: [number, number, number] } {
  let best: WetBody | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of bodies) {
    const d = Math.max(0, Math.hypot(x - b.x, z - b.z) - b.radius);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (best === null) return { line: -1e6, kd: [0, 0, 0] };
  return { line: best.level + WET_LINE_ABOVE, kd: best.kd };
}

/** Per frame: one wet line for every attached plugin. `attenuate` is false on the high tier. */
export function setWetLine(line: number, kd: [number, number, number], attenuate: boolean): void {
  for (const p of attached) { p.line = line; p.kd = kd; p.attenuate = attenuate; }
}
```

- [ ] **Step 5: Attach it**

`renderer.ts` `terrainMaterialFor`: after the roughness line, `attachWet(mat);` for every name (terrain, wood, stone, the props' colours all get wet). `characterModel.ts` `attachSkinToContainer`: also `for (const m of container.materials) attachWet(m);` and return the skin count as before. In the renderer's per-frame block (after `water?.setWind(...)` from Task 4): build `wetBodies` once at construction (the sea as `{...WATER_ROWS.sea, level: waterLevel, x: 0, z: 0, radius: Infinity}` when there is a sea, each pond as `{...WATER_ROWS.lowlandLake, level: p.height, x: p.x, z: p.z, radius: p.radius}`), and per frame `const w = wetLineFor(wetBodies, camX, camZ); setWetLine(w.line, w.kd, tier !== "high");`. With no bodies (brush levels), skip the call: the plugins' default line is far below everything.

- [ ] **Step 6: Run the tests, typecheck, lint, and the terrain plugin's tests (the anchor must still match after the terrain rewrite)**

Run: `cd client && npx vitest run test/game/wetPlugin.test.ts test/game/terrainTexture.test.ts test/game/characterModel.test.ts test/game/shaderHygiene.test.ts && cd .. && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Look in the browser**

Same stack as Task 4, Step 6; the pond pose at medium. Expected: a darker, glossier band of ground at the pond's rim up to 30 cm above the water, soft-edged; a still with the player standing in the pond (spawn the host at the pond, `__tp`, the `register-play-rig` memory) shows the legs darkened below the line. Save `t5-pond-rim-medium.png`, `t5-wading-medium.png` to the archive folder.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/wetPlugin.ts client/src/game/shaders/wet.fragment.fx client/src/game/shaders/wetLights.fragment.fx client/src/game/renderer.ts client/src/game/characterModel.ts client/test/game/wetPlugin.test.ts
git commit -m "feat: the wet plugin, darker and glossy below the wet line"
```

---

### Task 6: The high tier: scene copy, depth read, per-channel transmission

**Files:**
- Create: `client/src/game/waterFrame.ts` (the copy of the opaque pass and the depth source)
- Modify: `client/src/game/shaders/water.fragment.fx`, `client/src/game/shaders/water.vertex.fx`, `client/src/game/shaders/waterWorldPos.vertex.fx` (the view-depth varying)
- Modify: `client/src/game/renderer.ts` (`createWater` on high; rendering group)
- Test: `client/test/game/waterFrame.test.ts`, `client/test/game/waterPlugin.test.ts`

**Interfaces:**
- Consumes: Task 3's plugin fields `sceneTexture`, `depthTexture`, `screen`; the spike's copy code (`~/Projects/fps-sdd-archive/2026-09-29-water-spike/waterProbe.ts`, `copy()`).
- Produces:
  - `WATER_GROUP = 1` (the water's `renderingGroupId` on high)
  - `createWaterFrame(scene, engine, mode: "copy" | "prepass"): WaterFrame` with `{ scene: BaseTexture; depth: BaseTexture; screen: [number, number]; dispose(): void }` where `depth` holds **linear view depth in metres** in `.r`
  - Depth source decided by measurement in Step 5 and recorded in the spec's §4.4.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/waterFrame.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { WATER_GROUP, createWaterFrame } from "../../src/game/waterFrame.js";

describe("water frame (the high tier's copy of the opaque pass)", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("puts the water in rendering group 1 with the depth kept across the group boundary", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const frame = createWaterFrame(scene, engine, "copy");
    expect(WATER_GROUP).toBe(1);
    // Babylon clears depth between groups unless told not to
    const info = (scene as unknown as { _renderingManager: { _autoClearDepthStencil: Record<number, { autoClear: boolean }> } })._renderingManager._autoClearDepthStencil;
    expect(info[WATER_GROUP]?.autoClear).toBe(false);
    frame.dispose();
  });

  it("copies before group 1 renders, once per frame, and exposes screen as 1/size", () => {
    engine = new NullEngine({ renderWidth: 320, renderHeight: 200 });
    const scene = new Scene(engine);
    const frame = createWaterFrame(scene, engine, "copy");
    expect(frame.screen).toEqual([1 / 320, 1 / 200]);
    let fired = 0;
    scene.onBeforeRenderingGroupObservable.add((ev) => { if (ev.renderingGroupId === WATER_GROUP) fired++; });
    scene.render();
    expect(fired).toBe(1);
    expect(scene.onBeforeRenderingGroupObservable.hasObservers()).toBe(true);
    frame.dispose();
    expect(scene.onBeforeRenderingGroupObservable.observers.length).toBe(1); // only the test's
  });
});
```

Under `NullEngine` the copy itself cannot run (no frame to copy); the test pins the wiring, and Step 5 proves the copy in a browser.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/waterFrame.test.ts`
Expected: FAIL, cannot resolve `waterFrame.js`.

- [ ] **Step 3: Write `waterFrame.ts`**

```ts
// client/src/game/waterFrame.ts
/**
 * The high tier's view of the opaque pass for the water to read through
 * (spec §4.4, §5.2): the frame's colour copied before the water's rendering
 * group draws, and a depth texture in linear view metres. Two depth sources,
 * chosen by measurement (the plan's Task 6): "copy" reads the main target's
 * depth attachment, "prepass" asks Babylon's PrePassRenderer for its depth
 * texture. Renderer-only.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { CopyTextureToTexture } from "@babylonjs/core/Misc/copyTextureToTexture.js";
import type { Observer } from "@babylonjs/core/Misc/observable.js";
import type { RenderingGroupInfo } from "@babylonjs/core/Rendering/renderingManager.js";

/** The water draws after every opaque mesh, in its own group. */
export const WATER_GROUP = 1;

export type WaterFrame = {
  scene: BaseTexture;
  depth: BaseTexture;
  screen: [number, number];
  dispose(): void;
};

export function createWaterFrame(scene: Scene, engine: AbstractEngine, mode: "copy" | "prepass"): WaterFrame {
  const width = engine.getRenderWidth();
  const height = engine.getRenderHeight();
  // Depth is not cleared between group 0 and group 1: the water must test
  // against the opaque pass it reads.
  scene.setRenderingAutoClearDepthStencil(WATER_GROUP, false, false, false);

  const colour = new RenderTargetTexture("waterScene", { width, height }, scene, false, true,
    Constants.TEXTURETYPE_HALF_FLOAT, false, Texture.BILINEAR_SAMPLINGMODE, false);
  const copier = new CopyTextureToTexture(engine, false, false);

  let depth: BaseTexture;
  let depthCopy: RenderTargetTexture | null = null;
  if (mode === "prepass") {
    const pre = scene.enablePrePassRenderer();
    if (pre === null) throw new Error("water frame: no prepass renderer");
    const index = pre.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE);
    depth = pre.getRenderTarget().textures[index] as BaseTexture;
  } else {
    depthCopy = new RenderTargetTexture("waterDepth", { width, height }, scene, false, true,
      Constants.TEXTURETYPE_FLOAT, false, Texture.NEAREST_SAMPLINGMODE, false, false, false,
      Constants.TEXTUREFORMAT_R);
    depth = depthCopy;
  }

  const observer: Observer<RenderingGroupInfo> = scene.onBeforeRenderingGroupObservable.add((info) => {
    if (info.renderingGroupId !== WATER_GROUP) return;
    const first = scene.activeCamera?._postProcesses.find((p) => p !== null && p !== undefined) ?? null;
    const source = first?.inputTexture ?? null;
    if (source === null || !copier.isReady()) return;
    if (source.texture !== null) copier.copy(source.texture, colour);
    if (depthCopy !== null && source._depthStencilTexture !== null) copier.copy(source._depthStencilTexture, depthCopy);
  })!;

  return {
    scene: colour,
    depth,
    screen: [1 / width, 1 / height],
    dispose() {
      scene.onBeforeRenderingGroupObservable.remove(observer);
      colour.dispose();
      depthCopy?.dispose();
      copier.dispose();
      scene.setRenderingAutoClearDepthStencil(WATER_GROUP, true, true, true);
    },
  };
}
```

Two facts the implementer must check in Babylon 9.18 before trusting this file, and fix in place if they differ: (1) `RenderTargetWrapper._depthStencilTexture` is the depth attachment's `InternalTexture` on WebGPU when the wrapper was made with `generateDepthBuffer` (PostProcess's are); a depth attachment copied with `CopyTextureToTexture` lands as **nonlinear device depth**, so the copy path's shader must linearise: `wSceneDepth = near * far / (far - dev * (far - near))` with `near`/`far` as two more floats packed into a new `waterNearFar` vec2 uniform bound from `scene.activeCamera.minZ/maxZ`. (2) The prepass depth texture holds **linear view depth** already (`PREPASS_DEPTH_TEXTURE_TYPE` stores `vViewPos.z`), so that path uses it unlinearised. Make the choice a `waterDepthLinear` uniform (1 prepass, 0 copy) so one shader serves both while Step 5 measures.

- [ ] **Step 4: The shader's high path and the view-depth varying**

`water.vertex.fx` add `varying float vWaterViewDepth;`; `waterWorldPos.vertex.fx` add `vWaterViewDepth = -(view * worldPos).z;` (`worldPos` is the `vec4` local PBR's vertex stage sets just before `CUSTOM_VERTEX_UPDATE_WORLDPOS`, `pbr.vertex.js`; `view` is the scene UBO's view matrix, declared for every material). In `water.fragment.fx` remove the `float waterViewDepth = 0.0;` stand-in, add `varying float vWaterViewDepth;`, `uniform vec2 waterNearFar;`, `uniform float waterDepthLinear;` to the plugin's UBO list and fragment declarations, and in `waterLights.fragment.fx` replace `waterViewDepth` with `vWaterViewDepth` and the depth read with:

```glsl
  float wRaw = texture2D(waterDepth, wUv).r;
  float wLin = waterNearFar.x * waterNearFar.y / (waterNearFar.y - wRaw * (waterNearFar.y - waterNearFar.x));
  float wSceneDepth = mix(wLin, wRaw, waterDepthLinear);
```

Plugin: `nearFar: [number, number] = [0.05, 1000]`, `depthLinear = 0`, bound each draw. Add to `waterPlugin.test.ts` an assertion that the UBO list names `waterNearFar` and `waterDepthLinear` and that `water.fragment.fx` no longer contains `float waterViewDepth = 0.0;`.

`createWater(..., tier)`: on `"high"`, `const frame = createWaterFrame(scene, scene.getEngine(), WATER_DEPTH_MODE)`; every water mesh gets `renderingGroupId = WATER_GROUP`; both materials `transparencyMode = PBRMATERIAL_OPAQUE`, `needDepthPrePass = false`; plugins get `sceneTexture = frame.scene`, `depthTexture = frame.depth`, `screen = frame.screen`, `nearFar = [camera.minZ, camera.maxZ]` (read per frame in `update`, the camera can change), `depthLinear = WATER_DEPTH_MODE === "prepass" ? 1 : 0`; `dispose` disposes the frame. `WATER_DEPTH_MODE` is a module constant in `waterFrame.ts`, set by Step 5.

The `update` re-creates the frame when `engine.getRenderWidth/Height` change (a resize): dispose and create again, then re-point the plugins.

- [ ] **Step 5: Measure the two depth sources in the browser (WebGPU, high tier) and pick one**

On a quiet machine (load under 3.5, no vitest, no other session's page in the daemon), the spike's paired method (`~/Projects/fps-sdd-archive/2026-09-29-water-spike/measure.py`, blocks a to f, `quiet()`), 1920×1080 headless, `?seed=atmo&tier=high&engine=webgpu&time=12`, the pond pose and a sea pose with water filling the frame. Four pairs each of: `WATER_DEPTH_MODE = "copy"` vs the bed-depth path (`waterHigh` forced 0), and `"prepass"` vs the same. Record per reading: mean frame ms, the four pairs, load, the mode. Write `~/Projects/fps-sdd-archive/2026-09-29-water-material/t6-depth-source.md` with the table and the choice: the cheaper mode that produces a correct still (a wading leg attenuated by its own depth, `t6-wading-high.png`; a still with the copy path off shows the difference). Set `WATER_DEPTH_MODE` to it and add to the spec's §4.4 one sentence with the two numbers. If neither is under the 0.5 ms budget with the material's own cost, the spec's cut order applies: high falls back to the bed-depth path (`waterHigh = 0`, `WetPlugin.attenuate = true` on high too) and the spec's §8 gains that row; say so in the commit.

- [ ] **Step 6: Run the tests, typecheck, lint**

Run: `cd client && npx vitest run test/game/waterFrame.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts test/game/shaderHygiene.test.ts && cd .. && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/waterFrame.ts client/src/game/waterPlugin.ts client/src/game/renderer.ts client/src/game/shaders/water.vertex.fx client/src/game/shaders/waterWorldPos.vertex.fx client/src/game/shaders/water.fragment.fx client/src/game/shaders/waterLights.fragment.fx client/test/game/waterFrame.test.ts client/test/game/waterPlugin.test.ts docs/rendering/2026-09-29-water-material-design.md
git commit -m "feat: the high tier reads the opaque pass through the water"
```

---

### Task 7: Corpus, budgets, look gates and docs

**Files:**
- Modify: `client/shaders/corpus/` (recorded, via `tools/wgsl/merge-corpus.mjs`)
- Modify: `ARCHITECTURE.md` (the water paragraph), `docs/rendering/2026-09-29-water-material-design.md` (§8 measured numbers, §9 gate results)
- Test: `tools/wgsl/check-build.mjs` as CI runs it; the full client suite once

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped WGSL map covering `mat_water_sea`, `mat_water_lake` and every material that now carries `Wet`; the measured budgets; the gate stills in `~/Projects/fps-sdd-archive/2026-09-29-water-material/gates/`.

- [ ] **Step 1: Re-record the corpus**

Per the `shader-corpus-as-files` memory and `AGENTS.md`: with the dev stack up, visit each gate pose (pond, sea shore, wading, night with the headlamp, the trailhead) with `?wgsl=record` on the high tier, **three times each** (a variant shows on one visit in three), download the JSON each time and `node tools/wgsl/merge-corpus.mjs <json>` it; then `npm run build` in `client/` and `node tools/wgsl/check-build.mjs`. Expected: every stage found, zero misses in the page's console (`dayhike-wgsl-map` miss log) on a fresh context.

- [ ] **Step 2: Measure the budgets, three tiers**

The spike's paired method at the pond pose and the sea pose, water filling the frame at 1080p: high on WebGPU (with the Task 6 mode), medium and low on WebGL2 (`?engine=webgl2&tier=medium`, `...low`). Each: material on vs the old ramp (check out `origin/main`'s water in a second worktree on its own ports for the control, or force `waterHigh = 0` and remove the plugin for a same-build control), four pairs, both orders. Record in the spec's §8 as a row of measured numbers with the machine, the date and the load; the budgets 0.5/0.3/0.15 pass or the cut order of §8 is applied and re-measured, each cut a commit of its own.

- [ ] **Step 3: The look gates**

Six stills per the spec's §9 table, sun pinned per reading (`time=` on the URL, reload per still, the `pin-the-sun-for-colour-gates` memory), each saved beside the reference photo id it answers to, in `~/Projects/fps-sdd-archive/2026-09-29-water-material/gates/<gate>.png` with `readings.json` (pose, time, sunY, tier, engine). Present the six pairs to the owner as a local contact sheet (never published); each gate passes on the owner's word in the spec's terms. A failed gate is fixed and re-shot; the fix is a commit of its own with the gate's name in the message.

- [ ] **Step 4: Docs**

`ARCHITECTURE.md`: replace the sentence(s) describing the water's vertex-colour depth ramp with two on the material (per-pixel bed depth from a camera-local height texture, PBR plus `WaterPlugin`, `WetPlugin` on what the water touches, the high tier's copy of the opaque pass). The spec gets its measured §8 row and the §9 gate results (pass/fail and the still's name). No mention of where the photos came from.

- [ ] **Step 5: Full suite, leak scan, and the push**

Run: `npm test` (the full suite, once, on a quiet machine), then the pre-push hook's scan by hand over `origin/main..HEAD`.
Expected: green; the scan reports nothing. Then the `github-push` skill for the branch; CI runs the three suites and the map check.

- [ ] **Step 6: Commit**

```bash
git add ARCHITECTURE.md docs/rendering/2026-09-29-water-material-design.md client/shaders/corpus
git commit -m "docs: the water material as built, its measured cost and its gates"
```
