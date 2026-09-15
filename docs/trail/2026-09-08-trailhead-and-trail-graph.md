# The trailhead and the trail graph — design (sub-project A)

**Date:** 2026-09-08
**Status:** Shipped 2026-09-09 (`b86bd58c..6bf3231b`; parent §17); revised by
`docs/trail/2026-09-09-open-hillside-trail.md` (2026-09-09) and
`docs/trail/2026-09-09-apron-and-ground-trail.md` (2026-09-10, the trail is the ground).
**Superseded in part on 2026-09-09** by `docs/trail/2026-09-09-open-hillside-trail.md`: the
wall (§2.2) is removed, the corridor (§3.3) becomes a bench cut, and the paint (§6) becomes
gravel on the bed with grass gated off it. Read that doc first; this one stands for
everything it does not name.
**Parent:** `docs/gameplay/2026-09-08-register-and-hollow.md` §§3–4, §14. This is the first
of that design's ten sub-projects and the one everything else stands on.

**Decisions for this sub-project (2026-09-08):** W1 + T1 + L3 (§0), prototype the
corridor math first. The corridor spike passed (§3.3). The wall is **one-way**: a player may
slide down to the road and can never climb back — the design's aim was "cliffs that make
it difficult to get *back* to the forest."

## 0. What this builds, and the three choices behind it

A bounded, seeded **bowl** on the inland side of the highway with one way in: a trailhead
beside the road, a switchback ascent up an unclimbable face, and a forking trail network
across the plateau to four landmarks. It produces terrain, a trail graph the rest of the
game queries, cleared trees, trail paint, a relocated spawn, and placeholder trailhead
props. It builds no gameplay.

Three approaches were weighed; these won:

- **W1 — steepen the natural escarpment** rather than force `cliffD`'s terraces hot.
  Terraces have benches, and a bench between two risers is a place a fallen player can be
  stranded with no way up or down — the one thing a horror game cannot have.
- **T1 — a seeded polyline graph in the road frame, carved by cut-and-fill**, with the
  height-changing part confined to the ascent (§3).
- **L3 — landmarks are found where the seed provides them and carved where it does not**
  (§4), so the register's "last seen near…" is always true.

## 1. Measured facts the design rests on

Five seeds (0x5eed, 1, 12345, 777, 4242), throwaway probes against the real `olympic` field.

**The escarpment is natural but leaky.** East of the road the ground climbs 80–110 m in
the first ~100 m at gradients 0.65–1.54. The walkable limit is `MAX_WALKABLE_GRADIENT ≈
1.02` (`GROUND_NORMAL_Y = 0.7`), and it is a surface-normal test — ground steeper than that
is not ground, whatever direction you walk, so no switchback beats it. But 7–20 of 61
columns per seed are climbable straight up, in contiguous runs. The wall is a stage that
**closes gaps**, not one that builds a cliff from nothing.

**Ascent-then-forest is native.** Forest density is 0 for the first 120–200 m inland (the
road-clearance and slope gates), then ≈ 1. A bare climb into trees falls out of the field.

**Landmark coverage on the plateau** (`u` 150–1000, `|z| ≤ 600`, 25 m grid):

| type | coverage | verdict |
| --- | --- | --- |
| old stand (ρ > 0.9) | 44–58% | found in every seed |
| clearing (ρ < 0.1, h > 60) | 3–17% | found in every seed |
| talus (boulder density > 0.5) | 3–12% | found in every seed |
| treeline (h ≥ 200) | 0–9% | absent in 2 of 5 |
| overlook (unwalkable at h > 120) | 0–2% | near-absent |
| creek, tarn | — | **not producible**: `water` in `sim/` is sea level only |

**Two mechanics facts.** `TREE_CELL = 10` m with jitter, so density gating cannot clear a
2 m path; trees must be rejected per instance. And a 100 m climb at a hiking grade ≤ 0.3
needs ≥ 330 m of path: the ascent is a diagonal or switchback across the face, never a
straight cut.

**The corridor spike** (§3.3): 44,880 points, worst analytic-vs-numeric derivative error
3.2 × 10⁻⁵ against the harness's `TOL_RATIO = 0.01`, through three hairpins and every
corridor edge; steepest slope along the carved path 0.41.

## 2. The frame and the wall

### 2.1 The frame

Everything is defined in the **road frame** `(u, z)`: `u` the signed offset from the
highway centreline that `olympicSample` already computes (`u = d − d_r(z)`, with `uDz`
from the chain rule), `z` along the road. Cliffs and dunes are already defined there; that
is why the bowl is immune to the road's ±100 m per-seed wobble.

| tunable | value | meaning |
| --- | --- | --- |
| `TRAIL_Z_ANCHOR` | 0 | `z` of the trailhead |
| `BOWL_U_MIN`, `BOWL_U_MAX` | 30, 1000 | inland extent (`BOWL_U_MIN = ROAD_CORRIDOR_HALF`) |
| `BOWL_Z_HALF` | 600 | along-road half-extent |

The bowl sits entirely inside `IMPOSTOR_RADIUS = 2000` with `NEAR_RADIUS = 120` streaming
around the player; extent is not a problem.

### 2.2 The wall (W1)

A new stage `wallD` in `olympicSample`, **after `duneD` and before the road's
`corridorD`**, active for `u ∈ [WALL_U_LO, u_top(z)]` and `|z − TRAIL_Z_ANCHOR| ≤
WALL_Z_HALF` with smootherstep fades at the `z` ends.

**Shape.** The face is a plane of fixed gradient `G` from the shoulder to the plateau's own
rim height, **as wide as that requires**:

