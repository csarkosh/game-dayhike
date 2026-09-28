# WebGPU render pipelines made asynchronously: design

**As built, 2026-09-28**, behind the WebGPU engine's off switch
(`WEBGPU_ENABLED = false`, so reached only with `?engine=webgpu`). Nothing of
it has been measured in a browser yet: §10 lists what a browser must show.

Babylon 9.18.0 throughout; the names below are in its installed
`node_modules/@babylonjs/core`.

## 1. The problem, as measured

Babylon's WebGPU engine makes every render pipeline with the synchronous
`device.createRenderPipeline`, at the draw that first needs it
(`WebGPUEngine._draw` → `_cacheRenderPipeline.getRenderPipeline` →
`_createRenderPipeline`, `webgpuCacheRenderPipeline.js`). Chrome compiles
such a pipeline when it reaches the call in the page's command stream, and
every later command of the page waits behind it: no frame is shown until the
batch is compiled, while the page's own thread is idle.

Measured on a Windows machine with an NVIDIA T4 and 4 virtual CPUs, Chrome
154 on Direct3D 12:

- 91 pipelines (33 of them new to the page) made on a page already drawing
  60 frames a second: made synchronously, **no frame for 21.0 s**; the same 91
  made with `createRenderPipelineAsync`, **57–60 frames every second**, one
  972 ms frame when they were issued, the new ones ready over 2.2–14.3 s.
- In play, when five skinned characters come into view: one frame of
  16.5–18.6 s.
- A first visit spends about 16 s making pipelines in the GPU process.
- A returning player in a normal browser profile is served by the browser's
  own disk cache of compiled pipelines (0.4–1.3 s for a start's 66
  pipelines), but that cache is small, and a place not seen before, or one
  dropped from it, freezes as above.

## 2. What is patched, and why so

`client/src/game/asyncPipelines.ts`, installed by `createWebGpuEngine` once
the engine stands (`installPipelines`), on **that engine's own** pipeline
cache instance (`engine._cacheRenderPipeline`, made in `initAsync`) and that
engine's own `_draw`. Never a prototype: the clear quad's cache, and every
other engine of the page, keep Babylon's path. `remove()` puts both methods
back.

Inside the scope (`enter()` to `leave()`, §4), `getRenderPipeline`:

1. looks the draw's state up with Babylon's own `_lookupRenderPipeline`, the
   sample count normalised as Babylon's `getRenderPipeline` does
   (`WebGPUTextureHelper.GetSample`); a pipeline found is drawn with;
