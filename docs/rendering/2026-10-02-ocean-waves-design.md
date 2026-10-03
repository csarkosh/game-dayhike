# Ocean waves: design

**Spec, 2026-10-02.** The third of the water sub-projects: the sea's waves. Swell
arrives in sets from the open Pacific, feels the bed as it nears the shore,
slows, shortens, grows and turns to meet the cove and the bays, and spills
where it outgrows its depth, rolling on as white water that thins to lace. A
wind sea rides on it, glassy at dawn and rough in a storm, with whitecaps when
the wind is up. Every player sees the same wave break.

It fills two of the slots the water material left
([the water material](2026-09-29-water-material-design.md), §7): the surface
height, flat until now, and the normal, which the scrolled bump and the second
ripple octave carried. It rides on the ground the water terrain built
([the water terrain](2026-09-30-water-terrain-design.md)): the cove's 1:50 bed
to the 8 m shelf break and its 1:12 face, the bays' 1:67 bed, the headlands.
The physics and the costs behind the numbers here are in
[Photorealistic water rendering: lakes and oceans](https://csarko.sh/research/photorealistic-water-rendering)
(section numbers below are the research's: §3 the coast's waves, §6 and §8 the
techniques and their costs, §9 the options for this game).

The owner's rulings that shape it:

- As realistic as performance allows; costs are measured and reported, not set
  as bars beforehand.
- The water is built as if the player can reach it, in this game later and in
  other games built on these systems; the camera never goes under.
- This sub-project runs through the spilling surf: the open sea, the sets, the
  shoaling and refraction toward the shore, the spilling break line and its
  white water, and the open sea's whitecaps. The plunging shore-break on the
  cove's face is the breaker sub-project's, fed by this one.
- The open sea is made by tier: analytic swell on every tier; the wind sea as a
  GPU FFT on high, a loop computed at load on medium, normal maps on low.
- The sea state comes from the world's seed (the swell) and the game's weather
  and hour (the wind sea).
- The waves run on a shared clock, the world seed and the simulation's tick, so
  two players watch the same wave break.

## 1. The sea today

- **Geometry.** Four flat clipmap rings follow the camera, 128 cells a side, a
  vertex every 8, 16, 32 and 64 m (`client/src/game/water.ts`), out to about
  4 km; their borders are not stitched, since a flat plane cannot crack. No
  vertex is displaced; the plugin uses the vertex hooks
  `CUSTOM_VERTEX_DEFINITIONS` and `CUSTOM_VERTEX_UPDATE_WORLDPOS` only.
- **Normal.** PBR's bump texture, a 256² normal map 24 m a tile, scrolled at a
  fixed rate, plus `waterRipple2`, the same map at 3 m drifting with the wind's
  integral (`waterWindTime`); the low tier takes the first alone. Rain rings and
  the horizon clamp follow.
- **Roughness.** The whole Cox–Munk slope variance for the wind
  (`roughnessFor`, `waterShading.ts`).
- **Depth.** A 256 m bed-height square around the camera, read per pixel by the
  fragment stage; per-vertex `bedDepth` everywhere the rings reach.
- **Wind.** Renderer-only (`windParams.ts`): speed from the weather (0.25 clear
  to 0.9 in rain, × 12 m/s), direction turning once every 1,200 s on each
  page's own clock.
- **Clock.** Each page's `performance.now`; the sim's tick, 60 Hz, is the only
  shared time.
- **Reach.** The road wall keeps every player at least 62 m from the waterline;
  nothing in the sim reads the sea's surface.
- **Budgets.** The material's own cost sits at its budget on every tier
  (§8 of the material's design); those budgets were set "before waves".

## 2. What the sea must do

### 2.1 Swell

- Arrive in sets: two to four bigger waves every one to three minutes, the
  heights Rayleigh-distributed (§3.1).
- Come from the world's seed, inside the real coast's range (buoy 46041, §3.1):
  height (Hs) 0.8 to 4.0 m, peak period 8 to 14 s rising with the height, from
  255° to 300° (the shore faces west, so 15° south to 30° north of square), a
  peaked spectrum (JONSWAP γ 3.3 to 7) with long crests (spreading s 25 to 75).
- Feel the bed below half a wavelength: slow to √(gh), shorten, grow by
  shoaling (H²c_g conserved), and turn toward the contours by Snell's law
  (§3.2). An 11 s swell is about 75 m long at 5 m depth; it reaches the cove
  within about 10° of square.
- Run low and clean in a headland's lee (§3.2: swell keeps about 30 % deep in
  the shadow, chop about 14 %).

### 2.2 The break and its white water

- Spill where a crest outgrows its depth, H > γ_b h, with Weggel's breaker index
  (§3.3): about 0.9 on the 1:50 bed, about 1.24 on the 1:12 face.
- Roll on as a bore whose height the depth caps (H about 0.42 h, §3.4) toward
  the face.
- White water banded by depth: the spilling crest's roll, the foam behind it,
  thinning to lace over about 20 s (§3.5), covering much of the inner surf.
- On a typical day the break line sits 50 to 160 m out on the cove's 1:50 bed;
  between sets the smaller waves reach the face. Until the breaker sub-project
  lands, those waves spill on the face by the same rule, so no wave crosses the
  beach unbroken.

### 2.3 Wind sea and whitecaps

- A wind sea from the game's wind: its speed (×12 m/s as U₁₀), its direction,
  a spectrum fully developed for that speed when the wind blows onshore and
  held small near shore when it blows off the land (§3.2).
- The hour shapes it: glassy at dawn, a sea breeze in the afternoon (§3.1:
  dawn medians 1.2 to 1.8 m/s, afternoon about 3 m/s onshore).
- Whitecaps from about 3.7 m/s, covering the Callaghan fraction
  3.18 × 10⁻³ (U₁₀ − 3.7)³ % up to 11.25 m/s (§3.5): none on a calm day, a
  few percent in a storm.
- Damped in the surf zone, where broken waves eat the chop, and in a
  headland's lee.

### 2.4 The surface

- Displaced, not only shaded: crests rise and sharpen, troughs flatten, the
  silhouette at the horizon moves.
- No crack between rings, no seam at the cove's ends or the shelf break.
- Slope detail too small to draw at a distance moves into roughness, so a far
  sea under a low sun reads as water (§6.5).

### 2.5 Shared and deterministic

- The same seed and the same tick give the same surface on every peer, to
  within each peer's prediction lead (tens of milliseconds).
- Nothing new crosses the network.

## 3. Approach

Two layers on one shared clock. **The swell** is analytic: a set of trochoidal
(Gerstner) waves whose phase is integrated along the coast's own coordinate
through the bed's depth, so each wave keeps its identity from the horizon to the
shore. That identity is what a set, a refraction, a break and the breaker's
hand-off need, and it costs the same maths on every tier, on the CPU too. **The
wind sea** is spectral: an FFT of a wind-driven spectrum on high, the same
spectrum computed once into a loop on medium, normal maps on low. The break is
a rule on the swell's local height, evaluated per vertex and per pixel; its
white water is a function of the crest's phase, with no buffer to keep.

Rejected: an FFT for the whole sea (no wave keeps its identity to the shore, and
the doc §8.4 finds a loop makes swell 9 to 43 % too slow); fading the spectrum
by depth (the doc §9.2: "wrong way round", waves shrink where nature grows
them); a shallow-water simulation near shore (no dispersion, 3.2 ms in one
browser port, and it overlaps swash); a phase from a baked travel-time field
(no published example; the coast's own coordinate gives the same answer across
the cove, where the bed is a function of distance to shore alone).

## 4. The swell

### 4.1 The sea state

Drawn once per world from the seed, salted, into a `SwellState`:

| Quantity | Range | Rule |
| --- | --- | --- |
| Hs | 0.8 to 4.0 m | log-normal, median 1.9 m (the year's median 1.99 m, §3.1) |
| Tp | 8 to 14 s | 7.5 + 1.6 Hs, ± 1 s seeded |
| Mean direction | 255° to 300° (from) | seeded, weighted to the west |
| γ | 3.3 to 7 | seeded |
| Spreading s | 25 to 75 | seeded |

Every number is a named constant beside the others (§7).

### 4.2 The components

Twelve on high and medium, eight on low (the low tier takes the eight largest of
the same twelve, so the tiers share their biggest waves). Their frequencies are
drawn around the peak so that pairs lie 0.005 to 0.01 Hz apart, which makes
groups repeat every 100 to 200 s (§3.1: sets every 1 to 3.5 min); their
directions from the spreading about the mean; their amplitudes from the JONSWAP
spectrum, scaled so that 4√(Σa²/2) = Hs; their phases from the seed. Each
component's steepness Q is capped so that Σ Q k a ≤ 1 everywhere, so the surface
never loops (§6.1).

### 4.3 Phase along the coast

The coast gives every point a seaward distance d = x − coastlineX(z) (the
terrain's `coastFrame`; d < 0 at sea). The bed is a function of d alone across
each bay and across the cove's middle: `shoreProfileD` for the bays,
`coveProfileD` for the cove, blended across the cove's ends by its along-shore
window. A component with offshore wavenumber k₀ = (k₀ₓ, k₀z) travelling
onshore keeps its along-shore wavenumber (Snell, for a coast running along z)
and takes, at depth h,

```
k(h)  from ω² = g k tanh(k h)          (Fenton's explicit form, refined once)
kn(d) = √(k(h(d))² − k₀z²)              (the onshore wavenumber)
Ψ(d)  = ∫ kn dd'                        (the onshore phase, from far out to d)
φ     = Ψ(d) + k₀ₓ·coastlineX(z) + k₀z·z − ω t + φ₀
```

so the crests follow the coastline's outline offshore and bend to the contours
near shore, and far out the phase is the plane wave k₀ · x − ω t exactly.
Ψ, kn and the depth are tabulated per component, per profile, over d from
−1,000 m to +40 m at 0.5 m; seaward of −1,000 m the phase continues linearly.
The coastline's own position is a 1-D table along z around the camera, on the
road centreline table's pattern (`roadPaint.ts`). Where the coastline bends
(its slope reaches 0.4) the construction is an approximation; at the cove the
shore runs straight and it is exact up to the headlands.

**Deep water past the shelf.** The world's floor is 25 m deep, which would
shorten every swell (an 11 s swell 148 m long, not 189 m). Past the 8 m shelf
break the tables take deep water, so the open swell is as long as the real
coast's; shoaling begins across the shelf blend.

### 4.4 Height, shape and shelter

- **Shoaling and refraction.** Each component's amplitude is multiplied by
  K_s K_r: K_s from conserving H²c_g, K_r = √(cos θ₀ / cos θ) from the turn
  (§3.2). Both are tabulated with Ψ.
- **Shape.** The trochoid's crest sharpens as its steepness grows toward the
  break; Q follows the local steepness, still capped (§4.2).
- **Shelter.** Each headland casts a shadow under the swell's mean direction,
  bounded by its tip; inside it the swell keeps 0.3 and the wind sea 0.15 of
  their height, faded over a diffraction width of half a wavelength from the
  shadow line (§3.2). The open coast's stacks cast none (swell wraps them, §3.2).

### 4.5 The break

At a point, the swell's local height is twice the envelope of the shoaled,
sheltered components, |Σ aᵢ e^{iφᵢ}|, so it rises and falls with the sets.
Where the unbroken local height exceeds γ_b h, the wave has broken:

- Its components are scaled so the local height is the bore's, 0.42 h, reached
  over a short transition shoreward of the break point.
- Its breaking intensity B = the excess over γ_b h, normalised, feeds the white
  water (§5).
- γ_b is Weggel's, from the local bed slope and the peak period (§3.3),
  tabulated with the profile.

Because the depth falls monotonically toward the shore across each profile,
"broken" at a point is decided by the unbroken height there alone; the rule
needs no memory of where the wave was.

## 5. The white water

A function of the swell's local crest phase, with no buffer:

- **The spilling roll.** On a broken crest's front face, foam proportional to B.
- **The trailing foam.** Behind each broken crest, foam whose age is the time
  since that crest passed (the local phase over ω), fading with a 20 s
  lifetime (§3.5), thinning from a sheet to lace through a seeded foam pattern
  that drifts with the bore.
- **The inner surf.** Shoreward of the break line a foam floor that grows
  toward the face, so the inner surf is mostly white (§3.5: foam over 0.35 to
  0.55 of the surf zone, nearly all of its inner part).
- **Look.** Fresh foam reflects about 40 %, old foam 3 to 10 % (§2.4); foam is a
  matte layer over the water, the way the lake's skin is (the material's
  waterLights and compose blocks).
- **Whitecaps.** On high, where the wind sea's FFT folds (its Jacobian below
  0.4); on every tier, the Callaghan coverage as a statistic over the crests
  (§3.5). They flash and fade with the crest; no persistent streaks in this
  sub-project.

## 6. The wind sea

### 6.1 The spectrum

JONSWAP for U₁₀ = the game's wind speed × 12 m/s × the hour's factor (0.4 at
dawn, 1.25 through the afternoon's sea breeze, 1 otherwise, blended smoothly),
its direction the wind's, spreading s 10. When the wind blows off the land the
spectrum is cut to its fetch-limited size near shore (§3.2). It covers only the
wind sea's band; the swell carries the low frequencies, so nothing is counted
twice.

### 6.2 High: a GPU FFT

Three cascades of 256², 1,000 m, 150 m and 25 m across (§8.3; poseidon's finding
that a small largest tile prints long swell as corduroy), computed in WebGPU
compute each frame: the spectrum's phases advanced by dispersion, then one
inverse FFT for the heights, the two horizontal displacements and the two
slopes, batched into a shared-memory Stockham FFT of about a dozen dispatches,
not hundreds (§8.4: dispatch structure dominates). Results in `rgba16float`
storage textures (§8.4: 16-bit textures saved one author 1.27 ms of drawing),
read by the water material's vertex stage (displacement) and fragment stage
(slopes, Jacobian). The compute shaders are WGSL, outside the GLSL → WGSL
translation the materials take. The spectrum is rebuilt when the wind moves by
more than a step.

### 6.3 Medium: a loop computed at load

One 128² cascade, 60 m across, as 64 frames of a 20 s loop, linearly blended
between frames, computed at load on a worker (§8.4: about 8 MB for 64 frames of
128² in 16-bit floats; a loop suits chop, whose periods are a few seconds). The
spectrum is a fully developed one, whose shape is the same for every wind once
lengths are scaled by U₁₀² and times by U₁₀; so one bake serves every wind: the
tile is sampled at lengths scaled by (U/U_ref)², heights scaled likewise, time
run at U_ref/U, the coordinates rotated to the wind's direction.

### 6.4 Low: normals

The existing bump, its slope scaled by the wind sea's height, scrolled with the
wind. No displacement from the wind sea.

### 6.5 Near shore

The wind sea's height is damped shoreward of the break line (broken waves eat
it) and by the shelter (§4.4). Its own dispersion stays deep.

## 7. The surface

### 7.1 The mesh

Three finer rings join the four, at 1, 2 and 4 m, so the rings run 1, 2, 4, 8,
16, 32 and 64 m out to about 4 km, 128 cells a side as today. A player at the
waterline then stands on 1 m cells (the doc §9.6: 0.25 to 1 m near the viewer);
from the road the break line falls in the 4 m ring. Rings with no wet vertex
stay culled. Each ring's outer band blends its displacement toward the coarser
ring's, as the terrain's clipmap does (`blendWeight`, `coarseHeight`), so no
border cracks; waves shorter than four of a ring's cells leave its displacement
for the per-pixel normal, so no ring aliases.

### 7.2 Displacement

In `CUSTOM_VERTEX_UPDATE_POSITION`: the swell's trochoidal displacement plus, on
high and medium, the wind sea's; before `worldPos`, so it reaches the position,
the fragment's world position and the view depth together. Each ring's culling
box is raised and lowered by the sea's largest crest and trough.

### 7.3 Normal and roughness

- **Normal.** Per pixel: the swell's analytic slopes, the wind sea's slopes (the
  FFT's or the loop's), and on low the bump; then the rain rings, the horizon
  clamp and Fresnel as today. The scrolled bump and `waterRipple2` leave the sea
  on high and medium. The lakes keep their ripples unchanged.
- **Roughness.** Cox–Munk's variance for the wind less the variance the drawn
  waves already carry. Each cascade's and each component's slope variance is
  known from its spectrum; where its shortest wave falls below two pixels, its
  variance moves from the normal into the roughness (§6.5).

### 7.4 The waterline

The per-pixel waterline compares the displaced surface with the bed instead of
the still level, so the water's edge rises and falls with the wave at the shore.
The run-up's own sheet, the moving wet line and the wet sand's time stay the
swash sub-project's.

## 8. The clock and the sea state

- **Shared seconds.** The waves' time is the simulation's tick × `TICK_DT` plus
  the frame's fraction of a tick, from the state the renderer already draws
  (the client's predicted state, the host's own). A scene that hands the
  renderer its own clock (the title loop, the scene player) keeps it.
- **The wind on the shared clock.** The wind's turning and gusts move onto the
  same seconds, so every peer's wind sea blows the same way.
- **The sea state.** The swell from the world seed; the wind sea from the
  weather and the hour, which every client already computes from shared state.
  Nothing new crosses the network.
- **Where the maths lives.** `client/src/game/oceanWaves.ts`, Babylon-free: the
  sea state from a seed, the components, the tables, and the swell's height,
  slopes, phase and break at a point and a time. The shaders mirror it; tests
  hold the two in lockstep. The simulation does not read it in this
  sub-project; when the beach opens, a sim twin evaluates the same swell with
  the sim's own polynomial trigonometry.

## 9. Interfaces for later sub-projects

- **The breaker.** `crestAt(x, z, t)`: for the swell at a shore point, the local
  height (shoaled, refracted, sheltered), the peak period, the crest's direction
  and phase, the depth and the bed slope, the offshore H₀ and L₀ (the Iribarren
  number needs them), and whether it has broken. The breaker replaces the
  face's spilling rule (§2.2) with its plunge, fed by this.
- **Swash.** The arrival time and height of each bore at the face's toe.
- **Unchanged.** The reflection slot (the lake's mirror), the wet line, the
  lakes' ripples, the rain rings.

## 10. Costs and tiers

| | Swell | Wind sea | Mesh | Foam |
| --- | --- | --- | --- | --- |
| High (WebGPU) | 12 components | FFT, 3 × 256², compute | 7 rings, 1 m inner | break, trailing, Jacobian, statistic |
| Medium (WebGL2) | 12 | 20 s loop, 128², baked at load | 7 rings | break, trailing, statistic |
| Low (WebGL2) | 8 | normals | 7 rings | break, trailing, statistic |

No bar is set in advance. The cost is measured as the material's and the
terrain's were: GPU-bound at 3840 × 2160 (hardware scaling 0.5), scaled to each
tier's pixels, paired control/branch/branch/control readings on fresh pages, a
control build of `main`, a silent machine, at the worst poses (the cove from the
pad with the break line in view, the open sea to the horizon). If a tier proves
too heavy the cut order is: the third cascade, the swell's components (12 to 8),
the inner ring, the foam pattern's detail.

The two unknowns are measured first, before the rest is built: the WebGPU FFT's
cost on this machine (nobody has published three 256² cascades on Apple silicon,
§10) and the cost of drawing the dense mesh with its vertex reads.

The change re-keys every water shader stage, so the shader corpus is recorded
again on every tier at the gate poses, noon and night, and checked live after
the deploy. The high tier's map holds about 7.8 MB of its 10 MiB ceiling.

## 11. Tests and gates

Node tests:

- Dispersion: Fenton's explicit k(h), refined, against Newton's solution, to
  1e-6.
- Shoaling and refraction: K_s and the turn at 8, 5 and 2 m against the
  research's table (§3.2: an 11 s swell 1.05, 1.15, 1.42).
- The phase tables: Ψ against a numeric integral; continuity across the shelf
  blend, the cove's ends and d = −1,000 m; the plane wave far out.
- The breaker index: Weggel's γ_b about 0.9 on 1:50 and about 1.24 on 1:12; the
  typical swell (2.0 m, 11 s) breaking about 69 m out on the cove's bed, within
  20 % (§3.3).
- The sea state: every seeded quantity inside its range over 200 worlds; sets
  repeating every 100 to 200 s; Σ Q k a ≤ 1.
- Determinism: the same seed and tick give the same height and slopes; the
  shared seconds monotonic across a tick.
- The mesh: a finer ring's border vertices coincide with the coarser ring's
  interpolated displacement; the culling boxes contain the displaced surface.
- The loop: one bake scaled for two winds matches a bake made at the second.
- The FFT: the batched Stockham against a direct DFT on a small grid, on the
  CPU reference the WGSL mirrors.
- The shaders' text and constants in lockstep with `oceanWaves.ts`, as the
  material's are.

Browser gates, each a still at a pose matched to the reference photos, the sun
pinned per reading, at noon, at dusk, and in the rain weather's storm sea:

| Gate | Pose | Reference |
| --- | --- | --- |
| The cove's surf | from the pad, the break line in view | `ruby-05`, `rialto-03` |
| Sets and white water | from the berm along the beach | `ruby-01`, `kalaloch-11` |
| The headland's lee | across the cove's up-swell end | `kalaloch-11` |
| A calm dawn | the cove at dawn, glassy | `ruby-11`, `rialto-11` |
| The open sea | to the horizon, low sun | `kalaloch-11` |

A gate passes on the owner's word. The cost is reported for the owner to judge.

## 12. Out of scope

The plunging curl on the face (the breaker sub-project); swash, the run-up's
sheet and the moving wet line; the lake's mirror; insects and their sound;
surf sound (it would sit with the breaker); tide; opening the beach (the road
wall stays); persistent whitecap streaks; the lakes' waves.

## 13. As built (2026-10-03)

What the build changed from the sections above, each on the branch's own
measurement, and what the gates and the cost showed.

- **§2.5.** The swell and the high tier's FFT run on the shared clock; the
  medium tier's loop phase and the low tier's whitecap cells run on each
  page's own clock (their speed follows the wind, which a closed form of the
  shared seconds would make jump). Two players in one party read the sea's
  clock within 0.03 s of each other.
- **§4.3.** The tables are at 1 m over d, with Ψ integrated by Simpson's rule
  at 0.25 m; the coastline row steps 12 m and reaches 5,200 m past the camera
  along z, beyond the outermost ring. The bay's and the cove's phases differ
  by up to about 24 rad at the shore, so the phase (Ψ, kn) blends across the
  cove's ends by its own weight over 250 m, flat on the cove's centre line,
  while the depth, the breaker index and the amplitude factor keep the sim's
  60 m window; the wavevector's along-shore part carries ΔΨ·wp′. On the lobby
  worlds the blend's added turn stays under 0.62 of the wave's own wavenumber.
  Over dry sand the depth is held at 0.05 m, so the capped swell there is the
  bore's few centimetres and meets the waterline continuously.
- **§4.4.** The headland's shadow fades over a fixed 40 m, with a hard edge on
  the ridge's own side (land).
- **§5.** The foam's brightness and its cover are two quantities: the albedo
  fades from 0.4 (fresh) toward 0.06 with a 4.7 s constant (0.10 at 10 s), the
  spilling roll counting as fresh; the cover is the foam amount, a sheet on the
  roll thinning to lace, never under 0.6 of the surface where a wave is broken.
  The lace is thresholded at the measured quantile of its own noise, so its mean
  cover is the amount and the far value equals the near mean. Whitecaps on every
  tier are the Callaghan statistic over the crests: the high tier's folds were
  dropped, since with unit choppiness the physical spectrum's Jacobian never
  falls below 0.65 (0.4 is about five standard deviations away).
- **§6.1.** Under a wind off the land the wind sea follows the Coastal
  Engineering Manual's fetch law from the coastline outward (3 cm at 50 m and
  12 cm at 1 km at 8 m/s), mixed toward the full sea as the wind turns onshore;
  the flat near-shore cut it replaces would have left 0.85 m of chop at the
  waterline. The wind the sea follows lags the game's wind by 60 s, so a
  weather fade rebuilds the FFT's spectrum at most once.
