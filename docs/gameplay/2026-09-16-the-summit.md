# The summit — the core loop, redesigned

**Date:** 2026-09-16
**Status:** Designed. Four sub-projects, none built: T2 (loops and braids), S1 (the summit loop),
S3 (the cut), S2 (the watcher). §9 tracks each.
**Parent:** `docs/gameplay/2026-09-08-register-and-hollow.md`. Supersedes its loop (§1 there, the
count and the sign-out) and the §17 table's F and beyond. Keeps its trailhead, its Hollow's
lethality and its tone.
**Supersedes, in part:** `docs/gameplay/2026-09-15-register-and-count.md` (B) — the items, the
carry, the sites and the sign-out go; the trailhead, the car, the sign posts and the road wall stay.
`docs/gameplay/2026-09-15-the-hollow.md` (C) — the crawl, the bind, the split and the merge go, and
with them the rule that nothing pops in or out; contact, the stare, permanent death and the loss
stay. `docs/gameplay/2026-09-16-escalation-and-atmosphere.md` (D) — the world input changes; the
model, its outputs and the lens stay. `docs/trail/2026-09-11-trail-system.md` (T) — extended by the
braid; nothing removed.
**Depends on:** A (the trailhead), G1 (the headlamp), T (the trail system), C's movement, contact
and stare, D's model.

## 0. What this is

One hiker is missing, last seen at the summit. The poster at the trailhead says so, and that is
the whole briefing. The climb is a stalk: a figure stands in the trees at the edge of sight, closer
each time you look, and looking is what kills you. The crest is a discovery: the hiker, dead,
crucified, and the Hollow standing behind them. The descent is a chase through a web of trails
where a Hollow steps out of every wrong branch at every fork, so that exactly one way home stays
open — a medium-to-long, non-linear way, never the straight trail down. The woods end at the road,
and so do they.

The fetch-every-hiker loop (B) read as a chore. This replaces it with one ascent of rising dread
and one panicked escape.

## 1. Decisions

| Question | Decision |
| --- | --- |
| The briefing | A **missing-person poster** on the register post, not a book. Name, "last seen: the summit", a number to call. Optional to read. |
| The win | **Reach the road corridor alive.** No item, no carry, no sign-out. |
| The climb's threat | A **watcher**: a Hollow that stands off-trail, never moves, never touches, hides when you look away or come close. **The stare drains while you look at it and kills at 1.** |
| The discovery | **The first living player onto the crest** flips the phase for the whole party. One shared moment. |
| The summit Hollow | Appears behind the body on discovery, a 2 s reveal, then hunts. |
| Fork Hollows | **Step out of the wrong branch and join the chase.** The pack grows fork by fork. |
| Pacing | Hollows hunt at **6.3 m/s**, a touch under a sprint (7). Walking, stopping, turning back or a wrong branch is what closes the gap. |
| The trail | **Loops and braids**: the shipped stem-and-loops plus 2–3 parallel strands below the crest, cross-linked by rungs. 8–14 forks. |
| The one path home | **Cut fork by fork as you arrive**, guided by a hidden route drawn at discovery whose length is **1.5–2.5×** the shortest way down. Straying is re-guided, never trapped. |
| Safety | **The Hollow stays in the woods.** The road corridor is safe ground; a Hollow never crosses the treeline into it. |
| The end, 2–5 players | Each player is done on reaching the road. The match ends when no living player is still out: **won if anyone is safe, lost if all died.** The end screen groups the survived and the perished under a Poe-like passage. |
| Death | Permanent, as C shipped. The dead spectate. |
| Architecture | A **phase machine over the shipped parts** (§8): `phase` on the world, two new Hollow states, the poster in place of the register, a braid stage in the trail builder, the cut on top of `trailRoute.ts`. |

## 2. The loop

A match is two phases, host-authoritative, one byte on the wire.

**Climb.** The party spawns at the pad. The poster on the register post is the only briefing (§7).
The watcher stalks the climb (§4). Dread rises with the party's progress up the stem (§6).

**Chase.** The tick the first living player comes within `DISCOVERY_RADIUS` (12 m) of the body,
`phase` flips to Chase for everyone, wherever they are. The watcher is removed; the summit Hollow
appears (§5.1); every fork becomes a cut point (§5.3). The phase never flips back. A straggler still
climbing meets the summit Hollow coming down.

**Safe.** A player standing on the road corridor — within `ROAD_CORRIDOR_HALF` (30 m) of the road
centreline, the cleared strip the pad and the car sit in — is `safe`: never targeted, never
killed. Safety is a state of the ground, not a flag set once: a player who walks back into the woods
is a target again. A safe player can wait for a friend on the pad; they cannot lure the pack out,
because a Hollow never crosses the treeline (§5.2). `CAR_RADIUS` no longer means anything to the
win.