2. on a miss, takes the cache node the lookup leaves in `_parameter.token`. A
   node already being made leaves the draw out. Otherwise Babylon's own
   `_buildRenderPipelineDescriptor` builds the descriptor from the draw's
   state, now (the layouts it makes are the draw's; a skinned mesh's effect
   is re-prepared there as on Babylon's path), the creation is queued or
   started with `device.createRenderPipelineAsync`, remembered by node in a
   `WeakMap`, and the draw is left out;
3. when a creation lands, stores the pipeline in its node exactly as
   `preWarmPipeline` does (`_setRenderPipeline({ token: node, pipeline })`),
   so the next draw of the same state finds it by Babylon's own lookup.

"Left out" is one private error object thrown out of `getRenderPipeline` and
caught by the wrapper on `_draw`, which counts it and returns; any other
throw passes through unchanged. What `_draw` has done by then is safe to
leave, item by item (the comment above the wrapper says why for each): the
render pass begun, the draw's states applied to the trackers, the uniform
buffers bound and written, the draw context's stale bundle dropped, the
texture state written, the cache's own lookup state as after any miss. Not
reached: the bind groups, the bundle encoder, `setPipeline`, the draw and
`_reportDrawCall`. A draw with a live bundle returns before the lookup, so a
draw left out never has one. Snapshot recording, which takes a bundle
encoder before the lookup, is left to Babylon: while the engine renders by
snapshot every draw is Babylon's.

**The last guard.** Every draw reaches the lookup through the engine's own
`_draw` (Babylon's `drawElementsType` and `drawArraysType` are its only
callers, and `_draw` is the lookup's only caller; the canaries count them).
Were a Babylon ever to add another path, the sentinel would leave
`scene.render`, and Babylon's render loop queues no frame after a throw: the
game would stop for good, with no WebGPU error to swap on, which is worse
than the freeze removed. So each scene of a patched engine renders inside a
catch of the sentinel alone (`guardRender`): the patch then comes off that
engine for good, every later draw synchronous, one `console.warn` says so,
`dayhikePipelines.escapes` counts it, and the frame's loop goes on. Any other
throw passes through as before; on WebGL2 and with `?pipelines=sync` no
catch is added.

**Why a run-time patch on the instance.** A fork of Babylon would carry the
whole engine for one method, and a patch on the prototype would reach the
clear quad's cache and every engine of the page. Babylon's public
`engine.createRenderPipelineAsync(options)` cannot make the key of a real
draw: its options fix the texture state at 0 and carry no instance buffers
and no depth bias, so a shadow receiver, a thin-instanced or instanced mesh,
or anything drawn with a depth bias gets a pipeline no draw looks up. Only
the draw site has the whole state, so the patch sits there. Its canaries
(`asyncPipelines.test.ts`) fail when Babylon moves any of the names it uses.

## 3. What the player sees

Frames keep coming. A mesh whose pipeline is being made is absent from every
pass it is in, its shadow too, until the pipeline lands, as WebGL2 with
parallel shader compilation skips a mesh whose program is not linked. At the
start that is behind the held reveal (§6). In play, characters that come
into view appear some seconds late instead of the world freezing.

## 4. Where draws may be left out

Only the draws inside rendering groups: `scopeRenderingGroups`
(`renderer.ts`) calls `enter()` from the scene's
`onBeforeRenderingGroupObservable` and `leave()` from its
`onAfterRenderingGroupObservable`, which bracket each group's mesh, sprite
and particle draws, for the camera and for every render target, shadow maps
included (`renderingManager.js`, `render`). The renderer wires it when it is
given the patch (`RendererOptions.pipelines`, only for a WebGPU engine made
with it), and takes the scope and the patch off in `dispose` (and when its
build throws) before its engine goes, so a swap's old engine starts and
stores nothing more while the new one compiles.

The scope cannot stay open: a throw inside a group skips the group's
after-observer, so every group still open is shut as each frame of the scene
begins (`onBeforeRenderObservable`), and the impostor bake, whose renders
come outside the scene's frames, renders through the scope's `guarded`,
which shuts what its render left open even as it throws. Otherwise a throw
in a bake's render would leave every later post-process and probe draw open
to being left out.

A target drawn once (`REFRESHRATE_RENDER_ONCE`) is a render that is kept, as
the bake's is (§5), so its groups stay outside the scope: the reflection
probe's skybox is drawn on Babylon's path, as before. Babylon's own rule for
such a target is the same in spirit: a mesh not ready in it re-arms the
target rather than being baked out.

What the game draws outside rendering groups, and so on Babylon's path as
before:

| draw | where | now |
| --- | --- | --- |
| clears | the engine's render-pass clears; the clear quad, its own cache | synchronous; the clear quad's cache is not patched |
| the post chain: the scene pass, halation extract and blurs, grade, chromatic aberration, FXAA, finish | `post.ts`, drawn by the post-process manager after the groups | synchronous: no frame is shown without its final composite |
| the BRDF lookup texture's expansion | Babylon's `RGBDTextureTools`, through the post-process manager | synchronous |
| mip generation, the array textures' extra layers included | the texture helper's own pipelines (`mipEveryLayer`) | synchronous, not through `_draw` |
| the reflection probe | `lighting.ts`, a target drawn once | inside groups, but kept out of the scope (above): synchronous |
| the impostor bake | `forestMeshes.ts`, `rtt.render()` outside any frame | inside groups: the bake's rule (§5) |
| the shadow maps | the cascaded shadow generator's target, every frame | inside groups: may be left out, a caster's shadow late |
| rain and motes | particle systems, drawn inside the groups | may be left out |

## 5. The bake's rule

The impostor bake renders once into a texture kept for the life of the page;
a draw left out there would bake a blank or partial tree for good. It never
keeps such a render (`renderedWhole` in `forestMeshes.ts`, from its poll),
because its structure already allows it (it is asynchronous and bounded):

1. at each poll, readiness first (`rtt.isReadyForRendering()`): a target not
   ready is never rendered, and the bake goes back to its 16 ms poll, as
   before; Babylon itself leaves a mesh that is not ready out of a render
   without a draw, which no count of left-out draws would see;
2. on a ready target, a render, the count of left-out draws read just before
   and just after it (`takeSkipped()`): kept if it left nothing out;
3. otherwise the bake renders again every `BAKE_PIPELINES_POLL_MS` (250 ms),
   readiness checked first each time, until a render is whole. It waits for
   its own pipelines only: a pipeline it already asked for is not asked
   for again, and a render finds its pipelines as soon as they land, whatever
   else the engine is still making;
4. once what is left of the bake's own bound (`IMPOSTOR_BAKE_FAIL_MS`, 120 s
   from its start) has run out, one more render, as a target drawn once,
   which the scope leaves on Babylon's synchronous path (§4): its pipelines
   are made as before, while the page waits;
5. a render that still left something out is not kept: the bake fails as a
   compile failure does, with one `console.error`, and that billboard's
   bucket is disabled.

Every render goes through the scope's `guarded` (§4). This is better for the
player than a bake always made synchronously: the bake's pipelines are made
without a freeze, and the fallback keeps the old behaviour as a floor.

## 6. The reveal

With draws left out, the first frames would show a world with holes. The
start keeps the world hidden (its canvas invisible under the "Loading…"
line) until the end of the first frame that left no draw out, once the
engine has asked for a pipeline (a frame before any draw has met the cache
is an empty world, not a whole one), and at most `REVEAL_PIPELINES_MAX_MS`
(10 s) after the end of the first frame, after which it lifts anyway
(`revealWhenWhole`, `app.ts`). A switch of tier, a failure's rebuild, or the
game's end lifts it at once; their own covers take over. On WebGL2, and on
WebGPU with `?pipelines=sync`, nothing is held.

The line is shown only while the game's own HUD says nothing
(`holdReveal`, `revealHold.ts`): a follower sees "Connecting…" alone, and
"Loading…" once that has gone, if the world is still held.

**A switch's cover.** A switch of tier, the governor's drop and a failure's
rebuild wait under a cover for the new scene (`whenSceneReady`); on WebGPU
the cover then also waits for a frame that left nothing out
(`whenFrameWhole`), within what is left of the same bound (`made.leftMs`
less the scene's wait), so meshes do not appear after the cover lifts. The
covers' own bounds are not lengthened.

The longest start is therefore, on WebGPU with the patch, the start's
existing bounds ("Loading…" for at most `WEBGPU_FETCH_MS` + `WEBGPU_START_MS`,
20 s, where both stall), the build, the first frame, and 10 s more; on WebGL2
and with `?pipelines=sync` it is unchanged. The engine's own start budget is
untouched: the engine is handed over before any of this.

## 7. Failure

A creation that rejects marks its node failed: the node's next draw takes
Babylon's own synchronous path, which raises the validation error where it
is raised today, so the failure watcher (`watchWebGpu`) and the live swap to
WebGL2 behave exactly as before. A node marked failed is never tried
asynchronously again. The first rejection is said once, with its message, in
a `console.warn`.

A creation still in flight `ASYNC_PIPELINE_MAX_MS` (30 s) after it was
started (not queued) is given up the same way: its node is marked failed,
so its next draw takes the synchronous path, its slot in flight is freed for
the queue behind it, the first such is said once in a `console.warn`, and
`dayhikePipelines.expired` counts it. One that lands after its deadline
stores nothing. A creation that never settles can therefore neither keep a
mesh out for good, nor starve the governor of windows, nor stall the queue. Once the engine is disposed, its device lost, or the
patch removed, nothing is started and nothing is stored into a node (a
creation still pending at a loss lands as a pipeline of a lost device), and
every draw is Babylon's.

## 8. The limit, and the governor

At most `ASYNC_PIPELINES_MAX_IN_FLIGHT` creations are in flight at once,
`max(2, navigator.hardwareConcurrency − 2)`, computed once, and 2 where the
browser does not say; the rest wait first in, first out. It is a first
value, to be measured: the browser compiles asynchronous creations on a pool
of threads, and the bound keeps a burst from taking every core the page and
the GPU process need.

An asynchronous creation is not a hitch and does not raise Babylon's count
of the pipelines a frame made synchronously (`NumPipelineCreationLastFrame`).
But a frame that left draws out is cheaper than a whole one, so
`watchPipelines`, which the governor reads, voids a window in which a
pipeline was made synchronously **or** a draw was left out (`leftOutOn`,
counted per engine). The other readers of frame times: the governor's idle
timing runs with the render loop stopped, so nothing is drawn or left out;
the probe's steps build their renderer without the patch, so every draw is
Babylon's; the switch's cover waits on the scene, the forest's bakes and a
frame that left nothing out, not on frame times.

## 9. The address switch, and what a measurement reads

`?pipelines=sync` leaves Babylon's path as it is (the control); `?pipelines=async`,
or nothing, installs the patch at the page's limit; `?pipelines=<n>`, 1 to
16, installs it with `n` in flight (`parsePipelines`, `engineChoice.ts`).
`globalThis.dayhikePipelines` is the report of the page's latest WebGPU
engine: the mode, the limit, the pipelines asked for asynchronously, landed
and failed, those given up at their deadline, those made synchronously
(Babylon's per-frame count, summed), the draws left out, the frames a
left-out draw escaped (the patch then off), the longest time from asked to landed (the queue's wait
included), and what is pending now.

## 10. What a browser must still show

- The page that made 91 pipelines: frames every second throughout, against
  the synchronous control, and how long the new ones take to land at the
  default limit and at 1, 2, 4 and 8.
- The start: the reveal's time from the first frame, the longest frame after
  it, and a still at the reveal with no mesh missing.
- The characters coming into view: the longest frame, and how late they
  appear.
- The five impostor bakes baked whole (pixels in each), on a cold start.
- The reflection probe lit on the first revealed frame.
- A pipeline that fails validation still ending in the live swap to WebGL2.
- The governor not dropping a tier on the frames that left draws out.
- A swap of tier on WebGPU: the old engine's queue gone, nothing drawn with a
  pipeline of the old device.
- `dayhikePipelines` read at 60 s on each of these.
- Whether Chrome settles every `createRenderPipelineAsync`, a device loss
  included, and in what order against `device.lost`: `pending` back to 0 on
  the 91-pipeline page, and after a forced device loss.
- Whether Chrome also raises `uncapturederror` for a rejected asynchronous
  creation (the swap then comes one draw earlier).
- Whether a canvas at `visibility: hidden` keeps the clicks that engage the
  pointer lock during the hold: click during the hold, and see what engages.
- How late the Hollow appears when it comes into view mid-chase: from its
  first left-out draw to its first drawn frame, at the default limit.
- A console across a whole hike with no uncaught "a draw left out" error,
  and no `escapes`.
- The five bakes with pixels in each on a cold start, one of them forced
  down the fallback (a short `failMs` and `?pipelines=1`).
- A follower's reveal: a still at the lift and one at spawn, with
  "Connecting…" and "Loading…" never shown together.
- After a WebGPU switch of tier, no mesh appearing after the cover lifts.

## 11. Considered and not built

**A batch made ahead at the start.** The start's pipelines made
asynchronously as one batch at the very start of a page removed the stall on
that machine, but delayed the first frame by 4–5 s: the page's thread was
held 8.7–10.2 s against 4.8 s. And Babylon's key cannot be recorded from one
load to the next (an effect's `uniqueId` is part of it). So pipelines are
asked for when a draw needs them, and how many compile at once is bounded.

**Babylon's public `createRenderPipelineAsync(options)`**, for the reasons in
§2: it cannot make the key of a real draw.

**Spreading synchronous creations over frames.** Each synchronous creation
still holds every later command of its frame; a budget per frame only makes
the freezes shorter and more numerous.
