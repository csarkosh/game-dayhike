# Cliff modules: rock-wall models on the steep faces

The steep rock hillsides read as a smooth sheet with a cobble texture on
it. The rock relief work (`2026-09-23-rock-relief-design.md`) cut the loose
rock *props* into angular stone, but the surface in the complaint is the
rock *ground*: `classifySurface`'s rock class, painted onto the terrain
mesh by slope. Its crest against the sky is the terrain field's own smooth
curve, and no paint — parallax, normal map, crease darkening — can change a
silhouette.

Two ways to change it were tried before this design. Deep parallax on the
steep rock lifted the cobbles at 10 m and showed layer-stepping at grazing
angles, and left the crest untouched. Displacing the terrain mesh itself on
ground too steep to stand on (folded noise, 1.2 m, 1–2 m wavelengths) broke
the crest head-on at 10 m, but read as a wind-streaked dune from the side,
as dimples from above, and as the same flat sheet from 80 m: a fold
spectrum of 1–2 m on a 0.5–1 m vertex lattice can only alias or read as
bumps, and a scarp 80 m tall wants ledges and benches at 4–20 m, with
facets, overhangs and shadow that a heightfield cannot carry at any
resolution the clipmap can afford.

This design does what most games do with cliffs: it dresses the steep faces
with **instanced rock-wall modules** — real cliff geometry,
seated on the slope, drawn with LODs out to hundreds of metres so the
skyline breaks where the player actually sees these scarps. It is
renderer-only. Nothing in `sim/` changes, no collider is added, and the
level id is untouched.

## 1. Rulings

| question | ruling |
| --- | --- |
| What the faces get | Two cliff models (CC0, from the same collection as the shipped boulders), instanced along ground that is both rock and too steep to stand on |
| Collision | None. Modules stand only where a foot cannot go, so sight and collision never disagree underfoot; the simulation is untouched and mixed-version matches stay safe |
| Where a module may stand | Every probe of its footprint below the simulation's stand limit with a margin (`ny < GROUND_NORMAL_Y − 0.03`) and on rock (`weights.rock ≥ 0.8`); a module that would overhang walkable ground is not placed |
| Reach | High tier LOD0 to 60 m, LOD1 to 160 m, LOD2 to 400 m; medium 60 / 140 / 250; low LOD1 only to 80 m and LOD2 to 200 m |
| Seams | Geometric, mesh to mesh at fixed rings, as the opaque rock props already hand off — except the outermost edge, which dithers out over its last 40 m on the far bucket alone |
| Look | Each module tinted halfway toward the ground albedo under it, the way the litter pieces are, so a brown granite module and a pale cobble hillside read as one material |
| Cost | Native p95 at the scarp pose ≤ `main` + 1.0 ms; 4× pixel pairs at the scarp ≤ +1.5 ms and at TRAILSIDE (no cliffs in view) within noise |
| The displacement spike | Not merged. Its foot-of-face block field is a follow-up, judged on its own stills after the modules land |

## 2. Goals and non-goals

Goals:

- A steep rock face reads as broken, ledged rock with a jagged skyline from
  10 m to 400 m, from every angle — head-on, along the face, from the crest
  and from the road.
- Walkable ground is bit-for-bit what the simulation says it is, with the
  simulation's own colour on it. A module never stands where a player can.
- Determinism: the modules at a place are a pure function of the world seed
  and position, identical on every client.
- 60 Hz kept: the bars above, measured paired.

Non-goals:

- Collision with the modules, and any change under `sim/`.
- Modules on ground a player can stand on (rock outcrops in meadows are a
  different feature with a collider of its own).
- Replacing the rock ground paint: the modules stand on it and it shows
  between them.
- Snow: above the snow line the rock class already fades to snow paint, and
  the rock gate follows it, so the snowy faces keep their sheet for now.

## 3. The modules

Two models, through the same export as every other model, `kind`
environment (LOD caps 16,600 / 8,000 / 3,000 triangles), textures at 1k:

| id | source | size (m, w × d × h) | LOD0 target | LOD1 | LOD2 |
| --- | --- | --- | --- | --- | --- |
| `cliff.wall_a` | Namaqualand Cliff 01 | 8.3 × 4.4 × 5.0 | 5,000 | 2,250 | 900 |
| `cliff.wall_b` | Namaqualand Cliff 02 | 20.2 × 6.6 × 7.2 | 8,000 | 3,600 | 1,440 |

