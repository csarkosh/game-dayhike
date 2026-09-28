# Where WebGPU can buy time without changing a pixel

A read of every part of the renderer against Babylon.js 9.18.0's WebGPU engine, asking one
question: with the picture held fixed (same pixels, same fullness, same draw distances,
same effects), where does running on WebGPU save frame time or load time, and how much?

Nothing here was measured for this note. Each figure is graded:

- **measured**: taken from an earlier note, which is cited;
- **derived**: arithmetic from measured figures or from bytes moved, shown;
- **guess**: an estimate with no measurement behind it.

Every engine capability named was read in the installed engine's source.

## 1. Two facts that decide the ranking

**The frame is limited by the GPU.** At the canopy pose on the high tier at 1200 × 2029 on
WebGL2 the frame is 24.2 ms and the JavaScript inside it is 3.79 ms, over 222–229 draws
(the WebGPU verification note, §3.1). Work removed from the CPU frees the main thread but
does not move the frame's mean at that pose. No pose measured so far is limited by the
CPU; the spawn pose is the likeliest and has not been measured.

**The engine's own gain grows with the pixel count.** WebGPU alone read 1.53 ms faster at
2.4 Mpx and 9.93 ms faster at 9.7 Mpx. A gain that grows 6.5× when the pixels grow 4× is
not per-draw work, and it grows faster than the pixels do, which plain per-pixel work would
not: that points at memory bandwidth or cache effects, in what each render pass loads,
stores and resolves. So the largest remaining levers are in how the passes are structured,
not in culling or in how draws are submitted.

**What an API cannot do.** A fragment shader costs the same on either engine. The ground
(45–80 texture fetches a pixel), the blades (0.84 of their 1.05 ms is raster and fragment
work), the cards, the duff and the fog have no WebGPU lever for their shading.

## 2. Candidates, ranked by saving for the work

| # | Candidate | Saving | Grade | Work | WebGL2 |
|---|---|---|---|---|---|
| 1 | Per-pass GPU timers on measurement builds | none itself; it settles 2, 3, 5 and 9 | — | one feature request | unchanged |
| 2 | The main pass without 4× multisampling, on tiers that run the post chain | up to 0.7–0.9 ms native counting one store, 2.2–2.6 ms counting the three begins' stores; about 4× those at 4× pixels | derived, an upper bound | one engine option | unchanged |
| 3 | Discard the scene target's samples and depth once resolved | up to 1.1–1.3 ms native, up to 4–5 ms at 4× | derived, an upper bound | small to medium, an engine internal | has the same lever (`invalidateFramebuffer`), unused today |
| 4 | Keep translated shaders between visits | load time on a return visit | guess | small | unchanged |
| 5 | A hardware depth clamp for the shadow pass, and a depth-only shadow map | 0.1–0.5 ms | guess | medium, an engine patch | unchanged |
| 6 | Native shader source for the atmosphere, skin and cliff-tint plugins | 0.2–1.5 s off load, and the same share of the join hitch | guess | small | unchanged |
| 7 | Blades culled and counted on the GPU | 0.1–0.2 ms at rest (derived); 0.19–0.35 ms of JavaScript a frame while turning (measured on WebGL2) | mixed | large, engine internals | keeps the CPU filter |
| 8 | Shadow casters culled per cascade on the GPU | 0.3–1 ms | guess | large | cannot do it cheaply |
| 9 | Translated shaders built ahead of time | load time on a first visit | guess | medium to large | unchanged |
| 10 | Native shader source for the terrain | 50–150 ms a build, at load and at each join or leave | guess | large, two sources kept in step | unchanged |
| 11 | Native shader source for everything, dropping the translators | 2.66 MB of download (0.9 MB compressed, measured) and all translation time (guess) | mixed | large, about 1,325 lines | unchanged |

### 2.1 The two pass-structure candidates (2 and 3)

**The main pass.** The WebGPU engine is created with `antialias: true`, so the canvas's
own pass is a 4-sample colour target with a 4-sample depth and stencil target. On the high
and medium tiers the only thing drawn there is the last post-process's full-screen quad;
the scene's anti-aliasing happens earlier, in the first post-process's own 4-sample
target, which this option does not touch. Four identical samples resolve to the value a
single sample would have written.

The ceiling depends on which traffic is counted:

- 88 MB a frame (the 4-sample colour, 39 MB, and the 4-sample depth and stencil, 49 MB,
  stored once): 0.73–0.88 ms at native;
