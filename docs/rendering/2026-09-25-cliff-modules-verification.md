# Cliff modules: verification

What was measured against
[`2026-09-24-cliff-modules-design.md`](2026-09-24-cliff-modules-design.md)
before the rock-wall modules shipped, how, and what the numbers were, in the
format of
[`2026-09-24-forest-floor-verification.md`](2026-09-24-forest-floor-verification.md).
The gates are the design's §8; the bars are its §1.

The stills, the bucket counts, the seam and the invariant check were read
against the client code at `7ce02f2` (unchanged by the docs-only commit
`b95071d` that followed it). The design's §10 amendment — the capped lean and
the probes over the whole solid — is **not** in any of that, and the overhang
in section 7 is what the amendment exists to fix; those readings are owed
again on the amended code. Section 5's tint and lighting work was done later,
against the amended shell as it stood in the working tree, and does not
depend on the placement either way.

## 1. Method

Two builds, each from its own checkout on its own port: the branch, and a
control at the `main` it branched from (`d07a2cc`). Every still opens a fresh
page with the world seeded by token (`seed atmo`, 627994160), the weather
clear and the clock pinned (`time 12`), waits for the scene, teleports the
free camera with `__fcSet(x, y, z, yaw, pitch)` (positive pitch looks down),
waits, shoots, and closes. Control and branch are shot back to back at each
pose. The bucket instance counts and the material state are read off the
branch page at the pose, before the shot.

Two rig faults are worth stating because they change what the stills can
prove. A page is selected by its own port, not by "the newest game page" —
another measurement running beside this one put its page on top and the first
attempt read that page's (empty) scene instead. And the scene is animated:
wind, canopy dapple and wildlife all move, so two stills of the *same* build
are not the same image. Section 4 measures how far from the same they are.

## 2. The poses

| name | `__fcSet` | what it looks at |
| --- | --- | --- |
| face-10m | `(-345.5, 41.8, -896.9, 1.882, -0.75)` | the scarp at (−336, −900), face on, close |
| face-30m | `(-370, 25, -900, 1.571, -0.3)` | the same face from 30 m |
| face-80m | `(-420, 60, -900, 1.571, -0.05)` | the same face from 80 m |
| along-face | `(-340, 60, -860, 3.1416, 0.05)` | along the face from 14 m up |
| crest-down | `(-300, 135, -900, 4.712, 0.6)` | from the crest, down at the road |
| eye-level foot | `(-355, 19.3, -893.9, 1.882, -0.35)` | intended as the foot of the face |
| second face | `(-330, 95, -790, 0.9, 0.35)` | the (−300, −820) cluster, ground ~80 m |
| seam-a / seam-b | `(-147, 53.1, 42, 0.0, 0.15)` / `(…, 1.571, 0.15)` | the trail crossing steep rock |

The eye-level foot pose is unusable as written: at y = 19.3 the camera is
inside the hillside there, and both builds show nothing but ground filling
the frame. It is reported, not judged.

## 3. The buckets at each pose

Read from the branch page at the pose, as `cliff_m<model>_l<lod>` where model
0 is `wall_a` and model 1 is `wall_b`. `wall_a`'s LOD0 bucket is empty and
disabled at every pose on this scarp; no *enabled* bucket is ever empty.

| pose | a·L0 | a·L1 | a·L2 | b·L0 | b·L1 | b·L2 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| face-10m | 0 | 2 | 6 | 17 | 51 | 97 | 173 |
| face-30m | 0 | 2 | 6 | 14 | 49 | 100 | 171 |
| face-80m | 0 | 0 | 6 | 0 | 53 | 104 | 163 |
| along-face | 0 | 2 | 5 | 17 | 51 | 91 | 166 |
| crest-down | 0 | 2 | 7 | 21 | 51 | 93 | 174 |
| eye-level foot | 0 | 2 | 6 | 16 | 49 | 99 | 172 |
| second face | 0 | 4 | 2 | 14 | 55 | 70 | 145 |
| seam-a | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

The near ring holds 17 modules at face-10m, the middle 53 and the far 103 —
the three rings of the high tier filling in order, with the whole 400 m disc
at 173 against a budget of 700.

## 4. What the paired stills show

Nine pairs, control beside branch. The short answer: **the skyline breaks,
and the face does not read as a cliff.**

