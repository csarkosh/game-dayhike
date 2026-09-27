# Grass frame reclaim: design

**As built.** Step 1a is built and gated, and the bar for it re-based on
what was measured (§5.10); nothing else yet. This is the design as written on 2026-09-26. It
builds on the near-grass work
([2026-09-25-near-grass-fullness-design](2026-09-25-near-grass-fullness-design.md)
and its verification), which merges to `main` before any code here starts;
every "control" below is `main` at that merge. The plan
([2026-09-26-grass-frame-reclaim-plan](2026-09-26-grass-frame-reclaim-plan.md))
builds four steps in order, each behind its own gate, and runs a bounded WebGPU
spike beside them on its own branch. When the work lands, this paragraph is
rewritten to say which steps shipped and with what values; the sections below
stay the design as written.

The near-grass work made the ground under a closed canopy read as a sward, and
paid for it: at the canopy pose the frame is **+1.35 ms** over the control at
four times the pixels and **+1.23 ms** at native pixels (near-grass
verification §7.5). The miss was accepted for that release on the condition
that this design follows. The goal is one sentence: **take back at least
0.8 ms at native pixels at the canopy pose without taking away any of the
fullness it bought.** 0.8 ms is what an in-page profile of the canopy pose
measured when every grass layer was filtered to the frustum (§4.4).

The cost barely changes with the pixel count and grows with the instance
count, so it is per-instance work, not fill (§3.3). Most of that work is spent
on instances the camera cannot see: the profile found about 85 % of the
blades', the grass-class cards' and the meadow cards' instances outside the
frustum. Every clutter and blade bucket is pinned always active, and Babylon
culls a thin-instanced mesh as one unit anyway, so every blade clump in an 18 m
disc and every card in a 40 m disc (and every grass-class card in a 110 m one)
is drawn whatever the view. That is where this design starts, with the blades
and the grass-class cards, where the profile put the cost: drawing each frame
only the prefix of their buffers the camera can see. It then ends the meadow's
far cards where the published grass systems end their geometry, on a terrain
that carries the sward, and spends none of what it saves on new geometry: the
fullness levers it adds (a lean toward the eye, a base that hugs the ground, a
root that matches the floor, alpha that survives the mip chain) are vertex- and
fragment-stage arithmetic on the cards that are already there.

Renderer-only. No `sim/` change, no level-id move, no asset change. The WebGPU
spike is a measured experiment on its own branch; nothing of it ships unless
its go criteria (§9.5) are met, and then only through its own design.

## 1. Decisions

| question | decision |
| --- | --- |
| The bar | At the canopy pose, high tier, native pixels, the frame is at least **0.8 ms** under the near-grass tip by the pair method (§12.3), the profile's measured filter saving; the 4× figure reported beside it; cover ratios not below the near-grass fourth gate's (canopy **0.62**, meadow **0.94**); absolute near cover at the canopy pose ≥ **0.45**; luminance ratio in 0.8–1.25 at both poses; no seam or pop, at a frame edge or anywhere, on the walks (§12.4) |
| Step 1 | **Cull to the frustum, per frame.** 1a: the blade field's 36 buckets and the grass class's 4 keep their collected buffers and draw a prefix filtered to a frustum widened by 5° and pushed back 1 m, refiltered when the camera turns 4° or moves 0.5 m; only the prefix is uploaded; the draw-call count does not move (about 162). Expected **0.78 ms** at native (0.64–0.92), the profile's measured 0.82 less the margins. 1b: the meadow's two buckets the same way, only if measured at ≥ 0.15 ms. 1c: sector meshes (8 octants × rings) as the fallback if the filter's JS shows (§5). As built and measured: §5.10 |
| Step 2 | **The far sward on the terrain.** On the tiers that draw blades the meadow's far cards dither out over **[26, 30] m** (were [28, 40]) and are not collected past 34.24 m. Past 24 m the terrain pulls ground carrying a sward toward a far-sward colour with the cards' own clump mottle, a wind shimmer on the cards' own gust field and a grazing darkening. The mid crop (18–26 m) stays cards |
| Step 3 | **Lean and hug.** The fixed 4 cm `FOLIAGE_TILT` push becomes a rotation away from the eye by `FOLIAGE_LEAN` 0.5 rad × the sine of the eye's elevation over the instance, so a card seen from above faces up and a card near the horizon keeps its silhouette. Card bases follow the ground plane from the instance's own gradient |
| Step 4 | **Colour continuity and alpha coverage.** The card root takes the floor's own colour, sward pull included, over the bottom 35 % of its height; the card's alpha is scaled up with its mip level at run time so a card at 5–8 m keeps the coverage it has at 1 m. No texture file changes |
| WebGPU | A spike on its own branch: a `WebGPUEngine` behind `?engine=webgpu` on the high tier, a compute pass that culls and packs the blade field's clumps into storage-backed instance buffers drawn with `forcedInstanceCount`; go only on ≥ 1.0 ms saved at equal cover and a GLSL plugin path that survives (§9) |
| Upstream | If the spike goes: an upstream proposal to Babylon.js for a mesh-level indirect draw or storage-backed thin instances. A fork only as a last resort, as a small patch set on a pinned `@babylonjs/core` |
| Unchanged | Card models and texture files; the cards' dither, sink and seam; the blade field's geometry, counts and tiers; the low tier; everything under `sim/` |

## 2. Goals and non-goals

**Goals.**

- At least 0.8 ms back at the canopy pose at native pixels, measured against
  the near-grass tip; the 4× figure reported.
- Not one pixel of fullness given up for it: the cover and luminance measures of
  the near-grass work hold at both poses, and the look holds on a walk and a
  turn.
- Where a step adds fullness (steps 3 and 4), it adds it at no measurable frame
  cost.

**Non-goals.**

- Fewer cards or blades. Every reclaim here draws exactly the instances the
  camera can see, or replaces an instance with a picture of it on the ground.
- The forest's buckets, which are pinned always active for the same reason
  (`forestMeshes.ts:234`); a follow-up (§14).
- Shells, octahedral impostors, alpha-to-coverage and a depth pre-pass (§3.5).
- WebGPU as a shipped path. The spike measures; it does not ship.

## 3. Where the frame goes

### 3.1 What is drawn at the canopy pose

