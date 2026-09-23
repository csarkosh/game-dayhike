# Rock relief: verification

What was built, why its two geometry decisions were made, and the test
evidence for the cut described in
[`2026-09-23-rock-relief-design.md`](2026-09-23-rock-relief-design.md). The
gate's stills, walk and timings are run separately on live pages against a
control build and are recorded here once measured.

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

_Pending: measured by the controller on the gate rig._

## 8. LOD-swap walk

_Pending: measured by the controller on the gate rig._

## 9. Frame time: the 4× pixel pair at TRAILSIDE and EDGE

_Pending: measured by the controller on the gate rig._

## 10. Load time

_Pending: measured by the controller on the gate rig._
