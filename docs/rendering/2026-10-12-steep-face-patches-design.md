# Steep face patches: a finer rock surface over the steep ground

The steep faces of the world — the coast's scarp, the sea stacks, the cove's
walls, the terrace risers — are smooth surfaces with a rock texture painted
on them. At any distance under a hundred metres they read as a dune: the
texture has grain at the metre scale, and the shape under it has none. Rock
models stood on the faces (`docs/rendering/2026-09-24-cliff-modules-design.md`)
cover the shape without becoming it.

This design leaves the heightfield as it is and draws, over every steep
cell within reach, a patch: a finer grid of the same ground, each vertex
pushed out along the face's normal by a rock relief — columns on some faces,
jointed blocks on others. The patch is drawn with the terrain's own material,
so it is the same rock, the same paint and the same light as the ground it
covers; the ground's height is not changed, and where a patch covers fully
steep ground the clipmap leaves its own triangles there out. The patches are the
game's, not the simulation's: the collision surface does not move, and the
level id moves only because the rock models no longer stand on the faces
(§1).

The world's ground is one height function, built for the whole world from
one family of noise. That family makes hills and valleys well and cliffs
badly, because a cliff is not a hill turned up: it has joints, columns and
blocks, with their own scales and their own regularity. This design puts a
second function with those forms on the steep ground, on a surface fine
enough to show its joints.

## 1. Decisions

| question | decision |
| --- | --- |
| Where the relief lives | In the game layer, on separate patch meshes; the simulation's height function is untouched |
| What it is masked by | The ground's own gradient: nothing under 1.0, the whole relief from 1.4 up (`FACE_SLOPE_LO`, `FACE_SLOPE_HI`); the standing limit is 1.02 |
| The forms | Two, chosen by a slow noise over the world: columns (a jittered cellular field, the cells read as tall prisms on a steep face) and blocks (a near-square lattice with rounded joints, two octaves), both standing on large forms, a coarse octave of tilted slabs 20 m across |
| The size of the relief | Outward only, up to `PATCH_DEPTH = 4.0` m along the face's normal, the relief's half-depth (`FACE_HALF_DEPTH = 2.0`) doubled: the smooth face is the deepest joint, and no patch vertex is ever under the ground. Where the ground bends sharply the depth is cut, so the push stays under half the bend's radius |
| The patch grid | 16 m cells on the world's lattice; 0.5 m vertices within 48 m of the camera, 1 m within 160 m, 2 m within 400 m, none beyond (high tier; 36/120/300 m on medium, 24/80/200 m on low) |
| Normals | The displaced surface's, from the ground's and the relief's derivatives at each vertex, not from the grid: a column's flat face shades flat and its joint steep at either spacing, and a point has one normal in every patch that holds it |
| The ground under a patch | Dropped where it is fully steep: the clipmap leaves out each triangle whose three vertices have the whole mask (a gradient of 1.4 or more) in a 16 m square well inside the reach, so the lifted envelope no longer stands over the joints there. Kept everywhere else — at the reach's edge, on each ring's border row and the row around its hole, and wherever a vertex is less steep — under the patch, whose material carries a depth offset so the two never fight where the relief is zero (§4.4) |
| Collision | On the heightfield, as before: a player at the foot of a face can stand up to 4 m inside the drawn rock |
| The level id | Moves once, by the cliff modules' density, which is a tunable of the cliffs pass; the relief, the patches and the paint do not move it |
| The cliff modules | No module stands on a face: `CLIFF_DENSITY` is 0, so no cell starts a run, the cliff pass makes no collider and the shell fetches no model. The field and its tests remain, the tests laying it at a density of their own (0.1) |
| The grey rock | The steep rock and the scree paint a dark neutral grey: `ROCK` 0.081 and `SCREE` 0.115 on every channel (`terrainSurface.ts`), where they were a light grey-tan (§4.5) |
| The rock repeat | 5.4 m, three times its source's 1.8 m, for the whole rock layer wherever it is drawn: the faces, the scree and every fragment with rock weight (§4.5) |
| Shadows | The sun's shadow keeps at least 0.17 of its light, for every receiver (§4.5) |
| The lakes' reflections | The patches are drawn in the mirror (high) and the panorama (medium) through the stand-in the clipmap's rings are drawn with there, entering as each is built and leaving as each is dropped (§4.6) |
| The rain's cover map | The patches are in it as terrain, beside the clipmap's two inner rings, entering and leaving as they come and go (§4.6) |

## 2. Goals and non-goals

Goals:

- Steep ground reads as rock at every distance under about 150 m: facets
  that catch the light differently from their neighbours, crisp joints
  within 48 m, an uneven silhouette on a crest, no grain-on-a-dune.
- Columns on some faces, blocks on others, and the two never meet on one
  face.
- No crack between patches, between a fine patch and a coarse one, or
  between a patch and the ground at its edge.
- No triangle turned over by the push: the depth is cut where the ground
  bends sharply, so a hollow does not gather its points past its centre
  and a sharp crest is not notched.
- In `client/src/sim/`, one new pure module (`faceRelief.ts`) and one
  value: the cliff modules' density, 0. With the face its own rock, the
  models were cover the relief no longer needs, standing over it rather
  than being it; the density is a tunable, so the level id moves by it
  alone.

Non-goals:

- Overhangs. The patch is pushed out along the normal, not folded.
- Collision on the relief.
- The terrace stage (`cliffs.ts`) and its ledges, which stay as they are.
- The rock texture's maps. The paint changes in three values only: the
  rock and scree colours, made a dark neutral grey where a face read a
  light grey-tan, and the rock layer's repeat, made three times larger so
  the texture's stones do not break the relief's rocks back into cobbles
  (§4.5).

