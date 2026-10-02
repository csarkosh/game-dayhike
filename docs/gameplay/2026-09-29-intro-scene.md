# The intro scene

**Date:** 2026-09-29
**Status:** Designed, not built.
**Builds on:** [`2026-09-08-register-and-hollow.md`](2026-09-08-register-and-hollow.md) §11 (the
cutscene on Play), [`../trail/2026-09-28-trail-14-trailhead.md`](../trail/2026-09-28-trail-14-trailhead.md)
(a player arrives facing the trail, the car behind them),
[`../trail/2026-09-28-trailhead-board.md`](../trail/2026-09-28-trailhead-board.md) (the board at the
entrance), [`../rendering/2026-09-26-quality-tier-detection-design.md`](../rendering/2026-09-26-quality-tier-detection-design.md)
(the tier decided at launch).
**Research:** [Opening a game like a film](https://csarko.sh/research/opening-a-game-like-a-film):
how films open, what makes sixty rendered seconds read as cinema, and what a first visit loads.

## 0. What this is

A player who presses Play sees a seventy-two-second film: a park ranger drives the coast road alone,
takes a routine call from dispatch about a hiker last seen at Trail 14, the signal breaks up on
the words that matter, the ranger pulls onto the shoulder by the trailhead board, steps out and
faces the trail. The game cuts to first person on the same view, controls live.

The film is made in the game's own engine: the scene is staged on one fixed world with a scene
player that is a pure function of time, recorded frame by frame, encoded as a video and shipped
as an asset. The player's machine plays the video while the game downloads and builds behind
it, with one thin bar and one short line saying what is still being fetched or built. The title
page becomes light: a still frame from the film, and later a looping title video; nothing of the
engine, models or maps loads before Play.

This spec covers the game's side: the scene player, the intro's staging with stand-ins, playback
and loading, the title page, and the tests. The ranger's performance, the car with its parts,
the two voices, the sound mix and the recording are the asset side, specified apart.

## 1. The pieces and their order

| # | Piece | Where | What it delivers |
| --- | --- | --- | --- |
| 1 | The scene player | this repository, `client/src/game/scene/` | Plays a scene from timed tracks: camera, actors with blended clips, the car, faces, captions. A scene is a pure function of time. |
| 2 | The intro, staged | this repository | The seventy-two-second scene on the scene player, on one fixed world, viewable on a scene route, with stand-ins until the assets arrive. |
| 3 | The intro's assets | the asset repository | One ranger with a face rig, mouth shapes and the new clips; a car with wheels, doors and an interior; two voices; the sound bed. |
| 4 | The intro's video | the asset repository | The staged scene recorded at the high tier and encoded, delivered like every asset. |
| 5 | Playback and loading | this repository | Play starts the video; the game loads behind it; a bar and a line; hold to skip once ready; a click to step out; the cut to first person. |
| 6 | The title page | this repository | A still frame from the film in place of the rendered backdrop; later a looping title video. |

Pieces 1, 5 and 6 come first and do not depend on each other; playback is built against a
placeholder video. Piece 2 follows with stand-ins: the existing clips, the static car sliding
along the road, captions with no voice. Piece 3's assets replace the stand-ins as they arrive,
and piece 4 records the finished scene.

The film's own models, the car with its parts and the ranger with the film's clips, are loaded
by the scene route only; the catalog marks them (`scene`), and a hike neither loads nor counts
them.

The video's ranger and trailhead are not the player's: one ranger for everyone, one world for
the film. The cut to first person, on the player's own pad and trail, hides both.

## 2. The scene player

**The rule that shapes it.** A scene is a pure function of time. Given *t*, `evaluate` says
where the camera, the actors and the car are, which clip each actor is in and at what time, which
mouth shape shows, and which caption is up. Nothing advances on its own. That gives frame-exact
recording (the scene can be stepped a frame at a time), tests in Node ("at 12.5 s the car is here
and the caption reads this" is a literal), and trivial skip and hold (choosing *t*).

**Files, under `client/src/game/scene/`:**

| File | Job | Babylon? |
| --- | --- | --- |
| `timeline.ts` | A scene as data: duration, tracks (camera, actor, car, caption), and `evaluate(scene, t)`, which returns one frame's description. | No |
| `shots.ts` | Camera shots as functions of time: hold, follow the car, track beside it, push in, crane; each with its field of view and roll; cuts between them. | No |
| `roadPath.ts` | The car's position and heading a given distance along the world's road (from `roadCenterX`), a lane offset, and wheel spin from distance travelled. | No |
| `sceneClock.ts` | The time source: the wall clock, or stepped a frame at a time, or held. | No |
| `captions.ts` | The caption panel: text only, set from the frame's description. | DOM |
| `sceneStage.ts` | Applies one frame's description to the renderer's camera, the actors and the car. It decides nothing. | Yes |
| `scenePlayer.ts` | Runs clock, evaluate, stage; handles the end, a hidden tab and a seek. | No |
| `intro.ts` | The intro scene's data: the world, the shots, the actor's clips, the car's path, the script's captions. | No |

**Changes to existing code.**

- `renderer.ts`: the free camera's view gains a field of view and a roll, so a shot can use a
  film lens. The game's own camera keeps its 1.4 rad; the film camera defaults to 0.43 rad
  (a 32 mm lens on Super 35) and uses 0.10 to 0.14 rad for the coastal wide, never wider than
  0.57 rad except the one deliberate cab shot. Depth of field is off for every shot but the
  handset insert. The renderer's three wall-clock reads (wind, the post effects, wing flap) take
  an injected clock, so grass and water move in step with a stepped scene.
- `characterModel.ts`: clips addressed by name beyond today's four kinds; a character posed at
  an exact clip time with blend weights, in place of "play and let it run"; mouth and face shapes
  set by weight where the model has them.
- The scene's car is its own placed model with named parts (four wheels, the driver's door, the
  steering wheel). With today's car, which has no parts, the whole model slides along the road as
  the stand-in.
- `router.ts`, `main.ts`: a scene route, `/dayhike/scene/intro`, plays the staged scene on its
  fixed world, with `?t=<seconds>` to seek and `?step=<n>` to hold frame *n* at 24 frames a
  second, so a recorder can ask for any frame. The route exposes `dayhikeScene` with `seek(t)`
  and `frame()` (renders one frame and resolves when it is drawn).

**What it never touches:** the sim and the wire. The intro's ranger is a scene actor, not a
player, and the scene runs with no local player, the way the title page's backdrop did. Drawing
the player's own ranger in a scene is left to the summit scene, the first to need it.

**Failure handling.** A missing clip, part or mouth shape falls back to the stand-in and logs one
line; a scene never fails to play because an asset is absent. A hidden tab holds the clock, so
the scene resumes where it was.

## 3. The intro

**Setting.** The world `hollow`, at noon, in mist, which is how every match starts: the forest
comes down to the road at its trailhead, the trail runs straight in, the board stands to the
left of the entrance. Lit under the marine layer, graded toward muted greens with slightly lifted
blacks; no chromatic aberration; grain and halation, if any, added at playback, not in the file.

**The shots (72 s).** Eight shots, one idea each: the place, the attitude, the person, the
problem, the wrong note, the threshold, the step, the hold. Every exterior is shot from the sea
side, so the car always crosses the frame the same way. Deep focus throughout but shot 4.

| # | Seconds | Shot | Sound |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:09 | Black, then a fade in. Wide over the sea stacks and mist, the car small on the coast road, a long lens from high up; the trailhead is not in frame. | surf, then the engine, then a radio squelch |
| 2 | 0:09 to 0:15 | Along the road from the sea side, the forest to the tarmac, the camera a beat behind the car and then level with it. | dispatch keys up before the cut |
| 3 | 0:15 to 0:30.625 | The cab from the back seat: gloved hands on the wheel, the handset in its cradle, the empty passenger seat, the road and the forest through the windscreen. The ranger's face is never framed closer than this. | the call, lines 1 to 5 |
| 4 | 0:30.625 to 0:38.4 | The handset and the hand that holds it. | lines 6 and 7, line 8 begins |
| 5 | 0:38.4 to 0:48 | Low on the shoulder: the car passes close, into the treeline. | line 8 ends; line 9; the signal breaks; the static carries over the cut |
| 6 | 0:48 to 0:55 | A locked-off wide as the car slows onto the shoulder by the board. | line 10; nothing; the engine cuts |
| 7 | 0:55 to 1:04 | The door opens; the step onto gravel; the ranger from behind, walking round the car's tail to the trail's start and turning to it. | the door, boots, wind; no birds |
| 8 | 1:04 to 1:12 | A slow push past the ranger's shoulder onto the trail, the board in view, then held with no movement for the last three seconds, then black. | wind, then silence |

Amended 2026-09-30: the film runs 72 s. The call as recorded ends line 9 at 48.1 s, so shots 3
to 5 hold 33 s instead of 21 s and shots 6 to 8 follow 12 s later.

Every cut falls where a frame's shutter is shut (24 fps, each frame's shutter open for its first
half), so no frame mixes two shots: the cut into shot 4 is at 0:30.625, the frame after 0:30.6.

