# Steep ground relief: rock shape in the heightfield itself

The steep faces of the world — the coast's scarp, the sea stacks, the cove's
walls, the terrace risers — are smooth surfaces with a rock texture painted
on them. At any distance under a hundred metres they read as a dune: the
texture has grain at the metre scale, and the shape under it has none. Rock
models stood on the faces (`docs/rendering/2026-09-24-cliff-modules-design.md`)
cover the shape without becoming it; the seam between model and ground
stays, and the ground between the models stays a dune.

This design gives the steep ground its own shape. One more stage in the
terrain chain adds a rock relief — columns on some faces, jointed blocks on
others — to the height wherever the ground is too steep to stand on. The
relief is part of the heightfield, so the drawn surface, the collision
surface, the normals and every placement read the same rock. Nothing is
stood on the face; the face is the rock.

The world's ground is one height function, built for the whole world from
one family of noise. That family makes hills and valleys well and cliffs
badly, because a cliff is not a hill turned up: it has joints, columns and
blocks, with their own scales and their own regularity. This design adds a
second function with those forms, masked to the steep ground, instead of
asking the first to do both.

## 1. Decisions

| question | decision |
| --- | --- |
| Where the relief lives | In the simulation's height function (`client/src/sim/`), as a stage of the olympic chain, with exact derivatives like every stage before it |
| What it is masked by | The ground's own gradient: nothing under 1.0, the whole relief from 1.4 up (`FACE_SLOPE_LO`, `FACE_SLOPE_HI`); the standing limit is 1.02 |
| The forms | Two, chosen by a slow noise over the world: columns (a jittered cellular field, the cells read as tall prisms on a steep face) and blocks (a near-square lattice with rounded joints, two octaves) |
| The size of the relief | A half-depth of 1.0 m measured along the face's normal: the surface moves in and out of the smooth face by up to 1.0 m |
| The mesh | Unchanged: the clipmap samples the field as before. Ring 0's 1 m spacing is the finest the relief is drawn at; the cell sizes (2.8 m and 3.6 m) are chosen to survive it |
| Collision | Follows: the player stands, slides and is raycast on the same surface that is drawn |
| The level id | Moves once (the new stage's constants join the variant's tunables) |
| The shipped cliff modules | Unchanged on this branch; they stand on the relief as they stood on the smooth face |

## 2. Goals and non-goals

Goals:

- Steep ground reads as rock at every distance under about 150 m: facets
  that catch the light differently from their neighbours, an uneven
  silhouette on a crest, no grain-on-a-dune.
- Columns on some faces, blocks on others, and the two never meet on one
  face.
- Bit identity everywhere the ground is not steep: a point whose gradient is
  under `FACE_SLOPE_LO` gets the same sample object it got before.
- The walk, the raycast and the normals agree with the drawn surface, as
  they do today.

Non-goals:

- Overhangs. A heightfield has one height per point, and so does this
  design.
- A finer mesh. The relief is drawn at the clipmap's own spacing; a second,
  finer surface on the faces is a different design.
- The terrace stage (`cliffs.ts`) and its ledges, which stay as they are.
- The paint (`terrainSurface.ts`, the rock texture and its palette).

## 3. The relief function (`client/src/sim/faceRelief.ts`)

Pure, trig-free, seeded, with exact derivatives. Everything below is a
function of the world position alone, so it is the same whoever samples it.

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
`FACE_TILT · 2 · (1.42 + border / cell)`, about 1.07 for the columns and
1.17 for the blocks; with `o · FACE_VALUE_SPAN` beside it a plane can pass
±1 far up its tilt. The field is clamped to `[−1, 1]`, its derivative zero
where the clamp holds, so the range is kept for every sample. Over 20,000
points the largest tilt term with weight is about 0.44 and no blend reaches
the clamp.

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

### 3.2 The two forms

Columns: `cellularD(x, z, 2.8, 0.8, 0.3, COLUMN_SALT)`. On a face with
gradient `g`, a cell `c` metres across in plan runs `c · g` metres up the
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

### 3.3 Which form where

`k = gradientNoise2(x / FACE_KIND_WAVE, z / FACE_KIND_WAVE, KIND_SALT).v`
with `FACE_KIND_WAVE = 150` m, and `s = smootherstep(−0.15, 0.15, k)`: the
relief is columns where `s = 0`, blocks where `s = 1`, a blend in a band
between. Only the forms with weight are evaluated. The blend band is where
both forms are weak, never a face with both.

### 3.4 The function

`faceReliefD(seed, x, z): { v, dx, dz }` with `v ∈ [−1, 1]`, unitless, the
mix of the two forms by `s`, derivatives through both the forms and the
mix. Every constant above is exported in `FACE_RELIEF_TUNABLES`.

## 4. The stage (`faceStageD`, in `faceRelief.ts`, called from `olympic.ts`)

```
faceStageD(seed, x, z, s: TerrainSample, pre: (x, z) => TerrainSample): TerrainSample
```

