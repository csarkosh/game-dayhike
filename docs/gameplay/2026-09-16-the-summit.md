# The summit — the core loop, redesigned

**Date:** 2026-09-16
**Status:** Designed; T2 built 2026-09-16, S1 built 2026-09-22, S3 built 2026-09-25 (see §9). What moved in T2's execution: the top fork sits
below the peak's dome, not in the 0.75–0.85 band, with a floor of 0.5, a three-rung ladder 60 m of
stem apart tried on both sides, and a least span of 240 m between the forks (§3.2 records why);
rungs are 2–3 per pair and may end on a loop's bed when their strand target is walled off; a strand
or rung whose bed would stand more than 1.5 m off the ground is dropped; loops off the extra
strands were deferred (§3.2). Measured density on the 227-seed sweep, in place of §3.5's targets:
162 of 227 worlds build a strand, 101 a rung; forks per world 0:18 2:32 3:4 4:61 5:8 6:57 7:8 8:30
9:3 10:6 — 39 worlds reach eight, the floor is 15 %. The 8–18 fork band of §1 is met on 17 % of
worlds (39 of 227); raising it is the density follow-up. A guide route in the 1.5–2.5× band exists
on 132 (58 %, floor 55 %), and on the rest the guide returns the longest of its walks under the cap;
571 bed pairs on 142 worlds sit closer than the 16 m corridor gap (never under 4 m, so beds never
overlap) because the simplifier's gap test works in cell space — a world-space test there is the
follow-up that would raise every one of these numbers; build time about 400 ms a seed.
What S1's build ruled, amending the sections below: the Poe passages leave
`game/registerHud.ts` for a new `game/passages.ts`, which the end screen's three passages join;
the roster is untouched (it is the lobby's party list and carries no dead-versus-living state), so
the end panel is the only place the groups show; `PlayerState.respawnTimer` leaves the wire and
the state with this bump, making the snapshot's player record id, pos, vel, yaw, pitch, health,
grounded, a lamp byte, a flags byte whose bit 0 is `safe`, and the stare; nothing mapped a lobby
member to an entity id, so protocol 5 adds a `Named { entityId, peerId }` event that the host
sends a joining peer for every current pairing (its own and the newcomer's included) and sends
everyone else for the newcomer, with the local player named "You"; a Hollow with no living,
unsafe target stands where it is facing the pad, a third `AiState.Stand` rather than an Emerge
with no timer, and `AiState.Crawl` and `AiState.Merge` are deleted with their numbers 4 and 6 left
unused; `roadLine` survives with the wall, reading "Not yet. Somebody is still up there." on the
climb and nothing in the chase, because reaching the corridor is its own line on the end panel;
and the sign posts stay, reading the summit as their one site, while the trailhead board's lines
become the poster's — the poster's date and the number to call (§7) are deferred, and the
placeholder shows the name and "last seen" lines only. Three more rulings came out of the build itself: the safety pass runs at the
top of the authoritative tail, before the Hollows step rather than after them, so a player who
crosses onto the corridor cannot be killed by contact in the tick they reach it (discovery and the
end rule stay at the tail; deaths are settled before the summit step, so a contact kill and the end
it causes land on the same tick); a Hollow that ever finds itself on safe ground walks out instead of freezing;
and the stare is unchanged for everyone, safe or not — looking back from the road still costs the
screen — while contact never touches a safe player. As first built, the walk out allowed a step that strictly
increased the Hollow's distance from the road's centreline even from inside the corridor, which froze a Hollow
whose route began at the trailhead, deeper inside; since 2026-09-25 a Hollow inside ignores its route and walks
straight across to its own side's edge, and a route node on the corridor is passed for the next, when there is one,
once the treeline refuses a step toward it. What S1's execution measured: on the seed
`hollow` the stem node before the crest stands 11.3 m from the body, inside the 12 m discovery
radius, so the find can come one node short of the crest. What S3's build measured, on the fifty
seeds `hollow0..49` walked crest → pad along the guide: the pack at the pad is the summit Hollow
plus 0–10 — five in all on the median seed, eleven at most; the guide lands in its 1.5–2.5× band
on 29 of the 50 (58 %), the same share as before the walk was told to visit no node twice; one
seed (`hollow29`) stands a fork on the road corridor, and that fork is never cut. On `hollow` the
guide runs 36 → 0 over 54 nodes and 2013 m, meets its forks in the order 37, 22, 79, 78, 2, and
walking it closes six branches: a pack of seven. That walk sharpened two rules (§5.3): a fork's
trigger has to be on one of its branches with no other open edge nearer, and never on a closed
one; and the guide's edge out of a fork is opened only while the guide beyond it still reaches
the pad on the residual graph.
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
| The trail | **Loops and braids**: the shipped stem-and-loops plus 2–3 parallel strands below the crest, cross-linked by rungs. 8–18 forks. |
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
A player who leaves the match is removed and appears in neither group: the dead stay as peers,
leavers are simply gone.

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

At a **top fork** on the stem — at stem progress 0.75–0.85, seeded, **or where the stem enters the
peak's disc less a margin, whichever is lower** (amended 2026-09-16: on most seeds the band lies inside
the dome, whose skirt has no walkable ground to leave the stem laterally — measured, 76 of 227 seeds
could not route a strand from any fork inside it), so the final climb to the crest, the whole dome, is
one trail — never below a floor of progress 0.5, and tried on a three-rung ladder descending 60 m of
stem at a time, each rung on both sides, before a strand is dropped; a fork pair must leave at least
240 m of stem between the forks (a rung needs 360 m of span: the 120 m gap at each fork and between
rungs; a shorter braid builds strands without a rung) — the stem splits into **2–3 strands**
(seeded, weights 0.6 / 0.4 for 2 / 3) that descend roughly in parallel, 80–200 m apart laterally,
and rejoin at a **bottom fork** near the pad (progress 0.08–0.15). The original stem is strand A.
**Rungs** connect adjacent strands at seeded heights: 2–3 per adjacent pair, at least 120 m of
descent apart, each running between the nearest points of the two strands at that height.

Loops keep hanging off the stem as today, and their two junctions are forks like any other. Strands
and rungs treat every meadow's and pond's disc plus its apron as forbidden ground, so no strand cuts
through a meadow its loop circles; the peak's dome is walkable, and a bed that would stand more than
1.5 m off the ground on its skirt is dropped instead. Loops off the other strands are a
**follow-up**, not part of T2 (decided 2026-09-16 while planning): the fork band is met without them,
and they need the loop stage made generic over its spine, a refactor of a carefully measured stage
with its own risk.

### 3.3 The builder

Per seed, in this order, each stage seeing the ground the earlier ones made:

1. **Peak** and **stem**, as shipped.
2. **Loop features and loops**, as shipped, attached to the stem: the seeded N ∈ {1, 2, 3} loops
   with their kinds.
3. **Strands.** Choose the top and bottom fork points on the stem (the stem is split there, as a
   loop's junctions split it). For each extra strand, Dijkstra top → bottom on the walkability grid
   on a seeded side of the stem, the lateral band 80–200 m preferred by weight, the existing trail
   forbidden except at the two forks, reusing the reroute machinery and the composed fine check. A
   strand that cannot route within `TRAIL_REROUTE_MAX` tries is dropped and the count shrinks.
4. **Rungs.** For each adjacent strand pair, seeded heights between the forks, spaced ≥ 120 m of
   stem apart; Dijkstra between the two strands' nearest points at that height, held within
   ±100 m of it; a rung that fails to route is dropped, never forced.
5. **Annotate** (§3.4).

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
- Every constant above lives in `BRAID_TUNABLES`, folded into the level id beside `FEATURE_TUNABLES`.

### 3.5 Gates

On a ~200-seed sweep of the composed field (red before, green after — never a handful of probe
seeds):

- connected; the crest is the only dead end (every other node has degree ≥ 2);
- forks never exceed 18; at least 15 % of worlds reach 8 forks (measured 2026-09-16);
- a loop on ≥ 75 % of worlds, as today;
- a guide route with length in [1.5, 2.5] × `shortestHome` exists from the crest on at least 55 % of
  worlds, and on the rest the guide returns the longest of its walks under the cap
  (measured 2026-09-16);
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
would put it within `ROAD_CORRIDOR_HALF` of the road centreline is refused; one that is already
inside walks straight across to its own side's edge, ignoring its route until it is clear; and a
Hollow whose target is safe retargets as above or stands at the edge, facing the pad. `safe` is computed per
player per tick from the road distance (§2), rides the snapshot as a bit beside the lamp, and is
what the roster and the end rule read.

### 5.3 The cut (S3)

**The guide.** On the discovery tick the host draws a hidden **guide route** crest → pad: a seeded
random walk on the trail graph from the world RNG that never repeats an edge and may run round a
loop's far side, choosing at each fork uniformly among the branches that can still reach the pad
without a repeated edge. A walk is accepted when its length lands in
[`GUIDE_MIN`, `GUIDE_MAX`] × `shortestHome` (1.5, 2.5). Up to `GUIDE_TRIES` (64) walks; failing
that, the longest found under `GUIDE_MAX`; failing that, the shortest path (the sweep shows this
does not arise on the 227-seed set). Since 2026-09-25 the walk also never visits a node twice: a
try with no move left under that rule simply fails, and the guide's edge into a fork and out of
it are each one edge, as the cut below assumes. No one sees the guide. It is how the cuts know
which way is "the one path", and it is what makes the way home medium-to-long rather than the
stem.

**Cutting a fork.** During Chase, when any living, unsafe player comes within `FORK_CUT_RADIUS`
(9 m; 30 m as designed, moved 2026-09-25) of an uncut fork, that fork is cut, once, for the whole
party, for the rest of the match. Nine metres, because the fork Hollow takes about two seconds to
reach its mouth and nine metres is under two seconds at a walk: a player who keeps moving through
the fork is past it before the Hollow stands, and it hunts them from behind; at thirty metres it
met them at the fork head-on, sprinting or not. The **arrival** branch is the edge that player is on (nearest by `segmentDistance`). Sharpened
2026-09-25: the player has to be on one of the fork's branches, not merely near the fork — within
`TRAIL_CORRIDOR_HALF` (7 m) of the branch, with no other open edge of the trail strictly nearer,
because the next edge along comes within the half-width of a branch wherever the two share a
node — and a closed branch is nobody's arrival: the Hollow that closed it is the fork's answer to
whoever walks it. On the node itself every branch ties, and the tie goes to the lower edge index.
When two players qualify, the nearer one is the trigger, ties to the lower id. A fork that itself
stands on the road corridor is never cut: it is safe ground, and nobody is hunted there; it is
recorded as judged the first time a player reaches it, with nothing closed (2026-09-25). Then:

- if the fork is on the guide and the arrival branch is the guide's edge into it, the **open**
  branch is the guide's edge out of it — while that edge is still open and the guide beyond it
  still reaches the pad on the residual graph without coming back through the fork (since
  2026-09-25: a fork cut before the guide came to it, by a stray or by a player on another
  branch, can have closed the guide's own way on, and then the fork is judged as below);
- otherwise — the player strayed, or is a straggler still climbing — the open branch is the
  non-arrival branch whose route to the pad on the **residual** graph (every closed branch of every
  cut fork removed) is shortest, with ties, and near-ties within `GUIDE_REJOIN_SLACK` (60 m),
  broken toward the branch whose way home reaches its first guide node in the fewest metres from
  the fork (amended 2026-09-25: every way home ends on the guide's tail, so "rejoins the guide"
  alone cannot tell them apart), then the cheaper, then the lower edge index. The branches are
  costed with the fork's own edges left out, so a way home never comes back through the fork it
  leaves; for a straggler at a fork the whole upper trail hangs on, they are costed once more
  through the fork and the arrival, skipping any branch that is itself a dead end. Straying costs
  the extra Hollow behind you; the maze funnels you back, it never traps you.

Every other branch is **closed**. A closed branch is a Hollow, not a wall: a player can still enter
it, and it hunts them if they do. The crest stays the world's only dead end. A closed branch is
closed at both ends: an edge joining two forks, closed at the first, is not a candidate at the
second and is never closed twice (2026-09-25). A fork is never a trap at the moment it is cut: the
open branch reaches the pad on the residual graph at cut time, and if no branch but the arrival
does, the fork is recorded as cut with nothing closed. Later cuts elsewhere can put a Hollow on
that route — two players on different branches can arrange it — never remove the trail: a closed
branch is walkable (reworded 2026-09-25).

**The fork Hollow.** One per closed branch (a 4-way hub gets two). It spawns `FORK_SPAWN_DIST`
(12 m) into the closed branch on the bed, walks to the mouth of its branch — `FORK_MOUTH_DIST`
(3 m) in from the fork, since 2026-09-25, so a player passing the fork is out of its contact reach
— at hunt speed in `AiState.Emerge`, stands `FORK_REVEAL_S` (1 s) there facing the player who
triggered the cut, then hunts them under §5.1's rules. If they have already passed, it is behind
them; if they hesitate, it is on them. No Hollow ever steps out on safe ground, or on a player (2026-09-25): when the branch enters
the road corridor sooner, or ends sooner at another node, it steps out `FORK_SPAWN_CLEAR` (1 m)
short of that, and never within `FORK_SPAWN_PLAYER_CLEAR` (2 m) of a living player — it moves on
along the bed until it is clear, within the same limits; a branch with no such point at least
`FORK_SPAWN_MIN` (2 m) in cannot be closed and stays open. The walk to the mouth is the reveal,
not the hunt: being looked at does not slow it, and it is bounded — on reaching the mouth, or once
stuck for `STUCK_SECONDS`, or after `FORK_EMERGE_MAX_S` (6 s) of walking, the Hollow stands where
it is (2026-09-25). Contact and the stare apply throughout, as to any Hollow.

**The look (2026-09-25).** The Hollow is drawn as a very dark, lit shape rather than an unlit
black one: near-black, fully rough, with a faint emissive floor so it has an edge against a black
sky, and fog off, so the headlamp, the sun and the sky light catch its form on the same falloff as
everything else. The colours are knobs in `game/hollowLook.ts`.

**Pack size.** On a typical guide, the summit Hollow plus 5–8 was the estimate. Measured
2026-09-25 on the fifty seeds `hollow0..49`, walked crest → pad along the guide on today's trails:
the summit Hollow plus 0–10, five in all on the median seed, eleven at most; seven on `hollow`.
Raising the fork count is the density follow-up (§3.5). §5.1's pacing is what keeps the pack a
wall of pressure rather than a race lost.

**State.** `cuts: Map<number, number>` (fork node → open neighbour node, or -1 for a fork judged
with nothing open), `guide: number[]` and `closed: Set<number>` (the edges closed so far) on the
world, host-only, off the wire and outside the fingerprint, like the Hollow's route; the fork
Hollow's destination, `EnemyState.emergeTo`, likewise.

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
| T2 | Loops and braids | §3 | Built 2026-09-16 (docs/trail/2026-09-16-loops-and-braids-plan.md) |
| S1 | The summit loop: phase, poster, body, discovery, the summit Hollow, safety, the end, escalation, protocol 5 | §2, §5.1, §5.2, §6, §7 | Built 2026-09-22 (docs/gameplay/2026-09-16-the-summit-loop-plan.md) |
| S3 | The cut: the guide, the fork cuts, `Emerge`, the fork Hollows | §5.3 | Built 2026-09-25 (docs/gameplay/2026-09-25-the-cut-plan.md) |
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