At the canopy pose (`__fcSet(123, 110.87, -105.5, 1.571, 0.3)`, near-grass
design §4.1) on the near-grass tip, as the profile inventoried it (instances
per frame, and their vertices; the control's beside them):

| layer | meshes | vertices per instance | instances, tip / control | instance vertices, tip / control |
| --- | --- | --- | --- | --- |
| meadow near cards (LOD1 copy) | 1 | 20 | 2,674 / 0 | 53,480 / 0 |
| meadow far cards (LOD1) | 1 | 20 | 8,719 / 4,619 | 174,380 / 92,380 |
| blade clumps (`blade_clumps*`) | 20 live of 36 | 28–784 | 6,131 / 6,119 | 796,159 / 783,153 |
| grass-class cards (`clutter.grass_{a,b}`, LOD0 and LOD1) | 4 | 330 / 410 near, 172 / 221 far | 4,559 / 2,501 | 1,058,800 / 578,657 |
| litter (`duff_clumps*`) | 6 | — | 2,483 / 2,483 | 275,898 / 275,898 |

The meadow cards are the smallest of the three card-and-blade pools by vertex
count: the grass class's two models (credited in `CREDITS.md`) carry seventeen
to twenty times the vertices of a meadow card, over a 110 m disc, and the blade
clumps up to forty. The meadow is where the near-grass cost was added, but not
where most of the frame is spent (§3.3).

The meadow's far bucket is not an 18–40 m ring. The collector emits every
instance inside the seam band padded by the snap jitter to both buckets
(`clutterField.ts`, the seam duplication), and the meadow seam is [8, 18], so
the far bucket starts at 8 − 4.24 = **3.76 m** and the near bucket runs to
18 + 4.24 = **22.24 m**. Both carry instances their dither discards entirely.

### 3.2 Why all of it is shaded

`prepBucketMesh` (`clutterMeshes.ts:364–375`) sets
`alwaysSelectAsActiveMesh = true` and `doNotSyncBoundingInfo = true` on every
clutter and blade bucket, so Babylon never tests them against the frustum: the
scene's active-mesh pass reads `mesh.alwaysSelectAsActiveMesh ||
mesh.isInFrustum(...)` (`scene.pure.js:3892`). Turning the flag off would not
help a bucket as it stands. A thin-instanced mesh is one unit: "either all thin
instances are drawn (if the mesh is deemed visible) or none are"
([Babylon.js docs, Thin Instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances)),
and a bucket's instances surround the eye, so its one box always holds the
frustum's apex.

Two details of Babylon 9.18 matter for any split:

- A mesh's default `cullingStrategy` is `CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY`
  (`abstractMesh.pure.js:684`), which tests only the sphere around the box. A
  sector's sphere is far looser than its box; §5.7 sets the standard strategy
  (sphere, then box).
- `thinInstanceRefreshBoundingInfo` transforms the model box's eight corners by
  every instance matrix (`thinInstanceMesh.pure.js:375–414`). A sector's box is
  cheaper to build from the instance origins the rebuild already writes, and is
  handed to `BoundingInfo.reConstruct` directly.

### 3.3 What the cost follows

The in-repo evidence, all at the canopy pose, high tier (near-grass
verification):

- The near cards on LOD0 cost +1.19 ms at 4× and +1.06 ms at native: the same
  at a quarter of the pixels (§4.5).
- The same cards on LOD1, half the vertices and half the card layers per tuft,
  cost +0.60 ms (§5.4).
- Raising the canopy floor to 0.75 added 1,274 near and 4,100 far meadow cards,
  445 and 1,613 grass-class cards, and taller surviving blades, for +0.60 ms
  (§7.5).
- The dither leaves 466 of 1,400 near cards' worth of pixels at the first gate,
  yet the cost followed the 1,400 (§4.5).

So the cost follows the instances drawn, not the pixels they leave. It does
not follow their vertex count in any simple way: priced by the second item
(0.60 ms for 28,000 vertices), the grass class's million vertices would cost
more than the whole frame.

The in-page profile of the canopy pose (§4.4) settles where it goes:

- **The frame is GPU-bound.** JS is 2.7 ms (control) and 3.8 ms (tip) of a 22.4
  and 24.0 ms frame at native, 4.6–5.1 ms of 53–55 ms at 4×, and no layer's
  removal moved it past its noise. Draw calls are 160 (control) and 162–164
  (tip). The +1.35 ms is GPU time.
- **Per instance, not per pixel.** The grass-class cards cost 0.52 ± 0.12 ms at
  native and 0.51 ± 0.09 at 4×; the pairs give +1.23 against +1.35.
- **By layer**, at native on the tip: blades **1.36 ± 0.20 ms** (1.44 ± 0.17 in a
  second run), grass-class cards **0.52 ± 0.12**, meadow far cards **0.44 ±
  0.05**, meadow near cards **0.30 ± 0.13** (0.53 ± 0.04 in a second run). The
  increments over the control (near +0.4, far +0.2, grass class +0.3, blades
  +0.3–0.8) sum to 1.2–1.7 ms, which agrees with +1.23.
- **The blades are the surprise.** Their vertex count barely moved; at strength
  0.89 about twice as many blades survive the vertex-stage cut and reach the
  rasteriser. The profile could not split their cost between the vertex and
  fragment stages.

### 3.4 How much of it the camera cannot see

Measured by the profile, each instance's matrix against `scene.frustumPlanes`
with a 0.75 m sphere, at the canopy pose in the gate's window:

| layer | instances | outside the frustum | behind the camera |
| --- | --- | --- | --- |
| meadow cards (near + far) | 11,393 | 9,850 (86 %) | 5,447 (48 %) |
| blades | 6,131 | 5,068 (83 %) | 2,681 (44 %) |
| grass class | 4,559 | 3,872 (85 %) | 2,274 (50 %) |

The blades are thin instances per clump mesh, with their own matrix, `foliage`
and `bladeStrength` buffers, so they can be culled per instance exactly as the
cards can. The measured shares agree with a geometric derivation, which also
gives the shares in other views and is what §5's layouts are sized with:
instances spread evenly over each bucket's band, a 1.6 m eye over flat ground, the camera's vertical field of view 1.4 rad
(`renderer.ts:665`), and a card counted as seen if any point of it from the root
to 0.8 m up is inside the frustum.

| window | horizontal field of view | pitch | share of instances in view |
| --- | --- | --- | --- |
| the gate's still, 1200 × 2029 | 53° | 0.3 | 0.14–0.15 |
| the gate's still | 53° | 0.9 (at the feet) | 0.00–0.02 |
| a 16:9 window | 112° | 0.3 | 0.31–0.32 |
| a 16:9 window | 112° | 0.9 | 0.01–0.06 |

Between two thirds and seven eighths of every card is drawn for nothing at a
walking gaze, and nearly all of the far bucket when the player looks down. The
gate's portrait still has a narrow view, so it flatters any culling; the gates
report a landscape window beside it (§12.3).

### 3.5 What is not the lever

- **A vertex-shader reject.** Collapsing an out-of-view instance to a point in
  the vertex stage still pays the invocation and the matrix fetch; a 2025
  report measured "0 difference" from exactly that
  ([three.js forum](https://discourse.threejs.org/t/ideas-on-performing-fast-per-instance-frustum-culling-on-instancedmesh/85156)),
  and this repository's own dither is the same case: the discarded near cards
  cost what the drawn ones did (§3.3).
- **A depth pre-pass.** Babylon's pre-pass reuses the material's full vertex
  shader, doubling the work that is the problem, and in 9.18 writes the whole
  card's depth under alpha test (fixed upstream after 9.18 in
  [PR #18936](https://github.com/BabylonJS/Babylon.js/pull/18936)).
- **Half-resolution foliage.** No measured result in 2023–2026, and vegetation
  is the documented worst case for depth-aware upsampling; nor is the cost
  fill.
- **Fewer or coarser cards.** The near-grass second gate already took LOD1 and
  gave a quarter of the cards' near cover for it; this design does not go
  further down that road.

## 4. The measure, the poses and the control

### 4.1 Unchanged from near-grass

The poses, the page, the stills, the layer isolation, the crops, the
thresholds and the arithmetic are the near-grass verification's §1–§2, unchanged:

| pose | camera | near crop | mid crop | threshold |
| --- | --- | --- | --- | --- |
| canopy | `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` | `280:500:420:970` | `220:22:400:678` | 0.02058 |
| meadow | `__fcSet(369, 51.01, -855, 0, 0.3)` | `360:500:420:980` | `240:22:480:740` | 0.02853 |

`?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=high`, 1200 × 2029 at
device pixel ratio 1, the two uncommitted measurement patches (`__fcSet`,
`__scene` / `__engine`, `?tier=`).

The references this design is held to are the near-grass fourth gate's
figures on build A (verification §7.1, §7.6), which the control reproduces:

| pose | near cover | mid cover | cover ratio | lum ratio |
| --- | --- | --- | --- | --- |
| canopy | 0.459 | 0.734 | 0.62 | 1.25 (1.248) |
| meadow | 0.472 | 0.503 | 0.94 | 0.96 |

The canopy's luminance ratio sits on the 1.25 ceiling. A step that darkens the
mid crop without darkening the near crop pushes it out; step 2 is kept away
from the mid crop for that reason as well as for its cover (§6.1).

### 4.2 One new crop

Step 2 changes the ground past 24 m, which neither crop sees. A **far crop**
(ground ≈ 30–38 m) is added at both poses, placed as the others were: the ground
distance projected through the camera, then the rectangle drawn back onto the
still and checked to lie on the sward, clear of trunks and props. Task 1 records
it as a literal beside the others. It carries no bar of its own; step 2's gate
compares it with the control (§6.6).

### 4.3 The control

`main` at the merge of the near-grass work, which is build A of its fourth
gate. Task 1 reproduces the table above to within 0.02 of cover ratio before
anything else is measured.

### 4.4 Attribution on one page: the profile

The pair method (§12.3) measures a build against a build. It cannot say which
layer a millisecond belongs to. An in-page profile of the canopy pose on the
near-grass tip (build A) against the control, at native and 4× pixels, did that,
and its figures are this design's baseline; Task 1 pins them in the
verification note as literals and confirms them with one short-page run rather
than measuring them again.

**Its method.** Each condition toggled on and off every 1.5 s for six cycles
(eight in a long-page run), alternating which state goes first; three
conditions per page; a fresh browser and a discarded warm-up page per page; 60 s
of rest between pages. Frame intervals from `onAfterRenderObservable`; JS time
from `engine.onBeginFrameObservable` to `onEndFrameObservable`; active-mesh and
draw-phase times from the scene's observables; draw calls per frame. A figure is
**reliable** when its "off" frame sits near the build's floor (native: control
22.4 ms, tip 24.0; 4×: 53.3 and 54.8) and its interleaved error is ≤ 0.3 ms.

**Its caveats**, carried into every gate:

- The WebGL2 GPU timer (`EXT_disjoint_timer_query_webgl2`, Chrome, ANGLE on
  Metal) reads about twice the frame interval on this driver. It is a sign that
  the GPU moved, never a GPU time.
- At 4× the machine drifts under sustained load: one page's base went from 54 to
  96 ms, and base/condition/base triples showed a systematic 2 ms gap. Only short
  pages, rested, read; most of the 4× figures below are marked noisy.

**Its figures** (frame delta when the layer is hidden or culled, ms; reliable in
bold):

| condition | tip, native | tip, 4× | control, native | control, 4× |
| --- | --- | --- | --- | --- |
| hide meadow near cards | **−0.30 ± 0.13**; −0.53 ± 0.04 | −2.07 ± 0.37 (noisy) | −0.04 ± 0.03 | +0.21 ± 0.36 |
| hide meadow far cards | **−0.44 ± 0.05**; −0.40 ± 0.06 | −3.12 ± 0.99 (noisy) | −0.25 ± 0.26 | **−0.96 ± 0.12** |
| hide blades | **−1.36 ± 0.20**; −1.44 ± 0.17 | −1.65 ± 1.58, −2.63 ± 0.89 (noisy) | +0.02 ± 0.61 (noisy) | −0.56 ± 0.20 |
| hide grass-class cards | **−0.52 ± 0.12** | **−0.51 ± 0.09** | **−0.20 ± 0.05** | −0.72 ± 0.46 |
| hide litter | −0.45 ± 0.56 (noisy) | −0.27 ± 0.18 | **−0.20 ± 0.07** | +1.76 ± 0.58 (noisy) |
| filter meadow cards to the frustum | +0.47 ± 0.25 (lifted base) | **−0.06 ± 0.09** | — | — |
| filter blades | ± 1 (noisy) | −1.37 ± 0.26 (lifted base) | — | — |
| filter grass-class cards | −1.00 ± 0.66 (noisy) | −1.83 ± 1.47 (noisy) | — | — |
| filter all three | **−0.82 ± 0.14** | −0.51 ± 0.42 | — | — |

The filter is §5.2's mechanism done once on the page: each bucket's
buffers rewritten to its in-view instances and the count set. It is the most
culling can give, and the bar is set at its reliable figure.

The layers the profile toggled, and Task 1's confirmation run toggles:

| layer | meshes |
| --- | --- |
| meadow near | the meadow model's near LOD1 copy (`*.near`) |
| meadow far | the meadow model's LOD1 |
| grass-class near, far | `clutter.grass_a`/`_b` LOD0 and LOD1 |
| flower, bush | their LOD0 and LOD1 |
| blade tiers | `blade_clumps_*_t0`, `_t1`, `_t2` |
| duff | `duff_clumps_*` |

What the profile could not pin down, and no step here depends on: the blades'
split between vertex and fragment work, the foliage plugin's own vertex cost,
and the 4× figures for filtering the blades and the grass class separately.

## 5. Step 1: cull to the frustum

### 5.1 The change, and the order

The profile (§4.4) measured one culling mechanism directly: each layer's
buffers rewritten so that only the instances inside the frustum are drawn,
with the count set to them. Applied to the blades, the grass-class cards and
the meadow cards together it saved **0.82 ± 0.14 ms** at native, the meadow's
part of it nothing measurable (−0.06 ± 0.09 at 4×), and it added no draw call.
That mechanism, done every frame the view moves, is step 1:

1. **Step 1a: the blade field's 36 buckets and the grass class's 4, filtered
   to the frustum** (§5.2). Not conditional.
2. **Step 1b: the meadow's two buckets, by the same filter**, only if Task 2's
   gate, with 1a in, measures the meadow's filter saving at native at
   ≥ 0.15 ms by the profile's toggle method.
3. **Step 1c: sector meshes** (§5.6–§5.9), the fallback, only if the filter's
   JS shows in the gate: the JS frame time growing by more than the native
   frame shrinks.

**Invariant of 1a and 1b: the draw-call count does not move.** The filter
changes what each bucket's buffers hold, never how many meshes there are; the
scene draws 160 calls on the control and 162 on the tip at the gate still
(§3.3), and the gate holds it there (a bucket whose kept prefix is empty is
disabled, which can only lower it).

### 5.2 The filter

**Two buffer sets per bucket.** The rebuild writes what it writes today into
the bucket's **collected** buffers: matrix, `foliage`, and `fadeBands` (cards)
or `bladeStrength` (blades), for every instance the collector returned, in
the collector's order (nearest first for the blades). These stay on the CPU
and are never uploaded. The mesh owns a second, equal-capacity set, the
**drawn** buffers, handed to `thinInstanceSetBuffer` (updatable, as now).

**The pass.** Pure, in a new `grassCull.ts`, over a bucket's collected
buffers: for each instance, its translation (`matrix[12..14]`) tested as a
sphere of radius `CULL_RADIUS` against a **widened frustum** built from the
camera's pose; each kept instance's matrix and attribute floats copied, in
order, to the front of the drawn buffers; the kept count returned. The shell
then sets `thinInstanceCount` to it and uploads only the prefix,
`thinInstancePartialBufferUpdate(kind, kept, 0)` for every kind (Babylon's
count form, which uploads `kept × stride` floats from offset 0), never
`thinInstanceBufferUpdated`, which re-uploads a user buffer whole. Order is
preserved within the kept set, so the blades stay nearest first.

**The widened frustum.** The camera's own, from its position, yaw, pitch,
vertical field of view (1.4 rad) and aspect, with each side plane opened by
`CULL_MARGIN` = **5°** and the apex moved back along the view by
`CULL_PUSHBACK` = **1 m**. The sphere radius `CULL_RADIUS` = **0.75 m**, the
profile's, covers a card's half-width at its largest scale, the wind's lean
and step 3's lean. The planes are built from the pose, not read from
`scene.frustumPlanes`, so the pass is a pure function of the pose.

**When it runs.** On the first frame after a rebuild (the collected set
changed), and on any frame where the camera has turned by more than
`CULL_TURN` = **4°** (yaw or pitch) or moved by more than `CULL_MOVE` =
**0.5 m** since the pose the current prefix was filtered at. Otherwise the last
prefix is drawn as it is. The thresholds sit inside the margins: a turn of up to
4° leaves every edge of the true frustum inside the 5° widened one, and a move
of up to 0.5 m stays inside what the 1 m pushback opens at the apex
(1 m × tan 31.5° ≈ 0.61 m sideways at the gate still, more at 16:9). So an
instance the camera can see is always in the prefix it is drawing.

**As built** (grass frame reclaim step 1a): `CULL_MARGIN` **6°** and
`CULL_RADIUS` **1.5 m**, `CULL_PUSHBACK` and the thresholds as above. Two
things the paragraph above leaves out needed them. A yaw turn while pitched
is partly a roll about the view, and the view bob rolls the camera by up to
0.6°, so the frame's corners move further than the turn: at 5° and 0.75 m, a
sweep of turns, rolls and moves just under the thresholds left extents up to
1.28 m outside the sphere where the frustum's edges meet the ground. And an
instance reaches further than 0.75 m: a grass-class card at its largest scale
spans 0.50 m sideways and 0.60 m up, a blade clump 0.63 m and 0.50 m, and the
foliage vertex stage adds up to 0.76 of a vertex's drawn height of wind at
speed 1 (lean, peak gust, flutter), 0.04 m of tilt and 0.25 m of a player's
bend: 1.38 m for a card, 1.39 m for a clump. At 6° that sweep needs a radius
of 1.44 m; `grassCull.test.ts` derives both reaches from the models and the
clump geometry and holds them under `CULL_RADIUS`.

**Where it runs.** From `renderer.ts`, on
`scene.onBeforeActiveMeshesEvaluationObservable`, after the camera's pose for
the frame is final (the view bob included), with the camera's world position,
yaw, pitch and aspect; the shells expose `cull(pose)`. The blade field and the
clutter shell keep their rebuilds as they are.

**Cost.** Per pass, a plane test per instance over about 10,700 instances
(6,131 blade cells, 4,559 grass-class cards), most rejected at the first plane;
a copy of the kept prefix (about 2,150 instances at the gate still: 21 floats a
blade, 24 a card); and the upload of that prefix, about 190 KB at the gate
still and 350 KB at 16:9. An estimated 0.1–0.25 ms of JS per pass. Passes run
only on frames that cross a threshold: turning at 90° a second at 42 frames a
second, one frame in two; walking, about one in fifteen; standing and looking,
none. The gate measures the pass's JS time (a histogram over the walk and the
turn) and reports it; no test asserts a wall-clock bound.

### 5.3 Why the filter first

| | per-frame filter (1a) | sector meshes (1c) |
| --- | --- | --- |
| measured | 0.82 ± 0.14 ms at native (the profile, exact frustum) | nothing directly |
| share drawn, gate still, pitch 0.3 | blades 0.22, grass class 0.18 (with the margins) | blades 0.39–0.45, grass class 0.31–0.32 |
| share drawn, 16:9, pitch 0.3 | blades 0.41, grass class 0.34 | blades 0.58–0.62, grass class 0.49–0.52 |
| draw calls | unchanged, about 162 | about 250 at the gate still, 300 at 16:9 |
| JS per frame | 0.1–0.25 ms on frames past a threshold, none otherwise | about 0.9–1.4 ms every frame, for the extra draws |
| expected saving, native | about 0.78 ms | about 0.59 ms |

The contract both shells were built on, nothing per frame while the eye stays
in its cell, gives way here for a measured reason: the frame is GPU-bound, JS
is 3–5 ms of it (§3.3), and the filter's JS is a fraction of what the sectors'
extra draw calls would cost in the same place. What the filter couples to is
the camera's final pose, which `onBeforeActiveMeshesEvaluationObservable`
provides.

### 5.4 The expected saving

The profile's filter, with an exact frustum and a 0.75 m sphere, culled 83 %
of the blades and 85 % of the grass-class cards and saved **0.82 ± 0.14 ms** at
native, all of it theirs. Split by their hide costs (1.36 and 0.52 ms, 72 % and
28 %) and scaled by the share the widened frustum culls, from the geometric
derivation of §3.4 (which gives 0.827 and 0.853 for the exact frustum):

| layer | share of 0.82 | culled, widened / exact | expected, native |
| --- | --- | --- | --- |
| blades | 0.59 | 0.780 / 0.827 | **0.56** |
| grass class | 0.23 | 0.823 / 0.853 | **0.22** |
| together, gate still | 0.82 ± 0.14 | | **0.78** (0.64–0.92) |
| together, 16:9 | | 0.595 and 0.657 culled | **0.60**, reported |

The expected figure sits on the 0.8 ms bar, and the margins are its knob: at
10° and 2 m the kept shares rise to 0.27 and 0.21 and the saving falls to about
0.73 ms; at no margin (a pass every frame the view moves at all) it is the
profile's 0.82. What else can close a shortfall, in order: step 1b if the
meadow's saving is measured worth taking; step 2's far trim, about 0.12 ms at
native while the meadow is not filtered (§6.3); the margins narrowed to 3° and
0.5 m with the thresholds to 2° and 0.25 m.

**As built.** With the 6° margin and the 1.5 m radius (§5.2), the filter
keeps, at the canopy pose in the gate's still, 1,614 of 6,131 blade cells
(0.263) and 870 of 4,559 grass-class cards (0.191), against 1,388 and 823
(0.226, 0.181) at 5° and 0.75 m. Scaled as the table above, with these
measured shares in place of the derived ones: blades 0.59 × 0.737 / 0.827 =
**0.53**, grass class 0.23 × 0.809 / 0.853 = **0.22**, together **0.74 ms**
(0.62–0.87), under the 0.8 ms bar by 0.06. Of the closers listed above, step
1b and step 2's far trim still apply; narrowing the margins does not, since
the sweep in §5.2 is what set them.

**16:9.** A landscape window sees a third of the ring where the gate's still
sees a seventh, so the same filter saves about three quarters as much there.
The bar is the gate still's; the 16:9 figure is reported.

The comparison the bar reads is the branch filtered against the control as it
ships, unculled (§12.3).

### 5.5 What does not change

The fade bands are per instance and copied with the instance, and every card
in a bucket carries its bucket's bands, so the dither-in, the seam and the
dither-out are as they were. The blade tiers' hand-off bands and the foliage
plugin's `edges` are material uniforms. The shadow map draws no card and no
blade. Boulders, flowers, bushes, litter and the forest are not filtered.

### 5.6 Fallback (1c): the sector layout

The rest of §5 specifies step 1c, taken only if the filter's JS shows in the
gate. A sectored bucket keeps its one collector list and its one fill, but the
fill writes each instance into one of a fixed set of **sector meshes** chosen
by where it stands relative to the rebuild origin, each a copy of the bucket's
mesh with its own geometry, buffers and bounding box, which Babylon's own
per-mesh frustum test then draws or skips every frame.

#### The layout: octants and rings about the rebuild origin

A sector is an **octant** of the bearing from the bucket's rebuild origin
(`SECTOR_OCTANTS` 8) crossed with a **ring** of distance from it, with the ring
edges set per tier or bucket:

| bucket | band (from the origin) | ring edges (m) | sectors per bucket |
| --- | --- | --- | --- |
| blades, fine tier (12 buckets) | 0–6.12 | 2.5 | 16 |
| blades, mid tier (12 buckets) | 2.38–10.12 | none | 8 |
| blades, coarse tier (12 buckets) | 4.38–20.12 | none | 8 |
| grass-class near, LOD0 (2 models) | 0–53.74 | 18 | 16 |
| grass-class far, LOD1 (2 models) | 45.26–114.24 | none | 8 |
| meadow near (if 1b was taken) | 0–22.24 | 6, 14 | 24 |
| meadow far (if 1b was taken) | 3.76–40 (34.24 after step 2) | 14, 24 | 24 |

A disc needs rings; an annulus does not. An octant's box always reaches back to
the origin, and the origin is within 4.24 m (cards) or 2.12 m (blades) of the
eye, so an octant of a disc with no ring is drawn from almost every view: the
innermost ring is small and drawn nearly always, and the outer rings carry the
saving.

The derivation, as §3.4's, with Babylon's sphere-then-box test on each sector's
box, averaged over yaws and origin offsets, at pitch 0.3 (kept = share of the
bucket's instances in a drawn sector; ideal = share in view):

| bucket, layout | ideal | kept, gate still | kept, 16:9 | sectors drawn per bucket, gate / 16:9 |
| --- | --- | --- | --- | --- |
| blade fine, octants, no ring | 0.16 | 0.74 | 0.77 | — |
| blade fine, octants × ring 2.5 | 0.15 | **0.45** | 0.62 | 7.7 / 10.9 of 16 |
| blade fine, octants × rings 2, 4 | 0.16 | 0.41 | 0.57 | 11.7 / 14.9 of 24 |
| blade mid, octants | 0.15 | **0.42** | 0.61 | 3.4 / 4.9 of 8 |
| blade mid, octants × ring 6 | 0.16 | 0.36 | 0.54 | 5.8 / 8.9 of 16 |
| blade coarse, octants | 0.15 | **0.39** | 0.58 | 3.2 / 4.7 of 8 |
| blade coarse, octants × ring 12 | 0.15 | 0.34 | 0.52 | 5.6 / 8.5 of 16 |
| blades, 16 bearings × the rings above | 0.15 | 0.29–0.36 | 0.46–0.54 | 9.6–12.9 / 15–17 of 32 |
| grass near, octants × ring 18 | 0.14 | **0.32** | 0.52 | 6.0 / 8.4 of 16 |
| grass near, octants × rings 12, 30 | 0.14 | 0.31 | 0.48 | 8.1 / 11.9 of 24 |
| grass far, octants | 0.14 | **0.31** | 0.49 | 2.5 / 3.9 of 8 |
| grass far, octants × ring 80 | 0.14 | 0.29 | 0.45 | 4.8 / 7.2 of 16 |
| meadow near, octants × rings 6, 14 | 0.15 | 0.35 | 0.52 | 10.8 / 14.5 of 24 |
| meadow far, octants × rings 14, 24 | 0.14 | 0.32 | 0.49 | 11.0 / 15.9 of 24 |

The layouts in bold are taken. Past them each further ring or bearing takes
0.03–0.06 off the kept share for 40–100 % more draws; the blade field has
thirty-six buckets, so that trade is paid thirty-six times over.

Octants and rings are chosen over a fixed world grid for the same reason as
before: for the meadow's near disc, a 16 or 32 m cell keeps 0.54 or 0.71 (the
cell holding the eye and its neighbours are nearly always drawn), and an 8 m
grid keeps 0.31 for half again as many draws, with a slot count that depends on
where the disc falls on the grid. Octants and rings give every bucket a fixed
number of sectors, indexed directly, and a sector's membership is a pure
function of the instance and the snapped origin: what a sector holds depends
only on where the last rebuild happened, and which sectors draw only on the
camera.

### 5.7 Fallback (1c): the sector meshes

- **Built once**, when the bucket is adopted (cards) or created (blades):
  `sectorCount` copies of the bucket's mesh,
  `mesh.clone(`${name}.s${k}`, null, true).makeGeometryUnique()`, sharing its
  material. A thin-instance buffer lives on the geometry, so each sector needs a
  geometry of its own (the reason `nearLodVariants` already copies LOD1); a blade
  copy keeps its `blade` vertex data. The copies keep the source's name as a
  prefix, so the gates' isolation patterns (`/^blade_clumps/`,
  `/^LOD|^clutter\./`) still reach them. The source mesh stops drawing.
- **Flags.** `prepBucketMesh` as now, then `alwaysSelectAsActiveMesh = false`
  and `cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD`; a blade sector
  keeps `receiveShadows`. With the default sphere-only strategy the derivation
  keeps 0.55 rather than 0.54 of the meadow's near bucket at 16 m cells and 0.62
  rather than 0.48 at the feet; the box test costs a few plane tests per sector.
- **Filled on the rebuild.** The count pass counts per sector, `ensureCapacity`
  grows per sector, the write pass writes each instance into its sector's
  buffers exactly as it writes the bucket's today (the blade field's lists
  arrive nearest-first and are walked in order, so each sector stays
  nearest-first), and the apply step runs per sector. The buffers stay
  updatable, for the reason `applyBucket` records.
- **The box.** While writing, each sector tracks the minimum and maximum of the
  translations it writes. After the fill the box is those, padded by
  `SECTOR_PAD_XZ` 1.0 m sideways, `SECTOR_PAD_DOWN` 0.5 m down and
  `SECTOR_PAD_UP` 1.0 m up, and set with
  `getBoundingInfo().reConstruct(min, max, getWorldMatrix())`. The padding
  covers what the vertex stage can add beyond an instance's origin: a card's
  half-width at its largest scale (0.47 m for the meadow card; the grass class's
  are 0.08 m, a blade clump's 0.25 m), the wind's lean and flutter (a fifth of the
  drawn height at wind speed 1), step 3's lean (§7), and the far sink (half the
  model height, downward). An empty sector is disabled, as an empty bucket is
  today.

#### What does not change

The fade bands are per instance and keyed to the eye, not to the mesh, so every
sector of a card bucket carries its bucket's bands. The blade tiers' hand-off
bands are material uniforms, and a tier's sectors share its material. The
foliage plugin's `edges`, and so the far sink, are per material. The shadow map
draws no card and no blade. A boulder bucket is never sectored.

### 5.8 Fallback (1c): the blades and the grass class in sectors

#### The blade field

The blade field is thirty-six buckets (four characters × three tiers × three
sizes, `bladeMeshes.ts`), of which twenty hold instances at the canopy pose; its
6,131 cells carry 796,159 instance vertices, and hiding it saves **1.36 ± 0.20
ms** at native, the largest layer in the frame. Every bucket is sectored by its
tier's layout (§5.6): 12 × 16 + 24 × 8 = **384 sector meshes**, of which only
those holding cells are enabled.

The fine tier stands around the eye and needed a ring to be worth splitting at
all: with octants alone it keeps 0.74, with the 2.5 m ring 0.45. The mid and
coarse tiers are annuli and take octants alone. Weighted by the tiers' shares of
the field's vertices, about a third each (the budget test's padded clumps:
470.9 at 150 blades, 1,285.5 at 60 and 4,846.8 at 15), the field keeps **0.42**
of its instances at the gate still and 0.60 at 16:9, against 1.00 today and
0.15–0.32 in view.

#### The grass class

The grass class's four buckets (`clutter.grass_a` and `_b`, LOD0 near at 330
and 410 vertices a card, LOD1 far at 172 and 221) hold 4,559 cards and
1,058,800 instance vertices at the canopy pose; hiding them saves **0.52 ± 0.12
ms** at native and 0.51 ± 0.09 at 4×, the same at four times the pixels. Each
LOD0 bucket takes 16 sectors and each LOD1 bucket 8: **48 sector meshes**,
keeping 0.31–0.32 at the gate still and 0.49–0.52 at 16:9. The cards were in the
control as well as the near-grass tip, so this reclaims frame the near-grass
work never spent; that is still frame reclaimed, and the bar counts it.

### 5.9 Fallback (1c): saving and draw calls

#### The expected saving

Anchored on the profile's one reliable culling figure: filtering all three
layers to the frustum, which keeps about 0.15 of each, saved **0.82 ± 0.14 ms**
at native. The meadow's part of it was nothing measurable, so the figure is
the blades' and the grass class's. Split between them by their hide costs (1.36
and 0.52 ms, 72 % and 28 %), and scaled by the share each layout culls against
the share the filter culled (0.85), assuming each layer's saving is linear in
the off-frustum instances removed:

| layer | ideal saving (native) | culled, sectors / filter | sector saving, native |
| --- | --- | --- | --- |
| blades | 0.59 | 0.58 / 0.85 | **0.40** |
| grass class | 0.23 | 0.685 / 0.85 | **0.19** |
| together | 0.82 ± 0.14 | | **0.59** (0.49–0.69) |
| meadow | about 0 | | not expected |

**Sectors alone are expected to fall about 0.2 ms short of the 0.8 ms bar**,
and finer sectors do not close it: sixteen bearings with the same rings take
the blades to about 0.47 ms for some 210 blade draws. That, with their draw
calls, is why they are the fallback and the filter is step 1a (§5.3 compares them).
At 4× the profile's filter figure was 0.51 ± 0.42, not reliable; the sectors'
4× saving is reported, not barred. Step 2's far trim adds a little more
(§6.3).

This is not a saving against the ideal alone: the comparison the bar reads is
the branch culled against the control as it ships, unculled (§12.3).

#### Draw calls

The scene draws 160–164 calls at the canopy pose (§3.3), 20 of them live blade
buckets and 4 grass-class buckets. Sectored, those become about 95 and 17 draws
at the gate still and about 137 and 25 at 16:9 (the table in §5.6, with the live
blade buckets spread evenly across tiers): **about 250 draws at the gate still
and 300 at 16:9**, against a knee a Babylon report puts at 400 on a 2019 laptop
([Babylon forum](https://forum.babylonjs.com/t/rendering-performance-issues/43140)).
The profile's draw phase costs about 10 µs of JS per draw (1.7 ms for 162), so
the sectors add about 0.9 ms of JS at the gate still and 1.4 ms at 16:9, taking
the JS frame from 3.8 ms to about 4.7–5.2 ms: on this machine under the GPU's 24
ms, so hidden; on a machine whose frame is CPU-bound, a cost. Each gate reports
the draw calls and the JS frame time beside the frame, and if the JS time grows
by more than the GPU frame shrinks at native, the blades' fine-tier ring is
dropped first (§13). The meadow's sectors, if taken, add about 22 draws.

### 5.10 As built and measured

Step 1a as built (the verification note's §4 and §5 carry the measurements):

- **Constants.** `CULL_MARGIN` 6°, `CULL_PUSHBACK` 1 m, `CULL_RADIUS` 1.5 m,
  `CULL_TURN` 4°, `CULL_MOVE` 0.5 m (§5.2's as-built note gives why). The
  meadow's buckets are untouched; on the low tier the grass class draws whole.
- **What is drawn**, at the gate's still: at the canopy pose 1,614 of 6,131
  blade cells (0.26) and 870 of 4,559 grass-class cards (0.19); at the meadow
  pose 1,752 of 6,587 and 891 of 4,731. Draw calls do not move: 159–163 at
  the canopy pose and 201–205 at the meadow pose, on both builds.
- **Frame**, against `main` by the pair method: **−0.42 ms** at the canopy pose
  at native (same-code +0.01), −0.37 ms at 4×, −0.39 ms at 1920 × 1080;
  −0.96 ms at the meadow pose at native, −0.61 ms at 4×.
- **Fullness** unchanged: every cover, near-cover and luminance figure inside
  the control's own page-to-page spread at both poses. **No pop** found on the
  turn, pitch and walk sequences, each step just under a threshold (note §5.6).
  The JS frame at a still pose is unchanged (4.33 against 4.34 ms).
- **The filter's own JS.** As first built, a pass cost 0.4–0.5 ms in the page,
  twice §5.2's estimate, and a fast turn refilters every frame. The pass was
  then rebuilt without changing what it keeps: each bucket's translations held
  apart from its matrices, the five plane tests taken without a branch per
  instance (a turning view changes which instances pass from cut to cut, and
  early-out tests paid about as much again in mispredicted branches), the
  matrix and the vec4 streams moved as float64 pairs, and a bucket whose kept
  set is the last cut's left alone, neither copied nor uploaded. In Node, at the
  canopy pose, a pass went from 0.12–0.15 ms (blades 0.07–0.09, grass class
  0.04–0.06) to **0.05 ms** (0.03 and 0.02), on a turn and on repeated cuts
  alike, and a turn's blade uploads fell by a quarter (52 to 39 buffer updates a
  pass). The first build ran 2–4 times slower in the page than in Node (0.45 ms
  against 0.12–0.22), so a pass is expected at 0.10–0.20 ms in the page; the next
  gate times it.

**The bar, re-based.** The profile's 0.82 ms did not reproduce on today's
`main`: filtering the blades, the grass class and the meadow's cards to the
exact frustum, the most any culling of them can give, measures **0.58 ± 0.08
ms** at the canopy pose at native (note §4). No margin reaches 0.8 ms. Step
1a's bar is therefore set against that ceiling: **at least 70 % of the
exact-frustum saving at native, with no pop and no loss of fullness.** This
bar was chosen after step 1a's gate had measured it, so it records what was
accepted rather than a prediction that was tested; and the ratio is looser
than one figure says:

- The ceiling is 0.58 ± 0.08 ms (its three pages read 0.67, 0.51 and 0.57),
  so 0.42 / 0.58 = 72 % spans **64–84 %** on the ceiling's spread alone.
- The two figures come from different methods: the 0.42 ms is a pair delta
  against `main` (rounds of −0.34 to −0.46), the 0.58 ms a toggle within one
  page. Neither carries the other's noise.
- The ceiling includes the meadow's cards, which step 1a does not filter and
  which are worth about 0.05 ms (below). Like for like, the ceiling for the
  blades and the grass class is about 0.53 ms, and step 1a reaches about
  **79 %** of it.

The 0.8 ms goal of §1 stands for the design as a whole, and is now to be
reached with what follows.

**Step 1b dropped.** Filtering the meadow's two buckets on top of 1a measures
0.05 ms (−0.05 ± 0.04 and −0.07 ± 0.14 on two pages), under the 0.15 ms §5.1
asked of it. Step 1c is not taken either: the filter's JS does not show in the
frame, and is now a third of what the gate timed.

**What culling leaves: the blades in view.** With the filter on, hiding the
blades still saves 0.88–0.94 ms at the canopy pose, of the 1.20 ms they cost
unculled, and hiding the grass class 0.11 of its 0.43. The blades the camera
sees carry what the frame still spends, and no culling reaches them. The next
target, before step 2, is those blades, by levers that leave every blade in
its place (plan Task 2D):

1. **Fewer rings per blade in the mid and coarse tiers.** Every blade is
   `BLADE_RINGS` = 3 cross-sections below its tip, 7 vertices and 5 triangles,
   on every tier. Past 4 m a blade is a pixel or two wide and its curve spans a
   few pixels, so 2 rings on the mid tier (5 vertices, −29 %) and 1 on the
   coarse tier (3 vertices, −57 %) should hold its outline to about a pixel.
   The three tiers carry about a third of the field's vertices each, so this
   is about −29 % of the blade vertices.
2. **A simpler vertex stage for the coarse tier.** Terms of the foliage vertex
   stage that cannot move a coarse-tier vertex by a pixel (the per-vertex
   flutter, at most 0.04 of a 0.5 m blade, is 2 cm at 4–20 m) are dropped under
   a tier define. Which terms qualify is measured on rendered stills, not
   assumed; the player bend stays, since a remote player walks through the
   coarse tier.
3. **Step 2's far trim.** About 0.12 ms at native while the meadow is not
   filtered (§6.3). It is not a lever on its own: it ends cards past 26 m that
   the terrain's far pull (§6.2) is there to replace, so it comes with that
   pull, and taking it early means taking step 2 early, whole.

Which of the vertex or fragment stage the in-view blades spend is not known
(§3.3); Task 2D measures that split first, then each lever by the toggle
method, and keeps a lever only on a measured saving with fullness inside the
control's spread at both poses.

## 6. Step 2: the far sward on the terrain

### 6.1 Where the cards end

The meadow's far cards dither out over **[26, 30] m** on the tiers that draw
blades, where they dithered out over [28, 40]; the low tier is unchanged. Every
system that publishes its level-of-detail chain ends geometry this way, with
the terrain carrying the sward past a cut and a narrow blend band at the cut:
Ghost of Tsushima's last tier is a texture on the terrain
([tigerabrodi](https://tigerabrodi.blog/grass-in-ghost-of-tsushima)), and the
2026 Helio chain blends terrain material over 2 m bands past its geometry cull
([Pulsar/Helio](https://pulsarnative.com/blog/2026-08-02-helio-foliage-system)).

Why 30 m and not 18 m. The mid crop, 18–26 m, is where the near-grass bar reads
the field full, and what makes it full from a 1.6 m eye is rows of card
silhouettes overlapping at a grazing angle (near-grass design §3.4): at 20 m a
0.35 m card hides some 4 m of ground behind it. A flat shade cannot stand up
off the ground; it can only colour it. So the cards stay through the mid crop
and the terrain takes over only where they were already half gone: across
[28, 40] the old dither averages half visible and the far sink lowers the cards
by up to half their height.

**The collector.** The meadow's radius stays 40 m: the split, the seam and
`BLADE_REACH` all derive from it (`clutterField.ts`, `bladeField.ts:37`). The
far list alone is trimmed: an instance whose distance from the snapped origin is
≥ `CLUTTER_MEADOW_CARD_END` + `CLUTTER_FADE_MIN_RAMP` = 30 + 4.24 = **34.24 m** is
not emitted. The eye is within 4.24 m of the origin, so every trimmed instance
is at least 30 m from the eye, past the dither's end: none can pop. By area the
trim removes 27 % of the far bucket, about 2,350 cards at the canopy pose and
2,750 at the meadow pose; the gate records the counts.

**The fade.** The far bucket's out-band becomes (26, 30), which also moves the
foliage plugin's `edges` for the meadow material, so the sink runs over the
same four metres. Helio's bands are 2 m; four keeps the dissolve a dissolve at
the grazing angle.

### 6.2 What the terrain carries past 24 m

A second sward pull, after the near one (`terrainTexture.ts:566–567`):

```glsl
float farW = terrainFarSward.w
  * smoothstep(terrainFarSwardBand.x, terrainFarSwardBand.y, vTerrainCover)
  * smoothstep(terrainFarSwardBand.z, terrainFarSwardBand.w, dist);
vec2 fsCell = floor(vPositionW.xz / FAR_SWARD_CELL);
float fsClump = fract(fsCell.x * 0.618034 + fsCell.y * 0.381966);
float fsGust = terrainGust(vPositionW.xz, terrainWind.w + 0.6 * (fsClump - 0.5));
vec3 fsCol = terrainFarSward.rgb
  * (1.0 + terrainFarSwardFx.x * (fsClump - 0.5))
  * (1.0 + terrainFarSwardFx.y * terrainWind.z * fsGust)
  * (1.0 - terrainFarSwardFx.z * (1.0 - abs(viewDirectionW.y)));
surfaceAlbedo = mix(surfaceAlbedo, fsCol, farW);
```

| constant | value | meaning |
| --- | --- | --- |
| `FAR_SWARD` | (0.11, 0.135, 0.065) | the far field's colour, linear albedo: `TUFT_ALBEDO` × 0.6, the lit tuft darkened by the ground and the shade between rows. A starting value; the gate fits it (§6.6) |
| `FAR_SWARD_MAX` | 0.8 | the pull at full cover |
| `FAR_SWARD_COVER` | [0.05, 0.5] | the cover band, the near pull's `SWARD_COVER`: a sward stands where the blade field would grow |
| `FAR_SWARD_BAND` | [24, 30] | eye distance the pull ramps in over, under the cards' dither-out |
| `FAR_SWARD_CELL` | 1.5 | m; the mottle's cell, the foliage plugin's `FOLIAGE_CLUMP_CELL`, so the terrain's mottle is the cards' clump variation continued |
| `FAR_SWARD_CLUMP` | 0.16 | the mottle's luminance spread, `FOLIAGE_CLUMP_LUMA` |
| `FAR_SWARD_WIND` | 0.08 | the shimmer: albedo lifted and lowered by the gust field, the one the cards lean on, at the wind's gust amplitude |
| `FAR_SWARD_GRAZE` | 0.3 | darkening toward a grazing view, where rows of cards would hide the ground between them |

- **Colour.** The key is the ground cover the terrain already carries per vertex
  (`terrainCover`, near-grass design §5.2), not the grass texture weight, which is
  a mottle; the far pull falls where a sward stands, as the near one does.
- **Mottle.** `fsClump` is the foliage vertex stage's `fClump`
  (`foliageWorldPos.vertex.fx`) on the same 1.5 m cells, so where the cards
  thin out, the terrain continues the pattern of light and dark tufts rather
  than starting a new one.
- **Wind.** `terrainGust` is `foliageGust` (`foliage.vertex.fx`), the GLSL twin of
  `gustAt` in `windParams.ts`, copied under the terrain's own name and pinned to
  the same constants by the lockstep test. The wind record reaches the terrain
  through two new uniforms bound from the foliage module's current record, so a
  gust front that moves the cards at 25 m moves the shimmer at 35 m.
- **Normal and occlusion.** No new texture fetch. The grazing term stands in for
  the occlusion rows of cards give; the grass layer's hex normal already runs
  wherever the grass texture does.
- **The horizon pull** toward `TUFT_ALBEDO` past [35, 90] m is unchanged and runs
  first; on sward ground the far pull, at 0.8, mostly replaces it.

**Uniforms.** Four `vec4`s, on both the UBO list and the non-UBO string, as the
sward's are: `terrainFarSward` (colour, max), `terrainFarSwardBand` (cover band,
distance band), `terrainFarSwardFx` (clump, wind, graze, 0) and `terrainWind`
(direction x, z, gust amplitude, time). The pull is off with the near sward on
the low tier (`setTerrainSward`), whose far cards keep their own edges.

**CPU twin.** `farSwardWeight(cover, dist)` in `groundHexParams.ts`, beside
`swardWeight`, for the tests and for step 4's root colour.

### 6.3 Cost

Four uniforms, two `smoothstep`s, a hash, two `sin`s and a `mix` per terrain
fragment, on the terrain's one draw. The trim takes 27 % of the far bucket,
whose cost the profile measured at 0.44 ± 0.05 ms at native (§4.4): about
**0.12 ms** at native if the meadow is not filtered (step 1b not taken), and
the in-view part of that, about 0.04 ms, if it is. Step 2's value is as much
where it leaves the far field (a sward that reads to the horizon on the
terrain, not a card disc that ends at 40 m) as what it saves.

### 6.4 The seam

The cards dissolve over [26, 30] while the terrain darkens over [24, 30]. The
pull reaches full strength just as the last card is gone, and the terrain under
the dissolving cards is already most of the way to the far colour, so the
screen-door stipple of the dither shows the same tone through its holes as
around them. A walk across the cut (§12.4) judges it.

### 6.5 What it must not do

- Touch the mid crop: the band starts at 24 m, past its 18–26 m ground, and the
  near sward's own fade [12, 18] is unchanged.
- Move the luminance ratio at the canopy pose, which sits at the ceiling: the
  mid crop's mean must move by less than 1 %.
- Leave the far field lighter or darker than the cards left it (§6.6).

### 6.6 Fitting the colour

At both poses, the far crop (§4.2) on the control and on the branch, and the
branch with the cards hidden. `FAR_SWARD` is fitted so the branch's far-crop mean
is within ±10 % of the control's and its cover within ±0.05, moving the three
channels together; the fitted value is committed as a literal with the note's
numbers beside it.

## 7. Step 3: lean and hug

### 7.1 The lean

Today every tilting profile pushes a vertex away from the eye by
`FOLIAGE_TILT * fH2`, a fixed 4 cm at the tip whatever the distance or the view
(`foliageWorldPos.vertex.fx`, the `foliageFlags.x` block). Horizon Zero Dawn's
grass displaced each vertex along the camera's up vector in object space,
scaled by the vertex's height, so cards seen from above face the eye and the
ground between them closes
([HZD, GDC 2018, pp. 27–30](https://media.gdcvault.com/gdc2018/presentations/gilbert_sanders_between_tech_and.pdf)).
The same idea here, keyed not to the camera's orientation but to where the eye
is:

```glsl
vec3 fToEye = windEye - finalWorld[3].xyz;
float fElev = clamp(fToEye.y / max(length(fToEye), 1.0e-3), 0.0, 1.0);
float fLean = FOLIAGE_LEAN * fElev;
float fY = positionUpdated.y * fScale;
vec2 fAwayN = -fToEye.xz / max(length(fToEye.xz), 1.0e-3);
worldPos.xz += fAwayN * fY * sin(fLean);
worldPos.y -= fY * (1.0 - cos(fLean));
```

`FOLIAGE_LEAN` = **0.5** rad: a rotation about the card's base, away from the
eye, by 0.5 × the sine of the eye's elevation over the instance. From a 1.6 m
eye:

| distance | elevation sine | lean | tip moves (0.35 m card) |
| --- | --- | --- | --- |
| 1 m | 0.85 | 24° | 0.14 m |
| 2.5 m | 0.54 | 15° | 0.09 m |
| 6 m | 0.26 | 7° | 0.05 m |
| 20 m | 0.08 | 2° | 0.01 m |

- **Why elevation, not pitch.** A card at the feet is seen from above whatever
  the gaze, and a card at 20 m is seen side-on; the elevation says which, per
  card. Nothing depends on the camera's rotation, so turning in place moves no
  card at all. That is the swing the published warning is about (a strong lean
  "makes cards visibly swing as the player turns").
- **Level views keep the silhouette.** At 20 m the lean is 2°, less than today's
  4 cm push, so the mid crop's rows stand as they do.
- **Rotation, not shear.** The vertex drops by `1 − cos` as it moves out, so a
  leaning card keeps its length.
- **Profiles.** Every profile with `tilt: true` (grass, meadow, flower, blades)
  takes it; bush, understory, tree and duff do not, as now. `FOLIAGE_TILT` is
  removed from the GLSL and from `foliagePlugin.ts`, and `FOLIAGE_LEAN` takes its
  place in the lockstep test.
- **The bend and the wind** run before it, unchanged; the blade collapse runs
  after it, so a collapsed blade still coincides with its root.

### 7.2 The hug

A card stands upright on its origin, sunk 2 cm (`CLUTTER_SINK`), whatever the
slope; the meadow card's base spans ±0.44 m, so on a 20 % slope its downhill
edge floats about 7 cm (9 cm less the 2 cm sink). The trees already solve this (`groundConformPlugin.ts`); the
cards do not use it. The foliage plugin gains the same step for card profiles:

```glsl
float fHug = 1.0 - smoothstep(0.0, FOLIAGE_HUG_RAMP, fH);
vec2 fOff = worldPos.xz - finalWorld[3].xz;
worldPos.y += fHug * FOLIAGE_HUG * min(0.0, dot(fOff, foliageGrad));
```

- `foliageGrad` is a new per-instance `vec2` attribute, the instance's own ground
  gradient (`groundDx`, `groundDz`), which every clutter instance already
  carries from the sim's terrain sample.
- `FOLIAGE_HUG` = **1.5**, `GROUND_CONFORM_OVERSHOOT`'s value and reason: the push
  goes past the tangent plane so the downhill edge tucks into ground that has
  already curved away. Clamped downward, as the conform is: lifting the uphill
  half over concave ground opens new daylight.
- `FOLIAGE_HUG_RAMP` = **0.15** of the model height: the base follows the plane,
  the card above it stays upright.
- On the meadow, grass and flower profiles (a new `hug` profile flag), not the
  blades, whose clumps are 0.5 m cells whose roots already sit at the cell's
  ground through `bRoot`.

### 7.3 Cost and the bar

A normalise, a `sin`, a `cos` and a dot product per vertex, and 8 bytes per card
instance. Nothing measurable is expected; the gate's frame bar is that the
step's delta over the previous gate is inside the same-code noise (±0.1 ms). The
fullness bar: near cover up at both poses, luminance inside its window.

## 8. Step 4: colour continuity and alpha coverage

### 8.1 The root takes the floor's colour

A card's root is already tinted toward the ground under it
(`foliageLights.fragment.fx`): weight `foliageTint × (1 − h)²`, rising with
distance over 20–80 m, toward the `foliage` attribute's colour, which is the
terrain palette's `surfaceAlbedo` times the macro tint (`clutterMeshes.ts`,
`writeFoliage`). Two things keep the root from matching the floor it stands on:

- **Inside 18 m the floor is not that colour.** The near-grass work pulls the
  floor under a sward toward `SWARD_FLOOR` (0.05, 0.065, 0.03) by
  `swardWeight(cover, dist)`; the card's tint target is the unpulled palette,
  far lighter. From above, a tuft's light root on the dark thatch reads as the
  cut-out it is, which is the near-grass look verdict at the canopy pose ("single
  dark tufts on a pale mid-grey floor").
- **The root band is thin.** `(1 − h)²` is at half weight by 30 % of the height,
  and the near tint weight is at its smallest near the eye.

**The change.** The root target becomes the floor as the terrain draws it: the
foliage fragment pulls `vFoliage.rgb` toward `SWARD_FLOOR` by the near sward
weight and toward `FAR_SWARD` by the far weight, the terrain's own functions
moved into one GLSL snippet both plugins include, so the two cannot drift apart.
The weights need the cover at the instance: card buckets gain a per-instance
float `foliageCover`, `min(1, grass)` from the sim's ground cover at the
instance, the terrain's `terrainCover` and the blades' `bladeStrength` by
another name; the blade profile reads `bladeStrength`. The root band becomes
`1 − smoothstep(0, FOLIAGE_ROOT_BAND, h)` with `FOLIAGE_ROOT_BAND` = **0.35**,
so the bottom third of a card carries the floor's colour and fades into its own
over the rest. The weight's clamp at 0.85 and its rise with distance are kept.

Where a card stands on a sward the root is now darker than it was, so the step
adds to cover rather than taking from it; it must not lift the near crop's
luminance ratio below 0.8 at the meadow pose (0.96 now).

### 8.2 Alpha that survives the mip chain

The meadow card's alpha is a PNG embedded in `clutter.meadow.glb` (glTF `MASK`,
cutoff 0.25; the grass class's cutoff is 0.5), sampled trilinearly, with the mip
chain generated at load. Averaging a sparse mask lowers its alpha, and a blade
that is a few texels wide falls under the cutoff a few mips down: an
alpha-tested card thins with distance by its mip chain alone
([lisyarus](https://lisyarus.github.io/blog/posts/exploring-ways-to-mipmap-alpha-tested-textures.html)).
The meadow card's colour and alpha are one 1024 × 1024 indexed PNG; with about
a thousand texels to the metre of card, the gate's still samples its second mip
from about 5 m and its third from about 10 m (twice those distances at 4×
pixels), which is where the near field starts to read thin. The tool below
measures the texel density rather than assuming it.

Horizon Zero Dawn rebuilt each mip so its post-test coverage matched mip 0.
Doing that here would mean re-encoding the cards' textures as files with
hand-built mip chains, no longer the originals `CREDITS.md` names byte for
byte. The run-time equivalent keeps the files as shipped: the alpha
is scaled up by the mip level being sampled
([Golus](https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f)),

```glsl
vec2 fTexel = vAlbedoUV * foliageAlbedoSize;
float fMip = max(0.0, 0.5 * log2(max(dot(dFdx(fTexel), dFdx(fTexel)), dot(dFdy(fTexel), dFdy(fTexel)))));
float fAlpha = texture2D(albedoSampler, vAlbedoUV).a * (1.0 + fMip * foliageMipAlpha);
if (fAlpha < foliageCutoff) discard;
```

at `CUSTOM_FRAGMENT_MAIN_BEGIN`, before the distance fade's own discard.
Babylon's PBR material runs its alpha test inside the albedo block, before any
plugin hook can change the alpha (`pbrBlockAlbedoOpacity.js:73–75`), so the
plugin takes the test over: the material's `alphaCutOff` becomes 0 (its test
never fires) and the file's cutoff moves to the uniform `foliageCutoff`.

**The scale is measured, not picked.** A tool in `tools/` reads the card models'
embedded alpha, builds the same box-filtered chain the browser does, and prints
each mip's coverage at the file's cutoff and the per-mip scale that restores
mip 0's coverage. It reads the textures; it writes nothing. `foliageMipAlpha`
per card material is the scale that fits mips 1–4 best, starting at Golus's 0.25
if the tool is not yet run; its table goes into the verification note.

### 8.3 Cost and the bar

One more texture fetch (from a texel the albedo fetch then reads from cache)
and a few derivatives per card fragment; the built-in test's fetch and compare
are still done, but its discard never fires. Frame bar as step 3's. Fullness bar:
near cover up at both poses; a still at 5–8 m (§12.2) shows the cards no thinner
than at 2–3 m.

## 9. The WebGPU spike

### 9.1 What it is for

Culling on the CPU stops at the frustum, at the granularity of a clump, and
spends main-thread time on every candidate each pass. The route every shipped
grass system takes past that is a compute pass per frame that culls every
candidate and packs the survivors for the draw. Babylon 9.18 has two of the
three pieces: `ComputeShader`, and `StorageBuffer` with
`BUFFER_CREATIONFLAG_VERTEX | INDIRECT | READWRITE` wrapped as instanced
`VertexBuffer`s and drawn with `Mesh.forcedInstanceCount`
([Babylon docs, compute shaders](https://doc.babylonjs.com/features/featuresDeepDive/materials/shaders/computeShader)).
It lacks the third: no mesh-level indirect draw in core; the one Babylon
indirect-draw sample drops to raw WebGPU through `engine._device`
([Babylon forum](https://forum.babylonjs.com/t/indirect-drawing-sample-using-wgsl/63571)),
and storage-backed geometry landed only in the separate WebGPU-only Babylon-Lite
([PR #737](https://github.com/BabylonJS/Babylon-Lite/pull/737)). The spike asks
whether the route pays here, and what it would cost to take.

### 9.2 Scope

- **In:** the blade field on the high tier, under a `WebGPUEngine` selected by
  `?engine=webgpu` with `WebGPUEngine.IsSupportedAsync`; whatever else the scene
  needs in order to render on that engine for the measurement.
- **Out:** the cards on the GPU; the rest of the renderer ported to WebGPU;
  WebGPU as a default or a shipped option; Safari, which removed timestamp
  queries; any change on `main`.

Its own worktree and branch (`worktree-grass-webgpu`), from `main` after
step 1 lands, so its control carries the frustum filter.

### 9.3 The engine first

Every foliage, fade, terrain and atmosphere effect is a GLSL material plugin,
and a plugin's `isCompatible` accepts GLSL only
(`materialPluginBase.pure.js:32–35`). On a WebGPU engine a material generates
WGSL unless it was constructed with `forceGLSL`
(`PBRMaterial(name, scene, forceGLSL)`), in which case its GLSL is translated at
run time by glslang and twgsl. The materials the project constructs can pass
the flag; the ones the glTF loader constructs cannot, so on WebGPU the
clutter shell replaces each card material with a GLSL-forced copy (albedo
texture, alpha mode and cutoff, colour) before attaching plugins. The two
translators are served from the branch's own `client/public/libs/`, as the KTX2
decoder is (`tools/vendor-ktx2.mjs`), never from a CDN.

**Step 0 of the spike, its first go/no-go:** the canopy pose renders on WebGPU
with every plugin compiled, no console error, and a frame within 10 % of the
WebGL2 build's at the same pose. If a plugin does not survive translation, the
note lists which and what failed, and states the WGSL rewrite: the plugins'
GLSL is in `client/src/game/shaders/` and the plugin files, and the spike counts
the lines to port.

### 9.4 The cull and pack

- **Candidates.** The blade field's cells as today: the CPU collector on its 1 m
  crossing, written into one storage buffer of candidate records (origin,
  yaw, height scale, strength, character, size, ground tint and shade; 48 bytes)
  in place of the thirty-six matrix buffers.
- **One compute pass per frame**, one thread per candidate: the clump's bounding
  sphere (0.35 m × its height scale) against the six frustum planes, then its tier
  from the eye distance with each tier's padded band, then an `atomicAdd` on its
  bucket's counter and a write of its matrix (as four `vec4`), `foliage` and
  `bladeStrength` into that bucket's region of the output buffers.
- **The output buffers** are storage buffers with the vertex flag, wrapped as
  instanced `VertexBuffer`s named as the thin-instance attributes
  (`world0`–`world3`, `foliage`, `bladeStrength`), so the existing clump meshes,
  the tier materials and their plugins draw them unchanged.
- **The count.** Each bucket has a fixed capacity, the worst in-view count found
  over the gate's walk and turn with a quarter again. The draw is
  `forcedInstanceCount` = capacity, and the compute pass first clears every
  slot past the live count to a zero matrix, which collapses a dead slot's
  vertices to one point. That spends trivial vertex invocations on the dead tail;
  the alternative that spends none is the counter read back one frame late into
  `forcedInstanceCount`, tried second, and an indirect draw through
  `engine._device` third, only if both measure too slow.
- **Per blade** (each blade culled and packed rather than each clump, the False
  Earth layout, with a WGSL `ShaderMaterial` pulling blade records by
  instance index) is not in the spike. It is the next step only if the per-clump
  pass goes, and the spike's report states its WGSL cost.

### 9.5 Go or no-go

Measured at the canopy pose, high tier, native pixels (4× reported), by the
pair method, on the WebGPU engine: **S**, the spike's blade field, against **B**, the shipped
thin-instance blade field on the same engine; and the WebGPU build with S
against the WebGL2 build of the same commit.

**Go** only if all of:

1. S is at least **1.0 ms** faster than B;
2. near cover with S is at least B's less 0.01, at both poses, and the walk
   shows no clump appearing or vanishing;
3. the WebGPU build with S is no slower than the WebGL2 build at the same pose
   (otherwise the engine switch costs players more than the pass saves);
4. every plugin in the scene compiles through the translators on WebGPU, or the
   WGSL rewrite is costed and no larger than the plugins' own GLSL.

Otherwise **no-go**: the report records the numbers and what failed, and
nothing is proposed upstream.

**If go.** An upstream proposal to Babylon.js, the smallest that serves: a
mesh-level draw that reads its instance count from a storage buffer created with
`BUFFER_CREATIONFLAG_INDIRECT`, or thin instances backed directly by a storage
buffer (what the maintainers' workaround does by hand today), each with this
spike as its example. A fork only if the proposal is refused or cannot land in
time, as a small patch set applied at install on an exactly pinned
`@babylonjs/core`, with its own design.

## 10. What is not changed

- The card models and their texture files, byte for byte.
- The cards' near and far bands inside 26 m, the seam, the dither's rule, the far
  sink's rule.
- The blade field's placement, tiers, counts, geometry, budget and materials
  (step 1 only splits or filters buffers).
- The low tier: no frustum filter (it has no blade field and the smallest discs), no
  far sward, its own edges.
- The near sward floor, the horizon pull, the macro tint.
- Everything under `client/src/sim/`, and so the level id.

## 11. Tests

- `grassCull.test.ts` (new, step 1a): the constants as literals (5°, 1 m,
  0.75 m, 4°, 0.5 m); the widened planes at literal poses; the pass keeps
  exactly the instances inside them, in their collected order, and returns
  their count;
  - **the kept set is a pure function of the pose and the collected set:** the
    same pose and buffers give byte-identical prefixes whatever pose was
    filtered before;
  - **no visible instance is dropped:** for a pose filtered and then a camera
    turned by up to 4° and moved by up to 0.5 m from it, every instance whose
    translation, lifted 0–0.8 m, is inside that camera's view (`inCone`, margin
    0) is in the prefix;
  - **when it refilters:** not below either threshold, always past one, always
    after a rebuild.
- `bladeMeshes.test.ts`, `clutterMeshes.test.ts` (step 1a): after `cull(pose)`,
  each blade and grass-class bucket's `thinInstanceCount` is the pass's kept
  count; **the upload never exceeds the kept prefix**: every
  `thinInstancePartialBufferUpdate` in a pass has count ≤ the kept count and
  offset 0, and no `thinInstanceBufferUpdated` runs in a pass; the drawn
  buffers' prefix equals the collected buffers' kept instances, matrix and
  attributes alike, in order; the blades stay nearest first; **the mesh count
  is unchanged** by any number of passes; a bucket with an empty prefix is
  disabled.
- `grassSectors.test.ts`, `bladeMeshes.test.ts` and `clutterMeshes.test.ts`
  (step 1c, only if taken): every bucket split by its layout; each instance in
  exactly one sector; nearest-first order within each blade sector; sectors not
  always active, standard strategy; and, for the card sectors:
  - every grass-class instance (and meadow instance) lands in exactly one sector,
    and the sectors' counts sum to the collector's;
  - each sector's box contains every one of its instances, padded;
  - sector meshes are not always active and use the standard strategy; the source
    mesh is disabled;
  - every far sector carries the far bucket's fade bands, the near sectors the near
    bucket's in-band, as literals;
  - **no visible card is culled:** for a camera at literal poses (yaw 0, π/2, π;
    pitch 0.3 and 0.9), every instance whose origin, lifted 0–0.8 m, is inside the
    view (`inCone` from `wildlifeDirector.ts`, margin 0) belongs to a sector whose
    mesh `isInFrustum` of the camera's planes;
  - **the drawn set is a function of the rebuild point and the camera, never of
    the path:** a rebuild at the same point reached from two histories
    (straight there, and by way of a rebuild 30 m away) gives identical
    per-sector buffers, and the same camera then selects the same sectors; a
    camera that moves inside the rebuild cell changes which sectors draw and
    never what they hold;
  - after step 2, far counts at the two poses and the far out-band (26, 30).
- `clutterField.test.ts`: `CLUTTER_MEADOW_CARD_END` 30; no far meadow instance at
  or past 34.24 m from the origin; the near list unchanged; the low tier unchanged.
- `groundHexParams.test.ts`, `terrainTexture.test.ts`: the far-sward constants as
  literals; `farSwardWeight` at literal points; the four uniforms on the UBO list,
  in the non-UBO string and bound; the far pull's GLSL pinned as substrings, after
  the near pull; `terrainGust` in lockstep with `windParams.ts`.
- `foliagePlugin.test.ts`: `FOLIAGE_LEAN`, `FOLIAGE_HUG`, `FOLIAGE_HUG_RAMP`,
  `FOLIAGE_ROOT_BAND` in lockstep with the GLSL; `FOLIAGE_TILT` gone from both; the
  `foliageGrad` and `foliageCover` attributes declared for hugging and tinting card
  profiles only; the lean's lines pinned; `foliageMipAlpha`, `foliageCutoff` and
  `foliageAlbedoSize` bound; a card material's `alphaCutOff` 0 with the plugin
  attached.
- `shaderHygiene.test.ts` covers every new GLSL file unchanged.
- The mip tool's own test under `tools/`: a synthetic mask whose coverage per box
  mip is known, and the scale it prints.

## 12. Gates

### 12.1 Fullness

Paired stills, control against branch, at both poses (§4.1), with the
isolation. **Bar, after every step: cover ratio ≥ 0.62 (canopy) and ≥ 0.94
(meadow); canopy near cover ≥ 0.45; luminance ratio in 0.8–1.25 at both.** Step
1's stills are also compared pixel for pixel with the same build's filter
switched off on the same page (a gate-only switch): culling must be invisible,
the mean absolute difference no larger than between two consecutive stills with
the filter off. Step 1's gate also holds the draw-call count at the control's
160–164 and reports the filter pass's JS time over the walk and the turn.

### 12.2 Regression stills

- Step 2: the far crop at both poses, control against branch (§6.6); a row
  profile of the bare-ground still over 20–40 m, with no step.
- Step 4: a still at the canopy pose at pitch 0.6, where the ground at 5–8 m
  fills the lower third.
- Zero console errors on every page.

### 12.3 Frame

The near-grass method (its design §8.3, verification §4.5), unchanged: one
browser start per round; a discarded warm-up page; the two builds on fresh pages
in alternating order, at least two rounds each way; same-code rounds for the
noise floor, repeated if over 0.5 ms; only **quiet** rounds read (every page
within 0.5 ms of its build's lowest mean at that pose); per page the pose, 3 s to
settle, 8 s of `onAfterRenderObservable` intervals, mean and p95.

**Bar: the order-averaged delta, branch minus control, is ≤ −0.8 ms at the
canopy pose at native pixels by the end of step 4**, the control unculled as it
ships. The 4× delta is reported beside it, read only from quiet rounds on
short, rested pages (the profile's drift, §4.4). Each step's gate reports its own
delta against the control and against the previous gate. Also reported, not
barred: the canopy pose at 4×; the meadow pose at native and 4×; the canopy pose
in a 1920 × 1080 window at native, the landscape view; the draw calls and JS
frame time. The GPU timer is read only as a sign (§4.4).

### 12.4 The look and the walks

A verdict in words per pose per gate: does the near field read as the same sward
as the mid field, does anything read as a card.

- **The turn** (step 1): at the canopy pose, a full turn in place in 32 steps at
  pitch 0.3 and again at 0.9, a still at each; then the same turn as a
  continuous sweep at 90° a second, stills every 0.25 s. Bar: nothing appears or
  vanishes at a frame edge between consecutive stills.
- **The walk** (every gate): the near-grass walk (its design §8.4).
- **The cut** (step 2): at the meadow pose's heading, twelve steps of 1 m toward
  +Z at pitch 0.1, a still at each. Bar: no line where the cards end, no density
  step, and the field reads continuous to the horizon.
- **The lean** (step 3): the turn again; bar as the turn, and no card reads as
  lying down at pitch 0.9.

## 13. Fallbacks

In order, each one constant:

- Step 1 under the 0.8 ms bar at native after 1a (and 1b): the margins narrowed,
  `CULL_MARGIN` 5° → 3° and `CULL_PUSHBACK` 1 → 0.5 m, with `CULL_TURN` 4° → 2°
  and `CULL_MOVE` 0.5 → 0.25 m (§5.4).
- The filter's JS time growing by more than the native frame shrinks: first the
  margins widened (10° and 2 m, thresholds 8° and 1 m, fewer passes); if it still
  shows, step 1c, the sectors (§5.6–§5.9).
- If 1c is taken and its JS time grows by more than the GPU frame shrinks: the
  blade fine tier's ring dropped (16 → 8 sectors a bucket, about 30 fewer draws).
- A sector popping at a frame edge: `SECTOR_PAD_XZ` 1.0 → 1.5.
- Step 2 showing a line at the cut: the far out-band (26, 30) → (24, 30) and the
  terrain band [24, 30] → [22, 30]; a mid crop moved by the change: the reverse.
- Step 2's far crop darker or lighter than the control past ±10 %: `FAR_SWARD`
  refitted; if the look reads as paint, `FAR_SWARD_MAX` 0.8 → 0.6.
- Step 3 reading as cards lying down at the feet: `FOLIAGE_LEAN` 0.5 → 0.35;
  too weak (near cover not up): → 0.7.
- Step 4 lifting luminance out of its window: `FOLIAGE_ROOT_BAND` 0.35 → 0.25;
  cards reading too heavy at 5–8 m: `foliageMipAlpha` halved.

## 14. Follow-ups

- The forest's buckets, pinned always active for the same reason as the clutter's
  (`forestMeshes.ts:234`), filtered the same way if their measured cost warrants.
- The same filter for the flower and bush buckets, if their measured cost
  warrants.
- Per-blade compute culling, if the spike goes (§9.4).
- Shells on the 0–4 m ring, only if the near field still reads thin after steps 3
  and 4.