1. `g² = s.dx² + s.dz²`. If `g² ≤ FACE_SLOPE_LO²`, return `s` itself: the
   bit identity for the whole non-steep world, at the cost of two
   multiplications.
2. `g = sqrt(g²)`, `m = smootherstepD(FACE_SLOPE_LO, FACE_SLOPE_HI, g)`.
3. `r = faceReliefD(seed, x, z)`.
4. A move of `d` metres along the face's normal is a vertical move of
   `d · sqrt(1 + g²)`, so the height becomes

   ```
   h′ = h + m · FACE_HALF_DEPTH · r.v · sqrt(1 + g²)
   ```

   On the scarp (`g` ≈ 2 to 3) the vertical change is up to about 3 m;
   measured along the face, it is the 1.0 m the player sees.
5. The derivative. `h′` depends on `g`, and `g`'s derivative is the base's
   second derivative, which the chain does not carry. The stage takes it by
   forward differences of the chain before it: `pre(x + e, z)` and
   `pre(x, z + e)` with `e = FACE_DIFF_STEP = 0.25` m give
   `h_xx ≈ (pre(x+e).dx − s.dx) / e`, `h_xz ≈ (pre(x, z+e).dx − s.dx) / e`
   and `h_zz` likewise, and `∂g/∂x = (dx · h_xx + dz · h_xz) / g`. With
   `A = FACE_HALF_DEPTH · sqrt(1 + g²)` and `∂A/∂g = FACE_HALF_DEPTH · g / sqrt(1 + g²)`:

   ```
   ∂h′/∂x = s.dx + m · A · r.dx + (m′ · ∂g/∂x · A + m · ∂A/∂g · ∂g/∂x) · r.v
   ```

   The two extra samples are taken only where `g > FACE_SLOPE_LO`: about
   2.3 % of the world's area, and about 40 % of the scarp's. The cost
   lever, if the stage ever needs to be cheaper, is to drop the `sqrt(1 + g²)`
   factor and the mask's derivative and take a fixed vertical half-depth;
   that leaves the steepest faces with the least relief, so it is not the
   first choice.

The stage runs after `coveD` and before `padD`: the scarp, the stacks, the
headlands and the cove's stacks all get their relief, and the pad, the
features, the lakes, the trail and the road still carve through it. The
constants `FACE_SLOPE_LO`, `FACE_SLOPE_HI`, `FACE_HALF_DEPTH`,
`FACE_DIFF_STEP` and `FACE_RELIEF_TUNABLES` join the olympic variant's
tunables.

## 5. What the mesh makes of it

The clipmap samples the field at 1 m on ring 0 (within 64 m of the camera),
2 m on ring 1, 4 m beyond. A 2.8 m column is three vertices wide on ring 0
and one on ring 1: near faces show their joints; faces past 64 m show the
relief as unevenness, and past 128 m as a texture of lumps, which is what a
far cliff is. The clipmap's blend toward its coarser ring at each border
carries the one into the other without a step. A finer ring 0
(`BASE_SPACING = 0.5`, one more ring for the same reach) is the lever if
the joints need to be crisper near the camera; it is not taken here.

## 6. Tests

- `client/test/sim/faceRelief.test.ts`: `cellularD` returns the nearest
  point's plane inside a cell and the mean of two planes on a border; its derivatives match numeric ones to the
  olympic test's ratio; `faceReliefD` is within `[−1, 1]` on a 20,000-point
  sweep and deterministic; the forms' share over the world is pinned (a
  literal count of columns, blocks and band points on a lattice).
- `faceStageD`: returns the same object where `g ≤ FACE_SLOPE_LO`; its
  derivatives pass `checkDerivatives` on a sweep of steep points (the
  olympic test's own sweep gains the scarp); the height change on the scarp
  is within `FACE_HALF_DEPTH · sqrt(1 + g²)`.
- The level id's new value is pinned where the old one was
  (`groundGradient.test.ts`, `tierDeterminism.test.ts`); the 200-world
  sweeps are re-read and pinned with a dated line each (cliff field counts,
  collider counts, the water baseline fixture if any profile crosses steep
  ground); the montane snapshot is untouched (the montane family has no
  stage).
- `architecture.test.ts` holds: no trig, no `**`, no new `Math.hypot`.

## 7. Checks

Stills on the high tier at 1920 × 1080, clear, at 16:00 and at noon, at
the scarp from the road (the reference link: `(−370, 25, −900)`, yaw 1.571,
pitch −0.3), at 10 m from the face, along the face, from the crest down,
and at the cove's stacks, each beside `main` at the same pose. The reading
is whether the face is rock or a dune, whether columns and blocks read as
such, and whether the foot of the face meets the ground without a line.
Frame pairs against `main` at the same poses are recorded beside them.

## 8. Follow-ups

- The cliff modules: with the face its own rock, the modules are hero
  pieces, not cover; their density and their seat on the relief are a
  separate change.
- The terrace stage's ledges across a relieved riser.
- Overhangs and crisp joints need a finer surface than the clipmap's
  (the alternative not taken here: a separate patch mesh on the faces).
