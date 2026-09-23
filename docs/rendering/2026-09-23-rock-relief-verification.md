# Rock relief: verification

What was built, why its two geometry decisions were made, and the test
evidence for the cut described in
[`2026-09-23-rock-relief-design.md`](2026-09-23-rock-relief-design.md). The
stills, the LOD walk and the timings in §7–§10 were taken on live pages
against a control build at the commit this work started from.

## 1. Method

`rockRelief.ts` is Babylon-free: plain vertex arrays in, plain vertex arrays
out, exercised directly by its own test file on a synthetic icosphere (and an
anisotropic stretch of one — see §4) rather than through the engine.
`clutterMeshes.ts` is exercised through a `NullEngine` scene, the same escape
hatch the rest of the clutter shell's tests use. Both are unit-level and run
in milliseconds; neither substitutes for the gates below, which need a real
page, a real GPU and a control build at the commit this work started from.

## 2. What was built

`rockRelief.ts` seeds `ROCK_PLANES = 10` candidate planes per (model, cut),
each offset so that it slices off the outermost `ROCK_DEPTH` fraction of the
model's reach along that plane's own normal; drops the candidates whose cap
would take too few or too many vertices; projects everything beyond the
survivors onto them; unwelds every triangle to its own three vertices;
roughens each vertex inward along the input's own vertex normal; and writes a
per-facet luma as vertex colour. `clutterMeshes.ts` runs this on each rock and
boulder model's near and far LOD as its GLB lands, four cuts per model, and
spreads an instance across its class's four cuts by its own hash. The
decisions the design's earlier sections did not settle are recorded in the
spec's Amendments section and explained here.

On the four shipped models, 148 of the 160 candidates survive the cap-share
rule at the near LOD — `rock_a` 10/10/10/10, `rock_b` 10/9/10/10, `boulder_a`
6/8/7/8, `boulder_b` 10/10/10/10 — so the weakest bucket keeps six and eleven
of the sixteen keep all ten. Across both LODs it is 295 of 320. That number is
worth stating because it was 11 for most of this work: the offsets were keyed
to the model's largest reach in any direction rather than to its reach in the
plane's own, which is the same thing only on a sphere, and the sphere was the
only fixture the geometry tests used. §12 records what closed that.

## 3. Why roughening moves along the vertex normal, not the face normal

