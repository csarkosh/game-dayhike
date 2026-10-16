# Scene depth for a post process: WebGPU against WebGL2

A post process that softens the far field needs the camera-space depth of every
pixel it reads. Getting that depth to it is a small job that crosses most of what
separates WebGPU from WebGL2 in one browser engine: how a shader may branch, how a
draw leaves a render target untouched, how several targets are multisampled, which
float textures a sampler may filter, how a lost GPU looks, and what a new shader
variant costs to ship. This note records each difference as it was met in Day Hike
(Babylon.js 9.18, Chrome 157 on an Apple M4, WebGPU through Metal and WebGL2
through ANGLE's Metal backend), with the game as the worked example and the
engines as the subject.

The pass itself is `farSoft.fragment.fx`: past 80 m of depth the frame is blurred
by a radius rising to 5 texels at 450 m, two rings of reads round the texel, each
read kept only where its own depth is not much nearer than the texel's, so the
near grass against the far field keeps its edge. It is the first pass of the
chain on the high and medium tiers (`post.ts`).

## 1. Three places a depth can come from

- **A depth renderer.** Babylon's `DepthRenderer` draws the scene a second time
  into its own target with a depth-only shader. It works on both engines and
  needs nothing of the materials, which is also its flaw: it draws every mesh
  again, and with its own shader, so a material plugin's vertex work (the cards
  turned to the camera, the grass bent by the wind, the far cover widened with
  distance) is not in its depth. Day Hike draws several hundred thin-instanced
  buckets a frame; a second pass over them costs what the far field's own
  savings had bought.
- **The scene's own depth buffer.** The first pass of the chain is multisampled,
  and a multisampled depth attachment cannot be sampled on either engine: WebGL2
  cannot blit a multisampled depth renderbuffer into a texture that a sampler
  reads, and WebGPU allows no resolve target on a depth attachment. A
  single-sampled scene would give it away, and the cards' edges with it.
- **The prepass.** Babylon's `PrePassRenderer` draws the scene once, into
  several targets at once, the materials' own shaders writing their colour to the
  first and whatever else was asked for to the rest: here the camera-space depth,
  `vViewPos.z`, into a second. Every vertex plugin and every alpha test holds in
  it, nothing is drawn twice, and both engines take the same path. This is the
  one that shipped. The pass registers the depth as the one target it needs
  (`_prePassEffectConfiguration`), the prepass's targets become the first pass's
  input, and the multisampling goes to them.

The depth renderer was built first and the rest of this note is why it was
replaced, and what the prepass asked of each engine.

## 2. A branch the GLSL accepted and the WGSL refused

The pass leaves early where the radius is under a fifth of a texel, which is most
of the frame, and samples its two rings only past that:

```glsl
float r = smoothstep(soft.x, soft.y, d) * soft.z;
if (r < 0.2) { gl_FragColor = c; return; }
for (int i = 0; i < 12; i++) { ... texture2D(textureSampler, vUV + o) ... }
```

WebGL2 compiled it and drew it. WebGPU refused the shader:

```
error: 'textureSample' must only be called from uniform control flow
note: control flow depends on possibly non-uniform value
  if ((x_56 < 0.20000000298023223877f)) {
note: return value of 'textureSample' may be non-uniform
  let x_24 : vec4<f32> = textureSample(depthSamplerTexture, depthSamplerSampler, x_22);
```

The rule is WGSL's uniformity analysis. An implicit-level sample needs screen-space
derivatives, derivatives need the whole quad to take the same path, and a branch
on a value read from a texture cannot promise that, so the compiler rejects it
rather than leave it undefined. GLSL ES 3.00 has the same hazard and makes it the
author's problem: the derivatives inside non-uniform control flow are undefined,
and in practice the driver returns something and nothing is reported. The same
text is a warning nobody sees on one engine and a compile error on the other.

The fix is the same on both: every read at an explicit level, `textureLod(…, 0.0)`,
which the translator turns into `textureSampleLevel`, a function the analysis
leaves alone because it takes no derivative. The early leave stays. Babylon's
GLSL goes to WGSL through SPIR-V and Tint at run time, or ahead of time into the
map the build ships (`docs/rendering/2026-10-01-wgsl-map-per-tier-design.md`), so
the error surfaces the first time the stage is translated, which on a machine
without the shipped map is the first time the page is opened.

What the refusal did to the page is the subject of §6: Babylon reported the
failed pipeline as an uncaptured error, the game's handler took it for a GPU
error and rebuilt the renderer on WebGL2, and the rebuild dropped the player's
controls, so the still of the trailhead came out with the pause screen over it.
A shader that fails on one engine is not a visual bug there; it is an engine
change.

## 3. A draw that leaves a target alone

