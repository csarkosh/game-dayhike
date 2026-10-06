# Three acts

**Date:** 2026-10-05
**Status:** Built 2026-10-05.
**Parent:** [`2026-09-16-escalation-and-atmosphere.md`](2026-09-16-escalation-and-atmosphere.md)
(the model and the lens stand; the curve is replaced) and
[`2026-10-05-the-woods-voice.md`](2026-10-05-the-woods-voice.md) (the birds and the call, now
keyed to the acts; the night's other voices are new). Supersedes
[`2026-10-05-the-watcher-on-the-trail.md`](2026-10-05-the-watcher-on-the-trail.md) and the
watcher's showings on the climb (`2026-09-16-the-summit.md` §4): the Hollow is first seen at
the crest.

## 0. What this is

The climb is three acts, by the party's progress up the stem (ratcheted, so it never goes back).

1. **The day.** A semi-sunny day on the peninsula: broken cloud, a little haze, the forest
   lively. Full birdsong, every animal's call, the odd fly passing the ear.
2. **The wet.** From a quarter of the way up, over the next 15 %, cloud closes in, mist and
   rain come, the ground wets, and the look takes a first touch of the dread axis. The birds
   are half what they were, the rain takes more, the ground animals fall back and the ravens
   grow bolder: a wet day's woods.
3. **The night.** From a little past half way the sun goes, and by the crest it is night and
   the eerie preset. Every animal, the ravens too, is quiet by night. In their place: sounds
   that are not animals. A knock of wood on wood, twice. A trunk's long creak. A stick snapped
   close by. Steps in the litter that come nearer and stop. A breath at the shoulder. A thin
   ringing far off. A swell under everything. And the Hollow's call from up the trail, nearer
   each time. None of them explained, none the same place twice, more of them as the night
   deepens.

Nothing is seen on the climb. The watcher does not show (`WATCHER_ON_CLIMB`, false; its rules
and record are kept against the day it is wanted back). The Hollow is first seen at the crest.

## 1. The acts (`game/escalation.ts`)

`actsUnder(world)` gives `wet` and `night`, each 0 to 1 by smootherstep: `wet` from `WET_AT`
(0.25) over `WET_SPAN` (0.15); `night` from `DUSK_AT` (0.55) to 1. The weather runs from the base
preset to `ACT_WET` (cloud 1, mist 0.9, rain 0.55, wetness 0.85, dread 0.35) by `wet`, then to
eerie by `night`. The sun runs from the base hour to 22 by `night` alone. The lens lifts dread
as before. The three marks are the dials: a quarter, or a tenth, is one number.

The base preset is `bright` (cloud 0.45, mist 0.12, wetness 0.15), the game's new default.

## 2. The animals (`game/wildlifeBehaviour.ts`, `game/woodsVoice.ts`)

`wildlifePresenceUnder` takes the hour: every species, the ravens included, fades from 2.5 h
before dusk (20:00) to none an hour past it. The birdsong bed is all there in the day, half in
the wet act (`BIRDS_WET_CUT`), 45 % of that in full rain, and none by night; it still stops dead
while any Hollow is out. The Hollow's call's six marks are all in the night (0.6 to 0.95).

## 3. The other voices (`game/woodsSounds.ts`, `game/oddSounds.ts`)

Each screen runs its own stream (a 32-bit LCG seeded from the world's seed and the clock), so no
two players hear the same woods, and nothing of it is on the wire. By night, from `ODD_NIGHT_MIN`
(0.15), a sound every 48 s on average at first and every 14 s at full night, each gap drawn
between half and one and a half times that; never the same kind twice running; none in the
chase. Each kind has its range from the ear (a breath 1.5 to 3 m, a snap 4 to 9, steps 8 to 18,
a knock 14 to 40, a ring 25 to 60; the swell has no place), 60 % of them behind.

All synthesized on the ambient context from the shared noise and a few oscillators: the knock is
the noise through a wooden resonance with a thump under it; the creak two rough low tones
dragged down through a resonance that climbs; the snap a burst above 2.2 kHz; the steps four
crunches each a little louder; the breath the noise opened and shut like a mouth, in and then
out lower; the ring two thin sines a hair apart; the swell two low tones beating. In the day,
while more than 40 % of it is left, a fly passes about every 26 s: a buzz that crosses the head.

## 4. The stare, smoother

The lens follows the stare over 0.35 s (was 0.12), its side over 1.2 s (was 0.7); a beat's
swell takes 9 % of the beat to rise (was 4.5 %) and adds 14 % to the closing (was 24 %); the
dark's edge is wider and its crawl slower.

## 5. Tests

`test/game/escalation.test.ts` (the acts and the curve through them), `test/game/wildlifeBehaviour.test.ts`
(quiet by night), `test/game/woodsVoice.test.ts` (the birds under the acts, the marks in the
night), `test/game/woodsSounds.test.ts` (the stream, the night's spacing, kinds and places, the
flies), `test/game/ambientAudio.test.ts` (a sound placed in the listener's frame, every kind made,
the fly's pass), `test/sim/watcher.test.ts` (off on the climb, and its rules on a record turned on).
