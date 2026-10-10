# Lakes and the massif: design

**Spec, 2026-10-10.** The world's water and its summit stop being
stencils. A lake's outline is the shore of a basin: an oval, egg or teardrop,
sometimes bent or two-lobed, with bays and points at every scale down to the
metre, a shelf that is wide on the gentle side and narrow under a wall, a bank
that is meadow on one side and talus on the other, and one outlet. The dome at
the top of the climb becomes a massif: a crest 400 to 700 m long with the
summit platform at its highest point, a long gentle windward skirt where the
stem climbs and the braid forks, and a steep lee side cut by one or two cirques
whose perched floors hold clear tarns, one to three a world, half of them
stepping down a chain. Low on the climb the valley lake stays where the trail
builder puts it, stretched along the contour, murky, fringed with sedge. Every
system that asks "is this water, and how far from the shore" reads one shore
distance.

It answers the four directions of 2026-10-08: lakes must stop being
circles with clean edges; the summit extends further; features must stop
feeling forced together; the measured shapes of the Olympic lakes are the
targets. It replaces the pond's shape in
[the water terrain](../rendering/2026-09-30-water-terrain-design.md) §4.2 and
§4.4 and the dome of [the summit](../gameplay/2026-09-16-the-summit.md), and
ships in three releases (§14), each moving the level id once.

Compass, as the sky draws it (`sky.ts`, `sunPositionAt`): the sun rises on
+x, so east is +x and inland; the noon sun stands toward −z, so north is +z.

## 0. Decisions

Each line is a choice the design below makes on its recommended answer. A
choice against one changes only the sections it names.

| # | Decision | Recommended | Why |
| --- | --- | --- | --- |
| 1 | Which way the crest runs, and so where the tarns are (§7.1) | Along the coast within 45°, lee side inland, cirques on the lee; the tarns are seen from the crest and the summit, not passed by the stem | It is the only orientation that keeps the windward skirt (and the fork checks) at the dome's profile; the fit note's "the stem passes a cirque on its lip" needs the stem on the lee side, which leaves the bowl for most seeds |
| 2 | A loop to a tarn (§8.4) | None; a player may scramble down a 37 to 40° headwall to the water, no trail leads there | A cirque floor is reached only through its notch, from below, outside the bowl for most seeds; a loop at the summit would make it no longer the one dead end |
| 3 | Number of tarns and chains (§8.1) | 1, 2 or 3 tarns at weights 0.35, 0.40, 0.25; two or more chain down one outlet three times in four, else a second cirque | About 1.9 tarns a world and 60% of tarns in a chain, against the research's "about half in groups" |
| 4 | The massif's height (§7.2) | Summit rise 55 to 90 m, windward skirt `max(300, 25 + 1.78·rise/0.52)` = 300 to 333 m | Keeps the skirt's steepest grade at the dome's 0.52; the proposal's 60 to 110 m needs a 402 m skirt and pushes the braid's top fork 100 m down the stem |
| 5 | The crest's length and shape (§7.1) | Two arms of 180 to 350 m, 400 to 700 m in all, bent up to 40°, crest 20 m wide, the 25 m platform at the summit unchanged | "Extends further" is length, not height; a 20 m crest is walkable along its line |
| 6 | Valley lakes keep the trail builder's placement (§6.1) | Yes, flattest ground with two half-loops round it, but only in the lower 45% of the climb's height, and always murky | The research's two families with an empty band between; the loop machinery is the part that works |
| 7 | How the outline is made (§4) | A closed-form basin field whose level set is the shore, with the ground fitted to it | One exact shore distance for every consumer, no spill or puddle by construction; the contour of a carved basin on the real ground must be traced, baked and dammed anyway |
| 8 | The outline's harmonics (§4.3) | Amplitude `c·(k/3)^−1.4` for k 3 to 16, c = 0.10 for tarns and 0.14 for valley lakes, each times a per-lake draw in [0.5, 1.5]; L:W from quantiles 1.15/1.5/2.5 (tarns) and 1.5/2.2/3.0 (valley); one tarn in three bent, one in five two-lobed | The proposal's c = 0.07 matches the median single harmonic but gives 6.7% and 2.9% band RMS against the measured 10% and 4%; 0.10 gives 10.0% and 4.3% |
| 9 | The water level at the notch (§5.4) | The notch's sill 0.3 m above the water; every other point of the rim at least 0.45 m above | The basin then spills only through its notch, and the flat water never spreads into the outlet channel below the sill |
| 10 | How close the trail comes to the water (§6.2) | Every edge at least 7 m outside the shore | The corridor reshapes the ground to 7 m from its centreline; at the proposal's 4 m it bends the shore and the shore distance stops matching the ground |
| 11 | The shape checks' tolerances (§13.2) | Medians over the 200 lobby seeds at a 1 m outline: tarn SDI 1.20 to 1.35, convexity 0.89 to 0.94, L:W 1.4 to 1.7; valley SDI 1.45 to 1.85, convexity 0.78 to 0.88, L:W 1.9 to 2.5; perched in 95% of worlds | The research's bands widened by about the spread of a 200-world sample; shape targets apply although the game's lakes are smaller than the lakes measured |
| 12 | How shaders read the shore (§10.2) | A shore-distance atlas baked once at load, 128 × 128 per lake | One fetch a pixel inside a lake's square; per-pixel harmonics cost about 150 operations a pixel on the terrain on every tier |
| 13 | Reflections and water life with several lakes (§10.3) | The mirror (high) and panorama (medium) follow the nearest lake, retargeted with 20 m of hysteresis; every lake gets a skyline; water life lives on every lake and updates within 250 m | One mirror pass a frame as today; the renderer wires only `lakes[0]` now (`renderer.ts:1929`) |
| 14 | The grain bending round the massif (§9.2) | Ridges and gullies in the massif's own frame, added to its rise, in place of a domain warp of the base noise | A warp of the base moves `montaneSnapshot` and the bit-identity tests and feeds back into where the summit is placed |
| 15 | Headwall steepness (§7.3) | Talus 29° at the foot, wall 37 to 40° above | Under the 45° walk limit and the watcher's stand limit (`WATCH_SLOPE_NY` 0.74, 42°), so tarns are reachable on foot; the measured 55 to 65° would wall them off and fill the lee with cliff modules |
| 16 | Tarns as features (§8.1) | A new kind `"tarn"`, appended after the loops | Loop logic, the loop's place names and every pond check stay as they are; consumers ask `isLake(f)` |
| 17 | Names (§8.5) | Tarns named on the board only ("Upper" and "Lower" in a chain), from their own draw; no sign names them | No trail leads there; pond and meadow names keep their draws |
| 18 | The outlet streams (§9.3) | A dry channel 0.4 m deep with wet ground, wet plants and alders along it; no running water surface | "A ribbon from a point is enough for the eye"; running water is a water-material project of its own |
| 19 | The existing seeds' feel (§11.3) | Accept that every world's lake and summit change; re-pin the `hollow` fixtures; look at the 22 curated seeds by stills before and after each release | Holding the old graph (outline inside the old circle) would leave a circular ring trail round a non-circular lake, the "forced together" look |
| 20 | The level id (§11.2) | One move per release; R1 and R2 as one move if they finish together | Each release changes the feature tunables; players on different builds cannot join one another |
| 21 | Order of shipping (§14) | R1 outlines and the shore distance, then R2 the massif and tarns, then R3 composition and drainage; R1 after the sea's edge and before the still-water and beach life | Smallest risk first; the still-water life places along shores and should do so once, on the real outline |

