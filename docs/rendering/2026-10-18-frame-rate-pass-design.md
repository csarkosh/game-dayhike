# The frame-rate pass

**Goal:** the frame rate up on every tier with no change to the picture, or
none a player would see, and the walk smooth. Measured on an Apple M4 (an
`apple-base` GPU, which the game starts on the medium tier) at the meadow
pose (`seed pine`, free camera at 90, −316, yaw 0.8), the frame cap on
unless said, each page settled 90 s before a sample of 8 s, one page at a
time on an otherwise quiet machine. What the players' own pages reported
first.

## 1. What the players see

The telemetry's heartbeats over thirty days (`tools/telemetry/queries/`,
the `hb` rows: about twenty pages that reported a frame rate):

| Machine | Tier, engine | Frames a second |
|---|---|---|
| Apple M4 (base) | medium, WebGL2 | a median of 54, from 60 at the trailhead to about 40 past the hike's middle |
| Apple M3 Max, before the soft shadows | high, WebGPU | 93 at the start, 27 by the end |
| Apple M5 Max, M4 Max, with the soft shadows | high, WebGPU | 7 to 16 |
| GTX 1060, Arc A750 | medium, WebGL2 | 1 to 68, two pages each, one of them broken |
| Mali-G715 (a phone) | low, WebGL2 | 43 to 56 |

The high tier was the emergency: the machines meant for it ran it at a
tenth of the rate the medium tier runs on a base chip. The medium tier's
slide over a hike is the night: the rain, the mist and the lamp. The game
draws at the window's CSS pixels on every tier (`lighting.ts` sets the
hardware scaling level to the tier's 1, which overrides Babylon's device
ratio), so a Retina display costs nothing extra: a 14-inch MacBook's window
is 1512 by 982, 1.5 million pixels, and that is the size the medium tier is
judged at below.

## 2. The high tier: the soft shadow's array

Every feature of the high tier switched off one at a time, the frame rate
read after each (the switches were a measurement hook, not shipped):

| High tier at 1200 by 675 | Frames a second |
|---|---|
| as shipped | 1.4 (720 ms a frame) |
| without the soft shadows (plain filter) | 15 |
| without shadows | 18 |
| without the far field, the mirror, the paint, the cascades' reach, the halation and clouds, the mist, the water frame, or the blades | 1.4 each |
| on WebGL2, as shipped | 11 |

One switch, and only one, brought the tier back, and the same scene on
WebGL2 ran at eight times the rate: the cost was not the soft shadow's
reads but a shape in its shader that one translation mishandles. Babylon's
percentage-closer soft shadow finds the blockers round a sample with 16
reads of the depth map and filters with 32 reads of the shadow map, each
offset by an entry of a 64-entry Poisson table that is a function-scope
constant array, passed by value into the filter and indexed by the loop
counters. Through SPIR-V to WGSL, the compiler at the end keeps that array
in memory and reads every tap's offset back through it, for every lit
fragment. The paint pass met the same cost in its sector sums a day
earlier (`2026-10-17-painted-post-webgpu-vs-webgl2.md`), 12.5 ms against
2.1, and the cure is the same: no array.

`softShadowInclude.ts` rewrites the 32-tap cascaded function of Babylon's
include, the one the tier calls, with its 48 taps written out, each offset a
literal taken from Babylon's own table, the same arithmetic in the same
order, and `lighting.ts` puts the rewritten include in Babylon's store where
it chooses the soft filter, before any material compiles. The include's
other functions are left as they are: nothing calls them on this path, and
the translators drop a function nothing calls. The test processes a
material through Babylon's WebGPU processor and inliner and translates it
with the build's own glslang and Tint (`softShadowInclude.test.ts`), which
is what found three traps on the way: a negative literal after a minus
reads as a decrement (every literal is parenthesised); Babylon's inliner
wants a function's brace right after its signature (the rewrite's mark sits
just inside the include's shadows guard, where a stage without shadows
drops it with the rest and keeps its recorded translation); and a sampler built by a `#define`, which is how
the WebGPU path binds a texture and its sampler, cannot be a call argument,
which is why these functions are marked `inline` and must stay inlinable.

| High tier at 1200 by 675 | Frames a second | Draw calls a frame |
|---|---|---|
| as shipped | 1.4 | |
| taps written out | 30 (33 ms) | 2163 |
| taps written out, plain filter | 35 (29 ms) | |

The soft shadow now costs about 4.6 ms a frame on this chip at this size,
and the picture is the same: the filter's arithmetic is unchanged.

## 3. The high tier's draw calls: the far cascade