The game's name is not in the film. It shows for three seconds over the black after shot 8, then
the last frame returns and holds (§5).

**The script.** Ten lines, in plain radio procedure; both speakers already know the facts. The
hiker's name is never said (names are seeded per world). Dispatch is heard through the radio,
band-passed and keyed; the ranger is dry and close.

| # | Speaker | Line |
| --- | --- | --- |
| 1 | Dispatch | "Four-one, dispatch." |
| 2 | Ranger | "Four-one. Go ahead." |
| 3 | Dispatch | "We've had reports of a missing hiker. Last seen at Trail 14." |
| 4 | Ranger | "Copy. Anyone see them come down?" |
| 5 | Dispatch | "Last sighting was near the summit. The caller didn't leave a name." |
| 6 | Ranger | "All right. Who's meeting me out there?" |
| 7 | Dispatch | "I've got nobody else to send." |
| 8 | Ranger | "Figures. I'm ten minutes out. Up to the summit and back before dark." |
| 9 | Dispatch | "Four-one, be advised, radio won't carry past the road. If anything..." *(static)* "...get back to the road." |
| 10 | Ranger | "Dispatch, you're breaking up. ...Dispatch?" |

What the call plants: the goal (last seen near the summit); the rule that saves you (get back to
the road: the one ground the Hollow never crosses); that you are on your own (no radio past the
road; line 7 holds for a solo player and for a party); and the wrong notes, none remarked on: a
caller with no name, "before dark" on a mountain that goes dark by the crest, the signal dying on
the words that would have said why, and no birdsong when the engine stops.

