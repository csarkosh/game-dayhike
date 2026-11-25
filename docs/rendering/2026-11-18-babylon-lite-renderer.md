# The renderer as built on Babylon Lite

## 1. Status

- Day Hike is drawn by Babylon Lite (`@babylonjs/lite`, version 1.39.3 with 52 patches, tag `v1.39.3-dayhike.9` of `csarkosh/babylon-lite`), on WebGPU, with every shader in WGSL. Babylon.js 9.18, which drew the game on WebGL2 and WebGPU, is out of the tree as of this note, 2026-11-18.
- The older build (Babylon.js 9.18) was measured against this one on 2026-11-17 and 2026-11-18; the counts below were taken in headless Chrome on a MacBook Air.
- A browser must offer WebGPU and an adapter that is not the browser's software one and reaches WebGPU's default limits. No optional feature is required (`engine/src/game/loadCheck.ts`). Anyone else sees a page that says why (section 6).

This note answers `2026-11-13-babylon-lite-spike.md`, which measured what Lite would take and buy before anything was built. This one records what was built and what was measured. Where a number was taken, its conditions stand beside it.

**The rig** for every timed number below: an AWS g4dn.xlarge (an NVIDIA T4, four virtual CPUs), Windows, Chrome 154.0.8037.58. Its standard is the frame cap off (`--disable-gpu-vsync --disable-frame-rate-limit`); a table says when the cap was on. Where "older" appears, it is the older build, Babylon.js 9.18.

## 2. What it bought

### Standing, 21 view-tiers

Every view was opened once on each build, both at once, tier set by override, wind held at nothing, frame cap off, in the measurement mode. Both said `engine webgpu`: the older build was asked for its WebGPU engine. Sizes: medium 1470 x 956, high 1512 x 982, low drawn at 980 x 637. Three pairs of 8 s windows, one page drawing while the other was held. This build's frame interval was the lower in 60 of 63 pairs; the three exceptions are each a view's first pair, where the older build's first window read unusually light.

"GPU ms" is the passes' own times summed, every target that drew plus the pass that ends on the canvas. "Picture" is the mean difference of 255 between the two builds' stills, after a 9 x 9 blur in brackets; section 5 reads it.

| tier | view | picture | interval ms, median: older → this | GPU ms, median: older → this |
|---|---|---|---|---|
| low | forest (second load) | 0.09 (0.06) | 7.2 → 5.1 | 5.3 → 4.6 |
| low | trailhead | 0.24 (0.09) | 7.3 → 5.3 | 5.9 → 4.8 |
| low | forest-night | 0.05 (0.02) | 6.7 → 5.3 | 5.2 → 4.5 |
| low | tarn | 0.29 (0.16) | 7.5 → 3.7 | 4.2 → 3.3 |
| low | beach | **10.41 (10.12)** | 5.6 → 2.7 | 2.4 → 1.9 |
| low | meadow | 0.14 (0.07) | 7.3 → 4.3 | 4.2 → 3.6 |
| low | crest | 0.17 (0.06) | 8.9 → 3.1 | 2.3 → 1.5 |
| medium | forest | 0.60 (0.10) | 12.4 → 9.7 | 10.8 → 9.3 |
| medium | trailhead | 0.70 (0.10) | 15.4 → 10.9 | 13.7 → 10.4 |
| medium | forest-night | 0.53 (0.04) | 14.0 → 10.3 | 13.3 → 9.3 |
| medium | tarn | 0.65 (0.19) | 11.3 → 8.0 | 9.9 → 7.4 |
| medium | beach | **4.04 (3.54)** | 7.8 → 5.2 | 6.3 → 4.6 |
| medium | meadow | 0.49 (0.09) | 14.7 → 8.1 | 10.2 → 7.4 |
| medium | crest | 0.69 (0.09) | 12.9 → 4.8 | 5.1 → 4.3 |
| high | forest | 0.61 (0.09) | 13.9 → 10.9 | 11.9 → 10.3 |
| high | trailhead | 0.30 (0.09) | 16.6 → 10.9 | 14.4 → 11.2 |
| high | forest-night | 0.50 (0.04) | 13.9 → 11.1 | 11.9 → 10.1 |
| high | tarn | 1.20 (0.61) | 12.8 → 9.1 | 10.9 → 8.6 |
| high | beach | **5.98 (5.51)** | 8.8 → 6.0 | 6.2 → 5.2 |
| high | meadow | 0.52 (0.13) | 19.0 → 9.5 | 11.8 → 8.9 |
| high | crest | 0.58 (0.13) | 14.4 → 5.3 | 5.2 → 4.9 |

