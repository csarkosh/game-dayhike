# WebGPU on the high and medium tiers: design

**As built.** Task 1 so far, shipped switched off (the next paragraph). This
is the design as written on 2026-09-26, from
the WebGPU blade culling spike (`docs/rendering/2026-09-26-grass-webgpu-spike.md`,
on the spike's branch `worktree-grass-webgpu-spike` until the plan's Task 1
brings it over, and its code commit `781e4a2`). The plan
([2026-09-26-webgpu-high-tier-plan](2026-09-26-webgpu-high-tier-plan.md))
builds it in eight tasks on a fresh branch from `origin/main` (`ba0fd95`); the
engine reaches a player by default only at Task 6, after the parity and frame
gates. When the work lands this paragraph is rewritten to say what shipped and
with what values; the sections below stay the design as written.

**Task 1, as built.** The rule, the overrides and the fallback of §5, switched
off (`WEBGPU_ENABLED = false`), so WebGPU is reached only with
`?engine=webgpu`. Three decisions of 2026-09-26 are written into the sections
below:

- The rule covers the **high and medium** tiers: one constant,
  `WEBGPU_TIERS = ["high", "medium"]` in `engineChoice.ts`, which
  `chooseEngine` reads (and takes as a parameter in its tests), so a change of
  tiers is one line with its test. Low and the landing backdrop stay WebGL2.
  Tier detection is being redesigned on its own (§4). §1, §2, §4, §5.1, §5.7,
  §7.1, §13.1 and §14–§16 are amended, and the gates are measured on both
  tiers.
- One frame bar for both tiers: a gain above the same-code floor at the canopy
  pose, no standard pose slower than its floor, and parity; 1.5 ms on high is
  the expectation, reported, not the gate (§1, §3.2, §13.1, §16).
- Before Task 6, a failure after the game starts is handled by a live
  renderer swap, never a reload; the tier-detection work provides the swap
  (§1, §5.5, §13.6). A pipeline failure or an uncaptured WebGPU error, inside
  the startup window or after it, swaps now onto a fresh WebGL2 canvas and is
  remembered. A first lost device in 24 h retries once, on a new WebGPU engine
  on a fresh canvas; a second within 24 h swaps onto WebGL2 and is remembered.

Where the code differs from the text below, or adds to it:

- **The order, and two budgets measured apart** (`resolveWebGpu`), in place
  of §5.4's 15 s. A page without `navigator.gpu` fetches nothing. Otherwise the
  engine's module is imported, the adapter asked, and only where it fits are
  the translators fetched and the engine made: module, probe, translators,
  engine. The fetch's 10 s (`WEBGPU_FETCH_MS`) is a running total over the
  module and the translators; the GPU's 10 s (`WEBGPU_START_MS`) over the probe
  and the engine. A fetch that fails or runs out is WebGL2 for this load and is
  not remembered, since nothing of the GPU failed; a probe that does not
  answer, or an engine that fails or runs out, is remembered (`init`). A probe
  that fails, or finds no adapter that fits, is WebGL2 with no record, and
  fetches no translator. "Does not fit" is not remembered: with this order it
  costs a browser one cached chunk and an adapter request or two, and a stored
  verdict would outlive a driver update or a changed GPU, which leave the
  browser's version alone.
- **The wait is not blank.** While the engine is chosen, the page shows
  "Loading…" over the canvas in the HUD's status line, the word the landing's
  Play button showed; on the WebGL2 path there is no wait and no line.
- **The translators, started before the engine and handed to it.** Babylon
  9.18 loads them on the first GLSL effect, not in `initAsync`, and its loader
  waits rather than rejecting when a fetch fails. Their two loaders also
  collide: each is a classic script declaring a top-level `var Module`, its
  emscripten factory, and each translator starts from whatever `Module` is
  there when it is started. Loaded together (as first built), the later
  script's won, glslang was started on twgsl's factory and never came up, and
  every WebGPU start fell back after 10 s, remembered (the verification
  note, §3.2). So the translators' step, once the adapter fits, fetches both
  `.wasm` files whole and checked (so the loaders' own fetches come from the
  HTTP cache), then runs glslang's loader through Babylon's
  `Tools.LoadScriptAsync` and starts glslang at once, while its own `Module` is
  the one there, then does the same for twgsl, and hands the two started
  translators to `initAsync` (glslang as a promise, twgsl as the instance, as
  Babylon's options take them), so Babylon neither runs a loader again nor
  calls a factory. It fails at once where a script does not load, where a
  loader ran but defined no `glslang` or `twgsl` (this host answers a missing
  script with its HTML page, status 200), or where a translator is not
  WebAssembly. `createWebGpuEngine` then awaits `prepareGlslangAndTintAsync()`,
  and switches the materials to GLSL only once the engine stands. The started
  translators are kept for the page's life: every later engine (the live swap
  makes a new one on every switch onto WebGPU) takes the same ones rather than
  fetching and compiling about 2.6 MB again (Babylon keeps its first twgsl in a
  static anyway); a start that failed is dropped, so the next one tries again.
  So is one that has not come in within `WEBGPU_FETCH_MS`: it is abandoned
  there and runs no loader after, so a stalled start holds no later attempt in
  the page. Its WebAssembly downloads are not aborted: served content-hashed
  and immutable, on a slow link they finish into the browser's cache, and a
  later attempt (in the page, or on the next load) starts from it rather than
  running out of the budget again.
- **A lost device stops Babylon's own restore.** Babylon notifies a loss and
  then starts restoring the engine; since the page reloads (and, once it
  lands, swaps renderers), `watchWebGpu` replaces that restore with nothing on
  the engine as it hears the loss. Left to run, it logged a restore and threw
  in the seconds before the reload landed (the note, §3.3).
- **Texture compression.** The device asks for `texture-compression-bc`,
  `-etc2` and `-astc` where the adapter has them (`featuresToRequest`): the
  features Babylon reads its compressed-format caps from, so KTX2 textures stay
  compressed on WebGPU. §5.4 step 3 lists none.
- **A throw while the game is built on WebGPU** (the painted signs, until §6.6
  lands) counts as a failure in the startup window: remembered (`pipeline`) and
  reloaded onto WebGL2.
- **The reload onto WebGL2** carries `?engine=webgl2` wherever a plain reload
  would start WebGPU again: where storage throws, as §5.6 says, and where the
  URL carries `?engine=webgpu`, which outranks the record. Where storage refuses
  the record, the tab's URL is pinned to `engine=webgl2` by
  `history.replaceState` even when nothing reloads.
- **A lost device never replaces a record of another reason that still
  holds**, so a remembered fault is not retried after a loss.
- **The overrides stay on their page** (§5.3, now true by construction): the
  route a host announces drops `engine=` and `tier=`, and a follower compares
  routes in one canonical form, the path and the other parameters decoded and
  sorted (`sameRoute`), and keeps its own overrides when it moves.
- **The startup window** is kept as the times of the first frame and the last
  compile, and read when a failure arrives, rather than by timers.

**Joined with tier detection, as built.** The tier detection work
(`2026-09-26-quality-tier-detection-design.md`, §7.8, §9, §10) is merged in,
and the two starts are one; where this changes the text above and below:

- **One chain.** "Loading…" from the first moment; the GPU's signals; the
  tier (the address's `?tier=`, else the saved choice, else Auto with its
  probe); only then the engine the rule gives that tier, on the game's
  canvas, made once the probe is done ("Loading…" again while it is made);
  then the launch, which logs `quality: <tier> (<source>, <class>), engine
  <engine>` once the first renderer stands (`launchLine`): as a switch logs
  its build, the tier it was built at and the engine it draws with, with the
  source `fallback` where the tier decided did not build and a lower one did
  (whose own error lines come before it). One catch covers all of it
  (`startHike`).
- **One adapter request.** The signals ask for the adapter once
  (`readSignals`) and carry its limits, fallback flag and features; the rule
  reads them there (`adapterFromSignals`), and `probeAdapter` with Babylon's
  `IsSupportedAsync` is gone. The signals give up at 2 s, which means not
  known yet: the rule then waits on the same request within the GPU's 10 s,
  and only running out of that is remembered. Babylon's `initAsync` still
  asks for its own adapter when an engine is made (`webgpuEngine.pure.js`
  line 401); nothing lets it take the page's.
- **The overrides are one set,** `engine=`, `tier=` and `probe=`, carried
  across the page's own navigation (so `?tier=high` on the title still sets
  the hike Play starts) and stripped from every route a host announces
  (`router.ts`).
- **Probe steps draw on the rule's engine** for their tier, on their own
  canvas; a WebGPU step that fails, to start or in its frames, is the rule's
  `init` failure and is measured again on WebGL2. Only the step listens to
  its engine. Auto's verdict carries the engine it was measured with (only
  WebGPU's is written, so WebGL2 records are unchanged), and holds only for
  it; the probe attempts stay per GPU and browser, and a verdict written for
  another engine than the one the next load looks it up under keeps them, so
  the three-attempt cap holds however the key and the reading differ.