## 1. Lakes and the summit today

- **The pond.** At most one a world, in 101 of the 200 lobby worlds: a disc of
  radius 25 to 40 m (`POND_RADIUS_MIN/MAX`, `features.ts:166-167`) on the
  flattest ground the trail builder finds (mean gradient at most 0.25,
  `POND_SLOPE_MAX`) between 20% and 85% of the way from the pad to the crest,
  its rim level all the way round at the mean pre-feature ground over the disc
  (`meanPreFeatureHeight`, `trailBuild.ts:1068`). The build sees a 0.6 m dish
  and a 12 m apron (`basinD`, `features.ts:674-696`); the composed field adds
  the bed (`lakeD`, `features.ts:231-241`): a 0.9 m shelf 10 m wide, an 8 m
  drop, a flat middle 3 m deep murky or 6 m clear (`lakeDepthD`, 217-222). A
  murky lake has a marsh lobe on its flattest shore (`chooseLobe`, 290-312).
  Every shape function and every consumer reads q, the distance from the
  centre, against one radius.
- **The summit.** A dome (`peakD`, `features.ts:611-629`) of radius 300 and
  rise 50 to 80 m, additive on the hillside, at the highest reachable cell
  700 to 1000 m inland (`peakCentres`, `trailBuild.ts:261-293`), with a 25 m
  platform at the base plus the full rise. Its skirt's steepest grade is
  0.323, 0.420 and 0.517 at rise 50, 65 and 80. Up to three centres, each
  lowered by 10 m up to three times, reach no fallback on the 227 seeds. Crests
  stand 118 to 297 m (median 221).
- **Composition** (`olympicSample`, `olympic.ts:775-831`): coast, base, cliffs,
  dunes, cove, pad, `featureStageD` (peak, meadow flat, pond dish, in feature
  order), `lakeStageD` (bed, marsh), the trail's corridor and sink inside the
  bowl, the road. The pad, the dome, the flat, the dish, the bed and the sea
  stacks are all functions of the distance from one point.
- **No drainage.** Nothing flows; no lake has an inlet or outlet; the seeps
  are noise ribbons (`seep.ts`).

## 2. What it must do

1. **No circles.** Every outline, measured at 1 m, meets its family's shape
   targets (§13.2): tarns a rounded oval, egg or teardrop (median length to
   width 1.5, shoreline development 1.2 to 1.35, convexity 0.90 to 0.93),
   valley lakes stretched (2.2, 1.5 to 1.8, 0.83). One tarn in three is not
   star-shaped from its centre.
2. **No clean edges.** Shelf width, bank grade and apron width change round a
   lake with the side it is on; the headwall side drops off and its talus runs
   to the water; the outlet side shoals; a notch breaks the rim.
3. **Two families by height.** Valley lakes in the lower 45% of the climb's
   height, tarns in the cirque floors high on the massif, nothing between.
4. **A massif.** A crest 400 to 700 m long, the summit at its highest point,
   cirques on its lee side with headwalls, talus, floors perched behind lips,
   and tarns in the floors.
5. **Features from landforms.** Tarns are where the cirques are; valley lakes
   lie along the contour; flats and aprons blend by the ground's own slope;
   streams leave the outlets and run downhill.
6. **One shore.** Every consumer of a lake's shape reads one signed shore
   distance (§10).
7. **Keep the world's rules.** Every peer builds the same world from the seed:
   no trig, `pow`, `**`, `exp` or `hypot` in `sim/`, new draws by
   `hash3(…, seed ^ SALT)` with every constant and salt in `FEATURE_TUNABLES`.
   `sim/` stays free of Babylon, `net/` and `game/`. Every stage returns exact
   derivatives and returns its input unchanged, as the same object, outside its
   footprint, so the ground stays bit-identical there. The trail builder keeps
   no fallback and no dead end but the summit on 227 seeds, a walkable grade on
   every edge, the fork band, and `bowlFor` under 1,200 ms. Nothing on a
   frame's path in the renderer allocates.
8. **Keep the summit scene's ground.** A 25 m platform, clear and walkable, a
   straight arrival of at least 10 m, open sky all round, the summit the one
   dead end ([the summit scene](../gameplay/2026-10-08-the-summit-scene.md)).

## 3. Approach

- **A lake is a basin field.** Each lake carries a spine (one to three
  segments) with a half-width along it, random-phase harmonics, metre-scale
  position noise, bulges where talus or a fan meets the water, and a spout
  where it drains. From them one function gives, at any point, a signed
  distance to the shore and its exact gradient. The bed is a depth profile of
  that distance, the bank and the apron are profiles of it outside, and the
  outline is its zero set. Bays and points therefore come from the basin's
  shape, and the ground is built round the water rather than the water poured
  into the ground.
- **The massif is one feature.** A spine through the summit, a cross-profile
  that is the dome's on the windward side and steeper on the lee, and cirques
  joined to the flank by smooth minimum and maximum, each with a floor, a
  headwall, a lip and a notch. The tarns are lakes of the tarn family seated in
  the floors, so their placement is the massif's.
- **The trail builder sees what the player walks.** The lake's whole ground is
  in the build's field; trail edges keep 7 m outside the shore; the stem climbs
  the windward skirt as it climbs the dome's.
- **Composition last.** Slope-scaled blends for every flat, ridges and gullies
  on the massif, outlet channels traced downhill, fans and dressing along the
  shores.

Rejected:

