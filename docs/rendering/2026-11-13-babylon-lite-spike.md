# Babylon Lite as the renderer: a spike

**Status:** measured 2026-11-13 and 2026-11-14; nothing of it is in the game. The game draws with Babylon.js 9.18.

Babylon Lite (`@babylonjs/lite`, 1.39.3 here) is a second renderer from the Babylon.js team: WebGPU only,
WGSL only, its scene plain objects and functions, its opaque draws kept in a cached render bundle. This
note records what it would take to draw Day Hike with it and what it would buy, measured on the game's
own draw lists and plugins.

## 1. Where the main thread goes now

On the rented rig (a g4dn.xlarge: a T4, four virtual CPUs, Chrome 154, medium tier, WebGPU), the free
camera still at four views, a CPU profile of ten seconds each:

| View | Frame | Babylon, with the browser calls it makes | The game's own code | `sim/` | The browser |
|---|---|---|---|---|---|
| trailhead | 13.9 ms | 10.9 to 11.8 ms | 1.4 to 2.1 | 0.3 | 1.4 |
| forest | 11.4 | 8.9 | 1.4 | 0.4 | 1.3 |
| meadow | 12.0 | 7.8 to 8.2 | 1.3 | 1.0 | 1.9 |
| crest | 10.6 | 7.1 | 1.4 | 0.8 | 2.0 |

A census of the same frames (the WebGPU interfaces wrapped in the page): the main pass is 155 to 352
draws, already replayed from render bundles (2 to 10 recorded anew a frame), ten render passes, about 80
buffer writes carrying 360 to 460 KB, no bind group made. The scene holds 700 to 1,160 meshes and about
128 materials. So Babylon's three quarters of the main thread is not draw submission: it is what it does
a frame over every mesh and material it holds (the active-mesh pass, each material's bind with its
plugins' uniforms, world matrices, the passes' render lists).

## 2. The shader edits

The look is a stack of material plugins that edit Babylon's PBR shader at its named points and, in seven
files, by regex on its text. Lite's PBR shader is a template with slots, and a plugin fills a subset of
them under Babylon's point names. Its values there are mutable (`baseColor`, `roughness`, `metallic`,
`colorF0`, `surfaceAlbedo`, `N`, `color`), which is what most of the regexes were for.

Five of the game's plugins were written again in WGSL and compared, picture against picture, with
Babylon 9.18 drawing the same scene with the game's own plugins:

