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
        + "|staticUA=" + WebGPUTintWASM.DisableUniformityAnalysis
```

(`stageKey`, `lookupSalt`). The translators' digests are computed by the build
(`vite.config.ts`, the `__WGSL_TRANSLATORS__` constant), so the page never
hashes their 2.6 MB. The key is hashed in the page synchronously, by a SHA-256
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
`Effect` looks it up on the engine at every preparation). For a native WGSL
effect it calls Babylon's own method untouched; for a raw GLSL effect (shader
overrides; the game makes none) it starts the translators first and then calls
Babylon's own. For every other GLSL effect it:

1. builds `G_v`, `G_f`, `u_v` and `u_f` as Babylon does, and the two keys;
2. asks its sources in order for each key (§5): a source says at once whether
   it holds a key, and reads the WGSL asynchronously;
3. where a stage is not found, starts the translators if they are not yet
   (§6), and translates that stage alone, through the engine's own methods
   (`_compileRawShaderToSpirV`, then `_tintWASM.convertSpirV2WGSL` with the
   stage's switch, so Babylon's diagnostic is added as it adds it), and offers
   the WGSL to every source to keep, unwaited;
4. sets the pipeline context's `sources` as Babylon does, and its `stages`
   through Babylon's own `_createPipelineStageDescriptor` with the WGSL
   language, which skips Tint and only makes the two shader modules;
5. notifies `onBeforeShaderCompilationObservable` and
   `onAfterShaderCompilationObservable` around it, as Babylon does around a
   compile, so the governor and the probe see a compile on a hit as on a miss;
6. calls `onReady`.

A found stage's WGSL is checked by the device before the effect uses it:
Babylon reads no module's compilation messages, so the modules of an effect
with a found stage are made inside a `validation` error scope. A refusal is
then an answer, not an uncaptured error (which the watcher would answer by
swapping to WebGL2): the stage the device refused (by its module's compilation
messages; every found stage where they do not say) is dropped from its source
and translated afresh, once. A fresh translation the device refuses is left to
the uncaptured error, as without the lookup.

A translation that throws rejects the preparation as it did, so the failure
wrap records it on its effect and the watcher answers it as before. An engine
disposed while a preparation waited ends that preparation with nothing made.

`?wgsl=off` installs nothing: Babylon's own path, every stage translated, the
translators started before the engine, as before the lookup. One build can so
be measured both ways.

With a found stage the effect is ready a task or two later than a translated
one would have been in the same frame (the store's read, the error scope's
answer). A mesh that already drew with an earlier variant keeps drawing it
meanwhile (Babylon's shader hot-swapping); a new mesh appears a frame later.

## 5. Sources of entries

One interface (`WgslSource`: `has`, `get`, `put`, `drop`, `close`), several
sources asked in order; the first that has a stage answers it.

### 5.1 The browser's store (now)

`wgslStore.ts`: IndexedDB.

- **One database per salt**, `dayhike-wgsl-<16 hex digits of the salt's
  SHA-256>`, so a new build's store is a new database; every other database
  of the store's is deleted when one opens.
- **Two object stores**: each stage's WGSL, gzipped (`CompressionStream`,
  about 6–10×; kept as text where the browser has none), and a small record of
  its gzipped size and last use.
- **The records are read whole when the store opens**, so whether it holds a
  key is known at once; a WGSL is read only when used. The store opens at the
  engine's first shader, not before, so an engine whose start fails opens
  nothing; the first shader waits for it at most `WGSL_STORE_OPEN_MS`, 2 s,
  after which it is no store for that engine.
- **Bounded**: 64 MB of gzipped WGSL (`WGSL_STORE_MAX_BYTES`) or 2,000 stages
  (`WGSL_STORE_MAX_ENTRIES`), the least recently used evicted first, in the
  transaction that keeps a new stage. Uses are written a second later, a
  start's in one transaction.
- **Guarded**: storage refused (site data blocked), a private window, a full
  disk, a database that does not answer, or an entry that does not read back
  (gzip carries a checksum) is a store that has nothing or keeps nothing, and
  the lookup translates as the engine always did. An entry that does not read
  back is dropped.
- **Let go with its engine**: its database is closed when the engine is
  disposed (`releaseShaderLookup`, which the engine's dispose observable
  calls), and first thing when a start that failed part-way is disposed
  (`disposeHalfMade`), where Babylon's dispose throws before that observable
  is ever notified.

It buys nothing on a first visit; on a return visit, every stage seen before
is found.

### 5.2 Translations shipped with the build (next)

A second source ahead of the store: a map `{ salt, entries: { key: wgsl } }`
per tier, made before `vite build` by translating a recorded corpus of `G_s`
under Node with the very `.wasm` the page ships (both translators run under
Node unchanged), imported with `?url` so it is content-hashed and served
`immutable`, fetched on the WebGPU path only, beside the world's build. Its
`has` is synchronous over the parsed map; its `put` and `drop` do nothing. It
fixes the first visit, which the store cannot. The corpus comes from
`?wgsl=record` on the standard pages (§7); a freshness test would check that
a canonical set of keys, computed under Node, is in the map.

## 6. The translators, and the start's order

Before the lookup, the start fetched and started both translators before the
engine, inside the fetch budget. With it:

- **The start**: the WebGPU module imported (the fetch budget,
  `WEBGPU_FETCH_MS`, 10 s), the adapter asked, and where it fits the engine
  made (the GPU's budget, `WEBGPU_START_MS`, 10 s). No translator is fetched
  in the start; `?wgsl=off` alone fetches them there, as before, since
  Babylon's own path needs them before the engine. "Loading…" means what it
  meant, and is shorter by the translators' download and compile on a load
  that finds every stage.
- **At the first stage not found**, the translators are fetched and started
  through the game's own loader (`loadTranslators`: once a page, 10 s,
  rejects on any failure), then handed to Babylon (`handTranslators`); never
  through Babylon's own loader, whose promise has no rejection path, so a
  failed fetch there would leave every GLSL effect pending for good.
- **Once the page is idle after the engine's first frame**, they are started
  the same way (the same start, so the same 10 s), so that a later stage not
  found does not wait on the network. A prefetch that fails is silent and
  changes nothing: no swap, no line, no record; the next stage not found
  starts them again, and only a failure there is answered.
- **Translators that cannot be fetched** for a stage not found are the
  network's failure, not the GPU's. That effect cannot be made: its
  preparation ends, unready and without an error, so the failure wrap never
  hears of it, and the engine's watcher reports `unfetched`
  (`reportUnfetched`, `watchWebGpu`). The page answers it as a failure is
  answered, by a live swap onto WebGL2, with its own HUD line ("Graphics
  switched to WebGL2: part of the renderer could not be downloaded.", once,
  never the GPU error's), but remembers nothing: no record is written, the page alone holds itself on WebGL2 for
  the rest of its life, and the next load tries WebGPU again. A tab whose
  address asks for `?engine=webgpu`, which outranks that hold, is pinned to
  `engine=webgl2` so the rebuild cannot come back to it: the one address rule
  after every ending on WebGL2 (`pinsAfterFailure`), with the page's hold
  standing where a record would. A probe step that
  meets it writes no `init` record either.

So the failure records keep their meaning: `init` is a WebGPU start that
failed, `pipeline` a shader or pipeline the engine could not make, `lost` a
lost device; a network that fails the translators is none of them, at the
start (where it never counted) or later.

## 7. The recorder

`?wgsl=` is one of the page's own overrides (`engine`, `tier`, `probe`,
`wgsl`): carried across the page's navigation, never announced to a follower.

- **Always**: the page object `dayhikeWgsl` (one per page, across every engine
  it makes) counts `hits` (stages found and used), `misses` (stages
  translated), `translateMs` (both translators, every stage, on the page's
  thread), `rejected` (found stages the device refused) and `differences`.
- **`?wgsl=record`** also keeps, for every effect prepared, its `name` (the
  effect's key), `at`, `processMs` (Babylon's own processing: from its
  processing context's making to the preparation), `moduleMs` (the two shader
  modules), and for each stage its `key`, `flag` (`u_s`), `glsl` (exactly
  `G_s`), `wgsl`, `from` (`source` or `translated`), `spirvMs` (glslang) and
  `wgslMs` (Tint).
- **`?wgsl=verify`** translates every found stage too and compares, counting
  `differences` and logging each.
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
   rig's pages. It decides the shipped map's format (§5.2).
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
   recorded `G_s` translated under Node with the shipped `.wasm`, each result
   compared with the recorded `W_s`. Expected equal; it is what makes the
   shipped map honest. `?wgsl=verify` checks the same in each browser.
7. **The post chain while a post shader is not ready** (a found stage is
   ready a task later): delay one post effect in a development page and look
   at the frames.
8. **Whether the headlamp's and the rain's variants are in a start's
   corpus**, or only in the scripted minute's: the recording answers it, and
   with it whether the scripted minute's longest frame can meet its bar
   without moving translation off the page's thread.
9. **The store against a real IndexedDB.** The suite holds it against an
   `indexedDB` in memory only. In Chrome: a normal profile over two loads
   (the second's `hits` equal the first's `misses`, and `rejected` is 0); a
   private window (the store works for the window's life or is none, and the
   page draws either way); storage refused by the site's settings (no store,
   no error, every stage translated); and quota, with the store filled past a
   small origin quota, so that a `put` the browser refuses keeps nothing and
   costs nothing, and the eviction keeps it under its bounds.
10. **The SHA-256's cost per stage on a slow CPU.** Keying is synchronous, in
    the frame that asks, and the lookup's whole saving assumes it costs a few
    milliseconds against the translation's 0.7 to 2.0 s. On the T4 machine
    with `?wgsl=record`, the time to key each stage against its `glsl`'s
    length; if the largest stages cost more than a frame's share, hash
    incrementally or cache the key per effect.
11. **A Node round trip against the browser's output, byte for byte**, for
    the start's whole corpus (item 6), before any shipped map is trusted: the
    suite has no test that runs the real translators, which it stubs.

## 9. The bars

The WebGPU design's §13.3, on the T4 machine, high tier, canopy page:

- settled within **30 s** on a first load, with all five impostor bakes landed;
- the second load's first frame no more than **0.5 s** after WebGL2's, the
  first load's no more than **2.5 s** after;
- the scripted minute's longest frame no more than the larger of **100 ms**
  and WebGL2's longest plus 50 ms.

For the store alone, the second load must settle within 30 s (about WebGL2's
17–20 s expected), with the counters showing every stage found (two `hits`
an effect, about 110 for a start's 55 translated effects, and no `misses`), and the WebGL2 shader pins unchanged. The store cannot
move the first load (§5.1); that is the shipped map's bar.

## 10. The canaries

`shaderLookup.test.ts` pins, in the installed Babylon, each line the layer
copies or leans on: the version line and the defines before the code, and
that text handed to glslang; the uniformity switch read from each stage's
code; the observables notified around the compile; Tint skipped for WGSL and
one module made per stage from the code given; the preparation's parameter
list, its `sources` shape, and Babylon's own loader reached only there, for
GLSL; the diagnostic before a WGSL whose stage turns uniformity analysis off;
where the recorder reads an effect's processing and its name. Beside them, the
layer runs against Babylon's own engine methods on a stand-in device and is
held to hand glslang exactly the text Babylon's own path hands it and to make
exactly the same modules. A Babylon upgrade changes the salt anyway, which
turns every stored entry into a miss: it can cost speed, never a wrong
picture.
