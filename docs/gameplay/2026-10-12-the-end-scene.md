# The end scene

**Date:** 2026-10-12
**Status:** Designed, being built.
**Parent:** [`2026-10-06-the-end-screens.md`](2026-10-06-the-end-screens.md) (the win's lift to the sky,
which this replaces; the death stands, with its sound now going with its dark),
[`2026-10-08-the-summit-scene.md`](2026-10-08-the-summit-scene.md) (the game's own camera over the
game's own world, cut to cut, with a film lens; the shape this takes), [`2026-09-29-intro-scene.md`](2026-09-29-intro-scene.md)
§3 (the film's eight shots, whose first this scene's last answers) and
[`2026-10-06-the-haunt.md`](2026-10-06-the-haunt.md) (the shades, which here come out of the woods
after the party).
**Research:** [Opening a game like a film](https://csarko.sh/research/opening-a-game-like-a-film),
§1 (the opening image and the final image that answers it; Hitchcock's rule, the size of a thing in
the frame is its weight in the story), §7 (the lenses; a high angle as a predator's view; a camera
that comes up behind a car as if it were another car; screen direction kept), §8 (the rhythm: a
held last shot, no movement at its end, a cut to black on silence) and §10 (the engine cutting as
the loudest beat of the opening; here it is the engine catching).

## 0. What this is

The match won, and the player alive to see it, the game no longer lifts their eye to the sky under
a line. It plays the end: their own ranger sprints the last of the way to the car with the shades
of the woods coming across the pad after them; the car's engine turns over, catches, revs and the
car bolts down the highway; and from high over it the camera is left behind as it goes, tilting up
from the road under it to the road ahead, the car small on the highway into the mist, YOU LIVED
and the line over it, the game's sound gone with the car, the dark, the title page.

It is a scene of the game's own, as the summit's is: the world is built and drawn, the car is the
one the player walked away from an hour ago, the shades are the sim's, and the ranger's run is a
real run on the sim, so every peer sees it. The frame is letterboxed, the lenses are the film's,
and the shots cut. It plays on every screen whose player is alive at the win; a player dead when
the match is won stays under their own last line, as before.

The scene is the closing image that answers the opening's: the intro's first shot is the car
small on the coast road, coming; its last is the car small on the coast road, going.

## 1. The shots (`game/endScene.ts`, `END_SHOTS`, `endShot`)

Four shots, hard cuts between them, one move within each, a film lens on all (`LENS_24` 0.57,
`LENS_32` 0.43 rad vertical, `cutscene.ts`). The first two are as long as the run is; the last two
are fixed. `A` is the arrival, the second the runner reaches the car, at most `RUN_MAX_S` (10 s)
from the win. The night has no light but the sky's, the runner's lamp and, once it catches, the
car's own, so every shot frames its subject against the sky or in a lamp's beam.

| Shot | Seconds | Lens | Camera | What it says |
| --- | --- | --- | --- | --- |
| 1. The run | 0 to `RUN_CUT_S` (2.5), or `A` if sooner | 24 mm | Carried by the runner: `RUN_CAM_BACK` (2.2 m) behind, `RUN_CAM_UP` (0.5 m) over their eye, `RUN_CAM_SIDE` (0.6 m) to their right, aimed past their shoulder at the door, so the car grows in the frame; the lamp on the body lights the way | the person, running |
| 2. The pursuit | `RUN_CUT_S` to `A` | 32 mm | Locked off at the car's rear corner on the runner's side, `PURSUIT_CAM_UP` (0.7 m) up and `PURSUIT_CAM_OUT` (1.0 m) out from the corner, aimed at the runner's chest (`CHEST_M` 1.3 m over their feet) as they come at the lens, the pad, the treeline and the shades behind them in the mist; the cut on the arrival, the runner by the lens | the shadows, still coming |
| 3. The door and the engine | `A` to `A` + `ENGINE_SHOT_S` (5.5) | 32 mm | Locked off low on the road's far shoulder, `ENGINE_CAM_UP` (0.6 m) up, `ENGINE_CAM_AHEAD` (7 m) ahead of the car along its heading, aimed at the car's nose and turning to keep it centred as it passes (`holdLookingAt`): the door shuts, the crank, the catch, the lamps come on, the revs, the pull-away, the car passing the lens close; the shades reach the pavement's edge beyond and stand | the threshold, crossed back |
| 4. The road | `A` + 5.5 to `A` + `END_SCENE_AFTER_ARRIVAL_S` (17.5) | 24 mm | Overhead: `ROAD_CAM_UP` (14 m) over the car looking straight down the road's heading, carried by the car for `ROAD_CARRY_S` (2 s), then left in the air (eased over `ROAD_RELEASE_S` 1 s) as the car runs on from under it, and tilting up over the shot's rest from straight down to the road ahead (`ROAD_TILT_TO` 0.06 rad down), the car's lamps small on the highway into the mist; YOU LIVED and the line from `TITLE_AT_S` (2 s) into the shot; the dark from `END_FADE_AT_S` (10 s); the landing at `END_LANDING_AT_S` (15 s) | the place: the opening's wide, answered |

Every camera is in world units from the live state: the runner's body each frame (shots 1 and 2),
the car's site and heading (shots 2 and 3) and the car's own pose as it drives (shot 4), so the
same function serves a test with a straight road and a hike with a bend in it. The conventions
are the free camera's: yaw 0 faces +z, positive pitch looks down. `endShot(t, ctx)` gives the
camera, its lens and which shot; `endBeats(t)` the beats below as a record a test can read.

**The run.** From the win's first frame on this screen, the controls are the scene's (`app.ts`,
as the summit's threshold drives them): the command is a sprint toward the door spot, the yaw to
it, the look level, until the body is within `DOOR_REACH_M` (0.9 m) of the spot or `RUN_MAX_S` is
up; then still. The door spot is on the car's inland side, the side the trail is on, so no part of
the run crosses the car's box: `doorSpot(site, direction)` (`sim/trailhead.ts`, so the pursuit,
§2, walks to the same place) is `CAR_HALF.x + DOOR_OUT_M` (0.6 m) out from the car's centre and
`DOOR_ALONG_M` (0.5 m) ahead of it the way it faces. The run is on the sim,
so every peer sees the body cross the pad, and a player who had been standing thirty metres down
the road runs thirty metres. A player further than a sprint covers in `RUN_MAX_S` (70 m) is in
the car at the cap regardless, which is the one thing the scene cannot show well.

**In the car.** From the arrival the local body is hidden (`views.showLocal` false, the lamp on
the lens kept off through the scene, since the camera is not the eye). Any other player's body
within `DOOR_IN_M` (1.2 m) of the door spot is hidden too, from the scene's start on this screen:
they got in before or after, and the car leaves with everyone who reached it. There is no climb-in
animation: the cut from the pursuit to the engine is the getting in, and in the engine shot the
car stands between the lens and the door.

**The car** (`endCar(t)`, on `scene/roadPath.ts`'s `carAlong`): parked at its site until the
pull-away at `PULL_AWAY_AT_S` (2.6 s after the arrival), then `PULL_AWAY_ACCEL` (3.5 m/s²) to
`CRUISE_MPS` (14 m/s) and held, along the road the way it faces (`carYaw`, 0 or π, so the
direction is 1 or −1 as the intro's staging reads it), easing from the shoulder (`CAR_ROAD_U`
from the centreline) onto its lane (`LANE_M` 1.8 m) over its first `LANE_CHANGE_M` (30 m), on the
ground's own height, its wheels spinning with the distance and its front wheels turned with the
road. The soft dark patch rides under it.

**The lamps.** At the catch two lamps come on at the car's front, the bodies' own kind
(`lampParams.ts`) at a wider cone and a longer reach (`HEADLAMP_CONE`, `HEADLAMP_RANGE`), `HEADLAMP_APART`
(1.2 m) apart and `HEADLAMP_UP` (0.7 m) up, aimed ahead and `HEADLAMP_DOWN` (0.1 rad) down, so the
road ahead is lit and the wet ground reflects them; and two tail lamps, small red emissive quads at
the rear, so the car can be followed down the highway in the last shot. If the car model has lamp
meshes of its own, those are made emissive instead of quads added.

**The shades** (§2) come across the pad behind the runner through shots 1 and 2, reach the
pavement's edge during shot 3 and stand there in the mist beyond the car; shot 4 looks the other
way. The line says the rest.

## 2. The pursuit (`sim/haunt.ts`, `sim/summit.ts`)

On the tick the outcome becomes `Won`, the host stands up `PURSUIT_SHADES` (4) shades of a new
kind, `AiState.Pursue`, on the ground at the trail's entrance and up the stem behind it,
`PURSUIT_APART_M` (4 m) apart along the stem's first edge, each bound to the living player nearest
it, and they walk after the party (the party is at the car or on its way there), each to a stop of
its own: the first to the car's door spot (`doorSpot`, §1), each after it `PURSUIT_SPREAD_M` (1.8 m)
further along the road the way the car's tail points, at `PURSUIT_SPEED` (5.5 m/s, under a
sprint's 7), on the ground. The Hollow's treeline does not hold them (`walkToward` with `woods`
false): they cross the pad. Within `PURSUIT_ARRIVE_M` (1 m) of its stop a shade stands, so it does
not tread back and forth over it; and a step that would end nearer the centreline than
`PURSUIT_STOP_U` (`ROAD_WALL_U` + 1.5 m, 7.9 m) is not taken, the pavement being the one ground they
never cross. Stopped either way, they face the car. The stops are 8.4 m from the centreline, inland
of the pavement, so they stand in a loose file along the car's inland flank from the door back past
its tail, more than 1.5 m apart; the stop at the pavement holds wherever the way to a stop would
cross it. They go `PURSUIT_DWELL_S` (25 s) after they stood up. They are the haunt's shades in every other way: harmless (a shade kills nothing,
since the Hollows' contact is for Hollows alone; the stare they fill is capped at
`SHADE_STARE_CAP`), drawn through the silhouette mask, coming in from nothing and going out to it
(`isShadeState` counts them), and no player's nearness or look sends them away (the haunt's flee
radius is for shades that must not be reached; these are meant to be).

The director is otherwise unchanged: at the outcome its episode ends, as before, and the pursuit
is a single call from the end rule (`stepSummit`) on the winning tick, so a match lost stands
nothing up. Host truth on the wire as every enemy is (id, position, yaw, health, the ai byte), so
every peer's screen has the same four shades in the same places. The level id does not move: no
pass tunable changes.

## 3. The sound (`game/carAudio.ts`, `game/ambientAudio.ts`)

**The car.** Made on the ambient context, as the chase's pulse is, on a bus of its own off the
master (`car`), placed at the car's position and heard from the camera, which is the listener
through the scene: the car's place relative to the listener each frame (`ambient.setCar`), its
direction through a panner as the woods' odd sounds are placed, its distance through the level and
the low-pass below. The beats, seconds after the arrival (`CAR_CUES`): the door at `DOOR_AT_S`
(0.3): a short dull thud; the crank at `CRANK_AT_S` (0.8): `CRANK_PULSES` (4) pulses at 8 Hz of a
damped 60 Hz tone; the catch at `CATCH_AT_S` (1.4): the engine's bed comes in over 0.2 s, a tone of
`ENGINE_HARMONICS` (6) harmonics at 1/k over a fundamental `IDLE_HZ` (31 Hz) that wanders ±0.6 Hz
over `IDLE_WANDER_S` (3.1 s), under band noise 60 to 400 Hz at 0.4 of the tone; the revs at
`REV_AT_S` (2.2): two blips `REV_GAP_S` (0.8 s) apart, the fundamental to `REV_HZ` (72 Hz) over
0.25 s and back over 0.5 s, raised over whatever the speed has made of it, so the second, after
the pull-away, rides on the moving car's note; the pull-away at `PULL_AWAY_AT_S` (2.6): from the
first frame the car moves, the fundamental follows the car's speed at `HZ_PER_MPS` (4.5 Hz per
m/s) within a gear, with gear changes at `GEAR_MPS` (6 and 11 m/s) each dropping it by `GEAR_DROP`
(0.35), and tyre noise (2 to 6 kHz) rising with the speed. The level falls with the distance from
the listener as `1 / (1 + d / CAR_LEVEL_M)` (8 m) and a low-pass closes with it from 4 kHz to
800 Hz over `CAR_MUFFLE_M` (120 m); the pass in shot 3 is loud because the car is close, nothing more. These
are the same synthesis the intro's own engine bed is made from, so the two films' cars sound
alike.

