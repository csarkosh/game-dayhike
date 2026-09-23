# Wildlife director: an animal on screen about every five seconds

The trail feels lifeless. Eight species exist — elk, deer, rabbit and
squirrel as models; raven, gull and eagle as cards on the wing — placed on a
grid around the player with rest, alert and flee behaviour and calls
scheduled by the hour, but nothing knows whether the player has *seen* any
of them. This design adds a director that does: it counts sightings, keeps a
jittered target gap of five to ten seconds while the player moves through
daylight woods, stages the next animal into view when the gap is due —
preferring to move one that already exists — and never lets one appear or
vanish on screen. It goes quiet when the fiction needs stillness. A fifth
card species, a code-built butterfly, gives it the cheapest small cue there
is.

It is the fourth of four concurrent world-richness sub-projects and touches
none of the others' files.

## 1. Rulings

| question | ruling |
| --- | --- |
| A sighting | An animal on screen: inside the view within its species' notice distance, not fogged, not behind terrain, for at least a second. Calls heard but not seen do not count |
| The cadence | A jittered target gap of 5–10 s that relaxes when it should: longer when the player stands still and at night, and quiet during the chase and whenever the Hollow is near |
| Small over large | About six small sightings to one large |
| Appearing | Never on screen. A unit is created, moved by the director, or removed only outside the view, behind terrain or beyond the fog |
| Approach | A pure sighting director that prefers to drive existing off-screen units into view and spawns only when none is available |
| Butterflies | A fifth card species built in code beside the four birds |
| Cost | A 4× pixel pair within noise (≤ +0.3 ms); no per-frame allocation in the director |

## 2. Goals and non-goals

Goals:

- While moving through the woods in daylight, the player sees an animal about
  every five to ten seconds, most of them small, none of them repeating the
  last species.
- No animal is ever seen appearing or disappearing.
- The woods go still when the horror needs them to.
- The rule is measurable: the director keeps a log a gate can histogram.

Non-goals:

- New species beyond the butterfly; no new models.
- Any change to the existing species' rest, alert, flee and call behaviour
  beyond one new phase that walks a unit to a goal.
- Wildlife that peers must agree on. Placement stays cosmetic and local, as
  it is today.
- The player's own influence on animals (feeding, hunting).

## 3. Architecture

| unit | layer | does |
| --- | --- | --- |
| `wildlifeDirector.ts` (new, Babylon-free) | game | the on-screen predicate, the sighting clock, the jittered gap and its relaxation, cue selection, staging positions, the never-on-screen invariant, the log |
| `wildlifeBehaviour.ts` (changed) | game | `PHASE_CUE`: walk or run to a goal, then resume rest; the butterfly's flight |
| `wildlifeMeshes.ts` (changed) | game | calls the director each frame with the frame's inputs and applies its events; the butterfly as a code-built card in the bird bucket path |
| `renderer.ts` (changed) | game | passes the match state (phase, Hollow distance, hour, which screen) and the camera's FOV through to the wildlife update |

Nothing in `sim/` changes. The sim is read (its heightfield for the
line-of-sight check, the trail and forest fields for staging) and never
written.

## 4. Sighting detection

`onScreen(view, unit, fog)` is true when the unit is inside the view cone
with `VIEW_MARGIN = 5°` to spare, within its species' notice distance
(`NOTICE`: elk and deer 45 m, rabbit and squirrel 15 m, birds and the
butterfly the fog distance), nearer than the fog, and not behind terrain: a
line of sight that samples the sim's ground height at four points along the
ray from the eye to the unit's chest height and fails if any lies above the
ray. Trees do not occlude for this purpose. A unit on screen for
`SIGHTING_DWELL = 1` s counts as a sighting; the clock resets and the target
gap is redrawn. Each animal counts once for as long as it stays in view — a
deer grazing in frame for a minute is one sighting, not sixty — but a second
animal in view at the same time is a second sighting, because it is a second
animal the player saw.

## 5. The scheduler

- `targetGap` is drawn from `GAP = [5, 10]` s by seeded jitter after every
  sighting.
- When `sinceSighting > targetGap · relax − LEAD (2 s)` the director stages a
  cue. `LEAD` is the walk from staging to the sighting landing, so what the
  band describes is the interval the player gets. If no cue can be placed it
  retries after `RETRY = 1` s and the gap grows; a missed beat is never
  forced, but a cue the player has not seen within `CUE_PATIENCE` stops
  holding the beat, so a cue that misses cannot cost more than that in
  silence.
- A cue is only arranged where it can land: the animal has to reach its mark
  within `CUE_FLIGHT = 5` s at its own gait, and some part of the walk has to
  pass through the frame, close enough for its species to read. Both are
  judged against the frame carried forward by however the player has been
  walking and turning, not the frame as it stands — an elk aimed at where the
  player was looking five seconds ago arrives in an empty view.
- Species: small (rabbit, squirrel, raven, gull, butterfly) weighted
  `SMALL_TO_LARGE = 6` to one over large (deer, elk). The eagle is not cued:
  it cruises above the distance anything registers as a sighting at. Nor, in
  practice, are the raven pair and the gull flock — see §6. The last species
  is excluded from the next draw.
