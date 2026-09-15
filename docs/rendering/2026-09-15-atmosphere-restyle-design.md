# Atmosphere restyle: design

**Status:** design, ruled 2026-09-15. Implementation plan to follow.

**What this is.** A full redo of Day Hike's identity layer, the shaders and post-processes
that turn a lit PBR world into a look. The ruling behind it: *closer to photoreal, but artsy
and atmospheric*, keeping the ominous, eerie theme. The research is in
[2026-09-14-stylized-shader-looks](2026-09-14-stylized-shader-looks.md) and
[2026-09-15-atmosphere-and-dread-shaders](2026-09-15-atmosphere-and-dread-shaders.md); this
document records the decisions and the design, not the evidence.

The recipe every photoreal-but-atmospheric game in the research shares is the recipe here:
a physically based world underneath, an artist-controlled height fog on top, a neutral tone
map followed by a grade, and a film treatment so a dark, foggy image survives 8-bit output.
The horror layer rides the existing `dread` axis, drives the world in steps and the lens
continuously, and keeps the screen distortion small and peripheral.

## 1. Rulings

| Question | Ruling |
| --- | --- |
| Scope against the unbuilt horror sub-projects | Base look plus the dread channels, all on the existing `weather.dread` axis, testable through `/weather eerie`. The Hollow's rendering and the retroreflective tape are specified later inside sub-projects C and F, reusing the plugin hooks this design establishes. |
| The etched outline and the cel band | Retired, along with `/style`. The identity moves entirely to fog, grade and film treatment. |
| Hero frames the look is tuned and gated against | All four: sunny start (`clear`, hour 10–14), the eerie turn (`eerie`, hour 16–18), night with the headlamp (`eerie`, hour 20–22), and dawn (`clear`, hour 6–7). Every term is therefore a curve over the clock and the weather, not a preset. |
| Colour identity of the eerie state | Rich-eerie rebuilt: violet shadows, green-teal midtones, drained cyan highlights survive as the intent, re-expressed on a neutral tone map. A `lift` term (shadows never reaching black, the Alan Wake 2 look) exists as a parameter at 0 so that look can be dialled in later without restructuring. |
| Film treatment | Subtle by day, committed under dread. Halation, luminance grain and dither are always on but near-invisible in the sunny frame; grain, aberration and vignette climb with dread. No letterbox. |
| Frame-time gate and the low tier | High tier on the development Mac is the gate. Medium drops halation and the particles' upper capacity. Low has no post passes: it keeps the fog plugin and in-material image processing so the colour intent survives on phones. |
| Airborne matter | In scope on high and medium: one particle system, species by the sun's altitude, coloured by the fog. |
| Dread channels added | The peripheral overlap, lighting collapse in steps, and a `/unsettle` slider. A SOMA-style aberration spike is deferred to the Hollow's proximity in sub-project C. |
| Architecture | One custom grade pass owns colour and film treatment; Babylon's pipeline keeps only chromatic aberration and FXAA; a second custom pass finishes the frame. |

## 2. Goals and non-goals

Goals:

- The sunny frame reads photographic: a real hillside on a clear day, with aerial
  perspective and a warm sun-side haze, nothing that says "filter".
- The eerie frame reads authored: valleys filled with green-grey fog, lifted violet shadows,
  a headlamp that halates like a light on film, no banding in the near-black.
- A rising dread changes the world three times (steps) while the lens degrades continuously.
- Every number is a uniform driven from pure, tested TypeScript; nothing recompiles a shader
  at runtime; `clear` at any hour is the exact identity every dread and mood term returns to.
- The whole post chain costs about 2 ms or less at high tier at 1440p on the development
  Mac, measured with paired samples.

Non-goals:

- The Hollow's own rendering (fog exemption, rim, inner glow) and the retroreflective tape:
  sub-projects C and F.
- Whispers, one-shot sounds and anything that *drives* the dread axis in play: sub-projects
  D and E.
- A delayed (history-buffer) echo for the overlap; depth of field; god rays; WebGPU. Each
  is a documented follow-up, not a hidden requirement.
- Any change to `sim/`, the level id, or invite links. Everything here is renderer-only.

## 3. Architecture

### 3.1 Module map