Blocky jointed granite with metre-scale ledges: the most "jagged" read of
the candidates, and the collection the shipped boulders came from, so the
rock vocabulary matches. `wall_b` is the workhorse — it covers area and its
20 m width is what breaks a skyline — and `wall_a` fills the short runs and
the edges of a face. LOD0 targets are set well under the caps: modules draw
by the hundred, and the LOD2 cap is what decides the far cost (§5).

Conventions the shell relies on, as for every model: metres, origin at the
footprint base, `+Z` forward. For a cliff module forward is the **face** —
the side with the ledges — so a module seated with `+Z` downslope
looks out of the hill. The model's own width and height at scale 1 are
recorded as constants in the field (`CLIFF_MODEL_WIDTH`,
`CLIFF_MODEL_HEIGHT`), because an instance `scale` is a multiplier on the
model and not a length: the size bands below are metres only once divided
by them (the derivation `sim/clutter.ts` records for the clutter bands).

## 4. The field

Two files, on the pattern of the tree field (`forestField.ts` pure,
`forestMeshes.ts` shell): `cliffField.ts` decides where modules stand and
`cliffMeshes.ts` draws them.

### 4.1 Placement (`cliffField.ts`, pure)

A lattice of `CLIFF_CELL = 12` m. For cell `(ci, cj)`:

1. **Jitter**: the candidate stands at the cell centre moved by up to
   `CLIFF_JITTER = 0.5` cells on each axis, from the lattice hash
   (`latticeHash`, salted so the draws never correlate with the tree, blade
   or litter lattices).
2. **Gate**: the ground there must be steep and rock. Steep is
   `ny < GROUND_NORMAL_Y − CLIFF_STAND_MARGIN` with the margin 0.03, where
   `ny = 1 / sqrt(1 + dx² + dz²)` from the terrain sample — the simulation's
   own stand limit, by reference, with a margin so a module never stands on
   the last centimetre a foot can. Rock is `classifySurface(...).weights.rock
   ≥ CLIFF_ROCK_MIN = 0.8`, read game-side at the module's own spot, so a
   module can never stand off the texture it belongs to.
3. **Module**: `wall_b` when the face is long — three of the four
   neighbours at `CLIFF_CELL` are also steep rock — else `wall_a`. A
   `wall_b` that fails its footprint check (step 5) falls back to `wall_a`
   before the cell gives up.
4. **Frame**: yaw faces **downslope** — `atan2(−dx, −dz)` in the scene's
   yaw convention (yaw 0 faces `+Z`) — plus a jitter of ±0.3 rad from the
   hash, so a run of modules is not a fence. Scale is drawn from
   `[0.8, 1.3]` (so `wall_a` stands 6.6–10.8 m wide, `wall_b` 16–26 m). The
   module is seated on the ground normal, like the lying rock classes
   (`seatOnGround`): a wall bedded into a 45° face leans back with it, as an
   outcrop does, instead of standing off it like a fin. Sink is
   `CLIFF_SINK = 0.35` of the rendered height, so the base is buried and the
   ledges above ground are what shows.
5. **Footprint**: the four points at ±half the rendered width along the
   face and ±half the depth across it are probed with the same gate. All
   four must pass. This is the invariant that a module never overhangs
   walkable ground: the probes cover the module's extent, and the sink
   keeps the rest of it below the surface it stands on. A module whose
   probes fail is dropped (or, for `wall_b`, retried as `wall_a`).
6. **Half the cells that qualify carry a module** (`CLIFF_DENSITY = 0.5`,
   the first hash draw, taken before any terrain sample so the cheap
   rejection comes first). With modules 1.3× the lattice on average, that
   is a wall with gaps rather than an unbroken palisade; the rock paint
   shows between, which is what a real face does.

The output of a cell is a `CliffInstance`: model index, x, z, ground
height and gradient, yaw, scale, hash. Nothing about the eye — the field
is a function of the world.

### 4.2 Bands and rebuilds (`cliffMeshes.ts`, shell)

