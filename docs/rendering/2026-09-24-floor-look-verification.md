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