- **No reload is left.** A pipeline error or an uncaptured one, whenever it
  comes, swaps the renderer onto WebGL2 at once through the live rebuild; a
  first lost device retries once on a new WebGPU engine, a second within
  24 h swaps onto WebGL2; each is remembered, the URL pinned where storage
  refuses or `?engine=webgpu` outranks the record (`failureSwap`), and the
  HUD says so, naming what the rebuild ended on. The startup window is gone.
  One failure of an engine is answered once, and not at all once a switch
  under way has already left that engine. A renderer that cannot be built on
  its WebGPU engine, at the start or in a swap, has its tier built again on
  WebGL2 before the tier ladder goes down, and the fault is held against the
  engine only once that stands (a tier that fails on WebGL2 too is the
  tier's fault); every later rung is WebGL2, which is the rule's answer
  there. A start that throws on WebGPU after its renderer is started again on
  WebGL2 on a fresh canvas that replaces every canvas in the container. A
  Settings Apply or a governor's drop takes the engine the rule gives the new
  tier. All of this is `engineFailure.ts`, tested sequence by sequence.
- **Only a standing engine is listened to, and only for itself.** The
  watcher comes off before anything of an engine is disposed, and Babylon
  reports no loss of a device its own dispose destroyed (the `device.lost`
  handler returns once the engine is disposed), so a disposed engine is never
  taken for a failing one. An uncaptured error is heard on the engine's own
  device (`uncapturederror`), not in Babylon's log, which every engine of the
  page writes to. Babylon's own restore after a lost device, which would make
  a new device on the same engine, is given up on every engine as it is made
  and as it is watched (`giveUpRestore`); nothing here relies on it. A
  failed rung's engine is released once, by `createRenderer`, after its
  BRDF lookup texture.
- **The governor on WebGPU.** The engine fires
  `onAfterShaderCompilationObservable` for every effect it translates, as on
  WebGL2, but makes each render pipeline at the effect's first draw, a frame
  or more later; the governor voids the frames that made one as well
  (`watchPipelines`, reading Babylon's per-frame count).
- **The early teardown holds on WebGPU.** Model loads end through the shell's
  abort on either engine; a given engine is disposed when the build throws;
  the BRDF lookup texture is expanded on WebGPU by the same path (only the
  decode shader's language differs), so `releaseEngine` waits for it there
  too; the forest's bakes stop on the shells' one abort.

**Task 3, as built.** `offsetKeyedVertexBuffer` (`webgpuVertexBuffer.ts`) keys
the hash by the offset through an accessor on the vertex buffer instead of a
replaced `_computeHashCode` (§10). Babylon 9.18 recomputes the hash only by
assigning `hashCode`, from the constructor and from the `instanceDivisor`
setter when instancing flips; the accessor's setter keeps what Babylon assigns
and its getter adds `byteOffset × 2^24`, so neither of those paths, nor any
later direct assignment, can drop the term. The key stays exact because the
engine's tree cache looks it up as a property of a plain object
(`webgpuCacheRenderPipelineTree.js`), where an integer's string is exact below
2^53, and a byte offset under WebGPU's default 2^28 buffer size keeps every key
below 2^52 + 2^24. Four canaries in `webgpuVertexBuffer.test.ts` say when a
Babylon upgrade changes the ground: two plain vertex buffers at different
offsets still hash alike; the whole vertex-state key block is unchanged (so
the fix Appendix A suggests, which keeps the key line and adds an entry, fails
it too, and the test checks that it would); the tree still looks keys up on a
plain object; and the hash is still recomputed by that assignment, from those
two places only. The source scan of §10 lives in the same test file and is
stricter: no other file under `client/src` makes a vertex buffer at all. Not
covered: the grouping of consecutive attributes into one GPU buffer, which a
mismatch of can turn either way by draw order, into a silent wrong read or a
validation error; Task 7 carries the rule that avoids it. Nothing on `main`
calls the workaround yet; Task 7 is its first caller. Appendix A stays the
draft, with two claims corrected (the hash is public API, not read elsewhere;
the grouping mismatch goes either way; the workaround as the accessor built),
and nothing is filed.

**Task 4, as built.** §9, with four departures. `defaultBakeImpostor` takes
the options `{ signal, warnMs, failMs }` in place of `timeoutMs`, and on each
16 ms poll asks, in order: aborted (the forest's `AbortSignal`, fired first
thing in `dispose`: the target disposed, null, nothing logged); ready (it
renders once, as before, so a fast bake on either engine renders exactly as
it did; an effect that is ready bakes even with an error left on it from a
recompile that failed after an earlier one drew); failed (a bake clone's effect
reports a compilation error **and** has no fallback left, `allFallbacksProcessed()`:
PBR retries a failed compile with fewer defines on the same effect, the error
still set until a retry lands, so an error alone is not final; one
`console.error` naming the model, then null); or given up. The departures:
- **A bound after all.** At `IMPOSTOR_BAKE_FAIL_MS` (120 s, about four times
  the slowest cold WebGPU bake seen) a bake still waiting stops, logs one
  `console.error` and resolves null, recorded `failed`: a failure nothing
  reported must not poll for the life of the page.
- **The 30 s line is a warning** (`console.warn`), not an error: a routine
  cold WebGPU bake can cross 30 s and land, and must not trip §13.5's
  zero-error bar.
- **Translation failures reach the bake** through Task 1's
  `catchTranslationFailures` (below), which records them on the effect.
- **The records are the renderer's to give**: `ForestMeshes.impostorBakes()`
  (each billboard baking, ready or failed, with the milliseconds it took) is
  handed out by `Renderer.impostorBakes()`, so Task 4's gate reads when each
  landed without a hook of its own.

`adoptBake` logs a null that is not an abort, naming the billboard. The
compilation error is read from each clone's draw wrapper for the bake's own
render pass without creating one (`SubMesh._getDrawWrapper`, internal),
pinned by a canary with `Effect.getCompilationError` and
`Effect.allFallbacksProcessed`. What only a browser can show: how long the real
compiles take on each engine, whether the 30 s warning fires on a cold WebGPU
start, and the billboards' pixels; Task 4's gate records those.

**Task 1, as built, the translation-failure path** (found with Task 4).
Babylon 9.18's WebGPU engine translates GLSL inside an async
`_preparePipelineContextAsync` whose promise its caller neither awaits nor
catches, so a shader glslang refuses left its effect not-ready for good, with
no compilation error, no fallback tried and nothing on
`onEffectErrorObservable`: §5.5's "a shader fails to translate… detected by
`engine.onEffectErrorObservable`" could not fire. `createWebGpuEngine` now
installs `catchTranslationFailures` on the engine instance: it catches that
rejection and hands it to the effect it belongs to (found among the engine's
compiled effects by its pipeline context) through the effect's own
`_processCompilationErrors`, so the error is recorded, the next fallback
tried, and `onEffectErrorObservable` told once none is left, as on WebGL2. The
watcher therefore reports it as a pipeline failure, and the rule in §5.5
applies as built: inside the startup window, remembered and a reload onto
WebGL2; after it, remembered for the next load; the live swap replaces both
before Task 6. The bake sees it as its failed ending. It covers the case Task
1's gate met before it was built (the note, §3.3): with the translators
loaded, glslang's "GLSL compilation failed" throws inside the unawaited
preparation, which is exactly the rejection it catches. A failure that belongs to no
compiled effect is logged ("WebGPU shader translation failed") and told to
that engine's watcher. A wrapper, not a page-wide `unhandledrejection` listener,
because only the wrapper knows which effect failed; canaries pin the unawaited
call, the async method, the effect registry, `getPipelineContext`, the WebGPU
pipeline context's `isAsync` and `_processCompilationErrors`. Two limits,
both rare and both safe, since the engine then falls back: the wrapper cannot
pass on the pipeline context an effect had before, so a failed re-preparation
(a program rebuilt after a device loss, say) counts as failed instead of being
rolled back to the program that worked; and a module that translates but that
WebGPU rejects when the pipeline is made reaches only the uncaptured-error
path, which the watcher reads, while the bake reads that effect as ready and
renders a blank billboard.

**Task 2, as built (code and tests; the browser sweep and §6.4's measurement
follow).** The WebGL2 identity pins came first: thirty hashes, every plugin's
injected code per stage and the three post shaders, built through the same
attach functions the world uses (not builders moved out of the plugins' test
files, which the plan proposed) on one `NullEngine` scene
(`client/test/game/helpers/pluginText.ts`). Then, one commit each: the finish
pass's per-shader uniformity switch (§6.1, byte-identical on WebGL2); the hex
include split into three files whose join is the original, with the fetches as
macros on WebGPU (§6.2, byte-identical on WebGL2); `macro` renamed `macroRgb`
(§6.3, the one change to WebGL2's text, shown to be the whole difference, and
a scan of every plugin's declared names against WGSL's reserved words found no
other); the atmosphere's gradient bound whenever it exists (§6.5, shader text
unchanged; a check that every declared sampler of every plugin is bound in
every state found no other); and the engine's extensions imported by
`gpuEngine.ts` (§6.6). §6.4's limits stay Task 1's, 17 inter-stage variables
and 8 vertex buffers, requested exactly (nothing calls `setMaximumLimits`),
until the sweep measures the rest. The pins also hold each plugin's uniforms,
samplers, attributes and defines per state, and the sweep names the models
added since the spike (the rangers, the Hollow, the kiosk and SUV, the summit
body and the fingerposts), none of which carries custom GLSL.

The spike ran the game on Babylon's `WebGPUEngine` with every existing material
and plugin, to measure a compute cull of the blade field, and found the engine
itself worth more than the cull it was built to test. At the canopy pose, high
tier, on the reference machine (Chrome 153, Metal), the WebGPU build with the
blade field as shipped drew a frame in **45.21 ms** against WebGL2's **55.14 ms**
at four times the pixels, and in **22.69 ms** against **24.22 ms** at native
pixels (lowest page means; §3.1 says what those numbers are and are not). It
also left two look and behaviour problems unexplained, and six WebGPU-only
changes made in a hurry. This design turns that into something players can
be given. The goal is one sentence: **on the high and medium tiers, draw with WebGPU
wherever the browser can, show the same picture as WebGL2, and fall back to
WebGL2 by itself when it cannot.**

Renderer-only. No `sim/` change, no level-id move, no protocol change, no
asset change. Two peers on different engines share one world (§11).

## 1. Decisions

| question | decision |
| --- | --- |
| Which engine | The **high and medium** tiers (`WEBGPU_TIERS`) use `WebGPUEngine` when `WebGPUEngine.IsSupportedAsync` holds, the high-performance adapter is not a fallback (software) adapter, and it meets every required limit (§5.2); otherwise WebGL2, as today. Low and the landing backdrop stay WebGL2. The rule ships switched off (`WEBGPU_ENABLED = false`) and Task 6 switches it on after its gates, measured on both tiers |
| Overrides | `?engine=webgl2` and `?engine=webgpu`, on any tier, for testing; `?tier=low\|medium\|high`, committed (it has been an uncommitted measurement patch in three notes). `?engine=webgpu` on a browser that cannot run it falls back and says so once in the console |
| How the engine is made | Every PBR and standard material generates GLSL on WebGPU through Babylon's own public switches (`PBRBaseMaterial.ForceGLSL`, `StandardMaterial.ForceGLSL`), the sky material by its constructor flag; the engine translates at run time with the glslang and twgsl builds `@babylonjs/core` ships, content-hashed by the build and cached immutably; the device is asked for the required limits, not the adapter's maximum |
| Failure before the game starts | WebGL2, in the same page load; the player sees the usual loading and then the game |
| Failure after it starts | As built behind the off switch: a shader or pipeline error in the startup window, or an uncaptured WebGPU error then: WebGL2 is remembered and the page reloads itself. A lost device: the page reloads on WebGPU once; a second loss within 24 h remembers WebGL2 and reloads. After a fallback reload the HUD says so for 6 s. Before Task 6 switches WebGPU on, a live swap of the renderer, which the tier-detection work provides, replaces every reload (§5.5): a pipeline failure or an uncaptured error, in the startup window or after it, swaps now onto a fresh WebGL2 canvas and is remembered; a first lost device in 24 h retries once on a new WebGPU engine on a fresh canvas; a second within 24 h swaps onto WebGL2 and is remembered |
| Remembered fallback | `localStorage` key `dayhike.engine`, holding the reason, the browser's major version, Babylon's version and the time; it holds while both versions are unchanged and for 30 days. Where storage throws, the reload carries `?engine=webgl2`, so a failing engine can never loop |
| The six changes | Each its own commit with its own test (§6). WebGL2's shader text stays byte-identical, pinned by hash, except the one renamed identifier of §6.3 |
| Parity | Nine fixed poses (§7.1), on the high tier and again on the medium tier; per crop, WebGPU's mean linear luminance within ±5 % of WebGL2's and the CIELAB distance of the crop means ≤ 2.0, or twice the same-engine repeat where that is larger; grass cover within 0.02; a verdict in words per pose |
| The trail bed | Diagnosed before it is fixed (§8). On reading the paint, the snow mix cannot make the glint the spike saw; the likely mechanism is the image-based light the wet bed reflects |
| The impostor bake | Waits for readiness, not a clock; resolves null only on a shader error, which is logged; logs once if still waiting at 30 s; stops on dispose (§9) |
| The pipeline-cache bug | A local workaround that survives Babylon recomputing the hash, pinned by a canary test that fails when a fixed Babylon ships; a draft upstream issue (Appendix A). Filing it is a manual step outside this plan |
| Frame bar | One bar, the same for both tiers: a tier's WebGPU path turns on when, at the canopy pose at native pixels on the reference machine, WebGPU is faster than WebGL2 by more than the larger of the two engines' same-code noise floors (quiet pair rounds), **and** no standard pose of §13.1 is slower on WebGPU than on WebGL2 by more than the same-code noise floor at that tier, **and** that tier passes the parity gate. On the high tier about **1.5 ms** at the canopy pose is expected (§3.2): reported, not a gate. The other poses' gains and the 4× rows are reported (§13.1, §16) |
| Startup, memory, console, fallback | Bars in §13.3–§13.6 |
| The compute-culled blades | Build I, Task 7, only after the engine path is on `main`; built on the grass frame filter's collected buffers; must beat WebGPU with that filter by **0.3 ms** at native, not the unfiltered field (§12) |
| Unchanged | Everything under `client/src/sim/` (`passHash` −311867473); `PROTOCOL_VERSION` 5; every asset; what each tier draws; the low tier's engine; WebGL2's pixels |

## 2. Goals and non-goals

**Goals.**

- Players on the high and medium tiers get the WebGPU engine's frame time
  wherever their browser and adapter can run it, with no action of theirs.
- The picture on WebGPU is the picture on WebGL2 at every pose the gates
  know, within the tolerance of §7.
- No player is left with a blank or broken page: every way WebGPU can fail
  ends on WebGL2, once, without a loop.
- The WebGL2 path, which every player on the low tier keeps, and every player
  whose browser cannot run WebGPU, does not change by a byte of shader text
  except where §6 says so.

**Non-goals.**

- Porting the GLSL plugins to WGSL (about 685 lines under
  `client/src/game/shaders/` and about 640 more inline, the spike's count). The
  translators carry them; a port is a follow-up (§17).
- Changing which tier a device is detected as (§4, §17).
- WebGPU on low; WebGPU for the landing backdrop.
- Snapshot rendering, render bundles, timestamp queries in shipped code.
- Per-blade GPU culling (the spike's §7); build I culls per clump.

## 3. What the spike measured, and what it did not

### 3.1 The numbers

Babylon.js 9.18.0; Chrome 153, headless, on an Apple adapter (Metal 3); seed
`atmo`, `weather mist`, `time 12`, high tier; a 1200 × 2029 window at device
pixel ratio 1; the canopy pose `(123, 110.87, −105.5)`, yaw 1.571, pitch 0.3.
Frames by the near-grass pair method; a page is *quiet* when it sits within
0.5 ms of its build's lowest mean; only quiet rounds read. Builds from one
commit: **GL** WebGL2 as shipped; **B** WebGPU, thin instances as shipped;
**S** WebGPU with the compute cull, count read back a frame late; **I** the same
with the count written into the draw's indirect arguments.

| pixels | GL | B | S | I | reading |
| --- | --- | --- | --- | --- | --- |
| native | 24.22–24.26 (quiet pages) | 22.77–22.88 (quiet pages), 22.69 lowest | 21.66 lowest | not measured quietly | S − B −1.03 ms, two quiet pair rounds, same-code floor ±0.11 |
| 4× | 55.14 (same-code, both pages) | 45.21 / 45.23 (same-code) | 44.34 (one GL/S round) | −0.65 against B (one round) | GL/B pair rounds −9.2 and −11.6, both pages lifted |

### 3.2 What the engine alone is worth at native

The spike's summary says the engine alone is about 2.5 ms faster at native.
That figure is the WebGPU build **with S** (21.66 against 24.22), which the
spike's own §4 and §6 label correctly. The engine
alone, B against GL, is **−1.53 ms** by lowest means (22.69 against 24.22), and
−1.34 to −1.49 ms by the quiet pages' means; no GL/B round was quiet on both
pages at native. At 4× the engine alone is **−9.93 ms** (45.21 against 55.14),
and that figure is robust. So 1.5 ms at native rests on the only native
estimate there is. It is kept as the expectation for the high tier, and
reported, but it is not the gate: the gate (§13.1) is a gain above the same-code
floor, the same on both tiers, with no pose slower than its floor and parity,
and §16 says in advance what each outcome turns on.

The native window renders 2.4 million pixels. Every tier renders at CSS
pixels, not device pixels: `lighting.ts` sets the hardware scaling level to 1
(1.5 on low), which overrides the engine's `adaptToDeviceRatio`, so a Retina
panel does not double the cost, and a player's pixel count follows the window,
not the panel's density. (Babylon's `resize()` does rescale by a change of
device ratio when a window moves between displays.) So the native figure is the
one closest to what a player sees; the 4× figure stands for a window with four
times the pixels.

### 3.3 The six WebGPU-only changes the spike needed

| what failed | where | the spike's change | this design (§6) |
| --- | --- | --- | --- |
| `'textureSample' must only be called from uniform control flow` | the finish pass: a read of the scene after `if (mask > 0.0)` on a varying (`finish.fragment.fx:40–44`) | uniformity analysis off for every translated shader, by replacing the engine's private `_createPipelineStageDescriptor` | off for the named shader only, by Babylon's own define, on WebGPU only |
| `sampler constructor must appear at point of use` (glslang) | `groundHex.fragment.fx:90–114`: `hexFetch2D` / `hexFetchArray` take a sampler | the include rewritten by string surgery at two markers, on WebGPU only | the include split at the same seams into three files; WebGPU swaps the middle for macros |
| `'macro' is a reserved keyword` (WGSL) | the terrain blend's local `vec3 macro` (`terrainTexture.ts:558`) | a whole-word regex over all plugin text, on WebGPU only | renamed at source; a reserved-word scan over every plugin |
| 17 vertex outputs, limit 16 | the blade material: PBR's varyings plus the foliage plugin's four | `setMaximumLimits` (every adapter limit) | the required limits, measured and requested |
| `atmGradient` not bound | the atmosphere plugin binds no texture while its record is null | bind on WebGPU while off | bind whenever the texture exists |
| a sign's painted texture throws | the WebGPU dynamic-texture extension is not reached by the WebGL2 imports | import every WebGPU extension | the same import, in the WebGPU-only module |

### 3.4 The two open problems

- **The trail bed** reads cooler and greyer on WebGPU than WebGL2's warm brown,
  with a pale glint where it meets the horizon; not traced (§8).
- **The forest impostor bake** waits at most 5 s for its shaders
  (`forestMeshes.ts:631`, the loop at 704–712); under the slower run-time
  translation it timed out, resolved null, and `adoptBake` left the far forest's
  buckets disabled for good (`forestMeshes.ts:799–800`), with nothing in the
  console. Six times the budget let it bake (§9).

### 3.5 What of the spike's code should not ship

- `forceGlslMaterials` defines an accessor on `Material.prototype._forceGLSL`
  that reads true and swallows writes. It works only while Babylon assigns the
  field rather than defining it as an own property, and Babylon already has the
  public switches this needs (`pbrBaseMaterial.pure.js:270`,
  `standardMaterial.pure.js:599`).
- `skipUniformityAnalysis` replaces a private engine method for every shader,
  which also hides every other uniformity fault the translation would have
  reported.
- `setMaximumLimits` asks the device for everything the adapter has, so a
  pipeline that outgrows the limits every adapter guarantees still runs on the
  reference machine and fails only on a weaker one.
- `main.ts` awaits `createWebGpuEngine` with no rejection handler: a device or
  translator failure leaves a blank canvas and an unhandled rejection. Its own
  `webGpuRequested` helper is exported and unused.
- The impostor bake's six-fold budget is still a deadline, still silent past it,
  and applies only on WebGPU, though a slow machine on WebGL2 can miss the 5 s
  too.
- The pipeline-cache workaround adds the offset to `hashCode` once, after
  construction. Babylon recomputes the hash whenever `instanceDivisor` is set
  (`buffer.pure.js:234–239`), which silently drops the offset term and brings
  the collision back.
- Build S's read-back lags the view: 14 to 484 instance-frames went undrawn per
  turn. It is not carried forward.
- Build I reaches three private internals (`engine._renderEncoder`,
  `engine._endCurrentRenderPass()`, `SubMesh._getDrawWrapper(...).drawContext`)
  and ends the current render pass to copy the counts; whether that split the
  multisampled scene pass on a tile-based GPU was not checked (§12.4).
- The spike branched from `0b957a6`, before the grass frame's frustum filter
  (`5903706`, `418e755`), so its B draws the whole blade field every frame. S
  and I were measured against a baseline `main` is about to leave behind.
- `renderer.ts` reads `?blades=` and `?bladecount=` in shipped code.

### 3.6 What moved on `main` since

The spike's base is `0b957a6`; `main` is `ba0fd95`, eighteen commits later: the
summit models and their fingerposts with painted labels (`signMeshes.ts`, two
`DynamicTexture`s), rangers and the antlered Hollow (`characterModel.ts`,
`staticModel.ts`, `entityViews.ts`), the trailhead's kiosk and SUV
(`trailheadMeshes.ts`). None of those materials has been compiled on WebGPU.
Task 2 sweeps the scene from scratch rather than trusting the spike's list.

## 4. Who reaches the WebGPU tiers

Until Task 1, `createRenderer` detected the tier itself, since `app.ts` gave
it none; now `main.ts` resolves the tier before the game starts (`?tier=` where
valid, else `detectTier` in `quality.ts`, the same body) and passes it through
`app.ts` to the renderer. Detection is `tierFor` (`quality.ts`): high needs
more than eight threads **and** more than 8 GB of `navigator.deviceMemory`.
Chromium capped `deviceMemory` at 8 GB until Chrome 147, which is what the
near-grass design found; since then desktop Chrome reports 2, 4, 8, 16 or 32 GB,
so current Chrome, Edge, and the desktop launcher (Electron 44, Chromium 152)
send any machine with more than eight threads and 16 GB or more to high,
whatever its GPU, and one with more than four threads and more than 4 GB to
medium. Safari and Firefox expose no `deviceMemory`, read the default 4 GB, and
land on low.

So the rule covers both tiers a desktop Chromium is detected as: once the
switch is on, desktop Chrome, Edge and launcher players reach WebGPU on high or
medium with no action of theirs, and Safari and Firefox stay on WebGL2 on low. Changing detection moves every player it
promotes onto a higher tier's costs (on high: the scene pass, halation, two
2048² cascades, 400 m of cliff rings), which is a design of its own with its own
frame gate, being written separately (§17). The engine rule is written against
the resolved tier, so it needs no change when detection does.

## 5. Selection and fallback

### 5.1 The rule

Resolved once, before the game starts, in `main.ts`:

```
tier   = ?tier=… if valid, else detected
engine = ?engine=webgl2                          → WebGL2
       | ?engine=webgpu      and the GPU fits     → WebGPU
       | tier ∉ WEBGPU_TIERS (high, medium)      → WebGL2
       | not WEBGPU_ENABLED                      → WebGL2   (until Task 6)
       | the remembered fallback holds           → WebGL2
       | the GPU fits                            → WebGPU
       | otherwise                               → WebGL2

the GPU fits = navigator.gpu exists
             ∧ WebGPUEngine.IsSupportedAsync
             ∧ requestAdapter({ powerPreference: "high-performance" }) returns an adapter
             ∧ that adapter's info.isFallbackAdapter is false
             ∧ every limit of §5.2 ≤ the adapter's
```

The pure part (the override parsing, the limit comparison, the decision, the
remembered record) lives in `engineChoice.ts` and is tested with literal
inputs; the part that touches `navigator.gpu` lives in `gpuEngine.ts`, which is
loaded only by a dynamic `import()` on the WebGPU path, so the WebGL2 bundle
gains the selection code and nothing of the WebGPU engine.

### 5.2 Required limits

The device is created with exactly these as `requiredLimits`. Asking for the
adapter's maximum instead would let a pipeline that needs more than we checked
for run here and fail elsewhere.

| limit | WebGPU default | required | why |
| --- | --- | --- | --- |
| `maxInterStageShaderVariables` | 16 | **19** (as found: 17 was one short) | the giant trees' faded material: 18 vertex outputs, and, since Babylon declares every vertex output as a fragment input, 18 fragment inputs plus `front_facing`, which WebGPU counts (§6.4); measured on both tiers, the one pipeline that sets 19 (the verification note, §4) |
| `maxSampledTexturesPerShaderStage` | 16 | 16 (measured, no margin) | the terrain's fragment: seven layer maps and arrays, road ×2, trail ×2, the feature table, the atmosphere's gradient, the environment cube, the BRDF lookup and the cascaded shadow map, 16 |
| `maxSamplersPerShaderStage` | 16 | 16 (measured, no margin) | the same, the shadow map's by comparison |
| `maxUniformBuffersPerShaderStage` | 12 | 12 (measured, no margin) | the internals, scene, mesh and material blocks, one per light up to `LIGHT_BUDGET` 7 (`headlamp.ts:70`), and the leftover block: 12 |
| `maxVertexBuffers` | 8 | 8 (measured: 7 needed) | six on a terrain ring (position, normal, colour and the three of `renderer.ts:221–223`); five on a Task 7 bucket; as found, 7 on the duff clumps, the giant fir's faded material, the fern, the meadow's clutter and the grass |
| `maxStorageBuffersPerShaderStage` | 8 | 6 (Task 7 only) | the cull pass: parameters, candidates, counts, three tier outputs |

Task 2 measures the three unmeasured rows from the translated WGSL of every
pipeline the sweep builds (the highest binding count per stage) and pins them
as literals. As found (the verification note, §4): all three sit exactly at
the default, and `WEBGPU_REQUIRED_LIMITS` names them there, with the two
above, so the request lists the scene's whole need. Whether adapters on Windows (Dawn on D3D12) expose more than 16
inter-stage variables was not measured. If a Windows figure shows they do not,
the lever is to pack the foliage plugin's three scalar varyings
(`vFoliageH`, `vFoliageClump`, `vFoliageDist`) into one `vec3`, which brings the
blade material to 15; that changes WebGL2's shader text and is its own commit
with its own identity re-pin, taken only if the measurement asks for it.

### 5.3 The overrides

- `?engine=webgl2`: WebGL2 on every tier, whatever is remembered. Also the
  advice to give a player with a GPU problem.
- `?engine=webgpu`: WebGPU on any tier if the GPU fits, whatever is remembered;
  if it does not fit, WebGL2 and one `console.warn` naming why.
- `?tier=low|medium|high`: the tier, in place of detection. Committed here
  because every rendering gate needs it and the switch is unreachable without
  it (§4).

Neither is carried in an invite link; both are read from the page's own URL.

### 5.4 Making the engine

`createWebGpuEngine(canvas)`, in `gpuEngine.ts`:

1. `PBRBaseMaterial.ForceGLSL = true` and `StandardMaterial.ForceGLSL = true`,
   before any material exists: every material the scene or the glTF loader
   makes then generates GLSL, which the plugins require (a GLSL
   `MaterialPluginBase` refuses a WGSL material, `materialPluginBase.pure.js:32`).
   Neither switch has any effect on WebGL2, where every material is GLSL.
2. The sky material is constructed with its own `forceGLSL` argument
   (`lighting.ts:165`), so on both engines the sky is the same GLSL source the
   spike measured.
3. `new WebGPUEngine(canvas, { antialias: true, stencil: true,
   adaptToDeviceRatio: true, powerPreference: "high-performance",
   deviceDescriptor: { requiredLimits } })`, the WebGL2 engine's own options
   (`renderer.ts:647`) plus the two WebGPU ones.
4. `initAsync` with glslang and twgsl from `@babylonjs/core/assets/`, imported
   with `?url` so Vite content-hashes them under `/dayhike/assets/`, where
   `firebase.json` already serves `immutable`. Sizes: `glslang.wasm` 943,680 B,
   `twgsl.wasm` 1,702,916 B, and their loaders 16,030 and 74,555 B; 2,737,181 B
   in all, 913,730 B at gzip −9. They are fetched only on the WebGPU path.
5. The WebGPU engine extensions, by one side-effect import (§6.6).

Any throw or rejection in these steps, or no result in 15 s, is a failure
before the game starts (§5.5).

As built (Task 1), the order is: the WebGPU module imported (none of it on a
page without `navigator.gpu`), the adapter probed, and only where the adapter
fits, the translators fetched and the engine made, within two budgets that each
run across their two steps: 10 s for the module and the translators, 10 s for
the probe and the engine. What the player sees meanwhile is the HUD's status
line, "Loading…", over the canvas (the landing's own word), from the moment the
landing goes until the game starts on whichever engine was chosen; a normal cold
WebGPU start shows it for the translators' download and compile and the device,
and the worst case, a stalled fetch and a stalled adapter, for 20 s.

With the shader lookup ([its design](2026-09-28-webgpu-shader-lookup-design.md),
§6), the start fetches no translator: the module is imported within the fetch
budget, the adapter probed and the engine made within the GPU's, and the
translators are fetched, within the same 10 s of their own, at the first
shader the lookup does not find, or once the page is idle after the first
frame. "Loading…" covers the module and the device, and on a first visit the
translators' download too, since the first shaders are then not found.
Translators that cannot be fetched then end on WebGL2 by a live swap, as a
failure does, with nothing remembered. `?wgsl=off` keeps the order above.

### 5.5 What fails, and what the player sees

| failure | detected by | action | what the player sees |
| --- | --- | --- | --- |
| No WebGPU, a fallback adapter, a limit short | the rule (§5.1) | WebGL2, this load | the game, as today |
| Translators fail to load, device refused, `initAsync` throws, or 15 s pass | `createWebGpuEngine` rejecting | WebGL2, this load; remembered (reason `init`) | the game, a moment later than usual |
| A shader fails to translate or compile, or WebGPU reports an uncaptured error, during the startup window | `engine.onEffectErrorObservable`; Babylon's `Logger` entries that begin `WebGPU uncaptured error` (`webgpuEngine.pure.js:451–458`, which logs them as warnings) | remembered (reason `pipeline`); reload | the page reloads to the same route on WebGL2; then, for 6 s, the HUD line "Graphics switched to WebGL2 after a GPU error." |
| The same, after the startup window | the same | remembered (reason `pipeline`); no reload; one `console.error` | the game continues; the next load is WebGL2 |
| The device is lost (a GPU process crash, a driver reset) | `engine.onContextLostObservable`, which Babylon fires only for a loss it did not cause | first loss in 24 h: counted, reload on WebGPU; second: remembered (reason `lost`), reload | after the first, a reload and the HUD line "Graphics restarted after a GPU error."; after the second, a reload onto WebGL2 and the line above |

The **startup window** runs from the engine's creation until no effect has
compiled for 10 s after the first frame (the engine's
`onAfterShaderCompilationObservable`), or 60 s, whichever comes first. A
deterministic fault (a shader that does not translate, a pipeline that does not
validate) shows inside it; after it, a reload in the middle of a hike costs more
than the fault, so it waits for the next load.

A reload is what pressing reload does today: a solo hike restarts at the
trailhead in the same world. In a party it does more harm than that, because
the startup window is not over before the party connects: the lobby belongs to
the page and is usually made on the landing page, and the host's admission and
a follower's handshake both start inside `startGame`, so they run during the
window. A reload fires `pagehide`, and the page leaves the lobby
(`main.ts`'s `pagehide` listener):

- A **host**'s leave ends the room: every follower sees "The host ended this
  session.", and the invite is dead.
- A **follower** leaves the party, and its page reloads into a solo copy of the
  host's world, since the game URL keeps the host's token; it can rejoin by the
  invite.

This happens once per failing machine, since the failure is then remembered,
but it takes the whole party down when it is the host's. So, **before Task 6
switches WebGPU on**, a WebGPU failure after the game has started falls back
without reloading: the renderer is rebuilt live onto a fresh WebGL2 canvas,
the world, the session and the lobby kept. The tier-detection work, a design
of its own, is building exactly that rebuild (a tier change applied mid-hike
without a reload, a change of engine on a fresh canvas included); it is Task
6's prerequisite, so the WebGPU switch waits on that work. With the swap:

- **A shader or pipeline failure, or an uncaptured WebGPU error**, inside the
  startup window or after it, swaps now onto a fresh WebGL2 canvas and is
  remembered (`pipeline`), with the HUD line "Graphics switched to WebGL2 after
  a GPU error." A late error no longer waits for the next load, so the startup
  window stops deciding anything.
- **A first lost device** in 24 h is one retry on WebGPU: the renderer is
  rebuilt on a new WebGPU engine on a fresh canvas, the loss counted, with the
  line "Graphics restarted after a GPU error." **A second** within 24 h swaps
  onto WebGL2 and is remembered (`lost`), as the reload does today.
- A failure of an engine that a switch under way (Apply, the governor's
  drop) has already left by the time the rebuild could run is recorded, so
  the next load, and every engine the rule gives from then on, takes
  WebGL2, but it does not rebuild the renderer that switch built on
  another engine: that engine has its own watcher, which answers its own
  failure (as built, `answerFailures`).
- Where storage refuses the record, the tab's URL is pinned to
  `engine=webgl2` as today, so a reload stays on WebGL2. Until then the
reload paths stay as built, reachable only with `?engine=webgpu` behind the off
switch; the record, the lost-device count and the pin in the URL are kept as
they are, and only what happens after them changes. Babylon's own device-loss
recovery is not relied on, and is stopped (as built: replaced by nothing on
every engine made or watched, `giveUpRestore`): it rebuilds buffers and
textures, but the forest's impostor bakes and
the environment probe are one-shot render targets whose contents a lost device
erases and nothing renders again. The HUD line is carried across the reload by
a `sessionStorage` marker, dropped silently where that storage throws.

### 5.6 The remembered fallback

`localStorage["dayhike.engine"]` holds `{ reason, browser, babylon, at,
losses }`: the reason (`init`, `pipeline`, `lost`), the browser's major version
from `navigator.userAgent`, Babylon's version (`AbstractEngine.Version`), the time, and the
count of losses in the last 24 h. It **holds** (WebGL2 is chosen) while the
reason is not a lone loss, `browser` and `babylon` equal the running ones, and
`at` is less than 30 days old. A browser or Babylon upgrade therefore tries
WebGPU again, once. Every access is wrapped as `playerName.ts` wraps its own:
where storage throws, nothing is remembered and the reload URL carries
`?engine=webgl2` instead, so a failure that recurs on every WebGPU start cannot
loop.

### 5.7 The desktop launcher

`desktop/main.cjs` opens one window on the live site and nothing else; there
is no copy of the game in it. Its Electron (44.1.1) exposes WebGPU as the
Chromium inside it does, on macOS and Windows, with no switch in
`webPreferences`. So the launcher follows the page's rule unchanged, and its
`localStorage` persists in the app's own profile, so a remembered fallback
survives relaunches. The launcher's URL carries no query; its Chromium reports
memory above 8 GB, so detection sends a launcher to high or medium by its
threads and memory (§4), and once the switch is on, launcher players draw with
WebGPU where the adapter fits, and fall back as the page does. No launcher change and no launcher release are
needed. Its Windows smoke runs on a hosted runner without a GPU; whatever tier
it detects there, it must keep reaching the game, and a runner whose browser
offers no hardware adapter with the required limits draws with WebGL2, so the
smoke keeps exercising that path.

### 5.8 The landing backdrop

`landingScene.ts:55` builds its renderer with `{ tier: "low" }`, so it stays
WebGL2. The landing's engine is disposed before the game's is made
(`main.ts:424`), so the two never run at once.

### 5.9 The frame probe and the switch's cover, per engine

**The probe's steps.** Tier detection's probe is skipped where its step could
never be ready (`probeStepCanSettle`, the tier detection design §7.8): a step
is ready once `PROBE_QUIET_MS` pass without a compile inside
`PROBE_READY_MAX_MS`, and a WebGL2 context without
`KHR_parallel_shader_compile` links one program a frame on the page's thread,
so it never is. A WebGPU step is no quieter: Babylon's WebGPU engine translates
each effect's shaders on the page's thread as the effect is made (glslang, then
Tint, both synchronous; `WebGPUPipelineContext.isAsync` is false) and makes
each render pipeline at its first draw with `createRenderPipeline`, and the
probe's meter restarts its quiet on either. The first reading on a four-core
Windows machine drew about 2 frames a second for about 50 s after the page
opened. So a WebGPU step is not taken to settle until a browser has measured
that it does (`WEBGPU_PROBE_STEPS_SETTLE`, false; §13.7), and, as built:

- **Tiers that draw on WebGPU are probed on WebGL2** (`probeStepEngine`): the
  probe's steps run on a WebGL2 engine on their own canvases, whatever the
  rule gives their tiers, where a WebGL2 step can settle (the extension
  offered). The hike then starts on the rule's engine at the verdict's tier.
- **A WebGL2 verdict holds for WebGPU** (`verdictRead`). A verdict says which
  tier the machine holds, and WebGPU drew the same scene faster than WebGL2 at
  every pose measured so far, so a tier that holds on WebGL2 holds on WebGPU:
  a WebGL2 verdict is a floor there, read for a WebGPU start as for a WebGL2
  one. A WebGPU verdict (none can be measured while the constant is false; a
  governor's drop or a tier that built on WebGPU writes one) is read for
  WebGPU only, since nothing says WebGL2 is as fast. The record's shape is
  unchanged, so a record tier detection's release wrote (WebGL2 verdicts, its
  key) is read for either engine. A probe's WebGL2 verdict looked up under
  WebGPU resets the attempts, since it is read.
- **Where WebGL2 cannot settle either** (Firefox without the extension): the
  probe is skipped, as tier detection skips it, and Auto starts at the class's
  start tier; nothing is written. For `integrated-unknown` that is low, on
  WebGL2 (low is never WebGPU). The governor only ever lowers a tier, so a
  machine that would hold more stays at the start tier.
- **Once the constant is turned on**, the steps draw on the rule's engine
  again: WebGPU where it gives WebGPU, either while the adapter has not
  answered (so both must settle).
- **A step that ends on another engine** (a WebGPU start that fails, or a
  WebGPU engine that fails in the step, and the step measured again on WebGL2)
  is asked again as it runs (`measureOnRuleEngine`), and is not measured where
  it cannot settle: no reading, at once. `?probe=` forces the probe past this.
- **Low is the floor and is never measured**: a probe whose high and medium
  steps miss decides low without a third step.

Settings' caption (`probePending`) and the start read the same answer
(`autoPick`, with the engine the rule gives the probed tiers), so the caption
says a probe is pending exactly where the start will show the probe's screen.

**Before the switch goes on**, the reference machine's frame gate (§13.1, the
plan's Task 6 Step 2 guard) must show WebGPU no slower than WebGL2 at every
pose on both tiers: the WebGL2 verdict is read as a floor for WebGPU on that
ground alone.

**The cover's bound.** Every switch waits for its new scene under a cover,
bounded by its caller (the tier detection design's `APPLY_SWAP_READY_MAX_MS`,
20 s, and `GOVERNOR_SWAP_READY_MAX_MS`, 10 s), passed down to `whenSceneReady`:

| path | bound | the cover at most |
| --- | --- | --- |
| Settings Apply, on the pause screen | Apply's, 20 s | 20 s + 5 s + the build |
| the governor's drop, in play | the governor's, 10 s | 10 s + 5 s + the build |
| a failure's rebuild (a pipeline error, an uncaptured error), in play | the governor's, 10 s | 10 s + 5 s + the build |
| a lost device's retry on WebGPU, and a second loss's rebuild on WebGL2 | the governor's, 10 s | 10 s + 5 s + the build |
| a rung of a fallback ladder, inside any of these | its switch's | its switch's |
| a switch that crosses engines | its caller's | its caller's |

The 5 s is `SWAP_SCENE_MIN_MS`, below.

A rebuild nobody asked for, in the middle of play, covers the same player the
governor's drop does, so it takes the same bound (`answerFailures` passes it);
no third bound is needed. The hike's first build has no cover wait of its own.

The bound covers the engine's making too (`engineWithinBound`). A switch into
WebGPU makes its engine under the cover, which can take up to
`WEBGPU_START_MS` (10 s), and `WEBGPU_FETCH_MS` (10 s) more where the
translators are not loaded yet; that time is counted against the bound, and
the new scene waits on what is left of it, but never less than
`SWAP_SCENE_MIN_MS` (5 s), so a scene built after a slow or late engine still
has its models, ground maps and bakes loaded under the cover. The cover's total
is at most the bound the path names, plus that floor where the engine ate into
the bound, plus the renderer's build itself. An engine not ready within the
bound gives way to WebGL2 at the switch's tier, on a fresh canvas, and is let
go of when it arrives; its scene waits the 5 s floor. It was slow, not broken: nothing is remembered against
it, and the next switch or load tries WebGPU again. The player sees the cover
lift on the tier they asked for, drawn with WebGL2, and no line in the HUD;
the console says why.

## 6. The six compatibility changes

### 6.0 The WebGL2 identity pins

Before the first change, one test pins the WebGL2 shader text as SHA-256
literals measured at the branch's base: every plugin's `getCustomCode("vertex")`
and `getCustomCode("fragment")` output on `NullEngine`, with the terrain plugin
in the state the world builds it (road, trail and features on), the three post
shaders as stored, and the hex include. `groundHex.fragment.fx` is 5,803 bytes,
SHA-256 `21a6e1061ff6d1a66c384400f5eae5538cec24b17e7f551c647aa825c710f9bb`;
`finish.fragment.fx` is `4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5`.
Every change below leaves every pin as it was except §6.3's, which re-pins one
hash and proves the only difference is the rename.

### 6.1 Uniformity analysis, per shader

**What failed.** WGSL requires an implicit-derivative texture read in uniform
control flow. The finish pass reads the scene again inside `if (mask > 0.0)`,
where `mask` comes from `vUV` (`finish.fragment.fx:40–44`).

**Change.** Babylon turns the analysis off for a shader whose code carries
`#define DISABLE_UNIFORMITY_ANALYSIS` (`Constants.DISABLEUA`, detected at
`webgpuEngine.pure.js:1537–1538`), and its own shadow include already carries it
for every material that receives cascaded shadows
(`shadowsFragmentFunctions.js:119`). `post.ts` stores the finish shader through
`finishFragmentFor(isWebGPU)`, which prefixes that line on WebGPU and returns the
file's bytes untouched on WebGL2. It is safe here for a reason worth stating:
the finish pass reads a render target with a single mip level, so the implicit
LOD it can no longer rely on cannot select another level. The global override
goes. Task 2's sweep then runs with nothing turned off but this and Babylon's
own include, and every further shader it finds failing gets the same treatment,
named in the verification note, or a restructure where the read is not on a
single-level texture.

**Rejected.** `textureLod(textureSampler, echoUv, 0.0)` in the file: the same
pixels, legal in divergent flow everywhere, but WebGL2's text changes.

**WebGL2.** Byte-identical. **Test.** `finishFragmentFor(false)` hashes to the
file's literal; `finishFragmentFor(true)` is the define, a newline, then the
same bytes; no source file under `client/src` names
`_createPipelineStageDescriptor`.

### 6.2 The hex fetches, as macros on WebGPU

**What failed.** Babylon's WebGPU GLSL path splits each `sampler2D` uniform into
a texture and a sampler and names the pair with a `sampler2D(tex, samp)`
constructor at each use; glslang refuses that constructor as a function
argument, so a function with a sampler parameter cannot be called.

**Change.** `groundHex.fragment.fx` is split at the two seams the spike's
markers found, into three files whose concatenation is the original file byte
for byte: `groundHex.fragment.fx` (lines 1–87: header, lattice, `hexSetup`),
`groundHexFetch.fragment.fx` (lines 88–115: the four sampler-taking functions)
and `groundHexNoise.fragment.fx` (lines 116–145: `latticeHash`, the macro noise,
`macroTint`, `horizonWeight`). The terrain plugin assembles head + fetch + noise
on WebGL2 and head + `HEX_FETCH_MACROS` + noise on WebGPU, choosing by
`this._material.getScene().getEngine().isWebGPU`. `HEX_FETCH_MACROS` is a
TypeScript constant beside the plugin, the spike's two macros with the same
arguments and arithmetic; the one-shot spellings (`hexSample2D`,
`hexSampleArray`) have no caller in the plugin and are not in it. Every caller
passes plain variables (`terrainTexture.ts:462, 489, 512, 514, 537`), so a
macro's repeated argument costs nothing, and each macro body is parenthesised,
so `hexFetchArray(...).b` still selects from the sum.

Three files rather than the spike's surgery: nothing is cut at run time, no
marker can go missing in a player's browser, and each file keeps real code, so
the shader hygiene test (which requires that of every `.fx` file) holds.

**WebGL2.** Byte-identical. **Tests.** The three files joined hash to
`21a6e106…f9bb`; the WebGPU assembly declares no function with a sampler
parameter; the six `textureGrad` terms of the macros equal the functions' once
the macros' parameter parentheses are removed; the lockstep tests read the
joined include.

### 6.3 A WGSL reserved word, renamed

**What failed.** The translation keeps GLSL identifiers, and `macro` is
reserved in WGSL.

**Change.** `vec3 macro` becomes `vec3 macroRgb` in the terrain blend
(`terrainTexture.ts:558–559`), at source, on both engines. The spike's
alternative, a whole-word regex over every plugin's text on WebGPU only, keeps
WebGL2 byte-identical, but it is a second spelling of the shader that only one
engine sees, it rewrites comments and would rewrite a uniform of that name out
from under its binding, and the next reserved word would need another rule. A
test scans every plugin's GLSL, on both assemblies, for any declared name in
WGSL's reserved-word list, so the class is closed rather than the instance.

**WebGL2.** The one place its text changes: one identifier, in its declaration
and its one use. The compiled program is the same. **Test.** The terrain fragment's hash is re-pinned,
and the test asserts that the new text with `macroRgb` replaced by `macro`
hashes to the old literal.

### 6.4 The required limits

**What failed.** The blade material's 17th varying against the default 16.

**As found (the verification note, §6.1).** 17 was one short, and not for the
blades: WebGPU started on every load and stayed on none, because the giant
fir's and pine's two materials failed validation 10.9–20.7 s in, one with 17
fragment inputs and `front_facing`, one with 18 vertex outputs, against a
device made with 17. WebGPU's own rule ("validating inter-stage interfaces"):
a vertex stage writes at most the limit's user-defined outputs, each at a
location below it; a fragment stage reads at most the limit's user-defined
inputs less one for each inter-stage built-in it reads (`front_facing`,
`sample_index`, `sample_mask`, `primitive_index` and the two subgroup
built-ins), the position not counted. On WebGPU Babylon declares every vertex
output as a fragment input and places a `mat3` in three locations, and a
two-sided PBR material reads `front_facing`, so the faded trunk material needs
19; the device asks for 19, the number in one place (`engineChoice.ts`).
`interStage.test.ts` holds it: each plugin's varyings parsed from its injected
GLSL and pinned, and, as first built, the measured materials, Babylon's share
from the browser's reading, held within the limit as the specification
counts. The halation's kernel blur, which counted 18 at a device of 28,
sizes itself from the device's limit and cannot pass it. The full sweep of
every material, running in a browser, sets the final number. As read (the
verification note, §4): 19, the faded material's fragment stage reading 18
inputs and `front_facing` on both tiers, which fails at 18 and passes at 19,
the one pipeline that sets it; the halation's blur, which fills whatever the
device offers, failed at 18 only in the replay of a pipeline built for 19. The
inter-stage test now builds the
forest from the shipped models on `NullEngine` with Babylon's WebGPU
processing, pins the varyings Babylon gives the giants' materials, and adds
the shadow cascades' varyings by count, which it cannot draw; its count
matches the browser's on both tiers.

**Change.** §5.2: the rule checks the adapter against `WEBGPU_REQUIRED_LIMITS`
and the device is created with exactly those. Task 2 measures the three rows
the spike did not and pins them.

**WebGL2.** Untouched. **Test.** `adapterFits` on literal limit objects: the
WebGPU defaults fail (16 inter-stage variables); the reference machine's
recorded limits pass; a fallback adapter fails whatever its limits;
`WEBGPU_REQUIRED_LIMITS` pinned as literals.

### 6.5 The atmosphere's gradient, always bound

**What failed.** WebGPU validates every binding a pipeline declares on every
draw. The atmosphere plugin declares `atmGradient` and binds it only while its
record exists (`atmosphere.ts:79–95`); before the first `update`, a draw
declares a sampler nothing bound.

**Change.** Bind the gradient whenever it exists, on both engines, at the top of
`bindForSubMesh`. The shader already gates every read on `atmOn`, so binding it
while the effect is off changes no pixel.

**WebGL2.** Shader text identical; one texture bind more on the frames before
the atmosphere's first update. **Test.** A general one, for the class: for every
plugin, in every state it can be bound in, every sampler it lists in
`getSamplers` is set by `bindForSubMesh` (a spy on `UniformBuffer.setTexture`).
The atmosphere fails it today.

### 6.6 The WebGPU engine's extensions

**What failed.** `new DynamicTexture(...)` in `signMeshes.ts:77` and `:109`
throws on WebGPU: the engine's dynamic-texture extension is a side-effect
module the WebGL2 imports never reach.

**Change.** `import "@babylonjs/core/Engines/WebGPU/Extensions/index.js"` in
`gpuEngine.ts`, every extension at once, so the next one a model needs is
not found by a player. It is in the dynamically imported module, so it costs the
WebGL2 bundle nothing.

**WebGL2.** Untouched. **Test.** The side-effect import is in `gpuEngine.ts`, and
no module reachable by static import from `client/src/main.ts` imports
`@babylonjs/core/Engines/webgpuEngine` or anything under
`@babylonjs/core/Engines/WebGPU/`.

## 7. Parity

### 7.1 The poses

Every pose is shot on one build twice, `?engine=webgl2` and `?engine=webgpu`,
both with `?tier=high`, 1200 × 2029 at device pixel ratio 1, each from a fresh
page, the two back to back; the pose set by the uncommitted `__fcSet` patch as
in every earlier note. Then the whole set again with `?tier=medium`: the same
poses, conditions and crops, its own same-engine floor, its own verdicts.

What the medium tier draws differently, and so what the second set checks: a
1024² shadow map with one cascade (high: 2048², two); blade clumps at half the high tier's counts, floored at four blades a
clump (`BLADE_TIER_COUNTS`); the duff out to 16 m (24); cliff rings at 60,
140 and 250 m (60, 160, 400); no scene pass and no halation, so the grade pass
is the first pass and the multisampled one; texture mips capped at 1024; rain
at 1,200 particles (2,000) and motes at 600 (1,500). Hardware scaling is 1 on
both. The one-cascade shadow and the grade pass owning the scene target are
shader and pipeline variants the high tier never builds.

| pose | conditions | camera | crops | what it checks |
| --- | --- | --- | --- | --- |
| canopy | `atmo`, mist, noon | `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` | near `280:500:420:970`, mid `220:22:400:678`, the trail bed and the sky placed by Task 5 | blades, cards, sward; the bed where the spike saw it |
| meadow | `atmo`, mist, noon | `__fcSet(369, 51.01, -855, 0, 0.3)` | near `360:500:420:980`, mid `240:22:480:740` | open sward |
| meadow-trail-along | `atmo`, clear, noon | `__fcSet(258, 85.7, 120, 1.6, 0.15)` | bed `160:120:520:1280`, beside `160:120:120:1280` | a dry bed in the open |
| trail-down | `atmo`, clear, noon | `__fcSet(283, 85.7, 134, 0.6, 0.55)` | bed `260:110:70:1450`, beside `260:110:60:1250` | the bed from above |
| trail-along | `atmo`, clear, noon | `__fcSet(283, 85.7, 134, 1.892, 0.12)` | bed `170:170:400:1480`, beside `170:170:600:1480`, sky | the bed toward the horizon |
| canopy-floor | `ypeqauxk`, clear, noon | `__fcSet(-291.4, 22.9, 58.5, 1.06, 0.85)` | bed `380:700:700:850`, beside `380:700:120:850` | the litter floor and a bed under canopy |
| cliff face-30m | `atmo`, clear, noon | `__fcSet(-370, 25, -900, 1.571, -0.3)` | the face, placed by Task 6 | the rock modules and their tint |
| cliff seam-a | `atmo`, clear, noon | `__fcSet(-147, 53.1, 42, 0.0, 0.15)` | the bed over rock, placed by Task 6 | the trail over steep rock |
| night | `atmo`, `weather eerie`, `time 21`, lamp on | trail-along's camera | the lamp pool, the sky, placed by Task 6 | lights, the dread grade, rain, fog at night |

The grass poses are the near-grass design's (§4.1); the trail poses and their
crops are the floor-look verification's (§2, §8–§9, its replacement pair for
trail-along); the cliff poses are the cliff-modules verification's (§2). The
night pose is new: the earlier lamp checks ran at eerie 20–21 h on the trail
without a recorded camera. The lamp is switched on by its key (`KeyF`,
`input.ts:236`) before the free camera is entered, or by an uncommitted hook if
the free camera takes the key; the local headlamp is parented to the camera
(`renderer.ts:673–674`), so it lights what the free camera sees.

### 7.2 The measures

Per crop, the pixels are decoded from sRGB to linear. Recorded: the mean
linear luminance (`0.2126 R + 0.7152 G + 0.0722 B`), the mean linear RGB and
its CIELAB coordinates (D65), and at the grass poses the cover fraction against
the near-grass thresholds (0.02058 canopy, 0.02853 meadow). At the trail poses,
the floor-look bed/beside luminance ratio as well. Whole-frame mean absolute
difference is reported, never barred: wind, dapple and wildlife move between
any two stills (the cliff note scored the same build at the same pose 14.7 and
18.7 dB apart).

### 7.3 The floor and the bar

A crop's noise floor is its same-engine repeat: two WebGL2 page loads at the
pose, the luminance ratio between them, the CIELAB distance between their crop
means, the cover difference. **Bar, per crop:**

- WebGPU's mean luminance over WebGL2's in 0.95–1.05, or within twice the
  floor's ratio where that is wider;
- ΔE\*ab between the two crop means ≤ 2.0 (about one just-noticeable
  difference), or twice the floor where that is larger;
- cover within 0.02 of WebGL2's (a page load moves it by up to 0.015, the
  spike found), or twice the floor;
- at the trail poses, the bed/beside ratio inside the floor-look window
  (0.9–1.3) and within 0.05 of WebGL2's.

### 7.4 The verdict

In words, per pose: are the same things drawn, the same materials, the same
hue and light, nothing missing, nothing sparkling or banded that the other does
not have. A pose passes when every crop meets its bar and the verdict reads the
same picture. A crop that misses its bar while the verdict reads the same may
be **accepted** only with the reason written beside it in the verification note
(the wind's phase at a card edge, say); a difference the eye can see is never
accepted, whatever the numbers.

## 8. The trail bed

### 8.1 What was seen

At the canopy pose in mist, on WebGPU, the bed reads cooler and greyer than
WebGL2's warm brown, with a pale glint where it meets the horizon. The spike
read it as the trail paint's snow mix being taken. Near cover and luminance
matched; the sky was a little greener; a fern at the frame's edge was dimmer.

### 8.2 The paint, read against the symptom

There is no branch on a uniform or define in the paint that could evaluate
differently: `TRAILPAINT` and `VERTEXCOLOR` are defines computed on the CPU and
the same on both engines, and every runtime branch (`trailPaint.ts:333, 342,
349`) is on distances and texture data. Every local is initialised. The
fragment stage is `highp` on WebGL2 and `f32` on WebGPU, so no precision is lost
moving to WebGPU. The snow mix is not a branch but a blend by
`tSnow = 1 − clamp(vTerrainW2.y)` (`trailPaint.ts:362`); for it to act, the
vertex attribute's second channel would have to reach the fragment as zero.
A missing attribute would do that, but on both engines alike: WebGL2 reads a
disabled attribute as (0, 0, 0, 1), and Babylon's WebGPU engine binds a
one-float dummy of 0 (`webgpuEngine.pure.js:506–511`,
`webgpuCacheRenderPipeline.js:696–702`), which WebGPU widens to the same
(0, 0, 0, 1). And every ring uploads the attribute (`renderer.ts:221–223`);
nothing found by reading draws the terrain material without it.

And the symptom argues against the snow mix. Taken, it sets
`tGravel = tOnBench × (1 − tSnow)` to zero (`:455`), so the bed keeps the
ground's own roughness and F0 scale (`:472–473`): grass and floor are 1.0 and
0.5 in `LAYER_ROUGHNESS` and `LAYER_F0` (`terrainTexture.ts:184, 188`), where the
bench is the pebble's 0.9 and 0.85, glossed by the wet weather to about three
quarters of that in the core (`:471`, `TRAIL_WET_GLOSS` 0.5 at the mist
preset's wetness 0.5). A snow-mixed bed is rougher and less reflective than
WebGL2's. It cannot glint where WebGL2's does not. Puddles are not it either: at
wetness 0.5 `smoothstep(0.55, 0.8, 0.5)` is 0 (`:448`) on both engines.

### 8.3 The likely mechanism

The bed is the most specular ground in the mist preset: the pebble's F0 scale
and a wet-glossed roughness, where the grass beside it is at 1.0 and 0.5. Of
everything the bed shows, the part that grows with gloss and grazing angle is
the reflection of the environment: `scene.environmentTexture` is a 128² probe
cube rendered once from the sky material (`lighting.ts:47, 246–254`), mip-mapped
and read by PBR through roughness-selected levels, together with Babylon's BRDF
lookup texture. A difference in that chain between the engines would show on
the bed before anything else: a cooler, greyer sky in the reflection, and more
of it at grazing angles, a pale band where the bed meets the horizon. The same
chain reaches the rest of the frame weakly, which fits the other two
observations: the sky's own tint (the probe's source) and a dimmer fern (its
ambient share). Candidate links, each engine-specific: the sky shader's
arithmetic through the other translator (an edge case of `pow` or `exp` that one
compiler clamps and the other does not); the probe cube's faces or mip chain
(WebGL2's `generateMipmap` against Babylon's own WebGPU mip blit); the probe's
gamma handling (it is made with `linearSpace` false, eight bits per channel);
the BRDF lookup's RGBD decode.

Ranked: **(1)** the environment light the wet bed reflects; **(2)** a trail input
reaching the fragment differently (the weights attribute, `terrainWet`); **(3)**
the post chain, which would move every surface alike and is last for that
reason.

### 8.4 The first diagnostic step

At the canopy pose in mist, on both engines, on the same build, three stills
of the bed crop on one page each: as is; with `__scene.environmentIntensity = 0`
and the probe's reflection removed; and with `weather clear` (wetness 0, so no
gloss). If the gap closes with the environment off, the chain of §8.3 has it,
and the next step reads the probe's six faces back on both engines and compares
the sky crop. If it stays, the trail's inputs are shown in false colour by an
uncommitted patch that writes `(tSnow, terrainWet, clamp(vTerrainW2.w, 0.0, 1.0))`
into the bed's albedo, and `WebGPUCacheRenderPipeline.LogErrorIfNoVertexBuffer`
is set, which makes Babylon name any declared attribute drawn without a buffer.

### 8.5 The fix

The fix is decided by what the diagnosis finds, and each outcome's lever is
known in advance: for the probe, its format or gamma set explicitly, or its mip
chain generated the same way on both engines; for the sky, whose shaders are
Babylon's own, the sky left on Babylon's WGSL port on WebGPU instead of the
translated GLSL (one constructor argument, §5.4), or the sky parameter whose
arithmetic diverges clamped where it is set; for an input, the binding. Whatever
it is, it must not move WebGL2's pixels: a change that only the WebGPU path
takes is preferred, and a change to shared shader text re-runs the identity
pins and the WebGL2 stills at the trail poses against `main`. **Bar:** the
canopy pose's bed crop and every trail pose of §7.1 inside §7.3's bar, and the
verdict reads the same bed.

**As found (the verification note, §6).** Neither the probe nor the sky nor a
trail input: the ladder's second branch ruled out the snow mix, the wetness,
the weights attribute and a missing vertex buffer, and the probe's faces and
the BRDF lookup read back equal. Two causes, each confirmed on the page
without a build edit. **The ground's texture arrays** (`terrainRAH`,
`terrainNormals`, 512², six layers, ten levels, the only array textures the
game makes, `groundMaps.ts`) had mips on layer 0 only on WebGPU: Babylon
9.18's WebGPU mip pass for a `RawTexture2DArray` renders layer 0 alone, so
the bed's occlusion, read from layers 4 and 1, went to 0 beyond level 0 and
the bed went black, with the stepped edge at the level boundary. The fix is on
the WebGPU path only: every WebGPU engine runs Babylon's own mip pass for
each other layer after it (`mipEveryLayer`, `gpuEngine.ts`), each level
rendered from the one above through a linear sampler, the 2×2 average
WebGL2's `generateMipmap` gives every layer; a canary pins Babylon's
layer-0-only pass. Building the mips on the CPU before upload instead would
cost about 9 ms of start-up for both arrays (measured in node, the real
sizes), but it would change WebGL2's upload and filter too, which this fix
must not. **The rest of the frame**, 1.23× near ground in mist and up to 2×
in clear, was the probe's spherical harmonics, registered on WebGPU alone by
the non-pure PBR module the WebGPU module imported; it now imports the pure
one (§13's parity). With both corrected on the page, the frame matched WebGL2
within the same-engine floor on both tiers. The fixed build has not yet been
read in a browser.

## 9. The impostor bake

The bake cannot render until every clone's effect is ready under the bake's own
pass and camera, and that readiness is the only honest gate
(`forestMeshes.ts:589–615`). The 5 s deadline was a guard against a gate that
never opens; its cost is that a slow compile, on either engine, silently
removes the far forest for the life of the page.

**Change.** `defaultBakeImpostor` waits for `rtt.isReadyForRendering()` with no
deadline, and ends in exactly three ways: ready, when it renders and resolves
the texture; failed, when any bake clone's effect reports a compilation error,
when it logs one `console.error` naming the model and resolves null; or aborted,
when the forest is disposed, through an `AbortSignal` the forest owns, when it
disposes the render target and resolves null without logging. At
`IMPOSTOR_BAKE_WARN_MS` = 30,000 it logs one `console.error` naming the model
and keeps waiting: late is better than never, but late must be visible. The
fourth parameter stays the pose; the third, `timeoutMs`, becomes the options
`{ signal, warnMs }`. `adoptBake` logs a `console.error` for a null that is not
an abort. The spike's six-fold slack is not taken: a budget per engine is a
guess per machine, and a slow laptop on WebGL2 hits today's too.

**Tests.** With fake timers: a gate that opens after 40 s of polls resolves a
texture (today: null at 5 s); a compile error resolves null and logs; the
warning fires once at 30 s and the wait goes on; an abort stops the polls and
disposes the target; and through `createForestMeshes`, a bake that resolves null
logs an error naming the billboard, so a far forest can no longer drop out
without a word.

**WebGL2.** The same change applies: a bake that took more than 5 s, which
today drops the far forest, now lands late.

## 10. The pipeline-cache bug

Babylon's WebGPU pipeline cache keys each vertex attribute as
`vertexBuffer.hashCode + (location << 7)` (`webgpuCacheRenderPipeline.js:720`).
`VertexBuffer.hashCode` folds the type, normalisation, size, instancing and
stride (`buffer.pure.js:337–345`), not the byte offset. Yet the offset of an
attribute that lies inside its stride is baked into the pipeline's vertex
layout (`webgpuCacheRenderPipeline.js:794–834`). Two meshes that read one
buffer at different offsets, the same kind and format at the same location,
therefore share whichever pipeline was built first and read its data. On
WebGL2 there is no such cache and they draw correctly. The spike met it when
its twelve interleaved blade buckets vanished.

Nothing on `main` meets it today: every thin-instanced mesh reads its matrix
at the same four offsets. Build I (Task 7) is the first to. The workaround,
`offsetKeyedVertexBuffer(buffer, kind, offset, size)` in
`webgpuVertexBuffer.ts`, creates the vertex buffer, replaces that instance's
`_computeHashCode` with one that adds `byteOffset × 2^24` above the stride's bits
(stride ≤ 2,048 bytes occupies bits 12–23), and runs it, so a later recompute
(the `instanceDivisor` setter) keeps the term. A canary test asserts that two
plain vertex buffers at different offsets still hash equal; when a fixed
Babylon ships, the canary fails, and the workaround and its callers go in the
upgrade's own commit. A source scan asserts that no other file creates a
vertex buffer over a shared buffer at a non-zero offset.

**As found (the verification note, §6.2).** Something on `main` does meet it:
the glTF loader's interleaved buffers. `understory.fern` and
`understory.shrub` share one effect, their UVs one hash at offsets 24 and 12
of a 48-byte stride, so on WebGPU the shrub was drawn with the fern's pipeline
(leaf cover 0.016 against 0.058). The offset now keys every vertex buffer a
WebGPU engine draws, whoever made it: `keyEveryBoundBuffer`
(`webgpuVertexBuffer.ts`), installed by `createWebGpuEngine` on the WebGPU
pipeline cache's prototype, keys each buffer as the cache's `setBuffers` takes
it, before `_setVertexState` reads its hash, the main cache and the clear
quad's alike. WebGL2 engines never use that cache, and a test draws a mesh on
one and finds every buffer's hash and plain property as they were. The fixed
shrub has not yet been read in a browser.

The draft upstream issue is Appendix A. Filing it is a manual step for whoever
maintains this repository's account with the Babylon.js project; no task in the
plan files anything.

## 11. Determinism and the network

The engine is a rendering choice and nothing else. `sim/` imports nothing from
`game/`, `net/` or `@babylonjs/*` (`client/test/architecture.test.ts:74–86`, and
the ESLint rule at `eslint.config.js:18–23`), and `net/` imports neither Babylon
nor `game/` (`architecture.test.ts:88`); the new modules live in `game/`. The
simulation's state never reads a rendered value: the camera pose, the wind, the
interact prompt and the wildlife feed audio and the HUD only. The protocol
carries no engine field and `PROTOCOL_VERSION` stays 5, so a WebGPU host and a
WebGL2 follower build the same world from the same seed and run the same ticks;
only their pixels differ, and those within §7. `passHash` stays −311867473
(`client/test/sim/groundGradient.test.ts:700`). One test is added: the three
modules this design creates are not imported from `sim/` or `net/`, which the
existing rules already imply and which is pinned by name so the intent is
written down.

## 12. The compute-culled blades and the grass frame filter

### 12.1 How the two streams meet

The grass frame reclaim's step 1a (its plan's Task 2A: the blade field's 36
buckets and the grass class's 4, each frame the view moves, drawing only the
prefix of their collected buffers inside a widened frustum) is being gated as
this is written. It is engine-agnostic: pure CPU arithmetic in `grassCull.ts`,
then `thinInstancePartialBufferUpdate` and `thinInstanceCount`, which Babylon
implements on both engines. Its hook is
`scene.onBeforeActiveMeshesEvaluationObservable` in `renderer.ts`; this
design's contact with `renderer.ts` is the engine passthrough at `:647` and
`detectTier` moving out (`:517–527`), so the two touch the same file in
different places.

- **If the filter merges first**, this stream rebases, and Task 6's frame gate
  measures WebGPU with the filter against WebGL2 with the filter. Task 6 also
  reruns the filter's own invisibility check (its design §12.1: stills with the
  filter on and off on one page differ no more than two consecutive filter-off
  stills) and its turn on WebGPU.
