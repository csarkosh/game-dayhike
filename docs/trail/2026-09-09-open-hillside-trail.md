# Open hillside and bench-cut trail — design

**Date:** 2026-09-09 · **Supersedes** §2.2 (the wall), §3.3's symmetric corridor and §6's paint of
`docs/trail/2026-09-08-trailhead-and-trail-graph.md`. Everything in that spec not named here stands.
**Parent:** `docs/gameplay/2026-09-08-register-and-hollow.md` (amended: containment, see §8).

## 1. Why

Sub-project A shipped a one-way cliff wall between the highway and the forest with a switchback
trail cut into it. Played, the climb looks wrong: a smooth uniform 58° face with a trail floating on
an embankment, and the trail itself is hard to tell from the ground around it. The decisions on
2026-09-09:

1. **Remove the wall face entirely.** The road and the forest connect over the ground the base
   terrain already has. The rock terraces (`cliffs.ts`, altitude 120–220 m) stay.
2. **Nothing physical keeps the player in.** A later game-layer piece puts an invisible wall at the
   road edge with a line of dialogue ("I need to find those missing hikers first"). Out of scope
   here; the sim already exposes the signed road offset `u` it will need.
3. **The trail is flush with the ground: a bench cut.** Against the uphill face the bed is cut in;
   on the downhill side the bed's edge is open and drops to the natural ground. No fill embankment.
   On a switchback the uphill side swaps with the leg.
4. **The trail is a distinct dirt-and-gravel ribbon with no grass on it.**

Measured on the pre-wall field (3 seeds, `u ∈ [30, 200]`, `|z| ≤ 340`): the ground climbs from the
road (14–23 m) to the plateau (100–190 m) on its own, average grade 0.6–0.9, with 2–21 % of samples
above the walkable limit (terraces). So the switchback machinery stays: a single path cannot hold
the limit on that grade.

## 2. The terrain field

### 2.1 Stage order (`olympicSample`)

base → cliffs → dunes → **[inBowl: trailhead pad → trail corridor (bench) → landmark dome]** → road
corridor. The wall stage is gone. `inBowl(u, z)` and `BOWL_U_MIN/MAX`, `BOWL_Z_HALF`,
`TRAIL_Z_ANCHOR` stay as the region gate; "bowl" remains the name of the region the trail graph
and landmarks own, and the doc comment on it says it no longer has a wall.

The pre-graph sampler (what the builder and placement read for heights) is
**`olympicPreTrailSample`** = base → cliffs → dunes → pad. `olympicWallSample`, `wallTopAt`,
`wallSplinesFor` and the wall spline cache are deleted.

### 2.2 The trailhead pad

A flat disc for the car and the sign, centred at road-frame `(TRAILHEAD_U = 44, TRAIL_Z_ANCHOR)`,
radius `TRAILHEAD_RADIUS = 8`, fade `TRAILHEAD_FADE = 6` — the same disc the wall stage carried,
now its own stage `padD(u, uDz, z, padH, base)` in `bowl.ts`. The pad height `padH` is the pre-pad
field's height at the disc centre, memoised per seed (`padHeightFor(seed)`, the road-lattice idiom).
Inside the radius the sample is `{h: padH, dx: 0, dz: 0}`; across the fade it blends with
`smootherstepD` on the disc distance, derivatives exact; outside `RADIUS + FADE` it returns `base`
by reference. The trail's first node sits at the disc centre, so node 0's height is `padH`.

### 2.3 The bench-cut corridor

> **Superseded 2026-09-09** (see `docs/trail/2026-09-09-apron-and-ground-trail.md` §3.3): the bench
> cut, its lip, its adaptive coverage radius and the two-weight split are retired with the eased
> chord that made them necessary — the bed is the ground's own smoothed profile now, laid by ONE
> symmetric weight.

`trailCorridorD` keeps its union construction but now carries **two weights per edge**, not one —
COVERAGE and GRADE — because a single adaptive weight turned out to contaminate the grade mix
between overlapping edges (explained below).

**The bed line sits `TRAIL_BENCH_DEPTH` below the chord.** `g_i = h_a + (h_b − h_a)·S(τ) −
TRAIL_BENCH_DEPTH`. A constant offset: the chord's slope, every cap and every spacing invariant
are unchanged, but shallow dips between nodes become cuts instead of raised stretches. Default
`0.5` m; the visual check (§7) may move it.