- *The contour of a basin carved into the real ground.* Truer in principle,
  but the shore is then a traced line, not a function: the downhill side must
  still be dammed to stop a spill, every consumer would read a baked polyline,
  and the derivative of the shore is not available to the bed.
- *Harmonics alone, round one centre.* They cannot make the bent and
  two-lobed shapes two thirds of the measured tarns have.
- *A domain warp of the base noise round the massif.* It changes `denseSample`
  inside the massif's box, breaks `montaneSnapshot.test.ts` and the "bit-
  identical to dense" tests of `olympic.test.ts` (:103, :337, :886) there,
  and the warped base would move the cell `peakCentres` ranks highest, so the
  massif would move the ground it was placed on.
- *Flow accumulation.* A grid solve per world for streams the eye reads as a
  line from a notch.
- *A larger bowl so the lee cirques are on the trail.* Raising `BOWL_U_MAX`
  from 1000 to 1300 grows the walkability grid by 30% (124 to 161 columns of
  150) and the build with it, for a trail that would still have to reach the
  floors through their notches from below.

## 4. The shore

Lives in a new `client/src/sim/lakeShape.ts`; `features.ts` and every
consumer import it.

### 4.1 The shape record

`LakeShape`, drawn once when the lake is placed and stored on its feature:

- `family`: `"valley"` or `"tarn"`.
- `spine`: two to four points; `width`: the half-width at each.
- `centre`: the outline's centroid, which the harmonics turn about.
- `harm`: 14 pairs (a_k, b_k) for k = 3 to 16.
- `noiseAmp`, and the salt for the position noise.
- `bumps`: up to six (centre, radius, height) for talus and fans.
- `spout`: the outlet's segment and half-width.
- `head`: the unit direction of the steep side (the headwall, or the
  uphill side of a valley lake).
- `level`, `murk`, `lobe` as today, and three numbers measured from the
  outline at placement: `bound` (the farthest shore point from `centre` plus
  the widest apron), `sMax` (the largest shore distance inside, the water's
  half-width at its widest) and `meanRadius` (the radius of the circle of the
  same area).

### 4.2 The metric

The distance to the spine is the smooth minimum of the distances to its
segments, `smin(a, b, k) = (a + b − √((a − b)² + k²)) / 2` with k half the
half-width at the joint, so the inside of a bend has no crease. The half-width
`w(t)` runs between the points' widths by a smootherstep in the nearest
point's parameter t. The base metric is `m = d / w(t)`: 0 on the spine, 1 on
the plain shore.

- **Sizes.** Valley lakes keep the pond's radius draw, 25 to 40 m, as their
  mean radius. Tarns draw a mean radius of 0.45 to 0.65 of their floor's
  radius, clamped to 18 to 35 m.
- **Elongation.** L:W is drawn from a piecewise-linear quantile table: tarns
  1.15 at 0, 1.5 at the median, 2.5 at 1; valley lakes 1.5, 2.2, 3.0. For a
  straight spine of length ℓ and half-width w (a stadium), L:W = 1 + ℓ/(2w) and
  the area is πR² for mean radius R when `w = R·√(π / (4(L:W − 1) + π))` and
  `ℓ = 2w(L:W − 1)`: at L:W 1.5, w = 0.78 R; at 2.2, w = 0.63 R.
- **Egg and teardrop.** The half-width at the head end is (1 + τ) and at the
  tail (1 − τ) times w, τ drawn in 0 to 0.3. For a tarn the head end is the
  headwall's; for a valley lake, the uphill end.
- **Bends.** Tarns: a straight spine two times in three, else two segments
  bent 20 to 60° at 35 to 65% of the length. Valley lakes: two segments one
  time in two, three the other, each bend 15 to 45°, the whole laid along the
  local contour (§6.1). A two-lobed lake (one tarn in five, one valley lake in
  three) pinches the half-width at its bend to 0.60 to 0.75.
- **Angles without trig.** Bends and directions are drawn as indices into a
  literal table of 64 unit vectors 5.625° apart, as the marsh's 16 are
  (`MARSH_DIRECTIONS`, `features.ts:265`).

### 4.3 Harmonics, noise, bulges, spout

The basin field is

`B = m · (1 − H − N) + Σ bump_j`, joined with the spout by smooth minimum,

and the shore is B = 1.

- **Harmonics.** `H = fade(q) · Σ (a_k cos kθ + b_k sin kθ)` for k = 3 to
  16, θ the direction from `centre`. cos kθ and sin kθ come from the unit
  vector by complex multiplication, one step a harmonic, and dH/dθ by the same
  pass; dθ/dx = −(z − c_z)/q² and dθ/dz = (x − c_x)/q². Amplitude
  `A_k = c · T_k · g_k`: T_k = (k/3)^−1.4 as a literal table (1, 0.669, 0.489,
  0.379, 0.306, 0.253, 0.214, 0.186, 0.163, 0.144, 0.129, 0.116, 0.105,
  0.096); c = 0.10 for tarns, 0.14 for valley lakes; g_k drawn in [0.5, 1.5];
  the phase a unit vector from two draws normalised by its square root. Band
  RMS comes out at 10.0% of R for k 3 to 6 and 4.3% for 7 to 16 on tarns
  (measured 10% and 4%), 14% and 6% on valley lakes (measured 12 to 18% and
  5 to 9%). The k = 2 term of the research is the spine's elongation. `fade`
  is a smootherstep from 0.15 R to 0.45 R in q, so the field is smooth at the
  centre where θ is undefined.
- **Position noise.** `N = noiseAmp · fbm2d(x / 6, z / 6, seed ^ LAKE_NOISE_SALT,
  2)`, `noiseAmp` drawn in 0.015 to 0.03: the metre-scale wobble the research
  sets at 1.5 to 3% of R for k 17 to 32.
- **Bulges.** `bump_j = β_j (1 − r²/ρ²)³` inside radius ρ, the column shape
  the sea stacks use: raising B pushes the shore into the lake. Talus bulges
  (tarns, R2): two to five where the shore faces the headwall, each moving the
  shore in by 0.05 to 0.15 R over ρ of 0.15 to 0.3 R. Inlet fans (R3): one
  tarn in two at the head end, and every valley lake at its uphill end, 0.1 to
  0.4 R wide, moving the shore in by 0.08 to 0.15 R.
- **Spout.** A capsule from the shore to the outlet, 5 to 20 m wide and 5 to
  10 m long, whose own metric joins B by a smooth minimum (k = 0.3): the shore
  draws out into a short narrowing at the outlet instead of an arc.

### 4.4 The signed distance