- **If this stream's Task 6 merges first**, the grass frame's remaining gates
  add a WebGPU row: the same checks on `?engine=webgpu`.

Either way the filter must hold on both engines before Task 7 starts, and the
spike's −1.53 ms (§3.2) is re-measured, not assumed: the filter removes vertex
work the WebGPU engine may have been winning on.

### 12.2 Build I, on the filter's buffers

The spike's cull pass re-packed the CPU fill's buckets into one candidate
buffer. The filter keeps exactly those buckets on the CPU as its **collected**
buffers. Build I takes them as its candidates on each rebuild, so the CPU fill
is shared, and on WebGPU with I on the blade buckets skip the CPU `cull()`; the
grass class keeps the CPU filter. Per frame, one compute pass per the spike's
kernel (each tier's band in the foliage plugin's own eye distance, the clump's
sphere against the camera's six planes, an `atomicAdd` on its bucket's counter,
the 21 floats written at that slot) into one interleaved output buffer per
tier, bound as the thin-instance attributes through §10's workaround, and the
pass's counts copied into each bucket's indirect arguments. The frustum comes
from the camera's final pose for the frame, the same pose the filter reads, the
view bob included. No S, no F, no tail pass, and no URL switch in shipped code.

A layout worth trying first, because it avoids §10's bug altogether: one output
buffer per tier with each bucket's slots contiguous, every bucket mesh bound at
offset zero, and each bucket's region selected by the indirect arguments' first
instance. It needs the optional `indirect-first-instance` feature, which would
join the required set; Task 7 measures whether the reference adapter offers it
and keeps the interleaved layout if not.

