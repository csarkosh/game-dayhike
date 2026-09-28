# Trail 14 — the trailhead, rearranged

**Date:** 2026-09-28
**Status:** Designed, not built.
**Amends:** `docs/trail/2026-09-11-trail-system.md` (the pad's props and the spawn) and
`docs/gameplay/2026-09-16-the-summit.md` §7 (the poster's line). The trail graph, the pad, the
road wall and the notice board's site are unchanged.
**Depends on:** the trail system (the pad and the stem), the fork signs (`sim/signs.ts`,
`game/signMeshes.ts`), the summit loop (the poster, the body, the car).

## 0. What this is

A match opens on the pad, and the first thing a player sees decides whether they know where to
go. Today they face along the road, the car is 12 m off to one side, and nothing marks the
trail's start.

After this change a player arrives **facing the trail**, with **the car behind them** and a
**sign reading "Trail 14" at the trail's entrance, turned toward them**. The trail has a name,
and the poster and the README use it.

The same change removes the last trace of the sign-out book. Players see none of it today, but
the code that holds the poster, the body's place and the car is still named for a register. It is
renamed for what it holds.

## 1. Decisions

| Question | Decision |
| --- | --- |
| Where the player faces | The trail's entrance: the point where the stem's first edge crosses the pad's rim. |
| Where the car stands | On the road's shoulder at the pad, parallel to the road, directly behind the player. |
| Where the player stands | On the straight line from the car to the entrance, 2.5 m clear of the car. |
| The sign | A fork-sign post with one plank reading `Trail 14`, beside the bed at the entrance, its face toward the player. |
| The sign's model | The shipped `sign.post` and `sign.arm`. No new model. |
| The notice board | Stays where it is, its poster facing the pad. |
| The trail's name | **Trail 14**, wherever a player reads it: the sign, the poster, the README. |
| The trail builder | Untouched. The layout follows the trail; the trail does not turn to suit the layout. |
| The code's names | `register` becomes `search` (§5). Numbers on the wire do not change. |
| The wire | Protocol 5 stands. |
| The level id | Moves (§6). Invite links made before the change stop working, as on every layout change. |

## 2. Measured

Every number here was read from the world generator over the 227 seeds of
`client/test/sim/trailGateSeeds.ts`.

### 2.1 How the trail leaves the pad

| Measure | Reading |
| --- | --- |
| Edges at the pad's node | 1 on every seed, the stem's first |
| Length of that edge | 11.4 m at least, 67.9 m at the median |
| Its angle off "straight inland", in the road's own frame | 18.4° at the median |
| Seeds within 30° of straight inland | 132 |
| Seeds between 75° and 92° | 24 |

The first edge is longer than the pad's radius (8 m) on every seed, so the bed is a straight line
from the pad's centre to its rim, and the entrance is one point.

On 24 seeds the trail leaves the pad nearly parallel to the road. A layout fixed in the road's
frame, as the car and the board are today, cannot put the car behind a player who faces such a
trail. That is why the player's place is derived from the car and the entrance (§3.2).

### 2.2 The layout of §3, on every seed

| Measure | Least | Median | Most |
| --- | --- | --- | --- |
| The car, off "directly behind" the player's facing | 0.08° | 1.96° | 4.07° |
| The entrance, off the centre of the player's view | 0.08° | 1.96° | 4.07° |
| The player's facing, off the trail's own direction | 0.06° | 1.00° | 18.63° |
| The sign, off the centre of the player's view | 11.11° | 16.37° | 33.48° |
| The sign, from the player | 3.45 m | 6.90 m | 6.95 m |
| The player, from the entrance | 3.44 m | 6.67 m | 6.74 m |
| The player, from the car's box | 1.74 m | 2.48 m | 2.50 m |
| The player, from the board's box | 3.53 m | 6.32 m | 11.53 m |
| The player, from the road's centreline | 7.88 m | 10.25 m | 10.54 m |
| The bed's centreline, from the car's box | 1.19 m | 1.20 m | 1.43 m |
| The sign, from the board's box | 3.24 m | 9.28 m | 15.60 m |
| The sign, from the car's box | 5.76 m | 9.08 m | 9.39 m |
| The sign, from the road's centreline | 6.94 m | 16.79 m | 17.58 m |
| How far the car slides along the road (§3.1) | 0 m | 0 m | 3.5 m |

- The car and the entrance read 4.07° at most because the sim's facing is computed without
  trigonometry (§3.2) and is exact only on the eight compass points.
- The player's facing is within 15° of the trail's direction on 215 seeds and never more than
  18.63° off it.
- The car stands at the pad's own place along the road on 216 seeds and slides on 11: 3 m on
  one, 3.5 m on ten.
- The car's road-side corner is 5.04 m from the centreline at the least, which is what it is at
  today's site. The box is axis-aligned and the road is not, so a corner overhangs the pavement's
  edge (5.5 m) where the road runs at an angle. This change does not make that better or worse.

## 3. The layout

All of it follows from the seed and the trail graph, so every peer places it alike with nothing
on the wire. `sim/` rules hold throughout: no trigonometry, no `Math.pow`, no `**`, no
`Math.hypot`; lengths by `Math.sqrt`; directions as unit vectors.

Three points are used below:

- **P**, the pad's centre: the graph's node 0.
- **d**, the unit direction of the stem's first edge, out of P.
- **E**, the entrance: `P + TRAILHEAD_RADIUS · d`, the point where the bed crosses the pad's rim.

### 3.1 The car

The car keeps its box (`CAR_HALF`), its material, its distance from the road
(`CAR_ROAD_U`, its road-side face 0.5 m off the pavement) and its heading, parallel to the road.
Its place along the road changes:

1. It stands at the pad's own place along the road: `CAR_ROAD_Z` goes from 12 to 0.
2. If the bed's centreline, on any edge, comes within `CAR_BED_CLEAR` of the car's box, the car
   slides along the road in `CAR_SLIDE_STEP` steps until it does not, or until `CAR_SLIDE_MAX`.
   It slides away from the way the trail heads: toward −z when `d.z > 0`, toward +z otherwise.

| Constant | Value | Why |
| --- | --- | --- |
| `CAR_ROAD_Z` | 0 | Beside the pad's centre, so that it is behind a player who stands near it. |
| `CAR_BED_CLEAR` | 1.15 m | `TRAIL_BED_HALF` (0.75) plus `PLAYER_HALF.x` (0.4): a player walking the bed's edge clears the car. |
| `CAR_SLIDE_STEP` | 0.5 m | |
| `CAR_SLIDE_MAX` | 8 m | The pad's radius. Never reached: the most over the sweep is 3.5 m. |

The car no longer uses the mirrored-site rule of `propSite`. The board still does.

### 3.2 The player

A player spawns at **S** and faces **E**:

- **S** lies on the line from the car's centre **C** to **E**, `SPAWN_GAP` (2.5 m) past the point
  where that line leaves the car's box.
- The facing is the direction from S to E, turned into a yaw by the sim's trig-free facing. That
  function exists in `sim/register.ts` for the body; it moves to `sim/facing.ts` and both use it.
- `spiralSpawn` still runs, centred on S in place of P, so a place that is somehow blocked gives
  way to the nearest free one. Every player spawns at the same place, as today.

Because S is on the line from C to E, the car is behind the player and the entrance is ahead by
construction, whatever way the trail leaves the pad.

**The view starts where the player faces.** A player's yaw is whatever their input says, and the
input's look starts at 0 today, so the first input would turn the player back along the road. The
input sampler takes a starting yaw, and the game gives it the spawn's facing. Every peer derives
that facing from the seed, so a follower and a late joiner start facing the trail as the host
does.

### 3.3 The sign

One post stands at the entrance, with one plank.

- **Its place:** `SIGN_POST_OFFSET` (1.75 m) from the bed's centreline at E, across the trail's
  direction, on the side farther from the notice board.
- **Its box:** `SIGN_POST_HALF`, material `signpost`, emitted by the signs pass (pass 9) with the
  junction posts.
- **Its plank:** one, at the height of a post's lowest plank. It runs across the line from the
  post to S, so that its face is toward the player, and it extends away from the bed, so that it
  never hangs over the trail.
- **Its text:** `Trail 14`, from `TRAIL_NAME` in `sim/signs.ts`. The lettering is weathered as
  every plank's is, from the name's own hash, so every peer sees the same marks.
- **Drawn by** `game/signMeshes.ts`, as a post with one arm. If the models fail to load it falls
  back as the junction posts do.

The pad's node has one edge, so it is not a junction and has no post today. The junction posts
are unchanged, and their planks that point home still read `Trailhead`.

### 3.4 The notice board

Unchanged: 11 m from the centreline, 7 m along the road from the pad's centre, mirrored to the
other side where the bed is too close, its poster facing the pad. Only its painted line changes
(§4).

## 4. The name

| Where | Today | After |
| --- | --- | --- |
| The sign at the entrance | none | `Trail 14` |
| The poster painted on the board | `Last seen on the summit trail.` | `Last seen at Trail 14.` |
| The poster's panel, first line | `Last seen on the summit trail.` | `Last seen at Trail 14.` |
| `README.md`, the premise | "last seen on the summit trail" | "last seen at Trail 14" |

The poster's line is written once, in `game/posterPanel.ts`, and the board's painter reads it
from there. The name itself is `TRAIL_NAME`, and both lines are built from it.

## 5. The code's names

The module that holds the missing hiker, the body's place, the poster's point and the car is
named for a register that the game no longer has.

| Today | After |
| --- | --- |
| `client/src/sim/register.ts` | `client/src/sim/search.ts` |
| `Register`, `RegisterInput` | `Search`, `SearchInput` |
| `buildRegister`, `installRegister` | `buildSearch`, `installSearch` |
| `World.register` | `World.search` |
| `InteractKind.Register` (2) | `InteractKind.Poster` (2) |
| `BOX_RADIUS`, `BOX_HEIGHT`, `BOX_INTERACTABLE_ID`, `Register.box` | `POSTER_RADIUS`, `POSTER_HEIGHT`, `POSTER_INTERACTABLE_ID`, `Search.poster` |
| `client/test/sim/register.test.ts`, `registerSweep.test.ts` | `search.test.ts`, `searchSweep.test.ts` |

- The interactable's kind keeps its number, 2, and its id keeps its number, so nothing on the
  wire changes and protocol 5 stands.
- Comments in shipped code that mention the book, signing out or the register are rewritten to
  say what the code does now. `registerPass` and the other uses of the verb are not part of this.
- The design documents under `docs/gameplay/` keep their text. They record the design as it was
  on their dates.

The rename is its own commit, with no change in behaviour, so that the layout's commits show
only the layout.

## 6. The level id and the pinned values

The car moves and a box is added, so the generated world changes.

| Value | Where | What happens |
| --- | --- | --- |
| `GEN_VERSION` | `client/src/sim/forest.ts` | 6 → 7 |
| The pass hash, −311867473 | `client/test/sim/groundGradient.test.ts` | Re-pinned to the value the new tunables give |
| The trailhead pass's tunables | `client/src/sim/passes/trailhead.ts` | `CAR_ROAD_Z` changes; `CAR_BED_CLEAR`, `CAR_SLIDE_STEP`, `CAR_SLIDE_MAX` and `SPAWN_GAP` join |
| The watcher's sweep, 875 of 936 stands | `client/test/sim/watcherSweep.test.ts` | Re-measured. The pad's stands change, because the player there stands and faces differently and the car is in a new place |
| The trailhead sweep's bounds | `client/test/sim/trailhead.test.ts` | The car's clauses are rewritten for §3.1; the board's stand |

A re-pinned value is read from a run of the changed code and written as a literal. Where the
watcher's count falls, the spec's bar is that it is explained stand by stand, as the last change
to it was.

## 7. Where the code changes

| File | Change |
| --- | --- |
| `client/src/sim/facing.ts` | New. The trig-free facing, moved out of the search module. |
| `client/src/sim/passes/trailhead.ts` | The car's place along the road and its slide (§3.1); `carSite`. |
| `client/src/sim/spawn.ts` | `trailheadSpawn(graph, car)`: S and the facing (§3.2). |
| `client/src/sim/world.ts` | `pickSpawn` centres on S; `spawnPlayer` sets the yaw. |
| `client/src/sim/signs.ts` | `TRAIL_NAME`; `trailSign(graph, board, spawn)`: the post's place and the plank's direction (§3.3). |
| `client/src/sim/passes/signs.ts` | Emits the trail sign's box with the junction posts'. |
| `client/src/sim/search.ts` | The renamed module (§5). |
| `client/src/game/input.ts` | The sampler takes a starting yaw. |
| `client/src/game/signMeshes.ts` | Draws the trail sign as a post with one arm. |
| `client/src/game/posterPanel.ts` | The poster's line, from `TRAIL_NAME`. |
| `client/src/app.ts` | Gives the input the spawn's facing; draws the trail sign; reads the poster's line from the panel's model; the renames. |
| `README.md`, `ARCHITECTURE.md` | The premise's line; the trailhead's description. |

`sim/` imports nothing from `game/` or `net/`, as the lint rule requires.

## 8. Verification

### 8.1 Tests

Every numeric expectation is a literal.

**Over the 227 seeds**, in `client/test/sim/trailhead.test.ts`:

| Clause | Bound |
| --- | --- |
| The car is behind the player: the angle between the player's facing and the direction to the car's centre | at least 175° |
| The entrance is ahead: its angle off the facing | at most 5° |
| The sign is in view: its angle off the facing | at most 35° |
| The sign is near: its distance from the player | between 3 m and 7 m |
| The player is clear of every box on the pad | at least 1.5 m from the car's, 3 m from the board's |
| The player is inside the road wall: distance from the centreline | at least 7.5 m |
| The bed clears the car's box | at least 1.15 m |
| The sign clears the car's and the board's boxes | at least 3 m |
| The car's slide | at most 3.5 m, on at most 11 seeds |
| The car's road-side face, at its centre | 0.5 m off the pavement's edge, as today |

**Unit tests:**

- The facing at the eight compass points is exact, and between them within 0.07 rad.
- The car slides away from the trail's heading, and not at all on a trail that leaves straight
  inland.
- The spawn's yaw is the facing from S to E, and a new player has it.
- The input sampler's first command carries the starting yaw it was given.
- The signs pass emits one more box than there are junctions, at the trail sign's place.
- The trail sign's plank reads `Trail 14`, and the poster's line reads `Last seen at Trail 14.`
- The rename changes no number: the poster's interactable has kind 2 and its id as before.

### 8.2 In the game

The tests prove the geometry. They cannot prove the picture, so the change is looked at in the
running game before it ships, on at least these worlds:

| World | Why |
| --- | --- |
| `hollow` | The world the summit loop was checked on. |
| A seed whose trail leaves within 5° of straight inland | The plain case. |
| A seed whose trail leaves between 75° and 92° | The road runs beside the player. |
| A seed on which the car slides | The car stands off the pad's centre line. |
| A seed whose board is mirrored | The sign's side flips with it. |

On each, from the spawn with no input given: the trail and the sign are in the frame, the sign's
text reads the right way round and is legible, the plank does not hang over the bed, and turning
round shows the car. Two players in one match both arrive facing the trail.

## 9. Boundaries

Not part of this change:

- The opening, summit and closing scenes. They are designed separately, and this layout is what
  the opening scene's last shot is staged against.
- A sign model made for the trailhead. The post and plank stand until one exists.
- Moving or turning the notice board.
- The trail builder, the pad's size and the road wall.
- The car's box overhanging the pavement where the road runs at an angle (§2.2).
- The junction posts and their `Trailhead` planks.
