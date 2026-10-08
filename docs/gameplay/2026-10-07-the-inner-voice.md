# The inner voice

**Status:** Built 2026-10-07: the director, the first scenarios, and the cap.

## 0. What this is

The ranger's own lines, one at a time, at the bottom of the screen where the film's captions
sat: steering the player back to the trail, naming what they hear and see, and selling the day,
the dusk, the dread and the chase in their own plain voice. Never the end cards' voice, which
is the Poe-like line's alone. Text now; a whispered track could replace it on the same triggers.

It is local. What one screen hears never goes on the wire, and in co-op each player hears their
own: their own trail, their own stare, their own first cry.

## 1. The rules (`game/innerVoice.ts`)

- **One line at a time.** `VOICE_GAP_S` (22 s) between any two, and none before `VOICE_FIRST_S`
  (4 s). The body, the first cry, the chase's start and the car are urgent and skip the gap.
- **Each scenario once, or capped**: once for most; off the trail three times by day and three
  by night, a minute apart; standing still and the stare's warning twice, ninety seconds apart.
- **Nothing over the end.** With an end card up the voice is silent.
- **In the chase, only the chase's**: run, the trail, the car. Everything else is the climb's.
- **A pool is drawn in a seeded order, no repeat until it is spent** (`draw`), the seed the
  match's: the woods are made afresh each time, and the voice is not the one thing that repeats.
  Every pool has at least four lines (`innerLines.ts`), most five or six.
- The timers (off the trail, still, unlit, the birds heard, a shade in view, the cries) step
  whether or not a line comes, so a moment is not lost to the cooldown: the scenario speaks when
  the gap allows, if its condition still holds.

The inputs come from the frame (`app.ts`, after the woods' voice): the climb and the acts, the
chase and the end, metres off the trail (`sim/trail.ts`), the lamp, the stare, whether the player
moved, a shade in view (`playerSees`), the Hollow's cry this frame (the woods voice's call), the
birdsong's level, the cap, the body, the car.

## 2. The scenarios

| Scenario | When | Cap |
|---|---|---|
| `trailhead` | the first seconds, under 3 % of the climb | once |
| `rain` | the wet act coming in (0.5 to 1) | once |
| `offTrailDay` / `offTrailNight` | more than `OFF_TRAIL_M` (6 m) off the trail for `OFF_TRAIL_S` (8 s); the night's from `OFF_TRAIL_NIGHT` (0.5) | 3 each, 60 s apart |
| `dusk` | the night coming in (0.3 to 0.7) | once |
| `lamp` | the lamp off `UNLIT_S` (10 s) into the dark | once |
| `birds` | the birdsong heard above `BIRDS_HEARD` (0.4), then under `BIRDS_STOPPED` (0.1) at night: a question, so the quiet is the player's to answer | once |
| `mist` | the mist act rising (0.2 to 0.6) | once |
| `cryFirst` / `cryAgain` | the first cry; the second | once each |
| `shadeFirst` / `shadeGone` | a shade in view for 0.3 s; then none for `SHADE_GONE_S` (1.5 s) after one was | once each |
| `still` | standing still `STILL_S` (20 s) at night | 2, 90 s apart |
| `dontLook` | the stare at `DONT_LOOK` (0.4) at night | 2, 90 s apart |
| `crest` | 90 % of the climb | once |
| `cap` | within `CAP_NEAR_M` (2.5 m) of the cap | once |
| `body` | within 4 m of the body, before the chase | once, urgent |
| `chaseStart` | the chase begins | once, urgent |
| `chaseOffTrail` | the chase, 8 m off the trail for 4 s | once |
| `safe` | safe at the car | once, urgent |

## 3. The cap (`game/droppedItem.ts`)

The missing hiker's cap, the one thing of theirs the ranger finds before the crest: a crown and
a brim built here, in a red nothing else on the ground wears, lying `CAP_SIDE_M` (1.6 m) off the
stem `CAP_PROGRESS` (0.2) of the way up (`stemPointAt`, `sim/trailRoute.ts`), on the side the
seed draws, tipped as a dropped thing lies, seated on the terrain. The renderer builds it for a
forest world; the app finds its place once a world for the voice.

## 4. The line (`game/hud.ts`)

`hud.say(text, ms)`: the film captions' place and type (`introOverlay.ts`: centred, 44 characters
wide, system-ui at 2.4 vh), 11 vh up from the bottom, with a dark shadow for the night, up for
`VOICE_LINE_MS` (3.6 s) and faded over 350 ms; a new line replaces the one up.

## 5. The voice (`game/voiceClips.ts`, `ambientAudio.ts` `speak`)

Each line is a clip, `client/assets/audio/voice.<scenario>.<n>.mp3`, n from 1 in the pool's
order (`voiceClipId`); `node tools/voice/manifest.mjs` prints every line with its id and file
for whatever makes them. The pools are three a scenario, sixty lines, so the clips stay small
(a line of a second or three at the calls' encoding is tens of kilobytes; the set about a
megabyte) while a once-only scenario still reads differently across three matches and a capped
one never repeats within one. A clip is fetched the first time its line is said and kept decoded;
it plays on the ambient's voice bus, which hangs off the master rather than the world, so the
stare's muffle and the world's level never touch the ranger's own head. A clip that is not there
is silent and not asked for again: the subtitle stands on its own. Pre-generated clips first; a
voice actor's recordings replace them file for file.

## 6. Tests

`test/game/innerVoice.test.ts` (the pools' size and variety, the trailhead and the gap, off the
trail by day and night, the birds' question, the cries, the chase's lines alone, silence at the
end, the seeded draw), `test/game/droppedItem.test.ts` (the cap's place beside the stem, the same
for a seed and different for another; its meshes), `test/sim/trailRoute.test.ts` (`stemPointAt`),
`test/game/voiceClips.test.ts` (the clip's name, fetched once, played each time, a missing one
silent), `test/game/ambientAudio.test.ts` (the voice bus on the master).
