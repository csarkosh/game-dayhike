# Rock relief: verification

What was built, why its two geometry decisions were made, and the test
evidence for the cut described in
[`2026-09-23-rock-relief-design.md`](2026-09-23-rock-relief-design.md). The
stills, the LOD walk and the timings in §7–§10 were taken on live pages
against a control build at the commit this work started from.

## 1. Method

`rockRelief.ts` is Babylon-free: plain vertex arrays in, plain vertex arrays
out, exercised directly by its own test file on a synthetic icosphere (and an
anisotropic stretch of one — see §3) rather than through the engine.
`clutterMeshes.ts` is exercised through a `NullEngine` scene, the same escape
hatch the rest of the clutter shell's tests use. Both are unit-level and run
in milliseconds; neither substitutes for the gates below, which need a real
page, a real GPU and a control build at the commit this work started from.

## 2. What was built

`rockRelief.ts` cuts a model's vertex arrays with up to `ROCK_PLANES = 10`
seeded planes per (model, cut), skips a plane whose cap would take too few or
too many vertices, shrinks the whole model slightly, unwelds every triangle
to its own three vertices, roughens each along the input's own vertex normal,
and writes a per-facet luma as vertex colour. `clutterMeshes.ts` runs this on
each rock and boulder model's near and far LOD as its GLB lands, four cuts
per model, and spreads an instance across its class's four cuts by its own
hash. Two decisions the design's earlier sections did not settle are recorded
in the spec's Amendments section and explained here.

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
difference between the stored and the recomputed normal is about 1.47%; the
test's tolerance was set at 5%, comfortably above that peak and still far
below the error a genuinely wrong normal (flipped sign, wrong plane,
non-unit length) would produce.

## 4. Why the roughening amplitude scales by each vertex's own distance from the centroid

The shrink step pulls every vertex toward the centroid by `ROCK_ROUGH` of
*that vertex's own* distance from the centroid. The roughening step then
pushes it back out by up to the same fraction, along its vertex normal. For
these two steps to guarantee "a cut only removes material" — no output
vertex ends up farther from the centroid than the input vertex it came
from — the push-back has to be scaled by the same per-vertex distance the
shrink used. Scaling it by the model's half-extent instead (a single global
number) works only when every vertex sits at that same distance from the
centroid, which is true for a sphere and false for almost any real rock: a
vertex nearer the centroid than the model's most extreme point would be
shrunk by less than the half-extent-scaled roughening could push it back
out, letting it finish outside its own starting distance. Since a boulder's
mesh is what the sim's collision box is sized against, that failure mode is
exactly what the box cannot tolerate.

This was caught by a test, not by inspection: an anisotropic fixture (the
same icosphere scaled unevenly on its three axes, spreading vertex distances
from the centroid far more widely than a uniform sphere does) failed against
the half-extent-scaled version, with a vertex measured about 0.003 units
farther from the centroid than it started. Scaling by each vertex's own
distance instead makes the bound provable by the triangle inequality — for
any displacement direction, not only a radial one — rather than true only by
coincidence of a sphere-shaped test fixture.

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

- `rockRelief.ts`'s own test file plus the Babylon-free architecture check:
  14 tests passing, including the anisotropic hull-bound fixture (§4) and the
  facet-normal tolerance (§3).
- `clutterMeshes.test.ts` (rock relief in the shell, `cutsFor`/`cutOf`,
  `reliefMesh`) plus `renderer.test.ts`, `bladeMeshes.test.ts`,
  `rockRelief.test.ts` and the architecture check together: 54 tests passing
  before the model-index fix below; 55 after (the new test added with it).
- The `cutOf` hash-to-cut routing was confirmed red against the naive
  `hash & (cuts - 1)` (which coerces the unit-float hash to 0 via `ToInt32`
  and puts every instance in cut 0) before the fix that scales the hash into
  the cut range first, then green after.
- The model-index fix (§5) was confirmed red against the unfixed shell — two
  synthetic assets sharing a half-extent for rock's and boulder's first
  variant produced identical plane lists — then green after keying the plane
  list on `cls * 16 + variant`.