`s = (1 − B) · w(t)`, positive inside, in metres to within the field's
stretch, with `ds = −w·dB + (1 − B)·dw` exact. The checks hold |∇s| in 0.6 to
1.6 wherever |s| ≤ 20 m, so every rule below that says "metres from the shore"
means it to within that factor.

The one entry point is `lakeShoreInto(out, lake, x, z)`: it writes s, its
gradient, the depth below the level, and the side weight σ (§5.1) into the
caller's record and returns it, with nothing allocated. Outside `bound` it
writes s = −∞ after one distance test. `lakeOutline(lake, step)` marches the
zero set by squares over the lake's box into an ordered polyline; the checks
use it at 1 m, the game at 2 m.

## 5. The lake's ground

One stage per lake, `lakeGroundD`, in `featureStageD` in feature order, so the
trail builder's field holds the whole lake (§6.2). It replaces `basinD` and
`lakeD`; `lakeStageD` keeps only the marsh.

### 5.1 The side weight

`σ = 0.5 + 0.5 · fade(q) · ζ(û·head)`, where û is the unit vector from
`centre` and ζ a smootherstep mapping −0.7 to 0.7 onto −1 to 1. σ is 1 on the
steep side, 0 on the gentle side and the outlet side, 0.5 at the centre.

### 5.2 The bed

- **Valley lakes.** Today's profile in s (`lakeDepthD`): a 0.9 m shelf over
  `min(10, 0.4 sMax)` m, a drop over `min(8, 0.4 sMax)` m to a middle of
  `lakeMiddleDepth(murk)`, 3 m at murk 1.
- **Tarns.** A 0.9 m shelf over `W_shelf(σ)`, 2 m on the headwall side and
  0.35 sMax on the outlet side, then a smootherstep drop over the rest of the
  half-width to `D_max = 0.095 × 2 meanRadius`, 3.4 to 6.7 m, with no flat
  middle. The narrow shelf on the steep side packs the contours there and
  puts the deepest water 30 to 45% of the way across from the headwall shore;
  the wide shelf covers a quarter to a third of the area on the outlet side;
  mean depth comes out near half the maximum (checked, §13.2).

### 5.3 The bank and the apron

Outside the shore, at t = −s:

- **Bank.** `level + g_bank(σ) · t` eased in by a smootherstep over the first
  metre, out to `W_bank(σ)`: a meadow bank of grade 0.12 over 4 m on the gentle
  side, talus at 0.5 over 6 m on the steep side. The bank's top is at least
  0.45 m above the level everywhere but the outlet.
