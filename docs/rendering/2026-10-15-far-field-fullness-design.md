# A full far field: the ground, the cover, the trees and the air past 40 m

**Design, 2026-10-15.** The far field reads sparse, low in polygons and unblended:
past about 40 m the cover ends at a line and a flat olive plane carries on; past
140 m the ground is one colour on 8 to 64 m triangles; the far trees are black
cut-outs with ragged rims; and on a clear day the air does almost nothing to any of
it. The research behind this design is published
(https://csarko.sh/research/full-far-field-for-browser-worlds); its lesson is that
shipped games keep a cheaper stand-in running to the horizon and colour-match it to
what it replaces, then let the atmosphere and the anti-aliasing hide the handover.
This design applies that in six parts, in the order of payoff per millisecond,
built together and landed as one change on 2026-10-16, each part's "As built"
under it. Measured against the screens the design opened with: the crest
(`seed pine; freecam 602 -116 2.5`), the trailhead (`seed atmo; freecam -275 -1
1.571`), the meadow (`seed pine; freecam 90 -316 0.8`) and the hollow's trailhead
looking up the trail (`seed hollow; freecam -300 0 1.571`), clear weather at noon
on the high tier.

## 1. Where the far field stands today

| Layer | Ends at | What stands in past it |
|---|---|---|
| Blades, duff | 18 m, 24 m | the meadow cards to 40 m |
| Meadow cards, tufts, ferns, shrubs | 40 m, 110 m, 65 m, 75 m | the far cover's pull: one olive, clumps at 1 m and 3 m that average out under 2 px |
| Ground textures, normal maps, AO, the 18 m and 6 m macro tint | 80 to 140 m | the vertex colour, a point sample every 8 to 64 m |
| Full tree meshes | 120 m (70 on low) | one side-on 256 px lit bake a cohort, alpha-tested, lit again on a card, turned about the vertical axis; one tree in four from 1 to 2 km, none past 2 km |
| Cast shadows | 300 m | nothing |
| The air | 95 % of the colour left at 500 m on a clear day | the EXP2 fog's single colour at 4 km |

## 2. The ground: a far field that stays alive (`terrainTexture.ts`, `groundFarCover.fragment.fx`)

The far cover's two clump octaves fade to their mean once their cell is under two
pixels, which happens inside a hundred metres at a grazing footprint, and the 18 m
and 6 m macro tint fades with the textures. Past that the ground is one olive with
no variation at any scale. Real ground has variation at every scale: tussocks at a
metre, patches at ten, drifts of lush and dry at a hundred.

- **Drift octaves** at `FAR_DRIFT_CELL` 10 m and 30 m, the same lattice noise as the
  clumps, darkening the cover's troughs to `FAR_DRIFT_AO` of its crowns and tilting
  its normal by `FAR_DRIFT_TILT`, each octave faded to its mean under two pixels as
  the clumps are. They carry the ground from where the clumps average out to where
  the macro takes over.
- **A far macro** at `FAR_MACRO_CELL` 60 m and 220 m, the lush and dry tint the near
  macro gives (`macroTint`) from noise at these wavelengths, applied to all ground
  that carries cover at every distance, so a far hillside is a field of drifts and the
  near ground carries the same drift the far does. It never fades: a 60 m cell is
  still nine pixels wide at the horizon.
- The clumps, the drift and the macro are the same arithmetic in GLSL and in
  `groundHexParams.ts`, pinned by `groundFarCover.test.ts`.

**As built.** `FAR_DRIFT_CELL` 10 m and 30 m at weights `FAR_DRIFT_WEIGHT`
0.5 and 0.5, `FAR_DRIFT_AO` 0.55 in the troughs, `FAR_DRIFT_TILT` 0.3;
`FAR_MACRO_CELL` 60 m and 220 m at `FAR_MACRO_WEIGHT` 0.6 and 0.4, applied as
the near macro's tint through `macroTint` to every cover-bearing texel at every
distance, weighted by the cover (`fcFarMacro`), and bare ground past the
detail's fade darkened by the drift to `FAR_BARE_AO` 0.72, so the crest's
scree is not a plane either (`fcBare`). A roughness ramp, `FAR_ROUGH_BAND`
80 m to 400 m, lifts every ground texel's roughness toward 1 with distance
(`terrainTexture.ts`), so the far field goes matte under a flat light. The
clipmap blends each ring's colour, cover and gradient toward the coarser
ring's across its band as it blends the height (`coarseSample`, `clipmap.ts`),
so nothing snaps at a ring's edge.

## 3. The cover: thin by rule, not stop at a line (`clutterField.ts`, `bladeField.ts`)

The meadow cards fade out over 28 to 40 m and the tufts over 88 to 110 m, each a band
where every instance dithers out together, so the eye sees a line move with the
camera. Instead: a density ramp, where each instance has its own cutoff drawn from
its hash between the start of the band and the radius, and the survivors widen by
up to `COVER_WIDEN` as their neighbours go, so the cover thins without a front. The
far cover under it is already the cards' average, so what remains past the ramp is
relief alone.

**As built.** The ramp alone, no widening: each instance of the ramped classes
(`COVER_RAMP_CLASSES`: the grass, bushes, meadow, flowers, litter, ferns, shrubs
and the wet and high plants) takes its own out-band from its hash between the
bucket's band start and its end (`rampBands`, `clutterField.ts`), so the cover
thins from the band's start to its end instead of dithering out at one line.
`COVER_WIDEN` was not built: the far cover's relief under the ramp fills the
ground the thinned cards leave without it.

## 4. The trees: impostors in place of billboards (`forestMeshes.ts`)

One side-on bake lit at bake time, lit again live, alpha-tested with mips: that is
the black cut-out with the ragged rim. The impostor keeps the one sprite but bakes a
hemisphere of views (`IMPOSTOR_VIEWS` 8 round by 3 up, 1024 px a cohort) of the
unlit albedo with a normal and an alpha, blends the nearest views at draw, is lit
once by the live sun through its baked normal, and tests its alpha through a
distance field so the rim stays clean when it is small. The 1 to 2 km band keeps
every tree and scales the cards up by `FAR_TREE_SCALE` toward 2 km instead of
dropping three in four.

**As built.** One view, not a hemisphere: the side-on bake stays one sprite a
cohort, now 512 px, but it is two unlit pictures instead of one lit one. A
plugin on the bake clones' materials (`impostorBakePlugin.ts`) writes the
species' albedo in gamma space with the alpha its test left, and then, in a
second render of the same target, its shaded normal in the bake camera's view
as a tangent-space map of the card. Both are read back (`readPixels`, asynchronous
on WebGPU) and passed through the field (`impostorField.ts`): an exact
Euclidean distance transform with the nearest seed kept (Felzenszwalb and
Huttenlocher), run twice, so the alpha becomes the signed distance to the rim
over `IMPOSTOR_FIELD_SPREAD` 8 texels, tested at `IMPOSTOR_FIELD_CUT` 0.5, and
every texel outside the tree takes the nearest inside texel's colour and normal,
so the filter has nothing black to pull into the rim. The card lights the albedo
once, live, through the normal map, under the crown's share of the sky
(`CROWN_SKY`, where it took the full share for a bake lit already), and its face
(Babylon's plane faces −Z) is turned to the camera so the map's frame is the
card's. Where the pixels cannot be read back, the target itself is the card's
colour as before, unlit now, with the plain alpha test and no normal map. The
stride lattice is kept beyond 1 km, but its cards grow across the fill's seam
to `FAR_TREE_SCALE` 1.4 across and 1.1 up (`farTreeScale`, `forestField.ts`),
so one tree in four covers the hillside the four did. `IMPOSTOR_VIEWS` was not
built.

## 5. The air: aerial perspective by depth (`atmosphereFog.fragment.fx`, `sky.ts`)

The fog is one colour at one exponential, and on a clear day it leaves 95 % of the
colour at 500 m. Aerial perspective is wavelength-dependent: the blue scatters in
over the first kilometre, the red is left to the horizon. The fog shader takes an
in-scatter and a transmittance per channel by depth from the sky's own scattering
coefficients (`AIR_RAYLEIGH`, `AIR_MIE`), lifting the far ground toward the sky's
colour and lowering its contrast, and the clear-weather floor rises a little
(`FOG_CLEAR_FLOOR`) so the far field is never seen in clean air.

**As built.** The transmittance per channel alone: the fog's one transmittance
raised to `AIR_POWER` (0.72, 0.92, 1.3) a channel (`atmosphereFog.fragment.fx`,
mirrored by `airTransmittance` in `atmosphereParams.ts`), so the blue scatters
in first and the red is left to the horizon, the powers' mean near one so the
far field reaches the fog's floor where it did. The sky's own coefficients and
`FOG_CLEAR_FLOOR` were not built.

## 6. The clipmap: colour and normal across rings (`clipmap.ts`)

Only the height blends between rings; colour and normal are point samples that jump
at every snap. Each ring blends its colour and its normal toward the coarser ring's
across its band as the height does, and the outer rings take their normal from a
smoothed height (the gradient over the ring's own spacing) so a ridgeline is a
curve, not 64 m segments.

**As built.** The blend across rings, of the gradient, the colour, both weight
sets and the cover, by the same `t` as the height (`coarseSample`,
`clipmap.ts`); the smoothed normal from the ring's own spacing was not needed
once the gradient blended.

## 7. Roughness, far shadows and the temporal pass

A roughness ramp with distance on every ground and water material (`FAR_ROUGH`), so
the far field goes matte under a flat light; a far shadow cascade to `SHADOW_FAR`
2 km from the clipmap alone, so slopes and tree lines keep their shadows; and a
temporal anti-aliasing pass on the high and medium tiers, which parts 3 and 4 lean
on for their dithered fades and their alpha edges.

**As built.** The roughness ramp is `FAR_ROUGH_BAND` (part 2). The shadows'
reach is the tier's (`shadowDistance`, `shadowLambda`, `quality.ts`): medium
keeps its 300 m over one cascade at lambda 0.9; high reaches 1500 m over three
cascades at lambda 0.97, split at about 16.5 m and 77 m of camera depth, so the
near field keeps a texel finer than before, the middle distance gets a 4 cm
one and the far hillsides and tree lines keep their shadows at 70 cm, from
every caster the generator had (not the clipmap alone). Each cascade past the
first costs every lit material two inter-stage variables on WebGPU, which is
what holds the count at three and raised the device limit the game asks for
from 19 to 21 (`WEBGPU_REQUIRED_LIMITS`, `engineChoice.ts`); the sun's
`SUN_LIGHT_SIZE_UV` went from 0.1 to 0.15 with the shorter first slice. No
temporal pass was built: the field's rim and the ramp's thinning read clean
under MSAA and FXAA without it.

## 8. What is measured

Each part is judged on the four opening screens, the same poses, clear noon, high
tier: the far ground reads as drifts and not a plane, the cover has no front, the
crowns have no rim, the far hillside is hazed by depth, and the frame cost on the
high tier stays within 1 ms of where it started (the post chain's own timer).
