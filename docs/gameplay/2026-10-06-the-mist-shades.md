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

## 1. The mist (`game/hauntMist.ts`)

Twenty-eight puffs on the mist banks' alpha map, with no lighting and a grey of their own
(`HAUNT_MIST_GREY`, #3d3d3d, lit from within and outside the scene's fog, which at night is darker
and would swallow it), seated on the terrain round the eye: each born 2 to 14 m off on a drawn
bearing, 8 to 18 m of size, drawn twice that wide and 0.6 as tall, its centre 0.1 of its height
above the ground so the cloud rests on the ground, with a life of 10 to 24 s that it comes into
and goes out of over 2.5 s, drifting at 0.35 m/s on its own heading and breathing on its own
clock; left behind past 22 m and reborn round the eye. Each puff's opacity is `HAUNT_MIST_ALPHA`
(0.85) × its own weight × the night × its depth, which is `HAUNT_MIST_NIGHT_SHARE` (0.7) with no
haunt on and 1 at a full haunt: the cloud is there all night, deepens with the haunt, and never
shows by day. In the chase, by its cast, the puffs are born nearer (2.5 to 10 m), 30 % larger and
60 % more opaque: the mist closes in. (As first built, 0.22 grey, in the fog, and only while the
haunt was on, which left it unseen most of the night; and before that, two
quads(As first built, two
quads 7 m to each side of the eye: a wall glued to the screen.)

## 2. The figure (`game/shadeSilhouette.ts`, `shaders/grade.fragment.fx`)

On the post tiers the shades are not drawn into the frame. A render target at half the frame's
size, on a camera of its own that copies the player's each frame and sees only `SHADE_LAYER`
(a bit the main camera does not), draws each shade's meshes with a flat unlit material whose
red is the shade's softness. The grade pass reads that mask back through nine taps, the centre and a
ring of radius `SHADE_BLUR` (0.9 % of the frame's width), and darkens the frame by
`SHADE_DARK` (1) of it, after the chase's cast and before the vignette. The taps are unbranched
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

**Resolve.** A lunge within `SHADE_RESOLVE_M` (12 m) of the local eye eases its softness from 1
to 0 over `SHADE_RESOLVE_S` (1.4 s); a shade never resolves. Going, a resolved lunge is a shade
again first, over `SHADE_UNRESOLVE_S` (0.5 s), as it fades: it goes back into the mist, not out of
the frame. A strike plays the Hollow's attack clip.

**The low tier** has no grade pass: there the shades are the Hollow, fading in and out by
`visibility` alone.

## 3. Where it lives

- `game/shadeSilhouette.ts`: the mask, its camera, the per-shade materials, the layer and
  visibility bookkeeping, `any()` for the pass.
- `game/hauntMist.ts`: the banks.
- `game/entityViews.ts`: `softShades`, each shade's softness, `shades()` for the mask.
- `game/post.ts`: `setShades`, the sampler and `shadeShape`; `shaders/grade.fragment.fx` the taps.
- `game/renderer.ts`: builds both on a forest world (the mask on the post tiers), feeds them each
  frame; `setHaunt` from the app.

## 4. Tests

`test/game/shadeSilhouette.test.ts` (the mask's camera and layer, a shade's meshes into the
list on its layer, the visibility each pass gets, a resolving shade on both layers, a gone shade
out of the list), `test/game/hauntMist.test.ts` (the banks at the eye's sides, in by the haunt and
the night, none by day), `test/game/entityViewsFade.test.ts` (the softness and the list). The
browser pass is the look.