**The end.** The match ends on the first tick with no living, unsafe player. `Outcome.Won` if any
player is safe, `Outcome.Lost` if none is (everyone died). Mixed is a win with names on the stone.

**One player and five play by the same rules.** The trigger is "first onto the crest"; the cut is
shared; each player's escape is their own.

**What goes.** Items, carry, `pickUp`/`putDown`, the five-second sign-out, `retrievedCount`,
`signedOutCount`, the hiker sites on the trail, the register HUD ring, `ItemState` and the `items`
section of the snapshot, `PlayerState.carrying`, `signOutTicks` and `signedOut`. Deleted, not left
dormant. `register.ts` shrinks to the poster and the car.

**What stands from C.** Contact kills whoever it touches. The stare fills in 6 s while a Hollow is
in view, empties in 3 s, kills at 1, and rides the snapshot as a byte. Death is permanent on every
level; the dead stay as peers. Two Poe-like death passages.

## 3. The trail: loops and braids (T2)

### 3.1 What stays

Everything T shipped: the made peak and its crest platform; the stem pad → crest as the routing
backbone and the owner of `progress`; the seeded loops (1–3) around meadows and ponds, with their
hubs; the corridor, bed, bench cut, paint table and walkability-grid Dijkstra; the pad, the road and
the car.

### 3.2 The braid

At a **top fork** on the stem — at stem progress 0.75–0.85, seeded, so the final climb to the crest
is one trail — the stem splits into **2–3 strands** (seeded, weights 0.6 / 0.4 for 2 / 3) that
descend roughly in parallel, 80–200 m apart laterally, and rejoin at a **bottom fork** near the pad
(progress 0.08–0.15). The original stem is strand A. **Rungs** connect adjacent strands at seeded
heights: 2–4 per adjacent pair, at least 120 m of descent apart, each running between the nearest
nodes of the two strands at that height.

Loops keep hanging off the stem as today and may hang off any strand: a loop's feature is placed in
a band lateral to the strand it attaches to (the shipped placement rule, with "the stem" read as
"its strand"), and its two junctions are forks like any other. Strands and rungs treat every
feature disc plus its apron as costly ground, so no strand cuts through a meadow its loop circles.

### 3.3 The builder

Per seed, in this order, each stage seeing the ground the earlier ones made:

1. **Peak** and **stem**, as shipped.
2. **Loop features and loops**, as shipped, attached to the stem: the seeded N ∈ {1, 2, 3} loops
   with their kinds. A kind that finds no candidate on the stem is not dropped yet; it is retried
   in step 4.