Three LOD buckets per model, six thin-instance meshes, plus one mesh per
model for the far dither (§4.3). An instance is in exactly one bucket, by
its distance from the rebuild origin against the rings in §1
(`CLIFF_RINGS: Record<QualityTier, [lod0, lod1, lod2]>`); the partition is
asserted per rebuild.

The field rebuilds when the eye's origin snapped to `CLIFF_CELL` changes,
never every frame, through a memoising collector keyed by cell (the tree
field's `createBandCollector` shape): a rebuild re-reads only the cells
that entered the reach, and evicts cells past reach plus a margin. A cell
costs one terrain sample, one `classifySurface`, and four more samples for
the footprint of the half that qualify.

The reach edge is padded by `CLIFF_PAD = √2 · CLIFF_CELL` so a module at
the edge is collected before its band needs it — the same reason the tree
field's `SEAM_PAD` and the litter's `DUFF_PAD` exist.

### 4.3 Seams

LOD0 → LOD1 → LOD2 hand off geometrically at fixed rings, the opaque path
the rock and boulder props already take: a discard on an opaque material
disables early depth rejection and costs frame time scene-wide
(`distanceFadePlugin.ts`), so the near rings do not dither. The far
bucket's material is its own instance with the fade plugin attached
(`force`, the deadwood precedent) and an out band of `[reach − 40, reach]`
metres, because a 7 m wall popping out of the skyline at 400 m is 18 px at
1080p and visible; its fragments at that range are few, so the discard is
cheap where it is paid.

### 4.4 Look

Every instance carries the per-instance ground-albedo attribute the litter
and blade pieces carry (`writeFoliage` → the `foliage` buffer), and the
cliff materials take a small fragment-only plugin of their own
(`cliffTintPlugin.ts`) that mixes the albedo toward it by
`CLIFF_GROUND_TINT = 0.5`: half the module's own colour, half the ground's
under it. Not `foliagePlugin`, whose vertex stage is wind, lean and
collapse for cards — a wall wants none of that. Above the snow line the
rock weight fades, the gate closes, and the modules stop with the paint.

Modules cast and receive shadows the way the tree and clutter buckets do —
the shell exposes `casterMeshes` and the renderer registers them through
`lighting.addShadowMesh` as they load. The ledges' own shadows are most of
the "3D" the complaint asks for.

### 4.5 Where it runs

`renderer.ts` creates the field with the other fields and calls
`cliffMeshes.update(camX, camZ)` at both per-frame sites, after
`forestMeshes`, in the freecam branch and the player branch alike.

## 5. Budget

A census of three worlds (`atmo`, `ypeqauxk`, seed 1), 4 m cells over
±1.5 km, counting cells below the stand limit with rock ≥ 0.8:

| world | steep-rock area | worst 400 m disc | within 160 m | within 60 m |
| --- | --- | --- | --- | --- |
| atmo | 23.6 ha (2.6 %) | 4,621 cells | 805 | 0 |
| ypeqauxk | 11.0 ha (1.2 %) | 2,215 | 740 | 67 |
| seed 1 | 19.7 ha (2.2 %) | 5,549 | 1,261 | 105 |

Worst case at a 12 m lattice and density 0.5: 5,549 × 16 m² / 144 m² × 0.5
≈ 310 modules in the 400 m disc, of which ~70 within 160 m and ~6 within
60 m. At the LOD targets in §3 (mostly `wall_b`): 6 × 8,000 + 64 × 3,600 +
240 × 1,440 ≈ 0.62 M triangles at the worst disc, in six draw calls plus
the far dither meshes. The gate measures it; the fallbacks in §8 are
ordered by what they cost the look.

## 6. Invariants

1. **Never where a foot can go.** For every placed module, all five gate
   probes (centre and the four footprint points) satisfy
   `ny < GROUND_NORMAL_Y − 0.03` and rock ≥ 0.8.
2. **The simulation is untouched.** No file under `sim/` changes;
   `CLUTTER_TUNABLES` and the level id are the same digests as `main`.
3. **Pure.** `cliffCell(seed, ci, cj)` returns the same instance for the
   same arguments and differs by seed for every placed cell.
4. **One bucket per instance.** Each rebuild's instances partition exactly
   across the LOD buckets; the counts sum to the collected count.
5. **Bounded.** The collected count within the high-tier reach never
   exceeds `CLIFF_BUDGET = 700` modules on the three census worlds' worst
   discs.

Invariant 1 is superseded: §10 restated it over the module's whole solid,
and §11 settles what that can and cannot be — the probes are the lattice
over that solid, and what falls between them is measured, not forbidden.
§12.3 replaces it: the drawn solid lies inside the module's colliders.

## 7. Tests

- `cliffField.test.ts`: invariant 1 on real terrain, a 200-seed sweep of
  every placed module within 400 m of the seed's spawn (red before the
  footprint check, green after); invariant 3; the yaw faces downslope
  (the module's `+Z` has a negative dot with the gradient); the module
  choice (long faces take `wall_b`); density: on seed 1's worst disc,
  between 40 % and 60 % of qualifying cells carry a module.
- `cliffMeshes.test.ts` (NullEngine): buckets partition (invariant 4); a
  rebuild on a 12 m crossing re-reads only new cells (the collector's
  sample count); the far bucket's material carries the fade plugin and the
  near ones do not; every instance carries a `foliage` entry; instance
  matrices seat on the ground normal and sink 0.35 of the height; the
  model width/height constants match the loaded meshes' bounds (the
  `scale`-is-a-multiplier trap, pinned against the real GLBs); the buckets
  are exposed as `casterMeshes`; the tint plugin's GLSL is covered by
  `shaderHygiene.test.ts` like every other plugin's.
