# Floor look: verification

What was measured against the floor-look design's gates (section 5 of
[`2026-09-24-floor-look-design.md`](2026-09-24-floor-look-design.md)), how, and
what the numbers were. The design moves two things: the canopy floor paint and
the leaf pieces go tan, and the trail bed becomes packed earth in the hue of
its surroundings instead of a pale gravel band.

## 1. Method

Two checkouts on two ports, each serving its own build: the branch with both
changes, and a control at the `main` it branched from (`d07a2cc`, which
already carries the forest floor and the ground cover — this work's cost and
colour are measured on top of those, not folded into them). Every still opens
a fresh page, the world seeded by token so both builds generate the identical
terrain and trail, the clock pinned (`time 12`) and the weather clear, so two
stills minutes apart are lit the same. Every game page is blanked before the
next one loads, and the control and the branch of a pose are shot back to
back. Every still is 1200 × 2029 at the high tier.

The poses come from the simulation rather than from flying: each is a point
the bed's distance field and the cover field place under a named condition
(a bed cell under full canopy, a bed cell in open grass, a bed cell carrying a
litter drift).

Luminance is measured on the rendered pixels: a rectangle is cropped, averaged,
and the average converted from sRGB to linear luminance
(`0.2126 R + 0.7152 G + 0.0722 B`). Averaging in linear first rather than last
changes every figure below by under 3 %, so the simpler form is the one
quoted. Each crop was drawn back onto the still and looked at before its number
was used, so that no rectangle sits on a shadow edge, a trunk or a prop.

## 2. The poses

Seed `atmo`, clear noon:

| name | camera |
| --- | --- |
| canopy-trail-down | `__fcSet(256, 96.9, -220, 0.6, 0.55)` |
| canopy-trail-along | `__fcSet(256, 96.9, -220, 1.6, 0.15)` |
| meadow-trail-down | `__fcSet(258, 85.7, 120, 0.6, 0.55)` |
| meadow-trail-along | `__fcSet(258, 85.7, 120, 1.6, 0.15)` |
| trail-down | `__fcSet(283, 85.7, 134, 0.6, 0.55)` |
| trail-along | `__fcSet(283, 85.7, 134, 1.892, 0.12)` |
| canopy-trail-2 | `__fcSet(306, 120.8, 42, 0.6, 0.55)` |

Seed `ypeqauxk`, clear noon:

| name | camera |
| --- | --- |
| canopy-ahead | `__fcSet(-291.4, 22.9, 58.5, 1.06, 0.28)` |
| canopy-floor | `__fcSet(-291.4, 22.9, 58.5, 1.06, 0.85)` |
| drift-along | `__fcSet(-290.2, 22.7, 59.0, 1.892, 0.35)` |

Two of the ten do not carry a usable subject and are reported as such.
`canopy-trail-2` stands inside a conifer's own foliage: the frame is filled
with branches and no ground is visible on either build. `canopy-trail-down`
shows a floor but no distinguishable bed — on the control as well as the
branch — so it is read as a floor still, not a trail still.

## 3. The paired stills

Under the canopy the frames are very dark, so the canopy pairs were also
brightened identically on both sides before being judged; both readings agree
and the brightened one is what the description below is based on.

- **The canopy floor is warmer and lighter, and the change is unmistakable in
  a pair.** The control's floor under full canopy is a grey-blue plane; the
  branch's is a mid-brown one. Nothing else in those frames moves: the same
  pieces stand in the same places.
- **The bed reads as earth rather than gravel.** At `canopy-ahead` and
  `canopy-floor` the control's bed is a pale band with a crisp pebbled rim;
  the branch's is a brown band whose rim has gone soft and whose pebble
  texture no longer reads as loose stone.
- **In the open the trail no longer glares.** At `meadow-trail-along` the
  control's bed is a near-white ribbon; the branch's is tan earth sitting in
  the grass. This is the clearest single improvement in the set.
- **Under canopy the bed has gone too far the other way in two frames.** At
  `trail-along` the branch's bed is faint enough that tracing it takes a
  moment, where the control's was obvious; at `drift-along` the bed's core is
  darker than the floor beside it. The design's readability rule — the core
  stays traceable in every still — holds in all six trail stills, but at
  `trail-along` it holds with little margin.

## 4. The bed / beside ratio

Bed crop over beside crop, in linear luminance, on the same pixels in both
builds. Crops are `W:H:X:Y` in the 1200 × 2029 still. The gate is 0.9–1.3 on
the branch.

