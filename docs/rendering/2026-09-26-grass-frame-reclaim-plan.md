# Grass Frame Reclaim Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the canopy pose, high tier, 4× pixels, the frame is at least 1.0 ms under the near-grass tip, with cover ratios not below 0.62 (canopy) and 0.94 (meadow), canopy near cover ≥ 0.45, the luminance ratio in 0.8–1.25 at both poses, and nothing that appears, vanishes or reads as a line on a walk or a turn.

**Architecture:** Four steps in order, each behind its own gate, after a measured baseline. (1) Sector meshes: the meadow's card buckets (and, if measured worth it, the grass class's and the blade field's coarse fine-grass buckets) are split into octants × rings about their rebuild origin, each a mesh with its own box that Babylon frustum-tests every frame. (2) The meadow's far cards end at 30 m on the tiers with blades, and the terrain carries the sward past 24 m. (3) Cards lean away from the eye by the eye's elevation over them, and their bases hug the ground. (4) Card roots take the floor's colour, and card alpha is scaled by mip level. A WebGPU spike runs beside them on its own branch and ends in a go or a no-go. Nothing under `sim/`.

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
| `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md` (new) | 1, 2–5, 7 | Created by Task 1 (method, poses, control, attribution); one section per gate; closed by Task 7 |
| `client/src/game/grassSectors.ts` (new) | 2 | `SECTOR_OCTANTS`, the pads, `sectorCount`, `sectorOf`, the box accumulator |
| `client/src/game/clutterField.ts` | 2, 3 | `CLUTTER_SECTOR_RINGS`; `clutterOrigin` exported; `CLUTTER_MEADOW_CARD_END`, `CLUTTER_MEADOW_CARD_RAMP`, the far trim and `clutterMeadowFarEdges` |
| `client/src/game/clutterMeshes.ts` | 2, 3, 4, 5 | Buckets of parts, the sector meshes and boxes; the far edges on tiers with blades; `foliageGrad`; `foliageCover` |
| `client/src/game/bladeField.ts`, `bladeMeshes.ts` | 2C (conditional) | `bladeOrigin` exported; the coarse fine-grass buckets in octants |
| `client/src/game/groundHexParams.ts` | 3 | `FAR_SWARD`, `FAR_SWARD_MAX`, `FAR_SWARD_COVER`, `FAR_SWARD_BAND`, `FAR_SWARD_CELL`, `FAR_SWARD_CLUMP`, `FAR_SWARD_WIND`, `FAR_SWARD_GRAZE`, `farSwardWeight` |
| `client/src/game/shaders/sward.fragment.fx` (new) | 3, 5 | `swardGust`, `swardFar`, `swardNearWeight`, `swardFarWeight`: the floor's GLSL, included by the terrain and, from Task 5, the foliage fragment |
| `client/src/game/terrainTexture.ts` | 3 | Four uniforms, the far pull after the near one |
| `client/src/game/foliagePlugin.ts`, `shaders/foliage.vertex.fx`, `shaders/foliageWorldPos.vertex.fx`, `shaders/foliageLights.fragment.fx`, `shaders/foliage.fragment.fx`, `shaders/foliageAlpha.fragment.fx` (new) | 3, 4, 5 | `foliageWind()` getter; `FOLIAGE_LEAN`, the hug, `FOLIAGE_TILT` removed; `FOLIAGE_ROOT_BAND`, the root's floor colour, the mip-scaled alpha test |
| `tools/cardCoverage/cardCoverage.mjs` (new), `tools/cardCoverage/test/cardCoverage.test.mjs` (new) | 5 | Reads a card model's embedded alpha, prints coverage per box mip and the scale |
| `ARCHITECTURE.md` | 2, 3, 4, 5 | One sentence per step in the Rendering section |
| Tests: `grassSectors.test.ts` (new), `clutterMeshes.test.ts`, `clutterField.test.ts`, `bladeMeshes.test.ts`, `groundHexParams.test.ts`, `terrainTexture.test.ts`, `foliagePlugin.test.ts` | 2–5 | As each task says |
| Spike branch only: `client/src/app.ts`, `renderer.ts`, `bladeGpu.ts` (new), `client/public/libs/webgpu/` | 6 | Never merged; its report is |