The prepass compiles every capable material with `PREPASS` defined and as many
outputs as there are targets. A material that cannot write them all (`ShaderMaterial`
is not prepass-capable; Day Hike's sky dome, lake mirror and midges are such) is
drawn with only the first target enabled, and the prepass tells the engine so
through one call, `bindAttachments`, that the two engines answer differently:

- **WebGL2** calls `gl.drawBuffers([COLOR_ATTACHMENT0, NONE])`. The framebuffer
  keeps its attachments; the draw writes to the first and the second is left as
  it was. It is a state of the framebuffer, set between draws.
- **WebGPU** has no such call: a render pass's colour attachments are fixed when
  the pass begins, and a fragment stage must declare an output for every target
  it writes. Babylon keeps the attachment list on its pipeline cache
  (`setMRTAttachments`) and bakes it into the render pipeline as a colour write
  mask of zero for the targets the draw leaves alone. The target is still bound,
  the shader writes nothing to it, and the pipeline is a different pipeline from
  the one that writes both.

Babylon's PBR shader carries the seam in its last lines:

```glsl
#ifdef PREPASS
#include<pbrBlockPrePass>
#endif
#if !defined(PREPASS) || defined(WEBGL2)
gl_FragColor=finalColor;
#endif
```

On WebGL2 `gl_FragColor` and `gl_FragData[0]` are the same output, and both lines
run; on WebGPU only the prepass block writes. Anything a plugin does to
`finalColor` after the prepass block would land on one engine and not the other.
Day Hike's plugins all write before it (`CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR` sits
above the block), so the two engines draw the same colour, but it is the kind of
line to know about.

What the untouched target holds is then the clear value, 0 on both engines. The
pass reads 0 as the far sky (`FAR_SOFT_SKY`), so a far tree against the sky blurs
with it as it should, and nothing the sky dome does not write is a special case.

The depth itself costs a varying. Every capable material's vertex stage gains a
`vViewPos` output for the prepass to write the depth from, and on WebGPU that
output counts against `maxInterStageShaderVariables`, which the giants' faded
material already filled at 21 on the high tier (three shadow cascades, a
two-sided fragment reading `front_facing`). Its pipeline failed at the trailhead
with `Total fragment input variables count (22 = 21 (user-defined) + 1
(front_facing) exceeds the maximum (21)`, Babylon reported an uncaptured error,
and the game rebuilt on WebGL2 again. The limit the device is asked for rose to
22 (`WEBGPU_REQUIRED_LIMITS`; the reference adapter offers 28,
`interStage.test.ts` counts the prepass's variable on the tiers with a post
chain). WebGL2 has the same ceiling in `MAX_VARYING_VECTORS`, but counts
vectors the compiler packs scalars into, and no browser raised it here.

## 4. Multisampling several targets at once

The scene is drawn at 4 samples a pixel. With one target that is a multisampled
renderbuffer resolved into the texture (WebGL2) or a multisampled texture with a
resolve target (WebGPU), and the post process reads the resolved texture. With
two targets each needs its own:

- **WebGL2** attaches a multisampled renderbuffer per colour attachment and, at
  the end of the pass, blits each into its texture with `blitFramebuffer`, one
  read and one draw framebuffer binding per attachment.
- **WebGPU** gives each colour attachment of the render pass a multisampled
  texture and a `resolveTarget`, and the resolve is part of ending the pass.

Babylon hides both behind one setter (`prePassRenderer.samples`,
`updateMultipleRenderTargetTextureSampleCount`), and the game sets that instead
of the first post process's `samples`, which with the prepass in front of it would
multisample a target nothing draws into. The depth target is resolved along with
the colour, which averages the depth across a pixel's samples at an edge; for a
gate that asks only whether a neighbour is much nearer, that is fine, and it is
the same on both engines.

## 5. Which float a sampler may filter

The prepass stores its depth in a 32-bit float texture where the engine can
filter one, otherwise in a 16-bit float. Both engines render to both; what they
let a sampler do with them differs:

- **WebGL2** needs `OES_texture_float_linear` to filter a 32-bit float texture;
  without it a linear sampler on one returns nothing useful and no error.
- **WebGPU** makes filtering a validation matter. A 32-bit float texture has the
  sample type `unfilterable-float` unless the device was created with the
  `float32-filterable` feature, and binding it to a filtering sampler is a
  pipeline error. Babylon's WebGPU engine checks the texture's type against the
  device's capability when it builds the bind group layout and, where the
  texture cannot be filtered, demotes the sampler to `non-filtering` and the
  binding to `unfilterable-float` on its own (`webgpuCacheRenderPipeline`).

The pass reads the depth at the texel's centre with an explicit level, so it
never needs filtering, and the demotion costs it nothing. A pass that did
bilinear reads of a 32-bit depth would read the same shader text on both engines
and get filtered depth on one and point-sampled depth on the other.

## 6. Losing the GPU