**The game's sound goes.** From the pull-away the world's beds, the chase's pulse and the stare's
sounds fade together over `WORLD_FADE_S` (8 s): one gain (`scene`) between those three and the
master, which `ambient.fadeWorld(seconds)` ramps to silence; the inner voice's bus and the car's
hang off the master directly and are not in it. From the dark (`END_FADE_AT_S` into the last
shot) the master itself fades over `MASTER_FADE_S` (2 s), `ambient.fadeMaster(seconds)`, so the
title page is reached in silence, where today the sound stops under the veil when the game is
torn down.

**The death's sound.** The same master fade from `DIED_CLOSE_FROM_S` (1 s) over
`DEATH_SOUND_FADE_S` (5 s), so the sound is gone as the HUD's black finishes at
`DEATH_FADE_AFTER_MS` (6 s) and the return to the title page, six seconds later, is from silence
to silence; today the pulse and the rain play on under the black and stop dead under the veil.

## 4. The pieces, and the car model

**The film's car at the trailhead.** The hike's parked car (`trailhead.car`) has no parts: no wheels
to spin, no door. The intro's car (`intro.car`) has them, and the catalog marks it the scene's so a
hike neither loads nor counts it. The end scene needs it, so a hike fetches `intro.car` once the
phase flips to the chase, when the car is a kilometre away and out of sight, and places it over
the parked car on the same site at the same yaw with the parked model hidden and the patch kept;
the catalog entry stays `scene`, and the loading screen never counts it. A fetch that fails leaves
the parked car in place, and the scene moves it whole, wheels still. (Loading it from the start
would be simpler and cost 1.9 MB on every first visit before Play, for a thing seen in the last
twenty seconds; after the flip the download has twenty-one seconds of scene and the whole chase to
land in.)