## 3. The relief function (`client/src/sim/faceRelief.ts`)

Pure, trig-free, seeded, with exact derivatives. Everything below is a
function of the world position alone, so it is the same whoever samples it.
It lives in the simulation layer so that the simulation can take it into
the height function later without a change to its form.

### 3.1 The cellular field

`cellularD(x, z, cell, jitter, border, salt): { v, dx, dz }`

A lattice of `cell` metres. Each lattice cell `(i, j)` holds one point,
displaced from the cell's centre by up to `jitter · cell / 2` in each axis
(from `hash3(i, j, 0, salt)` and `hash3(i, j, 1, salt)`), one value
`o ∈ [−1, 1]` (from `hash3(i, j, 2, salt)`) and one tilt `(a, b)`, each in
`[−1, 1]` (from `hash3(i, j, 3, salt)` and `hash3(i, j, 4, salt)`). For the
sample's position, the nine cells around it give nine points `c_k = (sx_k, sz_k)`
at distances `F_k`, the nearest at `F1`. Each point carries a plane `u_k`
through it, weighs by how much farther it is than the nearest, and the field
is the weighted mean of the planes:

```
u_k = o_k · FACE_VALUE_SPAN + FACE_TILT · (a_k · (x − sx_k) + b_k · (z − sz_k)) / cell
w_k = 1 − smootherstep(0, border, F_k − F1)
v   = clamp(Σ w_k · u_k / Σ w_k, −1, 1)
```

`border` is the width, in metres, of the blend across a joint. The field is
the nearest point's plane inside a cell, where every other point is a
joint's width farther, and exactly the mean of two planes on the border
between two cells where no third point is within a joint's width; it is
continuous everywhere, since `F1` is.

A level cell differs from its neighbours only across the joint between
them, and a joint is half a metre to a metre and a half wide, so a face of
level cells reads soft. Each cell is therefore a plane, tilted its own way by up to
`FACE_TILT` of the unit range per cell crossed in each axis, and
neighbouring cells meet the light at different angles across their whole
width. A point with weight lies within `F1 + border ≤ 1.42 · cell + border`
of the sample, so its tilt term is at most
`FACE_TILT · 2 · (1.42 + border / cell)`, about 1.06 for the columns,
1.16 for the blocks and 1.12 for the large forms; with
`o · FACE_VALUE_SPAN` beside it a plane can pass ±1 far up its tilt. The
field is clamped to `[−1, 1]`, its derivative zero where the clamp holds,
so the range is kept for every sample. Over 20,000 points the largest tilt
term with weight is about 0.43 and no blend reaches the clamp.

With `W = Σ w_k`, the derivative is
`(Σ w_k′ · u_k + Σ w_k · ∂u_k) / W − v · (Σ w_k′) / W`, where
`∂u_k = FACE_TILT · (a_k, b_k) / cell`, with
`w_k′ = −smootherstep′(0, border, F_k − F1) · (∇F_k − ∇F1)`, the step's
derivative in its argument, and `∇F = (p − c) / F` for each point `c`; a
point exactly on a lattice point (`F < 1e−9`) takes `∇F = 0`.
The field is smooth across a joint of two cells and has kinks only at the
junctions of three or more cells, where the nearest point changes while a
third has weight, as a joint does. When a point with weight could lie
outside the nine cells (`F1 + border` past the nearest any point outside
can be), the search widens to the twenty-five around the sample, which holds
every point with weight for any `border` under `(2 − √2) · cell`, about
0.59 of a cell; the forms below keep their joints under a quarter of a cell
(0.10 for the columns, 0.23 for both octaves of the blocks, 0.175 for the
large forms), where that is rare, and the field is the whole blend for every
sample.

### 3.2 The forms

Columns: `cellularD(x, z, 5.0, 0.8, 0.5, COLUMN_SALT)`. On a face with
gradient `g`, a cell `c` metres across on the map runs `c · g` metres up the
face, so the cells of a steep face stand as prisms two to three times taller
than they are wide, and on a gentler one as blocks.

Blocks: `cellularD(x, z, 6.0, 0.25, 1.4, BLOCK_SALT)` plus half of
`cellularD(x, z, 3.0, 0.25, 0.7, BLOCK_SALT_2)`, the sum scaled by 2/3 to
stay within `[−1, 1]`. The low jitter keeps the joints near two directions,
and the wide border rounds the blocks' edges.

The cells are sized for fewer, larger rocks on a face. They were first
2.8 m for the columns and 3.6 m and 1.8 m for the blocks, with joints of
0.3, 0.9 and 0.45 m, and under the rock texture's small stones a face read
as busy; each grew by two thirds to four fifths, its joint with it, so the share of
a cell its joint takes is about what it was.

Both forms, and both octaves of the blocks, take their planes from the same
two constants, each octave with its own cell size beneath the tilt:
`FACE_VALUE_SPAN = 0.6`, the share of the unit range a cell's value spans
at its site, and `FACE_TILT = 0.35`, the share a tilt of 1 rises across one
cell. The span leaves room for the tilt within `[−1, 1]`.

The large forms: `cellularD(x, z, 20, 0.6, 3.5, FORM_SALT)`
(`FACE_FORM_CELL`, `FACE_FORM_JITTER`, `FACE_FORM_BORDER`). From the road,
80 m off, a face a hundred metres tall whose only relief is joints three
metres apart reads as a faint ribbing; real rock carries buttresses and
gullies ten to twenty metres across under its joints. This octave gives a
face those: its cells take their planes from the same `FACE_VALUE_SPAN` and
`FACE_TILT`, the tilt counted per cell crossed, so each 20 m cell is a slab
leaning its own way, and the 3.5 m border rounds neighbouring slabs into
one another (14 m and 2.5 m before the fine cells grew, which they grew
with). It does not depend on the noise that chooses the form, so
columns and blocks stand on the same large forms, and it is evaluated
wherever the relief is.

