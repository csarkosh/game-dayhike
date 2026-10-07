# The mist shades

**Date:** 2026-10-06
**Status:** Built 2026-10-06.
**Parent:** [`2026-10-06-the-haunt.md`](2026-10-06-the-haunt.md): the director, the shades and the
lunge are as there; this is how they look. Supersedes its §2 "The look".
**Research:** [How Alan Wake introduces its darkness](https://csarko.sh/research/how-alan-wake-introduces-its-darkness),
and the fog of Silent Hill: "We are most afraid of what we cannot see" (Mateusz Lenart, the
remake's creative director); the original team's "you don't know what is out there".

## 0. What this is

The haunt's shades were drawn as the Hollow, near-black and unlit, and at night in the woods
nobody saw one. They are figures in the mist now.

While the haunt is on, two pale banks of mist ride at the player's left and right, lit from
within, grey the dark is darker than. A shade is a dark blur in that mist, the shape of a figure:
it comes in from nothing over a second, stands, and goes out to nothing again. A lunge is the
same blur until it is close, and then it resolves: the blur falls away and the Hollow itself
comes in under it, one over the other, until it is the thing it was. Every change is a fade.

## 1. The cloud (`game/cloudParams.ts`, `shaders/atmosphereFog.fragment.fx`)

The night's mist is a volume, not sprites (since 2026-10-07; the design is in
`docs/rendering/2026-10-07-ground-cloud-volume-design.md`): the atmosphere plugin, which already
draws the closed-form height fog in every PBR fragment, marches from the eye toward each
fragment through a cloud whose density falls off with height above the ground and is shaped by
noise on the wind, and lays the cloud over the fogged surface by the optical depth it found. The
ground cuts nothing, since there is no surface to cut; the wisps at the face are the march's
first steps, walked through; the figures stand in it darker than it. Its density is the night ×
`CLOUD_NIGHT_DENSITY` (0.3) with no haunt on, lifted by `CLOUD_HAUNT_LIFT` (0.25 of the way to 1)
at a full haunt, and pulled to `CLOUD_CHASE_DENSITY` (0.7) by the chase's cast, all of it × how
far the mist has come in (`actsUnder(progress).mist`, which rises over the tenth of the climb
after the night is in: the mist is not there the moment it is dark, it rises, and the haunt
waits for it, `docs/gameplay/2026-10-06-the-haunt.md`); the console's
`mist <density>` holds it at a level in [0, 1] whatever the night, and a bare `mist` lets the
night set it again. The low tier, with no post pipeline, has the closed-form fog alone.

(As first built, 2026-10-06, camera-facing puffs: twelve, then sixteen, then twenty-eight seated
on the ground, and fourteen more at the face; the terrain cut each quad along a line and their
flat bottoms lined up, a wall, which the research note
`docs/rendering/2026-10-07-ground-fog-in-aaa-games.md` explains and this replaces.)

## 2. The figure (`game/shadeSilhouette.ts`, `shaders/grade.fragment.fx`)

On the post tiers the shades are not drawn into the frame. A render target at half the frame's
size, on a camera of its own that copies the player's each frame and sees only `SHADE_LAYER`
(a bit the main camera does not), draws each shade's meshes with a flat unlit material whose
red is the shade's softness. The grade pass reads that mask back through nine taps, the centre and a
ring of radius `SHADE_BLUR` (0.9 % of the frame's width), and darkens the frame by
`SHADE_DARK` (0.45 since 2026-10-07; 1, black, before) of it, after the chase's cast and before the
vignette: the figure is what stands behind it, the mist, a little darker, in the mist's own
colour. The taps are unbranched
(a texture read under a branch is one the WGSL translation has to be told about) and zeroed
while no shade is in the mask.

**The two passes' share.** A shade's meshes are on the shade layer while soft, and on the main
layer too once it begins to resolve. Their `visibility` is set as the mask renders (fade ×
softness) and restored after it (fade × (1 − softness)), so the mask has the blur's share and
the frame the Hollow's, from one mesh.

**Fade.** A shade comes in over `SHADE_FADE_IN_S` (0.9 s) and goes out over `SHADE_FADE_OUT_S`
(1.1 s), its model held after the state has dropped it until the fade ends (entityViews.ts).

**Distance.** A shade is whole in the mask within `SHADE_NEAR_M` (10 m) and `SHADE_FAR_SHARE`
(0.35) of itself at `SHADE_FAR_M` (40 m): the far ones are the fainter blurs.

**Facing.** Every Hollow and shade is drawn turned to the local player, whatever way the sim has
it going (`facingOf`, entityViews.ts): the figure, and its head with it, always faces whoever is
looking at it.

**Rise.** A shade comes up out of the ground to its height over `SHADE_RISE_S` (2.4 s), eased
(`risen`), its feet where they are, as if out of the mist. Going, it keeps its height and goes
slowly, over `SHADE_FADE_OUT_S` (2.6 s), and unevenly: the mask's green carries how far gone it
is, and the grade keeps each pixel of the figure only where a drifting blotch of in-shader value
noise (`shadeNoise`, nine blotches across the frame) stands above that, so it loses itself patch
by patch, never all at once. The
cloud stands taller as the shades come (`CLOUD_HAUNT_HEIGHT_M`, the design doc §2).

**Resolve.** A lunge within `SHADE_RESOLVE_M` (12 m) of the local eye eases its softness from 1
to 0 over `SHADE_RESOLVE_S` (1.4 s); a shade never resolves. Going, a resolved lunge is a shade
again first, over `SHADE_UNRESOLVE_S` (0.5 s), as it fades: it goes back into the mist, not out of
the frame. A strike plays the Hollow's attack clip.

**The low tier** has no grade pass: there the shades are the Hollow, fading in and out by
`visibility` alone.

## 3. Where it lives

- `game/shadeSilhouette.ts`: the mask, its camera, the per-shade materials, the layer and
  visibility bookkeeping, `any()` for the pass.
- `game/cloudParams.ts`, `game/atmosphere.ts`, `shaders/atmosphereFog.fragment.fx`: the cloud.
- `game/entityViews.ts`: `softShades`, each shade's softness, `shades()` for the mask.
- `game/post.ts`: `setShades`, the sampler and `shadeShape`; `shaders/grade.fragment.fx` the taps.
- `game/renderer.ts`: builds the mask on the post tiers, rebuilds the cloud's ground map as the
  eye moves and sets the cloud's density each frame; `setHaunt` and `setMist` from the app.

## 4. Tests

`test/game/shadeSilhouette.test.ts` (the mask's camera and layer, a shade's meshes into the
list on its layer, the visibility each pass gets, a resolving shade on both layers, a gone shade
out of the list), `test/game/cloudParams.test.ts` (the density by night, haunt and chase; the colour; the noise
and the ground map), `test/game/atmosphere.test.ts` (the cloud's uniforms and map on both
shader paths),
`test/game/commands.test.ts` (`mist`), `test/game/entityViewsFade.test.ts` (the softness and the
list). The
browser pass is the look.