**Coverage: where the field blends from `base` into the trail at all.** Let `c_i = base.h − g_i` at
the query point: positive where the ground is above the bed (cut side), negative where it is below
(fill side). The coverage weight's outer radius adapts to that depth:

```
R_i = TRAIL_BED_HALF + TRAIL_LIP + (TRAIL_CORRIDOR_HALF − TRAIL_BED_HALF − TRAIL_LIP) · S(0, TRAIL_FADE_MORPH, c_i)
wc_i = 1 − S(TRAIL_BED_HALF, R_i, d_i)
```

so on the cut side the bank spans the full `TRAIL_CORRIDOR_HALF = 4` m as today, and on the fill
side the bed's edge drops to the natural ground across `TRAIL_LIP = 0.75` m. `S` is the module's
`smootherstepD`; `R_i` morphs smoothly over the first `TRAIL_FADE_MORPH = 1` m of cut depth, so the
surface stays C¹ where cut becomes fill. `wc_i` (with its exact derivative, including the `∂R_i`
term) drives `prod = Π(1 − wc_i)` and the outer blend `h = (1 − w)·base + w·g`, `w = 1 − prod` — it
answers WHERE the trail is present, and it is where the bench cut is allowed to react to the real
ground's own gradient. The early return (`prod === 1` ⇒ `base` by reference, bit-identity) is on
coverage.

**Grade: how two overlapping edges' chords are mixed where both are present.** This weight uses the
FIXED, pre-bench-cut radius — no dependence on cut depth at all:

```
wg_i = 1 − S(TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, d_i)
g = Σ wg_i g_i / Σ wg_i
```

`wg_i` drives only the grade mix `g`, never coverage. It must stay independent of `c_i`: on edge
A's own flat bed (`wc_A = 1`, `d_A = 0`), the mix has `∂g_A ⊃ Σ_{B≠A} ∂wg_B·(g_B − g_A)/(Σwg)` by
the quotient rule, so any neighbour B's weight RATE — however small `wg_B` itself is — reaches
straight into A's own bed gradient through the (small but nonzero, unavoidable a few metres from a
shared node) gap between the two chords. An earlier version of this design let the SAME adaptive
`R_i` drive both weights; then `∂wg_B` carried `∂R_B ∝ (∂base − ∂g_B)`, i.e. the real ground's own
gradient, unbounded — so on real terrain (unlike the 219-seed check set) a third edge's `R` rising
through rugged ground near a junction could push a completely different edge's own bed gradient
over `MAX_WALKABLE_GRADIENT`, confirmed on the 300 held-out lobby seeds `room-200`–`room-499`
(`room-484`'s ascent edge 0→1, gradient over cap with the adaptive grade weight, clean at `TRAIL_FADE_MORPH = 1`
once grade uses the fixed radius). Raising `TRAIL_FADE_MORPH` only divides the contamination by a
constant; it cannot remove it, because the source is the mixing weight's domain, not its scale.
Splitting the two weights removes it structurally: `wg_i`'s fixed-radius domain is a superset of
`wc_i`'s adaptive one (`R_i ≤ TRAIL_CORRIDOR_HALF` always), so `wc_i > 0 ⇒ wg_i > 0` — coverage never
outruns the mix it needs — and an edge with `wg_i > 0` but `wc_i = 0` still enters the grade mix
exactly as it did before this change, with no adaptive term anywhere in it. No trig, no `pow`, no
`hypot` in either weight. Outside every corridor's coverage the sample is `base` by reference
(bit-identity).

**What it looks like.** Uphill: the bed is cut into the face and a bank of slope `c/3` rises to the
ground — flush with the mountain. Downhill: the bed's outer metre is the last graded ground; the
lip falls to the natural slope, which is the exposed side. A hairpin's two legs face opposite
ways, so each has its own cut side; where they are closer than the corridor width the union blends
them as today.

**Fill still exists** wherever the chord runs above the ground by more than the bench depth: the
bed there is a shelf whose lip drops the fill depth. Fill depth was measured along every bed over
219 seeds and reported as p50/p95/max, plus the lip's own steepness at
`TRAIL_BED_HALF + TRAIL_LIP` off centreline on the downhill side; the visual check decides whether
`TRAIL_BENCH_DEPTH` moves. Superseded by the chord-defined fill described in §3a (2026-09-09): the
fill-depth p95 is asserted below `TRAIL_FILL_MAX + TRAIL_BENCH_DEPTH + 1 = 3.5 m` and the max below
30 m, both regression detectors on the chord predicate's own tail, not the predicate's own cap; the
lip gradient is measurement only, no assertion (the walkability check already covers it directly).