- **§6.2.** The high tier draws the loop (mode 0, then 1) until the FFT reports
  running, and falls back to the loop if it is still compiling after 30 s of
  drawn frames; the FFT is stepped only while a sea ring is drawn; a validation
  error at its first dispatch marks it failed. The FFT's spectra live in storage
  buffers. The sea's constants per world (12 components) are uniforms, not atlas
  reads: 54 fetches a pixel on medium and high, 38 on low.
- **§6.4.** The low tier's bump scrolls as before.
- **§7.2 and §7.3.** The swell is summed once per vertex, not per pixel: the
  fragment takes the swell's normal, height and envelope from two varyings and
  builds the break, the roll and the foam's age per pixel from the interpolated
  envelope with its own coast and profile reads. Measured per pixel, the sum
  was the sea's cost (about 9 ns a shader lane, 8–15 ms of the open sea's frame
  at 4K); the arrays in it were a quarter of that. The price is a normal
  interpolated over the ring's cells (1–4 m near the camera under 50 m waves)
  and, beyond about a kilometre, the shorter swell leaving the pixel normal
  where a pixel already spans a wavelength; the wind sea's per-pixel normal and
  the foam's per-pixel edge stay.
- **§7.1.** The vertex stage slides each border vertex onto the coarser ring's
  lattice by the terrain's blend weight and evaluates the waves once there; the
  rings' culling boxes grow by 12 m plus a cell on every side.
