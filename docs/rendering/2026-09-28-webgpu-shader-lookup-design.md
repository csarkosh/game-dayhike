# WebGPU shader lookup: design

**As built, 2026-09-28.** The lookup layer, the browser's store and the
recorder, on `worktree-webgpu-wgsl`, behind the WebGPU engine's off switch
(`WEBGPU_ENABLED = false`, so reached only with `?engine=webgpu`). Shipping
translations made at build time is the next step, on the same layer (§5.2).
Nothing here has yet been measured in a browser: §8 says what has to be, and
§9 the bars it must meet.

Babylon 9.18.0 throughout; line references are to its installed
`node_modules/@babylonjs/core`.

## 1. What was measured

On a Windows machine with an NVIDIA T4 and 4 virtual CPUs, high tier, canopy
page ([the WebGPU design](2026-09-26-webgpu-high-tier-design.md), §13.3):

| | first frame | settled | frames drawn in the first 50 s |
| --- | --- | --- | --- |
| WebGPU, first load | 8.0 s | 57 s | 135 |
| WebGPU, second load | 8.0 s | 52 s | |
| WebGL2 | 7.6–7.7 s | 17 s | 2,159 |

Timing Babylon's `_preparePipelineContextAsync` on that page: 61 WebGPU
preparations settled in 39.8 s (the first load) and 55 in 35.4 s (the second),
against 49.0 s and 44.1 s of long tasks; WebGL2's 60 settled in 0.28 s, with
8.9 s of long tasks (the world's build among them). A translated effect cost
0.7 to 2.0 s. Making the shader modules and the render pipelines from the WGSL
cost about nothing on the page's thread. Nothing was kept from one load to the
next.

## 2. Where the time goes

Every material and plugin of the game is GLSL, and on WebGPU Babylon prepares
a GLSL effect in one synchronous run on the page's thread, inside the frame
that asked for it:

1. Babylon's own processing (includes, defines, the plugins' code, the WebGPU
   GLSL processor's bindings and locations): JavaScript, a few tens of
   milliseconds an effect at most.
2. glslang: each stage's GLSL to SPIR-V (`_compileRawShaderToSpirV`,
   `webgpuEngine.pure.js:1491`). WebAssembly.
3. Tint (twgsl): the SPIR-V to WGSL (`webgpuTintWASM.js:29`). WebAssembly.
4. `createShaderModule`, twice: about nothing.

Steps 2 and 3 are the 39.8 s. The effects that are WGSL already (Babylon's
own post processes, the shadow casters, the particles, the clear quad) settle
in about 0 ms; the translated ones are every PBR and Standard material, the
sky and the three custom post shaders.

## 3. What identifies a translation

For a stage `s` of a non-raw GLSL effect, glslang is handed exactly

```
G_s = "#version 450\n" + (defines ? defines + "\n" : "") + code_s
```

(`_compilePipelineStageDescriptor` and `_compileShaderToSpirV`,
`webgpuEngine.pure.js:1494–1495, 1539`), where `code_s` is the processed stage
Babylon's `Effect` hands the engine, and the WGSL that comes out is

```
W_s = (u_s ? "diagnostic(off, derivative_uniformity);\n" : "") + Tint(glslang(G_s, s))
```

with `u_s` true where `code_s` holds `#define DISABLE_UNIFORMITY_ANALYSIS`
(`webgpuEngine.pure.js:1537–1538`, read from the code, never the defines) or
Babylon's page-wide `WebGPUTintWASM.DisableUniformityAnalysis` is set
(`webgpuTintWASM.js:35`). Nothing else reaches the translators: no device, no
adapter, no caps, except through the text. Everything else the engine needs of
an effect (bindings, attribute locations, the uniform layouts) comes from step
1, which the lookup leaves as it is.

So the WGSL is a pure function of `G_s`, `s`, `u_s`, the translators' bytes
and Babylon's wrapping of them, and the lookup keys each stage by

```
key_s = SHA-256( salt ‖ 0 ‖ s ‖ 0 ‖ (u_s ? "1" : "0") ‖ 0 ‖ UTF-8(G_s) )
salt  = "dayhike-wgsl/1" + "|babylon=" + Babylon's version
        + "|glslang=" + SHA-256(glslang.wasm) + "|twgsl=" + SHA-256(twgsl.wasm)
        + "|glslang.js=" + SHA-256(glslang.js) + "|twgsl.js=" + SHA-256(twgsl.js)
        + "|staticUA=" + WebGPUTintWASM.DisableUniformityAnalysis
```