### 2.4 Tunables

`BOWL_TUNABLES` loses every `WALL_*` key and keeps `BOWL_U_MIN`, `BOWL_U_MAX`, `BOWL_Z_HALF`,
`TRAIL_Z_ANCHOR`, `TRAILHEAD_U`, `TRAILHEAD_RADIUS`, `TRAILHEAD_FADE`. `TRAIL_TUNABLES` gains
`TRAIL_BENCH_DEPTH 0.5`, `TRAIL_LIP 0.75`, `TRAIL_FADE_MORPH 1` (§2.3: the spec's original value —
an earlier version briefly raised it to `1.5` to paper over the grade-mix contamination described
above; splitting coverage from grade removed the contamination at its source, so the morph constant
itself no longer needs to move), `ASCENT_FACE_GRADIENT 0.8`,
`ASCENT_END_U 160`, and loses `RIM_OVERSHOOT`. The level id moves; the pinned `passHash` and census
literals in `groundGradient.test.ts` are re-pinned with the dated `from <old>` convention.

This also adds `TRAIL_CHORD_STEP 5`, `TRAIL_FILL_MAX 2`, `TRAIL_CUT_MAX 8` (31 → 34) for the chord
fill/cut predicate (§3a). It also moves four EXISTING tunables, all of them swept against the
walkability scan rather than reasoned:

| tunable | was | now | why |
| --- | --- | --- | --- |
| `ASCENT_LEG_DZ_MIN` | 120 | **113** | the chord predicate rejects the wider, taller-rise candidates the ascent's old sizing preferred (an eased chord's own `0.1465·Δh` overshoot caps a single edge's rise at ≈ 13.7 m), so the ascent takes more, shorter legs. 113 is the largest of the only two values in [90, 120] with zero defects across the check set, both holdouts and the sequential scan |
| `ASCENT_MAX_LEGS` | 6 | **8** | the same overshoot: more legs to cover the same rise |
| `FORK_FAN_RAYS`, `FAN_STEP` | 5, 25 | **9, 20** | with `domeBedPeak` added to the fork's predicate the old 5 × 25 fan often has no candidate clearing all four invariants. Worth 4 → 2 defects on 500 seeds held back from the tuning, at 1.89× the cold `bowlFor` build |
| `TRAIL_CLEAR` | 3 | **6** | 2 m past `TRAIL_CORRIDOR_HALF`, so no trunk stands on the bench cut's bank (parent spec §3.4) |

The level id moves on all of them; `passHash` and the tree census in `groundGradient.test.ts` are
re-pinned with the dated `from <old>` convention, and `groundedProps.test.ts`'s three root-plate
ceilings return to their earlier values once the trees are off the bank.

## 3. The trail builder

`TrailFrame` becomes `{ roadCenterX, heightAt }` — `wallTopU` is gone. Changes to
`buildTrailGraph`:

- **Step ratio.** `duPerDz = ASCENT_AVG_SLOPE_MAX / sqrt(G² − ASCENT_AVG_SLOPE_MAX²)` with
  `G = ASCENT_FACE_GRADIENT = 0.8` (a nominal hillside, the measured average) instead of
  `WALL_GRADIENT`. It is only the first guess; the retry ladder (halving `Δu` to `ASCENT_DU_MIN`,
  the `Δz` tries, the side flip) measures every candidate on the real ground exactly as today.
- **Where the ascent ends.** A candidate whose `u ≥ ASCENT_END_U − ASCENT_DU_MIN` is the rim leg:
  its node is placed at `u = ASCENT_END_U` (extended, never shortened, so the rim leg keeps the
  `Δu` floor) — the clamp happens in `legCandidate` before the slope is measured, as today's rim
  clamp does — and the spine starts there. `ASCENT_END_U = 160` is where `WALL_RIM_U` put the rim
  node, so the spine and the landmarks are planned over the same ground as before. The trough
  logic and `RIM_OVERSHOOT` go with the wall.
