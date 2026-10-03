# A scattering sky: design

**Spec, 2026-10-03.** One model of the air's light, used everywhere the sky
shows. A table of the clear sky is computed from how sunlight scatters in
air, by Rayleigh scattering, aerosols and ozone. The dome draws it, and the
image-based light captures it. The sun's colour, the fill, the haze and the
clear colour all read from the same table. A cloud deck sits over it under
cloudy weather. Golden hour, sunset, the blue hour and night follow one
another as the sun sinks.

The choices that shape it:

- **Our own model.** The table is computed in TypeScript on the CPU, so the
  design adds no dependency. Babylon's atmosphere addon was weighed against it
  and set aside. It would add its code to every PBR material, and the corpus
  maps already hold 7.9 of their 10 MiB.
- **Material shaders unchanged.** No PBR material's shader changes. The dome
  is the one new shader.
- **Real twilight.** The sky stays lit down to 18° below the horizon, then
  night begins as it is today.
- **Noon anchored.** Noon keeps today's look, at clear and in mist. Every
  other hour is checked again by eye.

## 1. The sky today

- **The dome.** Babylon's `SkyMaterial`, the Preetham model, is built in
  `client/src/game/lighting.ts`. A `ReflectionProbe` captures it once per
  change of hour or weather into `scene.environmentTexture`. Every PBR
  material reads that capture as its image-based light, the water included.
  The capture is 128² per face, 8-bit and in gamma space.
- **Everything else.** Separate hand-tuned curves in `sky.ts` drive
  `weather.ts`'s functions: `skyColourAt`, `sunColourAt`, `sunIntensityAt`,
  `ambientColourFor`, `fillIntensityFor` and `exposureFor`. Those functions
  set:
  - the fog colour and the clear colour;
  - the far end of the haze gradient and its glow toward the sun;
  - the sun and fill lights.

  The grade adds a white point that is warm, about 4300 K (`WHITE_DUSK`), at
  the horizon, and cool at night (`gradeParams.ts`).

The two skies disagree. Babylon's shader is ported into a scratch script at
clear weather; the table gives its linear values:

| Sun altitude | Dome zenith | Dome horizon toward the sun | Dome horizon away | `skyColourAt` (fog, fill) |
|---|---|---|---|---|
| 76° (noon) | 0.22 0.45 0.66 | 0.49 0.59 0.61 | 0.39 0.49 0.52 | 0.42 0.58 0.82 |
| 45° (15:00) | 0.00 0.04 0.17 | 0.50 0.58 0.58 | 0.19 0.28 0.31 | 0.42 0.58 0.82 |
| 10° | 0.00 0.00 0.01 | 0.86 0.70 0.49 | 0.01 0.01 0.01 | 0.52 0.54 0.62 |
| 0° (18:00, 06:00) | 0.00 0.00 0.00 | 0.43 0.08 0.00 | 0.00 0.00 0.00 | 0.62 0.50 0.42 |

The model's sun term falls to about 4 % of its noon value at the horizon, and
the sky's light goes as its 1.5 power. So the zenith is already dim at a 45°
sun, and black at sunset. Meanwhile the fog, the clear colour and the fill are
lit by a bright tan, `HORIZON_SKY`, and the grade warms the image further.

The result is a black sky over a gold ground. The atmosphere's own checks
first logged this as open on 2026-09-15
([verification](2026-09-15-atmosphere-restyle-verification.md), "Dawn").

Under cloudy weather the dome is a bright white-grey at noon, about 0.9
linear, and it also goes black at sunset.

Every hike crosses dusk. The escalation eases the hour from the start hour
toward 22:00 as the party climbs (`escalation.ts`), so 18:00 lands partway
up the climb. Most hikes cross it under cloud: the default weather is `mist`
(cloud cover 0.9), and the escalation drifts toward `eerie` (cloud cover 1).

## 2. Goals and non-goals

**Goals:**
- One table for the dome, the image-based light, the sun, the fill, the fog
  colour, the haze's glow and the clear colour, so that they cannot disagree.
- Twilight as it happens: the zenith stays blue after sunset, with a red band
  toward the sun, pink and then blue opposite it, and the ground dim and
  cool. Below about −12° the night takes over as it does today.
- A cloud deck under cloudy weather, whose brightness and colour follow the
  same table.
- Noon close to today's look, at clear and in mist.
- Per-frame cost no higher than today.
- Every number tested under Node.

