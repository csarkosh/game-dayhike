# The apron and the ground trail — design

**Date:** 2026-09-09 · **Supersedes** §2.1–§2.3 and §3/§3a of `docs/trail/2026-09-09-open-hillside-trail.md`
(the bench cut, the chord predicate, the ascent), and §3 of `docs/trail/2026-09-08-trailhead-and-trail-graph.md`
(the switchback graph). §4 (landmarks) and §5 (trailhead, spawn, props) of
`docs/trail/2026-09-08-trailhead-and-trail-graph.md` stand except where §4 below amends them. **Parent:**
`docs/gameplay/2026-09-08-register-and-hollow.md`.

## 1. Why

Played on `bb336b8b`, three things are still wrong and one was never fixed:

1. **The trail cuts trenches through rises** — the bed several metres below the ground on both sides.
2. **The trail builds causeways over dips** — the bed a metre or two above the ground on both sides.
3. **The trail is too bright** — it reads as sand, not as dirt and stone.
4. **The escarpment between the road and the forest is still there.** The wall we had built on it is gone;
   the base terrain's own 90–130 m climb in the first 150–200 m from the road (worst 10 m grade 1.3–1.8 on
   every probe seed) is what the player now hikes.

1 and 2 are one defect: the bed's height along an edge is an eased **chord** between its two nodes, so wherever
the ground between the nodes rises above the chord the corridor digs, and wherever it dips the corridor fills.
The chord existed because the ground was not walkable and a trail on it had to be built. With 4 fixed, it does
not have to be.

**Decided (2026-09-09):** remove the enclosure — the player walks from the road straight into the
forest; **keep every terrain feature inland of it**, the terraces and the mountains too tall to walk up; the
trail **is the ground**, rising and falling with it; the trail **routes around** ground the player cannot walk;
the trail's colour is dirt and stone. The region the trail and landmarks live in stays as a bound nothing marks
on the ground.

Measured on `bb336b8b` (five probe seeds, 10 m grid over the region, analytic gradient at cell centres): 3–6 %
of cells are steeper than the walkable limit — the plateau is walkable almost everywhere — but the trailhead
reaches **0 %** of the region on seeds 1 and 4242 and ~96 % on the other three: the escarpment is the seal.

## 2. The apron — no escarpment

### 2.1 What the escarpment is

The pre-road field blends the shore profile (≈ 20 m at the road) into the montane field (130–180 m) over the
coast-distance window `[BLEND_START, blendEnd(z)]`, and `blendEnd` is already per-z: `BLEND_END_HEADLAND = 40`
on headlands to `BLEND_END_BAY = 500` in bays (`coastFrame`, `olympic.ts`). The trailhead sits on a
headland-width blend, so the whole climb happens in ~100–150 m.

### 2.2 The change

Inside a z-window around the trailhead the blend end is pulled to a long, fixed span:

```
S           = smootherstepD(APRON_Z_HALF − APRON_Z_FADE, APRON_Z_HALF, |z − TRAIL_Z_ANCHOR|)
W(z)        = 1 − S.v;   W'(z) = −S.d · sign(z − TRAIL_Z_ANCHOR)      (W' = 0 where S is flat, so no kink at z = anchor)
blendEnd'   = blendEnd + (APRON_BLEND_END − blendEnd) · W
blendEndDz' = blendEndDz · (1 − W) + (APRON_BLEND_END − blendEnd) · W'(z)
```