### 12.3 The bar

Against **B′**, WebGPU with the grass frame filter on the blades and the grass
class, on the same build: at the canopy pose, native pixels, order-averaged over
quiet rounds, I − B′ ≤ **−0.3 ms**; near cover at both poses at least B′'s less
0.01; the grass frame's turn (32 steps at pitch 0.3 and 0.9, then a sweep at 90°
a second) with nothing appearing or vanishing at a frame edge; draw calls not
above B′'s; JS frame time not above B′'s. 4× reported. Why 0.3: against the
unfiltered field S saved 1.03 ms; the filter's expected blade share is 0.53 ms
(grass frame design §5.4, as built); what can be left for I over the filter is
about half a millisecond, and 0.3 stands clear of the spike's same-code floor
of ±0.11. If I misses, it does not ship, and the filter stays the blades' path
on both engines.

### 12.4 What I leans on

Three private internals, each pinned by a canary test against the installed
Babylon that names it: the engine's render encoder, its render-pass ending, and
a submesh's draw wrapper and draw context. And one thing the spike did not
check: the counts are copied after the compute pass and before the draw, and the
copy ends whatever render pass is current. On a tile-based GPU, ending and
resuming the multisampled scene pass costs a store and a reload of its
attachments. The gate confirms, in a WebGPU Inspector capture, that the scene
target gets one render pass per frame on I as on B′; if not, the pass and the
copy move to before the camera binds its target.

