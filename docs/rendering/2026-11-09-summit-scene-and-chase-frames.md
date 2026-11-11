# The summit scene's and the chase's frames

**Status:** Built 2026-11-09, measured on the rented rig (a g4dn.xlarge: an NVIDIA T4, four
virtual CPUs, Chrome 154) on the medium tier at 1470 × 956, on both engines.

## 0. What was wrong

On the medium tier the summit scene stopped: the screen kept one image for most of its 21
seconds, so the scene was missed. The chase after it never drew 60 frames a second, and froze for
seconds at a time.

Measured on the live build (`6856923d`), the player walked the last metres to the body as a
match's find comes, then sprinted the way the scene's threshold turns them
(`tools/frame-budget/timeline.mjs`):

| | WebGPU (medium's own engine in Chrome) | WebGL2 (the desktop launcher's) |
| --- | --- | --- |
| The scene (21 s) | the screen held on one image for 18.2 s, in six holds, the longest 15.6 s | 5 frames drawn in 23.5 s, the longest 12.5 s and 9.0 s |
| The chase's first 20 s | 3.1 s more held; 22 to 28 frames a second | 2 to 6 frames a second; frames of 6.2 s, 4.9 s and 2.5 s |

Three causes, each its own.

## 1. The find changed every material's shader

Babylon writes a material's shader for the lights that reach its mesh: a light added to the scene
is a different shader for every lit material, and on WebGPU a different render pipeline.

The summit scene shows the local player's own body, with their headlamp on it
(`docs/gameplay/2026-10-08-the-summit-scene.md`). That lamp was a light made in the scene's first
frame, the fourth of a solo hike (the sun, the fill, the lamp on the lens, and it). So the frame the
phase flipped, every lit material in view needed its shader again: 22 pipelines asked for at once
on WebGPU, and as each shot cut to a new view, the materials first seen there (27 more over the
scene: the terrain, the trees, the rock, the body, signs, water, animals).

- **WebGPU.** `asyncPipelines.ts` holds a scene's frames, the canvas keeping its last image,
  while a pipeline is being made, so a world is never drawn with its ground left out. The rig made
  a pipeline in 0.4 to 0.9 s, two at a time: the first 22 took 9.7 s. A held frame draws nothing,
  so the next wave was only found once the first had landed: the holds ran end to end through the
  scene. The game went on under them: the cry, the Hollow's rise and the voice's lines played to a
  still picture.
- **WebGL2.** The programs were linked where they were first used, and the page stopped in
  `getUniformBlockIndex` for each (ANGLE on Direct3D compiles there): two frames of 12.5 s and
  9.0 s. The chase's first frames paid for the rest.

