# Near grass fullness: verification

What is measured against the near-grass design's gates
([`2026-09-25-near-grass-fullness-design.md`](2026-09-25-near-grass-fullness-design.md),
§8), how, and what the numbers were. This note starts with the control; each
step's gate appends a section.

## 1. Method

**Builds.** Two checkouts on two ports, each serving its own build: the branch,
and a control detached at the `main` it branched from. Two small measurement
patches are applied to both for a gate and reverted after it; they are never
committed:

- a pose patch to `client/src/app.ts` and `client/src/game/renderer.ts` that
  exposes `__fcSet(x, y, z, yaw, pitch)`, pinning the free camera at a pose
  every frame (positive pitch looks down), and `__scene` / `__engine` for the
  layer isolation and the frame timing;
- a tier patch to `client/src/app.ts` that reads `?tier=low|medium|high`, because
  a desktop browser reports at most 8 GB of device memory and detection alone
  lands on medium.

With `freecam` on, every field — the blades, the cards, the litter, the terrain
— is built around the free camera, not the player (`renderer.ts:988–998`), so a
pose on the free camera is what the gate measures.

**Page.** `/dayhike/game/<fresh uuid>?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=high`,
in a browser window of 1200 × 2029 CSS pixels at device pixel ratio 1 (the engine
renders 1200 × 2029). The page is given 20 s to load, the pose is set, and the
still is taken 8 s later: `time 12` sets the hour at load and the clock runs, so
every still is taken within 30 s of the page loading. Every game page is closed
before the next one opens. Zero console errors on every page below.

**Stills and isolation.** A PNG of the full frame, then three more on the same
page, each 1.5 s after hiding layers by `mesh.isVisible = false` on the meshes
that carry thin instances or whose name starts `LOD`:

