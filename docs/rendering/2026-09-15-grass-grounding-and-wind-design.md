# Grass grounding and one wind: design

**Status:** design, ruled 2026-09-15. Implementation plan to follow.

**What this is.** The first pass on the owner's complaint that the grass and the trails read as
flat and game-like. The research is in
[2026-09-15-grass-and-trail-realism](2026-09-15-grass-and-trail-realism.md); this document
records the decisions and the design, not the evidence. Its diagnosis is that the flat read is a
grounding failure, not a triangle-count one, so this pass changes what a card *is* (grounded,
tinted, rounded, backlit) and what moves it (one wind field the whole world reads) without
changing its geometry. The trail bench and opaque blade clumps are follow-ups.

Every value below is a starting point. The browser gates tune them; the tests pin the shapes.

## 1. Rulings

| Question | Ruling |
| --- | --- |
| Scope | Packages A (ground the cards) and B (one wind) from the research, plus removing the pulsing "eerie air" audio bed. Package C (the trail as a bench) and D (blade clumps) are follow-ups. |
| The pulsing hum | The two detuned sines are removed outright. Under mist the wind bed sits lower and slower instead, so eerie stays distinct from clear without a tone. |
| Trees | The near LOD rings sway from the same field at a tree amplitude, gated on the paired deep-forest frame time. Shadow casters stay static. |
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
- Frame time within the 60 Hz contract on the four gate viewpoints, branch beside main.
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

## 7. Consumers

- **Clutter.** `clutterMeshes.ts` attaches `attachFoliage` with the class profile in place of
  `attachWind`, and `attachFoliageLight` beside it; the rebuild writes `foliage` per instance for
  every bucket whose profile tints — which is every bucket that declares the attribute, the rule
  a test in `forestMeshes.test.ts` holds across both shells.
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

If the deep-forest gate misses 60 Hz with the branch and holds it with tree sway disabled, the
fallback ladder is: trees on LOD0 only (the `attachFoliage` on LOD1 skipped), then trees off; the
cards keep everything. If the open-meadow gate regresses, the suspects in order are the
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
  only light 0 is modified.
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

## 10. Browser gates

Branch beside main on two ports, both builds seeded with the same world, paired samples in both
orders, warm-up before every sample, the vsync cap checked, hardware scaling 0.5 for the frame
pairs. Success is the owner's read of the paired frames and clips plus no regression on any pair.

1. **Open meadow, noon, clear and rain.** Still frames for grounding (tint, root darkening,
   no black cards, backlight with the sun low behind the grass at 17 h as a bonus frame) and a
   10 s clip at `/wind 100` for motion: the front must visibly travel downwind and the tufts
   must lean.
2. **Forest edge, 14 h.** Grass, understory, bushes and the near crowns moving together under
   one gust; the shadow cascades unaffected.
3. **The trail at eerie 20 h, lamp on.** Eerie still reads with the air bed gone (the wind bed
   lower and slower); the lamp lights swaying grass without artefacts; the per-instance tint
   does not fight the dread grade.
4. **Deep forest, 12 h.** The tree-sway frame gate. Fallback ladder per §8.

Also: the audio checked by ear at clear, mist and eerie with the clip playing, and a `/wind 0`
frame to confirm everything stands still and the sound is a steady low bed.

## 11. Follow-ups this design creates

- Package C, the trail as a bench (renderer-only; litter class would move the level id).
- Package D, opaque blade clumps for the near band with MSAA on the scene pass.
- Trampling memory (a camera-following flatten map).
- The sound-dread lever, issue #15.
- Moving shadow casters via a `ShadowDepthWrapper`, if the static-caster mismatch is ever seen.