### 3.3 Which form where

`k = gradientNoise2(x / FACE_KIND_WAVE, z / FACE_KIND_WAVE, KIND_SALT).v`
with `FACE_KIND_WAVE = 150` m, and `s = smootherstep(−0.15, 0.15, k)`: the
relief is columns where `s = 0`, blocks where `s = 1`, a blend in a band
between. Only the forms with weight are evaluated. The blend band is where
both forms are weak, never a face with both.

### 3.4 The function

`faceReliefD(seed, x, z): { v, dx, dz }` with `v ∈ [−1, 1]`, unitless.
The fine relief `v_fine` is the mix of columns and blocks by `s`; the large
forms `v_form` lie beneath it at `FACE_FORM_WEIGHT = 1.5` to its 1, and
their weighted mean is multiplied by `FACE_GAIN = 2.5`:

```
v = clamp(FACE_GAIN · (v_fine + FACE_FORM_WEIGHT · v_form) / (1 + FACE_FORM_WEIGHT), −1, 1)
```

Both terms are within `[−1, 1]`, so their weighted mean is, but it
clusters near zero, a mean `|v|` of 0.19 over 20,000 points; the gain
spreads it over the range, a mean `|v|` of 0.46, and the clamp, taken last
with a zero derivative where it holds, is a working bound that holds 7.3 %
of those points at ±1. At a half-depth of 2 m that is fine joints of up to
±2 m on large forms of up to ±3 m, held to ±2 m together. The derivatives
run through the forms and both mixes, times the gain. Every constant above is exported in `FACE_RELIEF_TUNABLES`, with
`FACE_SLOPE_LO = 1.0`, `FACE_SLOPE_HI = 1.4` and `FACE_HALF_DEPTH = 2.0`
beside them.

## 4. The patches

### 4.1 The grid (`client/src/game/facePatches.ts`, pure)

The world is divided into `PATCH_CELL = 16` m cells. For a cell and a
spacing `p` (0.5, 1 or 2 m) the patch is the `(16 / p + 1)²` lattice of the
cell's own grid points, boundary included. At each point:

```
s = elevationSampleAt(seed, x, z)
g = sqrt(s.dx² + s.dz²)
m = smootherstep(FACE_SLOPE_LO, FACE_SLOPE_HI, g) · taper
r = faceReliefD(seed, x, z)
D = PATCH_DEPTH / (1 + PATCH_DEPTH · κ / PATCH_BEND_SHARE)
d = m · D · (r.v + 1) / 2
k = d / sqrt(1 + g²)
position = (x, s.h, z) + (−s.dx, 1, −s.dz) · k
```

`d` is zero wherever the ground is not steep, so a patch's edge lies on
the ground exactly, and never under it.

`D` is the depth the ground's bend leaves: `PATCH_DEPTH = 4` m on even
ground, and where the ground bends by `κ` per metre, always under
`PATCH_BEND_SHARE = 0.5` of the bend's radius `1 / κ`. Pushed out along
its normal by its radius, a hollow's points meet at its centre and the
surface turns over; and the ground has sharp crests whose gradient turns
through two or three in half a metre, where the mask is nothing on the
crest and whole a step down either flank, so a full push notches the crest
and turns the triangles across it over. `κ` is therefore the sharper
principal curvature of the ground, concave or convex: the larger magnitude
of `λ / sqrt(1 + g²)` over the roots of `det(H − λ (I + ∇h ∇hᵀ)) = 0`, with
the Hessian `H` from differences of the ground's gradient
`PATCH_CURVE_STEP = 0.5` m on in x and in z, and again 0.5 m back, the
larger of the two. A one-sided difference sees a crease on either side of
the point, where a central one can step over a crease narrower than its
step. The step is a fixed world distance, not the grid's, so a point has
one depth in every patch that holds it; at 0.5 m the grid's own samples
and a ring one step outside the cell give the differences, at 1 m four
samples of the ground a point. The cap is smooth in `κ`, so the depth has
no step of its own.

The vertex normal is the displaced surface's, from the field's own
derivatives rather than from the grid. With `n = (−s.dx, 1, −s.dz)`, the
surface's tangents are

```
∂P/∂x ≈ (1, s.dx, 0) + n · (m · D / 2 · r.dx + m_g · D · (r.v + 1) / 2 · τ_x) / sqrt(1 + g²)
∂P/∂z ≈ (0, s.dz, 1) + n · (m · D / 2 · r.dz + m_g · D · (r.v + 1) / 2 · τ_z) / sqrt(1 + g²)
```

