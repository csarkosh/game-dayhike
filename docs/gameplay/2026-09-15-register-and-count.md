# The Register and the count — sub-project B

**Date:** 2026-09-15
**Status:** Design agreed. Not planned and not implemented.
**Parent:** `docs/gameplay/2026-09-08-register-and-hollow.md` §5, §17. Amends the parent:
§1.6 (the count), §1.17 and §5 (what raises the tension), §2 (the player's own name), §5
(the book growing), §10 (death and rejoining), §13.1, §13.3, §13.5, §13.6 (decided here),
§16 (invisible walls) and the §17 table.
**Depends on:** A (the trailhead and the trail graph), G1 (Interact), T (the trail system,
`docs/trail/2026-09-11-trail-system.md`).

## 0. What this is

The objective. A world with a trail, a car and a register box becomes a game that can be
won: find what is left of the missing hikers, carry each back to the register, sign them
out, and get everyone to the car. C (the Hollow) hunts what this sub-project defines, and
D (escalation) reads the count it keeps.

## 1. Decisions

Taken 2026-09-15, in the order they were made.

1. **The count is the number of sites the world has**, not four (parent §1.6). A site is a
   destination the trail actually reaches, so the book holds 2 to 4 names.
2. **Every world has at least two sites.** Where no loop was built, a scenery landmark
   becomes the second (§2.2).
3. **No player's own name in the book.** The register lists the missing and nobody else,
   so the last-entry proposal (parent §2, §13.3) is out.
4. **Death is permanent, and its cost is the run.** A dead player is never added to the
   book and never rejoins as a new hiker; they watch the living from a preview mode, which
   is its own sub-project. This settles parent §13.1 and overturns parent §10's
   rejoin-as-emergence.
5. **A joining player is not added to the book** (parent §5, §10). The book is the missing.
6. **Fork signs carry the site names** (parent §13.5), as wooden sign posts.
7. **The sign-out is a five-second hold that breaks** (parent §13.6): releasing, leaving
   reach or dying resets it to nothing.
8. **One item per player**, and any player may pick up any item, including one dropped
   where somebody died. Whoever carries an item to the box signs that hiker out.
9. **An item can be put down deliberately**, which is how a carrier sheds the Hollow's
   attention at the cost of another trip.
10. **A carried item stays where its carrier died.**
11. **The win is every hiker signed out, then every living player at the car.** There is no
    self sign-out, and the dead do not hold the win up.
12. **B owns containment** (parent §16): an invisible wall at the pavement's edge and a
    line on screen.
13. **Book, items and carry state replicate through the snapshot** (§3).
14. **The tension rises on the first pick-up of each hiker's item**, once per hiker — not
    on each sign-out (parent §1.17, §5).

## 2. The sites

Everything in this section follows from the seed and the trail graph, so every peer
computes it and none of it crosses the wire.

### 2.1 Which places are sites

- **The summit**, always: the graph's only dead end.
- **Each loop the world actually builds**, at its feature — the meadow or the pond.

T's graph plans 1 to 3 loops and builds what the ground allows: measured over 227 seeds, 78 %
of worlds build at least one loop and 52 % build their whole plan. So this rule alone yields
1 to 4 sites.

### 2.2 The two-site floor

A single-site world is one trip and one sign-out, which is not a game. Where the rule above
yields one site, a **scenery landmark becomes the second**: the stand first, the talus field
if the stand is unusable. Both already exist beside the trail (`sim/landmarks.ts`), neither
is a graph node, and neither is routed to — so the site is the point on the trail bed
nearest that landmark, not the landmark itself.

**Every world therefore has 2 to 4 sites.**

### 2.3 Where an item lies

On the trail bed at its site: at the crest for the summit, at the loop's nearest point to
its feature, at the trail's nearest point to the landmark for a fallback site. **No item
requires leaving the trail**, which keeps the wayfinding rule (parent §8) honest: going
off-trail is never the objective.

### 2.4 The names

One hiker per site, first name and surname drawn from a fixed table by the world seed, so
every peer reads the same book. Sites are named for their kind — the summit, the meadow,
the pond, the old stand, the talus field — and two sites of one kind are told apart by
position along the stem: "the lower meadow", "the upper meadow".

### 2.5 Sign posts

A wooden post stands at every junction of the graph, with one arm per branch naming the
sites that branch leads to. The trailhead's existing sign becomes the first post and names
every site. Placeholder geometry (boxes, names painted on) until the real prop exists; they
are read by lamp light at the distance a walker meets them.

## 3. State and the wire

The host's world is the authority, as it already is for players and enemies. All of this
lives in `client/src/sim/`, inside `cloneWorldState` and `serializeWorldState`, so the
600-tick determinism test covers it.

### 3.1 Per item (2 to 4 per world)

| Field | What it holds |
| --- | --- |
| `id` | The hiker's index in the book |
| `pos` | Where it lies; ignored while carried |
| `carrier` | The player holding it, or none |
| `pickedUp` | Whether anyone has ever picked it up. Set once, never cleared — this is what raises the tension (§1.14) |
| `signedOut` | Signed out at the box; the item leaves the world |

### 3.2 Per player

| Field | What it holds |
| --- | --- |
| `carrying` | The item held, or none |
| `signOutTicks` | Ticks of Interact held at the box, 0 to `SIGN_OUT_TICKS` (300 = 5 s at 60 Hz); zeroed on release, on leaving reach and on death |

### 3.3 Per match

`outcome`: `playing` until the win check passes, then `won`.

### 3.4 The rules, resolved on the host each tick

- **Pick up** — an Interact press edge with an item in reach and empty hands. Sets
  `carrier`; sets `pickedUp` if it was not already set.
- **Put down** — an Interact press edge with nothing in reach while carrying. The item
  lands at the player's feet.
- **Sign out** — Interact held within reach of the register box while carrying. At
  `SIGN_OUT_TICKS` the item is signed out and the hands are empty.
- **Death** — the carried item drops where the player stands; `signOutTicks` resets.
- **The win** — every item signed out and every living player within `CAR_RADIUS` of the
  car. `outcome` becomes `won`.

Interact already rides every input command (G1), so holding it needs no new input field.
Reach and cone are `resolveInteract`'s (2.5 m, 35°); the register box, the items and the
book are registered interactables, registered identically on both sides from the seed, as
`sim/world.ts` requires.

### 3.5 Containment

Movement clamps at the pavement's edge inside the movement step both sides already run, so
a client predicts the wall exactly and never rubber-bands. The car stands on the shoulder
and stays reachable: the wall follows the road's own frame, offset to leave the shoulder
inside.

### 3.6 On the wire

- **16 bytes per item**: id 1, position 12 (players' fixed-point encoding), carrier 2,
  flags 1. Four items are 64 bytes a snapshot.
- **3 bytes per player**: `carrying` 1, `signOutTicks` 2.
- **`PROTOCOL_VERSION` 2 → 3.** An old client is refused in words, as it is today.
- **A late joiner needs nothing extra**: the first snapshot carries every item, and the
  names come from their own seed.

## 4. What the player sees and hears

Each screen is a pure model and a plain renderer, per the client's house rules.

- **An item** is a placeholder pale bundle on the trail, lit like everything else, named by
  the existing in-world prompt: "Pick up Dana Whitcombe". Carried, it sits low in view on
  the camera's own walk bob; other players see it held against the carrier's body. A
  signed-out item disappears at the box.
- **The register box** prompts "Read the register" with empty hands, opening a panel
  listing every hiker, their site and whether they are signed out — this is how a player
  learns where to go. Carrying, it prompts "Sign out Dana Whitcombe — hold" and fills a
  ring over five seconds that empties the instant the hold breaks.
- **The highway** writes a fading line on the HUD's existing status line: "I need to find
  those missing hikers first." After the last sign-out: "Get to the car."
- **Winning** fades to one line, "You signed them out.", then returns to the landing page
  after a few seconds. The Poe passages and the real endings stay with J.
- **Three sounds**: pick up, put down, and the pen during a sign-out, which stops when the
  hold breaks. They need their own mixer bus — `ambientAudio`'s positioned path is wired to
  the wildlife gain bus, so B adds an objects bus beside it.
- **No new lights.** Items are lit by the lamps that exist; the per-mesh light budget
  (`game/headlamp.ts`) is untouched.

## 5. Tests

| What | How |
| --- | --- |
| Sites | ~200 seeds: 2 to 4 sites per world, every item on the trail bed, no two hikers at one site |
| Names | Seeded and stable; two sites of one kind read lower/upper in stem order |
| The wire | A random-state round-trip sweep, as `wireRange.test.ts` does: items, carry and sign-out survive exactly; a version mismatch is refused |
| The rules | Host tests: pick up, put down, sign out, an interrupted hold, a carrier dying, and a second pick-up not raising the count again |
| The win | Every hiker signed out with the living at the car ends the match; one player still out in the woods does not |
| Containment | Many seeds, several approach angles: the pavement is never crossed and the car stays reachable |
| Determinism | The existing 600-tick test, once the new state is in the clone and the fingerprint |
| The book panel | Model tests for contents and order |
| In the game | Two peers: a hiker each, one dropped and signed out by the other, both books agreeing |

## 6. Boundaries

- **Permanent death ships with preview mode, not with B.** Until then a dead player
  respawns after `RESPAWN_SECONDS` as today; B reads "living" as "not dead this tick", so
  its win check is unchanged when death becomes permanent.
- **The tension curve is D's.** B exposes two counts: hikers picked up, and hikers signed
  out.
- **The Hollow is C's.** B defines what it is drawn to.
- **The real endings are J's.**
