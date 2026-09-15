# Atmosphere and dread: a second shader research pass

**Question:** the first pass ([2026-09-14-stylized-shader-looks](2026-09-14-stylized-shader-looks.md))
surveyed eight ways games build a look out of shaders. The direction chosen from it is
*closer to photoreal, but artsy and atmospheric*, keeping the game's ominous, eerie theme,
with the two horror families (imitating a camera or recording medium, and shaders tied to
the mechanics) carrying the horror layer. What, concretely, do the games that achieve that
look do, what do state-driven horror effects look like when they are done well, and which
of it can Babylon.js 9.18 do at 60 fps in a browser?

**Short answer:** every photoreal-but-atmospheric game in the survey makes the same core
move: a physically based sky and lighting underneath, an **artist-controlled height fog**
on top of it, a **neutral tone map followed by a grade**, and a **film treatment** (halation,
luminance-weighted grain, dither) so a dark, foggy image survives 8-bit output. The horror
games that hold up over hours drive **event rate and severity** from their dread state and
keep screen distortion as the smallest channel, confined to the edge of the frame. Almost
all of it is cheap in Babylon: a handful of single-pass post-processes and per-material
plugin terms. The three things Babylon does not give for free are a fog hook (the fog line
has to be regex-replaced in the PBR fragment), an AgX or filmic tone map (a custom pass),
and a volumetric headlamp cone (a cone mesh, not the built-in god-ray pass).

Every game links to its Steam page, or to its official site or Wikipedia where it is not
on Steam. Sources are in the table at the end; anything marked *unverified* was reported
second-hand and the primary source could not be opened.

## 1. What the shaders did before the restyle

The pre-restyle "style" was thinner than it looked. All of it was in `client/src/game/`:

- `lighting.ts` — a `SkyMaterial` sky captured to a reflection probe for image-based
  ambient, a sun with cascaded shadows to 300 m, a hemispheric fill, ACES tone mapping
  with contrast 1.1, single-colour EXP2 fog to a 4 km horizon, and a nine-value
  `ColorCurves` split-tone grade (violet shadows, green-teal midtones, drained cyan
  highlights) scaled by the weather's mood.
- `weather.ts` — five presets (`clear`, `overcast`, `mist`, `rain`, `eerie`) as points in a
  continuous space with a `dread` axis. Dread already pulls the fog toward a bruised
  green-grey, dips exposure, deepens the vignette and grain, and thickens the mist banks.
  `clear` is the machine-checked identity every modifier returns to.
- `stylize.ts` — a vignette on the shared image-processing config, a
  `DefaultRenderingPipeline` with grain and radial chromatic aberration on medium and high,
  and the **etched outline** post-process (Roberts-cross edges on a depth pre-pass, normals
  on high, etch noise, dissolved by the fog); `/style cel` swapped it for `cel.ts`, a
  material plugin that quantised direct diffuse into two bands. All retired by the restyle.
- `skin.ts` — wrap Lambert with a red terminator scatter on characters that carry a
  metallic-roughness texture.
- `mistMeshes.ts` — twelve unlit billboard banks coloured to the fog.
- `headlamp.ts` — one `SpotLight` per player, 1.5 rad, intensity 400, no shadows.

The four material plugins (`distanceFadePlugin`, `groundConformPlugin`, `windPlugin`,
`wingPlugin`) and the ground blend in `terrainTexture.ts` are functional, not stylistic;
a restyle leaves them alone. Two facts carried into the restyle: the outline pass was the
only thing that expressed the "etched" identity, so the look was one post-process plus a
grade, which is why it did not read as distinct; and `quality.ts` declared an `ssao` flag
for the high tier that nothing in `client/src` consumed. The restyle retired the outline
pass, `/style` and the `ssao` flag.

## 2. Photoreal, but atmospheric

### The games