with `m = m_g · τ`, the mask times the taper, and `τ_x`, `τ_z` the taper's
derivatives (below), which are not slow: across its 3 m ramp the taper
lifts the relief by up to 4 m. The slowly varying terms (the mask's
derivative, the depth's, the ground normal's and `sqrt(1 + g²)`'s) are left
out, and the normal is `∂P/∂z × ∂P/∂x`, normalised: `n` itself where the
relief is nothing, up on flat ground as the clipmap's. A column's flat face
shades flat and its joint steep whatever the grid's spacing, and the normal
is a function of the world point, so a point shared by two patches has one
normal in both. Over the taper's ramp the vertex normals are within 12° on
average of those the grid's differences give, against 32° without the
taper's term.

The cut is measured, not proven: a triangle is taken to turn over when its
facet faces away from the same three grid points' facet on the ground. Over
the reference pose's patches none does, and the least agreement of the two
facets is a cosine of about 0.19, on the steepest columns at 0.5 m; on world
42's sharp ridge, cell (25, 34) at 0.5 m, it is 0.26. With the first, finer
cells (§3.2), over 250 steep cells at 0.5 m on each of worlds 1, 42 and
123456 it was 0.27, 0.14 and 0.11, with none turned over. Without the cut, at the full 4 m,
those cells turned 64, 179 and 164 triangles over, the worst facing
straight back.

The vertex colour is `classifySurface(...).albedo` at the point, and the
attributes `terrainWeights`, `terrainWeights2` and `terrainCover` are the
clipmap's for the same point, so the patch is painted as the ground under
it would be.

A cell has a patch when any of its grid points, boundary included, has
steep ground. Two patched neighbours share their boundary points bit for
bit, so they meet without a crack. A cell whose steep ground reaches its
boundary pulls its neighbour in through the shared points, so inside the
reach a patch never ends with its relief in the air. At the wide reach's
edge the neighbour is not drawn: there `taper` fades the relief to nothing
over `PATCH_TAPER = 3` m, a quintic step of the distance from the point to
the nearest square of a neighbour outside the set, 0 on its edge and 1
from 3 m in, whose derivative is the step's slope along the way out of
that square. A cell's eight neighbours, sides and corners, are flagged
open or not, so where the edge steps in, the cell open at a corner fades
toward the same square as its neighbour open at a side, and the two still
meet bit for bit.

Where a patch meets a coarser one, 0.5 m on 1 m or 1 m on 2 m (neighbouring
cells are never more than a band apart), the finer patch's midpoints on the
shared edge are set to the mean of the two coarse endpoints, position and
paint (colour, weights and cover), as the coarse patch interpolates its
edge, so the edge has one shape and one paint on both sides; the normal is
the mean made unit again. The shared points are the coarse patch's own,
normal included, with no special case.

### 4.2 The bands and rebuilds (`client/src/game/facePatchMeshes.ts`, shell)

Each frame the camera's cell is read; when it changes, the set of cells
within the wide reach is walked from the centre of the camera's cell, so
the set is a function of that cell alone, each cell's spacing chosen by
the distance from that centre to the cell's centre (0.5 m within
`near`, 1 m within `far`, 2 m within `wide`, `PATCH_REACH`), and every cell that entered or
left the set, or whose spacing, stitched edges or open neighbours changed,
is rebuilt or dropped. A cell's
patch is one mesh; the pure module gives it as a `VertexData`-shaped
record (positions, normals, colours, the three attributes, Uint16
indices), and the shell uploads it. A cell without steep ground is
remembered as empty while it stays in the set at its spacing: its stitch
does not make it steep.

| tier | `near` (0.5 m) | `far` (1 m) | `wide` (2 m) |
| --- | --- | --- | --- |
| high | 48 m | 160 m | 400 m |
| medium | 36 m | 120 m | 300 m |
| low | 24 m | 80 m | 200 m |

Past 160 m a face 2 m across a vertex still shows its large forms, slabs
20 m across, where the clipmap's 4 m and 8 m rings show none of them.

The patches use a terrain material of their own, made by the same factory
as the ground's (`terrainMaterialFor(scene, "facePatch")`: the same PBR
material, the terrain texture, the wet layer and the atmosphere attached),
with `zOffset = −1` so the patch wins over the ground where the two
coincide. The patches cast and receive shadows with the clipmap.

**The rebuild as a job.** The patches build on the renderer's scheduler
(`syncJobs.ts`), as the clipmap and the ground cover do. A crossing at a
walk is one job. Its first slice works out the new set: the cells, their
spacings, stitches and open neighbours, and which of them the set drawn
does not hold as wanted. Then each cell to build, nearest the camera's
cell's centre first, has a slice of its own, which the slice before says
it will take (5 ms near and 2 ms far, `FACE_PATCH_SLICE_MS`, 0.5 ms wide), so
a near cell starts only as a frame's share begins; the cell is made into
its mesh and uploaded, hidden and in no registry. The last slice applies
the set: the new meshes shown and entered into the shadow map, the
reflections and the rain's map, and the patches of the cells that changed
or left dropped, together. No frame draws half a set, and a changed cell's
old patch is drawn until its replacement is.

The job is patient, a kind the scheduler runs after every other job, with
the share they leave, and never runs to its end at once, as it does a job
six frames or 100 ms old. A crossing builds about 140 cells, about 120 ms
of work, far more than six frames' share, and waiting costs only detail,
never a hole: the set drawn is whole, and the clipmap leaves out only the
ground it covers. Idle work, every shell's, runs while only patient jobs
are pending, with what they leave.