Three of the first nine runs on WebGPU lost the device, about 25 s after the page
opened, and each time the renderer Babylon rebuilt lost it again some 20 s later;
after the second loss the page could not make a WebGL2 engine either, since the
browser's GPU process was gone with the device (`WebGL not supported`). Chrome's
own log carried one line before each loss, `A valid external Instance reference
no longer exists`, and nothing from Dawn's validation. The losses came with the
depth renderer's map bound and read, and once with the prepass's target bound and
read; a pass that bound the depth and read a constant instead never lost it, nor
did the depth pass drawing with no post process reading it, nor any of six later
runs that read the depth, with and without Dawn's backend validation, with and
without the game's asynchronous pipeline creation. The cause is not found; the
correlation with reading a float render target in a post process is the strongest
there is, and the runs that survived say it is not that alone.

What a lost GPU looks like is itself an engine difference. On WebGL2 the context
is lost and the canvas raises `webglcontextlost`; the GPU process is usually still
there, and a new context on a new canvas works. On WebGPU the device is lost, the
`GPUDevice.lost` promise resolves with a reason, and when the GPU process itself
went down every API it hosted goes with it, WebGL2 included, until the browser
restarts it. Day Hike's engine failure path (`engineFailure.ts`,
`rendererSwap.ts`) rebuilds the renderer on a fresh canvas, a first loss on
WebGPU again and a second on WebGL2, pins the tab to WebGL2 and remembers the
fall-back for the browser version; on the runs above the second rebuild climbed
down the tiers and found no GPU to build on at any, and the page was left with
its world and no renderer. The player sees the pause screen, because a rebuild
releases the pointer.

A shipped renderer cannot leave a one-in-three device loss in a feature. The
softening ships on both engines because every run after the first nine, among
them the full set of the README's seven stills at 75 s each and the trailhead
again after the limit of section 4 rose, drew with the prepass and lost nothing; the loss is kept in view here and in the game's telemetry, where a
lost device is an `engine_failed` event with the reason `lost`.

## 7. Three traps in the prepass that were the same on both engines

Not every difference met was an engine's. Three were Babylon's, and the same on
both, and they took longer to find than the engine differences did:

- **It reads the chain from the scene's active camera.** The prepass decides
  what it draws for by walking the active camera's post processes when it
  updates, which is at the first draw after anything marks it dirty: a pass
  attached or detached, its own creation. The first draw of a frame is as often
  a render target's, the lake's mirror or the impostors' bake, whose own camera
  is the active one while it draws, and it has no chain. The prepass then finds
  nothing, switches itself off, and does not look again until something marks
  it dirty, which in play is the lens pass attaching when rain reaches the
  glass. The game runs the update with the chain's camera active.
- **It writes `applyByPostProcess` every frame.** The prepass sets the scene's
  image processing to run in a post process only when it finds Babylon's own
  image-processing pass in the chain. Day Hike's grade is its own pass, so the
  prepass would set the flag false, every lit material would tone-map in its
  shader, and the grade would tone-map it again. The flag is pinned to the true
  the lighting sets on this path.
- **It takes up every render target the scene draws.** The first time a render
  target clears, the prepass gives it a prepass target of its own and updates,
  which re-reads every material's defines. The impostors' bake is a render
  target made once a cohort, during play, so each bake came with a re-read, the
  bake caught materials mid-recompile and kept nothing, and the far trees stood
  as bare poles on both engines. Every render target of the game's own opts out
  (`noPrePassRenderer`), and the prepass draws for the scene's camera alone.

All three are worth knowing before the engine comparison: a prepass that is silently
off draws the same frame on both engines, with no depth in it.

## 8. What a new shader variant costs to ship

Turning the prepass on compiles every capable material with `PREPASS` defined.
On WebGL2 that is a recompile the browser does the first time it draws each
material, from the GLSL the page already has. On WebGPU each stage must be
translated to WGSL, and Day Hike ships the translations as a map built from a
recorded corpus so a first visit never waits on the translator
(`docs/rendering/2026-10-01-wgsl-map-per-tier-design.md`): a new define on every
material is a new stage for every material, and the corpus is recorded again
before the map is built. Where the map is missing, as on the development server
with `DAYHIKE_SKIP_WGSL_MAP` set, the page translates at run time, and the
render pipelines land one by one (`docs/rendering/2026-09-28-webgpu-async-pipelines-design.md`),
so a still shot at 55 s on WebGPU showed the meadow's trees as bare poles with
their crowns' pipelines still to come, and the same still at 110 s showed them
whole. On WebGL2 the same page at 55 s was complete. The difference is not the
engine's speed; it is where the translation happens.

## 9. What was not measured

No frame times were taken for the prepass against the depth renderer or against
no softening, on either engine; the prepass was chosen on what it does not do
(a second pass) and on the correctness of its depth, not on a measurement. The
device loss has no reproduction. Both belong in the next measurement on the
reference machine and the Windows rig (`2026-09-26-webgpu-high-tier-verification.md`,
§1 for the method): the cost of the second target and its resolve at 4 samples
on each engine, and a run long enough to say whether the loss returns.