Removed: the outline pass and its pre-pass wiring in `stylize.ts`; `cel.ts`;
`shaders/celBand.fragment.fx`; `shaders/etchedOutline.fragment.fx`; the `/style` command,
`STYLE_NAMES`, `DEFAULT_STYLE` and `StyleName`; the `ssao` flag in `quality.ts` (consumed by
nothing); the tests `cel.test.ts`, `celBandShader.test.ts`, `etchedOutlineShader.test.ts`,
`stylize.test.ts` and `stylizeParams.test.ts`.

Added, one unit per job. Every Babylon-bearing unit has a pure, Babylon-free `*Params.ts`
sibling on the architecture test's `BABYLON_FREE_FILES` list, and every `.fx` file has a
lockstep test against the TypeScript reference of its literals: the `weather.ts` /
`lighting.ts` and `celBand` patterns, kept.

| Unit | Kind | Job |
| --- | --- | --- |
| `atmosphere.ts`, `atmosphereParams.ts`, `shaders/atmosphereFog.fragment.fx` | material plugin, registered globally before any material exists (the slot `cel.ts` occupied) | replaces the PBR fog line: height fog, distance gradient, sun-direction inscatter |
| `post.ts` (replaces `stylize.ts`), `postParams.ts` (replaces `stylizeParams.ts`) | the post-chain shell | builds the halation passes, the `grade` pass, the pipeline and the `finish` pass in order; owns the capability fallback |
| `shaders/halationExtract.fragment.fx` | post-process, quarter resolution | luminance threshold and tint, feeding Babylon's `BlurPostProcess` |
| `shaders/grade.fragment.fx` | post-process | exposure, AgX, white point, Purkinje, split-tone, lift, vignette, halation, sRGB encode |
| `shaders/finish.fragment.fx` | post-process | the peripheral overlap, luminance grain, triangular dither |
| `motes.ts`, `motesParams.ts` | particle system | airborne matter, species by altitude, coloured by the fog |

Changed: `weather.ts` keeps the `dread` axis and gains `stepped()`, the ambient-collapse
term and the new gains; `lighting.ts` keeps sky, sun, shadows and the probe, stops setting
tone mapping, contrast and colour curves on pipeline tiers, and writes the atmosphere
record; `commands.ts` gains `/unsettle` and drops `/style`; `renderer.ts` wires the new
units where it wired the old; `mistMeshes.ts` colours its banks from the gradient's mid
colour rather than `scene.fogColor`; `windPlugin.ts` exports its ω constants for `motes.ts`.

### 3.2 Data flow

Once per frame in `renderer.sync`, after `lighting.weather` and `lighting.hour` are read:

```
(weather, hour, unsettle)
  ├─ atmosphereUnder(weather, hour)            → AtmosphereRecord → atmosphere plugin (module record; bindForSubMesh reads it)
  │                                                               → motes.update (near-end inscatter colour)
  │                                                               → mistMeshes.update (mid colour)
  ├─ gradeUnder(weather, hour, unsettle)        → GradeRecord      → grade pass onApply (pipeline tiers)
  │                                                               → imageProcessingConfiguration (low tier)
  ├─ finishUnder(weather, unsettle)             → FinishRecord     → finish pass onApply
  └─ motesUnder(weather, hour)                  → MotesRecord      → motes.update
```

No shader reads scene state directly. Every value is a uniform, so nothing recompiles at
runtime and every value is testable under Node. The three records are plain objects of
numbers, matrices as `number[9]`, and colours as `Rgb`.

The fog gradient is the one texture rebuilt at runtime: a 256×1 `RawTexture` regenerated on
the CPU from `fogGradientUnder(weather, hour)` whenever hour or weather changes (the fade
observer already fires `apply()` per tick during a fade; the rebuild rides it).

### 3.3 Two colour paths

Medium and high build the `DefaultRenderingPipeline` with `hdr: true` and set
`imageProcessingConfiguration.applyByPostProcess = true`, so every material outputs linear
HDR and the `grade` pass owns colour.

Low has no float render targets, so it has no passes: the same `GradeRecord` is mapped onto
Babylon's in-material image processing (Khronos PBR Neutral tone mapping, the existing
`ColorCurves` split-tone, vignette, `ditheringEnabled`). The operator differs, the intent
matches. This is the only place the two paths diverge, and it is stated here once.