(`stageKey`, `lookupSalt`). The translators' digests, of their WebAssembly and
of their loaders (which hold glslang's defaults and twgsl's wrapper), are
computed by the build (`vite.config.ts`, the `__WGSL_TRANSLATORS__` constant),
so the page never hashes their 2.7 MB. The key is hashed in the page synchronously, by a SHA-256
in TypeScript (`sha256.ts`): `crypto.subtle` answers a task later at the
earliest. The key carries the whole stage as glslang is handed it, so two
stages that differ only by the uniformity define get two keys.

**Why a stale entry cannot be reached.** A change to anything that decides the
WGSL changes the key: Babylon (it owns the version line, the defines' join and
the diagnostic, and its version is in the salt), either translator (its digest
is), the game's shaders and plugins, the defines, the device-driven text (all
in `G_s`), the uniformity switch (in the key and the salt). A stored WGSL made
under anything else is simply never asked for. The one way to draw a wrong
shader from the store is a SHA-256 collision.

**A hit-rate hazard, not a correctness one.** Babylon numbers each plugin's
`MATERIALPLUGIN_N` define in the order plugin classes are first attached on
the page (`materialPluginManager.pure.js:42–45`). Were that order ever to
differ between loads, every key of the affected materials would change though
the WGSL would not: misses, never a wrong picture. §8 measures whether it
does.

## 4. The layer

`lookUpShaders` (`client/src/game/shaderLookup.ts`), installed by
`createWebGpuEngine` (`gpuEngine.ts`) through one call, on each engine it
makes, before the wrap that catches translation failures
(`catchTranslationFailures`), which wraps whatever preparation it finds.

It replaces the engine instance's `_preparePipelineContextAsync` (Babylon's
`Effect` looks it up on the engine at every preparation). A native WGSL effect
and a raw GLSL one (shader overrides; the game makes none) go to Babylon's own
method untouched. For every other GLSL effect it:

1. builds `G_v`, `G_f`, `u_v` and `u_f` as Babylon does, and the two keys;
2. asks, for each key, the stages this page translated while the start's WGSL
   is held, then its sources in order (§5), each answering from memory;
3. translates a stage none has, alone, through the engine's own methods
   (`_compileRawShaderToSpirV`, then `_tintWASM.convertSpirV2WGSL` with the
   stage's switch, so Babylon's diagnostic is added as it adds it), and offers
   the WGSL to every source that takes writes, never waited on;
4. sets the pipeline context's `sources` as Babylon does, and its `stages`
   through Babylon's own `_createPipelineStageDescriptor` with the WGSL
   language, which skips Tint and only makes the two shader modules;
5. notifies `onBeforeShaderCompilationObservable` and
   `onAfterShaderCompilationObservable` around it, as Babylon does around a
   compile, so the governor and the probe see a compile on a hit as on a miss;
6. calls `onReady`.

**It never waits.** All of that runs in the call that asked for it, as
Babylon's own preparation does once its translators are loaded, and Babylon
relies on that. At the first draw of a mesh with integer vertex buffers (every
skinned glTF model: the hikers, the Hollow, wildlife, whose joint indices are
`UNSIGNED_BYTE` or `UNSIGNED_SHORT`) the render pipeline's descriptor calls
`checkNonFloatVertexBuffers` (`buffer.nonFloatVertexBuffers.js:48–84`), which
prepares the effect again on the same pipeline context, with the joints as
integer inputs, "synchronously" (its own comment, `:78`; the WebGPU engine keeps
the context, `_checkNonFloatVertexBuffersDontRecreatePipelineContext: true`),
and then builds the pipeline from `stages` straight after
(`webgpuCacheRenderPipeline.js:841, 916`). A preparation that waited once,
for a store's read or a translator's download, left the old float-input
modules there: the pipeline failed validation at the first skinned draw, the
watcher swapped to WebGL2 and remembered it for 30 days, on every load. So
every source is in memory before the engine is handed over (§5), the
translators are loaded by then (§6), and the preparation has no `await`.

A translation that throws rejects the preparation as it did, so the failure
wrap records it on its effect and the watcher answers it as before.

**A found stage is not checked by the device.** Babylon reads no module's
compilation messages, and the device answers only asynchronously, after the
effect is ready and maybe drawn; a refusal it gave then would already have
failed a pipeline. What stands between a damaged entry and the device is the
store's gzip, whose CRC-32 is checked as each entry is unzipped at the engine's
making (a store is only made where the browser can check it). A WGSL that
passes it is byte for byte what the translators made under the same salt,
which a fresh translation would reproduce; the device can refuse it only where
it would refuse the fresh one too.

