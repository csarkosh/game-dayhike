# Grass grounding and one wind: design

**Status:** design, decided 2026-09-15.

**What this is.** The first pass on the complaint that the grass and the trails read as
flat and game-like. The research is in
[2026-09-15-grass-and-trail-realism](2026-09-15-grass-and-trail-realism.md); this document
records the decisions and the design, not the evidence. Its diagnosis is that the flat read is a
grounding failure, not a triangle-count one, so this pass changes what a card *is* (grounded,
tinted, rounded, backlit) and what moves it (one wind field the whole world reads) without
changing its geometry. The trail bench and opaque blade clumps are follow-ups.

Every value below is a starting point. The browser checks tune them; the tests pin the shapes.

## 1. Decisions

| Question | Decision |
| --- | --- |
| Scope | Packages A (ground the cards) and B (one wind) from the research, plus removing the pulsing "eerie air" audio bed. Package C (the trail as a bench) and D (blade clumps) are follow-ups. |
| The pulsing hum | The two detuned sines are removed outright. Under mist the wind bed sits lower and slower instead, so eerie stays distinct from clear without a tone. |
| Trees | The near LOD rings sway from the same field at a tree amplitude, conditional on the paired deep-forest frame time. Shadow casters stay static. |
| Dread | Wind follows the weather only. Dread's pull on the wind and its sound is issue #15. |
| Architecture | One foliage plugin (vertex and fragment) fed by a Babylon-free `windParams.ts`, one new per-instance attribute written in the existing clutter rebuild, and a small second plugin for translucency on the `skin.ts` idiom. No custom shader material. |
| Wind on clear | A light breeze. `clear` was never the wind's identity: today everything moves at one strength regardless of weather. |
| Direction | Steady per preset with a slow drift, one full turn in 20 minutes. |
| Interaction | A bend around up to five players, no trampling memory. |
| Level id | Unchanged. Nothing here touches `sim/`. |

## 2. Goals and non-goals

**Goals.**

- Grass, meadow carpet, flowers and bushes belong to the ground: tinted to it at the base,
  darker at the root, varied by clump, lit as one rounded mass, glowing when the sun is behind.
- One wind. A gust is one event that crosses grass, shrubs, understory, crowns, motes, mist and
  rain together and swells the wind sound as it passes. The field leans permanently and the
  oscillation rides on the lean, so it reads as pressure, not vibration.
- Frame time within the 60 Hz contract on the four viewpoints of §10, branch beside main.
- Nothing seeded, nothing in `sim/`, no level-id change, no new `discard`.

**Non-goals.** Blade geometry, the trail edge, trampling memory, wind under dread, moving shadow
casters, WebGPU.

## 3. Architecture

```
weather + clock ──► windParams.ts (pure) ──► WindRecord
                                              ├─► FoliagePlugin uniforms (grass, meadow, flower, bush, understory, tree LOD0/LOD1)
                                              ├─► motesParams.ts  (drift)
                                              ├─► mistMeshes.ts   (bank drift)
                                              ├─► rain.ts         (slant)
                                              └─► ambientAudio.ts (wind bed cutoff and gain)
clutter rebuild ──► per-instance `foliage` vec4 (ground tint rgb, shade) ──► FoliagePlugin attribute
```

The record is computed once per frame in `renderer.ts` and handed to every consumer; nothing
evaluates wall time on its own except the plugin's wrapped `windTime`, which the record also
carries. The GLSL and the TypeScript evaluate the same closed form and a lockstep test says so.

Files:

| File | Role |
| --- | --- |
| `client/src/game/windParams.ts` (new, replaces `windField.ts`) | Babylon-free: constants, `WindRecord`, `windRecordUnder(weather, seconds, override)`, `gustAt(record, x, z)`, `directionAt(seconds, preset)`. On `BABYLON_FREE_FILES`. |
| `client/src/game/foliagePlugin.ts` (new, replaces `windPlugin.ts`) | The plugin class, `attachFoliage(material, profile, meshHeight)`, per-frame `setWind(record)`. |
| `client/src/game/shaders/foliage.vertex.fx`, `foliage.fragment.fx` (new) | The GLSL, in `.fx` so the hygiene test covers it. |
| `client/src/game/foliageLightPlugin.ts` + `shaders/foliageDiffuse.fragment.fx` (new) | Translucency on the sun's diffuse line. |
| `client/src/game/clutterMeshes.ts` | Writes the `foliage` attribute in the rebuild; attaches both plugins. |
| `client/src/game/forestMeshes.ts` | Attaches the foliage plugin to LOD0/LOD1 tree meshes and the understory. |
| `client/src/game/motesParams.ts`, `mistMeshes.ts`, `rain.ts`, `ambientAudio.ts`, `weather.ts` | Read the record; the air bed and its gain go. |
| `client/src/game/commands.ts`, `renderer.ts` | `/wind`, the per-frame record, `setWind`. |
| `ARCHITECTURE.md` | The Rendering paragraph gains one sentence on the wind field. |

## 4. The wind record

```ts
export type WindRecord = {
  dirX: number; dirZ: number;   // unit XZ
  speed: number;                // 0–1
  lean: number;                 // tip lean as a fraction of mesh height
  gustAmp: number;              // gust amplitude as a fraction of mesh height
  flutterAmp: number;           // flutter amplitude as a fraction of mesh height
  time: number;                 // seconds, wrapped at WIND_TIME_WRAP
};
```

