# Water material: design

**Spec, 2026-09-29.** The first of the water sub-projects: the material every
body of water in the game is drawn with, and the wet look of whatever the
water touches. It replaces the shading of today's sea and ponds; it adds no
waves, no surf, no shore mirror, no insects and moves no terrain. Those are
the later sub-projects (§10), and each plugs into a slot this material leaves
for it.

The physics and the numbers come from
[Photorealistic water rendering: lakes and oceans](https://csarko.sh/research/photorealistic-water-rendering)
(the research doc; section numbers below are its). The owner's rulings that
shape it: build as if the player reaches the water, and future games built on
these systems will; lakes sit at low ground and high ground both; the player
wades to the waist and the camera never goes under.

Babylon 9.18.0 throughout.

## 1. The water today

One `PBRMaterial` (`mat_water`, `renderer.ts`): white albedo, roughness 0.12,
alpha-blended, one scrolling bump texture at 24 m a tile. Four camera-following
rings at 8/16/32/64 m vertex spacing (`water.ts`) plus one 48-segment disc a
pond, and the whole look of depth baked into **vertex** colour and alpha from
the terrain height under each vertex (`waterColorAt`: foam to teal to dark
over 10 m). The sky is rendered once an hour into a reflection probe that
`scene.environmentTexture` serves to every PBR material; the sun is a
`DirectionalLight`, the headlamps are `SpotLight`s under `LIGHT_BUDGET`, fog is
a plugin anchored on PBR's fog line, and the post colour path runs after.

What that gives at the pond: a pale grey disc. The vertex ramp at 8 m cannot
draw a waterline, the disc has no shoreline at all, reflection is the whole
sky at a fixed gloss whatever the wind, and the water's colour is a ramp of
three constants rather than what a bed at that depth under that water would
look like.

## 2. What the material must do

For a pixel of water at a view angle, over a bed at depth d, under wind U, in
a body with its own murk:

1. Reflect the sky by Fresnel: 2 % looking straight down, a mirror at a
   grazing angle (§2.1). Never the ground half of the skybox.
2. Show the bed through the water darkened and tinted by the water's measured
   attenuation, exp(−2 Kd d) in each colour channel, with the water's own
   faint colour taking over as the bed fades (§2.3). The waterline is sharp:
   depth is known per pixel, not per vertex.
3. Be as rough as the wind makes it, sheltered where trees shelter it (§2.2):
   a still lake is a mirror, the sea never is.
4. Make what it touches wet: sand, pebbles, the pond's rim, a log, the
   player's legs, at 0.40 of their dry brightness and glossy (§2.4).
5. At night go black and glitter under the headlamp (§2.5).
6. Fit 0.5 ms on the high tier, 0.3 ms on medium, 0.15 ms on low, full screen
   at 1080p, before any wave, mirror or surf is added.

## 3. Approach

`PBRMaterial` with a `WaterPlugin` (`MaterialPluginBase`), the way the ground,
the cliffs and the foliage are each a PBR material with a plugin. Everything a
lit surface needs is inherited and stays one implementation: the sun's
specular, the probe's sky reflection, the headlamps, shadows on the shore, fog,
the colour path, and the WGSL corpus that the WebGPU path ships with. The
plugin replaces only what water is about: per-pixel depth, the transmitted
colour, the roughness, the reflection direction, and on the high tier a
refracted read of the frame behind the surface.

Rejected: a custom `ShaderMaterial` (re-implements seven lights, fog, the
colour path, and doubles the corpus surface; kept as the fallback if the
plugin measures over budget, §9); Babylon's `WaterMaterial` (two extra scene
renders a frame; the spike measured one mirror pass at 2.2 to 7 ms on the
medium tier, research §8.5).

## 4. Depth per pixel

Depth is the distance from the surface down to whatever is behind the pixel.
Two sources, by tier.

### 4.1 The bed: a height texture around the camera