- **Apron.** From the bank's top the ground blends to the surrounding ground
  (the hillside, or the cirque's floor) by a smootherstep over `A(θ)`. A(θ) is
  `clamp(4 m / g, 4, 30)` for g the mean gradient of the ground in direction θ
  across the band 0 to 30 m outside the shore, sampled on 16 directions at
  placement and fitted with harmonics up to k = 3, evaluated by the same
  recurrence: wide on flat ground, short against a wall. On a downhill side
  where the hillside lies below the level, the bank and apron form the dam a
  moraine or slide makes at one end of a real valley lake.

`POND_DEPTH`, `POND_APRON` and the dish go. The water mesh reaches 3 m past the
shore (§10.2), where the bank is already above the level, so water is drawn
only in the lake.

### 5.4 The outlet and the level

- **Valley lakes.** The level stays the mean pre-feature ground, now over the
  8 m cells inside the outline. The outlet is the shore point of lowest bank
  on the downhill end of the spine; the spout points there and the bank is
  notched to a sill at level + 0.3 m.
- **Tarns.** The level is the cirque floor's (§7.4); the outlet is the notch
  in the lip, its sill at level + 0.3 m.

In both, the sill is the basin's spill point: the lowest point on any path
from the water out of the lake's box (checked by a flood fill, §13.2).

### 5.5 The marsh

Murky lakes only, as today, and only valley lakes: tarns have murk at most 0.3
and no lobe. `chooseLobe` scans the same 16 directions but starts each scan at
the shore crossing in that direction (the first point from `centre` where
s ≤ 0) instead of at R; `marshMetricD` measures its ellipse in (s, distance
from the lobe's axis) instead of (R − q, lateral); `lobePoints` walks it the
same way. The lobe still sits on the shelf, inside the shore, where no trail
comes.

## 6. Valley lakes

### 6.1 Placement

The trail builder's pond, as today (`trailBuild.ts:418-481`): a loop feature
in its band, flattest ground first, two half-loops round it, the 24 best
candidates tried. What changes:

- **Height.** A candidate must lie below 45% of the way from the pad's height
  to the crest's (`VALLEY_LAKE_HEIGHT_MAX` 0.45), from R2 on, when the tarns
  hold the high water. Murk there is `murkFor` at 0.45 or below, 0.78 to 1, so
  valley lakes are murky and have a marsh. A pond with no candidate under the
  limit is dropped, as any loop without a candidate is today. The count of
  worlds with a valley lake is measured on the 200 lobby seeds; under 80 of
  200, the limit rises to 0.5.
- **Orientation.** The spine lies along the contour: perpendicular to the mean
  gradient vector over the candidate's disc, normalised by its square root.
- **The test disc becomes the outline.** `meanGradientInDisc` (:1040) and
  `meanPreFeatureHeight` (:1068) read the 8 m cells inside the outline;
  `featureReach` (`trailPlan.ts` ~155-164) and the stem's clearance use
  `bound`; `resampleAround` (:164-191) re-reads cells out to `bound` and one
  cell.
- **Murk and lobe at placement.** The crest's height is known before the
  loops are placed, so murk and the lobe are set with the shape instead of
  after the bowl (:960-970), and the build's field has the whole bed.

### 6.2 The trail round it

Today an edge may touch the rim (`segmentDistance ≥ f.radius`); 20 ponds of 101
have the trail at the rim. Now:

- Every edge keeps at least 7 m outside the shore (s ≤ −7 at every point),
  the reach of the trail corridor's smootherstep from 0.75 to 7 m
  (`trailCorridorD`), so the corridor never reshapes the shore.
- The ring is forbidden inside 7 m and one grid cell, and cheaper in the band
  7 to 19 m outside the shore (`RING_BAND` 12, `RING_COST` 0.35), in place of
  [R, R + 12] from the centre.
- `ringPassFraction` (:998) reads the cells of that band.

The loop then follows the real shore at 7 to 19 m, round its bays and points,
not a circle.

## 7. The massif

`massifD` replaces `peakD` (`features.ts:611-629`) as the first stage of
`featureStageD`; the feature keeps `kind: "peak"`, so the summit, the search,
the scene and the treeline still find it by kind.

### 7.1 The crest

- **Summit.** The centre `peakCentres` picks, by the same ranking and the
  same 700 to 1000 m band. The 25 m platform there is unchanged: the base plus
  the full rise inside `PEAK_CREST_RADIUS`.
- **Direction.** The spine runs along the coast turned by φ within ±45°, so
  its lee normal, the side facing +u, points between east and north-east two
  times in three (φ in 0 to 45°) and between east and south-east once in
  three: the research's cirque aspect, N to E for 66% of lakes above 1,000 m,
  inside what keeps the lee side inland.
- **Arms.** Two, one each way from the summit, each 180 to 350 m with 400 to
  700 m in all, each turned up to ±20° from the spine's line so the crest
  bends up to 40° at the summit. The summit's |z| limit becomes 600 less the
  arms' reach along z, in place of 600 less the dome's radius.
- **Along the crest.** The rise falls from the summit's along each arm by a
  smootherstep to 40 to 60% of it at the tip: a crest descending at grades of
  0.1 to 0.2, walkable along its line. Beyond a tip the profile turns round it
  as the segment distance does.
- **Across.** A crest 20 m wide (10 m either side of the spine), then the
  dome's cone-times-dome profile (`crestProfileD`, :586-590) remapped onto
  [10 m, W] with W the skirt's width on that side.

### 7.2 Windward and lee

- **Windward** (toward the pad): `W = max(300, 25 + 1.78 · rise / 0.52)`, 300
  to 333 m for a summit rise of 55 to 90 m, which holds the skirt's steepest
  grade at the dome's 0.52, under the grid's cap of 0.6 (`TRAIL_GRID_CAP`).
- **Lee** (inland): W drawn in 180 to 240 m, a flank of 0.5 to 0.9 before the
  cirques cut it.
- Between them W blends by a smoothstep in the cosine between the lee normal
  and the unit vector from the nearest spine point, −0.3 to 0.3, so it turns
  smoothly round each arm's tip; its gradient is exact through the cosine.
- **Footprint.** The spine's box grown by the windward W: 6,000 to 10,300 cells
  of the 8 m grid before the bowl clips it, 1.4 to 2.3 times the dome's 4,400.
  Outside it, the input sample is returned unchanged.

### 7.3 Cirques

One cirque head, or two when the tarn draw (§8.1) asks for a second and the
crest is long enough to set them 160 m apart along the spine. Each:

- **Seat.** On the lee flank at a point within the crest's middle 70%, its
  axis the lee normal there turned by up to ±25°, its floor's centre 0.45 to
  0.6 of the lee W from the spine (80 to 145 m), its headwall's top at least
  25 m from the spine, so the crest stays 20 m wide and walkable above it.
- **Floor.** Radius 35 to 60 m; its height F is the massif's ground at the
  floor's centre less 6 to 14 m. It rises 2 to 4% from the tarn's shore to the
  walls.
- **Walls.** Behind and beside the floor the cirque surface rises, at the
  back as a talus apron of 0.55 (29°) for 12 to 20 m, then a headwall of 0.75
  to 0.84 (37 to 40°); at the sides at 0.45. It meets the massif by a smooth
  minimum (k = 3 m), so the walls stop where they reach the flank: a headwall
  20 to 50 m high, the research's 125 m within 200 m at the game's quarter
  scale.
- **Lip.** On the open side the floor rises 3 to 15 m above the water over 10
  to 15 m to a lip crest, whose outer face falls at 0.5 until it meets the
  flank. It joins by a smooth maximum (k = 3 m), so the lip stands on the flank
  where the flank has fallen below the floor. Beyond it the ground drops 40 m
  or more within 100 m of the water: the floor is perched.
- **Notch.** A U section across the lip where the outlet line crosses it, 5
  to 20 m wide, its sill at the water plus 0.3 m.
- **Window.** A smootherstep window on the cirque's outer edge, where both
  joins have returned to the massif's ground, gives the massif back unchanged.

Every join is of the square-root form, so the cirque is smooth with exact
derivatives everywhere.

### 7.4 Chains

When the tarns chain (§8.1), each lower step sits on the upper's outlet line,
its floor's centre 90 to 150 m beyond the upper lip and 25 to 60 m lower,
radius 25 to 45 m, with a lip of 3 to 8 m and its own notch; its back wall is
the upper lip's outer face. A step that cannot be seated (the ground does not
fall 25 m below the upper floor within 150 m, or the step would leave the
massif's footprint by more than 200 m) ends the chain there, so a world may
draw three tarns and hold two.

### 7.5 Placing it, and the trail builder

- **The ladder.** For each of the three centres, the massif, its cirques and
  their tarns are built and the stem routed; on failure the summit's rise
  drops 10 m and everything is re-seated, up to four times (one more than
  today's three, as the top of the range is 10 m higher). No massif after all
  of them is a fallback, as today.
- **The braid.** `peakEntryArc` (`trailBraid.ts:217-225`) becomes the first
  stem sample inside the massif's footprint (the spine distance less than the
  W on that side), less `BRAID_PEAK_MARGIN` 40. The stem comes from the pad,
  so it enters on the windward side, about where it entered the dome.
- **Other features.** The peak's shoulder rule (`PEAK_SHOULDER` 0.6 times the
  dome's radius plus the loop's reach) becomes 0.6 times the windward W from
  the spine plus the loop's reach.
- **Murk.** `murkFor` reads the summit's crest height as `crestH`.

### 7.6 Treeline and paint

The treeline stays a height, crest less 15 m thinning over 35 m
(`TREELINE_BELOW_CREST`, `TREELINE_BAND`). The arms' tips, 22 to 54 m below
the summit, carry trees; the cirque floors sit at or under the treeline band,
so the tarns have scattered trees on their meadow side. The bare-rock crest
follows the spine's 10 m half-width and the platform; `PEAK_RIM_FADE` 40 m
fades by the spine distance at the footprint's edge.

## 8. Tarns

### 8.1 How many

Drawn from the seed: 1, 2 or 3 tarns at weights 0.35, 0.40 and 0.25. With two
or more, they chain down the first cirque's outlet three times in four,
otherwise the second sits in a second cirque head. Each tarn is a feature of
kind `"tarn"`, appended after the loops so the loops' ids do not move.
`isLake(f)` (pond or tarn) is what the lake's consumers test.

### 8.2 Shape

The tarn family of §4: mean radius 0.45 to 0.65 of the floor's, 18 to 35 m;
L:W from the tarn quantiles; head end and `head` toward the headwall; the long
axis turned uniformly relative to the fall line (a third along, a third
diagonal, a third across, as measured); two to five talus bulges where the
shore faces the headwall; the spout at the notch.

### 8.3 Water

Level F (§7.3); murk `min(murkFor(level), 0.3)`, clear; no marsh, reeds or
lilies; the tarn bed of §5.2; depth 3.4 to 6.7 m.

### 8.4 Reaching them

No trail leads to a tarn and none of the loop machinery sees one. The crest
and the summit platform look down the lee side onto the floors 80 to 145 m
away and 20 to 50 m below. The talus and the headwall, at 29° and 37 to 40°,
are under the 45° walk limit (`GROUND_NORMAL_Y` 0.7), so a player can climb
down to the water and back. The summit stays the one dead end.

### 8.5 Names

The board names each tarn from its own draw (`TARN_NAMES_SALT`) apart from
`placeNames`' stream, with "Upper" and "Lower" (and "Middle") on a chain. No
fingerpost names a tarn.

## 9. Composition

### 9.1 One blend for every flat

The meadow's flat (`flatD`, R to R + 35), the pad (`padD`, `bowl.ts:120-143`,
8 m and a 6 m fade) and the lake's apron become one blend, `flatBlendD`: lerp
to the flat's height by a smootherstep over a width per direction, A(θ) =
`clamp(k / g, lo, hi)` from the ground's gradient on 16 directions fitted to
k ≤ 3 (§5.3). Meadow: k = 8 m, 12 to 45 m. Pad: k = 2 m, 6 to 20 m. Lake: as
§5.3. The meadow's loop walks its apron, as `flatD`'s note records it must; its
tries are re-measured.

