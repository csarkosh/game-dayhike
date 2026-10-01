# Rain System Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rain that is everywhere the player can be, at every height, from the first frame, that stops under cover, lands on the ground, wets the world and touches the lens, with the whole stack's measured cost at most 2.7 ms on high, 1.8 ms on medium and 0.8 ms on low at native pixels on the reference machine (Apple M4, Chrome), the no-rain frame unchanged within the noise floor, and every figure published in the verification note with the hardware named.

**Architecture:** Seven layers in order, each behind a gate: (1) a camera-locked wrapped streak volume (one thin-instanced quad mesh, a static seed buffer, a vertex-stage material plugin) replaces the particle system, with the fog following the rain and the streaks lit by the sky and the headlamp; (2) a `WetPlugin` on every non-terrain PBR material and ring-texture ripples on the trail's puddles; (3) a top-down height map (a 512-texel render target over 96 m, refreshed every 8 m of movement) that fades streaks under cover; (4) splash sprites on the map's height and a drip volume under canopy driven by a canopy-water scalar; (5) a lens post-process; (6) a drip sound layer and a rain-shaped hiss; (7) the WGSL corpus recorded and the measurements published. Nothing under `sim/`, no asset file.

**Tech Stack:** TypeScript, Babylon.js 9.18 (thin instances, `MaterialPluginBase` on `StandardMaterial` and `PBRMaterial`, `RenderTargetTexture` with `setMaterialForRendering`, `ShaderMaterial`, `PostProcess`, `RawTexture`), GLSL in `.fx` files and template strings, vitest 4 with `NullEngine` and Babylon's shader processor, the Web Audio API, the `chrome-devtools` CLI for the gates.

**Spec:** `docs/rendering/2026-10-01-rain-system-design.md`

## Global Constraints

- No file under `client/src/sim/` changes; the level id does not move. No file under `client/assets/` is written.
- Every numeric expectation in a test is a literal, never the constant it pins. vitest 4 takes a test's timeout as the third argument.
- GLSL rules (`client/test/game/shaderHygiene.test.ts`): no comment spelling a preprocessor directive, no semicolon inside a trailing comment on a code line; a new uniform goes on BOTH the `getUniforms().ubo` list and the non-UBO string; samplers are declared in `CUSTOM_*_DEFINITIONS` and listed in `getSamplers()`. Plain GLSL ES 1.00 (`attribute`, `varying`, `texture2D`); a `texture2D` inside a branch on a varying needs `#define DISABLE_UNIFORMITY_ANALYSIS` on WebGPU, prepended as `terrainTexture.ts` and `post.ts` do.
- A new material plugin class goes at the END of `PLUGIN_ORDER` in `client/src/game/pluginNumbers.ts` (after `WaterPlugin`; `WetPlugin` takes its reserved slot), and the literal count in `client/test/game/pluginNumbers.test.ts` is bumped. A new pure module goes on `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`.
- Every new `attachX(material)` guards on `material.pluginManager?.getPlugin(name)`.
- Before every commit: `npm run typecheck`, the touched test files (`cd client && npx vitest run <files>`), and `npx eslint <touched files>` green.
- Stage explicit paths only, never `git add -A` or `git add .`. Never bare `git stash`.
- Commit format: type-prefixed subject under 72 characters, a blank line, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then the repository's two attribution trailer lines (written `<trailers>` below).
- Public repository: no code comment, doc or commit message describes how an asset was made or the process around the work; write for an engineer reading the code.
- Measurement hooks are applied to a worktree for a gate and reverted after it. They are never committed; `git status --porcelain` is clean before any commit.

## File map