| still | bed crop | beside crop | main | branch |
| --- | --- | --- | --- | --- |
| canopy-floor | 380:700:700:850 | 380:700:120:850 | 1.81 | **0.86** |
| trail-down | 260:110:70:1450 | 260:110:60:1250 | 1.40 | **0.82** |
| trail-along | 170:170:400:1480 | 170:170:120:1480 | 1.26 | 0.94 |
| meadow-trail-down | 300:100:500:1700 | 300:100:500:1240 | 2.26 | **1.38** |
| meadow-trail-along | 160:120:520:1280 | 160:120:120:1280 | 2.20 | **1.46** |
| drift-along | 200:100:140:1720 | 200:100:920:1720 | 0.98 | **0.63** |

**The gate is not met.** One of six lands in 0.9–1.3; the branch spans
0.63–1.46 where the control spanned 0.98–2.26. The geometric mean moves from
1.58 to 0.97, so the beds are now centred on the window rather than sitting
above it, and four of the six are within 0.09 of an edge — but the two ends
have separated.

The mechanism is that the two ends move for different reasons and the
design's permitted levers move every bed together:

- **The open end is still high** (1.38, 1.46). The meadow bed wears the grass
  bank's own colour, which is bright, so the earth mix darkened it by about a
  third and left it above the grass.
- **The canopy end has gone low** (0.86, 0.82, 0.63). Two changes push the
  same way there. The bed takes 80 % of the bank's shade instead of 60 %, and
  where the bank is dark that multiplier costs the bed roughly a quarter of
  its brightness; and the floor paint's lift went to the ground beside the
  bed but not to the bed itself, because the bed is coloured from the terrain
  vertex colour and from the drift tint, neither of which sees the canopy
  floor paint. The beside crops bear this out: under canopy they rise
  (0.112 → 0.137 at `trail-down`, 0.0095 → 0.0115 at `canopy-floor`) while in
  the meadow they do not move (0.1365 → 0.1387).

`TRAIL_CORE_GAIN` and `TRAIL_MARGIN_GAIN` scale every bed by the same factor,
so no move within the allowed ±0.08 closes both ends: −0.08 would bring the
two meadow stills in (about 1.11 and 1.17) and take the canopy stills to
roughly 0.66, 0.69 and 0.51; +0.08 would bring `trail-down` and `trail-along`
in (about 0.99 and 1.13) and take the meadow stills to about 1.66 and 1.75 —
back where the design started. `TRAIL_BENCH_SHADE` 0.8 → 0.9 darkens the bed
in proportion to how dark its bank is, so it widens the spread rather than
closing it. **No retune was made**, because every permitted move trades one
end of the range for the other and the −0.08 direction would also push the
canopy bed, already the frame where the core is hardest to trace, further
towards invisibility.

Closing the canopy end needs the bed's base to follow the canopy floor paint
the way the ground beside it does — a change to what colours the bed, not to
its gains, and outside this design's allowance. It is the follow-up this
measurement asks for.

Two caveats on the numbers. `drift-along`'s crops read 0.006 and 0.010 in
linear luminance, near the floor of an 8-bit frame, so its 0.63 carries more
uncertainty than the others. And `trail-down`'s bed core lies in a tree's
shadow at that pose, so its bed crop is on the lit part of the bed nearer the
camera; the beside crop is on ground at the same light level.

## 5. Beside the reference photographs

Each canopy still laid beside the two hardwood-canopy photographs, and the
meadow still beside the two grassland ones, both scaled to the same height.

- **The meadow trail reads as the same kind of path.** Tan, sandy earth in
  grass, with soft edges — the photograph's trail is narrower, winds, and is
  braided into two treads, where the game's is a wider straight ribbon with
  parallel edges, but the material reads right and the brightness against the
  grass is close.
- **The canopy floor does not yet read as the same kind of floor.** The
  photographs show a continuous carpet of overlapping rust and tan leaves,
  deep enough to hide the soil, with an earth trail cut through it. The game's
  canopy floor is a smooth mid-brown plane with sparse dark flecks scattered
  on it. The paint is now in the right family — against the control's
  grey-blue it is clearly the photographs' direction — but it is flatter, less
  saturated and grey where the photographs are rust, and the pieces are far
  too few and too dark to add up to a carpet. The gap is coverage and piece
  colour, not the floor paint.