**Non-goals:**
- Clouds as geometry or volumes.
- Stars and a moon (§11).
- Haze per pixel read from the table. That would need a new texture, and the
  terrain's fragment stage already uses all 16 textures WebGPU allows
  (`stageBindings.test.ts`).
- Relighting the far trees' impostors when the hour changes (§6, §11).
- Re-recording the title and intro films. They are a separate step (§6).

## 3. The model

### 3.1 The air

The standard Earth atmosphere of Hillaire (2020), the model Babylon's addon
and Unreal's sky use:

- **The planet.** Ground radius 6,360 km; the air ends at 6,460 km.
- **Rayleigh scattering.** (5.802, 13.558, 33.1) × 10⁻⁶ m⁻¹ at the ground,
  with a scale height of 8 km.
- **Aerosols (Mie).** Scattering 3.996 × 10⁻⁶ m⁻¹ and absorption
  4.40 × 10⁻⁶ m⁻¹, with a scale height of 1.2 km and a phase asymmetry g of
  0.8.
- **Ozone absorption.** (0.650, 1.881, 0.085) × 10⁻⁶ m⁻¹, in a tent profile
  peaking at 25 km and reaching zero 15 km either side. Ozone is what keeps
  the twilight zenith blue rather than grey-yellow.
- **The ground.** Albedo 0.3, for the light it scatters back up.
- **The eye.** Fixed 200 m above the ground. A test checks that the world's
  relief changes the sky by less than its tolerance.

The aerosol scale is a tunable. With it, the brightness of the noon horizon
against the zenith can be matched (§3.6).

### 3.2 The tables

- **Transmittance**, 256 × 64: the fraction of light that crosses the air from
  a height along a direction. It depends only on the air, so it is computed
  once.
- **Multiple scattering**, 32 × 32: Hillaire's isotropic second-order term
  with its geometric series. It is computed once.
- **The sky**, one slice per sun altitude: 64 elevations × 32 azimuths
  measured from the sun's azimuth over 0–180°. The sky is mirror-symmetric
  about the sun's vertical plane, so half the azimuths suffice.
  - The elevation is mapped as v = ½ + ½·sign(e)·√(|e| / 90°), which puts
    half the rows within about 22° of the horizon, where the colour changes.
  - Slices are taken every 0.5° from −18° to +12°, and every 2° from 12° to
    76°, the noon sun's height on the arc: 93 slices.

Built in TypeScript under Node, the two fixed tables take about 80 ms and a
slice about 3 ms: about 0.4 s for the whole set. The values below are from a
first prototype at the default aerosols, before the scale of §3.6:

| Sun | Zenith, × noon | Zenith colour | Horizon toward the sun | Horizon away | Ground's sky light, × noon, colour |
|---|---|---|---|---|---|
| 76° | 1 | 0.25 0.47 1.00 | 0.53 0.79 1.00 | 0.52 0.78 1.00 | 1, 0.22 0.46 1.00 |
| 10° | 0.29 | 0.24 0.46 1.00 | 1.00 0.73 0.40 | 0.88 1.00 0.80 | 0.50 |
| 5° | 0.20 | 0.31 0.51 1.00 | 1.00 0.53 0.18 | 1.00 0.86 0.48 | 0.36 |
| 0° | 0.069 | 0.57 0.56 1.00 | 1.00 0.23 0.05 | 1.00 0.28 0.19 | 0.12, 0.81 0.69 1.00 |
| −3° | about 0.01 | blue | red-orange | blue-grey | about 0.02 |
| −6° | 0.0004 | 0.46 0.33 1.00 | 1.00 0.22 0.07 | 0.51 0.45 1.00 | 0.0008 |
| −12° | 8 × 10⁻⁷ | deep blue | dim | dim | 10⁻⁶ |

Colours are normalised to their largest channel.

### 3.3 The sun

- **The light.** The sun's light is the transmittance at the eye toward it:
  its colour, and its strength relative to noon. It reddens toward the
  horizon: 1.00 0.65 0.32 at 10°, and 1.00 0.10 0.00 at 0°.
- **The disc.** The dome draws the disc analytically, 0.27° in radius, in the
  same colour. The image-based light's capture sees the disc capped at
  today's brightness, so a few texels of HDR sun do not sparkle in rough
  reflections.

### 3.4 Night