| File | Task | Change |
| --- | --- | --- |
| `docs/rendering/2026-10-01-rain-system-verification.md` (new) | 1, 2, 4, 7 | Method, hardware, poses, the control's figures; one section per gate; the final table |
| `client/src/game/rainParams.ts` (new, pure) | 2, 4, 5 | `RAIN_TIERS`, `RAIN_BOX`, `RAIN_CLASSES`, the fades, `rainFold`, `rainDrift`, `rainBoxMin`, `streakLength`, `rainSeeds`; `RAIN_MAP`, `mapCentre`; `SPLASH_TIERS`, `DRIP_TIERS`, `canopyWaterStep` |
| `client/src/game/rainPlugin.ts` (new) | 2, 4, 5 | `RainPlugin` on the streak material: the wrapped position, the stretch, the alpha; `RAIN_OCCLUSION` and `RAIN_DRIP` defines |
| `client/src/game/rain.ts` | 2, 4, 5 | Rewritten: the streak mesh, its material and plugin, the seed buffer, `update`; later the map binding and the drip mesh |
| `client/src/game/weather.ts` | 2 | `FOG_RAIN_GAIN`, the rain term in `fogDensityUnder` and `fogColourUnder`; `RAIN_CAPACITY` removed in favour of `RAIN_TIERS` |
| `client/src/game/renderer.ts` | 2, 3, 4, 5, 6 | The one-line rain call becomes `rain.update(...)` with the lamp and the frame time; `setWet`; the map's render list; the lens gating inputs |
| `client/src/game/wetPlugin.ts` (new) | 3 | `WetPlugin`, `attachWet(material, cap)`, `setWetLevel` |
| `client/src/game/forestMeshes.ts`, `clutterMeshes.ts`, `cliffMeshes.ts`, `duffMeshes.ts`, `propMeshes.ts` | 3, 4 | `attachWet` with each material's cap; the map's render list registration |
| `client/src/game/terrainTexture.ts`, `trailPaint.ts` | 3 | `terrainRain` uniform, `rippleSampler`, the four ripple layers in the puddle normal |
| `client/src/game/rainMap.ts` (new) | 4 | The render target, its camera, the height shader material, `register(mesh, kind)`, `update(playerPos)` |
| `client/src/game/rainSplash.ts` (new) | 5 | The splash mesh, its material and the vertex-stage placement |
| `client/src/game/post.ts`, `postParams.ts`, `shaders/lens.fragment.fx` (new), `client/src/game/lensParams.ts` (new, pure) | 6 | The `lens` pass, `lensDropletMap()`, `lensStrengthUnder` |
| `client/src/game/ambientAudio.ts` | 7 | The hiss's band centre and wind cut; the drip layer |
| `client/shaders/corpus/` | 8 | The recorded stages |
| `ARCHITECTURE.md` | 8 | One paragraph in the Rendering section |
| Tests: `rainParams.test.ts` (new), `rainPlugin.test.ts` (new), `rain.test.ts`, `weather.test.ts`, `wetPlugin.test.ts` (new), `terrainTexture.test.ts`, `rainMap.test.ts` (new), `rainSplash.test.ts` (new), `postParams.test.ts`, `lensParams.test.ts` (new), `post.test.ts`, `ambientAudio.test.ts`, `pluginNumbers.test.ts`, `architecture.test.ts` | 2 to 7 | As each task says |

---

### Task 1: The control, measured

No game code. The verification note is created with the method, the hardware and the control's figures: the particle rain's cost today at the three poses on high and medium, native and 4×, WebGL2 and WebGPU.

**Files:**
- Create: `docs/rendering/2026-10-01-rain-system-verification.md`

- [ ] **Step 1: Builds and hooks.** A control worktree detached at `b43952d` with the gate hooks applied and its own port; the branch tip (the same commit until Task 2 lands) is not needed for this task.
- [ ] **Step 2: The renderer string.** Read `engine.getGlInfo().renderer` (WebGL2) and the adapter info (WebGPU) from a page and write them into §1.
- [ ] **Step 3: The control's rain.** At each pose, `weather rain` and `weather clear` by the pair method of design §8, high and medium, native and 4×, WebGL2; high on WebGPU. Table in §3 with mean and p95 per cell, the deltas, and the draw calls.
- [ ] **Step 4: Commit.**

```
docs: pin the particle rain's cost before the rain system

## What

The verification note for the rain system: the method, the reference
machine, the three poses and what the particle rain costs today on it,
tier by tier and engine by engine, so every gate that follows has its
control.

## How

- `docs/rendering/2026-10-01-rain-system-verification.md` — §1 Method,
  §2 Poses, §3 Control.

<trailers>
```

---

### Task 2: The air and the far field

Design §2 and §3. The streak volume replaces the particle system; the fog follows the rain; the streaks fade toward the sky and brighten in the headlamp.

