# The end scene

**Date:** 2026-10-12
**Status:** Built 2026-10-13 (§7).
**Parent:** [`2026-10-06-the-end-screens.md`](2026-10-06-the-end-screens.md) (the win's lift to the sky,
which this replaces; the death stands, with its sound now going with its dark),
[`2026-10-08-the-summit-scene.md`](2026-10-08-the-summit-scene.md) (the game's own camera over the
game's own world, cut to cut, with a film lens; the shape this takes) and
[`2026-09-29-intro-scene.md`](2026-09-29-intro-scene.md) §3 (the film's eight shots, whose first
this scene's last answers).
**Research:** [Opening a game like a film](https://csarko.sh/research/opening-a-game-like-a-film),
§1 (the opening image and the final image that answers it; Hitchcock's rule, the size of a thing in
the frame is its weight in the story), §7 (the lenses; a high angle as a predator's view; a camera
that comes up behind a car as if it were another car; screen direction kept), §8 (the rhythm: a
held last shot, no movement at its end, a cut to black on silence) and §10 (the engine cutting as
the loudest beat of the opening; here it is the engine catching).

## 0. What this is

The match won, and the player alive to see it, the game no longer lifts their eye to the sky under
a line. It plays the end: their own ranger sprints the last of the way to the car across the pad,
alone; the car's engine turns over, catches, revs and the car bolts down the highway; and from high
over it the camera is left behind as it goes, tilting up from the road under it to the road ahead,
the car small on the highway into the mist, YOU LIVED and the line over it, the game's sound gone
with the car, the dark, the title page.

It is a scene of the game's own, as the summit's is: the world is built and drawn, the car is the
one the player walked away from an hour ago, and the ranger's run is a real run on the sim, so
every peer sees it. The frame is letterboxed, the lenses are the film's, and the shots cut. It
plays on every screen whose player is alive at the win; a player dead when the match is won stays
under their own last line, as before.

The scene is the closing image that answers the opening's: the intro's first shot is the car
small on the coast road, coming; its last is the car small on the coast road, going.

## 1. The shots (`game/endScene.ts`, `END_SHOTS`, `endShot`, `endShotIndex`)

Four shots, hard cuts between them, one move within each, a film lens on all (`LENS_24` 0.57,
`LENS_32` 0.43 rad vertical, `cutscene.ts`). The first two are as long as the run is; the last two
are fixed. `A` is the arrival, the second the runner reaches the car, at most `RUN_MAX_S` (10 s)
from the win. The night has no light but the sky's, the runner's lamp and, once it catches, the
car's own, so every shot frames its subject against the sky or in a lamp's beam.

| Shot | Seconds | Lens | Camera | What it says |
| --- | --- | --- | --- | --- |
| 1. The run | 0 to `RUN_CUT_S` (2.5), or `A` if sooner | 24 mm | Carried by the runner: `RUN_CAM_BACK` (2.2 m) behind, `RUN_CAM_UP` (0.5 m) over their eye, `RUN_CAM_SIDE` (0.6 m) to their right, aimed past their shoulder at the door, so the car grows in the frame; the lamp on the body lights the way | the person, running |
| 2. The pursuit | `RUN_CUT_S` to `A` | 32 mm | Locked off at the car's rear corner on the runner's side, `PURSUIT_CAM_UP` (0.7 m) up and `PURSUIT_CAM_OUT` (1.0 m) out from the corner, aimed at the runner's chest (`CHEST_M` 1.3 m over their feet) as they come at the lens, the pad and the treeline behind them in the mist; the cut on the arrival, the runner by the lens | the woods, left behind |
| 3. The door and the engine | `A` to `A` + `ENGINE_SHOT_S` (5.5) | 32 mm | Locked off low on the road's far shoulder, `ENGINE_CAM_UP` (0.6 m) up, `ENGINE_CAM_AHEAD` (7 m) ahead of the car along its heading, aimed at the car's nose and turning to keep it centred as it passes (the stand fixed, the aim on the nose's place each frame): the door shuts, the crank, the catch, the lamps come on, the revs, the pull-away, the car passing the lens close | the threshold, crossed back |
| 4. The road | `A` + 5.5 to `A` + `END_SCENE_AFTER_ARRIVAL_S` (17.5) | 24 mm | Overhead: `ROAD_CAM_UP` (14 m) over the car looking straight down (`ROAD_LOOK_DOWN`, 1.55 rad, a hair short of it so the look keeps a heading) with the car's heading as its yaw, carried by the car for `ROAD_CARRY_S` (2 s), then left in the air as the car runs on from under it: over `ROAD_RELEASE_S` (1 s) the camera slows along the car's own path from the car's speed to nothing (over the car's pose at `u − u²/2` of the release, `u` the release's share run, `releaseAt`), so it comes to rest, never moving back, over where the car was half the release on (`roadRelease`), and tilting up over the shot's whole 12 s from straight down to the road ahead (`ROAD_TILT_TO` 0.06 rad down), the car's lamps small on the highway into the mist, which the shot draws back from its start (over `END_MIST_EASE_S`, 4 s, the ground cloud and the weather's mist eased to `END_MIST_FLOOR`, 0.2, of what they were, and held: `endMistShare`) so the car is not lost in it within a second of the release, the night, the rain and the cast as they were and the wind heard from the weather as it is; YOU LIVED and the line from `TITLE_AT_S` (2 s) into the shot; the dark from `END_FADE_AT_S` (10 s); the landing at `END_LANDING_AT_S` (15 s) | the place: the opening's wide, answered |

Every camera is in world units from the live state: the runner's body each frame (shots 1 and 2),
the car's site and heading (shots 2 and 3) and the car's own pose as it drives (shot 4), so the same
function serves a test with a straight road and a hike with a bend in it. The conventions are the
free camera's: yaw 0 faces +z, positive pitch looks down. `endShot(t, ctx)` gives the camera, its
lens and which shot (0 to 3, the run to the road); `endBeats(t, arrival)` the beats below as a
record a test can read. Shot 1 is aimed at the door spot at the runner's eye height; shot 2's
standpoint is out from the corner toward where the runner was on the pursuit's first frame, held
from there (`pursuitFrom`, which the renderer fills at the cut), kept to the quarter away from the
car, inland and back the way it faces, so it never stands in the car's box (on the diagonal out of
the corner where that quarter has nothing toward the runner, as for one who came along the road from
ahead); shot 3 stands on the far shoulder at the road's centreline less `CAR_ROAD_U`, the car's own
offset mirrored, and aims at the car's nose `ENGINE_AIM_UP` (0.5 m) over its ground. Past the
scene's end the last pose holds.

**The run.** From the win's first frame on this screen, the controls are the scene's (`app.ts`, as
the summit's threshold drives them): the command is a sprint toward the door spot, the yaw to it,
the look level, until the body is within `DOOR_REACH_M` (0.9 m) of the spot or `RUN_MAX_S` is up;
then still. The door spot is on the car's inland side, the side the trail is on, so a run from
inland never crosses the car's box: `doorSpot(site, direction)` (`sim/trailhead.ts`) is
`CAR_HALF.x + DOOR_OUT_M`, 1.5 m, out from the car's centre (0.6 m past its side) and
`DOOR_ALONG_M` (0.5 m) ahead of it the way it faces. The run is on the sim, so every peer sees the
body cross the pad, and a player who had been standing thirty metres down the road runs thirty
metres. The run is a straight line: a player coming along the road from behind the car meets its
rear corner and runs against it until the cap. A player further than a sprint covers in `RUN_MAX_S`
(70 m), or stuck so, is in the car at the cap regardless, which is the one thing the scene cannot
show well. A player whose controls the scene has is the scene's to the end of it: no quality switch
is taken from the win on, since a renderer built anew would have no scene to play, and a renderer
with no scene runs nobody.

**In the car.** From the arrival the local body is hidden (`views.showLocal` false, the lamp on
the lens kept off through the scene, since the camera is not the eye). Any other player's body
within `DOOR_IN_M` (1.2 m) of the door spot is hidden too, with its lamp, from the scene's start
on this screen (`views.hideNear`): they got in before or after, and the car leaves with everyone
who reached it. There is no climb-in animation: the cut from the pursuit to the engine is the
getting in, and in the engine shot the car stands between the lens and the door.

**The car** (`endCar(t)`, on `scene/roadPath.ts`'s `carAlong`): parked at its site until the
pull-away at `PULL_AWAY_AT_S` (2.6 s after the arrival), then `PULL_AWAY_ACCEL` (3.5 m/s²) to
`CRUISE_MPS` (14 m/s) and held, along the road the way it faces (`carYaw`, 0 or π, so the
direction is 1 or −1 as the intro's staging reads it), easing from the shoulder (`CAR_ROAD_U`
from the centreline) onto its lane (`LANE_M` 1.8 m) over its first `LANE_CHANGE_M` (30 m), on the
ground's own height, its wheels spinning with the distance and its front wheels turned with the
road. Its heading is the parked car's square yaw until it moves; over the lane change it turns
onto the road's own heading and is angled across by the change itself (the arctangent of the
lane's slope, 0 at either end of it), so it pulls out of the shoulder rather than sliding off it.
The soft dark patch rides under it. Once clear of its own footprint (`2 · CAR_HALF.z`, 4.6 m on,
1.6 s past the pull-away) it leaves the rain's cover (`leave()`) and the cover map is drawn again
where it stands (`redraw()`), so the rain falls once more on the pad the car left, in the engine
shot as after it; through the scene the map follows the camera, not the player in the car.

**The lamps.** At the catch two lamps come on at the car's front, the bodies' own kind
(`lampParams.ts`) at a wider cone and a longer reach (`HEADLAMP_CONE` 1.9 rad, `HEADLAMP_RANGE`
60 m), `HEADLAMP_APART` (1.2 m) apart at its nose and `HEADLAMP_UP` (0.7 m) up, aimed ahead and
`HEADLAMP_DOWN` (0.1 rad) down, at the tuned lamp's level and colour with no dread in it, so the
road ahead is lit and the wet ground reflects them. They are no new lights: every material binds two
lights and one a player at most, so the car's are the two this screen already has, the lamp on the
lens (freed from the camera, its right lamp) and the local body's (`views.localLampAt`, its left),
which the scene has no other use for once the runner is in. The body's lamp is kept a light from the
chase's flip to the end (`views.keepLocalLamp`), dark whenever the body is not drawn, so the lights
every material binds are the same from the film's car's first frames through the scene and no
pipeline is first asked for in it. In a party of five the local body's lamp, last of the scene's
lights, is the eighth light against a cap of seven, and lights nothing: the car has one lamp there,
as the summit's shots have the same count. The body's lamp is aimed after the car is posed in the
same frame, so it is at the car's nose and not a frame behind it. And two tail lamps, small red
quads at the rear (`TAIL_LAMP_W` 0.32 by `TAIL_LAMP_H` 0.12 m, the size that reads at 100 m,
`TAIL_LAMP_COLOUR` (1, 0.08, 0.04), unlit, emissive alone, casting nothing, and out of the fog, so
the two red points stay in the frame down the highway into the mist where the car itself is lost),
`TAIL_LAMP_UP` (0.75 m) up, `TAIL_LAMP_APART` (1.4 m) apart and `TAIL_LAMP_BACK` (2.2 m) behind the
car's centre, children of the film's car's root, so the car can be followed down the highway in the
last shot. They are made with the film's car when it is swapped in, drawn in its first frames with
it inside its body and then hidden, so nothing of them shows on the car through the chase, and shown
and lit at the catch at its rear (`tailLamps(true)`), a catch that comes in those frames included.
The film's car has no lamp meshes of its own (its meshes are not named by part), so the quads are
added; the parked car, swapped for nothing, has none. With no car drawn to drive (its box alone,
below), the headlamps stay at the parked car's front.

## 2. The sound (`game/carAudio.ts`, `game/ambientAudio.ts`)

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
(0.35), and tyre noise (2 to 6 kHz) rising with the speed. The car's level at the ear is
`CAR_LEVEL` (0.6), the engine's bed sitting at `ENGINE_LEVEL` (0.4) within it, and it falls with
the distance from the listener as `CAR_LEVEL / (1 + d / CAR_LEVEL_M)` (8 m) while a low-pass
closes with it from 4 kHz to 800 Hz over `CAR_MUFFLE_M` (120 m); the pass in shot 3 is loud
because the car is close, nothing more. These are the same synthesis the intro's own engine bed is
made from, so the two films' cars sound alike. The cues run on the audio context's clock from
`ambient.startCar`, the picture on the renderer's, so a suspended context would put the door, the
crank and the revs out of step with what is seen; the speed, set each frame, still follows.

**The game's sound goes.** From the pull-away the world's beds, the chase's pulse and the stare's
sounds fade together over `WORLD_FADE_S` (8 s): one gain (`scene`) between those three and the
master, which `ambient.fadeWorld(seconds)` ramps to silence; the inner voice's bus and the car's
hang off the master directly and are not in it. From the dark (`END_FADE_AT_S` into the last
shot) the master itself fades over `MASTER_FADE_S` (2 s), `ambient.fadeMaster(seconds)`, so the
title page is reached in silence, where today the sound stops under the veil when the game is
torn down.

**The death's sound.** The same master fade from `DIED_CLOSE_FROM_S` (1 s) over
`DEATH_SOUND_FADE_S` (5 s), so the sound is gone as the HUD's black begins at
`DEATH_FADE_AFTER_MS` (6 s) and the return to the title page, six seconds later, is from silence
to silence; today the pulse and the rain play on under the black and stop dead under the veil.

## 3. The pieces, and the car model

**The film's car at the trailhead.** The hike's parked car (`trailhead.car`) has no parts: no wheels
to spin, no door. The intro's car (`intro.car`) has them, and the catalog marks it the scene's so a
hike neither loads nor counts it. The end scene needs it, so a hike fetches `intro.car` once the
phase flips to the chase, when the car is a kilometre away and out of sight, and places it over the
parked car on the same site at the same yaw with the parked model (or its box) hidden
(`trailhead.swapCar`); the parked car's fixed patch gives way to one that rides the new car's root,
drawn as the parked car's is, by the same shader and as dark, so the swap is not seen in it and asks
for no shader the hike has not made. Once swapped in, the film's car, its patch and its tail lamps
are drawn wherever they stand (`alwaysSelectAsActiveMesh`), unseen a kilometre off in the dark of
the chase, each until its material has been ready for it on two passes and none past
`PIPELINE_WARM_FRAMES_MAX` (30) frames: the effects prepared, the shader modules made and the
pipelines requested at the swap, so the scene's first frames draw the car whole instead of leaving
it out or holding the page. A tier change that builds the trailhead anew fetches it again; while the
scene plays (from the win, or the console's look at it) no tier change is taken, neither the
player's from the settings nor the governor's drop, since a renderer built anew would have no scene
to play. The catalog entry stays `scene`, and the loading screen, gone by then, never counts it. A
fetch that fails leaves the parked car in place, and the scene moves it whole, wheels still, its
fixed patch left on the pad; with only the box standing (its model never came) the car stays where
it is and only its sound drives off. (Loading it from the start would be simpler and cost 1.9 MB on
every first visit before Play, for a thing seen in the last twenty seconds; after the flip the
download has twenty-one seconds of scene and the whole chase to land in.)

The stage's car block (`scene/sceneStage.ts`: the root, the wheels' spin and turn, the steering,
the door) becomes `stageCar(pose, model)`, which the scene route and the renderer both call.

**Where it lives.**

- `game/endScene.ts`: `END_SHOTS`, `endShot(t, ctx)`, `endShotIndex(t, arrival)`,
  `endCar(t, road, site, direction)` with `carDistance`, `carSpeed` and `laneAt`,
  `endBeats(t, arrival)`, `arrived`, `pursuitOut` (shot 2's quarter), `releaseAt` and
  `roadRelease` (shot 4's slowing and its rest, made once a scene), `headlampAt`, `carHeard` (the
  car in the ear's own frame, for `ambient.setCar`) and the constants above; Babylon-free, as
  `cutscene.ts` is. `ctx` is the runner's body and eye this frame, the car's site, its ground and
  direction, the road, the door, the arrival second (or none yet) and the pursuit shot's
  standpoint.
- `game/carAudio.ts`: the schedule as data (`CAR_CUES`, the fundamental and the levels at a
  second, pure) and the Web Audio graph that plays it on the `car` bus.
- `game/ambientAudio.ts`: the `scene` gain, `fadeWorld`, `fadeMaster`, the `car` bus and
  `createCarAudio` on it.
- `game/ending.ts`: the death's pose stays; the win's lift goes with its constants.
- `game/renderer.ts`: `setEnding("won", scene)` runs the scene over the player's camera as the
  summit's shots do (the camera, the lens, `showLocal` through the run, the arrival judged each
  frame from the local body, the bodies at the door, the lens's lamp off); `stageCar` each frame of
  the scene on the trailhead's car as it stands (`scene.car()`, so a swap that lands mid-scene is
  driven from its next frame); the lamps; `endScene()`, the scene's seconds, arrival, shot and the
  car's pose and speed for `app.ts`.
- `game/scene/sceneStage.ts`: `stageCar(pose, model)`.
- `game/trailheadMeshes.ts`: `swapCar(placed)`, the parked model hidden and the film car placed
  over it; `car()`, the car's root and parts (`model` null for the parked car) for the renderer.
  `carYaw` reads the sim's `carDirection`.
- `sim/trailhead.ts`: `carDirection(site, trailhead)` (1 with the nose toward +z, −1 toward −z:
  the rule `carYaw` turns into 0 or π) and `doorSpot(site, direction)` with `DOOR_OUT_M` and
  `DOOR_ALONG_M`, where the run ends. The sim changes nowhere else.
- `game/entityViews.ts`: `hideNear`, the bodies in the car hidden; `localLampAt`, the local lamp as
  the car's left headlamp.
- `game/hud.ts`: unchanged (the bars, the title, the fade). `game/passages.ts`: the win's timings
  are the scene's (`WON_FADE_AFTER_MS` and `WON_LANDING_MS` go; the scene's own constants stand in
  their place).
- `app.ts`: the win sets the scene (the renderer, the bars, the controls to the run, the arrival
  watched each frame), the beats (the title at its second, the world's fade at the pull-away, the
  master's at the dark, the landing), each set from the frame the arrival lands, the car's sound
  started on that frame and placed every frame after the frame's listener; a landing set at the
  win for the latest it can come (`RUN_MAX_S` and 20.5 s), which the arrival replaces; the film
  car's fetch at the flip; the road shot's mist drawn back where the frame's weather and acts are
  settled (`syncAtmosphere`); the death's sound fade; the `escape` command.

## 4. A look at it

The console's `escape` (host only; not persisted) plays the end as the real one opens: the film's
car is fetched at once and the acts are set at the crest's (`escalationAt(1, true)`: the night, the
mist and the chase's cast whole). The win waits on the car: once it is in and past its first frames,
and the pipelines in flight have landed (or, where none are counted, `ESCAPE_SETTLE_S`, 2 s, later;
at most `ESCAPE_WAIT_S` after those frames), or after `ESCAPE_WAIT_S` (10 s) with no car at all, the
host's own player is put on the pad `ESCAPE_FROM_M` (14 m) from the car toward the trail's entrance,
on the ground and facing the car, the phase set to the chase if it is still the climb, and the next
tick is the win, so the scene plays as it will, on the film's car; a phase flipped
with the match already decided shows no find.
The `end won` command plays the scene from wherever the player stands, with the trailhead's car
(the sim is not touched), and leaves the screen dark at its end, with no landing.
Named in a page's script (`?cmd=seed hollow;time 22;weather eerie;escape`), `escape` (and `summit`)
is called once the world is in (`ready`, app.ts) rather than with the view commands restored at the
start, so a link opens on the scene; typed, neither is written back to the URL.

## 5. Tests

- `test/game/endScene.test.ts`: the shots' seconds from a given arrival (the run's cut at 2.5 s,
  or at an arrival sooner; the engine shot's 5.5 s; the road's 12 s), each shot's lens; shot 1's
  camera from a body at a literal pose; shot 2's from the car's site; shot 3's ahead on the far
  shoulder and its turn as the car passes; shot 4 over the car, carried then released, its pitch
  from straight down to `ROAD_TILT_TO` by its end; the car's distance at literal seconds (0 at 2.6 s,
  7 m at 4.6 s, 28 m at 6.6 s, 14 m/s after), its lane change, its direction on both headings; the
  door spot on both headings; the beats' seconds; the mist's share through the road shot.
- `test/game/carAudio.test.ts`: the cues' seconds; the fundamental at idle, in a rev's peak, at
  5, 8 and 12 m/s with the gear drops; the level and the cutoff at 0, 8 and 120 m.
- `test/game/ambientAudio.test.ts`: `fadeWorld` ramps the scene gain and leaves the voice and car
  buses; `fadeMaster` ramps the master; the car bus hangs off the master.
- `test/game/entityViews.test.ts`: a body within `DOOR_IN_M` of the door spot hidden in the scene;
  the local lamp kept a light, dark, from the run through the arrival to the catch, and the car's
  headlamp there.
- `test/game/rendererEndScene.test.ts`: the scene's first frame (the camera, the lens, the body
  drawn, the lens's lamp off), the arrival (the body hidden, the engine shot), the car driven, the
  rain's cover left once the car is clear of its footprint, the headlamps and the tail lamps at the
  catch, the body's lamp at the car as posed in the same frame, the rain lit from the headlamp where
  it stands; the same lights from the run to the end; the lamps held at the parked car with its box
  alone.
- `test/game/scene/sceneStage.test.ts`: `stageCar` called on its own.
- `test/game/trailheadMeshes.test.ts`: `swapCar` over the parked model and before it, the patch
  riding the new root, its first frames over for each mesh once its material is ready and for all at
  the cap, the tail lamps hidden after them and shown when lit, a second car refused, `leave()`, and
  the disposal; the real model's wheels a tyre's radius over the ground and inside the body, parked
  and 7 m on.
- `test/game/escalation.test.ts`: `escalationAt` eased whole at the climb it is given.
- `test/game/commands.test.ts`: `escape` takes no argument and is never in the URL.
- `test/game/ending.test.ts`: the death as before; the win's cases removed.
- The browser pass: the scene on `escape`, every shot seen, the car on the road's height on a bend,
  the lamps on the wet ground, the sound's fade; a second peer's screen; the death's fade to silence.

## 6. Boundaries

- The sim's one change is `carDirection` and `doorSpot` (`sim/trailhead.ts`); the level id does
  not move, and the snapshot's codec is untouched.
- The intro and the title's loop are not changed here; the death's camera is not changed, only its
  sound.
- The car's sounds are synthesized; recorded ones may replace them later through the catalog as
  the calls are.

## 7. As built

The win plays the four shots over the player's own camera, letterboxed, from the frame the
outcome lands on their screen: the run carried behind the runner, the pursuit from the car's
rear corner, the engine from the far shoulder, and the road from overhead. The run is the sim's
(`ranToCar` on both loops), the arrival the renderer's, the car's drive `carAlong`'s on the
road's own height with the lane change and a heading that eases from the parked yaw onto the
road's; the release decelerates along the car's path (`releaseAt`) and holds over its pose at
8.0 s; the beats come from the arrival (`syncEndScene`): the car's sound at once, the world's
fade at the pull-away, the title at 7.5 s, the dark with the master's fade at 15.5 s, the landing
at 20.5 s, a backstop at 30.5 s from the win. Through the road shot the ground cloud and the
weather's mist draw back to a fifth over four seconds (`endMistShare`), the night, the rain and
the cast kept, so the car's lamps carry down the highway.

**The car** is the film's (`intro.car`), fetched at the flip to the chase and placed over the
parked model out of sight, its moving patch the parked patch's material. For its first frames
after the swap its meshes, the patch and the tail lamps are drawn whether in view or not, each
until its material has reported ready on a pass and been drawn once more, thirty frames at most,
so the effects, the shader modules and the pipelines exist before the scene; the local body's
lamp is kept a light from the flip (`keepLocalLamp`) so the car's materials keep one light set.
The tail lamps are the trailhead's, made at the swap inside the body and dark, moved to the rear,
lit and shown at the catch, outside the fog. The headlamps are the lens's lamp, freed from the
camera, and the local body's lamp, aimed after the car's pose each frame.

**The sound** is as §2 says, with the engine's revs and idle wander an offset summed into each
harmonic so the speed's note and the scheduled ramps never share a parameter, and the wind's
sound fed the weather before the mist is drawn back.

**The shader corpus** gained 230 stages recorded through the scene on every tier (the film car
under the hike's lights, fog, shadows and wet layer; the tail lamps outside the fog; the light
set kept), so no stage is translated on the page's thread through the scene: a verify page on
each tier at night in the eerie weather, from the win to the title page, found every stage it
asked for in its map and none differing.

**Seen in the browser** (seed `hollow`, the crest's escalation, high tier on WebGPU, the frame read
from inside the page four times a second): the bars at the win, the title 10.3 s after, the dark at
18.3 s, the title page at 23.3 s; no main-thread block over 0.5 s through the scene; the lamps
within 0.2 m of the car's nose each frame; the camera's z never decreasing through the release. The
run over the ranger's shoulder with the car ahead, the car passing the lens, the overhead under the
headlights, and from about seven seconds into the road shot the road running off between the trees
with the car's lamps a point on it.

**Not done, listed for later.** The look's run from 14 m is shorter than the first cut, so the
pursuit shot is skipped there (a real win's run is longer); the first seconds of the road shot are
the ground cloud seen from above until the tilt reaches the horizon and the mist has drawn back;
the car's shadow-map pass first runs when it enters the cascades, in the scene; a runner coming
along the road from behind the car sticks on its rear corner until the run's cap; a five-player
party's fifth lamp lights nothing, as in the summit scene; the car's sounds are synthesized and not
yet heard beside the mix; the intro's film still ends with the parked car's model.
