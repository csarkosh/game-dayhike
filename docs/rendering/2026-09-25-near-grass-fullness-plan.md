# Near Grass Fullness Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ground 2–6 m from a hiker's eye reads as full as the ground 18–26 m out: near cover ≥ 0.8 × mid cover and near/mid mean linear luminance in 0.8–1.25, at a canopy sward pose and an open meadow pose, within +1.0 ms at 4× pixels.

**Architecture:** Four steps, in order, each behind its own gate; a later step is taken only if a pose still misses the bar. (1) The meadow's near cards stay under the blade field on high and medium, dithering in from the eye. (2) The terrain gains a per-vertex ground-cover channel and a sward-floor pull inside the blade field's reach. (3) The meadow seam narrows to [13.5, 18] so the coarse blade tier has a full-strength stretch, and only if that misses, the coarse counts are restored with the vertex budget raised. (4) Only for a luminance or colour miss, the blades' albedo is lifted. Nothing under `sim/`.

**Tech Stack:** TypeScript, Babylon.js 9.18 (thin instances, `MaterialPluginBase`), GLSL in template strings, vitest 4 with `NullEngine`.

**Spec:** `docs/rendering/2026-09-25-near-grass-fullness-design.md`

## Global Constraints

- No file under `client/src/sim/` changes; the level id does not move (the `CLUTTER_TUNABLES` digest pinned in `client/test/sim/groundGradient.test.ts` is untouched).
- Every numeric expectation in a test is a literal, never the constant it pins. vitest 4 takes a test's timeout as the third argument: `it("…", () => { … }, 20_000)`.
- GLSL rules (`client/test/game/shaderHygiene.test.ts`): no comment spelling a preprocessor directive, no semicolon inside a trailing comment on a code line; a new uniform goes on BOTH the `getUniforms().ubo` list and the non-UBO `fragment` string, never inside `TERRAIN_FRAGMENT_DEFS`.
- Before every commit: `npm run typecheck`, the touched test files (`cd client && npx vitest run <files>`), and `npx eslint <touched files>` green.
- Stage explicit paths only, never `git add -A` or `git add .`.
- Commit format: type-prefixed subject under 72 characters, a blank line, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then the repository's two attribution trailer lines.
- Public repository: no code comment, doc or commit message describes how an asset was made or the process around the work; write for an engineer reading the code.
- Measurement patches (Task 1, Step 1) are applied to a worktree for a gate and reverted after it. They are never committed; `git status --porcelain` is clean before any commit.

## File map

| File | Task | Change |
| --- | --- | --- |
| `docs/rendering/2026-09-25-near-grass-fullness-verification.md` (new) | 1, 2–5, 6 | Created by Task 1 (method, poses, control); one section appended per gate; closed by Task 6 |
| `client/src/game/clutterField.ts` | 2, 4 | `CLUTTER_MEADOW_NEAR_IN` (new); `CLUTTER_BLADE_HANDOFF` 10 → 4.5 |
| `client/src/game/clutterMeshes.ts` | 2 | The near-card filter removed; the meadow near bucket's in-band on `nearBlades` tiers |
| `client/src/game/bladeField.ts` | 2 | `bladeFieldCovers` removed |
| `client/src/game/renderer.ts` | 2, 3 | Comments at the clutter/blade creation; `terrainCover` upload |
| `ARCHITECTURE.md` | 2, 3 | The near-field sentence; the floor sentence |
| `client/src/game/groundHexParams.ts` | 3 | `SWARD_FLOOR`, `SWARD_MAX`, `SWARD_COVER`, `SWARD_FADE`, `swardWeight` |
| `client/src/game/clipmap.ts` | 3 | The per-vertex `cover` channel: sampled, scrolled, emitted |
| `client/src/game/terrainTexture.ts` | 3 | `terrainCover` attribute, `vTerrainCover`, two uniforms, the pull |
| `client/src/game/bladeClump.ts` | 4B, 5 | Coarse counts and `BLADE_VERTEX_BUDGET` (conditional); `BLADE_ALBEDO` (conditional) |
| `client/test/game/clutterMeshes.test.ts`, `clutterField.test.ts`, `bladeField.test.ts` | 2, 4 | Filter gone, in-band, seam literals |
| `client/test/game/groundHexParams.test.ts`, `clipmap.test.ts`, `terrainTexture.test.ts` | 3 | Constants, cover channel, attribute, uniforms, the pull's GLSL |
| `client/test/game/bladeClump.test.ts` | 4B, 5 | Counts, budget, albedo |

---

### Task 1: Pin the poses and measure the control

No code. The gate places the camera, not the player: with `freecam` on, every field is updated at the free camera's XZ (`client/src/game/renderer.ts:988–998`), so no teleport or placement command is needed.

**Files:**
- Create: `docs/rendering/2026-09-25-near-grass-fullness-verification.md`

**Interfaces:**
- Consumes: a second worktree detached at `origin/main` (`git worktree add --detach <path> origin/main`, then `npm ci`) as the control, and this branch's worktree, each serving its own build on its own port.
- Produces: the note's §1 Method, §2 Poses, §3 Control, which every later gate appends to.

- [ ] **Step 1: The two measurement patches**

Apply to both worktrees; revert after every gate (`git checkout -- client/src/app.ts client/src/game/renderer.ts client/vite.config.ts`).