**Which crossings wait.** As the clipmap's (`crossingAt`): a one-cell step
at a walk or a run is a job; a jump of more than a cell and a view moving
more than a metre a frame (the free camera's boost) build at once, and a
pending job is dropped. The first update builds the near band at once, the
0.5 m cells within `near` (29 at the reference pose, 20 of them with a
patch), applies it, and begins a job for the rest of the set: the first
frame has the face in front of the camera, and the distance fills in over
the frames after it. A crossing while a job is pending begins the job
again for the new cell, in the old one's place; the cells built so far are
kept, and the new job builds only those the new set wants and does not
find built as it wants them. Finishing the old job first would build at
once what is left of it, the stall the job is there to avoid, for a set
already behind the camera.

**Building ahead.** While no job is pending, idle work builds the cells
the next crossing will want: the cell the camera reaches next on its
heading (`nextCrossing`), its set worked out against the set drawn, and
its cells to build, nearest first, a slice each, hidden. An idle slice
says what it will take, as a job's does, and one that would not fit in
what is left of the frame's share waits to be first in the next, while
the idle work behind it goes on. A crossing stops the idle work, and its
job builds what is not yet built. When the camera turns, the work is aimed
at the new cell, and what was built for the old one is kept, each cell by
its band and stitch, so a camera that turns back builds nothing twice;
when a set is applied, whatever is built and not in it is let go. At a
walk a crossing finds every cell built, and its job only works out the
set and applies it, in the crossing's own frame.

**The cover follows what is drawn.** The clipmap asks the patches for the
ground they cover (`FacePatches.cover`) as each of its rebuilds begins:
the cover of the camera's cell the set drawn was walked from, not of the
camera's cell, so a ring never leaves ground out under a square whose
patch is still building. Before any patch is drawn it is null; while the
first update's job is pending it is the near band's, its reach the near
reach less a cell's diagonal and `fine` the near reach. The patches are
updated before the clipmap each frame, so a set built at once is the one
the rings' rebuild in that frame reads. The clipmap asks every frame as
well, and when the patches have drawn a set since its rings were built,
the camera standing or not, it begins a rebuild of its own, which draws
again only the rings whose cover's centre, reach or `fine` changed. A set
drawn by the patches' job is followed a frame or two later, under the
scheduler's share; in those frames the rings leave out what the set
before covered, which a set one cell on still patches.

### 4.3 Cost

A fully steep 16 m cell at 0.5 m is 1,089 vertices and 2,048 triangles; at
1 m, 289 and 512; at 2 m, 81 and 128. At the reference pose on the high
tier the reach holds 1,963 cells, 29 near, 287 far and 1,647 wide, of which
20 near, 121 far and 221 wide have steep ground: 74,650 vertices and
131,200 triangles. The shell's walk, from the camera's cell's centre,
holds 1,961 cells and draws 362. Built at once, on the frame the camera
crossed a cell line, the patches took about 580 ms at the first update
(620 ms cold), which builds 1,961 cells, and about 120 ms at the crossing
one cell east, which builds 142 (51 that entered the reach and 91 whose
band, stitch or open neighbours changed), leaving 368 drawn. At the 160 m
reach the same two took about 350 ms and 115 ms.

As jobs, measured on the development machine under Node, on the null
engine, with the frames run back to back (`facePatchMeshes.test.ts`'s
`wall-clock` test, three runs):

| | as jobs | built at once |
| --- | --- | --- |
| the first update, on its frame | 99 to 101 ms, the near band's 29 cells | about 580 ms |
| the far and wide bands after it | 605 to 636 ms of work over 159 to 166 frames, 3.2 ms a frame on average, 4.5 to 5.2 at most: about 2.7 s at 60 frames a second | in the first update |
| a walk to the cell's east line, 172 frames, and 30 on | 1.1 ms a frame on average, 4.3 at most, the cells of the crossing built ahead | nothing until the line |
| the crossing's frame at a walk | 2.6 to 3.2 ms | about 120 ms |
| a crossing nothing was built ahead for | 34 to 36 frames, 3.2 to 3.4 ms a frame on average, 4.1 to 6.3 at most | about 120 ms in one frame |

The near band's 100 ms on the first frame is the one stall left. The draw
calls are the next lever, the cells of one band merged into one mesh at
each change.

The clipmap leaves out, at the same pose, 11,582 of ring 0's 32,768
triangles, 4,559, 1,933 and 199 of the 24,576 of rings 1, 2 and 3, and
none of ring 4's, which begins about 500 m out: 18,273 in all, under 217
of the 362 patched squares.

### 4.4 The ground under the patches (`client/src/game/clipmap.ts`)

The clipmap draws an upper envelope of the ground, each vertex lifted by
the most the field rises above its drawn edges, and past ring 0 that
envelope can stand above the patch's joints where the push is near zero,
filling them. So each ring leaves out of its index buffer the triangles a
patch draws over (`CoveredGround`, given by `facePatchCover`):

- a triangle whose three vertices are fully steep, a gradient of
  `FACE_SLOPE_HI` or more as the ring stores it, where the patches' mask
  is whole;
- in a 16 m square whose centre lies within the wide reach, less a cell's
  diagonal (about 377 m on the high tier), of the centre of the cell the
  set drawn was walked from (section 4.2). Every neighbour of such a
  square, corners too, is in the patched set, so its patch has no open
  side, no taper and the whole relief over it; and the set drawn for a
  camera one cell on still patches the square, in the frames until the
  rings are drawn again for that set;
- on a ring whose cells each lie within one square, a spacing that divides
  16 m: rings 0 to 4;
- on a ring finer than 2 m, ring 0, in a square whose centre lies within
  `fine` as well, the far reach (`CoveredGround.fine`, 160, 120 and 80 m by
  tier), where the patches are 1 m apart or finer.

A ring's border row, where it meets the coarser ring, and the row around
its hole, where it meets the finer one, are always kept, so the seams stay
closed. The vertices stay: only the indices change, so the buffers'
layout, the blend toward the coarser ring and the positions are as they
were, and with nothing covered the index buffers are the same bytes as
before. Every triangle left out has three steep vertices, which are grid
points of its square's patch, so the square has a patch; where a patch's
edge is tapered, at the reach's edge, the ground is not left out. The
`fine` bound is what holds this on low: ring 0's 1 m vertices lie in
squares up to 90.5 m from the camera's cell's centre (64 m in each axis),
past low's 80 m far reach and into its 2 m band, where three fully steep
vertices a metre off the patch's points can lie in a square with no steep
point of its own, and so no patch. On high and medium every square of ring
0 lies within the far reach, and the bound leaves out what was left out
before; on low, at the reference pose, it keeps 361 triangles that were
left out under 2 m patches, 16,181 of 16,542 left out still.
A ring is drawn again when the cover changes, in a rebuild the clipmap
begins for it whether the camera moves or not (section 4.2). The
first build, at the origin before the camera's first frame, leaves nothing
out: no patch stands yet, and the camera is elsewhere. The first update
builds at once and draws again every ring that can leave ground out, under
the near band's cover, which the patches' first update, before it, drew.

The clipmap's rings are the shadow casters; the patches cast too, so a
triangle left out casts its shadow through the patch over it.

### 4.5 The look: the rock texture and the shadows

The relief's cells give a face its rocks, and the rock texture painted over
them must not break them back into cobbles. Its source covers 1.8 m, about
ten stones a side, so at its own size a face showed stones of 0.15 to
0.25 m in their hundreds across every slab. The rock layer
(`TILING_METRES.rock` in `client/src/game/terrainTexture.ts`) repeats every
5.4 m instead, three times its footprint, so a stone is 0.45 to 0.75 m
across. The repeat is the layer's, not the patches': the steep ground, the
scree and every other fragment that carries rock weight take it. The rock's
parallax keeps its depth of 3 cm in metres, scaled to the repeat in the
shader, so the stones are as deep as before, now a fifteenth of their
width or less. Only a uniform changes; the shader text does not. At a
face's foot, the nearest any rock is seen, the texture's 512² texels over
5.4 m are about 95 to the metre.

The ground shader divides each layer's texture by its own mean colour, so a
face shows the vertex colour the paint gives it, the texture adding
variation and no hue of its own. The rock and the scree were a light
grey-tan, (0.17, 0.16, 0.15) and (0.24, 0.23, 0.21), and a face read light
and warm; `ROCK` and `SCREE` (`client/src/game/terrainSurface.ts`) are now
neutral at half that luminance, 0.081 and 0.115 on every channel, and the
faces read a dark grey.

The shadows of the joints and slabs added to the noise: under a clear sky
the shadow generator's darkness was 0, so a face in shadow had only the
sky's light. The darkness is now never under `SHADOW_FLOOR = 0.17`
(`client/src/game/lighting.ts`). By the sky state's light, the image-based
light taken as the dome's irradiance over π and the sun as the PBR diffuse,
a face leaning 55° toward the sun keeps, shadowed, 45 %, 47 % and 43 % of
its lit value at 08:00, noon and 15:00, where it kept 34 %, 36 % and 32 %;
level ground keeps 46 %, 38 % and 41 %, where it kept 35 %, 25 % and 29 %.
There is one shadow generator for the scene and Babylon has no darkness per
receiver, so the floor holds for every receiver: the patches, the ground,
the trees and the props. Weather whose cloud already lightens the shadows
past it, bright weather's 0.45 and every cloudier one, keeps its own
darkness.

### 4.6 The reflections and the rain

The lakes' reflections draw the clipmap's rings 0 to 4 with a lit
stand-in, the mirror on high and the panorama on medium, and the rain's
cover map draws rings 0 and 1 as terrain. Since the rings leave out the
ground under fully steep squares, a steep face missing from either would
reflect as sky and let the rain through the rock. The patches therefore
enter both as they are built and leave both as they are dropped, beside
the shadow map's casters (`createFacePatches`'s `reflections` and `rain`
registries): in the reflections through the same stand-in the rings are
drawn with there, in the rain's map as terrain, so the streaks stop on the
rock and the splashes land on the faces.