### 9.2 Ridges and gullies on the massif

A ridged noise in the massif's frame, across-distance d at a wavelength of 120
m and along-crest t at 30 m, so its ridges run down the flanks; added to the
rise at 0 on the crest and the platform, up to 6% of the local rise on the
windward skirt and 12% on the lee, and 0 at the skirt's foot. It fades out
over 40 m either side of a bend's normal and round the arms' tips, where t
is constant. It is two `fbm2d` octaves with exact derivatives through d and t,
and it moves the fork and grade sweeps, which must stay green.

### 9.3 Outlets and inlets

- **Outlet channels.** From each lake's sill a line traced downhill on the
  field before the trail, by the exact gradient, in 4 m steps: it stops on
  reaching another lake (a chain's link), after 20 m of grade under 0.02 (it
  soaks into a wet patch 10 m across), at 400 m, or at the footprint's box. The
  ground takes a channel 0.4 m deep, its bed 1.6 m wide, its banks out to 2.5 m
  by a smootherstep, faded in and out over its first and last 10 m; distance to
  the line is the smooth minimum of its segments' (k = 1 m), boxed by chunks of
  eight segments. A stage after the lakes; the trail's corridor runs after it
  and fords it.
- **Inlet fans.** The bulge of §4.3 plus a fan of gravel raised 0.3 to 0.8 m
  over its footprint, shallow (under 3 m) for a radius of its own width,
  with a dry rill traced uphill from its apex 60 to 150 m.
- **Wetness.** The wet plants (`clutter.ts`) and alders (`vegetation.ts`) read
  the channels as they read `seepOffset`; the ground paint's wet band (3 m)
  follows them per vertex in `waterGroundAt`.

### 9.4 Shores by family

- **Valley lakes.** Wet plants and reeds on 75 to 100% of the shore (s from −3
  to 0.6 m deep), driftlogs and snags along t = 0 to 4 m, the marsh lobe as
  today.
- **Tarns.** Boulders and scree from 12 m up the bank to 2 m into the water
  where σ is over 0.6; a meadow bank where σ is under 0.4; nothing emergent.

## 10. Consumers of the shore

### 10.1 In the simulation

| Reader | Today | After |
| --- | --- | --- |
| `lakeD`, `lakeDepthD` (`features.ts:217-241`) | depth of R − q | `lakeGroundD`: bed of s, by family (§5.2) |
| `basinD` (`features.ts:674-696`) | 0.6 m dish, 12 m apron, in the build | removed; the build has the lake's ground (§5) |
| `lakeStageD` (`features.ts:392-400`) | bed and marsh | marsh only |
| `chooseLobe`, `marshMetricD`, `marshD`, `lobePoints` (`features.ts:290-387`) | shelf ring R − 10 to R | scan from the shore crossing; ellipse in s (§5.5) |
| `featureMaskAt` pond branch (`features.ts:746-753`) | bare to R + 4, trees from R + 8 to R + 18 | bare to t = 4, trees from t = 8 to 18, by s |
| `containAtLake` (`containment.ts:39-56`) | wall at R − 10 | wall at s = `W_shelf(σ)`, the 0.9 m contour, pushed back along ∇s |
| `waterLevelAt` (`containment.ts:77-90`) | q < R | s > 0 |
| `groundSpawn` (`spawn.ts:36-43`) | ground under the level and q < R | ground under the level and s > −1 |
| `waterPlantDensity` (`clutter.ts:582-625`) | reach R + 4; lilies q < R | reach t = 4; lilies s > 0 |
| wet-plant ring (`clutter.ts:850-863`) | R + 4 to R + 11 | t = 4 to 11 |
| `alderHabitat` (`vegetation.ts:281-321`) | R + 8 to R + 30 | t = 8 to 30 |
| `waterBodiesHook` (`olympic.ts:757-769`), `LakeSource` (`terrain.ts:29-31`) | `radius` | `shape` and `bound`; `radius` removed so every reader is found by the compiler |
| `trailBuild.ts` candidate scan, ring, reach (§6) | discs of R | outline, `bound`, the 7 m rule |

### 10.2 In the game