`?wgsl=off` installs nothing: Babylon's own path, every stage translated. One
build can so be measured both ways.

## 5. Sources of entries

One interface, several sources asked in order; the first that has a stage
answers it. A `WgslSource` has a `name` (the report counts hits by it) and the
`salt` its entries were made under (a source of another salt is closed and
never asked); `get` answers from memory; `put`, where the source takes writes,
holds a new translation at once and writes it later, never waited on;
`ready` resolves once its entries are in memory; `settle` lets the start's
WGSL go; `close` lets everything go. `createWebGpuEngine` takes the sources to
use (the browser's store by default), so a second source is added where the
engine is made, not in the layer.

**Read in while the engine is made.** The lookup starts its sources as the
engine object is made, and `createWebGpuEngine` waits for them after the
device and the translators, within `WGSL_SOURCES_MS`, 2 s from the start of
the read, opening and reading together; the device's request runs meanwhile.
The wait sits inside the start's own budget, whose running out is
remembered (`init`), so it also ends 500 ms before that budget's deadline
(`SOURCES_MARGIN_MS`), and does not happen at all with less left: a cache
that exists to be optional never fails a start. A source that has not
opened by the bound is closed as it lands and never asked. A source that has
opened but whose entries are still being unzipped goes on filling in after
the engine is handed over: a stage asked for before its entry has landed is
a miss, translated; one asked for after is found. Nothing is read from the
database after the read the start began.

**What is let go once the start has settled.** The start settles
`WGSL_HOLD_QUIET_MS` (30 s) after the last preparation, or
`WGSL_HOLD_MAX_MS` (120 s) after the engine stood, whichever comes first.
Then the WGSL the start used is let go: the page's own translations, and
each source's entries that were asked for (Babylon keeps an effect once
made, and rarely asks for it again). What has not been asked for yet (the
headlamp's variants, the rain's, the last hike's creatures', all read in
because they were used recently) is kept for the engine's life, and each is
let go once it is used; turning the lamp on a minute into a hike finds its
stages rather than translating them. A stage used before the settle and
asked for again after it (an effect made again) is translated, the
translators being loaded, and not held.

**What that costs in memory.** The store holds only what it read in for the
start: at most `WGSL_START_MAX_BYTES`, 32 MB of WGSL text (ASCII, which V8
keeps a byte a character), plus the records of at most 2,000 stages, a few
hundred kilobytes, and, while the entries are unzipped, their gzipped bytes,
a few MB. What it keeps is never held. Over a long hike that bound never
grows: nothing is read or held after the start's read, and after the settle
it shrinks as each kept stage is used. The page's own translations are held
only until the settle, the start's misses (on a first visit, the start's
whole set). A start's own set is estimated at 6 to 24 MB (§8 measures it).

**Let go with its engine.** Every source is closed when the engine is disposed
(`releaseShaderLookup`, which the engine's dispose observable calls), and
first thing when a start that failed part-way is disposed (`disposeHalfMade`),
where Babylon's dispose throws before that observable is ever notified.

### 5.1 The browser's store (now)

`wgslStore.ts`, `loadWgslStore`: IndexedDB.

- **One database per salt**, `dayhike-wgsl-<16 hex digits of the salt's
  SHA-256>`, so a new build's store is a new database; every other database
  of the store's is deleted when one opens. A newer build deleting this one's
  closes the connection (`versionchange`), from when it keeps nothing more.
- **Two object stores**: each stage's WGSL, gzipped (`CompressionStream`,
  about 6–10×), and a small record of its gzipped size, its unzipped size and
  its last use. A browser without `CompressionStream` has no store.
- **Read in for a start**: the records whole, then the most recently used
  entries while their unzipped WGSL fits `WGSL_START_MAX_BYTES`, 32 MB, each
  unzipped and checked; one that does not read back is dropped.
- **Bounded on disk**: 64 MB of gzipped WGSL (`WGSL_STORE_MAX_BYTES`) or 2,000
  stages (`WGSL_STORE_MAX_ENTRIES`), the least recently used evicted first, in
  the transaction that keeps a new stage. Uses are written a second later, a
  start's in one transaction.
- **Guarded**: storage refused (site data blocked), a private window, a full
  disk, or a database that does not answer is a store that has nothing or
  keeps nothing, and the lookup translates as the engine always did.

It buys nothing on a first visit; on a return visit, every stage seen before
is found.

### 5.2 Translations shipped with the build (next)

