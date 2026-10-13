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

## 1. The shots (`game/endScene.ts`, `END_SHOTS`, `endShot`, `endShotIndex`)

Four shots, hard cuts between them, one move within each, a film lens on all (`LENS_24` 0.57,
`LENS_32` 0.43 rad vertical, `cutscene.ts`). The first two are as long as the run is; the last two
are fixed. `A` is the arrival, the second the runner reaches the car, at most `RUN_MAX_S` (10 s)
from the win. The night has no light but the sky's, the runner's lamp and, once it catches, the
car's own, so every shot frames its subject against the sky or in a lamp's beam.

| Shot | Seconds | Lens | Camera | What it says |
| --- | --- | --- | --- | --- |
| 1. The run | 0 to `RUN_CUT_S` (2.5), or `A` if sooner | 24 mm | Carried by the runner: `RUN_CAM_BACK` (2.2 m) behind, `RUN_CAM_UP` (0.5 m) over their eye, `RUN_CAM_SIDE` (0.6 m) to their right, aimed past their shoulder at the door, so the car grows in the frame; the lamp on the body lights the way | the person, running |
| 2. The pursuit | `RUN_CUT_S` to `A` | 32 mm | Locked off at the car's rear corner on the runner's side, `PURSUIT_CAM_UP` (0.7 m) up and `PURSUIT_CAM_OUT` (1.0 m) out from the corner, aimed at the runner's chest (`CHEST_M` 1.3 m over their feet) as they come at the lens, the pad, the treeline and the shades behind them in the mist; the cut on the arrival, the runner by the lens | the shadows, still coming |
| 3. The door and the engine | `A` to `A` + `ENGINE_SHOT_S` (5.5) | 32 mm | Locked off low on the road's far shoulder, `ENGINE_CAM_UP` (0.6 m) up, `ENGINE_CAM_AHEAD` (7 m) ahead of the car along its heading, aimed at the car's nose and turning to keep it centred as it passes (the stand fixed, the aim on the nose's place each frame): the door shuts, the crank, the catch, the lamps come on, the revs, the pull-away, the car passing the lens close; the shades come to the car's inland flank beyond it and stand in a file there | the threshold, crossed back |
| 4. The road | `A` + 5.5 to `A` + `END_SCENE_AFTER_ARRIVAL_S` (17.5) | 24 mm | Overhead: `ROAD_CAM_UP` (14 m) over the car looking straight down (`ROAD_LOOK_DOWN`, 1.55 rad, a hair short of it so the look keeps a heading) with the car's heading as its yaw, carried by the car for `ROAD_CARRY_S` (2 s), then left in the air (eased over `ROAD_RELEASE_S` 1 s from the carried place to where the car was at the release) as the car runs on from under it, and tilting up over the shot's whole 12 s from straight down to the road ahead (`ROAD_TILT_TO` 0.06 rad down), the car's lamps small on the highway into the mist; YOU LIVED and the line from `TITLE_AT_S` (2 s) into the shot; the dark from `END_FADE_AT_S` (10 s); the landing at `END_LANDING_AT_S` (15 s) | the place: the opening's wide, answered |

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
inland never crosses the car's box: `doorSpot(site, direction)` (`sim/trailhead.ts`, so the pursuit,
§2, files back from the same place) is `CAR_HALF.x + DOOR_OUT_M`, 1.5 m, out from the car's centre
(0.6 m past its side) and `DOOR_ALONG_M` (0.5 m) ahead of it the way it faces. The run is on the
sim, so every peer sees the body cross the pad, and a player who had been standing thirty metres
down the road runs thirty metres. The run is a straight line: a player coming along the road from
behind the car meets its rear corner and runs against it until the cap. A player further than a
sprint covers in `RUN_MAX_S` (70 m), or stuck so, is in the car at the cap regardless, which is the
one thing the scene cannot show well. A player whose controls the scene has is the scene's to the
end of it: no quality switch is taken from the win on, since a renderer built anew would have no
scene to play, and a renderer with no scene runs nobody.

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
which the scene has no other use for once the runner is in. In a party of five the local body's
lamp, made again at the catch and last of the scene's lights, is the eighth light against a cap of
seven, and lights nothing: the car has one lamp there, as the summit's shots have the same count.
And two tail lamps, small red quads at the rear (`TAIL_LAMP_W` 0.25 by `TAIL_LAMP_H` 0.1 m,
`TAIL_LAMP_COLOUR` (1, 0.08, 0.04), unlit, emissive alone, casting nothing), `TAIL_LAMP_UP` (0.75 m)
up, `TAIL_LAMP_APART` (1.4 m) apart and `TAIL_LAMP_BACK` (2.2 m) behind the car's centre, children
of its root, so the car can be followed down the highway in the last shot; made as the scene begins
and hidden to the catch, so their shader is compiled on the scene's first frame and not in the
engine shot. The film's car has no lamp meshes of its own (its meshes are not named by part), so the
quads are added. With no car drawn to drive (its box alone, below), the lamps stay at the parked
car's front.