```
shoulder(z) = spline of the pre-wall base height at u = WALL_U_LO      (lattice, along z)
rim(z)      = spline of the pre-wall base height at u = WALL_RIM_U     (lattice, along z)
u_top(z)    = WALL_U_LO + (rim(z) − shoulder(z)) / G
face(u, z)  = shoulder(z) + G · (u − WALL_U_LO) + relief(u, z)
```

`h' = blend(base, face)` with a smootherstep in `u` that is 1 across the face interior,
rising from the base over `[WALL_U_LO, WALL_U_LO + WALL_FADE]` and returning to it over
`[u_top − WALL_FADE, u_top]`. The two splines reuse `gradeSplineD` with their own lattice
samplers (the road-lattice idiom, memoized per seed), so the face is C² in `z`, and its
top meets the plateau at the plateau's own height — no crest ridge, no overshoot.

**Amended 2026-09-09.** "No crest ridge, no overshoot" is true of the FACE, and
it is not the whole story of the ground. `u_top` is where the face meets `rim(z)`, the
spline of the base at `u = WALL_RIM_U`; between `u_top` and `WALL_RIM_U` the face has been
blended off and the ground is whatever the base does there, which is generally BELOW
`rim(z)`. The result is a shallow inland-facing trough behind the crest. A walk survey
caught it as the spine's first edge climbing out of the dip (seed 24301 edge 3→4 at
slope 1.44, seed 1 edge 2→3 at 1.47). The graph builder now lands the rim node at
`max(u_top + RIM_OVERSHOOT, WALL_RIM_U)` so the spine starts on ground already at rim
height and the ascent's last leg crosses the trough on its own near-flat chord (§3.2).

The **trailhead flat** has the mirror-image problem and is a KNOWN FOLLOW-UP, not fixed
here: the disc sits at `TRAILHEAD_U = 44`, 14 m up a face of gradient 1.6, and holds
shoulder height, so it is a ~22 m pit in the face. No `Δu` makes the first ascent leg's
average comfortable; it peaks near 0.8 (walkable, under 1.02, but over the 0.5 comfort
cap). The fix is a "notch" — shifting `WALL_U_LO` outward to the flat's edge near `z = 0`
so the face begins where the flat ends.

**Why a plane, not `max(base, face)`.** A max would leave the base wherever it is higher —
and a high, *flat* patch of base on the face is a bench: reachable by sliding down from
the rim, sealed below by the face, sealed above by more face. A trap. The face interior is
the plane, so the gradient is ≥ `G` at every point of it and there is nowhere to stand.

**Relief.** A plane reads as a wall of concrete. `relief` is a small seeded `fbm2d` term
whose amplitude and wavelength are chosen so that its gradient contribution `δ` satisfies
`G − δ − max|∂shoulder/∂z| > 1.1` — comfortably above 1.02. The wall sweep test (§7) pins
this; the numbers below are the starting point, and the test is the authority.

| tunable | value |
| --- | --- |
| `WALL_U_LO` | 30 |
| `WALL_RIM_U` | 160 |
| `WALL_GRADIENT` (`G`) | 1.6 |
| `WALL_FADE` | 8 |
| `WALL_Z_HALF`, `WALL_Z_FADE` | 400, 60 |
| `WALL_RELIEF_AMPLITUDE`, `WALL_RELIEF_WAVELENGTH`, `WALL_RELIEF_OCTAVES`, `WALL_RELIEF_SALT` | 2.5, 60, 2, new salt |
| `WALL_LATTICE` | 240 |

**Why compact.** The wall's only job is to stop a player who slid down to the road from
climbing back near the trailhead, where they would naturally try. A player on the road is
inside the leash wherever they are (parent §8), so gaps 700 m along the rim are the
Hollow's problem. `WALL_Z_HALF = 400` covers the ascent's `z`-extent plus the leash's
reach with margin.

**Derivatives.** `∂face/∂u = G + ∂relief/∂u`; `∂face/∂z = shoulder'(z) + ∂relief/∂z`;
`∂u_top/∂z = (rim'(z) − shoulder'(z)) / G` feeds the top fade's chain rule; world
derivatives via `∂u/∂x = 1`, `∂u/∂z = uDz`. Bit-identity outside the window by early
return — the `corridorD` idiom. Everything is polynomial plus `fbm2d`.

## 3. The trail graph (T1)

### 3.1 Two kinds of edge

> **SUPERSEDED 2026-09-09** (`docs/trail/2026-09-09-apron-and-ground-trail.md` §3.2): there
> is no ascent, spine or fork any more — the graph is a Dijkstra tree on a walkability grid,
> and an edge's kind (`trunk` / `branch`) falls out of how many landmark paths use it rather
> than being planned.

Two kinds of edge, distinguished by how they are PLANNED. **Both carve** (amended
2026-09-09 — the original claim that plateau edges carve nothing was wrong):

- **The ascent chain** — trailhead node → 2–4 switchback legs across the face → rim node.
  Planned against `ASCENT_AVG_SLOPE_MAX` / `ASCENT_PEAK_SLOPE_MAX`, with `Δu` floored at
  `ASCENT_DU_MIN` so two neighbouring legs' corridors can never overlap.
- **Plateau edges** — a spine inland from the rim node with seeded `z`-wobble, and four
  forks off it to the landmark endpoints. These are carved too. The plateau at 130–180 m
  lies inside the cliff band's altitude window (`CLIFF_ALT_LO/HI = 120/220`, `cliffs.ts`),
  so an uncarved straight edge crosses terrace risers and steep fbm ground: a walk survey
  measured slopes of 1.06–2.2 on **18 of 58** plateau edges, with arrival gaps up to
  88 m. Routing alone cannot fix an uncarved edge. Plateau edges keep the ascent's comfort
  target out of it and are planned against the hard ceiling alone.