- Everything else — comfort target 0.5, hard ceiling `TRAIL_HARD_SLOPE_MAX 0.9`, `ASCENT_DU_MIN`,
  the spacing invariant with `TRAIL_JUNCTION_R`, the spine search, fork placement, carved
  fallbacks — is untouched. Node heights come from `olympicPreTrailSample`.

`spawn.ts`/`world.ts` are unchanged: the spawn is the trailhead node, on the pad.

### 3a. Every candidate edge follows the ground

> **Superseded 2026-09-09** (see `docs/trail/2026-09-09-apron-and-ground-trail.md` §3.2–§3.4): the
> chord predicate (`chordDeviation`, `TRAIL_FILL_MAX`/`TRAIL_CUT_MAX`), the `fallbackScore` bands,
> the fork fan's widening and `retreatToWalkable` all existed to bound how far an eased CHORD
> departs from the ground. There is no chord: the bed IS the ground, and what routing has left to
> decide is which ground.

*(This section describes the code as shipped; some history is noted at the end.)*

The builder validated a candidate only by its eased chord's SLOPE (`easedPeak`), never by the
ground between its endpoints — so a leg with two reasonable endpoints could bridge a gully or
float over a terrace, exactly the "trail must be flush with the ground" decision this branch
exists to satisfy (`TRAIL_BENCH_DEPTH` cannot absorb metres). Every candidate edge is now measured
against the ground it spans, and against the dome it may end under.

**The chord measure.** `chordDeviation(heightAt, ax, az, ah, bx, bz, bh)` samples the SAME eased
chord the corridor lays (`g = ah + (bh − ah)·S(τ)`) every `TRAIL_CHORD_STEP` (5 m) of plan length,
endpoints excluded, against the pre-trail sampler, and returns `{ fill, cut }` — the chord's worst
float above the ground and worst sink below it. `chordOk(d)` is
`d.fill ≤ TRAIL_FILL_MAX && d.cut ≤ TRAIL_CUT_MAX`; `chordScore(d)` is the worse of
`d.fill / TRAIL_FILL_MAX` and `d.cut / TRAIL_CUT_MAX`.

The easing contributes a floor to both, and it is large enough to be a design constraint rather
than a detail: `S(τ) − τ` peaks at **0.1465**, so a chord of rise Δh over ground that runs
perfectly straight between its endpoints already floats `0.1465·|Δh|` at τ ≈ 0.77 and cuts the same
at τ ≈ 0.23, with the terrain contributing nothing. That is real fill — the corridor lays that
embankment — so the measure is right; but it means `TRAIL_FILL_MAX` caps a single edge's RISE at
about `TRAIL_FILL_MAX / 0.1465` ≈ 13.7 m before terrain is considered at all, which is why the
ascent needs more and shorter legs (`ASCENT_MAX_LEGS 8`) and why the fork halves take fallbacks at
the rate the measurements table records: inside a FIXED fan the ranking is choosing the least-bad
edge, not failing. A grade line that followed the ground instead of easing between the endpoints
would not carry this term — a follow-up, not part of this change.

**The dome measure.** A CARVED overlook's dome is composed AFTER `trailCorridorD` (parent spec
§4.2) and centred exactly on its fork's endpoint node, so on the bed — where the corridor's coverage
weight is 1 and the composed height is the eased chord exactly — the dome's gradient ADDS to the
chord's, near-radially. The dome's own peak,
`1.875 · OVERLOOK_DOME_HEIGHT / OVERLOOK_DOME_RADIUS = 0.75`, is already three quarters of
`MAX_WALKABLE_GRADIENT` before the trail's own grade is counted. `domeBedPeak` (in `landmarks.ts`)
samples both half-chords every `TRAIL_CHORD_STEP` and, inside the dome, takes the magnitude of the
summed gradient; `forkChords` returns it as `domePeak` BESIDE `peak`, and deliberately does not fold
it into `ok` — a FOUND overlook raises no dome, and `found` is decided from the same scan, so a dome
the fork will never get must not veto the natural high point that would have made it findable.

**Where each predicate binds.** The ascent's `comfortable`/`walkable` tiers require `chordOk` on top
of their slope cap. The spine's `chosen` step requires it alongside the gap and hard-slope
invariants. `landmarks.ts`'s `forkChords` requires it on BOTH half-chords. A carved overlook takes
the HIGHEST fan candidate that is also dome-safe (`domeSafeBest`), and only if the fan offers none
does it fall to the ranking.