Unwelding gives every triangle its own copy of each vertex, so two triangles
sharing an edge no longer share a vertex index — only a position, coincident
by construction. Displacing each triangle's copy along that triangle's own
face normal moves the two copies of a shared edge in two different
directions (the two triangles' face normals disagree at almost any edge),
pulling the edge apart into a crack. The input's vertex normal, by contrast,
is the same value on both sides of a shared edge before unwelding, so moving
both copies along it by the same signed amount along the same direction
keeps them coincident. The triangle's face normal is still written to the
output `normals` array, unchanged, so shading still reads each facet as flat.

A synthetic-fixture test caught the one place this ruling has a cost: the
stored (flat) face normal is no longer exactly the geometric normal of the
triangle's own roughened output positions, because the three vertices of a
triangle now move along three different (vertex) directions rather than one
shared one. Measured on a subdivision-4 icosphere, the peak relative
difference between the stored and the recomputed normal is about 0.51%; the
test's tolerance is 5%, comfortably above that peak and still far below the
error a genuinely wrong normal (flipped sign, wrong plane, non-unit length)
would produce.

## 4. Why the roughening moves inward only, and is scaled by each vertex's own distance from the centroid

A cut has to remove material and never add it — a boulder's mesh is what the
sim's collision box is sized against, and the box is a constant the renderer
must not move. (Removing material keeps the mesh inside the box; it does not
keep the mesh flush with it, and §12 records the one place the two come
apart.) Two things hold that.

The displacement is **inward only**: the noise runs `[0, 1)` and is subtracted,
so a vertex is pushed toward the surface's inside or left where it is, never
pushed out. An earlier version instead shrank the whole model by `ROCK_ROUGH`
first and let a two-sided noise push back out by as much again. That held the
bound, but it held it by spending 2 % of the model's reach in every direction:
enough to lift a prop's flat underside — which the artist puts at y = 0 and
the shell sinks 2 cm to stop it z-fighting the terrain — out of most of that
2 cm at the largest instance scale the sim draws, and enough to pull a
boulder's top away from a collider box sized around the uncut mesh. One-sided
displacement costs neither, because the extremes stay exactly where they were
wherever the noise happens to be quiet, and a real surface has plenty of such
places along any one edge of it.

The amplitude is scaled by **each vertex's own distance** from the centroid
rather than by any single number for the model, so the bound is about that
vertex rather than about the model's most distant point.

Neither is quite enough on its own, and the gap is worth recording: "inward
along the vertex normal" is not the same as "inward toward the centroid".
They agree where the surface is convex. On the concave stretches every real
rock has, the normal runs partly sideways, and a sideways step can carry a
vertex slightly farther from the centroid than it began — measured at 21 µm
on the shipped boulders. A final clamp returns any such vertex to its own
starting radius, which makes the bound exact on any mesh rather than exact
only on a convex one. Measured after it, over all thirty-two cut meshes at
both LODs, the largest excess is 35.7 nm (on `boulder_b`'s far LOD, cut 3),
which is float32 store rounding and nothing else.

The per-vertex scaling was caught by a test rather than by inspection: an
anisotropic fixture (the icosphere scaled unevenly on its three axes,
spreading vertex distances from the centroid far more widely than a uniform
sphere does) failed against a version scaled by the model's half-extent, with
a vertex measured about 0.003 units farther from the centroid than it started.

## 5. The model index

`rockPlanes(model, cut, halfExtent)` seeds a (model, cut) pair's plane
directions and depths from a hash of both numbers. The clutter shell used to
pass each cut class's own per-class variant index as `model`, so rock's and
boulder's first variant were both "model 0" and drew the same cut-plane
directions — hidden from view only because the two classes' underlying
geometry differs, not because the planes actually differed. The shell now
keys the plane list on `cls * 16 + variant`, unique across every model in
every cut class, so two different models — whether in the same class or two
different ones — always draw independent planes. A test built two synthetic
assets sharing one half-extent (so nothing else could mask a collision) for
rock's and boulder's own first variant and asserted their plane lists differ.

## 6. Test evidence

- `rockRelief.test.ts` (the pure module on synthetic fixtures) 9 tests,
  `rockReliefModels.test.ts` (the same cut on the four shipped GLBs) 9,
  `clutterMeshes.test.ts` (rock relief in the shell, `cutsFor`/`cutOf`,
  `reliefMesh`) 18, `architecture.test.ts` (the Babylon-free check among
  others) 8, `bladeMeshes.test.ts` 5 — 49 passing together.
- `rockRelief.test.ts` covers the anisotropic hull-bound fixture (§4), the
  facet-normal tolerance (§3), a cut of a reversed-wound copy of the fixture
  asserting no facet ends up facing inward (§11), and a coin fixture built
  square to a seeded plane direction, which is what it takes to make the
  cap-share ceiling fire at all (§12).
- The `cutOf` hash-to-cut routing was confirmed red against the naive
  `hash & (cuts - 1)` (which coerces the unit-float hash to 0 via `ToInt32`
  and puts every instance in cut 0) before the fix that scales the hash into
  the cut range first, then green after.
- The model-index fix (§5) was confirmed red against the unfixed shell — two
  synthetic assets sharing a half-extent for rock's and boulder's first
  variant produced identical plane lists — then green after keying the plane
  list on `cls * 16 + variant`.
- `npm run typecheck` and `npm run lint`: both clean. `npx vitest run --root
  tools`: 70 passing.

## 7. Stills: a rock at 2 m and a boulder at 4 m

Both builds were driven to the same poses on the forest slope east of the
trail, where rock and boulder ground actually is — the meadow has no rock
within 60 m, so the pose has to follow the stone. The subjects are a rock at
2.2 m — camera `(371.9, 136.4, 593.8)` looking west — and a boulder at 4.3 m
— camera `(364.0, 135.6, 592.0)`, yaw 1.15. Each was shot on seed `atmo` at
12:00 clear, 16:00 clear, and 12:00 in mist.

The change is unambiguous at both distances and in all three conditions.
Before, the rock reads as a smooth rounded loaf: one soft silhouette, no
internal edges, the whole surface shading as a single curve. After, it reads
as broken stone — planar faces each taking the light at its own angle, hard
creases between them, and a silhouette with corners in it.

These were shot twice, and the pair is worth keeping side by side, because
the first set was taken while the planes were being skipped (§12). Even then
the rock looked fractured — the unweld, the flat face normals and the
roughening produce a convincingly angular surface on their own. What the
working planes add is *scale*: whole flat faces that run most of the width of
the rock and meet at long straight edges, rather than a uniformly crumpled
skin. Put the two next to each other and the earlier one reads as a rock with
a rough texture, the later one as a rock that has been split.

That distinction is the entire reason §12 exists, and it is why a still could
confirm the look while the mechanism was not running.

**Mist is the condition that shows this best**, which was not obvious before
the shots were taken. Direct sun gives a rounded surface its own bright and
dark sides, so an uncut rock still looks like it has form; mist removes the
directional shading and leaves nothing but the geometry to carry the read.
Under it the uncut rock reads as a soft organic mound — at a glance, closer
to a root ball than to stone — while the cut one is plainly crystalline. Any
later change to this geometry should be judged in mist first.

One claim from the first pass does not survive: `boulder_a` has **no** cleaved
top. All four of its cuts leave the crown within 3 µm of the uncut model, so
every plane it keeps takes a flank. `boulder_b` does cleave — 11.3 % of its
height in cut 0, 2.5–2.8 % in two others — and that single cut is where the
collider divergence in the design's §3 comes from.

## 8. LOD-swap walk

The concern this gate exists for is that a rock could change SHAPE, not just
detail, at the moment its LOD swaps — which is what the one-plane-list-per-
model rule in `expandCutVariants` prevents.

**The gate was specified as three stills at the boulder, and stills do not
answer it.** They were taken — backing away along +x from the boulder at
`(367.9, 135.2, 593.8)` to 30 m, 60 m and 90 m — and they show nothing
usable: at the first station a tree trunk stands in the line of sight, and by
the third a 2 m boulder is a handful of pixels, well under the size at which
a change of shape could be seen. Re-framing would not rescue the method. A
pop is a temporal event between two frames, and a still is one frame.

What stands in its place is two measurements, both taken on the live page,
and it is worth being exact about what each one buys:

- **The two LOD levels agree on outline.** Measured as the support function
  over 128 fixed directions, which is the right instrument because the
  support function *is* the outline: the sixteen cut LOD0/LOD1 pairs disagree
  by **0.94 %–2.51 %** of model size (worst `rock_a_cut3`), while the vertex
  counts drop 2400 → 1080 for a rock and 6450 → 2898 for a boulder.

  The number that makes this meaningful is the control: the **uncut** pairs,
  measured the same way, disagree by **0.64 %–1.09 %**. The two levels of a
  model are not the same mesh — LOD1 carries about 45 % of LOD0's vertices —
  so their outlines differ a little before anything is cut, and that range is
  by how much. So the cut adds at most **1.86 %** to a gap that was already
  there.

  Read on bounding extents instead, the same pairs give 0.00–3.71 %. Both
  numbers are correct; an extent is a difference of two extremes and so
  roughly doubles the same error. The support figure is the honest one, and
  the two are quoted together because a reader comparing against a different
  measurement should know which was used.
- **The hand-off is a wide dithered band, not a line.** Walking away from a
  cut rock, LOD0 instances span 2.2–157.1 m from the eye and LOD1 instances
  span 35.4–391.2 m — a shared band roughly 120 m deep in which both levels
  draw, each instance picking its own side by hash. This rules out a *row* of
  rocks switching together at one distance, which is the conspicuous form of
  a pop. It does not rule out a single rock changing slightly at its own
  swap; the first measurement bounds that instead.

## 9. Frame time: the 4× pixel pair at TRAILSIDE and EDGE

Samples at `SCALE = 0.5`, high tier, on the final geometry, every game page
blanked before each. Six fresh pages at TRAILSIDE, alternating which build
went first so drift could not load onto one side:

| pair | branch | control | delta |
| --- | --- | --- | --- |
| 1 | 36.04 ms | 35.94 ms | **+0.10** |
| 2 | 35.85 ms | 35.80 ms | **+0.05** |
| 3 | 37.39 ms | 36.48 ms | +0.91 |

**No evidence of a regression, and the strongest reason is structural rather
than measured.** The cut does not change the triangle count the GPU draws each
frame. What multiplied it is the unweld — three vertices per triangle instead
of a shared mesh — and the unweld has been there since the first commit of
this work, in the control and the branch alike once the planes started biting.
Projecting a vertex onto a plane moves it; it does not add one. So a frame-time
difference between the two builds would have to come from something other than
the geometry the pass exists to make, which is the same argument §10 makes for
load time and the same reason both instruments are poor detectors of whether
the planes cut at all.

What the timings say, and no more: two interleaved pairs at +0.10 and +0.05 ms
against a ≤ +0.3 ms bar, and a third at +0.91 ms taken as the machine's load
climbed, with both builds rising together. The third exceeds the bar and is
discounted for drift — which is the same reasoning this section says below
cannot be relied on, so it is offered as a reading to set aside rather than as
a pass. EDGE read −0.05 and +0.14 ms, but on an **earlier** build, before the
geometry fix in §12; it has not been re-run on the finished cut, and by the
argument above it would not be expected to move if it were.

Getting here took three attempts and the two failures are worth recording,
because both would have been reported as findings.

The first two runs were wrecked by load: every series slower in round two
than round one, on both builds, by between +5 % and +63 %. A drift that
uneven defeats the reason for sampling in both orders, which is to cancel a
drift that is at least *steady*, and a ±20 ms swing cannot resolve a ±0.3 ms
bar.

The third looked like a real TRAILSIDE regression — four pairs reading −0.46,
+4.44, −0.15 and +5.28 ms, reproducible across two runs, with an obvious
mechanism to blame. Boulders are the only clutter that casts a shadow, and
the cut turns their four caster meshes into sixteen; a cascaded shadow map
renders its list once per cascade, so that is roughly forty-eight extra draws
a frame. **The obvious mechanism was innocent.** Removing all sixteen cut
meshes from the live shadow render list at that pose moved the mean 35.53 →
35.79 → 35.86 ms as they were pulled and put back — no effect at all, and
less than the drift between the three readings.

What the +5 ms actually was: within one page, three consecutive eight-second
samples repeat to ±0.3 ms, but *between* pages the same build varies by 5 ms,
and the slow sample was always the last of the run — which the script's fixed
view order makes the branch every time. Interleaving repeated pairs on fresh
pages, as in the table above, is what removes it. Absolute levels also moved
from ~27 ms to ~36 ms between runs an hour apart, which is why only
interleaved deltas mean anything here.

## 10. Load time

`performance.now()` around the cut pass in `expandCutVariants`, summed over
both cut classes, on cold page loads of the final geometry. That pass builds
every cut mesh the two classes draw: two classes × two variants × four cuts
is sixteen buckets, each cut at both the near and the far LOD, so thirty-two
meshes in all — the count `clutterMeshes.test.ts` asserts.

| run | rock class | boulder class | total |
| --- | --- | --- | --- |
| 1 | 7.6 ms | 8.1 ms | 15.7 ms |
| 2 | 7.6 ms | 7.9 ms | 15.5 ms |
| 3 | 6.9 ms | 8.9 ms | 15.8 ms |
| 4 | 8.8 ms | 10.1 ms | 18.9 ms |
| 5 | 7.0 ms | 9.0 ms | 16.0 ms |

Against the 50 ms bar, with roughly 2.6× headroom at the worst run. The pass
runs once per class as that class's GLBs land, before its first draw, so it
costs nothing per frame afterwards.

Worth noting for anyone reading these against an earlier revision: the same
measurement before the geometry fix in §12 read 16.0–20.2 ms — indistinguishable,
even though the pass was then projecting almost no planes at all. Projecting
a plane is cheap next to unwelding every triangle and rebuilding the arrays,
which the pass did either way. **The timing could not have detected that the
mechanism was not running**, which is one more instrument that was measuring
something real and saying nothing about the thing that was broken.

## 11. Why the cut declares its own front face

A mesh built from another mesh's vertex data inherits its triangle order but
not its winding declaration. `reliefMesh` builds each cut with `new Mesh`,
which in this left-handed scene defaults to counter-clockwise, while the
glTF loader declares its meshes clockwise. The cut therefore kept the
source's triangle order and announced the opposite front face, so every
facet rasterized as a back face — and because these materials set
`twoSidedLighting`, a back face's shading normal is negated, leaving the
rock lit by ambient alone. The cuts still drew, because back-face culling is
off; they drew dark.

The fix is one line, and the important part is which line: the cut takes
`sideOrientation` from the mesh it was built from rather than from a
constant. A constant that happened to suit the four shipped GLBs would be
the same authoring mistake in a new place. A second instance of that mistake
was fixed in the same pass — `rockRelief` derived its facet normals assuming
one winding, a no-op on the shipped assets and black rocks on any model
wound the other way.

**What the tests for this can and cannot do.** Every one of the suite's
tests passed while the rocks rendered black, and that is not a gap that was
closed: nothing in the suite rasterizes, shades, or reads a pixel, because
its scenes run on a `NullEngine`. The tests added here pin the declaration —
that a cut's front face matches its source's, on a source of either winding,
and that no facet ends up facing inward. Two things they provably cannot
see, each confirmed by putting the defect back and watching the suite stay
green: a material that overrides the mesh's value, and the assignment order
in `reliefMesh`, where `sideOrientation` must be set before `material`.
Those are held by comments in the code, not by tests. Credit this coverage
with catching one specific authoring mistake in one function; the only
evidence that the rocks are lit is a frame, and the frames are in §7.

## 12. Why the planes were not cutting anything

For most of this work the cut was seeding ten planes per model and cutting
with almost none of them, and every test passed. It is worth setting out
exactly how, because the shape of the mistake is more interesting than the
mistake.

A plane needs an offset: how far from the middle of the model to put it. The
design says `ROCK_DEPTH` of "the model's half-extent along that normal", and
the build read half-extent as the model's largest distance from its centroid
to any vertex — one number, whichever direction that vertex lay in. On a
sphere the two readings are the same number, because every vertex of a sphere
is at that distance in its own direction too. On anything else they are not,
and a rock is emphatically not a sphere: the shipped models run two to three
times longer on one axis than another. Offsetting by the global number put
each plane out at the model's longest reach no matter which way it faced, so
in every direction but the longest it sat outside the surface entirely, its
cap came out empty, and the cap-share floor dropped it as too small.

Measured across the four shipped models at the near LOD: **11 of 160 candidate
planes survived** (22 of 320 across both LODs). Seven of the sixteen cut
buckets kept none at all. All four of `boulder_a`'s cuts were the same solid,
differing only in the seed of their roughening noise — four cuts per model,
spread across a field of rocks by hash, delivering one silhouette. What made
the rocks read as angular in §7 was the unwelding and the flat face normals,
which is real and is most of the look, but it is not the fracture the planes
were there to cut.

Those pre-fix figures were re-derived against the removed code rather than
carried forward from the first reading of it, which reported 7, ten and three.
A section whose subject is a measurement that looked right and was not is the
last place to quote a number nobody re-took.

The fix is to offset a plane by the model's reach **along that plane's own
normal** — its support distance — which is the same proportional bite on any
shape and the identical plane on a sphere. After it, 148 of the 160 survive at
the near LOD and 295 of 320 across both, the weakest bucket keeps six, and no
two cuts of one model agree on their outline to closer than 6.3 % of the
model's largest dimension.

**Why nothing caught it, which is the part worth remembering.**

Every geometry test ran on a synthetic icosphere, and the icosphere is not
merely a convenient stand-in for a rock. It is *the one shape on which this
mechanism is perfect*. The bug was that two readings of "the model's reach"
had been confused — the reach in a particular direction, and the largest reach
in any direction — and a sphere is precisely the shape where those two numbers
are equal. Under either version of the code, all ten candidate planes survive
on a sphere, in all four cuts. Anyone reading the tests, or the tests
themselves, would see the cut working perfectly. It was working perfectly, on
the only shape it was ever shown.

The visual gate did not catch it either; it confirmed the wrong thing. The
stills in §7 are real — the rocks genuinely did stop looking like smooth
loaves and start looking like broken stone. What produced that was the
unwelding and the flat face normals, which are most of the look and which
worked from the first commit. So the gate asked "does it look like fractured
rock?", answered yes, and said nothing whatever about whether the fractures
existed. A green suite and a set of before-and-after stills both passed over a
mechanism that was seeded, judged and discarded without ever cutting
anything.

The general lesson, stated plainly for whoever reads this next:

- **A fixture that cannot fail is not a test.** Ask of every geometric fixture
  which property of it the code under test depends on, and whether that
  property is one the real inputs share. A sphere is isotropic, uniformly
  sampled and convex; a rock is none of those. Every one of those three
  differences hid a separate defect here — the anisotropy hid this one, the
  concavity hid a 21 µm bound violation (§4), and the uniform sampling hid the
  fact that the cap-share ceiling can never fire on a sphere at all.
- **A look gate confirms the look, not the mechanism.** When a change is meant
  to work by a specific mechanism, something has to measure that the mechanism
  ran. "It looks right" is compatible with the named cause contributing
  nothing, and here it was.
- **Run it on the shipped asset.** `rockReliefModels.test.ts` exists for this.
  It cuts the four real GLBs, loaded through the path the game loads them by,
  and asserts what the design promises *there*: that planes survive, that a
  model's four cuts are four different solids, that both LODs cut to one
  shape, that the only-removes-material bound holds on real geometry, that a
  prop keeps enough of its sink, and that every cut shows the six distinct
  facet planes §6 asks for. It is slower than the sphere tests and it is the
  only thing standing between this mechanism and a silent return to doing
  nothing.

**Two things the fix turned up.** `boulder_a`'s top is untouched in all four
of its cuts — no seeded plane faces steeply enough upward to clear the floor
there — while `boulder_b` is genuinely cleaved, losing 11.3 % of its height in
its first cut and 2.5 to 2.8 % in two others.

That cleave is the look the design asked for, and it is also the one place
this pass can be seen from the simulation. A boulder's collider box runs from
the ground to `BASE_H · scale · (1 − BOULDER_SINK)`, sized from the UNCUT
mesh's height — a constant in `sim/passes/clutter.ts` that a renderer-only
pass must not move, and does not. But whatever a cut takes off the top is box
left standing above stone: 0.2135 m in model space, which at
`CLUTTER_BOULDER_SCALE_MAX` is **up to 0.30 m at the largest instance scale the
sim draws.** Nothing in `sim/` changed and the mesh is still wholly inside its
box, so "renderer-only, colliders untouched" remains literally true — and a
reader should not take it to mean that what the player sees and what they
collide with still agree everywhere on a boulder, because at the top of
`boulder_b` they do not. It was accepted rather than fixed: the divergence is
inside the ~0.15 m at model scale that the box's own comment already allows
for ground tilt, a 2.6 m boulder is not something a hiker can climb, and the
obvious lever — narrowing `ROCK_DEPTH` — would spend the cut-to-cut variety
this whole fix exists to buy. A test holds the cleave under 15 % of a
boulder's height so it cannot quietly grow.

## 13. Follow-ups

- **Close the boulder cleave without touching `ROCK_DEPTH`.** Refuse a
  candidate plane whose normal points steeply upward, so a cut takes flanks
  and undersides but never the crown. That leaves the box and the visible top
  in agreement, costs none of the cut-to-cut difference measured above, and is
  a few lines in `rockPlanes`. The reason it is not done here is that it is a
  new rule with its own look consequences — a boulder that can never be
  cleaved is a boulder that keeps its dome — and that is a design question,
  not a bug fix.
- **Retire or rewrite `2026-09-23-rock-relief-plan.md`.** It predates the work
  this note records, it is written as a sequence of tasks rather than as a
  description of the game, and its code sketch calls `rockHalfExtent` eight
  times — a function the cut no longer has. A reader who finds it first will
  be reading a shape the code left behind.
- Moss and lichen on the north faces of facets, as a vertex-colour tint by
  facet normal (from the design's own follow-ups).
- Cut the ground's scree paint to match, so a boulder and the scree it sits in
  agree (likewise).
