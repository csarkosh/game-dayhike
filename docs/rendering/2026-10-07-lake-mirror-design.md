# The lake's mirror and ripples: design

**Spec, 2026-10-07.** The fifth of the water sub-projects: the lake's surface
at rest. At dawn and dusk under a clear sky the water is glass, and the shore
stands on its own inverted image: the treeline, the stacks and cliffs, the
reeds and logs meeting their reflections at the waterline, the sky between the
trunks. By day a breeze breaks the glass into cat's-paws, dark patches that
cross the lake with the gusts and erase the shore image where they lie; in
rain the near water rings and the mirror is gone. The surface moves the way a
sheltered forest lake moves: two states, glass and ripples, not a blur between.

It fills two slots the water material left open
([the water material](2026-09-29-water-material-design.md), §10): the
reflection, which has been the sky probe for every body, and the lake's
normal, which has been two scrolling octaves that never knew the wind's
speed. It builds on the lake the water terrain made
([the water terrain](2026-09-30-water-terrain-design.md)) and leaves the sea's
waves ([the ocean's waves](2026-10-02-ocean-waves-design.md)) and the lake's
life ([insects over the water](2026-10-05-water-insects-design.md)) as they
are; the midges and dragonflies are reflected on the high tier.

What shapes it:

- As realistic as performance allows; costs are measured and reported, not set
  as bars beforehand.
- The mirror shows the shore, not the players: the near shore too, so a reed
  stands on its own image, but no hiker and no lamp. Players in the mirror
  are a later addition behind the same pass.
- The calm follows the hour and the weather, not the world's wind, which
  never drops below a quarter and would leave every lake a dull sheen.
- Peers see the same glass and the same cat's-paws (the shared clock and the
  world's seed); the mirror image itself is each page's own.
- Nothing may drop WebGPU to WebGL2: the trees' material already uses every
  inter-stage variable the engine allows, so the pass may add none.

## 1. The surface today

- **The reflection** is PBR's own: every water material reads the sky probe
  (a 128² cube of the dome alone, re-armed on the hour and the weather) along
  the reflected view at a mip set by the roughness, through PBR's Fresnel
  (F0 0.02). The water plugin's only hold on it is the normal: the horizon
  clamp rewrites `normalW` before PBR samples the probe. No body reflects
  its shore.
- **The roughness** is Cox and Munk's slope variance from the wind's speed
  times the body's shelter (0.1 for a murky lowland lake, 0.3 for a clear
  high one), one value a body a frame. The wind's speed is
  `0.25 + 0.35·cloud + 0.3·rain`, so a lake's roughness never goes below
  about 0.25 (0.16 is the calm it was calibrated to, reachable only by
  console). The mirror photographs a crisp shore image needs an rms slope
  under 0.07°; roughness 0.16 is already 1°, a 27 px smear at 1080p.
- **The ripples** are a 256² fbm normal map read twice: the 24 m tile
  scrolled at a fixed rate whatever the wind, and the 3 m tile drifting along
  the wind's direction with no regard for its speed, on high and medium only;
  plus four stamped layers of rain rings on every tier, and the skin's
  flattening on a murky lake. The rings are everywhere at every distance,
  though separate rings read only within 5–8 m of the eye.
- **The wind** has gusts the foliage reads (`gustAt`: two waves of 25 and 9 m
  travelling downwind at 1.5 m/s, ragged by a 6 m lattice) and the water does
  not.
- **One lake a world**, in about half the worlds, 25–40 m in radius, bare
  shore to 4 m past the rim and no trees to 8 m, one static disc mesh with
  its own material; the sea and a high lake can share a frame.
- **What the renderer can draw twice**, cheaply: the sky dome (one shader
  material), the inner terrain rings (the rain map already draws rings 0–1
  through a two-attribute height shader), the forest's impostors (thin
  instances yawed to the camera's xz), the cliffs at their coarsest ring, the
  shore props, the reeds and lilies, the water life's cards. Costly or wrong:
  the full PBR terrain, the forest's near LODs (the giants' material at the
  varying limit), the blades and duff (cut to the main camera's frustum), the
  camera-locked rain, mist and motes.
- **Measured once** (2026-09-29, WebGL2 medium, the pond pose): a second pass
  over the sky, the terrain rings and the impostors cost +2.8 ms at 960×540
  and the same at 480×270; with the trees and the cliffs +4.3 ms; with every
  mesh +6.5 ms. The cost is the draws, not the fill.

## 2. What the lake must do

1. **Glass at the day's ends.** From before dawn until mid-morning, and
   from late afternoon through the night, under a clear or bright sky,
   the lake is a mirror: the shore image sharp to the pixel, the image darker
   than its object by Fresnel (0.6–0.7× across the lake, 0.03–0.15× at your
   feet), the contact line registered so the bank meets its own reflection
   with no sky between.
2. **Cat's-paws by day.** Dark patches metres across, ragged, living seconds,
   travelling with the gusts, more of them on an exposed lake than a
   sheltered one, erasing the shore image where they lie and leaving the
   blurred sky.
3. **Rings in rain.** Near the eye, separate rings that spread at the speed a
   drop's ring spreads and die within a second, as many a square metre as the
   rain gives; farther off, a roughness rise; the mirror gone.
4. **Every tier.** The shore in the water on all three, each at its cost:
   a per-frame mirror on high, a captured panorama on medium, a skyline on
   low.
5. **Nothing lit twice.** The mirror image takes the place of the probe's
   radiance where it shows, through PBR's own Fresnel; the water's own colour
   under it is unchanged.
6. **Costs measured** against `main` at 4K and 1080p on every tier, at dawn
   and at noon, and reported.

## 3. Approach

- **The calm is the lake's own.** A calm share by hour and weather, a table
  of literal values, says how much of the lake is glass. Two roughnesses
  result: PBR's `roughness` for the probe's lobe, as shipped, and a per-pixel
  *mirror weight* that says how much of the pixel's reflection is the sharp
  shore image.
- **High: a planar mirror without a clip plane.** A second camera mirrored in
  the lake's plane, its projection made oblique so the near plane is the
  water, rendering a short list of cheap draws into a half-resolution target,
  read by the lake material at the composition hook the skin already uses.
- **Medium: a shore panorama.** A cylindrical capture of the shore from the
  lake's centre, refreshed with the sky probe, read by intersecting the
  reflected ray with a cylinder at the shore radius; the skyline masks the
  sky.
- **Low: the skyline.** A one-dimensional elevation-by-azimuth texture and a
  forest colour under the probe.
- **Ripples as two states.** A gust-advected cat's-paw mask between glass and
  rough; analytic rain rings in a hashed grid near the eye; the scrolling
  octaves kept for the slopes finer than a pixel.

The alternatives considered: Babylon's `MirrorTexture` (it clips with
`scene.clipPlane`, one more fragment input than the trees' material can take
on WebGPU, and a new variant of every material drawn); screen-space
reflections (Babylon's need a geometry buffer, doubling the draws, and show
nothing of what is off screen or behind a trunk); a cube probe at the lake's
centre (directions off by tens of degrees for a 30 m lake); an FFT surface
(1–2 ms for a lake with no swell to need it).

