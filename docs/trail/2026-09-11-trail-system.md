# The trail system — a stem to a made peak, seeded loops around made features

**Status:** Shipped 2026-09-11. Numbers that moved in execution, all levers: peak r 300 / rise 50–80 (was 220 / 60–90), a 25 m flat crest platform; `TRAIL_MOVE_GRADE_MAX 0.7`; loop features scored on the whole disc with `MEADOW_SLOPE_MAX 0.35` / `POND_SLOPE_MAX 0.25`, levelled to their mean ground, the meadow's ramp OUTSIDE its radius (`MEADOW_RIM 35`) and the loop walking that apron; `FEATURE_SPACING 180`, `LOOP_LATERAL_MAX 200` at the disc's near edge, wider overlapping bands, meadow r 50–90, `LOOP_LEN_MAX 700`, `LOOP_TRIES 24`; the seeded plan is a ceiling — measured on 227 seeds: a loop on 78 % of worlds, 62 % of planned loops built, full plan on 52 %, hubs on 13, fallbacks 0.
**Parent:** `docs/gameplay/2026-09-08-register-and-hollow.md` (§17 build order: this
slots after G1 and before B — B places the register on the graph this spec defines).
**Supersedes:** the landmark-driven graph of `docs/trail/2026-09-09-apron-and-ground-trail.md` §3–4
(overlook / stand / clearing / talus as graph nodes). The apron, the walkability grid, the
Dijkstra, the composed fine check, the bed, the bench cut and the paint table all stay.

## 1. Why

Today's trail graph is a set of chords between four scored landmarks, and its ends are wherever
a scoring function found bare ground. They read as arbitrary: a trail that stops in the trees.
A real trail system has reasons — it climbs to a top, or it walks the rim of something worth
walking round. This sub-project makes the graph say that: **one stem that climbs to a summit —
the only dead end in the world — and a seeded number of loops off it, each circling a feature
that exists because the loop needs it** (a meadow, a pond). It also moves the trailhead to where a
car actually parks, and fixes the invisible wall at the pad, which is the trailhead's own
placeholder props colliding without being drawn.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Loop around what? | **New terrain features** (peak, meadow flat, pond basin), not the existing landmarks |
| Topology | **Stem and loops**: one stem pad → summit, loops branch off and rejoin |
| How many loops | **Seeded**: N ∈ {1, 2, 3}, kinds from a pool |
| The pond | **Shallow, wadeable**: ≤ 0.6 m deep, water plane visual only, no movement change |
| The summit | **A made peak**: an elevation stage raises a true crest |
| Builder | **Feature-first**: place terrain, then route on the ground that results |
| Junctions | Loops **may share** a stem junction (a hub) |
| Trailhead | **9 m** from the road centreline; the car parked on the shoulder |
| The invisible wall | Every chunk prop is **drawn**; no collider without a mesh |

## 3. The features

Each is an elevation stage on the composed field (base terrain → apron → features → corridor
stages), returning exact analytic derivatives and the input sample as the same object outside
its window, like the landmark domes. Every constant below lives in one `FEATURE_TUNABLES` table
that `passHash()` folds into the level id.

- **Peak** — one per world, always. A dome with a sharp crest: rise 60–90 m over a 220 m radius
  (seeded within the range), centred 700–1000 m inland of the pad along the montane grain (+x).
  Bare rock above a per-world treeline at crest − 35 m; trees thinned in a 60 m band below it;
  no clutter on the crest disc (r = 25 m). The **crest cell** is the stem's target.
- **Meadow** — a flat: a disc of radius 70–110 m levelled to its centre height with a soft rim
  (rim width 25 m), `meadow` ground class inside, denser flowers, trees and stumps refused inside
  the disc plus a 6 m margin, clutter thinned. A loop circles its rim band.
- **Pond** — a basin: a dish of radius 25–40 m, ≤ 0.6 m deep at the centre, with a water plane at
  rim height. Bare floor from the rim to +4 m; no trees within the disc +8 m; wadeable — the
  basin floor is ordinary ground, the water is a mesh. A loop circles it 6–10 m off the shore.

### 3.1 Seeded selection

N is drawn from the world RNG with weights 0.3 / 0.5 / 0.2 for 1 / 2 / 3 (a lever); kinds are
drawn from the pool {meadow, pond} with replacement, **never two ponds**. The old landmark types
leave the graph: the overlook is replaced by the peak, the clearing by the meadow; the **stand
and talus stay as scenery** stages placed off-trail by their existing scoring, no longer nodes.

### 3.2 Placement

Candidates are sampled on the walkability grid (8 m) along the stem's corridor, not the whole
map: the i-th loop's feature sits at 25–40 % / 45–60 % / 65–80 % of the pad→crest straight-line
distance, 60–120 m lateral of that line so the loop is a real detour, on ground whose pre-stage
slope suits the kind (meadow ≤ 0.12 rise/run, pond in a local low with slope ≤ 0.08 across the
disc). Candidates are scored on flatness, clearance from the road apron (≥ 150 m), from each
other (≥ 250 m centre to centre) and from the peak's dome (outside it), and the best is taken. A
kind with **no candidate is dropped and N shrinks** — the seed still gets a legal world.

## 4. The builder

Per seed, in this order, each stage seeing the ground the earlier ones made:

