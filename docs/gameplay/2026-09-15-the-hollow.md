# The Hollow — sub-project C

**Date:** 2026-09-15
**Status:** Designed 2026-09-15; not built.
**Parent:** `docs/gameplay/2026-09-08-register-and-hollow.md` §6, §7, §12, §14, §17. Amends the
parent: §6.1 (one entity → one per hunted player, floor one), §6.3 (standing still is *slower*, not
safe: the Hollow crawls toward the trailhead from tick 0), §6.6 (looking slows it *and* costs the
stare, which can kill), §13.7 (decided here), and the §17 table.
**Depends on:** A (the trailhead and the trail graph), T (the trail system), B (the register and
the count, `docs/gameplay/2026-09-15-register-and-count.md`).

## 0. What this is

The threat. B made a world that can be won; this makes it a world that can be lost. One figure
walks the trail from the first tick, slowly, toward the car. Picking up a hiker binds it to you
and it comes at a pace you cannot walk away from. It cannot be fought or stopped, only slowed —
by looking at it, which darkens your sight and, held too long, ends you. Contact kills, and death
is permanent: the fallen stay in the match to watch, once P gives them a view. When every player
is dead the match is lost.

## 1. Decisions

Taken 2026-09-15, in the order they were made.

1. **It crawls toward the trailhead from tick 0**, very slowly, and never idles (amends parent
   §6.3). Time alone brings it closer; the clock is the length of the stem.
2. **A pick-up binds it to the carrier**: it turns toward that player and walks at a pace above a
   walk and below a sprint (parent §6.3–6.4). Doing the objective is what draws it.
3. **One Hollow per hunted player.** With two carriers there are two Hollows; the second steps out
   of the nearest one. The count converges back to one as hunts end (amends parent §6.1).
4. **A put-down releases nothing.** A hunt is bound to the *player*, not the item, and ends only
   when that player signs a hiker out at the box or dies. Every pick-up is a commitment.
5. **Splits step out of the nearest Hollow; released ones walk back and merge** with the nearest
   other Hollow on contact. Nothing pops in or out.
6. **It may leave the trail**: a graph walk to the node nearest its target, then a straight
   approach over the ground. Off-trail is never a refuge.
7. **Death is a fade to one passage, and the dead stay in the match** as peers (B §1.4: permanent).
   The passage is Poe-like prose that closes that player's story (§5.3).
8. **Looking slows it, and darkens the screen — to death.** A per-player *stare* fills while a
   Hollow is in view and kills at full (decides parent §13.7, extends §6.6).
9. **When the crawl reaches the pad it turns and crawls back up the stem**, forever: a slow
   pendulum, pad to crest to pad.
10. **A Hollow is an enemy.** It lives in `state.enemies` as an `EnemyState` with new `AiState`
    values, so the snapshot's enemy channel, cloning, the fingerprint and the enemy view all carry
    it unchanged; the rules live in one new module, `sim/hollow.ts`, and `sim/ai.ts` stays the
    sandbox's chaser.
11. **A hunt ends on the hunted player's own sign-out** of any hiker — "completes the register" read
    as their sign-out, not the whole book. (Carried in from the design; not asked separately.)

## 2. The rules

### 2.1 Count and states

There is always at least one Hollow. Each *hunted* player has exactly one Hollow bound to them; a
Hollow with no hunt is *free*. Count = max(1, hunted players). A Hollow is in one of three states:

| State | Who | Target | Speed |
| --- | --- | --- | --- |
| **Crawl** | free | the stem, pad ↔ crest, reversing at each end | `HOLLOW_CRAWL_SPEED` |
| **Hunt** | bound to player P | P | `HOLLOW_HUNT_SPEED` |
| **Merge** | free, not the last | the nearest other Hollow; removed on contact | `HOLLOW_HUNT_SPEED` |

At tick 0 one Hollow stands on the crest, crawling down.

### 2.2 Binding and release

On player P's **first pick-up** (P not already hunted): if a free Hollow exists, the nearest free
one — by horizontal distance, ties by lower entity id — takes the hunt; otherwise a new Hollow is
created at the position of the nearest Hollow of any state, already hunting P.