| still | hidden |
| --- | --- |
| all | nothing |
| no blades | `/^blade_clumps/` |
| no cards | `/^LOD\|^clutter\.grass\|^clutter\.meadow/` (the meadow model's two LOD buckets and the grass-class cards) |
| bare ground | `/^blade_clumps\|^duff_clumps\|^LOD\|^clutter\./` |

**Measure.** A short Python script, kept outside the repository beside the
stills, does the arithmetic of design §4.2: each pixel decoded from sRGB to
linear, reduced to luminance `0.2126 R + 0.7152 G + 0.0722 B`; per crop the
**mean**, and the **cover fraction** — the share of pixels below the pose's
threshold. The threshold is the control's mid-crop median, fixed as a literal
for every later build. Its core:

```python
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
cover = (crop(L) < threshold).mean()
```

**Crops**, `W:H:X:Y` in the 1200 × 2029 still, placed by projecting the ground
distance through the camera (vertical field of view 1.4 rad) and checked by
drawing each rectangle back onto the still: the near crop lies on the sward, the
mid crop on the dark tuft band beyond it, neither on a trunk, stump or prop.

| pose | near crop (ground ≈ 2–6 m) | mid crop (ground ≈ 18–26 m) | threshold |
| --- | --- | --- | --- |
| canopy | `280:500:420:970` | `220:22:400:678` | 0.02058 |
| meadow | `360:500:420:980` | `240:22:480:740` | 0.02853 |

**Bar** (design §8.1), on both poses: near cover ≥ 0.8 × mid cover, and near/mid
mean luminance in 0.8–1.25.

## 2. Poses

Seed `atmo` (627994160), `weather mist` (cloud cover 0.9, mist 1, wetness 0.5),
`time 12`, high tier. Found from the simulation, not by flying (design §4.1).
The eye is the ground plus 1.6 m.

| pose | camera | ground in view |
| --- | --- | --- |
| canopy | `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` | in the sward 2.5 m left of a straight trail centreline, looking along it (+X); canopy 1.0, grass 0.5 — the most a closed canopy allows |
| meadow | `__fcSet(369, 51.01, -855, 0, 0.3)` | open meadow looking +Z; canopy 0.00–0.04 to 26 m, grass 1.5, flat to ±0.5 m |

## 3. Control

Measured 2026-09-25 on `main` at `9c97483`, two page loads per pose.

**Fullness.**

| pose | load | near mean | mid mean | lum ratio | near cover | mid cover | cover ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| canopy | 1 | 0.0337 | 0.0292 | 1.16 | 0.133 | 0.500 | **0.27** |
| canopy | 2 | 0.0337 | 0.0290 | 1.16 | 0.131 | 0.500 | 0.26 |
| meadow | 1 | 0.0345 | 0.0297 | 1.16 | 0.233 | 0.499 | **0.47** |
| meadow | 2 | 0.0345 | 0.0299 | 1.16 | 0.237 | 0.491 | 0.48 |

**The bar is missed on cover at both poses** — a third (canopy) and a half
(meadow) of the 0.8 it asks — and met on luminance at both. The two loads agree
within 0.01 in cover ratio.

**Layer isolation** (first load, same thresholds):

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

All of the mid crop's cover is the cards'; all of the near crop's is the
blades'. No meadow near card is drawn at either pose: the rebuild's filter keeps
0 of 1,400 near instances at the canopy pose and 0 of 3,168 at the meadow pose,
against 4,619 and 10,166 far instances. The grass class's near cards add nothing
measurable (no cards: near cover 0.137 and 0.247 against 0.133 and 0.233 with
them).

**Read.** At both poses the near sward is a mid-grey ground under thin dark
strokes, and the band beyond 18 m is dark tufts against fog-lit ground — the
problem as the design describes it. The mean does not show it (the near crop's
median, 0.0364 at the canopy pose, sits above its mean; the mid crop's, 0.0206,
far below); the cover fraction does.

## 4. First gate: the near cards under the blades

Measured 2026-09-25 on the branch at `4ec2a67` against the control at
`9c97483`, the method of §1 unchanged. `4ec2a67` keeps every meadow near card on
high and medium and dithers the near bucket in over `CLUTTER_MEADOW_NEAR_IN`
[1.0, 2.5] m (design §5.1). Zero console errors on every page that
took a still.

### 4.1 Fullness

One page load per build per pose, control and branch back to back. The control
reproduces §3 to within 0.01 of cover ratio at both poses.

| pose | build | near mean | mid mean | lum ratio | near cover | mid cover | cover ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| canopy | control | 0.0337 | 0.0291 | 1.16 | 0.132 | 0.498 | 0.27 |
| canopy | gate 1 | 0.0308 | 0.0288 | **1.07** | 0.224 | 0.500 | **0.45** |
| meadow | control | 0.0344 | 0.0298 | 1.16 | 0.243 | 0.502 | 0.48 |
| meadow | gate 1 | 0.0277 | 0.0295 | **0.94** | 0.518 | 0.502 | **1.03** |

**The meadow pose meets the bar** on both counts: the near crop now has the mid
crop's cover, and its mean sits 6 % under the mid's rather than 16 % over it.
**The canopy pose misses it on cover** — 0.45 against the 0.8 asked, up from
0.27 — and meets it on luminance.

### 4.2 Layer isolation

On the branch, first load, same thresholds:

| pose | layers drawn | near mean | near cover | mid mean | mid cover |
| --- | --- | --- | --- | --- | --- |
| canopy | all | 0.0308 | 0.224 | 0.0288 | 0.500 |
| canopy | no blades | 0.0355 | 0.119 | 0.0292 | 0.494 |
| canopy | no cards | 0.0336 | 0.137 | 0.0649 | 0.007 |
| canopy | bare ground | 0.0397 | 0.001 | 0.0724 | 0.000 |
| meadow | all | 0.0277 | 0.518 | 0.0295 | 0.502 |
| meadow | no blades | 0.0297 | 0.455 | 0.0298 | 0.495 |
| meadow | no cards | 0.0344 | 0.242 | 0.0743 | 0.000 |
| meadow | bare ground | 0.0434 | 0.003 | 0.0753 | 0.000 |

The near crop's cover is now mostly the cards'. At the meadow pose the cards
alone give 0.455, nine tenths of what they give the mid crop; the blades alone
give what they gave before (0.242 against §3's 0.247), and the two overlay
almost independently (1 − (1 − 0.455)(1 − 0.242) = 0.59 against 0.518
measured: the blades partly fall on cards). The no-cards rows match §3's to
0.005: the blades and the ground are unchanged. The mid crop is unchanged.

At the canopy pose the cards alone give the near crop 0.119, a quarter of
what they give it at the meadow pose. The canopy pose has 1,400 near cards in
the 18 m disc against the meadow's 3,168, 0.44 as many (design §3.6: under a closed
canopy the grass reads 0.5, in the open meadow 1.5), and the two crops see that density
differently. The mid crop looks across 18–26 m at a grazing angle, where the
tufts overlap on screen: the cards take its mean from bare ground's 0.0724 to
0.0292 at the canopy pose and from 0.0753 to 0.0298 at the meadow, the same
60 % at 0.44 the density. The near crop looks down on 2–6 m, where each tuft
is seen whole with ground between it and the next: the cards take its mean
down 11 % at the canopy pose (0.0397 to 0.0355) against 32 % at the meadow
(0.0434 to 0.0297). The mid crop's cover is 0.5 at both poses by construction —
the threshold is its median — so the bar reads the near field against a mid
field that looks full whatever the density, and the canopy's thin density shows
only near. Blades and cards together, 0.224, is what the two give alone
(1 − (1 − 0.119)(1 − 0.137) = 0.24); what shows between them is the ground,
0.0397 bare against a threshold of 0.0206.

### 4.3 The look

Stills at both poses as §1 takes them, then on the branch four more per pose on
one page: looking down (pitch 0.9), and turned 90° (yaw π at the canopy, across
the trail; π/2 at the meadow) at pitch 0.3 and 0.9.

**Meadow.** The near field now reads as the same sward as the mid field: dark
tufts standing in the blades from about 2.5 m out, shrinking evenly with
distance into the dark band past 18 m. There is no line and no density step at
8–18 m (screen rows 757–890 at pitch 0.3); the near bucket's dither-out and the
far bucket's dither-in meet without a seam. Inside 2.5 m the tufts thin to a
stipple under the blades — at pitch 0.3 the bottom third of the frame — and
there the field is blades over grey ground, as the control was everywhere.

**Canopy.** The near field has gained the tufts, but they read as single dark
tufts on a pale mid-grey floor, a metre or more apart, while the band past 18 m
still reads as a continuous dark carpet. The difference is density on screen,
not a step: the card layer is continuous across 8–18 m and no seam shows. This
is §4.2's mechanism, seen.

**At the feet.** Looking down at either pose, the nearest cards stand 2–3 m out,
upright and whole; below them the frame is blades only. No card stands as a
flat plane at the feet. A card coming inside 2.5 m dissolves by stipple rather
than shrinking, and a half-dissolved card reads as a translucent, speckled
tuft if looked at directly. The case §5.1's in-band leaves open — a card whose
origin is just past 1 m, whose quads reach about 0.55 m from the eye — does not
show at either pose: there are 12 (canopy) and 35 (meadow) near cards with
origins in [1, 2.5) m, all well into their dither, and none of them reads as a
plane in the down-looking or turned stills. No bare patch shows inside 1 m:
at both poses the grass (0.5 and 1.5) is above the blade field's floor, so the
blades grow at the feet where the 3 and 6 cards inside 1 m are removed. The
bare disc remains possible only where the grass is under that floor.

### 4.4 The walk

At the canopy pose, design §8.4's walk on the branch, one page: twelve steps of
0.25 m along +X at pitch 0.3, then sixteen yaw steps through a full circle at
pitch 0.6 and again at 0.9, at x = 126, a still 1.5 s after each pose. The
ground rises 0.04 m over the 3 m (from the simulation's height), so the eye was
held at y = 110.87.

Over the twelve steps the tufts slide down the frame and thin as they come
inside 2.5 m, each step continuing the last; no card or blade appears or
vanishes between consecutive stills. Through both turns no card stands at the
feet and the ring of cards 2–3 m out stays whole from still to still, across the
trail and back into the sward. **The walk bar is met.**

### 4.5 Frame

Design §8.3's method at high tier and `setHardwareScalingLevel(0.5)` (2400 × 4058
pixels): each round a fresh browser, a discarded warm-up page on the control,
then two pages; mean and p95 in ms over 8 s of `onAfterRenderObservable`
intervals after 3 s at the pose. Rounds with a 1-minute load over 3.5 on any page
were discarded and run again. Delta is gate 1 minus control (for a same-code
round, second minus first).

The machine was not steady: the frame time at either pose sat on a floor
(control 53.6–53.9 ms at the canopy, 47.4–47.5 at the meadow) for stretches, and
between them rose by 3 to 11 ms from other work on the same GPU that the load
average does not show. Rounds where a page was lifted off its floor give deltas
from −8.3 to +5.3 ms and same-code deltas up to 2.2 ms, above the 0.5 ms the
method allows. The rounds were repeated, in three sets, the third starting a
round only when its warm-up page sat on the control's floor. The table marks **quiet** the rounds
in which every page sat within 0.5 ms of its build's lowest mean at that pose;
the quiet same-code rounds agree within 0.16 ms, and those rounds are read.

| canopy round | first page | second page | delta | quiet |
| --- | --- | --- | --- | --- |
| same code 1 | control 53.73 / 55.5 | control 54.35 / 56.3 | +0.62 |  |
| same code 2 | control 53.91 / 56.1 | control 53.83 / 55.7 | −0.08 | yes |
| same code 3 | control 53.90 / 55.7 | control 53.83 / 55.8 | −0.07 | yes |
| same code 4 | control 53.76 / 55.6 | control 53.81 / 56.0 | +0.05 | yes |
| same code 5 | control 54.03 / 55.9 | control 53.87 / 56.0 | −0.16 | yes |
| 1 | control 53.71 / 55.7 | gate 1 55.25 / 57.2 | +1.54 | yes |
| 2 | gate 1 54.86 / 56.6 | control 53.76 / 55.8 | +1.10 | yes |
| 3 | control 53.73 / 55.4 | gate 1 58.14 / 60.3 | +4.41 |  |
| 4 | gate 1 56.55 / 58.9 | control 64.86 / 76.7 | −8.31 |  |
| 5 | control 59.19 / 62.5 | gate 1 62.45 / 65.1 | +3.26 |  |
| 6 | gate 1 60.72 / 63.4 | control 61.80 / 66.4 | −1.08 |  |
| 7 | control 53.64 / 55.4 | gate 1 54.88 / 56.7 | +1.24 | yes |
| 8 | gate 1 55.75 / 58.0 | control 57.72 / 60.0 | −1.97 |  |
| 9 | control 53.88 / 56.0 | gate 1 54.91 / 56.8 | +1.03 | yes |
| 10 | gate 1 54.87 / 56.9 | control 54.98 / 57.3 | −0.11 |  |
| 11 | control 53.75 / 56.1 | gate 1 55.02 / 57.0 | +1.27 | yes |
| 12 | gate 1 54.84 / 56.7 | control 54.25 / 56.3 | +0.59 |  |

| meadow round | first page | second page | delta | quiet |
| --- | --- | --- | --- | --- |
| same code 1 | control 47.51 / 50.1 | control 47.44 / 49.8 | −0.07 | yes |
| same code 2 | control 51.87 / 54.7 | control 52.83 / 56.5 | +0.96 |  |
| same code 3 | control 47.48 / 50.3 | control 47.40 / 49.5 | −0.08 | yes |
| same code 4 | control 49.42 / 51.8 | control 50.31 / 53.8 | +0.89 |  |
| same code 5 | control 50.18 / 52.7 | control 48.02 / 50.2 | −2.16 |  |
| 1 | control 47.47 / 49.7 | gate 1 48.98 / 51.4 | +1.51 | yes |
| 2 | gate 1 54.19 / 71.2 | control 54.51 / 58.7 | −0.32 |  |
| 3 | control 53.37 / 58.5 | gate 1 56.41 / 59.7 | +3.04 |  |
| 4 | gate 1 55.29 / 59.3 | control 54.34 / 58.8 | +0.95 |  |
| 5 | control 47.47 / 49.9 | gate 1 49.17 / 51.5 | +1.70 | yes |
| 6 | gate 1 49.79 / 52.5 | control 48.49 / 50.8 | +1.30 |  |
| 7 | control 53.51 / 58.0 | gate 1 57.81 / 61.2 | +4.30 |  |
| 8 | gate 1 54.60 / 58.5 | control 54.97 / 59.6 | −0.37 |  |
| 9 | control 48.81 / 51.2 | gate 1 49.23 / 52.3 | +0.42 |  |
| 10 | gate 1 48.92 / 51.4 | control 47.56 / 49.9 | +1.36 | yes |
| 11 | control 48.40 / 51.0 | gate 1 53.71 / 59.6 | +5.31 |  |
| 12 | gate 1 48.96 / 51.0 | control 47.63 / 50.3 | +1.33 | yes |

| pose | quiet same-code deltas | quiet rounds, control first | quiet rounds, gate 1 first | order-averaged delta | lowest mean, control / gate 1 |
| --- | --- | --- | --- | --- | --- |
| canopy | −0.08, −0.07, +0.05, −0.16 | +1.54, +1.24, +1.03, +1.27 (mean +1.27) | +1.10 | **+1.19** | 53.64 / 54.84 (+1.20) |
| meadow | −0.07, −0.08 | +1.51, +1.70 (mean +1.61) | +1.36, +1.33 (mean +1.35) | **+1.48** | 47.40 / 48.92 (+1.52) |

Over all rounds, quiet or not, the order-averaged delta is +0.25 ms at the
canopy pose and +1.71 at the meadow: the lifted rounds swing either way by more
than the bar and do not read.

**Native p95**, the canopy pose at scaling 1 (1200 × 2029), one round in each
order: control 22.95 / 24.8 and 22.94 / 25.0, gate 1 24.51 / 27.3 and
23.50 / 25.5; order-averaged delta +1.06 ms, p95 +1.5 ms. The frame is not
capped by vsync (intervals near 23 ms, none quantised to 16.7).

The delta at the canopy pose is about the same at native pixels (+1.06) as at
four times as many (+1.19), and is larger at the meadow pose, where there are
3,168 near cards against 1,400: the cost follows the card count and not the
pixel count. It is the per-instance work of the near bucket — every LOD0 card
in the 18 m disc is drawn and vertex-shaded, about 20 triangles each, although
the dither leaves only 466 (canopy) and 1,095 (meadow) cards' worth visible —
rather than the alpha-tested overdraw §5.1 expected to dominate.

### 4.6 Verdict

| bar | canopy | meadow |
| --- | --- | --- |
| near cover ≥ 0.8 × mid cover | **missed**, 0.45 | **met**, 1.03 |
| luminance ratio 0.8–1.25 | met, 1.07 | met, 0.94 |
| frame ≤ +1.0 ms at 4× pixels | **missed**, +1.19 | **missed**, +1.48 |
| no card as a plane at the feet; nothing appears or vanishes | met | met (still checks) |
| zero console errors | met | met |

**Fullness.** The meadow pose passes. The canopy pose misses on cover because
its cards stand at 0.44 the meadow's density and the near crop, looked down
on, shows the pale floor between them (§4.2). No constant of step 1 reaches
that: it is step 2's floor, darkening the ground under the sward (design §5.2),
which the design takes when either pose still misses.

**Frame.** Both poses are over the bar, the canopy by 0.2 ms and the meadow by
0.5, and the cost is per-instance vertex work (§4.5). The design's named
fallback for step 1 over the frame bar is, in order, the near cards on LOD1
(10 triangles) inside `BLADE_REACH` rather than LOD0, then the in-band's start
1.0 → 1.5 m (design §9); the first acts on exactly this cost.

**The feet.** No card reads as a plane at the feet, so the in-band [1.0, 2.5]
stands and its fallback [1.5, 3.0] is not needed on that count.

## 5. Second gate: the near cards on LOD1

Measured 2026-09-25 on the branch at `7dd5f29` against the control at
`9c97483`, the method of §1 unchanged. `7dd5f29` draws the meadow's near cards
on the model's LOD1 (5 cards, 20 vertices) on the tiers that draw blades, in
place of LOD0 (40 vertices): the near cards' vertex work halves, from 56,000 to
28,000 at the canopy pose and from 126,720 to 63,360 at the meadow. The in-band
[1.0, 2.5] m is unchanged. Zero console errors on every page that took a still.

### 5.1 Fullness

| pose | build | near mean | mid mean | lum ratio | near cover | mid cover | cover ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| canopy | control | 0.0337 | 0.0290 | 1.16 | 0.129 | 0.499 | 0.26 |
| canopy | gate 1 (§4) | 0.0308 | 0.0288 | 1.07 | 0.224 | 0.500 | 0.45 |
| canopy | gate 2 | 0.0317 | 0.0289 | **1.10** | 0.196 | 0.501 | **0.39** |
| meadow | control | 0.0344 | 0.0297 | 1.16 | 0.242 | 0.496 | 0.49 |
| meadow | gate 1 (§4) | 0.0277 | 0.0295 | 0.94 | 0.518 | 0.502 | 1.03 |
| meadow | gate 2 | 0.0295 | 0.0295 | **1.00** | 0.449 | 0.500 | **0.90** |

The control reproduces §3 to within 0.02 of cover ratio. **The meadow pose still
meets the bar**, with 0.10 of margin where §4 had 0.23. **The canopy pose still
misses it on cover**, further than at the first gate. Both meet it on luminance.

### 5.2 Layer isolation

On the branch, same thresholds:

| pose | layers drawn | near mean | near cover | mid mean | mid cover |
| --- | --- | --- | --- | --- | --- |
| canopy | all | 0.0317 | 0.196 | 0.0289 | 0.501 |
| canopy | no blades | 0.0365 | 0.089 | 0.0292 | 0.503 |
| canopy | no cards | 0.0336 | 0.135 | 0.0649 | 0.008 |
| canopy | bare ground | 0.0398 | 0.001 | 0.0724 | 0.000 |
| meadow | all | 0.0295 | 0.449 | 0.0295 | 0.500 |
| meadow | no blades | 0.0332 | 0.345 | 0.0292 | 0.512 |
| meadow | no cards | 0.0342 | 0.253 | 0.0743 | 0.001 |
| meadow | bare ground | 0.0434 | 0.004 | 0.0753 | 0.000 |

LOD1 costs the near crop a quarter of the cards' cover: 0.345 against LOD0's
0.455 at the meadow pose, 0.089 against 0.119 at the canopy. The cards stand
where they stood; each tuft is five cards rather than ten, and more floor shows
through it. The blades, the ground and the mid crop are as in §4.2 (the mid
crop's cards were LOD1 already).

### 5.3 The look

**Meadow.** The near field still reads as the same sward as the mid field, with
no line or density step at 8–18 m. Side by side with §4's still, the same tufts
stand in the same places, each with fewer dark strokes and a little more of the
grey floor between them: the near field reads slightly lighter and more open
than at the first gate, still well fuller than the control.

**Canopy.** As in §4.3, single tufts on a pale floor, now a shade thinner; the
band past 18 m is unchanged.

**At the feet.** At pitch 0.9 at both poses, and turned 90°, the nearest cards
stand where they did, 2–3 m out: the choice of LOD does not move a card, and
the in-band still starts at 1.0 m. The nearest ones read as small upright tufts
of a few strokes, thinner than LOD0's; none stands as a flat plane, and a card
dissolving under 2.5 m reads as the same stipple as before. No bare patch
inside 1 m.

### 5.4 Frame

§4.5's method and quiet rule, unchanged: 16 rounds at 4× pixels, of which
rounds with a 1-minute load over 3.5 on any page (three) were discarded and run
again, and a round started only when its warm-up page sat within 0.6 ms of the
control's floor. Of the 16 kept, 11 are quiet — every page within 0.5 ms of its
build's lowest mean at that pose — and are read; in the other five one control
page was lifted by 0.6 to 3.1 ms by other work on the same GPU.

| canopy round | first page | second page | delta | quiet |
| --- | --- | --- | --- | --- |
| same code 1 | control 53.65 / 55.4 | control 53.63 / 54.9 | −0.02 | yes |
| same code 2 | control 53.65 / 55.7 | control 54.29 / 56.8 | +0.64 |  |
| 1 | control 53.76 / 55.6 | gate 2 54.37 / 56.3 | +0.61 | yes |
| 2 | gate 2 54.33 / 56.3 | control 56.18 / 58.3 | −1.85 |  |
| 3 | control 53.72 / 55.8 | gate 2 54.35 / 56.2 | +0.63 | yes |
| 4 | gate 2 54.31 / 56.1 | control 56.34 / 58.7 | −2.03 |  |
| 5 | control 53.72 / 55.4 | gate 2 54.31 / 56.2 | +0.59 | yes |
| 6 | gate 2 54.37 / 56.0 | control 53.77 / 55.4 | +0.60 | yes |

| meadow round | first page | second page | delta | quiet |
| --- | --- | --- | --- | --- |
| same code 1 | control 47.45 / 50.0 | control 50.49 / 53.4 | +3.04 |  |
| same code 2 | control 47.39 / 49.5 | control 47.38 / 49.6 | −0.01 | yes |
| 1 | control 47.36 / 49.8 | gate 2 47.95 / 50.0 | +0.59 | yes |
| 2 | gate 2 47.97 / 50.4 | control 47.52 / 50.3 | +0.45 | yes |
| 3 | control 47.37 / 49.9 | gate 2 47.89 / 50.4 | +0.52 | yes |
| 4 | gate 2 47.96 / 50.7 | control 49.70 / 53.2 | −1.74 |  |
| 5 | control 47.41 / 50.0 | gate 2 47.87 / 50.1 | +0.46 | yes |
| 6 | gate 2 47.93 / 50.7 | control 47.45 / 49.8 | +0.48 | yes |

| pose | quiet same-code delta | quiet rounds, control first | quiet rounds, gate 2 first | order-averaged delta | lowest mean, control / gate 2 |
| --- | --- | --- | --- | --- | --- |
| canopy | −0.02 | +0.61, +0.63, +0.59 (mean +0.61) | +0.60 | **+0.60** | 53.63 / 54.31 (+0.68) |
| meadow | −0.01 | +0.59, +0.52, +0.46 (mean +0.52) | +0.45, +0.48 (mean +0.47) | **+0.49** | 47.36 / 47.87 (+0.51) |

The branch's pages sit within 0.06 ms of one another at each pose (54.31–54.37,
47.87–47.97). The delta has halved from §4's +1.19 and +1.48 with the vertex
work, which is what §4.5 found the cost to be.

**Native p95**, the canopy pose at scaling 1, four rounds. Only the first had
both pages on the control's floor (22.94 ms): control 22.98 / 25.0, gate 2
23.80 / 26.0, delta +0.82 ms, p95 +1.0 ms. In the other three the control page
was lifted to 23.6–23.8 ms and the deltas (−0.26, +0.18, +0.39) do not read.
Not capped by vsync.

### 5.5 Verdict

| bar | canopy | meadow |
| --- | --- | --- |
| near cover ≥ 0.8 × mid cover | **missed**, 0.39 | **met**, 0.90 |
| luminance ratio 0.8–1.25 | met, 1.10 | met, 1.00 |
| frame ≤ +1.0 ms at 4× pixels | **met**, +0.60 | **met**, +0.49 |
| no card as a plane at the feet | met | met |
| zero console errors | met | met |

**Frame.** LOD1 brings both poses under the bar, with 0.4 and 0.5 ms to spare,
so design §9's second fallback for step 1 over the frame bar — LOD0 with the
in-band from 1.5 m — is not needed for the frame.

**Fullness.** The meadow pose passes on LOD1, with less margin. The canopy pose
misses as at the first gate, now at 0.39, and for the same reason (§4.2): its
cards stand at 0.44 the meadow's density and the floor shows between them.
Neither fallback of step 1 reaches that — the second (LOD0 from 1.5 m) would
give back LOD1's quarter of the cards' cover but take the cards out of the
nearest 1.5 m, and would put the frame back over the bar — so the canopy's
cover goes to step 2, the sward floor (design §5.2), which the design takes
when either pose still misses. Step 2 darkens the near crop's floor at both
poses, so it has the meadow's luminance ratio, 1.00, to keep at or above 0.8.

## 6. Third gate: the sward floor

Measured 2026-09-25 on the branch at `1ee0805` against the control at
`9c97483`, the method of §1 unchanged. `1ee0805` is step 2 (design §5.2) on top
of §5's build: inside the blade field's reach the terrain's albedo is pulled
toward `SWARD_FLOOR` (0.05, 0.065, 0.03) by `SWARD_MAX` 0.6, ramped by the ground
cover each terrain vertex now carries over `SWARD_COVER` [0.05, 0.5], and faded
out over `SWARD_FADE` [12, 18] m of eye distance. Zero console errors on every
page that took a still.

### 6.1 Fullness

| pose | build | near mean | mid mean | lum ratio | near cover | mid cover | cover ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| canopy | control | 0.0337 | 0.0292 | 1.16 | 0.131 | 0.504 | 0.26 |
| canopy | gate 2 (§5) | 0.0317 | 0.0289 | 1.10 | 0.196 | 0.501 | 0.39 |
| canopy | gate 3 | 0.0290 | 0.0289 | **1.00** | 0.201 | 0.496 | **0.41** |
| meadow | control | 0.0345 | 0.0299 | 1.15 | 0.238 | 0.490 | 0.49 |
| meadow | gate 2 (§5) | 0.0295 | 0.0295 | 1.00 | 0.449 | 0.500 | 0.90 |
| meadow | gate 3 | 0.0286 | 0.0295 | **0.97** | 0.464 | 0.505 | **0.92** |

The control reproduces §3 to within 0.02 of cover ratio. **The meadow pose meets
both bars**, the luminance ratio at 0.97, well inside 0.8–1.25. **The canopy pose
still misses on cover**, at 0.41, and meets luminance. The design's
`SWARD_MAX` 0.4 fallback applies to a luminance ratio under 0.8, so it was not
measured.

### 6.2 Layer isolation

On the branch, same thresholds. The pull is on the ground, so the bare-ground
rows now differ from the control's, given beside them:

| pose | layers drawn | near mean | near cover | mid mean | mid cover |
| --- | --- | --- | --- | --- | --- |
| canopy | all | 0.0290 | 0.201 | 0.0289 | 0.496 |
| canopy | no blades | 0.0325 | 0.091 | 0.0290 | 0.499 |
| canopy | no cards | 0.0306 | 0.141 | 0.0647 | 0.010 |
| canopy | bare ground | 0.0353 | 0.000 | 0.0724 | 0.000 |
| canopy | bare ground, control | 0.0397 | 0.001 | 0.0724 | 0.000 |
| meadow | all | 0.0286 | 0.464 | 0.0295 | 0.505 |
| meadow | no blades | 0.0290 | 0.380 | 0.0296 | 0.498 |
| meadow | no cards | 0.0326 | 0.274 | 0.0743 | 0.000 |
| meadow | bare ground | 0.0368 | 0.008 | 0.0753 | 0.000 |
| meadow | bare ground, control | 0.0433 | 0.003 | 0.0753 | 0.000 |

The pull takes the rendered near ground from 0.0397 to 0.0353 at the canopy
pose (×0.89) and from 0.0433 to 0.0368 at the meadow (×0.85). On albedo the
design expected ×0.85 and ×0.67; on the rendered pixels the mist's in-scatter
and the fixed share of sky light dilute it. The mid crop's bare ground is
unchanged to four places: the pull is gone by 18 m. A row-by-row profile of the
bare-ground stills ramps from ×1.0 to the full pull over screen rows 740–860
(about 18 to 12 m), with no step.

The pull darkens the near crop but hardly adds to its cover. The threshold is
the control's mid-crop median, 0.02058 at the canopy pose, and the pulled
ground there sits at 0.0353, 1.7 times it: a pixel of floor between the tufts is
darker than before but still far from dark enough to count. What cover the step
adds comes from where cards and blades already half-cover the ground (canopy
0.196 → 0.201, meadow 0.449 → 0.464). The luminance ratio moves as expected
(canopy 1.10 → 1.00, meadow 1.00 → 0.97).

### 6.3 The floor-look poses

The floor-look design's bed/beside ratio (`2026-09-24-floor-look-verification.md`
§4 and §8, same crops and the same averaging), seed `atmo`, `weather clear`,
`time 12`, control and branch back to back. Its window is 0.9–1.3.