**Speed** is a function of the weather params, so preset interpolation stays continuous:
`speed = clamp01(WIND_BASE + WIND_CLOUD·cloudCover + WIND_RAIN·rain)` with `WIND_BASE = 0.25`,
`WIND_CLOUD = 0.35`, `WIND_RAIN = 0.3`. That gives clear 0.25, overcast 0.53, mist 0.57, rain 0.9,
eerie 0.69. A `/wind` override replaces `speed` and nothing else.

**Lean, gust and flutter amplitudes** scale with speed: `lean = WIND_LEAN_MAX·speed` with
`WIND_LEAN_MAX = 0.35`; `gustAmp = WIND_GUST_MAX·speed` with `WIND_GUST_MAX = 0.25`;
`flutterAmp = WIND_FLUTTER_MAX·speed` with `WIND_FLUTTER_MAX = 0.04`. All are fractions of the
mesh height at the tip; the plugin multiplies by `h²·meshHeight` so bases stay planted. A 0.4 m
tuft under rain therefore leans 12.6 cm and gusts a further ±9 cm; on clear it leans 3.5 cm.

**Direction** is `WIND_DIR_BASE + seconds · 2π / WIND_DIR_PERIOD` with `WIND_DIR_PERIOD = 1200`
and `WIND_DIR_BASE = 0.6 rad` (roughly from the sea toward the hills on the default world). The
drift is slow enough that the phase slide it induces at the 110 m disc edge (about 0.6 m/s)
stays under the gust's own 1.5 m/s wave speed.

**Gust** is two octaves whose phase is world position projected onto the direction, plus time,
plus a hash-based ragged offset:

```
u        = dirX·x + dirZ·z
ci, cj   = floor(x / 6), floor(z / 6)                              // 6 m cells
ragged   = WIND_RAGGED · (fract(ci · 0.618034 + cj · 0.381966) − 0.5)   // ±0.6 rad
gust     = sin(K1·u − Ω1·t + ragged) + 0.5 · sin(K2·u − Ω2·t + 1.7·ragged)
```

The ragged term is a golden-ratio lattice hash rather than the usual `sin`-based one because the
GLSL and the TypeScript must agree to 1e-3 for the lockstep test, and `sin`-hash results differ
across GPUs; multiply-add-fract on cell indices is IEEE-exact enough at any cell the camera can
reach.

with `Ω1 = 0.3769911184` and `Ω2 = 0.879645943` rad/s kept from today (n = 18 and 42 of
2π/300), `K1 = 2π/25` and `K2 = 2π/9` rad/m, so the primary front travels at 1.5 m/s in 25 m
waves. `flutter = sin(2.1·x + 1.7·z + Ω3·t)` keeps today's `Ω3 = 12.5663706144` (n = 600). Every
temporal frequency stays an exact multiple of 2π/`WIND_TIME_WRAP` (300 s); a test asserts it for
every exported Ω.

`gustAt(record, x, z)` is the TypeScript evaluation the motes, mist, rain and audio use; the
GLSL is the same expression with `windTime` for `t`.

## 5. The foliage plugin

`FoliagePlugin` replaces `WindPlugin`: name `"Foliage"`, priority 200, define `FOLIAGE`, one
instance per material, attach idempotent by plugin name (LOD buckets share materials). The
`attachFoliage(material, profile, meshHeight)` profile is a small record per class:

| Profile | amp | groundTint | rootAO | tilt | bend | Used by |
| --- | --- | --- | --- | --- | --- | --- |
| `GRASS` | 1.0 | 0.6 | 0.45 | yes | yes | grass tufts |
| `MEADOW` | 1.0 | 0.7 | 0.5 | yes | yes | carpet |
| `FLOWER` | 0.83 | 0.4 | 0.5 | yes | yes | flowers |
| `BUSH` | 0.5 | 0.3 | 0.6 | no | yes | bushes |
| `UNDERSTORY` | 0.67 | 0.4 | 0.55 | no | yes | ferns, shrubs |
| `TREE` | 0.33 | 0 | 1 | no | no | tree LOD0/LOD1 |

`amp` is a unitless multiplier on the record's fractions, in the ratios of today's per-class
tip amplitudes (grass 0.06 m = 1.0); `groundTint` is the tint weight at the root and, when
greater than zero, turns on the `FOLIAGE_TINT` define that declares the attribute; `rootAO` is
the albedo factor at the root; the two flags gate the camera tilt and the player bend.

**Uniforms** (UBO members on the UBO path, plain uniforms on the other; no samplers):
`windDir` (vec2), `windLean`, `windGust`, `windFlutter`, `windTime` (floats), `windPlayers[5]`
(vec3 array via `arraySize`; unused slots at `(0, −1e6, 0)`), `windEye` (vec3, the camera), and
the per-material `foliageAmp`, `foliageHeight`, `foliageTint`, `foliageRootAO`, `foliageFlags`
(vec2 of 0/1) and `foliageEdges` (vec2: the start and end distance of the bucket's outer fade,
`(1e8, 2e8)` when it has none). The record is pushed once per frame through a module-level
`setWind(record)` the way `skin.ts` keeps module-level state; `bindForSubMesh` copies it.
`foliageEdges` is set by the shell from `clutterFadeEdges` on far card buckets and from
`SEAM_LOD1` on tree LOD1 buckets, so the plugin never reads another plugin's attribute.

