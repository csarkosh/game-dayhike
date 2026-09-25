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
footprint base, `+Z` forward. For a cliff module forward is the **scanned
face** — the side with the ledges — so a module seated with `+Z` downslope
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
touched: `wall_b` at scale 1.3 on a 45° face puts its top-front edge 8.5 m
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
  height that stands above the sink, and `F` the scanned face's reach from
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

## 11. What the probes cannot reach (open)

§10 asked for two things that turn out not to meet: a fixed handful of probes,
and an invariant that every point of the module's above-ground box is over
steep rock. They do not meet because the gate is a per-point reading of
terrain that dips in and out of the stand limit inside a footprint 8–26 m
across: a probe bounds the ground it reads and nothing between. Two smaller
errors in §10's own formula were corrected on the way — the lean turns about
the sunk origin, so the top of the box swings `H·sin θc` downhill, not
`0.65·H·sin θc`; and the base probes sat at `±D/2` while the footprint runs
`−(D − F)` to `+F`, so the back of the box and all four corners were outside
them.

The field now probes the box itself: the corners of the above-ground box plus
a midpoint on any axis longer than half the model's longest dimension
(`CLIFF_PROBE_SPAN`), seated exactly as the shell seats the module — about
fifteen reads per candidate. What that leaves is measured, not assumed. Each
rule below was run over its own placements, swept on a 1 m grid over the box's
faces, across 60 worlds (792 qualifying cells; the shipped rule's own figures
over the full 200 worlds are 406 modules, 65 with a point over ground the gate
refuses, 31 of those over ground a player can stand on, pinned in
`cliffField.test.ts`):

| probe rule | reads per placement | placed | with a bad point | over walkable ground |
|---|---|---|---|---|
| §10's eight, as written | 8 | 179 | 83 | 28 |
| the box's eight corners | 8 | 142 | 37 | 17 |
| **corners + midpoints (shipped)** | **15** | **126** | **21** | **7** |
| corners + midpoints, stand margin 0.10 | 15 | 46 | 0 | 0 |
| 2 m lattice over the box | 108 | 113 | 4 | 1 |
| 1 m lattice — the sweep itself | 375 | 109 | 0 | 0 |

Exempting the points buried in the hillside does not rescue the cheaper rules:
77 % of the swept points stand proud of the ground they project onto, and the
corner rule still leaves 34 modules bad, 17 over walkable ground.

Three ways to close the rest, none of them chosen here:

- **Probe densely.** Read the 1 m lattice at placement — about 375 gate reads
  per placement against fifteen today, and on the worst 400 m disc (555
  qualifying cells) roughly 208,000 reads for a cold build, seconds rather
  than a frame. It would have to be spread across frames to be payable.
- **Widen the stand margin at the probes.** 0.10 instead of 0.03 closes the
  residue with the probes we have, and empties about two thirds of the faces:
  46 modules where the shipped rule places 126. The margin is a continuous
  lever, and the ground between 0.03 and 0.10 has not been measured.
- **Make the modules solid.** A collider under the module removes the
  disagreement instead of avoiding it, and the question stops being where a
  module may stand. That is a `sim/` change and a level-id move, which is why
  it is not a rendering decision.

Until one is taken, the three measured numbers are pinned in the test, so the
residue can shrink but cannot quietly grow.