- `npx vitest run --root client --maxWorkers=3`, `--root server`, and
  `--root tools`, plus `npm run typecheck` and `npm run lint`: see the commit
  history for the exact pass counts recorded at each step of this work.

## 7. Stills: a rock at 2 m and a boulder at 4 m

Both builds were driven to the same poses on the forest slope east of the
trail, where rock and boulder ground actually is, on seed `atmo` under clear
weather. The subjects are a rock at 2.2 m — camera `(371.9, 136.4, 593.8)`
looking west — and a boulder at 4.3 m — camera `(364.0, 135.6, 592.0)`,
yaw 1.15 — each shot at 12:00 and at 16:00.

The change is unambiguous at both distances and both hours. Before, the rock
reads as a smooth rounded loaf: one soft silhouette, no internal edges, the
whole surface shading as a single curve. After, it reads as broken stone —
planar faces each taking the light at its own angle, hard creases between
them, and a silhouette with corners in it. The boulder behaves the same way
at 4 m, where the larger model's cuts give it a flat cleaved top rather than
a dome.

The cut rock's silhouette is slightly smaller than the uncut one, which is
the shrink the cut applies before roughening (§4); at 2 m the difference is
not readable as a size change, only as a sharper outline.

## 8. LOD-swap walk

The concern this gate exists for is that a rock could change SHAPE, not just
detail, at the moment its LOD swaps — which is what the one-plane-list-per-
model rule in `expandCutVariants` prevents. Two measurements, both taken on
the live page:

- **The two LOD levels agree on shape.** For all sixteen cut meshes, LOD0's
  and LOD1's bounding extents agree to within 1.5 % on every axis (worst
  case: `boulder_a` at 1.5 %, best: `rock_a_cut3` at 0.1 %), while the vertex
  counts drop 2400 → 1080 for a rock and 6450 → 2898 for a boulder. Detail
  falls by more than half; the outline does not move.
- **The hand-off is a wide dithered band, not a line.** Walking away from a
  cut rock, LOD0 instances span 2.2–157.1 m from the eye and LOD1 instances
  span 35.4–391.2 m — a shared band roughly 120 m deep in which both levels
  draw, each instance picking its own side by hash. There is no distance at
  which a row of rocks switches together, which is what would read as a pop.

## 9. Frame time: the 4× pixel pair at TRAILSIDE and EDGE

Paired samples at `SCALE = 0.5`, both orders, high tier, every game page
blanked before each sample:

| order | view | branch | control | delta |
| --- | --- | --- | --- | --- |
| branch first | EDGE | 40.29 ms | 48.42 ms | −8.13 |
| branch first | TRAILSIDE | 36.82 ms | 34.79 ms | +2.03 |
| control first | EDGE | 48.56 ms | 51.00 ms | −2.44 |
| control first | TRAILSIDE | 56.76 ms | 56.72 ms | +0.04 |

**This pass does not settle the gate and is recorded as inconclusive.** The
second round's readings are 40 % slower than the first on BOTH builds
(TRAILSIDE control 34.79 → 56.72 ms), which is machine load moving under the
measurement, not either build changing. A ±8 ms swing cannot resolve a
±0.3 ms bar. The deltas do rule out a large regression — their mean is
negative — but the gate needs a repeat on an otherwise idle machine before it
can be called passed.

## 10. Load time

`performance.now()` around the cut pass in `expandCutVariants`, summed over
both cut classes (all sixteen meshes), on three cold page loads:

| run | rock class | boulder class | total |
| --- | --- | --- | --- |
| 1 | 11.0 ms | 9.2 ms | 20.2 ms |
| 2 | 8.5 ms | 7.5 ms | 16.0 ms |
| 3 | 8.1 ms | 9.8 ms | 17.9 ms |

Against the 50 ms bar, with roughly 2.5× headroom at the worst run. The pass
runs once per class as that class's GLBs land, before its first draw, so it
costs nothing per frame afterwards.