`BedHeightTexture`: a square of terrain heights centred near the camera,
sampled from `elevationAt` (the same function the water rings and the terrain
clipmap sample, so the three agree), uploaded as one `R32F` texture on both
backends, sampled nearest and blended by hand in the shader (`r32float` is not
filterable on WebGPU, and linear filtering of float textures is not a given on
WebGL2).

| Tier | Texels | Spacing | Extent |
| --- | ---: | ---: | ---: |
| high, medium | 256² | 1 m | 256 m |
| low | 128² | 2 m | 256 m |

Re-baked when the camera leaves the inner half of the square, the new origin
snapped down to a quarter of the extent (`bedOriginFor`, the bake's own rule;
the rings snap on theirs). The bake is measured: 260 to 295 ms for
256² (3.8 µs a sample on an Apple M4 under Node), so it is never spent inside
a frame. It is spread a row a frame into a spare grid (`beginBake` and
`bakeRows`, `bedHeight.ts`) and swapped in with its origin in one call, so the
origin and the heights always change together; the first fill is whole, at
load, at the player's spawn. A bake is begun only where a body can reach the
new square (`bedSquareHasWater`: the terrain below the sea's level at one of
nine points, corners, edge midpoints and centre, or a pond's disc overlapping
the square); elsewhere the current square is kept, since there is no water to
read it. A bake whose square the camera leaves before it ends (a teleport, a
fast ride) is dropped and a fresh one begun for where the camera is.

Beyond the square the shader falls back to the depth the ring vertices already
carry (8 m apart on the nearest ring). The inner-half rule keeps the camera a
quarter extent, 64 m, inside the square's edge, so the fallback can begin 64 m
from the camera, and nearer while a bake is under way or where the square was
kept because no body reached the new one; nine points 128 m apart can miss a
strip of sea, which is then drawn on the fallback, coarser but never missing.

The pond's basin is carved into `elevationAt` by `basinD` (`sim/features.ts`),
so the disc needs no analytic profile of its own any more: `pondDisc` loses its
vertex colours and keeps its shape.

Depth of the bed at a pixel: d = level − h(x, z), clamped at 0. Negative
depth (the plane runs on over land) is discarded (`discard` at d ≤ 0), which is
what draws the waterline: the mesh has vertices on land, the pixels do not.

### 4.2 Things in the water: the frame's depth on high

A height texture cannot see a log, a rock, or the wading player's legs. On the
**high tier (WebGPU)** the plugin reads the opaque pass's depth (§4.4),
reconstructs the distance to the surface behind the pixel, and takes d = min(bed
depth, the depth below the surface along the eye ray), which is
(eye.y − surface.y)·(sceneDepth/viewDepth − 1), so a leg 30 cm under is
attenuated by 30 cm of water, not by the metre of water between the surface and
the bed. Here `sceneDepth` is the view-space depth of the opaque pass,
linearised from the resolved depth by the shader. The high path exists only on WebGPU: on WebGL2 the depth attachment is a
renderbuffer no shader can read, so the high tier there keeps the blended water
and the object tint of §6.2.

On **medium and low** d is the bed depth alone; a submerged object is made to
read as submerged by its own material instead (§6.2). In the humic lake at
1 m of bed depth that shows a leg at about 22 % of its lit colour against the
true 40 %; in the clear lake the two are within a few percent.

### 4.3 The sea's far field

Beyond the height texture the sea is deep everywhere: d is taken as the ring
vertex's depth, which is at least tens of metres, and the transmitted term is
the water's own colour alone. No new cost out there.

### 4.4 Reading the frame on WebGPU

The water is drawn after every opaque mesh (alpha-blended on medium and
low, a later rendering group on high); by then the opaque depth is final. On
the high tier the plugin reads it from the WebGPU MSAA depth resolve: Babylon
resolves the multisampled depth into a readable `r32float` texture when asked,
so the read is one sample a water pixel, with no copy of the depth and no
change to the opaque pass. A prepass variant (Babylon's `PrePassRenderer` with
the depth texture, an extra attachment on every opaque draw) was considered and
dropped as strictly more work. The scene colour is still copied after the
opaque pass (§5.2), and only in a frame whose culling kept a water mesh (a ring
or a pond's disc among the scene's active meshes): the water's group also holds
rain, mist and motes and renders without the water in view, and then nothing
is copied or resolved. Rain, mist and motes draw in the water's rendering group on
high, so the opaque water does not paint over them.