A second source ahead of the store: a map `{ salt, entries: { key: wgsl } }`
per tier, made before `vite build` by translating a recorded corpus of `G_s`
under Node with the very files the page ships (both translators run under
Node unchanged), imported with `?url` so it is content-hashed and served
`immutable`, fetched on the WebGPU path only, and parsed into memory within
the same bound as the store. It takes no writes; its salt is checked by the
layer; its hits are counted under its own name. It fixes the first visit,
which the store cannot. The corpus comes from `?wgsl=record` on the standard
pages (§7); a freshness test would check that a canonical set of keys,
computed under Node, is in the map.

## 6. The translators, and the start's order

**Decision (2026-09-28): the translators stay eager.** They are fetched and
started before the engine is handed over, through the game's own loader and
within the fetch budget, as before the lookup; a failure there is the start's
failure, answered as it always was (WebGL2 for this load, nothing
remembered). A first version fetched them only at the first stage not found,
or once the page was idle after the first frame, to spare a visitor whose
every stage is found one 2.6 MB download. It cost more than it saved: a
preparation had to wait for the download, which is the defect of §4; a
failed download mid-hike needed an ending of its own (a swap to WebGL2 with
its own line, nothing remembered); and on a first visit the download ran
after "Loading…" was gone, over an empty world, instead of inside it. Lazy
translators may come back with the translations shipped at build time (§5.2),
where a first visit can find every stage, and only as measured.

The start, step by step:

1. "Loading…" on screen. The WebGPU module imported (the fetch budget,
   `WEBGPU_FETCH_MS`, 10 s, running across this step and the third).
2. The adapter asked (the GPU's budget, `WEBGPU_START_MS`, 10 s, running
   across this step and the fourth).
3. Where it fits, the translators fetched and started (`loadTranslators`).
4. The engine made (`createWebGpuEngine`): the engine object, the lookup
   installed and its sources' read started, the device requested
   (`initAsync`), the translators handed to Babylon, and the sources waited
   for, at most 2 s from when their read began and never closer than
   500 ms to the start's deadline.
5. The engine handed over; the world's build and its first preparations,
   each in its call.

With `?wgsl=off` step 4 installs no lookup and reads nothing.

## 7. The recorder

`?wgsl=` is one of the page's own overrides (`engine`, `tier`, `probe`,
`wgsl`): carried across the page's navigation, never announced to a follower.