| Reader | Today | After |
| --- | --- | --- |
| `waterGroundAt` (`waterGround.ts:18-37`), per clipmap vertex | bed if q < R | bed if s > 0, per vertex on the CPU as today |
| `featurePaint.ts` shore tint, CPU (100-128) and GLSL (195-227) | R + 4 to R + 6 from the centre | t = 4 to 6, from the shore atlas |
| `wetPlugin.ts`, `wet.fragment.fx:22-24`, `renderer.ts:1939-1943` | wet inside r + 1 to r + 3 | the atlas's s; the nearest body by `bound` |
| `lakeSurface` (`renderer.ts:962-1050`), `POND_DISC_MARGIN` (`bedHeight.ts:127`) | polar disc R + 1 | a 2 m grid over the lake's box, vertices kept where s > −3, built once |
| `bedSquareHasWater` (`bedHeight.ts:140-158`) | the disc | the box, then s |
| `lakeMirror.ts:252-253` | within 200 m of R | within 200 m of `bound`; the nearest lake (§10.3) |
| `lakePanorama.ts`, `lakeSkyline.ts` | a cylinder of radius R | a cylinder whose radius in each of 64 directions from `centre` is the farthest shore crossing there, from the outline |
| `waterLifeField.ts` shore band (145-148), markers, beats, perches (188-256), `footingOf` (126-129) | rings at R, `atan2` round the circle | the band s from −15 to 8; laid by arc length along the 2 m outline; footing by s |
| `waterLife.ts:96-110` frogs, the opposite rim | the lobe and the circle | the lobe and the outline's farthest point from it |
| `waterPlants.ts:246` | rect of R + 5 | the lake's box |
| `boardMap.ts:77-86` | pond and peak rings as circles | lakes as outline polylines; the massif as offsets of its spine at W/4, W/2 and 3W/4 |

The shore atlas: one R16F texture, 128 × 128 per lake in a 2 × 2 tile, each
tile covering the lake's square of side 2 × `bound`, baked once at load from
`lakeShoreInto` (65,536 calls) and sampled bilinearly. The duckweed, algae
and the water's discard follow the bed already and need nothing.

### 10.3 Several lakes

Today the renderer wires the water life, the mirror, the panorama, the
skyline and the lake plugin's body to `lakes[0]` (`renderer.ts:1929-1998`).
With up to four lakes:

- Every lake has its surface, material row and skyline.
- The mirror (high) and the panorama (medium) serve the nearest lake by
  distance to `bound`, retargeted when another lake is 20 m nearer; a
  retarget sets the mirror's plane and re-captures the panorama.
- The water life is placed on every lake at load and updated and drawn for
  lakes within 250 m of the camera.
- The nearest-lake choice runs on preallocated records, with no allocation a
  frame.

`FEATURE_PAINT_MAX` (`featurePaint.ts:37`) grows from 4 to 8 (one massif,
three loops, three tarns), and the table gains a third row for the spine's
four points and its two widths.

## 11. Determinism, the level id and the fixtures

### 11.1 Determinism

Every draw is `hash3(id, i, 0, seed ^ SALT)` with a new salt in the tunables
(`LAKE_SHAPE_SALT`, `LAKE_NOISE_SALT`, `MASSIF_SALT`, `TARN_SALT`,
`TARN_NAMES_SALT`); angles are table indices; harmonics by recurrence; unit
vectors by `Math.sqrt`. Placement-time measures (`bound`, `sMax`, the apron's
harmonics, the outlet) are computed from the seed's field in the builder, the
same on every peer. `lakeShape.ts` sits in `sim/` and imports nothing from
`game/`; the game reads its records.

### 11.2 The level id

Every new constant enters `FEATURE_TUNABLES`, so `registryDigest` and `passHash`
move once per release (`groundGradient.test.ts:798`, 962002917 today) and the
tunables' count (70, `features.test.ts:279`) is re-pinned. `GEN_VERSION` (8)
and `fieldHash` do not move. Each release ships in one deploy, announced, with
the join-failure panel as the net for a stale tab.

### 11.3 Fixtures and pins

Re-recorded or re-pinned at each release that moves them:

- `waterBaseline.json` over the 200 lobby seeds (`RECORD_WATER_BASELINE=1`),
  gaining the lake's family, bound and level.
- The `hollow` seed: `summitRun` (nodes 5 and 36, range 66.77), `cut` (guide 35,
  55 nodes, 1988 m, forks 21, 36, 53, 77, 78), `watcher` (crest node 35),
  `haunt`, `hollowCorridor`, `summit`, `spawn`.
- `watcherSweep` (899 of 924 shown, 74,240 admitted) and `cliffField` (`laid`
  475, `farthest` 50.594…), where cirques change the ground under stands.
- The renderer's part count where parts change, and the feature tunables'
  count.

## 12. Tiers, costs and shaders

| Tier | Shore | Reflection | Water life |
| --- | --- | --- | --- |
| high | atlas | mirror on the nearest lake | lakes within 250 m |
| medium | atlas | panorama of the nearest lake, skyline on the rest | lakes within 250 m |
| low | atlas | skyline on every lake | lakes within 250 m |

- **Per sample, in the simulation.** Inside a lake's box: one to three segment
  distances, 14 harmonic steps and their derivative, two noise octaves, the
  profiles: about 200 operations and two gradient-noise calls, a quarter of a
  dense sample (19 noise calls). Inside the massif's box: the spine, the side
  blend, the profile, one to three cirques with their joins: about 90
  operations, and two noise octaves for the gullies in R3. Outside the boxes,
  one compare each.
- **World build.** Today `bowlFor` runs about 400 ms a seed against a 1,200 ms
  limit. Added: the massif's resample at 1.4 to 2.3 times the dome's cells a
  try, the outline-based ring and gradient for each pond candidate, the
  tarns' seating, the outlet traces. Expected 550 to 800 ms; measured on the
  first build and reported, not assumed. The game's outlines at 2 m and the
  atlas add about 20 ms at load.
- **Per frame.** No new cost on any tier from the shapes, which live in the
  sim and in data baked at load. A mirror retarget costs one panorama capture
  on medium, rarely.
- **Shaders.** The terrain material's text changes once in R1 (the shore tint
  from the atlas, the wet plugin's inside test) and again in R2 (the feature
  table's third row for the spine), so the corpus is recorded again on every
  tier at each. The water material's text is unchanged; the lake mirror's and
  panorama's are unchanged, their inputs move to the CPU.

## 13. Tests and checks

### 13.1 Exact pieces