- **The trail through the canopy reads as earth.** Where the photographs show
  a brown, stony, soft-edged tread, the branch now shows a brown soft-edged
  tread; the control's crisp pale rim was the thing that looked wrong and it
  is gone.

## 6. Frame pairs

`high` tier, hardware scaling 0.5 (4× pixels, off the vsync cap), 3 s warm-up
and an 8 s sample per reading, one page at a time, both orders. Means and p95
per reading, in ms:

| view | order | branch | control |
| --- | --- | --- | --- |
| trail | branch first | 51.77 (p95 54.8) | 51.80 (p95 54.8) |
| trail | control first | 51.96 (p95 55.2) | 51.96 (p95 54.6) |
| trailside | branch first | 50.58 (p95 52.2) | 51.70 (p95 56.4) |
| trailside | control first | 52.15 (p95 54.0) | 50.66 (p95 52.4) |

Averaged over both orders: trail 51.87 against 51.88 (−0.01 ms), trailside
51.37 against 51.18 (+0.19 ms). The spread between a build's own two readings
is up to 1.6 ms, larger than either difference, so both views are within
noise and under the +0.3 ms bar. Load average was 1.15 at the start of the run
and 2.45 at the end.

## 7. What missed

- The bed / beside ratio, in five of six trail stills, in both directions —
  section 4, with its mechanism and the reason no permitted retune closes it.
- The canopy floor against the photographs: the paint is right, the carpet is
  not — section 5. Coverage and piece colour are what is left.
- `trail-along` keeps its traceable core with little margin; any further
  darkening of the bed under canopy would break the readability rule.

## 7. Second gate

The amendment (design section 7) lifted the litter drift on the bed by the
floor paint's own 1.5× and mixed the bed's normal, occlusion and roughness
toward the floor texture by the same earth share, and brought the core and
margin gains down to 0.24 and 0.47. The same poses were shot again against the
same control, and the ratio measured at exactly the rectangles of section 4.
One retune followed, and the table below is after it.

### The table

Branch values at the first gate, at the amendment as first written, and after
the retune. Crops as in section 4.

| still | main | first gate | amended | after retune |
| --- | --- | --- | --- | --- |
| canopy-floor | 1.81 | 0.86 | 1.35 | **1.14** |
| trail-down | 1.40 | 0.82 | 0.85 | 0.83 |
| trail-along | 1.26 | 0.94 | 0.67 | 0.76 |
| meadow-trail-down | 2.27 | 1.38 | 1.47 | 1.43 |
| meadow-trail-along | 2.20 | 1.46 | 1.69 | 1.60 |
| drift-along | 0.98 | 0.63 | 0.69 | 0.64 |

The control reproduced to three decimal places at every crop (1.807, 1.403,
1.256, 2.268, 2.207, 0.975), which is the evidence that the rig is repeatable
and that the differences below are the builds' and not the day's.

**The gate is still not met**: one of six in 0.9–1.3, and the branch now spans
0.64–1.60 where the first gate spanned 0.63–1.46.

### What the amendment did, and the retune

- **The drift lift worked, and overshot.** `canopy-floor` went 0.86 → 1.35: the
  drifted bed under canopy had been the clearest failure and is now the
  clearest success, but at 0.77 the bed read 1.35× the litter floor beside it,
  and a drift is the same litter as that floor. `TRAIL_DRIFT_LUM` 0.77 → 0.66
  (inside the ±0.15 the amendment allowed) puts it at **1.14**, in band, and
  moves nothing else in the set by more than 0.03. That is the retune, and it
  is the one made.
- **The relief mix brightened the bed, and the gain cut did not cancel it.**
  The open beds went the wrong way — 1.38 → 1.47 and 1.46 → 1.69 — although
  the gains came down by a third. Taking the gains' own effect out (below),
  the normal, occlusion and roughness mix is worth about 1.4–1.55× on the
  open bed's brightness, which is more than the gain cut took off.
- **The gains are not the lever the amendment took them for.** A probe at
  `TRAIL_CORE_GAIN` 0.16 and `TRAIL_MARGIN_GAIN` 0.39 — a third off the core,
  the whole of the remaining allowance — moved the open beds by ×0.96 and
  ×0.93, not the ×0.67 the core's own factor implies. Only about an eighth of
  the open bed's brightness is scaled by the gains at all. It cost the canopy
  beds more than it bought in the open (`trail-down` 0.85 → 0.79,
  `drift-along` 0.69 → 0.63), so it was not kept.