| still | camera | bed crop | beside crop | control | gate 3 |
| --- | --- | --- | --- | --- | --- |
| meadow-trail-along | `__fcSet(258, 85.7, 120, 1.6, 0.15)` | `160:120:520:1280` | `160:120:120:1280` | 1.54 | **2.61** |
| meadow-trail-along, cards hidden | same | same | same | 1.54 | 1.78 |
| trail-down | `__fcSet(283, 85.7, 134, 0.6, 0.55)` | `260:110:70:1450` | `260:110:60:1250` | 0.84 | **0.85** |
| trail-along | `__fcSet(283, 85.7, 134, 1.892, 0.12)` | `170:170:400:1480` | `170:170:120:1480` | 1.14 | 1.14 |

The control reproduces that note's fourth-gate figures (1.52, 0.86, 1.24 there
against `d07a2cc`; 1.54, 0.84 and 1.14 here against the `main` since merged).
The bed crops are unchanged to five places on every still: the trail paint does
not read the pulled albedo.

- **meadow-trail-along** moves out of the window, further than it was: 1.54 →
  2.61. The beside crop falls from 0.1226 to 0.0723. Two things darken it. The
  pull on the verge takes it to 0.1060 (the still with the cards hidden, 1.78),
  and a near card tuft, kept since the first gate, stands inside the beside
  rectangle on the branch and takes the rest. The ground under the rectangle is
  at cover 1.0–1.4, above the pull's ramp: the design's lever, `SWARD_COVER[0]`
  0.05 → 0.3, acts only where cover is under 0.5 and would not move it. The
  lever's trigger is a ratio that was inside the window leaving it; this one was
  outside already.
