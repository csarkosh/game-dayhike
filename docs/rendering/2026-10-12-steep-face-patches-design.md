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
covers; the ground under it is covered, not changed. The patches are the
game's, not the simulation's: the collision surface, the placements and the
level id do not move.

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
| The forms | Two, chosen by a slow noise over the world: columns (a jittered cellular field, the cells read as tall prisms on a steep face) and blocks (a near-square lattice with rounded joints, two octaves), both standing on large forms, a coarse octave of tilted slabs 14 m across |
| The size of the relief | Outward only, up to `PATCH_DEPTH = 4.0` m along the face's normal, the relief's half-depth (`FACE_HALF_DEPTH = 2.0`) doubled: the smooth face is the deepest joint, and no patch vertex is ever under the ground. Where the ground bends sharply the depth is cut, so the push stays under half the bend's radius |
| The patch grid | 16 m cells on the world's lattice; 0.5 m vertices within 48 m of the camera, 1 m within 160 m, none beyond (high tier; 36/120 m on medium, 24/80 m on low) |
| Normals | The displaced surface's, from the ground's and the relief's derivatives at each vertex, not from the grid: a column's flat face shades flat and its joint steep at either spacing, and a point has one normal in every patch that holds it |
| The ground under a patch | Stays drawn; the patch's material carries a depth offset so the two never fight where the relief is zero. Beyond ring 0 the clipmap draws a lifted envelope that can stand above the joints where the push is near zero, so joints are judged within 64 m until the ground under covered cells is dropped. Dropping the clipmap's triangles under a fully covered cell is a later lever |
| Collision | On the heightfield, as today: a player at the foot of a face can stand up to 4 m inside the drawn rock |
| The level id | Does not move |
| The shipped cliff modules | Unchanged on this branch |

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
- Nothing in `client/src/sim/` changes but one new pure module, and the
  level id stays where it is.

Non-goals:

- Overhangs. The patch is pushed out along the normal, not folded.
- Collision on the relief.
- The terrace stage (`cliffs.ts`) and its ledges, which stay as they are.
- The paint (`terrainSurface.ts`, the rock texture and its palette).

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
them, and a joint is a few tenths of a metre wide, so a face of level cells
reads soft. Each cell is therefore a plane, tilted its own way by up to
`FACE_TILT` of the unit range per cell crossed in each axis, and
neighbouring cells meet the light at different angles across their whole
width. A point with weight lies within `F1 + border ≤ 1.42 · cell + border`
of the sample, so its tilt term is at most
`FACE_TILT · 2 · (1.42 + border / cell)`, about 1.07 for the columns,
1.17 for the blocks and 1.12 for the large forms; with
`o · FACE_VALUE_SPAN` beside it a plane can pass ±1 far up its tilt. The
field is clamped to `[−1, 1]`, its derivative zero where the clamp holds,
so the range is kept for every sample. Over 20,000 points the largest tilt
term with weight is about 0.44 and no blend reaches the clamp.

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
every point with weight for any `border` under `(2 − √2) · cell`; at the
forms' numbers below that is rare, and the field is the whole blend for
every sample.

### 3.2 The forms

Columns: `cellularD(x, z, 2.8, 0.8, 0.3, COLUMN_SALT)`. On a face with
gradient `g`, a cell `c` metres across on the map runs `c · g` metres up the
face, so the cells of a steep face stand as prisms two to three times taller
than they are wide, and on a gentler one as blocks.

Blocks: `cellularD(x, z, 3.6, 0.25, 0.9, BLOCK_SALT)` plus half of
`cellularD(x, z, 1.8, 0.25, 0.45, BLOCK_SALT_2)`, the sum scaled by 2/3 to
stay within `[−1, 1]`. The low jitter keeps the joints near two directions,
and the wide border rounds the blocks' edges.

Both forms, and both octaves of the blocks, take their planes from the same
two constants, each octave with its own cell size beneath the tilt:
`FACE_VALUE_SPAN = 0.6`, the share of the unit range a cell's value spans
at its site, and `FACE_TILT = 0.35`, the share a tilt of 1 rises across one
cell. The span leaves room for the tilt within `[−1, 1]`.

The large forms: `cellularD(x, z, 14, 0.6, 2.5, FORM_SALT)`
(`FACE_FORM_CELL`, `FACE_FORM_JITTER`, `FACE_FORM_BORDER`). From the road,
80 m off, a face a hundred metres tall whose only relief is joints three
metres apart reads as a faint ribbing; real rock carries buttresses and
gullies ten to twenty metres across under its joints. This octave gives a
face those: its cells take their planes from the same `FACE_VALUE_SPAN` and
`FACE_TILT`, the tilt counted per cell crossed, so each 14 m cell is a slab
leaning its own way, and the 2.5 m border rounds neighbouring slabs into
one another. It does not depend on the noise that chooses the form, so
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
forms `v_form` lie beneath it at `FACE_FORM_WEIGHT = 1.5` to its 1:

```
v = clamp((v_fine + FACE_FORM_WEIGHT · v_form) / (1 + FACE_FORM_WEIGHT), −1, 1)
```