**Two invariants bind EVERY carved edge** (amended 2026-09-09 — testing measured ~3% of
seeds shipping a bed the player cannot walk, because each of these had been enforced only
locally):

1. **The hard slope ceiling `TRAIL_HARD_SLOPE_MAX = 0.9`.** No search anywhere in the
   builder may take an edge above it while any candidate is under it — ascent legs, spine
   steps and *both halves* of every fork alike. `ASCENT_PEAK_SLOPE_MAX = 0.5` remains the
   ascent's comfort TARGET, not its ceiling. It replaces `PLATEAU_PEAK_SLOPE_MAX = 1.0`,
   whose 2 % margin under `MAX_WALKABLE_GRADIENT` was not enough for a bound the union
   perturbs; measured over-cap beds before the ceiling existed: 1.28 (seed 90), 1.16 (243),
   1.05 on a fork half-chord.
2. **The spacing invariant.** Two edges that do NOT share a node keep their centrelines at
   least `2 · TRAIL_CORRIDOR_HALF + TRAIL_EDGE_GAP = 12 m` apart. Two edges that DO share a
   node keep the same distance *outside a junction of radius `TRAIL_JUNCTION_R = 25 m`*:
   inside it they are meant to merge, outside it they are two trails. `ASCENT_DU_MIN` was
   this rule for two neighbouring switchbacks; it now holds for every pair. Measured before
   it did: seed 119's two fork edges 3 m apart, blending grade lines 45 m apart, for a bed
   gradient of **19.0**; seed 453's 66 m spine step and 120 m fork leaving one node and
   running 8 m apart for 55 m, for **4.90**.

   **A carved overlook's dome is a third party to this invariant** (amended 2026-09-09, per
   `docs/trail/2026-09-09-open-hillside-trail.md`): its centre keeps `OVERLOOK_DOME_RADIUS +
   TRAIL_CORRIDOR_HALF = 49 m` from every bed that is not its own fork's — derived from two
   declared tunables, not a new one. 12 m was sized for two beds; a dome reaches 45 m, so
   without this an edge sat legally inside a dome with nothing measuring it from either side
   (`domeBedPeak` looks only at the fork whose own endpoint carries the dome). Measured:
   seed 429557651's fork bed 26.2 m from another fork's dome (**1.032**) and seed 418336776's
   ASCENT chain 24.2 m from one (**1.051**) — and an unwalkable ascent seals the world.

Carrying every edge in the corridor stage is safe because the grade is an eased **chord**
(§3.3), not a terrain-following line: its slope is bounded by a number the builder chooses,
and it is FLAT at both nodes, so where several edges meet at a junction their grades agree
to second order and the union has nothing to reconcile. A B-spline of the ground along each
edge — the highway's mechanism — was tried and rejected: it faithfully reproduces
the terrain's own 20 m-scale slope, which is 1.2–2.0 on the wall face and at the trailhead
flat's rim, and its end condition put a 6.8 m step at the trailhead node.

### 3.2 Generation (deterministic, per seed, memoized)

All positions in the road frame; converted to world `x` through `roadCenterX(seed, z)`.