---

### Task 1: The baseline, measured

No code. Everything the later tasks decide on is measured here first.

**Files:**
- Create: `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md`

**Interfaces:**
- Consumes: a control worktree detached at `origin/main` after the near-grass merge (`git worktree add --detach <path> origin/main`, then `npm ci`), and this branch's worktree, each serving its own build on its own port; the near-grass measurement patches (its plan, Task 1 Step 1: `__fcSet`, `__scene`/`__engine`, `?tier=`, a port per worktree).
- Produces: the note's §1 Method, §2 Poses and crops, §3 Control, §4 Attribution, which every gate appends to; the decisions of Step 6.

- [ ] **Step 1: Reproduce the control**

Near-grass verification §1 and §2, unchanged: `/dayhike/game/<fresh uuid>?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=high`, window 1200 × 2029 CSS pixels at device pixel ratio 1, 20 s to load, the pose, 8 s, the still; then the three isolation stills. Measure with that note's `fullness.py` and its crops and thresholds.

Expected (near-grass fourth gate, build A): canopy near cover 0.459, mid cover 0.734, cover ratio 0.62, luminance ratio 1.25; meadow near cover 0.472, mid cover 0.503, cover ratio 0.94, luminance ratio 0.96. A cover ratio more than 0.02 off means the page, the pose or the crop differs; find which before going on.

- [ ] **Step 2: The far crop**