## 13. Gates

### 13.1 Frame

The near-grass pair method with the spike's quiet rule: one browser start per
round, a discarded warm-up page, the two builds on fresh pages in alternating
order, at least two rounds each way; same-code rounds on each engine for its
noise floor, repeated if over 0.5 ms; only quiet rounds read; per page the pose,
3 s to settle, 8 s of `onAfterRenderObservable` intervals, mean and p95. The
"builds" are one commit with `?engine=webgl2` and `?engine=webgpu`, both
`?tier=high`; then every pose again with both at `?tier=medium` (what that tier
draws differently is listed in §7.1), with its own same-code floors.

- **Bar, the same on each tier:** at the canopy pose at native pixels, on the
  reference machine, WebGPU faster than WebGL2 by more than the larger of the
  two engines' same-code floors there.
- **Guard, the same on each tier:** at every other pose below, WebGPU −
  WebGL2 no larger than the larger of the two engines' same-code floors there.
  A regression at any pose blocks that tier.
- A tier's WebGPU path turns on when it meets the bar **and** the guard **and**
  passes the parity gate (§7, §13.2) on that tier (§16).
- **Expected, reported, not a gate:** on the high tier about **−1.5 ms** at that
  pose (§3.2). No spike figure exists for medium, which draws less on every page
  (one cascade, half the blades, no scene pass).