| Plugin | How it goes in Lite | Lite against Babylon, mean of 255 |
|---|---|---|
| Atmosphere (the fog line's regex) | Lite's fog off; the plugin fogs `color` before the tone map, with Babylon's linearised fog factor computed itself | 0.02 |
| Wet (a point Lite lacks, and a regex on roughness) | The base colour and roughness at the diffuse point, the rest before the lights | 0.02 |
| Foliage (wind in the vertex stage, shading, the normal) | At the vertex stage's end: only the clip position takes the wind, as in Babylon | 0.11 |
| Foliage lighting (a regex inside the light loop) | A point inside Lite's loop (below) | 0.10 |
| Distance fade (a per-instance attribute) | A per-instance attribute (below) | 0.11 |

The wind moves 13 % of the reference's pixels and the lighting edit 10 % when backlit; the differences
above are the residue along moved edges.

Lite as published could not carry all of it. The changes are in a repository of the published package
with the patches as commits, `github.com/csarkosh/babylon-lite` (tag `v1.39.3-dayhike.1`, 64 lines; the two after it below are `v1.39.3-dayhike.2`, the last three `v1.39.3-dayhike.3`; the fourth tag's are in sections 4 and 5):

- a plugin's code before the lights runs after Lite's own there, and the reflectance feature's
  `surfaceAlbedo` is mutable, so a plugin can change the albedo on a loaded model;
- a plugin's code before the final colour runs once (as published it ran twice on a material with no
  image-based light: a fog applied twice);
- a plugin declares per-instance attributes, fed from the thin instance (the direct draw path only);
- `CUSTOM_FRAGMENT_LIGHT`, a point inside the light loop;
- `CUSTOM_VERTEX_DEFINITIONS`, helper functions for the vertex stage;
- a plugin's texture without a sampler of its own (a stage has sixteen), as an array, or as unfilterable
  float data;
- `Camera.projectionHook`, to change the projection a camera has just computed;
- a plugin declares per-vertex attributes, fed from the mesh (the terrain's layer weights);
- a plugin's global directives for the fragment module (`diagnostic(off,derivative_uniformity)`, for
  code that samples inside a branch, as the game's translated stages carry now);
- `colorF90` is mutable before the lights, as `colorF0` is.

A float array in a plugin's uniforms rides as `array<vec4<u32>,N>` and is read by bitcast. The fog
plugin must be the last at its point. The ported plugins read Lite's own names (`lights.lights`, `pl`,
`N`, `V`), as the regexes lean on Babylon's text: a test would pin them, as the anchors are pinned now.

## 3. The frame

The game's draw list at each view (every mesh drawn, its geometry, matrices and instance lists) was
replayed in Lite with plain PBR materials carrying the atmosphere plugin, and the main thread timed on
the same rig Chrome as the table above:

| View (draws) | Babylon's own, camera still | Lite, still | Lite, turning |
|---|---|---|---|
| trailhead (352) | 10.9 to 11.8 ms | 0.41 ms | 0.38 ms |
| forest (155) | 8.9 | 0.32 | 0.25 |
| meadow (260) | 7.8 to 8.2 | 0.25 | 0.20 |
| crest (230) | 7.1 | 0.20 | 0.26 |

The replay is a floor for Lite and not a forecast: one plugin where the game has nineteen, none of the
meshes the scene holds undrawn, one pass of ten, no animation, and shaders that stand in for the game's
(its GPU time says nothing). The still views already draw at 72 to 94 frames a second on the rig; the
frames that miss are the moving ones, where the streaming jobs and `sim/` are 8 to 11 ms on top of
Babylon's 11 to 16 (`2026-11-09-summit-scene-and-chase-frames.md`). Lite takes most of the second number
and none of the first. On the Air the frame is the GPU's, and none of this moves it.

## 4. A world that changes

Timed on the rig at the trailhead, each change on its own:

| Change | Mean main thread a frame | Worst frame |
|---|---|---|
| A mesh hidden or shown every sixth frame (the bundle recorded again, 352 draws) | 0.30 ms | 2.9 ms |
| A mesh's geometry rewritten in place every sixth frame | 0.81 | 12.8 |
| Every material's uniforms every frame | 1.85 | 9.3 |
| Eight instance lists a frame re-sent whole | 1.90 | 27 |
| The same with their counts moving | 3.62 | 138 |

Recording the bundle again is cheap. The slow frames are buffer uploads: a profile puts 57 % of the busy
time of the last row in the browser's `writeBuffer`, and under 10 % in Lite. The test sends whole lists,
some of them hundreds of kilobytes; the game on Babylon uploads about 5 KB a call. So the rule for a
world in Lite is the one the job scheduler already keeps: a bound on what a frame uploads, dirty ranges
and not whole lists, and a fixed set of meshes changed in place (Lite's `updateMeshGeometry`,
`updateMeshPositions`, `setThinInstanceCount`) rather than made and destroyed.

A plugin's uniforms are in the material's buffer, and Lite keeps one a draw: with the sun and the wind's
clock among them every draw's buffer is written every frame (353 writes at the trailhead, about 1.5 ms on
the rig), where Babylon writes one a material.

The repository of Lite's package changes four of these (tag `v1.39.3-dayhike.4`). Each is counted on the
same replay, on any machine the same count, with the pictures unchanged to the pixel:

| What a frame does, trailhead (352 draws) | Lite as published | With the changes |
|---|---|---|
| Buffer writes when the air's uniforms move, in the materials' own buffers | 353 | 72 (one a material) |
| The same with the air in a uniform block of its own | not possible | 2 (the block and the scene's) |
| Pipeline changes in a recording of the opaque list (329 draws, 4 pipelines) | 97 | 4 |
| Draws recorded over 300 frames of a turning view that hides what leaves it | 11,326 | 1,076 |

- One uniform buffer a material, shared by the meshes drawn with it (forest 156 to 63, meadow to 56,
  crest to 55).
- A uniform block (`createPluginUniformBlock`) that plugins name and read as `<name>.<field>`: what is
  the same for the whole scene and moves every frame is written once, whatever the materials.
- The opaque list sorted by pipeline within a render order.
- The opaque list recorded in parts of 32 draws: showing or hiding a mesh records its part alone, so a
  frustum cull by `setMeshVisible` no longer records the whole list on each frame the view turns
  (forest 2,399 draws to 413, meadow 4,101 to 688, crest 6,174 to 665).

Timed on the rig, the page built against the third tag and against the fourth in turn on one Chrome, three
rounds of 300 frames, main thread a frame:

| What the frames do | Third tag | Fourth tag | Fourth, the air in a block |
|---|---|---|---|
| Trailhead, the air's uniforms move every frame | 2.28 ms, 28 frames of 300 over 5 ms | 0.33 ms, none | 0.19 and 0.23 ms (a third round 1.17, one frame of 147 ms in it) |
| Forest, the same | 0.41 | 0.24 | 0.16 |
| Trailhead, a turning view that hides what leaves it | 0.37 | 0.28 | |
| Forest, the same | 0.21 | 0.19 | |
| Trailhead, a mesh hidden or shown every sixth frame: that frame | 1.02 | 0.34 | |
| Trailhead, the churn above (uniforms, instance lists re-sent, a mesh replaced) | 3.38 | 2.16 | 1.40 |
| Forest, the same | 1.57 | 1.40 | |
| Trailhead, still and turning with nothing changed | 0.20, 0.19 | 0.20, 0.18 | |

The uniform writes were the cost they looked like: one buffer a material takes the trailhead's frame from
2.3 ms to 0.3. Recording in parts is a small saving, since a whole recording was cheap already. The churn's
frames over 5 ms are as many as before (27 of 300 at the trailhead against 29; 18 against 25 at the forest):
they are the instance lists going up whole and a mesh replaced, which none of these changes touches.

## 5. The start

Lite makes PBR pipelines with `createRenderPipeline`; its asynchronous path covers its plain shader
material only. On the rig a first draw stopped the page for 2.6 and 3.1 s. The game avoids exactly this
on Babylon today (`asyncPipelines.ts`), and would need the same of Lite.

The repository's fourth tag adds it: with `enableAsyncPbrPipelines()` a forward pass's pipeline is made
with `createRenderPipelineAsync`, the mesh is left out of the draw list while it compiles and joins on the
frame after, and `whenPbrPipelinesIdle()` says when none is compiling. On the replay no pipeline is made
inside a frame (4 of 4 off it) and the picture is the same once they are ready. Shadow and geometry passes
still make theirs when first drawn.

On the rig the stop belongs to a browser's first pipelines, not to every new shader. The first page of a
new machine, its pipelines made as they were drawn, stopped for 1.7 s in one frame. After that, pages whose
fragment shader the browser had never compiled did not stop either way: made as they were drawn, the worst
frame was 6 to 10 ms and the frames of the next second ran at 0.65 to 0.7 ms against 0.2; made off the main
thread, the pipelines were ready after 0.35 to 0.5 s, the page drew 170 to 350 frames meanwhile (the worst
4 to 24 ms), and the frames after ran at 0.2 ms.

The asynchronous path does not spare a new machine its first stop. A newly started rig's first WebGPU
page stopped for 2.0 s with its pipelines made off the main thread, and for 1.7 to 3.1 s (once 21 s) with
them made as drawn. The profile puts the time in the swap chain's first texture and the frame's native
calls: the browser's GPU process starting on a cold disk. On a browser that has drawn before, four
pipelines whose vertex and fragment text are both new compile in about 0.1 s and no frame runs over 18 ms
either way. The game covers its start with the intro in both cases.

With the shaders written in WGSL, a first visit no longer fetches the GLSL translators (2.65 MB) or a
tier's WGSL map (7.6 to 8.8 MB), and the recorded shader corpus and its tools have no work left.

## 6. Who could not play

Lite has no WebGL2 path. The page already asks every browser for a WebGPU adapter at load and records the
answer: over thirty days, 51 of 53 page loads had one, and all 34 sessions that reached a hike, the 16
that drew on WebGL2 among them (an iPhone, Safari, Firefox, Chrome on Android). The limits the game needs
are WebGPU's defaults. The pine scene draws at 60 frames a second in Firefox 160 and Safari 26.6 on a Mac.

## 7. The terrain

The terrain's whole material was written again in WGSL as Lite plugins: the layer blend with its hex
tiling, rock parallax and height blend, the macro and far-cover colour, the road, trail and feature
paints, the far cover's lighting, the wet surfaces as the terrain compiles them. It is 616 lines of
GLSL as the game assembles it for the low tier, taken statement for statement.

The reference is the game: the low tier on WebGL2 (its GLSL as written), every mesh but the clipmap
rings left out, the image-based light and the tone curve off on both sides. What the material was
drawn with is read out of the running page (the rings' vertex buffers, the uniform values by name,
the eleven textures' pixels, the lights, the camera) and handed to Lite, so the two pictures differ
only by the shader and the renderer. At 853 by 480:

| View | Lite against the game, mean of 255 | Pixels off by more than 16 |
|---|---|---|
| trailhead | 0.09 | 0.02 % |
| forest | 0.09 | 0.08 % |
| tarn | 0.12 | 0.12 % |
| meadow | 0.12 | 0.15 % |
| crest | 0.11 | 0.31 % |
| beach | 0.06 | 0.05 % |
| on the road | 0.11 | 0.05 % |
| trailhead, rain | 0.07 | 0.06 % |
| tarn, rain | 0.08 | 0.14 % |
| beach, rain | 0.04 | 0.06 % |
| on the road, rain | 0.08 | 0.09 % |
| forest at night, the lamp | 0.04 | 0.03 % |

What is left is a line one pixel wide along silhouettes, where two rasterisers disagree, and specks
on thin far features. Each part of the shader is in the pictures: left out of Lite's, the road changes
49 % of the road view's pixels, the trail 20 % of the trailhead's, the feature paint 37 % of the
crest's, the far cover's sun term 14 % of the trailhead's, the rock parallax 6 % of the tarn's, the
wet surfaces 48 % of the beach's. The rain ripples are ported and in no picture: no puddle was in view.

How it goes in differs from Babylon in four places:

- Babylon runs the blend on the base colour, before it is split into albedo and F0; Lite has split
  them by its point before the lights. The blend starts again from the base colour, and a last plugin
  makes the split with the terrain's F0 and specular weight. The three regexes on Babylon's
  reflectivity block are that plugin.
- The regex inside Babylon's light loop is the point inside Lite's.
- The layer weights ride in the mesh's plugin vertex data, and the vertex colour with them.
- The eleven textures share one sampler; the three float tables are read at their texels.

Not in the comparison: the image-based light, the tone curve, the medium and high tiers (the same
code with a wider far band), compressed textures, and the shader's GPU time.

## 8. A whole view

The forest view was rebuilt whole in Lite from the running game. The game is opened at the view, its clock
held still, and what every drawn mesh was drawn with is read out of the page: vertex buffers, instance
lists and their per-instance attributes, each draw's uniform values by name from its GL program, the
texture at each sampler, the face it culls. Lite draws the same list with its PBR material and the
game's material plugins written in WGSL (the atmosphere, the wet surfaces, the terrain, the foliage with
its wind and its per-light term, the distance fade, the ground conform, the moss, the fallen wood, the
wings, the grass blades), fed those values.

| Forest view | Draws | Lite against the game, mean of 255 | Pixels off by more than 16 |
|---|---|---|---|
| Low tier, 853 by 480, no post chain on either side | 111 | 0.77 | 0.18 % |
| Medium tier, 1280 by 720, the game's whole post chain | 141 | 0.91 | 0.27 % |

By kind on the low tier: terrain 0.07, signs and the summit body 0.00, rocks 0.03, impostors 0.04,
crowns 0.10, ferns 0.21, shrubs 0.15, grass 0.35, bark 0.77. The bark is what is left: the comparison
makes the compressed textures' smaller levels again by halving where the game reads the files' own,
and the moss's mask is a threshold on that texture.

The medium tier's chain is the game's, pass for pass: the scene in linear light under four samples a
pixel with its depth kept, the far softening, the temporal anti-aliasing with its history and its
sharpen, the paint pass at half size and its compose, the grade. Each pass is the game's GLSL statement
for statement, fed the uniform values read from the game's own pass. Both sides draw 321 frames with the
clock held, so the anti-aliasing has settled. Not exercised by this view, and left out: the far
softening's cloud march, the grade's shade mask and its halation.

What Lite does differently from Babylon, each found as a wrong picture:

- Babylon multiplies the lights' diffuse by the occlusion a metallic map's red channel holds; Lite keeps
  occlusion to the image-based light. A plugin takes that share out of the composed colour.
- A material drawn on both sides without two-sided lighting keeps its normal on a back face in Babylon;
  Lite's `doubleSided` turns it over. A plugin undoes the turn.
- Lite's PBR always ended with the display curve, and a post chain wants linear light.
- Lite's `createTexture2DFromPixels` made one level and ignored `mipMaps`: bark speckled, and
  alpha-tested cards covered a seventh more pixels than the game's.
- `projectionHook` was handed a matrix holding its own last edit, so a jitter added there summed and
  walked the picture twenty pixels in 325 frames.
- A plugin's instance data was bound wherever a mesh carried it, whether or not the material's plugin
  declared instance attributes.

The last four are mended in the repository's fifth tag (`enablePbrLinearOutput`, `mipMaps`, the hook's
matrix written whole, the binding), with the two additions the sky's light needed. The first two stay
the port's to carry, as plugins.