2163 draw calls a frame against the medium tier's 1014: the shadow map's
676 casters drawn into three cascades. By their names: 469 rock face
patches, 104 animal parts, 66 signs, 16 boulders, 7 clipmap rings, 6
trailhead props, 6 giant-tree buckets, 2 summit props. The third cascade
reaches from about 150 m to 1500 m with a texel of 0.6 m: a patch, a sign
or an animal a metre or three across is a speck in it or nothing, drawn
650 times a frame for that.

`lighting.ts` takes a reach with each caster (`ShadowReach`): `far`, every
cascade, for the ground, the clipmap, the trees, the cliffs and the props;
`near`, every cascade but the farthest where the reach is long
(`farCascadeIndex`: the last of two or more cascades reaching
`FAR_CASCADE_REACH_M`, 500 m, so the high tier's third), for the patches,
the signs, the animals and the boulders. Babylon asks for each cascade's
list by its layer (`getCustomRenderList`); the farthest gets the far
casters' own list, remade when a caster comes or goes. The medium tier's one
cascade and the low tier's none are untouched.

| High tier at 1200 by 675 | Frames a second | Draw calls a frame | CPU in the scene's render |
|---|---|---|---|
| taps written out | 30 | 2163 | 13 ms |
| and the far cascade's list | 35 (28 ms) | 1561 | 10 ms |

## 4. The paint at half resolution

The medium tier at the laptop window, the frame cap off so the frame time
reads whole, each feature switched off in turn:

| Medium tier at 1512 by 982 | Milliseconds a frame |
|---|---|
| as shipped | 27 to 32 (31 to 37 frames a second) |
| without the paint pass | 21 |
| without the post chain at all | 16 |
| without shadows | 29, and 274 draw calls in place of 1006 |
| without the far field, the blades, the mist or the clouds | within the noise of as shipped |

The post chain is the cost at this size, and the paint pass most of it. The
stroke's radius scales with the frame's rows so the stroke is the same
share of the picture at any size (`paintRadiusFor`), and 982 rows asked
the medium tier for a 3 px stroke: 49 taps a pixel at 1.5 million pixels.
The pass is bound by its texture reads, not its arithmetic: a version that
read each tap's sector weights from a table ran no faster, and one that read
every other tap of the stroke's outer ring (21 taps in place of 49) gained
nothing measurable either.

The paint now runs at half the frame's pixels on each axis (`PAINT_SCALE`),
a quarter of the reads, with its radius halved to match
(`paintTexelRadius`), so the stroke keeps its size on the picture. A plain
upscale of the half-size paint read as a blur, not as paint: blades and the
kiosk's edges smeared. `paintCompose.fragment.fx` brings it back to the
full frame edge by edge, a joint bilateral upsample: each pixel takes the
four half-size texels round it, weighted by their bilinear share and by how
alike the scene is at each texel's centre and at the pixel
(`PAINT_JOINT_SHARPNESS`, 60, on a compressed colour), so a stroke never
crosses an edge the full frame has, and mixes the result over the scene by
the paint's strength. The paint itself writes its painted colour whole; the
compose does the mixing.

| Medium tier at 1512 by 982, WebGPU, cap off | Frames a second at the meadow |
|---|---|
| the paint at full size, 3 px | 32 to 37 |
| the paint at full size, held at 2 px | 42 |
| half size, plain upscale | 49 to 53 |
| half size, edge-preserving compose | 51 |

At every pose the compose is within a frame or two of the plain upscale,
and its picture is close to the full-size paint's. The high tier's paint
runs the same way, ahead of its halation.

## 5. The walk

The simulation steps at 60 Hz and the renderer draws when the browser asks.
The camera took the local player's pose straight from the last tick, so at
any frame rate but the tick rate the eye moved by one tick on some frames
and two on others: held W for twelve seconds at about 40 frames a second,
the eye's steps were exactly 1, 1, 2, 1, 1, 2 ticks' worth, frame after
frame, every step on a tick multiple. That is the judder in the walk and
the stutter in the look.

`eyeBlend.ts` draws the eye `alpha` of the way from the pose the frame's
last tick began with to the pose it ended with (`alpha` is the
accumulator's fraction of the next tick, `loop.ts`): one tick behind the
simulation, which nothing a player does can tell, and moving the frame's own
share of a tick. The loops capture the pose before their last tick
(`app.ts`, `eyeBefore`) and hand it to the renderer with the frame
(`FrameView.before`); the yaw turns the shorter way round; two poses more
than `EYE_SNAP_M` (3 m) apart are a teleport, a stand or a respawn, and the
eye snaps. The same walk after: steps of 1.45, 1.47, 1.40 ticks' worth,
following the frame's time, 6 % of them on a tick multiple, and those the
frames whose own time hit a tick's. The remaining unevenness is the frame
time's own.

## 6. The medium tier on WebGPU

The medium tier was left on WebGL2 in September, when WebGPU measured no
faster there. With the paint and the far softening in the chain it now is,
at every pose, interleaved with WebGL2 at the laptop window, cap off:

| Medium tier at 1512 by 982 | WebGL2 | WebGPU |
|---|---|---|
| forest | 34.1 ms (29 a second) | 28.0 ms (36) |
| trailhead | 40.3 ms (25) | 26.1 ms (38) |
| meadow | 29.6 ms (34) | 20.1 ms (50) |

`WEBGPU_TIERS` in `engineChoice.ts` now holds the high and the medium tier.
The high tier's own features (the wind-sea's spectrum, the water's frame,
the spray, the lake's mirror) are gated on the tier, not the engine, so the
medium tier gains none of them. Its first visit now fetches what a high
tier's does: the WebGPU engine, the translators and the medium tier's WGSL
map.

## 7. The forest

The forest is where the medium tier was slowest. In a small window, where
the pixels cost little, each family switched off in turn against the whole
scene between every switch (the measuring machine is a fanless laptop whose
frame times drift a quarter within a run, so only a reading next to its
base means anything): the floor cover 7.6 ms, the trees 5.6, the shadows
3.6, the post chain 1.2, everything else under 1 ms each. A count of a
forest view's triangles put the floor cover at 2.5 million of 5.3 million a
frame, and the two bushes at 1.7 million of those.

- **The bushes** (`clutterMeshes.ts`, `BUSH_LOD_NAMES`): each model ships
  three levels; the near band now draws the second (510 triangles) and the
  far band the third (200), where they drew the first (1,150) and the
  second. A shrub a metre across is a few pixels past the seam under the
  canopy, and inside it the second level's cut of the same cards reads as
  the first. The forest at the laptop window: 38.3 to 33.6 ms on WebGL2.
- **The floor cover's reach** (`CLUTTER_REACH`, 0.7 of every class's
  radius on the tiers that draw the blades; the low tier keeps its 0.6),
  through each class's fades, seams and far band: about 3.2 ms a forest
  frame, the cover's outer rings being cards a few pixels tall under the
  fog and the paint, where the ground's own far cover reads the same.
- **The trees' rings** (`forestField.ts`): the full model to 36 m (from
  42) and the middle level to 70 m (from 85), the seams 30 to 36 m and 61
  to 70 m: 1.3 ms. The giants' full models are the forest's shadow casters,
  so the trees cast to 36 m.
  *Amended 2026-10-23:* the giants' LOD1 buckets cast again, as near casters (every
  cascade but a long reach's farthest), so a tree casts out to LOD1's edge; without them a
  tree cast nothing until the player was within 36 m and its canopy's shadow switched on over
  the trunk as they walked up. The caster pass is culled per cascade and drawn every second
  frame since the second pass (`2026-10-23-frame-rate-pass-two-design.md`), so the LOD1 draws
  cost a fraction of the 2 ms measured here.