- **Reported, both tiers:** every other pose's gain, and a slower pose's JS and
  draw-call figures (§16); the canopy and meadow poses at 4×; the canopy pose in a
  1920 × 1080 window; per page the JS frame time (`onBeginFrameObservable` to
  `onEndFrameObservable`) and the draw calls.

Poses: canopy, meadow, TRAILSIDE (`__fcSet(263.9, 85.77, 118, 0.6, 0.25)`, mist,
noon), cliff face-80m (`__fcSet(-420, 60, -900, 1.571, -0.05)`, clear, noon: the
long view, every LOD ring), night (§7.1), and **spawn**: no free camera, the
player's own view at the trailhead of seed `atmo` 5 s after the world appears,
where the summit models, the kiosk, the SUV and the fingerposts put the most
draw calls in view. WebGPU's per-draw JS in Babylon is not WebGL2's, and the
spawn view is where a CPU-side cost would show.

Also, once per tier: WebGL2 on the branch against WebGL2 on `main`, at the
canopy pose, within the same-code floor. The switch must not cost the players
who keep WebGL2 anything.

### 13.2 Parity

§7, every pose, every crop, with the verdicts.

### 13.3 Startup

Per engine on the same build, three loads **cold** (a fresh browser profile:
no HTTP cache, no GPU shader cache) and three **warm** (the next load in the
same profile), recording: the time from navigation to the first frame of the
game scene (on WebGPU it includes the engine's choice, with "Loading…" on screen,
§5.4); the time to **settled** (the five impostor bakes landed and no effect
compiled for 5 s); the effects compiled; and, over a scripted minute after
settling (the canopy walk, a full turn, the lamp on, `weather rain`), the
longest frame. **Bars:**