**Attribute.** `attribute vec4 foliage;` declared under `FOLIAGE_TINT` and `THIN_INSTANCES`
only (the `distanceFadePlugin` precedent: a non-instanced clone must compile without it, and a
tree bucket has no buffer to bind), pushed through `getAttributes` under the same condition.
`foliage.rgb` is the ground colour at the instance, `foliage.a` the canopy shade. Written in
`clutterMeshes.ts`'s rebuild next to `fadeBands` for every class with a tinting profile:
`surfaceAlbedo(seed, x, z, groundH, slope, canopy)` with slope from the instance's
`groundDx/Dz` and canopy from `forestDensity(seed, x, z)`, and `shade = 1 − 0.5·forestDensity`.
The buffer grows with the matrix buffer (16 floats ↔ 4 floats) exactly as `bands` does. Without
tint data the tint weight is zero (a guard on the attribute's magnitude), so no mix happens.

**Vertex stage**, injected at `CUSTOM_VERTEX_UPDATE_WORLDPOS` after the instance matrix, in
this order (`h = clamp(positionUpdated.y / foliageHeight, 0, 1)`, `h2 = h·h`,
`origin = finalWorld[3].xz`, `dir = vec3(windDir.x, 0, windDir.y)`):

1. **Clump hash**: `clump = hash2(floor(origin / 1.5))`, a 1.5 m lattice so neighbours share it.
   Passed to the fragment as a varying.
2. **Motion weight**: `m = foliageAmp · h2 · foliageHeight · scale · (1 − smoothstep(foliageEdges.x,
   foliageEdges.y, dist))` with `dist = distance(origin, windEye.xz)`, so motion scales to zero
   across the bucket's outer fade (the tree LOD1 seam, the card disc edge) and nothing pops
   against a rigid neighbour. `scale = length(finalWorld[1].xyz)` is the instance's own uniform
   scale: `foliageHeight` is the MODEL bounding height and the displacement is added in world
   space, so without it the lean would be a fraction of model rather than drawn height.
3. **Lean**: `worldPos.xyz += dir · windLean · m`.
4. **Gust**: `worldPos.xyz += dir · windGust · m · gust(origin, windTime + 0.6·(clump − 0.5))`,
   evaluated at the **origin** so a tuft moves as one.
5. **Flutter**: `worldPos.xz += windFlutter · m · flutter(worldPos.xz, windTime) ·
   vec2(0.75, −0.35)`, evaluated at the **vertex**.
6. **Camera tilt** (flag): `worldPos.xz += FOLIAGE_TILT · h2 · normalize((origin − windEye.xz))`
   with `FOLIAGE_TILT = 0.04` m, so a card leans slightly away from the viewer and never presents
   a pure edge.
7. **Player bend** (flag): for each of the five slots, `d = origin − player.xz`,
   `w = (1 − clamp(length(d) / FOLIAGE_BEND_R, 0, 1))²`, `worldPos.xz += normalize(d) ·
   FOLIAGE_BEND · h2 · w` with `FOLIAGE_BEND_R = 0.6` m and `FOLIAGE_BEND = 0.25` m.
8. **Sink** (tinting profiles only): `worldPos.y −= FOLIAGE_SINK · foliageHeight ·
   smoothstep(foliageEdges.x, foliageEdges.y, dist)` with `FOLIAGE_SINK = 0.5`, so far grass
   settles into the ground across the same band the dither dissolves it in. Near buckets have
   the no-op edges and never sink.

Nothing runs at `CUSTOM_VERTEX_UPDATE_POSITION` (before the instance matrix). The varyings are
`vFoliage` (the attribute, or `vec4(0, 0, 0, 1)` without `FOLIAGE_TINT`), `vFoliageH` (`h`),
`vFoliageClump` and `vFoliageDist` (`dist`).

**Fragment stage**, injected at `CUSTOM_FRAGMENT_BEFORE_LIGHTS` (after the albedo and normal
are established, before any light; `surfaceAlbedo` and `normalW` are in scope, the
`trailPaint.ts` precedent):

1. **Root darkening**: `surfaceAlbedo *= mix(foliageRootAO, 1.0, vFoliageH)`.
2. **Ground tint**: `w = foliageTint · (1 − vFoliageH)² · (1 + 0.5 · smoothstep(20, 80,
   vFoliageDist)) · has`, where `has = step(1/255, max(vFoliage.rgb))` so a draw carrying no tint
   data cannot mix toward black; `surfaceAlbedo = mix(surfaceAlbedo, vFoliage.rgb, clamp(w, 0, 0.85))`.
   Stronger at the root, more at distance (the pigment-map rule) so the far field dissolves into
   the ground colour and the card-to-texture horizon hides itself.
3. **Shade**: `surfaceAlbedo *= vFoliage.a`.
4. **Clump variation**: `surfaceAlbedo *= 1.0 + FOLIAGE_CLUMP_LUMA · (vFoliageClump − 0.5)` with
   `FOLIAGE_CLUMP_LUMA = 0.16`.
5. **Normal**: `normalW = normalize(mix(vec3(0, 1, 0), normalW, vFoliageH))`, then
   `normalW = faceforward(normalW, −viewDirectionW, normalW)` so the field lights as a rounded
   mass from the ground up and a card never lights as its back. Trees use `mix` weight
   `mix(0.6, 1.0, vFoliageH)` instead, so trunks keep their own normal.

No `discard`, no sampler, no new define beyond `FOLIAGE`. `vAlbedoColor` is never read (it is
the material constant); every tint multiplies or mixes `surfaceAlbedo`.

## 6. Translucency

`FoliageLightPlugin`, name `"FoliageLight"`, priority 210, attached to the same card materials
(not trees). It replaces every light's diffuse line by the `skin.ts` regex idiom, with the light
index captured as a second group
(`!info\.diffuse=computeDiffuseLighting\(preInfo,(diffuse(\d+|\{X\})\.rgb)\);`, anchor-tested
against the installed include) with `foliageDiffuseLighting(preInfo, $1, float($2), vFoliageH)`
from `shaders/foliageDiffuse.fragment.fx`. At compile time `$2` is the light's digit; the
function returns Babylon's stock result for every index but 0, the sun, which is the first light
`lighting.ts` creates (the anchor test pins that order). The headlamps therefore keep Babylon's
own diffuse.

```
wrap      = FOLIAGE_WRAP (0.35): diffuse = max(0, (NdotL + wrap) / (1 + wrap)) / (1 + wrap)   // energy-conserving
back      = pow(clamp(dot(viewDirectionW, −L), 0, 1), FOLIAGE_BACK_POWER (4.0))
thickness = 1 − 0.7·h                                                                            // thicker at the root
diffuse  += FOLIAGE_BACK (0.6) · back · thickness · lightColour
```

About six ALU per fragment for one light.

Amended 2026-10-13: the sun is not the first light in the game. The local
headlamp is made before it (`renderer.ts`: `createHeadlamp`, then
`createLighting`), so light 0 is the headlamp and the sun is light 1, and the
cards took the wrap and the backlight from the headlamp while the sun reached
them through Babylon's own diffuse. The call no longer carries the index. The
replacement is `foliageDiffuseLighting(preInfo, $1, vFoliageH, viewDirectionW)`
under `#if defined(FOLIAGE) && defined(DIRLIGHT$2)`, with Babylon's own line
as the other branch: the plugin's key runs after the light include is unrolled
and before the preprocessor resolves each light's type, so `DIRLIGHT$2`
compiles the call into the directional light's line and no other. The sun is
the scene's only directional light, so the cards take the wrap and the
backlight from the sun whatever order the lights were made in, and every
other light, the headlamps included, keeps Babylon's own diffuse.

## 7. Consumers

- **Clutter.** `clutterMeshes.ts` attaches `attachFoliage` with the class profile in place of
  `attachWind`, and `attachFoliageLight` beside it; the rebuild writes `foliage` per instance for
  every bucket whose profile tints — which is every bucket that declares the attribute. The rule
  is asserted for the forest shell's buckets in `forestMeshes.test.ts`, and the clutter shell's
  buckets are covered by `clutterMeshes.test.ts`'s `foliage` buffer test.
- **Trees.** `forestMeshes.ts` attaches the `TREE` profile to every LOD0 and LOD1 mesh of the
  giants and saplings with `meshHeight` from the baked bounding box (the understory precedent);
  LOD2, the snag and the impostor quads stay rigid. LOD1 buckets get `foliageEdges = SEAM_LOD1`
  (76–85 m) so the motion weight reaches zero where the rigid LOD2 takes over. The understory
  bucket takes the `UNDERSTORY` profile, which tints, so its rebuild writes the `foliage`
  attribute too, from the same palette and density the clutter shell samples.
  Shadow casters are not wrapped: the depth pass draws the unswayed mesh, which at a 2 % tip lean
  is under a shadow-map texel at the cascade distances involved.
- **Motes.** `motesParams.windAt(t)` becomes `windAt(record)` = `dir · WIND_DRIFT · (0.4 +
  0.6·speed) · (0.5 + 0.5·gustAt(record, 0, 0))`; the species and rise logic is untouched.
- **Mist.** `mistMeshes.update` offsets every bank by `dir · drift`, where `drift` accumulates
  `MIST_DRIFT · speed · Δt` (with `MIST_DRIFT = 0.25` m/s, and `Δt` clamped to a second so a
  suspended tab resumes rather than lurches), wrapped within the bank's own cell so the seeded
  field never changes; the banks read as slowly rolling downwind. Integrated rather than scaled
  off the absolute clock, which would rescale the whole history on a change of speed.
- **Rain.** `rain.ts` sets `direction1/2 = (dir · RAIN_SLANT · speed ± spread, −RAIN_FALL_SPEED,
  …)` with `RAIN_SLANT = 3` m/s, so rain slants downwind instead of falling on a fixed spread.
- **Audio.** In `ambientAudio.ts` the two air oscillators and `airGain` are removed, and the wind
  bed's LFO oscillator is removed too: `setWind(record)` (called from the renderer at 10 Hz) drives
  `windFilter.frequency.setTargetAtTime(cutoff, t, 0.15)` with `cutoff = 400 · (1 − 0.5·mist) +
  250 · gustAt(record, listener)`, and the wind gain becomes `WIND_LEVEL · (0.35 + 0.65·speed) ·
  (1 − 0.3·mist)`. `ambientGainsUnder` drops `air`; `rain` is unchanged. Clear therefore has a
  quiet, steady wind bed; mist a lower, slower one; the swell arrives with the gust the player sees.
- **`/wind`.** A view command like `/unsettle`: bare `/wind` restores the weather-driven speed,
  `/wind <0–100>` overrides it. Renderer-only, never scripted into a world.

## 8. Tiers and fallbacks

The plugin runs on all three tiers: it is vertex work plus a few fragment ALU, and the low tier's
material colour path is unaffected because the tint is applied to `surfaceAlbedo` before image
processing. Translucency is on all tiers for the same reason.

If the deep-forest check misses 60 Hz with the branch and holds it with tree sway disabled, the
fallback ladder is: trees on LOD0 only (the `attachFoliage` on LOD1 skipped), then trees off; the
cards keep everything. If the open-meadow check regresses, the suspects in order are the
five-player loop (drop to the local player) and the translucency plugin (off on medium and low).

The plugin is GLSL-only and silently dropped on WebGPU, as every plugin in the repo is.

## 9. Tests

- `windParams.test.ts`: every Ω is an exact multiple of 2π/300; `speed` per preset matches the
  table in §4; the override replaces speed only; `directionAt` is unit length and drifts one turn
  in 1200 s; `gustAt` is bounded in [−1.5, 1.5] and its primary front moves 1.5 m/s along the
  direction (sample two points 15 m apart downwind, 10 s apart, same phase).
- `foliagePlugin.test.ts`: the GLSL gust and flutter in lockstep with `gustAt` (extract the
  expression the way `gradeShader.test.ts` pins AgX); the plugin compiles on both shader paths
  under NullEngine with `_webGLVersion` forced to 2 (the `atmosphere.test.ts` trick); `foliage`
  is declared under `FOLIAGE_TINT` and `THIN_INSTANCES` only, so a tree profile and a
  non-instanced clone both compile without it; `attachFoliage` is idempotent; the `windPlayers`
  array binds five slots; the motion weight is zero past `foliageEdges.y`.
- `foliageLightPlugin.test.ts`: the regex anchor matches the installed `lightFragment` include;
  the wrap term is energy-conserving (integrates to ≤ Lambert over the hemisphere on a grid);
  only light 0 is modified (amended 2026-10-13: only the directional light's line takes the
  call, shown in the game's light order, headlamp first, both on the include unrolled per light
  and on a material compiled through Babylon's WebGPU processing).
- `clutterMeshes.test.ts`: the `foliage` buffer is written for a known cell with the colour
  `surfaceAlbedo` returns there and a shade of `1 − 0.5·forestDensity`; its capacity tracks the
  matrix buffer; far buckets get `foliageEdges` from `clutterFadeEdges` and near buckets the
  no-op pair.
- `forestMeshes.test.ts`: LOD0 and LOD1 tree materials carry the plugin, LOD2 and impostors do
  not.
- `ambientAudio.test.ts`: the graph creates no oscillators (was three); `setWind` moves the
  wind cutoff and gain; `ambientGainsUnder` has no `air`.
- `motesParams`, `mist`, `rain` tests: drift, offset and slant follow a record and are zero at
  speed 0 (`/wind 0`).
- `commands.test.ts`: `/wind` parses bare and 0–100, rejects the rest.
- `architecture.test.ts`: `windParams.ts` on `BABYLON_FREE_FILES`; `windField.ts` and
  `windPlugin.ts` gone.
- `shaderHygiene.test.ts` covers the four new `.fx` files by its glob.

## 10. Browser checks

Branch beside main on two ports, both builds seeded with the same world, paired samples in both
orders, warm-up before every sample, the vsync cap checked, hardware scaling 0.5 for the frame
pairs. Success is the paired frames and clips reading right by eye, plus no regression on any pair.

1. **Open meadow, noon, clear and rain.** Still frames for grounding (tint, root darkening,
   no black cards, backlight with the sun low behind the grass at 17 h as a bonus frame) and a
   10 s clip at `/wind 100` for motion: the front must visibly travel downwind and the tufts
   must lean.
2. **Forest edge, 14 h.** Grass, understory, bushes and the near crowns moving together under
   one gust; the shadow cascades unaffected.
3. **The trail at eerie 20 h, lamp on.** Eerie still reads with the air bed gone (the wind bed
   lower and slower); the lamp lights swaying grass without artefacts; the per-instance tint
   does not fight the dread grade.
4. **Deep forest, 12 h.** The tree-sway frame check. Fallback ladder per §8.

Also: the audio checked by ear at clear, mist and eerie with the clip playing, and a `/wind 0`
frame to confirm everything stands still and the sound is a steady low bed.

## 11. Follow-ups this design creates

- Package C, the trail as a bench (renderer-only; litter class would move the level id).
- Package D, opaque blade clumps for the near band with MSAA on the scene pass.
- Trampling memory (a camera-following flatten map).
- The sound-dread lever, issue #15.
- Moving shadow casters via a `ShadowDepthWrapper`, if the static-caster mismatch is ever seen.

## 12. Amendment (2026-10-14): the canopy on the sky and on the sun, the root eased, the wrap a lift

The ground cover read too dark under the canopy, its shadows hard and heavy:
on the README stills at the game's opening conditions the forest's fern slope
read a mean of 38 (sRGB, 0–255), the trailhead's tufts 61 and 68 against the
trail at 98. Four things stacked on a card, all on the sun's light and the
sky's alike: the wrap (§6) at three quarters of Lambert on a card facing the
sun, the root darkening, the canopy shade on the albedo (§5, the fragment
stage's third item), and for the blade clumps the cast shadow as well. Three of
them change; the cast shadow does not.

**The wrap is a lift.** `foliageWrapLambert` is now `clamp((N·L + wrap) /
(1 + wrap), 0, 1)`: exactly Lambert at N·L = 1, 0.26 at N·L = 0 with
`FOLIAGE_WRAP` 0.35, zero below −0.35. The lift stands in for the light that
comes through a thin leaf; a card facing the sun is lit as Lambert would light
it. §6's "energy-conserving" form, `/ (1 + wrap)²`, gave such a card 0.76 of
the sun. `FOLIAGE_WRAP`, `FOLIAGE_BACK` and `FOLIAGE_BACK_POWER` are unchanged.

**The fourth float is the openness.** `foliage.a` carries `1 − forestDensity`,
the share of the sky open above the instance (1 in the open, and the generic
value of a draw that writes no foliage data, which so takes no cut), not the
shade `1 − 0.5·forestDensity`. The four writers (`clutterMeshes.ts`
`writeFoliage`, `bladeMeshes.ts`, `duffMeshes.ts`, `forestMeshes.ts` for the
understory) write it; nothing else about the attribute changes.

**The canopy's cut is two terms, each its own constant, and none on the
albedo.** The fragment stage's third item (`surfaceAlbedo *= vFoliage.a`) is
gone. In its place:

- The sky's: `FOLIAGE_CANOPY_SKY` 0.4, the share of the sky's light the canopy
  takes from a card under full density, in a third injection point,
  `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`
  (`shaders/foliageSky.fragment.fx`), where the probe's diffuse
  (`finalIrradiance`) and its reflection (`finalRadianceScaled`) are made and
  not yet summed: both × `1 − 0.4·(1 − foliage.a)`. The trees' bark takes 0.65
  of the sky and their crowns 0.4 (`forestLookParams.ts`); the ground under a
  canopy sees the sky through the trunks' gaps, less than a crown does, so a
  little under the crown's cut. The hemispheric fill is untouched.
- The sun's: `FOLIAGE_CANOPY_SUN` 0.4, the share of the sun's light the canopy
  takes, under full density, from a card that receives no cast shadow, in the
  sun's own diffuse (§6's `foliageDiffuseLighting`): the wrapped term and the
  backlight × `1 − foliageCanopySun·(1 − foliage.a)`. It stands in for the
  shadow the trees would cast: a shadowed receiver keeps 0.45 of the sun under
  the "bright" weather, and a card is taller than the floor and catches the
  gaps, so it keeps 0.6. `foliageCanopySun` is a new float in the plugin's
  uniform buffer, decided where `attachFoliage` is called
  (`{ sunShadowed: true }`): 0 for a material whose meshes receive cast
  shadows, which cut the sun already (the blade clumps, the duff and the
  reeds, all `receiveShadows = true`), the constant for the clutter cards and the
  understory, which receive none. The understory's materials are not among
  the trees' (`shadeTreeMaterial` runs on the LOD ladder alone), so they take
  the sky at full share and the canopy cuts them once, per instance.

**The root darkening eased.** `rootAO` rises by 0.15 on every ground-cover
profile: GRASS 0.6, MEADOW 0.65, FLOWER 0.65, BUSH 0.75, UNDERSTORY 0.7,
BLADES 0.65, REEDS 0.75, DUFF 0.75; TREE stays 1 (§5's table and the
blade-clumps and blade-field docs' tables carry the old values).

The far ground's canopy shade follows by the same arithmetic
(`2026-10-10-far-ground-cover-design.md`, §14). The target the change was
made for: ferns about 55–60, open tufts about 90–95, the trail unchanged at
98, to be read on the stills; the weather is as it was, the light comes from
the shading.

## 13. Amendment (2026-10-14): the cards at one albedo

With §12 the cards are lit alike: the sun's share scales them exactly as it
scales the trail, and the cast shadows and the sky barely move them. They
still read dark against the ground, and unevenly, because each card's colour
is its texture's own and the textures' exposures are unrelated. Measured on
the shipped models' base colour textures, over the texels the alpha mask
keeps (alpha ≥ 0.5), the mean linear luminance (Y = 0.2126 R + 0.7152 G +
0.0722 B):

| model | material | linear Y |
| --- | --- | --- |
| `clutter.grass_a` | the main tuft | 0.0942 |
| `clutter.meadow` | the same texture | 0.0942 |
| `clutter.grass_b` | the pale tuft | 0.2909 |
| `clutter.flower_a` | | 0.1796 |
| `clutter.flower_b` | | 0.1840 |
| `clutter.bush_a`, `clutter.bush_b` | the same texture | 0.1543 |
| `understory.fern` | | 0.0901 |

The floor's own grass colour (`terrainSurface.ts` `GRASS`, (0.09, 0.15,
0.06)) has Y 0.131: the main tuft and the fern stood at 0.7 of the floor they
stand on and the pale tuft at 2.2 times it, which is why one tuft in three
glowed and the rest sank, however they were lit. The ground textures follow
one rule for this already (the terrain divides each by its own mean,
`terrainTexture.ts` `LAYER_MEAN_RGB`, and multiplies it over the palette);
the cards had none.

**One rule, the ground textures'.** Every card material is brought to one
target luminance by a gain on its albedo. `coverAlbedoParams.ts`
(Babylon-free) holds the table above by catalog id (`COVER_ALBEDO_Y`), the
target `COVER_ALBEDO_TARGET` 0.18, and `coverAlbedoGain(id)` =
clamp(0.18 / Y, 0.4, 2.0), 1 for a model not in the table. The target is a
little over the floor's grass: a sunlit clump of blades is brighter than the
turf's mean, because the eye sees its lit and backlit faces, not the shaded
ground under them; and a little over the pale flowers' own. The gains: the
main tuft and the meadow 1.911, the pale tuft 0.619, the flowers 1.002 and
0.978, the bushes 1.167, the fern 1.998. Neither end of the clamp is
reached; a texture that reached one would be a texture to replace, not to
push through the factor. The values are measurements and stay as literals;
a model whose texture changes is measured again the same way (its base
colour texture as shipped, the texels at alpha ≥ 0.5, linear Y averaged) and
its row replaced.

**Where it is applied.** `clutterMeshes.ts` multiplies the gain into the
`albedoColor` of each card model's material as the models land, once per
material (a GLB's two LOD groups share one, and the LOD copies and the cut
copies made after share it by reference), on the classes that wear the
foliage profile alone: grass, meadow, flower, bush and the sword fern. Rock,
boulder, driftwood and fungus are not cards and take none, nor does the
litter, which draws the rock and driftwood models; the classes built in code
(shrub, wet plant, high plant) have no texture to measure and stay white
under their own vertex colours. `forestMeshes.ts` gives the nurse log's fern
the same gain, under its `NURSE_SHADE`, on the plain material it makes for
it: that copy takes the texture and sets its own colour, so the gain goes in
there. The shipped materials are white, so the product is the gain itself.
`albedoColor` is a uniform: the shader text is unchanged and no define moves.

The target the change was made for, on the stills at the game's opening
conditions: the main tuft, the fern and the pale tuft at one brightness
against the ground, the open tufts and the ferns of §12's targets reached
by the albedo rather than by the light.

### 13.1. As built, 2026-10-14: the cover in the main tuft's own green, its blacks lifted

The gain above brought every card to one luminance and left two things on the
stills. Black strokes through the near grass at the trailhead and in the
meadow, and black blades and card interiors under the ferns in the old wood:
not the shadows' darkness alone but three things of the cover's own. Blades
edge-on to the sun, which §12's wrap left at a quarter of the light; the
blade clumps' own colour, `BLADE_ALBEDO` (0.03, 0.04, 0.013), at the blades'
tips, where the ground tint has faded out (its weight is (1 − h)²); and the
card textures' own dark interiors, which a gain scales but never lifts. And
the ferns, at the cards' luminance, read brighter and more saturated than the
grass and stood out: the tuft's texture is a yellow green where the fern's is
a blue one, and one luminance does not make them one colour. The main tuft's
dreary olive is the one to keep, and every ground plant is matched to it.

**One green.** `COVER_GREEN` (`coverAlbedoParams.ts`) is the main tuft's own
colour, its texture's mean (`clutter.grass_a`, (0.1001, 0.0989, 0.0297), Y
0.0942, the table below), at 0.85 of its luminance: (0.0851, 0.0841, 0.0252)
linear, Y 0.0801. `COVER_ALBEDO_TARGET`, §13's 0.18, is now that luminance,
0.0801. The tufts and the meadow keep their own colour, a little darker; the
ferns, the bushes and the pale tuft take it. Both are literals, with a test
that recomputes the green from those numbers.