The stage's car block (`scene/sceneStage.ts`: the root, the wheels' spin and turn, the steering,
the door) becomes `stageCar(pose, model)`, which the scene route and the renderer both call.

**Where it lives.**

- `game/endScene.ts`: `END_SHOTS`, `endShot(t, ctx)`, `endCar(t, road, site, direction)`,
  `endBeats(t)` and the constants above; Babylon-free, as `cutscene.ts` is. `ctx` is the runner's body this frame, the car's site and direction, the road, and the
  arrival second (or none yet).
- `game/carAudio.ts`: the schedule as data (`CAR_CUES`, the fundamental and the levels at a
  second, pure) and the Web Audio graph that plays it on the `car` bus.
- `game/ambientAudio.ts`: the `scene` gain, `fadeWorld`, `fadeMaster`, the `car` bus and
  `createCarAudio` on it.
- `game/ending.ts`: the death's pose stays; the win's lift goes with its constants.
- `game/renderer.ts`: `setEnding("won", ctx)` runs the scene over the player's camera as the
  summit's shots do (the camera, the lens, `showLocal` through the run, the bodies at the door, the
  lens's lamp off); the film car's swap when it lands; `stageCar` each frame of the scene; the
  lamps.
- `game/trailheadMeshes.ts`: the parked model hidden and the film car placed over it; the car's
  root and parts exposed to the renderer. `carYaw` reads the sim's `carDirection`.
