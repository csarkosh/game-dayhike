# Cliff modules: verification

What was measured against
[`2026-09-24-cliff-modules-design.md`](2026-09-24-cliff-modules-design.md)
before the rock-wall modules shipped, how, and what the numbers were, in the
format of
[`2026-09-24-forest-floor-verification.md`](2026-09-24-forest-floor-verification.md).
The gates are the design's §8; the bars are its §1.

Everything below was read against the client code at `7ce02f2` (unchanged by
the docs-only commit `b95071d` that followed it). The design's §10 amendment —
the capped lean and the probes over the whole solid — is **not** in anything
measured here, and the two findings in section 7 are what that amendment
exists to fix. The stills, the seam and the frame numbers are owed again on
the amended code.

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
  module pixels average about (25, 30, 35) of 255 while the hillside around
  them averages (113, 112, 111) in shade and (150, 150, 141) in sun. §1 asks
  that "a brown granite module and a pale cobble hillside read as one
  material". They do not; they read as a different rock dropped onto the
  hill. Section 5 measures why.
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

## 5. The tint

The per-instance tint (`CLIFF_GROUND_TINT = 0.5`) was toggled on and off on
**one page at one pose** — no reload, so the sun does not move — at the lit
80 m view, and the two frames compared.

Toggling the plugin off changes the module pixels by **0.04 of 255** in each
channel (module body, 451,118 pixels: (24.96, 30.11, 35.33) with the tint on
against (24.99, 30.15, 35.38) with it off). The frame-to-frame animation
noise over the same five seconds is about 2.7 of 255, seventy times larger.
The plugin is attached to all six materials and reports itself enabled; its
effect on what is drawn is below the noise floor. Half the ground's albedo is
not reaching the wall. That is the second finding in section 7.

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

## 7. Two defects

- **A module can lean out over walkable ground.** Seated fully on the ground
  normal, a wall lies back on the slope and its upper body reaches downhill
  past the four footprint probes, which bound only its base. From the crest
  this is plainly visible: the modules along the road's cut lean out and
  cover the carriageway. The probes cannot see it because they never leave
  the base plane. The design's §10 amendment — the lean capped at 20° and
  three more probes at the ground projection of the top edge — is the fix;
  none of it is in the code measured here.
- **The tint does not reach the wall.** Section 5: switching the plugin off
  moves the modules by 0.04 of 255. Whatever the fragment stage is mixing
  toward, it is not the ground albedo under the instance, and the result is
  a near-black wall on a pale hillside at every distance.

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
  between the modules is unchanged, the lattice shows in their spacing, and
  their colour does not belong to the hill. Ledges rather than scattered
  blocks is a placement question — a run of modules that overlaps along a
  contour rather than one per 12 m cell — and it is not answered here.
- The design's own follow-ups, none of them attempted: the block field at the
  foot of the face, mirrored variants, the snowy faces above the snow line,
  and a crest-only band beyond the reach.