From about −12° the table is effectively black.

- **The dome.** It adds today's night colour, `NIGHT_SKY`, as a floor.
- **The fill.** Its moonlight tint, `MOONLIGHT`, and strength, `FILL_NIGHT`,
  stay as today.

So midnight looks as it does today.

### 3.5 Adaptation

The light falls about 40× from noon to sunset, and a further 1,000× by −6°.

- **The factor.** Every light the sky gives (the dome, the sun, the fill's day
  share, and through the dome the image-based light) is multiplied by one
  factor:

  A = (max(Y, Y_floor) / Y_noon)^(γ − 1)

  Y is the clear sky's light on level ground, sun and sky together, and γ is
  below 1. It stands in for the eye adjusting. One common factor keeps the
  colours and ratios the model gives.
- **γ.** Its starting value is 0.5: at that value sunset reads about a
  quarter as bright as noon, and −6° about a fortieth. The final value is
  chosen by eye at the dusk checks (§10).
- **Image exposure.** `exposureFor`'s curve stays as it is: noon 0.9, night
  1.6. The Hollow's eyes are tuned to cross the halation threshold at exactly
  those values (`hollowLook.test.ts`).

### 3.6 The scale

- **K.** One constant converts the table's units to the scene's. It is fixed
  so that the noon zenith at clear has the luminance of today's dome, 0.42.
  A test checks it against the ported shader.
- **The aerosol scale.** It is then tuned so that the noon horizon is no more
  than about twice the zenith. The default aerosols put it at 4.4×; fewer
  aerosols make it brighter still, since the noon zenith, 14° from the sun,
  takes much of its light from their forward scattering. Five times the
  default meets it, an aerosol optical depth of about 0.05, a clear day. The
  noon zenith is then paler, and the zenith at sunset 4 % of noon's.
- **Below the horizon.** The dome reads the table at the horizon for every
  direction below it, as today's dome does. A slice's lower rows hold only
  the air's own glow, 2 % of the zenith at the nadir, which would darken the
  image-based light on every downward face.
- **The sun's light at noon.** `SUN_PEAK` (4) at noon, as today.

## 4. Computing it

- **At load, in a worker.** The worker computes the two fixed tables, then
  the slices in the order the start hour needs them: the two either side of
  it first, then outward. Before the first frame is shown the renderer waits
  for the slices the noon and the start hour need, under 0.1 s. The ocean's
  wind-sea loop already bakes in a worker the same way. The full set takes
  about 0.4 s, off the main thread.