1. The pose: in `client/src/app.ts`, right after `let freecamPending = false;`, a `forcedView` of `{ x, y, z, yaw, pitch } | null` and `globalThis.__fcSet = (x, y, z, yaw, pitch) => { forcedView = { x, y, z, yaw, pitch }; }`; at the top of `stepFreecamView`, `if (forcedView !== null) { freecam = { x: forcedView.x, y: forcedView.y, z: forcedView.z }; freecamPending = false; renderer.setFreecam(forcedView); return; }`. In `client/src/game/renderer.ts`, right after `const scene = new Scene(engine);`, `globalThis.__scene = scene; globalThis.__engine = engine;`.
2. The tier: in `client/src/app.ts`, `createRenderer(canvas, level, forest, { tier })` with `tier` read from `?tier=` (`low`, `medium` or `high`, else `undefined`), and `globalThis.__tier` set to it. A desktop browser reports at most 8 GB of device memory, so detection alone lands on medium.
3. `client/vite.config.ts`: each worktree on its own port.

- [ ] **Step 2: Load the poses**

URL, on each build's port: `/dayhike/game/<fresh uuid>?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=high`. The browser window is 1200 × 2029 CSS pixels at device pixel ratio 1; check `__engine.getRenderWidth()` is 1200 and `getRenderHeight()` 2029. Wait 20 s for the page, then set the pose, then wait 8 s:

| pose | `__fcSet` |
| --- | --- |
| canopy | `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` |
| meadow | `__fcSet(369, 51.01, -855, 0, 0.3)` |

Take the still (PNG) at once: `time 12` is set at load and the clock runs.

- [ ] **Step 3: The layer isolation**

On the same page, three more stills, each after hiding layers by `mesh.isVisible = false` and waiting 1.5 s: no blades (`/^blade_clumps/`), no cards (`/^LOD|^clutter\.grass|^clutter\.meadow/`), bare ground (`/^blade_clumps|^duff_clumps|^LOD|^clutter\./`). Apply the test only to meshes with `thinInstanceCount > 0` or a name starting `LOD`.

- [ ] **Step 4: Measure**

For each still, this script (keep it beside the stills, not in the repository):

```python
#!/usr/bin/env python3
"""fullness.py <still.png> <near W:H:X:Y> <mid W:H:X:Y> [threshold]"""
import sys, numpy as np
from PIL import Image
img = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float64) / 255.0
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
def crop(spec):
    w, h, x, y = map(int, spec.split(":"))
    return L[y:y + h, x:x + w].ravel()
near, mid = crop(sys.argv[2]), crop(sys.argv[3])
thr = float(sys.argv[4]) if len(sys.argv) > 4 else float(np.median(mid))
cn, cm = float((near < thr).mean()), float((mid < thr).mean())
print(f"near mean={near.mean():.4f} cover={cn:.3f} | mid mean={mid.mean():.4f} cover={cm:.3f} "
      f"| cover ratio={cn / cm:.2f} lum ratio={near.mean() / mid.mean():.2f}")
```

Crops and thresholds (design §4.2):

| pose | near | mid | threshold |
| --- | --- | --- | --- |
| canopy | `280:500:420:970` | `220:22:400:678` | 0.02058 |
| meadow | `360:500:420:980` | `240:22:480:740` | 0.02853 |

Draw each rectangle onto the full still (`ffmpeg -vf drawbox=…`) and look at it before using its number: the near crop on the sward left of the trail, the mid crop on the dark tuft band beyond it, neither on a trunk, stump or prop.

