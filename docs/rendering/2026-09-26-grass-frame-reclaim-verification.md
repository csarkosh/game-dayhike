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
profile's 0.82 ± 0.14, within the plan's 0.3 ms tolerance of the band but
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