## 4. The atmosphere plugin

**Hook.** A `MaterialPluginBase` registered through `RegisterMaterialPlugin` for every
`PBRMaterial`; the factory declines everything else (sky, mist, particles). Its
`getCustomCode` returns `CUSTOM_FRAGMENT_DEFINITIONS` for the functions and uniforms, and
one `!`-regex key that replaces the expanded fog line
`finalColor.rgb=mix(vFogColor,finalColor.rgb,fog);` with the model below. `scene.fogMode`
stays `FOGMODE_EXP2` so the `FOG` define, `vFogDistance` and `CalcFogFactor()` still exist;
the built-in mix is gone rather than doubled. The regex is pinned by an anchor test against
the installed `fogFragment` include text, the `skin.ts` precedent, so a Babylon upgrade
fails in the suite rather than in the browser.

**Model, per fragment**, with `d = length(vFogDistance)` and `rd` the unit world ray from
`vEyePosition` to `vPositionW`:

- *Extinction* `T = exp(-(d·k_base)²) · exp(-h(d, rd))`, where the first factor is today's
  EXP2 term to the 4 km horizon (so `fogDensityFor`'s guarantee that the draw-distance edge
  is invisible holds unchanged) and `h` is Quílez's closed-form height fog: a density that
  decays exponentially with height above a **world-fixed reference level**, integrated along
  the ray. Mist raises the reference level and the height density; `dreadWorld` raises the
  level further. World-fixed rather than camera-relative so climbing the stem lifts the
  player out of the fog.
- *Inscatter colour* `C = mix(G(d), S, pow(max(dot(rd, sunDir), 0), k_sun) · sunWeight)`,
  where `G` is the distance gradient sampled at `d / viewDistance`, `S` the sun colour, and
  `sunWeight` fades with cloud cover and with the sun's altitude below the horizon.
- `finalColor.rgb = mix(C, finalColor.rgb, T)`.

Output is linear; the grade pass tone-maps it.

**The gradient** (`fogGradientUnder(weather, hour)`, pure): near end is the air colour
(today's `fogColourUnder`, which already carries mist, cloud, dusk dimming and the dread
pull toward `DREAD_AIR`); far end is the sky's horizon colour at that hour, so the horizon
seam closes by construction; the curve between them is a smoothstep biased toward the near
colour. Authored in linear.

**`AtmosphereRecord`**: `baseDensity`, `heightDensity`, `heightFalloff`, `referenceLevel`,
`gradientScale`, `sunDir`, `sunColour`, `sunWeight`, `k_sun`. One module-level record,
written once per frame, bound per submesh. No defines.

**Non-PBR materials keep Babylon's single-colour fog** (`scene.fogColor` stays set to the
gradient's near colour): the mist billboards, rain and the water surface if it is not PBR.
Near-field only; accepted.

**Cost:** a few ALU and one 1D fetch per fragment, minus the mix it replaces.

## 5. The post chain

### 5.1 Order on the camera (medium and high, `hdr: true`, half-float throughout)

1. `halationExtract` at ¼ resolution: luminance threshold, red-orange tint. Then Babylon's
   `BlurPostProcess` X and Y at ¼ resolution. **High tier only.**
2. **`grade`**, full resolution. Reads the scene through `setTextureFromPostProcess` (the
   extract's input) and the blur as `halationSampler`. In order: exposure → AgX → white
   point → Purkinje → split-tone → lift → vignette → halation → sRGB encode.
3. `DefaultRenderingPipeline`: chromatic aberration and FXAA only. Image processing, bloom,
   grain, sharpen and depth of field stay off.
4. **`finish`**, full resolution: overlap → luminance grain → triangular dither → 8-bit.

Passes created before the pipeline run before it and those created after run after it,
which is what fixes this order; FXAA and aberration must precede grain and dither, and the
dither must be last.

On medium, step 1 is absent and the grade pass binds a 1×1 black texture as
`halationSampler` with `halationStrength = 0`, so one shader serves both tiers.

### 5.2 The grade pass, term by term

- **Exposure**: `exposureUnder(weather, altitude)`, unchanged, now a uniform multiply.
- **AgX**: the three.js implementation (MIT): inset matrix, log2 encode over its documented
  range, the contrast sigmoid approximation, outset matrix. Its matrices and range are TS
  constants mirrored in the GLSL and lockstep-tested.
- **White point**: a 3×3 Bradford chromatic-adaptation matrix computed in TS per frame by
  lerping keyed illuminants over the sun's altitude, warm at dawn and dusk, neutral (the
  identity) at noon, cool at night, through the same `twilightT` bands `sky.ts` defines.
