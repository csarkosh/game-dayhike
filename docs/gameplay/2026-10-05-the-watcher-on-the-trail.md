# The watcher on the trail

**Date:** 2026-10-05
**Status:** Built 2026-10-05.
**Parent:** [`2026-09-16-the-summit.md`](2026-09-16-the-summit.md) §4, the watcher. Every rule
there stands for the showings in the trees; this adds the first showings, which are not there.
**Research:** [Building dread toward a late reveal in horror games](https://csarko.sh/research/building-dread-toward-a-late-reveal),
§2: brief appearances work only if the player registers them.

## 0. What this is

The watcher stood 25 to 90 m out, 30° to 70° off the lead's look, in the trees, and hid the
moment nobody had it in view. A party that walked looking at the trail could reach the crest
without ever seeing it, and everything after rests on the party knowing something is there.

Its first two showings now stand on the trail itself, a short way up ahead, in the middle of
the bed and inside the stare's cone. A party walking the trail is looking straight at it: the
birds stop, the dark starts to close from where it stands, and the heart starts. Then it is
gone. After those two it goes back to the edge of sight, and the party knows what the edge of
sight holds.

The figure alone does not carry this. Tried first at 40 to 65 m, anywhere within 40° of the
look, it was a faint shape fifteen pixels tall in the haze, lost against the trunks. What
nobody misses is the stare, so the showing is placed where the stare begins at once.

The first stretch of the trail has no showing of any kind: the woods are only woods until the
party has climbed a tenth of the way.

## 1. The rule (`sim/watcher.ts`)

The record carries three more things: the showings on the trail still owed (`bold`, 2 at the
start: `WATCH_BOLD_SHOWS`), how long the present try for one has waited, and whether the
showing now out is one of them.

**When.** While a showing on the trail is owed, nothing is tried until the lead's climb is at
least `WATCH_BOLD_MIN_CLIMB` (0.1): no draw is spent and no wait counted.

**Where it stands** (`placeWatcherAhead`). The point on the stem a drawn 22 to 34 m
(`WATCH_BOLD_NEAR`, `WATCH_BOLD_FAR`) above the lead by arc length (`stemAhead`,
`sim/trailRoute.ts`). It must be:

- short of the crest;
- standable, and off the road corridor;
- at least `WATCH_BOLD_FLEE_RADIUS` (12 m) from every living player;
- within 15° of the lead's horizontal look (`WATCH_BOLD_VIEW_COS`), inside the stare's 20°;
- in a clear sightline from the lead's eye.

Eight tries a tick, each one draw from the watcher's own stream, as for the trees.

**When no place fits.** The lead is off the stem, or looking away from it, or the trail bends
out of sight. The try waits a tick, as any does. After `WATCH_BOLD_PATIENCE_S` (20 s) of that,
one showing is made in the trees by the old rule, and the showing on the trail is still owed.

**When it hides.** As any showing: the first tick nobody has it in the wide view, or a living
player is within its radius, which for a showing on the trail is 12 m. At a walk that is two
to four seconds of it standing in the trail ahead, with the stare filling throughout.

**The rest after** is drawn as for any showing.

## 2. Tests

`test/sim/watcher.test.ts`, "the first showings, on the trail": `stemAhead`'s arc and its null
past the crest; the showing stands on the bed, in the band of distances, inside the stare's cone
and in the lead's sight, and the stare fills without the lead turning; it hides at its own
radius; nothing is tried on the trail's first stretch; a lead
looking back down the trail gets a showing in the trees after the patience, with the trail's
still owed; two showings on the trail, and the third in the trees. The file's other tests, the
sweep and the summit run pin the showings in the trees, on a record past its first two.