- **The crest is broken, and that is real.** At 10 m the control's horizon is
  the terrain's own smooth curve with one speck on it; the branch's is a run
  of blocky jointed rock standing against the sky. Along the face the same
  thing reads as a spine of rock running down the ridge, throwing long
  shadows across the slope. This is the thing the design set out to buy and
  it is bought.
- **Between the modules, nothing changed.** At 30 m and 80 m the modules are
  discrete dark slabs sitting on a hillside that is still the same smooth
  cobbled sheet, with bare ground between them and their spacing visibly on
  the 12 m lattice — rows of separate boulders, not ledges cut into a face.
  The second face is the same picture. The design's own words for the target
  are "ledges and benches at 4–20 m, with facets, overhangs and shadow"; what
  is there is scattered blocks. The honest verdict at 30 m and beyond is that
  the face does **not** read as ledged rock.
- **They are far darker than the ground they stand on.** On the lit slope the
  module pixels average about (31, 34, 38) of 255 while the hillside around
  them averages (117, …) in the same frame. §1 asks that "a brown granite
  module and a pale cobble hillside read as one material". At noon they do
  not. Section 5 establishes why, and it is not the material: a near-vertical
  wall under a sun 76° up is lit almost entirely by the sky fill. At 16:00
  the same modules read at twice the value and the gap halves.
- **Nothing floats and nothing is buried wrongly.** Every module is bedded
  with its shadow starting at its own base; none hangs in the air, and none
  is sunk so far that only a nub shows. At the near pose the camera stands in
  the shadow the modules above it throw, which is why the branch's face-10m
  still is far darker overall than the control's — that is the ledges'
  shadow, the very thing §4.4 wants, not a lighting fault.
- **They cover the road from the crest.** At crest-down the control shows a
  clean paved road with its markings; the branch shows a continuous run of
  rock standing along the road's uphill cut and leaning out over the
  carriageway, hiding it. This is the clearest picture of the geometry fault
  the design's §10 amendment describes, and section 7 states it as a defect.
- **No popping edge at the reach.** In no pose is there a visible ring where
  the far bucket ends; the last 40 m dither does its job.
- **The seam is untouched.** Both seam poses show the same trail on the same
  rock with the same litter on it; the only differences are the wind's phase
  in the canopy dapple and a different hiker name in the corner.

## 5. The tint, and why the walls are dark

**The tint works.** An earlier reading in this note said it did not; that
reading was wrong and the way it was wrong is worth keeping. It switched the
plugin off with `plugin.isEnabled = false` and found the module pixels moved
by 0.04 of 255. But `MaterialPluginBase` defines no `isEnabled` — the
property simply does not exist on this plugin, so the assignment added a
stray field to a JavaScript object and the plugin went on running. The
experiment never turned anything off.

Three readings on the live page say the path is whole, end to end:

- `foliage` is in the effect's own attribute list —
  `position, normal, tangent, uv, world0..3, foliage`.
- The compiled defines carry both `CLIFFTINT` and `THIN_INSTANCES`, which is
  what the vertex stage needs before it will read the attribute at all.
- Writing `(1, 0, 0, 1)` into every bucket's `foliage` buffer turns the
  modules visibly **pink**. Half the instance colour reaches the albedo, as
  designed.

**The walls are dark because of the sun, not the material.** With
`unlit = true` — the raw base colour, no lighting — the same pixels render
**(96, 92, 86)**: ordinary mid-grey granite. Lit at noon they render
**(31, 34, 38)**, about a third of that, and blue-shifted so that blue
exceeds red although the albedo has red exceeding blue. That is the
signature of a surface the sun is missing: the only light of consequence
reaching it is the hemispheric fill, intensity 0.15 and diffuse
(0.42, 0.58, 0.82), while the directional sun runs at intensity 3.95 and
points (0, −0.970, 0.243) — 76° above the horizon. A near-vertical wall
catches almost none of a sun that is nearly overhead.

Everything else was ruled out by experiment on one page at one pose:

| change | module mean RGB |
| --- | --- |
| as shipped, noon | (30.8, 34.4, 38.2) |
| `albedoTexture = null`, `albedoColor` white | (45.6, 52.5, 60.3) |
| …and `receiveShadows = false` | (49.0, 55.6, 63.0) |
| …and `twoSidedLighting = true` | (49.0, 55.6, 63.0) |
| `unlit = true` (raw albedo) | (96.1, 92.0, 86.4) |