- `sim/trailhead.ts`: `carDirection(site, trailhead)` (1 with the nose toward +z, −1 toward −z:
  the rule `carYaw` turns into 0 or π) and `doorSpot(site, direction)` with `DOOR_OUT_M` and
  `DOOR_ALONG_M`, so the run and the pursuit share one door.
- `game/entityViews.ts`: `Pursue` drawn as a shade.
- `sim/types.ts`: `AiState.Pursue` (13). `sim/haunt.ts`: `startPursuit(world)`, the pursuit's
  step and its stop at the pavement, `isShadeState` including it. `sim/hollow.ts`: `walkToward`'s
  `woods` flag, and the stare's shade cap counting `Pursue`. `sim/summit.ts`: the call on the
  winning tick.
- `game/hud.ts`: unchanged (the bars, the title, the fade). `game/passages.ts`: the win's timings
  are the scene's (`WON_FADE_AFTER_MS` and `WON_LANDING_MS` go; the scene's own constants stand in
  their place).
- `app.ts`: the win sets the scene (the renderer, the bars, the controls to the run, the arrival
  watched each frame), the beats (the title at its second, the world's fade at the pull-away, the
  master's at the dark, the landing); the death's sound fade; the `escape` command.

## 5. A look at it

The console's `escape` (host only; not persisted): the host's own player is put on the pad
`ESCAPE_FROM_M` (14 m) from the car on the trail's side, the phase set to the chase if it is not,
and the next tick is the win, so the scene plays as it will, pursuit and all. The `end won`
command plays the scene from wherever the player stands, with no pursuit (the sim is not touched).

## 6. Tests

- `test/game/endScene.test.ts`: the shots' seconds from a given arrival (the run's cut at 2.5 s,
  or at an arrival sooner; the engine shot's 5.5 s; the road's 12 s), each shot's lens; shot 1's
  camera from a body at a literal pose; shot 2's from the car's site; shot 3's ahead on the far
  shoulder and its turn as the car passes; shot 4 over the car, carried then released, its pitch
  from straight down to `ROAD_TILT_TO` by its end; the car's distance at literal seconds (0 at 2.6 s,
  7 m at 4.6 s, 28 m at 6.6 s, 14 m/s after), its lane change, its direction on both headings; the
  door spot on both headings; the beats' seconds.