in `coastFrame`, so every consumer of the frame (the sample, the pre-road export, the road lattice) sees the
same apron and the chain rule downstream is untouched. The climb is the same 110–160 m, now over ≈ 500 m from
the road — average grade ≈ 0.25–0.3 — with the montane relief arriving in proportion: a foothill apron rather
than a face. Inland of `APRON_BLEND_END` the field is the montane field **bit-identically**, as it is today
(`olympicBaseFrom`'s short-circuit); outside the z-window the blend is what it was.

**The terraces leave the apron.** `cliffD`'s mask gains a factor `1 − A(u, z)` with
`A = (1 − smootherstep(APRON_CLIFF_U, APRON_CLIFF_U + APRON_CLIFF_FADE, u)) · W(z)`, product rule through
`∂u/∂x = 1`, `∂u/∂z = uDz` and `W'(z)`. Risers resume past `APRON_CLIFF_U` and outside the window. The dune
stage and the road corridor are untouched.

**What "walkable" means on the apron.** The blend's own slope is `s'(d)·(dense − shore) + s·dense'`; with a
500 m span the first term peaks near 0.5 and the second is the montane relief, so the apron is hilly, not flat,
and can carry steep patches. That is acceptable — the trail routes around them (§3) — provided the apron is
walkable on **most** of its width and the trailhead can reach the plateau. The apron scan (§6) is the authority.

| tunable | value | meaning |
| --- | --- | --- |
| `APRON_Z_HALF`, `APRON_Z_FADE` | 700, 100 | the window in z: the region's `BOWL_Z_HALF = 600` plus margin, fading out over 100 m beyond it |
| `APRON_BLEND_END` | 600 | coast distance of the blend's end inside the window (≈ 500 m inland of the road) |
| `APRON_CLIFF_U`, `APRON_CLIFF_FADE` | 450, 60 | road offset past which the terraces return |

Declared in `BOWL_TUNABLES`; the level id moves (a new world; old invite links are dead by design).

### 2.3 The pad

Unchanged (§2.2 of `docs/trail/2026-09-09-open-hillside-trail.md`). Its uphill bank, 8 m on `bb336b8b`, becomes
~1 m because the ground at `TRAILHEAD_U = 44` now rises at ≈ 0.3 rather than 1.6.

**The apron does not move the highway** (amended 2026-09-09, correcting an earlier version of this change).
`roadOffsetD`'s coast offset is `ROAD_WINDOW_FRACTION` of the blend window, so pulling the window out to
`APRON_BLEND_END` moved the ROAD inland with it — 32–50 m at the anchor, and a 45° jog (|d x / d z| up to
0.999, against 0.37 anywhere on the un-aproned road) where the window's fade closes at z ≈ ±660. `coastFrame`
therefore returns TWO windows: `blendEnd`/`blendEndDz`, the aproned pair, read ONLY by `olympicBaseFrom`'s
terrain blend; and `roadBlendEnd`/`roadBlendEndDz`, the headland/bay pair, read by every `roadOffsetD` caller
(the sample, the pre-trail and pre-pad samples, the road frame, the road distance, the centreline and the grade
lattice) and by `test/sim/helpers/roadLine.ts`'s oracle. `apron.test.ts` pins the centreline bit-identical to the
pre-apron formula at a dozen z on two seeds, and holds |d roadCenterX / dz| ≤ 0.5 over z ∈ [−1000, 1000].

## 3. The trail is the ground

### 3.1 Two kinds of thing, not two kinds of edge

**A path** is a polyline on the pre-trail ground found by the pathfinder (§3.2). **The bed** is the ground
under that polyline, smoothed (§3.3). Nothing about the height of the bed is planned; it is measured. The
former distinction between ascent legs and plateau edges is gone — there is no ascent.

### 3.2 Routing (T2: a pathfinder on the ground)

**The grid.** Over the region `u ∈ [BOWL_U_MIN, BOWL_U_MAX]`, `|z − TRAIL_Z_ANCHOR| ≤ BOWL_Z_HALF`, cells of
`TRAIL_GRID_CELL = 8` m in the road frame, each holding the pre-trail height and the analytic gradient
magnitude at its centre (one `olympicPreTrailSample` per cell; ≈ 18k cells, ≈ 30 ms once per world, memoised
with the graph). A cell is **impassable** if its gradient exceeds `TRAIL_GRID_CAP = 0.6`, and so is every
8-neighbour of one. The grid's cap is deliberately well under the fine check's `TRAIL_HARD_SLOPE_MAX = 0.9`
(§3.4): a cell's centre gradient under-reads the ground between centres 8 m apart, and a simplified segment cuts
corners the grid never measured. Measured over 55 seeds (2026-09-09): with the grid cap at 0.9 six seeds ended
over the fine cap after three reroutes, at 0.7 three did, at **0.6 none** — worst profile slope 0.879.

**The search.** Dijkstra from the trailhead cell over 8-connected moves; a move's cost is its length times
`1 + TRAIL_SLOPE_COST · |Δh| / length` (`TRAIL_SLOPE_COST = 2`: a 0.5 grade costs double), so the trail prefers
gentle ground without being forbidden steep-but-walkable ground. Deterministic: cells in a fixed order, a binary
heap with the cell index as the tie-break, no RNG — `hash3` enters only through the landmark predicates.

**The tree.** Landmarks are chosen (§4) from cells the first search can REACH, so every landmark is reachable by
construction. The graph is the union of the four shortest paths from the trailhead to the four landmarks, built
in the fixed order overlook, stand, clearing, talus, and made to **coalesce**: a move that lands on a cell already
in the tree costs `TRAIL_REUSE_FACTOR = 0.35` of its length, and a cell adjacent (8-neighbour) to the tree but
not on it is enterable only by a move that ends on the tree. That second rule is the spacing invariant of the
old §3.1 made structural: two branches either share cells or stay two cells apart, never one — no post-pass, no
`TRAIL_JUNCTION_R`. Trunk and forks fall out of the union instead of being designed in.

**Simplification.** Each path is reduced by Douglas–Peucker with `TRAIL_SIMPLIFY_TOL = 6` m, under three
constraints, a vertex being kept where any would be violated: the merged segment, sampled every 2 m, never crosses
an impassable cell; it never comes within `2·TRAIL_CORRIDOR_HALF + TRAIL_EDGE_GAP = 12` m of an edge of the tree
it does not share a node with; and its own smoothed profile (§3.3) never exceeds `TRAIL_HARD_SLOPE_MAX` — the
simplifier is slope-aware, so the fine check of §3.4 fails only when the grid path itself was steep. Vertices are deduplicated by grid cell, so paths that
share cells share nodes. The trailhead node is the pad centre itself, not a cell centre; the first edge runs
from it to the path's first vertex.

**Amended 2026-09-09, from the build.** Three things the design left implicit had to be made explicit,
each measured:

- *The tree is the whole bed, not its vertices.* A committed path marks every cell its SEGMENTS pass through,
  not only the vertices the simplifier kept. With vertices alone the reuse discount has nothing to coalesce onto
  and the two-cell rule — which is where the spacing invariant lives — is a halo around a few isolated cells
  rather than a corridor: on the builder's own synthetic world, two paths through a four-cell gap sealed it for
  the third.
- *A branch that leaves the trail partway along an edge SPLITS that edge.* The search leaves the trail wherever
  the cost says to, which is almost never at a kept vertex. The new node is the PROJECTION of the departure cell
  onto the edge's own centreline, so the split is exactly collinear and nothing already measured on that edge
  moves; within `2·TRAIL_CORRIDOR_HALF` of either end the existing node is used instead, because two nodes closer
  than the corridor's width are one junction and the stub between them carries four overlapping corridors.
- *The pad is the doorway.* `padD` levels a disc at its own centre height, so the ring it leaves is ~1.9 × the
  local grade — over `TRAIL_GRID_CAP`, and it surrounds the car completely. The cells within
  `TRAILHEAD_RADIUS + TRAILHEAD_FADE + TRAIL_GRID_CELL` of the pad centre are forced passable, exactly as a
  carved dome's own cells are (below): a stage that LEVELS ground must not be read as a wall. Without it, seeds
  108 and 282 of 0…500 reached nothing at all and could not be built.

**The carved overlook and the grid.** If the overlook is carved (§4), its dome is composed into the grid's
heights and gradients for the cells it covers BEFORE the remaining paths are routed, so every later path sees
the dome as ground; the path to the overlook itself climbs the dome's own ≤ 0.76 slope. (Amended 2026-09-09:
a dome NEVER SEALS GROUND THAT WAS WALKABLE. Its 0.75 skirt is under the fine check's 0.9 but over the
grid's deliberately conservative 0.6, so a plain re-read marks the whole skirt and its margin impassable and the
search cannot reach the cell the landmark is on — measured: every carved overlook came back unreachable. Cells
passable before the dome are forced passable after it; cells that were not stay that way.) The old dome-spacing rule
(`DOME_BED_CLEAR`) and `domeBedPeak` are retired: a dome is terrain the pathfinder routes over or around like any
other. **The stage order changes to match:** base → cliffs → dunes → [region: pad → **dome** → corridor] → road
corridor — the dome is ground before the corridor levels the bed over it, so a bed that crosses a dome is flush
with the dome. The builder's ground sampler is `groundAt(seed, landmarks, x, z) = landmarkDomeD(landmarks, x, z,
olympicPreTrailSample(seed, x, z))` — the pre-trail field with the domes — and it is what the grid (after the
overlook is placed), the profiles and the flush check all read. `olympicPreTrailSample` itself is unchanged.

### 3.3 The bed: a smoothed ground profile

Per edge from node `a` to node `b` (plan length `L`), the **profile** is the pre-trail ground (with any dome)
sampled every `TRAIL_PROFILE_STEP = 2` m along the segment, endpoints included; the interior samples are
smoothed with a symmetric triangular kernel of half-width `TRAIL_PROFILE_SMOOTH = 4` samples (8 m) — enough to
take out pebble- and clod-scale bumps, small enough to keep the rise and the dip — and the two end samples are
pinned to the node heights, so that every edge meeting there agrees exactly.

**Amended 2026-09-09, both from the walk scan.** *The kernel runs at full width everywhere*, reading the
ground past both ends along the edge's own line rather than shrinking as it approaches them: shrinking keeps a
plane exact, which is all the earlier measurement covered, but it leaves a SHORT edge barely smoothed, and the trail's
first edge is short and crosses the pad's own fade ring (composed gradient 1.507, seed −1098592628). *And a
node's height is the DE-CLODDED ground* — the same smoothing as a disc of the same 8 m reach — not the raw
ground. Every profile is pinned to its node heights, so a node standing on a clod is the one bump the smoothing
cannot remove: both edges are dragged to it, one arriving up it and one leaving down it, and their linear
extrapolations past the shared node then disagree by twice the clod exactly where the corridor blends them.
Measured with raw node heights over the 219 check seeds: 15 beds over `MAX_WALKABLE_GRADIENT`, every one of them
2.8–3.0 m from a node on an edge whose own profile was running at 0.32–0.57. With smoothed node heights and the
split rule of §3.2: none. (Confirmed, 2026-09-09: this spec's reason for pinning the ends — "so that every edge
meeting there agrees exactly" — is satisfied by the two edges sharing ONE value, whatever that value is, and the
de-clodded one is the one consistent with the interior samples.) The profile is interpolated by a Catmull–Rom spline in arc length: C¹ along the edge, `dg/ds` in closed
form. `g_i(p) = profile_i(τ_i · L)` with `τ_i` the projection parameter of §3.3 of
`docs/trail/2026-09-08-trailhead-and-trail-graph.md`, so `∇g_i = profile_i'(τ L) · L · ∇τ_i`.