## 4. The calm

### 4.1 The calm share

`calmShare(hour, weather)` in 0..1, the glass's share of the lake, a table of
literal hours with linear ramps, in `lakeCalm.ts` (Babylon-free), read each
frame from the shared seconds so peers agree:

| Weather | 04:30–08:00 | 08:00→09:00 | 09:00–17:00 | 17:00→18:00 | 18:00–04:30 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clear, bright, eerie | 1 | ramp to 0 | 0 | ramp to 1 | 1 |
| mist | 1 | ramp to 0.3 | 0.3 | ramp to 1 | 1 |
| overcast | 0.3 | ramp to 0 | 0 | ramp to 0.3 | 0.3 |
| rain | 0 | 0 | 0 | 0 | 0 |

The hours are the water life's clock (the midges' dusk rises from 17:45 and
the frogs begin at 19:30), so the mirror returns as the midges come out. The
eerie weather keeps the clear sky's calm: a still mirror is the more
unsettling lake.

### 4.2 The three states and their slopes

- **Glass:** σ = 0. The shore image is sharp.
- **Cat's-paw:** σ = 4° (Cox and Munk at about 1 m/s), which turns any shore
  image into the sky's blur. The probe at that lobe is what shows.
- **Rough:** today's Cox and Munk roughness from the wind and the shelter,
  over the whole surface, with no shore image; what the lake has been.