3. **Strands.** Choose the top and bottom fork nodes on the stem (snapped to existing nodes in the
   progress bands). For each extra strand, Dijkstra top → bottom on the walkability grid with a
   lateral offset target (a seeded side and distance from strand A's line) and a penalty inside
   every existing edge's corridor, reusing the corridor-union and reroute machinery. A strand that
   cannot route within `TRAIL_REROUTE_MAX` tries is dropped and the count shrinks.
4. **Loops off strands.** The loop kinds step 2 could not place are retried with each strand beyond
   A in the stem's role, one loop per strand at most, under the same feature spacing. N never
   grows; a kind with no candidate on any strand is dropped, as today.
5. **Rungs.** For each adjacent strand pair, seeded heights in the pair's shared progress range,
   spaced ≥ 120 m of descent; Dijkstra between the nearest nodes; a rung that fails the
   `TRAIL_EDGE_MIN_GAP` check against any edge but its own ends is dropped, never forced.
6. **Annotate** (§3.4).

A seed always gets a legal world: a dropped strand or rung is a smaller web, not a fallback.

### 3.4 The graph

- A **fork** is any node of degree ≥ 3; the graph lists them in `forks: number[]`.
- `EdgeKind` becomes `"stem" | "loop" | "strand" | "rung"`. The stem keeps its `progress`; the
  `stem` edge list and `stemLen` are unchanged, so `stemProgress` and everything that reads it
  stand.
- Every node carries `homeDist`: its Dijkstra distance to the pad along the trail, by arc length,
  computed once at build. The cut rule and the Hollow's routing read it.
- The graph carries `shortestHome`: `homeDist` of the crest, the shortest crest-to-pad length. The
  guide route (§5.3) is sized from it.
- Every constant above lives in `TRAIL_TUNABLES`, so it folds into the level id.

### 3.5 Gates

On a ~200-seed sweep of the composed field (red before, green after — never a handful of probe
seeds):

- connected; the crest is the only dead end (every other node has degree ≥ 2);
- 8–14 forks per world;
- a loop on ≥ 75 % of worlds, as today;
- a guide route with length in [1.5, 2.5] × `shortestHome` exists from the crest on every seed
  (found by running §5.3's walk offline);
- `fallbacks === 0`;
- build time per seed within today's budget (the sweep clocks it).

### 3.6 Standalone

T2 ships first and alone. The current loop plays on it unchanged: the register's sites sit on the
stem, the Hollow's crawl and `stemProgress` read the stem, and both still exist.

## 4. The climb: the watcher (S2)

One Hollow in a new `AiState.Watch`. It exists only while it can be seen: it is spawned when it
shows and removed when it hides, so peers get it through the enemy snapshot they already receive.

**Where it shows.** Relative to the **lead**: the living player with the greatest `stemProgress`.
It stands off the trail bed — at least `WATCH_TRAIL_CLEAR` (6 m) from any edge — on walkable
ground, at a range that shrinks with the lead's progress: `WATCH_RANGE_FAR` (90 m) at progress 0
to `WATCH_RANGE_NEAR` (25 m) at the top fork's progress, linear between. Its bearing is
`WATCH_BEARING_MIN`–`WATCH_BEARING_MAX` (30°–70°) off the lead's look direction, in the forward
hemisphere, on a seeded side. It must have a clear sightline from the lead's eye — `playerSees`,
the test the stare uses. Never within `WATCH_FLEE_RADIUS` (15 m) of any player. Up to
`WATCH_PLACE_TRIES` (8) placements per tick from the world RNG; if none fits, it waits a tick.

**What it does.** Nothing. It stands and faces the lead. It never walks, never touches, never
leaves its spot. It is the shipped placeholder model.

**The stare.** While any living player holds it in view, that player's `stare` fills as shipped.
This is the climb's whole danger: it stays as long as you keep looking, and it kills you if you
don't stop.

**When it hides.** On the first tick no living player has it in view, or a player is within
`WATCH_FLEE_RADIUS`. Then a rest drawn from `WATCH_REST_MIN`–`WATCH_REST_MAX` (20–60 s at the pad),
both scaled down to `WATCH_REST_NEAR_SCALE` (0.4) of themselves at the top fork's progress, so
sightings get frequent near the top. Then it shows again. From the player's side: you see it, you
look away, it's gone when you look back — closer next time.

**On discovery** it is removed for good. The summit Hollow is a separate spawn.

**Levers** (all in `hollow.ts`): the ranges, the bearing band, the flee radius, the rest bounds and
their near scale, the tries.

**Tests.** Placement obeys every constraint on a seeded sweep; hides on look-away and on approach;
the stare fills only while in view and never on the tick after it hides; it never spawns once the
phase has flipped; the lead is re-read when the lead dies.

## 5. The summit and the chase

### 5.1 The summit (S1)

**The body.** A placeholder at the crest centre: two dark timbers crossed, a hiker-shaped capsule
bound to them, facing the stem's arrival. Built from primitives in `game/` with a
`StandardMaterial`, like the Hollow's placeholder — a PBR material with fog off never compiles
under the atmosphere plugin. The sim knows it as `summitBody: { pos, yaw }` on the level. Nothing
else is placed on the crest, as today.

**Discovery.** The tick the first living player comes within `DISCOVERY_RADIUS` (12 m) of the
body: `phase` → Chase; the watcher is removed; the **summit Hollow** spawns `SUMMIT_SPAWN_DIST`
(6 m) behind the body on the far side from that player, facing them, in `AiState.Emerge` with
`SUMMIT_REVEAL_S` (2 s) on its timer. When the timer runs out it hunts that player.

**The hunt, revised for the chase.**

- `HOLLOW_HUNT_SPEED` **6.3 m/s** everywhere (was 6; sprint is 7, walk 5.25). It closes on anyone
  walking, stopped or turned round.
- Target: the player named at spawn. When its target dies or becomes safe, the nearest living,
  unsafe player. With no such player it stands where it is, facing the pad.
- Contact kills whoever it touches, target or not.
- Pathing as shipped: a graph walk along the trail while far, a straight approach within
  `HOLLOW_APPROACH_RANGE` (25 m). The route is rebuilt from the node it is already walking to.
- Being looked at slows it: `HOLLOW_LOOK_FACTOR` **0.6** (was 0.35; the watcher never moves, so
  the constant is simply retuned). The stare fills as shipped, so glancing back buys distance and
  costs the screen.

### 5.2 Safety (S1)

A Hollow never crosses the treeline. Its movement clamps at the road corridor's edge: a step that
would put it within `ROAD_CORRIDOR_HALF` of the road centreline is refused, and a Hollow whose
target is safe retargets as above or stands at the edge, facing the pad. `safe` is computed per
player per tick from the road distance (§2), rides the snapshot as a bit beside the lamp, and is
what the roster and the end rule read.

### 5.3 The cut (S3)

**The guide.** On the discovery tick the host draws a hidden **guide route** crest → pad: a seeded
random walk on the trail graph from the world RNG that never repeats an edge and may run round a
loop's far side, choosing at each fork uniformly among the branches that can still reach the pad
without a repeated edge. A walk is accepted when its length lands in
[`GUIDE_MIN`, `GUIDE_MAX`] × `shortestHome` (1.5, 2.5). Up to `GUIDE_TRIES` (64) walks; failing
that, the longest found under `GUIDE_MAX`; failing that, the shortest path — the sweep gate (§3.5)
pins this last case to never happen. No one sees the guide. It is how the cuts know which way is
"the one path", and it is what makes the way home medium-to-long rather than the stem.

**Cutting a fork.** During Chase, when any living, unsafe player comes within `FORK_CUT_RADIUS`
(30 m) of an uncut fork, that fork is cut, once, for the whole party, for the rest of the match.
The **arrival** branch is the edge that player is on (nearest by `segmentDistance`). Then:

- if the fork is on the guide and the arrival branch is the guide's edge into it, the **open**
  branch is the guide's edge out of it;
- otherwise — the player strayed, or is a straggler still climbing — the open branch is the
  non-arrival branch whose route to the pad on the **residual** graph (every closed branch of every
  cut fork removed) is shortest, with ties, and near-ties within `GUIDE_REJOIN_SLACK` (60 m),
  broken toward a branch that rejoins the guide. Straying costs the extra Hollow behind you; the
  maze funnels you back, it never traps you.

Every other branch is **closed**. A closed branch is a Hollow, not a wall: a player can still enter
it, and it hunts them if they do. The crest stays the world's only dead end. Because the open
branch reaches the pad on the residual graph at cut time and arrival branches are never closed, a
route home free of closed branches exists from every fork the moment it is cut; a later cut
elsewhere can only add a Hollow to someone's way, never remove the way.

**The fork Hollow.** One per closed branch (a 4-way hub gets two). It spawns `FORK_SPAWN_DIST`
(12 m) into the closed branch on the bed, walks to the fork's mouth at hunt speed in
`AiState.Emerge`, stands `FORK_REVEAL_S` (1 s) facing the player who triggered the cut, then hunts
them under §5.1's rules. If they have already passed, it is behind them; if they hesitate, it is on
them.

**Pack size.** On a typical guide, the summit Hollow plus 5–8. §5.1's pacing is what keeps that a
wall of pressure rather than a race lost.

**State.** `cuts: Map<number, number>` (fork node → open neighbour node) and `guide: number[]` on
the world, host-only, off the wire and outside the fingerprint, like the Hollow's route.

## 6. Escalation, re-derived (S1)

Still the pure client-side model in `game/escalation.ts`; nothing on the wire. Only the **world**
input changes.

- **Climb.** world = the party's best stem progress: the greatest `stemProgress` any *living*
  player has reached, ratcheted so it never falls (a dead lead does not lower it). This replaces the
  retrieval floor and the crawl creep. Outputs are unchanged: the sun runs from the base hour toward
  22, the weather from the base toward eerie, dread lifts. Reaching the crest puts the summit at
  full dark, so the chase is a night chase by headlamp. That is the intent.
- **Chase.** world pinned at 1.
- **Lens.** As shipped: the off-trail spike and Hollow nearness. The watcher counts as a Hollow for
  nearness, so every sighting nudges the lens. In the chase, nearness reads the nearest hunting
  Hollow, as today.

Folded in from D's follow-ups, because the same lines move: the vignette is clamped to 1, and
`creepMax` is renamed `progressMax`. The look at mid-progress (bright mist versus dusk) stays a
browser-pass item.

**Tests.** The world input follows the lead's progress and ratchets; a dead lead does not lower
it; the phase pins it; the watcher feeds nearness.

## 7. The client side and the wire (S1, S3, S2)

**Screens.** `registerPanel.ts` becomes the poster: the same pure-model-plus-dumb-renderer shape
as every screen, `textContent` only, a missing-person notice (the hiker's name from
`hikerNames.ts`, "last seen: the summit", the date, a number to call) and one dismiss.
`registerHud.ts` is deleted. The end screen gains the two-group layout — *survived* and
*perished*, with names — under a passage from a **third passage set** in `script.ts`, beside the
two death passages, chosen by which groups are non-empty (all survived, some, none). The pause menu
and roster are untouched, except that a safe player shows in the roster the way a dead one does,
with its own label.

**World.** The body placeholder is a `game/` mesh at `summitBody`. The Hollows need no new
rendering: the watcher and the fork Hollows are enemies the entity views already add and remove, in
the shipped placeholder model. The poster is drawn on the register post that exists.

**Wire, protocol 5.** Snapshot: the `items` section removed; a `phase` byte added; the per-player
lamp byte gains the `safe` bit. `stare` stays. `AiState` gains `Watch` and `Emerge`; the enemy byte
carries them. Old-protocol peers are refused at the lobby, as every bump has been.

**Determinism.** Every draw the loop makes — watcher placement, the guide, the order of cuts —
comes from `nextRandom(state)`, so a seed and an input log replay the same match on the host.
`serializeWorldState` adds `phase`, `safe` and the new enemy states and leaves the guide and the
cuts out, as it leaves the Hollow's route out today.

## 8. Architecture

A phase machine over the shipped parts, chosen over rewriting the enemy layer (a cleaner
`HollowState` would have put a codec, entity-view and model refactor in the same diff as the
redesign) and over a client-side watcher (the stare kills, so the watcher must be host truth).

| Piece | Module | Change |
| --- | --- | --- |
| Phase, safety, the end | `sim/world.ts`, `sim/register.ts` | `phase` and `safe`; the end rule replaces the win at the car; the poster interactable |
| The Hollows | `sim/hollow.ts` | `Watch` and `Emerge` beside `Hunt`; the crawl, bind, split and merge deleted; the treeline clamp; retargeting |
| The cut | `sim/trailRoute.ts` (+ a `sim/cut.ts` if it outgrows it) | the guide walk, the residual-graph route, the cut rule |
| The trail | `sim/trailBuild.ts`, `sim/trail.ts` | the braid stages, `forks`, `homeDist`, `shortestHome`, the new edge kinds |
| The wire | `net/protocol.ts` | protocol 5 |
| Escalation | `game/escalation.ts` | the world input |
| Screens | `game/registerPanel.ts`, `game/script.ts`, the end screen, `game/roster*.ts` | the poster, the passages, the groups, the safe label |
| The body | `game/` | the placeholder mesh |

`EnemyState` keeps its generic fields; a few go unused on a Hollow. That is the cost of not
rewriting the layer now.

## 9. Build order

Four sub-projects, each with its own plan, subagent-driven build, browser pass, push and deploy,
in this order. Each leaves the game playable.

| # | Sub-project | Sections | Status |
| --- | --- | --- | --- |
| T2 | Loops and braids | §3 | Not started |
| S1 | The summit loop: phase, poster, body, discovery, the summit Hollow, safety, the end, escalation, protocol 5 | §2, §5.1, §5.2, §6, §7 | Not started |
| S3 | The cut: the guide, the fork cuts, `Emerge`, the fork Hollows | §5.3 | Not started |
| S2 | The watcher | §4 | Not started |

After S1 the game is: climb unstalked, find the body, one Hollow chases you home. S3 makes the
descent the maze; S2 gives the climb its stalker. S3 goes before S2 because the chase is the heart
of the loop.

## 10. Verification

**Unit.** Everything each section names, plus a **whole-run test** on the seed `hollow`: script one
player up the stem by teleport, assert the watcher's sightings, the flip at the crest, a cut at
every fork on the guide, and the end rule for all three group shapes. The sim is deterministic, so
this is a plain vitest.

**Sweep.** §3.5's trail gates and the guide-length band, ~200 seeds, red before and green after.

**Wiring.** The source-text tests on `app.ts` are updated, not deleted.

**Browser pass**, on the register play rig (host `__tp` for any player, the aiming page driver,
seed `hollow`): see the watcher and lose it; die of the stare on the climb; the reveal at the
summit; a fork cut with the Hollow stepping out; outrun the pack by sprinting and get caught by
walking; the treeline stop at the road; the end screen for all three group shapes; a two-page match
for the shared flip. The pacing numbers — 6.3, 0.6, the reveals, the watcher's ranges — are the
spec's starting values, tuned there, and what moves is recorded in the Status line.

## 11. Boundaries

Not in this spec: the wendigo model and the body as real assets (placeholders here); the headlamp's
charge; the dead player's view (P); the audio of the watcher and the pack beyond what the
escalation model already drives; any change to the sign posts, the road wall or the car. F (tape
and leash) is on hold and unaffected.