Lite has no frustum culling of plain meshes, and its targets are sized when made: a change of render
scale rebuilds the frame's passes.

## 8a. The whole view's frame

The rebuilt forest view was kept drawing on the rented Windows machine (an NVIDIA T4, Chrome 154, the
frame cap off, 1470 by 956) beside the game's medium tier at the same view and size, three rounds
interleaved. The game was timed by its own frame-budget harness, with its GPU readout; Lite by the same
sample of frames, with every render pass's time on the GPU summed as Babylon's readout sums them. Every
material's uniforms were written again each frame in Lite, as the wind's and the air's clocks make the
game do.

| Still view, medium, 1470 by 956 | The game | Lite |
|---|---|---|
| A frame, mean of three rounds (ms) | 12.33, 12.75, 12.37 | 9.32, 9.35, 9.34 |
| On the GPU a frame (ms) | 10.76, 10.86, 10.70 | 8.81, 8.85, 8.84 |
| The main thread a frame, from a CPU profile (ms) | 12.3 busy, 3.0 of it inside `writeBuffer` | 9.4 busy, 8.5 of it inside `writeBuffer` |
| The main thread apart from `writeBuffer` (ms) | 9.3 | 0.9 |

Lite's frame is the GPU's: its main thread waits inside the first buffer write for the GPU to take the
last frame's work, which is where the profile puts nine tenths of its time. What the page itself does
is under a millisecond a frame. The game's main thread is busy the whole frame, a quarter of it in
buffer writes, some of which is the same wait.