## 5. Tests

- `client/test/sim/faceRelief.test.ts`: `cellularD` returns `o1` inside a
  cell and the mean on a border; its derivatives match numeric ones;
  `faceReliefD` is within `[−1, 1]` on a 20,000-point sweep and
  deterministic; inside a cell of every lattice with weight it is the fine
  cells' planes over the large form's, built from `cellularSite`, and where
  the share is 0 or 1 the mix of `cellularD`'s forms; the forms' share over
  the world is pinned (a literal count of columns, blocks and band points
  on a lattice).
- `client/test/game/facePatches.test.ts`: every vertex with `m = 0` lies
  on the field's height; `d` is within the depth the ground's bend leaves,
  and that depth under half the bend's radius; every normal is unit, and
  over the taper's ramp near the grid's own; two
  neighbouring patches share their boundary positions and normals bit for
  bit, at a step of the reach's edge too; a fine patch's stitched
  midpoints lie on the coarse edge, east–west and north–south, with the
  coarse paint, 0.5 m on 1 m and 1 m on 2 m; the relief fades to the ground at an open edge and is whole
  3 m in; no triangle turns over at the scarp, nor across a sharp crest of
  world 42 where the full depth turned 12 over; a cell with no steep
  point has no patch; the cell set, the vertex and triangle counts and the
  near and far cell counts at the scarp are pinned as literals; a cell's
  patch is the same whatever the camera's path to it.
- `client/test/game/clipmap.test.ts`: with no cover the index buffers are
  every triangle, byte for byte; the triangles left out per ring at the
  reference pose are pinned; none on a border row or beside a hole; on
  every tier each is fully steep, its vertices grid points of its square's
  patch, over a square with a patch and no open neighbour; ring 0's
  squares lie within medium's far reach and past low's wherever the camera
  stands in its cell.