**The shades** (§2) come down the trail and across the pad behind the runner through shots 1 and
2, reach the car during shot 3 and stand in a file along its inland flank and back past its tail,
in the mist beyond it from the lens on the far shoulder; shot 4 looks the other way. The line says
the rest.

## 2. The pursuit (`sim/haunt.ts`, `sim/summit.ts`)

On the tick the outcome becomes `Won`, the host stands up `PURSUIT_SHADES` (4) shades of a new
kind, `AiState.Pursue`, behind the party: on the stem up from the living player furthest up it
(the rearmost, last to reach the corridor), `PURSUIT_BEHIND_M` (3 m) behind them and
`PURSUIT_APART_M` (4 m) apart from there, so every shade starts further up the stem than any
winner (a winner who reached the corridor away from the stem is placed by their nearest point on
it). Where every living player's nearest point on the stem is at or below the trail's entrance,
they stand up at the entrance and back along the stem's first edge, 4 m apart. Each place is one a
hull stands clear on (`groundSpawn`), or 1 or 2 m to a side of it, so none starts in a trunk or a
boulder's box; where none of those is clear, the bare ground's height there, which can still,
rarely, start one in a box. Each faces the living player nearest it as it rises; nothing else
reads that.

They walk after the party (the party is at the car or on its way there), each to a stop of its own:
the car's door spot (`doorSpot`, §1) moved `PURSUIT_SPREAD_M` (1.8 m) along the road the way the
car's tail points for the first, and as much again for each after it, each as far from the road's
centreline at its own z as the door is at the door's, so the door itself stays the runner's and the
file follows the road where it bends. They walk at `PURSUIT_SPEED` (5.5 m/s, under a sprint's 7), on
the ground. The Hollow's treeline does not hold them (`walkToward` with `woods` false): they cross
the pad. Within `PURSUIT_ARRIVE_M` (1 m) of its stop a shade stands, so it does not tread back and
forth over it; and a step toward the road that would end nearer the centreline than `PURSUIT_STOP_U`
(`ROAD_WALL_U` + 1.5 m, 7.9 m) is not taken, the pavement being the one ground they never cross (a
step away from the road is always taken). Stopped either way, the sim turns them to the car; every
screen draws a shade turned to its own eye, as it draws every shade. The door spot is 1.5 m from the
car's centre (0.6 m past its side), 8.4 m from the centreline where the road is straight at the car
(8.44 m on the test world, where it bends), inland of the stop at the pavement, so the shades stand
in a loose file along the car's inland flank and back past its tail (on the test world 1.7 to 1.8 m
apart at rest, 9.37 to 9.40 m from the centreline); the stop at the pavement holds wherever the way
to a stop would cross it. In a win made at the corridor's edge on the stem, the first shade is at
its stop 4.35 s after the win on the test world, where a runner from the winner's place is at the
door in 3.06 s. They go `PURSUIT_DWELL_S` (25 s) after they stood up.

They are the haunt's shades in every other way: harmless (a shade kills nothing, since the Hollows'
contact is for Hollows alone; the stare they fill is capped at `SHADE_STARE_CAP`), drawn through the
silhouette mask, coming in from nothing and going out to it (`isShadeState` counts them), and no
player's nearness or look sends them away (the haunt's flee radius is for shades that must not be
reached; these are meant to be).

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

## 4. The pieces, and the car model