## 5. The surface

Out = F · reflected + (1 − F) · transmitted, evaluated inside PBR's lighting
so the sun's glitter and the headlamp's spot are PBR's own terms.

### 5.1 Reflection

F is Fresnel for n = 1.33: F0 = 0.02, Schlick's form, which is PBR's own and
within 6 % absolute of the exact curve for water over the whole range, the
worst at 85° (0.058; research §2.1). The plugin sets `metallicF0Factor` so F0 is 0.02 and nothing
else in the material can raise it.

The reflected colour is the sky probe sampled along the reflected view vector
with its y clamped to no less than +0.02, so a rough surface never pulls the
skybox's ground half into the water. The plugin rewrites the reflection
vector before PBR samples the probe; the probe itself is untouched. The clamp
is the exact one-step half-vector construction, not an iteration: the reflected
ray is lifted to y = 0.02 with its xz shortened to keep it unit, and the normal
is normalize(view + r'). The bed height reads are unconditional (four taps
always taken, the result selected afterwards), because a texture read inside a
branch on a varying is non-uniform control flow that the WebGPU compiler
refuses.

Roughness from wind. Cox and Munk (research §2.2): the surface's slope
variance is σ² = 0.003 + 0.00512 U, U the wind at 10 m in m/s. The game's wind
is a clamp of 0 to 1 (`windParams.ts`, `windSpeedUnder`); U = 12 m/s × wind,
so the rain-and-cloud maximum is a fresh breeze and calm is calm. A body's
`shelter` scales σ² (1 for the sea; a lowland lake in old growth 0.1, a high
lake by its exposure, set per body); the plan calibrates the floor against
the mirror photos. Beckmann's slope variance converts to a microfacet width
α = √(2σ²) and PBR's perceptual roughness is √α. A shelter of 0.1 in calm air
gives roughness 0.16; the open sea in the rain, 0.6. The plugin writes
`roughness` per frame from the weather, and only when it moves by more than
1e-3, because PBR's setter marks every submesh dirty; no texture.

Shore reflections (trees, stacks, the far bank) are not this spec. The lake
sub-project adds the mirror pass and feeds it into the plugin's reflection
slot (§7) in place of the probe for that body.

### 5.2 Transmission

Per body: an attenuation Kd per channel and a deep-water colour L∞, from the
research doc's measured rows (§2.3):

| Body | Kd red | Kd green | Kd blue | L∞ (as an albedo lit by the sky) |
| --- | ---: | ---: | ---: | --- |
| The sea | 0.34 | 0.18 | 0.26 | a few percent, green-blue |
| A lowland forest lake (humic) | 1.1 | 1.5 | 3.5 | under 1 %, red-brown |
| A high lake (very clear) | 0.2 | 0.12 | 0.2 | a few percent, blue |

Transmitted = L∞ · (1 − e^(−2 Kd d)) + bed · e^(−2 Kd d), per channel. L∞ is
handed to PBR as the albedo, so the sky's own brightness lights it: at night
it is lit by nothing and the lake goes black, as it must. On the high tier the
albedo is L∞·(1 − T), T = e^(−2 Kd d): the bed's radiance is not handed to PBR
as an albedo, which would light it twice, and bed·T·(1 − F) is added after
lighting through the emissive at the final colour composition.

On the **high tier** the term is computed exactly: the plugin samples the
scene-colour copy the spike measured (research §8.5, under 1 ms at 1080p) at
the pixel's position offset by the ripple normal's xz, the offset scaled by
min(d, 1 m) so a shallow bed does not smear, and blends per channel. The
material then writes without a framebuffer blend, still drawn after the
opaque pass (a later rendering group, depth write on) since the copy it reads
is of that pass.

