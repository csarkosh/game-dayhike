# Grass Frame Reclaim Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the canopy pose, high tier, native pixels, the frame is at least 0.8 ms under the near-grass tip (the profile's measured filter saving; the 4× figure reported), with cover ratios not below 0.62 (canopy) and 0.94 (meadow), canopy near cover ≥ 0.45, the luminance ratio in 0.8–1.25 at both poses, and nothing that appears, vanishes or reads as a line on a walk or a turn.

**Architecture:** Four steps in order, each behind its own gate, after a baseline pinned from an in-page profile of the canopy pose. (1) Per-frame frustum filtering: the blade field's 36 buckets and the grass class's 4 keep their collected instances and draw, each frame the view has moved past a threshold, only the prefix inside a slightly widened frustum, with the draw-call count unchanged; the meadow's two buckets only if then measured worthwhile; sector meshes only as the fallback if the filter's JS shows. (2) The meadow's far cards end at 30 m on the tiers with blades, and the terrain carries the sward past 24 m. (3) Cards lean away from the eye by the eye's elevation over them, and their bases hug the ground. (4) Card roots take the floor's colour, and card alpha is scaled by mip level. A WebGPU spike runs beside them on its own branch and ends in a go or a no-go. Nothing under `sim/`.

**Tech Stack:** TypeScript, Babylon.js 9.18 (thin instances, `MaterialPluginBase`, `BoundingInfo`, `AbstractMesh.cullingStrategy`; `WebGPUEngine`, `ComputeShader`, `StorageBuffer` for the spike only), GLSL in `.fx` files and template strings, vitest 4 with `NullEngine`, plain Node ESM under `tools/`.

**Spec:** `docs/rendering/2026-09-26-grass-frame-reclaim-design.md`

## Global Constraints

- No file under `client/src/sim/` changes; the level id does not move (the `CLUTTER_TUNABLES` digest pinned in `client/test/sim/groundGradient.test.ts` is untouched).
- Every numeric expectation in a test is a literal, never the constant it pins. vitest 4 takes a test's timeout as the third argument: `it("…", () => { … }, 20_000)`.
- GLSL rules (`client/test/game/shaderHygiene.test.ts`): no comment spelling a preprocessor directive, no semicolon inside a trailing comment on a code line; a new uniform goes on BOTH the `getUniforms().ubo` list and the non-UBO string.
- Before every commit: `npm run typecheck`, the touched test files (`cd client && npx vitest run <files>`), and `npx eslint <touched files>` green.
- Stage explicit paths only, never `git add -A` or `git add .`.
- Commit format: type-prefixed subject under 72 characters, a blank line, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then the repository's two attribution trailer lines (written `<trailers>` below).
- Public repository: no code comment, doc or commit message describes how an asset was made or the process around the work; write for an engineer reading the code.
- Measurement patches are applied to a worktree for a gate and reverted after it. They are never committed; `git status --porcelain` is clean before any commit.
- The texture files and models under `client/assets/` are never written.

## File map

| File | Task | Change |
| --- | --- | --- |
| `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md` (new) | 1, 2–5, 7 | Created by Task 1 (method, poses, control, the profile pinned, its confirmation); one section per gate; closed by Task 7 |
| `client/src/game/grassCull.ts` (new) | 2 | `CULL_*`, `cullPlanes`, `needsCull`, `cullPrefix`: the per-frame frustum filter |
| `client/src/game/renderer.ts` | 2, 5 | The per-frame `cull` hook; `setFoliageSward` |
| `client/src/game/grassSectors.ts` (new, 2C only) | 2 | `SECTOR_OCTANTS`, the pads, `sectorCount`, `sectorOf`, the box accumulator |
| `client/src/game/clutterField.ts` | 2C, 3 | `CLUTTER_SECTOR_RINGS` (2C only); `clutterOrigin` exported; `CLUTTER_MEADOW_CARD_END`, `CLUTTER_MEADOW_CARD_RAMP`, the far trim and `clutterMeadowFarEdges` |
| `client/src/game/clutterMeshes.ts` | 2, 3, 4, 5 | `CLUTTER_CULLED`, collected and drawn buffers, `cull` (sectors in 2C only); the far edges on tiers with blades; `foliageGrad`; `foliageCover` |
| `client/src/game/bladeField.ts`, `bladeMeshes.ts` | 2, 2D | Collected and drawn buffers, `cull`; in 2C only, `bladeOrigin` exported and `BLADE_SECTOR_RINGS`; each tier's meshes on its rings (2D) |
| `client/src/game/bladeClump.ts` | 2D | `BLADE_TIER_RINGS`; `bladeClumpGeometry` takes the rings |
| `client/src/game/groundHexParams.ts` | 3 | `FAR_SWARD`, `FAR_SWARD_MAX`, `FAR_SWARD_COVER`, `FAR_SWARD_BAND`, `FAR_SWARD_CELL`, `FAR_SWARD_CLUMP`, `FAR_SWARD_WIND`, `FAR_SWARD_GRAZE`, `farSwardWeight` |
| `client/src/game/shaders/sward.fragment.fx` (new) | 3, 5 | `swardGust`, `swardFar`, `swardNearWeight`, `swardFarWeight`: the floor's GLSL, included by the terrain and, from Task 5, the foliage fragment |
| `client/src/game/terrainTexture.ts` | 3 | Four uniforms, the far pull after the near one |
| `client/src/game/foliagePlugin.ts`, `shaders/foliage.vertex.fx`, `shaders/foliageWorldPos.vertex.fx`, `shaders/foliageLights.fragment.fx`, `shaders/foliage.fragment.fx`, `shaders/foliageAlpha.fragment.fx` (new) | 2D, 3, 4, 5 | `foliageWind()` getter; `FOLIAGE_LEAN`, the hug, `FOLIAGE_TILT` removed; `FOLIAGE_ROOT_BAND`, the root's floor colour, the mip-scaled alpha test |
| `tools/cardCoverage/cardCoverage.mjs` (new), `tools/cardCoverage/test/cardCoverage.test.mjs` (new) | 5 | Reads a card model's embedded alpha, prints coverage per box mip and the scale |
| `ARCHITECTURE.md` | 2, 3, 4, 5 | One sentence per step in the Rendering section |
| Tests: `grassCull.test.ts` (new), `grassSectors.test.ts` (new, 2C only), `clutterMeshes.test.ts`, `clutterField.test.ts`, `bladeMeshes.test.ts`, `groundHexParams.test.ts`, `terrainTexture.test.ts`, `foliagePlugin.test.ts` | 2–5 | As each task says |
| Spike branch only: `client/src/app.ts`, `renderer.ts`, `bladeGpu.ts` (new), `client/public/libs/webgpu/` | 6 | Never merged; its report is |

---

### Task 1: The baseline, pinned from the profile

No code. The in-page profile of the canopy pose (design §4.4) already measured where the frame goes; this task writes its figures into the verification note as literals, with its caveats, confirms them with one short-page run, and measures the two things the profile did not: the fullness reproduction on `main` and the far crop.

**Files:**
- Create: `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md`

**Interfaces:**
- Consumes: a control worktree detached at the commit `main` stood at before the near-grass merge (`git worktree add --detach <path> 9c97483`, then `npm ci`) and a tip worktree at `origin/main` after the merge, each serving its own build on its own port; the near-grass measurement patches (its plan, Task 1 Step 1: `__fcSet`, `__scene`/`__engine`, `?tier=`, a port per worktree).
- Produces: the note's §1 Method, §2 Poses and crops, §3 Control and profile, §4 Confirmation, which every gate appends to.

- [ ] **Step 1: Reproduce the fullness**

Near-grass verification §1 and §2, unchanged: `/dayhike/game/<fresh uuid>?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=high`, window 1200 × 2029 CSS pixels at device pixel ratio 1, 20 s to load, the pose, 8 s, the still; then the three isolation stills. Measure with that note's `fullness.py`, crops and thresholds, on the tip.

Expected (near-grass fourth gate, build A): canopy near cover 0.459, mid cover 0.734, cover ratio 0.62, luminance ratio 1.25; meadow near cover 0.472, mid cover 0.503, cover ratio 0.94, luminance ratio 0.96. A cover ratio more than 0.02 off means the page, the pose or the crop differs; find which before going on.

- [ ] **Step 2: The far crop**