**The film's car at the trailhead.** The hike's parked car (`trailhead.car`) has no parts: no wheels
to spin, no door. The intro's car (`intro.car`) has them, and the catalog marks it the scene's so a
hike neither loads nor counts it. The end scene needs it, so a hike fetches `intro.car` once the
phase flips to the chase, when the car is a kilometre away and out of sight, and places it over
the parked car on the same site at the same yaw with the parked model (or its box) hidden
(`trailhead.swapCar`); the parked car's fixed patch gives way to one that rides the new car's root,
drawn as the parked car's is, by the same shader and as dark, so the swap is not seen in it and
asks for no shader the hike has not made. A tier change that builds the trailhead
anew fetches it again. The catalog entry stays `scene`, and the loading screen, gone by then, never
counts it. A fetch that fails leaves the parked car in place, and the scene moves it whole, wheels
still, its fixed patch left on the pad; with only the box standing (its model never came) the car
stays where it is and only its sound drives off. (Loading it from the start would be simpler and
cost 1.9 MB on every first visit before Play, for a thing seen in the last twenty seconds; after
the flip the download has twenty-one seconds of scene and the whole chase to land in.)

The stage's car block (`scene/sceneStage.ts`: the root, the wheels' spin and turn, the steering,
the door) becomes `stageCar(pose, model)`, which the scene route and the renderer both call.

**Where it lives.**

- `game/endScene.ts`: `END_SHOTS`, `endShot(t, ctx)`, `endShotIndex(t, arrival)`,
  `endCar(t, road, site, direction)` with `carDistance`, `carSpeed` and `laneAt`,
  `endBeats(t, arrival)`, `arrived`, `pursuitOut` (shot 2's quarter), `roadRelease` (shot 4's
  held place, made once a scene), `headlampAt`, `carHeard` (the car in the ear's own frame, for
  `ambient.setCar`) and the constants above; Babylon-free, as `cutscene.ts` is. `ctx` is the
  runner's body and eye this frame, the car's site, its ground and direction, the road, the door,
  the arrival second (or none yet) and the pursuit's standpoint.
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
  `DOOR_ALONG_M`, so the run and the pursuit share one door.
- `game/entityViews.ts`: `Pursue` drawn as a shade; `hideNear`, the bodies in the car hidden;
  `localLampAt`, the local lamp as the car's left headlamp.
- `sim/types.ts`: `AiState.Pursue` (13). `sim/haunt.ts`: `startPursuit(world)`, the pursuit's
  step and its stop at the pavement, `isShadeState` including it. `sim/hollow.ts`: `walkToward`'s
  `woods` flag, and the stare's shade cap counting `Pursue`. `sim/summit.ts`: the call on the
  winning tick.
- `game/hud.ts`: unchanged (the bars, the title, the fade). `game/passages.ts`: the win's timings
  are the scene's (`WON_FADE_AFTER_MS` and `WON_LANDING_MS` go; the scene's own constants stand in
  their place).
- `app.ts`: the win sets the scene (the renderer, the bars, the controls to the run, the arrival
  watched each frame), the beats (the title at its second, the world's fade at the pull-away, the
  master's at the dark, the landing), each set from the frame the arrival lands, the car's sound
  started on that frame and placed every frame after the frame's listener; a landing set at the
  win for the latest it can come (`RUN_MAX_S` and 20.5 s), which the arrival replaces; the film
  car's fetch at the flip; the death's sound fade; the `escape` command.

## 5. A look at it

The console's `escape` (host only; not persisted): the host's own player is put on the pad
`ESCAPE_FROM_M` (14 m) from the car toward the trail's entrance, on the ground and facing the car,
the phase set to the chase if it is still the climb, and the next tick is the win, so the scene
plays as it will, pursuit and all; a phase flipped with the match already decided shows no find.
The `end won` command plays the scene from wherever the player stands, with the trailhead's car and
no pursuit (the sim is not touched), and leaves the screen dark at its end, with no landing.

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
  spot hidden in the scene; the local lamp as the car's headlamp.
- `test/game/rendererEndScene.test.ts`: the scene's first frame (the camera, the lens, the body
  drawn, the lens's lamp off), the arrival (the body hidden, the engine shot), the car driven, the
  rain's cover left once the car is clear of its footprint, the headlamps and the tail lamps at the
  catch, the rain lit from the headlamp where it stands; the lamps held at the parked car with its
  box alone.
- `test/game/scene/sceneStage.test.ts`: `stageCar` called on its own.
- `test/game/trailheadMeshes.test.ts`: `swapCar` over the parked model and before it, the patch
  riding the new root, a second car refused, `leave()`, and the disposal.
- `test/game/commands.test.ts`: `escape` takes no argument and is never in the URL.
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