- `relax` is a multiplier: `STILL = 1.8` once the player has moved under
  0.3 m/s for 3 s; `NIGHT = 2.5` by the hour the calls already use; and
  **quiet** — no cues — during the chase phase, whenever the Hollow is within
  `HOLLOW_QUIET = 60` m or hunting, and on any screen that isn't the world.
  Existing units keep behaving under quiet; only cues stop.

## 6. Staging and the invariant

Three stagings, by species and availability:

- **Cross** — birds and the butterfly start outside the view cone by the
  margin and fly across it, inside the range their species reads at; for birds
  this is the existing card path given a heading through the view. A loop
  flier is a circle twenty to a hundred and forty metres across rather than a
  point, and a cue moves the whole circle: there is no placement that hides
  every bird of one, and no reach from which one can be turned unseen either,
  so in practice the butterfly is the crossing the player gets.
- **Break cover** — rabbit and squirrel start behind terrain or beyond a
  lateral edge of the cone, within 15 m, then take `PHASE_CUE` to a goal
  across or away from the view and resume rest. Cover is a point the line of
  sight says is hidden, found by trying up to eight seeded candidates.
- **Tree line** — deer and elk start outside the cone at 25–45 m, or inside
  it beyond the fog, and walk in under `PHASE_CUE` until seen, then graze or
  take their existing alert path.

**The invariant.** At the instant the director creates or moves a unit, the
unit is outside the view cone by the margin, *or* behind terrain, *or* beyond
the fog. A unit is never moved by more than its own speed allows, and never
removed while on screen: removal waits until it is off screen and beyond 1.5
times its notice distance. The director asserts this on every event it emits,
and a test drives it through a thousand seeded frames with a moving, turning
player and checks the invariant on every one.

## 7. Budget and recycling

The unit budget per species is unchanged. A cue's first choice is an
existing off-screen unit of the chosen species within `RECYCLE = 60` m; it
receives the `PHASE_CUE` goal and nothing is created. Only with none available
does the director place a unit, removing the oldest off-screen one of that
species first if the budget is full. Per-frame cost is the line-of-sight
samples — at most four terrain reads per unit — and no allocation: the
director keeps its candidates and its log in preallocated arrays, as
`wildlifeMeshes` already does.

## 8. The butterfly

A fifth card species beside the four birds: two quads hinged on the body,
8 cm across, `WING_BEAT = 12` rad/s, a vertex-colour wing pattern of a pale
ground with two dark spots in three colourways by hash. It flies a slow
wandering path 0.3–1.5 m above the ground at 1 m/s, only in daylight, in the
open or near the meadow's flower cells, never under dense canopy and never
in rain. It rides the bird bucket path — the wing-beat rate, the
thin-instance card buffers — with its model id resolving to code-built
geometry instead of a GLB, the one branch that path gains. It is the most
frequent small cue.

## 9. Tests

Pure, in `wildlifeDirector.test.ts` and the existing behaviour and mesh test
files:

- the on-screen predicate against hand-built cases: in the cone, out by the
  margin, fogged, behind a ridge on a synthetic heightfield;
- the dwell, the clock, and the gap's range and redraw;
- species weighting over 10,000 draws within 6:1 ± 10 %, and no repeat;
- each relaxation multiplier and each quiet state;
- each staging's start position satisfying the invariant on a synthetic
  world; the eight-candidate cover search giving up cleanly;
- the thousand-second seeded drive, over seven seeds: a player walking and
  turning, the invariant asserted on every event, at least one cue of each
  staging, and the gaps' WHOLE distribution against §10's gate — the median
  inside the band, most gaps inside it, nothing over `GAP_CEILING`, and no
  stretch longer than that with nothing on screen at all. A median alone is
  not the gate: one has sat inside the band over a distribution with a quarter
  of its gaps past twenty seconds and a worst case of ninety-six;
- recycling preferred over spawning when a unit is available; removal only
  off screen;
- `PHASE_CUE` entering, walking to its goal, and resuming rest;
- the butterfly's geometry (two quads, size, beat) and its daylight, open,
  no-rain gate;
- no allocation in the director's per-frame path (the existing allocation
  test pattern).

## 10. Gates

In the game, against `main`:

- a three-minute daytime walk along the stem from TRAIL toward EDGE, the
  director's log read back through the wildlife events: the gap histogram's
  median inside 5–10 s and no gap over 20 s while moving; species share
  small:large within 6:1 ± 30 %;
- the same walk at night showing the gaps stretched by about 2.5;
- a chase segment with zero cues in the log;
- the log reviewed for any event the invariant flagged — there must be none;
- stills: a butterfly over the meadow, a squirrel breaking cover, a deer at
  the tree line;
- the 4× pixel pair at TRAIL and MEADOW within noise; the native cap check.

## 11. Fallbacks

In order: `LEAD` 2 → 3 s; notice distances shortened by a third; the tree-line
staging restricted to beyond-fog starts; the butterfly off.

## 12. Follow-ups

- Authored encounter beats at trail nodes as a layer over the director.
- The Hollow's own approach staged through the director's invariant, so it
  is never seen appearing either.
- Sightings that react to the player's look direction, once the director is
  measured.