The two do not draw quite the same thing. Lite's view is 141 of the game's draws: the sky's dome, the
mist, the motes, the animals and the heads-up display are not in it, nor the game's own work (the
simulation, the streaming, the sound), which is about a twentieth of the game's profile at a still
view. Lite's lower GPU time is therefore partly the draws it lacks; it is not above the game's.

Walking is not the same measurement on the two sides. The game walked for thirty seconds through the
forest, its world streaming. Lite cannot stream: its view turned thirty degrees a second, each mesh
was shown or hidden by a cone about the view's axis, and the changes a walk makes were made at the
rates of a sixty-frames-a-second walk (480 instance lists sent again and 10 terrain meshes changed a
second).

| Walking, medium, 1470 by 956 | A frame, mean (ms) | Median | 95th percentile | Worst | Frames over 50 ms a second |
|---|---|---|---|---|---|
| The game, a real walk (three runs of 30 s) | 23.0 to 25.1 | 15.4 to 16.4 | 69 to 76 | 172 to 232 | 3.7 |
| Lite, terrain meshes replaced (three runs of 10 s) | 9.4 | 2.3 to 4.2 | 32 to 39 | 102 to 123 | 2.0 to 3.0 |
| Lite, terrain meshes written in place | 9.4 | 7.4 to 8.2 | 29 to 30 | 66 to 97 | 1.0 to 1.6 |