- **Purkinje**: a per-pixel blend toward a rod-response matrix keyed to pixel luminance
  (below a low threshold the blend rises), constants taken from Patry's Samurai Cinema
  talk. Night goes blue-grey without a tint; the warm headlamp is above the threshold and
  keeps its colour.
- **Split-tone**: the rich-eerie grade re-expressed analytically: three tints (violet,
  green-teal, cyan) applied through luma-banded weights (shadows, midtones, highlights),
  each with a density and a saturation, all scaled by `moodUnder(weather)` so `clear` is
  the exact identity. Hues and starting densities are today's constants; the browser gate
  retunes them, since Babylon's curve operator is not being matched numerically.
- **Lift**: `rgb = lift + rgb·(1 − lift)`, `lift = 0` in every preset today.
- **Vignette**: today's weight and colour, in-pass; the dread share is lens-side.
- **Halation**: `screen(rgb, halation · tint · strength)` where strength is small by day
  and climbs with `dreadLens`.
- **sRGB encode**, so the pipeline's FXAA sees display-referred values.

`GradeRecord`: `exposure`, `whitePoint[9]`, `purkinje[9]`, `purkinjeThreshold`, three
`(hue, density, saturation)` triples, `lift`, `vignetteWeight`, `vignetteColour`,
`halationStrength`, `aberrationAmount`.

### 5.3 The finish pass

- **Overlap**: an echo of the current frame sampled at a mirrored (about the vertical centre
  line), slightly scaled (~1.06) UV with a slow 0.05 Hz breathing drift on the offset and
  no rotation; de-lit and desaturated; screen-blended through a radial mask that is zero
  inside the central ~55% of the frame and rises toward the corners. Gain
  `= OVERLAP_MAX · dreadLens · unsettle`. The base image is never displaced and the horizon
  never moves.
- **Grain**: animated hash noise weighted by luminance, strongest in mid-shadows and zero in
  clipped whites, gain `= GRAIN_BASE · (1 + GRAIN_DREAD_GAIN · dreadLens) · unsettle`.
- **Dither**: triangular-PDF noise of ±½ LSB added after the sRGB encode, always on, never
  scaled.

`FinishRecord`: `overlapGain`, `overlapPhase`, `grainGain`, `time`.

### 5.4 The low tier

No passes. `lighting.ts` maps the `GradeRecord` onto `imageProcessingConfiguration`:
`toneMappingType = TONEMAPPING_KHR_PBR_NEUTRAL`, `exposure`, the three split-tone triples
onto `ColorCurves` exactly as today, `vignetteWeight` and colour, `ditheringEnabled = true`.
No white point, Purkinje, halation, grain or overlap.

## 6. The dread channels

`weather.dread` stays continuous in [0, 1]. Two derived values feed everything:

- **`dreadWorld = stepped(dread)`**: four plateaus at 0, ⅓, ⅔ and 1 with a narrow smoothstep
  edge on each. Read by the world-side terms: the gradient's pull toward `DREAD_AIR`, the
  exposure dip, the height-fog reference rise, the motes' density and drift, and a new
  **ambient collapse** term that scales the hemispheric fill and the probe's contribution
  down at the top plateau. The plateau positions and edge widths are constants in
  `weather.ts`; sub-project D decides when the axis moves and inherits the steps.
- **`dreadLens = dread`**: continuous. Read by the lens-side terms: grain, aberration, the
  dread share of the vignette, halation strength and the overlap.

**`/unsettle <0–100>`**: a persisted view command in the `/bob` mould, default 100, bare
reports the current value. It scales exactly the lens-side gains. Fog, light and colour
are never scaled by it, so a player at 0 still sees the world change in steps.

