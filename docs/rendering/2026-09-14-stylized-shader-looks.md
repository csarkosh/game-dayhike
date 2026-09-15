# Stylized shader looks: how games build a visual identity

**Question:** what are the different ways games have used shaders to give themselves a distinct
look, in the way Borderlands' ink outlines make it read as a comic book?

**Short answer:** most memorable looks come from one or two strong rules applied everywhere,
not from many small effects. Borderlands itself is mostly two things: a post-process pass that
finds edges in the depth and normal buffers and draws them black, and textures that were
hand-painted with ink lines already in them. The lighting underneath is fairly conventional.

Every game below links to its Steam page so you can see the look in the store screenshots and
trailers. Where a game is not sold on Steam, the link goes to its official site, or to its
Wikipedia article if it is no longer sold at all.

## 1. Outlines and ink

- **Post-process edge detection:** [Borderlands](https://store.steampowered.com/app/729040/)
  and [XIII](https://store.steampowered.com/app/1170760/) (the 2003 original, sold as
  *XIII - Classic*). Find sudden jumps in depth or surface angle in screen space and draw a
  line there. It is cheap and catches every object, but line width is the same everywhere and
  cannot be art-directed.
- **Inverted hull:** [Guilty Gear Xrd](https://store.steampowered.com/app/520440/),
  [Hi-Fi Rush](https://store.steampowered.com/app/1817230/) and most anime-style games. Draw
  each mesh a second time, pushed out along its normals, with front faces culled. Arc System
  Works' GDC 2015 talk shows how far this goes: vertex colours set line thickness, normals
  were hand-edited to control where shadows fall, and animation runs at a lowered frame rate
  so it reads like hand-drawn keyframes.
- **Ink-wash:** [Okami HD](https://store.steampowered.com/app/587620/). Brush-stroke outlines,
  a paper-grain overlay and a faded palette imitate sumi-e painting.

## 2. Stepped or reshaped lighting

- **Cel ramps:** [Jet Set Radio](https://en.wikipedia.org/wiki/Jet_Set_Radio) (no longer sold
  on Steam) and [The Legend of Zelda: The Wind Waker](https://en.wikipedia.org/wiki/The_Legend_of_Zelda:_The_Wind_Waker)
  (Nintendo only). Round the light amount into two or three flat bands instead of a smooth
  falloff.
- **Warped diffuse:** [Team Fortress 2](https://store.steampowered.com/app/440/). Valve's 2007
  "Illustrative Rendering in Team Fortress 2" paper describes it. Lighting runs through a
  hand-authored 1D ramp and gets a strong rim light, so characters read like early-20th-century
  commercial illustration and their silhouettes stay clear at a distance.
- **Authored face shadows:** [Genshin Impact](https://genshin.hoyoverse.com/) (HoYoverse's
  own launcher, not Steam). Shadow shapes on faces come from textures, not from the geometry,
  so a nose never casts an ugly shadow.

## 3. Limited colour

- **1-bit dithering:** [Return of the Obra Dinn](https://store.steampowered.com/app/653530/).
  Two colours and a dither pattern. Lucas Pope's devlog covers the hard part: a dither
  computed fresh each frame swims as the camera moves, so the final version maps the pattern
  onto a sphere around the camera for surfaces facing the viewer, which keeps it pinned while
  the camera turns, and uses blue noise everywhere else.
- **A restricted palette as the identity:** [MadWorld](https://en.wikipedia.org/wiki/MadWorld)
  (Wii only; black, white and red), [SUPERHOT](https://store.steampowered.com/app/322500/)
  (a white world with red enemies) and [LIMBO](https://store.steampowered.com/app/48000/)
  (greyscale silhouettes).

## 4. Deliberately low fidelity

- **The PS1 look:** [SIGNALIS](https://store.steampowered.com/app/1262350/) and much of the
  indie horror scene. Vertices snapped to a coarse grid so they jitter, textures that warp
  because there is no perspective correction, low resolution and dithering. People's memories
  of that era make it feel uncanny.
- **3D rendered as pixel art:** [Dead Cells](https://store.steampowered.com/app/588650/).
  3D models rendered at low resolution with no anti-aliasing, then used as sprites.
- **Low-resolution assets under modern lighting:** [Valheim](https://store.steampowered.com/app/892970/).
  Pixelated textures under volumetric fog and bloom.

## 5. Painterly and illustrative

- **Moebius-style line art:** [Sable](https://store.steampowered.com/app/757310/). Heavy
  outlines, flat colour and very little shading.
- **Hatching, watercolour and brush filters:** cross-hatch textures chosen by light level,
  paper grain, or a Kuwahara filter that smears the image into brush strokes.
- **Hand-painted textures with simple lighting:** early [World of Warcraft](https://worldofwarcraft.blizzard.com/)
  (Battle.net, not Steam). Most of the look lives in the textures.

## 6. Atmosphere as the style

- **Gradient fog:** [Firewatch](https://store.steampowered.com/app/383870/). This is the
  closest reference for Day Hike. Fog colour comes from a hand-painted gradient chosen by
  distance, so far ridgelines fade into flat poster colours, and each time of day has its own
  gradient. Much of the game's identity comes from that one shader. Jane Ng's GDC 2015 talk
  covers the art direction behind it.
- **Specular glitter:** [Journey](https://store.steampowered.com/app/638230/). John Edwards'
  GDC talk on the sand: glitter from sparkle normal maps plus a broad, ocean-like sheen made
  sand the game's signature material.
- **Tilt-shift diorama:** [OCTOPATH TRAVELER](https://store.steampowered.com/app/921570/)
  (its "HD-2D" look) and [TUNIC](https://store.steampowered.com/app/553420/). Strong depth of
  field, bloom and vignette make the world look like a miniature.

## 7. Imitating a camera or recording medium

- **VHS and camcorder:** [Resident Evil 7 Biohazard](https://store.steampowered.com/app/418370/)
  (its found-footage tapes) and [Outlast](https://store.steampowered.com/app/238320/) (the
  night-vision camcorder). Scanlines, colour bleed, noise and tracking glitches.
- **Film grain, vignette and chromatic aberration:** horror uses these as shorthand for
  found footage.
- **Fog and noise as dread:** [Silent Hill](https://en.wikipedia.org/wiki/Silent_Hill_(video_game))
  (the 1999 PS1 original, no longer sold). The fog began as a way to hide a short draw distance
  and became the series' identity; the [SILENT HILL 2](https://store.steampowered.com/app/2124490/)
  remake keeps it.

## 8. Shaders tied to the mechanics

- **Painting the world in:** [The Unfinished Swan](https://store.steampowered.com/app/1206430/).
  The world starts pure white, and you reveal it by throwing paint.
- **Seeing by scanning:** [Scanner Sombre](https://store.steampowered.com/app/475190/). You
  only see the point cloud your LIDAR scanner has painted.
- **Sanity effects:** [Eternal Darkness](https://en.wikipedia.org/wiki/Eternal_Darkness)
  (GameCube only) and [Amnesia: The Dark Descent](https://store.steampowered.com/app/57300/).
  The screen warps, colour drains and the image distorts as the character's mind frays.

## What this suggests for Day Hike

- **Firewatch-style gradient fog** fits an outdoor hiking game. It can sit on top of
  photoreal rendering instead of replacing it, so it does not fight the world's current
  photoreal direction.
- **The horror layer** could draw on sections 7 and 8. A post-process that shifts as dread
  builds would set the horror apart from the daytime hike without re-authoring any assets:
  fog colour sliding along a different gradient, grain and chromatic aberration creeping in,
  or a slight VHS bleed on the headlamp cone.

Babylon.js supports both through the material plugins the ground shaders already use and
through its `PostProcess` pipeline.

## Sources

| Source | Covers |
| --- | --- |
| [GuiltyGearXrd's Art Style: The X Factor Between 2D and 3D](https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The) (GDC 2015) | Inverted-hull outlines, edited normals, stepped animation |
| [Illustrative Rendering in Team Fortress 2](https://steamcdn-a.akamaihd.net/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf) (Mitchell, Francke and Eng, NPAR 2007) | Warped diffuse ramp and rim lighting |
| [Return of the Obra Dinn devlog, November 2017](https://dukope.com/devlogs/obra-dinn/tig-32/) (Lucas Pope) | Stabilising 1-bit dithering |
| [The Art of Firewatch](https://gdcvault.com/play/1022295/The-Art-of) (Jane Ng, GDC 2015) | Firewatch's art direction |
| [Making the World of Firewatch](https://www.gdcvault.com/play/1023191/Making-the-World-of) (Jane Ng, GDC 2016) | Firewatch's world production |
| [Sand Rendering in Journey](https://www.gdcvault.com/play/1017742/Sand-Rendering-in) (John Edwards, GDC 2013) | Sand glitter and sheen |