- `catalogModels.test.ts`: the two models load with `LOD0`–`LOD2` roots.
- `groundGradient.test.ts` / the level-id pin: unchanged digests
  (invariant 2, proven by not touching them).

## 8. Gates

Paired stills, `main` against the branch, seed `atmo`, clear noon, at the
scarp at (−336, −900) — face-on from 10 m, 30 m and 80 m, along the face
from 14 m up, from the crest looking down at the road — plus the
trail-over-rock seam pose at (−147, 53, 42), which must be pixel-identical.
The face must read as ledged rock with a broken skyline in every pose that
shows it, and the seam pose must not change.

Frame: 4× pixel pairs both orders at the scarp pose and at TRAILSIDE;
native p95 at the scarp on a quiet machine. Bars in §1.

Fallbacks if the bar is missed, in order: LOD0 targets 5,000 / 3,000; high
reach 300 m; lattice 16 m; density 0.4.

## 9. Follow-ups

- The foot-of-face block field from the displacement spike, as broken rock
  at the base of the modules.
- Mirrored variants (a negative x scale by hash) if two models repeat
  visibly on long faces.
- The snowy faces above the snow line.
- A crest-only far band beyond the reach, if the 400 m edge shows.

## 10. Amendment (2026-09-24): the solid, not the base

§4.1's footprint probes bound the module's base plane — the midpoints of
its four edges, not its corners — and §6's invariant was stated over those
five points. But a module seated fully on the ground normal lies back on
the slope, and its upper body then reaches out over ground the base never
touched: `wall_b` at scale 1.3 on a 45° face puts its top-front edge 8.6 m
horizontally downhill of its origin, 4 m past the front probe. The
terrain's own cliff bands are staircases — a riser with a walkable bench
at its foot — so a module low on a riser could hang a slab over the bench
at head height, with no collider under it. §1's "sight and collision never
disagree underfoot" would fail there. Two changes close it, together:

- **The wall stands nearly plumb.** A module leans toward the ground normal
  by at most `CLIFF_TILT_MAX = 0.35` rad (20°), not by the slope's full
  angle: a cliff face stands against a steep hillside rather than lying on
  it, and a 20° lean is enough to bed it. The shell composes this itself
  (`seatOnGroundCapped` in `groundTilt.ts`) instead of the lying-rock
  seating of `instanceMatrixFor`; the sink stays vertical and in `groundH`.