- `test/game/carAudio.test.ts`: the cues' seconds; the fundamental at idle, in a rev's peak, at
  5, 8 and 12 m/s with the gear drops; the level and the cutoff at 0, 8 and 120 m.
- `test/game/ambientAudio.test.ts`: `fadeWorld` ramps the scene gain and leaves the voice and car
  buses; `fadeMaster` ramps the master; the car bus hangs off the master.
- `test/sim/haunt.test.ts`, `test/sim/summit.test.ts`: four `Pursue` shades on the winning tick and
  none on a loss; their places at the entrance and up the stem; their speed; the stop at the
  pavement, and that none ever stands on it; nothing killed through the scene; gone after the dwell;
  the state's fingerprint and the snapshot carry them.
- `test/game/entityViews.test.ts`: `Pursue` drawn as a shade; a body within `DOOR_IN_M` of the door
  spot hidden in the scene.
- `test/game/ending.test.ts`: the death as before; the win's cases removed.
- The browser pass: the scene on `escape`, every shot seen, the car on the road's height on a bend,
  the lamps on the wet ground, the sound's fade; a second peer's screen; the death's fade to silence.

## 7. Boundaries

- The sim's one change is the pursuit; the level id does not move. The snapshot's codec is
  untouched (the ai byte carries the new value).
- The intro and the title's loop are not changed here; the death's camera is not changed, only its
  sound.
- The car's sounds are synthesized; recorded ones may replace them later through the catalog as
  the calls are.