**Ascent.** Start at the trailhead node `(TRAILHEAD_U + TRAILHEAD_RADIUS, TRAIL_Z_ANCHOR)`
on the trailhead flat. Repeat: choose the leg's `Δz` in `±[ASCENT_LEG_DZ_MIN,
ASCENT_LEG_DZ_MAX]` (seeded, sign alternating); choose `Δu` so that the leg's average slope
`G·Δu / L ≤ ASCENT_AVG_SLOPE_MAX` where `L = sqrt(Δu² + Δz²)`; the node height is the
**post-wall** terrain height at the node. Stop when the node's `u ≥ u_top(z)` — the rim,
placed at `max(u_top + RIM_OVERSHOOT, WALL_RIM_U)` so it stands past the trough behind the
crest (§2.2) — or after `ASCENT_MAX_LEGS`. If a leg's eased peak slope (1.875 × average —
the quintic smootherstep's peak derivative S′(½), §3.3) would exceed
`ASCENT_PEAK_SLOPE_MAX`, halve `Δu` and continue, **but never below `ASCENT_DU_MIN`**.
That floor is load-bearing: it is `2 · TRAIL_CORRIDOR_HALF + TRAIL_EDGE_GAP`, so two
neighbouring legs always leave clear ground between their beds. Without it, the first leg
out of the trailhead pit (§2.2) halves four times, the switchbacks pack to a few metres, and
the union of two overlapping corridors blends grade lines tens of metres apart — measured at
slope 2.0 on seed 12345. Because the face is a plane of gradient `G`, a leg of `Δu = 25`
over `L ≈ 160` gains 40 m at slope 0.25: two to four legs for a 70–130 m face.

The leg is a **candidate search in three tiers** (amended 2026-09-09; the earlier "a leg
already at the floor is accepted over-cap, and such a leg peaks near 0.8" was measured false
— 1.28 on seed 90). Candidates run in priority order: the seeded `Δz` first, then
`ASCENT_DZ_TRIES` evenly spaced over the range, each with its own `Δu` ladder halving down
to the floor. Take the first candidate under the COMFORT target; failing that, the first
under `TRAIL_HARD_SLOPE_MAX`; failing that, the least-steep candidate seen. Taking the FIRST
one under the hard cap rather than the least-steep matters twice: the `Δu` ladder runs
longest-first, so it is the widest hairpin that is still walkable, and a wide hairpin is what
keeps the two legs' corridors from running alongside each other out of the turn.

Two further amendments to the leg:

- **The rim leg is slope-checked AFTER its clamp.** When a candidate's `u ≥ u_top(z)` the
  node is re-placed at `max(u_top + RIM_OVERSHOOT, WALL_RIM_U)` and the chord that is then
  measured is the chord that gets built; `reached` belongs to the CHOSEN candidate, so a leg
  that touched the rim and was rejected for slope does not end the ascent.
- **Direction is the last thing a leg gives up.** The switchback alternates `±z` as before,
  but if the seeded side offers NO candidate under the hard cap, the leg takes the other
  side and the alternation continues from the side actually taken. The face's shoulder
  spline climbs along `z`, so one side of a switchback can be a ramp and the other a wall:
  on seed 620 every `+z` candidate peaked at 0.01–0.18 and every `−z` one at 1.55–2.29, and
  the builder had no way to say so. The ascent is the only walkable column out of the bowl,
  so a leg that cannot be walked seals the world.

**Spine.** From the rim node, walk inland: nodes every `SPINE_STEP` in `u` with a seeded
`z` offset in `±SPINE_WOBBLE`, to `SPINE_U_END`. Each step runs a small **candidate search**
against `TRAIL_HARD_SLOPE_MAX` **and the spacing invariant**: step lengths generated by
halving `SPINE_STEP` `SPINE_STEP_HALVINGS` times and then flooring at `SPINE_STEP_MIN`,
crossed with lateral offsets `k · SPINE_SIDESTEP`, `k ∈ {0, ±1 … ±SPINE_SIDE_SPAN}`, in that
fixed order; the first candidate clearing BOTH wins. Failing that there are two fallback
tiers, because the two invariants fail differently: among candidates that clear the gap, the
least steep (a too-steep chord costs its own slope); only if nothing clears the gap, the
largest gap — the least-violating candidate (an overlap costs the blend of two grade lines,
which is unbounded). The order is
seed-independent (the seed enters only through the wobble), so the first candidate is
exactly the pre-search choice and any spine that already met the cap is bit-identical.
The sideways axis is the load-bearing one: shortening alone cannot help on a straight bank,
because a shorter step climbs the same gradient. Measured — halving-only left seed 1's 6→7
at peak 1.31 after four retries; with the sidestep search every spine edge on all three
surveyed seeds clears the cap.

**Forks.** Four, from four distinct spine nodes chosen with seeded spacing, alternating
`±z`, with a seeded bend node at mid-length so a fork is not a straight line. Each fork
carries a **designated landmark type** (§4); its length and endpoint are chosen together by
the fan scan of §4.3 (there is no separate seeded fork length — the scan takes the
best-scoring radius over `FORK_LEN_MIN`–`FORK_LEN_MAX`). Every node must satisfy
`BOWL_U_MIN < u < BOWL_U_MAX`, `|z| < BOWL_Z_HALF`; a fork that would leave the bowl is
shortened.

| tunable | value |
| --- | --- |
| `TRAILHEAD_U`, `TRAILHEAD_RADIUS`, `TRAILHEAD_FADE` | 44, 8, 6 |
| `ASCENT_LEG_DZ_MIN`, `ASCENT_LEG_DZ_MAX` | 113 (amended 2026-09-09 from 120), 180 |
| `ASCENT_AVG_SLOPE_MAX`, `ASCENT_PEAK_SLOPE_MAX` | 0.25, 0.5 |
| `ASCENT_MAX_LEGS`, `ASCENT_DZ_TRIES` | 8 (amended 2026-09-09 from 6), 5 |
| `ASCENT_DU_MIN` | 12 |
| `TRAIL_HARD_SLOPE_MAX` | 0.9 |
| `TRAIL_EDGE_GAP`, `TRAIL_JUNCTION_R` | 4, 25 |
| `SPINE_SIDESTEP` | 20 |
| `SPINE_STEP`, `SPINE_WOBBLE`, `SPINE_U_END` | 80, 40, 700 |
| `SPINE_STEP_MIN`, `SPINE_STEP_HALVINGS`, `SPINE_SIDE_SPAN` | 10, 2, 3 |
| `FORK_COUNT`, `FORK_LEN_MIN`, `FORK_LEN_MAX` | 4, 200, 450 |
| `TRAIL_BED_HALF`, `TRAIL_CORRIDOR_HALF` | 1, 4 |
| `TRAIL_CLEAR` | 6 (amended 2026-09-09 from 3) |
| `BOWL_MARGIN`, `LEG_RETRIES` | 20, 4 (`RIM_OVERSHOOT` dropped 2026-09-09 with the wall) |
| `TRAIL_SALT` | new salt |

Every number in that table is a declared tunable folded into the level id. Nothing that
steers the graph is a module-private constant: the graph decides the carved elevation field,
so a constant that moves it without moving `registryDigest` is how two peers on differing
builds end up on different ground (amended 2026-09-09 — `BOWL_MARGIN`, `RIM_OVERSHOOT`,
`LEG_RETRIES`, `SPINE_STEP_MIN` and the spine ladders' shapes were all private before).

### 3.3 The corridor stage — the validated construction

A new stage `trailCorridorD`, **after `wallD` and before the road's `corridorD`**, over
EVERY edge of the graph (amended 2026-09-09; it was the ascent chain only). Each
edge is first rejected by an XZ bounding-box test grown by `TRAIL_CORRIDOR_HALF` — a cost
cut, not a behaviour change, since a rejected edge has `w_i = 0`. For point `p` and each
surviving edge `i` from `a` to `b`, with `e = b − a`:

```
τ_i   = ((p − a)·e) / |e|²                     projection parameter, linear in p
t_i   = clamp(τ_i, 0, 1)                        for the DISTANCE only
d_i   = |p − (a + t_i e)|                       distance to the segment
w_i   = 1 − smootherstep(TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, d_i)
g_i   = h_a + (h_b − h_a) · smootherstep(0, 1, τ_i)   the leg's grade, eased