- `client/test/game/renderer.test.ts`: the clipmap's first build leaves
  nothing out, and its first update leaves out what its cover names; on
  one scheduler with the patches, the rings' rebuild at a crossing reads
  the cover of the set drawn while the crossing's patches build, and rings
  0 to 4 are drawn again for the whole first set and for the crossing's
  set two frames after each is drawn, the camera standing; the patches
  have the scheduler and are updated before the clipmap in both branches.
- `client/test/game/syncJobs.test.ts`: a patient job is never late, runs
  behind the others and keeps its place when begun again, and one begun
  again as ordinary moves ahead and can be late; idle work runs beside
  patient jobs only; an idle slice said to be long waits for a frame where
  it fits or is first, and the idle work behind it goes on.
- `client/test/game/facePatchMeshes.test.ts`: the attribute names match
  the terrain plugin's; the material carries the plugins and the depth
  offset, the atmosphere's plugin and a view of the ground's arrays that
  follows their swap; a cell is rebuilt when its band, stitch or open
  neighbours change and not otherwise, and an empty cell not at all; the
  shadow map, the reflections and the rain's map see every patch built and
  every one dropped. On a stepped clock: the first update builds the near
  band, 29 cells, and the rest is drawn whole 63 frames on, never late; at
  a walk the crossing's cells are built ahead and drawn in its own frame,
  nothing built in it, the registries swapped there and the old patches
  drawn until then; a crossing nothing was built ahead for, begun again at
  a second, keeps what it built and draws what a set built at once draws;
  a jump and the boost build at once; a turn and a turn back near a corner
  build nothing twice; nothing is built or left after `dispose`. A
  `wall-clock` test keeps the first update under 200 ms and a frame on the
  patches under 20 ms.
- `client/test/game/cliffMeshes.test.ts`: at the shipped density no model
  is fetched.
- `architecture.test.ts` holds: no trig, no `**`, no new `Math.hypot` in
  `sim/`; `facePatches.ts` is Babylon-free.
- The level id, the 200-world sweeps and the water baseline are untouched.

## 6. Checks

Stills on the high tier at 1920 × 1080, clear, at 16:00 and at noon, at
the scarp from the road (the reference link: `(−370, 25, −900)`, yaw 1.571,
pitch −0.3), at 10 m from the face, along the face, from the crest down,
and at the cove's stacks, each beside `main` at the same pose. The reading
is whether the face is rock or a dune, whether columns and blocks read as
such, whether the joints are crisp within 48 m, and whether the foot of the
face and the edges of the patches meet the ground without a line. Frame
pairs against `main` at the same poses are recorded beside them.

## 7. Follow-ups

- The near band's 100 ms on the first frame: built over the loading
  screen's last frames, where the camera's first position is known.
- Merging a band's patches into one mesh (draw calls).
- Collision on the relief, if standing inside the drawn rock at a face's
  foot shows.
- The cliff modules, if they return: as hero pieces on a face, not cover,
  at a density and a seat of their own.
- A lip at a column's top for a real overhang.

## 8. As built

The steep faces carry patches: over every 16 m cell with a steep grid point, a finer grid of
the same ground at 0.5 m within 48 m of the camera, 1 m within 160 m and 2 m within 400 m on
the high tier (36 / 120 / 300 m on medium, 24 / 80 / 200 m on low), each vertex pushed out
along the face's normal by up to 4 m of the relief, capped where the ground bends tighter than
the push, and drawn with the terrain's own material so the paint, the wet layer, the rain, the
reflections and the shadows are the ground's. The height field, the collision and the placements
are the ones the game had; the level id moved once, when the cliff modules' density went to
zero.

**The relief** (`client/src/sim/faceRelief.ts`) is a weighted blend over the nine sites around a
point, each site a tilted plane (`FACE_VALUE_SPAN` 0.6, `FACE_TILT` 0.35), at three scales:
columns of 5 m cells with 0.5 m joints or blocks of 6 m with 1.4 m joints over a 3 m octave,
chosen by a 150 m noise, under forms of 20 m with 3.5 m borders at one and a half times the
fine weight; a gain of 2.5 before the clamp to [-1, 1] fills the range (mean |v| 0.46, 7.3 %
clamped). The search widens to twenty-five sites when a nearer site could lie outside the nine,
exact while `border < (2 - sqrt 2) * cell` for every lattice. The slope mask runs from a gradient
of 1.0 to 1.4; the standing limit is 1.02.

**The patches** (`client/src/game/facePatches.ts`, pure; `facePatchMeshes.ts`, the shell) take
their normals from the relief's own derivatives, stitch a finer edge to a coarser neighbour's
(0.5 to 1 m and 1 to 2 m), fade over 3 m toward any side or corner whose neighbour is outside the
reach, and are built as one patient job per 16 m crossing on the renderer's job system: the near
band at once at the first update (about 100 ms at the scarp), the rest at about 3 ms a frame
over about 2.7 s, the next crossing's cells built ahead on idle frames along the heading, so a
crossing at a walk costs about 3 ms. The clipmap leaves out the ground under fully steep squares
of the set the patches last drew (rings 0 to 4; 18,273 of 98,304 triangles under 217 squares at
the road under the scarp) and redraws for each new set on the frame after it lands.

**The look.** The rock texture repeats every 5.4 m on the rock layer; `ROCK` is (0.081, 0.081,
0.081) and `SCREE` (0.115, 0.115, 0.115), a neutral grey at half the old luminance; in clear
weather the sun's shadow keeps 0.17 of its light (`SHADOW_FLOOR`), every receiver alike; no cliff
module stands on a face (`CLIFF_DENSITY` 0; the field and its tests keep a density of 0.1 of
their own). No shader text changed, so the shader corpus and its maps are the ones before.