- **Always**: the page object `dayhikeWgsl` (one per page, across every engine
  it makes) counts `hits` (stages found and used), `hitsBySource` (the same by
  the source's name, `page` for a stage this page translated earlier in the
  start), `misses` (stages translated), `translateMs` (both translators, every
  stage, on the page's thread) and `differences`.
- **`?wgsl=record`** also keeps, for every effect prepared, its `name` (the
  effect's key), `at`, `processMs` (Babylon's own processing: from its
  processing context's making to the preparation), `moduleMs` (the two shader
  modules), and for each stage its `key`, `flag` (`u_s`), `glsl` (exactly
  `G_s`), `wgsl`, `from` (the source's name, or `translated`), `spirvMs`
  (glslang) and `wgslMs` (Tint).
- **`?wgsl=verify`** prepares every effect a second time on Babylon's own
  path, on a scratch context whose modules are not made, and compares, stage
  by stage, the text Babylon hands the first translator with the key's `G_s`,
  and Babylon's WGSL with the one used; each difference is counted in
  `differences` and logged. It so checks the lookup's composition against
  Babylon's on the real shaders, as well as the store. That second
  preparation notifies the compile observables once more.
- **`?wgsl=off`**: Babylon's own path (§4).

A measurement reads it whole with `JSON.stringify(dayhikeWgsl)` from the page
(or saves it with `dayhikeWgsl.download()`), and reads the counters alone for
a gate: `hits` and `misses` show whether the mechanism fired.

## 8. What is not known yet, and how each will be measured

1. **How the 39.8 s divides** between glslang, Tint and Babylon's processing,
   per effect: one first load on the T4 machine with `?wgsl=record`
   (`spirvMs`, `wgslMs`, `processMs`).
2. **The WGSL's size**, per effect, per start and over the union of the
   standard pages, raw, gzip −9 and brotli −q 11: the recorded `wgsl` of the
   rig's pages. It decides the shipped map's format (§5.2), and whether
   `WGSL_START_MAX_BYTES` holds a start's set.
3. **Whether the keys are stable across loads** (the `MATERIALPLUGIN_N`
   hazard, §3): two recorded loads of the same page, their key sets compared.
   If they differ, the plugins' order is fixed before any material exists.
4. **Whether one corpus serves every machine**: the same page recorded on the
   Apple M4 (ASTC, ETC2) and the T4 machine (BC), the key sets intersected.
5. **What the GPU process costs once translation is gone**: a Chrome trace
   with the GPU categories on the T4 machine, on a load whose stages are all
   found: Dawn's shader and pipeline compiles, and whether frames wait on
   them; Chrome's own shader cache keys on the WGSL, so a first and a second
   load.
6. **Whether Node's translation equals the browser's** byte for byte: the
   recorded `G_s` translated under Node with the shipped files, each result
   compared with the recorded `W_s`. Expected equal; it is what makes the
   shipped map honest. `?wgsl=verify` checks each browser against Babylon's
   own path.
7. **The skinned draw on a real device**: a page with a hiker in view, first
   and second load, no validation error at its first draw and its effect's
   vertex source carrying `_int_matricesIndices_`; `?wgsl=off` alike.
8. **Whether the headlamp's and the rain's variants are in a start's
   corpus**, or only in the scripted minute's: the recording answers it, and
   with it whether the scripted minute's longest frame can meet its bar
   without moving translation off the page's thread.
9. **The store against a real IndexedDB.** The suite holds it against an
   `indexedDB` in memory only. In Chrome: a normal profile over two loads
   (the second's `hits` equal the first's `misses`); a private window (the
   store works for the window's life or is none, and the page draws either
   way); storage refused by the site's settings (no store, no error, every
   stage translated); quota, with the store filled past a small origin quota,
   so that a `put` the browser refuses keeps nothing and costs nothing, and
   the eviction keeps it under its bounds; and the read's time at the
   engine's making, against its 2 s.
10. **The SHA-256's cost per stage on a slow CPU.** Keying is synchronous, in
    the frame that asks, and the lookup's whole saving assumes it costs a few
    milliseconds against the translation's 0.7 to 2.0 s. On the T4 machine
    with `?wgsl=record`, the time to key each stage against its `glsl`'s
    length; if the largest stages cost more than a frame's share, hash
    incrementally or cache the key per effect.
11. **A Node round trip against the browser's output, byte for byte**, for
    the start's whole corpus (item 6), before any shipped map is trusted: the
    suite has no test that runs the real translators, which it stubs.
12. **The memory the held WGSL costs**: the page's heap with the start's WGSL
    held and after it is let go (§5), on a return visit.

## 9. The bars

The WebGPU design's §13.3, on the T4 machine, high tier, canopy page:

- settled within **30 s** on a first load, with all five impostor bakes landed;
- the second load's first frame no more than **0.5 s** after WebGL2's, the
  first load's no more than **2.5 s** after;
- the scripted minute's longest frame no more than the larger of **100 ms**
  and WebGL2's longest plus 50 ms.

For the store alone, the second load must settle within 30 s (about WebGL2's
17–20 s expected), with the counters showing every stage found (two `hits`
an effect, about 110 for a start's 55 translated effects, and no `misses`),
and the WebGL2 shader pins unchanged. The store cannot move the first load
(§5.1); that is the shipped map's bar.

## 10. The canaries

`shaderLookup.test.ts` pins, in the installed Babylon 9.18.0, the whole of
each body the layer replaces, skips or calls, by the SHA-256 of its text: the
preparation, the stages' compile, the stage descriptor, the composition of
glslang's input, `WebGPUPipelineContext.isReady` (the stages alone), the
re-preparation for integer vertex buffers, and the path it runs through
synchronously (`Effect._processShaderCodeAsync`, `_prepareEffect`,
`createAndPreparePipelineContext`, `_executeWhenRenderingStateIsCompiled`,
`_buildRenderPipelineDescriptor`), and Tint's wrapper
`convertSpirV2WGSL`; so a line an upgrade adds anywhere in them is noticed.
It also pins, beside `LOOKUP_FORMAT`, the text of the lookup's own three
functions that decide what is stored for a key (`translatorInput`,
`translate`, `pack`): a change to any of them must bump the format, so that
no entry made the old way is reachable. Beside them, lines pinned by their text (the version line,
the uniformity switch, the observables, the diagnostic prefix, the
recorder's two readings, the synchronous re-preparation's call and comment,
the WebGPU engine keeping the context, and the pipeline reading `stages` after
it). The layer runs against Babylon's own engine methods on a stand-in device
and is held to hand glslang exactly the text Babylon's own path hands it, to
make exactly the same modules, and to be ready, with its new stages, before
the call returns, driven also through Babylon's own `Effect` and
`checkNonFloatVertexBuffers`. A Babylon upgrade changes the salt anyway, which
turns every stored entry into a miss: it can cost speed, never a wrong
picture.
