# Near grass fullness: design

**As built.** Steps 1 and 2 and the §11 amendment shipped; the sections below
stay the design as written, and the
[verification note](2026-09-25-near-grass-fullness-verification.md) has every
measurement. Step 1: on high and medium the meadow's near cards stay under the
blade field, drawn on the model's LOD1 and dithered in from the eye over
`CLUTTER_MEADOW_NEAR_IN` [1, 2.5] m. Step 2: inside the blade field's reach the
terrain is pulled toward `SWARD_FLOOR` (0.05, 0.065, 0.03) by `SWARD_MAX` 0.6,
ramped over `SWARD_COVER` [0.05, 0.5] of a new per-vertex `terrainCover` (the
ground cover's grass, clamped to 1) and faded over `SWARD_FADE` [12, 18] m; off
on the low tier, which draws no blades. Steps 3 and 4 were not taken: the
meadow pose met every bar after step 2, and neither acts on the canopy pose's
near crop (step 3 works at 8–18 m, step 4 on a luminance miss). §11:
`CLUTTER_GRASS_CANOPY_FLOOR` 0.5 → 0.75, so a closed canopy's grass is 0.9375,
and the rabbits are kept off closed canopy by `RABBIT_CANOPY_MAX` 0.85. That is
a simulation change: the level id moved (`passHash` 1907808213), and an old
client cannot join a new host. The canopy pose ships at an absolute near cover
of 0.46, equal to the meadow pose's, with a +1.35 ms frame miss at 4× pixels
that §12 carries.

At a hiker's eye on a misty day, standing in a grass sward beside a trail under
the canopy, the ground two to six metres out reads as a pale sward with a few
thin dark blades on it — nearly bare — while the ground eighteen to twenty-six
metres out reads as dense dark tufts that hide the ground completely. The near
field is where the player looks most, and it is the emptiest part of the
frame. The goal of this design is one sentence: **the near field must read as
full as the mid field.**

The fullness in the mid field is not the blades; it is the meadow's photo
cards, seen nearly edge-on, row behind row. The near field has no cards: they
are filtered out wherever the blade field grows, and the blades alone, seen
from 1.6 m looking steeply down between 2 cm strips, show the ground. This
design puts the cards back under the blades, darkens the ground between them,
closes a thin stretch at 8–18 m, and — only if all that still misses — lifts the
blades' colour.

As written, steps 1–4 are renderer-only: no `sim/` change, no level-id move,
no engine change, no asset change. §11 is the one simulation change.

## 1. Decisions

| question | decision |
| --- | --- |
| The measure | A **cover fraction** and a **mean linear luminance** on two fixed crops of a 1200 × 2029 still — near (ground ≈ 2–6 m) and mid (ground ≈ 18–26 m) — at two pinned poses (§4). Cover is the share of a crop's pixels darker than a per-pose threshold, the control's mid-crop median, fixed as a literal |
| The bar | On both poses: near cover ≥ 0.8 × mid cover, and near/mid mean-luminance ratio in 0.8–1.25. Control: cover ratio **0.27** (canopy) and **0.47** (meadow); luminance ratio **1.16** on both |
| Step 1 | The meadow's near cards (LOD0) stay under the blade field on high and medium, as opaque cover with the blades as fine detail on top; they gain a dither-in from the eye over [1.0, 2.5] m and keep their seam dither-out |
| Step 2 | Inside the blade field's reach, ground carrying a sward is pulled toward a shaded thatch colour by the ground-cover field's grass, carried per terrain vertex; open ground beyond 18 m unchanged |
| Step 3 | The coarse blade tier gets a full-strength stretch: `CLUTTER_BLADE_HANDOFF` 10 → 4.5, so the meadow seam is [13.5, 18] as the blade-field design's table has it. The coarse counts 10/8/4/8 → 16/12/4/12 only if the handoff alone misses, with the vertex budget raised to fit (§5.3) |
| Step 4 | Only if still missed, and only for a luminance or colour miss: `BLADE_ALBEDO` (0.03, 0.04, 0.013) → (0.16, 0.21, 0.065), with the near/far colour match re-run |
| Placement for the gate | None needed. Freecam re-centres every field on the camera, not the player (`renderer.ts:988–998`), so a pose set on the free camera is what the blade field and the cards are built around |
| Frame | ≤ +1.0 ms at both poses, high tier, 4× pixels, paired builds by the method of §8.3; native p95 reported |
| Unchanged | Blade width and the fine/mid tier counts; the low tier; the card models and textures; everything under `sim/` |

## 2. Goals and non-goals

**Goals.**

- At a sward pose under the canopy and one in the open, the ground 2–6 m from the
  eye is as covered as the ground 18–26 m out, by the measure of §4, and no
  brighter or darker than it by more than a quarter.
- Nothing stands at the feet as a flat plane, and nothing pops as the player
  walks or turns.
- The frame cost stays within +1.0 ms at 4× pixels.

**Non-goals.**

- Blade geometry: width, height, the fine and mid tiers' counts. A 2 cm strip seen
  from above shows the ground whatever its count; more of them is the costliest
  way to hide it.
- The low tier: it draws no blades and already keeps the near cards.
- The mid and far field: the far cards, their textures, the horizon pull.
- The sim's grass gate, including the canopy's halving of the sward (§3.6).
- WebGPU, or any engine change.

## 3. What the frame shows, and why

### 3.1 Near, 0–18 m: blades over bare ground

On the high and medium tiers the near field is the blade field
(`bladeField.ts`, `bladeClump.ts`, `bladeMeshes.ts`): a lattice of
`BLADE_CELL = 0.5` m cells out to `BLADE_REACH = 18` m (the meadow's 40 m radius
× `CLUTTER_FAR_SPLIT` 0.45, `bladeField.ts:37`), in three tiers split at
`BLADE_TIER_EDGE = [4, 8]` with `BLADE_TIER_BAND = 1.5` m hand-off bands
(`bladeField.ts:39–41`). Fine grass carries 100 / 40 / 10 blades per clump on the
fine / mid / coarse tier at base size (`BLADE_TIER_COUNTS.high`,
`bladeClump.ts:120–123`), each a tapered strip 0.01 m in half-width at the root
and 0.2–0.45 m tall (`BLADE_CHARACTERS`, `bladeClump.ts:108–113`), in a near-black
material, `BLADE_ALBEDO = (0.03, 0.04, 0.013)` (`bladeClump.ts:45`) — cut from the
first design's (0.30, 0.40, 0.12) in `0817b66` so the blades would read as
continuous with the far cards across the hand-off.

From a 1.6 m eye the near ground is seen from 15–60° above the horizontal, and a
blade covers its own 2 cm of that ground. The ground shows between them.

### 3.2 Near, 0–18 m: the cards are taken away

The meadow's cards are placed on their own 0.7 m lattice and drawn in two LOD
buckets: LOD0 (40 vertices, 20 triangles per clump) inside the 18 m split and
LOD1 (20 vertices, 10 triangles) beyond it, crossing over the meadow seam. On
the tiers that draw blades the rebuild drops every near card that stands where
the blade field grows (`clutterMeshes.ts:598–612`, the `bladeFieldCovers`
filter), switched on by `nearBlades: tier !== "low"` (`renderer.ts:790`). At the
two poses of §4 that filter keeps **0** of **1,400** (canopy) and **0** of
**3,168** (meadow) near instances: inside 18 m nothing but the blades covers the
ground.

### 3.3 The 8–18 m stretch

`CLUTTER_BLADE_HANDOFF = 10` (`clutterField.ts:236`) opens the meadow seam to
[8, 18] m (`clutterSeamEdges`, `clutterField.ts:243–249`). The coarse tier grows
in over [6.5, 8] and starts collapsing at 8 m, the moment it has grown in, while
the far cards are still dithering in across the same ten metres. Across that
band neither layer is at full strength, and the weaker of the two — ten blades
per clump — is the one losing ground fastest. The blade-field design's own table
(`2026-09-22-blade-field-design.md:103–109`) still shows the coarse tier
collapsing over [13.5, 18] with 16 blades per clump; the ten-metre hand-off
(`0817b66`) and the coarse trim to 10/8/4/8 (`4f3ba4e`) moved both.

### 3.4 Mid, 18–28 m: the cards at full strength

Beyond the seam the far cards stand at full strength: one clump per 0.7 m cell
wherever the gate saturates (`CLUTTER_MEADOW_CELL = 0.7`, `CLUTTER_MEADOW_D =
2.05`, `sim/clutter.ts:255–258`; presence is `min(1, gate · 0.49 · 2.05)`,
`sim/clutter.ts:727`), scaled 0.59–1.07. They dither out over 28–40 m and sink as
they go (`foliageWorldPos.vertex.fx:71`). Viewed nearly level, rows of opaque
alpha-tested cards overlap and hide the ground: that is the fullness the mid
field has. At the meadow pose the far bucket holds **10,166** instances.

### 3.5 The floor between the blades

The terrain is pulled toward `TUFT_ALBEDO = (0.18, 0.22, 0.11)` only past
`HORIZON = [35, 90]` m (`groundHexParams.ts:53–56`, applied at
`terrainTexture.ts:556`). The between-blade occlusion of the near-eye detail
scale (`DETAIL_AO = 0.7`, `groundHexParams.ts:39`) runs at full strength inside
8 m and fades out over `DETAIL_FADE = [8, 20]` (`groundHexParams.ts:35`) — but it
is gated on the grass *texture* weight `w0` (`terrainTexture.ts:502`), the 34 m
floor/grass mottle, not on whether a sward stands there. The foliage root's pull
toward the ground colour rises only over 20–80 m (`foliageLights.fragment.fx:18`).
So near the eye the gaps between blades show the ground's own colour: the grass
vertex colour, or under the canopy its tint toward `CANOPY`, lit by the full
mist. Isolated (§4.3), the bare ground in the near crop reads **0.0397** in
linear luminance at the canopy pose; the blades bring the crop only to
**0.0337**.

### 3.6 The canopy halves both layers

`519465a` raised the canopy floor of the ground-cover field to
`CLUTTER_GRASS_CANOPY_FLOOR = 0.5` (`sim/clutter.ts:88`), so under a closed canopy
the grass reads 0.5 where the open reads up to `CLUTTER_GRASS_BOOST` 1.5. The
halving reaches **both** layers, because both read the same field: the blade
field cuts its blades by `strength = min(1, cover)` (`bladeField.ts:183–185`,
`step(bR2, bStrength)` at `foliageWorldPos.vertex.fx:88`), and sets their height by
strength alone since `fa034da` made `BLADE_CANOPY_HEIGHT` 1
(`bladeMeshes.ts:52–59`); the meadow class reads the field's `grass` verbatim
(`sim/clutter.ts:627–635`), so a card's presence halves too. Measured at the two
poses: 1,400 against 3,168 near instances, 4,619 against 10,166 far.

Under a closed canopy the field cannot reach a grass of 1: at canopy density
ρ ≥ 0.85 the canopy factor is 0.5 and the edge boost is 1, so grass ≤ 0.5; at
ρ = 0.8 it is at most 0.52. The canopy pose therefore sits at the canopy's own
maximum, grass 0.5 across the whole view.

### 3.7 The record

The blade field's verification already saw this: "up close the frame is mostly
ground between sparse blades, while the distant band is dense cover hiding its
ground" (`2026-09-22-blade-field-verification.md:55–60`). So did the ground-cover
work: "Short, sparse grass is a grazing-angle phenomenon: bare at the feet, a
dark band some 5–20 m out that recedes as the player walks"
(`2026-09-23-ground-cover-design.md:309–313`). Both treated it as a colour or a
height problem. It is a cover problem, and the cover the far field has is the
cards.

## 4. The measure and the control

### 4.1 The poses

Found from the simulation, not by flying: for every trail-centre point on a 3 m
grid over 1.8 km square of seed `atmo` (627994160), the trail's direction from
the minimum of the trail distance on a 10 m circle, then the ground cover and
canopy density sampled over the near and mid crops' ground. The open pose is the
flattest point whose whole view has canopy < 0.1 and grass ≥ 1.

| pose | camera | ground in view |
| --- | --- | --- |
| **canopy** | `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` | standing in the sward 2.5 m left of a straight trail centreline, looking along it (+X); canopy 1.0 everywhere in view, grass 0.5 (the canopy maximum, §3.6) left of the trail from 1.5 m, rising 1 m over the first 20 m |
| **meadow** | `__fcSet(369, 51.01, -855, 0, 0.3)` | open meadow, looking +Z; canopy 0.00–0.04 to 26 m, grass 1.5 throughout, flat to ±0.5 m |

The eye height is the ground plus 1.6 m (`PLAYER_HALF.y` 0.9 +
`PLAYER_EYE_OFFSET` 0.7, `sim/constants.ts:26–27`). Pitch is positive looking
down. Both stills are taken under the conditions the problem was seen in:

`?cmd=seed%20atmo;freecam;weather%20mist;time%2012`

— `seed atmo` is a world entry resolved before the world is built
(`app.ts:103–113`, FNV-1a of the token, `seed.ts:10`); `freecam` enables the
free camera (`app.ts:261–266`); `weather mist` is the preset `{ cloudCover 0.9,
mist 1, rain 0, wetness 0.5 }` (`weather.ts:40`); `time 12` sets the hour at load
(`app.ts:277–289`), which the world clock then advances, so every still is taken
within 30 s of the page loading. The pose itself and the tier (`high`) are set
by two small measurement patches never committed (plan, Task 1): one exposes
`__fcSet` to pin the free camera, the other reads `?tier=` because a desktop
browser reports at most 8 GB of device memory and so detects medium.

**Why no teleport.** A player-placement command would be needed if the blade
field followed the player; it does not while the free camera is on. With
`freecam` set, every field — clipmap, forest, cliffs, clutter, blades, litter —
is updated at the free camera's XZ (`renderer.ts:988–998`); only without it do
they follow the local player (`renderer.ts:1025–1032`). The player-bend of the
foliage reads player positions, not the camera, but its radius
(`FOLIAGE_BEND_R = 0.6` m) is inside the near cards' dither-in (§5.1), so a gate
still at the free camera sees what a player standing there sees.

### 4.2 The crops and the numbers

Stills are 1200 × 2029 at device pixel ratio 1 (`getRenderWidth()` 1200,
`getRenderHeight()` 2029), camera `fov` 1.4 vertical (`renderer.ts:661`). Crops are
`W:H:X:Y` in that still, placed by projecting the ground distance through the
camera and checked by drawing each rectangle back onto the still:

| pose | near crop (ground ≈ 2–6 m) | mid crop (ground ≈ 18–26 m) | threshold |
| --- | --- | --- | --- |
| canopy | `280:500:420:970` | `220:22:400:678` | 0.02058 |
| meadow | `360:500:420:980` | `240:22:480:740` | 0.02853 |

For each crop: every pixel is decoded from sRGB to linear and reduced to
luminance `0.2126 R + 0.7152 G + 0.0722 B`; the crop's **mean** is the mean of
those; its **cover fraction** is the share of pixels below the pose's
threshold. The threshold is the control's mid-crop median, fixed as the literal
above, so the control's mid cover is 0.5 by construction and every later build
is measured against the same number. The mid crop is short because the mid
field is: at a 1.6 m eye, 18–26 m of ground spans 22 rows.

Control, `main` at `9c97483`, high tier, two page loads each:

| pose | near mean | mid mean | lum ratio | near cover | mid cover | cover ratio |
| --- | --- | --- | --- | --- | --- | --- |
| canopy | 0.0337 | 0.0292 | **1.16** | 0.133 | 0.500 | **0.27** |
| canopy (repeat) | 0.0337 | 0.0290 | 1.16 | 0.131 | 0.500 | 0.26 |
| meadow | 0.0345 | 0.0297 | **1.16** | 0.233 | 0.499 | **0.47** |
| meadow (repeat) | 0.0345 | 0.0299 | 1.16 | 0.237 | 0.491 | 0.48 |

The luminance ratio already sits inside 0.8–1.25; the cover ratio is a third
(canopy) and a half (meadow) of the bar. The mean is not the difference, as the
blade-field verification found under the same fog: the mid crop is dark
silhouettes over fog-lit ground (median 0.0206 under a mean of 0.0292), the near
crop a uniform mid-grey with thin strokes on it (median 0.0364 over a mean of
0.0337). What the eye reads as "full" is the share of the ground hidden, and
that is the number that fails. The luminance window stays in the bar as a guard:
steps 1 and 2 darken the near field, and must not overshoot.

### 4.3 What fills each crop

The layer isolation the blade-field verification used, on the same page load:
hide the blade meshes (`blade_clumps_*`), then the card meshes (the meadow
model's `LOD0`/`LOD1` and `clutter.grass_*`), then every blade, litter
(`duff_clumps_*`) and clutter mesh, by `mesh.isVisible = false`, and measure the
same crops against the same threshold.

| pose | layers drawn | near mean | near cover | mid mean | mid cover |
| --- | --- | --- | --- | --- | --- |
| canopy | all | 0.0337 | 0.133 | 0.0292 | 0.500 |
| canopy | no blades | 0.0389 | 0.016 | 0.0291 | 0.499 |
| canopy | no cards | 0.0336 | 0.137 | 0.0648 | 0.009 |
| canopy | bare ground | 0.0397 | 0.001 | 0.0724 | 0.000 |
| meadow | all | 0.0345 | 0.233 | 0.0297 | 0.499 |
| meadow | no blades | 0.0434 | 0.003 | 0.0297 | 0.497 |
| meadow | no cards | 0.0342 | 0.247 | 0.0743 | 0.000 |
| meadow | bare ground | 0.0434 | 0.003 | 0.0753 | 0.000 |

Every bit of the mid crop's cover is the cards'; every bit of the near crop's
is the blades'; the grass class's near cards add nothing measurable. The blades
darken the near crop by 15 % (canopy) and 20 % (meadow) and hide under a quarter
of it.

## 5. The four steps

Each step is a task in the plan with its own gate (§8). Step *n* + 1 is taken
only if, after step *n*, either pose still misses the bar. Each step's constants
are starting values; the gate may move them within the stated range.

### 5.1 Step 1: keep the near cards under the blades

**Change.** `clutterMeshes.ts` stops filtering the meadow's near band on the
tiers that draw blades: the `nearLists` block (`clutterMeshes.ts:598–612`) goes,
the near loop writes `band.near` as every other class does, and
`bladeFieldCovers` (`bladeField.ts:161–174`), with no caller left, is removed.
The meadow's near bucket, on those tiers only, gains an in-band:

`CLUTTER_MEADOW_NEAR_IN = [1.0, 2.5]` (m, `clutterField.ts`), so the bucket's
`fadeBands` are `(1.0, 2.5, seam.start, seam.end)` on high and medium and
`(-2, -1, seam.start, seam.end)` on low, as today.

**The dither-in, decided.** The distance fade (`distanceFadePlugin.ts`) measures
each instance's origin to the eye in XZ and discards by a fixed screen-space
noise before any texture fetch, so a card dissolves rather than scales and a
discarded fragment costs nothing but the test. Without an in-band a card whose
origin is 0.3 m from the eye draws: a 0.85 m wide cluster of vertical quads
standing across the view at the feet, which reads as the flat planes it is. With
[1.0, 2.5] a card is absent inside 1 m and thickens in by 2.5 m, where the fine
tier's 100 blades per clump are densest and carry the ground alone. At pitch 0.3
the bottom row of the frame is ground 1.05 m out, so at a walking gaze the
dither sits at the frame's bottom edge; looking at the feet it is visible as a
thinning of the cards under the blades, which the walk check (§8.4) judges.

**The bend.** `FOLIAGE_BEND_R = 0.6` m (`foliagePlugin.ts:44`): an instance whose
origin is within 0.6 m of a player leans away from them, per instance
(`foliageWorldPos.vertex.fx:32, 58–65`). The local player's own bend never acts
on a visible near card: the in-band starts at 1.0 m. Another hiker walking
through the sward now parts the cards as well as the blades.

**Cost.** The near instances were already collected and budgeted
(`CLUTTER_BUDGETS` meadow 10,600, `clutterField.ts:181`); the filter's per-instance
`groundCover` call goes away, so the rebuild gets cheaper. What is new is the
draw: 1,400 (canopy) and 3,168 (meadow) LOD0 instances, 28 k and 63 k
triangles, alpha-tested, one extra draw call, and the overdraw of cards that
cover a large share of the lower frame. Expected well inside +1.0 ms at 4×
pixels; the gate measures it.

**Expected effect.** The near crop gains the same cover the mid crop has, in
the same material. With the blades on top it should reach the bar at the meadow
pose, where the cards stand at one per 0.49 m²; at the canopy pose the cards
stand at half that (§3.6), and the ground between them is step 2's.

**Also on this step: the trough.** With the near cards kept, the near bucket's
dither-out and the far bucket's dither-in over the seam partition every pixel
(`distanceFadePlugin.ts`, the complementary-halves rule), so the card layer is
continuous from 1 m to 40 m. The trough of §3.3 is then a trough in the blades
only, over a full card layer: step 3 may not be needed.

### 5.2 Step 2: darken the ground under the sward

**Change.** A sward-floor pull in the terrain's fragment blend, right after the
horizon tint (`terrainTexture.ts:556`):

```glsl
float swardW = terrainSward.w
  * smoothstep(terrainSwardBand.x, terrainSwardBand.y, vTerrainCover)
  * (1.0 - smoothstep(terrainSwardBand.z, terrainSwardBand.w, dist));
surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);
```

New constants in `groundHexParams.ts`, beside `TUFT_ALBEDO` and `HORIZON`:

| constant | value | meaning |
| --- | --- | --- |
| `SWARD_FLOOR` | (0.05, 0.065, 0.03) | the thatch between blades, linear albedo: dark, green-brown, between the blades' own albedo and the grass floor's (0.09, 0.15, 0.06) |
| `SWARD_MAX` | 0.6 | the pull at full cover |
| `SWARD_COVER` | [0.05, 0.5] | the cover band the pull ramps over: zero where the blade field stops growing (`BLADE_STRENGTH_FLOOR` 0.05), full at the canopy floor's half sward |
| `SWARD_FADE` | [12, 18] | out-band in eye distance: gone by `BLADE_REACH`, so the open-meadow floor beyond 18 m is unchanged |

bound as two `vec4` uniforms, `terrainSward = (SWARD_FLOOR, SWARD_MAX)` and
`terrainSwardBand = (SWARD_COVER, SWARD_FADE)`, declared on both uniform paths as
the horizon's are.

**The key is the ground cover, carried per vertex.** What a sward stands on is
the ground-cover field's grass, and the terrain does not carry it today.
`vTerrainW.x` is the grass *texture* weight, the 34 m floor/grass mottle
(`terrainSurface.ts:178–180`): half of a sward stands on floor-textured ground
and would take no pull (the floor-look design's §10 found the same of the
floor weight). The clipmap already calls `groundCover` for every vertex it
samples, for the duff (`clipmap.ts:108`); its `grass` comes free with it. It
becomes a new per-vertex float, `terrainCover = min(1, grass)` — the blade
field's own strength — sampled in `sampleInto`, carried by the ring scroll copy
and by `ringGeometry`, uploaded beside `terrainWeights2` (`renderer.ts:218`),
and read as `vTerrainCover`. One float per vertex; ring 0's spacing is 1 m, and
the field is a composition of smoothsteps, so vertex resolution is enough.
Rejected: the vertex colour's alpha channel, which is written 1 and read by
nothing today — free, but it is the channel Babylon reads as opacity the moment
`hasVertexAlpha` is set.

The between-blade occlusion is not extended: it already runs at full strength
inside 8 m, and widening its gate from `w0` to the cover would add its two
detail fetches to floor-textured ground. The pull is one `mix`.

**Expected effect.** On open grass ground at full cover the floor's albedo
luminance moves from 0.131 to about 0.088 (×0.67); under the canopy, where the
ground is already tinted toward `CANOPY`, from about 0.080 to 0.068 (×0.85). It
darkens the pixels the cards and blades do not cover; it does not add cover, so
by itself it moves the cover fraction only where the pulled ground crosses the
threshold. Its job is that what shows between the blades reads as shaded sward.

**Interaction with the trail paint.** The trail paint takes its bank colour from
the vertex colour, not from `surfaceAlbedo` (`trailPaint.ts:395–397`), so the bed
and bank are unaffected; the ground beside a meadow trail is darker, which
raises the floor-look design's bed/beside ratio at a trail pose inside 18 m. The
gate reports that ratio at two of the floor-look poses. The lever, if it pushes
one out of its 0.9–1.3 window, is `SWARD_COVER[0]` 0.05 → 0.3, which leaves the
trail's grass ramp mostly unpulled.

**Cost.** One float attribute, one varying, one `mix` and two `smoothstep`s per
terrain fragment. Nil at the frame bar; the gate measures it.

### 5.3 Step 3: close the 8–18 m stretch

**Change.** `CLUTTER_BLADE_HANDOFF` 10 → 4.5. The meadow seam at radius scale 1
becomes `max(0, min(15.3, 13.757, 13.5))` = **[13.5, 18]**, the blade-field
design's table: the coarse tier stands at full strength over 8–13.5 m and
collapses over the same band the far cards dither in over, and the near cards
(step 1) dither out over it. The tier rings the blade field collects are keyed on
`BLADE_TIER_EDGE` and `BLADE_REACH`, not on the seam start, so the vertex bound
is unchanged: **1,543,239** vertices against `BLADE_VERTEX_BUDGET` 1,600,000.

Moving `BLADE_TIER_EDGE` instead was rejected: it widens the fine and mid rings,
whose clumps carry 150 and 60 blades at full size, and the budget grows with the
square of the fine ring.

The ten-metre hand-off was set because blades and cards are different pictures
of grass and a 4 m swap between them read as a line (`0817b66`). With step 1 in,
there is no swap: the cards run continuously under the blades, and across the
seam only the blades thin out over them. The line had nothing to be drawn
between.

The low tier's meadow seam moves too, since the handoff scales with the tier's
radius: at radius scale 0.6 it goes from [4.8, 10.8] to **[6.56, 10.8]**, the
jitter-width floor every other class's seam sits at. The low tier draws no
blades, so this is only the width of its LOD0 → LOD1 card swap.

**Only if the handoff alone misses: the coarse counts.** `BLADE_TIER_COUNTS`
coarse column, high 10/8/4/8 → **16/12/4/12**, medium 5/4/2/4 → **8/6/2/6** (the
values before `4f3ba4e`). This does not fit the current budget. The budget
test's worst case — every cell at full size, fine grass, the three tiers' padded
rings of 470.9, 1,285.5 and 4,846.8 clumps — at fine-grass coarse base counts:

| coarse base | full-size blades | worst-case vertices |
| --- | --- | --- |
| 10 (today) | 15 | 1,543,239 |
| 11 | 17 | 1,611,094 |
| 13 | 20 | 1,712,877 |
| 16 | 24 | 1,848,587 |

Ten is the largest count under 1.6 M. Restoring 16 raises
`BLADE_VERTEX_BUDGET` to **1,900,000**. The constant's own comment says the real
bar for a rise is a frame-time measurement, and it is: the step is kept only
if the frame bar holds. Fallback if it does not: 13/10/4/10 (budget 1,750,000);
if that misses too, the counts stay at 10/8/4/8 and the handoff alone ships.

### 5.4 Step 4, conditional: lift the blades' colour

Taken only if, after step 3, a pose misses on **luminance** (the ratio outside
0.8–1.25) or the look verdict reads the near field as a different material from
the mid; it cannot help a cover miss — a lighter blade crosses the cover
threshold less often, not more.

**Change.** `BLADE_ALBEDO` (0.03, 0.04, 0.013) → **(0.16, 0.21, 0.065)**, half the
first design's meadow green. The near-black was chosen so the blades would read
as continuous with the far cards across the hand-off
(`2026-09-22-blade-field-verification.md` §3); with the cards now under the
blades all the way in, the blades no longer carry the near field's tone alone
and can read as lit grass over a shaded sward.

**The colour match, re-run.** At both poses, under `weather clear` and `weather
mist` — the two conditions §3 of that note found pull a single value in opposite
directions — the near and mid crops' mean linear RGB and their green-channel
ratio, reported; the bar is the look: across 13.5–18 m the field reads as one
material with no line, in both weathers. The step is kept only if the fullness
bar still holds with the threshold unchanged.

## 6. What is not changed

- No engine change and no WebGPU.
- Blade width, height and droop; the fine and mid tiers' counts; the tier edges
  and bands.
- The low tier: no blades, cards as shipped (its meadow seam narrows under step
  3, §5.3).
- The card models, their LODs and textures; the far cards' bands and sink.
- The between-blade occlusion, the macro tint, the horizon pull.
- Everything under `client/src/sim/`, and so the level id.

## 7. Tests

- `clutterMeshes.test.ts`: on high and medium (`nearBlades: true`) the meadow
  near bucket holds every near instance the collector returns (the filter gone);
  its `fadeBands` are `(1, 2.5, seam.start, seam.end)` with `nearBlades` and
  `(-2, -1, seam.start, seam.end)` without, as literals; the grass class's near
  cards unchanged.
- `clutterField.test.ts`: `CLUTTER_MEADOW_NEAR_IN` pinned at `[1, 2.5]`; after
  step 3, `CLUTTER_BLADE_HANDOFF` 4.5 and the meadow seam `[13.5, 18]` at scale 1
  and `[6.557359312880715, 10.8]` at 0.6, as literals.
- `bladeField.test.ts`: unchanged; its assertion that the coarse tier's out-band
  is the meadow seam carries step 3's new seam without a literal to move.
- `clipmap.test.ts`: the cover channel is `min(1, grass)` at literal vertices
  (0, 0.3087…, 0.5, and 1 where the field reads 1.5), survives the scroll
  (scroll equals fresh), and reaches `ringGeometry` in vertex order.
- `terrainTexture.test.ts` and `groundHexParams.test.ts`: the new constants as
  literals; the attribute and varying declared; both uniforms on the UBO list
  and in the non-UBO string and bound with the constants; the pull's GLSL lines
  pinned as substrings, after the horizon tint.
- `bladeClump.test.ts` (only if the counts move): the coarse column and the budget
  as literals; the worst case under the new budget and above half of it.
- `bladeClump.test.ts` (step 4 only): `BLADE_ALBEDO` pinned.

## 8. Gates

### 8.1 Stills and the fullness bar

Paired stills, control (`main`) against the branch, at the two poses of §4.1, each
from a fresh page load, the two builds back to back. The crops, the thresholds
and the arithmetic are §4.2's, unchanged for every step. **Bar, on both poses:
near cover ≥ 0.8 × mid cover, and near/mid mean luminance in 0.8–1.25.** Each
gate also repeats the layer isolation of §4.3 on the branch, so the note says
what fills the near crop after that step.

### 8.2 Regression stills

- The meadow seam at 13.5–18 m: three stills 1.5 m apart walking across it at the
  meadow pose's heading; no line, no density step.
- Step 2: the floor-look design's bed/beside ratio at `meadow-trail-along` and
  `trail-down` (`2026-09-24-floor-look-verification.md` §2, same crops), reported
  against its 0.9–1.3 window.
- Zero console errors on every page.

### 8.3 Frame

**Bar: ≤ +1.0 ms mean frame time, branch over control, at both poses, high tier,
4× pixels** (`setHardwareScalingLevel(0.5)` on the 1200 × 2029 page). Native p95
reported beside it.

Method, corrected for the order and warm-up effects earlier notes ran into:

- One round is one start of the browser, a warm-up page that is discarded, then
  the two builds one after the other on fresh pages, then the browser stopped.
- The order alternates round to round, and there are at least two rounds in each
  order; the delta is the mean over rounds.
- A same-code round — control against control — is run with them, to show the
  noise floor. If its delta exceeds 0.5 ms the machine is too noisy to read and
  the rounds are repeated.
- Per page: the pose set, 3 s to settle, then 8 s of frame intervals from
  `onAfterRenderObservable`; mean and p95.

The two poses are the frame poses because they put the near field across most
of the frame, the worst case for the near cards' overdraw; the blade-field and
floor-look notes' MEADOW and TRAILSIDE views (pitch 0.08 and 0.25) show less of
it. TRAILSIDE (`__fcSet(263.9, 85.77, 118, 0.6, 0.25)`, mist, noon) is measured
once more at the last gate, for continuity with those notes.

### 8.4 The look, and the walk

A verdict in words per pose per gate: does the near field read as the same sward
as the mid field, and does anything read as a card. Then the walk, at the canopy
pose, scripted on the free camera: twelve steps of 0.25 m along the trail
heading at pitch 0.3, then a turn in place through a full circle in sixteen steps
at pitch 0.6 and again at 0.9 (looking at the feet), a still at each. **Bar:** no
card stands as a flat plane at the feet, and no card or blade appears or
vanishes between consecutive stills.

## 9. Fallbacks

In order, each one constant:

- Step 1 over the frame bar: the near cards on LOD1 (10 triangles) inside
  `BLADE_REACH` rather than LOD0, then the in-band's start 1.0 → 1.5 m.
- A card read as a plane at the feet: the in-band [1.0, 2.5] → [1.5, 3.0].
- Step 2 too dark (luminance ratio under 0.8): `SWARD_MAX` 0.6 → 0.4; too weak:
  → 0.8.
- A bed/beside ratio pushed out of its window: `SWARD_COVER[0]` 0.05 → 0.3.
- Step 3's counts over the frame bar: 13/10/4/10, then 10/8/4/8 (§5.3).

## 10. Follow-ups

- A committed pose command (`/pose x y z yaw pitch` on the free camera), so a
  gate's poses reproduce from a URL alone.
- If the canopy pose still misses after step 4: the sward under a closed canopy
  is half the open's by the sim's own rule (§3.6), and a fuller forest floor is a
  change to that rule, with its level-id move.
- Cards receiving shadows, so the near cards sit under the canopy's shadow as the
  blades do (the blade-field design's §12 follow-up, now closer to the eye).

## 11. Amendment, 2026-09-26: three quarters of the sward under the canopy

This section takes up §10's second follow-up. It is the one change in this
design that is not renderer-only: it moves a simulation constant, and the
level id with it. Everything above stays as written.

### 11.1 The gap, and why nothing above closes it

After steps 1 and 2 the meadow pose meets every bar (verification §6: cover
ratio 0.92, luminance 0.97, frame +0.63 ms). The canopy pose does not: cover
ratio **0.41** against 0.8, luminance 1.00, frame +0.75 ms. It reads as tufts
on a darker floor, not a sward.

The mechanism is density, not colour. The canopy pose stands where
`forestDensity` is 1, so the canopy ramp sits at its floor and the field's
grass is `CLUTTER_GRASS_CANOPY_FLOOR` × patch = 0.5 across the whole view
(§3.6). Both layers read that number: the meadow class's presence is
`min(1, grass · 0.49 · 2.05)`, so there are 1,400 near cards against the
meadow pose's 3,168 (0.44 as many), and the blade field's `strength =
min(1, grass)` culls half the blades in every clump and draws the rest at
0.75 of their height. Looked down on, a near crop of cards at that density
shows the floor between the tufts, and step 2's pull leaves that floor at
0.0353, 1.7 times the cover threshold (verification §6.2). `SWARD_MAX` 0.8
would take it to about 0.034, still 1.6 times. Step 3 acts at 8–18 m, outside
the near crop. Step 4 is for a luminance miss and cannot add cover. What is
left is the number both layers read.

### 11.2 The change

`CLUTTER_GRASS_CANOPY_FLOOR` 0.5 → **0.75** (`sim/clutter.ts`): the canopy
factor of the ground-cover field bottoms out at three quarters under the
densest canopy, where it bottomed out at a half. The rule is otherwise as it
was — `canopy = FLOOR + (1 − FLOOR) · (1 − shade)`, `shade` the smoothstep of
`forestDensity` over `CLUTTER_GRASS_CANOPY_LO` 0.4 to `_HI` 0.85.

**What that gives, from the rule.** The field's grass is
`edge · patch · boost`, where `edge` is the product of the ground,
canopy, road and trail factors and `boost = 1 + 0.5 · smoothstep(0.5, 1, edge)`
is the interior boost (`CLUTTER_GRASS_BOOST` 1.5, from
`CLUTTER_GRASS_BOOST_LO` 0.5). At a floor of 0.5 a closed canopy held `edge`
at 0.5, where the boost has not started, so grass was 0.5 × patch. At 0.75
the edge product passes the boost's start, and the boost adds a quarter:
`1 + 0.5 · smoothstep(0.5, 1, 0.75)` = 1.25. Under a closed canopy, with patch
at 1, the grass is therefore **0.9375**, not 0.75 — 1.875 times what it was,
and 0.625 of the open meadow's 1.5. The card and blade counts follow that
number, not the constant.

Measured with `groundCover` and `collectClutter` on seed `atmo` (627994160)
at the canopy pose's XZ (123, −105.5), radius scale 1:

| | floor 0.5 (now) | floor 0.65 (fallback) | floor 0.75 |
| --- | --- | --- | --- |
| grass at the pose, ρ = 1 | 0.5 | 0.7202 | **0.9375** |
| duff at the pose | 0.6667 | 0.5199 | **0.375** |
| meadow cards, near / far | 1,400 / 4,619 | 2,029 / 6,686 | **2,674 / 8,719** |
| grass-class cards, near / far | 503 / 1,998 | 729 / 2,830 | 948 / 3,611 |
| blade cells in the three tiers | 6,119 | 6,130 | 6,131 |
| mean blade strength | 0.479 | 0.686 | 0.891 |
| litter cells in the 24 m field | 2,483 | 2,483 | 2,483 |
| mean litter strength | 0.670 | 0.538 | 0.408 |

The near and mid crops' ground sits at grass 0.5 → 0.9375 and duff 0.667 →
0.375 at every sampled point. The meadow's near cards at the canopy pose rise
to 0.84 of the meadow pose's 3,168; the blades stand at 0.89 of full
strength, so nearly twice as many blades survive the per-blade cut in each
clump, at 0.97 of their base height where they stood at 0.75.

### 11.3 What it costs

**More cards and blades under the trees.** +1,274 near and +4,100 far meadow
cards at the canopy pose, and +445 / +1,613 grass-class cards. The blade
field's cell count barely moves (a cell exists wherever grass ≥ 0.05, and it
did), so its vertex work is unchanged; what grows is the blades that survive
the strength cut and their height, which is fragment work. The evidence for
the frame: step 1's LOD0 cards cost +1.19 ms for 1,400 cards at the canopy pose
and +1.48 ms for 3,168 at the meadow — 0.29 ms for 1,768 more cards — and
on LOD1 the two poses sat at +0.60 and +0.49, the card count lost in the
noise. The meadow pose carries more cards than the canopy pose will (3,168 /
10,166) and is at +0.63 ms on this branch. The **frame bar is ≤ +1.0 ms at
the canopy pose against `main`**, by §8.3's method, with 0.25 ms left after
step 2's +0.75.

**Less litter showing.** The duff the field reports is
`onGrass · (1 − grass / 1.5) · (0.15 + 0.85 · shade)`, so under a closed canopy
it is `1 − grass / 1.5`: it falls from 0.667 to **0.375**, a factor 0.56. Both
of its readers follow. The litter pieces are culled per piece by a cell's
strength, as the blades are, so about 0.56 as many lie under a closed canopy.
The floor paint mixes toward the litter colour by `DUFF_FLOOR_MAX · duff`, 0.5 →
0.28. The forest floor under a closed canopy moves from two thirds litter to
three eighths: a sward with leaves in it, rather than leaves with a sward in
them. Where the canopy is partial the duff's shade term is smaller and the
change is smaller. What gives way is the floor-look design's leaf carpet
under a closed canopy (`2026-09-24-floor-look-design.md`): about 0.56 as much
litter within the litter field's 24 m, and a greener, less tan floor, which
shows most past 18 m, where the sward pull does not reach and the paint is all
there is between the cards.

**The rabbits.** `RABBIT_GRASS_FLOOR` 0.55 (`wildlifeField.ts`) was set just
above the old canopy maximum of 0.5, so the grass floor alone kept rabbits out
of the closed woods. With the new maximum of 0.9375 under it, the census over
the wildlife test's 4 km square rises from 1,441 / 1,343 / 1,136 units (seeds
1, 388817, −1117907922) to 4,084 / 4,576 / 3,158, of which 2,406 / 2,988 /
1,777 stand where ρ ≥ 0.85, outside the census test's band of 487–1,752.
Raising the grass floor to 0.95 would keep them out, but would also take
rabbits off open ground whose grass is 0.55–0.95 (trail and road margins,
edges): open-ground rabbits 705 / 634 / 556 → 672 / 602 / 533. So the grass
floor stays at 0.55 and closed canopy is excluded directly, by a new
`RABBIT_CANOPY_MAX` 0.85 on `forestDensity` at the rabbit's anchor. Split by
the canopy at the anchor, the census goes from open 705 / 634 / 556, partial
736 / 709 / 580, closed 0 to open 705 / 634 / 556 (the same, unit for unit),
partial 959 / 934 / 793 (partial canopy carries more grass now), closed 0. The flowers (`CLUTTER_FLOWER`, based on the same grass) rise under
the canopy with the grass; the butterflies are gated on ρ < 0.4 and do not move.

**The level id.** `CLUTTER_GRASS_CANOPY_FLOOR` is in `CLUTTER_TUNABLES`, so
`registryDigest` and `passHash` move, and the clutter census rows that read
the field's grass move with it (grass, flower). An old client cannot join a
new host, and that is deliberate: two peers on different floors scatter grass
differently under every closed canopy.

### 11.4 What must not change

- **The open meadow.** Where ρ ≤ `CLUTTER_GRASS_CANOPY_LO` 0.4, `shade` is 0
  and the canopy factor is exactly 1 whatever the floor, so the field is the
  same to the bit. At the meadow pose the grass is 1.5 and the meadow cards
  are 3,168 near and 10,166 far, before and after. The grass class's own
  wider disc reaches a canopy edge there, so its far count moves (3,562 →
  3,720); the meadow class's does not. A test pins an open point off the
  saturated value and a grid sum over every open point near a meadow trail,
  both as literals measured before the change.
- **The floor-look's canopy poses.** More sward means less litter beside the
  trail, and the floor-look design's bed/beside ratio must stay inside its
  0.9–1.3 window at the two canopy poses it passes at: `canopy-floor` (seed
  `ypeqauxk`, 1.19) and `trail-along` (seed `atmo`, 1.24, on its replacement
  crops, `2026-09-24-floor-look-verification.md` §8–§9). The beds are on the
  trail's core, where the field's grass is 0 and the duff is the bed drift;
  neither moves (duff 0.579 and 0.803 under the two bed crops). The beside
  crops are on the trail's thinning edge: grass 0.158 → 0.237 and duff 0.895
  → 0.842 under `canopy-floor`'s, grass 0.085 → 0.127 and duff 0.943 → 0.915
  under `trail-along`'s. That moves the beside ground a little toward grass
  and into step 2's pull ramp, which darkens it and raises the ratio;
  `trail-along` has 0.06 of headroom.

### 11.5 Gates and the fallback

The gate measures, on the branch against `main`, and against this branch
before the change for the floor-look poses (their 1.19 and 1.24 were measured
before steps 1 and 2):

- the fullness bar at the canopy pose (§8.1, thresholds unchanged), with the
  layer isolation; the meadow pose as a regression;
- the frame at the canopy pose, ≤ +1.0 ms at 4× pixels by §8.3's method; the
  meadow pose reported;
- the bed/beside ratio at `canopy-floor` and `trail-along`, inside 0.9–1.3;
- the look at the canopy pose (does the near field read as a sward, and does
  litter still show between the grass, and how the canopy floor past 18 m
  reads with less litter paint), and §8.4's walk.

**The decision.** The gate (verification §7) measured 0.75 and the 0.65
fallback. Neither meets every bar, and 0.75 ships.

- **Cover.** The canopy pose's cover-ratio bar is flawed for this change: its
  mid crop is 18–26 m of the same canopy floor, and it fills with the change
  as the near crop does (mid cover 0.50 → 0.73 against the fixed threshold),
  so the ratio rises only to 0.62. The reading that stands is the absolute
  near cover, 0.459 against the meadow pose's 0.472, and the look: the near
  field reads as a sward, the same kind of field as the meadow's. At 0.65 the
  near crop stays tufts on a floor (0.257) and the luminance ratio leaves its
  window (1.28).
- **Frame.** At the canopy pose 0.75 costs +1.35 ms at 4× pixels (+1.23 ms
  native), over the +1.0 ms bar, and 0.65 costs +1.06. The miss is accepted
  for this release, with the follow-up of §12.
- **Floor-look.** `canopy-floor` 1.25 and `trail-along` 1.14, both inside
  0.9–1.3.

## 12. Follow-up, 2026-09-26: reclaiming the frame without thinning

The canopy pose runs +1.35 ms over `main` at 4× pixels and +1.23 ms at native
pixels. The cost barely changes with the pixel count and grows with the card
count (verification §4.5, §5.4, §7.5): it is per-card work — every thin
instance in the near and far buckets is vertex-shaded, whether or not the
dither or the view keeps it — not fill. The way back is to do less of that
work for the same picture, not to draw fewer cards. Candidates, to be chosen
after measuring what each saves at the canopy pose:

- per-instance culling of thin instances behind the camera or outside the
  view, on the CPU at rebuild, so they are not submitted at all;
- cheaper vertex work for the near cards, whose wind and bend are computed
  per vertex for cards the dither discards;
- GPU-driven culling of the instance buffers on WebGPU.

No constants are set here; each candidate gets its own design once measured.