- **The shore.** s on literal shapes (a straight stadium at L:W 1.5 has s =
  0.78 R − d on its flank; a two-segment spine's inner bend has no crease); the
  harmonic recurrence against literal cos kθ for k up to 16 at known unit
  vectors; the bulge and the spout at literal points; `lakeShoreInto` writing
  into its record with nothing allocated.
- **Derivatives.** `checkDerivatives` at `TOL_RATIO` on `lakeShoreInto`'s s,
  on `lakeGroundD` and `massifD`, at 12 bearings and 11 radii (0.1 to 1.4 of
  the size) about each lake's centre, the summit, each arm's tip, each cirque's
  floor and lip, and each notch, as the lake's are today.
- **Profiles.** The tarn's depth at the headwall shelf and the outlet shelf;
  the bank's grade by σ; the sill at level + 0.3 m; the apron's width at
  literal gradients (4 m at 1, 16 m at 0.25, 30 m on the flat).
- **Containment and spawn.** The wall at the 0.9 m contour on both sides of a
  tarn; wading by s; a spawn refused on the bed and allowed 1 m outside.

### 13.2 Over the seeds

On the 200 lobby seeds, outlines at 1 m:

- Each lake one connected body at its level; no ground below the level
  anywhere in the lake's box that is not the lake and does not reach the box's
  edge (no puddles).
- The sill is the spill point: a flood fill from the water escapes the box
  first through the outlet, at the sill's height to 0.1 m.
- |∇s| in 0.6 to 1.6 wherever |s| ≤ 20 m.
- Medians, tarns: SDI 1.20 to 1.35, convexity 0.89 to 0.94 (p10 0.75 to
  0.85), Feret L:W 1.4 to 1.7, mean over maximum depth 0.40 to 0.55, outlet
  shelf a quarter to a third of the area. Valley lakes: SDI 1.45 to 1.85,
  convexity 0.78 to 0.88, L:W 1.9 to 2.5. Tarns not star-shaped from their
  centroid: 25 to 45%.
- Tarns perched (ground 100 m beyond the notch below the water) in 95% of
  worlds; every tarn's open side between south-south-east and north-north-east
  (the lee normal's ±45° and the cirque's ±25°), N to E for at least 55%
  (62% expected).
- Valley lakes all below 0.45 of the climb's height and murk at least 0.75;
  their count reported against today's 101.
- The marsh's points between the shore and the shelf's inner edge; lilies
  only where s > 0.

On the 227 trail seeds, as today and still green: no fallback, no dead end but
the summit, one peak per world, at least 85% of peaks in the band, the
walkable grade on every edge and the bed within 2 m of the ground, the fork
band (at least 88% of worlds with two or more forks, at least 15% with eight
or more, at most 18), `bowlFor` under 1,200 ms. Added: no trail edge within
7 m of a shore; the crest 20 m wide and walkable along each arm; the summit's
platform 25 m clear with the stem's last 10 m straight.

### 13.3 Bit-identity

`olympic.test.ts`'s three bit-identity cases hold outside the massif's box and
every lake's, which they exclude as they exclude the cliff mask and the bowl;
`montaneSnapshot.test.ts` is untouched; `fieldHash` holds.

### 13.4 Look

Stills, the sun pinned (reload per reading, `sunY` recorded), against the
Lake Angeles, Twin Lakes and Hoh Lake references at six poses: the headwall
over a tarn from its lip; a chain from the crest; a tarn's talus shore at
the water; the valley lake from its loop; the valley lake's marsh and sedge
end; the massif from the trailhead pad. Each release adds its poses before
and after on `hollow` and the 22 curated seeds.

### 13.5 Architecture

`architecture.test.ts` (no trig, `pow`, `**` or `hypot` in `sim/`, `lakeShape.ts`
included); the architecture doc's water paragraph gains the shore distance,
and a massif paragraph replaces the dome's.

## 14. Releases

| Release | What lands | What moves | What the player sees |
| --- | --- | --- | --- |
| R1, outlines and the shore | `lakeShape.ts`; the valley family's shape on today's pond; the lake's ground in the build; the 7 m trail rule; every consumer of §10; the atlas; several-lake wiring | level id; pond loops' graphs; water baseline; `hollow` where its pond moves; the terrain corpus | The one lake a world in a truer shape: a bent lobe, bays and points, a shore that pinches and widens, a meadow bank on one side, the loop following it |
| R2, the massif and its tarns | `massifD`; cirques, lips, notches, chains; the tarn family; the valley lakes' height limit; the board's outlines and tarn names | level id; every 227-seed sweep re-run; the summit's fixtures; watcher and cliff pins; the corpus | The climb ends on a long crest, not a cone; below its lee side one to three clear tarns step down behind rock lips, talus to the water, a notch where each overflows |
| R3, composition and drainage | `flatBlendD` for meadow, pad and lake; ridges and gullies on the massif; outlet channels; inlet fans; shore dressing by family | level id; meadow loops; the pad's ground; fork and grade sweeps | The hillside's grain runs off the massif, streams leave the notches, fans and talus shape the shores, sedge fringes the valley lake |

R1 follows the sea's edge and precedes the still-water and beach life; R2 and
R3 follow it in turn, R2 with a quiet stretch of its own.

## 15. Out of scope

Running water in the channels, waterfalls and their sound; late snow on the
shaded walls; islands; big trough lakes, kettles, beaver ponds and oxbows;
ice; a trail into a cirque; flow accumulation and the erosion stage reserved
in `montane.ts`; moving the bowl's extents; the sea and its cove.

## References

- [The water terrain](../rendering/2026-09-30-water-terrain-design.md), §1,
  §4.2 to §4.5, §6, §7.
- [The water material](../rendering/2026-09-29-water-material-design.md),
  the basin and the wet ground.
- [The water insects](../rendering/2026-10-05-water-insects-design.md), the
  shore band.
- [The lake's mirror and ripples](../rendering/2026-10-07-lake-mirror-design.md),
  the reach and the cylinder.
- [The summit](../gameplay/2026-09-16-the-summit.md) and
  [the summit scene](../gameplay/2026-10-08-the-summit-scene.md).
- [The trail system](../trail/2026-09-11-trail-system.md).
- Bortleson, Dion, McConnell and Nelson, *Reconnaissance data on lakes in
  Washington*, USGS / Washington Department of Ecology Water-Supply Bulletin
  43, vol. 1 (1976), https://apps.ecology.wa.gov/publications/documents/wsb43a.pdf:
  shoreline development, depth, bottom slope and bathymetry of Blue Lake, the
  Twin Lakes and Tomyhoi.
- Evans and Cox, *Cirque morphometry* (Geomorphometry 2015),
  https://geomorphometry.org/uploads/pdf/pdf2015/EvansCox2015geomorphometry.pdf:
  cirque proportions and headwall gradients.
- The outline measurement of 2026-10-08: 1,317 OpenStreetMap water polygons in
  47.30 to 48.20 N, 124.75 to 122.95 W (ODbL), with SRTM 30 m elevations, for
  length to width, shoreline development, convexity, the harmonic spectrum, the
  cross-sections of perched lakes and the outlet aspect.