Lite's long frames are fewer and shorter than the game's and they are not gone: a changed world still
costs frames of 60 to 120 ms at these rates, more when a mesh is replaced than when it is written in
place. What they are made of was not profiled.

## 8b. The water

Not written again. What it needs of the renderer was tried on the game's own geometry with shaders that
stand in for the game's (about 1,070 lines of GLSL still to write in WGSL), and nothing was compared with
the game's picture: a second camera reflected in the water's plane, the opaque scene's colour copied and
its depth kept, a displaced surface drawn after it reading a height map in the vertex stage, that colour
and depth, and the mirror. It draws: trunks stand in the water and their reflections lie on it.

## 8c. Skinned models, the sky's light, a lost device

- **Skinned models.** The game's animals pose in Lite as in Babylon (0.01 of 255 at a held pose). Lite's
  scene mixer plays every clip of a loaded container unless its animation groups are taken off before it
  joins the scene; a pose is set with `goToFrame`. Lite gives every glTF material a packed
  occlusion, roughness and metal texture.
- **The sky's light.** The sky drawn into a cube and used as the image-based light matches at noon, dusk
  and night (0.01 of 255), with two additions to the fork: an environment the application draws itself,
  and a light changed in place written again. Babylon reads the game's probe at its top level whatever
  the roughness, and the probe gives no diffuse light as the game ships. Lite's PBR has exposure, contrast
  and a tone curve, and no colour curves, dither or vignette: on the low tier those need a last plugin
  or pass.
- **A lost device.** The game's own rebuild works on Lite: the device destroyed (and, separately, the
  browser's GPU process ended), the engine disposed and built again, the picture the same. Lite's own
  recovery in place reports success and leaves plugin textures and instance buffers on the dead device.

## 9. Not measured

A real walk in Lite (its world streaming), and what its long frames under change are made of. The
game's own shaders for the water; the high tier (halation, the wider paint); the bark shade; the mirror's oblique near
plane; the ocean's FFT; the lens; a view under rain or cloud with the post chain; Lite's frame with the
scene's undrawn meshes in it; per-instance attributes through Lite's GPU-culled paths; a phone.
Whether Lite's GPU culling of instances, a depth pass before the colour pass, or the opaque list
drawn near to far would save the GPU time: none was tried.

## 10. The runs

`/Volumes/CyrusExtSSD/dayhike-lab/lite-spike/`: `captures/` the four views' draw lists and censuses;
`gate-a/`, `pine/` and `terrain/` the pictures compared (`terrain/` with the dumps they were drawn from); `probes/` the three parts' pictures; `rig-2026-11-13/` the baseline's profiles and the replay,
`rig-2026-11-13b/` to `d/` the changing world and its profiles; `fork4/` the counts and pictures of the
fourth tag's changes (`base` Lite at the third tag, `pinned` the fourth); `rig-2026-11-14/` the third tag
timed against the fourth (`node summary.mjs` there prints the table); `view/` the whole view's dumps and
pictures; `rig-2026-11-14d/` the whole view's frame against the game's (`python3 summary.py` there prints the rows).