**The dome is also a SPACING constraint.** A dome may never touch a bed that is not its own fork's:
its centre keeps `DOME_BED_CLEAR = OVERLOOK_DOME_RADIUS + TRAIL_CORRIDOR_HALF = 49 m` from every
edge already in the graph, and every fork candidate's two halves keep the same distance from every
EARLIER carved overlook's dome — two checks that between them cover both directions, since forks
are placed in order. Both ride the GAP band, because both are spacing violations, and a dome
clearance is mapped onto the 12 m bed gap's own scale (`d · TRAIL_EDGE_MIN_GAP / DOME_BED_CLEAR`) so
one comparator ranks both. Neither is folded into `ok`'s dome-free half: a FOUND overlook raises no
dome and `found` is decided from the same scan. Nothing new is declared — the distance is derived
from two existing tunables.

**One ranking everywhere.** `fallbackScore(peak, gapSq, domePeak, chordScoreValue)` is used by every
search in `trail.ts` and `landmarks.ts` — the ascent's fallback, the spine's single tracker, the
fork scan's `leastBad`, and `retreatToWalkable`'s own least-violating try. It is LEXICOGRAPHIC in
four additive bands, senior to junior:

1. `TRAIL_HARD_SLOPE_MAX` on the candidate's own eased chord (tie: least steep),
2. the spacing invariant `TRAIL_EDGE_MIN_GAP` (tie: largest gap; `null` where a search has no
   pairwise gap of its own, which is the ascent's — `ASCENT_DU_MIN` handles leg spacing directly),
3. the same slope cap on the bed a carved overlook's dome will sit on (tie: least steep; 0 where no
   dome applies, which is everywhere but a carved overlook),
4. chord quality (`chordScoreValue`).

A candidate that clears every band above always outranks one that fails any of them, however far
its chord floats or cuts: an edge over the slope cap, crossing another edge's corridor, or carrying
a dome that breaks its own bed is a WALKABILITY defect and `trailBed.test.ts` has zero tolerance for
those, while chord quality is a LOOK defect the visual check (§7) judges. Both the ordering and the
dome band's position were measured rather than assumed — see the note below.

**Two placement rules the searches need.** A fork takes its dealt side (`ForkSpec.nominalSide`,
strictly alternating) unless that side's whole fan falls outside the bowl's landmark margin, in
which case it takes the other and records the placed side in `ForkSpec.side` — the ascent's own "the
direction is the last thing the leg gives up" move. Without it, a spine node within
`FORK_LEN_MIN / sqrt(1 + FORK_FAN_LEAN²)` ≈ 179 m of the bowl's z-edge leaves the scan nothing to
rank, the fork falls through to the centroid, and `clampIntoMargin` drags it into a stub a few tens
of metres long — which a 45 m dome then swallows whole. And `forkBend`'s x-jitter is capped at
`min(FORK_BEND_JITTER, span / 2)`, a no-op for any normal-length fork, so a short one is not swung
into a hairpin.

**Trees keep off the bank.** `TRAIL_CLEAR` is 6, not 3 — 2 m past `TRAIL_CORRIDOR_HALF` — so no
trunk stands on the cut bank or the lip. See the parent spec's §3.4.

**Re-tuned for the sweeps (§2.4): `ASCENT_LEG_DZ_MIN 120 → 113`, `ASCENT_MAX_LEGS 6 → 8`,
`FORK_FAN_RAYS 5 → 9`, `FAN_STEP 25 → 20`.** All four were swept against the walkability scan, not
reasoned, and the two searches were swept against DIFFERENT seed sets, which is the only reason
either number can be trusted:

- `ASCENT_LEG_DZ_MIN` was chosen against the 219 seeds checked for walkability, the held-out lobby
  seeds `room-200…499` (300) and sequential 0–499 (500). Only 112 and 113 give zero defects across
  all three and 113 is the larger, so it is a two-wide measured band, not a plateau — its own doc
  comment says so.