At both poses, project the ground at 30 m and 38 m through the camera (vertical field of view 1.4 rad, pitch 0.3, the eye 1.6 m over the ground under the pose, the ground's rise read from the simulation along the view) to two screen rows; take a rectangle between them as wide as the mid crop and centred on it; draw it onto the still (`ffmpeg -vf drawbox=…`) and move it sideways until it lies on the sward, clear of any trunk, stump or prop. Record `W:H:X:Y` per pose as a literal. Run `fullness.py` with the far crop in place of the mid crop and the pose's threshold, and record the control's far mean and far cover.

- [ ] **Step 3: Counts and draw calls**

On the control page at each pose, in the console:

```js
const meshes = __scene.meshes.filter((m) => m.isEnabled() && m.thinInstanceCount > 0);
console.table(meshes.map((m) => ({ name: m.name, count: m.thinInstanceCount, vertices: m.getTotalVertices() })));
const si = new __SceneInstrumentation(__scene);
si.captureFrameTime = true; si.captureRenderTime = true; si.captureActiveMeshesEvaluationTime = true;
```

(The pose patch adds `globalThis.__SceneInstrumentation` and `__EngineInstrumentation`, imported in `renderer.ts` beside `__scene`.) Record per bucket: instances and vertices per instance; the scene's draw calls (`si.drawCallsCounter.current`); the frame, render and active-mesh evaluation times (averages over 8 s); the GPU frame time (`new __EngineInstrumentation(__engine)`, `captureGPUFrameTime = true`, `gpuFrameTimeCounter.average / 1e6` ms) where the browser exposes it.

Expected counts at the canopy pose (design §3.1): meadow near 2,674, meadow far 8,719, grass class 948 near and 3,611 far.

- [ ] **Step 4: The off-frustum share**

On the same page, per card and blade bucket:

```js
function inView(planes, x, y, z) {
  for (const p of planes) if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.d <= -0.5) return false;
  return true;
}
function share(mesh) {
  const m = mesh._thinInstanceDataStorage.matrixData, n = mesh.thinInstanceCount, planes = __scene.frustumPlanes;
  let seen = 0;
  for (let i = 0; i < n; i++) {
    const x = m[i * 16 + 12], y = m[i * 16 + 13], z = m[i * 16 + 14];
    if (inView(planes, x, y, z) || inView(planes, x, y + 0.8, z)) seen++;
  }
  return seen / n;
}
```

Record the share in view per bucket at both poses, at the gate's window and at a 1920 × 1080 window. Expected (design §3.4): 0.14–0.15 at the gate's window, 0.31–0.32 at 16:9, both at pitch 0.3.

- [ ] **Step 5: Attribution by toggling**

On one fresh control page per pose, at 4× pixels (`__engine.setHardwareScalingLevel(0.5)`), for each layer of design §4.4 in turn: hide it (`mesh.isVisible = false` on its meshes), wait 2 s, collect frame intervals from `onAfterRenderObservable` for 6 s; show it, wait 2 s, collect 6 s; six cycles. The layer's cost is the mean of the six (shown − hidden) differences of the half-cycle means; a cycle with nothing toggled, run first and last, is the noise floor. Then, for the meadow near and far buckets, the grass class's buckets and the blade coarse tier, the **filtered saving**: rewrite each bucket's `matrix`, `fadeBands` and `foliage` (and `bladeStrength`) buffers to the instances `share` counts in view, set the count, and cycle filtered against unfiltered the same way, restoring the original buffers after.

Record a table per pose: layer, cost (ms), filtered saving (ms), noise floor. If a toggle's cost is within the noise floor, say so rather than reading it.

- [ ] **Step 6: The decisions**

From Step 5, at the canopy pose at 4×:

1. The grass class is sectored in Task 2 (Step 2B) if its two buckets cost ≥ 0.2 ms together.
2. The blade coarse fine-grass buckets are split in Task 2 (Step 2C) if the coarse tier costs ≥ 0.4 ms.
3. If the meadow's and grass class's filtered savings together are under 1.0 ms, the bar cannot be met by culling: write so in the note, with what the other layers cost, before Task 2 is built.
4. If the filtered saving of any bucket beats what the design's derivation gives sectors (a third drawn, §5.3) by more than 0.5 ms, note it against design §5.2.

- [ ] **Step 7: Write the note and commit**

`docs/rendering/2026-09-26-grass-frame-reclaim-verification.md`: §1 Method (the patches in words, the page, the stills, the crops with the far crop, the pair method of design §12.3, the toggle method), §2 Poses and crops, §3 Control (fullness and isolation tables, the far crop, counts, draw calls, times), §4 Attribution (Step 4's shares, Step 5's tables, Step 6's decisions).

```bash
git add docs/rendering/2026-09-26-grass-frame-reclaim-verification.md
git commit -F - <<'EOF'
docs: measure where the grass frame goes at the two poses

## What

The baseline the frame reclaim is measured against: the near-grass
fullness reproduced on main, a far crop for the ground past 30 m, and
each grass layer's cost, its share out of view and what culling it
could save, measured on one page by toggling.

## How

- `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md` — the
  method, the poses and crops, the control, the attribution and the
  decisions it sets for the sectors.

<trailers>
EOF
```

---

### Task 2: Step 1 — sector culling

**Files:**
- Create: `client/src/game/grassSectors.ts`, `client/test/game/grassSectors.test.ts`
- Modify: `client/src/game/clutterField.ts` (export `clutterOrigin`; `CLUTTER_SECTOR_RINGS`)
- Modify: `client/src/game/clutterMeshes.ts` (`Bucket` → parts; `prepSectorMesh`; the fill, apply and box; `adopt`)
- Modify: `ARCHITECTURE.md` (the clutter sentence)
- Test: `client/test/game/clutterMeshes.test.ts`, `client/test/game/clutterField.test.ts`
- Step 2C only: `client/src/game/bladeField.ts`, `bladeMeshes.ts`, `client/test/game/bladeMeshes.test.ts`

**Interfaces:**
- Consumes: `clutterCell` (`sim/clutter.ts`); `inCone`, `View` (`wildlifeDirector.ts`) in the tests; `Frustum.GetPlanes` and `UniversalCamera` from Babylon in the tests.
- Produces:
  - `export const SECTOR_OCTANTS = 8`, `SECTOR_PAD_XZ = 1`, `SECTOR_PAD_DOWN = 0.5`, `SECTOR_PAD_UP = 1`
  - `export function sectorCount(rings: readonly number[]): number`
  - `export function sectorOf(x: number, z: number, ox: number, oz: number, rings: readonly number[]): number`
  - `export function resetBoxes(boxes: Float32Array): void`, `growBox(boxes: Float32Array, k: number, x: number, y: number, z: number): void`, `paddedBox(boxes: Float32Array, k: number, out: Float32Array): boolean` (false for an empty sector)
  - `export function clutterOrigin(camX: number, camZ: number, cell: number): { x: number; z: number }` (now exported)
  - `export const CLUTTER_SECTOR_RINGS: ReadonlyMap<number, readonly [readonly number[], readonly number[]]>` — `[near rings, far rings]` per sectored class

- [ ] **Step 1: Write the failing tests for the pure sector maths**

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
    expect(sectorCount([6, 14])).toBe(24);
    expect(sectorCount([18])).toBe(16);
    expect(sectorCount([])).toBe(8);
  });

  it("numbers octants clockwise from +Z, rings outward", () => {
    // Octant 0 starts at +Z (yaw 0 faces +Z) and runs toward +X; ring-major.
    expect(sectorOf(0, 3, 0, 0, [6, 14])).toBe(0);
    expect(sectorOf(3, 0, 0, 0, [6, 14])).toBe(2);
    expect(sectorOf(0, -3, 0, 0, [6, 14])).toBe(4);
    expect(sectorOf(-3, 0, 0, 0, [6, 14])).toBe(6);
    expect(sectorOf(0, 10, 0, 0, [6, 14])).toBe(8);
    expect(sectorOf(-10, -10, 0, 0, [6, 14])).toBe(21);
    // An octant edge belongs to the octant it opens: the diagonal +X+Z is octant 1.
    expect(sectorOf(2, 2, 0, 0, [6, 14])).toBe(1);
    // A ring edge belongs to the ring outside it.
    expect(sectorOf(0, 6, 0, 0, [6, 14])).toBe(8);
    // Relative to the origin, not the world.
    expect(sectorOf(103, 50, 100, 50, [6, 14])).toBe(2);
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

- [ ] **Step 2: Write the failing tests for the shell**

In `client/test/game/clutterField.test.ts`, import `CLUTTER_SECTOR_RINGS` and add:

```ts
  it("sectors the meadow's two buckets in octants and rings", () => {
    // Near [0, 22.24] in rings at 6 and 14 m; far [3.76, 40] at 14 and 24 m.
    expect(CLUTTER_SECTOR_RINGS.get(CLUTTER_MEADOW)).toEqual([[6, 14], [14, 24]]);
    expect([...CLUTTER_SECTOR_RINGS.keys()]).toEqual([CLUTTER_MEADOW]);
  });
```

In `client/test/game/clutterMeshes.test.ts`, inside `describe("the cards beside the blade field", …)`, reusing its `build(nearBlades)`, add a helper and four tests:

```ts
  function sectorsOf(scene: Scene, source: Mesh): Mesh[] {
    return scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.name.startsWith(`${source.name}.s`));
  }
  function origins(mesh: Mesh): [number, number, number][] {
    const m = mesh.thinInstanceGetWorldMatrices();
    return m.map((w) => [w.m[12]!, w.m[13]!, w.m[14]!] as [number, number, number]);
  }

  it("splits the meadow's buckets into sectors that hold every card once", () => {
    const { scene, assets, clutter, engine } = build(true);
    clutter.update(35, 21335);
    const near = assets[CLUTTER_MEADOW]![0]![0]![0]!;
    const far = assets[CLUTTER_MEADOW]![0]![1]![0]!;
    const nearSectors = sectorsOf(scene, near);
    const farSectors = sectorsOf(scene, far);
    expect(nearSectors.length).toBe(24);
    expect(farSectors.length).toBe(24);
    // The source meshes no longer draw; the sectors do.
    expect(near.isEnabled()).toBe(false);
    expect(far.isEnabled()).toBe(false);
    const sum = (list: Mesh[]) => list.reduce((s, m) => s + (m.isEnabled() ? m.thinInstanceCount : 0), 0);
    expect(sum(nearSectors)).toBe(2801);
    expect(sum(farSectors)).toBe(collectClutter(1, 35, 21335)[CLUTTER_MEADOW]!.far.length);
    for (const mesh of [...nearSectors, ...farSectors]) {
      expect(mesh.alwaysSelectAsActiveMesh).toBe(false);
      expect(mesh.cullingStrategy).toBe(AbstractMesh.CULLINGSTRATEGY_STANDARD);
      if (!mesh.isEnabled()) continue;
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
    clutter.dispose();
    engine.dispose();
  }, 30_000);

  it("gives every sector its bucket's fade bands", () => {
    const { scene, assets, clutter, engine } = build(true);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    clutter.update(35, 21335);
    const cases: [Mesh, number[]][] = [
      [assets[CLUTTER_MEADOW]![0]![0]![0]!, [1, 2.5, 8, 18]],
      [assets[CLUTTER_MEADOW]![0]![1]![0]!, [8, 18, 28, 40]],
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

  it("never culls a card the camera can see", () => {
    const { scene, assets, clutter, engine } = build(true);
    clutter.update(35, 21335);
    const camera = new UniversalCamera("eye", new Vector3(35, 0, 21335), scene);
    camera.fov = 1.4;
    camera.minZ = 0.05;
    for (const source of [assets[CLUTTER_MEADOW]![0]![0]![0]!, assets[CLUTTER_MEADOW]![0]![1]![0]!]) {
      const sectors = sectorsOf(scene, source).filter((m) => m.isEnabled());
      for (const [yaw, pitch] of [[0, 0.3], [Math.PI / 2, 0.3], [Math.PI, 0.9], [2.4, 0.6]] as const) {
        // The eye 1.6 m over the ground at the camera, as the game's is.
        const eyeY = elevationSampleAt(1, 35, 21335).h + 1.6;
        camera.position.set(35, eyeY, 21335);
        camera.rotation.set(pitch, yaw, 0);
        camera.computeWorldMatrix(true);
        const planes = Frustum.GetPlanes(camera.getTransformationMatrix(true));
        const view = { x: 35, y: eyeY, z: 21335, yaw, pitch, fov: 1.4, aspect: engine.getAspectRatio(camera) };
        for (const mesh of sectors) {
          const drawn = mesh.isInFrustum(planes);
          if (drawn) continue;
          for (const [x, y, z] of origins(mesh)) {
            expect(inCone(view, x, y, z, 0) || inCone(view, x, y + 0.8, z, 0)).toBe(false);
          }
        }
      }
    }
    clutter.dispose();
    engine.dispose();
  }, 60_000);

  it("fills sectors by the rebuild point alone, never by the path", () => {
    const a = build(true);
    a.clutter.update(35, 21335);
    const b = build(true);
    b.clutter.update(65, 21335); // a rebuild 30 m away first
    b.clutter.update(35, 21335);
    for (const [cls, lod] of [[CLUTTER_MEADOW, 0], [CLUTTER_MEADOW, 1]] as const) {
      const sa = sectorsOf(a.scene, a.assets[cls]![0]![lod]![0]!);
      const sb = sectorsOf(b.scene, b.assets[cls]![0]![lod]![0]!);
      expect(sa.map((m) => m.isEnabled() ? m.thinInstanceCount : 0)).toEqual(sb.map((m) => m.isEnabled() ? m.thinInstanceCount : 0));
      for (let k = 0; k < sa.length; k++) {
        if (!sa[k]!.isEnabled()) continue;
        expect(origins(sa[k]!)).toEqual(origins(sb[k]!));
      }
    }
    for (const t of [a, b]) { t.clutter.dispose(); t.engine.dispose(); }
  }, 60_000);
```

Imports to add at the top of the file: `AbstractMesh` (`@babylonjs/core/Meshes/abstractMesh.js`), `UniversalCamera` (`@babylonjs/core/Cameras/universalCamera.js`), `Frustum` (`@babylonjs/core/Maths/math.frustum.js`), `inCone` (`../../src/game/wildlifeDirector.js`). `elevationSampleAt` is imported already.

The literal 2801 is the existing test's; the far bucket's sum is checked against the collector here because the collector's far count is pinned elsewhere. The fade literal `[8, 18, 28, 40]` is the far bucket's today; Task 3 moves it and this test with it.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/grassSectors.test.ts test/game/clutterField.test.ts test/game/clutterMeshes.test.ts`
Expected: FAIL — `grassSectors.js` does not exist; `CLUTTER_SECTOR_RINGS` is not exported; no mesh named `*.s0`.

- [ ] **Step 4: The pure module**

`client/src/game/grassSectors.ts`:

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
/** Padding (m) of a sector's box beyond its instance origins: sideways for a
 * card's half-width at its largest scale, the wind's lean and the step-3 lean;
 * down for the far sink; up for the card's height. */
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

/** Six floats per sector: min x, y, z, max x, y, z of its instance origins. */
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

`client/src/game/clutterField.ts`: export `clutterOrigin` (unchanged body), and after `CLUTTER_MEADOW_NEAR_IN`:

```ts
/**
 * The classes whose buckets are split into sectors (grassSectors.ts), with
 * each bucket's ring edges (m from its rebuild origin): [near, far]. A disc
 * needs rings, because an octant's box reaches back to the origin and so is
 * drawn from nearly any view; an annulus does not. The meadow's near bucket
 * runs to 22.24 m, its far one from 3.76 m.
 */
export const CLUTTER_SECTOR_RINGS: ReadonlyMap<number, readonly [readonly number[], readonly number[]]> = new Map([
  [CLUTTER_MEADOW, [[6, 14], [14, 24]] as const],
]);
```

- [ ] **Step 5: The shell**

`client/src/game/clutterMeshes.ts`:

- A `Part` type carries what `Bucket` carries per mesh today: `meshes`, `buf`, `bands`, `foliage`, `count`, `grown`. `Bucket` keeps `fade` and `tints` and gains `parts: Part[]`, `rings: readonly number[] | null` and `boxes: Float32Array` (six floats per part; empty when not sectored). An unsectored bucket has one part holding its source meshes, so the fill and apply loops run the same code either way.
- `ensureCapacity` and `applyBucket` become `ensureCapacity(part)` and `applyPart(part, box)`; `applyPart` sets the box when the bucket is sectored:

```ts
const scratchBox = new Float32Array(6);
const scratchMin = new Vector3();
const scratchMax = new Vector3();

/** A sector's box, from its instance origins padded (grassSectors.ts), set
 * directly: `thinInstanceRefreshBoundingInfo` would transform the model box's
 * corners by every matrix, and the fill has the origins already. */
function setSectorBox(mesh: Mesh, boxes: Float32Array, k: number): void {
  if (!paddedBox(boxes, k, scratchBox)) return;
  scratchMin.copyFromFloats(scratchBox[0]!, scratchBox[1]!, scratchBox[2]!);
  scratchMax.copyFromFloats(scratchBox[3]!, scratchBox[4]!, scratchBox[5]!);
  mesh.getBoundingInfo().reConstruct(scratchMin, scratchMax, mesh.getWorldMatrix());
}
```

- `prepSectorMesh(mesh)`: `prepBucketMesh(mesh)`, then `mesh.alwaysSelectAsActiveMesh = false` and `mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD`, with a comment: the default strategy tests only the sphere around the box, which for a sector reaches far past it.
- `rebuild`: for each sectored class, the class's origin `clutterOrigin(x, z, clutterCell(cls))` (the collector's own); pass 1 counts `bucket.parts[sectorOf(inst.x, inst.z, o.x, o.z, rings)]`; pass 2 writes into that part and grows its box by the translation of the matrix just written (`growBox(bucket.boxes, k, scratchMatBuf[12], scratchMatBuf[13], scratchMatBuf[14])`, so the sink is in it); `resetBoxes` before pass 2. For an unsectored bucket the part is always 0 and no box is grown.
- `adopt`: after the foliage and fade attach (the plugin reads its height off the source mesh's box, so this runs after), for a class in `CLUTTER_SECTOR_RINGS` and each LOD: `sectorCount(rings)` parts, each `meshes.map((m) => m.clone(`${m.name}.s${k}`, null, true)!.makeGeometryUnique())` passed through `prepSectorMesh`; the source meshes `setEnabled(false)` (their container owns them); `boxes = new Float32Array(6 * parts.length)`. Casters stay the boulders' source meshes; no sectored class casts.
- `dispose`: every part's meshes.

`ARCHITECTURE.md`: after the sentence on the blade buckets, one sentence: the meadow's card buckets are split into octants and rings about their rebuild origin, each a mesh with its own box, so Babylon's frustum test draws only the sectors in view.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/grassSectors.test.ts test/game/clutterField.test.ts test/game/clutterMeshes.test.ts test/game/bladeMeshes.test.ts test/game/renderer.test.ts`
Expected: all pass. The existing `clutterMeshes` tests that read a meadow bucket's buffer through `bufferFor(spy, meadowNear, …)` now read the source mesh, which no longer receives buffers: point them at the sectors (sum of counts; the first enabled sector's `fadeBands`), keeping their literals.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/grassSectors.ts client/src/game/clutterField.ts client/src/game/clutterMeshes.ts ARCHITECTURE.md client/test/game/grassSectors.test.ts client/test/game/clutterField.test.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: draw only the meadow card sectors the camera can see

## What

Every meadow card was drawn every frame: its buckets were pinned always
active, and Babylon frustum-tests a thin-instanced mesh as one box that
always holds the eye. Each bucket is now split into octants and rings
about its rebuild origin, each sector a mesh with its own box, so the
frustum test drops the two thirds of the cards behind and beside the
view. The rebuild writes the same instances; nothing runs per frame
but Babylon's own box tests.

## How

- `client/src/game/grassSectors.ts` — the octant-and-ring index, the
  box accumulator and its padding.
- `client/src/game/clutterMeshes.ts` — buckets of parts; the meadow's
  sector meshes, not always active, standard culling, a box per rebuild.
- `client/src/game/clutterField.ts` — `CLUTTER_SECTOR_RINGS`;
  `clutterOrigin` exported for the shell.
- `ARCHITECTURE.md` — the sectors in the clutter sentence.
- `client/test/game/grassSectors.test.ts`, `clutterMeshes.test.ts`,
  `clutterField.test.ts` — the index as literals, every card in one
  sector, no visible card culled, the fill independent of the path.

<trailers>
EOF
```

- [ ] **Step 8 (2B, if Task 1 Step 6 took it): the grass class**

Failing test first: `CLUTTER_SECTOR_RINGS.get(CLUTTER_GRASS)` is `[[18], []]` and the keys are `[CLUTTER_GRASS, CLUTTER_MEADOW]` in that order; in `clutterMeshes.test.ts`, the grass class's buckets split into 16 near and 8 far sectors per model, their counts summing to the collector's. Run, see it fail, add `[CLUTTER_GRASS, [[18], []]]` to the map, run, pass, commit (`feat: draw only the grass card sectors the camera can see`, the two files and their tests).

- [ ] **Step 9 (2C, if Task 1 Step 6 took it): the blade coarse fine grass**

`client/test/game/bladeMeshes.test.ts`, failing first:

```ts
  it("splits the coarse tier's fine grass into octants, nearest first in each", () => {
    // Coarse tier (2), fine grass (character 0), three sizes, eight octants each.
    const { scene, blades, engine } = buildBlades();
    blades.update(35, 21335);
    const tiers = collectBladeCells(1, 35, 21335);
    const want = [0, 1, 2].map((size) => tiers.coarse.filter((c) => c.character === 0 && c.size === size).length);
    for (const size of [0, 1, 2]) {
      const sectors = scene.meshes.filter((m) => m.name.startsWith(`${bladeMeshName(0, 2, size)}.s`)) as Mesh[];
      expect(sectors.length).toBe(8);
      expect(sectors.reduce((s, m) => s + (m.isEnabled() ? m.thinInstanceCount : 0), 0)).toBe(want[size]);
      for (const m of sectors) expect(m.alwaysSelectAsActiveMesh).toBe(false);
    }
    blades.dispose();
    engine.dispose();
  }, 30_000);
```

(`buildBlades` is the file's existing NullEngine helper, or one written beside it the same way.) Implementation: export `bladeOrigin` from `bladeField.ts`; in `bladeMeshes.ts` the three buckets `[2][0][size]` hold eight parts each (clones of the clump mesh with its `blade` vertex data, `prepSectorMesh`, `receiveShadows` kept), filled by `sectorOf(c.x, c.z, bladeOrigin(x), bladeOrigin(z), [])` in list order, so each part stays nearest-first; `meshes` lists the parts in place of the three source meshes. Commit `feat: draw only the coarse blade sectors the camera can see`.

- [ ] **Step 10: Gate**

Branch against control, the patches of Task 1 applied to both; the sectors' gate switch added to the branch's patch (`globalThis.__sectors = (on) => …` setting every sector mesh's `alwaysSelectAsActiveMesh` to `!on`).

1. **Fullness** at both poses with the isolation; bar as design §12.1.
2. **Invisible culling:** at each pose, on one branch page, two stills 0.5 s apart with `__sectors(false)`, then one with `__sectors(true)`; the mean absolute difference in linear luminance between the first two and between the second and third, over the whole frame. Bar: the second no larger than the first by more than 10 %.
3. **Frame:** design §12.3 at both poses, 4× and native, the landscape round, draw calls and JS frame time. Expected at the canopy pose: −0.8 to −1.5 ms with the meadow alone (design §5.8).
4. **The turn** (design §12.4): 32 stills per pitch; bar: nothing appears or vanishes at a frame edge.
5. **The walk:** the near-grass walk.

Append `## 5. Step 1: sectors` to the note: the fullness table against the control, the isolation, the culling-invisible figures, the frame table per round (control, branch, delta, quiet), the draw calls and JS time, the turn and the walk. If the frame bar is met already, Tasks 3–5 are still taken for what they add or keep (design §6.3, §7, §8), and their frame bar is that each stays inside the noise of this gate.

```bash
git add docs/rendering/2026-09-26-grass-frame-reclaim-verification.md
git commit -F - <<'EOF'
docs: gate the card sectors at both poses

## What

The fullness, invisible-culling check, frame pairs, draw calls, turn
and walk for the sectors, against main at the two poses.

## How

- `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md` — §5.

<trailers>
EOF
```

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

`client/test/game/clutterMeshes.test.ts`: in the fade-bands test of Task 2, the far literal becomes `[8, 18, 26, 30]` when `nearBlades` is true (and stays `[8, 18, 28, 40]` built with `nearBlades: false`); the far sectors' summed count equals the trimmed collector's.

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
4. **Frame** as Task 2's gate, reported against the control and against Task 2's gate. Expected: −0.1 to −0.3 ms beyond Task 2 (design §6.3).
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

On the WebGPU engine at the canopy and meadow poses, 4×, the pair method (design §12.3): **S** (Step 2) against **B** (the shipped blade field on WebGPU, `?blades=cpu`); and the WebGPU build with S against the WebGL2 build of the same commit. Fullness with the isolation for S and B. The walk and the turn with S. Chrome's WebGPU timestamps are quantised to 100 µs without the developer-features flag, so the frame intervals, not GPU timers, are the measure, as on WebGL2.

- [ ] **Step 4: The report and the verdict**

`docs/rendering/<date>-grass-webgpu-spike.md`: the engine step (which plugins compiled, the frame against WebGL2), the pass as built, the tables of Step 3, the verdict against the four criteria of design §9.5, and, if go, the upstream proposal's shape and the per-blade next step's WGSL cost. Commit it on the spike branch alone (`docs: report the WebGPU blade culling spike`), then bring that one commit to this stream's branch (`git cherry-pick <sha>`), so the report merges with the stream and the spike's code does not.

---

### Task 7: Close the verification note and the design

**Files:**
- Modify: `docs/rendering/2026-09-26-grass-frame-reclaim-verification.md`, `docs/rendering/2026-09-26-grass-frame-reclaim-design.md` (the **As built** paragraph only), `ARCHITECTURE.md` (if a step's sentence changed at its gate)

- [ ] **Step 1: The last frame round**

TRAILSIDE (`__fcSet(263.9, 85.77, 118, 0.6, 0.25)`, `weather mist`, `time 12`), high, 4×, by design §12.3's method, for continuity with the blade-field, floor-look and near-grass notes; and the canopy pose once more, control against the final branch, for the headline delta.

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