1. **Peak.** Sample its centre, apply the dome; the crest cell is the target. If no walkable path
   reaches the crest under `TRAIL_HARD_SLOPE_MAX`, lower the crest one step (5 m) and retry, at
   most three times, before falling back to today's highest-reachable rule. The seed sweep
   requires `fallbacks === 0` over ~200 seeds.
2. **Stem.** Today's Dijkstra (slope cost, tree-reuse discount) pad → crest, slope-aware
   Douglas–Peucker, bed and corridor as shipped. Stem edges carry a monotone **`progress`**
   scalar — stem distance, 0 at the pad, 1 at the crest — which is what B and C consume. The
   last 80 m may switch back; the Dijkstra produces that on its own on a cone.
3. **Loops, in stem order.** Apply the feature's stage, then route **two half-loops**: junction A
   (the stem node nearest the feature's lower band) → a turn node on the feature's far side,
   then turn node → junction B (the stem node nearest the upper band, ≥ 120 m of stem above A).
   Both halves use the Dijkstra with a **ring cost**: cells inside the feature disc are
   impassable; cells in the band `[R, R + 12 m]` cost × 0.35; all else as usual. A loop whose
   halves share more than 20 % of their cells with each other or with the stem is rejected and
   its feature stage dropped (N shrinks). Junctions split the stem edge at the join
   (`splitAt` node sharing). **Loops may share a junction** — a hub node with up to four edges;
   the pad's departure frame already handles any number of incident edges.
4. **Fine check and paint** as shipped: the composed check over every edge with ≤ 3 reroutes,
   the bucketed paint table, the bench cut with its 6 m shoulder. Loops and stem paint the same
   bed.

**Budget:** stem 900–1400 m, each loop 250–500 m; a full world is a 2.5–4 km walk (levers).

### 4.1 The graph that ships

```
TrailGraph {
  nodes, edges                          // as today
  trailhead: { x, z, u }                // as today
  summit: NodeId                        // the crest node — the ONLY dead end
  stem: EdgeId[]                        // pad → summit, in order; each edge has progress0/progress1
  loops: { kind, featureId, edges: EdgeId[], junctionA: NodeId, junctionB: NodeId }[]
  features: { id, kind: "peak" | "meadow" | "pond", centre, radius, height }[]
}
```

Progress on a loop edge is the nearer junction's stem progress (C's "which way is up").

## 5. The trailhead, the road, the props

- **Distance.** The pad centre moves from 44 m to **9 m** from the road centreline: road
  half-width 3.5 m, a 2.5 m shoulder, ~3 m of gravel to the pad centre. The apron already makes
  this ground gentle; the corridor's first stage starts at the pad as today.
- **The car** is parked on the shoulder, parallel to the road (long axis along z), outer edge
  0.5 m off the pavement — placed in the **road frame**. The post and sign stay in the pad's
  departure frame at its far edge, off the bed.
- **Every chunk prop is drawn.** In forest worlds the renderer today skips brush meshes
  (`renderer.ts`, `forest === null` guard), so the placeholder car / post / sign collide
  invisibly — the wall in the 2026-09-11 clip. The renderer draws every chunk prop as a brush
  mesh with its material; a test asserts every collidable prop has a render entry. Real assets
  replace the boxes in a later sub-project; **no collider without a mesh, ever.**
- Containment on the road stays unowned, as in the parent spec.

## 6. Ground, water, cover

- Meadow: `meadow` ground class inside the disc, flowers denser, trees/stumps refused inside +6 m,
  clutter thinned; the rim band takes the trail's bare shoulder where the loop runs.
- Pond: bare floor rim → +4 m; no trees within +8 m; **one flat water mesh per pond** at rim
  height, the ocean's water material reused (camera-relative shader, one extra mesh, no new
  material); wading is walking on the basin floor.
- Peak: bare rock above the treeline, thinned band below, no clutter on the crest.

## 7. Tests and checks

- **Seed sweep (~200 seeds, composed field):** a summit exists and every dead end is it; every
  loop returns to the stem; feature discs are disjoint from every edge and from each other; no
  edge exceeds `TRAIL_HARD_SLOPE_MAX` after the fine check; `fallbacks === 0` for the peak; the
  pad centre is 9 ± 0.5 m from the road centreline; N's distribution matches its weights within
  noise. Red before, green after.
- **Stages:** exact derivatives (finite-difference check) for peak / flat / basin; same-object
  return outside the window; bit-identical world per seed.
- **Builder:** ring cost keeps a half-loop in the band on a synthetic disc; two half-loops never
  overlap; a shared junction is one node with four edges; a kind with no candidate shrinks N and
  leaves a legal world; overlap rejection drops the feature stage.
- **Renderer (NullEngine):** every chunk prop gets a brush mesh in a forest world; one water
  mesh per pond at rim height.
- **Checked in the running game:** the pad from the road — car on the shoulder, props
  visible, a walk through where the clip stopped; the meadow loop from its junction; the pond
  shore with a wade; the summit crest with the coast behind; a frame-time pair for the water
  mesh.
- **The level id moves** (feature tunables fold in); invite links refuse across the change.

## 8. Out of scope

Swimming or any movement change; real car / sign / reed / rock assets; the register on the
graph (B); the Hollow (C); containment on the road; a pool of more than two loop kinds (the
pool is designed to grow — a rock bench, a talus bowl — without changing the builder's contract).