The page's own JavaScript a frame, from a 5 s profile at 19 of the 21, fell from 4.2 to 13.9 ms on the older build to 1.4 to 2.1 ms on this one.

What qualifies the table:

- Every view-tier stands on one load of each build, except the beach on high and the forest on low. The beach on high's two loads agree within about 7 %.
- The older build's first window is its lightest at about half the views (trailhead on high, GPU ms by pair: 1.4, 14.4, 14.7). Whether its world was still coming in or the hold did it was not separated. This build's three windows agree within 0.3 ms.
- With the frame cap off the main thread's busy share is the frame interval again, since both pages wait on the GPU. Capped and alone at the forest on medium, the main thread's work is 9.6 ms on the older build and 3.4 ms on this one.
- On low at the forest the settle ended before either page had made its far-tree bake targets: that view's times are of two pages not yet whole.

### Walking

The old wood at night, the lamp lit, W held 30 s, medium, frame cap on (a player's Chrome), each run a fresh load.

| build | runs | frames over 50 ms | main thread ms a frame | frame interval ms |
|---|---|---|---|---|
| this | 3 | 39, 46, 43 | 12.5, 13.2, 12.9 | 18.9, 19.3, 19.2 |
| older, on WebGPU | 2 | 71, 78 | 21.4, 21.4 | 22.1, 22.0 |
| older, on WebGL2 (it came up there by itself) | 1 | 58 | 19.9 | 20.8 |

### Load under the film

Play clicked on the landing page to world-ready, medium, three runs each, caches warm. **The older build drew on WebGL2 in every one of these runs**, asked for WebGPU or not (four loads through the landing page, and the one run left to its own rule). So the comparison is this build with what a desktop player on medium had, not WebGPU with WebGPU.

| build, API | Play to world-ready, s | main thread's tasks, s | longest long frame, ms |
|---|---|---|---|
| older, WebGL2 | 102.2, 103.4, 94.9 | 98.0, 99.7, 91.6 | 7812, 3607, 4239 |
| this, WebGPU | 68.5, 76.4, 62.8 | 62.3, 60.7, 51.0 | 2466, 2988, 582 |

With the caches warm, making the hike's pipelines off the main thread bought nothing: Play to world-ready 78.0, 81.0 and 79.4 s, with 164 to 614 frames drawn while a pipeline was pending. It is on a first visit that it matters (next).

### A first visit under the film

The intro is a film played over the hike while the hike loads. On a first visit no cache holds a shader or a file, and two things made the film stand. The frame cap was on for every run here, medium, the browser's profile and the driver's shader cache emptied before each.

**Pipelines.** A pipeline made with `createRenderPipeline` holds the browser's GPU thread while it compiles, and that thread presents the film's frames. A load made about 90 of them on medium: 14.2 s of that thread in one traced cold run, single calls of 0.2 to 1.5 s (0.6 s in all with the caches warm). While a hike loads, every pipeline is now asked for with `createRenderPipelineAsync`: the hike's own pass, the shader materials, the post chain, the sky's capture and Lite's helpers, four asks a frame at most. The passes whose pictures are kept (the far trees' bakes, the rain's cover map, the shore's panorama, the haunt's mask) draw whole or not at all, and are drawn once their pipelines are in. From world-ready on, every pass makes its pipelines at once, so what joins a hike under way is drawn from the frame it joins.

| synchronous pipeline makes before world-ready | low | medium | high |
|---|---|---|---|
| every pipeline made at once | 78 | 96 | 93 |
| as built | 1 | 1 | 2 |

The one left on every tier is a mip chain's blit, made by a synchronous caller; high's second is Lite's depth grab for transmission. In a traced cold run as built the GPU thread spent 0.07 s in synchronous pipeline makes.

**Downloads.** A browser fetches a film element's file at a low priority and every `fetch` at a high one. A hike asked for about fifty files at once, so the film got little of the link while they were in flight, and stood once its buffer was played. While the film plays, a hike's downloads now take turns behind it (`engine/src/game/downloadTurns.ts`): a download starts only while the film has enough buffered ahead (hungry below 5 s, fed again at 9 s) and a few at a time, the number doubling while the film stays fed and halving when it goes hungry. A film that holding does not feed holds a hike for about a minute at most, and a hike with no film is not bounded. Counted in headless Chrome on a MacBook Air with the link throttled, Play clicked at once on a cold profile:

| link | downloads all at once | as built |
|---|---|---|
| 15 Mbit/s | the film waits 4 times, ends 22.4 s behind | waits 0 times, ends 0.1 to 0.3 s behind |
| 25 Mbit/s | waits 3 times, 5.1 s behind | waits 0 times, 0.3 s behind |
| 8 Mbit/s | waits 4 times, about 60 s behind | waits 2 times, about 3 s behind; the hike is in after the film's end |
| not throttled | waits 0 times | waits 0 times |

The older build starts its models in sequences and has the same fault in a smaller measure: at 15 Mbit/s its film waits 3 times and ends about 7 s behind.

**On the rig**, medians of the cold runs (the older build's two runs each given):

| build | runs | worst step of the film's clock, s | worst skip of its picture, s | longest page stop, s | stops over 0.25 s | film frames dropped | Play to world-ready, s |
|---|---|---|---|---|---|---|---|
| every pipeline at once, downloads at once | 3 | 3.82 | 2.92 | 3.37 | 13 | 237 | 27.7 |
| pipelines off the thread | 10 | 1.12 | 0.46 | 0.71 | 5 | 43.5 | 29.9 |
| as built: and the downloads in turns | 7 | 0.45 | 0.75 | 0.73 | 4 | 57 | 28.8 |
| older (Babylon.js 9.18, WebGPU asked) | 1 + 1 | 0.00, 0.46 | 0.75, 0.50 | 1.35, 1.35 | 7, 5 | 59, 62 | 38.2, 32.6 |

With the caches warm, as built: no step of the clock, no skip, no frame dropped, no stop over 0.25 s, world-ready at 15.4 and 16.7 s.

What is left on a cold load: the film still waits two or three times a load with 12 to 17 s buffered, so not for data. One traced run puts the waits beside tasks of 0.3 to 0.7 s that the browser's GPU process spends on the page's raster work, not on pipelines; that reading rests on one trace. The page's own stops over 0.25 s are the renderer's creation (0.3 to 0.4 s), the first builds' slices, the parse of the models and the trailhead board's drawing. One cold run in each set, the first after the rig was started, held a stop of 2.8 to 5 s in which the page ran nothing; it is not explained.

### The start, made ahead and paced by the film

Two things held a start back after the work above, and neither was the machine. Counted on the build before this one, Play clicked on the landing page (headless Chrome on a MacBook Air, medium, the site served from the same machine, so no link to wait for):

- **Nothing loaded for the first seconds.** A hike's build waits for its world, which the world's worker makes off the page's thread, and the worker was started at Play: 1.5 to 2 s there (5 to 7 s on the rented rig's recordings of 2026-11-18) with the film playing and no file asked for, no pipeline made. No download starts before the build does.
- **Then the load ran at a fixed pace.** Under the film the hike was drawn four times a second, each draw asking for four pipelines at most, and the world is in only once a drawn frame has asked for nothing: about 80 pipelines took 3.1 to 3.8 s to ask for, in a stretch where no frame of the page ran over 50 ms.

As built:

- **The next hike's world is made while the landing page stands** (`engine/src/game/worldAhead.ts`). Once the page has loaded and the load check has said the visitor can play, the page makes the token the next Play will use and starts that world's worker; where the tier a start would be given needs no check (`tierAhead`), the hike's first scene at that tier is asked of the worker too. Play starts its hike at that token and takes the world as made. Nothing is fetched for it but the worker's own script, and nothing is made for a follower (the host's Play names their hike) or for a visitor turned away. A hike at any other address (an invitation, a link, an address edited) ends what was made ahead and starts its own worker, as before.
- **The load under the film runs at the pace the film affords** (`engine/src/game/loadPace.ts`, `filmFrames.ts`). The film's own frames are counted as the screen got them: a frame of its time that was never presented is a frame missed, and a picture standing now (the film's time a quarter second past the last frame shown) is counted as it stands. The pace is a level from the floor (the old fixed pace: a draw every 250 ms, four asks a draw) to the top (a draw every frame, one ask a draw, 60 asks a second). It climbs an eighth each quarter second the film kept every frame and its time, so two seconds from floor to top; it halves when the film misses a frame or its time stands, rests a second, and is then held under three quarters of the level the trouble came at, for 10 s the first time and twice as long each time after, a minute at most. A stop of the page's thread holds the level where it is. What is not the machine's doing moves nothing: a film waiting for its file with no data ahead, a film paused with its tab, trouble at the floor itself. A film nothing can be read of (a browser that counts no frames, a film no frame of which has been shown) leaves the load at the floor, so no machine is paced faster than before unless its film is seen to be whole.

Play to `hold to skip`, the same machine, the two builds turn about (seconds; each cold run on an empty profile, each warm run the same browser's second start):

| | before | as built |
|---|---|---|
| landing page stood 4 s, cold | 5.4, 6.4 | 2.6, 2.4 |
| landing page stood 4 s, warm | 6.0, 5.8 | 2.3, 2.5 |
| landing page stood 1 s, cold | | 3.5 |
| Play clicked at once, cold | 7.2 | 4.5 |
| link held to 15 Mbit/s, landing page stood 4 s, cold | 57.7 | 56.8 |

In every run of both builds the film dropped no frame and never waited, and the pace reached the top and stayed. So these runs show the gain and not the back-off: no run here made the film miss a frame, and the law's cuts are held by its tests alone. On a slow link the files are the whole wait, and neither change moves them: a hike's 87 MB is still asked for only after Play.

Not measured: the rented rig, a phone, any machine whose film does miss frames under the climb. This machine is not a timed one (other work runs on it), so the table is for the order of the stages and the size of the change, not for a budget.

**Measured on players' machines.** A start is timed by its own rows (`docs/telemetry/2026-10-12-telemetry-design.md`): `ready` carries the wait from Play, when the ground's files were in, when the terrain stood, when the first model was asked for and the last was in, and what came over the network against what the cache answered; `pace` says how the load was paced under the film and how many of the film's frames were missed; `intro` says what the film lost in all. `tools/telemetry/queries/start.sql` reads them a build at a time. Over the thirty days before this change, nine sessions of players pressed Play: the six that reached ready waited a median of 15 s (the longest 43 s), and three left first, after a median of 11 s.

**Found on the first preview, not yet changed.** Over a real link with an empty cache the bar stood at "building the world 2 of 11" for 3.4 s. The world was made, but the terrain waits for the renderer, and the renderer waited 1.7 s for the ground's images and then 1.6 s while the scene's code was fetched a file after another (a dozen small files, each naming the next). The models, 62 MB and most of that start's 25 s, were not asked for until the renderer stood, 3.4 s after Play.

### The long session

This build, medium, 22.8 minutes of walking in eight legs, beside other pages. No growth in the second half.

| reading | JS heap MB | buffers alive | buffer MB | textures alive |
|---|---|---|---|---|
| start | 41.9 | 1932 | 61.9 | 212 |
| middle | 47.9 | 2041 | 129.2 | 213 |
| end | 50.8 | 2043 | 129.2 | 213 |

The buffers' jump came in the first lap.

### The stops seen only with the frame cap off

With the cap off this build's page stops for 0.3 to 1.2 s every 260 to 265 frames, at 17 of the 21 view-tiers; alone on the page, without the measurement mode, and on a build without indirect draws too. Each stop is about 85 times the GPU's frame time. With the cap on it does not stop: 12 s alone at the forest on medium, 721 frames, the longest 17.6 ms; at the trailhead on high at 2560 x 1440 (this build's GPU frame 24.5 ms), 488 frames, the longest 34.5 ms. The older build, the same, has one 50 ms frame.

In all six profiles taken, each stop is one stretch of the main thread in the browser's own code with no JavaScript on the stack. The reading is that the uncapped page gets ahead of the GPU and is held until it catches up; no trace of Chrome's GPU process was taken, so that is a reading. Every uncapped count of this build's frames over 50 ms while standing belongs to the rig, not to a player.

### What a frame sends and draws

Counts at the forest (seed `atmo`, 250 -500, yaw 1.09) on each build's real tier, 120 frames a cell, every call the page makes to the GPU, clocks running, the camera still. Older: Babylon.js 9.18 on WebGPU. This: the loads at the tip.

| tier | passes: older → this | draws: older → this | buffer writes: older → this | bytes: older → this |
|---|---|---|---|---|
| low | 2 → 1 | 101 → 93, 93.66, 93.68 | 45 → 0.017 | 309,488 → 0.7 |
| medium | 10 → 7 | 138.375 → 121, 121.78, 121 | 56.25 → 2 | 357,910 → 376 |
| high | 14 → 10 | 252.375 → 125, 125, 125 | 57.1 → 2 | 369,951 → 376 |

With every clock held from load, low at the forest is 94 draws, 0 writes and 0 bytes on this build. Draws on medium and high move by one from load to load; on high what moves is the steep ground's pool, 1, 2 or 4 indirect draws.

The spike note counted the older build at medium on the rig on 2026-11-13: at the forest, 155 draws in the main pass; across its four views ten render passes, about 80 buffer writes carrying 360 to 460 KB, and no bind group made in a frame. The table above is the later count.

The indirect draws (section 4) cost nothing measurable on the GPU: each build alone at the forest on high, interval 9.95 ms and GPU frame 10.38 ms on both. What they save is indices: 248,244 fewer a frame on low, 451,350 on medium and 812,430 on high.

## 3. How a frame is drawn now

`ARCHITECTURE.md` is the authority (its "Rendering" section, and the paragraphs that begin "A hike is drawn with Babylon Lite" and "On the tiers with a post chain"). In short:

- **One frame block.** What every material reads alike and what moves with the frame (the air, the wet line, the wind and its clock, the eye the fades measure from, the lakes' and the sea's numbers, the grade a tier with no chain lays on) is one uniform buffer written once a frame, and only the words that moved (`lite/frameBlock.ts`). A material keeps what is its own.
- **Cached bundles.** Opaque draws are recorded in render bundles, in pipeline order, in parts: showing or hiding a mesh records its part alone. An instance list's plugin data and a ring's vertex data go up by marked range (`lite/listMeshes.ts`, `lite/terrainMeshes.ts`), so a draw is not recorded again for them. The steep ground's pool draws from indirect arguments of its own.
- **Plugins.** The look is material plugins in WGSL, statement for statement the game's earlier GLSL, the text in `.wgsl` files under `client/src/game/shaders/` that the modules below import with `?raw` and fill (`shaders/shaderText.ts`): the air (`lite/atmospherePlugin.ts`), the terrain (`lite/terrainPlugins.ts`), wet surfaces (`lite/wetWgsl.ts`), the forest's foliage (`lite/forestPlugins.ts`), the birds' wings (`lite/wingPlugin.ts`), the lakes and the sea (`lite/lakePlugin.ts`, `lite/seaPlugin.ts`), and on a tier with no post chain the grade (`lite/displayCurve.ts`). Everything they are fed is made by modules that import no engine.
- **The tiers' passes** at the forest, from the census above: low is one pass, to the canvas. Medium is seven: the scene at four samples a pixel in linear light, the depth's resolve, the far softening, the temporal anti-aliasing, its sharpen, the paint at half size, and the grade to the canvas. High is ten: medium's seven and the halation's extract and two blurs at quarter size (`lite/postChain.ts`, `lite/postWgsl.ts`). A lake in view adds its own passes on the tiers that draw its shore panorama or its mirror (`lite/lakePanorama.ts`, `lite/lakeMirror.ts`).
- **Streaming under a frame's share** (`syncJobs.ts`). A crossing's rebuild is a job, slices that end where a builder's loop asks the scheduler's clock (`sliceDue`) and finds 1.5 ms gone since the slice began (read every 8 samples, a hundredth of the work it follows); its last step applies the result to the meshes in one step and says what it expects to take, which the scheduler corrects with what that owner's apply steps took on the device. A frame's share is 4 ms (the phone's frame has 4 to 5 ms for everything else, so this is what streaming may spend and hold 60), a job past six frames or 100 ms is late, goes first and is given up to 8 ms a frame (the rest of a phone's 12 ms to spare, less a slice) and goes on the next, and one a second old is run to its end in one frame, for a clock that jumped or a job starved. A patient job (the face patches') never late is given one slice a frame the others left none for, up to 9.5 ms spent. A replaced job keeps the old one's deadline; what the old job had made that the new needs (a ring's samples, the cells a lookup holds, the patches built ahead) is not made again. A crossing's work on a phone is several times what six frames of 4 ms hold, so a ground detail at the edge of what is built arrives after the frames its work needs at that share, a few tenths of a second, and not in one frame that stops.
- **What is sent a frame** is the frame block and a pass's uniforms, and the lists and plugin data of what moved. The sea's swash table is packed only while the sea is in view, which takes 3,988 bytes a frame off the block on low and 3,952 on medium and high wherever the sea is out of view.
- **Water.** On high a lake and the sea are drawn opaque after the frame's first half, which is kept, and read through their surface (`lite/waterBehind.ts`); the lake's mirror is drawn on high (`lite/lakeMirror.ts`).

## 4. What Lite needed

The game's build of Lite carries 52 patches over 1.39.3, nine tags. Each is a commit in the fork.

| tag | patches |
|---|---|
| `.1` | a plugin's code before the lights follows the features' code there; the reflectance feature's `surfaceAlbedo` is a variable; a plugin's code before the final colour runs once; a plugin's per-instance attributes; `CUSTOM_FRAGMENT_LIGHT`, a point inside the light loop; `CUSTOM_VERTEX_DEFINITIONS`, helper functions for the vertex stage |
| `.2` | `Camera.projectionHook`; a plugin's texture without a sampler of its own, with its array type and sample type |
| `.3` | the plain path's `colorF90` is a variable; a plugin's global directives for the fragment module; a plugin's per-vertex attributes |
| `.4` | one uniform buffer a PBR material, shared by its meshes; the opaque list recorded in pipeline order; the opaque list recorded in parts; `createPluginUniformBlock`, a uniform block of the application's own; `enableAsyncPbrPipelines` and `whenPbrPipelinesIdle` |
| `.5` | `enablePbrLinearOutput`, PBR in linear light for a post chain; `mipMaps` on a texture made from pixels; a mesh's plugin instance data bound only where the material declares it; a projection hook handed a matrix written whole; `markLightDirty`; `createCustomEnvironment`, an environment the application draws itself |
| `.6` | a shader material's thin instances carry attributes of one's own; a list's buffer made again records only its own part; the scene's bind group set once a pass; a disposed mesh's plugin buffers destroyed with it; a mesh's uniform buffer and the lights buffer written only when their bytes changed; a shader material reads the application's uniform blocks (`uniformBlocks`); a mesh added or removed records only its own part of the list; plugin data sent when its version moves, by range, shown or hidden; thin instances written past the drawn count sent as a ranged flush |
| `.7` | a render task's pass broken before the meshes an application names (`enableRenderTaskBreak`); a render task shows or hides a mesh by its own word (`setTaskMeshVisible`); a draw range marks only its own mesh's recorded draw stale; a task clears its viewport alone and writes alpha 1 where it drew; a range of a plugin uniform block written alone; a public way to a pass of one's own on the frame's encoder; a shader material lets go of the textures it claimed; a render target can keep its textures while its size stands (`keep`) |
| `.8` | a draw range that stands, or moves over triangles already walked, reads nothing of the mesh; a scene let go leaves the PBR pipelines other scenes draw with; a blended mesh can be ordered by a point of its own (`Mesh.sortOrigin`); what a task's break keeps can stand from one recording to the next; the first scene node a page makes can be let go; one shader module a stage for every pipeline of a PBR layout; a plain mesh can draw from indirect arguments of its own (`enableMeshDrawArgs`); a task or a scene can make its PBR pipelines at once (`syncPipelines`) |
| `.9` | a render task draws whole or not at all while a pipeline of its list compiles (`drawWhole`, `isRenderTaskHeld`, `whenRenderTaskPipelinesIdle`); a shader material's pipelines made off the main thread whenever it joins (`enableAsyncShaderMaterialPipelines`); Lite's helper pipelines (the read-back, the RGBD decode, a mip chain's blit) asked for off the main thread where their callers wait; a bound on the pipelines asked for in one frame (`setPipelineAsksPerFrame`) |

What the later tags counted, each in the fork's own report:

| patch | count |
|---|---|
| one uniform buffer a PBR material (the spike's replay, trailhead) | buffer writes when the air moves, 353 → 72; with the air in a block of its own, 2 |
| the pipeline cache held across scenes (a load, trailhead low) | pipelines made 110 → 53, shader modules 252 → 138 |
| `enableMeshDrawArgs`, a held frame | indices 248,244 / 451,350 / 812,430 fewer on low / medium / high |
| `sortOrigin`, the car's glass on a moving frame | 2 writes, 16,728 bytes → 1 write, 144 bytes |
| a ranged write of the frame block, a held frame | medium 7,728 bytes → 2,424, high 8,496 → 3,192; low 5,312 bytes → none |

The game calls `enableAsyncPbrPipelines`, `enableAsyncShaderMaterialPipelines` and `setPipelineAsksPerFrame` while a hike loads, sets `drawWhole` on the passes whose pictures are kept, and sets `syncPipelines` on the scene from world-ready on: section 2 gives what that did on a first visit.

### What the game still works around

Lite lacks these, and the fork's reports list them as owed. The game carries each in its own code.

- `enablePbrLinearOutput` is the whole page's and cannot be turned back. On the low tier after a tier with a chain, the air's plugin lays the display curve on itself.
- Depth written by a blended material, and a second colour target from a material's fragment.
- The clear coat takes only the first light's bearing; every lamp would light the car's paint if it took each light.
- An order among the panes of one blended mesh.
- A mesh that joins a task while the scene is building: the game hides a seed mesh (a task's material override on a thin-instanced mesh needs one) and hands a mesh to a second task only after the forest's bakes settle.
- `keep` for the default pass's target; a function to change a task's target; a sampler on `createRenderTargetTexture`; thin instances without the matrix buffer; asynchronous pipelines for the shadow and geometry passes; a render target sized by a rule; a front-face flip for one task; a real depth bias; a mesh's edges drawn through its own material.
- Lite's own recovery of a lost device reports success and leaves plugin textures and instance buffers on the dead device. The game builds its renderer again on a new device instead (section 6).

## 5. Where the picture differs, and why

**At the floor.** Two loads of one build differ too. At the forest the floor is 0.41 (0.06) on medium and 0.64 (0.05) on high; none was shot on low. The older and this build are at that floor in 17 of the 21 view-tiers, every view but the beach on all three tiers and the tarn on high. The title still on high, shot alone, is 0.57 (0.05).

**The tarn on high is drawn differently by design.** On the tarn on high 7.3 % of pixels, the lake's surface, differ by a mean of 6.6; this build's water is lighter and warmer. The tarn on medium is at the floor.

- The older build's high tier did not draw its water the way its design says. The check that arms the design (`waterFrameSupported`) asked the first post-process for more than one sample, and since the far softening's prepass the samples are set on the prepass; so on high the older build's water is blended like medium's and nothing is read through the surface.
- This build draws the design: the sea, the swept curl of its waves and the lakes are opaque, marked to come after a break in the scene's pass, and read the kept colour and depth of the first half (section 3); the lake's mirror is drawn.
- Against the older build with the design switched on by a temporary line, on high at 1470 x 956, 260 frames, clocks held, the whole frame at the lake at noon is 1.017 (floor 1.147), at the beach at noon 0.046 (floor 0.045). Mending the check alone would not bring the design back to the older build: its depth resolve then writes into a texture the device refuses as a colour attachment, and the page rebuilds on the blended path.

**The lake's bank.** On the older build the sea's wet band is laid on a lake's bank as well, with no bound in x, and it pulses with the sea's swash. On this build the band is bound to the sea's cove: a surface under a lake's wet line has none. At the lake the pictures differ from the older build's by 45,037 pixels (3.2 %, largest difference 64 of 255) at night and 44,841 (3.2 %, 102) at noon on low; 3.7 % (41) and 4.4 % (55) on medium at night and noon; 3.8 % (41) on high at night. The beach is the same bytes.

**The beach.** Its stills differ between the two builds by more than two loads of one build do, and this is not explained.

| tier | older against this, mean of 255 | pixels off by over 4 |
|---|---|---|
| low | 10.41 | 42 % |
| medium | 4.04 | 24 % |
| high | 5.98 | 39 % |

- This build against itself on high is 2.75 (20 % of pixels): the shore's wet patches and pools sit at other places on two loads of one build.
- Among the differing pixels this build's shore is lighter than the older build's by about 11 levels on low and high and 4 on medium. Two loads of this build differ by 0.1.
- On high this build draws red-brown sand over the lower half where the older build draws grey water with a white surf line. The water's own comparison at its beach view was 0.41.
- Holding the wind at nothing is not the cause: with the game's own wind, high is 5.37.
- One still a build a tier; no floor was shot at the beach on medium or low.
- The sea is drawn at the simulation's tick (`sharedSeconds`, `oceanWindSea.ts`). The stills held `performance.now` and `Date.now`, not the tick, so the two pages may stand at different places in the swash's cycle. How much of the difference is the sea's phase and how much is the drawing has not been separated.

**Seen once.** One page of this build drew a hike with no trees: its console said the forest's trees could not be made after a failed fetch (picture against the older build 50.3). It was one of about a hundred pages of this build on the rig. The view loaded again agrees (0.093). What the older build does in the same case was not checked. That page was of a build that asked for each file once; a fetch that fails the way a network fails is asked for three times in all (`engine/src/game/fetchRetry.ts`).

## 6. Who cannot play, and what they see

The page decides once as it loads (`engine/src/game/loadCheck.ts`) whether this browser and graphics card can play, from what the page already reads about the GPU. If not, nothing of a hike is fetched or built, and one page (`turnedAway.ts`, with its model in `turnedAwayModel.ts` and its words in `turnedAwayWords.ts`) stands in place of every route, the landing page and an invitation among them. Cyrus decided on 2026-11-13 that such a browser is told at load. Four reasons are told apart:

| reason | what it means | headline in a browser |
|---|---|---|
| `no-webgpu` | the browser offers no WebGPU | This browser cannot run Day Hike. |
| `no-adapter` | it offers WebGPU and gave no adapter | This browser could not reach the graphics card, so Day Hike cannot run in it. |
| `software` | the adapter is the browser's software one | This browser has graphics acceleration turned off, so Day Hike cannot run in it. |
| `short` | the adapter reports less than the game needs | The graphics card in this device cannot run Day Hike. |

- The needs are WebGPU's defaults (`REQUIRED_LIMITS`: 2D textures 8192, 4 bind groups, 16 sampled textures and 16 samplers a stage, 12 uniform buffers a stage, a uniform binding of 65,536 bytes, 8 vertex buffers, 16 attributes, 16 inter-stage variables) and no optional feature. A limit the adapter does not report is not known and is never short. An adapter that has not answered in two seconds is not refused; the page reads its later answer.
- The page shows the title, what is wrong in one sentence, what to do, the browsers that run the game on the visitor's kind of device with their versions (Chrome or Edge 113, Safari 26, Firefox 141 on Windows and 147 on a Mac with Apple silicon, Chrome 121 on Android 12, Safari on iOS 26), one small technical line that names WebGPU, and the credits. A phone is told to update the browser and the system. In the desktop app the page names no browser.
- **The desktop app is offered only where the browser is what is missing:** reason `no-webgpu`, on Windows 10 or later with an x64 build, or on a Mac with Apple silicon whose GPU the browser does not name as another maker's. Never on a phone or tablet, never in the app, and never for the other three reasons, where the app's browser would meet the same graphics card.
- The page carries its reason as `data-reason` on its `main` element, which the desktop app's smoke test reads.

**A device lost and found again.** A lost device is answered by a new renderer on a new device, built at the running tier under a cover over play. The loss that is the third within ten minutes (`LOSS_BOUND_COUNT`, `LOSS_BOUND_WINDOW_MS` in `lossBound.ts`) is not answered: the hike ends with "The hike ended: this device's graphics keep resetting. Restarting the browser may help.", on its screen and then on the landing page. The count belongs to the page, so a new hike on a machine that is still failing ends at its first loss. Cyrus decided on 2026-11-16 that such a hike stops and ends with a short message.

Over thirty days before the spike, 51 of 53 page loads had a usable adapter, and all 34 sessions that reached a hike.

## 7. Not measured

- **Phones.** No phone was timed or looked at on this build.
- **Safari and Firefox.** Both are on the page's list of browsers because they have WebGPU turned on, not because the game was run in them on this renderer.
- **The tier check on a machine with warm caches.** With emptied caches on the rig, no step of the check was ready in its 15 s on either build (two runs each: this build with the frame cap on and off, the older with it on and off). No verdict was reached and none could be compared; both start at low. On this build the last pipeline was asked for 14.3 s into the step with the cap on, and with it off the far trees' bakes had not begun by 15 s. A first-visit player on such a machine waits 15 s behind the screen, spends an attempt and gets the start tier.
- **The load on high and low**, beyond one cold run each (world-ready at 24.5 s on low and 31.1 s on high, before the downloads took turns).
- **A first visit on a real slow link.** The throttle shares a link equally among requests; a server that honours priorities gives a low request nothing while a high one has data, so a real link starves the film harder than the throttle shows.
- **Why the film still waits with data in hand** on a cold load (section 2): laid beside the GPU process's raster tasks by one trace, not proved.
- **The walk on high and low**, and a third run of the older build on its WebGPU engine (one of its three ran on WebGL2).
- **The older build on WebGL2 in the standing views**, which is what a desktop player on medium and low had.
- **The floor on low**, at any view but the forest and, on high, the beach; the title still on medium and low.
- **A second load of most views**: the spread from load to load is known at two views.
- **The alternating way against pages newly loaded**, the older build above all with the frame cap off. The standing windows hold one page while the other draws.
- **What Chrome is doing in the stops with the cap off.** They do not show with the cap on, alone, at a GPU frame of 7.6 or 24.5 ms. Not tried: several hikers' lamps, a walk at a GPU-bound size, another machine.
- **The Hollows' eyes** are in no view of the list, and the far trees joining together cannot show in a settled still.
- **Of the water:** the night residue of the mirror (tree shapes differ pixel by pixel; read as the forest's dithered fade laid on a picture turned over and halved, not proved); the mirror under a moving eye, a resize, a second lake; device loss with the indirect draws; a second hiker.