- **trail-down** is unmoved (0.84 → 0.85), below the window as before: its beside
  crop is on the thinning edge of the grass beside the trail, at cover
  0.03–0.13, where the ramp gives almost no pull.
- **trail-along** is unchanged: its beside crop is on ground at cover 0, which
  the pull does not reach.

**The look.** At `meadow-trail-along` the trail still reads as earth beside
grass, not as a pale strip in a dark sward: the tan bed runs between two green
verges of trampled grass that the pull barely touches (the trampled band's
cover is low), and the darker, tufted sward begins a metre out on either side.
Against the control the verges read a shade darker and the meadow beyond them
reads fuller, with dark tufts where the control had pale ground between blades.
At `trail-down` the two stills are hard to tell apart.

### 6.4 The look

**Meadow.** The near field reads as the same sward as the mid field. Against
§5's still, the floor between the tufts is a shade darker and more olive, and
the lower frame reads slightly denser. No line where the pull fades out
(12–18 m) and none at the card seam.

**Canopy.** The floor between the tufts is darker and less pink-grey than at
§5; the near field still reads as tufts on a floor rather than a sward, and the
band past 18 m still as a carpet. No line where the pull fades.

**At the feet.** At pitch 0.9 and turned 90° at both poses, nothing has changed
in the cards: the nearest stand 2–3 m out as small upright tufts, none reads as
a plane, and no bare patch shows inside 1 m. The floor at the feet is darker
under the blades.