The reason is in how the bed's colour is assembled: the gain-scaled core and
margin colours are mixed out again by the drift and by the wash-out, and the
wash-out's colour is the floor texture at `TRAIL_WASH_DARK` on the bench base,
with no gain in it. Where the bed's 4 m wash noise is high — which is much of
the open bed — the gains do not reach the pixel. `TRAIL_WASH_DARK` (0.55) is
what sets that brightness, and neither the colour change nor the relief change
touched it. It is the lever the open end needs, and it is outside this
design's allowance.

One measurement has to be withdrawn. `trail-along`'s beside rectangle turns
out to sit on drifted bed, not on the ground beside it: its value moved by
1.48× when the drift was lifted, while every other beside crop in the table
was unchanged to five decimal places. Its ratios are a bed-over-bed reading
and should not be read as the gate. Excluding it, the branch spans 0.64–1.43
below and 1.60 above.

### Beside the reference photographs

- `meadow-trail-down` beside the grassland photograph: the tread now reads as
  earth rather than as pale sand, and its value against the grass is close.
  It is cooler and greyer than the photograph's, which is a damp warm brown,
  and it is smooth where the photograph's carries small stones and ruts.
- `canopy-floor` beside the hardwood-canopy photograph: the bed and the floor
  beside it are now at nearly the same value, which is the relationship the
  photograph shows, and the bed reads as leaf-drifted earth. The floor itself
  still does not read as the photograph's carpet — sparse dark flecks on a
  smooth grey-tan plane against a continuous rust-brown mass of leaves. That
  is the coverage-and-lighting matter the amendment set outside this design.

### Frame pairs

`high` tier, hardware scaling 0.5, 3 s warm-up and an 8 s sample, one page at a
time, both orders. The machine was shared during this run and the readings say
so, so only the pairs taken at a settled load are quoted as measurements:

| round | view | branch | control | difference |
| --- | --- | --- | --- | --- |
| 1 (load 1.50) | trail | 53.26 (p95 56.3) | 53.31 (p95 56.7) | −0.05 ms |
| 1 (load 1.50) | trailside | 52.57 (p95 55.0) | 52.51 (p95 55.2) | +0.06 ms |
| 2 (load rising) | trailside | 62.43 (p95 66.0) | 62.58 (p95 67.1) | −0.15 ms |

The second round's trail pair (branch 60.81 against control 54.09, the branch's
own sample count falling from 147 to 131) is contention, not cost, and is
discarded; so is a later trail-only run that returned one empty sample and one
reading at half the frame cost. Three pairs taken under matched conditions
differ by −0.15, −0.05 and +0.06 ms, all inside the +0.3 ms bar. Load average
was 1.50 at the start of the run and 2.65 at the end.

### What still misses

- The open end of the ratio, by more than the first gate: 1.43 and 1.60. Its
  lever is `TRAIL_WASH_DARK`, not the gains.
- The canopy gravel beds, unchanged at 0.83 and 0.64 — the amendment's drift
  lift does not reach them because they are washed-out bed, not drift.
- The canopy floor against the photographs: coverage and piece colour, as
  before.
- `trail-along`'s crop pair, withdrawn: its beside rectangle is on the bed.

## 8. Third gate

The second amendment (design section 8) split the wash-out's darkness in two,
blended by the litter the bed lies in: `mix(TRAIL_WASH_DARK_OPEN,
TRAIL_WASH_DARK_LITTER, clamp(vTerrainW2.z, 0, 1))`, 0.40 in the open and 0.75
where litter lies. Same poses, same control, same crops — except `trail-along`,
whose beside rectangle was withdrawn in section 7 and is replaced here.

### The replacement crop for `trail-along`

The bed and the ground beside it are told apart by measurement rather than by
eye: only the bed's own constants changed between the gates, so a rectangle
whose value moves between two shoots is on trail paint. Scanning across the
still at the bed's row band, the paint reaches to about x = 590 and the ground
beside begins at x = 600. The replacement pair is bed `170:170:400:1480` and
beside `170:170:600:1480` — adjacent, at the same depth, in the same dappled
light, and the beside rectangle reads 0.02098 at all three gates, unchanged to
five decimal places, which is the evidence that it is off the paint. The
withdrawn rectangle (`170:170:120:1480`) moved by 1.48× when the drift was
lifted; it was drifted bed.

### The table

Branch values at the three gates, control unchanged throughout. `trail-along`
is on the replacement crops at every gate, so its column is comparable.