- [Death Stranding](https://store.steampowered.com/app/1850570/) — the clearest precedent.
  Decima combines a precomputed atmospheric-scattering model (photoreal, hard to art-direct)
  with an analytic height fog (artist-driven), "mixing both photorealism and artistic
  flexibility in a single model". Timefall rolls in as fog and turns the palette grey-green.
- [Red Dead Redemption 2](https://store.steampowered.com/app/1174180/) — sky, clouds and
  fog as one system tied to the time of day, "balancing physical accuracy with artistic
  control". Dawn mist, noon haze and dusk glow are one continuous curve, not presets.
- [Ghost of Tsushima](https://store.steampowered.com/app/2215430/) — "stylised realism"
  from a 128×64×64 froxel haze (~0.5 ms on async compute), hand-picked Rayleigh
  coefficients to get the right blue, a Bradford white point chosen per time of day, a
  Purkinje night shift (rods pull night scenes to blue-grey without a tint), and tens of
  thousands of airborne particles (pollen, leaves, ash) lit by the fog volume. Kurosawa
  mode is a calibrated monochrome with grain.
- [Alan Wake 2](https://www.alanwake.com/) — the most photoreal forest shipped and
  unmistakably graded: lifted grey shadows, froxel fog with a multiple-scattering
  approximation "giving it a thick and realistic look", film grain as a player setting,
  HDR grading by professional colourists.
- [Hunt: Showdown 1896](https://store.steampowered.com/app/594650/) — "every light affects
  the fog, and fog is also affected by shadows"; the workflow "mimics the workflow used for
  movies": a neutral HDR base image first, then a bold gold grade by day and a grim
  blue-black by night.
- [Hellblade: Senua's Sacrifice](https://store.steampowered.com/app/414340/) and
  [Senua's Saga: Hellblade II](https://store.steampowered.com/app/2461850/) — photoreal
  scanned Iceland committed to a film presentation: 2.39:1 letterbox, soft filmic image,
  shallow depth of field, grain, chromatic aberration, motion blur as texture. The
  letterbox is also a resolution rebate: Hellblade II renders 1296–1440p and shows
  962–1070 rows (*unverified*: reported from Digital Foundry's video, not the video itself).
- [INSIDE](https://store.steampowered.com/app/304430/) — realistic lighting on minimal
  forms, fog in every shot, backlit silhouettes, and an image whose identity lives in the
  bottom tenth of the tone range. Playdead's GDC 2016 talk pairs it with "Banding in
  Games": triangular-PDF noise at about half an LSB, applied after the sRGB transform and
  before quantisation, animated per frame. That is what lets a dark, foggy, graded image
  hold in 8-bit.
- [Everybody's Gone to the Rapture](https://store.steampowered.com/app/417880/) — a valley
  in permanent golden hour, built from stock CryEngine systems; the rules were "slow,
  languid movement" and one shape grammar shared by every light effect.
- [Dear Esther](https://store.steampowered.com/app/520720/) — flat overcast light, fog
  that eats the horizon, silhouettes; identity through restraint.
- [The Vanishing of Ethan Carter](https://store.steampowered.com/app/258520/) — the first
  indie game built from scans of real locations, which "deliberately avoided photorealistic
  presentation" by applying stylised lighting and post on top of the scanned geometry. The
  team used fog as a culling tool: the far clip plane sits where fog opacity reaches 100%.
- [Mundaun](https://store.steampowered.com/app/720350/) — realistic lighting and fog acting
  on hand-pencilled textures. Proof that a photoreal pipeline with a non-photographic albedo
  reads as art without any post trickery.
- [Bramble: The Mountain King](https://store.steampowered.com/app/1623940/) — reportedly
  a bare rig of sky light, one directional light and an exponential height fog per level
  (*unverified*), which is the minimum that still makes a strong mood.
- [Pacific Drive](https://store.steampowered.com/app/1458140/) — the same Pacific Northwest
  forest family as Day Hike, "twisted from the familiar". A mood reference; no published
  post-process specifics.
- [Still Wakes the Deep](https://store.steampowered.com/app/1622910/) and
  [Metro Exodus](https://store.steampowered.com/app/412020/) — fog and mist withhold the
  creature; identity from the contrast between areas.

Dropped after a look: Kholat, Sons of the Forest and Stray (no technique sources) and The
Long Dark (painterly; belongs to the first pass).

### The pattern

1. **Height fog with a sun-direction colour, instead of one fog colour.** Iñigo Quílez's
   closed-form height fog and a `mix(shadowColour, sunColour, pow(dot(view, sun), k))`
   inscatter term give aerial perspective in a few lines: far ridges go blue-grey while
   the near mist stays warm. Bind density, height and both colours to the day-to-dusk
   clock and to the weather so they are curves, as in RDR2, rather than presets.
2. **Neutral tone map, then a grade.** Hunt's rule. ACES bends hue (the orange-and-teal
   drift); AgX attenuates chroma toward white as values rise and reads photographic.
   Tsushima's per-time-of-day white point and Purkinje matrix are the right way to make
   night blue-grey without tinting, and they flatter a warm headlamp.
3. **Film treatment.** Halation (threshold, wide blur, red-orange tint, screen blend; not
   bloom) so the headlamp and the low sun read as lights on film; grain that is
   luminance-dependent and applied after tone mapping; triangular dither after sRGB so
   near-black fog does not band; optionally a letterbox.
4. **Airborne matter lit by the fog.** Pollen at noon, midges at dusk, frost or ash at
   night, riding the wind field the foliage already sways to, coloured by the same
   inscatter term as the fog so motes glow in shafts and die in shadow.
5. **Silhouettes against the fog.** INSIDE authors diffuse, specular and bounce separately
   so silhouettes can be pushed dark against lit mist; a forward PBR equivalent is a plugin
   term that scales ambient down near the fog horizon.

## 3. Horror effects tied to a state or a mechanic

### The games

- [Alan Wake](https://store.steampowered.com/app/1029880/) — enemies wear a shroud of
  darkness that the flashlight's focused beam burns off before they can be hurt; lamp
  posts are safe zones. The shroud is a legibility trick: an enemy is darker than dark
  until light touches it, and the burn-off is the state readout.
- [Alan Wake 2](https://www.alanwake.com/) — the **overlap**: a faded second view of a
  parallel location is double-exposed over the playable scene as you near a threshold, and
  monochrome smash cuts arrive as the Dark Presence spreads. Enemies "never stop talking",
  with mumble loops tuned to their alertness, so you hear them before you see them.
- [SILENT HILL 2](https://store.steampowered.com/app/2124490/) (2024) — fog as the world's
  draw distance, a muted palette, and the flashlight as the dominant direct light with
  real bounce. The Otherworld flips at authored beats, "just as it seems like players have
  mastered their understanding of their surroundings", never on a timer.
- [Amnesia: The Dark Descent](https://store.steampowered.com/app/57300/) — sanity drains
  in darkness and on sightings; the cue is a screen pulse plus a sound that gets "worse and
  worse", and discrete stings on events. Frictional removed every fail state from the
  meter because it could not be balanced across hours; the deterrence is entirely
  audio-visual. Low-sanity specifics (blur, warp, insects, delayed input) are *unverified*.
- [Amnesia: Rebirth](https://store.steampowered.com/app/999220/) — fear accumulates in the
  dark; when it overwhelms, "grotesque images will also pop up in the screen": single-frame
  inserts and whisper layers gated by the scalar.
- [Amnesia: The Bunker](https://store.steampowered.com/app/1944430/) — when the lights
  flicker erratically, the creature is nearby. A light-intensity jitter as a proximity
  channel: cheap, diegetic, reads through walls.
- [SOMA](https://store.steampowered.com/app/282140/) — nearing a creature, the screen
  distorts and glitches until the monster is "impossible to define visually". The warning
  hides the thing it warns about.
- [Slender: The Arrival](https://store.steampowered.com/app/252330/) — camcorder static and
  chromatic aberration rise with proximity. Thomas Grip's verdict: a "great way to
  symbolize the presence of an evil being", but encounters "became increasingly frequent
  and the effect was lost". A proximity effect that fires often becomes a rule.
- [Fatal Frame II](https://store.steampowered.com/app/3920610/) — the camera's filament
  glows blue for a friendly spirit and red for a hostile one; ghosts fade in and out with
  distance. The indicator lives on the device, not the HUD.
- [Phasmophobia](https://store.steampowered.com/app/739630/) — no hallucination post-process
  at all. Sanity drives the *frequency* of ghost events, flickering lights and hunts;
  the numbers come from a community guide (*unverified*).
- [Visage](https://store.steampowered.com/app/594330/) — sanity drives the *severity* of
  each event rather than its rate.
- [DREDGE](https://store.steampowered.com/app/1562430/) — panic from staying out after dark
  makes rocks appear in the water, and they really damage the boat. The scalar changes the
  world, not the lens.
- [Layers of Fear](https://store.steampowered.com/app/391720/) — the room changes when you
  look away, triggered by position or by view direction after light and sound have pulled
  attention elsewhere.
- [Control](https://store.steampowered.com/app/870780/) — possessed hosts glow red "from
  inside", like "shining a bright torch beneath your hand"; one hue means one thing across
  the whole game.
- [DEATH STRANDING](https://store.steampowered.com/app/1190460/) — BTs are invisible until
  a scan sends a flash down the terrain and gives "a faint outline of any BTs on the
  horizon" for a moment. Two independent recreations show the scan is a post-process:
  quantised depth with a Sobel edge for the sweeping contours, converted to world-space
  distance so line spacing does not change with the camera.
- [Pacific Drive](https://store.steampowered.com/app/1458140/) — when enough energy is
  collected "the junction begins to destabilize, and the safe area shrinks": the closest
  published analogue to Day Hike's task-driven escalation.
- [Dead by Daylight](https://store.steampowered.com/app/381210/) — a heartbeat in thirds
  of the terror radius (32 m default), with an accessibility option that draws the beating
  heart on the survivor's chest.
- [Alien: Isolation](https://store.steampowered.com/app/214490/) — a menace gauge that
  "backs off and sends the alien elsewhere" at its peak, music remixed from live "stealth"
  and "threat" values, and view-cone scripting so the music never betrays an alien
  approaching from outside the field of view.
- [Darkwood](https://store.steampowered.com/app/274520/) — outside the vision cone the
  scene is greyscale and enemies are not drawn at all.
- [P.T.](https://en.wikipedia.org/wiki/P.T._(video_game)) — one lighting change per loop:
  lit, then the radio, then lights out, then red. The lack of pattern is the point.
- [S.T.A.L.K.E.R.: Shadow of Chernobyl](https://store.steampowered.com/app/4500/) —
  anomalies show as air distortion you can test with a thrown bolt: distortion as a
  warning, localised to a world volume.
- Shorter: [Outlast](https://store.steampowered.com/app/238320/) (seeing costs battery),
  [Blair Witch](https://store.steampowered.com/app/1092660/) (the dog barks when they are
  close; *unverified* beyond Wikipedia), [The Medium](https://store.steampowered.com/app/1293160/)
  (two full worlds rendered at once, a budget warning), [SCP – Containment Breach](https://www.scpcbgame.com/)
  (a forced blink as the entity's window), [Lethal Company](https://store.steampowered.com/app/1966720/)
  (deep shadow and fog so "the imagination takes hold").

Retroreflection has a recent primary source: the MRM paper (arXiv 2606.08739) makes any
microfacet BSDF retroreflective by evaluating it with the view direction reflected about
the normal, with no new parameters. It flares only for a small light near the eye, which is
exactly a headlamp.

### What it suggests for Day Hike's horror layer

The parent design already has an escalation scalar (task completion and leaving the
trail), one persistent Hollow that must read from far away, a headlamp, retroreflective
tape and a planned dread stack. The survey maps onto each:

- **The scalar drives rate and severity, not amplitude.** Whispers and misleading
  one-shots on a rate curve and a severity curve (Phasmophobia, Visage); the screen warp
  the smallest of the three channels (Grip's Slender lesson); Amnesia's split of a
  continuous, worsening cue plus discrete stings on task completion and on stepping off
  the trail. Alien's director rule: after a peak, back off.
- **Lighting collapse as authored steps.** Three or four discrete lighting states advanced
  on task milestones (P.T., Pacific Drive), with only small continuous drift inside each,
  rather than a slider.
- **The Hollow is exempt from fog.** Render it with fog factor zero and no distance
  desaturation so at 800 m it is still a pure black cut-out against fog that has gone
  grey-blue (an inference from Alan Wake's darker-than-dark shroud and Silent Hill's fog,
  not a documented technique). A thin rim against the fog colour keeps the outline at
  distance; inside the headlamp cone, Control's inner red translucency rather than a lit
  surface, so light passes through it and never reveals it. Death Stranding's one-shot
  depth-Sobel outline is the fallback if a guaranteed read is ever needed.
- **Proximity cues must not leak position.** Distance cues (lamp flicker, a heartbeat in
  bands) may scale continuously; directional cues only after the Hollow has been seen.
  SOMA's aberration is the model for the last 30 m, where the image itself hides it.
- **The screen warp is AW2's overlap, at the periphery.** A low-alpha ghost of a wrong view
  of the same trail, growing with the scalar, on the outer part of the frame, with no camera
  roll and a stable horizon, behind a 0–100% "unsettling effects" slider (Xbox Accessibility
  Guideline 117). The centre of the headlamp beam is always trustworthy.
- **Retroreflective tape is a one-line material change,** masked to the headlamp so
  moonlight never makes it glow.

## 4. What Babylon.js 9.18 can do

Checked against the installed `@babylonjs/core` 9.18.0 source, not the docs alone.

| Technique | Mechanism | Cost | Notes |
| --- | --- | --- | --- |
| Vignette, exposure, contrast, colour curves, dithering | `ImageProcessingConfiguration` | cheap | Already in use; every scalar is a plain uniform, safe to drive per frame |
| Grain, chromatic aberration, sharpen, FXAA | `DefaultRenderingPipeline` | cheap | One pass each |
| Colour-grading 3D LUT | `colorGradingTexture` (`.3dl` or PNG) | cheap | One 3D fetch in the image-processing pass |
| Tone mapping | `TONEMAPPING_STANDARD` / `ACES` / `KHR_PBR_NEUTRAL` | cheap | **No AgX or filmic mode exists**; flipping the type recompiles, set it per tier |
| AgX tone map, halation, film grain, gate weave | one custom "grade" `PostProcess` | cheap | three.js's AgX GLSL is MIT and ports directly; run it with the pipeline's image processing off, on linear HDR |
| Bloom | pipeline `bloomEnabled` | moderate | Four passes at `bloomScale` |
| Depth of field | pipeline DoF | expensive | A depth re-render plus three to seven blur passes; dusk-only at best |
| Height fog with a gradient colour | PBR plugin regex on the expanded fog line | cheap | **There is no fog hook in `pbr.fragment.js`**; the include ends in `color.rgb=mix(vFogColor,color.rgb,fog);` and a `!`-regex key must replace it. Version-fragile: pin with a compile test |
| Fog on the sky and particles | `SkyMaterial` colour by hand; `applyFog` stays single-colour | cheap | The horizon has to meet the far end of the gradient |
| God rays from the sun | `VolumetricLightScatteringPostProcess` | expensive | Re-renders every occluder; **useless for an eye-mounted headlamp** (the source is at the camera) |
| Headlamp volume | an additive cone mesh with depth-map soft intersection | cheap | The "good enough volumetrics for spotlights" technique; `FrameGraphVolumetricLightingTask` is frame-graph and directional-light only |
| UV warp, ripple, heat haze, overlap | custom `PostProcess`, one or two reads | cheap | Fold every distortion into one pass driven by the scalar |
| Retroreflective tape, rim, fog silhouette | PBR plugin at `CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR` | cheap | `viewDirectionW` is surface-to-camera; pass the lamp explicitly rather than reading light slots |
| Motion blur | `MotionBlurPostProcess` | moderate to expensive | Needs the g-buffer or depth plus the previous view-projection |
| `LensRenderingPipeline` | separate chain | moderate | Conflicts with the default pipeline; take one custom pass instead |

Constraints that shape the design:

- Post-processes run in creation order and the pipeline's internal order is fixed
  (sharpen, DoF, bloom, image processing, chromatic aberration, grain, FXAA); the outline
  already runs first on linear HDR. Custom passes inside the chain must use the same
  half-float texture type or they truncate.
- One depth renderer per camera is shared by the outline, DoF and any new pass; a second
  scene render (g-buffer, god-ray occluders) costs several milliseconds in this forest.
  Budget the whole post chain at about 2 ms at 1440p and measure with paired samples.
- Plugin custom code is injected after include expansion and before `#ifdef` evaluation;
  `vAlbedoColor` is the material constant; a directive spelled in a comment is parsed as
  real. All three traps are already recorded in the shader files.
- `MaterialPluginBase.isCompatible` accepts GLSL only, so every plugin is silently dropped
  on WebGPU. The restyle stays on WebGL2.

## 5. Candidate directions for the brainstorm

These are not decisions. They are the shapes the evidence supports, for the redesign
discussion to pick from.

1. **"Photographed dusk."** Keep the PBR world; replace the identity layer with height
   fog and sun-colour inscatter (a plugin), AgX plus a per-hour white point and a Purkinje
   night matrix (one pass), a `.3dl` LUT for the eerie grade, halation, luminance grain
   and dither. The etched outline and the cel band retire. This is the Death Stranding and
   Alan Wake 2 recipe at browser cost, and it keeps the world photoreal by construction.
2. **Airborne matter as the signature.** One particle system on the wind field, coloured
   by the fog term, changing species with the hour. Tsushima's identity, and the game's
   wind already exists.
3. **The horror layer as the two horror families.** Lighting collapse in steps, the
   overlap at the periphery, the fog-exempt Hollow with an inner glow, retroreflective
   tape, lamp flicker by distance, and a filament-style diegetic indicator if the design
   wants a detector. All of it on the existing `dread` axis, which already reaches fog,
   exposure, vignette, grain and mist.
4. **A letterbox** as both a film cue and a resolution rebate, if the post chain needs the
   headroom.

Open questions for the owner:

- Does the outline pass go entirely, or survive as an optional `/style`?
- Is the Hollow allowed a hue of its own (Control's one-meaning red), given the model
  convention that reserves hue 280–340 for enemies?
- Which quality tier is the reference for the 2 ms post budget?

Fuller per-game notes, with every fetched URL and the list of what could not be verified,
are archived outside the repository at
`~/Projects/fps-sdd-archive/2026-09-15-shader-restyle-research/` (three files: photoreal
atmosphere, horror mechanics, Babylon feasibility).

## Sources

| Source | Covers |
| --- | --- |
| [Decima Engine: Advances in Lighting and AA](https://advances.realtimerendering.com/s2017/index.html) (de Carpentier and Ishiyama, SIGGRAPH 2017) | The scattering-plus-height-fog hybrid |
| [Creating the Atmospheric World of Red Dead Redemption 2](https://advances.realtimerendering.com/s2019/index.htm) (Bauer, SIGGRAPH 2019; abstract only, slides *unverified*) | Integrated sky, cloud and fog |
| [Real-Time Samurai Cinema](https://advances.realtimerendering.com/s2021/jpatry_advances2021/index.html) (Patry, SIGGRAPH 2021) | Froxel haze, white point, Purkinje shift, particles lit by fog |
| [How Northlight makes Alan Wake 2 shine](https://www.remedygames.com/article/how-northlight-makes-alan-wake-2-shine) (Remedy) | Multiple-scattering fog, grading, grain |
| [The Development of Hunt: Showdown](https://80.lv/articles/the-development-of-hunt-showdown) (80.lv) | Neutral base image, then a grade; lights in fog |
| [Low Complexity, High Fidelity: The Rendering of INSIDE](https://www.gdcvault.com/play/1023002/Low-Complexity-High-Fidelity-INSIDE) (Gjøl and Svendsen, GDC 2016) and [Banding in Games](https://loopit.dk/banding_in_games.pdf) | Dither after sRGB, silhouettes, authored light |
| [Visual Revolution of The Vanishing of Ethan Carter](https://www.theastronauts.com/2014/03/visual-revolution-vanishing-ethan-carter/) (The Astronauts) | Stylised post on scanned geometry; fog as culling |
| [Fog](https://iquilezles.org/articles/fog/) (Quílez) | Closed-form height fog and sun-direction colour |
| [Khronos PBR Neutral](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md) and [darktable's AgX](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/agx/) | Tone-mapping choices |
| [Alan Wake: Light and Dark](https://gdcvault.com/play/1013666/Alan-Wake-Light-and) (Lehtinen, GDC Europe 2010) | Darkness as a shield the light burns off |
| [Game Design Deep Dive: Amnesia's Sanity Meter](https://www.gamedeveloper.com/design/game-design-deep-dive-i-amnesia-i-s-sanity-meter-) and [Thoughts on Slender: The Arrival](https://www.gamedeveloper.com/design/thoughts-on-slender-the-arrival) (Grip) | Continuous cue plus stings; why frequent proximity effects wear off |
| [The Perfect Organism: The AI of Alien: Isolation](https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation) and [The sound of Alien: Isolation](https://audiomediainternational.com/the-sound-of-alien-isolation/) | Menace gauge that backs off; view-cone scripting |
| [How the Beast works in Amnesia: The Bunker](https://www.aiandgames.com/p/how-the-beast-works-in-amnesia-the) (AI and Games) | Light flicker as a proximity channel |
| [Fog of Woe](https://www.gamedeveloper.com/design/fog-of-woe-what-the-silent-hill-2-remake-gets-right-about-immersing-players-in-its-world) (Game Developer) | Silent Hill 2's fog and authored flips |
| [Death Stranding Odradek terrain scanner, UE4 case study](https://realtimevfx.com/t/death-stranding-odradek-terrain-scanner-ue4-case-study/11200) and [the Unity recreation](https://80.lv/articles/recreating-death-stranding-odradek-terrain-scanner-in-unity) | The scan as a depth-Sobel post-process |
| [MRM: microfacet retroreflection](https://arxiv.org/abs/2606.08739) | Retroreflection by reflecting the view direction |
| [Xbox Accessibility Guideline 117](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/117) and [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/) | Sliders for full-screen effects; stable horizon |
| [Good enough volumetrics for spotlights](https://john-chapman-graphics.blogspot.com/2013/01/good-enough-volumetrics-for-spotlights.html) (Chapman) | The headlamp cone mesh |
| Babylon.js documentation: [DefaultRenderingPipeline](https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/defaultRenderingPipeline), [Material plugins](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/materialPlugins), [Volumetric light scattering](https://doc.babylonjs.com/features/featuresDeepDive/lights/volumetricLightScattering); installed source `@babylonjs/core` 9.18.0 | Section 4 |