On **medium and low** the surface stays alpha-blended and the blend does the
transmission: the shader outputs colour L∞ and alpha = 1 − (1 − F)·T̄ with T̄ = e^(−2 K̄ d), K̄
the mean of the three channels, and F Schlick on N·V, because plain alpha
blending scales PBR's reflection by alpha too and the sky's mirror would vanish
with the transmission at the rim and at grazing angles. The bed shows through by the right amount
with a single tint rather than three; the shoreline ramp and the amber rim of
the humic lake still read, since the rim is L∞'s colour taking over, and that
is exact.

### 5.3 Ripples

Two octaves of one bump texture. The first is PBR's own bump texture, 24 m a
tile, its UV offset scrolled by the shell at a fixed rate (`WATER_UV_SCROLL`,
`renderer.ts`). The second is `waterRipple2` in the plugin's fragment: the same
texture at 3 m a tile and a third of the first's slope, drifting with the
wind's direction (`WATER_OCTAVE2_*`). The low tier takes the first alone
(`waterOctaves`). There is no single normal function: the wave sub-projects
replace these two, the bump texture's scroll and `waterRipple2`, with their
own normals.

### 5.4 Fog and the colour path

Unchanged: PBR's fog line and the atmosphere plugin apply to the water as to
any material, and the post colour path runs after. The water's alpha on
medium and low is not fogged (fog acts on colour), so a distant sea does not
turn clear; it is deep there anyway (§4.3).

## 6. The ground side

A second, smaller plugin, `WetPlugin`, on the materials of things the water
touches. It reads one uniform per body, `wetLine`, a height in world metres, and is
bounded to the body's footprint as well as to the line (§6.1).

### 6.1 Wet ground