**Captions.** Every line is a caption, at most 42 characters a line and two lines, no faster than
20 characters a second; dispatch in italics with the label "Dispatch (radio)". The captions come
from `intro.ts`'s caption track, the same data the staged scene shows, driven at playback by the
video's clock (§5), so they cannot drift from the voice.

## 4. The file

One video, delivered through the asset repository's export like every asset, LFS-tracked,
listed in `client/assets/catalog.json` with `kind: "video"`, content-hashed by the build and
served immutable:

- H.264 in MP4, 8-bit, 1280 by 640 (2:1), 24 frames a second, key frames every 2 s, `faststart`,
  AAC audio; the encode dithered against banding in the fog and gated on a banding score
  (the asset side's concern). Expected 20 to 28 MB for sixty seconds.
- Optionally an AV1 version in 10-bit as the first `<source>`, the H.264 file as the fallback.
- No black bars in the file: the page letterboxes it and puts the captions and the bar in the
  bars.

The still for the title page is one frame of shot 8, held, as a WebP of 1280 by 640 under
200 KB, delivered the same way.

## 5. Playback and loading

### 5.1 The title page

The page and the still: no engine, no models, no ground maps, no shader map before Play. Play,
the party's roster and the other links as today. The first load of the title page is under
1.5 MB (a check). The looping title video comes later: a montage of several angles of a world,
cut with dissolves, its loop's seam inside a dissolve so it is never seen, small enough to keep
the page light; it takes the still's place and nothing else changes. Designed in
[`2026-10-01-title-loop.md`](2026-10-01-title-loop.md).

### 5.2 On Play

1. The Play click starts the video at once, in the click's own gesture so it plays with sound.
   The file streams: it plays after a couple of seconds are buffered, under shot 1's fade in.
2. The tier probe, where it runs (a first visit on Auto), runs behind the video.
3. Once the video has six seconds in hand, or three seconds have passed, the game's download and
   build begin: the engine, the ground maps, the models in the order the first frame needs them,
   the calls, and on WebGPU the translators and the shader map. Until then the video has the
   line to itself.
4. The world build runs in steps that yield between them: the start's phases are already
   separate awaits; the clipmap's first build is a slice generator and is stepped rather than run
   whole; the first frame's collectors run under the sync budget rather than whole. Today the
   whole start is one blocking task of about two seconds on a fast machine; after this it holds
   the main thread for no more than 150 ms at a time, so the captions and the bar keep painting.
5. Ready: the scene is ready, nothing is in flight, the forest's billboards are baked, and on
   WebGPU a whole frame has been drawn with no draw left out; the gate the tier switch already
   uses, run once at start.

### 5.3 The bar and the line

One thin bar along the bottom edge of the letterbox and one short line under it, in a corner,
muted. The line names the stage the load is in and its count, one stage at a time:

| Stage | Line | Where the count comes from |
| --- | --- | --- |
| downloading models | `downloading models 31 of 45, 22 of 47 MB` | every model passes through `loadUntilAborted`; bytes from the loader's progress and totals from the catalog's `bytes` |
| ground and sound | `ground and sound 20 of 24` | the 18 map fetches and the 6 calls |
| shaders, WebGPU | `shaders 3.1 of 4.2 MB`, then `pipelines 40 of 60` | the translators' and the map's bytes against `content-length`; pipelines landed of asked |
| shaders, WebGL2 | `compiling shaders 40` | the engine's compile observable; no total exists at run time, so the line counts up and the bar's segment fills when the gate says done |
| building the world | `building the world 3 of 7` | the clipmap's rings, then the billboards baked of the billboards wanted |
| ready | `ready` | the gate |

The bar is one value in [0, 1], weighted by bytes for the download stages (the only part that
scales with the connection) and by count for the rest, and it never moves backward. Where no
total exists it never shows a fake percentage. `catalog.json` gains `bytes` per asset, written by
the export; a test checks each against the file.

### 5.4 Skip, the end, the cut

Once ready, `hold to skip` appears beside the bar: hold any key, mouse button or touch for
0.8 s, a ring fills; releasing early does nothing. The film's last shot holds on its final frame
with `click to step out`; that click, or a skip's release, is the gesture the browser needs for
the pointer lock and the sound, so the cut is always on a gesture and never lands in the pause
menu. The cut is to first person on the player's own pad, facing up their trail, controls live.
If the world is not ready when the film ends, the last frame holds and the bar keeps counting
until it is.

The title card: three seconds of the game's name over black after shot 8, once per Play, then
the last frame returns for the hold.

### 5.5 Followers, failures, the wire

A player who joins by an invite link sees the same intro while connecting, on their own
machine, with the sound off: they are brought to the hike by the host's Play with no click of
their own, and a browser plays a video without a gesture only muted. A sound button at the top
right of the film turns it on; it is plain while the sound is off and faded once it is on (the
host's own intro, which plays with sound, shows it faded). The host never waits for anyone's
video. A join that fails (a level id mismatch, a dead
host) shows the connect-failure panel in place of the video, which stops. A video that fails to
load starts the game as it does today, with no intro.

The sim and the wire never see any of this. A player mid-video is, to the host, a player who has
not engaged yet.

## 6. The recording

The asset side records the film from the scene route on the high tier at 1280 by 640: for each
of the 1,728 frames it asks the route for 8 sub-frames spread over the first half of the frame's
1/24 s and averages them, which gives the motion blur of a half-frame shutter, then encodes as
§4 says. The route's `frame()` promise and stepped clock are what make that frame-exact. How the
frames are captured and encoded is the asset repository's tooling and is not written here.

## 7. Budget

- Bytes per play, first visit: the video (20 to 28 MB) plus the game (about 52 MB today; the
  four trees are 2.5 to 3 MB each). At 10 Mbps, the design floor, the video and the game land in
  about 60 to 65 s; at 25 Mbps under 30 s; on the lines below the floor the held frame and the
  bar cover the rest. The connection medians are far above the floor.
- Egress: the video's bytes per play times plays per month against the hosting plan's rate, as a
  number in the plan, not a guess.
- Mesh compression of the models (the glTF mesh compressions usually halve them; gzip takes
  23 percent off) is the lever outside this spec that moves every row of that table.
- The title page: under 1.5 MB on first load.

## 8. Testing

### 8.1 In Node

Every numeric expectation is a literal; explicit time limits go through `timeLimit(<ms>)`.

- `timeline.ts`, `shots.ts`, `roadPath.ts`: at *t* the frame's camera, actors, car and caption
  are the same numbers every call; the eight shots sum to 72 s and each shot's field of view is
  within [0.10, 0.57] rad; the caption at any *t* is the script's line for that *t* or none; the
  car's position along the road at a distance lies on the road's centreline plus its lane
  offset; a seek is idempotent.
- The playback model (`introPlayback.ts`, a pure model with a dumb renderer): states
  playing, ready, holding, skipped, ended, stepped out; inputs the video's time, the world's
  readiness, the hold's progress, the gesture. Pinned: no cut without a gesture; ready never
  before the gate; a hold released before 0.8 s never skips; a hidden tab pauses and resumes at
  the same *t*; the title card shows once.
- The progress model (`loadProgress.ts`): stages, counts and bytes in; one bar value and one
  line out. Pinned: the bar is monotonic; the download stages weigh by bytes; no stage without a
  total ever reports a percentage; `ready` only when the gate says so; one stage named at a time.
- `catalog.json`'s `bytes` matches every file on disk; the video and the still are in the
  catalog and the build hashes them.
- The scene runs with no local player and the sim's state is untouched by a scene frame.

### 8.2 In the browser, on this machine

1. **No freeze.** From Play to ready, on both tiers and both engines, with the probe running and
   with it skipped: the video's `getVideoPlaybackQuality()` reports no dropped frames; the
   longest main-thread task after Play is under 150 ms; the captions and the bar are seen to move
   throughout. (Measured before this spec: in this Chrome a video keeps presenting every frame
   through a 5 s main-thread block, and only the captions freeze; the yielding steps are for the
   captions and the bar, and the gate is for other hardware.)
2. **The probe's verdict** is the same with the video playing and without, three runs each.
3. **Time to ready** under Chrome's Fast 4G and Slow 4G presets and unthrottled, on a first
   visit with the cache cleared and on a repeat visit: the bar reaches ready, the last frame holds
   where it should, and the step-out click cuts to first person on the pad facing the trail.
4. **The cut:** the film's last frame and the game's first are framed alike; the controls are
   live on the click; the pause menu never shows on its own.
5. **A phone:** 390 by 844 portrait, the video letterboxed, the captions and the bar readable
   in the bars, hold to skip by touch.
6. **A follower** joining mid-video sees the intro; a join that fails shows the connect panel
   and the video stops.
7. **A missing video** starts the game as today.

### 8.3 On other hardware

The no-freeze and time-to-ready gates on the Windows machine with the NVIDIA GPU, in headed
Chrome on WebGPU; the picture on one real phone.

### 8.4 In production

`deploy:verify` checks the video and the still the way it checks the models: the hashed URL is in
the bundle, the video's bytes begin with the MP4 `ftyp` box, both are served immutable; the
title page's first load is under 1.5 MB.

### 8.5 Recorded, not asserted

Bytes per play and the hosting rate; the fog shots' banding score; the file's loudness against
the game's; the time to ready on each connection preset.

## 9. Boundaries

- The summit scene and the ending are their own specs; the scene player is built so the summit
  scene can hold the world and draw the player's own ranger, but nothing of that is here.
- The level id does not move: no sim value changes. The spawn already faces the trail.
- The looping title video is a later asset; this spec leaves it a place (§5.1) and no more.
- The radio's voices, the ranger's face rig and clips, the car's parts, the sound mix, the
  recording and the encode are the asset repository's.
- Mesh compression of the models is a separate change.
