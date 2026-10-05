# The woods' voice

**Date:** 2026-10-05
**Status:** Built 2026-10-05, the reveal (§3) with it.
**Parent:** [`2026-09-16-escalation-and-atmosphere.md`](2026-09-16-escalation-and-atmosphere.md)
(the world answering the game: the same ratcheted progress drives this) and
[`2026-09-16-the-summit.md`](2026-09-16-the-summit.md) §4 (the watcher).
**Research:** [Building dread toward a late reveal in horror games](https://csarko.sh/research/building-dread-toward-a-late-reveal),
§4: lead with sound, and take sound away.

## 0. What this is

The climb had rain, wind and six animals' calls, and nothing in it that said something was up
the trail. Two sounds now carry that.

**The birds.** A bed of birdsong plays under everything on a forest world: full at the
trailhead, thinner with every stretch climbed, gone short of the crest. Whenever the watcher is
out it stops dead, and it stays stopped for a while after the watcher has gone. A player who
never sees the figure in the trees still hears the woods go quiet, and learns what quiet means.

**The call.** Six times on the climb, as the party passes a mark, something calls from up the
trail. The first is far, quiet and dull enough to be an elk. Each one after is nearer, louder
and clearer, and none of them is an elk.

Both are each screen's own, worked out from state every peer already has. Nothing is on the wire.

## 1. The birdsong

**The bed.** One recording, `audio/ambience.forest_birds.mp3`: 46 seconds of a spring morning's
birdsong in a lowland Douglas-fir and maple forest in Oregon, with everything under the birds
cut away, since the game makes its own wind and rain. It is faded two seconds at each end.

**The loop** (`ambientAudio.ts`). Two passes of the bed play at once, half a bed apart, one
toward each ear (`BIRD_PAN` 0.6), so the two never sing the same bar and the song has width.
Each ear's next pass starts `BIRD_OVERLAP_S` (2 s) before the one before it ends, under its
fade, so there is no seam. The bus sits in the world's mix: a stare muffles it with the rest.

**The level** (`woodsVoice.ts`, `stepWoods`), 0 to 1:

- what the climb leaves: all of it up to a climb of 0.12, falling evenly to none at 0.88, where
  the climb is the party's best so far (`EscalationState.progressMax`) and never falls;
- less in rain: full rain leaves 30 %;
- none while any Hollow is in the world or the chase is on, and for `BIRDS_HOLD_S` (8 s) after.

The level falls with a time constant of 0.1 s, a hush that lands within a breath, and rises with
one of 9 s. The watcher is in the world only while it shows, so its showing is the hush.

## 2. The call

**The marks.** Climbs of 0.12, 0.30, 0.48, 0.64, 0.78 and 0.90. On the frame the party's best
climb passes one, the call sounds; a climb that jumps several at once is heard as its latest alone. A screen that joins a climb under way
starts from the marks already passed and hears none of them. There is no call in the chase.

**The cue.** Evenly from the first mark to the last: 420 m to 60 m, a level of 0.4 to 0.9, heard
through a low-pass at 1.4 kHz opening to 3.2 kHz. Distance is carried by the level and the
low-pass, not by a position: the call is placed 20 m from the ear in the direction of the crest.

**The sound.** The elk's bugle, the recording the wildlife already plays, played wrong: an
octave down, and a second voice a fourth under that 90 ms later. A player who has heard an elk
on this mountain has something to mistake the first call for, and less each time.

## 3. The reveal

Added 2026-10-05. The finding of the body was the Hollow appearing behind it, standing two
seconds and hunting, with no sound. It is staged now, in the same voice the climb used:

1. **The body is found.** The Hollow is there, behind it, standing. On every screen that was
   watching the climb, the world's sound (rain, wind, drips, animals) is cut to nothing within
   a breath (`AmbientAudio.setHush`). A player who looks at the Hollow hears their own heart
   and the whispers, which are not the world's.
2. **`REVEAL_SILENCE_S` (1.6 s) of nothing.**
3. **The call**, the one the climb has been bringing nearer, from where the body is. Within
   30 m it is louder (1.3) and clearer (6 kHz) than any call of the climb; further off it
   falls to the climb's far call at 420 m, so a straggler down the trail hears it from above.
   The world's sound comes back with it.
4. **The hunt.** The Hollow stands `SUMMIT_REVEAL_S`, now 4 s (was 2), so it moves in the
   middle of its own call.

A screen that joins a chase already under way has no reveal.

## 4. Where it lives

- `client/src/game/woodsVoice.ts`: the level's step and the marks. Babylon-free.
- `client/src/game/ambientAudio.ts`: the bed's bus and loop (`setBirdBed`, `setBirds`), and the
  call (`hollowCall`).
- `client/src/game/birdBed.ts`: fetches the bed and hands it over once the audio is unlocked.
- `client/src/app.ts`: steps the woods beside the escalation on a forest world with a search,
  and nowhere else.

## 5. Tests

`test/game/woodsVoice.test.ts` (the thinning, the hush, the hold and the return; each mark's
call once and in order; none for a late joiner's past marks or in the chase),
`test/game/ambientAudio.test.ts` (the bed's two passes and their overlap; the gain following its
level; the call's two voices, its low-pass and its direction), `test/game/birdBed.test.ts` (the
bytes and the unlock in either order; a missing bed is silence).

## 6. Not in this

A call for the Hollows that step out at the forks. The levels are set by measurement, not
by ear.