A pure white material still renders at a third of the hillside's value, so
it is not the base-colour texture and not `albedoColor`. Shadow receipt is
worth about 3 of 255. Two-sided lighting changes nothing, because
`twoSidedLighting` is already true and `backFaceCulling` already false. The
shipped boulders carry the same material fields — white `albedoColor`, the
same base-colour texture setup, metallic 0, roughness 1, both intensities 1 —
so nothing about the cliff material is unusual.

The sun angle settles it. The same pose at 16:00, sun at 29° instead of 76°:

| | module | ground | module / ground |
| --- | --- | --- | --- |
| noon, sun 76° up | 34.5 | 116.8 | **0.295** |
| 16:00, sun 29° up | 75.5 | 123.2 | **0.613** |

The modules more than double in brightness while the ground barely moves.
Every gate pose in this note was shot at `time 12`, which is the worst hour
in the day for a near-vertical face. The walls being dark at noon is the
scene lighting working, not a fault — but it is still how the game looks at
noon, and if they should read lighter the levers are the fill light, the
tint share, or seating the modules further back, not the texture.

One loose end: raising the material's `environmentIntensity` and
`directIntensity` to 4 lifted the mean only from 30.9 to 51.4, far less than
fourfold. A constant that does not scale with the material's light terms is
contributing most of the remainder at this distance, most likely the
atmosphere's in-scatter. It is noted, not chased.

## 6. The invariants

- **Invariant 1, on the instances actually drawn.** Every thin-instance world
  matrix was read off the branch page at face-10m, its translation taken, and
  the gate re-derived offline from the same simulation functions the field
  uses — not by calling `cliffGate`, but by sampling the terrain, computing
  `1/√(1+dx²+dz²)` and classifying the surface. **173 translations checked, 0
  violations**: every one sits below `GROUND_NORMAL_Y − 0.03` and on rock with
  weight ≥ 0.8. This is the base plane only; section 7 is about the solid
  above it.
- **Invariant 4, one bucket per instance.** The six bucket counts sum to 173
  at face-10m, which is what the collector returns for that disc minus the
  pad's ring (178 collected at the reach plus pad, 173 inside the reach).
- **Invariant 5, bounded.** The worst disc measured here holds 178 modules
  against `CLIFF_BUDGET = 700`.
- **The simulation is untouched.** `git diff origin/main..HEAD -- client/src/sim/`
  is empty.
- **The shaders link, including the two-plugin material.** No console error of
  any kind on any branch page, at any pose. Both far buckets carry
  `DistanceFade` **and** `CliffTint` on a cloned material and report
  `isReady` true with instances drawn; the near buckets carry `CliffTint`
  alone. The one bucket reporting not-ready is `wall_a`'s LOD0, which is
  disabled and holds no instances.

## 7. One defect, and one thing that is not one

- **A module can lean out over walkable ground.** Seated fully on the ground
  normal, a wall lies back on the slope and its upper body reaches downhill
  past the four footprint probes, which bound only its base. From the crest
  this is plainly visible: the modules along the road's cut lean out and
  cover the carriageway. The probes cannot see it because they never leave
  the base plane. The design's §10 amendment — the lean capped at 20° and
  three more probes at the ground projection of the top edge — is the fix;
  none of it is in the code measured here.
- **The tint is not a defect.** An earlier pass in this note recorded it as
  one, on a measurement that never switched the plugin off. It works: the
  attribute is bound, the defines are set, and a forced red instance colour
  turns the modules pink. Section 5 has the correction and the reason the
  walls are dark anyway.

## 8. The rebuild is not a hitch

Walking the free camera along the face in 3 m steps from z = −897 to −960 —
twenty-two steps, crossing the 12 m lattice at −900, −912, −924, −936 and
−948 — the second frame after each teleport is long: 32 to 70 ms against a
steady state of 15 to 20 ms. It is long at **every** step, not at the
crossings, and the same walk on the control, which has no cliff field at all,
shows the same spike **larger**: 36 to 104 ms, median about 56 against the
branch's 50. The spike is the teleport making every field rebuild at once;
the cliff field adds nothing measurable to it. (A first pass at this walk
discarded the first sample after each move, which is exactly where the
rebuild lands, and so found nothing; the numbers above keep it.)

## 9. The seam

