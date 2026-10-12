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
| The forms | Two, chosen by a slow noise over the world: columns (a jittered cellular field, the cells read as tall prisms on a steep face) and blocks (a near-square lattice with rounded joints, two octaves) |
| The size of the relief | Outward only, up to `PATCH_DEPTH = 1.2` m along the face's normal: the smooth face is the deepest joint, and no patch vertex is ever under the ground |
| The patch grid | 16 m cells on the world's lattice; 0.5 m vertices within 48 m of the camera, 1 m within 160 m, none beyond (high tier; 36/120 m on medium, 24/80 m on low) |
| Normals | From the patch's own displaced grid, so the light reads the shape that is drawn |
| The ground under a patch | Stays drawn; the patch's material carries a depth offset so the two never fight where the relief is zero. Dropping the clipmap's triangles under a fully covered cell is a later lever |
| Collision | On the heightfield, as today: a player at the foot of a face can stand up to 1.2 m inside the drawn rock |
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
(from `hash3(i, j, 0, salt)` and `hash3(i, j, 1, salt)`), and one value
`o ∈ [−1, 1]` (from `hash3(i, j, 2, salt)`). For the sample's position, the
nine cells around it give nine points `c_k` at distances `F_k`, the nearest
at `F1`. Each point weighs by how much farther it is than the nearest, and
the field is the weighted mean of the values:

```
w_k = 1 − smootherstep(0, border, F_k − F1)
v   = Σ w_k · o_k / Σ w_k
```

`border` is the width, in metres, of the blend across a joint. The field is
`o1` inside a cell, where every other point is a joint's width farther, and
exactly the mean of two values on the border between two cells where no
third point is within a joint's width; it is a convex mix, so within `[−1, 1]`, and continuous everywhere, since `F1` is.
With `W = Σ w_k`, the derivative is
`(Σ w_k′ · o_k) / W − v · (Σ w_k′) / W` with
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

### 3.2 The two forms

Columns: `cellularD(x, z, 2.8, 0.8, 0.3, COLUMN_SALT)`. On a face with
gradient `g`, a cell `c` metres across in plan runs `c · g` metres up the
face, so the cells of a steep face stand as prisms two to three times taller
than they are wide, and on a gentler one as blocks.

Blocks: `cellularD(x, z, 3.6, 0.25, 0.9, BLOCK_SALT)` plus half of
`cellularD(x, z, 1.8, 0.25, 0.45, BLOCK_SALT_2)`, the sum scaled by 2/3 to
stay within `[−1, 1]`. The low jitter keeps the joints near two directions,
and the wide border rounds the blocks' edges.

### 3.3 Which form where

`k = gradientNoise2(x / FACE_KIND_WAVE, z / FACE_KIND_WAVE, KIND_SALT).v`
with `FACE_KIND_WAVE = 150` m, and `s = smootherstep(−0.15, 0.15, k)`: the
relief is columns where `s = 0`, blocks where `s = 1`, a blend in a band
between. Only the forms with weight are evaluated. The blend band is where
both forms are weak, never a face with both.

### 3.4 The function

`faceReliefD(seed, x, z): { v, dx, dz }` with `v ∈ [−1, 1]`, unitless, the
mix of the two forms by `s`, derivatives through both the forms and the
mix. Every constant above is exported in `FACE_RELIEF_TUNABLES`, with
`FACE_SLOPE_LO = 1.0` and `FACE_SLOPE_HI = 1.4` beside them.

## 4. The patches

### 4.1 The grid (`client/src/game/facePatches.ts`, pure)

The world is divided into `PATCH_CELL = 16` m cells. For a cell and a
spacing `p` (0.5 or 1 m) the patch is the `(16 / p + 1)²` lattice of the
cell's own grid points, boundary included, plus one ring of apron points
outside it that are sampled for the normals and not drawn. At each point:

```
s = elevationSampleAt(seed, x, z)
g = sqrt(s.dx² + s.dz²)
m = smootherstep(FACE_SLOPE_LO, FACE_SLOPE_HI, g)
n = (−s.dx, 1, −s.dz) / sqrt(1 + g²)
d = m · PATCH_DEPTH · (faceReliefD(seed, x, z).v + 1) / 2
position = (x, s.h, z) + n · d
```

`d` is zero wherever the ground is not steep, so a patch's edge lies on
the ground exactly, and never under it. The vertex normal is the cross
product of the central differences of the displaced positions over the
grid (the apron gives the boundary its neighbours), normalised. The
vertex colour is `classifySurface(...).albedo` at the point, and the
attributes `terrainWeights`, `terrainWeights2` and `terrainCover` are the
clipmap's for the same point, so the patch is painted as the ground under
it would be.

A cell has a patch when any of its grid points, boundary included, has
`m > 0`. Two patched neighbours share their boundary points bit for bit,
so they meet without a crack. A cell whose steep ground reaches its
boundary pulls its neighbour in through the shared points, so a patch
never ends with its relief in the air.

Where a 0.5 m patch meets a 1 m one, the fine patch's midpoints on the
shared edge are set to the mean of the two coarse endpoints, so the edge
has one shape on both sides.

### 4.2 The bands and rebuilds (`client/src/game/facePatchMeshes.ts`, shell)

Each frame the camera's cell is read; when it changes, the set of cells
within the far reach is walked, each cell's spacing is chosen by the
distance from the camera to the cell's centre (0.5 m within
`PATCH_NEAR`, 1 m within `PATCH_FAR`), and every cell whose spacing
changed or that entered or left the set is rebuilt or dropped. A cell's
patch is one mesh; the pure module gives it as a `VertexData`-shaped
record (positions, normals, colours, the three attributes, Uint16
indices), and the shell uploads it. A cell without steep ground is
remembered as empty until the camera's cell changes again.

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
1 m, 289 and 512. The scarp's reach on the high tier holds about 36 near
cells, 40 % of them steep, and about 400 far cells, 10 to 40 % steep: on
the order of 30,000 vertices and 60 draw calls in the worst view, rebuilt a
cell at a time as the camera moves 16 m. The draw calls are the lever if
they show: the cells of one band merged into one mesh at each change.

## 5. Tests

- `client/test/sim/faceRelief.test.ts`: `cellularD` returns `o1` inside a
  cell and the mean on a border; its derivatives match numeric ones;
  `faceReliefD` is within `[−1, 1]` on a 20,000-point sweep and
  deterministic; the forms' share over the world is pinned (a literal
  count of columns, blocks and band points on a lattice).
- `client/test/game/facePatches.test.ts`: every vertex with `m = 0` lies
  on the field's height; `d ≤ PATCH_DEPTH`; every normal is unit; two
  neighbouring patches share their boundary positions bit for bit; a fine
  patch's stitched midpoints lie on the coarse edge; a cell with no steep
  point has no patch; the cell set, the vertex and triangle counts and the
  near and far cell counts at the scarp are pinned as literals; a cell's
  patch is the same whatever the camera's path to it.
- `client/test/game/facePatchMeshes.test.ts`: the attribute names match
  the terrain plugin's; the material carries the plugins and the depth
  offset; a cell is rebuilt when its band changes and not otherwise.
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

- Dropping the clipmap's triangles under fully covered cells (overdraw).
- Merging a band's patches into one mesh (draw calls).
- Collision on the relief, if standing inside the drawn rock at a face's
  foot shows.
- The cliff modules: with the face its own rock, the modules are hero
  pieces, not cover; their density and their seat are a separate change.
- A lip at a column's top for a real overhang.