**Built.** The local body has no lamp of its own. The lens's lamp is the local player's one lamp
all game, and a scene wears it where it needs it (`placeLensLamp`, `renderer.ts`): on the camera
through the hike; at the body's eye, as the views drew it that frame (`EntityViews.localEye`),
while a scene shows the body (the summit's shots, the end scene's run), lit for the shot; off
from the end scene's arrival to the engine's catch; then the car's headlamp. So a solo hike
binds three lights from its first frame to its last (the sun, the fill, the lens's lamp), a
party two and one a player, never over the cap of seven (`LIGHT_BUDGET`; a terrain's stage binds
twelve uniform buffers with seven lights, WebGPU's default most), and the find asks for nothing.

The light the body's lamp was also stood for the end scene's second headlamp: the car's two were
the lens's lamp and the body's (`docs/gameplay/2026-10-12-the-end-scene.md`). The car is now lit
by one light at the middle of its nose, as bright as the two together (`HEADLAMP_INTENSITY`).
On a road lit from a few metres on, a nose 1.2 m wide is nearly a point; the wet ground shows
one reflection where it showed two.

Kept at three lights, a solo hike's shaders are the ones the shipped corpus already holds (but
for two things now first drawn under them, §6).
A first version (§7's `rc1`, `rc2`) kept the body's lamp as a fourth light, dark, from the
hike's first frame instead. It fixed the scene as well, but every lit fragment then paid for a
fourth spot light through the climb (the scene pass at the settled summit view 3.37 ms with three
lights, 3.63 ms with four, on the rig's T4: 8 %). Every lit material also needed shaders the
corpus did not hold: first visits translated them in the page.

## 2. Things first drawn in the scene and the chase held the page too

With the lights constant, the scene still asked for ten pipelines and held 4.7 s for them:

- **The local player's body** (two: the ranger's materials), first drawn in the first shot.
  **Built:** it is drawn for its first frames `WARM_DEPTH_M` (40 m) under the player's feet,
  behind the ground, whatever the view (`EntityViews.warmLocal`), for at least `WARM_FRAMES_MIN`
  frames the scene drew and `WARM_MS` after the first of them, then hidden until a scene. Counted
  in frames drawn, not frames asked for: a page still holding its frames for the world's
  pipelines has drawn none, and a warm-up counted by the clock alone ended before it began.
- **The film's car** (seven), fetched at the find for the end scene and swapped in a kilometre
  off, "unseen": its first frames held the scene's first two shots, and on WebGL2 its textures
  (`texImage2D`, 0.8 s) and its programs' first draws (0.5 to 1 s each) stopped them.
  **Built:** it is fetched with the hike's scenery (`buildExtras`, `app.ts`), so all of that
  falls in the hike's start.
- **Anything else newly in view.** On the live build each animal, pond or sign first met on a
  hike held the page for its one pipeline (half a second on the rig), on the climb as in the
  chase. **Built:** once a frame of an engine has been whole (drawn, having asked for pipelines
  before it, with no draw left out and none asked for), its frames are held only while more than
  `HOLD_PENDING_OVER` (8) pipelines are pending at once; up to that many, the frames draw and the
  new things are in the picture when their pipelines land. A world that is not in still holds, as
  does any change that asks for every material's again (22 at the find, before §1).

## 3. A sight line cost four milliseconds, and the chase cast several a frame

The chase's main thread on the rig, a frame of 37 to 43 ms: 6 to 10 ms in `hasLineOfSight`
(`sim/ai.ts`), cast by the Hollow's hunt every tick, by the haunt, and by the lens every frame
(`escalationTargets`: how near the Hollow is, halved without a sight line). Only the chase has a
Hollow to see, so only the chase paid.

A sight line is a march through the ground's height field, a step every half metre
(`raycastGround`), 160 steps over 80 m, and since the walkable rock (2026-10-13) a height is the
bare ground and the rock's layer on it: the mask's smoothed slope (four more ground samples), and
where there is rock its bend (four more). Five to nine ground samples a step, about 4.5 ms a ray on
the rig. Slow frames then ran more ticks each, every tick its own rays.

**Built**, each the same answer as before, to the bit:

- `GroundField.above(x, y, z)` (`sim/ground.ts`): whether a point is above the surface, which is
  all a march or its bisection reads. Under the bare ground it is not, the layer never sinking
  it; more than `GROUND_DEPTH · sqrt(1 + g²)` over the bare ground it is, that being the most the
  layer rises (its mask and its relief's share are at most 1, its depth at most `GROUND_DEPTH`);
  between, the layer is asked. `raycastGround` asks it. `test/sim/groundRay.test.ts` holds the
  march to the old one's answers on 1,200 sight lines around the crest, and `above` to
  `heightAt`'s on 4,000 points.
- `rockRiseAt` reads the trail's clearance before the mask's slope: on the trail's bed the rise
  is nothing either way, and a sight line down the trail asks one distance a step, not four
  ground samples.
- The lens's sight line is cast every `LENS_SIGHT_MS` (100 ms) and kept between (`sightEvery`,
  `app.ts`): the lens eases over 1.5 s. This is the screen's alone; the simulation's rays are
  every tick's, as they were.

Measured in the chase's first 20 s: `hasLineOfSight` 6.3 to 9.9 ms a frame before, 0.9 to 2.2
after; the lens's share 3.8 to 4.0 ms, then 0.5; a tick's whole work 3.2 to 8.3 ms a frame, then
1.2 to 3.8.

## 4. One slow frame at a sprint rebuilt the ground at once

A shell that streams with the view (the terrain's rings, the face patches, the forest's bands)
rebuilds in slices under a budget when the view crosses one of its lines, and at once when the
view jumps (`crossingAt`, `syncJobs.ts`): a teleport, or a step of more than a metre in a frame,
the free camera's boost. A sprint is 0.12 m a frame at 60, and 1.05 m over one frame of 150 ms: so
after any one slow frame (a collection, a buffer's upload) a sprinting view was taken for a boost,
and every shell crossing a line that frame built its whole set at once. The face patches' took one
frame of 1.1 to 1.3 s on the rig: seen 1.4 s into both sprints of the live build on the climb, and
2.4 s into the WebGL2 candidate's chase, each time straight after a frame of 0.18 to 0.26 s.

**Built.** The step is read as it would be at 60 frames a second: over a longer frame it is scaled
to one, by the scheduler's clock as its last share began (`SyncJobs.started`), so it is the view's
speed that says a burst. A jump of more than a cell is a jump at any frame rate. With it, three
WebGL2 runs of the chase had no frame over 0.46 s; few runs, on a fault that needs a slow frame to
fall beside a line, so it is the rule's tests (`syncJobs.test.ts`) that hold it.

## 5. After

The candidates on the rig, the same walk and sprint (§7 for the runs). Frames a second are the
scene's whole 21 s; the rig's frames are capped at 60 in stretches and its CPU is a fraction of
the Air's, so they say the page kept drawing, not what the Air will read. The four-light
candidates (`rc1`, `rc2`) and the build as it stands, three lights (`rc3`):

| | Live, WebGPU | Four lights, WebGPU | Three lights, WebGPU | Live, WebGL2 | Four lights, WebGL2 | Three lights, WebGL2 |
| --- | --- | --- | --- | --- | --- | --- |
| Runs | 2 | 3 | 2 | 1 | 4 | 1 |
| The scene: screen held, or frames over 0.25 s | 18.2 s held | none | none | 5 frames in 23.5 s | one frame in two of the four (0.34 s, 1.05 s; below) | one (0.33 s, shot 4) |
| The scene: frames a second | (held) | 62 to 79 | 40 to 55 | 0.2 | 72 to 91 | 63 |
| The scene: worst frame | (held) | 0.08 to 0.09 s | 0.09 to 0.14 s | 12.5 s | 0.10 s, but for the two above | 0.33 s |
| The scene: pipelines asked for | 49 | 1 to 3 | 1 to 2 | | | |
| The scene and the chase: shaders translated in the page | | | none | | | |
| The chase: screen held | 3.1 s | none | none | | | |
| The chase: worst frame | (held) | 0.16 to 0.34 s | 0.14 to 0.25 s | 6.2 s | 0.15 to 0.46 s with §4 (three runs); 1.34 s without (one) | 0.50 s |
| The chase: sight lines, ms a frame | 6.3 to 9.9 | 0.4 to 2.2 | | 8.2 | 1.3 to 1.4 | |
| World ready, first visit | 44 to 78 s | 58 to 74 s | 76 s (138 s on a rig's first page) | | | |

The three-light runs' scenes read slower than the four-light runs' (40 to 55 frames a second):
their first and last shots spent the main thread's whole four seconds sampling the ground for the
streaming shells (`sim/field.ts`), as the sprint does (below), not drawing; the GPU's passes were
the same or less. The end scene, played by the console's `escape` on WebGPU, drew 81 frames a
second with no frame held and no shader translated in it, and its screencast shows the lamp at the
runner's eye in the run and one pool ahead of the car's nose from the catch.

The live build translates 4 shaders in the page as a hike starts; the three-light build 8 to 20
(2.7 to 6.2 s on the page's thread, while the world loads): the film's car and the local body,
drawn there now under the hike's three lights, which the live build only drew under four. They
are recorded into the corpus since (§6), after these runs.

What is left:

- **A sprint on the rig is 25 to 40 ms a frame, on the climb as in the chase.** The rig's CPU,
  bound by what a moving view costs on the main thread: the streaming jobs 8 to 11 ms a frame
  there, Babylon's own frame 11 to 16. The chase's own share (the sight lines, and the ticks that
  piled up behind slow frames) is gone; what remains is the climb's as much as the chase's. The
  face patches' and the clipmap's rebuilds sample the ground on the main thread, and a worker
  would take them off it.
- **WebGL2 on Direct3D stops once in the scene's fourth shot** (0.34 s and 1.05 s in two runs of
  four: `bindVertexArray`, `activeTexture`, `uniformMatrix4fv`): ANGLE compiling at a first draw,
  of what that shot is the first to see (the mist's meshes; the car's parts the warm-up's thirty
  frames left). On WebGPU the same things are three pipelines under the hold's bound. Not seen
  on macOS, where it was not measured.
- A collection of 0.15 to 0.29 s lands in some runs' first shot or first seconds of the chase.

## 6. The shader corpus

No stage of the hike's changes: a hike binds the lights it bound before the find (§1), and the
shipped WGSL maps (`client/shaders/corpus/`) hold its shaders. Two things are drawn under those
lights that were not before, both at the hike's start: the film's car (fetched with the scenery,
§2) and the local body (its warm-up, §2). Their stages were recorded on 2026-11-11 from this
build, every page of `tools/wgsl/record-pages.json` on the three tiers: 84 stages new to the
corpus (1,182 in all; the low tier's map at 81 % of its ceiling, medium's 63 %, high's 58 %).

## 7. The runs

`/Volumes/CyrusExtSSD/dayhike-lab/frame-budget/2026-11-09-summit-chase/`: each run's frames
(`<label>.json`), its CPU profile and a JPEG of its last frame; `maps-*` the lab builds' source
maps. `base-*` the live build, `climb-*` its sprint with no find, `lab-*` and `lab2-*`, `lab3-*`
one switch at a time (the lamp; the sight line; the hold's bound and the body's first frames; the
car), `rc1-*` the four-light candidate before §4, `rc2-*` with it, and `rc3-*` the build as it
stands, three lights. Read one with `tools/frame-budget/timeline-report.mjs`.