## 7. Airborne matter

One `ParticleSystem` (CPU-simulated, one draw call) with a box emitter ~20 m across that
follows the camera; capacity 1500 on high, 600 on medium, not created on low. The sprite is
a generated soft disc `RawTexture`. Additive blending at low alpha: motes over a dark
forest floor are invisible, over lit air they shine, which is the "glow in light, vanish in
shadow" read without shadow-map lookups in the particle shader.

- **Colour**: set per frame to the gradient's near-end inscatter (sun-tinted, cloud-faded).
  Distance fog on the particles stays Babylon's single-colour fog.
- **Species by the sun's altitude** through `twilightT`: pollen by day (small, slow,
  drifting up and across), midges at dusk (tiny, jittery, short-lived), frost or ash at
  night (larger, slow fall). Two species overlap at a band edge; the crossfade is emit
  rate, not a swap.
- **Wind**: drift from a pure `windAt(t)` built on the ω constants exported from
  `windPlugin.ts`, so motes and grass ride the same wave.
- **Weather**: emit rate × `(1 − rain)` × `(1 + MOTE_DREAD_GAIN · dreadWorld)`; drift speed
  × `(1 − 0.5 · dreadWorld)`.

`MotesRecord`: per-species emit rate, size range, lifetime, velocity, and the colour.

## 8. Fallbacks and migration

- `post.ts` keeps the `fxSupported` guard (float or half-float render targets). Without it,
  every tier takes the low path.
- If the fog regex stops matching, Babylon's own fog silently stays; the anchor test is the
  guard.
- Everything is renderer-only: the level id and invite links do not move. A persisted
  `style=` entry in an old URL is dropped silently rather than reported as unknown.

## 9. Tests

All headless, under Vitest:

- **Pure params**: `clear` remains the exact identity across every new term at every hour
  (the existing sweep extends to the new records); `stepped()` hits its four plateaus and is
  monotonic; the white-point matrix is the identity at noon; the AgX TS reference is
  monotonic and bracketed; `/unsettle` scales only the lens gains; species rates sum
  sensibly and rain zeroes them; the gradient's far end equals the sky's horizon colour.
- **Lockstep**: every numeric literal in a `.fx` file mirrors a TS constant: AgX matrices
  and range, the split-tone, the plateaus, the dither amplitude, the overlap mask.
- **Shader hygiene**: one test globs `client/src/game/shaders/*.fx` and enforces the two
  comment rules (no hashed directive spelled in a comment, no trailing comment after code),
  replacing the per-file checks.
- **Anchor**: the fog regex matches the installed `fogFragment` include text.
- **Architecture**: the new `*Params.ts` modules are on `BABYLON_FREE_FILES`; `createRenderer`
  still constructs under `NullEngine`; `commands.test.ts` covers `/unsettle` and the
  silent drop of `style`.

## 10. Browser gates

Per the repository's visual-gate practice: a green suite is not evidence on visual work.

- The four hero frames at one fixed pose each, a control screenshot from `main` beside the
  restyle, judged by the owner.
- A 0→1 dread fade at hour 17, watched for the three steps landing as distinct changes.
- The night frame inspected for banding in the fog and the sky.
- `/unsettle 0`: the world still steps; the lens is clean.
- The low tier forced on: the in-material path renders and `clear` is unchanged.
- Paired frame-time samples, both orders, on high, against the ~2 ms post budget; motes
  and halation toggled in the same session to attribute their share.

Write-up at `docs/rendering/YYYY-MM-DD-atmosphere-restyle-verification.md`, dated the day
the gates run; images archived outside the repository.

## 11. Follow-ups this design creates

- The Hollow's rendering (fog exemption, rim, inner glow under the headlamp) and the
  retroreflective tape, in sub-projects C and F, as plugin terms on the hooks above.
- A delayed echo for the overlap (history buffer), if the spatial echo is judged too static.
- The `lift` term and a colder cast, if the Alan Wake 2 look is wanted later.
- A SOMA-style peripheral aberration spike tied to the Hollow's proximity.
- Depth of field at dusk and a headlamp volume cone, both deliberately out of this design.