| Cap on, at the laptop window | Floor cover as it was | at 0.85 | at 0.7 |
|---|---|---|---|
| forest | 36 | 39 | 40 |
| trailhead | 37 | 39 | 41 |
| meadow | 45 | 47 | 49 |

The shadows were looked at and left: their filter's taps cost nothing
measurable (one tap to nine read the same), and their casters (about 2 ms,
425 of 590 draw calls a frame) are the trees and the ground the shadows
are of.

## 8. The night: the ground cloud once a pixel

The medium tier's frame rate slid over a hike, from 60 toward 40 in the
telemetry. By the escalation's acts, on WebGPU: the wet act added 2.6 ms,
the night 2.8, the end 3 to 4. Most of the night's was the ground cloud,
about 5 ms: the atmosphere's plugin marched it in every material's fragment
stage, eight steps of three reads each, and the foliage's overdraw drew
those fragments several times a pixel.

On the tiers with a post chain the cloud is now marched once a pixel, in
the far softening's pass, which already reads the scene's depth
(`farSoft.fragment.fx`): each pixel's ray is the camera's forward axis
plus its place on the screen (`farForward`, `farRight`, `farUp`), its
length the depth over the ray's share of the forward axis, and the cloud's
three functions are the atmosphere's own, copied to the letter
(`cloudInPost.test.ts` holds them in step). The cloud lies over the softened
colour by its optical depth, as the materials laid it over theirs, and none
over the sky. `atmosphere.ts` binds the materials no steps while the pass
marches (`setCloudInPost`), so their shader text is unchanged, and binds
the pass's uniforms through the same writer (`bindCloud`). The pictures
match to half a level in 255; the night's frame is 2.2 to 3 ms shorter:

