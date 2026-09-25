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