A hunt on P is **released** when P signs any hiker out at the box (B's `signOut`) or P dies. The
released Hollow goes to **Merge** if another Hollow exists, otherwise to **Crawl**, resuming the
pendulum from its nearest stem node in the direction that continues its last crawl (down, at
birth). A Hollow whose merge target vanishes retargets the nearest other Hollow, or crawls if none.

Put-downs, hand-offs (put down, picked up by another) and a second pick-up by an already hunted
player change nothing. A second player's first pick-up while the first is hunted is what splits.

### 2.3 Contact kills

Any **living** player whose hull touches a Hollow's dies that tick: horizontal distance below
`PLAYER_HALF.x + ENEMY_HALF.x + HOLLOW_CONTACT_MARGIN` and vertical overlap of the two hulls.
Hunted or not. Death is permanent (§4.3).

### 2.4 Looking slows it; the stare

A Hollow is **seen** by a player when the Hollow's centre lies within `HOLLOW_LOOK_HALF_ANGLE` of
the player's aim ray, within `HOLLOW_LOOK_RANGE` of the eye, and `hasLineOfSight` holds between
eye and centre (the existing raycast in `sim/ai.ts`). A Hollow seen by at least one living player
moves at `HOLLOW_LOOK_FACTOR` of its state's speed that tick.

Each player carries a **stare**, 0 to 1. While the player sees any Hollow it rises by
`1 / (HOLLOW_STARE_FILL_S · SIM_TICK_HZ)` per tick; otherwise it falls by
`1 / (HOLLOW_STARE_EMPTY_S · SIM_TICK_HZ)`, clamped. At 1 the player dies. The screen darkens with
it (§5.2). Dead players do not see, and their stare holds at whatever it was.

### 2.5 Loss

When the world has at least one player and every player is dead, `outcome` becomes `Lost`. Like
the win, it is final for the match: each screen already holds its passage, and the match returns
to the landing after `LOSS_LANDING_MS`.

### 2.6 Dials

All in `sim/hollow.ts`, exported:

| Constant | Value | Why |
| --- | --- | --- |
| `HOLLOW_CRAWL_SPEED` | 0.8 m/s | a 600 m stem takes ~12 minutes one way |
| `HOLLOW_HUNT_SPEED` | 6.0 m/s | above `WALK_SPEED` 5.25, below `SPRINT_SPEED` 7 |
| `HOLLOW_LOOK_FACTOR` | 0.35 | seen, it moves at about a third |
| `HOLLOW_LOOK_HALF_ANGLE` | 20° (cos 0.9397) | it must be near the centre of the view, not the edge |
| `HOLLOW_LOOK_RANGE` | 120 m | beyond the mist's usual reach; a silhouette is enough |
| `HOLLOW_STARE_FILL_S` | 6 s | a long look, not a glance |
| `HOLLOW_STARE_EMPTY_S` | 3 s | looking away recovers at twice the rate |
| `HOLLOW_CONTACT_MARGIN` | 0.1 m | the hulls need not interpenetrate |
| `HOLLOW_MERGE_RADIUS` | 1 m | merge on touch |
| `HOLLOW_WAYPOINT_RADIUS` | 1.5 m | a node counts as reached |
| `HOLLOW_APPROACH_RANGE` | 25 m | leaves the graph for the target within this, with line of sight |
| `HOLLOW_LOST_SIGHT_S` | 3 s | off the graph, without sight this long, it re-routes |
| `HOLLOW_HEIGHT` | 2.6 m | the placeholder's height (§5.1) |
| `LOSS_LANDING_MS` | 8000 | the win uses 5000 |

## 3. Navigation

### 3.1 The graph is the map

`TrailGraph` (`sim/trail.ts`) holds nodes with ground heights, edges with lengths, and `stem` as the
ordered pad→crest edge chain. A new `sim/trailRoute.ts` does one thing: `route(graph, from, to)`,
the shortest node path by summed edge length, Dijkstra with ties broken by the lower node index,
memoised per graph (the graph never changes for a world). `nearestTrailNode` already exists.

### 3.2 Movement

A Hollow moves through `stepMovement` with a synthesized command, exactly as `ai.ts`'s `move`
does: face the waypoint (`atan2`, the one trig call the sim already allows for facing), wish
forward scaled so the result is the state's speed, with the enemy hull, the world's boxes, water
level and ground. It inherits sliding, step-up and ground following. It is placed only at birth.

### 3.3 Waypoints and the approach

Each Hollow holds a route (node indices), an index into it, a stem direction, an *approach* flag
and a lost-sight timer — host-only fields on `EnemyState`. It advances to the next node within
`HOLLOW_WAYPOINT_RADIUS` horizontally.

- **Crawl:** the route is the stem chain in the current direction; at either end the direction
  flips and the route is rebuilt from the same node.
- **Hunt:** route = `route(graph, ownNearestNode, targetNearestNode)`, rebuilt whenever the
  target's nearest node changes. The approach begins when the route is exhausted or the target is
  within `HOLLOW_APPROACH_RANGE` with line of sight: the Hollow leaves the graph and walks straight
  at the target's position. Off the graph it keeps the lost-sight timer: while it cannot see the
  target the timer runs, and at `HOLLOW_LOST_SIGHT_S` it drops the approach and re-routes from its
  own nearest node.
- **Merge:** Hunt, with the nearest other Hollow's position as the target.

### 3.4 Stuck

`ai.ts`'s stuck detection is kept unchanged: no squared-distance progress toward the current
waypoint for 1.5 s starts a 0.7 s sidestep. The fields are already on `EnemyState`.

### 3.5 Determinism

Every read is sim state; every choice has a tie-break (lower id, lower node index); randomness
only through `nextRandom`; trig only `atan2` for facing, as `ai.ts` already does. Two worlds fed
the same inputs with a hunt in progress stay byte-identical (§6).

## 4. State and the wire

### 4.1 Per Hollow

An `EnemyState`. `ai` ∈ {`Crawl`, `Hunt`, `Merge`} (new `AiState` values after `Dead`);
`targetId` is the hunted player (Hunt) or the other Hollow (Merge), 0 otherwise; `stateTimer` is
the lost-sight timer; `lastDistSq`, `stuckTimer`, `unstickTimer` as today. New host-only fields,
outside the snapshot and the fingerprint like the stuck fields: `route: number[]`, `routeAt`,
`stemDir` (+1 toward the crest, −1 toward the pad), `approach: boolean`. `health` is
`ENEMY_MAX_HEALTH` and nothing changes it.

### 4.2 Per player

`stare: number`, 0 to 1, host truth (§2.4). On the wire as one byte (`round(stare · 255)`); the
client's reconcile copies it onto the predicted local player as it copies `signOutTicks`, so the
screen and the death agree with the host.

### 4.3 Death, permanent

`isDead` is `health <= 0`. `updateRespawns` becomes `updateDeaths`: on the tick a player's health
first reads 0 it drops their item at their feet (B's `putDown`), zeroes velocity and records
`deathPos`; nothing brings them back. `respawnTimer` stays in the state and on the wire, always 0
(the codec is untouched by it), and `pickRespawn` and the respawn ring go. This holds on every
level, the sandbox included.

### 4.4 Per world and per match

`World` gains `trail: TrailGraph | null`, set by `createForestWorld` (`createSigns` in `app.ts`
reads it instead of recomputing the graph). `Outcome` gains `Lost = 2`. On forest worlds the
director does not run; `updateHollows` does.

### 4.5 The tick, host only, after every player has moved

1. `stepHollow(hollow)` for each Hollow, in id order: route upkeep, movement, stuck.
2. `updateHollows`: contact kills; the stare and the per-Hollow *seen* flag for next tick; binding
   on new carriers, splits, releases, merges; the loss.
3. `updateDeaths`.
4. `stepRegister` (B), so a death's drop precedes the win check as today.

### 4.6 On the wire

`PROTOCOL_VERSION` 3 → 4. Player entries grow by one byte (`stare`); enemy entries are unchanged
(`ai` carries the new states, `health` rides as today). `Lost` is a value of the existing outcome
byte. `GEN_VERSION` is unchanged: the world is the same.

## 5. What the player sees and hears

### 5.1 The placeholder

A 2.6 m capsule, matte black, unlit, with **fog disabled on its material**, drawn by
`entityViews` when an enemy's `ai` is a Hollow state (instead of the creature model or the violet
capsule). No fog means it stays a silhouette at any distance in mist — a still, dark, upright shape
against the sky or the far trees, which is what makes it findable in hindsight from Act 1. It
faces the way it walks. Nothing else: no eyes, no animation, no sound of its own. E owns the look.

### 5.2 The stare on screen

`post.update` gains `stare`. As it rises the vignette closes in and the image darkens, black at 1:
`vignetteWeight` toward its maximum and a lift toward black, both eased. No other channel. The
prompt, the HUD and the party roster stay readable until the end.

### 5.3 Death and loss

On the first frame the local player's health reads 0: input is suppressed, the book closes, the
view fades and holds the death passage. The scene keeps rendering beneath the fade and the session
stays connected — P will replace the fade with the living players' views. The pause menu and Exit
keep working. When `outcome` reads `Lost`, the passage stays and the match returns to the landing
after `LOSS_LANDING_MS`.

The passages, in `registerHud.ts` beside `WIN_LINE`, original prose in Poe's cadence:

- **`DEATH_LINE`** — *"The woods had counted you among the missing before you knew that you were
  lost."*
- **`LOSS_LINE`** — *"Nobody signed out. The book was closed from the bottom, by a hand that was
  not a hand, and the woods went back to counting."*

J owns the full set of passages; C ships these two.

### 5.4 Sound

Nothing new. The existing pick-up, put-down and pen sounds stand; E adds the Hollow's tells.

## 6. Tests

**`client/test/sim/trailRoute.test.ts`** — on a hand-built graph (a stem of five nodes and one
loop off its middle): the pad↔crest route is the stem chain; a loop edge is taken when it is
shorter; an equal-length tie takes the lower node index; the route from a node to itself is
`[node]`; the memo returns the same array for the same graph and endpoints.

**`client/test/sim/hollow.test.ts`** — on the same graph with a flat `GroundField` and no boxes:
the crawl reverses at the pad and at the crest; the first pick-up binds the nearest free Hollow; a
second carrier's first pick-up creates a Hollow at the nearest Hollow's position hunting them; a
second pick-up by a hunted player binds nothing new; put-down releases nothing; the hunted player's
sign-out releases; their death releases; a released Hollow with another present merges and is
removed on contact; the last released Hollow crawls from its nearest stem node; contact kills a
hunted player and an unhunted one; the dead stay dead with the item at their feet; a seen Hollow
moves at 35 %; the stare fills in 6 s of looking, empties in 3 s, and kills at 1; `Lost` when the
last living player dies and not while one lives; a world with no players is never lost.

**`client/test/sim/world.test.ts`** — the determinism test runs two worlds with a Hollow hunting a
moving player for 600 ticks; the clone and the fingerprint cover `stare`; a dead player has no
respawn after `RESPAWN_SECONDS` of ticks.

**`client/test/sim/hollowWalk.test.ts`** — 50 seeds: a Hollow placed on the crest, crawling at hunt
speed for a tick budget proportional to `stemLen`, reaches within 5 m of the pad — the trail is
walkable by `stepMovement` at the enemy hull on real terrain.

**`client/test/net/protocol.test.ts`** — `stare` round-trips at 1/255; the byte sizes; a Hollow
state and `Lost` decode to what was encoded.

**`client/test/game/`** — the post record darkens monotonically with `stare` and is black at 1;
the death overlay opens once on health 0 and never on a respawn (there is none); the loss timer
navigates once.

**In the browser, before shipping:** the silhouette on the stem from the pad at tick 0; a pick-up
turns it; the stare closes the vignette; a death and its passage; two carriers, two Hollows, and
the merge; the loss.

## 7. Boundaries

- **D (escalation)** reads `retrievedCount` and will scale C's speeds; C ships them as constants.
- **E (dread stack)** replaces the stare's vignette with the warp, adds whispers and the wildlife
  silence, and redoes the placeholder's look.
- **P (preview mode)** turns the dead peer's held fade into the living players' views; C keeps the
  dead player's session and render loop alive for it.
- **J (endings and polish)** owns the full set of passages and the tuning of the look.
- **Out of C:** the Hollow's identity (parent §13.2), any real asset, altitude as an axis, the
  win's counterpart passage (parent §13.8).