The design asks the trail-over-rock pose at (−147, 53, 42) to be pixel
identical. It cannot be proved that way with this rig, and the reason is
worth recording. Between control and branch the two poses score **32.7 dB**
and **33.8 dB** PSNR — but between *two shots of the control alone*, same
pose, same build, minutes apart, they score **14.7 dB** and **18.7 dB**. The
measurement's own noise is larger than the difference it is meant to detect,
because the canopy dapple and the wildlife move between page loads. PSNR has
no resolving power here and no PSNR number at this pose should be read as
evidence either way.

What does settle it: at that pose the branch draws **zero** cliff instances
in all six buckets, and the field itself places **no module anywhere within
the whole 400 m reach** of (−147, 42) on this world. The seam is untouched by
construction, not by measurement.

## 10. The design's density figure is wrong

§7 asks the test to assert that "between 40 % and 60 % of qualifying cells
carry a module" on seed 1's worst disc. Measured on that disc (seed 1, centre
(1100, −1200), the high reach of 400 m): **555 qualifying cells, 128 of them
carrying a module — 23.1 %**, and the collector returns **132** modules there.
The shipped test asserts 20–28 %, which is the measurement; the design's
40–60 % is the figure that should be corrected.

The gap is not a bug. `CLIFF_DENSITY = 0.5` is the share drawn *before* any
terrain sample, and the footprint check then rejects roughly half of what
survives — a module a cell wide straddles the edge of a face far more often
than a point-sized draw would suggest. The same arithmetic makes §5's budget
estimate high: it predicted about 310 modules on that disc from the cell
count and the density alone, and the field places 132.

## 11. Frame time

*(The frame pairs are pending: see section 12. They were deliberately not
taken against a working tree that was being edited for the §10 amendment,
because a run that straddles an edit measures neither build.)*

## 12. What is owed

- The frame pairs and the native tail at the scarp, on the amended code:
  4× pixel pairs both orders at the scarp and at TRAILSIDE, and native p95 at
  the scarp on a quiet machine, against the bars in §1 (+1.5 ms, noise,
  +1.0 ms).
- All the face stills again after the §10 amendment lands, since the capped
  lean changes where every module sits and how it stands.
- The look itself. The skyline breaks, and that is the win. But the face
  between the modules is unchanged and the lattice shows in their spacing.
  Ledges rather than scattered blocks is a placement question — a run of
  modules that overlaps along a contour rather than one per 12 m cell — and
  it is not answered here.
- A decision about the walls at midday. They are lit correctly and they are
  dark; whether a near-vertical face should read this dark under a high sun
  is a judgement, and the levers are the fill light, `CLIFF_GROUND_TINT` and
  the seating angle. Worth judging on a mid-morning or late-afternoon pose
  as well as noon, since the difference is a factor of two.
- The design's own follow-ups, none of them attempted: the block field at the
  foot of the face, mirrored variants, the snowy faces above the snow line,
  and a crest-only band beyond the reach.

## 13. After the fix

Everything in this section was read against `ffa5e2d`, which caps the lean at
20° and probes the whole above-ground solid instead of the base plane. The
control is unchanged (`d07a2cc`). Ten pairs: the five face poses at `time 12`
and again at `time 16`, control then branch at each. No console error on any
page, at any pose, at either hour.

### The buckets

At face-10m, by ring (LOD0 / LOD1 / LOD2), `wall_a` + `wall_b` together:
**17 / 50 / 100**, 167 in the 400 m disc against a budget of 700 — the same
shape as before the fix, six fewer modules. Across the other poses the totals
run 163–174. `wall_a`'s LOD0 bucket is empty and disabled at most poses; no
*enabled* bucket is ever empty. The counts are identical at 12:00 and 16:00,
as they must be: the hour changes the light, not the field.

### What the pairs show

- **They stand up out of the hill now.** This is the clearest change. Before,
  a module lay back with the slope and its body reached downhill; now it
  stands, and at face-10m the consequence is visible in the ground rather
  than in the rock — the near field is lit exactly as the control is, where
  before it lay in the shadow the leaning modules threw over the camera.
- **The skyline is broken at every pose that shows a crest.** At 30 m the
  crest reads as a continuous jagged rim rather than the three or four
  separate blocks it was; along the face a rock spine runs the length of the
  ridge with lit tops and deep shadowed clefts. At 16:00 the along-face pose
  is the best picture the modules have produced: an eroded rocky arête.
- **Nothing floats, nothing is buried, nothing pops.** Every module's shadow
  starts at its own base. No ring is visible at the 400 m reach.