Expected (the design's control, `9c97483`): canopy cover ratio 0.26–0.27, luminance ratio 1.16; meadow cover ratio 0.47–0.48, luminance ratio 1.16. A reading more than 0.03 off in cover ratio means the page, the pose or the crop differs from the design's; find which before going on.

- [ ] **Step 5: Write the note and commit**

`docs/rendering/2026-09-25-near-grass-fullness-verification.md`: §1 Method (the patches in words, the page, the stills, the script, the crops), §2 Poses (the two `__fcSet` lines, the conditions), §3 Control (the fullness table and the isolation table, with the date and the commit measured).

```bash
git add docs/rendering/2026-09-25-near-grass-fullness-verification.md
git commit -F - <<'EOF'
docs: record the near grass control at its two poses

## What

The poses the near-grass work is gated at, how a still is measured,
and what main measures there: near cover a quarter to a half of the
mid field's, at the same mean luminance.

## How

- `docs/rendering/2026-09-25-near-grass-fullness-verification.md` — the
  method, the canopy and meadow poses, the control's fullness and
  layer-isolation tables.

<trailers>
EOF
```

---

### Task 2: Step 1 — keep the near cards under the blades

**Files:**
- Modify: `client/src/game/clutterField.ts` (new `CLUTTER_MEADOW_NEAR_IN`)
- Modify: `client/src/game/clutterMeshes.ts` (the `nearLists` filter at 598–612; the `fade` in `adopt`; the `nearBlades` option's comment)
- Modify: `client/src/game/bladeField.ts` (remove `bladeFieldCovers`, 161–174)
- Modify: `client/src/game/renderer.ts` (the comments at 782–795)
- Modify: `ARCHITECTURE.md` (the near-field sentence)
- Test: `client/test/game/clutterMeshes.test.ts`, `client/test/game/clutterField.test.ts`

**Interfaces:**
- Consumes: `clutterSeamEdges`, `collectClutter` (`clutterField.ts`); `fadeBands` (`distanceFadePlugin.ts`).
- Produces: `export const CLUTTER_MEADOW_NEAR_IN: readonly [number, number] = [1, 2.5]`.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/clutterField.test.ts`, add `CLUTTER_MEADOW_NEAR_IN` to the import from `../../src/game/clutterField.js` and add:

```ts
  it("dithers the meadow's near cards in from the eye, clear of the seam", () => {
    // Under the blade field the meadow's near cards are the cover and the
    // blades the detail. Inside 1 m a card would stand as a flat plane at the
    // feet, so it is absent there and thickens in by 2.5 m, where the fine
    // blade tier is densest. The in-band ends well inside the seam's start.
    expect(CLUTTER_MEADOW_NEAR_IN).toEqual([1, 2.5]);
    expect(clutterSeamEdges(CLUTTER_MEADOW).start).toBeGreaterThan(2.5);
  });
```

In `client/test/game/clutterMeshes.test.ts`, remove the `bladeFieldCovers` import and replace the test `"only drops a near card where the blade field actually covers it"` with:

```ts
  // The blade field adds detail over the meadow's cards; it never takes them
  // away. From a standing eye the blades are 2 cm strips over bare ground,
  // and the cards are the cover the mid field reads full with.
  it("keeps every meadow near card under the blade field, dithering in from the eye", () => {
    const want = collectClutter(1, 35, 21335)[CLUTTER_MEADOW]!.near.length;
    expect(want).toBeGreaterThan(0);
    for (const nearBlades of [true, false]) {
      const { assets, clutter, engine } = build(nearBlades);
      const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      clutter.update(35, 21335);
      const meadowNear = assets[CLUTTER_MEADOW]![0]![0]![0]!;
      const meadowFar = assets[CLUTTER_MEADOW]![0]![1]![0]!;
      const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
      expect(meadowFar.thinInstanceCount).toBeGreaterThan(0);
      // Every near instance the collector returns, blades or not.
      expect(meadowNear.thinInstanceCount).toBe(want);
      // With blades over them the near cards dither in over [1, 2.5] m; the
      // seam's dither-out is the same either way.
      const bands = Array.from(bufferFor(spy, meadowNear, "fadeBands")!.subarray(0, 4));
      expect(bands).toEqual((nearBlades ? [1, 2.5, 8, 18] : [-2, -1, 8, 18]).map(Math.fround));
      // The grass near cards draw all the way in either way.
      expect(grassNear.thinInstanceCount).toBeGreaterThan(0);
      const grassSeam = clutterSeamEdges(CLUTTER_GRASS);
      const grassWant = [-2, -1, grassSeam.start, grassSeam.end].map(Math.fround);
      expect(Array.from(bufferFor(spy, grassNear, "fadeBands")!.subarray(0, 4))).toEqual(grassWant);
      spy.mockRestore();
      clutter.dispose();
      engine.dispose();
    }
  }, 20_000);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/clutterField.test.ts test/game/clutterMeshes.test.ts`
Expected: FAIL — `CLUTTER_MEADOW_NEAR_IN` is not exported; with `nearBlades` the meadow near count is 0 (the filter) and its bands are `[-2, -1, 8, 18]`.

- [ ] **Step 3: Keep the cards and give them the in-band**

`client/src/game/clutterField.ts`, after `CLUTTER_BLADE_HANDOFF`:

```ts
/**
 * The meadow's near cards' in-band (m, eye distance to the instance origin)
 * on the tiers that draw the blade field over them. The cards are the near
 * field's cover and the blades its detail; inside 1 m a card would stand
 * across the view at the feet as the flat quads it is, so it is absent there
 * and dithers in by 2.5 m, where the fine blade tier is densest. It starts
 * outside FOLIAGE_BEND_R, so the local player's own bend never acts on a
 * card that can be seen.
 */
export const CLUTTER_MEADOW_NEAR_IN: readonly [number, number] = [1, 2.5];
```

`client/src/game/clutterMeshes.ts`:

- Delete the `nearLists` block (the comment starting "With the blade field on, a meadow near card is redundant…" and the loop that fills `nearLists`), and in the count and write loops iterate `band.near` in place of `nearLists[cls] as ClutterInstance[]`.
- Remove the `bladeFieldCovers` import; import `CLUTTER_MEADOW_NEAR_IN` with the other `clutterField.js` names.
- In `adopt`, replace the near-bucket fade:

```ts
          // The meadow's near cards stand under the blade field on the tiers
          // that draw it, and dither in from the eye there so none stands as
          // a flat plane at the feet. Every other near bucket draws all the
          // way in, as does the meadow's on the low tier, which has no blades.
          const nearIn = nearBlades && cls === CLUTTER_MEADOW ? CLUTTER_MEADOW_NEAR_IN : null;
          const fade: FadeBands = lod === NEAR_LOD
            ? fadeBands(nearIn, [seam.start, seam.end])
            : fadeBands([seam.start, seam.end], [edge.start, edge.end]);
```

- The `nearBlades` option's doc comment: "The blade field (bladeMeshes.ts) draws over the meadow's near cards on this tier, so those cards dither in from the eye over `CLUTTER_MEADOW_NEAR_IN` rather than standing at the feet. Off on the low tier, which draws no blades."

`client/src/game/bladeField.ts`: delete `bladeFieldCovers` and its doc comment. `groundCover` stays imported (`bladeCellAt` reads it).

`client/src/game/renderer.ts`: the comment above `createClutterMeshes` says high and medium draw the blade field over the meadow's near cards, which dither in from the eye; the comment above `createBladeMeshes` says it draws over the cards rather than taking their place.

`ARCHITECTURE.md`: in the sentence beginning "Inside 18 m on the high and medium tiers the near field is opaque blade clumps built in code, placed independently of the cards", add that the meadow's near cards stand under them as cover, dithering in from a metre out.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/clutterField.test.ts test/game/clutterMeshes.test.ts test/game/bladeField.test.ts test/game/bladeMeshes.test.ts`
Expected: all pass. The first `clutterMeshes` test (default `nearBlades: false`) still expects `[-2, -1, seam]` on every near bucket and passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/clutterField.ts client/src/game/clutterMeshes.ts client/src/game/bladeField.ts client/src/game/renderer.ts ARCHITECTURE.md client/test/game/clutterField.test.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: keep the meadow's near cards under the blade field

## What

Inside 18 m the blade field took the meadow cards' place, and from a
standing eye its 2 cm strips show the ground between them: the near
field read nearly bare while the mid field, all cards, read full. The
near cards now stay under the blades on high and medium as the cover,
with the blades as the detail on top, dithering in from a metre out so
none stands as a flat plane at the feet.

## How

- `client/src/game/clutterMeshes.ts` — the near-card filter removed;
  the meadow near bucket's bands are (1, 2.5, seam) on tiers with blades.
- `client/src/game/clutterField.ts` — `CLUTTER_MEADOW_NEAR_IN` [1, 2.5].
- `client/src/game/bladeField.ts` — `bladeFieldCovers`, now unused,
  removed.
- `client/src/game/renderer.ts`, `ARCHITECTURE.md` — the near field
  described as cards under blades.
- `client/test/game/clutterMeshes.test.ts`, `clutterField.test.ts` —
  every near card kept, the in-band pinned as literals.

<trailers>
EOF
```

- [ ] **Step 6: Gate**

Branch against control, the patches of Task 1 applied to both, both builds on their own ports.

1. **Fullness.** Task 1 Steps 2–4 at both poses on the branch, with the control's thresholds. Bar: near cover ≥ 0.8 × mid cover and luminance ratio in 0.8–1.25 at both poses.
2. **Isolation.** Task 1 Step 3 on the branch: what now fills the near crop.
3. **Frame.** Design §8.3: high tier, `__engine.setHardwareScalingLevel(0.5)`, per page the pose, 3 s settle, then 8 s of `onAfterRenderObservable` intervals (mean, p95); one browser start per round, a discarded warm-up page, then the two builds; order alternating, at least two rounds per order; one control-against-control round per order. Repeat at scaling 1 for the native p95. Bar: mean delta ≤ +1.0 ms at both poses; the same-code delta under 0.5 ms or the rounds are repeated.
4. **Look and walk.** Design §8.4 at the canopy pose: 12 steps of 0.25 m along +X at pitch 0.3 (`__fcSet(123 + 0.25·k, y, -105.5, 1.571, 0.3)`, `y` the ground plus 1.6 m from the note's pose table, raised with the ground), then yaw through 0 → 2π in 16 steps at pitch 0.6 and at 0.9. Bar: no card reads as a plane at the feet; nothing appears or vanishes between consecutive stills.
5. Zero console errors on every page.

Append `## 4. Step 1: the near cards` to the note: the fullness table (control and branch side by side), the isolation table, the frame table (per round and order, mean delta, same-code delta, native p95), the look verdict per pose, the walk. If both poses meet the bar, the remaining steps are not taken: go to Task 6. If the frame bar misses, the design's §9 fallbacks in order, each its own commit with its test literals, re-measured.

```bash
git add docs/rendering/2026-09-25-near-grass-fullness-verification.md
git commit -F - <<'EOF'
docs: gate the near cards under the blades at both poses

## What

The fullness, layer isolation, frame pairs and walk for step 1, against
main at the two poses.

## How

- `docs/rendering/2026-09-25-near-grass-fullness-verification.md` — §4.

<trailers>
EOF
```

---

### Task 3: Step 2 — darken the ground under the sward

Taken only if Task 2's gate missed the bar at either pose.

**Files:**
- Modify: `client/src/game/groundHexParams.ts` (constants and `swardWeight`, beside `TUFT_ALBEDO`/`HORIZON`)
- Modify: `client/src/game/clipmap.ts` (`RingSamples.cover`, `RingGeometry.cover`; `sampleInto`, `createRingSamples`, `updateRingSamples`, `ringGeometry`)
- Modify: `client/src/game/renderer.ts` (the upload beside `terrainWeights2`, line 218)
- Modify: `client/src/game/terrainTexture.ts` (vertex and fragment declarations, `TERRAIN_VERTEX_MAIN_END`, `getAttributes`, the UBO list, the non-UBO string, `bindForSubMesh`, `TERRAIN_FRAGMENT_BLEND`)
- Modify: `ARCHITECTURE.md` (the grass-floor sentence)
- Test: `client/test/game/groundHexParams.test.ts`, `client/test/game/clipmap.test.ts`, `client/test/game/terrainTexture.test.ts`

**Interfaces:**
- Consumes: `groundCover(seed, x, z, s)` (already called in `sampleInto`), `smoothstep` in `groundHexParams.ts`.
- Produces: `SWARD_FLOOR: Rgb = (0.05, 0.065, 0.03)`, `SWARD_MAX = 0.6`, `SWARD_COVER = [0.05, 0.5]`, `SWARD_FADE = [12, 18]`, `swardWeight(cover, dist)`; the `terrainCover` vertex attribute (one float, `min(1, grass)`).

- [ ] **Step 1: Write the failing tests**

`client/test/game/groundHexParams.test.ts` — import the five new names and add:

```ts
describe("the sward floor", () => {
  it("pins the thatch colour, the pull and its bands", () => {
    expect(SWARD_FLOOR).toEqual({ r: 0.05, g: 0.065, b: 0.03 });
    expect(SWARD_MAX).toBe(0.6);
    expect(SWARD_COVER).toEqual([0.05, 0.5]);
    // Gone by the blade field's 18 m reach, so the open floor beyond is unchanged.
    expect(SWARD_FADE).toEqual([12, 18]);
  });

  it("pulls by the cover inside the reach and not at all past it", () => {
    expect(swardWeight(1, 5)).toBeCloseTo(0.6, 10);
    expect(swardWeight(0.5, 5)).toBeCloseTo(0.6, 10); // the canopy floor's half sward is full cover
    expect(swardWeight(0.275, 5)).toBeCloseTo(0.3, 10);
    expect(swardWeight(0.05, 5)).toBe(0); // where the blade field stops growing
    expect(swardWeight(0, 5)).toBe(0);
    expect(swardWeight(1, 15)).toBeCloseTo(0.3, 10);
    expect(swardWeight(1, 18)).toBe(0);
    expect(swardWeight(1, 40)).toBe(0);
  });
});
```

`client/test/game/clipmap.test.ts`:

- In `"scrolls to exactly what a fresh build at the new camera produces"`, add `expect(scrolled.cover).toEqual(fresh.cover);`.
- In the `stub` of `"ring nesting"`, add `cover: new Float32Array(0),`.
- In `"emits weights from ringGeometry in the same vertex order as colors"`, add `expect(geo.cover.length).toBe(16641);` and `expect(geo.cover[102 + 4 * 129]).toBe(ring.cover[102 + 4 * 129]);`.
- Add, in the same `describe` as the canopy-density test:

```ts
  it("carries the ground cover's grass, clamped to 1, as the cover channel", () => {
    // The blade field's own strength, min(1, grass): the terrain's sward
    // floor keys on it, not on the grass texture weight, because half a
    // sward stands on floor-textured ground.
    const ring = createRingSamples(SEED, 0, 0, 0);
    expect(ring.cover.length).toBe(16641);
    const cases: [number, number, number][] = [
      [40, 61, 0],
      [102, 4, 0.5],
      [60, 0, 0.3087129490878816],
    ];
    for (const [ix, iz, want] of cases) {
      expect(ring.cover[iz * SIDE + ix], `vertex ${ix},${iz}`).toBeCloseTo(want, 6);
    }
    for (let at = 0; at < SIDE * SIDE; at += 97) {
      const x = ring.originX + (at % SIDE) * ring.spacing;
      const z = ring.originZ + ((at / SIDE) | 0) * ring.spacing;
      const s = elevationSampleAt(SEED, x, z);
      expect(ring.cover[at]).toBeCloseTo(Math.min(1, groundCover(SEED, x, z, s).grass), 6);
    }
  });

  it("clamps the cover at 1 where the field boosts the grass past it", () => {
    // Seed atmo (627994160), an open meadow at (369, -855) where the grass
    // reads 1.5.
    const ring = createRingSamples(627994160, 0, 369, -855);
    const ix = 369 - ring.originX, iz = -855 - ring.originZ;
    expect(ring.cover[iz * SIDE + ix]).toBe(1);
  });
```

`client/test/game/terrainTexture.test.ts`:

- In `"declares both weight attributes and the seven samplers"`, expect `attrs` to contain `"terrainCover"` too.
- Add:

```ts
  it("declares the cover attribute and its varying as floats", () => {
    const plugin = pluginFor("tc");
    const vert = plugin.getCustomCode("vertex")!;
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).toContain("attribute float terrainCover;");
    expect(vert.CUSTOM_VERTEX_DEFINITIONS).toContain("varying float vTerrainCover;");
    expect(vert.CUSTOM_VERTEX_MAIN_END).toContain("vTerrainCover = terrainCover;");
    expect(plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS).toContain("varying float vTerrainCover;");
  });

  it("pulls the sward floor toward the thatch colour after the horizon tint", () => {
    const blend = makePlugin().getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_LIGHTS!;
    const w = "float swardW = terrainSward.w * smoothstep(terrainSwardBand.x, terrainSwardBand.y, vTerrainCover) * (1.0 - smoothstep(terrainSwardBand.z, terrainSwardBand.w, dist));";
    const mix = "surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);";
    expect(blend).toContain(w);
    expect(blend).toContain(mix);
    expect(blend.indexOf("horizonWeight(dist)")).toBeLessThan(blend.indexOf(w));
    expect(blend.indexOf(w)).toBeLessThan(blend.indexOf(mix));
    // The pull keys on the cover, not on the grass texture weight.
    expect(w).not.toContain("w0");
  });

  it("declares and binds the sward uniforms", () => {
    const plugin = makePlugin();
    const names = plugin.getUniforms().ubo.map((u: { name: string }) => u.name);
    expect(names).toEqual(expect.arrayContaining(["terrainSward", "terrainSwardBand"]));
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+vec4\s+terrainSward\s*;/);
    expect(plugin.getUniforms().fragment).toMatch(/uniform\s+vec4\s+terrainSwardBand\s*;/);
    const defs = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!;
    expect(defs).not.toContain("uniform vec4 terrainSward");
    const { writes } = makeBoundPlugin();
    expect(writes.terrainSward).toEqual([0.05, 0.065, 0.03, 0.6]);
    expect(writes.terrainSwardBand).toEqual([0.05, 0.5, 12, 18]);
  });
```

(`makePlugin`, `makeBoundPlugin` are the helpers of the floor `describe`; put the last two tests inside it. `pluginFor` is the file's own helper.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/groundHexParams.test.ts test/game/clipmap.test.ts test/game/terrainTexture.test.ts`
Expected: FAIL — the names are not exported, `ring.cover` is undefined, the attribute, uniforms and GLSL lines are absent.

- [ ] **Step 3: The constants**

`client/src/game/groundHexParams.ts`, after `HORIZON_MAX`:

```ts
/** The sward floor: inside the blade field's reach, ground carrying a sward
 * reads as the shaded thatch between the blades (linear albedo) rather than
 * as bare ground. Dark and green-brown, between the blades' own albedo and
 * the grass floor's. */
export const SWARD_FLOOR: Rgb = { r: 0.05, g: 0.065, b: 0.03 };
/** The pull toward SWARD_FLOOR at full cover. */
export const SWARD_MAX = 0.6;
/** The ground cover (the blade field's strength, min(1, grass)) the pull
 * ramps over: nothing where the field stops growing, full at the canopy
 * floor's half sward. */
export const SWARD_COVER: readonly [number, number] = [0.05, 0.5];
/** Eye distance (m) the pull fades out over: gone by the blade field's
 * reach, so the open floor beyond 18 m is unchanged. */
export const SWARD_FADE: readonly [number, number] = [12, 18];

/** The sward pull at a fragment, mirroring the terrain blend's swardW. */
export function swardWeight(cover: number, dist: number): number {
  return SWARD_MAX * smoothstep(SWARD_COVER[0], SWARD_COVER[1], cover) * (1 - smoothstep(SWARD_FADE[0], SWARD_FADE[1], dist));
}
```

- [ ] **Step 4: The cover channel**

`client/src/game/clipmap.ts`:

- `RingSamples` and `RingGeometry` gain `cover: Float32Array` (one float per vertex): "The ground cover's grass at the vertex, clamped to 1 — the blade field's own strength. The terrain's sward floor keys on it."
- `sampleInto`: `const gc = groundCover(seed, x, z, s); const duff = gc.duff;` in place of the `.duff` call, and `ring.cover[at] = Math.min(1, gc.grass);`.
- `createRingSamples`: `cover: new Float32Array(SIDE * SIDE),`.
- `updateRingSamples`: `const oldCover = ring.cover;`, `ring.cover = new Float32Array(SIDE * SIDE);`, and in the vertex copy `ring.cover[to] = oldCover[from] as number;`.
- `ringGeometry`: `const cover = new Float32Array(SIDE * SIDE);`, `cover[at] = ring.cover[at] as number;` beside the weights, and `cover` in the returned object.

`client/src/game/renderer.ts`, after the `terrainWeights2` upload: `mesh.setVerticesData("terrainCover", geometry.cover, true, 1);`.

- [ ] **Step 5: The shader**

`client/src/game/terrainTexture.ts`:

- `TERRAIN_VERTEX_DEFS`: `attribute float terrainCover;` and `varying float vTerrainCover;` inside the `TERRAINTEX` block.
- `TERRAIN_FRAGMENT_DEFS`: `varying float vTerrainCover;`.
- `TERRAIN_VERTEX_MAIN_END`: `vTerrainCover = terrainCover;`. Extend the comment above it: a ring without the attribute reads 0, so the pull is a no-op there.
- `getAttributes`: `attributes.push("terrainWeights", "terrainWeights2", "terrainCover");`.
- The UBO list, after `terrainTuft`: `{ name: "terrainSward", size: 4, type: "vec4" }` and `{ name: "terrainSwardBand", size: 4, type: "vec4" }`, with a comment: the sward floor's (colour, max) and (cover band, fade band).
- The non-UBO `fragment` string: `uniform vec4 terrainSward;` and `uniform vec4 terrainSwardBand;`.
- `bindForSubMesh`: `uniformBuffer.updateFloat4("terrainSward", SWARD_FLOOR.r, SWARD_FLOOR.g, SWARD_FLOOR.b, SWARD_MAX);` and `uniformBuffer.updateFloat4("terrainSwardBand", SWARD_COVER[0], SWARD_COVER[1], SWARD_FADE[0], SWARD_FADE[1]);`, importing the four constants.
- `TERRAIN_FRAGMENT_BLEND`, directly after `surfaceAlbedo = mix(surfaceAlbedo, terrainTuft, w0 * horizonWeight(dist));`:

```glsl
  // Sward floor: inside the blade field's reach, ground carrying a sward reads
  // as the shaded thatch between the blades, not bare ground. Keyed on the
  // ground cover, not the grass texture weight, which is a mottle.
  float swardW = terrainSward.w * smoothstep(terrainSwardBand.x, terrainSwardBand.y, vTerrainCover) * (1.0 - smoothstep(terrainSwardBand.z, terrainSwardBand.w, dist));
  surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);
```

`ARCHITECTURE.md`: in the grass-floor sentence ("The grass floor is hex-tiled …"), add that inside the blade field's reach it is pulled toward a shaded thatch by the ground cover each terrain vertex carries.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/groundHexParams.test.ts test/game/clipmap.test.ts test/game/terrainTexture.test.ts test/game/shaderHygiene.test.ts test/game/trailPaint.test.ts`
Expected: all pass, including the `NullEngine` compile tests of `terrainTexture.test.ts` (the WebGL2 migration test sees `in float terrainCover;`).

- [ ] **Step 7: Commit**

```bash
git add client/src/game/groundHexParams.ts client/src/game/clipmap.ts client/src/game/renderer.ts client/src/game/terrainTexture.ts ARCHITECTURE.md client/test/game/groundHexParams.test.ts client/test/game/clipmap.test.ts client/test/game/terrainTexture.test.ts
git commit -F - <<'EOF'
feat: shade the ground between the blades as sward

## What

Between the blades the near ground showed the floor's own pale colour,
so the gaps read as bare soil. Inside the blade field's reach, ground
carrying a sward is now pulled toward a dark thatch by the ground
cover's grass, which each terrain vertex carries; past 18 m the floor
is unchanged.

## How

- `client/src/game/groundHexParams.ts` — `SWARD_FLOOR` (0.05, 0.065,
  0.03), `SWARD_MAX` 0.6, `SWARD_COVER` [0.05, 0.5], `SWARD_FADE`
  [12, 18], and the `swardWeight` mirror.
- `client/src/game/clipmap.ts`, `renderer.ts` — a per-vertex cover
  channel, min(1, grass), sampled, scrolled and uploaded as
  `terrainCover`.
- `client/src/game/terrainTexture.ts` — the attribute, two uniforms and
  one mix after the horizon tint.
- `client/test/game/*.test.ts` — the constants, the channel at literal
  vertices, the GLSL lines and the bound values.

<trailers>
EOF
```

- [ ] **Step 8: Gate**

Task 2 Step 6's gate, on this commit against the control, plus:

- The floor-look bed/beside ratio at `meadow-trail-along` (`__fcSet(258, 85.7, 120, 1.6, 0.15)`, crops `160:120:520:1280` / `160:120:120:1280`) and `trail-down` (`__fcSet(283, 85.7, 134, 0.6, 0.55)`, crops `260:110:70:1450` / `260:110:60:1250`), seed `atmo`, `weather clear`, `time 12`, control and branch. Reported against the 0.9–1.3 window. If a ratio that was inside leaves it: `SWARD_COVER[0]` 0.05 → 0.3, its own commit, re-measured.
- If the luminance ratio falls under 0.8: `SWARD_MAX` 0.6 → 0.4; if the pull reads too weak by eye and the cover still misses: → 0.8. Each its own commit with the literals, re-measured, two moves at most.

Append `## 5. Step 2: the sward floor` and commit the note alone, as in Task 2. If both poses meet the bar, go to Task 6.

---

### Task 4: Step 3 — close the 8–18 m stretch

Taken only if the bar is still missed after Task 3 (or after Task 2, if Task 3 was not needed for the pose that missed).

**Files:**
- Modify: `client/src/game/clutterField.ts` (`CLUTTER_BLADE_HANDOFF` and its comment)
- Modify (4B, conditional): `client/src/game/bladeClump.ts` (`BLADE_TIER_COUNTS`, `BLADE_VERTEX_BUDGET`)
- Test: `client/test/game/clutterField.test.ts`, `client/test/game/clutterMeshes.test.ts`, (4B) `client/test/game/bladeClump.test.ts`

**Interfaces:**
- Consumes: `clutterSeamEdges`, `bladeTierBands` (the coarse tier's out-band is the meadow seam; `bladeField.test.ts` asserts it and needs no change).
- Produces: the meadow seam [13.5, 18] at radius scale 1, [6.557359312880715, 10.8] at 0.6.

- [ ] **Step 1 (4A): Write the failing tests**

`client/test/game/clutterField.test.ts`, in the seam test, after the existing meadow assertions:

```ts
    // The blade hand-off: the coarse tier stands at full strength from 8 m
    // and collapses over the same band the far cards dither in over.
    expect(CLUTTER_BLADE_HANDOFF).toBe(4.5);
    expect(meadow.start).toBeCloseTo(13.5, 9);
    // The low tier (radius scale 0.6) draws no blades: its meadow seam sits
    // at the jitter-width floor every other class's does.
    expect(meadowLow.start).toBeCloseTo(6.557359312880715, 9);
    expect(meadowLow.end).toBeCloseTo(10.8, 9);
```

Delete the line `expect(meadowLow.start).toBeCloseTo(meadowLow.end - CLUTTER_BLADE_HANDOFF * 0.6, 9);` — at 0.6 the jitter floor binds, not the handoff.

`client/test/game/clutterMeshes.test.ts`, in `"keeps every meadow near card under the blade field…"`: `[1, 2.5, 8, 18]` → `[1, 2.5, 13.5, 18]` and `[-2, -1, 8, 18]` → `[-2, -1, 13.5, 18]`.

- [ ] **Step 2 (4A): Run to verify they fail**

Run: `cd client && npx vitest run test/game/clutterField.test.ts test/game/clutterMeshes.test.ts`
Expected: FAIL on the handoff literal and the seam starts.

- [ ] **Step 3 (4A): Narrow the hand-off**

`client/src/game/clutterField.ts`: `export const CLUTTER_BLADE_HANDOFF = 4.5;`, the comment rewritten: the blades' coarse tier collapses and the far cards dither in across this band; ten metres was needed while blades and cards were different pictures of grass swapping at the seam, and read as a line at 4 m; with the meadow's near cards under the blades the card layer is continuous across the seam and only the blades thin out over it, so the band is the blade-field design's [13.5, 18] and the coarse tier stands at full strength over 8–13.5 m.

- [ ] **Step 4 (4A): Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/clutterField.test.ts test/game/clutterMeshes.test.ts test/game/bladeField.test.ts test/game/bladeClump.test.ts`
Expected: all pass; `bladeClump.test.ts`'s budget test is unchanged (its rings do not read the seam start).

- [ ] **Step 5 (4A): Commit**

```bash
git add client/src/game/clutterField.ts client/test/game/clutterField.test.ts client/test/game/clutterMeshes.test.ts
git commit -F - <<'EOF'
feat: give the coarse blade tier a full-strength stretch

## What

The meadow seam opened to [8, 18] m, so the coarse blades began
collapsing at 8 m, the moment they had grown in, while the far cards
were still dithering in: from 8 to 18 m neither layer stood at full
strength. With the near cards now continuous under the blades the wide
band has nothing left to hide, and it returns to [13.5, 18].

## How

- `client/src/game/clutterField.ts` — `CLUTTER_BLADE_HANDOFF` 10 → 4.5;
  the low tier's seam sits at the jitter floor, [6.56, 10.8].
- `client/test/game/clutterField.test.ts`, `clutterMeshes.test.ts` —
  the seam literals.

<trailers>
EOF
```

- [ ] **Step 6 (4A): Gate**

Task 2 Step 6's gate, plus three stills 1.5 m apart across 13.5–18 m at the meadow pose's heading (`__fcSet(369, 51.01, -855 + d, 0, 0.1)`, d = 0, 1.5, 3, the eye raised with the ground): no line, no density step. Append `## 6. Step 3: the hand-off` and commit the note alone. If both poses meet the bar, go to Task 6; else 4B.

- [ ] **Step 7 (4B, conditional): Write the failing tests**

`client/test/game/bladeClump.test.ts`, in `"match the spec"`:

```ts
    expect(BLADE_TIER_COUNTS.high).toEqual([[100, 40, 16], [80, 28, 12], [12, 8, 4], [100, 32, 12]]);
    expect(BLADE_TIER_COUNTS.medium).toEqual([[50, 20, 8], [40, 14, 6], [6, 4, 2], [50, 16, 6]]);
```

and in `"keeps the high tier's field under the vertex budget with every cell at full size"`, before the two existing assertions:

```ts
    expect(BLADE_VERTEX_BUDGET).toBe(1_900_000);
    // The three padded rings' clumps (fine, mid, coarse) at the full size.
    expect(Math.round(total)).toBe(1_848_587);
```

- [ ] **Step 8 (4B): Run to verify they fail** — `cd client && npx vitest run test/game/bladeClump.test.ts`: FAIL on the table, the budget and the total.

- [ ] **Step 9 (4B): Restore the counts**

`client/src/game/bladeClump.ts`: the coarse column high `[.., .., 16]`, `[.., .., 12]`, `[.., .., 4]`, `[.., .., 12]`, medium 8/6/2/6; `BLADE_VERTEX_BUDGET = 1_900_000`, its comment updated: the worst case is 1,848,587 vertices with the coarse tier at 16, and the frame bar of this design is what admits it.

Run: `cd client && npx vitest run test/game/bladeClump.test.ts test/game/bladeMeshes.test.ts test/game/bladeField.test.ts` — all pass. Commit (`feat: restore the coarse blade tier's counts`, the usual body and trailers; `bladeClump.ts` and its test only).

- [ ] **Step 10 (4B): Gate**

Task 2 Step 6's gate. If the frame bar misses: 13/10/4/10 (medium 6/5/2/5), budget 1,750,000, total literal 1,712,877, its own commit, re-measured; if that misses too, revert to 10/8/4/8 and 1,600,000 and record it. Append `## 7. Step 3: the coarse counts`; commit the note alone. If both poses meet the bar, go to Task 6.

---

### Task 5: Step 4 — lift the blades' colour (conditional)

Taken only if, after Task 4, a pose misses on the **luminance** ratio or the look verdict reads the near field as a different material from the mid. A cover miss alone is not this step's: a lighter blade crosses the cover threshold less often. Record a cover miss in Task 6 with the isolation that explains it.

**Files:**
- Modify: `client/src/game/bladeClump.ts` (`BLADE_ALBEDO` and its comment)
- Test: `client/test/game/bladeClump.test.ts`

- [ ] **Step 1: Write the failing test** — in `"match the spec"`: `expect(BLADE_ALBEDO).toEqual({ r: 0.16, g: 0.21, b: 0.065 });`.
- [ ] **Step 2: Run to verify it fails** — `cd client && npx vitest run test/game/bladeClump.test.ts`.
- [ ] **Step 3: Implement** — `BLADE_ALBEDO = { r: 0.16, g: 0.21, b: 0.065 }`; the comment says the near-black was chosen so the blades matched the far cards across the hand-off, and with the cards under the blades all the way in they can read as lit grass over a shaded sward.
- [ ] **Step 4: Run** — `bladeClump`, `bladeMeshes` tests pass. Commit (`feat: lift the blades to a lit green over the sward`, `bladeClump.ts` and its test only).
- [ ] **Step 5: Gate** — Task 2 Step 6's gate with the thresholds unchanged, plus the colour match of the blade-field verification §3 re-run: at both poses under `weather clear` and under `weather mist`, the near and mid crops' mean linear RGB and green-channel ratio, reported; bar, by eye, the 13.5–18 m band reads as one material with no line in both weathers. The step is kept only if the fullness bar holds; otherwise revert it and record why. Append `## 8. Step 4: the blade colour`; commit the note alone.

---

### Task 6: Close the verification note and the design

**Files:**
- Modify: `docs/rendering/2026-09-25-near-grass-fullness-verification.md`
- Modify: `docs/rendering/2026-09-25-near-grass-fullness-design.md` (the "As built" paragraph only)

- [ ] **Step 1: The last frame round** — TRAILSIDE (`__fcSet(263.9, 85.77, 118, 0.6, 0.25)`, `weather mist`, `time 12`), high, 4× pixels, by the method of Task 2 Step 6, for continuity with the blade-field and floor-look notes.
- [ ] **Step 2: The summary** — a closing section: the fullness table across the control and every gate taken, per pose; which steps shipped with which values; the frame deltas; the look and the walk; and, if a pose still misses, what the isolation says fills its near crop and why no step here closes it (the canopy's half sward is the sim's rule, design §10).
- [ ] **Step 3: The design's opening** — rewrite the **As built** paragraph to say which steps shipped, with their constants, and link the note; leave the rest of the design as written.
- [ ] **Step 4: Checks and commit**

Run: `npx vitest run --root tools` (the doc-name test) and `git status --porcelain` (no measurement patch left).

```bash
git add docs/rendering/2026-09-25-near-grass-fullness-verification.md docs/rendering/2026-09-25-near-grass-fullness-design.md
git commit -F - <<'EOF'
docs: say what the near grass work shipped and measured

## What

The near-grass gates closed: which of the four steps were taken, the
fullness at both poses against main, the frame cost and the walk.

## How

- `docs/rendering/2026-09-25-near-grass-fullness-verification.md` — the
  summary and the last frame round.
- `docs/rendering/2026-09-25-near-grass-fullness-design.md` — the
  as-built paragraph.

<trailers>
EOF
```