**The blades.** `BLADE_ALBEDO` is the blades' own dark green, (0.03, 0.04,
0.013), under the floor of the albedo below on every channel, so the floor
sets the blades' colour wherever the ground tint does not, and no tip goes to
black. The far sward is fitted to the near field
(`2026-10-10-far-ground-cover-design.md`, §16), never the near field darkened
to meet it.

**Per-channel normalisation for the green cards.** `COVER_ALBEDO_RGB` holds
the measured mean linear colour of each green card's base colour texture
over the texels its alpha mask keeps (alpha ≥ 0.5):

| model | R | G | B |
| --- | --- | --- | --- |
| `clutter.grass_a`, `clutter.meadow` | 0.1001 | 0.0989 | 0.0297 |
| `clutter.grass_b` | 0.3108 | 0.3001 | 0.1415 |
| `clutter.bush_a`, `clutter.bush_b` | 0.1802 | 0.1530 | 0.0899 |
| `understory.fern` | 0.0700 | 0.1035 | 0.0165 |

`coverAlbedoTint(id)` is, for a model in that table, `COVER_GREEN` over its
mean, each channel clamped to [0.3, 3.0] (`COVER_TINT_MIN`, `COVER_TINT_MAX`),
so its mean lands on the green: the main tuft and the meadow (0.850, 0.850,
0.848), the fern (1.216, 0.813, 1.527, its blue under the cap), the bushes
(0.472, 0.550, 0.3, the blue at the clamp's floor, 0.280 unclamped), the pale
tuft (0.3, 0.3, 0.3, every channel at the floor, 0.274, 0.280 and 0.178
unclamped, so its mean lands at (0.0932, 0.0900, 0.0425), Y 0.087, a little
over the green). The clamp is wider than the grey gain's [0.4, 2] because a
texture's blue is small and noisy. **The flowers' exception:** a model with a
luminance row alone (`clutter.flower_a`, `clutter.flower_b`) takes the grey
gain `coverAlbedoGain(id)` on all three channels (0.446, 0.435), so the
petals keep their colour; a model in neither table takes (1, 1, 1). The tint
replaces the gain at both places it was applied, multiplied into
`albedoColor` per channel: `clutterMeshes.ts` on the card models' materials
and `forestMeshes.ts` on the nurse log's fern.

**The blacks lifted: contrast toward the green.** A texture keeps baked
shade in its dark texels, which no gain lifts. The foliage plugin takes a
uniform `foliageContrast` (`attachFoliage`'s `contrast`, 1 unless given, the
texture as it is), bound beside `foliageCanopySun` and, as the first line of
the colour block in `foliageLights.fragment.fx`, before the root darkening
and the tint that shape the root on top of the texture:

```glsl
surfaceAlbedo = mix(FOLIAGE_CARD_GREEN, surfaceAlbedo, foliageContrast);
```

with `FOLIAGE_CARD_GREEN` = (0.0851, 0.0841, 0.0252) declared in
`foliage.fragment.fx` and pinned to `COVER_GREEN` at four decimals by the
lockstep test. The card models' materials pass `FOLIAGE_CARD_CONTRAST` 0.6
(`coverAlbedoParams.ts`): since the tint puts every green card's mean at the
green, the mix compresses each texture's contrast around its own mean, a
black texel to 0.4 of the green and a white one to 0.4 of white over 0.6 of
the green. The flowers take it too; their mean is not the green, so they
shift a little toward it, which is accepted. The blade clumps, the duff, the
reeds and the trees bind 1, as do the clutter classes built in code (shrub,
wet plant, high plant), which have no texture with shade baked in. No
define moves: a material's contrast is a uniform.

**The albedo's floor.** The colour block's last albedo line, after the root
darkening, the tint and the per-clump nudge:

```glsl
surfaceAlbedo = max(surfaceAlbedo, FOLIAGE_ALBEDO_FLOOR);
```

with `FOLIAGE_ALBEDO_FLOOR` = (0.0532, 0.0525, 0.0158), Y 0.050, about five
eighths of the green, declared in `foliage.fragment.fx` beside the green and
pinned to `coverAlbedoParams.ts` at four decimals by the lockstep test. Per
channel, so nothing the foliage plugin draws goes to black: not a blade's
tip, a card's baked-dark texel nor a root the darkening and the tint have
taken down. The block is every foliage material's, the trees' crowns, the
duff and the reeds too; above the floor the albedo is as it was.

**The shadow's floor.** `FOLIAGE_SHADOW_FLOOR` 0.75 (`coverAlbedoParams.ts`),
the least of the sun's light the cover keeps in a cast shadow. The shadow
generator's darkness applies to every receiver, and on the cover the blades'
and the cards' own shade (the root darkening, the baked-dark texels, the
canopy's cut) stacks on top of it, so the cover's shadows went to black where
the floor's keep the weather's darkness. The light plugin
(`foliageLightPlugin.ts`) takes a second injection point,
`FOLIAGE_SHADOW_INJECTION_POINT`, on Babylon's own line that applies a light's
shadow to its diffuse, once per light in the `lightFragment` include, and
writes the line back after the floor:

```glsl
#ifdef FOLIAGE
shadow=max(shadow,0.75);
#endif
diffuseBase+=info.diffuse*shadow;
```

The line carries no light index, so the floor is every light's; only the sun
casts shadows. The lines after it in the include, the specular's among them,
read the held value too. It moves the ground cover that receives cast
shadows, the blade clumps, the duff and the reeds (§12); the cards receive
none. Under `FOLIAGE` for the reason the sun's diffuse call is
(`foliageLightPlugin.ts`): an effect processed without the define keeps
Babylon's line alone.

**The half-Lambert.** `FOLIAGE_WRAP` is 1.0, not §12's 0.35: §12's lift,
`clamp((N·L + wrap) / (1 + wrap), 0, 1)`, at a wrap of 1 is `(N·L + 1) / 2`,
exactly Lambert at N·L = 1, half the light at the terminator (0.26 at 0.35),
and zero only for a face turned fully from the sun. A blade edge-on to the
sun keeps half the light of one facing it and no longer reads as a black
stroke. Below N·L = 1 it exceeds Lambert by more than §12's did: 0.75 against
Lambert's 0.5 at N·L = 0.5, where §12's gave 0.63
(`2026-10-10-far-ground-cover-design.md`, §14, on the far ground's fit).
`foliageDiffuse.fragment.fx` mirrors the constant and the lockstep test
asserts it.

**The nurse fern.** The fern on a nurse log wore a plain material with no
foliage plugin, so the contrast could not reach it; it now wears the plugin
under a profile of its own, `NURSE` (no wind, no tilt or bend, no ground
tint, no root darkening, the card's own normals to the root), with the cards'
contrast and no light plugin, and the plain material's other terms as they
were. The sun's cut is the constant's, as on the floor's cards: the log's
fern receives no cast shadow. Wearing the plugin, the fern also takes the
terms no profile turns off, the normal forced to face the viewer, the
per-clump luminance nudge and the albedo's floor, all benign on a card on a
log; the retired one-a-tree understory path, under its own profile, takes
neither the cards' tint nor their contrast.

What the change was made for, on the stills: no black strokes in the grass,
neither the blades edge-on to the sun nor the blades' own colour at the tips,
no black in the cards' interiors, and the ferns in the main tuft's olive,
not their texture's. The far sward is refitted to these cards
(`2026-10-10-far-ground-cover-design.md`, §16) and the trees' bark toned to
sit with them (`2026-10-14-tree-bark-textures.md`, §11).