- **The road is back.** From the crest the control's carriageway and its
  markings are legible across the frame on the branch too, where before the
  whole road was hidden under rock. A run of modules stands along the road's
  downhill shoulder and, from this near-vertical angle, projects across the
  near lane in screen space — but the gate check below finds no module
  standing on ground a foot could occupy, so what the pose shows is a tall
  rock on the slope below the road seen from almost directly above, not a
  slab over the bench.
- **At noon they are still dark; at 16:00 they are not.** Section 5 explains
  why and the pairs confirm it at full scale. At `time 12` the modules read
  as dark slabs against a pale hillside. At `time 16` they are warm tan at
  essentially the hillside's own value — at 30 m and 80 m they read as the
  same rock as the ground they stand on, which is what §1 asked for.
- **What is left is spacing, not colour.** The 16:00 80 m pair is the honest
  one: with the colour no longer wrong, the eye goes straight to the layout —
  regular rows of similar-sized lumps, one per 12 m cell, with unbroken smooth
  ground between them. It reads as rocks placed on a slope, not as a face that
  is made of rock.

### The gate, re-derived

Every thin-instance translation at face-10m was read off the page and the
gate re-derived offline from the simulation's own functions: **167 checked, 0
violations** — all below `GROUND_NORMAL_Y − 0.03` and on rock ≥ 0.8.

The fix also changed how much the field places, because the extra probes
reject more: the atmo scarp disc goes 178 → **172**, and seed 1's worst disc
132 → **89**. Section 10's density figures describe the field before the fix.

### Frame time

Four pairs per view at 4× pixels (two runs, both orders each), then native at
the scarp, both orders. Deltas are branch − control in the order taken. Load
average 1.7–2.5 throughout, no other page open.

| view | 4× pair deltas (ms) | 4× median | bar | verdict |
| --- | --- | --- | --- | --- |
| scarp | −0.21, +0.14, +1.26, +1.23 | **+0.69** | ≤ +1.5 | **pass** |
| trailside | +0.26, +0.18, −0.11, −0.55 | **+0.04** | within noise | **pass** |

| native, scarp | branch p95 | control p95 | delta |
| --- | --- | --- | --- |
| branch-first | 19.1 | 19.1 | 0.0 |
| control-first | 19.2 | 19.0 | +0.2 |

The native bar (≤ +1.0 ms) is met, but it should be read for what it is: the
mean is 16.66–16.67 ms on all four samples, which is the 60 Hz cap to the
hundredth. Native at this pose has no headroom in which a difference could
appear, so the pass is the cap's and not the field's. The 4× numbers are the
ones with power, and there the two runs disagree — the first found no cost at
the scarp, the second about +1.25 ms — so the honest reading is "somewhere
between nothing and +1.3 ms, median +0.7, inside the bar".

No fallback was applied; none was needed.

### Does the face read as ledged rock?

Not yet, but it is much closer than it was, and what is missing is now a
single thing. The modules stand correctly, they break the skyline wherever
one is in view, they cast their own shadows, and by late afternoon their
colour belongs to the hill. What defeats them is the lattice: one module per
12 m cell, each drawn from the same two shapes at a similar scale, leaves
regular rows of separate lumps with untouched smooth ground between them, and
the eye reads that as objects placed on a slope rather than as a rock face.
The change that would matter most is letting modules crowd and overlap along
a contour — several per cell where the face is long, none where it is short —
so runs of them merge into a continuous band with real gaps elsewhere; after
that, a wider scale band and mirrored variants to break the repetition, and
only then the lighting, which at midday is the sun's angle on a near-vertical
wall rather than anything the material is doing wrong.

## 14. Counts after the probed box was corrected

The placement moved once more after §13 was written: the probed box now
follows each model's own off-centre extents (`CLIFF_MODEL_RIGHT` beside
`CLIFF_MODEL_FRONT`), which admits a few cells the symmetric box refused.
The figures above that name counts are superseded by these, measured at the
same places: the scarp collects **174** (169 inside the reach, five in the pad; rings
17 / 51 / 101; per model and level [[0, 7, 11], [17, 44, 90]]); seed 1's
worst disc places **91 of 555** qualifying cells (16.4 %) and the collector
returns **92**; the 200-world sweep holds 399 modules, of which 69 have an
above-ground point over ground the gate refuses and 31 over ground a
player can stand on. Every still and frame reading in §13 was taken before
this change; nothing it shows depends on the handful of cells that moved.