### 6.5 Frame

§4.5's method and quiet rule, unchanged: 16 rounds at 4× pixels, each started only
when its warm-up page sat on the control's floor. Of the 16, 12 are quiet and are
read; in the other four one page was lifted by 0.5 to 2.6 ms by other work on
the same GPU.

| canopy round | first page | second page | delta | quiet |
| --- | --- | --- | --- | --- |
| same code 1 | control 53.69 / 55.7 | control 53.74 / 55.3 | +0.05 | yes |
| same code 2 | control 54.18 / 56.0 | control 53.70 / 55.6 | −0.48 |  |
| 1 | control 53.71 / 55.9 | gate 3 54.91 / 57.4 | +1.20 |  |
| 2 | gate 3 54.37 / 56.5 | control 53.70 / 55.8 | +0.67 | yes |
| 3 | control 53.65 / 55.7 | gate 3 54.32 / 56.2 | +0.67 | yes |
| 4 | gate 3 54.37 / 56.0 | control 55.38 / 57.3 | −1.01 |  |
| 5 | control 53.64 / 55.4 | gate 3 54.50 / 56.8 | +0.86 | yes |
| 6 | gate 3 54.42 / 56.4 | control 53.64 / 55.4 | +0.78 | yes |

| meadow round | first page | second page | delta | quiet |
| --- | --- | --- | --- | --- |
| same code 1 | control 47.42 / 49.7 | control 47.40 / 49.8 | −0.02 | yes |
| same code 2 | control 47.41 / 50.3 | control 47.44 / 49.7 | +0.03 | yes |
| 1 | control 47.38 / 49.6 | gate 3 48.09 / 50.8 | +0.71 | yes |
| 2 | gate 3 47.97 / 50.2 | control 47.37 / 50.0 | +0.60 | yes |
| 3 | control 47.43 / 50.4 | gate 3 50.02 / 53.0 | +2.59 |  |
| 4 | gate 3 48.13 / 50.9 | control 47.40 / 49.5 | +0.73 | yes |
| 5 | control 47.39 / 50.1 | gate 3 48.01 / 50.5 | +0.62 | yes |
| 6 | gate 3 48.07 / 50.8 | control 47.64 / 50.1 | +0.43 | yes |

