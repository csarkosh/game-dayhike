# Rain system: design

**As written on 2026-10-01.** This is the design before any code; when the work
lands, this paragraph is rewritten to say which layers shipped, on which tiers,
and at what measured cost. The plan
([2026-10-01-rain-system-plan](2026-10-01-rain-system-plan.md)) builds the
layers in order, each behind its own gate, and the verification note
([2026-10-01-rain-system-verification](2026-10-01-rain-system-verification.md))
holds every measurement. The survey this design follows is published at
[csarko.sh/research/photorealistic-rain-for-browser-games](https://csarko.sh/research/photorealistic-rain-for-browser-games);
section numbers written "survey §n" refer to it.

The rain today is one CPU particle system of streak sprites (`client/src/game/rain.ts`):
a 30 m box 15 m above the camera emits at its top face at the weather's rain
value times a tier capacity (600, 1,200, 2,000), and the streaks fall at 11 m/s
for 2.2 s. A streak takes 1.4 s to reach eye height; a player walking at
5.25 m/s has moved 7 m by then and one sprinting at 7 m/s has moved 9.5 m, so
the rain at eye height begins 8 or 5.5 m ahead of them and trails 22 to 25 m
behind, and when they stop it catches up over 1.4 s. Past 15 m there is no
rain. Rain starts 1.4 s after the weather says so, falls through the canopy
and any roof, lands on nothing, and 2,000 streaks in a 30 by 30 by 24 m volume
is 0.09 per cubic metre. Every surface but the trail bed ignores the wetness
value. The read is a rain source following the player.

The goal is one sentence: **rain that is everywhere the player can be, at
every height, from the first frame, that stops under cover, lands on the
ground, wets the world and touches the lens, within a measured frame budget
on named hardware.** The survey found that no browser rain has a published
frame time on named hardware; this design's verification note is written to
be that publication.

Renderer-only. No `sim/` change, no level-id move, no asset file added or
changed: every texture the rain needs (the streak profile, the ripple rings,
the lens droplets) is generated in code, as the streak sprite is today.

## 1. Decisions

| question | decision |
| --- | --- |
| The bar | On the reference machine (Apple M4, Chrome, ANGLE over Metal), at the canopy-trail pose and the meadow pose, the **whole rain stack's cost** (the frame under `weather rain` minus the frame under the same preset with every rain layer off, same build, pair method of §8) is at most **2.7 ms on high, 1.8 ms on medium and 0.8 ms on low** at native pixels, with the 4× figure and the WebGPU figure reported beside it. The branch's frame under `weather clear` is within the noise floor of the control's. No streak leading edge, no catch-up and no dry start at 7 m/s. Rain under the trailhead's car roof and kiosk is zero |
| The air | A **camera-locked wrapped volume**: one thin-instanced quad mesh, a static per-drop seed buffer, and a vertex-stage material plugin that places each drop by `fract` inside a box of 24 by 20 by 24 m biased 6 m along the view, stretched along its own fall vector to the frame's streak length (§2). 3,000 streaks on low, 10,000 on medium, 24,000 on high, four fall-speed classes. Replaces the particle system entirely |
| The far field | Fog density gains `1 + FOG_RAIN_GAIN × rain` and the fog colour pulls toward neutral grey by rain; `clear` is unchanged by construction (§3) |
| Lighting | Streak alpha fades toward the sky (view elevation) and brightens near the headlamp by an inverse-square term inside its cone; the streak colour is the fog colour lifted whiter (§3) |
| Occlusion | On medium and high, a **top-down height map**: a 512-texel render target over 96 m around the player, re-rendered when the player has moved 8 m, drawing the terrain rings, the props, the cliffs and the water with a cheap height material. The terrain writes its canopy density as transmission; props and cliffs write hard cover. Streaks under cover fade by the transmission; splashes and drip read the same map. Low runs without it (§4) |
| Splashes and drip | On medium and high: a thin-instanced sprite mesh of 600 or 1,200 short-lived crown rings placed on the map's height around the player, and a second wrapped volume of 600 or 1,000 large, slow, vertical drops drawn only under canopy and driven by a canopy-water scalar that fills about a minute after rain starts and drains over ten minutes after it stops (§5) |
| Wet materials | A `WetPlugin` on the forest, understory, clutter, cliff and prop PBR materials: Lagarde's porosity rule from the material's own roughness, with a per-material porosity cap. The terrain keeps its own wetness. Four-layer ring-texture ripples on the trail's puddles, scaled by rain (§6) |
| The lens | On medium and high: one post-process pass between FXAA and the finish pass, a code-generated droplet normal-and-mask texture that refracts the scene, a few procedural sliding drops, and on high a lerp toward the quarter-resolution halation blur for the foggy glass. Gated by rain, by pitch (strongest looking up) and by the canopy at the camera, smoothed over a second (§7) |
| Sound | The hiss's band centre falls with rain intensity and wind dulls it; a drip layer of sparse synthesised plops under canopy follows the canopy-water scalar (§7.3) |
| Order | Air and fog first (they remove the chasing emitter and the missing far field with no new render target), then wet materials and ripples, then the height map with splashes and drip, then the lens, then sound. Each behind a gate; a layer that misses its share of the budget ships smaller or not at all, and the note says which |
| WebGPU | Nothing WebGPU-specific. Every new plugin, define combination and post-process is recorded into the WGSL corpus before the branch is offered (§9) |
| Unchanged | Everything under `sim/`; the weather presets and their fades; the terrain's trail-paint wetness and puddles (ripples are added to them, not in place of them); the motes; the mist banks; the level id |

## 2. The air: a wrapped streak volume

### 2.1 The volume

Every shipped system the survey found keeps a fixed population of streaks in a
box locked to the camera and moves a streak that leaves one face to the
opposite face (survey §3.2). The box is 24 m across, 20 m tall and 24 m deep;
its centre is the camera plus 6 m along the horizontal view direction and
2 m down, so 12 m of rain stands above the eye and 8 m below, and a player
looking ahead sees 18 m of it and 6 m behind them. The rain-visible region for
a game camera is 6 to 20 m (survey §1.3); the box ends where streaks would
have stopped reading anyway.

A drop is a seed `s` in the unit cube and a class `k` in {0, 1/3, 2/3, 1}.
Its world position each frame is

```
q = fract(s + (drift - boxMin / boxSize))      drift = (driftX, -v_k * t_v / 20, driftZ)
p = boxMin + q * boxSize
```

where `boxMin` is the box's low corner this frame, `v_k` is the class's fall
speed, `t_v` is a running time folded modulo 40 s, and `driftX`, `driftZ` are
the wind's horizontal displacement accumulated on the CPU and folded modulo
1. The horizontal fold is exact because the wind is one velocity for every
drop; the vertical fold is exact because every class's speed times 40 s is a
whole number of box heights (4.5, 6, 7.5 and 9 m/s give 9, 12, 15 and 18
heights), so neither fold ever snaps. Because `boxMin` is subtracted inside the
`fract`, the field of drops stands still in the world while the box slides over
it: the drop that leaves the far face as the player sprints is the drop that
enters the near face. Nothing is respawned, nothing is uploaded per frame, and
the volume is full on the first frame.

### 2.2 The streak

Each instance is a unit quad. In the vertex stage the plugin builds the drop's
fall vector `along = normalize(vec3(windX, -v_k, windZ))`, the camera-facing
side vector `right = normalize(cross(along, camera - p))`, and places the
corner at `p + right × (u - 0.5) × width + along × (v - 0.5) × length`. The
width is 1.2 to 3 cm by class; the length is the class speed times the frame's
duration times a stretch of 1.5, clamped to 8 to 50 cm, with the frame's
duration a uniform smoothed over ten frames and clamped to 1/120 to 1/30 s, so
the streak reads as the motion blur of that frame and holds its length as the
frame rate moves (survey §3.3). The fragment reads the existing 4 by 16 streak
profile as the material's diffuse texture.

The four speeds stand in for the fall-speed spread of real rain (2 to 9 m/s,
survey §1.2); the slant of each class is `atan(wind / v_k)`, steepest for the
slow drops, because the horizontal velocity is the wind's for every drop. The
wind is the frame's `WindRecord`: `RAIN_SLANT × speed` metres per second
along its direction, as today. The gust lag is not modelled.

### 2.3 Alpha

Per vertex, carried to the fragment as one varying:

- **distance**: in from 0.6 m to 1.5 m, so no quad grows to fill the screen,
  and out from 9 m to 12 m, the box's half-width, so the far face is never
  seen;
- **the sky**: times `1 - 0.6 × smoothstep(0, 0.25, viewY)`, the view
  direction's upward component at the drop, because a drop against the bright
  overcast that lit it is invisible and the same drop against trunks is not
  (survey §1.4);
- **the class**: 0.35 for the smallest to 0.6 for the largest, since visibility
  rises with drop size;
- **the headlamp**: plus `lampIntensity × cone / (1 + d²)`, where `d` is the
  drop's distance from the lamp and `cone` its falloff inside the lamp's angle,
  which is the night look every system gets from a point light near the eye;
- **cover** (§4): times the map's transmission where the drop is under it.

The streak colour is the scene's fog colour lifted by 15 percent and 0.05,
the "milk" every production rain adds (survey §1.4); the material is unlit,
alpha-blended, depth-tested, not depth-written, not culled, and fogged by the
scene's exponential fog, which the atmosphere sets each frame for non-PBR
materials. The mesh is always active, never picked, never a shadow caster or
receiver, and its bounding info is not synced.

### 2.4 Counts and cost

| tier | streaks | box | expected fill at 1080p |
| --- | --- | --- | --- |
| low | 3,000 | 24 × 20 × 24 m | 0.2 to 0.3 ms at scaling 1.5 |
| medium | 10,000 | same | 0.4 to 0.5 ms |
| high | 24,000 | same | under 1 ms |

The expectations are the survey's (§7.1, §6.4): an Intel UHD 620 sustains
about 2.5 million textured blended pixels at 60 Hz in WebGL, and 24,000
streaks of 2 by 30 px with most of them faded or off screen are a fraction of
that. The cost is fill and grows with the streak's on-screen size, not the
count; the near fade (0.6 to 1.5 m) is what keeps it bounded. The JavaScript
cost is a dozen uniforms per frame.

### 2.5 What the particle system's removal changes

`rain.ts` keeps its name and its `Rain` interface (`update(camPos, weather,
wind)`, `dispose()`), so `renderer.ts` changes one line. The streak profile
map and its tests stay. `RAIN_CAPACITY` becomes the streak count per tier.
`rain.test.ts` is rewritten against the new shape. The emit-rate function and
the particle-system latch go.

## 3. The far field and the light

**Fog.** `fogDensityUnder` gains a factor `1 + FOG_RAIN_GAIN × rain` with
`FOG_RAIN_GAIN = 0.5`, and `fogColourUnder` pulls the colour toward its own
luminance by `0.3 × rain`. Both are zero at `clear`, which the weather tests
pin. The rain preset carries mist 0.6 already, so the rain gain is the
difference between a misty day and a rainy one, not the whole veil: a rain
alone cuts visibility to kilometres, the cloud with it to hundreds of metres
(survey §1.5), and the mist value is where that lives.

**Light.** §2.3's sky fade and lamp term. The lamp is the local headlamp
(`lamp_local`, a spot light parented to the camera): its world position,
direction, intensity and cone angle are bound as four uniforms each frame,
intensity zero when it is off. No streak database and no per-streak texture
array: the survey's reading is that the signal is in the fade and the lamp,
not the speckle (§7.4).

## 4. Occlusion: the height map

On medium and high, a `RenderTargetTexture` of 512 by 512 texels, RGBA half
float, rendered by an orthographic camera looking straight down from 100 m
over a 96 by 96 m square centred on the player's position snapped to the last
centre until the player has moved 8 m from it (so a refresh happens every 1.5
to 2 s of walking and never on a turn). Its render list is the terrain's
clipmap rings, the prop meshes (the trailhead's car, kiosk and board, the
bench and sign meshes), the near cliff buckets and the water surface; the
forest meshes are not in it. Every listed mesh is drawn through
`setMaterialForRendering` with one cheap shader material that writes

- **R**: the surface's world height;
- **G**: transmission, 1 for open ground, `1 - 0.65 × canopy` for terrain
  under canopy (the terrain's own per-vertex canopy density, carried as the
  fourth terrain-weight component), 0 for props, cliffs and water;
- **B**: a ceiling lift, 10 m for terrain with canopy, 0 otherwise.

The depth test leaves the topmost surface in each texel, so a car roof over
the road writes its own height and hard cover. The streak plugin reads the map
at the drop's world position (one vertex-stage fetch): a drop below
`R + B` is under cover and its alpha is multiplied by `G`. The 0.65 is the
share of rain an old-growth canopy intercepts or delays (survey §1.7: direct
throughfall 0.36), so under the trees a third of the streaks still fall
through, and the "canopy" is the terrain's density rather than the drawn
crowns, as Alan Wake 2 leaves trees out of its collision for the same reason
(survey §3.5). The props' tops are splash surfaces; water is a splash surface
with no streak occlusion, so it writes transmission 1 and no lift. Where the
player stands under a crown with no canopy density under it (a lone tree), it
rains; accepted.

Cost: about twenty terrain ring draws and a handful of props with a trivial
shader into a 512-texel target, once per 8 m. Expected under 0.1 ms amortised
on the reference machine; the gate measures it both as the amortised figure
and as the cost of the frame it falls on.

Low has no map. Its streaks fall through everything, as they do today, and it
has no splashes, drip or lens.

## 5. Splashes and drip

**Splashes** (medium 600, high 1,200): one thin-instanced quad mesh whose
vertex stage places each sprite from a hash of its index and its cycle (the
integer part of `time / life + hash`) at a random point in a 10 m disc around
the camera, on the height the map gives at that point, facing the camera, 6 to
10 cm wide, with a phase (the fractional part) that grows a ring from the
centre and fades it over a life of 120 ms. The fragment draws the ring from
the phase and a radial coordinate, no texture. Its alpha is the map's
transmission at the point, the rain value, and a backlight term when the sun or
the lamp is behind it (survey §4.5). The instance count drawn is
`round(rain × capacity)`. A splash that is not raining is a disabled mesh.

**Drip** (medium 600, high 1,000): the streak mesh's plugin with a `RAIN_DRIP`
define and its own instance buffer: fall speed 6 m/s, no slant, width 4 cm,
length 12 cm, alpha only where the map's transmission is below 1 and the drop
is under the ceiling, times a `canopyWater` uniform. `canopyWater` is a scalar
on the CPU that rises toward 1 at `rain / 60` per second and falls at
`1 / 600` per second when rain is 0, so the trees start dripping about a
minute after the rain starts (standing in for the one-to-two-hour wet-up of
survey §1.7) and keep dripping for ten minutes after it stops. The drips that
reach the ground are not matched by splashes; the splash disc already covers
the ground under them.

## 6. Wet materials and ripples

### 6.1 The plugin

`WetPlugin` (the name the plugin order reserves) attaches to the PBR materials
of the forest's bark and canopy at every LOD, the understory, the clutter, the
cliffs, the deadwood and the props, with a per-material porosity cap: 1 for
bark, soil, duff, deadwood and the props' wood and concrete; 0.5 for rock; 0.3
for leaves and grass cards, which glaze more than they darken (survey §4.1).
In the fragment before lighting, with `wet` the weather's wetness bound once
per frame:

```
porosity = min(cap, saturate((roughness - 0.5) / 0.4))
factor   = mix(1.0, 0.2, porosity)
albedo  *= mix(1.0, factor, wet)
rough    = 1.0 - mix(1.0, 1.0 - rough, mix(1.0, factor, 0.5 * wet))
```

which is Lagarde's rule with porosity derived from gloss (survey §4.2). The
roughness scale is applied where the terrain plugin applies its own, on the
reflectivity call. The terrain's trail paint keeps its wetness, puddles and
gloss. `applyWetness` keeps scaling the terrain and brush base materials.
Cost: a few instructions per fragment on materials that already run several
plugins.

### 6.2 Ripples

A 256 by 256 ring texture generated in code (`rippleRingMap()`): red the
inverted normalised distance from the ring centre, green and blue the
direction from it, alpha a per-ring random phase. Four layers at the survey's
time multipliers and offsets (§4.4), each at its own UV scale and offset,
blended in one per quarter of rain intensity, summed into the trail paint's
puddle normal where `tPuddle` is above zero. One uniform (`terrainRain`) and
one sampler on the terrain plugin. Expected under 0.1 ms. The lake and the sea
are left to the water design.

## 7. The lens and the sound

### 7.1 The pass

On medium and high, a `lens` post-process between FXAA and the finish pass,
so the drops are anti-aliased and the dither stays last. It reads the chain's
colour, a 128 by 128 code-generated droplet texture (RG a normal, B a mask, A a
trail channel; about forty static drops of 2 to 5 percent of the frame's
height, tiled twice across the frame with a per-tile offset so no drop repeats
in place) and, on high, the halation chain's quarter-resolution blur. Per
pixel: the drop normal offsets the scene UV by `strength × normal × 0.03`,
the colour is read once there; on high it is lerped toward the blur by the
mask's complement times the trail channel for the foggy glass. Eight sliding
drops are procedural: a grid of 8 columns, each with a saw-tooth fall at its
own speed and a sinusoidal wobble, each drop a circle whose analytic normal
refracts the scene the same way and whose trail cuts the fog. That is three
texture reads and a few dozen operations per pixel on high, two reads on
medium, and no extra render target.

### 7.2 Gating

`strength` is a CPU scalar smoothed with a 1 s time constant toward
`rain × (0.25 + 0.75 × smoothstep(0.1, -0.5, pitch)) × transmission`, with
pitch positive looking down (so the drops are strongest looking up and a
quarter strength looking ahead) and transmission `1 - 0.65 × canopy` at the
camera from the simulation's forest density, so the lens clears within a
second of stepping under the trees. Below 0.02 the pass is skipped. The
pass is written for a bare-headed first-person character: sparse, soft, and
the drops are gone before the player has to look away.

### 7.3 Sound

The hiss's band-pass centre moves from 3,000 Hz to 1,800 Hz with the rain
value and its gain is cut by up to a third above wind 0.6, because heavier
rain is lower-pitched and wind suppresses the small-drop hiss (survey §1.8).
A drip layer: a timer that fires a short filtered noise burst (a 25 ms
band-passed envelope at 1 to 2 kHz, random within an octave) at random
intervals of 0.3 to 1.5 s, through a gain of `canopyWater × canopy at the
listener × DRIP_LEVEL`. Audio-thread time only.

## 8. The measure, the poses and the control

**Hardware.** The reference machine: Apple M4 (8 cores, 16 GB), Chrome,
WebGL2 through ANGLE over Metal, and WebGPU. The renderer string is read
from the page before every round and written into the note.

**Builds.** The branch, and a control detached at the `origin/main` commit
the branch starts from (`b43952d`), each serving its own build on its own
port. The gate hooks (`__fcSet`, `__scene`, `__engine`, `__lampOn`, the port)
are applied for a gate and reverted after it, never committed. One more
never-committed hook on the branch: `__rainLayers({streaks, map, splashes,
drip, lens, wet, ripples})`, which switches each layer off so the stack can
be measured whole and by parts on one page.

**Poses.** Three, at `tier=high` and `tier=medium`, in a 1920 by 1080
window at device pixel ratio 1:

| pose | command | camera |
| --- | --- | --- |
| canopy trail, day | `seed atmo;freecam;weather rain;time 12` | 263.9, 85.77, 118, yaw 1.571, pitch 0.12 |
| meadow, day | `seed atmo;freecam;weather rain;time 12` | -216.1, 22.38, 414, yaw 0.393, pitch 0.08 |
| canopy trail, night, lamp on | `seed atmo;freecam;weather rain;time 22` | 263.9, 85.77, 118, yaw 1.571, pitch 0.12 |

The same three with `weather clear` give the no-rain frame.

**The pair method**, as the grass work's: one browser start per round, a
discarded warm-up page, the builds on fresh pages in alternating order, at
least two rounds each way, same-code rounds for the noise floor, only quiet
rounds read. Per page: 20 s to load, the pose, 3 s to settle, 8 s of
`onAfterRenderObservable` intervals, mean and p95. Native pixels and 4×
(hardware scaling 0.5, 3840 by 2160, off the vsync cap).

**What is reported**, per tier and engine, at each pose:

1. control, `weather rain` minus control, `weather clear`: the particle
   system's cost today;
2. branch, `weather rain` minus branch, `weather rain` with every layer off:
   the stack's cost, the bar;
3. the same with one layer on at a time: each layer's own cost;
4. branch, `weather clear` minus control, `weather clear`: the cost when it
   is not raining, which must be within the noise floor;
5. draw calls and the JavaScript frame time beside the GPU-bound figures.

**Stills.** A still per pose on both builds, and a 2 s walk at sprint speed
along the trail on the branch to confirm there is no leading edge; the stills
are kept beside the note outside the repository.

## 9. WebGPU and the corpus

Every GLSL stage the WebGPU path compiles is read from a map built from the
recorded corpus, and a stage that is not there is translated on the page at
first visit (about a second each). This design adds: the streak plugin's
vertex and fragment stages on an unlit material (with and without `RAIN_DRIP`,
with and without `RAIN_OCCLUSION`), the height material's stages, the splash
material's stages, the lens pass, and a new variant of every PBR material the
`WetPlugin` attaches to. The last is the large one: every forest, clutter,
cliff and prop material's text changes. The plan's last task records the
corpus on WebGPU at every tier and every state (rain on and off, lamp on,
night, a party of two) until no new stages appear, merges it, and checks the
build. The `RainPlugin` is appended to the plugin order after `WaterPlugin`
so no existing plugin's define number moves.

## 10. What does not ship if a gate misses

The order of §1 is the order of value per millisecond. If the whole stack
misses its bar on a tier, the layers are removed from the end: the lens
first, then drip, then splashes, then the map (which also removes the cover
fade), then the streak count is halved. The note records the final shape per
tier. The air and the fog ship on every tier whatever else does, because they
are what fixes the complaint.