| Medium tier, night, WebGPU, cap off | Before | After |
|---|---|---|
| trailhead | 28.0 ms | 25.6 ms |
| forest | 30.3 ms | 27.3 ms |
| meadow | 23.0 ms | 20.9 ms |

## 9. The render scale

What is left at the laptop window is the pixels. Drawn at 87 % of them on
each axis and stretched back, a frame under the paint reads as the full
one; at 75 % only a little softer. Measured cap on, before the changes
above: the forest 26 frames a second at full size, 30 at 87 %, 34 at 75 %;
the meadow 34, 39 and 42.

`renderScale.ts` holds the scale on the tiers that paint, changed by the
frame rate over windows of 2 s: two windows in a row under 48 frames a
second take it a step down (`RENDER_SCALE_STEPS`: 1, 0.87, 0.75), three in
a row over 57 a step back up. A window with a frame longer than a quarter
second in it (a load, a rebuild) counts for nothing and breaks the run. The
renderer sets Babylon's hardware scaling to the tier's own over the scale
(`engine.setHardwareScalingLevel`), so an open view keeps every pixel and
only a slow one gives some up.

## 10. The sun between two applies

The tree shadows moved in steps. The escalation and the explore day set
the whole view, the sky, the fog, the reflection probe and the sun, only
once the hour has moved a hundredth (`syncAtmosphere` in `app.ts`), since
that apply re-renders the probe. The explore day turns an hour in forty
seconds, so that was every 390 ms: the sun stood still for 23 frames and
then moved 0.14°, and every shadow jumped with it, by a metre at the tip of
a tall tree's shadow under a low sun.

The sun's light now follows the hour on every frame (`Lighting.followHour`,
through `Renderer.followHour`): it sets the light's direction from the
hour (`sunPositionAt`, as the apply does) and the hour the next apply
starts from, so a weather fade's apply cannot put the light back. Nothing
else moves with it, so it costs one vector a frame. Over 270 frames the
light moved on 13 before and on 269 after.

## 11. The worn-tape look, removed

Three things the chain laid over the grade read together as a worn tape,
and were removed the same day: the chromatic aberration pass (colour
fringing toward the edges, rising with dread), the finish pass's
peripheral overlap (a de-lit echo of the frame, mirrored and offset, rising
with dread) and its luminance-weighted grain. What the finish pass had
left, the triangular dither that keeps the 8-bit frame from banding, moved
to the grade's last lines, and the finish pass went with the aberration:
the chain is two full-resolution passes shorter. FXAA now runs after the
dither and leaves it where no edge is, which is where banding shows. The
grade's own dread terms, the vignette and the halation, stay.

## 12. Measuring

Tooling kept outside the repository: a probe that opens each pose on its
own Chrome (the frame cap off where the frame time is wanted whole), counts
animation frames and reads the scene's render time on the CPU and the draw
calls a frame; a matrix script that runs one probe a pose under an alarm
and kills every browser a probe may have left. Lessons paid for: Babylon's
per-pass GPU timestamps are not a measurement (enabling them has the engine
map a buffer per pass, and the frame goes to 500 ms; on WebGPU on this chip
the passes overlap, and their times sum past the frame's); a probe killed
by an alarm leaves its browser rendering, which inflated ninety minutes of
frame times two and a half times before it was found; a fanless laptop
slows as it warms, so every variant is read beside its base, in turn. A
page's forest and shaders settle about 90 s after it opens; a sample before
that is a half-built scene.

The player's view at the laptop window, cap on, the render scale on, before
its 75 % step:

| Medium tier at 1512 by 982 | Frames a second before the pass (WebGL2) | After |
|---|---|---|
| beach | 38 | 59 |
| crest | 38 | 60 |
| meadow | 34 | 52 |
| tarn | 29 | 50 |
| trailhead | 25 | 53 |
| forest | 26 to 29 | 45 |
| forest, night | | 46 |
| trailhead, night | | 47 |

## 13. Not done

The rain's streaks (about 1.8 ms on a wet or night frame) were left as they
are: fewer would show. *Amended 2026-10-20:* by night they are gone: the night's
weather has no rain (`NIGHT_WEATHER`, `2026-10-05-three-acts.md`), so its frame draws no
streaks, splashes or lens drops, on any tier. The forest at the laptop window on a base M4 is
still in the forties at full size; the render scale's steps carry it from
there. The high tier was measured on a base chip; the Max chips it is meant
for will show their own numbers in the telemetry.
