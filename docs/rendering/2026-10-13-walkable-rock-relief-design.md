# Walkable rock relief: the ground's rock paint given its shape

The steep faces carry a rock relief on patches drawn over the ground
(`docs/rendering/2026-10-12-steep-face-patches-design.md`). The rest of the
ground the surface paints as rock — the band where the forest's slope gate
turns soil to rock, a gradient of 0.55 to 0.75, the scree past 0.95, and
the bare crests — was still the smooth height field with the rock texture
on it: a dune with cobbles painted on. This design gives that ground a shape
of its own, by the same means as the faces: the same patches, a second
relief function in the same module, masked by the rock paint where the
faces' mask leaves off, and shallow enough to walk over with collision on
the smooth ground. The paint then enhances a shape instead of standing in
for one.

## 1. Decisions

| question | decision |
| --- | --- |
| Where the relief lives | In the game layer, on the face patches (`client/src/game/facePatches.ts`); the simulation's height function, collision and placements are untouched, and the level id does not move |
| What it is masked by | The rock weight the surface paints at the vertex (`classifySurface`, the slope's rule less the water's and the snow's say), times `1 − faceMask`, so a face carries the faces' relief alone and the two never add; times the cell's loudness; times the patches' taper toward cells outside the set |
| The depth | Outward only, along the ground's normal, up to `GROUND_DEPTH` = 0.4 m at full loudness, cut by the ground's bend as the faces' depth is but to the whole radius of curvature, not half (`GROUND_BEND_SHARE`): 0.4 m cannot gather a hollow past its centre as 4 m can, and the lowland outcrops are tight humps that half the radius halved. A foot stands at most 0.4 m inside the drawn rock and 0.2 m on average, with collision on the height field as before |
| The forms | Three octaves of the cellular field, each site a dome: slabs (3 m cells, 0.6 m joints, a dome of 3 and a tilt of 1), rubble (1.2 m, 0.3 m, a dome of 3, at 0.5) and outcrops (9 m, 2 m joints, a tilt of 2 and a dome of 0.5, at 0.8), gained 1.5 and clamped: a mean |v| of 0.57, 15 percent on the clamps (at a gain of 2, 35 percent, and the tops and hollows sat flat). A shallow relief reads by its curvature, not its depth: the faces' planes tilt a degree at 0.4 m and shade as the ground does |
| The loudness | By the rock's extent about the cell: the mean rock-of-slope at a cell's corner and at eight points 6 m out (`rockExtent`), 0 to 1, read at the cell's four corners, which its neighbours share, and interpolated across the cell; the loudness is 0.75 at an extent of 0.1 and under, 1 from 0.5, a quintic step between (`groundLoudness`). A lone outcrop in grass shows three quarters of the depth and the rest as it widens; a rocky hillside is whole. As first built the floor was 0.25, the stencil 10 m and the ramp 0.15 to 0.85, and the lowland outcrops by the trailhead, humps of the height field three metres wide painted rock by their own slope, moved under 3 cm, which read as nothing: the first place a player looks at rock. At 0.75 they move up to 9 cm, their creases capping the rest (§4) |
| Which cells | A cell is patched when a point of its grid is steep (as before) or has a rock-of-slope of 0.1 or more (`GROUND_ROCK_MIN`); under that the push is a few centimetres |
| The ground under a patch | Kept: the clipmap leaves out its triangles under fully steep squares as before and nowhere else; the push is outward, so the patch is never under the ground, and the patch material's depth offset keeps the two apart where the relief is nothing |
| The faces' forms | Unchanged: `cellular` takes a tilt and a dome, the faces' calls leave both at their defaults (FACE_TILT, 0), and a dome of 0 adds nothing, so every face value is the one before, bit for bit (the relief tests' pinned literals) |
| Cost | More patches: at the road under the scarp 753 cells of 1,963 in reach against 362, the 391 added for their rock. Build time, not frame time: the patches build over frames on the job system as before |

## 2. Goals and non-goals

Goals:

- Ground painted rock reads as rock at the distances a player walks it:
  rounded cobbles and slabs that catch the light differently from their
  neighbours, joints between them, broad bedding under them.
- Walking over it reads right: the drawn surface is within 0.4 m of the
  ground the player stands on, and only above it.
- Louder where the rock is wide, quieter where it is a patch in the grass.
- No crack between the faces' relief and the walkable rock's: the two masks
  sum to the rock weight at most and the taper is shared.

Non-goals:

- The rock and boulder models (`rockRelief.ts` cuts those at load).
- Collision on the relief.
- The rock paint itself: the texture, its repeat and the grey are the faces'.

## 3. The relief function (`client/src/sim/faceRelief.ts`, `groundReliefD`)

The cellular field of the faces (§3.1 of the faces' design) blends, over the
sites with weight about a point, each site's plane: its value at the site
and a tilt through it. The walkable rock adds a dome to the plane, a fall of
`dome · F² / cell²` from the site, so a cell is a cap rounded off toward
its joints, and takes a tilt of its own instead of FACE_TILT. Both are
parameters of `cellular` with the faces' values as defaults; the derivative
of the dome term is `−2 · dome · (p − s) / cell²`, added to the plane's own
slope inside the blend, so the field keeps exact derivatives and the normals
the patches take from them.

`groundReliefD` is the slabs plus the rubble at `GROUND_RUBBLE_WEIGHT` plus
the outcrops at `GROUND_MASS_WEIGHT`, divided by the weights' sum and
multiplied by `GROUND_GAIN`, clamped to [−1, 1] and flat where the clamp
holds. The clamp's floor is the hollow between cobbles. The three lattices
have salts of their own, so they share nothing with the faces' lattices and
a face and the rock at its foot show no common seam.

## 4. The patches (`client/src/game/facePatches.ts`)

`surfaceInto` pushes a vertex by `d / sqrt(1 + g²)` along the ground's
normal with, now, two terms in `d`: the faces' `m · τ · D · (v + 1) / 2` as
before and the walkable rock's `rock · (1 − mask) · loud · τ · D_g · (v_g +
1) / 2`, `D_g` GROUND_DEPTH cut by the bend by the faces' rule at the walkable rock's
share (`patchDepth(bend, GROUND_DEPTH, GROUND_BEND_SHARE)`). The normal takes both reliefs'
derivatives and the taper's, the slowly varying terms left out as before.

The rock weight is the surface's at the vertex, so the paint is classified
before the surface is placed, where it was classified after. The loudness is
bilinear across the cell from its four corners' `groundLoudness(rockExtent)`,
nine ground samples a corner; a corner is a lattice point, so the next cell
reads the same doubles there and the loudness meets without a step.

A cell is a candidate when any grid point is steep or has rock-of-slope ≥
GROUND_ROCK_MIN; the rock-of-slope is the surface's own smoothstep of the
gradient from GRASS_SLOPE to ROCK_SLOPE, the only way the rock paint comes.
Where no point is rocky, no extent is read.

## 5. Tests

- `client/test/sim/faceRelief.test.ts`: the walkable rock's relief is its
  three octaves' weighted mean gained and clamped (300 points against
  `cellularD` with the tilts and domes); exact derivatives over a 2,000-point
  sweep, the junctions of the three lattices left out; within [−1, 1] and
  finite over 20,000 points; deterministic, and another field than the
  faces' and than another world's; continuous along 100 lines of 100 m at 1
  cm; uses its range. The faces' pinned literals and sweeps are unchanged.
- `client/test/game/facePatches.test.ts`: the rocky hillside's cell is
  patched with no point of it steep, every vertex out along the normal by at
  most GROUND_DEPTH and none into the ground; the extent is 1 on the
  hillside and 0 on the road under the scarp and the loudness follows it;
  the flat south of the scarp has no patch; the scarp's counts; the
  boundary and stitching tests as before, now over cells with rock.
- `client/test/game/facePatchMeshes.test.ts`: the scarp's set of 753, the
  near band of 22, and the walk's frames.

## 6. As built

Built as designed, 2026-10-13, the numbers of §1 the code's. At the road
under the scarp on the high tier (the faces' reference pose): 753 of the
1,963 cells in reach patched, 22 at 0.5 m, 161 at 1 m and 577 at 2 m,
117,224 vertices and 201,344 triangles, no triangle folded (362 cells,
74,650 vertices and 131,200 triangles before); a crossing of the cell line
east builds 148 cells and drops 117 (58 and 52 before), and the idle work
builds the next line's 190 over 24 frames after it. The walk's wall-clock
bars (the first update under 200 ms, a frame's mean under 8 ms and its most
under 20) hold on the development machine.

Stills at the rocky hillside above the trail (seed `atmo`, (−168, 69, −1740),
rock-of-slope 1 over its window, high tier, 14:00): with planes alone at 0.35
m the slope read as the dune it was; with the domes at 0.4 m the level view
shows rounded cobbles and hummocks under the paint and the across view a
bumpy near slope. The faces' five pinned literals and their sweeps are
unchanged.

**The lowland outcrops.** The first rock a player meets is a hump of the
height field by the trailhead, three metres wide and a metre tall, painted
rock by its own slope (`sim/cliffs.ts`, the outcrop component). Its rock
weight covers a strip two metres by eight, its creases cap the depth, and
the relief it takes is under 9 cm at the eased rule: a more rugged top edge
in a still from 5 m, not a crag. A walkable depth cannot make a one-metre
hump craggy; what would is a deeper relief on small outcrops (drawn rock
the player's feet pass into) or collision on the relief (a simulation change
and the level id), neither of which this design takes.