Rough holds under rain, and on a clear lake (shelter 0.3) above a
wind of 0.7; otherwise the surface is glass and paws by the calm share.

### 4.3 The mirror weight

Per pixel, `w = (1 − paw) · calmShare · F_PBR`, where `paw` is §7.1's mask and
`F_PBR` is PBR's own Fresnel term for the reflection
(`colorSpecularEnvironmentReflectance`). The pixel's reflection radiance is
`mix(probeRadiance, mirrorRadiance, w)`, substituted where PBR adds its
reflection, so the probe is what shows wherever the mirror is absent, blurred
or out of its target. PBR's `roughness` keeps its shipped value and meaning:
the probe's lobe, the sun's specular, the headlamps.

## 5. The mirror on the high tier

### 5.1 The pass

- A `RenderTargetTexture` of half the frame's size, half float, with its own
  `TargetCamera` never made active: each frame, the player's camera's view
  reflected in the plane `y = level + 0.02` (`Matrix.ReflectionToRef`), and
  its projection the oblique one: Lengyel's replacement of the third row so
  the near plane is the water plane in camera space, for the [0, 1] depth
  range on WebGPU and [−1, 1] on WebGL2 (`obliqueProjection.ts`,
  Babylon-free, tested in both forms). Nothing under the water reaches the
  target; no `scene.clipPlane`, no clip-distance varying, no shader
  variant. `_mirroredCameraPosition` is set for the pass so front faces flip
  with the mirrored view.
- The pass runs only in a frame whose active meshes hold the lake's disc and
  whose calm share is above 0; otherwise the target is left as it was and
  the weight is 0. In the frame it runs, it runs before the main view
  (`customRenderTargets`), outside the water's group.
- Async pipelines are in scope: a draw whose pipeline is not ready is left
  out of that frame's mirror rather than stalling the frame.

### 5.2 What it draws

In the target's `renderList`, with stand-in materials where the real ones are
costly (`setMaterialForRendering`, as the rain map does):

| Drawn | Material in the mirror |
| --- | --- |
| The inner terrain rings (0–3) | the rain map's height shader with a lit terrain colour (the ground hex's base colour, the sun and the sky's ambient, fog) |
| The cliffs and stacks | their coarsest LOD ring, the scene's material |
| The forest's impostors | the scene's impostor material (two thin-instanced quads, yawed to the camera's xz, which the mirrored camera shares) |
| The near bank's trees | LOD2 only (the giants' faded material at LOD0/1 is at the varying limit) |
| The shore props, the reeds and the lilies | the scene's materials |
| The water life's midges and dragonflies | the scene's materials |
| The animals | the scene's materials |

Not drawn: the sky dome (the target is cleared to alpha 0 and the probe fills
the sky), the water (a target cannot sample itself), the blades, duff and
grass cards, the rain, the mist, the motes, the players and their lamps, the
shadows. Fog and the atmosphere apply inside the target as in the main view;
image processing does not (the post chain runs once on the frame).

### 5.3 The read

In the lake's fragment stage, at `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`
where the skin already scales the reflection:

1. The surface point's clip position in the mirror camera gives the texel,
   `uv = clip.xy / clip.w` mapped to [0, 1]; the mirror's view-projection is
   a uniform.
2. The ripple offset: `uv += normalW.xz · k · min(depth / 0.5, 1) / viewDepth`
   with `k` a literal mirrored in TypeScript, `depth` the bed height
   texture's water depth at the pixel and `viewDepth` the pixel's distance
   from the eye: zero at the contact line (the bank meets its image), smaller
   with distance, and biased downward on screen so a reflection never
   climbs above its bank.
3. The sample, with a 4-tap blur along screen-y whose length is the pixel's σ
   smear (`2σ · H / FOV_v`): 0 on glass, the full smear at a paw's edge.
4. Where the uv leaves [0, 1] or the sample's alpha is 0, the probe.
5. `w` of §4.3 blends the sample against PBR's reflection term; the sampler
   is declared in the `.fx` and bound on every draw (a 1×1 placeholder on the
   sea).