Both terms are within `[−1, 1]`, so their weighted mean is; the clamp,
taken last with a zero derivative where it holds, keeps the range against
rounding. At a half-depth of 2 m that is about ±0.8 m of fine joints on
±1.2 m of large forms. The derivatives run through the forms and both
mixes. Every constant above is exported in `FACE_RELIEF_TUNABLES`, with
`FACE_SLOPE_LO = 1.0`, `FACE_SLOPE_HI = 1.4` and `FACE_HALF_DEPTH = 2.0`
beside them.

## 4. The patches

### 4.1 The grid (`client/src/game/facePatches.ts`, pure)

The world is divided into `PATCH_CELL = 16` m cells. For a cell and a
spacing `p` (0.5 or 1 m) the patch is the `(16 / p + 1)²` lattice of the
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
facets is a cosine of about 0.30, on the steepest columns at 0.5 m; over
250 steep cells at 0.5 m on each of worlds 1, 42 and 123456 it is 0.27,
0.14 and 0.11, with none turned over. Without the cut, at the full 4 m,
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
reach a patch never ends with its relief in the air. At the far reach's
edge the neighbour is not drawn: there `taper` fades the relief to nothing
over `PATCH_TAPER = 3` m, a quintic step of the distance from the point to
the nearest square of a neighbour outside the set, 0 on its edge and 1
from 3 m in, whose derivative is the step's slope along the way out of
that square. A cell's eight neighbours, sides and corners, are flagged
open or not, so where the edge steps in, the cell open at a corner fades
toward the same square as its neighbour open at a side, and the two still
meet bit for bit.

Where a 0.5 m patch meets a 1 m one, the fine patch's midpoints on the
shared edge are set to the mean of the two coarse endpoints, position and
paint (colour, weights and cover), as the coarse patch interpolates its
edge, so the edge has one shape and one paint on both sides; the normal is
the mean made unit again. The shared points are the coarse patch's own,
normal included, with no special case.

### 4.2 The bands and rebuilds (`client/src/game/facePatchMeshes.ts`, shell)

Each frame the camera's cell is read; when it changes, the set of cells
within the far reach is walked from the centre of the camera's cell, so
the set is a function of that cell alone, each cell's spacing chosen by
the distance from that centre to the cell's centre (0.5 m within
`PATCH_NEAR`, 1 m within `PATCH_FAR`), and every cell that entered or
left the set, or whose spacing, stitched edges or open neighbours changed,
is rebuilt or dropped. A cell's
patch is one mesh; the pure module gives it as a `VertexData`-shaped
record (positions, normals, colours, the three attributes, Uint16
indices), and the shell uploads it. A cell without steep ground is
remembered as empty while it stays in the set at its spacing: its stitch
does not make it steep.

| tier | `PATCH_NEAR` | `PATCH_FAR` |
| --- | --- | --- |
| high | 48 m | 160 m |
| medium | 36 m | 120 m |
| low | 24 m | 80 m |

The patches use a terrain material of their own, made by the same factory
as the ground's (`terrainMaterialFor(scene, "facePatch")`: the same PBR
material, the terrain texture, the wet layer and the atmosphere attached),
with `zOffset = −1` so the patch wins over the ground where the two
coincide. The patches cast and receive shadows with the clipmap.

### 4.3 Cost

A fully steep 16 m cell at 0.5 m is 1,089 vertices and 2,048 triangles; at
1 m, 289 and 512. At the reference pose on the high tier the reach holds
316 cells, 29 near and 287 far, of which 20 near and 121 far have steep
ground: 56,749 vertices and 102,912 triangles, and 140 draws from the
shell's walk. The patches are built at once, on the frame the camera
crosses a cell line: about 350 ms at the first update, which builds 317
cells, and about 115 ms at the crossing one cell east, which builds 66 (21
that entered the reach and 45 whose band, stitch or open neighbours
changed). The ground's bend costs a quarter of that: the same crossing
builds in about 90 ms at the full depth, without the differences. Spreading
the builds over frames is the first follow-up; the draw calls are the next
lever, the cells of one band merged into one mesh at each change.

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
  coarse paint; the relief fades to the ground at an open edge and is whole
  3 m in; no triangle turns over at the scarp, nor across a sharp crest of
  world 42 where the full depth turned 12 over; a cell with no steep
  point has no patch; the cell set, the vertex and triangle counts and the
  near and far cell counts at the scarp are pinned as literals; a cell's
  patch is the same whatever the camera's path to it.
- `client/test/game/facePatchMeshes.test.ts`: the attribute names match
  the terrain plugin's; the material carries the plugins and the depth
  offset, the atmosphere's plugin and a view of the ground's arrays that
  follows their swap; a cell is rebuilt when its band, stitch or open
  neighbours change and not otherwise, and an empty cell not at all.
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

- Building the patches over several frames, not on the one the camera
  crosses a cell line.
- Dropping the clipmap's triangles under fully covered cells (overdraw).
- Merging a band's patches into one mesh (draw calls).
- Collision on the relief, if standing inside the drawn rock at a face's
  foot shows.
- The cliff modules: with the face its own rock, the modules are hero
  pieces, not cover; their density and their seat are a separate change.
- A lip at a column's top for a real overhang.