**Files:**
- Create: `client/src/game/rainParams.ts`, `client/src/game/rainPlugin.ts`, `client/test/game/rainParams.test.ts`, `client/test/game/rainPlugin.test.ts`
- Modify: `client/src/game/rain.ts`, `client/test/game/rain.test.ts`, `client/src/game/weather.ts`, `client/test/game/weather.test.ts`, `client/src/game/renderer.ts`, `client/src/game/pluginNumbers.ts`, `client/test/game/pluginNumbers.test.ts`, `client/test/architecture.test.ts`, any test that imports `RAIN_CAPACITY`

**Interfaces:**
- `rainParams.ts` (pure, Babylon-free): `RAIN_TIERS: Record<QualityTier, number>` = 3000 / 10000 / 24000; `RAIN_BOX = { x: 24, y: 20, z: 24, forward: 6, down: 2 }`; `RAIN_FOLD_S = 40`; `RAIN_CLASSES` = four `{ speed, width, alpha }` rows at speeds 4.5, 6, 7.5, 9, widths 0.012 to 0.03, alphas 0.35 to 0.6; `RAIN_STRETCH = 1.5`, `RAIN_LENGTH = [0.08, 0.5]`, `RAIN_FADE_NEAR = [0.6, 1.5]`, `RAIN_FADE_FAR = [9, 12]`, `RAIN_SKY_FADE = 0.6`, `RAIN_MILK = { gain: 1.15, lift: 0.05 }`, `RAIN_SLANT` (moved from `rain.ts`); `rainSeeds(count, seed): Float32Array` (xyz in [0,1) and the class as k in {0, 1/3, 2/3, 1}, deterministic from a hash); `rainBoxMin(cam, yaw)`; `rainDrift(prev, wind, dt)` (the horizontal fold, each component in [0,1)); `rainFold(seconds)` (modulo `RAIN_FOLD_S`); `streakLength(speed, dt)`; `smoothedDt(prev, dt)` (ten-frame smoothing, clamped to [1/120, 1/30]). Tests pin: the fold's exactness (every class speed × 40 / 20 is an integer), seeds in range and deterministic, the drift fold, the length clamp, and that a drop's `fract` position is unchanged by a camera move (the field stands still in the world).
- `rainPlugin.ts`: `class RainPlugin extends MaterialPluginBase` named `"RainPlugin"`, defines `{ RAIN: false, RAIN_DRIP: false, RAIN_OCCLUSION: false }` (the last two unused until Tasks 4 and 5), attribute `rainSeed` (vec4), uniforms `rainBoxMin` (vec3), `rainBoxSize` (vec3), `rainDrift` (vec2), `rainFold` (float), `rainDt` (float), `rainWind` (vec2), `rainCam` (vec3), `rainLampPos` (vec3), `rainLampDir` (vec3), `rainLamp` (vec2: intensity, cos half-angle), `rainTint` (vec3), `rainSpeeds` (vec4), `rainWidths` (vec4), `rainAlphas` (vec4). Vertex: `CUSTOM_VERTEX_DEFINITIONS` and `CUSTOM_VERTEX_UPDATE_POSITION` compute the wrapped drop, the corner and the varying `vRainAlpha` (design §2.1 to §2.3); the mesh's world matrix is identity and the thin-instance matrices are identity, so the computed position is the world position. Fragment: `CUSTOM_FRAGMENT_DEFINITIONS` (the varying), `CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR` multiplies `color.a` by `vRainAlpha`. If the standard material's shader does not expose a hook with `color` in scope there, use the hook that does and say which in the plugin's comment. Setters take plain numbers; `bindForSubMesh` writes the uniform buffer. `rainPlugin.test.ts` runs the vertex and fragment through Babylon's processor as `distanceFadePlugin.test.ts` does and asserts the hooks' code is present and compiles.
- `rain.ts`: `createRain(scene, tier): Rain` with `Rain = { update(camPos, yaw, weather, wind, dt, lamp: { x, y, z, dx, dy, dz, intensity, angle }): void; dispose(): void; mesh: Mesh }`. One `Mesh` ("rain_streaks", a unit plane with uv), `StandardMaterial` ("mat_rain": `disableLighting`, `emissiveColor` white, `diffuseTexture` the existing streak map with `hasAlpha`, `useAlphaFromDiffuseTexture`, alpha blend, `backFaceCulling = false`, `disableDepthWrite = true`, `fogEnabled = true`), `RainPlugin` attached; `thinInstanceSetBuffer("matrix", identities, 16, true)` and `thinInstanceSetBuffer("rainSeed", rainSeeds(...), 4, true)`; `alwaysSelectAsActiveMesh`, `doNotSyncBoundingInfo`, `isPickable = false`, `receiveShadows = false`. `update` folds the time, steps the drift, smooths dt, binds everything, sets the tint from `scene.fogColor` by `RAIN_MILK`, and enables the mesh only when `weather.rain > 0` (count `round(rain × RAIN_TIERS[tier])` through `thinInstanceCount`). `rain.test.ts` under `NullEngine`: the mesh exists with the tier's instance count, is disabled at `clear` and enabled at `rain`, the count scales with the rain value, the plugin is attached once, and `dispose` disposes the mesh and the material.
- `weather.ts`: `FOG_RAIN_GAIN = 0.5`; `fogDensityUnder` multiplies by `1 + FOG_RAIN_GAIN × clamp01(rain)`; `fogColourUnder` mixes toward the colour's luminance by `0.3 × rain`; `rainEmitRateUnder` and `RAIN_CAPACITY` removed. `weather.test.ts`: the `clear` identity still holds exactly; at the rain preset the density is 1.5× what mist alone gives, as a literal.
- `renderer.ts`: `rain.update(camera.position, yaw, weather, wind, engine.getDeltaTime() / 1000, lamp)` at both call sites, the lamp from `localLamp` (`getAbsolutePosition()`, its direction, `intensity`, `angle`); `partOf(rain)` and the dispose list unchanged.

