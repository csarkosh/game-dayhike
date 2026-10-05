# Grass frame reclaim: verification

What is measured against the grass frame reclaim design's gates
([`2026-09-26-grass-frame-reclaim-design.md`](2026-09-26-grass-frame-reclaim-design.md),
§12), how, and what the numbers were. This note starts with the baseline: the
method, the poses and crops, and the canopy profile's figures pinned as
literals. Each step's gate appends a section.

## 1. Method

**Builds.** Two checkouts on two ports, each serving its own build: the branch,
and a control detached at `main` as it ships, `0b957a6` (the near-grass work
merged; its rendering is that work's fourth-gate build A). The near-grass
measurement patches are applied to both for a gate and reverted after it; they
are never committed:

- a pose patch to `client/src/app.ts` and `client/src/game/renderer.ts` that
  exposes `__fcSet(x, y, z, yaw, pitch)`, pinning the free camera at a pose
  every frame (positive pitch looks down), and `__scene` / `__engine` for the
  layer isolation, the in-page profile and the frame timing;
- a tier patch to `client/src/app.ts` that reads `?tier=low|medium|high`,
  because a desktop browser reports at most 8 GB of device memory and detection
  alone lands on medium;
- the dev server's port in `client/vite.config.ts`, one per checkout.

**Page.** `/dayhike/game/<fresh uuid>?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=high`,
in a browser window of 1200 × 2029 CSS pixels at device pixel ratio 1 (the
engine renders 1200 × 2029; "4×" below is hardware scaling 0.5, 2400 × 4058).
The page is given 20 s to load, the pose is set, and the still is taken 8 s
later. Every game page is closed before the next one opens.

**Stills and isolation**, as the near-grass verification's §1: a PNG of the full
frame, then three more on the same page, each 1.5 s after hiding layers by
`mesh.isVisible = false`:

| still | hidden |
| --- | --- |
| all | nothing |
| no blades | `/^blade_clumps/` |
| no cards | `/^LOD\|^clutter\.grass\|^clutter\.meadow/` |
| bare ground | `/^blade_clumps\|^duff_clumps\|^LOD\|^clutter\./` |

**Measure.** Each pixel decoded from sRGB to linear and reduced to luminance
`0.2126 R + 0.7152 G + 0.0722 B`; per crop the **mean** and the **cover
fraction**, the share of pixels below the pose's threshold (§2). The script is
kept outside the repository beside the stills.

**Fullness bar** (design §12.1), after every step: cover ratio (near cover over
mid cover) ≥ 0.62 at the canopy pose and ≥ 0.94 at the meadow pose; canopy near
cover ≥ 0.45; near/mid luminance ratio in 0.8–1.25 at both.

**Frame: the pair method** (design §12.3, the near-grass method unchanged). One
browser start per round; a discarded warm-up page; the two builds on fresh
pages in alternating order, at least two rounds each way; same-code rounds for
the noise floor, repeated if over 0.5 ms; only **quiet** rounds read, every page
within 0.5 ms of its build's lowest mean at that pose. Per page: the pose, 3 s
to settle, 8 s of `onAfterRenderObservable` intervals, mean and p95. The bar
reads the order-averaged delta, branch minus control, at the canopy pose at
native pixels; the 4× delta, the meadow pose, a 1920 × 1080 window, the draw
calls and the JS frame time are reported beside it.

**Attribution: the toggle method** (design §4.4). The pair method measures a
build against a build; it cannot say which layer a millisecond belongs to. An
in-page profiler does, on one page:

- per frame: the frame interval (`onAfterRenderObservable`); the JS time from
  `engine.onBeginFrameObservable` to `onEndFrameObservable`; the active-mesh
  evaluation and draw-phase times (the scene's before/after observables); the
  draw calls; a GPU timer query around the frame;
- each condition toggled on and off every 1.5 s for six cycles (eight in a
  long-page run), alternating which state goes first, 0.4 s of settling before
  each 1.5 s window; three conditions per page; a fresh browser and a discarded
  warm-up page before each page; 60 s of rest between pages;
- a condition's figure is the mean of its "on" windows less the mean of its
  "off" windows, with the standard error of the paired differences;
- a figure is **reliable** when its "off" frame sits near the build's floor
  (native: control 22.4 ms, near-grass tip 24.0; 4×: 53.3 and 54.8) and its
  error is ≤ 0.3 ms.

The conditions: **hide** a layer (`isVisible = false` on its thin-instanced
meshes: meadow near `^LOD1\.near$`, meadow far `^LOD1$`, blades
`^blade_clumps`, grass class `^clutter\.grass`, litter `^duff_clumps`), and
**filter** a layer to the frustum: each mesh's matrix and per-instance
attribute buffers (`foliage`, and `fadeBands` or `bladeStrength`) rewritten to
the instances whose translation, as a 0.75 m sphere, lies inside every one of
`scene.frustumPlanes`, in their order, with the count set to them; the
originals restored when the condition turns off. This is design §5.2's
mechanism done once on the page, with the exact frustum and no margin.

**Caveats**, carried into every gate:

- **The GPU timer is a sign only.** `EXT_disjoint_timer_query_webgl2` is
  present (Chrome, ANGLE on Metal) but reads about twice the frame interval on
  this driver (about 44 ms at a 23.5 ms frame). Its deltas track the frame's at
  a steady 2 : 1, so it says the GPU moved when the frame moves and the JS time
  does not; it is never read as a GPU time.
- **4× figures only from short, rested pages.** Under sustained load at 4× the
  machine drifts: one page's base went from 54 to 96 ms, and base / condition /
  base triples showed a systematic 2 ms gap between their two bases. A 4×
  figure is read only from a short page, after rest, whose "off" frame is
  within 0.3 ms of the build's floor.

## 2. Poses and crops

Seed `atmo` (627994160), `weather mist`, `time 12`, high tier; the eye is the
ground plus 1.6 m. The poses are the near-grass verification's §2:

| pose | camera | ground in view |
| --- | --- | --- |
| canopy | `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` | in the sward under a closed canopy (canopy 1.0, grass 0.94), 2.5 m left of a trail, looking along it (+X) |
| meadow | `__fcSet(369, 51.01, -855, 0, 0.3)` | open meadow looking +Z (grass 1.5) |

Crops are `W:H:X:Y` in the 1200 × 2029 still, placed by projecting the ground
distance through the camera (vertical field of view 1.4 rad, pitch 0.3, the
ground's height read from the simulation along each ray) and checked by drawing
each rectangle back onto the still. The threshold is the near-grass control's
mid-crop median, fixed for every build.

| pose | near crop (≈ 2–6 m) | mid crop (≈ 18–26 m) | far crop (≈ 30–38 m) | threshold |
| --- | --- | --- | --- | --- |
| canopy | `280:500:420:970` | `220:22:400:678` | none (below) | 0.02058 |
| meadow | `360:500:420:980` | `240:22:480:740` | `240:16:480:708` | 0.02853 |

**The far crop** (design §4.2) is new, for step 2, which changes the ground past
24 m. At the meadow pose the projection puts 30 m at rows 724–726 and 38 m at
rows 702–710 across columns 480–720; the rectangle, as wide as the mid crop and
centred on it, spans rows 708–723 (30.1–38.7 m by the projection), and drawn
back onto the still it lies on the far edge of the card field, clear of trunks
and props, with the mist-lit ground above it.

**At the canopy pose there is no far crop.** The ground rises ahead of the eye
to a crest 22–27 m out and falls away behind it: the projection finds no ground
past 27.4 m anywhere in the still (columns 0–1180), and above the mid crop the
still shows trunks against mist. Step 2's check at the canopy pose is therefore
design §6.5's rule on the mid crop (its mean moved by less than 1 %), not a far
crop.

## 3. Control and profile

### 3.1 Fullness

Measured 2026-09-26 on the control, `main` at `0b957a6`, one page per pose,
zero console errors; against the references it is held to (near-grass
verification §7.1 and §8, build A):

| pose | build | near mean | mid mean | lum ratio | near cover | mid cover | cover ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| canopy | reference | 0.0222 | 0.0178 | 1.25 (1.248) | 0.459 | 0.734 | 0.62 (0.625) |
| canopy | `0b957a6` | 0.0222 | 0.0178 | 1.25 (1.247) | 0.453 | 0.732 | **0.62** (0.619) |
| meadow | reference | 0.0284 | 0.0296 | 0.96 | 0.472 | 0.503 | 0.94 (0.939) |
| meadow | `0b957a6` | 0.0284 | 0.0295 | 0.96 (0.962) | 0.473 | 0.506 | **0.94** (0.935) |

The control reproduces the references to within 0.01 in every figure: the work
`main` merged beside the near grass after build A (the watcher, the Hollow's
fork cut) does not move them. The gates read the fresh figures as the control.

**Layer isolation** on the control, with the far crop:

| pose | layers drawn | near mean | near cover | mid mean | mid cover | far mean | far cover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| canopy | all | 0.0222 | 0.453 | 0.0178 | 0.732 | — | — |
| canopy | no blades | 0.0261 | 0.301 | 0.0180 | 0.730 | — | — |
| canopy | no cards | 0.0263 | 0.277 | 0.0631 | 0.010 | — | — |
| canopy | bare ground | 0.0342 | 0.000 | 0.0703 | 0.000 | — | — |
| meadow | all | 0.0284 | 0.473 | 0.0295 | 0.506 | 0.0621 | 0.030 |
| meadow | no blades | 0.0291 | 0.370 | 0.0297 | 0.489 | 0.0616 | 0.037 |
| meadow | no cards | 0.0328 | 0.251 | 0.0743 | 0.000 | 0.0878 | 0.000 |
| meadow | bare ground | 0.0368 | 0.012 | 0.0753 | 0.000 | 0.0897 | 0.000 |

The far crop at the meadow pose is mostly lit ground under the last cards: the
cards take its mean from 0.088 to 0.062 and leave 3 % of it below the threshold
(build A's stills give 0.0620 and 0.032). Step 2 is held to that mean within
±10 % and that cover within ±0.05 (design §6.6).

### 3.2 Where the frame goes

The in-page profile of the canopy pose, high tier, on the near-grass tip
(build A) against the control before it (`9c97483`), by the toggle method of
§1. Its raw figures, as pinned by design §3–§4.

**JS and GPU.**

| build, scale | frame (ms) | JS per frame | active-mesh evaluation | draw phase (JS) | draw calls |
| --- | --- | --- | --- | --- | --- |
| control, native | 22.4 | 2.7 | 0.45 | 1.3 | 160 |
| tip, native | 24.0 | 3.8 | 0.64 | 1.7 | 162 |
| control, 4× | 53.2 | 4.6 | 0.77 | 1.9 | 160 |
| tip, 4× | 54.8 | 4.6–5.1 | 0.8 | 2.0–2.3 | 160–164 |

The frame is GPU-bound: JS is 3–5 ms of a 22–55 ms frame, and no condition
moved it by more than its noise. The tip's one or two extra draw calls are the
`LOD1.near` bucket. The +1.35 ms at 4× and +1.23 ms at native (near-grass
verification §7.5) are GPU time.

**What is drawn**, per frame at the pose (tip / control):

| layer | meshes | vertices per instance | instances | instance vertices |
| --- | --- | --- | --- | --- |
| meadow near cards (`LOD1.near`) | 1 | 20 | 2,674 / 0 | 53,480 / 0 |
| meadow far cards (`LOD1`) | 1 | 20 | 8,719 / 4,619 | 174,380 / 92,380 |
| blade clumps (`blade_clumps*`) | 20 live of 36 | 28–784 | 6,131 / 6,119 | 796,159 / 783,153 |
| grass-class cards (`clutter.grass_{a,b}`, LOD0 and LOD1) | 4 | 330 / 410 near, 172 / 221 far | 4,559 / 2,501 | 1,058,800 / 578,657 |
| litter (`duff_clumps*`) | 6 | — | 2,483 / 2,483 | 275,898 / 275,898 |

`scene.getActiveIndices()` is 18.26 M on the tip and 16.94 M on the control.
Every one of these meshes is `alwaysSelectAsActiveMesh`, so none is
frustum-culled, even as a whole.

**What the camera cannot see**, each instance's translation as a 0.75 m sphere
against `scene.frustumPlanes`, on the tip:

| layer | instances | outside the frustum | behind the camera |
| --- | --- | --- | --- |
| meadow cards (near + far) | 11,393 | 9,850 (86 %) | 5,447 (48 %) |
| blades | 6,131 | 5,068 (83 %) | 2,681 (44 %) |
| grass class | 4,559 | 3,872 (85 %) | 2,274 (50 %) |

**By layer**, the frame delta when the layer is hidden or filtered (ms;
reliable in bold; a second figure is the long-page run):

| condition | tip, native | tip, 4× | control, native | control, 4× |
| --- | --- | --- | --- | --- |
| hide meadow near cards | **−0.30 ± 0.13**; −0.53 ± 0.04 | −2.07 ± 0.37 (noisy) | −0.04 ± 0.03 | +0.21 ± 0.36 |
| hide meadow far cards | **−0.44 ± 0.05**; −0.40 ± 0.06 | −3.12 ± 0.99 (noisy) | −0.25 ± 0.26 | **−0.96 ± 0.12** |
| hide blades | **−1.36 ± 0.20**; −1.44 ± 0.17 | −1.65 ± 1.58, −2.63 ± 0.89 (noisy) | +0.02 ± 0.61 (noisy) | −0.56 ± 0.20 |
| hide grass-class cards | **−0.52 ± 0.12** | **−0.51 ± 0.09** | **−0.20 ± 0.05** | −0.72 ± 0.46 |
| hide litter | −0.45 ± 0.56 (noisy) | −0.27 ± 0.18 | **−0.20 ± 0.07** | +1.76 ± 0.58 (noisy) |
| filter meadow cards | +0.47 ± 0.25 (lifted base) | **−0.06 ± 0.09** | — | — |
| filter blades | ± 1 (noisy) | −1.37 ± 0.26 (lifted base) | — | — |
| filter grass-class cards | −1.00 ± 0.66 (noisy) | −1.83 ± 1.47 (noisy) | — | — |
| filter all three | **−0.82 ± 0.14** | −0.51 ± 0.42 | — | — |

**Read.**

- **Per instance, not per pixel.** The grass-class cards cost 0.52 at native
  and 0.51 at 4×; the pairs give +1.23 at native against +1.35 at 4×.
- **The blades are the largest layer** (1.36 ms at native), then the
  grass-class cards (0.52), the meadow far cards (0.44) and near cards
  (0.30–0.53). Their increments over the control (near +0.4, far +0.2, grass
  class +0.3, blades +0.3–0.8) sum to 1.2–1.7 ms, which agrees with +1.23.
- **Filtering all three layers to the frustum saves 0.82 ± 0.14 ms at
  native**, and the meadow cards' part of it is nothing measurable
  (−0.06 ± 0.09 at 4×). The bar of 0.8 ms is set at that figure.
- Not pinned down, and no step depends on it: the blades' split between vertex
  and fragment work, the foliage plugin's own vertex cost, and the 4× figures for
  filtering the blades and the grass class separately.

## 4. Confirmation

Measured 2026-09-26 on the control, `main` at `0b957a6`, at the canopy pose,
native pixels, by the toggle method of §1: three pages, three conditions each in
a rotated order, six cycles of 1.5 s windows, a discarded warm-up page before
each page and 60 s of rest between them. The browser was started once for the
run rather than once per page. Renderer `ANGLE (Apple, ANGLE Metal Renderer:
Apple M4, Unspecified Version)`, as every earlier gate; the engine rendered
1200 × 2029; zero console errors.

| condition | page 1 | page 2 | page 3 | mean | profile | inside the band |
| --- | --- | --- | --- | --- | --- | --- |
| hide blades | −1.11 ± 0.04 | −1.35 ± 0.16 | −1.14 ± 0.03 | **−1.20** | −1.36 ± 0.20 | yes, at its edge |
| hide grass-class cards | −0.42 ± 0.04 | −0.44 ± 0.04 | −0.42 ± 0.04 | **−0.43** | −0.52 ± 0.12 | yes |
| filter all three | −0.67 ± 0.09 | −0.51 ± 0.06 | −0.57 ± 0.09 | **−0.58** | −0.82 ± 0.14 | no: 0.10 short of it |

The same pages, the "off" windows:

| | mean | range |
| --- | --- | --- |
| frame (ms) | 23.59 | 23.48–23.79 |
| p95 (ms) | 25.8 | 25.6–26.2 |
| JS per frame (ms) | 4.14 | 3.82–4.38 |
| active-mesh evaluation (ms) | 0.68 | 0.61–0.75 |
| draw phase, JS (ms) | 1.68 | 1.45–1.93 |
| draw calls | 164 | 160–166 |
| GPU timer (ms, a sign only) | 43.4 | 43.0–44.0 |

The instance counts are the profile's to the instance: 2,674 near and 8,719 far
meadow cards, 6,131 blade cells, 4,559 grass-class cards, 2,483 litter clumps;
the filter found 9,850, 5,068 and 3,872 of them outside the frustum.

**Read.** The machine runs the pose half a millisecond lower than the profile
did (a floor of 23.5 ms, not 24.0), and every layer's cost is lower with it.
The blades and the grass class sit inside their bands, low. The filter's
saving does not: on three pages it is **0.58 ± 0.08 ms**, against the
profile's 0.82 ± 0.14, within the confirmation run's 0.3 ms tolerance of the band but
outside the band itself on all three. The filter's "on" windows add no JS
(+0.00 to +0.12 ms, inside the pages' noise) and no draw call.

**Design §5.4 redone with it.** Split by the confirmed hide costs (1.20 and
0.43 ms, 74 % and 26 %) and scaled by the share the filter as built culls
(6° and 1.5 m: blades 0.737, grass class 0.809) against the exact frustum's
(0.827 and 0.849):

| layer | share of 0.58 | culled, as built / exact | expected, native |
| --- | --- | --- | --- |
| blades | 0.43 | 0.737 / 0.827 | 0.38 |
| grass class | 0.15 | 0.809 / 0.849 | 0.14 |
| together | 0.58 ± 0.08 | | **0.52** (0.45–0.59) |

Step 1a alone is expected to fall about 0.3 ms short of the 0.8 ms bar. Its
gate measures it; what can close the rest is step 1b (the meadow's buckets, if
worth 0.15 ms) and step 2's far trim.

## 5. First gate: the frustum prefix

Measured 2026-09-26: the branch at `418e755` against the control, `main` at
`0b957a6`, by §1's method. The branch builds step 1a with its as-built
constants: the blade field's 36 buckets and the grass class's 4 draw each frame
the prefix of their collected instances inside the camera's frustum widened by
6° and pushed back 1 m, each instance a 1.5 m sphere, refiltered when the view
turns 4° or moves 0.5 m; the meadow's buckets are untouched. The branch was
served from a checkout of that commit with §1's patches and one more, for the
gate only: `__cull(on)`, which hands both shells `null` (the whole collected
set) when off, and a timer around every filter pass. Renderer as §4; zero
console errors on every page. The browser was started once for the gate, not
once per round; every round still opened with a discarded warm-up page.

### 5.1 What is drawn

| pose | layer | kept / collected | meshes drawing |
| --- | --- | --- | --- |
| canopy | blades | 1,614 / 6,131 (0.26) | 20 |
| canopy | grass class | 870 / 4,559 (0.19) | 4 |
| meadow | blades | 1,752 / 6,587 (0.27) | 12 |
| meadow | grass class | 891 / 4,731 (0.19) | 4 |

The kept counts are the expected ones to the instance. **Draw calls do not move**: at
the canopy pose 159–163 a frame on both builds, at the meadow pose 201–205 on
both, and 169–172 on both in a 1920 × 1080 window.

### 5.2 Fullness

Two pages per build per pose, the crops and thresholds of §2:

| pose | build | near cover | mid cover | cover ratio | lum ratio | far mean | far cover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| canopy | control | 0.453, 0.458 | 0.732, 0.735 | 0.619, 0.624 | 1.247, 1.249 | — | — |
| canopy | branch | 0.458, 0.458 | 0.740, 0.735 | 0.619, 0.623 | 1.247, 1.249 | — | — |
| meadow | control | 0.473, 0.465 | 0.506, 0.503 | 0.935, 0.923 | 0.962, 0.968 | 0.0621, 0.0621 | 0.030, 0.032 |
| meadow | branch | 0.469, 0.469 | 0.505, 0.510 | 0.930, 0.919 | 0.969, 0.972 | 0.0620, 0.0622 | 0.027, 0.033 |

The branch matches the control within the page-to-page spread at both poses,
in every column; the layer isolation stills agree to 0.01 as well. The meadow's
cover ratio sits at 0.92–0.94 on both builds today: the 0.94 of design §12.1 is
at the top of the control's own spread, and the filter does not move it.

**Invisible culling** (design §12.1). At each still pose, the
filtered and the whole set drawn back to back on one page:

- With the wind held still (`/wind 0`), per 6 × 6 pixel block of mean luma,
  the switch changes 0, 0 and 0 blocks at the canopy pose and 0, 0 and 14 at
  the meadow pose (the last against 12 changed with no switch), in-page and
  frame-matched. By screenshot, the mean absolute difference across the
  switch is 0.47 and 0.54 (×10⁻³) at the canopy pose against 0.51 and 0.55
  between two whole frames, and 0.49 and 0.62 against 0.52 and 0.53 at the
  meadow pose: three of four within 10 %, the fourth +17 % at the grain floor
  with 1 block changed against 2.
- With the weather's wind, the screenshots' differences are the wind's (8–14
  against 8–10); the switch's pair spans more time than the reference pair,
  so the 10 % rule cannot be read there, and the frame-matched in-page
  count is lower across the switch than without it at every still.

### 5.3 Frame

At the canopy pose, native pixels, four pair rounds with 30 s of rest before
each page, all quiet:

| round | first page | second page | delta |
| --- | --- | --- | --- |
| same code | control 24.15 / 26.5 | control 24.16 / 26.6 | +0.01 |
| 1 | control 24.19 / 26.7 | branch 23.76 / 25.6 | −0.43 |
| 2 | branch 23.77 / 25.7 | control 24.20 / 26.4 | −0.43 |
| 3 | control 24.20 / 26.8 | branch 23.74 / 25.9 | −0.46 |
| 4 | branch 23.79 / 26.0 | control 24.13 / 26.3 | −0.34 |

An earlier set of six rounds without the rest read the same: same-code +0.02
(control) and +0.01 (branch), then −0.40, −0.51, −0.63 and −0.45 in its last
four rounds, where both builds sat about 0.7 ms over their same-code floors
(not quiet by the rule, so not read).

| view | same code | control first | branch first | **order-averaged delta** | p95 delta |
| --- | --- | --- | --- | --- | --- |
| canopy, native | +0.01 | −0.43, −0.46 | −0.43, −0.34 | **−0.42** | −0.7 |
| canopy, 4× | +0.05 | −0.34, −0.44 | −0.31, −0.38 | **−0.37** | −0.5 |
| canopy, 1920 × 1080 | — | −0.42, −0.45 | −0.32, −0.35 | **−0.39** | −0.8 |
| meadow, native | +0.04 | −0.92, −1.00 | −0.97 | **−0.96** | −3.1 |
| meadow, 4× | — | −0.52, −0.70 | −0.60, −0.60 | **−0.61** | −0.5 |

The build floors: canopy native 24.13 (control) and 23.74 (branch); canopy 4×
55.12 and 54.78; meadow native 19.18 and 18.23; meadow 4× 48.08 and 47.44;
canopy 1920 × 1080 24.96 and 24.54. One meadow round is not quiet (the branch
page at 21.46 ms with 7.5 ms of JS, another process's load) and is not read.

**The JS frame is unchanged** at a still pose: 4.33 ms (control) and 4.34 ms
(branch) over every canopy page at native, 4.96 and 5.11 at 4×; no pass runs
while the view holds still.

### 5.4 The filter's own JS

Timed around both shells' `cull` on the frames whose pose crossed a threshold,
at the canopy pose with the weather's wind (the page's timer resolves 0.1 ms):

| motion, 10 s | passes per second | median | p95 | max |
| --- | --- | --- | --- | --- |
| turning 90° a second | 17.8 | 0.5 ms | 1.0 | 1.1 |
| turning 3.9° a frame | 23.2 | 0.5 | 0.8 | 1.1 |
| turning 20° a frame | 43.1 (every frame) | 0.5 | 0.8 | 1.1 |
| turning 3.9° a frame at pitch 0.9 | 26.2 | 0.4 | 0.5 | 0.6 |
| walking 1.4 m/s with a 3 cm bob | 2.7 | — | — | 0.5 |
| still | 0.1 | 0.4 | — | — |
| meadow, turning 90° a second | 17.8 | 0.4 | 0.5 | 0.5 |

A pass costs about **0.4–0.5 ms**, twice the 0.1–0.25 ms estimated (design
§5.2): the plane tests and copies of about 10,700 instances and the upload of
the prefix. Averaged over a 90°-a-second turn it is about 0.2 ms a frame; in a
fast turn that refilters every frame, 0.5 ms a frame. On this machine the frame
is GPU-bound (JS 4.3 of 24 ms), so it does not show in the frame; on a machine
whose frame is set by JS it would, while turning, be about the size of the
saving. (The walk's passes were timed through a mirror of the thresholds that a
rebuild's own refilter desynchronises, so its median is not read.)

### 5.5 What culling leaves

The toggle method of §1 on branch pages at the canopy pose, native:

| condition | page 1 | page 2 | control (§4) |
| --- | --- | --- | --- |
| hide blades | −0.94 ± 0.07 (lifted base) | −0.88 ± 0.10 (lifted base) | −1.20 |
| hide grass-class cards | +0.23 ± 0.13 (noisy) | **−0.11 ± 0.02** | −0.43 |
| filter the meadow's cards | −0.05 ± 0.04 (lifted base) | −0.07 ± 0.14 (lifted base) | — |

The grass class keeps a quarter of its cost; the blades keep three quarters of
theirs. The blades drawn in view carry most of what the blade field costs, and
culling cannot reach them. **The meadow's filter is worth about 0.05 ms**, under
step 1b's 0.15 ms.

### 5.6 Pops

**Method.** On a branch page, with the wind held still so that nothing but the
filter can change what is drawn at a fixed pose, the camera steps through a
sequence; at each step the prefix held is the one cut at the previous step's
pose, so each step is a turn or move just under the thresholds from the last
cut, the worst case. Five frames are grabbed at the step, three with the prefix
held and two with the whole collected set, and each is reduced to 6 × 6 pixel
blocks of mean luma. A block counts as changed when it moves by more than 0.04.
The switch's count (held against whole) is set against the largest count between
two frames of the same state, which carries the grass grain, the motes and the
animals. The filter is switched back on after each step, which cuts at that
step's pose.

**Its sensitivity**, on the control: the blades and the grass class filtered
once to the exact frustum with a 0.75 m sphere (the profile's filter) and held
while the camera turns. At 11.7° a step the switch changes 236 blocks, 122 of
them in the 48-pixel edge bands, against 1 without a switch: a strip of
blades missing at the entering edge. At 7.8° it changes 29 edge blocks against
20. At 3.9° the exact filter shows nothing measurable at this pose.

**On the branch** (steps, switch count against the same-state count, edge
bands in brackets):

| pose | sequence | steps | switch | same state |
| --- | --- | --- | --- | --- |
| canopy | full turn right, 3.9° steps, pitch 0.3 | 92 | 178 (4) | 245 (16) |
| canopy | full turn right, 3.9° steps, pitch 0.9 | 92 | 208 (0) | 72 (3) |
| canopy | turn left, 3.9° steps | 23 | 261 (24) | 543 (158) |
| canopy | full turn, 20° steps (a refilter each) | 18 | 0 (0) | 1 (0) |
| canopy | pitch −0.4 → 1.2 and back, 3.9° steps | 48 | 328 (71) | 579 (130) |
| canopy | walk 0.49 m steps; walk and turn; walk at pitch 0.9 | 36 | 18 (0) | 67 (1) |
| meadow | full turn, 3.9° steps, pitch 0.3 | 92 | 5,599 (348) | 7,248 (604) |
| meadow | half turn, 3.9° steps, pitch 0.9 | 46 | 478 (85) | 676 (85) |
| meadow | turn left; 20° steps; pitch sweep; walks | 89 | 445 (72) | 588 (125) |
| canopy, the weather's wind | full turn at 0.3, a quarter at 0.9, 20° steps | 133 | 24,295 (3,512) | 31,807 (5,740) |
| meadow, the weather's wind | half turn at 0.3, a quarter at 0.9 | 69 | 2,731 (120) | 3,949 (273) |

In the edge bands the switch changes no more blocks than the same state does in
any sequence, and in the whole frame fewer in every sequence but one. That one,
the canopy's turn at pitch 0.9, owes 202 of its 208 blocks to one step, mid-frame
and away from every edge; read again from screenshots, it is a bird taking off
between the frames. The other steps with an edge count carry the same count at
the same edge between frames of one state: animals and motes, not the filter.
With the weather's wind the switch reads below the same state everywhere, the
wind's motion dominating both.

**Mid-turn stills.** At the canopy pose turned 45° (pitch 0.3) and 135° (pitch
0.9), the branch held 3.9° past its last cut, beside the control at the same
pose, with the weather's wind: the two read the same to the frame edges, the
only differences the wind's.

No pop was found. What the method cannot see is a single blade or card at the
very edge that changes fewer than a few blocks; the positive control puts the
threshold of what it sees near a turn of 8° past an exact cut.

### 5.7 Verdict

| bar | result |
| --- | --- |
| canopy frame at native ≤ −0.8 ms (design §12.3) | **missed**: −0.42 ms |
| canopy frame at 4× (reported) | −0.37 ms |
| canopy frame at 1920 × 1080 (reported; design expected about −0.60) | −0.39 ms |
| meadow frame (reported) | −0.96 ms native, −0.61 ms at 4× |
| fullness: cover ratios, canopy near cover, luminance ratios as the control's | met: every figure within the control's page spread |
| canopy near cover ≥ 0.45 | met: 0.458 |
| draw calls unchanged | met: 159–163 (canopy), 201–205 (meadow) on both |
| JS frame at a still pose | unchanged: 4.33 against 4.34 ms |
| filter pass JS (expected 0.1–0.25 ms) | 0.4–0.5 ms a pass; hidden on this machine |
| no pop at a frame edge | met |
| meadow filter worth ≥ 0.15 ms (step 1b) | not: about 0.05 ms |

**The filter works as built and takes back 0.42 ms at the canopy pose at native,
half the bar.** It is below design §5.4's redone expectation (0.52, §4) by 0.1
ms, and it is invisible. What culling leaves at the pose is the in-view blades
(about 0.9 ms of the 1.2 they cost unculled) and the in-view grass class (about
0.1 ms).

What design §5.4 and §13 name to close the rest, measured against the
0.38 ms still missing:

- **Step 1b, the meadow's buckets:** about 0.05 ms at native (§5.5). Not worth
  its own step by design §5.1's 0.15 ms rule, and not enough to close the gap.
- **Step 2's far trim:** expected about 0.12 ms while the meadow is not
  filtered (design §6.3). With it the frame is expected near −0.55 ms.
- **Narrowed margins** are no longer among the design's closers (§5.4 as
  built: the 1.5 m radius is what keeps a swaying instance in the prefix), and
  the confirmation (§4) puts the whole exact-frustum saving at 0.58 ms: no
  margin setting of this filter reaches 0.8 ms at this pose.

The rest of the bar is not in culling. It is in what the blades in view cost,
which the filter leaves untouched: the bar at 0.8 ms rested on a filter figure
(0.82) that the confirmation measured at 0.58 on this machine.

After this gate the design re-based step 1a's bar on that ceiling (design
§5.10): at least 70 % of the exact-frustum saving at native, with no pop and
no loss of fullness, which the 0.42 ms meets at 72 % (64–84 % on the
ceiling's spread, about 79 % like for like); the "missed" row above is the
gate as run, against the bar it was given. The filter has also changed since,
without changing what a still pose keeps: its pass was rebuilt for speed, and
its planes now turn with the camera's roll with `CULL_TURN` at 3.5° (design
§5.2 and §5.10).