On the terrain material (which the pond's rim shares). For a ground pixel with
world y below `wetLine`: albedo × 0.40 (saturated sand against dry, research
§2.4) and roughness to 0.15 so the sky mirrors in it, blended over a 10 cm
band about the line so it is soft. Above the line, nothing changes. The effect is also bounded to the body's
footprint, a centre and a radius (`wetCentre`, `wetRadius`), fading out over 1
to 3 m past the rim, because one global line would paint every surface below it
(the apron 10 m from the pond is 3.7 m under the pond's line); the sea's radius
is `WET_RADIUS_MAX = 1e6`, representable in fp32. A finite body's line applies
within `POND_REACH = 40 m` of its rim, the sea's otherwise. This spec
sets `wetLine` = the body's level + 0.3 m, a still swash band; the swash
sub-project later drives it up and down the face with each wave, and how long
sand stays wet belongs there.

### 6.2 Objects in the water

The same plugin on the character and prop materials, keyed on the same
`wetLine`: below it, albedo × 0.40, and objects darken by their depth below the
body's level (`wetLevel`), not the wet line, so a wading player's legs and a
half-sunk log read as wet above the surface and submerged below it. On
medium and low the darkening is only the chromatic residual
min(1, e^(−2 (Kd − K̄) d)) per channel, since the surface's blend already
applied the mean (§5.2) and nothing may be attenuated twice. The residual is
bounded to the body's footprint as the wet look is (§6.1): its depth is
multiplied by the same 1-inside, 0-from-3-m-past-the-rim term, so ground below
the level but outside the body (the apron beside a pond) is not tinted. On the high tier
the darkening is switched off (the true-depth read of §4.2 attenuates the
frame already); the wet look above the line stays on every tier.

### 6.3 Night and the headlamp

No code of its own. The sun's term goes to zero with the sky, the probe (re-
rendered when the hour changes) gives a near-black reflection, L∞ is lit by
nothing, and the headlamp's `SpotLight` gives the glitter on the ripples
through PBR's ordinary spot specular. The water material is registered under
`LIGHT_BUDGET` (`budgetMaterial`) like every other.

## 7. Interfaces

```ts
/** One body of water, from the world at build time. */
type WaterBody = {
  level: number;              // surface height, world metres
  kd: [number, number, number]; // attenuation per channel, per metre
  lInf: [number, number, number]; // deep-water colour, an albedo
  shelter: number;            // 0..1 scale on Cox and Munk's slope variance
};
```

The sea is the terrain variant's `waterLevel` with the sea's row; a pond is a
`Pond` feature with the lowland row; the high lake is the terrain
sub-project's to place, and it arrives as another `WaterBody`. Each row has
its own material (`mat_water_sea`, `mat_water_lake`), and each mesh (ring or
disc) carries its body's level (`metadata.waterLevel`, written on every draw).

What the later sub-projects fill or replace, and what this spec puts there:

| Slot | This spec | Filled later by |
| --- | --- | --- |
| the normal | PBR's bump texture, scrolled (`WATER_UV_SCROLL`), plus `waterRipple2` (§5.3) | ocean waves, lake ripples, replacing both |
| `reflection(dir)` | the sky probe, horizon-clamped | the lake's mirror pass |
| `wetLine` | level + 0.3 m | swash |
| surface height | flat at `level` | ocean waves (displacement) |

Pure maths in Babylon-free modules: Fresnel, the attenuation and roughness
from wind and shelter in `waterShading.ts`, the height texture's bake and its
re-centring rule in `bedHeight.ts`, the wet residual's mirror in `wetPlugin.ts`
(`wetResidual`); testable under Node, as `water.ts` and `sky.ts` are.

## 8. Costs and tiers

| | high | medium | low |
| --- | --- | --- | --- |
| Depth | bed texture + frame depth | bed texture | bed texture, 128² at 2 m |
| Transmission | colour copy, per channel, opaque | alpha blend, K̄ | alpha blend, K̄ |
| Ripples | two octaves | two octaves | one octave |
| Extra passes | one colour copy, in frames with water in view; the depth is the pass's own MSAA resolve | none | none |
| Budget, full screen at 1080p | 0.5 ms | 0.3 ms | 0.15 ms |

Budgets are for the material alone, before waves, mirror or surf, and they are
measured, not estimated: paired frame times (off/on/on/off, four pairs, the
spike's method, research §8.5) at the pond pose and at a sea pose with the
water filling the frame, WebGPU on high and WebGL2 on medium and low, on a
quiet machine. A tier over its budget cuts in this order: the second ripple
octave, the refracted offset (sample unrefracted), the height texture to the
next size down.

Measured 2026-09-30 (provisional): paired frame times (off/on/on/off, four
pairs, 5 s samples of `requestAnimationFrame` intervals) at the pond's rim pose
with the water filling the frame, 1920×1080 on high and medium (hardware
scaling 1) and 1280×720 on low (scaling 1.5), on an Apple M4 in headless Chrome
through the chrome-devtools daemon, seed atmo at noon.

| Path | Frames, mean | Water on minus off |
| --- | --- | --- |
| High tier on WebGPU (the high path on) | 54 ms | −1.3 ms (noise) |
| High tier fallen back to WebGL2 (the blended path) | 45.8 ms | +0.68 ms |
| Medium on WebGL2 | 44.8 ms | +0.54 ms |
| Low on WebGL2 | 32.0 ms | +1.39 ms |

These readings are not a verdict on the 0.5 / 0.3 / 0.15 ms bars. Another
session's game page rendered in the same Chrome throughout, so every frame ran
at 45 to 54 ms against the roughly 16 ms this machine gives the same poses on a
quiet rig, and the on−off differences are inflated by that contention and by
its noise (a negative delta on the high path). The re-measurement on a quiet
rig, with no other game page open, is owed before the material ships; the cut
order above applies to whatever it finds.

## 9. Tests and gates

Node tests, in `client/test/`:

- Fresnel at 0°, 45°, 80°, 90° against the exact curve for n = 1.33, within
  6 % absolute (the worst is 0.058, at 85°).
- Transmission: the humic row at 0.3 m gives half the red, two fifths of the
  green, an eighth of the blue (research §2.3's worked numbers); at 10 m the
  bed is gone in every body.
- Roughness: shelter 0.1 in calm air is under 0.2; the sea in rain is at
  least 0.5; monotone in wind.
- The height texture's bake: every texel equals `elevationAt` at its centre;
  no rebake until the camera leaves the inner half; a row-by-row bake applies
  its origin only on its last call and equals a whole bake; a rebake changes
  the origin and the heights together, never one without the other.
- Where a body reaches: the sea at one of the nine points, a pond's disc
  overlapping the square from inside or out, nothing just out of reach.
- The wet residual: the per-channel formula at a body's centre, 1 in every
  channel 5 m outside the footprint even 4 m below the level.

The plugin's GLSL compiled and checked on both backends through the corpus
tools, the corpus re-recorded at the gate poses several times each (a variant
can show on one visit in three), and the built map checked as CI does.

Tests on the real water (`createWater` under NullEngine) asserting the
mechanism fired, not a fixture: the water meshes carry `bedDepth` and no vertex
colours; the bed is uploaded at creation at the camera's start; a re-centre
uploads nothing mid-bake and exactly once when the bake is whole (a spy on the
texture's upload), with the new origin and heights; no bake begins where no
body reaches the new square; a bake left mid-way by a 500 m jump is dropped and
the new square baked from its first row; on the high tier the frame is asked
for its copy only while a water mesh is among the active meshes. No pixel is
read under Node; the look is the gates' below.

Look gates, each a still from the game at a pose matched to a photo of the
approved reference set (kept outside the repository; a gate names its ids),
the sun pinned per reading and the reading recorded with it:

| Gate | Pose | Reference | What must hold |
| --- | --- | --- | --- |
| Murky pond | pond at 3 m, looking across | `ozette-08`, `mountain-lake-04` | amber rim, dark mirror beyond, sharp waterline |
| Clear lake | a shallow bed in the clear row | `crescent-04`, `crescent-13` | pebbles visible to a few metres, blue with depth |
| The sea | shore at 2 m, low sun | `ruby-09` | glitter along the sun, never the ground colour |
| Wet sand | the beach at the wet line | `second-beach-06` | a darker glossy band mirroring the sky |
| Night | the pond, headlamp on | none (research §2.5) | black water, a lamp glitter, nothing teal |
| Wading | the player's legs in the pond | none | legs darken with depth, wet above the line |

First stills, 2026-09-30 (in the archive outside the repository). The owner's
verdicts are owed: no gate has passed yet, since a gate passes on the owner's
word.

- Murky pond: `g-high-noon-murky-pond.jpeg` (high, WebGPU, noon, sun y −0.97,
  intensity 3.95). A sky-lit surface with a crisp waterline, a dark centre and
  glitter; the amber rim reads faintly at this depth (`POND_DEPTH` 0.6 m).
- Clear lake: not posable; no high lake exists until the terrain sub-project.
- The sea: `g-high-dusk-sea.jpeg` (time 18, sun on the horizon). The glitter
  path along the sun on the water, the sand foreground wet.
- Wet sand: `g-high-noon-wet-sand.jpeg` and `g-high-dusk-wet-sand.jpeg`. The
  foreground sand inside the 0.3 m still-swash band is all darkened and glossy,
  with no dry band in the frame at a 1:67 bed.
- Night: `g-high-night-night-pond-rim.jpeg` and `-west.jpeg` (time 0, lamp on,
  player in the pond). Black water, the lamp's glitter on the ripples, nothing
  teal.
- Wading: not posed. The local player has no body mesh in first person and the
  rig had no remote player or creature in the water.

The sea gate's pose is found on the coast.

The gate passes when the owner says the still resembles the photo in the
column's terms; a gate without a photo passes on the "what must hold" alone.

## 10. Out of scope

Waves and swell (the ocean waves sub-project); the swash and the moving wet
line; the plunging breaker and its foam; the lake's shore mirror; insects and
their sound; the pebble pocket beach and the high lake's basin (terrain);
the underwater view (the camera never submerges). Each later sub-project's
spec names the slot of §7 it fills.