- warm first frame on WebGPU no more than **0.5 s** after WebGL2's; cold, no
  more than **2.5 s** after (the translators' 0.9 MB and their instantiation);
- settled within **30 s** cold on WebGPU, with all five bakes landed;
- the scripted minute's longest frame on WebGPU no more than the larger of
  **100 ms** and WebGL2's longest plus 50 ms.

The third bar is the one most likely to bite. Babylon translates a GLSL effect
on WebGPU synchronously on the main thread, where WebGL2 compiles in parallel,
and a headlamp turning on changes every lit material's defines. §16 has the
lever.

### 13.4 Memory

At the canopy pose after 60 s, per engine: the page's renderer process and the
GPU process, from the browser's task manager, and `performance.memory`'s used JS
heap. **Bars:** the renderer process on WebGPU within **96 MB** of WebGL2's (two
translator instances and their heaps); the GPU process within **20 %**. Over a
ten-minute walk on WebGPU, no growth past **5 %** after the first minute.

### 13.5 Console

Zero `console.error` on every page of every gate, and on WebGPU pages zero
Babylon warnings that begin `WebGPU uncaptured error` or `WebGPU context lost`,
which Babylon logs as warnings, not errors (`webgpuEngine.pure.js:451–467`).

### 13.6 The fallback, exercised

Each on the branch, with the measuring browser injecting what it needs before
the page's own scripts run; nothing of it is committed. Items 3–5 are the
reload paths as built behind the off switch, and belong to Task 1's gate; the
live swap (§5.5) replaces them with 3′–5′, which Task 6 runs once the swap has
landed. The rest hold on either path.

1. `navigator.gpu` hidden: WebGL2, no error; `?engine=webgpu` gives WebGL2 and
   one warning.
2. An adapter reporting `maxInterStageShaderVariables` 16: WebGL2.
3. A lost device, by crashing the GPU process from another tab
   (`chrome://gpucrash`): one reload on WebGPU; again, a reload onto WebGL2, the
   record written, the HUD line shown; the next load WebGL2; `?engine=webgpu`
   still WebGPU; with the record deleted, WebGPU again.
4. An uncaptured validation error dispatched on the device inside the startup
   window: the record written, a reload onto WebGL2, the HUD line.