| still | main | gate 1 | gate 2 | gate 3 | verdict |
| --- | --- | --- | --- | --- | --- |
| canopy-floor | 1.81 | 0.86 | 1.14 | **1.14** | in band |
| trail-along | 2.47 | 0.90 | 0.91 | **1.17** | in band |
| trail-down | 1.40 | 0.82 | 0.83 | **0.83** | below, unmoved |
| drift-along | 0.98 | 0.63 | 0.64 | **0.64** | below, unmoved |
| meadow-trail-down | 2.27 | 1.38 | 1.43 | **1.56** | above, and rising |
| meadow-trail-along | 2.20 | 1.46 | 1.60 | **1.67** | above, and rising |

Two of six in 0.9–1.3. The control reproduced to five decimal places at every
crop across all three shoots.

### What the split did, and why the open end rose again

The split was meant to bring the open bed down and hold the littered bed up. It
held the littered bed up — `trail-along` 0.91 → 1.17, into the window, and the
canopy beds unchanged — but the open bed went **up**, 1.43 → 1.56 and
1.60 → 1.67, the opposite of the intent.

The reason is that the open poses are not open to `vTerrainW2.z`. Three
measurements say so:

- At `canopy-floor`, `trail-down` and `drift-along` the branch's numbers are
  identical to the previous gate to five decimal places. The wash-out
  contributes nothing at those pixels, so neither constant reaches them.
- At the two meadow poses the bed rose by 1.09× and 1.05×. The wash went from
  a flat 0.55 to 0.75 on the litter side, a factor of 1.36, which is what a
  bed about a quarter wash would do — so those pixels took the **litter**
  value, not the open one.
- Probed at `TRAIL_WASH_DARK_OPEN` 0.32 — the whole of the allowed ±0.08 — the
  two meadow beds moved by ×0.983 and ×0.987, and `trail-along` by ×0.997.
  The open constant is worth under 2 % at every pose in the set.

So the vertex litter weight at the meadow poses is already near 1: the bed in
the grass still reads as litter ground to the field the blend separates on, and
takes the higher of the two constants. **No retune was made**: the allowance is
the open constant alone, and it is measurably inert here. The lever that would
work is the litter constant, or the term the blend separates on.

### Beside the photographs, and the stills

- **Meadow, main against gate 2 against gate 3**: main is a near-white gravel
  band with a stony rim; gate 2 is tan earth; gate 3 is the same tan a shade
  paler. All three read as the same *kind* of surface from gate 2 onward, and
  the rim is gone. Against the grassland photograph the tread is still paler
  and greyer than the photograph's damp brown, and the gap widened slightly.
- **Canopy floor**: unchanged from gate 2, as the numbers say. The bed reads as
  leaf-drifted earth at nearly the value of the floor beside it, which is the
  photograph's relationship. The floor itself is still sparse dark flecks on a
  smooth grey-tan plane where the photograph is a continuous rust carpet.

### The frame pair

`trail`, high tier, hardware scaling 0.5, both orders, twice, on a quiet
machine (load 1.74 and 2.33 at the two starts, cliff gates and test runs all
finished):

| run | order | branch | control |
| --- | --- | --- | --- |
| A | branch first | 54.61 | 54.27 |
| A | control first | 55.19 | 54.37 |
| B | branch first | 52.46 | 54.27 |
| B | control first | 57.98 | 55.14 |

Whichever build is sampled second is the slower one in three of the four
rounds, so the orders are averaged: run A gives branch 54.90 against control
54.32 (**+0.58 ms**), run B gives 55.22 against 54.71 (**+0.51 ms**). Two
independent runs agree at about **+0.55 ms**, which is **over the +0.3 ms
bar**. Section 6's −0.01 ms and section 7's −0.05 ms were single rounds that
were not order-averaged, and this pair supersedes them. The wash split itself
is one `mix` of two constants; the likelier cost is the bed's normal,
occlusion and roughness mixes added with the first amendment, which no pair has
yet measured on its own.

### Verdict per pose

| pose | verdict |
| --- | --- |
| canopy-floor | passes; the bed sits just above the litter floor, as the photograph does |
| trail-along | passes; the replacement crops show the littered bed at 1.17 |
| trail-down | fails low at 0.83, unmoved by either amendment — its bed is neither drift nor wash |
| drift-along | fails low at 0.64, likewise unmoved; the worst reading in the set |
| meadow-trail-down | fails high at 1.56, and worse than at the first gate |
| meadow-trail-along | fails high at 1.67, and worse than at the first gate |
| frame cost | fails; about +0.55 ms at TRAIL against a +0.3 ms bar |