- [ ] **Step 1: `rainParams.ts` and its tests.**
- [ ] **Step 2: `rainPlugin.ts` and its processor test.** Append `"RainPlugin"` to `PLUGIN_ORDER`; bump the plugin count literal.
- [ ] **Step 3: `rain.ts` rewritten; `rain.test.ts` rewritten.** Remove the particle imports. Keep `rainStreakMap` and its constants.
- [ ] **Step 4: Fog.** `weather.ts` and its tests; grep for `RAIN_CAPACITY` and `rainEmitRateUnder` across `client/` and fix every use.
- [ ] **Step 5: Wire the renderer.** Typecheck, lint, the touched tests, then the whole client suite once.
- [ ] **Step 6: Look.** `npm run dev:client` in the worktree, `/dayhike/game/<uuid>?cmd=seed%20atmo;weather%20rain;time%2012&tier=high` (and `time 22` with the lamp), walk and sprint along the trail: no leading edge, no catch-up, rain on the first frame, streaks slanting with the wind, fainter against the sky, bright in the lamp at night, fogged at distance. Fix what reads wrong before committing.
- [ ] **Step 7: Commit.**

```
feat: rain as a camera-locked wrapped streak volume

## What

The rain is no longer a particle emitter falling from a plane above
the camera; it is a fixed population of streaks in a box locked to the
camera, each placed in the vertex stage by a fold of its seed, so the
box is full at every height on every frame and a sprinting player
never outruns it. Four fall-speed classes slant by the wind, the
streak's length is the frame's motion blur, the alpha fades toward the
sky and brightens in the headlamp, and the fog follows the rain.

## How

- `client/src/game/rainParams.ts` — the tiers, the box, the classes, the
  folds and the seeds, pure.
- `client/src/game/rainPlugin.ts` — the vertex-stage placement and the
  alpha on the streak material.
- `client/src/game/rain.ts` — the thin-instanced mesh, its material and
  the per-frame uniforms.
- `client/src/game/weather.ts` — `FOG_RAIN_GAIN` and the fog colour's
  pull toward grey under rain.
- `client/src/game/renderer.ts` — the lamp and the frame time handed to
  the rain.
- `client/src/game/pluginNumbers.ts` — `RainPlugin` appended.
- Tests for each.

<trailers>
```

**Gate 1** (the controller, after review): design §8 at the three poses, high and medium, native and 4×, WebGL2 and WebGPU on high: the stack's cost (streaks on minus streaks off), the no-rain frame against the control, the sprint still. Bars: streaks + fog at most 1.0 ms on high, 0.5 ms on medium at native; no-rain within the noise floor.

---

### Task 3: Wet materials and ripples

Design §6.

**Files:**
- Create: `client/src/game/wetPlugin.ts`, `client/test/game/wetPlugin.test.ts`
- Modify: `client/src/game/forestMeshes.ts`, `clutterMeshes.ts`, `cliffMeshes.ts`, `duffMeshes.ts`, `propMeshes.ts`, `renderer.ts`, `terrainTexture.ts`, `trailPaint.ts`, `rainParams.ts` (the ripple map), `client/test/game/terrainTexture.test.ts`, `client/test/game/rainParams.test.ts`