The **corridor** is the union from `docs/trail/2026-09-08-trailhead-and-trail-graph.md`, with one fixed
radius (the second weight and adaptive radius of `docs/trail/2026-09-09-open-hillside-trail.md` were the bench
cut's; a bed that is the ground needs neither):

```
w_i = 1 − smootherstep(TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, d_i)
w   = 1 − Π(1 − w_i);   g = Σ w_i g_i / Σ w_i;   h' = (1 − w)·h + w·g
```

Exact derivatives as before. Across the 2 m bed the ground is levelled to the profile; over the 3 m blend it
returns to itself. On a side slope that is a bench of at most `TRAIL_BED_HALF · cross-slope` — half a metre on
a 0.5 slope — which is what a trail on a hillside looks like. On a rise the bed climbs the rise; over a dip it
descends into it. `TRAIL_BENCH_DEPTH`, `TRAIL_LIP` and `TRAIL_FADE_MORPH` are retired.

**Flush is a number.** Along every edge's centreline at ≤ 1 m: `|g − ground|` ≤ 0.5 m at p95 and ≤ 2.0 m at
max, over the check seeds (§6). It is the invariant this design exists for. (Max amended 2026-09-09 from 1.5,
to the measured tail, then corrected after a re-measurement: over the 227 check seeds p50 0.057, p95 0.296,
max 1.517. The tail has TWO mechanisms, both the bed doing its job where the ground is not smooth at the
profile's own scale — the pad's own fade ring, which the trail's first edge must cross, and a mid-edge ridgelet
narrower than the 8 m kernel. NO sample within 4 m of a node exceeds 1.5: an earlier version of this note
blamed the second-largest residual on the overlap either side of a node, and that was shown to be wrong.
Note also that the residual AT a node is no longer zero by construction — a node's height is the de-clodded
ground (below), so the bed passes near the raw ground there rather than through it, which is what a p95 of a few
centimetres is measuring. p95, which is what "the bed IS the ground" means, is 0.296.)

### 3.4 Walkability is a property of the ground the trail chose

**The fine check measures the COMPOSED FIELD** (amended 2026-09-09; it was the profile's own slope before).
After simplification the branch is PLANNED — the exact geometry `commitPath` would build, same nodes,
same profiles — and `trailCorridorD` is evaluated over the whole graph, the tree's edges and the candidate's
together, along every new edge's centreline at 1 m, against `TRAIL_HARD_SLOPE_MAX`. Every bed already in the
graph that the new one comes within `2·TRAIL_CORRIDOR_HALF` of is measured too, because that is exactly the reach
over which two corridors share a union. The profile alone is not what the player walks: at a junction the union
carries a `wDx·(g − base)` term — the blend weight's own gradient, up to 0.625/m, times the flush residual —
which nothing bounds, so a 0.2 m residual on a 0.9 profile already clears `MAX_WALKABLE_GRADIENT`. Measured with
the profile-only check over sequential seeds 0…500: five worlds carried a bed over the walkable cap (29 at 3.13,
305 at 2.76, 81 at 1.10, 221 at 1.08, 483 at 1.04), three of them with `fallbacks` reading 0, and two more (241,
409) were lifted over it by a LATER landmark's path joining an earlier bed. With the composed check: none.
`profileMaxSlope` stays in the simplifier as the cheap per-segment filter.

If the check fails anywhere: if
`|∇h|` exceeds `TRAIL_HARD_SLOPE_MAX` anywhere, the cells that edge crosses (not the tree's, the start's or
the target's) are marked impassable and the landmark's path is routed again, up to `TRAIL_REROUTE_MAX = 3`
times. **Those marks live for ONE LANDMARK'S PLACEMENT and are undone when it is placed** (amended 2026-09-09):
left in place for the whole build they accumulate and cut the region in two —
measured on seed 460, where one landmark's reroutes made every later candidate, and then the whole next landmark,
unreachable — but undone per CANDIDATE they teach the next candidate nothing, and one landmark's candidates are
the same patch of ground. On seed 305 three candidates behind the same 15 m step over 8 m of grid failed
identically; with the marks kept across them the second and third come back unreachable, cost no try, and the
search walks down the ranked list to a candidate on the near side. If the path still fails, the landmark
moves: the next-best candidate of its type is taken (§4), up to `LANDMARK_TRIES = 3` candidates; only when every
try fails does the graph keep the least-steep attempt and count it in `graph.fallbacks`. A candidate the tree can
no longer REACH at all is skipped without spending a try (amended 2026-09-09), and an empty path is never
committed: high scores cluster — a stand is a patch of forest — so the top three candidates are usually
neighbours, and if their pocket is shut they all are. Measured over 55 seeds: 0–2 reroutes per seed, no fallbacks, no landmark moved. The walk
scan (§6) is unchanged in what it measures.

### 3.5 What retires, what arrives

Retired from `TRAIL_TUNABLES` and the code: every `ASCENT_*`, every `SPINE_*`, `FORK_LEN_*`, `FORK_FAN_*`,
`FAN_STEP`, `FORK_BEND_JITTER`, `TRAIL_CHORD_STEP`, `TRAIL_FILL_MAX`, `TRAIL_CUT_MAX`, `TRAIL_BENCH_DEPTH`,
`TRAIL_LIP`, `TRAIL_FADE_MORPH`, `LEG_RETRIES`, `TRAIL_JUNCTION_R`, `BOWL_MARGIN`; `chordDeviation`,
`fallbackScore` and its bands, `forkChords`, `retreatToWalkable`, `domeBedPeak`, `DOME_BED_CLEAR`. (`edgeGapSq`, `trimJunction`
and `TRAIL_JUNCTION_R` were kept briefly as a query helper and then deleted with the rest — 2026-09-09: nothing
in `src/` called them once the grid's two-cell rule and the simplifier's own `segmentSegmentDistanceSq` test took
that job. `segmentSegmentDistanceSq` stays.) Kept:
`TRAIL_HARD_SLOPE_MAX`, `TRAIL_BED_HALF`, `TRAIL_CORRIDOR_HALF`, `TRAIL_EDGE_GAP` (documentation of the two-cell
rule: `2·TRAIL_GRID_CELL ≥ 2·TRAIL_CORRIDOR_HALF + TRAIL_EDGE_GAP` is asserted), `TRAIL_CLEAR`, `TRAIL_SALT`,
`FORK_COUNT`.

| new tunable | value |
| --- | --- |
| `TRAIL_GRID_CELL`, `TRAIL_GRID_CAP` | 8, 0.6 |
| `TRAIL_SLOPE_COST` | 2 |
| `TRAIL_REUSE_FACTOR` | 0.35 |
| `TRAIL_SIMPLIFY_TOL` | 6 |
| `TRAIL_PROFILE_STEP`, `TRAIL_PROFILE_SMOOTH` | 2, 4 |
| `TRAIL_REROUTE_MAX` | 3 |

The builder lives in a new module, `client/src/sim/trailBuild.ts`, which composes `trailGrid.ts` (the grid and
the search), `trail.ts` (types, tunables, the corridor, the distance queries) and `landmarks.ts` (the predicates,
the mask, the dome) — `trail.ts` must not import `landmarks.ts`, and this is what keeps the dependency a line.

`TrailGraph` keeps `nodes`, `edges` (`kind: "trunk" | "branch"` — an edge on two or more landmark paths is
trunk), `trailhead`, `fallbacks`, and gains `landmarkNode: number[]` (the node index each landmark ends at, in
landmark order). `ascent`, `rimNode`, `forks` and `forkEnd` go; `trailDistance` and `nearestTrailNode` are
unchanged in signature. `trailPaint.ts` reads `nodes`/`edges` only.

## 4. Landmarks on reachable ground

The four types and their predicates (§4.1–4.2 of `docs/trail/2026-09-08-trailhead-and-trail-graph.md`) stand.
Placement changes from a ray fan to a scan of the **reachable** cells of §3.2's first search:

- Candidates: reachable cells on a lattice of every `LANDMARK_CANDIDATE_STRIDE = 4`th cell in each axis (32 m —
  the disc scan is 29 samples per candidate, and 18k candidates would cost a second per world; ~700 cost 40 ms),
  with path length ≥ `LANDMARK_MIN_PATH = 250` m from the trailhead, plan distance ≥ `LANDMARK_SPACING = 200` m
  from every landmark already placed, and at least `LANDMARK_BOWL_MARGIN` inside the region.
- Score each candidate by its predicate on the `LANDMARK_SCAN_STEP` disc scan as now — EXCEPT the talus, whose
  disc is scored a `LANDMARK_DISC_RADIUS` away, the best of the eight compass directions (amended 2026-09-09).
  A boulder field is a property of steep ground: `boulderDensityUnmasked` ramps in over
  `CLUTTER_BOULDER_SLOPE_LO/HI` = 0.35/0.8, so `TALUS_BOULDER_MIN` = 0.5 needs a grade near 0.6 — and
  `TRAIL_GRID_CAP` is 0.6, with a margin on top, so no cell that could satisfy the predicate is a cell the trail
  may stand on. Measured over 25 seeds before the change: the best fill on any reachable cell was 0.07–0.52
  against the 0.7 threshold while unreachable discs scored 0.72–1.00, and the talus carved on 501 of 501 worlds —
  a conflict between the predicate and the grid, not a fact about the seeds. **The trail ends at the FOOT of the
  talus**: the landmark's own position (and its carve disc, and `landmarkNode`) is the walkable candidate cell,
  and `Landmark.discX/discZ` records the centre of the disc it was scored on. After the change, 42 of 227 check
  seeds FIND one.
- Take the best candidate that clears its threshold. The overlook's predicate becomes "the highest candidate, at least `OVERLOOK_RISE` above
  the trailhead's height"; it is **found** when one exists and **carved** (a dome at the highest candidate)
  otherwise. The other three carve as before when nothing clears.
- The carved point is a candidate cell, so it is reachable and inside the margin by construction; the earlier
  "retreat" and "least-violating" tiers have nothing left to do and are gone.
- `LANDMARK_SPACING` is a PREFERENCE, not a structural rule (amended 2026-09-09): where a seed's
  reachable, far-enough, inside-the-margin cells run out, it is halved and then dropped rather than fail to build
  the world. `LANDMARK_BOWL_MARGIN` and `LANDMARK_MIN_PATH` are not relaxed. Measured with one fixed spacing over
  seeds 0…500: seven worlds (1.4 %) had no candidate left for their third or fourth landmark (seed 79's region
  offers 21 candidate cells in all, of 1178 scanned).

`landmarkMaskAt` and `landmarkDomeD` are unchanged. `FORK_FAN_RAYS`, `FORK_FAN_LEAN`, `FAN_STEP`,
`FORK_BEND_JITTER` leave `LANDMARK_TUNABLES`; `LANDMARK_MIN_PATH`, `LANDMARK_SPACING`,
`LANDMARK_CANDIDATE_STRIDE` and `LANDMARK_TRIES` join it. A candidate that could not be routed walkably (§3.4)
is passed over for the next-best of its type.

## 5. Paint

Renderer-only, in `trailPaint.ts` and its GLSL mirror:

- **The segment table is bucketed.** A ground-following graph has many short edges — measured up to
  180 per world, against the old table's 64 — and a per-fragment loop over all of them is too much. The graph's
  segments are binned into `TRAIL_PAINT_BUCKET = 100` m world-aligned buckets over the graph's bounding box
  (grown by `TRAIL_CORRIDOR_HALF`), a segment entered in every bucket its corridor-grown box touches; a 16 × 16
  RGBA index texture holds `(start, count)` per bucket and a `TRAIL_PAINT_MAX_SEGMENTS = 512`-entry RGBA list
  holds the (duplicated) segments. The fragment computes its bucket from `trailInfo = (x0, z0, 1 / bucket,
  bucketsPerRow)`, reads the index texel, and loops at most `TRAIL_PAINT_BUCKET_MAX = 32` segments with a `break`
  at the count. Measured at most 25 segments in any 100 m bucket over 55 seeds; the bed scan asserts
  every bucket of every check seed fits and the list never overflows.

- `TRAIL_DIRT_TINT` from (0.62, 0.50, 0.38) — sand — to **(0.34, 0.29, 0.24)**: wet earth. The gravel layer's
  albedo contribution is scaled by `TRAIL_GRAVEL_GAIN = 0.6` so the stones read as dark stone in dirt, not pale
  pebbles. The check in §7 judges the pair and may move both.
- The bank band paints bare floor on the side where the ground **rises away from the bed** — at a pixel at
  distance `d` from the segment, with `e = (p − q)/d` the unit vector away from the bed, the ground climbs away
  when `dot(−normalW.xz / normalW.y, e) > 0`; the band is `smoothstep(0, TRAIL_BANK_SLOPE, that) · (1 −
  smoothstep(BED, TRAIL_CORRIDOR_HALF, d))` with `TRAIL_BANK_SLOPE = 0.15`, mirrored in TS with the sim's own
  gradient. The segment table drops its height row (the bed's height is the ground's now; `Segment` returns to
  `{ax, az, bx, bz}`, `buildTrailTable` to one row), and the bench cut's cut-depth model (`trailCutDepth`,
  `TRAIL_PAINT_CUT_FULL`) is retired.

## 6. Tests

| test | pins | precedent |
| --- | --- | --- |
| derivatives through the apron | `checkDerivatives` at `TOL_RATIO` on a dense sweep across the z-fade (`|z| ∈ [APRON_Z_HALF − APRON_Z_FADE, APRON_Z_HALF]`), across `blendEnd'` and across the cliff mask's `A` fade, three seeds | `helpers/derivatives.ts` |
| bit-identity outside the apron | outside the z-window and inland of `APRON_BLEND_END` the sample is the same object as before the change (the corridor-exclusion idiom); the clutter and tree censuses outside the window do not move | the "outside the corridor is exactly the cliff stage" test |
| **the apron scan** | on the five probe seeds and 200 lobby seeds: the mean grade of the ground from `u = BOWL_U_MIN` to `APRON_CLIFF_U` at `z ∈ {0, ±300}` ≤ 0.66 per column and the fraction of apron cells (`u < APRON_CLIFF_U`) under the walkable limit ≥ 0.88 (amended 2026-09-09 from ≤ 0.65 / ≥ 0.9: measured 0.658 and 0.885 over 205 seeds, and the test asserts the measured thresholds); and the trailhead cell reaches ≥ 0.9 of the region's walkable cells (measured min 0.995) | the wall sweep |
| **the flush check** | `|g − ground|` along every centreline at ≤ 1 m: p95 ≤ 0.5, max ≤ 2.0, over the check seeds (max amended from 1.5 with §3.3, 2026-09-09; measured p50 0.057 / p95 0.296 / max 1.517 over 227 seeds) | new |
| the walk scan | the composed field's gradient along every centreline at ≤ 1 m never exceeds `MAX_WALKABLE_GRADIENT`, 200 lobby + probe + spot-check seeds; `fallbacks` reported; every paint bucket ≤ `TRAIL_PAINT_BUCKET_MAX` and the list ≤ `TRAIL_PAINT_MAX_SEGMENTS` | `trailBed.test.ts` |
| the two-cell rule | no two non-adjacent edges closer than `2·TRAIL_CORRIDOR_HALF + TRAIL_EDGE_GAP`; asserted from the grid rule's constant relation and measured on the check seeds | `trail.test.ts` |
| derivatives through every corridor | the dense local sweep, kept | `trailBed`/`trail.test.ts` |
| graph determinism | hash-stable per seed, differs across seeds, query-order independent; cell order fixed | `forest.test.ts` idiom |
| landmarks | each landmark reachable (a path exists in the graph from the trailhead to `landmarkNode[i]`); each predicate holds at its endpoint; carved overlook's dome walkable through its bed | `landmarks.test.ts` |
| tunables exhaustive | `BOWL_TUNABLES`, `TRAIL_TUNABLES`, `LANDMARK_TUNABLES` — every key asserted, counts pinned | `bowl.test.ts` |
| trees and grass off the bed | unchanged | `vegetation`/`clutter` tests |
| paint mirror | TS and GLSL agree on the band, the tint literals and the gain | `trailPaint.test.ts` |
| spawn | on the pad, above freeboard | `spawn.test.ts` |

Level-id and census pins move once, dated.

## 7. Checked in the running game, before merge

Checked on three worlds, four views each, shot in the afternoon, each compared against a control shot of the
ground before this change:

1. **From the pad looking inland:** the forest reachable on foot — no escarpment, no terrace between the road
   and the trees.
2. **On the trail where it crosses a rise:** the bed on the rise, not below it — no trench.
3. **On the trail where it crosses a dip:** the bed in the dip, not above it — no causeway.
4. **The paint, close, beside a control frame:** dirt and stone, not sand.

Views 2 and 3 are found analytically from the profile (the edge with the largest positive and the largest
negative ground curvature). The check passes when all four hold on all three worlds; the write-up records what
each pair shows and what the browser found that the tests could not.

## 8. Out of scope

The invisible wall at the road edge and its line; the leash; the Hollow; water; the desktop shell. The region's
bound (`BOWL_U_*`, `BOWL_Z_HALF`) stays as the trail's domain and is not marked.