- **§7.2 and §3.** The ocean's uniforms join every water material's block, so a
  lake's compiled stages change while its injected code and look do not; the
  corpus holds the lakes' new stages on every tier.

### Cost

Measured as §10 says, GPU-bound at 3840 × 2160 against `main`, paired on fresh
pages, on the development machine (an M4 Air; the same build on both sides of a
pair read within 0.35 ms in the morning and about 3 ms once the machine had
warmed, which bounds the figures below).

| Tier | The cove from the pad | The open sea |
| --- | --- | --- |
| high (WebGPU) | +2.8 ms | +3.4 ms |
| medium (WebGL2) | +2.1 ms | +3.9 ms |
| low (WebGL2) | +1.3 ms | +3.0 ms |

Before the swell moved to the vertex stage the open sea cost +9.6 / +16.9 /
+9.7 ms (high / medium / low) and the pad +4.7 / +7.9 / +3.6: the per-pixel
sum was the cost, and neither its texture reads (cut by a third with no
change) nor the wind sea's sampling nor the whitecap cells (each under 1.3 ms)
were. The two unknowns measured first, before the shaders were built: the
WebGPU FFT about 0.8 ms a frame, fixed; the seven rings with a vertex stage of
the swell's reads about 2 ms at 4K.

### Gates

Stills at the poses of §11, the sun pinned per reading, on the high tier
(WebGPU) with the cove's overview on every tier, taken before and after the
swell moved to the vertex stage; every page on its tier's engine with no
console error. Two players in one party saw the same sea (their sea clocks
within 0.03 s).

| Gate | What the stills showed | The owner's word |
| --- | --- | --- |
| The cove's surf | From the pad at eye height the 3 m berm hides most of the surf zone; from 18 m up the break line, the spilling crests and the lace show on every tier | passed |
| Sets and white water | The white water lies as a sheet along the shore with lace beyond; over three minutes the larger crests come in groups | passed |
| The headland's lee | Calmer water behind the up-swell headland | passed |
| A calm dawn | A glassy sea under a 1.0 m swell and a 1.2 m/s wind | passed |
| The open sea | The storm sea's whitecaps at 1.1 % coverage; the horizon smooth from a low eye after the far-sea fade | passed |

The one thing turned back lies outside this work: at 18:00 and 06:00 the sky
reads near black above a sun at the horizon while the ground and the trees
stay gold, which is the atmosphere's own lighting at those hours and shows on
`main` the same way.