**At the road under the scarp, high tier** (seed `atmo`, camera (-370, 25, -900)): 1,963 cells
walked, 362 patches (20 at 0.5 m, 121 at 1 m, 221 at 2 m), 74,650 vertices, 131,200 triangles,
no triangle folded (least facet agreement 0.185); on world 42's ridge cell (25, 34) none either.

**Checks.** With the current main merged in, typecheck and lint pass, and the suite passes: 5,241 tests in 357 files, the twenty files that time out under the suite's own load green one at a time. The production build carries the three WGSL maps as it should. Verify pages on WebGPU, one fresh page a tier at noon and at 16:00: every stage the pages ask for is in the maps (166 to 234 a page), no misses, no differences, no console errors. Frame pairs at 3840 x 2160 on the high tier on WebGPU against the main of the day, two rounds of A B B A each, the branch less main: the stand on the face -9.3 and -10.3 ms (48.9 to 39.6 ms), the pose on the scarp -6.5 and -6.1 ms (30.7 to 24.2 ms), the road with the whole face in view +2.2 and +2.9 ms (52.4 to 54.6 ms), beside a same-build pair at -3.9 ms, so the road's change is within the noise and the other two are the cliff models' cost gone.

**Not done, listed for later.** A player at the foot of a face can stand up to a few metres
inside the drawn rock, since collision stays on the height field; the far and wide bands can
still be filling when the intro's cover lifts; the rock texture at 5.4 m is about 95 texels a
metre at a face's foot; the shadow lift is global to clear weather.

## 9. As built (2026-10-14): the sun's shadow edges soften on the high tier

The sun's cast shadows had one edge everywhere: the cascaded shadow generator's
percentage-closer filter at Babylon's default quality, a 5 × 5 texel kernel, blurs a trunk's
contact and a canopy's shadow alike, 16 cm across in the first cascade. On the high tier the
generator now takes Babylon's percentage-closer soft shadow (`shadowSoftEdges` in
`client/src/game/quality.ts`, true on high alone; `shadowFilterFor` and `SUN_LIGHT_SIZE_UV` in
`client/src/game/lighting.ts`): for each shadowed fragment it searches the shadow map's depth
round the sample, sixteen taps, for the casters above the receiver, and sizes a filter of
thirty-two taps by their average height above it, so a shadow is a texel wide at the contact and
widens with the caster's height. Medium and low keep the plain filter; low has no shadows.

**The sun's size.** The sun subtends about 0.53°, so a caster `d` metres above the ground
throws a penumbra 0.0093 d metres wide: 28 mm under a branch 3 m up, 19 cm under a canopy
20 m up. Babylon takes the light's size as a ratio of the first cascade's width, and sizes the
filter by the receiver's depth less the blockers' over the first cascade's depth range in the
light's view, so the penumbra's radius is `Δz × ratio × X / Z`, `X` the cascade's width and
`Z` that range, and the sun's ratio is `0.00463 Z / X`. Two cascades at lambda 0.9 over 300 m
split at 18.5 m of camera depth; the stabilised first cascade is the sphere round that slice
of the 1.4 rad frustum, 66 m across in a 16:9 window (41 m in a window twice as tall as wide),
32 mm a texel at 2048². The depth range is not the slice's: the soft shadow turns depth
clamping off to keep true distances, so the light's near plane moves back to hold every
caster, and the clipmap's outer rings reach 4 km from the camera: the range is their reach
up-sun, about 1.4 km at noon (the sun 76° up), 4.5 km at 08:00 and 16:00 (29°). The ratio is
0.1 (`SUN_LIGHT_SIZE_UV`), the sun's at noon in a 16:9 window: a penumbra 28 mm wide at 3 m,
over a floor of one texel at the contact; the same value is a third of the sun's at 08:00 and
1.6 times it in the tall window. The penumbra's darkness stays at Babylon's default; the
normal bias of 0.3 stays.

**The map.** The soft shadow's search reads the map's own depth back as a texture, over the
whole range, so the high tier's map is full float where the engine renders it (half float,
Babylon's first choice, resolves about 1 part in 2,000 of the range, a metre and more, and a
caster nearer the ground than that could read as none): 2048² × 2 cascades × 4 bytes, twice
the half-float map's bytes. The hard-edged tiers compare against the depth-stencil texture and
keep the half.

**Shaders.** No shader text of the game's changes. Babylon's defines on every material that
receives the sun's shadow on the high tier change: `SHADOWPCF<n>` gives way to `SHADOWPCSS<n>`
with `SHADOWMEDIUMQUALITY<n>`, which selects `computeShadowWithCSMPCSS32`, and the fragment
takes the `depthTexture<n>` sampler and the `lightSizeUVCorrection<n>`, `depthCorrection<n>`
and `penumbraDarkness<n>` uniforms; the shadow map's own stages take `SM_DEPTHCLAMP 0` where
they took 1. The corpus and the maps are recorded again for them.

**To look at in the browser, and to measure.** The frame's cost on the high tier at the
canopy pose and on the face, against the build before, with the map's extra bytes in it. The
shadows at the contact: a trunk's foot, a rock on the ground, a fern's lower fronds. The search
runs over the light's ratio of the map, 6.6 m round the sample at noon, with sixteen fixed taps,
the nearest 0.55 m out, and a receiver whose taps find no blocker is lit, so a caster narrower
than the taps' spacing can lose its shadow; whether the trunks', rocks' and fronds' shadows
hold is the first thing to see. Then the softness under a canopy against the contact, at noon
and at 16:00; the montane field's ripple under the soft shadow at the normal bias kept; and
the edge where the two cascades blend.