- `FORK_FAN_RAYS`/`FAN_STEP` could NOT be chosen that way: every fan width reaches zero on those
  same 1019 seeds once `ASCENT_LEG_DZ_MIN` is swept, so they carry no signal about the fan. The fan
  was chosen on a further 500 lobby seeds, `room-500…999`, held back from every other decision —
  where the unwidened 5 × 25 fan (5 rays, 11 radii) leaves 4 beds over the walkable cap, the worst a
  spine step at 1.921 (a wall), and the shipped 9 × 20 fan (9 rays, 13 radii: L = 200…440) leaves 2,
  worst 1.051 (marginal). The widening was accepted on that worst-VALUE evidence rather than on the
  count.

**`room-500…999` is therefore a clean holdout for `ASCENT_LEG_DZ_MIN` only, not for the fan.** Any
future claim about the fan's generalisation needs a set that has not been used to pick it.

**History.** The chord predicate first shipped with a weighted `max(...)` fallback score and a
`KNOWN_CHORD_GAP_EXCEPTIONS` list. Making the ranking lexicographic — cap, then gap, then chord —
deleted the exceptions but left the walk scan red on 2 seeds, which was first blamed on the
corridor's adaptive coverage radius. Decomposing the composed field stage by stage disproved that
(on a centreline the coverage weight is exactly 1, so the corridor stage contributes exactly the
chord's own gradient) and found the carved overlook's dome instead, which added `domeBedPeak`, the
dome band, `domeSafeBest` and the empty-fan side flip. `TRAIL_CLEAR 3 → 6` followed, with
`groundedProps.test.ts`'s three root-plate ceilings restored to their earlier values, `ASCENT_LEG_DZ_MIN`
re-swept to 113 and the fork fan widened to `FORK_FAN_RAYS 9` / `FAN_STEP 20`, reaching 0
walkability defects over all 1019 scanned seeds. This section, the parent spec's §3.2 rows and every
dated measurement in the tests were then corrected: they had been taken mid-sweep at
`ASCENT_LEG_DZ_MIN 112` rather than at the shipped 113. Last came the dome's spacing rule above,
which moved no constant — a dome on the ascent chain seals the world, so it is a walkability defect,
not a look defect — reaching **0 walkability defects over all 1519 scanned seeds** (the check set,
both holdouts and the sequential scan).

## 4. Trail surface (renderer)

`trailPaint.ts` stops tinting and paints materials. Two bands from the same segment loop:

- **The bed: gravel with a dirt tint.** Within `d < TRAIL_BED_HALF + TRAIL_PAINT_MARGIN` (margin
  `0.5` m, the walked edge) the fragment takes the **pebble ground layer** — already bound on the
  terrain material as `terrainPebble` with its normal and RAH maps — sampled planar in XZ at the
  pebble tiling, albedo multiplied by `TRAIL_DIRT_TINT` (a warm brown, `(0.62, 0.50, 0.38)` as the
  starting value), and its normal, roughness and F0 mixed into `normalW`/`terrainRough`/
  `terrainF0` the way `roadPaint.ts` mixes asphalt. The band edge is `TRAIL_PAINT_EDGE = 0.4` m
  with the `fwidth` anti-alias floor, as today.
- **The cut bank: bare forest floor.** Within `d < TRAIL_CORRIDOR_HALF` and on the cut side, the
  fragment takes the **forest-floor layer** (`terrainFloor`), weighted by
  `smoothstep(0, 1, c) · (1 − smoothstep(BED + MARGIN, CORRIDOR_HALF, d))` where `c` is the cut
  depth. On the fill side the gravel simply ends at the bed's edge and the natural ground shows.

**Cut depth in the shader.** The segment table gains node heights: it becomes an `N × 2` RGBA32F
texture, row 0 `(x_a, z_a, x_b, z_b)` as today, row 1 `(h_a, h_b, 0, 0)`. The fragment computes
`g = h_a + (h_b − h_a)·S(τ) − TRAIL_BENCH_DEPTH` for its nearest segment (the same `τ` the distance
loop already forms) and `c = vPositionW.y − g`: the terrain height at the fragment is its own world
y, so the classification matches the sim's exactly at the bed line and to the corridor blend's
accuracy beyond it. `trailPaint.ts` exports the TS mirror `trailCutDepth(x, z, y, segments)` so the
test pins the shader's arithmetic. Constants in the GLSL come from the module's exports via the
`f()` formatter, never literals, and `TRAIL_BENCH_DEPTH` is imported from `sim/trail.ts` (a
type-and-constant import; the file stays Babylon-free and in `BABYLON_FREE_FILES`).

`TRAIL_PAINT_MAX_SEGMENTS 64` and the truncation assertion in the bed scan stay.

## 5. Grass off the bed

`grassGateProduct` (`clutter.ts`) gains one factor: `S(CLUTTER_GRASS_TRAIL_NEAR, CLUTTER_GRASS_TRAIL_FAR, r_t)`
with `r_t = variant.trailDistance?.(seed, x, z) ?? Infinity` and `NEAR = 2`, `FAR = 5` (m): zero
across the bed and the lip, returning past the cut bank. Every class that shares the grass gate
(grass, flowers, whatever else calls `grassGateProduct`) inherits it; rocks and boulders do not — a
few rocks on the bed read as gravel. Outside the bowl the hook returns `Infinity`, the factor is
`1`, and the census is bit-identical. Both constants join `CLUTTER_TUNABLES`.

## 6. Tests

Deleted, not weakened: the synthetic wall tests in `bowl.test.ts` (`wallD`, `wallTopU`, the wall
derivative sweep), the wall sweep and the "through the wall" derivative sweep in `olympic.test.ts`,
the `wallTopU` assertions in `trail.test.ts`, and the `WALL_*` rows of the tunables tests.

| Test | What it proves |
| --- | --- |
| `bowl.test.ts` pad | flat inside the radius; exact derivatives across the fade (dense sweep, ≤ 1 % of steepest); same object outside `RADIUS + FADE`; `BOWL_TUNABLES` exhaustive |
| `trail.test.ts` bench | on a synthetic slope: bed at `g − TRAIL_BENCH_DEPTH`; downhill of the bed the sample equals `base` beyond `BED + LIP`; uphill the bank reaches `TRAIL_CORRIDOR_HALF`; derivative sweep through a hairpin at ≤ 1 % of steepest including the cut/fill crossing; same object outside; `TRAIL_TUNABLES` exhaustive with the new keys |
| `trail.test.ts` builder | ascent ends at `ASCENT_END_U` on the five probe seeds; all existing builder properties (alternation, spacing, hard cap) unchanged |
| `olympic.test.ts` | derivative sweep along every edge of the real graph + the pad; bit-identity outside the bowl with its `checked` floor; carved overlook/stand tests re-pinned |
| `trailBed.test.ts` | GREEN: 0 bed samples over `MAX_WALKABLE_GRADIENT` on 219 seeds; gained the chord-defined fill/cut/lip test (§3a) and its 40 s timeouts, both up from 20 s |
| `trailWalk.test.ts` | unchanged and GREEN on its 3 seeds |
| `trailPaint.test.ts` | two-row table layout; `trailCutDepth` positive uphill and negative downhill of a synthetic segment; GLSL contains the exported constants and the `fwidth`-before-branch pin; still in `BABYLON_FREE_FILES` |
| `clutter.test.ts` | grass density 0 on a bed point, restored by `FAR`, bit-identical outside the bowl; `CLUTTER_TUNABLES` includes the two keys |
| `groundGradient.test.ts` | re-pinned digests with dated `from <old>` clauses |
| `architecture.test.ts` | unchanged (no trig/pow/hypot in `sim/`) |

## 7. The visual check (binding, before merge)

The acceptance criterion is visual. After the numeric checks are green, the running game is checked
on three seeds (`0x5eed`, `1`, `12345`), from the same three viewpoints on the current build and on
the branch:

1. from the trailhead pad looking up the first switchback;
2. from the middle of the first leg's bed, looking downhill across the open side;
3. standing on the spine at the first fork, looking along the bed.

This passes when the three decisions in §1 (no wall face; bed against the face with the far side
open; a gravel ribbon distinct from grass) are visible at all three viewpoints. If the bed reads as
floating on fill in view 2, raise `TRAIL_BENCH_DEPTH` and check again; record the value.

## 8. Parent spec amendment

`docs/gameplay/2026-09-08-register-and-hollow.md`'s containment rule ("cliffs keep you in") is
replaced: the highway is where the forest ends; an invisible wall at the road edge with a spoken
line keeps the player in, built in a later sub-project. The car at the trailhead remains the only
exit.

## 9. Out of scope

The road shoulder's own steepness where the highway is cut into a bank; the terraces; the
invisible wall and its dialogue; the unsealed z extremes follow-up (moot without a wall); the
trailhead-pit notch (moot: the pit was the wall's).