**Interfaces:**
- `wetPlugin.ts`: `class WetPlugin extends MaterialPluginBase` named `"WetPlugin"`, define `{ WET: false }`, uniforms `wetLevel` (float) and `wetCap` (float). Fragment `CUSTOM_FRAGMENT_BEFORE_LIGHTS`: porosity from the material's roughness as in design §6.1, `surfaceAlbedo *= mix(1.0, factor, wetLevel)`; the roughness scale on the reflectivity call, by the same regex key `terrainTexture.ts` uses, guarded so a material carrying both plugins does not double-apply (the terrain never gets `WetPlugin`). `attachWet(material, cap)` guarded; `setWetLevel(w)` writes module state read in `bindForSubMesh`, as `setFoliageWind` does. Caps: bark, deadwood, duff, props 1.0; rock and cliffs 0.5; canopy, understory, grass and meadow cards 0.3.
- `rainParams.ts`: `RIPPLE_SIZE = 256`, `RIPPLE_LAYERS` = the four `{ timeMul, timeAdd, scale, offset }` rows, `rippleRingMap(): Uint8Array` (design §6.2), tested for size and channel ranges.
- `terrainTexture.ts`: `setRain(rain)`, UBO `terrainRain`, sampler `rippleSampler` bound to a `RawTexture` built from `rippleRingMap` (RGBA, repeat wrap, trilinear). `trailPaint.ts`: the four-layer normal offset summed into `tBenchN` scaled by `tPuddle × terrainRain` before the final `normalW` mix; one layer per quarter of `terrainRain`.
- `renderer.ts`: `setWetLevel(weather.wetness)` and `setTerrainRain(...)` beside `setTerrainWetness`.

- [ ] **Step 1: `WetPlugin` and its processor test; attach it in each mesh module with its cap.**
- [ ] **Step 2: The ripple map and the trail paint's layers; the terrain tests.**
- [ ] **Step 3: Look** at the trail under `weather rain` at noon and at 16:00: bark and props darker and glossier than under `mist`, leaves glazed, puddles rippling; under `clear` nothing changed.
- [ ] **Step 4: Commit.**

```
feat: wet materials by porosity, and rippled puddles

## What

Every tree, bush, rock, cliff and prop darkens and glosses with the
weather's wetness by Lagarde's porosity rule, with a cap per material
so leaves glaze where bark soaks; the trail's puddles carry four layers
of ring ripples scaled by the rain.

## How

- `client/src/game/wetPlugin.ts` — the rule and the per-material cap.
- `client/src/game/forestMeshes.ts`, `clutterMeshes.ts`, `cliffMeshes.ts`,
  `duffMeshes.ts`, `propMeshes.ts` — attached with their caps.
- `client/src/game/rainParams.ts` — the ring texture, generated.
- `client/src/game/terrainTexture.ts`, `trailPaint.ts` — the rain uniform,
  the sampler and the layers in the puddle normal.
- Tests for each.

<trailers>
```

---

### Task 4: The height map and occlusion

Design §4.

**Files:**
- Create: `client/src/game/rainMap.ts`, `client/test/game/rainMap.test.ts`
- Modify: `client/src/game/rainParams.ts`, `rainPlugin.ts`, `rain.ts`, `renderer.ts`, the mesh modules whose meshes join the list, `client/test/game/rainParams.test.ts`