The target carries linear HDR, as the post tiers' scene does.

## 6. The mirror on medium and low

### 6.1 Medium: the shore panorama

- A cylindrical strip, 1024 × 128, half float, captured from the lake's
  centre 0.4 m above the water so the trees are seen from beneath: sixteen
  sectors of 22.5°, one a frame, through a `TargetCamera` whose view turns
  about the centre, drawing §5.2's list without the near-bank trees and
  without the water life. Captured at load and whenever the sky probe is
  re-armed (the hour, the weather).
- At the surface, the reflected ray is intersected with a vertical cylinder of
  the shore radius about the lake's centre; below the skyline (§6.2) the
  panorama is read at the hit's azimuth and height, above it the probe at the
  raw direction. The same ripple offset and shore clamp as §5.3, applied to
  the ray; the same weight.
- What it cannot do: parallax inside the cylinder (a reed's image slides a
  little as you walk the bank) and moving things.

### 6.2 The skyline

A one-dimensional texture, 512 texels of azimuth about the lake's centre,
each the treeline's elevation as seen from the centre, computed once at load
from the terrain's heights and the forest's placement around the rim (the
tallest tree within the rim's 8 m margin and the first 60 m beyond it, its
height over the terrain), in `lakeSkyline.ts` (Babylon-free). It masks the
panorama's sky on medium and is the whole shore on low.

### 6.3 Low

Below the skyline's elevation, a forest colour: the probe's horizon colour
scaled by a shade ratio of 0.15 (the forest in shade against the sky, a
literal); above it, the probe. One texture read and a compare. The low tier
keeps its one ripple octave; the cat's-paw mask runs on it.

### 6.4 The blended water

Medium and low draw the water blended, with
`alpha = 1 − (1 − F)·T̄` settled before the composition hook. The mirror's
radiance is substituted where the probe's would be and nothing else moves, so
the water's own colour under the image is as it was.

## 7. The ripples

Assembled on `normalW` in the lake's fragment stage, where its normal is built
today, on every tier; GLSL with TypeScript twins pinned in lockstep.

### 7.1 Cat's-paws

`paw(x, z, t)` in 0..1 over the lake: value noise of two octaves with 5–15 m
features, advected downwind at 1.5 m/s, gated by the gust (`gustAt`'s GLSL
twin, read at the pixel) so a patch grows where a gust crosses and fades
behind it over a few seconds, thresholded with a soft edge of about 0.5 m.
The covered fraction follows `1 − calmShare`, scaled by the body's shelter
(0.1 on a murky lowland lake, 0.3 on a clear high one), so a sheltered lake
shows a few paws and an exposed one a field of them. Time is the shared
seconds.

Where `paw > 0` the two octaves run at full amplitude and σ is 4°; where it is
0 they are silenced to glass. The second octave drifts at the wind's speed
(U10 = 12 m/s × the wind), not only along its direction; the first keeps its
tile and gains the same drift.

### 7.2 Rain rings

Within 8 m of the eye, an analytic ring a cell of an 18 cm hashed grid, one
drop a cell a cycle, the 3 × 3 neighbourhood summed:
`h = A · e^(−t/τ) · sin(k (r − c t)) · window(r − c t)` with c = 0.18 m/s,
λ = 3 cm, τ = 0.3 s, a front window so nothing precedes the ring; the slope
by analytic derivative. The cell's hash is `rainSplash.ts`'s, so the rings lie
under the crowns. Live rings a square metre follow the rain's rate: 35 at
0.5 mm/h, 77 at 1, saturating above 2 (Marshall and Palmer's drops of 1 mm
and over, living half a second). Beyond 8 m, and over the whole surface as the
rate rises, rain is the Cox and Munk roughness rise it is today. The four
stamped ring layers are retired. Under rain the calm share is 0, so rings only
ever break the probe's sheen.

### 7.3 The rest

The horizon clamp, the transmission's refracted offset, the Fresnel and the
skin's flattening follow unchanged, on the assembled normal.

## 8. Tiers, costs and shaders