## 9. Fourth gate

The third amendment (design section 10) keys the bed's lift and the wash-out's
darkness on the canopy density ρ, carried to the fragment as the fourth
terrain-weight component: the bed's base is mixed toward the needle bed by
`0.75 · ρ`, the bank beside the bed keeps the unlifted base, drifts ride the
lifted bench base, and the wash-out is `mix(0.40, 0.75, ρ)`. The branch is at
`6dd92d7`; same control (`d07a2cc`), same poses, same hour, weather, tier and
still size, and the same crops as section 8, `trail-along`'s replacement pair
included.

### The table

| still | main | gate 1 | gate 2 | gate 3 | gate 4 | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| canopy-floor | 1.81 | 0.86 | 1.14 | 1.14 | **1.19** | in band, 0.11 under the ceiling |
| trail-along | 2.47 | 0.90 | 0.91 | 1.17 | **1.24** | in band, 0.06 under the ceiling |
| meadow-trail-down | 2.27 | 1.38 | 1.43 | 1.56 | **1.27** | in band, 0.03 under the ceiling |
| trail-down | 1.40 | 0.82 | 0.83 | 0.83 | **0.86** | below, by 0.04 |
| drift-along | 0.98 | 0.63 | 0.64 | 0.64 | **0.65** | below, by 0.25 |
| meadow-trail-along | 2.20 | 1.46 | 1.60 | 1.67 | **1.52** | above, by 0.22 |

Three of six in 0.9–1.3, where the third gate had two. The control reproduced
to five decimal places at every crop but one: `meadow-trail-down`'s bed read
0.30818 against 0.30925, 0.3 % lower, with no pixel in the rectangle moving by
more than 12 levels in 255 — grass sway, not a change. On the branch every
**beside** crop is unchanged from the third gate to five decimal places, so the
ground beside the bed, the bank included, did not move; every difference below
is the bed's.

| still | bed, gate 3 | bed, gate 4 | factor |
| --- | --- | --- | --- |
| canopy-floor | 0.01304 | 0.01364 | ×1.046 |
| trail-along | 0.02449 | 0.02601 | ×1.062 |
| trail-down | 0.11374 | 0.11815 | ×1.039 |
| drift-along | 0.00641 | 0.00651 | ×1.016 |
| meadow-trail-down | 0.21616 | 0.17669 | ×0.817 |
| meadow-trail-along | 0.20711 | 0.18822 | ×0.909 |

### What the canopy key did

The two ends moved for the two halves of the change, as intended.

- **In the open the wash-out took its open value, for the first time.** The
  meadow beds fell by ×0.82 and ×0.91. The lift does not reach them — ρ is near
  zero there — but the wash-out's darkness went from the litter value 0.75 to
  the open value 0.40, a factor of 0.53 on the washed part of the bed. The
  measured factors put the wash-out at about two fifths of
  `meadow-trail-down`'s bed and one fifth of `meadow-trail-along`'s. So the
  meadow bed is **not** unchanged from the third gate: it is darker, and that
  is the section 8 split finally separating the open from the litter, now that
  it keys on a field that is low in the open.
- **Under the canopy the bed took the lift, and it is small.** The four canopy
  beds rose by 2–6 %, where about 10 % was expected. The bench base is
  `mix(1.0, bed base, 0.8)`, so a fifth of it is fixed; and under full canopy
  the vertex colour is already 85 % of the way to the dark canopy green, about
  0.08 in linear luminance against the needle bed's 0.11. Mixing three
  quarters of the way raises the base by about a third and the bench base by at
  most about 8 %. The lift is mostly a move in hue: `canopy-floor`'s bed went
  from sRGB (36, 29, 20) to (39, 29, 21), red up and green unchanged.

### The three consequences design section 10 asked to be reported

- **The washed-out bed under the canopy.** `trail-along` is that bed — section 8
  showed it rising with the wash-out's litter constant. Its wash constant
  now keys on ρ, which is near 1 there — had it fallen well short of the litter
  weight the wash keyed on before, the bed would have darkened, as the meadow
  beds did — so it stays near 0.75 and now multiplies the lifted bench base.
  The product is worth ×1.062, 1.17 → 1.24: the largest move under the
  canopy, and the canopy pose now nearest the ceiling.