w     = 1 − Π_i (1 − w_i)                       union of corridors
g     = Σ_i w_i g_i / Σ_i w_i                   weighted grade
h'    = (1 − w) · h + w · g
```

If `Σ_i w_i = 0` (outside every corridor — exact, since `smootherstep` saturates) the
input sample is returned **as the same object**: bit-identity.

Why each piece is shaped as it is:

- **The union `1 − Π(1 − w_i)`** rather than `max`: a product of C¹ functions is C¹; a max
  has a kink wherever two corridors tie, and the derivative harness would find it.
- **The eased grade** `smootherstep(0, 1, τ)` rather than a linear ramp with a clamped `t`:
  a clamp makes the grade C⁰ at each leg's ends. Easing makes it C² in `τ`, which is linear
  in `p`, so `g_i` is smooth everywhere. It also flattens every hairpin and puts the leg's
  steepest point (1.875 × its average — the quintic's peak derivative S′(½)) mid-leg —
  which is what a real switchback does.
- **The distance derivative.** For interior `t`, `p − q` is perpendicular to `e`, so `∇d_i
  = (p − q)/d_i` exactly; for clamped `t` the same expression holds with `q` at the
  endpoint. `∇d_i` is never needed where `d_i < TRAIL_BED_HALF` — `w_i` is flat there — so
  `d_i → 0` is not a singularity in `h'`.
- **The weighted grade** is well-defined wherever `Σw_i > 0`, and as every `w_i → 0`,
  `w·g → Σ w_i g_i`, so the composite is C¹ through the corridor's outer edge.

Exact derivatives by the product rule for `Π`, the quotient rule for `g`, and the chain
rule through `∇τ_i = e/|e|²`, `∇d_i` above, and the smootherstep derivatives. Nothing but
`sqrt`, `min`, `max`, multiplication and division. **The spike in §1 is this construction
verbatim on the real field.**

Node heights are the post-wall terrain's own, so the trail touches ground at every turn;
between turns the eased grade cuts or fills a few metres. On a face of gradient 1.6 the
corridor's 3 m blend zone carries ~5 m of height, so the uphill side is a cut bank and the
downhill side a fill slope — which is what a switchback on a steep face looks like.

### 3.4 Trees

`treeInCell` computes each tree's jittered position. A new check rejects the instance if
`variant.trailDistance(seed, x_tree, z_tree) < TRAIL_CLEAR`. Per tree, not per cell: the
10 m cell cannot resolve a 2 m path. The road's 12 m density gate is left as is — the road
is 11 m wide and the gate is right for it.

`TRAIL_CLEAR` is **6, not 3** (amended 2026-09-09, per
`docs/trail/2026-09-09-open-hillside-trail.md`): 2 m past `TRAIL_CORRIDOR_HALF = 4`, so no
trunk stands on the cut bank or the lip. At 3 it sat INSIDE the corridor, which was harmless
while the corridor was a blend and became visible once the open-hillside bench cut
(`docs/trail/2026-09-09-open-hillside-trail.md` §2.3) made its edge a real bank:
`groundedProps.test.ts` measured 7.28 m of daylight under a giant's root plate whose trunk
stood 4.16 m from a corridor centreline — the corridor had cut the ground out from under the
plate. Trees keep off the bank by construction rather than by a wider daylight ceiling on the
props test.

### 3.5 Ownership and hooks

A new `sim/trail.ts` owns the graph: `trailGraph(seed)` (nodes, edges tagged ascent /
spine / fork, the four landmarks with their types and endpoints, the trailhead node),
`trailDistance(seed, x, z)` (plain minimum over all edges — C⁰ is fine, no height depends
on it), and `nearestTrailNode(seed, x, z)`. Memoized per seed, pure, no RNG stream — `hash3`
and `fbm2d` from `field.ts` only.

`TerrainVariant` gains two optional hooks beside `roadDistance` and `roadCenterX`:
`trailDistance` and `trailGraph`. The terrain stages, the tree rejection, and later the
leash (sub-project F) and the Hollow (sub-project C) read the same graph.

## 4. The landmarks (L3)

### 4.1 Four fixed types

Every run has exactly these, one per fork: **the old stand, the clearing, the talus, the
overlook.** Treeline and overlook merge — the overlook is the highest point in its fork's
fan, and in the seeds where the plateau reaches 200 m it is above the treeline without
anyone deciding so. Creek and tarn are dropped: nothing in `sim/` makes water above sea
level, and adding it is not this sub-project.

### 4.2 Predicates

| type | found when | carved as |
| --- | --- | --- |
| old stand | `forestDensity ≥ 0.9` over most of a 30 m disc | density × `STAND_BOOST` and an older cohort inside the disc |
| clearing | `forestDensity ≤ 0.1` and `h > 60` over most of a 30 m disc | density × 0 inside the disc |
| talus | boulder `clutterDensity ≥ 0.5` over most of a 30 m disc — a disc centred a `LANDMARK_DISC_RADIUS` from the trail's endpoint, on whichever of the eight compass sides scores best (amended 2026-09-09, per `docs/trail/2026-09-09-apron-and-ground-trail.md`: the predicate needs ground steeper than the walkability grid will route over, so the trail ends at the FOOT of the field and the field is beside it) | boulder density × `TALUS_BOOST` inside the disc, centred on the endpoint |
| overlook | the highest point of the fan is ≥ `OVERLOOK_RISE` above the fork's spine node | a dome of radius `OVERLOOK_DOME_RADIUS`, height `OVERLOOK_DOME_HEIGHT`, raised at **the highest DOME-SAFE candidate in the fan** — the highest whose own fork bed stays under `TRAIL_HARD_SLOPE_MAX` with the dome on it (`domeBedPeak`), and where none does, the least-violating one on the ranking's own order, cap → gap → dome → chord. Walkability outranks height (amended 2026-09-09; it read "the fan's highest point", which put a 0.75-gradient dome on whatever chord the height happened to want) |