At both poses, project the ground at 30 m and 38 m through the camera (vertical field of view 1.4 rad, pitch 0.3, the eye 1.6 m over the ground under the pose, the ground's rise read from the simulation along the view) to two screen rows; take a rectangle between them as wide as the mid crop and centred on it; draw it onto the still (`ffmpeg -vf drawbox=…`) and move it sideways until it lies on the sward, clear of any trunk, stump or prop. Record `W:H:X:Y` per pose as a literal, and the tip's far mean and far cover against the pose's threshold.

- [ ] **Step 3: Pin the profile**

Write into the note, as literals, design §3.1's inventory, §3.3's JS and GPU table, §3.4's off-frustum table and §4.4's figures table, with the method and the caveats in words:

| build, scale | frame (ms) | JS per frame | active-mesh evaluation | draw phase (JS) | draw calls |
| --- | --- | --- | --- | --- | --- |
| control, native | 22.4 | 2.7 | 0.45 | 1.3 | 160 |
| tip, native | 24.0 | 3.8 | 0.64 | 1.7 | 162 |
| control, 4× | 53.2 | 4.6 | 0.77 | 1.9 | 160 |
| tip, 4× | 54.8 | 4.6–5.1 | 0.8 | 2.0–2.3 | 160–164 |

Reliable costs at native on the tip: blades −1.36 ± 0.20 ms, grass-class cards −0.52 ± 0.12, meadow far −0.44 ± 0.05, meadow near −0.30 ± 0.13 (−0.53 ± 0.04 in the long-page run); filter all three −0.82 ± 0.14. At 4×: grass-class cards −0.51 ± 0.09, meadow filter −0.06 ± 0.09. Off-frustum: meadow 9,850 of 11,393, blades 5,068 of 6,131, grass class 3,872 of 4,559.

Caveats, stated in the note's §1 and applied at every gate: the WebGL2 GPU timer on ANGLE over Metal reads about twice the frame interval and is a sign only; 4× pages drift under sustained load (a base from 54 to 96 ms on one page), so 4× figures are read only from short, rested pages whose "off" frame is within 0.3 ms of the build's floor.

- [ ] **Step 4: The confirmation run**

One short-page run on the tip at the canopy pose, native pixels, by the profile's method (design §4.4: 1.5 s toggles, six cycles, alternating first state, three conditions a page, a fresh browser and a discarded warm-up page each, 60 s rest between pages): **hide blades**, **hide grass-class cards**, **filter all three to the frustum**. The filter rewrites each layer's `matrix`, `fadeBands` or `bladeStrength`, and `foliage` buffers to the instances whose origin, lifted 0 and 0.8 m, is inside `scene.frustumPlanes` with a 0.75 m sphere, sets the count, and restores the originals after.

Bar: each within its profile band (−1.36 ± 0.20, −0.52 ± 0.12, −0.82 ± 0.14), or within 0.3 ms of it. If one is outside, run it on two more pages; if it stays outside, the note records the new figure and design §5.8's arithmetic is redone with it before Task 2 is built.

- [ ] **Step 5: Write the note and commit**

`docs/rendering/2026-09-26-grass-frame-reclaim-verification.md`: §1 Method (the patches in words, the page, the stills, the crops with the far crop, the pair method of design §12.3, the toggle method and its caveats), §2 Poses and crops, §3 Control and profile (fullness and isolation, the far crop, Step 3's tables), §4 Confirmation (Step 4's table against the profile's).

```bash
git add docs/rendering/2026-09-26-grass-frame-reclaim-verification.md
git commit -F - <<'EOF'
docs: pin where the grass frame goes at the canopy pose

## What

The baseline the frame reclaim is measured against: the near-grass
fullness reproduced on main, a far crop for the ground past 30 m, and
the canopy profile's layer costs and off-frustum shares as literals,
confirmed on short pages. The blades and the grass-class cards carry
the cost; filtering all three layers to the frustum saves 0.82 ms at
native.

## How

- `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md` — the
  method and its caveats, the poses and crops, the control, the
  profile's tables and the confirmation run.

<trailers>
EOF
```

---

### Task 2: Step 1 — cull to the frustum

Three parts: **2A** the blade field's 36 buckets and the grass class's 4, filtered to the frustum each frame the view moves (design §5.2); a gate; **2B** the meadow's 2 buckets by the same filter, only if that gate measures them worth it; **2C** sector meshes, the fallback, only if the filter's JS shows in the gate (design §5.6–§5.9).

**As built** (design §5.10): 2A shipped with `CULL_MARGIN` 6° and `CULL_RADIUS` 1.5 m, and a context-restore hand-back of the drawn buffers; after its gate, the planes turn with the camera's roll (`roll` in `CullPose`, `CULL_ROLL` 1°) and `CULL_TURN` is 3.5° (design §5.2's as-built note). Its pass was then rebuilt for speed, keeping what it keeps: `cullPrefix(planes, count, set: CullSet): boolean` over a `CullSet` (`cullSet`, `cullInvalidate`) that holds each bucket's translations apart, moves the matrix and vec4 streams as float64 pairs and returns false, copying nothing, when a bucket keeps exactly its last cut; the shells upload only buckets that changed. 2B is dropped (0.05 ms measured against its 0.15 ms threshold) and 2C not taken. The bar for 2A was re-based, after its gate, on the measured exact-frustum ceiling: at least 70 % of it at native, no pop, no fullness loss. −0.42 of 0.58 ms is 72 % (64–84 % on the ceiling's spread, the two figures from different methods; about 79 % like for like, the ceiling including the meadow's 0.05 ms): design §5.10.

**Files:**
- Create: `client/src/game/grassCull.ts`, `client/test/game/grassCull.test.ts`
- Modify: `client/src/game/bladeMeshes.ts` (collected and drawn buffers; `cull`)
- Modify: `client/src/game/clutterMeshes.ts` (collected and drawn buffers for filtered classes; `cull`; `CLUTTER_CULLED`)
- Modify: `client/src/game/renderer.ts` (the per-frame hook)
- Modify: `ARCHITECTURE.md` (the blade and clutter sentences)
- Test: `client/test/game/bladeMeshes.test.ts`, `client/test/game/clutterMeshes.test.ts`
- 2C only: `client/src/game/grassSectors.ts` and its test, `bladeField.ts`, `clutterField.ts`

**Interfaces:**
- Consumes: `inCone`, `View` (`wildlifeDirector.ts`) in the tests; the camera's `globalPosition`, `rotation`, `fov` and `engine.getAspectRatio(camera)`.
- Produces:
  - `export const CULL_MARGIN = (5 * Math.PI) / 180`, `CULL_PUSHBACK = 1`, `CULL_RADIUS = 0.75`, `CULL_TURN = (4 * Math.PI) / 180`, `CULL_MOVE = 0.5`
  - `export type CullPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; aspect: number }`
  - `export function cullPlanes(pose: CullPose, out: Float32Array): void` — five planes (four sides and the pushed-back near), four floats each, inward normals, widened by `CULL_MARGIN`
  - `export function needsCull(last: CullPose | null, pose: CullPose): boolean`
  - `export type CullStream = { src: Float32Array; dst: Float32Array; stride: number }`
  - `export function cullPrefix(planes: Float32Array, count: number, matrix: CullStream, attrs: readonly CullStream[]): number` — copies the kept instances, in order, to the front of every `dst`, returns the kept count
  - `cull(pose: CullPose | null): void` on `BladeMeshes` and `ClutterMeshes`; `null` keeps every instance
  - `export const CLUTTER_CULLED: ReadonlySet<number>` (`clutterMeshes.ts`): `CLUTTER_GRASS` in 2A; `CLUTTER_MEADOW` added in 2B

- [ ] **Step 1: The pure pass, test first**

`client/test/game/grassCull.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CULL_MARGIN, CULL_MOVE, CULL_PUSHBACK, CULL_RADIUS, CULL_TURN,
  cullPlanes, cullPrefix, needsCull, type CullPose,
} from "../../src/game/grassCull.js";
import { inCone } from "../../src/game/wildlifeDirector.js";

const POSE: CullPose = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, fov: 1.4, aspect: 1200 / 2029 };

/** n instances on the ground: translations at (x, 0, z), one attribute of stride 4 holding the index. */
function field(points: [number, number][]) {
  const n = points.length;
  const src = new Float32Array(n * 16), attr = new Float32Array(n * 4);
  points.forEach(([x, z], i) => { src[i * 16] = src[i * 16 + 5] = src[i * 16 + 10] = src[i * 16 + 15] = 1; src[i * 16 + 12] = x; src[i * 16 + 14] = z; attr[i * 4] = i; });
  return { n, matrix: { src, dst: new Float32Array(n * 16), stride: 16 }, attrs: [{ src: attr, dst: new Float32Array(n * 4), stride: 4 }] };
}
function kept(points: [number, number][], pose: CullPose): number[] {
  const f = field(points);
  const planes = new Float32Array(20);
  cullPlanes(pose, planes);
  const k = cullPrefix(planes, f.n, f.matrix, f.attrs);
  return Array.from(f.attrs[0]!.dst.subarray(0, k * 4)).filter((_, j) => j % 4 === 0);
}

describe("grass cull", () => {
  it("pins the margins and thresholds", () => {
    expect(CULL_MARGIN).toBeCloseTo(0.0872665, 7);
    expect([CULL_PUSHBACK, CULL_RADIUS, CULL_MOVE]).toEqual([1, 0.75, 0.5]);
    expect(CULL_TURN).toBeCloseTo(0.0698132, 7);
  });

  it("keeps what the widened frustum holds, in order", () => {
    // Yaw 0 faces +Z. The portrait still's half-width is 26.49°, 31.49° widened,
    // from an apex 1 m behind the eye.
    const pts: [number, number][] = [
      [0, 10],                                   // ahead: kept
      [10 * Math.tan((30 * Math.PI) / 180), 10], // inside the widened edge: kept
      [10 * Math.tan((40 * Math.PI) / 180), 10], // 1.41 m past it: dropped
      [0, -0.5],                                 // just behind the eye, inside the pushback: kept
      [0, -10],                                  // behind: dropped
      [-2, 20],                                  // ahead: kept
    ];
    expect(kept(pts, POSE)).toEqual([0, 1, 3, 5]);
  });

  it("is a pure function of the pose and the collected set", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 400; i++) pts.push([Math.sin(i * 12.9898) * 30, Math.cos(i * 78.233) * 30]);
    const a = kept(pts, POSE);
    kept(pts, { ...POSE, yaw: 2 }); // another pose in between changes nothing
    expect(kept(pts, POSE)).toEqual(a);
  });

  it("never drops an instance the camera can see within the thresholds", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 2000; i++) pts.push([Math.sin(i * 12.9898) * 25, Math.cos(i * 78.233) * 25]);
    for (const base of [POSE, { ...POSE, yaw: 1.571, pitch: 0.3 }, { ...POSE, yaw: 3, pitch: 0.9, aspect: 16 / 9 }]) {
      const keep = new Set(kept(pts, base));
      for (const [dyaw, dpitch, dx, dz] of [[0.0698, 0, 0, 0], [-0.0698, 0.0698, 0, 0], [0, 0, 0.5, 0], [0.05, -0.05, -0.35, 0.35]]) {
        const view = { x: base.x + dx, y: base.y, z: base.z + dz, yaw: base.yaw + dyaw, pitch: base.pitch + dpitch, fov: base.fov, aspect: base.aspect };
        pts.forEach(([x, z], i) => {
          if (inCone(view, x, 0, z, 0) || inCone(view, x, 0.8, z, 0)) expect(keep.has(i)).toBe(true);
        });
      }
    }
  }, 20_000);

  it("refilters past a threshold, not below", () => {
    expect(needsCull(null, POSE)).toBe(true);
    expect(needsCull(POSE, { ...POSE, yaw: 0.05 })).toBe(false);
    expect(needsCull(POSE, { ...POSE, yaw: 0.08 })).toBe(true);
    expect(needsCull(POSE, { ...POSE, pitch: -0.08 })).toBe(true);
    expect(needsCull(POSE, { ...POSE, x: 0.4 })).toBe(false);
    expect(needsCull(POSE, { ...POSE, x: 0.4, z: 0.4 })).toBe(true);
  });
});
```

Run `cd client && npx vitest run test/game/grassCull.test.ts`: FAIL (no module). Then `client/src/game/grassCull.ts`:

```ts
/**
 * Per-frame frustum filtering of thin-instance buckets. A bucket's instances
 * surround the eye and Babylon draws a thin-instanced mesh whole or not at
 * all, so a bucket of grass is vertex-shaded in full whatever the view; at a
 * walking gaze five in six of its instances are outside it. The shells keep
 * each bucket's full collected buffers on the CPU and draw a prefix: the
 * instances inside a frustum widened by CULL_MARGIN on every side and pushed
 * back CULL_PUSHBACK behind the eye, copied in order to the front of the
 * drawn buffers. The prefix is refiltered only when the camera has turned by
 * CULL_TURN or moved by CULL_MOVE since it was cut, and those sit inside the
 * margins, so an instance the camera can see is always in the prefix.
 * Pure and Babylon-free: the planes are built from the pose, not read from the
 * scene, so the kept set is a function of the pose and the collected set.
 */
export const CULL_MARGIN = (5 * Math.PI) / 180;
export const CULL_PUSHBACK = 1;
/** An instance's reach beyond its translation: a card's half-width at its
 * largest scale, the wind's lean and the lean toward the eye. */
export const CULL_RADIUS = 0.75;
export const CULL_TURN = (4 * Math.PI) / 180;
export const CULL_MOVE = 0.5;

export type CullPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; aspect: number };
export type CullStream = { src: Float32Array; dst: Float32Array; stride: number };

export function cullPlanes(pose: CullPose, out: Float32Array): void {
  // Forward, right and up as inCone (wildlifeDirector.ts) has them: yaw 0
  // faces +Z, positive pitch looks down, no roll.
  const sy = Math.sin(pose.yaw), cy = Math.cos(pose.yaw), sp = Math.sin(pose.pitch), cp = Math.cos(pose.pitch);
  const fx = sy * cp, fy = -sp, fz = cy * cp;
  const rx = cy, ry = 0, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  const ax = pose.x - fx * CULL_PUSHBACK, ay = pose.y - fy * CULL_PUSHBACK, az = pose.z - fz * CULL_PUSHBACK;
  const halfY = pose.fov / 2 + CULL_MARGIN;
  const halfX = Math.atan(Math.tan(pose.fov / 2) * pose.aspect) + CULL_MARGIN;
  const side = (k: number, ex: number, ey: number, ez: number, half: number, sign: number) => {
    // Inward normal of the plane through the apex containing the edge direction.
    const c = Math.cos(half), s = Math.sin(half);
    const nx = fx * s - sign * ex * c, ny = fy * s - sign * ey * c, nz = fz * s - sign * ez * c;
    out[k] = nx; out[k + 1] = ny; out[k + 2] = nz; out[k + 3] = -(nx * ax + ny * ay + nz * az);
  };
  side(0, rx, ry, rz, halfX, 1);
  side(4, rx, ry, rz, halfX, -1);
  side(8, ux, uy, uz, halfY, 1);
  side(12, ux, uy, uz, halfY, -1);
  out[16] = fx; out[17] = fy; out[18] = fz; out[19] = -(fx * ax + fy * ay + fz * az);
}

export function needsCull(last: CullPose | null, pose: CullPose): boolean {
  if (last === null) return true;
  if (Math.abs(pose.yaw - last.yaw) > CULL_TURN || Math.abs(pose.pitch - last.pitch) > CULL_TURN) return true;
  const dx = pose.x - last.x, dy = pose.y - last.y, dz = pose.z - last.z;
  return dx * dx + dy * dy + dz * dz > CULL_MOVE * CULL_MOVE;
}

export function cullPrefix(planes: Float32Array, count: number, matrix: CullStream, attrs: readonly CullStream[]): number {
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 16;
    const x = matrix.src[o + 12]!, y = matrix.src[o + 13]!, z = matrix.src[o + 14]!;
    let inside = true;
    for (let p = 0; p < 20; p += 4) {
      if (planes[p]! * x + planes[p + 1]! * y + planes[p + 2]! * z + planes[p + 3]! < -CULL_RADIUS) { inside = false; break; }
    }
    if (!inside) continue;
    // Always across arrays, collected into drawn, so the collected set survives.
    matrix.dst.set(matrix.src.subarray(o, o + 16), kept * 16);
    for (const a of attrs) a.dst.set(a.src.subarray(i * a.stride, (i + 1) * a.stride), kept * a.stride);
    kept++;
  }
  return kept;
}
```

(The yaw difference is taken without wrapping; a turn across ±π refilters once, which is harmless. The `subarray` views allocate per kept instance; if the gate's JS histogram shows it, they become index loops.) Run: PASS.

- [ ] **Step 2: The blade shell, test first**

`client/test/game/bladeMeshes.test.ts`:

```ts
describe("the blade field culled to the frustum", () => {
  const POSE = { x: CAM.x, y: 0, z: CAM.z, yaw: 1.571, pitch: 0.3, fov: 1.4, aspect: 1200 / 2029 };

  it("draws each bucket's kept prefix, uploads only it, and adds no mesh", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    blades.update(CAM.x, CAM.z);
    const meshCount = scene.meshes.length;
    const pose = { ...POSE, y: elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.6 };
    const partial = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
    const whole = vi.spyOn(Mesh.prototype, "thinInstanceBufferUpdated");
    blades.cull(pose);
    const planes = new Float32Array(20);
    cullPlanes(pose, planes);
    const tiers = collectBladeCells(SEED, CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    let drawn = 0, collected = 0;
    for (const mesh of blades.meshes) {
      const [, c, t, s] = /_c(\d)_t(\d)_s(\d)$/.exec(mesh.name)!.map(Number);
      const cells = lists[t!]!.filter((cell) => cell.character === c && cell.size === s);
      collected += cells.length;
      // The kept cells are those whose translation the planes keep, in list order.
      const want = cells.filter((cell) => {
        const y = cell.groundH - 0.02; // the translation instanceMatrixFor writes: the ground less the sink
        for (let p = 0; p < 20; p += 4) if (planes[p]! * cell.x + planes[p + 1]! * y + planes[p + 2]! * cell.z + planes[p + 3]! < -0.75) return false;
        return true;
      });
      expect(mesh.isEnabled() ? mesh.thinInstanceCount : 0).toBe(want.length);
      if (!mesh.isEnabled()) continue;
      drawn += want.length;
      expect(mesh.thinInstanceGetWorldMatrices().map((m) => [m.m[12], m.m[14]].map(Math.fround))).toEqual(want.map((cell) => [cell.x, cell.z].map(Math.fround)));
    }
    // The prefix is a fraction of what was collected: about a fifth at this pose.
    expect(drawn / collected).toBeLessThan(0.35);
    // Only prefixes are uploaded, never more than the kept count, never whole.
    for (let k = 0; k < partial.mock.calls.length; k++) {
      const [, len, offset] = partial.mock.calls[k]!;
      expect(offset).toBe(0);
      expect(len as number).toBeLessThanOrEqual((partial.mock.instances[k] as Mesh).thinInstanceCount);
    }
    expect(whole).not.toHaveBeenCalled();
    // A second call at the same pose does nothing.
    partial.mockClear();
    blades.cull(pose);
    expect(partial).not.toHaveBeenCalled();
    expect(scene.meshes.length).toBe(meshCount);
    partial.mockRestore(); whole.mockRestore();
    blades.dispose(); engine.dispose();
  }, 60_000);
});
```

Run `cd client && npx vitest run test/game/bladeMeshes.test.ts`: FAIL (`cull` is not a function).

Implement in `client/src/game/bladeMeshes.ts`: a bucket's `buf`, `foliage` and `strength` become its **collected** buffers, written by the rebuild as now; the bucket gains `drawn: { buf, foliage, strength }` of equal capacity, grown with them, and `streams: { matrix: CullStream; attrs: CullStream[] }` rebuilt only on growth. `applyBucket` on a rebuild calls `thinInstanceSetBuffer` with the drawn arrays only when grown, and marks the shell dirty; it no longer uploads. `cull(pose)`: `if (!dirty && !needsCull(last, pose)) return;` then `cullPlanes(pose, planes)` into a module-level `Float32Array(20)`, and per bucket `kept = cullPrefix(planes, count, streams.matrix, streams.attrs)`, `mesh.thinInstanceCount = kept`, and if `kept > 0` `thinInstancePartialBufferUpdate("matrix", kept, 0)`, `("foliage", kept, 0)`, `("bladeStrength", kept, 0)`; `mesh.setEnabled(kept > 0)`; `last = pose` copied into a module-level record, `dirty = false`. The file-head comment gains the filter's paragraph (design §5.2) and says the draw count is the buckets', unchanged. `cull(null)` keeps every instance (the tests' and the gate switch's way to draw the collected set whole). Run: PASS, with the existing `bladeMeshes` tests that read buffers after `update` calling `blades.cull(null)` first, their literals unchanged.

- [ ] **Step 3: The grass class, test first**

`client/test/game/clutterMeshes.test.ts`, inside `describe("the cards beside the blade field", …)` with its `build(nearBlades)`: the same shape as Step 2's test over the grass class's four buckets (`assets[CLUTTER_GRASS][variant][lod][0]`), the kept cards being those of `collectClutter(1, 35, 21335)[CLUTTER_GRASS]` in that bucket whose translation the planes keep, in collector order, with `matrix`, `fadeBands` and `foliage` prefixes matching the collected ones; partial uploads only, never over the kept count; no mesh added; the meadow's buckets untouched by `cull` (their `thinInstanceCount` the collector's full count, 2,801 near). And `expect([...CLUTTER_CULLED]).toEqual([CLUTTER_GRASS])`.

Run: FAIL. Implement in `clutterMeshes.ts`: `CLUTTER_CULLED = new Set([CLUTTER_GRASS])` with a comment (the grass class's cards are 172–410 vertices over a 110 m disc; the meadow's 20-vertex cards measured no saving); for buckets of a culled class, the same collected/drawn split, streams and `cull` as the blades (`fadeBands` and `foliage` as attributes); every other bucket as today. `ClutterMeshes.cull(pose)`. Run: PASS.

- [ ] **Step 4: The hook**

`client/src/game/renderer.ts`, after the shells are created:

```ts
  // The grass is culled to the frustum here, once the camera's pose for the
  // frame is final (the view bob included) and before Babylon picks the
  // active meshes; the shells refilter only when the view has moved past
  // grassCull.ts's thresholds.
  const cullPose: CullPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 1.4, aspect: 1 };
  scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    const p = camera.globalPosition;
    cullPose.x = p.x; cullPose.y = p.y; cullPose.z = p.z;
    cullPose.yaw = camera.rotation.y; cullPose.pitch = camera.rotation.x;
    cullPose.fov = camera.fov; cullPose.aspect = engine.getAspectRatio(camera);
    bladeMeshes?.cull(cullPose);
    clutterMeshes?.cull(cullPose);
  });
```

`ARCHITECTURE.md`: the blade and grass-class buckets keep their full instance lists and each frame the view has moved draw only the prefix inside a slightly widened frustum, with the draw count unchanged.

Run: `cd client && npx vitest run test/game/grassCull.test.ts test/game/bladeMeshes.test.ts test/game/clutterMeshes.test.ts test/game/renderer.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/grassCull.ts client/src/game/bladeMeshes.ts client/src/game/clutterMeshes.ts client/src/game/renderer.ts ARCHITECTURE.md client/test/game/grassCull.test.ts client/test/game/bladeMeshes.test.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: draw only the blades and grass cards inside the view

## What

Babylon draws a thin-instanced mesh whole or not at all, and the blade
and grass-class buckets surround the eye, so every clump and card was
vertex-shaded every frame, five in six of them outside the view. Each
bucket now keeps its collected instances on the CPU and draws the
prefix inside a frustum widened by 5° and pushed back a metre, cut
again only when the camera has turned 4° or moved half a metre, with
only that prefix uploaded. The draw calls do not change.

## How

- `client/src/game/grassCull.ts` — the widened planes, the thresholds
  and the prefix copy; pure in the pose and the collected set.
- `client/src/game/bladeMeshes.ts`, `client/src/game/clutterMeshes.ts` —
  collected and drawn buffers, `cull`, partial uploads;
  `CLUTTER_CULLED` holds the grass class.
- `client/src/game/renderer.ts` — the per-frame hook before the active
  meshes are picked.
- `ARCHITECTURE.md` — the filter.
- `client/test/game/grassCull.test.ts`, `bladeMeshes.test.ts`,
  `clutterMeshes.test.ts` — the planes and thresholds as literals, the
  kept set a function of the pose, nothing visible dropped, uploads
  never past the kept count, no mesh added.

<trailers>
EOF
```

- [ ] **Step 6: Gate for 2A**

Branch against control, the patches of Task 1 applied to both; a gate-only switch on the branch (`globalThis.__cull = (on) => …`; off passes `null` to both shells' `cull`).

1. **Fullness** at both poses with the isolation; bar as design §12.1.
2. **Invisible culling:** at each pose, on one branch page, two stills 0.5 s apart with `__cull(false)`, then one with `__cull(true)`; the mean absolute difference in linear luminance between the first two and between the second and third. Bar: the second no larger than the first by more than 10 %.
3. **Frame** (design §12.3): the canopy pose at native, the bar's view; 4× on short, rested pages, reported; the meadow pose and the 16:9 window reported. Expected at the canopy pose at native: **about −0.78 ms (−0.64 to −0.92)** (design §5.4); at 16:9 about −0.60.
4. **The invariant:** draw calls at the gate still 160–164, as the control's; the JS frame time; and the filter pass's own JS time, timed around each `cull` that refilters, as a histogram over the walk and the continuous turn (design §12.4): passes per second, median and p95 ms. Expected 0.1–0.25 ms a pass.
5. **The meadow's worth** (for 2B): on a branch page at native, the profile's toggle, filtering the meadow's two buckets to the frustum against not. Record the saving.
6. **The turn** (step-wise and continuous) and **the walk**. Bar: nothing appears or vanishes at a frame edge.

If the frame misses −0.8 ms, the margins narrow (design §13: 3° and 0.5 m, thresholds 2° and 0.25 m), a commit with its literals, and re-gate. If the JS time grows by more than the native frame shrinks, the margins widen first (10° and 2 m, thresholds 8° and 1 m); if it still shows, 2C. Append `## 5. Step 1: culling the blades and grass cards`; commit the note alone (`docs: gate the frustum filter at both poses`).

- [ ] **Step 7 (2B, only if Step 6's meadow saving is ≥ 0.15 ms at native): the meadow**

Failing test first: `CLUTTER_CULLED` is `[CLUTTER_GRASS, CLUTTER_MEADOW]`; the meadow's two buckets after `cull` draw their kept prefix, with `fadeBands` `[1, 2.5, 8, 18]` (near, on tiers with blades) and `[8, 18, 28, 40]` (far) copied with each card, partial uploads only. Add `CLUTTER_MEADOW` to the set; run; commit `feat: draw only the meadow cards inside the view`; re-run Step 6's frame, invariant and invisible-culling items and append them to §5. If the saving was under 0.15 ms, the note records it and the meadow stays as it is.

- [ ] **Step 8 (2C, only if Step 6 finds the filter's JS showing): sectors**

The fallback of design §5.6–§5.9. The filter is removed from whichever layers it showed on (a revert of those buckets' part of Step 5, kept as its own commit), and those buckets are sectored instead, by the sub-steps below. Gate as Step 6, with the draw calls expected at about 250 and the invariant of item 4 replaced by design §5.9's JS rule.

- [ ] **Step 8a: The pure sector module, test first**

`client/test/game/grassSectors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SECTOR_OCTANTS, SECTOR_PAD_DOWN, SECTOR_PAD_UP, SECTOR_PAD_XZ,
  growBox, paddedBox, resetBoxes, sectorCount, sectorOf,
} from "../../src/game/grassSectors.js";

describe("grass sectors", () => {
  it("pins the layout constants", () => {
    expect(SECTOR_OCTANTS).toBe(8);
    expect([SECTOR_PAD_XZ, SECTOR_PAD_DOWN, SECTOR_PAD_UP]).toEqual([1, 0.5, 1]);
    expect(sectorCount([2.5])).toBe(16);
    expect(sectorCount([18])).toBe(16);
    expect(sectorCount([])).toBe(8);
    expect(sectorCount([6, 14])).toBe(24);
  });

  it("numbers octants clockwise from +Z, rings outward", () => {
    // Octant 0 starts at +Z (yaw 0 faces +Z) and runs toward +X; ring-major.
    expect(sectorOf(0, 1, 0, 0, [2.5])).toBe(0);
    expect(sectorOf(1, 0, 0, 0, [2.5])).toBe(2);
    expect(sectorOf(0, -1, 0, 0, [2.5])).toBe(4);
    expect(sectorOf(-1, 0, 0, 0, [2.5])).toBe(6);
    expect(sectorOf(0, 4, 0, 0, [2.5])).toBe(8);
    expect(sectorOf(-4, -4, 0, 0, [2.5])).toBe(13);
    // An octant edge belongs to the octant it opens: the diagonal +X+Z is octant 1.
    expect(sectorOf(2, 2, 0, 0, [])).toBe(1);
    // A ring edge belongs to the ring outside it.
    expect(sectorOf(0, 2.5, 0, 0, [2.5])).toBe(8);
    // Relative to the origin, not the world.
    expect(sectorOf(103, 50, 100, 50, [])).toBe(2);
  });

  it("pads each sector's box and reports an empty one", () => {
    const boxes = new Float32Array(6 * 2);
    resetBoxes(boxes);
    growBox(boxes, 0, 1, 10, 2);
    growBox(boxes, 0, 3, 11, -1);
    const out = new Float32Array(6);
    expect(paddedBox(boxes, 0, out)).toBe(true);
    expect(Array.from(out)).toEqual([0, 9.5, -2, 4, 12, 3]);
    expect(paddedBox(boxes, 1, out)).toBe(false);
  });
});
```

Run `cd client && npx vitest run test/game/grassSectors.test.ts`: FAIL (no module). Then `client/src/game/grassSectors.ts`:

```ts
/**
 * Sectors of a thin-instance bucket: octants of the bearing from the bucket's
 * rebuild origin crossed with rings of distance from it. A bucket's instances
 * surround the eye, so Babylon, which frustum-tests a thin-instanced mesh as
 * one box, can never cull it; split into sectors, each with its own box, most
 * of a bucket falls outside the view and is not drawn. Pure and Babylon-free:
 * the shells own the meshes, this owns which sector an instance is in and the
 * box a sector needs.
 *
 * The octant is the bearing from +Z (yaw 0) toward +X, so it agrees with the
 * camera's yaw. Rings run outward; the index is ring-major.
 */

/** Bearings per ring. */
export const SECTOR_OCTANTS = 8;
/** Padding (m) of a sector's box beyond its instances' translations:
 * sideways for a card's half-width at its largest scale (0.47 m, the meadow
 * card), the wind's lean and the lean toward the eye; down for the far sink;
 * up for the tallest card or clump. */
export const SECTOR_PAD_XZ = 1;
export const SECTOR_PAD_DOWN = 0.5;
export const SECTOR_PAD_UP = 1;

export function sectorCount(rings: readonly number[]): number {
  return (rings.length + 1) * SECTOR_OCTANTS;
}

const OCTANT = Math.PI / 4;

export function sectorOf(x: number, z: number, ox: number, oz: number, rings: readonly number[]): number {
  const dx = x - ox, dz = z - oz;
  const bearing = Math.atan2(dx, dz);
  const octant = Math.min(SECTOR_OCTANTS - 1, Math.floor((bearing < 0 ? bearing + 2 * Math.PI : bearing) / OCTANT));
  const d2 = dx * dx + dz * dz;
  let ring = 0;
  while (ring < rings.length && d2 >= (rings[ring] as number) * (rings[ring] as number)) ring++;
  return ring * SECTOR_OCTANTS + octant;
}

/** Six floats per sector: min x, y, z, max x, y, z of its translations. */
export function resetBoxes(boxes: Float32Array): void {
  for (let k = 0; k < boxes.length; k += 6) {
    boxes[k] = boxes[k + 1] = boxes[k + 2] = Infinity;
    boxes[k + 3] = boxes[k + 4] = boxes[k + 5] = -Infinity;
  }
}

export function growBox(boxes: Float32Array, k: number, x: number, y: number, z: number): void {
  const o = k * 6;
  if (x < boxes[o]!) boxes[o] = x;
  if (y < boxes[o + 1]!) boxes[o + 1] = y;
  if (z < boxes[o + 2]!) boxes[o + 2] = z;
  if (x > boxes[o + 3]!) boxes[o + 3] = x;
  if (y > boxes[o + 4]!) boxes[o + 4] = y;
  if (z > boxes[o + 5]!) boxes[o + 5] = z;
}

export function paddedBox(boxes: Float32Array, k: number, out: Float32Array): boolean {
  const o = k * 6;
  if (!(boxes[o]! <= boxes[o + 3]!)) return false;
  out[0] = boxes[o]! - SECTOR_PAD_XZ;
  out[1] = boxes[o + 1]! - SECTOR_PAD_DOWN;
  out[2] = boxes[o + 2]! - SECTOR_PAD_XZ;
  out[3] = boxes[o + 3]! + SECTOR_PAD_XZ;
  out[4] = boxes[o + 4]! + SECTOR_PAD_UP;
  out[5] = boxes[o + 5]! + SECTOR_PAD_XZ;
  return true;
}
```

In `clutterMeshes.ts`, beside `prepBucketMesh`:

```ts
const scratchBox = new Float32Array(6);
const scratchMin = new Vector3();
const scratchMax = new Vector3();

/** A sector mesh: a bucket copy Babylon frustum-tests on its own box. The
 * default culling strategy tests only the sphere around the box, which for a
 * sector reaches far past it; the standard one tests the sphere, then the box. */
export function prepSectorMesh(mesh: Mesh): void {
  prepBucketMesh(mesh);
  mesh.alwaysSelectAsActiveMesh = false;
  mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD;
}

/** A sector's box from its instances' translations, padded (grassSectors.ts),
 * set directly: `thinInstanceRefreshBoundingInfo` would transform the model
 * box's corners by every matrix, and the fill has the translations already. */
export function setSectorBox(mesh: Mesh, boxes: Float32Array, k: number): void {
  if (!paddedBox(boxes, k, scratchBox)) return;
  scratchMin.copyFromFloats(scratchBox[0]!, scratchBox[1]!, scratchBox[2]!);
  scratchMax.copyFromFloats(scratchBox[3]!, scratchBox[4]!, scratchBox[5]!);
  mesh.getBoundingInfo().reConstruct(scratchMin, scratchMax, mesh.getWorldMatrix());
}
```

Run: PASS. Commit (`feat: index grass instances by octant and ring`, `grassSectors.ts`, `clutterMeshes.ts`, the test).

- [ ] **Step 8b: The blade field's sectors — failing tests**

`client/test/game/bladeMeshes.test.ts`, with the file's `SEED` and `CAM` and a `NullEngine` scene as its other tests build them; imports added: `AbstractMesh`, `UniversalCamera`, `Frustum`, `inCone`, `collectBladeCells`, `BLADE_SECTOR_RINGS`, `elevationSampleAt`:

```ts
describe("the blade field's sectors", () => {
  function sectorsOf(scene: Scene, tier: number, character: number, size: number): Mesh[] {
    const prefix = `${bladeMeshName(character, tier, size)}.s`;
    return scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.name.startsWith(prefix));
  }
  function origins(mesh: Mesh): [number, number, number][] {
    return mesh.thinInstanceGetWorldMatrices().map((w) => [w.m[12]!, w.m[13]!, w.m[14]!] as [number, number, number]);
  }

  it("splits every bucket by its tier's layout and keeps each cell once, nearest first", () => {
    expect(BLADE_SECTOR_RINGS).toEqual([[2.5], [], []]);
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    blades.update(CAM.x, CAM.z);
    const tiers = collectBladeCells(SEED, CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    for (const [tier, want] of [[0, 16], [1, 8], [2, 8]] as const) {
      for (let character = 0; character < 4; character++) {
        for (let size = 0; size < 3; size++) {
          const sectors = sectorsOf(scene, tier, character, size);
          expect(sectors.length).toBe(want);
          const cells = lists[tier]!.filter((c) => c.character === character && c.size === size);
          expect(sectors.reduce((s, m) => s + (m.isEnabled() ? m.thinInstanceCount : 0), 0)).toBe(cells.length);
          for (const m of sectors) {
            expect(m.alwaysSelectAsActiveMesh).toBe(false);
            expect(m.cullingStrategy).toBe(AbstractMesh.CULLINGSTRATEGY_STANDARD);
            expect(m.receiveShadows).toBe(true);
            if (!m.isEnabled()) continue;
            // Nearest first within the sector, as the tier list is.
            const d = origins(m).map(([x, , z]) => Math.hypot(x - bladeOrigin(CAM.x), z - bladeOrigin(CAM.z)));
            for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThanOrEqual(d[i - 1]! - 1e-4);
          }
        }
      }
    }
    // The source meshes no longer draw.
    expect(scene.getMeshByName(bladeMeshName(0, 0, 1))!.isEnabled()).toBe(false);
    blades.dispose();
    engine.dispose();
  }, 60_000);

  it("never culls a clump the camera can see", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    blades.update(CAM.x, CAM.z);
    const camera = new UniversalCamera("eye", new Vector3(CAM.x, 0, CAM.z), scene);
    camera.fov = 1.4;
    camera.minZ = 0.05;
    const eyeY = elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.6;
    const sectors = scene.meshes.filter((m): m is Mesh => m instanceof Mesh && /^blade_clumps.*\.s\d+$/.test(m.name) && m.isEnabled());
    for (const [yaw, pitch] of [[0, 0.3], [Math.PI / 2, 0.3], [Math.PI, 0.9], [2.4, 0.6]] as const) {
      camera.position.set(CAM.x, eyeY, CAM.z);
      camera.rotation.set(pitch, yaw, 0);
      camera.computeWorldMatrix(true);
      const planes = Frustum.GetPlanes(camera.getTransformationMatrix(true));
      const view = { x: CAM.x, y: eyeY, z: CAM.z, yaw, pitch, fov: 1.4, aspect: engine.getAspectRatio(camera) };
      for (const mesh of sectors) {
        if (mesh.isInFrustum(planes)) continue;
        for (const [x, y, z] of origins(mesh)) {
          expect(inCone(view, x, y, z, 0) || inCone(view, x, y + 0.6, z, 0)).toBe(false);
        }
      }
    }
    blades.dispose();
    engine.dispose();
  }, 60_000);

  it("fills sectors by the rebuild point alone, never by the path", () => {
    const build = () => { const engine = new NullEngine(); const scene = new Scene(engine); return { engine, scene, blades: createBladeMeshes(scene, SEED, { quality: "high" }) }; };
    const a = build();
    a.blades.update(CAM.x, CAM.z);
    const b = build();
    b.blades.update(CAM.x + 30, CAM.z); // a rebuild 30 m away first
    b.blades.update(CAM.x, CAM.z);
    const names = a.scene.meshes.filter((m) => /\.s\d+$/.test(m.name)).map((m) => m.name);
    for (const name of names) {
      const ma = a.scene.getMeshByName(name) as Mesh, mb = b.scene.getMeshByName(name) as Mesh;
      expect(mb.isEnabled()).toBe(ma.isEnabled());
      if (ma.isEnabled()) expect(origins(mb)).toEqual(origins(ma));
    }
    for (const t of [a, b]) { t.blades.dispose(); t.engine.dispose(); }
  }, 60_000);
});
```

Run: `cd client && npx vitest run test/game/bladeMeshes.test.ts` — FAIL: no `*.s0` meshes, `BLADE_SECTOR_RINGS` not exported.

- [ ] **Step 8c: The blade field's sectors — implement**

`client/src/game/bladeField.ts`: `export function bladeOrigin(v: number): number` (the body unchanged).

`client/src/game/bladeMeshes.ts`:

```ts
/**
 * Ring edges (m from the rebuild origin) of each tier's sectors
 * (grassSectors.ts): fine, mid, coarse. The fine tier is a disc around the
 * eye, and an octant of a disc reaches back to the origin, so it is drawn from
 * nearly any view unless its inner ring is split off; the mid and coarse
 * tiers are annuli and need octants alone. Every bucket of a tier shares its
 * tier's layout.
 */
export const BLADE_SECTOR_RINGS: readonly [readonly number[], readonly number[], readonly number[]] = [[2.5], [], []];
```

- A bucket becomes `{ source: Mesh; parts: Part[]; boxes: Float32Array; rings }`, a `Part` holding what a bucket holds today (`mesh`, `buf`, `foliage`, `strength`, `count`, `grown`). `createClumpMesh` builds the source as now; then `sectorCount(rings)` parts, each `source.clone(`${source.name}.s${k}`, null, true)!.makeGeometryUnique()` (the `blade` vertex buffer comes with the geometry), passed through `prepSectorMesh` with `receiveShadows = true` set again after it; the source `setEnabled(false)`. `meshes` lists the parts' meshes in tier-character-size-sector order.
- `fill(list, row, tier)`: `ox = bladeOrigin(x)`, `oz = bladeOrigin(z)` of the rebuild's eye; pass 1 counts `row[c.character][c.size].parts[sectorOf(c.x, c.z, ox, oz, BLADE_SECTOR_RINGS[tier])]`; `ensureCapacity` per part; `resetBoxes`; pass 2 writes each cell into its part as today and grows the box by the matrix's translation (`scratchMat[12]`, `[13]`, `[14]`); then per part `applyBucket(part)` and `setSectorBox(part.mesh, bucket.boxes, k)`. The list is walked in its nearest-first order, so each part stays nearest-first.
- `dispose`: every part's mesh and every source.
- The file-head comment: the thirty-six buckets are each split into their tier's sectors; the draw count is the sectors in view.

`ARCHITECTURE.md`: in the blade sentence, each bucket is split into octants about the rebuild origin, with a ring at 2.5 m on the fine tier, so only the sectors in view draw.

Run: `cd client && npx vitest run test/game/bladeMeshes.test.ts test/game/bladeField.test.ts test/game/grassSectors.test.ts test/game/renderer.test.ts` — PASS. The existing `bladeMeshes` tests that read a bucket's buffers off its source mesh read them off its enabled parts, summing counts, their literals unchanged.

- [ ] **Step 8d: Commit**

```bash
git add client/src/game/bladeField.ts client/src/game/bladeMeshes.ts ARCHITECTURE.md client/test/game/bladeMeshes.test.ts
git commit -F - <<'EOF'
feat: draw only the blade sectors the camera can see

## What

The blade field is the costliest layer at the canopy pose, and every
one of its clumps was drawn every frame, five in six of them outside
the view. Each of its thirty-six buckets is now split into octants
about the rebuild origin, with a ring at 2.5 m on the fine tier, each
sector a mesh with its own box that Babylon frustum-tests. The rebuild
writes the same clumps, nearest first within each sector.

## How

- `client/src/game/bladeMeshes.ts` — buckets of sectors,
  `BLADE_SECTOR_RINGS`, a box per rebuild.
- `client/src/game/bladeField.ts` — `bladeOrigin` exported.
- `ARCHITECTURE.md` — the blade sectors.
- `client/test/game/bladeMeshes.test.ts` — the layout, every cell once
  and nearest first, no visible clump culled, the fill independent of
  the path.

<trailers>
EOF
```

- [ ] **Step 8e: The grass class's sectors — failing tests**

`client/test/game/clutterField.test.ts`:

```ts
  it("sectors the grass class's two buckets", () => {
    // Near [0, 53.74] with a ring at 18 m; far [45.26, 114.24] in octants alone.
    expect(CLUTTER_SECTOR_RINGS.get(CLUTTER_GRASS)).toEqual([[18], []]);
    expect([...CLUTTER_SECTOR_RINGS.keys()]).toEqual([CLUTTER_GRASS]);
  });
```

`client/test/game/clutterMeshes.test.ts`, inside `describe("the cards beside the blade field", …)` with its `build(nearBlades)`:

```ts
  function sectorsOf(scene: Scene, source: Mesh): Mesh[] {
    return scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.name.startsWith(`${source.name}.s`));
  }
  function origins(mesh: Mesh): [number, number, number][] {
    return mesh.thinInstanceGetWorldMatrices().map((w) => [w.m[12]!, w.m[13]!, w.m[14]!] as [number, number, number]);
  }

  it("splits the grass class's buckets into sectors that hold every card once", () => {
    const { scene, assets, clutter, engine } = build(true);
    clutter.update(35, 21335);
    const bands = collectClutter(1, 35, 21335)[CLUTTER_GRASS]!;
    for (const [lod, want, list] of [[0, 16, bands.near], [1, 8, bands.far]] as const) {
      let sum = 0;
      for (const variant of [0, 1]) {
        const source = assets[CLUTTER_GRASS]![variant]![lod]![0]!;
        const sectors = sectorsOf(scene, source);
        expect(sectors.length).toBe(want);
        expect(source.isEnabled()).toBe(false);
        for (const mesh of sectors) {
          expect(mesh.alwaysSelectAsActiveMesh).toBe(false);
          expect(mesh.cullingStrategy).toBe(AbstractMesh.CULLINGSTRATEGY_STANDARD);
          if (!mesh.isEnabled()) continue;
          sum += mesh.thinInstanceCount;
          const box = mesh.getBoundingInfo().boundingBox;
          for (const [x, y, z] of origins(mesh)) {
            expect(x).toBeGreaterThanOrEqual(box.minimumWorld.x + 0.999);
            expect(x).toBeLessThanOrEqual(box.maximumWorld.x - 0.999);
            expect(z).toBeGreaterThanOrEqual(box.minimumWorld.z + 0.999);
            expect(z).toBeLessThanOrEqual(box.maximumWorld.z - 0.999);
            expect(y).toBeGreaterThanOrEqual(box.minimumWorld.y + 0.499);
            expect(y).toBeLessThanOrEqual(box.maximumWorld.y - 0.999);
          }
        }
      }
      expect(sum).toBe(list.length);
    }
    clutter.dispose();
    engine.dispose();
  }, 30_000);

  it("gives every grass sector its bucket's fade bands", () => {
    const { scene, assets, clutter, engine } = build(true);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    clutter.update(35, 21335);
    const seam = clutterSeamEdges(CLUTTER_GRASS), edge = clutterFadeEdges(CLUTTER_GRASS);
    const cases: [Mesh, number[]][] = [
      [assets[CLUTTER_GRASS]![0]![0]![0]!, [-2, -1, seam.start, seam.end]],
      [assets[CLUTTER_GRASS]![0]![1]![0]!, [seam.start, seam.end, edge.start, edge.end]],
    ];
    for (const [source, want] of cases) {
      for (const mesh of sectorsOf(scene, source).filter((m) => m.isEnabled())) {
        expect(Array.from(bufferFor(spy, mesh, "fadeBands")!.subarray(0, 4))).toEqual(want.map(Math.fround));
      }
    }
    spy.mockRestore();
    clutter.dispose();
    engine.dispose();
  }, 30_000);
```

and the two further tests of Step 8b — **no visible card culled** (the same camera poses, `inCone` on each disabled-by-frustum sector's origins lifted 0 and 0.8 m) and **the fill independent of the path** (a rebuild at (65, 21335) first) — over the grass class's four buckets. Imports added: `AbstractMesh`, `UniversalCamera`, `Frustum`, `inCone`.

Run: `cd client && npx vitest run test/game/clutterField.test.ts test/game/clutterMeshes.test.ts` — FAIL.

- [ ] **Step 8f: The grass class's sectors — implement**

`client/src/game/clutterField.ts`: export `clutterOrigin` (unchanged body), and after `CLUTTER_MEADOW_NEAR_IN`:

```ts
/**
 * The classes whose buckets are split into sectors (grassSectors.ts), with
 * each bucket's ring edges (m from its rebuild origin): [near, far]. A disc
 * needs rings, because an octant's box reaches back to the origin and so is
 * drawn from nearly any view; an annulus does not. The grass class's cards
 * carry 172–410 vertices each over a 110 m disc; its near bucket runs to
 * 53.74 m, its far one from 45.26 m.
 */
export const CLUTTER_SECTOR_RINGS: ReadonlyMap<number, readonly [readonly number[], readonly number[]]> = new Map([
  [CLUTTER_GRASS, [[18], []] as const],
]);
```

`client/src/game/clutterMeshes.ts`:

- A `Part` type carries what `Bucket` carries per mesh today (`meshes`, `buf`, `bands`, `foliage`, `count`, `grown`). `Bucket` keeps `fade` and `tints` and gains `parts: Part[]`, `rings: readonly number[] | null` and `boxes: Float32Array` (six floats per part, empty when not sectored). An unsectored bucket has one part holding its source meshes, so the fill and apply loops run the same code either way. `ensureCapacity` and `applyBucket` take a part.
- `rebuild`: for each sectored class, the class's origin `clutterOrigin(x, z, clutterCell(cls))` (the collector's own); pass 1 counts `bucket.parts[sectorOf(inst.x, inst.z, o.x, o.z, rings)]`; `resetBoxes` before pass 2; pass 2 writes into that part and grows its box by the translation of the matrix just written (`scratchMatBuf[12]`, `[13]`, `[14]`, so the sink is in it); after the fill, `applyBucket(part)` and `setSectorBox` for each mesh of each part.
- `adopt`: after the foliage and fade attach (the plugin reads its height off the source mesh's box, so this runs after), for a class in `CLUTTER_SECTOR_RINGS` and each LOD: `sectorCount(rings)` parts, each `meshes.map((m) => m.clone(`${m.name}.s${k}`, null, true)!.makeGeometryUnique())` through `prepSectorMesh`; the source meshes `setEnabled(false)` (their container owns them). No sectored class casts.
- `dispose`: every part's meshes.

`ARCHITECTURE.md`: after the blade sectors, one clause: the grass class's card buckets likewise.

Run: `cd client && npx vitest run test/game/grassSectors.test.ts test/game/clutterField.test.ts test/game/clutterMeshes.test.ts test/game/bladeMeshes.test.ts test/game/renderer.test.ts` — PASS; existing tests that read a grass-class bucket's buffers off its source mesh read its parts instead, literals unchanged.

- [ ] **Step 8g: Commit**

```bash
git add client/src/game/clutterField.ts client/src/game/clutterMeshes.ts ARCHITECTURE.md client/test/game/clutterField.test.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: draw only the grass card sectors the camera can see

## What

The grass class's cards, at 172–410 vertices each over a 110 m disc,
were all drawn every frame, five in six outside the view. Each of its
four buckets is now split into octants about its rebuild origin, with
a ring at 18 m on the near bucket, each sector a mesh with its own box
that Babylon frustum-tests.

## How

- `client/src/game/clutterMeshes.ts` — buckets of parts; sector meshes,
  not always active, standard culling, a box per rebuild.
- `client/src/game/clutterField.ts` — `CLUTTER_SECTOR_RINGS`;
  `clutterOrigin` exported for the shell.
- `ARCHITECTURE.md` — the card sectors.
- `client/test/game/clutterField.test.ts`, `clutterMeshes.test.ts` —
  every card in one sector, its bucket's bands, no visible card culled,
  the fill independent of the path.

<trailers>
EOF
```

---

### Task 2D: The blades in view

Design §5.10. With 2A in, hiding the blades still saves 0.88–0.94 ms at the canopy pose at native, of the 1.20 ms they cost unculled: the blades the camera sees carry most of what is left above the bar, and no culling reaches them. Two levers that leave every blade where it stands, each kept only on a measured saving with no loss of fullness, after the split of that cost between the vertex and fragment stages is measured. Before Task 3.

**Files:**
- Modify: `client/src/game/bladeClump.ts` (`BLADE_TIER_RINGS`; `bladeClumpGeometry` takes the rings), `client/src/game/bladeMeshes.ts` (each tier's meshes on its rings)
- Modify, lever 2 only: `client/src/game/foliagePlugin.ts`, `client/src/game/shaders/foliageWorldPos.vertex.fx` (a define on the coarse tier's material)
- Test: `client/test/game/bladeClump.test.ts`, `client/test/game/bladeMeshes.test.ts`, `client/test/game/foliagePlugin.test.ts`, `client/test/game/shaderHygiene.test.ts`

**Interfaces:**
- Produces: `export const BLADE_TIER_RINGS: readonly [number, number, number]` (fine, mid, coarse; `[3, 2, 1]` to start); `bladeClumpGeometry(character, count, rings = BLADE_RINGS)`; `bladeVertsFor(rings)` = `rings * 2 + 1` and `bladeTrisFor(rings)` = `(rings - 1) * 2 + 1`, with `BLADE_VERTS` and `BLADE_TRIS` their values at `BLADE_RINGS`
- Lever 2: a `FOLIAGE_BLADES_FAR` define, set on the coarse tier's material only

- [ ] **Step 1: Where the in-view blades spend (measurement only)**

On a branch page at the canopy pose at native, by the toggle method of the note's §1, with 2A's filter on: (a) every blade collapsed to its root in the vertex stage, through a gate-only override of the strength cut to 0, which keeps the vertex work and removes what is rasterised; (b) the blades hidden. (b) is the in-view blades' whole cost, (a) the part after the vertex stage, (b) − (a) the vertex stage's. Recorded in the note; lever 1 is aimed at the vertex stage and lever 2 at its per-vertex arithmetic, so if (b) − (a) is **under 0.1 ms at native** (Step 4's own bar for one lever) neither can pass that bar, and the task stops there with that finding.

- [ ] **Step 2: Lever 1, fewer rings on the far tiers, test first**

`bladeClump.test.ts`: `BLADE_TIER_RINGS` is `[3, 2, 1]`; for each of 1, 2 and 3 rings, a clump of 10 blades has `10 * (rings * 2 + 1)` vertices and `10 * ((rings - 1) * 2 + 1)` triangles; each blade's root and tip vertices, and the `blade` record's root, random and height fraction at them (0 and 1), are the same at every ring count for the same character and count, so a blade on fewer rings keeps its ends, its height, its droop and its place in the hand-off; the seed and flower heads take the tier's rings as their strips do. `bladeMeshes.test.ts`: each tier's meshes carry the vertex count of their tier's rings; the vertex budget test re-pinned with the new total as a literal (measured). Run: FAIL. Implement: the ring count threads from `BLADE_TIER_RINGS[tier]` through `createClumpMesh` into `bladeClumpGeometry`; the ring positions keep their fractions `k / rings` of the blade's height. Run: PASS. Typecheck, eslint, the touched tests; commit `perf: draw the far blades on fewer rings`, `## What` / `## How` as the global constraints, then `<trailers>`.

- [ ] **Step 3: Lever 2, a lighter vertex stage for the coarse tier, test first**

Only the terms of the foliage vertex stage that cannot move a coarse-tier vertex by a pixel at 4.4 m and beyond are candidates: first the per-vertex flutter (at most `WIND_FLUTTER_MAX` × 0.83 of a 0.5 m blade, under 2 cm), then any other the Step 1 split points at. The player bend stays: a remote player walks through the coarse tier. Test first: `FOLIAGE_BLADES_FAR` is on the coarse tier's material and on no other; the GLSL keeps `shaderHygiene.test.ts`'s rules; the dropped term's GLSL sits under `#ifndef FOLIAGE_BLADES_FAR`. Then a still pair at each pose, the define on and off, with the wind held at 0 and at the weather's wind: no changed block past the grain floor (the note's §5.6 method). Commit `perf: a lighter vertex stage for the farthest blades`.

- [ ] **Step 4: Gate**

1. **Frame**: each lever by the toggle method on branch pages at the canopy pose at native (the lever on against off, three pages); the branch against Task 2's tip by the pair method; the meadow pose and 4× reported. A lever is kept only on a **reliable** saving of at least 0.1 ms at native: **every one of the round's three pages reads a saving of at least 0.1 ms, and a same-code round run with it (the lever off against off) reads inside ±0.05 ms**. A lever that misses is reverted, its commit named in the note.
2. **Fullness** at both poses with the isolation: cover ratio, canopy near cover and luminance ratio inside the control's page-to-page spread, as 2A's gate read them.
3. **The walk and the turn** of design §12.4, and the mid crop's stills: no ring of blades that changes as it crosses a tier's band.
4. **The running total** against the control at the canopy pose at native, against the design's 0.8 ms goal, with what Task 3's far trim is expected to add (design §6.3).

Append `## 6. The blades in view` to the verification note (the sections later tasks append move down by one); commit the note alone (`docs: gate the blades in view`).

The far trim (design §5.10, lever 3) is not taken here: it ends cards past 26 m that the terrain's far pull replaces, so it lands with Task 3 whole.

---

### Task 3: Step 2 — the far sward on the terrain

**Files:**
- Modify: `client/src/game/clutterField.ts` (`CLUTTER_MEADOW_CARD_END`, `CLUTTER_MEADOW_CARD_RAMP`, `clutterMeadowFarEdges`, the collector's `farTrim` option)
- Modify: `client/src/game/clutterMeshes.ts` (the far edges and the trim on tiers with blades)
- Modify: `client/src/game/groundHexParams.ts` (the far-sward constants and `farSwardWeight`)
- Create: `client/src/game/shaders/sward.fragment.fx`
- Modify: `client/src/game/terrainTexture.ts` (four uniforms, the include, the pull)
- Modify: `client/src/game/foliagePlugin.ts` (`foliageWind()` getter)
- Modify: `ARCHITECTURE.md` (the far field)
- Test: `client/test/game/clutterField.test.ts`, `clutterMeshes.test.ts`, `groundHexParams.test.ts`, `terrainTexture.test.ts`, `foliagePlugin.test.ts`, `shaderHygiene.test.ts` (unchanged; covers the new file)

**Interfaces:**
- Consumes: `CLUTTER_FADE_MIN_RAMP`, `clutterFadeEdges` (`clutterField.ts`); `TUFT_ALBEDO`, `SWARD_COVER`, `swardWeight` (`groundHexParams.ts`); `FOLIAGE_CLUMP_CELL`, `FOLIAGE_CLUMP_LUMA` (`foliagePlugin.ts`); `gustAt` and the `WIND_*` constants (`windParams.ts`).
- Produces:
  - `export const CLUTTER_MEADOW_CARD_END = 30`, `export const CLUTTER_MEADOW_CARD_RAMP = 4`
  - `export function clutterMeadowFarEdges(): { start: number; end: number }` → `{ start: 26, end: 30 }`
  - `createClutterCollector(seed, options?: { meadowFarEnd?: number })` and `collectClutter(seed, x, z, radiusScale, options?)`: far meadow instances at origin distance ≥ `meadowFarEnd + CLUTTER_FADE_MIN_RAMP` are not emitted
  - `FAR_SWARD: Rgb = { r: 0.11, g: 0.135, b: 0.065 }`, `FAR_SWARD_MAX = 0.8`, `FAR_SWARD_COVER = [0.05, 0.5]`, `FAR_SWARD_BAND = [24, 30]`, `FAR_SWARD_CELL = 1.5`, `FAR_SWARD_CLUMP = 0.16`, `FAR_SWARD_WIND = 0.08`, `FAR_SWARD_GRAZE = 0.3`
  - `export function farSwardWeight(cover: number, dist: number): number`
  - `export function foliageWind(): WindRecord` (the module's current record)

- [ ] **Step 1: Write the failing tests**

`client/test/game/clutterField.test.ts`:

```ts
  it("ends the meadow's far cards at 30 m on the tiers with blades", () => {
    expect(CLUTTER_MEADOW_CARD_END).toBe(30);
    expect(CLUTTER_MEADOW_CARD_RAMP).toBe(4);
    expect(clutterMeadowFarEdges()).toEqual({ start: 26, end: 30 });
    const full = collectClutter(1, 35, 21335)[CLUTTER_MEADOW]!;
    const trimmed = collectClutter(1, 35, 21335, 1, { meadowFarEnd: 30 })[CLUTTER_MEADOW]!;
    // The near list is untouched; the far list loses exactly what lies past
    // 30 + 4.24 m of the meadow's own snapped origin.
    expect(trimmed.near).toEqual(full.near);
    const o = clutterOrigin(35, 21335, 0.7);
    const reach = 30 + Math.SQRT2 * 3;
    // As sets: the budget clamp, when it runs, re-sorts a list by distance.
    const keys = (list: { x: number; z: number }[]) => list.map((i) => `${i.x},${i.z}`).sort();
    expect(keys(trimmed.far)).toEqual(keys(full.far.filter((i) => Math.hypot(i.x - o.x, i.z - o.z) < reach)));
    expect(trimmed.far.length).toBeLessThan(full.far.length);
    // Every other class, and the low tier's meadow, as before.
    const other = collectClutter(1, 35, 21335, 1, { meadowFarEnd: 30 });
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      if (cls !== CLUTTER_MEADOW) expect(other[cls]).toEqual(collectClutter(1, 35, 21335)[cls]);
    }
  }, 30_000);
```

`client/test/game/clutterMeshes.test.ts`: the meadow far bucket's `fadeBands` become `[8, 18, 26, 30]` when `nearBlades` is true and stay `[8, 18, 28, 40]` built with `nearBlades: false`; its summed count equals the trimmed collector's.

`client/test/game/groundHexParams.test.ts`:

```ts
  it("carries the far sward past the cards", () => {
    expect(FAR_SWARD).toEqual({ r: 0.11, g: 0.135, b: 0.065 });
    expect(FAR_SWARD_MAX).toBe(0.8);
    expect(FAR_SWARD_COVER).toEqual([0.05, 0.5]);
    expect(FAR_SWARD_BAND).toEqual([24, 30]);
    expect([FAR_SWARD_CELL, FAR_SWARD_CLUMP, FAR_SWARD_WIND, FAR_SWARD_GRAZE]).toEqual([1.5, 0.16, 0.08, 0.3]);
    expect(farSwardWeight(1, 20)).toBe(0);
    expect(farSwardWeight(1, 30)).toBeCloseTo(0.8, 12);
    expect(farSwardWeight(0.275, 27)).toBeCloseTo(0.8 * 0.5 * 0.5, 12);
    expect(farSwardWeight(0.04, 60)).toBe(0);
  });
```

`client/test/game/terrainTexture.test.ts`, beside the sward tests: `terrainFarSward`, `terrainFarSwardBand`, `terrainFarSwardFx`, `terrainWind` on the UBO list (size 4, `vec4`) and declared in the non-UBO string; bound with `0.11, 0.135, 0.065, 0.8`, `0.05, 0.5, 24, 30`, `0.16, 0.08, 0.3, 0` and the current wind (a `setFoliageWind` in the test first); the fragment contains `swardFarWeight(` and `surfaceAlbedo = mix(surfaceAlbedo, swardFar(` after `surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);`; the sward pull is off on the low tier (`setTerrainSward(…, false)` binds max 0 for both).

`client/test/game/foliagePlugin.test.ts`, in the lockstep test: `sward.fragment.fx` contains the four `const float WIND_*` values of `foliage.vertex.fx` and `FAR_SWARD_CELL`'s `1.5`; `foliageWind()` returns what `setFoliageWind` was last given.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/clutterField.test.ts test/game/clutterMeshes.test.ts test/game/groundHexParams.test.ts test/game/terrainTexture.test.ts test/game/foliagePlugin.test.ts`
Expected: FAIL on the missing exports, the far bands `[8, 18, 28, 40]`, and the missing uniforms.

- [ ] **Step 3: The far trim and edges**

`client/src/game/clutterField.ts`, after `CLUTTER_SECTOR_RINGS`:

```ts
/**
 * Where the meadow's far cards end (m from the eye) on the tiers that draw
 * blades, and the width of their dither-out. Past it the terrain carries the
 * sward (terrainTexture.ts, the far pull), as every published grass system
 * ends its geometry. The mid field, 18–26 m, stays cards: from a standing eye
 * its fullness is rows of card silhouettes overlapping, which a shade on the
 * ground cannot stand up. The meadow's radius stays 40 m, because the split,
 * the seam and the blade field's reach derive from it; only the far list is
 * trimmed, at this end plus the snap jitter, so a trimmed card is always past
 * the dither's end and cannot pop.
 */
export const CLUTTER_MEADOW_CARD_END = 30;
export const CLUTTER_MEADOW_CARD_RAMP = 4;

export function clutterMeadowFarEdges(): { start: number; end: number } {
  return { start: CLUTTER_MEADOW_CARD_END - CLUTTER_MEADOW_CARD_RAMP, end: CLUTTER_MEADOW_CARD_END };
}
```

`collectClutterCore` takes `meadowFarEnd: number | undefined`; for `cls === CLUTTER_MEADOW` with it set, a far push (in both branches and in the budget clamp's re-split) requires `d2 < (meadowFarEnd + CLUTTER_FADE_MIN_RAMP) ** 2`, squared once outside the loop. `collectClutter`, `collectClutterWithBudgets` and `createClutterCollector` take an optional `{ meadowFarEnd?: number }` and pass it through.

`client/src/game/clutterMeshes.ts`: `createClutterCollector(seed, nearBlades ? { meadowFarEnd: CLUTTER_MEADOW_CARD_END } : undefined)`; in `adopt`, for the meadow on `nearBlades` the far `edge` is `clutterMeadowFarEdges()` (so both the far bucket's fade bands and `setFoliageEdges`, and with them the sink, use [26, 30]).

- [ ] **Step 4: The far pull**

`client/src/game/groundHexParams.ts`, after `SWARD_FADE`:

```ts
/** The far sward: past the meadow's cards the floor under a sward reads as
 * the field they were (linear albedo): the lit tuft darkened by the ground
 * and the shade between rows. Fitted at the gate against the far crop. */
export const FAR_SWARD: Rgb = { r: 0.11, g: 0.135, b: 0.065 };
export const FAR_SWARD_MAX = 0.8;
/** The cover band, the near pull's: a sward stands where the blades would. */
export const FAR_SWARD_COVER: readonly [number, number] = [0.05, 0.5];
/** Eye distance (m) the pull ramps in over, under the cards' dither-out. */
export const FAR_SWARD_BAND: readonly [number, number] = [24, 30];
/** The mottle's cell (m) and spread: the cards' own clump variation
 * (FOLIAGE_CLUMP_CELL, FOLIAGE_CLUMP_LUMA) continued on the ground. */
export const FAR_SWARD_CELL = 1.5;
export const FAR_SWARD_CLUMP = 0.16;
/** The shimmer on the cards' gust field, at the wind's gust amplitude. */
export const FAR_SWARD_WIND = 0.08;
/** Darkening toward a grazing view, where rows of cards hide the ground. */
export const FAR_SWARD_GRAZE = 0.3;

/** The far pull at a fragment, mirroring the GLSL `swardFarWeight`. */
export function farSwardWeight(cover: number, dist: number): number {
  return FAR_SWARD_MAX * smoothstep(FAR_SWARD_COVER[0], FAR_SWARD_COVER[1], cover) * smoothstep(FAR_SWARD_BAND[0], FAR_SWARD_BAND[1], dist);
}
```

`client/src/game/shaders/sward.fragment.fx`:

```glsl
// The sward floor's shared GLSL: the far pull's weight and colour, spliced
// into the terrain fragment, and from step 4 into the foliage fragment, so a
// card's root and the floor under it take one colour. swardGust mirrors
// gustAt in windParams.ts, as foliageGust does in foliage.vertex.fx, whose
// constants a lockstep test pins to these.
//
// COMMENT RULES as in foliage.vertex.fx.
const float SWARD_WIND_K1 = 0.25132741228718347;
const float SWARD_WIND_K2 = 0.6981317007977318;
const float SWARD_WIND_OMEGA1 = 0.3769911184;
const float SWARD_WIND_OMEGA2 = 0.879645943;
const float SWARD_WIND_RAGGED = 1.2;
const float SWARD_WIND_RAGGED_CELL = 6.0;
const float SWARD_CELL = 1.5;

float swardGust(vec2 p, vec2 dir, float t) {
  float u = dir.x * p.x + dir.y * p.y;
  vec2 c = floor(p / SWARD_WIND_RAGGED_CELL);
  float ragged = SWARD_WIND_RAGGED * (fract(c.x * 0.618034 + c.y * 0.381966) - 0.5);
  return sin(SWARD_WIND_K1 * u - SWARD_WIND_OMEGA1 * t + ragged) + 0.5 * sin(SWARD_WIND_K2 * u - SWARD_WIND_OMEGA2 * t + 1.7 * ragged);
}

float swardFarWeight(vec4 far, vec4 band, float cover, float dist) {
  return far.w * smoothstep(band.x, band.y, cover) * smoothstep(band.z, band.w, dist);
}

vec3 swardFar(vec4 far, vec4 fx, vec4 wind, vec2 p, float viewUp) {
  vec2 cell = floor(p / SWARD_CELL);
  float clump = fract(cell.x * 0.618034 + cell.y * 0.381966);
  float gust = swardGust(p, wind.xy, wind.w + 0.6 * (clump - 0.5));
  return far.rgb * (1.0 + fx.x * (clump - 0.5)) * (1.0 + fx.y * wind.z * gust) * (1.0 - fx.z * (1.0 - abs(viewUp)));
}
```

`client/src/game/terrainTexture.ts`: the file imported raw (`import swardGlsl from "./shaders/sward.fragment.fx?raw"`) and spliced after the hex/macro/horizon GLSL, gated with it; four uniforms on the UBO list and in the non-UBO string (`terrainFarSward`, `terrainFarSwardBand`, `terrainFarSwardFx`, `terrainWind`, all `vec4`), bound in `bindForSubMesh`:

```ts
    uniformBuffer.updateFloat4("terrainFarSward", FAR_SWARD.r, FAR_SWARD.g, FAR_SWARD.b, this._swardOn ? FAR_SWARD_MAX : 0);
    uniformBuffer.updateFloat4("terrainFarSwardBand", FAR_SWARD_COVER[0], FAR_SWARD_COVER[1], FAR_SWARD_BAND[0], FAR_SWARD_BAND[1]);
    uniformBuffer.updateFloat4("terrainFarSwardFx", FAR_SWARD_CLUMP, FAR_SWARD_WIND, FAR_SWARD_GRAZE, 0);
    const w = foliageWind();
    uniformBuffer.updateFloat4("terrainWind", w.dirX, w.dirZ, w.gustAmp, w.time);
```

and after the near pull (`surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);`):

```glsl
  // Far sward: past the meadow's cards, ground carrying a sward reads as
  // the field they were, with their clump mottle and their gust.
  float farW = swardFarWeight(terrainFarSward, terrainFarSwardBand, vTerrainCover, dist);
  surfaceAlbedo = mix(surfaceAlbedo, swardFar(terrainFarSward, terrainFarSwardFx, terrainWind, vPositionW.xz, viewDirectionW.y), farW);
```

(`viewDirectionW` is in scope at the terrain's hook, as the atmosphere plugin's fragment already reads it; if the hook sits before it, compute `normalize(vEyePosition.xyz - vPositionW)` locally.)

`client/src/game/foliagePlugin.ts`: `export function foliageWind(): WindRecord { return wind; }`.

`ARCHITECTURE.md`: in the near-field sentence, the meadow's cards end at 30 m on the tiers with blades and the terrain carries the sward beyond, with the cards' own mottle and gust.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/clutterField.test.ts test/game/clutterMeshes.test.ts test/game/groundHexParams.test.ts test/game/terrainTexture.test.ts test/game/foliagePlugin.test.ts test/game/shaderHygiene.test.ts test/game/bladeField.test.ts`
Expected: all pass. `bladeField.test.ts` is unchanged: the seam and the reach do not move.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/clutterField.ts client/src/game/clutterMeshes.ts client/src/game/groundHexParams.ts client/src/game/shaders/sward.fragment.fx client/src/game/terrainTexture.ts client/src/game/foliagePlugin.ts ARCHITECTURE.md client/test/game/clutterField.test.ts client/test/game/clutterMeshes.test.ts client/test/game/groundHexParams.test.ts client/test/game/terrainTexture.test.ts client/test/game/foliagePlugin.test.ts
git commit -F - <<'EOF'
feat: end the meadow cards at 30 m and carry the sward on the ground

## What

The meadow's far cards ran to 40 m, the last twelve metres already
half dithered and half sunk, and every one of them was drawn. On the
tiers with blades they now dissolve over 26–30 m and are not collected
past it, and the terrain under a sward takes over from 24 m: the far
field's colour, the cards' own clump mottle, a shimmer on the cards'
own gust, and a darkening toward a grazing view.

## How

- `client/src/game/clutterField.ts` — `CLUTTER_MEADOW_CARD_END` 30 and
  its 4 m ramp; the collector trims the far list at 34.24 m.
- `client/src/game/clutterMeshes.ts` — the far bands and sink on
  (26, 30) on tiers with blades.
- `client/src/game/groundHexParams.ts` — the far-sward constants and
  `farSwardWeight`.
- `client/src/game/shaders/sward.fragment.fx`,
  `client/src/game/terrainTexture.ts` — the far pull after the near one.
- `client/src/game/foliagePlugin.ts` — `foliageWind()` for the terrain.
- `ARCHITECTURE.md` — the far field.
- `client/test/game/*.test.ts` — the trim, the bands, the constants,
  the uniforms and the GLSL as literals.

<trailers>
EOF
```

- [ ] **Step 7: Gate**

1. **Fullness** at both poses with the isolation; bar as design §12.1. The mid crop's mean on the branch within 1 % of Task 2's gate (design §6.5).
2. **The far crop** (design §6.6): control, branch, and branch with the cards hidden, at both poses. Bar: the branch's far mean within ±10 % of the control's and its far cover within ±0.05. If it misses, fit `FAR_SWARD` (the three channels scaled together) on one page by overriding the uniform (`terrainFarSward` through a gate-only setter), re-measure, commit the fitted literal with its test (`fix: fit the far sward to the far crop`), and re-run the gate.
3. **The cut walk** (design §12.4) and a row profile of the bare-ground still over 20–40 m: no step.
4. **Frame** as Task 2's gate, reported against the control and against Task 2's gate. Expected at native: about −0.12 ms beyond Task 2 if the meadow is not filtered, about −0.04 if it is (design §6.3).
5. Counts: the far bucket's instances at both poses (expected about 6,370 and 7,420).

Append `## 6. Step 2: the far sward`; commit the note alone (`docs: gate the far sward at both poses`).

---

### Task 4: Step 3 — lean and hug

**Files:**
- Modify: `client/src/game/shaders/foliageWorldPos.vertex.fx`, `client/src/game/shaders/foliage.vertex.fx`, `client/src/game/foliagePlugin.ts`
- Modify: `client/src/game/clutterMeshes.ts` (the `foliageGrad` buffer on hugging profiles' buckets)
- Modify: `ARCHITECTURE.md` (the foliage sentence)
- Test: `client/test/game/foliagePlugin.test.ts`, `client/test/game/clutterMeshes.test.ts`

**Interfaces:**
- Consumes: `ClutterInstance.groundDx`, `groundDz`; the part/bucket fill of Task 2.
- Produces: `FOLIAGE_LEAN = 0.5`, `FOLIAGE_HUG = 1.5`, `FOLIAGE_HUG_RAMP = 0.15`; `FoliageProfile.hug: boolean` (true for `GRASS`, `MEADOW`, `FLOWER`); `FOLIAGE_TILT` removed; the `foliageGrad` attribute (`vec2`, per instance).

- [ ] **Step 1: Write the failing tests**

`client/test/game/foliagePlugin.test.ts`, in the lockstep test, replacing the `FOLIAGE_TILT` line:

```ts
    expect(FOLIAGE_LEAN).toBe(0.5);
    expect(FOLIAGE_HUG).toBe(1.5);
    expect(FOLIAGE_HUG_RAMP).toBe(0.15);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_LEAN = ${glslFloat(FOLIAGE_LEAN)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_HUG = ${glslFloat(FOLIAGE_HUG)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_HUG_RAMP = ${glslFloat(FOLIAGE_HUG_RAMP)};`);
    expect(vertexWorldPos).not.toContain("FOLIAGE_TILT");
    // The lean is a rotation about the base, away from the eye, by the sine
    // of the eye's elevation over the instance.
    expect(vertexWorldPos).toContain("float fElev = clamp(fToEye.y / max(length(fToEye), 1.0e-3), 0.0, 1.0);");
    expect(vertexWorldPos).toContain("worldPos.xz += fAwayN * fY * sin(fLean);");
    expect(vertexWorldPos).toContain("worldPos.y -= fY * (1.0 - cos(fLean));");
    expect(vertexWorldPos).toContain("worldPos.y += fHug * FOLIAGE_HUG * min(0.0, dot(fOff, foliageGrad));");
```

and a profile test:

```ts
  it("hugs the ground with the card profiles only", () => {
    expect(Object.entries(FOLIAGE_PROFILES).filter(([, p]) => p.hug).map(([k]) => k)).toEqual(["GRASS", "MEADOW", "FLOWER"]);
    const scene = new Scene(new NullEngine());
    const mat = new PBRMaterial("m", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.MEADOW, 0.35);
    const attrs: string[] = [];
    (mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin).getAttributes(attrs, scene, null as never);
    expect(attrs).toEqual(["foliage", "foliageGrad"]);
  });
```

A CPU twin for the lean (in `foliagePlugin.test.ts`), so the shader's numbers are pinned by arithmetic, not only by text:

```ts
  it("leans a 0.35 m card by the eye's elevation", () => {
    // Eye 1.6 m up; card origin on flat ground at 2.5 m.
    const elev = 1.6 / Math.hypot(2.5, 1.6);
    const lean = 0.5 * elev;
    expect(elev).toBeCloseTo(0.53905, 5);
    expect(0.35 * Math.sin(lean)).toBeCloseTo(0.09320, 5);
    expect(0.35 * (1 - Math.cos(lean))).toBeCloseTo(0.01264, 5);
  });
```

`client/test/game/clutterMeshes.test.ts`: the meadow's parts receive a `foliageGrad` buffer of stride 2 whose first two floats are the first instance's `groundDx`, `groundDz` (`Math.fround`); the rock bucket receives none.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/foliagePlugin.test.ts test/game/clutterMeshes.test.ts`
Expected: FAIL — the constants are not exported; the GLSL still has `FOLIAGE_TILT`; no `foliageGrad`.

- [ ] **Step 3: The shader and the plugin**

`client/src/game/shaders/foliage.vertex.fx`, inside `#ifdef FOLIAGE`, after the `blade` attributes:

```glsl
#ifdef FOLIAGE_HUG
#ifdef THIN_INSTANCES
attribute vec2 foliageGrad;
#endif
#endif
```

`client/src/game/shaders/foliageWorldPos.vertex.fx`: `const float FOLIAGE_TILT = 0.04;` becomes the three constants; the `foliageFlags.x` block becomes:

```glsl
  if (foliageFlags.x > 0.5) {
    vec3 fToEye = windEye - finalWorld[3].xyz;
    float fElev = clamp(fToEye.y / max(length(fToEye), 1.0e-3), 0.0, 1.0);
    float fLean = FOLIAGE_LEAN * fElev;
    float fY = positionUpdated.y * fScale;
    vec2 fAwayN = -fToEye.xz / max(length(fToEye.xz), 1.0e-3);
    worldPos.xz += fAwayN * fY * sin(fLean);
    worldPos.y -= fY * (1.0 - cos(fLean));
  }
#ifdef FOLIAGE_HUG
#ifdef THIN_INSTANCES
  {
    float fHug = 1.0 - smoothstep(0.0, FOLIAGE_HUG_RAMP, fH);
    vec2 fOff = worldPos.xz - finalWorld[3].xz;
    worldPos.y += fHug * FOLIAGE_HUG * min(0.0, dot(fOff, foliageGrad));
  }
#endif
#endif
```

and the file's head comment: "camera tilt" becomes "the lean away from the eye", with a sentence on why the elevation and not the camera's rotation (turning in place moves no card).

`client/src/game/foliagePlugin.ts`: `FOLIAGE_TILT` → `FOLIAGE_LEAN`, `FOLIAGE_HUG`, `FOLIAGE_HUG_RAMP`, each with a doc comment (the lean: HZD's camera-based tilting keyed to where the eye is; the hug: `GROUND_CONFORM_OVERSHOOT`'s value and reason, clamped downward); `FoliageProfile.hug` with `GRASS`, `MEADOW`, `FLOWER` true, every other false; the define `FOLIAGE_HUG` in the constructor's list and `prepareDefines` (`defines.FOLIAGE_HUG = this._profile.hug`); `getAttributes` pushes `"foliageGrad"` when `hug`.

- [ ] **Step 4: The gradient buffer**

`client/src/game/clutterMeshes.ts`: a part gains `grad: Float32Array` (2 floats per instance, capacity tracking `buf`, `EMPTY_BUFFER` unless the bucket's profile hugs); the fill writes `inst.groundDx`, `inst.groundDz`; `applyPart` sets and updates `"foliageGrad"` with stride 2 beside `"foliage"`. A `hugs: boolean` on the bucket, from `FOLIAGE_BY_CLASS.get(cls)?.hug`.

`ARCHITECTURE.md`: in the foliage sentence, cards lean away from the eye by its elevation over them and their bases follow the ground.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/foliagePlugin.test.ts test/game/clutterMeshes.test.ts test/game/bladeMeshes.test.ts test/game/duffMeshes.test.ts test/game/forestMeshes.test.ts test/game/shaderHygiene.test.ts`
Expected: all pass; the blade, duff and forest buckets get no `foliageGrad`.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/shaders/foliage.vertex.fx client/src/game/shaders/foliageWorldPos.vertex.fx client/src/game/foliagePlugin.ts client/src/game/clutterMeshes.ts ARCHITECTURE.md client/test/game/foliagePlugin.test.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: lean the grass away from the eye and seat card bases on slopes

## What

Seen from a standing eye, upright cards show the ground between them.
Every grass card and blade clump now leans away from the eye by half a
radian times the sine of the eye's elevation over it, a rotation about
its base: fifteen degrees at 2.5 m, two at 20 m, so the near field
faces the eye while the mid field's rows keep their silhouettes, and
turning in place moves nothing. The fixed 4 cm push it replaces is
gone. Card bases on a slope follow the ground plane, pushed past it
on the downhill side as the trees' conform is.

## How

- `client/src/game/shaders/foliageWorldPos.vertex.fx`,
  `client/src/game/shaders/foliage.vertex.fx` — the lean, the hug and
  the `foliageGrad` attribute.
- `client/src/game/foliagePlugin.ts` — `FOLIAGE_LEAN` 0.5, `FOLIAGE_HUG`
  1.5, `FOLIAGE_HUG_RAMP` 0.15; the `hug` profile flag.
- `client/src/game/clutterMeshes.ts` — each instance's ground gradient
  for the hugging profiles.
- `ARCHITECTURE.md` — the lean and the hug.
- `client/test/game/foliagePlugin.test.ts`, `clutterMeshes.test.ts` —
  the constants in lockstep, the lean's arithmetic, the attribute.

<trailers>
EOF
```

- [ ] **Step 7: Gate**

1. **Fullness** at both poses with the isolation. Bar as design §12.1, and near cover up at both poses against Task 3's gate.
2. **A slope still:** a meadow pose on a slope of at least 0.25, found from the simulation as the near-grass poses were (grass ≥ 1, canopy < 0.1), recorded in the note; pitch 0.6; control against branch. Bar: no card base shows daylight under it on the downhill side.
3. **The turn** (design §12.4) at pitch 0.3 and 0.9; bar: nothing moves between stills that is not the wind, and no card reads as lying down at 0.9.
4. **Frame:** the delta over Task 3's gate inside the same-code noise (±0.1 ms).

If near cover does not rise, `FOLIAGE_LEAN` 0.5 → 0.7; if cards read as lying down, → 0.35 (design §13); each a commit with its literal and a re-gate. Append `## 7. Step 3: lean and hug`; commit the note alone.

---

### Task 5: Step 4 — colour continuity and alpha coverage

**Files:**
- Create: `tools/cardCoverage/cardCoverage.mjs`, `tools/cardCoverage/test/cardCoverage.test.mjs`
- Create: `client/src/game/shaders/foliageAlpha.fragment.fx`
- Modify: `client/src/game/shaders/foliageLights.fragment.fx`, `client/src/game/shaders/foliage.fragment.fx`, `client/src/game/shaders/foliage.vertex.fx`, `client/src/game/shaders/foliageWorldPos.vertex.fx`, `client/src/game/foliagePlugin.ts`, `client/src/game/renderer.ts` (`setFoliageSward` beside `setTerrainSward`)
- Modify: `client/src/game/clutterMeshes.ts` (`foliageCover`; the cards' cutoff and mip scale)
- Modify: `ARCHITECTURE.md`
- Test: `client/test/game/foliagePlugin.test.ts`, `clutterMeshes.test.ts`

**Interfaces:**
- Consumes: `sward.fragment.fx` (Task 3); `SWARD_*`, `FAR_SWARD_*`, `swardWeight`, `farSwardWeight` (`groundHexParams.ts`); `groundCover` (`sim/clutter.ts`), read, not changed.
- Produces:
  - `node tools/cardCoverage/cardCoverage.mjs <model.glb>` → per mip: size, coverage at the file's cutoff, the scale that restores mip 0's coverage; and the least-squares scale per mip over mips 1–4
  - `FOLIAGE_ROOT_BAND = 0.35`; `FOLIAGE_MIP_ALPHA: Readonly<Record<string, number>>` keyed by card model (`"clutter.meadow"`, `"clutter.grass_a"`, `"clutter.grass_b"`, `"clutter.flower_a"`, `"clutter.flower_b"`), from the tool
  - `setFoliageAlpha(material: Material, cutoff: number, mipAlpha: number): void` — takes the alpha test over (the material's own `alphaCutOff` becomes 0)
  - the `foliageCover` attribute (`float`, per instance) on tinting card buckets

- [ ] **Step 1: The tool, test first**

`tools/cardCoverage/test/cardCoverage.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { boxMips, coverage, mipScales } from '../cardCoverage.mjs';

describe('card coverage', () => {
  it('measures what a box-filtered chain does to a sparse mask', () => {
    // 8 × 8 alpha: one-texel vertical lines every other column, alpha 1.
    const a = new Float32Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x += 2) a[y * 8 + x] = 1;
    const mips = boxMips(a, 8, 8);
    expect(mips.map((m) => m.width)).toEqual([8, 4, 2, 1]);
    expect(coverage(mips[0], 0.25)).toBe(0.5);
    // Mip 1 averages each line with the gap beside it: 0.5 everywhere.
    expect(coverage(mips[1], 0.25)).toBe(1);
    expect(coverage(mips[1], 0.75)).toBe(0);
    // The scale that brings mip 1 back to half coverage at a 0.75 cutoff
    // cannot exist for a uniform mip; the tool reports it as null.
    expect(mipScales(mips, 0.75)[1]).toBeNull();
  });
});
```

`tools/cardCoverage/cardCoverage.mjs`: reads the GLB's JSON chunk, finds the material's `baseColorTexture` image and `alphaCutoff`, decodes the embedded PNG with `node:zlib` (colour types 3 with `tRNS`, and 6; filters 0–4; 8-bit), builds the box-filtered chain the browser's `generateMipmap` approximates, and prints per mip the size, the coverage at the cutoff, and the multiplier `s` on alpha for which the coverage of `alpha · s` equals mip 0's (null if none); last, the per-mip-level scale `k` in `1 + k · mip` that fits mips 1–4 best by least squares, which is the literal for `FOLIAGE_MIP_ALPHA`. It writes nothing. A header comment says it reads the shipped models and never writes them.

Run: `npx vitest run --root tools cardCoverage` (fails, then passes once the module exists). Run the tool on the five card models and paste its tables into the note (Step 6).

- [ ] **Step 2: Write the failing tests for the shader side**

`client/test/game/foliagePlugin.test.ts`:

```ts
  it("gives the card root the floor's colour over its bottom third", () => {
    expect(FOLIAGE_ROOT_BAND).toBe(0.35);
    expect(fragmentLights).toContain(`const float FOLIAGE_ROOT_BAND = ${glslFloat(FOLIAGE_ROOT_BAND)};`);
    expect(fragmentLights).toContain("float fRoot = 1.0 - smoothstep(0.0, FOLIAGE_ROOT_BAND, vFoliageH);");
    // The target is the floor as the terrain draws it: the near pull, then the far.
    expect(fragmentLights).toContain("vec3 fFloor = mix(vFoliage.rgb, foliageSward.rgb, foliageSward.w * smoothstep(foliageSwardBand.x, foliageSwardBand.y, vFoliageCover) * (1.0 - smoothstep(foliageSwardBand.z, foliageSwardBand.w, vFoliageDist)));");
    expect(fragmentLights).toContain("fFloor = mix(fFloor, swardFar(foliageFarSward, foliageFarSwardFx, foliageWindRec, vFoliageOrigin, viewDirectionW.y), swardFarWeight(foliageFarSward, foliageFarSwardBand, vFoliageCover, vFoliageDist));");
  });

  it("takes the cards' alpha test over, scaled by mip", () => {
    expect(FOLIAGE_MIP_ALPHA).toEqual(MIP_ALPHA_FROM_TOOL); // the tool's five literals, pasted
    expect(fragmentAlpha).toContain("float fAlpha = texture2D(albedoSampler, vAlbedoUV).a * (1.0 + fMip * foliageMipAlpha);");
    expect(fragmentAlpha).toContain("if (fAlpha < foliageCutoff) discard;");
    const scene = new Scene(new NullEngine());
    const mat = new PBRMaterial("m", scene);
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    mat.alphaCutOff = 0.25;
    attachFoliage(mat, FOLIAGE_PROFILES.MEADOW, 0.35);
    setFoliageAlpha(mat, 0.25, 0.3);
    expect(mat.alphaCutOff).toBe(0);
  });
```

(`MIP_ALPHA_FROM_TOOL` is written out as the object literal the tool printed; the placeholder name is not committed. `fragmentAlpha` is `shaders/foliageAlpha.fragment.fx` imported raw, as the test imports the other `.fx` files.) The profile test of Task 4 now expects `["foliage", "foliageGrad", "foliageCover"]`. `clutterMeshes.test.ts`: the meadow's parts receive a `foliageCover` buffer (stride 1) whose first value is `Math.fround(Math.min(1, groundCover(1, x, z).grass))` at the first instance; after `adopt`, the meadow material's `alphaCutOff` is 0 and its plugin's cutoff is the model's (0.25 for the test's boxes' materials as set in `build`).

- [ ] **Step 3: Run to verify they fail**

Run: `cd client && npx vitest run test/game/foliagePlugin.test.ts test/game/clutterMeshes.test.ts`
Expected: FAIL on the missing constants, attribute and GLSL.

- [ ] **Step 4: Implement**

- `foliage.vertex.fx`: `attribute float foliageCover;` under `FOLIAGE_TINT` and `THIN_INSTANCES` for cards; `varying float vFoliageCover; varying vec2 vFoliageOrigin;`. `foliageWorldPos.vertex.fx`: `vFoliageCover = 1.0;` then, under the same guards, `vFoliageCover = foliageCover;` for cards and `vFoliageCover = bladeStrength;` for blades; `vFoliageOrigin = fOrigin;`.
- `foliage.fragment.fx`: the two varyings; `sward.fragment.fx` spliced after them (a raw import in `foliagePlugin.ts`), under `FOLIAGE_TINT`.
- `shaders/foliageAlpha.fragment.fx` (new), returned by `getCustomCode` at `CUSTOM_FRAGMENT_MAIN_BEGIN` (Babylon's PBR runs its own alpha test inside the albedo block, before any later hook, so the plugin's test has to come first), under a `FOLIAGE_ALPHA` define set when `setFoliageAlpha` has run:

```glsl
#ifdef FOLIAGE_ALPHA
#ifdef ALBEDO
{
  vec2 fTexel = vAlbedoUV * foliageAlbedoSize;
  float fMip = max(0.0, 0.5 * log2(max(dot(dFdx(fTexel), dFdx(fTexel)), dot(dFdy(fTexel), dFdy(fTexel)))));
  float fAlpha = texture2D(albedoSampler, vAlbedoUV).a * (1.0 + fMip * foliageMipAlpha);
  if (fAlpha < foliageCutoff) discard;
}
#endif
#endif
```

- `foliageLights.fragment.fx`: `const float FOLIAGE_ROOT_BAND = 0.35;`, `fRoot` as the test pins, and the tint target `fFloor` in place of `vFoliage.rgb` in the root mix (the two lines the test pins, under `FOLIAGE_TINT`).
- `foliagePlugin.ts`: `FOLIAGE_ROOT_BAND`, `FOLIAGE_MIP_ALPHA` with the tool's values and a comment naming the tool; uniforms `foliageSward`, `foliageSwardBand`, `foliageFarSward`, `foliageFarSwardBand`, `foliageFarSwardFx`, `foliageWindRec` (all `vec4`, bound from `groundHexParams.ts` and the wind record exactly as the terrain binds its own), `foliageCutoff`, `foliageMipAlpha` (`float`), `foliageAlbedoSize` (`vec2`, from `material.albedoTexture.getSize()`), on both uniform paths; `getAttributes` pushes `"foliageCover"` for tinting non-blade profiles; the `FOLIAGE_ALPHA` define; `setFoliageAlpha`. The sward uniforms' max is 0 where the terrain's is (the low tier), through the same `setTerrainSward` call site in `renderer.ts` also calling `setFoliageSward(on)`.
- `clutterMeshes.ts`: a part's `cover: Float32Array` (1 float per instance) filled with `Math.min(1, groundCover(seed, inst.x, inst.z).grass)` for tinting buckets and uploaded as `"foliageCover"`; in `adopt`, for a card class with a foliage profile, `setFoliageAlpha(material, material.alphaCutOff, FOLIAGE_MIP_ALPHA[modelId] ?? 0)` before the cutoff is cleared, `modelId` from the model URL's file name.

`ARCHITECTURE.md`: a card's root carries the floor's own colour, sward included, and its alpha is scaled by mip level so a card keeps its coverage with distance.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/foliagePlugin.test.ts test/game/clutterMeshes.test.ts test/game/bladeMeshes.test.ts test/game/forestMeshes.test.ts test/game/shaderHygiene.test.ts` and `npx vitest run --root tools`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tools/cardCoverage/cardCoverage.mjs tools/cardCoverage/test/cardCoverage.test.mjs client/src/game/shaders/foliageAlpha.fragment.fx client/src/game/shaders/foliage.vertex.fx client/src/game/shaders/foliageWorldPos.vertex.fx client/src/game/shaders/foliage.fragment.fx client/src/game/shaders/foliageLights.fragment.fx client/src/game/foliagePlugin.ts client/src/game/clutterMeshes.ts client/src/game/renderer.ts ARCHITECTURE.md client/test/game/foliagePlugin.test.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: root the cards in the floor's colour and keep their alpha far

## What

A card's root was tinted toward the unpulled ground palette, far
lighter than the dark sward the floor now draws under it, so each tuft
read as a cut-out from above. The bottom third of a card now takes the
floor's colour as the terrain computes it, near and far sward pulls
included. And an alpha-tested card thinned with distance through its
mip chain alone; its alpha is now scaled up with the mip level being
sampled, by a per-model factor a tool measures from the shipped
textures without changing them.

## How

- `tools/cardCoverage/cardCoverage.mjs` — coverage per box mip at the
  model's cutoff, and the scale that restores it; read-only.
- `client/src/game/shaders/foliage*.fx` — `foliageCover`, the root's
  floor colour over `FOLIAGE_ROOT_BAND`, the mip-scaled alpha test.
- `client/src/game/foliagePlugin.ts` — the constants, uniforms and
  `setFoliageAlpha`.
- `client/src/game/clutterMeshes.ts`, `client/src/game/renderer.ts` —
  the cover per card; the cards' alpha test handed to the plugin.
- `ARCHITECTURE.md`, `client/test/game/*.test.ts`,
  `tools/cardCoverage/test/cardCoverage.test.mjs` — as literals.

<trailers>
EOF
```

- [ ] **Step 7: Gate**

1. **Fullness** at both poses with the isolation; bar as design §12.1, near cover up against Task 4's gate.
2. **The mid-distance still** (design §12.2): the canopy pose at pitch 0.6, control against branch; the look: cards at 5–8 m no thinner than at 2–3 m.
3. **Frame:** the delta over Task 4's gate inside ±0.1 ms.
4. The tool's tables for the five models in the note.

Fallbacks (design §13) each a commit and a re-gate. Append `## 8. Step 4: colour and coverage`; commit the note alone.

---

### Task 6: The WebGPU spike

Its own worktree and branch, from `origin/main` once Task 2 has merged, run beside Tasks 3–5. Its code never merges; its report does.

```bash
git fetch origin
git worktree add -b worktree-grass-webgpu .claude/worktrees/grass-webgpu origin/main
```

**Files (spike branch only):**
- Modify: `client/src/app.ts` (`?engine=webgpu`), `client/src/game/renderer.ts` (engine creation at `new Engine(...)`; the engine passed on)
- Modify: `client/src/game/bladeMeshes.ts`, `clutterMeshes.ts` (GLSL-forced materials on WebGPU)
- Create: `client/src/game/bladeGpu.ts` (the cull-and-pack pass and its buffers), `client/public/libs/webgpu/` (the two translators, served locally)
- Create (this stream's branch, by cherry-pick of its one commit): `docs/rendering/<date>-grass-webgpu-spike.md`, dated the day it is written

**Interfaces:**
- Consumes: `WebGPUEngine`, `WebGPUEngine.IsSupportedAsync`, `ComputeShader`, `StorageBuffer`, `VertexBuffer`, `Mesh.forcedInstanceCount`, `Constants.BUFFER_CREATIONFLAG_*`; the blade collector (`bladeField.ts`).
- Produces: a go or a no-go, with the numbers of design §9.5.

- [ ] **Step 1: Step 0, the engine**

`?engine=webgpu` on the high tier: `await WebGPUEngine.IsSupportedAsync`, then `new WebGPUEngine(canvas, { antialias: true, stencil: true })` and `await engine.initAsync(glslangOptions, twgslOptions)` with both pointed at `client/public/libs/webgpu/`; otherwise the WebGL2 `Engine` as today. The project's own `PBRMaterial`s on WebGPU are constructed with `forceGLSL` true; the clutter shell, on WebGPU, replaces each loaded card material with a GLSL-forced `PBRMaterial` copying `albedoTexture`, `bumpTexture`, `transparencyMode`, `alphaCutOff`, `backFaceCulling`, `metallic`, `roughness`, before any plugin attaches. The terrain and the other plugin-carrying materials likewise.

Bar (design §9.3): the canopy pose renders with every plugin compiled, zero console errors, and a mean frame within 10 % of the WebGL2 build's at 4×. If not, list each plugin that failed and why, count the GLSL lines each would need ported to WGSL, write the report as a no-go, and stop.

- [ ] **Step 2: The pass**

`client/src/game/bladeGpu.ts`:

- A candidate `StorageBuffer` (`BUFFER_CREATIONFLAG_STORAGE | BUFFER_CREATIONFLAG_WRITE`), 48 bytes a cell (origin xyz, yaw; height scale, strength, character, size; ground tint rgb, shade), written on the collector's 1 m crossing from the three tier lists.
- Per bucket (thirty-six), output storage buffers with `BUFFER_CREATIONFLAG_VERTEX | BUFFER_CREATIONFLAG_STORAGE | BUFFER_CREATIONFLAG_READWRITE` for `world0`–`world3`, `foliage` and `bladeStrength`, each wrapped as an instanced `VertexBuffer` of that kind on the bucket's clump mesh (`mesh.setVerticesBuffer(new VertexBuffer(engine, sb.getBuffer(), kind, { size, instanced: true, stride }))`), and a counter.
- A `ComputeShader` (WGSL), one invocation per candidate: the six frustum planes and the eye as a uniform buffer; the clump's sphere (0.35 m × height scale) against the planes; the tier from the eye distance with each tier's padded band (`bladeTierBands`, `BLADE_PAD`); `atomicAdd` on its bucket's counter; its matrix (the same composition as `instanceMatrixFor`), tint and strength written at that slot. A first pass clears the counters and writes a zero matrix into every slot of every bucket past its last count (the dead tail).
- Each bucket mesh: `forcedInstanceCount` = its capacity, the worst in-view count over the gate's walk and turn plus a quarter. The existing tier materials and plugins draw it.

Second, only if Step 3 measures the dead tail as costing more than the pass saves: the counters read back (`StorageBuffer.read`) and applied one frame late as `forcedInstanceCount` = count + 64. Third, only if that too measures too slow: `drawIndexedIndirect` through `engine._device`, and the report says what of Babylon's material path it gave up.

- [ ] **Step 3: Measure**

On the WebGPU engine at the canopy and meadow poses, native pixels (4× reported), the pair method (design §12.3): **S** (Step 2) against **B** (the shipped blade field on WebGPU, `?blades=cpu`); and the WebGPU build with S against the WebGL2 build of the same commit. Fullness with the isolation for S and B. The walk and the turn with S. Chrome's WebGPU timestamps are quantised to 100 µs without the developer-features flag, so the frame intervals, not GPU timers, are the measure, as on WebGL2.

- [ ] **Step 4: The report and the verdict**

`docs/rendering/<date>-grass-webgpu-spike.md`: the engine step (which plugins compiled, the frame against WebGL2), the pass as built, the tables of Step 3, the verdict against the four criteria of design §9.5, and, if go, the upstream proposal's shape and the per-blade next step's WGSL cost. Commit it on the spike branch alone (`docs: report the WebGPU blade culling spike`), then bring that one commit to this stream's branch (`git cherry-pick <sha>`), so the report merges with the stream and the spike's code does not.

---

### Task 7: Close the verification note and the design

**Files:**
- Modify: `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md`, `docs/rendering/2026-09-26-grass-frame-reclaim-design.md` (the **As built** paragraph only), `ARCHITECTURE.md` (if a step's sentence changed at its gate)

- [ ] **Step 1: The last frame round**

TRAILSIDE (`__fcSet(263.9, 85.77, 118, 0.6, 0.25)`, `weather mist`, `time 12`), high, native and 4×, by design §12.3's method, for continuity with the blade-field, floor-look and near-grass notes; and the canopy pose once more, control against the final branch, for the headline delta.

- [ ] **Step 2: The summary**

A closing section: the fullness table across the control and every gate, per pose; the frame deltas per gate and cumulative, at 4×, native and 16:9; the draw calls and JS time; which optional parts of Task 2 were taken and why; the fitted `FAR_SWARD`, the final `FOLIAGE_LEAN` and the mip scales; the spike's verdict with a link to its report; the look and the walks.

- [ ] **Step 3: The design's opening**

Rewrite the **As built** paragraph: which steps shipped, with their constants, the headline delta, the spike's verdict, and links to the note and the spike report; the rest of the design stays as written.

- [ ] **Step 4: Checks and commit**

`npx vitest run --root tools` (the docs name test) green.

```bash
git add docs/rendering/2026-09-26-grass-frame-reclaim-verification.md docs/rendering/2026-09-26-grass-frame-reclaim-design.md ARCHITECTURE.md
git commit -F - <<'EOF'
docs: close the grass frame reclaim with its results

## What

The frame reclaimed at the canopy pose across the four steps, the
fullness held at both poses, and the WebGPU spike's verdict, summed
up in the verification note and in the design's opening.

## How

- `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md` —
  the last frame round and the summary.
- `docs/rendering/2026-09-26-grass-frame-reclaim-design.md` — As built.
- `ARCHITECTURE.md` — as the gates left it.

<trailers>
EOF
```