**Interfaces:**
- `rainParams.ts`: `RAIN_MAP = { texels: 512, extent: 96, height: 100, step: 8, canopyBlock: 0.65, canopyLift: 10 }`; `mapCentre(prev, player)` returns the previous centre unless the player is more than `step` from it, then the player's position (tested).
- `rainMap.ts`: `createRainMap(scene, tier): RainMap | null` (null on low), `RainMap = { texture: RenderTargetTexture; register(mesh, kind: "terrain" | "hard" | "water"): void; unregister(mesh): void; update(player): boolean (true on a refresh); dispose(): void }`. One `ShaderMaterial` per kind ("rain_height_terrain" reads the `terrainWeights2` attribute's w for the transmission; "rain_height_hard" writes 0; "rain_height_water" writes 1 and no lift), declaring `world0..3` so thin instances draw, set on each registered mesh through `texture.setMaterialForRendering`. The target is `refreshRate = RENDER_ONCE` and is re-armed by `update` when the centre moves. The orthographic camera is the texture's `activeCamera`, not the scene's. Tested under `NullEngine`: null on low, the centre's step rule drives a refresh, register and unregister maintain the render list.
- `rainPlugin.ts`: under `RAIN_OCCLUSION`, uniforms `rainMapCentre` (vec2), `rainMapExtent` (float) and a sampler `rainMapSampler`; the vertex stage fetches the map at the drop's xz (`texture2DLod`), and multiplies the alpha by `G` where `drop.y < R + B`.
- `renderer.ts`: the map created after the terrain exists, the clipmap rings, the prop meshes, the near cliff buckets and the water registered, `rainMap.update(local.pos)` before `rain.update`, and the map handed to `rain` (`rain.setMap(map)`).

- [ ] **Step 1: The pure parts and the map module with its tests.**
- [ ] **Step 2: The plugin's occlusion path; the registration in the renderer and the mesh modules.**
- [ ] **Step 3: Look:** stand under the kiosk roof and beside the car at the trailhead: no streaks under either; walk into the deep forest: the rain thins to about a third; the lake under rain still rains.
- [ ] **Step 4: Commit.**

```
feat: a top-down height map keeps rain out from under cover

## What

A render target looks straight down on 96 m around the player,
refreshed when they have moved 8 m, and stores each texel's top height,
its transmission (open ground 1, canopy by the terrain's density, props
and cliffs 0) and a ceiling lift; the streaks read it and fade under
cover, so it does not rain under the trailhead's roof and the deep
forest gets a third of the open sky's rain.

## How

- `client/src/game/rainMap.ts` — the target, its camera, the height
  materials and the render list.
- `client/src/game/rainPlugin.ts` — the occlusion fetch.
- `client/src/game/rain.ts`, `renderer.ts` and the mesh modules — the map
  bound and the meshes registered.
- Tests for each.

<trailers>
```

**Gate 2** (the controller): the map's amortised cost and the cost of a refresh frame at the canopy pose while walking; the stack so far against the bars.

---

### Task 5: Splashes and drip

Design §5.

**Files:**
- Create: `client/src/game/rainSplash.ts`, `client/test/game/rainSplash.test.ts`
- Modify: `client/src/game/rainParams.ts`, `rainPlugin.ts`, `rain.ts`, `renderer.ts`, the tests

**Interfaces:**
- `rainParams.ts`: `SPLASH_TIERS` = 0 / 600 / 1200, `SPLASH = { radius: 10, life: 0.12, size: [0.06, 0.1] }`; `DRIP_TIERS` = 0 / 600 / 1000, `DRIP = { speed: 6, width: 0.04, length: 0.12 }`; `canopyWaterStep(prev, rain, dt)` (rise at `rain / 60` per second toward 1, fall at `1 / 600` when rain is 0), tested at the literal rates.
- `rainSplash.ts`: `createRainSplash(scene, tier, map): RainSplash | null`, a thin-instanced quad mesh with a `StandardMaterial` and a small plugin (or a `ShaderMaterial`, the implementer's call, said in a comment) whose vertex stage places each sprite as design §5 says, reading the map for its height and transmission, and whose fragment draws the ring from the phase. `update(camPos, weather, lamp, sunDir, time)` sets the count to `round(rain × capacity)`.
- `rain.ts`: a second mesh "rain_drips" sharing the material's texture with its own `RainPlugin` carrying `RAIN_DRIP`; `update` steps `canopyWater` and binds it.

- [ ] **Step 1: The pure parts; the splash module and its test.**
- [ ] **Step 2: The drip mesh; the renderer wiring.**
- [ ] **Step 3: Look:** splashes on the trail and the car roof, none under the kiosk; a minute into the rain, drips under the canopy; stop the rain (`weather mist`) and the drips continue.
- [ ] **Step 4: Commit.**

```
feat: splashes on the ground and drips under the canopy

## What

Short-lived crown rings land on the height map's surface around the
player, scaled by the rain, and a sparse volume of large slow drops
falls under the canopy, driven by a canopy-water value that fills a
minute into the rain and keeps dripping for ten minutes after it stops.

## How

- `client/src/game/rainSplash.ts` — the sprite mesh and its placement.
- `client/src/game/rain.ts`, `rainPlugin.ts` — the drip volume.
- `client/src/game/rainParams.ts` — the tiers and the canopy-water step.
- `client/src/game/renderer.ts` — wired.
- Tests for each.

<trailers>
```

---

### Task 6: The lens

Design §7.1 and §7.2.

**Files:**
- Create: `client/src/game/lensParams.ts`, `client/src/game/shaders/lens.fragment.fx`, `client/test/game/lensParams.test.ts`
- Modify: `client/src/game/post.ts`, `postParams.ts`, `renderer.ts`, `client/test/game/post.test.ts`, `client/test/game/postParams.test.ts`, `client/test/architecture.test.ts`

**Interfaces:**
- `lensParams.ts` (pure): `LENS = { size: 128, drops: 40, radius: [0.02, 0.05], tiles: 2, offset: 0.03, columns: 8 }`, `lensDropletMap(seed): Uint8Array` (RG normal, B mask, A trail), `lensStrengthUnder(rain, pitch, canopy)` (design §7.2's target), `lensSmooth(prev, target, dt)` (1 s time constant), tested.
- `postParams.ts`: `PostFeatures.lens: boolean` (true on medium and high with the pipeline); `postFeaturesFor` updated and its tests.
- `post.ts`: the `lens` pass between FXAA and finish, uniforms `lensStrength`, `time`, `aspect`, samplers `lensSampler` (the droplet texture) and, on high, `blurSampler` (the halation blur's output); skipped (`enabled = false`... or the engine's post-process toggle) below 0.02. `update` gains `lensStrength`.
- `renderer.ts`: computes the target from `weather.rain`, the camera's pitch and the forest density at the camera (`forestDensity(seed, x, z)` from `sim/vegetation.ts`, read-only), smooths it, and passes it to `post.update`.

- [ ] **Step 1: The pure parts and their tests.**
- [ ] **Step 2: The pass; the post tests.**
- [ ] **Step 3: Look:** in rain, look up: drops; look ahead: a few; step under the trees: gone within a second; the fog on the glass only on high.
- [ ] **Step 4: Commit.**

```
feat: rain on the lens

## What

A post-process pass refracts the frame through a field of droplets and
a few sliding drops, foggy between them on high, strongest when the
player looks up into the rain and gone within a second under the trees.

## How

- `client/src/game/lensParams.ts` — the droplet texture, generated, and
  the gating.
- `client/src/game/shaders/lens.fragment.fx`, `post.ts`, `postParams.ts` —
  the pass.
- `client/src/game/renderer.ts` — the gating inputs.
- Tests for each.

<trailers>
```

---

### Task 7: The sound

Design §7.3.

**Files:**
- Modify: `client/src/game/ambientAudio.ts`, `client/src/game/weather.ts` (`ambientGainsUnder` gains a `drip` and the hiss centre), `client/src/game/renderer.ts` or `app.ts` (the canopy at the listener and the canopy water), `client/test/game/ambientAudio.test.ts`, `client/test/game/weather.test.ts`

- [ ] **Step 1: The hiss's centre and wind cut; the drip layer with the injectable context; tests.**
- [ ] **Step 2: Listen,** then commit.

```
feat: the rain's hiss follows its weight, and the canopy drips

## What

The rain layer's band centre falls as the rain gets heavier and the
wind dulls it; under the canopy a sparse train of synthesised drips
follows the canopy-water value.

## How

- `client/src/game/ambientAudio.ts` — the band centre, the wind cut, the
  drip layer.
- `client/src/game/weather.ts` — the gains.
- Tests for each.

<trailers>
```

---

### Task 8: The corpus, the measurements and the close

- [ ] **Step 1: Record the corpus on WebGPU** at high and medium, rain on and off, lamp on, night, a party of two, until no new stages appear; `merge-corpus.mjs`; `npm run build`; `node tools/wgsl/check-build.mjs`. Commit the `.glsl` files.
- [ ] **Step 2: The final table** (the controller): design §8's five figures at every pose, tier and engine, whole and per layer, native and 4×, into the verification note §4; the per-tier shape that ships (design §10).
- [ ] **Step 3: Close.** The design's first paragraph rewritten as built; `ARCHITECTURE.md`'s Rendering section gains the rain paragraph; the README's weather sentence if it has one.
- [ ] **Step 4: Commit, whole-branch review, offer for push.**
