# The ground cloud: the night's mist as a volume

The mist of the night is a cloud resting on the ground that the player walks through, drawn as a
volume the atmosphere marches through in every PBR fragment, not as sprites. It follows the
research in `2026-10-07-ground-fog-in-aaa-games.md`: the AAA engines integrate fog along the ray
to each pixel's own depth, so the ground never cuts it. Here the integral is taken in the
material itself, at full resolution, with no depth texture, no upsample and no temporal filter,
which is what the game's existing fog plumbing offered and what keeps it free of the ghosting
those engines document.

## 1. Where it runs

`atmosphere.ts` already splices a function into every PBR fragment at Babylon's fog line and
draws the closed-form height fog there (`2026-09-15-atmosphere-restyle-design.md`). The cloud is
the second half of that function (`shaders/atmosphereFog.fragment.fx`): after the surface is
fogged by the air, the march runs from the eye toward the fragment and the cloud is laid over
the result by its optical depth. The sky dome, the mist banks, the rain and the shades are not
PBR and do not carry it; the sky between the trunks is far enough that a ray to it leaves the
cloud's height within a few metres, and the forest hides most of it.

The Hollow's material keeps the plugin off, as before; a shade in the cloud is drawn by the
grade's mask (`docs/gameplay/2026-10-06-the-mist-shades.md` §2) over a frame that already has
the cloud in it, which is why it stands darker than the mist.

## 2. The density field

At a point `p`, the extinction is `atmCloudDensity × h × n`:

- `atmCloudDensity` is `CLOUD_SIGMA` (0.55 a metre) × the density knob, 0 to 1
  (`cloudDensityUnder`: the night × `CLOUD_NIGHT_DENSITY` 0.3, lifted by the haunt by
  `CLOUD_HAUNT_LIFT` 0.25 of the way to 1, pulled to `CLOUD_CHASE_DENSITY` 0.7 by the chase's
  cast, × how far the mist has come in, `actsUnder(progress).mist` (`sim/acts.ts`), so it rises
  over the tenth of the climb after the night is in rather than appearing with the dark; or the
  console's `mist <density>` hold).
- `h = exp(−max(0, y − floor + CLOUD_SEAT) / height)`: the cloud thins to 1/e every `height`
  metres above the ground, `cloudHeightUnder(haunt)`: `CLOUD_HEIGHT_M` (1.6) with no haunt on and
  `CLOUD_HAUNT_HEIGHT_M` (2.4) more at its full (2.5 and 3 earlier on 2026-10-07: denser at the
  ground now), × the trail's share: `CLOUD_TRAIL_SHARE` (0.3) of itself on the trail and whole
  from `CLOUD_TRAIL_FADE_M` (4.5 m) off its edge (`CLOUD_TRAIL_EDGE_M` 0.8), the way open and the
  sides not; so the mist stands taller as the shades come;
  seated `CLOUD_SEAT` (0.3 m) under the ground so a slope never shows an edge. The floor is
  the ground's height under `p`, read from the ground map (§3).
- `n = clamp(large × small × 2.4 − 0.2, 0, 1)`: two reads of the tileable noise (§3), the large
  shapes at `CLOUD_NOISE_LARGE_M` (11 m a tile) drifting with the wind at `CLOUD_WIND_MPS`
  (0.35 m/s), the small at `CLOUD_NOISE_SMALL_M` (4 m), sheared by height and drifting the other
  way. One octave each, as Wronski found enough. Within `CLOUD_NEAR_M` (8 m) of the eye the
  shapes smooth toward a plain veil, the small ones over the first 8 m and the large over the
  first 4: a feature a metre or two off sweeps across the view at a walker's parallax, tens of
  degrees a second, and read as the mist rushing past, where it should hang (since 2026-10-07).

## 3. The map

One RGBA8 texture of `CLOUD_NOISE_SIZE` (64) a side, `atmCloudMap`, since a material has sixteen
texture units and one was at them (the distance gradient gave up its texture for the same
reason: it is now a curve on the `atmFarColour` uniform, `ATM_NEAR_DIM` and `ATM_GRADIENT_BIAS`
mirroring `atmosphereParams.ts`):

- R and G: two channels of two-octave tileable value noise on their own seeds, each stretched to
  fill 0 to 255 (`cloudNoiseMap`), read wrapping.
- A: how far off the trail each place is, 0 on it and 255 from the fade's end, from the terrain
  variant's `trailDistance`.
- B: the height of the ground round the eye (`cloudGroundMap`), 64 samples a side over
  `CLOUD_GROUND_SPAN` (128 m), the lowest at 0 and the highest at 255 with the base and the range
  in uniforms (`atmCloudGroundRect`, `atmCloudGroundRange`), rebuilt once the eye is
  `CLOUD_GROUND_REBUILD_M` (16 m) from its centre. Read bilinearly with its coordinates clamped
  `ATM_CLOUD_EDGE` (half a texel) inside the map, so the wrap set for the noise never reaches it;
  beyond the map the edge repeats.

Every read is `textureLod` at level 0: explicit-level reads are outside WGSL's uniformity rules,
so the march may sit under any control flow.

## 4. The march

`atmCloudDepth`: at most `ATM_CLOUD_STEPS_MAX` (12) steps from the eye along the ray to the
fragment, stopped by `atmCloudSteps` (the tier's: `CLOUD_STEPS_HIGH` 12, `CLOUD_STEPS_MEDIUM` 8,
0 on low, where the closed-form fog stands alone) and by `CLOUD_RANGE` (40 m), the air's own fog
beyond. The steps are packed toward the eye, at `reach × (i/N)²`, so the first is a quarter of a
metre out and the wisps are walked through; each adds the density at its midpoint × its length.
The cloud's colour is the air's near colour pulled toward grey by `CLOUD_GREY_MIX` (0.55) and
lifted by `CLOUD_LIFT` (1.35) (`cloudColourUnder`), so it is dark by night and pale by day, plus
the sun's or moon's colour toward it by `CLOUD_GLOW` (0.35) at the power `CLOUD_GLOW_POWER` (4);
the fragment is `mix(cloud, fogged, exp(−od))`.

## 5. Cost

Twelve steps of three texture reads at full resolution in every PBR fragment, of the order of
30 reads a pixel on the high tier, 20 on medium; a few tenths of a millisecond on a discrete GPU
and of the order of a millisecond on an integrated one at 1080p, measured by eye against the
headless runs and to be measured on the test rigs. The volume never changes a shader's defines,
so nothing recompiles at runtime.

## 6. Where it lives and its tests

`game/cloudParams.ts` (the constants, `cloudDensityUnder`, `cloudColourUnder`, `cloudNoiseMap`,
`cloudGroundMap`; Babylon-free), `game/atmosphere.ts` (the map texture, the uniforms, `setCloud`,
`setCloudGround`), `shaders/atmosphereFog.fragment.fx` (the march), `game/renderer.ts` (the
tier's steps, the ground map's rebuilds, the density each frame, `setMist`), `game/commands.ts`
and `app.ts` (`mist`). Tests: `test/game/cloudParams.test.ts`, `test/game/atmosphere.test.ts`
(the uniforms and the map on both shader paths, the literals in lockstep), the shader hygiene
and WebGL identity tests, `test/game/commands.test.ts`.