- **The drifts.** Drifts ride the lifted bench base, and moved by what the lift
  is worth: `canopy-floor`, whose bed is drifted (section 7), ×1.046, 1.14 →
  1.19; `drift-along` ×1.016, 0.64 → 0.65, one level in 255, in the red, at the
  bottom of the 8-bit range. The drift under the canopy at `drift-along` is
  still darker than the floor beside it.
- **The two canopy poses already in band.** Both took the lift and both stay in
  band: `canopy-floor` at 1.19, 0.11 under 1.3, and `trail-along` at 1.24, 0.06
  under. The 1.25–1.29 anticipated for them assumed a lift of about 10 %; the
  measured lift is 5–6 % at these two poses.

### The stills

Control, gate 3 and gate 4 side by side, and the canopy poses also brightened
identically on all three.

- **canopy-floor**: the bed is the same tan earth as at the third gate, a shade
  warmer; the green-grey floor beside it and every piece on it are unchanged.
  The bed still reads as leaf-drifted earth a little lighter than the floor,
  not yet as the litter floor running on under it — the floor beside the bed
  is green-grey and the bed is tan, so continuity of hue is not there, only
  closeness of value.
- **canopy-ahead** (no crop, against the control only): the control's bed is a
  pale grey band with a pebbled rim; the branch's is a warm brown band with a
  soft rim, reading as earth through the canopy.
- **drift-along**: indistinguishable from the third gate by eye; the drifted
  bed is the same dark band against the lighter floor.
- **trail-down**: the bed under the tree's shadow a shade warmer and lighter;
  the lit bank and the grass unchanged.
- **trail-along**: the littered bed in dappled light a shade warmer and
  lighter; still easy to trace, and no longer faint as at the first gate.
- **meadow-trail-down**: the tread a clear step darker and browner than the
  third gate's — tan earth against the grass rather than pale sand — the grass
  and the bank unchanged.
- **meadow-trail-along**: the ribbon a shade darker and more even than the
  third gate's; still visibly lighter than the grass either side of it.

### Frame pairs, and a correction to section 8

Section 8's **+0.55 ms at TRAIL was an artefact of the measurement, not a cost.**
The script took both orders in one browser, four pages in a row, and put the
branch fourth in its second round; a later count found that the fourth page
opened in a run is 1.4–3 ms slow whatever it serves. With identical code on
both ports the fourth page read +2.26 ms and the first two +0.07 ms; swapping
the order moved the slow page onto the control (−3.79 ms). Order-averaging
does not cancel a slowdown that falls on one page position, and that position
was always the branch's, so the average charged the branch about half the
penalty. Measured per commit at TRAIL, both orders averaged, the branch's
steps carry no resolvable cost:

| step | run | round/order | branch mean (p95) | control mean (p95) | d mean | d p95 |
|---|---|---|---|---|---|---|
| 120991a earth mix | A | 1 branch-first | 51.16 (53.7) | 51.12 (53.2) | +0.04 | +0.5 |
| | A | 2 control-first | 51.18 (53.4) | 51.05 (53.0) | +0.13 | +0.4 |
| | | **avg** | | | **+0.09** | **+0.45** |
| 184a7fc relief mix | A | 1 branch-first | 52.51 (55.7) | 52.82 (54.2) | -0.31 | +1.5 |
| | A | 2 control-first | 50.90 (52.9) | 50.97 (52.9) | -0.07 | 0.0 |
| | | **avg** | | | **-0.19** | **+0.75** |
| e690713 wash blend | A | 1 branch-first | 51.25 (53.3) | 53.54 (55.9) | -2.29 | -2.6 |
| | A | 2 control-first | 52.60 (55.1) | 52.50 (54.9) | +0.10 | +0.2 |
| | B | 1 branch-first | 52.59 (54.7) | 53.19 (56.2) | -0.60 | -1.5 |
| | B | 2 control-first | 53.73 (57.0) | 54.66 (57.6) | -0.93 | -0.6 |
| | | **avg (4)** | | | **-0.93** | **-1.13** |
| 948138d tip | A | 1 branch-first | 52.46 (54.6) | 52.58 (54.6) | -0.12 | 0.0 |
| | A | 2 control-first | 52.67 (54.8) | 52.49 (54.7) | +0.18 | +0.1 |
| | B | 1 branch-first | 51.33 (53.4) | 51.34 (53.3) | -0.01 | +0.1 |
| | B | 2 control-first | 51.04 (53.0) | 51.00 (53.2) | +0.04 | -0.2 |
| | | **avg (4)** | | | **+0.02** | **0.0** |