- **The probes bound the solid.** To the five base probes are added three
  at the ground projection of the module's top-front edge — at the centre
  and at ±half the width — a forward distance `s · (0.65·H·sin θc +
  F·cos θc)` from the origin, where `θc` is the capped lean, `0.65·H` the
  height that stands above the sink, and `F` the face's reach from
  the origin along +Z at scale 1 (`CLIFF_MODEL_FRONT`: 0.77 m for `wall_a`,
  2.19 m for `wall_b`). At the cap the farthest point of the solid is inside
  the outermost probe for both models at every scale in the band. The
  invariant in §6 now reads: every point of the module's above-ground
  bounding box, projected to the ground, is steep rock past the margin — and
  the test sweeps that box on a 1 m grid across 200 worlds.

Two smaller corrections from the same read: the per-instance ground tint
is memoised per instance (it re-sampled the terrain for every module in
reach on every 12 m crossing, on the same frame as the clutter's rebuild),
and it reads the ground's own height rather than the sunk one, so a
sea-cliff module is not tinted from 3 m below its base. A LOD root with
more than one geometry mesh is refused at load rather than half-drawn.

The placement counts move: fewer cells pass eight probes than five, and
the first count (23 % of qualifying cells on the worst face) is superseded
by the verification note's.

§11 supersedes this section in two places: the `0.65·H` in the top-edge
formula is wrong (the lean turns about the sunk origin, so the whole height
swings forward), and the box invariant as written above cannot be met by any
handful of probes at a cost the rebuild can pay. What shipped is the lattice
over the solid, with the remainder measured.

## 11. What the probes cannot reach (open)

§10 asked for two things that turn out not to meet: a fixed handful of probes,
and an invariant that every point of the module's above-ground box is over
steep rock. They do not meet because the gate is a per-point reading of
terrain that dips in and out of the stand limit inside a footprint 8–26 m
across: a probe bounds the ground it reads and nothing between. Two smaller
errors in §10's own formula were corrected on the way — the lean turns about
the sunk origin, so the top of the box swings `H·sin θc` downhill, not
`0.65·H·sin θc`; and the base probes sat at `±D/2` and `±W/2` while the
footprint runs `−(D − F)` to `+F` and `−(W − R)` to `+R`, so the back of the
box and all four of its corners were outside them.

The field now probes the box itself: the corners of the above-ground box plus
a midpoint on any axis longer than half the model's longest dimension
(`CLIFF_PROBE_SPAN`), seated exactly as the shell seats the module — about
fifteen reads per candidate. What that leaves is measured, not assumed. Each
rule below was run over its own placements, swept on a 1 m grid over the box's
faces, across 60 worlds (792 qualifying cells; the shipped rule's own figures
over the full 200 worlds are 399 modules, 69 with a point over ground the gate
refuses, 31 of those over ground a player can stand on, pinned in
`cliffField.test.ts`):

| probe rule | reads per placement | placed | with a bad point | over walkable ground |
|---|---|---|---|---|
| §10's eight, as written | 8 | 179 | 86 | 53 |
| the box's eight corners | 8 | 140 | 42 | 24 |
| **corners + midpoints (shipped)** | **15** | **121** | **23** | **7** |
| corners + midpoints, stand margin 0.10 | 15 | 45 | 0 | 0 |
| 2 m lattice over the box | 112 | 109 | 5 | 0 |
| 1 m lattice — the sweep itself | 379 | 107 | 0 | 0 |

Exempting the points buried in the hillside does not rescue the cheaper rules:
77 % of the swept points stand proud of the ground they project onto, and the
corner rule still leaves 35 modules bad, 19 over walkable ground.

The box is the model's own, not a centred one: both models sit off-centre in
their own extents, `wall_a` reaching 4.40 m along +X of its origin and 3.87 m
the other way, `wall_b` 10.55 m and 9.68 m, in the frame the instance matrix
works in (the loader's handedness mirror already baked in). `CLIFF_MODEL_RIGHT`
and `CLIFF_MODEL_FRONT` carry those, and `cliffMeshes.test.ts` pins both
against the loaded meshes, so a re-export cannot move the solid out from under
the probes.

Three ways to close the rest, none of them chosen here:

- **Probe densely.** Read the 1 m lattice at placement — about 379 gate reads
  per placement against fifteen today, and on the worst 400 m disc (555
  qualifying cells) roughly 210,000 reads for a cold build, seconds rather
  than a frame. It would have to be spread across frames to be payable. The
  2 m lattice is the cheaper half of the same idea: 112 reads, nothing left
  over walkable ground in the scan, five modules still over ground inside the
  margin.
- **Widen the stand margin at the probes.** 0.10 instead of 0.03 closes the
  residue with the probes we have, and empties about two thirds of the faces:
  45 modules where the shipped rule places 121. The margin is a continuous
  lever, and the ground between 0.03 and 0.10 has not been measured.
- **Make the modules solid.** A collider under the module removes the
  disagreement instead of avoiding it, and the question stops being where a
  module may stand. That is a `sim/` change and a level-id move, which is why
  it is not a rendering decision.

Until one is taken, the three measured numbers are pinned in the test, so the
residue can shrink but cannot quietly grow.

(2026-09-25) The residual is retired by the colliders of §12.3, which
contain the whole drawn solid; the test that pinned it is gone.

## 12. Amendment (2026-09-25): walls, and solid ones

Two rulings after the second gate (`2026-09-25-cliff-modules-verification.md`
§13). Standing plumb and coloured like the hill, the modules still read as
outcrops in rows — one per 12 m cell with smooth ground between — not as a
face. And §11's residual (31 of 399 modules with some above-ground point
over ground a player can stand on) is closed by making the modules solid
rather than by probing further. Both change where placement lives.

### 12.1 Placement moves into the simulation

A solid module is part of the world every peer must agree on, so the
placement field moves from `game/cliffField.ts` to `sim/cliffs`-adjacent
code (`sim/cliffField.ts`), Babylon-free: the capped lean becomes a plain
rotation about the axis `UP × normal` (the same quaternion the shell
composes, written out), and the rock weight is the simulation's own slope
band for rock (`CLUTTER_ROCK_SLOPE_LO/HI`, the band the rock props already
stand on) instead of the paint's `classifySurface`. Every constant that
steers placement is declared in the pass's tunables, so the level id moves
with them and an old client cannot share a world with a new host. The shell
reads instances from the simulation field and keeps the LOD buckets, the
tint and the far dither exactly as they are.

### 12.2 Walls: several modules along a contour

A cell that qualifies no longer places one module at its jittered point.
It lays modules **along the contour** — the direction perpendicular to the
gradient — at a spacing of `CLIFF_RUN_SPACING = 0.7` of the mean of the two
neighbours' placed widths, so neighbours overlap by about a third and a run
reads as one wall with no lattice between; the run extends from the cell's point in both
directions while each next spot passes the same probe rule (18 probes for
`wall_a`, 12 for `wall_b`), up to
`CLIFF_RUN_MAX = 4` modules per cell per side (a cell contributes at most
nine). Each module in a run draws its own scale from a wider band,
`CLIFF_SCALE = [0.7, 1.6]`, and its own yaw jitter, so a wall is not a row
of copies; every second module along a run is the *other* model, and the
spacing is the mean of the two neighbours' widths so a long module stepping
to a short one leaves no gap. The density draw stays first, before any
terrain sample, but falls from 0.5 to `CLIFF_DENSITY = 0.1` per cell: a run
reaches up to `CLIFF_RUN_REACH` (63.84 m) either side of its cell, so at 0.5
every 12 m cell along a face laid its own run over the same stretch and
modules stood two and three deep. At 0.1 a stretch of wall is laid about
once, faces keep real gaps between runs, and the census discs sit under the
budget. Runs are deterministic: the spots along a contour are a
function of the cell and the terrain, not of any neighbour cell's outcome,
so two cells' runs can cross the same stretch of face. The density keeps
that rare: a stretch is laid about once, and modules overlap only within a
run, where the spacing sets them a third of a width into each other.

The budget re-measures with the census discs; the bar and fallbacks of §8
stand, and `CLIFF_RUN_MAX` is the first fallback (4 → 2) before the reach.

### 12.3 Solid modules

A chunk pass (`sim/passes/cliffs.ts`, the boulder pass's idiom) emits
collision brushes for every module whose solid intersects the chunk —
modules are collected from the cells within the chunk expanded by the
farthest a run carries a module from its cell (`CLIFF_RUN_REACH`, 63.84 m)
plus the farthest the module's solid reaches from its origin
(`CLIFF_SOLID_REACH`, 21.58 m: the long model's farthest corner at the top
of the scale band, `1.6 · sqrt(R² + H² + (D − F)²)`, which no yaw or lean
can lengthen), 85.42 m in all. A cell's point lies inside its own cell, so
no further cell term is needed, and a wall straddling a chunk border is
found from either side. A module's collider is a **row of axis-aligned
boxes along its yawed length**: the wall's length at scale is cut into
pieces no longer than `CLIFF_BOX_STEP = 4` m, each piece an `Aabb` of the
piece's own x/z extent, from the seated solid's lowest point up to its
highest. Boxes are what the
movement code already collides with (`depenetrate`, `sweepBox`,
`tryStepUp`), so a wall stops a hiker the way a boulder does, and blocks
line of sight the way a large boulder does.

The extent is the bounds of the piece's eight corners **seated** — turned to
the facing, then leant — over the model's whole height, from its base to
its top, not of its four yawed corners with the lean ignored,
as this section first read. The lean does not lean into the hill: it turns
about the sunk origin and tips the top downslope, out over the foot of the
face, by up to `H · s · sin θc` (3.9 m for the long model at the top of the
band), and lifts the back of the top edge above the plumb height (by up to
2.58 m in a 40-world sweep). Plumb boxes around the unleant piece left
41,499 of the 85,780 swept points of the above-ground box outside them. The
lean also drops the front of the base below the sunk origin, where the
downhill ground can lie lower still, so the part the sink was meant to bury
can stand in the open; boxes that started at the sunk origin and bounded
only the part above the sink line left 15,274 of the 106,996 points of the
whole model's box outside them. The boxes therefore bound the whole drawn
solid, buried part included. The base is not at the origin: both models
reach a little below it (`CLIFF_MODEL_BASE`, −0.42 m for `wall_a` and
−0.16 m for `wall_b` at scale 1, pinned against the loaded meshes), so the
model runs from `BASE` to `BASE + H` and the corners are taken there. The
placement's probes keep their box from the ground at the origin to `H`: its
bottom is the ground whatever the base, and its top stands `|BASE|` above
the drawn top, so the probes read a slightly taller box than is drawn and
err toward refusing a spot. The sink stays measured from the origin, which
buries `|BASE|` more of each model than `CLIFF_SINK` of its height — a
matter of look, since the renderer seats from the same `groundH`.

The price of the seated bounds is that each box stands plumb over the
lean's whole reach, so at the foot of the face it claims a few metres of
ground in front of the drawn rock — ground that is mostly too steep to stand
on, though only at the probe points is that guaranteed. Measured over 40
worlds, 4 of 84 modules have a box standing over walkable ground (17 of
13,746 metre cells under their footprints). The box tops are a second
consequence of axis-aligned boxes: each is flat and level with its piece's
highest seated corner, so where the hillside behind a wall rises to it (255
of 362 tops over 40 worlds lie within a step of it), a hiker sliding down
from above can land on a ledge up to 3.74 m above the drawn top edge.

A wall straddling a chunk border is emitted by every chunk it reaches into,
each emitting its own share of each box: the box clipped to the chunk's
footprint. The chunk grid's broadphase surfaces only the props of the chunks
a query overlaps, which is why the trees and boulders clamp to their chunk;
a wall cannot lose its overhang the way a trunk can, so it is split across
chunks instead, and the shares tile each box exactly.

The invariant of §6 (1) is replaced: **the drawn solid lies inside its
collision boxes** — every point of the module's box, from the model's base
to its top (the lattice §11's residual sweeps, extended below the sink
line), lies inside one of its boxes; asserted on the 200-world sweep. The
residual of §11 is retired with it.

Cost: 65 boxes on the atmo scarp chunk, and at most 88 in a
chunk on the census worlds' worst discs. The pass remembers each cell's run
per world and terrain variant (the field is pure, so this changes no
output), since a chunk's gather window is about 203 m across and each cell
is asked for by some forty chunks. Across a 7 × 7 window at the scarp the
pass costs 8.9–10.4 ms against 53–57 ms for all the other passes together,
about 0.18 of them; read cold, before the cache, it cost about 79 ms.

### 12.4 Gates

The scarp stills (10 / 30 / 80 m, along, crest) at noon and 16:00: the
face reads as runs of wall rather than rows of outcrops; nothing walks
through a module (a scripted walk into a wall at the scarp foot stops at
the box, and a slide onto a wall from above shows where the flat box tops
of §12.3 hold a hiker); the trail seam pose unchanged; frame pairs and
native p95 as §8, and the level-id pin in `client/test/sim/groundGradient.test.ts`
re-pinned to the new digest with the tunables named.

### 12.5 Amendment (2026-09-25): the uphill face goes into the hill

The third gate (`2026-09-25-cliff-modules-verification.md` §15) found seven
places behind the scarp's walls where a hiker comes to rest and cannot
leave. Walking, jumping or sprinting for five seconds in any of eight
directions moves them less than 0.35 m; without the colliders the same
points slide 31–80 m down the face.

**The mechanism.** A box's uphill (back) face stands where the seated
corners put it, plumb, and above it the hillside behind the wall is below
the box's top. The ground there is too steep to stand on (normal 0.48–0.65),
so a hull resting on it is never grounded. It cannot jump, friction never
applies, and air control (`AIR_ACCEL`) is too weak to climb. Only gravity's
downhill share moves it, and that points straight into the back face, which
cancels it. The hull sits in the V between hillside and face with nothing to
push off.

**The rule.** After the seated-corner bounds, each box's uphill face is
moved back into the hill, `CLIFF_BURY_STEP` (1 m) at a time, until the
hillside along the face, read at most `CLIFF_BURY_SAMPLE` (1 m) apart, stands
at or above the box's top everywhere. It moves at most `CLIFF_BURY_MAX`
(16 m), and a face that stops there is counted.
- **Which face moves:** the side face the module's uphill direction
  `−(fx, fz)` points through most nearly, the axis with the larger component.
- **Why only one:** moving the other face as well, where the uphill direction
  is near a diagonal, would try to bury a face that runs down the slope. Its
  downhill end stands in front of the wall, where the hillside never reaches
  the top. Tried with both faces moving whenever the lesser component is at
  least `sin 22.5°`, 7 of 362 boxes over 40 worlds stopped at a 40 m cap, and
  the median face moved 6 m.
- **What changes:** a hiker sliding down behind a wall now meets the box's
  top, which is flat and holds a foot, and walks forward off the front.
  `movement.ts` is unchanged, and the collider stays a row of axis-aligned
  boxes.

**The invariant.** Along every box's uphill face, read every quarter metre,
the hillside stands at or above the box's top, less a 5 cm tolerance for
curvature between the rule's own readings. No face stops at the cap. Both
are asserted on the 200-world sweep. The boxes only grow, so the drawn solid
still lies inside them (§12.3).

**What it costs.**
- **How far faces move:** over the same sweep, a face moves a median of 1 m
  and at most 14 m. The seven trap boxes needed 1–5 m.
- **Gather reach:** the pass gathers `CLIFF_BURY_MAX` further, 101.42 m in all.
- **Build time:** building a chunk reads the hillside along every face, so
  the 7 × 7 window at the scarp costs about 18 ms against 9–10 ms before.
- **Standing boxes:** box tops over walkable ground, counted over 40 worlds,
  go from 17 cells in 4 modules to 40 cells in 9. Some of these cells are
  crests the buried volume now runs under; they count only where a box's top
  stands above the ground there. Counting every walkable cell under a
  footprint, including where the box lies wholly under the ground, gives 305
  cells in 19 modules. That count says nothing about play.
- **Shelves:** the flat tops of §12.3 reach further back over the hill,
  which is the point: the ledge a hiker lands on now meets the hillside, so
  nothing is left between them to be caught in.

**The crest-run jitter is not a collider shape.** Walking along a crest
run's top, the hull shows about 100 reversals in 10 s and sits up to 0.11 m
inside a box. The cause is the ground's stick in `stepMovement`. A grounded
hull whose feet end a tick just above the terrain is snapped down onto it
when the drop is within one tick's walkable descent. That terrain can lie
inside a box, a few centimetres under its top, along the line where the
hillside meets the top. The next tick's `depenetrate` lifts the hull back
onto the top, and walking along that line keeps the two in contention. Any
box whose top meets the hillside has such a line, and burial guarantees one,
so no box shape removes it. It belongs to the ground stick, which would have
to leave a hull on a box top it is already standing on.