"Over most of" is a fraction of sampled points inside the disc, `LANDMARK_FILL ≥ 0.7`.
Predicates are evaluated outside the trail corridor — the fork carves a walkable, boulder-free
bed through its own landmark.

### 4.3 Placement

> **SUPERSEDED 2026-09-09** (`docs/trail/2026-09-09-apron-and-ground-trail.md` §4): the fork
> fan, the retreat, the centroid clamp and the dome-spacing rule (`DOME_BED_CLEAR`,
> `domeBedPeak`) are all gone — a landmark is now chosen among the grid cells the trail can
> actually reach, so reachability, containment and walkability are properties of the
> candidate rather than repairs applied to it. §4.1–4.2's four types and their predicates
> still stand.

For each fork: the **fan** is a RAY FAN, not a grid (amended 2026-09-09 — the earlier "sample
it on a 25 m grid" never described the code). `FORK_FAN_RAYS` rays leave the fork's spine
node on the fork's designated side, leaning `−FORK_FAN_LEAN … +FORK_FAN_LEAN` in `u` per unit
of side distance — a direction-cosine bound (`1/sqrt(1 + lean²) ≈ 0.894` at 0.5), because
`sim/` has no trig — and each is sampled at radii `FORK_LEN_MIN`–`FORK_LEN_MAX` in `FAN_STEP`
increments. Candidates are clipped to the bowl with a `LANDMARK_BOWL_MARGIN` inset, so every
footprint stays inside the `inBowl` gate. Score every surviving candidate by the predicate's
strength and take the best that clears the threshold. **If none does, carve.**

A candidate is rejected **before** scoring unless it clears §3.1's two invariants on BOTH of
the fork's half-edges — spine → bend and bend → end — measured as `1.875 · |Δh| / L_half ≤
TRAIL_HARD_SLOPE_MAX` and as the spacing invariant against every edge already in the graph
(the ascent, the spine, and every EARLIER fork, since forks are placed in order). A fork edge
carves, so the player walks its chords, and a perfect talus up a cliff is not a place a trail
can go. Failing that there are the same two fallback tiers the spine has: among candidates
that clear the gap, the least steep; only if nothing clears the gap, the largest gap.

Both halves, not the fork end to end (amended 2026-09-09): the bend node sits at the
**midpoint of the two heights** — it is a carved node, the corridor imposes its height — but
at a *jittered* midpoint in plan, so the halves split the rise evenly and the plan length
unevenly. The earlier claim that the end-to-end cap "also bounds each half" was measurably
false: the worst fork half over 500 seeds ran 1.018 against a 1.0 cap, and one real seed put
a 1.05 bed on a fork.

**A carved overlook's endpoint is checked against every OTHER bed as well** (amended
2026-09-09, per `docs/trail/2026-09-09-open-hillside-trail.md`): a candidate that would carve
keeps its dome centre `OVERLOOK_DOME_RADIUS + TRAIL_CORRIDOR_HALF` from every edge already in
the graph (its own two halves excepted — `domeBedPeak` is their check), and every fork
candidate's two halves keep the same distance from every EARLIER carved overlook's dome. Both
ride the GAP band of the placement's ranking, because both are spacing violations; see §3.1.

**The carved endpoint is checked too** (amended 2026-09-09 — the earlier exemption, "a carve
has to land somewhere and the centroid is a fixed point of the fan rather than a choice", was
what let seeds 28 and 443 lay two carved forks' beds 0.7 m and 0.0 m apart, and seed 308
stack four carved edges into one bundle for a bed gradient of 9.66). A carved endpoint that
fails either invariant RETREATS along its own ray in `FAN_STEP` steps down to `FORK_LEN_MIN`
until both hold — the ascent's "shorten until it is walkable" move — and, failing that, takes
the fan's least-violating candidate.

Scoring excludes the strip the fork will carve — the bend node is a pure function of the
endpoints, the fork index and the seed, so the disc is measured exactly as the finished world
will show it.

**A carved overlook's endpoint is held to a fourth invariant** (amended 2026-09-09, per
`docs/trail/2026-09-09-open-hillside-trail.md`): the bed its own dome will sit on must stay
walkable. The dome is composed after `trailCorridorD` and centred exactly on the endpoint
node, so on the bed — where the corridor's coverage weight is 1 and the composed height is
the eased chord exactly — the dome's gradient ADDS to the chord's, near-radially, and the
dome's own peak (`1.875 · OVERLOOK_DOME_HEIGHT / OVERLOOK_DOME_RADIUS = 0.75`) is already
three quarters of `MAX_WALKABLE_GRADIENT`. `domeBedPeak` samples both half-chords every
`TRAIL_CHORD_STEP` and takes the magnitude of the summed gradient wherever a sample is inside
the dome; the carved overlook then takes the HIGHEST fan candidate that keeps it under
`TRAIL_HARD_SLOPE_MAX`, and where none does, the least-violating on the ranking's own dome
band (cap → gap → dome → chord). Measured before this existed, on 219 surveyed seeds: 7 of
the 8 steepest beds in the whole set were fork half-chords 22.5 m from a carved overlook's
centre — the dome's own steepest ring — and two of them were over the walkable cap on chords
that cleared every other invariant outright.

**A fork whose fan is entirely outside the bowl takes the other side** (amended 2026-09-09) —
the ascent's own "the direction is the last thing the leg gives up" move. A spine node
within `FORK_LEN_MIN / sqrt(1 + FORK_FAN_LEAN²)` ≈ 179 m of the bowl's z-margin puts every ray at
every radius outside `insideBowlWorld`, and the fork then falls through to the centroid, which
points the same way and is dragged back by `clampIntoMargin` into a stub a few tens of metres long
(96 of 876 surveyed forks, 11.0%). The z-margin band is 1100 m wide against a 450 m reach, so the
other side always has room where this one does not; the fork takes its dealt side
(`graph.forks[f].nominalSide`, strictly alternating) unless that side's whole fan falls outside the
bowl's landmark margin, in which case it takes the other and records the placed side in
`graph.forks[f].side` — any consumer that wants to know where the fork actually went reads `side`.

Carving is expressed as **masks**, not as edits: a `landmarkMask(seed, x, z)` hook returns
per-point multipliers for tree density and boulder density (smootherstep-edged discs), and
the overlook dome is a terrain stage `landmarkD` (a smootherstep dome, exact derivatives)
composed **after `trailCorridorD`**. The stand's older cohort is a per-instance age bias
read the same way the density multiplier is.

Multipliers alone cannot create presence where the raw gate is a hard zero — seeds 12345 and
777 carve talus on ground flatter than `CLUTTER_BOULDER_SLOPE_LO`, where `TALUS_BOOST × 0 =
0` — so a carved stand or talus also carries a **floor** (`STAND_CARVED_DENSITY`,
`TALUS_CARVED_DENSITY`, scaled by the disc weight) and consumers apply `min(1, max(raw ·
mult, floor))`. Floors fire only for carved landmarks, whose discs lie at least
`LANDMARK_BOWL_MARGIN` inside the bowl **by construction**: a carved point (the fan's
centroid, or the highest fan point for an unfound overlook) is clamped into the margin box
before it becomes the endpoint, rather than merely being one of the fan candidates that
happened to pass the margin check during scoring — a fan-edge fork could otherwise carve
outside the margin, or outside the bowl entirely, for a seed the fan scan never visited.

| tunable | value |
| --- | --- |
| `FORK_FAN_RAYS`, `FORK_FAN_LEAN` (a direction-cosine bound, no trig) | 9 (amended 2026-09-09 from 5), 0.5 |
| `FAN_STEP`, `LANDMARK_SCAN_STEP` | 20 (amended 2026-09-09 from 25), 10 |
| `FORK_BEND_JITTER` | 60 |
| `LANDMARK_DISC_RADIUS`, `LANDMARK_DISC_FADE` | 30, 10 |
| `LANDMARK_FILL` | 0.7 |
| `STAND_TREE_MIN`, `CLEARING_TREE_MAX`, `CLEARING_H_MIN`, `TALUS_BOULDER_MIN` | 0.9, 0.1, 60, 0.5 |
| `STAND_BOOST`, `TALUS_BOOST` | 1.5, 3.0 |
| `STAND_CARVED_DENSITY`, `TALUS_CARVED_DENSITY` | 0.95, 0.8 |
| `LANDMARK_BOWL_MARGIN` | 50 |
| `OVERLOOK_RISE` | 25 |
| `OVERLOOK_DOME_RADIUS`, `OVERLOOK_DOME_HEIGHT` | 45, 18 |

As in §3.2, every number here is a declared tunable: the fan's shape, the disc scan step, the
bend jitter and the three predicates' thresholds were all module-private constants that moved
the landmarks — hence the carved field — without moving the level id (amended 2026-09-09).
`FORK_FAN_COS` is gone: it was declared, folded into the level id, and never read.

The dome's maximum gradient is `≈ 1.9 · height / radius ≈ 0.76` — walkable, so the overlook
is a place you can stand on, not a wall. Steepening one side into a real drop is flavour
for a later pass; the register only needs the overlook to exist.

## 5. The trailhead and spawn

A **flattening disc** at `(TRAILHEAD_U, TRAIL_Z_ANCHOR)`, radius `TRAILHEAD_RADIUS`, fade
`TRAILHEAD_FADE`, at the height of the road shoulder there (the pre-wall base at `u =
WALL_U_LO`, which is where `corridorD`'s blend returns to the base). `TRAILHEAD_U = 44` is
the smallest value that keeps the disc's full fade ring (14 m) inside the gate at
`WALL_U_LO = 30`, which is what makes the flat meet the shoulder with no kink. It is composed as
part of `wallD`'s bottom edge: inside the disc the wall's lower fade is suppressed so the
flat meets the corridor shoulder with no kink, and the ascent's first node sits on the
disc's inland edge at the disc's height.

**Spawn.** `spiralSpawn` is re-centred on the trailhead node instead of the origin — it
hardcodes `(0.5, 0.5)` today and nothing else in `sim/` assumes the origin (the road
lattice is per-`z`, the clipmap follows the camera). `SPAWN_FREEBOARD = 2` is satisfied:
the shoulder is 15–21 m above sea level in every probed seed.

**Props.** A small **trailhead pass** emits collider boxes for the car, the register post
and the trailhead sign at fixed offsets on the flat, the way the forest passes emit theirs.
For this sub-project they render as boxes; real assets and the register's UI are later
sub-projects.

## 6. Renderer — trail paint

In scope because a trail you cannot see is not a trail. The road paints from a 1-D
centreline table because its centreline is a function of `z`; a graph is not. Instead
`game/trailPaint.ts` (new, pure, Babylon-free) uploads the graph's segments as a uniform
array — `vec4(ax, az, bx, bz)` per segment, capped at `TRAIL_PAINT_MAX_SEGMENTS = 64`;
the ascent, spine and forks total ~25 — and the fragment shader computes the corridor
weight per pixel with the same `smootherstep` over distance-to-segment, painting a dirt
band over the forest floor with a soft edge. The TypeScript mirror of the arithmetic sits
beside the GLSL string so tests pin the band — the `roadPaint.ts` / `groundConformPlugin.ts`
idiom — which is also what keeps the trap below in view.

> **A GLSL comment containing `#ifdef` is parsed as a real preprocessor directive and
> silently deletes code.** Twice in this repo. No hashed keyword in any comment inside a
> shader string.

Paint bed half-width mirrors `TRAIL_BED_HALF`; the soft edge widens to the fragment
derivative so it does not alias at range, as the road's does. Renderer-only: nothing here
is a tunable.

## 7. Determinism, the level id, and tests

**Determinism.** Every new function is polynomial plus `sqrt`, `fbm2d` and `hash3`. No
trig, no `Math.pow`, no `**`, no `Math.hypot` — `architecture.test.ts` enforces this. The
graph is memoized per seed like `LATTICE_CACHE`; the query-order test idiom applies.

**The level id moves.** Every constant in the tables above is declared in the olympic
variant's `tunables`, and tunables fold into `levelId` by design. This is correct — it is a
new world — and `forest.test.ts` pins only stability and difference, not a literal hash.

**Tests, with their precedent where one exists:**

| test | what it pins | precedent |
| --- | --- | --- |
| corridor identity excludes the bowl | `"outside the corridor is exactly the cliff stage"` learns a bowl-window exclusion; counts re-measured and commented | the cliff test's corridor exclusion |
| derivatives through the new stages | a dense local sweep over the wall window and EVERY trail corridor (amended 2026-09-09: it was the ascent chain) at `TOL_RATIO` — the spike, kept | `checkDerivatives`, `helpers/derivatives.ts` |
| the wall sweep | every column where the wall is at full strength (`|z| ≤ WALL_Z_HALF − WALL_Z_FADE`) carries a CONTIGUOUS unwalkable run of ≥ 20 m across the face, on three seeds — the barrier's width, not merely its existence (amended 2026-09-09; it broke at the first unwalkable sample, which a one-sample riser would have satisfied) | the escarpment probe |
| **the bed scan** | the composed field's gradient along the CENTRELINE of every edge of every graph, at ≤ 1 m steps, over 200 hashed lobby seeds plus the seeds already probed and checked, never exceeds `MAX_WALKABLE_GRADIENT`; and no graph outgrows `TRAIL_PAINT_MAX_SEGMENTS` (added 2026-09-09 — a check this work had been missing, and the only test on it that measures the union rather than restating the builder) | new |
| carved landmarks on real terrain | a carved overlook raises a real dome and its fork's bed stays walkable through it; a carved stand puts real trees on the composed field (added 2026-09-09 — 47 % of seeds carve the overlook and it had only synthetic coverage) | new |
| the walk | an agent traverses every edge of the graph with slope along the path ≤ the walkable limit | `groundWalk.test.ts` |
| graph determinism | same seed → same graph (hash), different seeds differ; query-order independence | `forest.test.ts`, the lattice memo test |
| graph invariants | every ascent leg under `ASCENT_PEAK_SLOPE_MAX`; EVERY edge under `TRAIL_HARD_SLOPE_MAX`; every non-adjacent pair of edges at least `TRAIL_EDGE_MIN_GAP` apart; every node inside the bowl; forks on distinct spine nodes, alternating sides | new |
| the tunables records | `TRAIL_TUNABLES` and `LANDMARK_TUNABLES` are EXHAUSTIVE — every key asserted and the key count pinned, so a new module-private constant cannot steer the graph past the level id | `bowl.test.ts` |
| trees off the trail | no tree instance within `TRAIL_CLEAR` of any edge, every edge, several seeds | new |
| landmarks | each fork's predicate holds at its endpoint after placement, whether found or carved, across the five probe seeds and more | new |
| spawn | `spiralSpawn` lands on the trailhead flat, above `SPAWN_FREEBOARD` | `spawn.test.ts` |
| trail paint mirror | TS and GLSL agree on the band | `roadPaint.test.ts` |

## 8. What already exists to build on

| need | what is there |
| --- | --- |
| the frame | `olympicSample`'s `u`, `uDz`; `roadCenterX`, `roadDistance` hooks |
| the two rim/shoulder splines | `gradeSplineD` and the `latticeHFor` memo idiom in `road.ts` / `olympic.ts` |
| bit-identity and exact derivatives | the `corridorD` early-return idiom; `checkDerivatives` |
| smooth blends | `smootherstep` with derivative, already in `olympic.ts` and `road.ts` |
| noise | `fbm2d`, `hash3` in `field.ts` |
| tree placement to hook | `treeInCell` in `vegetation.ts`; the `roadDistance` gate pattern |
| boulder density to hook | `clutterDensity(seed, CLUTTER_BOULDER, …)` in `clutter.ts` |
| spawn | `spiralSpawn`, `groundSpawn` in `spawn.ts` |
| collider emission | the pass registry in `forest.ts` / `passes/` |
| paint idiom | `roadPaint.ts`, `groundConformPlugin.ts` |
| walkability | `MAX_WALKABLE_GRADIENT`, `groundWalk.test.ts` |

## 9. Not in this sub-project

The leash scalar and its escalation (F). The Hollow and its navigation (C) — the graph
exposes `nearestTrailNode` for it. The register's state, items and UI (B). Real props,
fork-sign text, the cutscene. Water of any kind. Steepening the overlook into a drop.
Everything here exposes a hook for those and builds none of them.