This gate's pairs use the corrected method: every round starts a fresh
browser, opens and discards a warm-up page, then samples the two builds in two
pages, with the order alternating from round to round; same-code rounds (the
control against itself) run among them to show the noise floor. `high` tier,
hardware scaling 0.5, 3 s warm-up and an 8 s sample per page, as before; a
round taken while a test run was going, or at a load average over 3.5, was
thrown away and repeated.

The machine spent much of the run in a slower state — every page, the
warm-up included, at 55–63 ms where a settled page reads 49–53 ms — and in
that state the second page of a round is 1.5–4 ms slower than the first
whatever it serves: the same-code rounds taken in it read +3.90, +1.50, +3.03
and +3.92 ms. Eighteen rounds fell in that state, four of them same-code; the
fourteen pairs among them scatter from −5.9 to +7.9 ms, and they are kept in
the record but not quoted as measurements. The
rounds in which all three pages ran settled (at least 150 frames in the
sample) are these:

| round | view | order | branch | control | difference (p95) |
| --- | --- | --- | --- | --- | --- |
| same code | trail | — | 50.96 (52.9) | 51.07 (53.1) | −0.11 (−0.2) |
| same code | trail | — | 51.90 (54.9) | 52.94 (55.8) | −1.04 (−0.9) |
| same code | trail | — | 52.48 (54.9) | 52.51 (55.0) | −0.03 (−0.1) |
| same code | trailside | — | 49.74 (52.2) | 50.96 (53.3) | −1.22 (−1.1) |
| 1 | trail | branch first | 50.93 (53.4) | 50.93 (52.8) | 0.00 (+0.6) |
| 2 | trail | control first | 52.05 (55.2) | 51.02 (53.1) | +1.03 (+2.1) |
| 3 | trail | control first | 52.41 (54.6) | 52.49 (54.6) | −0.08 (0.0) |
| 4 | trailside | control first | 49.54 (51.3) | 49.49 (51.6) | +0.05 (−0.3) |
| 5 | trailside | control first | 49.65 (51.3) | 49.44 (51.1) | +0.21 (+0.2) |
| 6 | trailside | branch first | 51.34 (53.9) | 51.04 (53.0) | +0.30 (+0.9) |

(In the same-code rows the "branch" column is the second page and the
"control" column the first.) Averaging each order and then the two orders:
**TRAIL +0.24 ms** (branch first 0.00; control first +0.48), **TRAILSIDE
+0.22 ms** (branch first +0.30; control first +0.13). Both are under the
+0.3 ms bar. The same-code rounds put a single round's noise at about ±1 ms,
so a cost of a few tenths cannot be excluded from these pairs alone; with the
per-commit table above (the previous tip at +0.02 ms over four rounds) and the
change since being one more float per vertex, nothing in the evidence points
to a cost.

### Verdict per pose

| pose | verdict |
| --- | --- |
| canopy-floor | passes at 1.19; took the lift, 0.11 under the ceiling |
| trail-along | passes at 1.24; the washed bed under the canopy, 0.06 under the ceiling |
| meadow-trail-down | passes at 1.27, from 1.56; the wash-out's open value reaches it |
| trail-down | fails low at 0.86; plain core bed in shade, which the lift raises by only 4 % |
| drift-along | fails low at 0.65; the drift took the lift at 2 %, and the drift under the canopy stays darker than the floor beside it |
| meadow-trail-along | fails high at 1.52, from 1.67; only a fifth of its bed is wash-out |
| frame cost | passes on the settled, order-averaged pairs: +0.24 ms at TRAIL, +0.22 ms at TRAILSIDE |

The mechanisms of the three misses:

- **`trail-down` and `drift-along`** are the canopy beds that neither the wash
  nor section 7's drift lift reached, and the canopy lift is too weak to carry
  them: the bench base keeps a fixed fifth and the base under full canopy is
  already near the needle bed's value, so `0.75 · ρ` is worth under 8 % there.
  `trail-down` needs about another 5 %; `drift-along` about another 40 %, which
  no lift on the base can give.
- **`meadow-trail-along`**: section 8 found the litter weight near 1 at the
  meadow poses, so the part of the bed the wash-out does not cover — here about
  four fifths — is drift, and the drift's colour is one tint for the canopy and
  the open. The wash-out's open value has done what it can at this pose; the
  remaining brightness is the drift's.