| pose | quiet same-code deltas | quiet rounds, control first | quiet rounds, gate 3 first | order-averaged delta | lowest mean, control / gate 3 | gate 2 (§5) |
| --- | --- | --- | --- | --- | --- | --- |
| canopy | +0.05 | +0.67, +0.86 | +0.67, +0.78 | **+0.75** | 53.64 / 54.32 (+0.68) | +0.60; 54.31 |
| meadow | −0.02, +0.03 | +0.71, +0.62 | +0.60, +0.73, +0.43 | **+0.63** | 47.37 / 47.97 (+0.60) | +0.49; 47.87 |

Step 2 adds 0.15 ms and 0.14 ms to the order-averaged delta over §5, and 0.01
and 0.10 ms to the branch's lowest mean: one float per terrain vertex and a
`mix` per fragment, near the noise floor.

**Native p95**, the canopy pose at scaling 1, four rounds. One had both pages on
the control's floor (22.95 ms): control 22.95 / 25.0, gate 3 23.35 / 25.5, delta
+0.40 ms, p95 +0.5 ms. In the other three the control page was lifted to
23.7–25.3 ms. Not capped by vsync.

### 6.6 Verdict

| bar | canopy | meadow |
| --- | --- | --- |
| near cover ≥ 0.8 × mid cover | **missed**, 0.41 | **met**, 0.92 |
| luminance ratio 0.8–1.25 | met, 1.00 | met, 0.97 |
| frame ≤ +1.0 ms at 4× pixels | met, +0.75 | met, +0.63 |
| no card as a plane at the feet | met | met |
| floor-look bed/beside (design §8.2) | trail-down 0.85 and trail-along 1.14, unmoved | meadow-trail-along 2.61, out of 0.9–1.3 and further out than the control's 1.54 |
| zero console errors | met | met |