5. `localStorage` throwing, then (4): the reload's URL carries `?engine=webgl2`;
   no second reload.

   With the swap in place of 3–5, and a second page following as a party
   member in each:

   - **3′.** A lost device, as in 3: the renderer rebuilt on a new WebGPU
     engine on a fresh canvas, the hike going on and the loss counted, the
     line "Graphics restarted after a GPU error."; a second loss: rebuilt on
     WebGL2, the record written, the switched line; the next load WebGL2.
   - **4′.** An uncaptured validation error, inside the startup window and, on
     another page, after it: rebuilt on WebGL2 on a fresh canvas at once, the
     record written, the switched line, no reload; the party kept in both cases
     (the host's room open, the follower connected).
   - **5′.** `localStorage` throwing, then (4′): WebGL2 at once, the tab's URL
     pinned to `engine=webgl2`; a reload of it stays on WebGL2.
6. Before Task 2 lands, the real failures of §3.3 on `?engine=webgpu`: the game
   ends on WebGL2 every time. Task 1's gate is this.
7. A `requestAdapter` that never answers: WebGL2 once `WEBGPU_START_MS` have
   passed, `init` recorded. A translator fetch that stalls: WebGL2 once
   `WEBGPU_FETCH_MS` have passed, nothing recorded.
8. A translator loader served as the host's HTML page (a missing asset): WebGL2
   at once, nothing recorded.

### 13.7 The probe on WebGPU

What turns `WEBGPU_PROBE_STEPS_SETTLE` on (§5.9): on each tier probed, with an
empty browser shader cache, a measurement build that sets it true, and
`?probe=high` on WebGPU at the canopy pose, the
time from each step's engine to its meter's `ready`, and whether a reading
came, over five loads each on the slowest machines whose class is probed (a
four-core Windows laptop among them) and on the reference Mac. **Bar:** every
step ready inside `PROBE_READY_MAX_MS` (15 s) with at least 5 s to spare, and a
reading on every load. Short of it, the value stays false and those machines
are probed on WebGL2, their verdict read for WebGPU.

**A condition of the switch.** A WebGL2 verdict is read as a floor for WebGPU
(§5.9) because WebGPU drew the same scene faster at every pose measured so far.
Before `WEBGPU_ENABLED` goes on, the reference machine's frame gate (§13.1;
the plan's Task 6 Step 2 guard) must show WebGPU no slower than WebGL2 at every
pose on both tiers; a pose where it is slower means a WebGL2 verdict could put
a WebGPU hike above what it holds, and the switch stays off for that tier.

## 14. Tests

- `engineChoice.test.ts`: the overrides parsed from literal query strings;
  `chooseEngine` over a literal table (tier × override × fits × remembered ×
  `WEBGPU_ENABLED`); `WEBGPU_TIERS` pinned as `["high", "medium"]`, and the
  rule reading it; `adapterFits` on literal limits (§6.4); the remembered
  record holding, lapsing on a new browser major, a new Babylon version and
  after 30 days, and the lost-device count (one loss does not hold, two within
  24 h do, two a day apart do not).
- `renderer.test.ts`: the renderer uses an engine it is given and makes WebGL2's
  own otherwise, with WebGL2's options unchanged.
- `webglIdentity.test.ts`: §6.0's pins.
- `post.test.ts`: `finishFragmentFor` both ways (§6.1).
- `terrainTexture.test.ts`, `groundHex.test.ts`, `shaderHygiene.test.ts`: the
  split include (§6.2); the reserved-word scan and the rename (§6.3).
- `atmosphere.test.ts` and a plugin-wide binding test (§6.5).
- `architecture.test.ts`: no static route from `main.ts` to the WebGPU engine
  (§6.6); the new modules absent from `sim/` and `net/` (§11).
- `forestMeshes.test.ts`: §9's five cases, replacing "a gate that never opens
  times out to null".
- `webgpuVertexBuffer.test.ts`: distinct hashes by offset, kept across an
  `instanceDivisor` write; the canary; the source scan (§10).
- `bladeGpu.test.ts` (Task 7): the record layout and interleave as literals; the
  band test against `bladeTierBands`; the kernel's text pinned where it states
  the band and the sphere; the three private names' canaries.

No test asserts a wall-clock bound; frame, startup and memory are gates.

## 15. What is not changed

- Everything under `client/src/sim/`, the level id and the protocol.
- Every asset, model and texture.
- What each tier draws, the low tier's engine, the landing backdrop, and the
  WebGL2 path's shader text, except §6.3's identifier.
- The desktop launcher.
- Tier detection (§4).
- The blade field, the cards and the grass frame filter, until Task 7, which
  changes only how the blades are drawn on WebGPU.

## 16. Fallbacks

Pre-stated, in order:

- **The frame bar, the guard and parity, per tier** (§13.1, §13.2). Each tier
  is judged on its own: faster than the same-code floor at the canopy pose at
  native, no standard pose slower than its floor, and parity passed.
  - **Both tiers pass:** both on. `WEBGPU_TIERS` stays `["high", "medium"]` and
    `WEBGPU_ENABLED` goes on.
  - **One tier passes:** that tier on. `WEBGPU_TIERS` becomes that tier alone,
    in its own commit with its test, and the switch goes on for it; the other
    is measured again with Task 7.
  - **Neither passes:** off. The engine path stays on `main` behind
    `?engine=webgpu`, Task 7 is measured on it, and a tier goes on when the
    engine with I passes that tier's bar, guard and parity against WebGL2 with
    the filter. If the 4× delta is not a gain either, the design is revisited
    with the figures.

  The high tier's 1.5 ms is reported against its expectation either way; a
  shortfall there is a finding for the note, not a reason to keep a passing
  tier off.
- **A pose slower than its floor** (the guard, §13.1): that tier does not go
  on. The pose's JS and draw-call figures say whether it is CPU-side; if so, the
  first lever is Babylon's WebGPU snapshot rendering for the static buckets
  (§17), then the tier is measured again.
- **The startup hitch bar missed**: the lit materials' lamp-on variants compiled
  behind the loading screen, by `forceCompilationAsync` with the lamp enabled
  for the call, then the startup gate re-run.
- **A limit that Windows adapters do not reach**: §5.2's varying pack.
- **Parity missed at a pose after Task 5**: the pose's difference diagnosed as
  in §8.4 and fixed in its own commit; the switch does not go on with a
  difference the eye can see.
- **Build I under its bar**: it does not ship (§12.3).

## 17. Follow-ups

- **Tier detection.** A desktop browser with a qualifying WebGPU adapter is a
  better signal for the high tier than `deviceMemory`, which says nothing of
  the GPU, which Chromium capped at 8 GB until Chrome 147, and which the others
  do not expose. A design of its own, being written, with a frame gate on
  medium-class machines, since everyone it promotes pays the high tier's costs.
- **The plugins in WGSL.** It would remove the 2.7 MB of translators, their
  startup cost and the synchronous translation hitch, and every §6 change with
  them. About 1,325 lines.
- **Translated shaders looked up, not translated at every start**
  ([its design](2026-09-28-webgpu-shader-lookup-design.md)): a lookup keyed by
  the exact GLSL, with the browser's store built and translations shipped with
  the build next, against the 39.8 s of translation measured on a 4-CPU
  machine's start.
- **Snapshot rendering** for the static buckets, if the spawn pose shows a
  CPU-side cost.
- **A mesh-level indirect instance count** upstream, the spike's §8 shape, if
  build I ships on private internals.
- **A committed pose command**, so every gate here reproduces from a URL alone
  (the near-grass design's follow-up, still open).
- **A WebGL2 verdict and a WebGPU probe.** While WebGPU probe steps are not
  taken to settle, a holding WebGL2 verdict is read for WebGPU as a floor and
  stops the probe (§5.9). If WebGPU steps are later measured to settle
  (§13.7), decide whether a holding WebGL2 verdict should keep stopping a
  WebGPU probe, or give way to one, since it would then keep a WebGPU hike
  unmeasured for up to 30 days.
- **The probe's spherical harmonics on both engines.** WebGL2, as shipped,
  never computes them: `BaseTexture.sphericalPolynomial` is Babylon's stub
  unless its polynomial module is loaded, so PBR's diffuse ambient from the
  environment is absent, and WebGPU now matches that. With them, the near
  ground reads about 1.23 times brighter in mist and up to 2 times in clear
  (the verification note, §6.6), the sky crop 2.1 times in clear; the
  environment's diffuse light would then come from the probe, which may be
  the more natural picture, and would move WebGL2's look and its stills. A
  change to the look, judged by its own gate, not a parity fix.

## Appendix A. Draft upstream issue

For the Babylon.js repository's issue tracker. Not filed by this work.

**Title:** WebGPU: render pipeline cache ignores a vertex buffer's byte offset,
so meshes reading one buffer at different offsets share a pipeline

**Body:**

> **Babylon.js version:** 9.18.0, WebGPU engine (`WebGPUEngine`). WebGL2 is not
> affected.
>
> **What happens.** Two meshes use the same material. Each binds the same
> custom attribute kind, with the same format, from one shared `Buffer`, at a
> different byte offset inside the stride. On WebGPU both meshes draw with the
> offset of whichever mesh was drawn first; on WebGL2 each draws its own data.
>
> **Why.** `WebGPUCacheRenderPipeline` keys each attribute's vertex state as
> `vertexBuffer.hashCode + (location << 7)` (in `_setVertexState`).
> `VertexBuffer._computeHashCode()` folds the type, `normalized`, the size,
> `_instanced` and `byteStride`, but not `byteOffset`. When the offset lies inside
> the stride (`_validOffsetRange`), `_getVertexInputDescriptor()` bakes
> `effectiveByteOffset` into the pipeline's `GPUVertexAttribute.offset`. So the
> cache returns a pipeline whose baked offset belongs to another mesh. Whether
> consecutive attributes share one GPU buffer also shapes the vertex layout and
> is not in the key either; a mismatch there goes one of two ways by draw
> order: a mesh binding two buffers, drawn with a pipeline built for one, reads
> its second attribute from its first buffer without an error; the reverse
> fails validation.
>
> **Minimal reproduction** (a playground on the WebGPU engine):
>
> ```js
> const engine = new BABYLON.WebGPUEngine(canvas);
> await engine.initAsync();
> const scene = new BABYLON.Scene(engine);
> new BABYLON.ArcRotateCamera("c", 0, 1, 6, BABYLON.Vector3.Zero(), scene);
> const a = BABYLON.MeshBuilder.CreateBox("a", {}, scene);
> const b = BABYLON.MeshBuilder.CreateBox("b", {}, scene);
> b.position.x = 2;
> const n = a.getTotalVertices();
> // One buffer, 8 floats per vertex: a red vec4, then a green vec4.
> const data = new Float32Array(n * 8);
> for (let i = 0; i < n; i++) data.set([1, 0, 0, 1, 0, 1, 0, 1], i * 8);
> const buffer = new BABYLON.Buffer(engine, data, false, 8);
> a.setVerticesBuffer(buffer.createVertexBuffer("tint", 0, 4));
> b.setVerticesBuffer(buffer.createVertexBuffer("tint", 4, 4));
> const mat = new BABYLON.ShaderMaterial("m", scene, {
>   vertexSource: `precision highp float;
>     attribute vec3 position; attribute vec4 tint;
>     uniform mat4 worldViewProjection; varying vec4 vTint;
>     void main() { vTint = tint; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
>   fragmentSource: `precision highp float; varying vec4 vTint;
>     void main() { gl_FragColor = vTint; }`,
> }, { attributes: ["position", "tint"], uniforms: ["worldViewProjection"] });
> a.material = mat;
> b.material = mat;
> engine.runRenderLoop(() => scene.render());
> ```
>
> **Expected:** `a` red, `b` green. **Actual on WebGPU:** both red. On WebGL2:
> red and green.
>
> **Suggested fix.** Key the baked offset where it is baked: in
> `_setVertexState`, include `vertexBuffer.effectiveByteOffset` in the state
> when `_validOffsetRange` is true (and, for the grouping, whether the
> attribute shares the previous attribute's GPU buffer). Folding the offset into
> `_computeHashCode()` would also work (an offset below the stride's 2,048-byte
> maximum fits above the stride's bits, as `byteOffset * 2 ** 24`), but the hash
> is public API, and the cache is where the offset matters.
>
> **Workaround.** Give the vertex buffer instance its own `hashCode` accessor:
> the setter keeps whatever Babylon assigns, and the getter adds
> `byteOffset * 2 ** 24`. Adding the term once is not enough, since
> `_computeHashCode()` reassigns `hashCode`, and runs again whenever the
> `instanceDivisor` setter flips instancing; the accessor survives that, and
> any other assignment.