- **On each change of hour or weather**, on the main thread:
  - the renderer blends the two slices either side of the sun's altitude
    linearly, together with their derived values (§6);
  - it applies the cloud deck (§5);
  - it uploads one 64 × 32 RGBA16F texture, 16 KB, for the dome;
  - it sets every consumer from the same state.

  This replaces today's `apply()` body and costs well under 1 ms. The
  escalation pushes nearly every frame at the start of the chase
  (`app.ts`'s throttle is 0.01 h), so it has to be cheap.
- **The probe.** As today, the probe re-renders after each change.
- **Texture format.** RGBA16F can be filtered on WebGL2 and on WebGPU's core
  feature set. The ocean's float atlas uses explicit reads because RGBA32F
  filtering is optional on WebGPU. The dome reads the table at an explicit
  level, under uniform control flow.

## 5. Weather on top

### 5.1 The cloud deck

With cloud cover c, the dome is mix(clear, deck, c).

- **Shape.** The deck follows the CIE overcast law, L(e) = L_z·(1 + 2 sin e)/3,
  brightest at the zenith.
- **Brightness.** L_z is the clear sky's light on level ground, Y, passed
  through the cloud: L_z = τ(c)·Y / (7π / 9). The overcast law gives that
  ratio between zenith luminance and ground illuminance.
- **The anchor.** τ is fixed so that the deck at noon in mist matches today's
  mist dome at noon, about 0.85 linear. At sunset the deck then dims with the
  light rather than holding a fixed grey.
- **Colour.** The clear light's colour, desaturated by `AMBIENT_DESAT`. At
  sunset it is a dim lavender-grey.
- **The sun.** Dimmed by `SUN_CLOUD_LOSS` and desaturated by `SUN_DESAT`, as
  today. The disc fades out with the cloud.

### 5.2 Mist, rain and dread

The fog colour keeps today's steps, in order and with their constants: the
pull toward mist air, cloud desaturation, rain's greying and dread's pull.
It becomes `airColourUnder(weather, base)`, over a base colour it is given.

- **The base.** Its base is the sky's horizon colour (§6) instead of
  `skyColourAt`.
- **The overcast dusk dimming goes.** It existed because `skyColourAt`
  stayed bright under cloud at dusk. The deck now dims the base itself, so
  keeping the step would dim it twice.
- **The dome's horizon.** The dome blends toward that same fog colour near
  the horizon, weighted by mist. Mist is the one part of the air the table
  does not model, so with this blend the dome and the fog meet without a
  band.

### 5.3 What goes

- `SkyMaterial` and `skyMaterialParamsUnder`: turbidity and aerosol haze stood
  in for cloud, and the deck replaces them.
- `@babylonjs/materials`: `SkyMaterial` was its only use.
- `skyColourAt`, `HORIZON_SKY`, `DAY_SKY`, `HORIZON_SUN`, `ZENITH_SUN` and
  `sunIntensityFor`'s hand curve.
- The day half of `ambientColourFor`.
- The warm dusk half of the grade's white point (§6).

`twilightT` stays for the airborne motes, which pick their species by the
sun's height.

## 6. The consumers

| Consumer | Today | With the table |
|---|---|---|
| The dome | `SkyMaterial` | A new material on the skybox that reads the slice texture (§7) |
| Image-based light (every PBR material, the water) | The probe captures `SkyMaterial`, 8-bit and flagged gamma-encoded. On medium and high the dome writes linear values into it, so materials decode the sky to the power 2.2 | The probe captures the new dome half-float and still flagged gamma-encoded, so no material's shader changes. The dome writes the gamma encoding, so materials decode its true linear radiance, and the dusk horizon's brightness above 1 survives. `SKY_IBL_SCALE` (1) is left for the checks by eye |
| The sun light (light 0; the foliage plugin needs it first) | Hand curves | The transmittance's colour and strength, × A |
| The fill light (light 1) | `ambientColourFor`, `fillIntensityFor` | Day share: `FILL_DAY` × the sky's light on level ground (relative to noon) × A, in its colour. Night share: today's moonlight. A night factor n weights the two |
| Fog colour, clear colour, the haze gradient's far end | `fogColourUnder` on `skyColourAt` | `fogColourUnder` on the sky's horizon colour away from the sun |
| The haze's glow (`atmSunColour`, `atmSunDir`, `atmSunPower`, `atmSunWeight`) | The sun's colour, toward the sun, power 8, zero after sunset | The horizon's colour toward the sun, centred on the sun's azimuth at the horizon, with its power fitted to the horizon's fall-off away from the sun. It persists after sunset while the twilight glows |
| Mist banks, motes, rain | Read the fog colours | Unchanged code |
| The grade's white point | Warm toward 4300 K at the horizon, cool at night | The identity through day and twilight; cool by the night factor n |
| Purkinje shift | 0.8 × night by `twilightT` | 0.8 × n |
| The low tier (no post chain) | `SkyMaterial` skips exposure and tone mapping | The dome applies exposure, contrast and Khronos PBR Neutral itself, as Babylon does for the other materials there |

The haze's glow keeps its shader text: every term above is a value the
plugin already binds, and the fit is the work of `atmosphereParams.ts`.

- **The horizon colour** is the slice's ring at 2° elevation, 32 azimuths.
  The base colour is the mean of the ring's half away from the sun. The glow
  is the ring's colour toward the sun. The power is a least-squares fit of
  the ring's luminance between them.
- **The night factor** is n = 1 − (the adapted sky light) / (that light plus
  the moonlight's), clamped to exactly 0 by day.

**Pre-existing, unchanged.**
- **The impostors.** The far trees' billboards are a lit render taken at load
  (`forestMeshes.ts`), so their colour keeps the load hour's light under the
  current one.
- **The films.** The title loop (15:00, overcast) and the intro (noon, mist)
  are recorded videos. They will drift from the live look until they are
  recorded again, a step outside this repository after the checks pass.

## 7. Shaders and the corpus

- **The dome.** One vertex stage and one fragment stage, in GLSL built with
  `forceGLSL` and translated on WebGPU as the sky is today. The fragment
  stage:
  1. turns the view direction into the table's coordinates, with the sun's
     azimuth as zero;
  2. reads the slice, scales by K·A and adds the night floor;
  3. blends in the deck and the mist's horizon;
  4. adds the disc;
  5. on the low tier only, applies exposure and the tone map.

  The capture always writes the gamma encoding of the linear composition,
  never tone-mapped, with the disc capped.
- **The corpus.** The dome's stages are recorded on every tier, and the four
  `SkyMaterial` stages are retired by path.
- **PBR stages.** No PBR stage changes. A test pins
  `atmosphereFog.fragment.fx`'s text, and the terrain's 16 textures and the
  materials' 12 uniform buffers stay where `stageBindings.test.ts` pins them.

## 8. Cost

Costs are measured and reported, not set beforehand:

- **The worker.** Its time at load in Chrome on the M4.
- **Each change.** The main thread's time for a blend and upload, measured
  during an escalation's chase start.
- **Frames.** Frame-time pairs against `main` at 4K, at noon and at 18:00, on
  all three tiers. The dome is one texture read against Preetham's sum, so it
  should be no dearer.
- **The probe.** Its half-float capture, timed in the same pairs.
- **The start-up check.** The tier check renders at noon in mist
  (`probeScene.ts`), so the sky's cost reaches the tier choice. Measure it
  before and after.

## 9. Tests

**The model:**
- Transmittance lies in [0, 1] and rises with the cosine.
- The sun's colour reddens toward the horizon.
- At 0° the zenith is blue (b above r and g), between 3 % and 15 % of noon's
  luminance.
- The horizon toward the sun is red-dominant at 0°.
- Below the horizon the zenith's luminance falls with every 0.5° step.
- At −18° the zenith is below 10⁻⁶ of noon.
- Every value is finite and non-negative. The prototype produced a NaN at
  −18°, from normalising zero.
- 0 m and 1 km eye heights agree within a tolerance.

**The slices and the state:**
- Adjacent hours, 0.01 h apart, never step by more than a tolerance.
- Clear noon gives the anchors: the dome zenith at 0.42 luminance, the sun at
  `SUN_PEAK`, the fill at `FILL_DAY`.
- Midnight gives today's values: the moonlight fill and the `NIGHT_SKY`
  floor.

**Coherence (the property this design exists for):**
- The fog's far colour equals the dome's horizon away from the sun.
- The glow's colour equals the dome's horizon toward the sun.
- The dome shader's coordinate mapping is transcribed in TypeScript and
  agrees with it.

**The deck:**
- At c = 0, the clear sky is unchanged.
- At c = 1, no disc and no glow.
- Its brightness follows Y.
- Noon in mist matches today's mist dome within a tolerance.

**The grade:**
- The white point is the identity at every altitude down to the start of
  night.
- Midnight's matrix is unchanged.
- Purkinje is 0 by day and today's 0.8 at midnight.

**Shaders:**
- The dome compiles on every tier and translates to WGSL with explicit-level
  reads only.
- `atmosphereFog.fragment.fx` is byte-pinned.
- The terrain's sampler list is unchanged.
- The corpus holds the dome's stages.

**Kept, rewritten where they named the old functions:**
- `sky.test.ts`, `weather.test.ts`, `lighting.test.ts`,
  `atmosphereParams.test.ts`, `gradeParams.test.ts`, `dreadNight.test.ts`.
- Every numeric expectation stays a literal.

## 10. Checks by eye

Stills from the trailhead pad and from 18 m up, with the sea in view:

- **Clear:** 12:00, 15:00, 17:00, 17:30, 18:00, 18:15, 18:30, 19:00 and
  22:00, and 06:00.
- **Mist:** 12:00 (the intro's look), 18:00 and 19:00.
- **Overcast:** 15:00 (the title's look).
- **Eerie:** 20:00 (the escalation's end).
- **Rain:** 18:00.

Each beside today's frame at the same pose, and beside photographs of clear
sunset, civil twilight, the blue hour and an overcast dusk, kept outside the
repository. γ, the aerosol scale and τ are chosen at these checks.

## 11. Follow-ups this design creates

- **Stars and a moon.** The night floor is a stand-in for both.
- **The impostors.** Relight their bake when the hour moves far from the one
  they were baked at.
- **Haze per pixel from the table**, if a texture slot frees up on the
  terrain.
- **The films.** Record the title and intro again, so they match the live
  look.