- **Cost.** Measured against `main` at 4K and 1080p, pairs in both orders on
  a quiet machine, at the murky lake at dawn (06:15, glass) and noon (paws),
  from the shore pose and the across pose, on every tier. Budgets, to be
  held or reported: high ≤ 2.5 ms for the pass and the read (the 2026-09-29
  reading was +2.8 ms for 13 draws on WebGL2; the pass is skipped with the
  lake out of view or the glass down); medium ≤ 0.3 ms at runtime, the
  capture spread over sixteen frames; low ≤ 0.05 ms. The cut order if a
  budget fails: the near-bank LOD2 trees out of the list; the water life's
  cards out; the target to a quarter of the frame; on medium the panorama to
  512 wide.
- **Shaders.** The oblique projection, the mirror camera and the stand-in
  materials are TypeScript and small `.fx` files; the lake material gains the
  mirror sampler and matrix, the weight's uniforms and the paw mask behind
  uniforms, no new defines, so its stage text is one per tier. Every new stage
  (the lake's, the stand-ins', the panorama's) is recorded at the lake on
  every tier at dawn, noon and in rain, several visits a pose, and merged
  into the corpus before the gates; the inter-stage and texture counts are
  pinned (≤ 19, ≤ 16; the lake's fragment stage binds one more sampler).
- **Determinism.** The calm share and the paw mask read the shared seconds
  and the world's seed; the mirror pass is each page's own.
- **Readiness and teardown.** The material is ready with an empty mirror (the
  probe shows); a mid-hike tier swap disposes the target, the camera, the
  panorama and the skyline.

## 9. Tests and checks

Node, every expectation a literal:

- The reflection matrix: a point on the plane is fixed, the determinant is
  −1, the mirrored eye of a 1.7 m standing eye is 1.7 m under the level.
- The oblique projection in both depth ranges: points on the plane map to
  the near depth, points under it are clipped, the reflected frustum holds
  the reflected view; Babylon's left-handed row-major conventions.
- The calm share's table, every cell and both ramps, by weather.
- σ by state and the smear in pixels at 1080p and 4K.
- The paw mask's covered fraction over the lake against `1 − calmShare` and
  the shelter; its advection speed; a patch's life.
- The ring's profile (the front at c·t, zero mean slope, the decay) and the
  live-ring count a square metre by rate.
- The skyline from a placement; the ray–cylinder intersection; the split
  between the panorama and the probe.
- The shore clamp: 0 at depth 0, bounded by 1/viewDepth, biased downward.
- Every shader constant in lockstep with its twin; the stage text one per
  tier; the inter-stage and texture counts.
- The target's shape under NullEngine: size, list, camera, refresh, the
  stand-in registry, dispose, as the rain map's tests do; the panorama's
  sectors; the pass skipped with the lake out of view or the share 0.

In the browser, on every tier:

- Stills at the murky lake (room-3) and the clear lake (room-1) at dawn
  (06:15, glass), noon (paws), dusk (18:30), night (22:00) and in rain, from the shore and the
  across poses, beside the references `mountain-lake-04` (the full mirror),
  `lily-pond-08` (a sharp mirror on murky water), `crescent-10` (a breeze on
  a mirror), `ozette-08` (chop, no shore); the contact line registered at the
  near bank, no sky between bank and image, the image darker than its object
  by the Fresnel of the distance.
- The corpus: 0 misses on a first visit after the recording.
- The costs of §8.
- The look, in the browser, by eye.

## 10. Out of scope

Players and their lamps in the mirror; the sea's reflection; screen-space
reflections; tide; the beach; the breaker and swash.

## References

- Cox, C. and Munk, W. (1954), *Measurement of the roughness of the sea
  surface from photographs of the sun's glitter*.
- Lengyel, E. (2005), *Oblique view frustum depth projection and clipping*.
- Lagarde, S. and Zanuttini, A. (2012), *Local image-based lighting with
  parallax-corrected cubemaps*.
- Lagarde, S. (2013), *Water drop 2b: dynamic rain and its effects*.
- Le Méhauté, B. (1988), *Gravity–capillary rings generated by water drops*,
  J. Fluid Mech. 197.
- Minnaert, M., *Light and Color in the Outdoors*.
- Shaw, J. A. (1999), *Glittering light on water*.