**Luminance.** Met at both poses, the meadow at 0.97: on the rendered meadow ground
the pull darkens by 15 %, about half the 33 % it takes off the albedo, so `SWARD_MAX` 0.6 does not come near
the 0.8 floor, and the "too dark" fallback (0.4) is not needed.

**Canopy cover.** Step 2 moves it from 0.39 to 0.41. The design's "too weak"
fallback, `SWARD_MAX` 0.8, was not measured: at 0.6 the pulled floor sits at 1.7
times the threshold, and 0.8 would darken it by a third more than
the 0.0044 that took it from 0.0397 to 0.0353 — to about 0.034, still 1.6 times the
threshold, so it would not reach. Neither later step acts on the canopy's near
crop: step 3 (design §5.3) changes the blades at 8–18 m, outside the crop's
2–6 m, and step 4 (§5.4) is for a luminance miss and cannot add cover. The miss
is the one design §10 names: the sward under a closed canopy is half the
open's by the simulation's own rule (§3.6), and a fuller forest floor is a
change to that rule.

**The floor-look ratio.** `meadow-trail-along` moves from 1.54 to 2.61: the pull
alone takes it to 1.78, and a near card standing in the beside rectangle takes
the rest. The design's lever, `SWARD_COVER[0]` 0.05 → 0.3, is inert there — the
ground under the rectangle is at cover 1.0–1.4 — and its trigger, a ratio
inside the window leaving it, does not fire: this one was outside before. The
trail still reads as earth beside grass (§6.3).