- 264 MB a frame (the pass is begun three times a frame, for the scene's clear, the
  camera's depth clear and the final quad, and each begin ends in a store): 2.2–2.6 ms at
  native, and more if the second and third begins also load what the one before stored.

Both are bytes moved divided by an assumed 100–120 GB/s, and both are ceilings. The
traffic is clears and identical samples, which the GPU's framebuffer compression handles
well; the real figure could be a few tenths of a millisecond. With it go two options that
work on either engine: no automatic clear of the canvas where the post chain runs (one
pass fewer), and no stencil (the game uses none).

Proof of sameness: a still pair with the sun, the grain and the clock pinned, expecting no
changed pixel. The one place a difference could appear is a single least-significant-bit
step along the quad's diagonal.

**The scene target.** Its 4-sample colour (RGBA16F) and 4-sample depth are written to
memory at the end of the pass every frame, and nothing reads them again: the resolve
happens inside the pass. The engine hard-codes the store on every attachment; the one
reason its source gives, on the canvas pass's colour attachment, is that a pass begun
several times on one attachment would break, and the render-target path follows the same
rule without comment.

This candidate is not WebGPU's alone. WebGL2 has `invalidateFramebuffer` and
`invalidateSubFramebuffer`, which discard an attachment's contents after the resolve copy,
and neither the engine (9.18.0) nor the game calls either. So the same saving is open on
WebGL2, which is what every player runs today.

On WebGPU it is only safe while that pass begins exactly once a frame. By reading it does
(one rendering group, no render target drawn mid-scene), but a compute dispatch, a mipmap
generation or a readback in mid-scene would end the pass and begin it again, and a
discarded attachment is defined to read as zeros, so the second pass would load zeros in
place of the first pass's samples. So it ships with a count of begins per frame, checked at
run time, and the rule that any compute work is dispatched before the scene pass starts.

### 2.2 The shader pipeline (4, 6, 9, 10, 11)

On WebGPU the game's material plugins are GLSL, so every material's whole shader is
translated to WGSL in the page, synchronously, on the main thread, by two translators that
are downloaded first (943,680 B and 1,702,916 B). The atmosphere plugin sits on every PBR
material, so none can use the engine's native shaders until it has a native twin.

What is already native: the shadow depth passes, the built-in post-processes (the blurs,
chromatic aberration, FXAA), the particles.

What has never been measured is what translation costs per shader. One timing wrapper
around the engine's stage compile answers it, and that figure grades 4, 6, 9, 10 and 11
at once. Two things are worth knowing before it is taken:

- The translators can be dropped only when nothing at all is left in GLSL: nine plugins,
  three post shaders and the sky.
- A native PBR shader keeps its uniforms differently (in each effect's shared buffer
  rather than a buffer per material), so the JavaScript frame could move either way.

Keeping translated output between visits (4) is the cheap form: same translator, same
input, so the same output by construction; the first visit is unchanged and a stale entry
is only a miss.

### 2.3 Culling on the GPU (7 and 8)

The earlier trial of compute-culled blades was compared against WebGPU with no filter. The
per-frame CPU filter has shipped since. Against it, what compute culling adds at a still
pose is the difference in kept share (0.263 against 0.121) at 1.17 ms per unit share:
about 0.17 ms. That is under the 0.3 ms the WebGPU design asks of it at a still pose. Its
other gain, the CPU filter's 0.19–0.35 ms a frame while turning, is JavaScript and is
hidden on a frame the GPU limits.

The engine has no public way for the GPU to set an instance count. Compute can write
instance data in place through public calls; the count needs engine internals.

Two cheaper moves reach part of the same saving on both engines: the tier band test added
to the CPU filter (kept share 0.263 → about 0.18), and one buffer per bucket in place of
three (upload calls 54 → about 18 a pass, about 0.28 ms a pass at the measured 6.6–8.9 µs
a call).

Per-cascade culling of shadow casters (8) is the one culling lever WebGL2 cannot match
cheaply, but what the casters cost has not been measured. Removing each caster group from
the shadow pass on a measurement page bounds it; under 0.3 ms, it is dropped.

## 3. Found on the way: the same picture for less, on either engine

| Lead | Saving | Grade |
|---|---|---|
| The terrain is drawn early, so its shader runs under everything drawn over it later; a depth pre-pass or drawing the large occluders first gives the same pixels | not estimated | — |
| At least 9 of a pure-grass pixel's texture fetches are multiplied by exactly 0 | not estimated | — |
| A lamp that is off is still evaluated on every lit pixel | not estimated; grows with the party | — |
| The 12 relief maps are decoded, drawn to a canvas, read back and copied twice before upload | 30–120 ms at load | guess |
| The tier band test in the grass filter | about 0.1 ms on WebGPU, 0.04 ms on WebGL2 | derived |
| One instance buffer per bucket instead of three | about 0.28 ms of JavaScript a filter pass | derived |

## 4. Three things to check, whatever is built

**A possible wrong read on WebGPU.** The engine's pipeline cache leaves a vertex buffer's
byte offset out of its key. The branch works around that for buffers the game builds, and
its design says nothing on main meets the defect. The model loader may: it builds
interleaved buffers, and after the transform is baked in only the UVs stay interleaved.
`understory.fern` keeps them at offset 24 of a 48-byte stride and `understory.shrub` at
12, with the same material shape and the same plugins. If the two share a compiled effect,
one reads the other's UVs. The trial's dimmer fern was put down to image-based light; this
would explain it too. The check: on WebGPU, log each bucket's effect and its UV buffer's
offset, and take a still pair against WebGL2 at a pose with ferns.

**An unmeasured hitch.** A hiker who joins brings a lamp, and a new light gives every lit
material a new shader variant. On WebGL2 those compile in parallel while the old shader
keeps drawing. On WebGPU they are translated one after another in the frame the join lands
in, the terrain's among them. The design's scripted minute never triggers it.

**The halation's shape.** The blur takes its step from the size of the target it writes.
The horizontal pass writes a quarter-size target and the vertical pass writes a full-size
one, so the horizontal reach is 33 quarter-size texels (about 132 px) and the vertical
reach 33 px: the glow is four times wider than it is tall. The vertical pass also runs at
full size, about 41 M filtered taps a frame (0.35–1.4 ms at native, derived from an
assumed sampling rate). Running it at quarter size saves that on either engine but changes
the glow's height unless its step is pinned, so which shape is wanted has to be settled
first.

## 5. Looked at, with no lever found

| Item | Why |
|---|---|
| Snapshot rendering, either mode | It records the whole frame's draws and replays them; culling, the grass filter, the clipmap, the wildlife and the lamps change the draw set on nearly every frame. |
| Non-compatibility mode | A CPU saving, hidden at every pose measured; it does not re-check cull, blend or depth state on a replayed draw, and replaced buffers would replay stale. Worth a second look only if the spawn pose proves CPU-limited. |
| Clustered lighting | Available on both engines, and its range cut changes pixels past 25 m. |
| Occlusion queries | Results arrive a frame or more late, so geometry can drop out on a turn. |
| Texture compression | The same formats are chosen on both engines. |
| Shadow maps cached between frames | The cascades follow the camera and the sun moves. |
| Merging post passes, or smaller post formats | Each pass needs the one before it finished; a smaller format changes precision the dither depends on. |
| The pipeline pre-warm | It assumes no float or depth textures and no instance attributes, so it misses the terrain, every shadow receiver and every instanced layer. |
| Vertex pulling | Only in the native shaders, so out of reach while the materials are GLSL. |
| The ground's shading, the fog, the cards, the blades' fragments | Fragment work. |
| The meadow cards, the forest's impostor quads | Culling them is worth about 0.05 ms and 0.06 ms. |
| Ground animals | The engine has no compute skinning. |
| The forest impostor bake | A load cost, and slower on WebGPU for the translation; baking ahead would change its lighting. |

## 6. The order to measure in

1. Request the timestamp feature on a measurement build (Chrome steps its timestamps by
   65,536 ns, about 0.07 ms, unless its developer features are on) and read each pass's GPU time at
   the canopy and meadow poses, at native and at 4× pixels, on the high and medium tiers.
2. Candidate 2: the option off against on, by pass time and by page pairs in both orders;
   the still pair.
3. Candidate 3, the same way, with the begin count.
4. The translation timing wrapper over a cold start and over a second hiker joining, with
   the same join on WebGL2 beside it.
5. The fern and shrub check.
6. The shadow casters' cost, one group removed at a time.

Candidates 2 and 3 are kept only on a saving that every page of a round shows and that a
same-code round does not.
