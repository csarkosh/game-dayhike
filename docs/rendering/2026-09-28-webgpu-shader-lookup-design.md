# WebGPU shader lookup: design

**As built, 2026-09-28.** The lookup layer, the browser's store and the
recorder, on `worktree-webgpu-wgsl`, and the translations made at build time
and shipped as the lookup's first source (§5.2), on
`worktree-webgpu-wgsl-map`, behind the WebGPU engine's off switch
(`WEBGPU_ENABLED = false`, so reached only with `?engine=webgpu`). Nothing
here but the lookup and the store has yet been measured in a browser (their
first readings are in §8): §8 says what has to be, and §9 the
bars it must meet.

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

(`stageKey`, `lookupSalt`, in `wgslFormat.ts`, a module with no Babylon and
no DOM in it, so the build's tools key a stage with the very same code under
Node, §5.2). The translators' digests, of their WebAssembly and of their
loaders (which hold glslang's defaults and twgsl's wrapper), are computed by
the build (`vite.config.ts`, the `__WGSL_TRANSLATORS__` constant, through
`tools/wgsl/lib/translators.mjs`'s `translatorDigests`, which the tools salt
with too), so the page never hashes their 2.7 MB. The key is hashed in the
page synchronously, by a SHA-256 in TypeScript (`sha256.ts`): `crypto.subtle`
answers a task later at the earliest. Read in a browser on a machine with 4
virtual CPUs, it costs 0.5 to 0.6 ms a stage, about 60 ms a start. The key carries the whole stage as glslang is handed it, so two
stages that differ only by the uniformity define get two keys.

**Why a stale entry cannot be reached.** A change to anything that decides the
WGSL changes the key: Babylon (it owns the version line, the defines' join and
the diagnostic, and its version is in the salt), either translator (its digest
is), the game's shaders and plugins, the defines, the device-driven text (all
in `G_s`), the uniformity switch (in the key and the salt). A stored WGSL made
under anything else is simply never asked for. The one way to draw a wrong
shader from the store is a SHA-256 collision.

**A hit-rate hazard, not a correctness one: text that differs between
loads.** A stage whose text differs from one load of a page to the next has
another key, and a translation made on the first load is not found on the
second, though the WGSL may be the same: misses, never a wrong picture.

- *The plugins' numbers.* Babylon gives each material plugin class a define,
  `MATERIALPLUGIN_<n>`, numbered the first time a plugin of that class is added
  to a material on the page, from a page-wide counter keyed by the class's
  name (`MaterialPluginManager._addPlugin`, `materialPluginManager.pure.js:42–45`).
  A material carries one such define, first in its defines: that of the last
  class added to it, as `_addPlugin` rebuilds the material's plugin defines
  around the class it adds (`:50–51`). What is added first follows what loads
  first. The define is read by no shader.
  Pinned (`pluginNumbers.ts`): once a WebGPU engine stands, before any of its
  materials, every class the game's materials carry (Babylon's seven on a PBR
  material, the decal map's, the game's nine) is numbered by its place in
  `PLUGIN_ORDER`, and Babylon numbers any other after them. On WebGL2 nothing
  changes: a page that never makes a WebGPU engine keeps Babylon's numbering
  and its shader text, and the WebGL2 pins.
- *Something else, not yet named.* On the Windows machine, over four recorded
  loads of one page, the plugins' numbers were the same on every load (the
  first define of each material's defines, 8 to 16). Yet the first visit
  prepared 18 to 20 stages (9 to 10 PBR effects, of plugins 8, 13 and 14) that
  no later visit asked for, and each has, in each later visit, a stage of the
  same kind whose text is exactly as long, whose WGSL is exactly as long, and
  whose defines begin with the same 82 characters, under another key. So the
  text differs at the same length, past the plugin's define.

**The requirement that a page's keys be the same on every load is not shown
met.** Pinning the plugins' numbers meets it for the one mechanism it names,
but on the loads recorded those numbers were already the same, and what did
differ lies past them. Babylon's source shows three mechanisms that would
give exactly that, a text of the same length under another key; none is
shown to be the one that fired:

- *The order of the defines.* A material's defines print in the order their
  names were first set on its defines object (`MaterialDefines.rebuild` takes
  them from `Object.keys`, `materialDefines.js:141–148`, and `toString`
  writes them so, `:214–231`), and a light's defines are first set when that
  light's index is first prepared (`materialHelper.functions.js:789–836`). A
  submesh whose defines first met fewer lights, or met them in another
  order, prints the same defines in another order.
- *A light's index, by arrival.* Lights are numbered by the mesh's
  `lightSources` (`materialHelper.functions.js:585–595`), where a light that
  becomes enabled or starts affecting the mesh is appended at the end, not in
  the scene's order (`abstractMesh.pure.js:953–969`); the other players'
  lamps are made as they arrive over the network (`entityViews.ts`), beside
  the local one (`renderer.ts`). Two lights swapping indices swap their blocks
  at equal length.
- *A numeric define's value.* `SHADOWCSMNUM_CASCADES0 <n>` follows the
  tier's cascades, and a texture's `…DIRECTUV <n>` its UV set: a value that
  changes keeps the length.

Which it is needs two loads recorded whole, the stages' texts diffed line by
line (§8, item 2); the record kept effect names cut at 90 characters and key
prefixes, not the texts. Meanwhile a corpus merged from several recorded
loads holds each variant that any of them met, and so serves a later load
whichever of them fires in it.

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
2. asks, for each key, the stages this page translated (kept for the
   engine's life, up to `WGSL_KEPT_MAX_CHARS`), then its sources in order
   (§5), each answering from memory;
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
answers it: the translations shipped with the build (`wgslMap.ts`, §5.2),
then the browser's store (`wgslStore.ts`, §5.1). A `WgslSource` has a `name` (the report counts hits by it) and the
`salt` its entries were made under (a source of another salt is closed and
never asked); `get` answers from memory; `put`, where the source takes writes,
holds a new translation at once and writes it later, never waited on;
`ready` resolves once its entries are in memory; `waitMs` is how long the
engine's maker waits for it, where it has a bound of its own; `close` lets
everything go. `createWebGpuEngine` takes the sources to
use (by default the map shipped with the build, then the browser's store,
`defaultSources`), so a source is added where the engine is made, not in the
layer. Each default source comes in on its own: the store, which must open
a database before it has anything, is held from the start by
`openingSource`, which answers nothing until the store has opened and lets
go of one that has not opened within the bound as it lands, so its opening
never holds back the map beside it.

**Read in while the engine is made.** The lookup starts its sources as the
engine object is made, and `createWebGpuEngine` waits for them after the
device and the translators, each within its bound, counted from the start of
the read, opening and reading together: `WGSL_SOURCES_MS`, 500 ms, for the
store (and any source without a bound of its own), and the map's own,
`WGSL_MAP_MS`, 1 s (§5.2). On the Windows machine the store opened in 2 to
6 ms and answered a start's 94 to 116 reads within 83 ms, while the device
came 39 ms after the read began: a database that never answered added the
whole of the old 2 s bound to the start, so the store's is short.
The wait sits inside the start's own budget, whose running out is
remembered (`init`), so it also ends 500 ms before that budget's deadline
(`SOURCES_MARGIN_MS`), and does not happen at all with less left: a cache
that exists to be optional never fails a start. A source that has not
opened by the bound is closed as it lands and never asked. A source that has
opened but whose entries are still being unzipped goes on filling in after
the engine is handed over: a stage asked for before its entry has landed is
a miss, translated; one asked for after is found. Nothing is read from the
database after the read the start began.

**Kept for the engine's life.** What the sources read and what the page
translates is kept until the engine is let go, used or not. A first version
let the start's WGSL go once the start had settled (30 s without a
preparation, or 120 s): on the Windows machine the first rain of a visit
made again effects the start had used, and two stages the store held were
translated on the page's thread, a 2.1 s frozen frame. Now an effect made
again (the rain's) finds its stages, as the headlamp's variants, the rain's
and the last hike's creatures' do, read in because they were used recently.

**What that costs in memory.** The store holds what it read in for the
start: at most `WGSL_START_MAX_BYTES`, 32 MB of WGSL text (ASCII, which V8
keeps a byte a character), plus the records of at most 2,000 stages, a few
hundred kilobytes, and, while the entries are unzipped, their gzipped bytes,
a few MB. What it keeps is never held. The page's own translations are kept
up to `WGSL_KEPT_MAX_CHARS`, the same 32 MB of text; past it a translation is
not kept here, and the store keeps it for the next visit. The map holds what
the build shipped. Over a long hike none of it grows past those bounds:
nothing is read after the start's read. What a start holds, estimated from
the Windows machine's reading (a start's WGSL 4.99 MB of text over 106
stages; the store's 128 entries 5.9 M characters): about 5 MB of strings for
the page's own on a first visit, about 6 MB for the store's read on a return
visit, and the map's entries beside either (for a start's set, about as much
again); 64 MB and the map at the very most.

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

### 5.2 Translations shipped with the build

`wgslMap.ts`, `loadWgslMap`; made by `tools/wgsl/`. It fixes the first
visit, which the store cannot: a stage the corpus holds is found on a
player's first load.

**The corpus.** The GLSL stages to translate ahead, committed in
`client/shaders/corpus/`: for each, the stage, its uniformity switch and the
exact text handed to glslang (`G_s`), the three the recorder keeps of a stage
that decide its WGSL (§7). A corpus file is JSON, `{"format":
"dayhike-wgsl-corpus/1", "stages": [...]}`, one stage a line, sorted by a
name that no build changes (the stage's key under an empty salt,
`corpusId`), and the committed corpus is up to sixteen such files,
`stages-<h>.json`, a stage in the one named by the first digit of its name.
Why that form:

- **One download is one file.** `dayhikeWgsl.download()` on a page opened
  with `?wgsl=record` saves exactly a corpus file (`corpusText`), which can be
  dropped into the directory as it is and built. A file a stage, named by its
  key, cannot come out of a browser as one download, and the key carries the
  salt, so every Babylon or translator upgrade would rename every file though
  its text had not changed.
- **Review.** One stage a line, sorted: a merge reads in a diff as the stages
  it adds, and a stage's text is still readable, escaped.
- **Size.** Git keeps the text zlib'd and deltas one version of a file
  against the last; an archive would defeat both and could not be reviewed.
  Sixteen files keep each a sixteenth of the whole, so a real corpus (§8)
  stays far below the size a Git host refuses a file at, and a stage always
  lands in the same file.

`tools/wgsl/merge-corpus.mjs` takes recorded files and the corpus and writes
the union, each stage once, saying how many stages the recorded files hold
and how many are new; a recorded file dropped into the directory is merged
and removed.

**What is shipped now.** 421 stages (221 vertex, 121 fragment, 79 fragment
stages that turn the uniformity analysis off), 14,183,815 bytes in the
sixteen files, recorded with `?wgsl=record` in Chrome 154 on Windows with an
NVIDIA T4 under Direct3D 12, on the high and medium tiers, each text checked
by its SHA-256 against the page that recorded it, and merged. The pages
covered: the standard pose on a first and a repeat visit; the trailhead with
characters in view; the headlamp on; rain; night; a sweep over the poses with
every material compiled; the weathers and the hours; a party of two. Not yet
in it: anything recorded on macOS (its texture formats reach the text
through the defines, §8 item 3), and the low tier. 228 of the stages carry
characters outside ASCII (in the game's shader comments); glslang is handed
them as the page hands them, and the WGSL has no comments (the build checks
that the map is ASCII).

**Line endings.** The recording was first made from a checkout with Windows
line endings: the game's `.fx` shader files had no line-ending rule, so they
were checked out with `\r\n`, and 234 of the 421 stages carried their
carriage returns into the text, and so into their keys, which a page built
from a checkout without them never asks for. On a Mac, a first visit on the
build with that corpus found 43 stages in the shipped map and translated
52; with the same stages' `\r\n` turned to `\n` (still 421 distinct, the
map's WGSL the same 23,367,492 bytes) the same page found 100 and
translated none. The corpus was repaired by the merge tool, and three
things now keep it from happening again: `.gitattributes` checks `.fx`
(and `.glsl`, `.wgsl`) out with `\n` everywhere; the merge tool turns every
`\r\n` into `\n` in each stage it reads, reports how many, and refuses a
stage with a carriage return left, and the map's build refuses a corpus
with one, naming the stage and the tool that repairs it; and a page opened
with `?wgsl=record` counts the stages it keeps whose text carries one
(`stagesWithCarriageReturns` in `dayhikeWgsl`), so such a recording is seen
at once. The key stays the hash of the exact text: the page repairs
nothing.

The ten stages made under Node (`tools/wgsl/node-corpus.mjs`: the game's
three post shaders and Babylon's PBR and Standard materials, through
Babylon's WebGPU GLSL processing on `NullEngine`) are not shipped: no browser
asks for them (the caps, the engine's version and the game's own defines
differ from a browser's). They are the tests' fixture,
`tools/wgsl/test/fixtures/node-corpus/`, which `node-corpus.mjs` rewrites.

**The map it makes, measured** (the test workflow's `build` job, GitHub's
runner, Node 22): 421 entries, none failed; 23,367,492 bytes raw, 4,035,679
gzip −9, 488,023 brotli −q 11 (brotli's window sees across entries, gzip's
does not); the largest entry 184,166 bytes, a fragment stage; 35.5 s of
translation, 84 ms a stage on average, 477 ms the longest; read as one JSON
in 24.4 ms, as an index and a text in 2.7 ms (17.7 and 3.3 ms on a later
run). Its WGSL is 642,494 lines, 77,364 of them distinct, in 3,409,566
bytes; with every run of digits read as `#`, 3,722 distinct, in 169,814
bytes: most of the map is lines it repeats, and most of the rest differ only
in a generated number. The map's ceiling was set from these figures (below).

**The tool.** `tools/wgsl/build-map.mjs`, plain Node, run by `npm run build`
before `vite build`: it loads each translator's loader, a classic script, in
a `vm` context of its own (their top-level `Module`s collide in one), its
fetch of the WebAssembly answered with the file's bytes, both files resolved
from the client package as the page's build resolves them; hands twgsl to
Babylon's own wrapper as the page does (`initTwgsl`); keys every stage with
`wgslFormat.ts` itself (bundled with esbuild and imported, since this Node
runs no TypeScript) under the salt the page computes (Babylon's version and
page-wide switch read from the installed Babylon, the translators' digests
by the build's own function); and translates each as the page does
(`compileGLSL(G_s, s)`, then Babylon's `convertSpirV2WGSL` with `u_s`). The
same corpus and translators give the same bytes. A stage that does not
translate is left out and reported loudly, and the build goes on: the page
translates that stage itself, as it always has. It prints the entries, the
bytes raw, gzip −9 and brotli −q 11, each stage's milliseconds, and what
reading the map costs in its two candidate forms. `--reuse` keeps a map made
from the same corpus under the same salt (the dev server's start).

**The map.** `{"format": "dayhike-wgsl-map/1", "salt": ..., "entries":
{key: wgsl}}`, one JSON, its keys sorted (`mapText`, `readMap`), written to
`client/shaders/map/` (not committed). One map for every tier: the engine's
maker does not know the tier, and whether a map per tier pays is for the
real corpus's sizes to decide (§8). Chosen over a JSON index into one UTF-8
text (the page parsing a small index and decoding each entry from its bytes,
never parsing the WGSL as JSON) for three reasons, the first two decisive
whatever the sizes:

- the host compresses a JSON response (gzip or brotli) and would serve a
  binary blob as it is: the WGSL is 6 to 50 times smaller compressed (§8);
- parsed, each entry is one string, held once for the engine's life (§5);
  the other form would hold the whole blob of bytes and, beside it, a decoded
  string of every entry asked for;
- reading it costs one `JSON.parse`, when it lands, before the preparations
  that find it. The tool measures both forms on each map: on the committed
  corpus (10 entries, 91,340 bytes raw, 16,655 gzip −9, 13,147 brotli −q 11)
  0.09 ms as one JSON and 0.02 ms as an index and a text, under Node on
  GitHub's runner, both nothing; the measurement to watch is the real
  corpus's in a browser on the slow machine (§8): the index would be taken up
  only if the JSON's parse is a long task the start can feel.

**In the build.** The WebGPU module imports the map's URL from
`virtual:dayhike-wgsl-map` (`tools/wgsl/lib/mapPlugin.mjs`): in `vite build`
the map is re-exported with `?url&no-inline`, so it is emitted as
`assets/wgsl-map-<hash>.json`, never inlined however small, named by the
WebGPU chunk alone and served `immutable` under `/assets/**`; the WebGL2
bundle neither holds nor names it (`webgpuSwitchOff.test.ts`; a page built
with Vite as the game's is, in `tools/wgsl/test/mapPlugin.test.mjs`). A
build whose map was not made fails, naming the step. The dev server runs the
tool as it starts and serves the map at `<base>wgsl-map.json` once made (a
request before then waits; one the tool failed to make is a 404, no map), so
a measurement on the dev server sees what production will. A dev server's
start so translates the whole corpus wherever no map was made yet (every
fresh checkout: the map is not committed): the 421 recorded stages take about
35 s on an Apple M4 and 54 s on a GitHub build runner, beside whatever the
dev server may be measuring. With `DAYHIKE_SKIP_WGSL_MAP` set, the dev
server translates nothing and answers the map's request with a 404; the
build always translates. Under the suite the URL is empty and no map is
asked for.

**Its ceiling.** A map is at most `MAP_MAX_BYTES`, 32 MiB (33,554,432 bytes)
of text: the page holds it whole for the engine's life and parses it in one
task on its thread. It was set from the map the recorded corpus makes,
23,367,492 bytes for two tiers on one platform, which a page holds in about
250 to 280 MB in all and reads as one JSON in 24 to 35 ms. A recording on
another platform that takes the union past it is answered by a map per
platform, not by a higher ceiling. The build fails on a larger map, naming
its size and the ceiling. The build also prints how much of the map is
repeated lines (`lines:`: the lines in all, the distinct ones and their
bytes, and the same with every run of digits read as `#`). The
page reads the map's body as it arrives, counting its decoded bytes, and
stops and refuses it once they pass the ceiling, before anything is parsed;
the `Content-Length` header cannot bound it alone, since the host serves the
map compressed (the header then counts the smaller bytes sent) and a chunked
response has none, so it only refuses sooner a map whose header already says
it is larger. A response with no body to read as it comes is read whole and
refused by its length before it is parsed. Each is a source with nothing in
it, one console line.

**The build, checked on every push.** The test workflow's `build` job builds
the client as the deploy does (`npm run build`, under the production base)
and runs `tools/wgsl/check-build.mjs` on it: exactly one
`assets/wgsl-map-*.json`, parsing as a map of the known format; the entry
chunk and every chunk it imports statically naming none of `wgsl-map`,
`wgslFormat`, `dayhike-wgsl`; the WebGPU chunk naming the map; and the deploy
check (below) accepting the built map against the built chunks, read by the
same walk the deploy check fetches them with. Its log names the chunk that
carries Babylon's version.

**On the page.** `loadWgslMap` fetches the map as the engine is made, beside
the store's read, and parses it into memory when it lands; a map that lands
after the engine is handed over is found from then on, and its fetch is
aborted when the engine is let go. The engine's maker waits for it by its
own bound, `WGSL_MAP_MS`, 1 s from its fetch, within the start's budget. The
map is the difference between a first visit that translates nothing and one
that translates every stage (40 s of the page's thread on the Windows
machine), but a map that lands late is still found by every stage asked for
after, and the preparations run on for most of a minute: the few effects
made before the world's first frame (the post chain, the sky, one
material), then the world's, from its first frame, 4 to 5 s after the
hand-over there. So a longer wait buys only those first effects, about a
second of translation there, while a map that never comes costs the whole
wait: the wait is that second. A start's map, about a megabyte compressed,
comes within it over a link of 10 Mbit/s or more; fetching it earlier, beside
the translators, is the lever for slower links. Its salt is checked against the page's
and its format must be known; a map that does not come (a refused fetch, an
HTTP error, a fetch that never answers), is another build's, or does not
parse is a source with nothing in it: one console line, nothing the player
sees, never a switch to WebGL2, never a record. So is one that reads past
the map's ceiling (above), refused before it is parsed. It takes no writes, so a
stage found in it is never written to the store. Its hits are counted as
`shipped` in `hitsBySource`. What it read is held for the engine's life
(§5).

**A stale entry** is one whose text the game no longer produces: after a
change to a shader, a plugin, a define or Babylon. Its key is never asked
for, so it costs its bytes and nothing else, and it cannot be told from a
live one without a browser: a recorded page's `hitsBySource.shipped` against
the corpus's size shows how much of it is live. A corpus recorded under an
older build is re-recorded, not trusted.

**Honesty.** `wgslHonesty.test.ts` translates the Node-made fixture with the
tool and with the page's own lookup, both with the real translators under
Node, through Babylon's own engine methods on a stand-in device, and holds
every map entry byte for byte to the page's WGSL, and the tool's salt to the
page's `buildSalt`. `?wgsl=verify` counts a map entry that differs from what
the page translates (held with an entry altered by one byte). Whether a
browser's WebAssembly gives Node's bytes is §8's item 4.

**The deploy check.** `npm run deploy:verify` (`tools/deploy/verify.mjs`,
check 4d) finds the map in the WebGPU chunk, and checks that it is served
`immutable`, parses, is of a format the chunk reads, carries in its salt the
translators' digests and the key's format the chunk was built with, Babylon's
version the bundle carries and, where the bundle shows it, Babylon's
page-wide uniformity switch, and holds translations. The bundle it searches
is the entry chunk and every chunk it imports statically, fetched by the walk
the build's check reads its files with (`tools/deploy/lib/bundle.mjs`, at
most `MAX_STATIC_CHUNKS`, 500), so a version literal the build's check finds
in an imported chunk is found here too; on the real build it is in two
chunks the entry imports (`abstractEngine.pure-*.js`, `tools.pure-*.js`),
not in the entry chunk. The walk starts from the entry chunk's text the
check already fetched, and resolves each chunk against the chunk that names
it. A chunk that does not answer, or whose fetch throws, fails the check,
naming it and the error; and any request of the deploy check that gets no
answer at all is a failure of its own check, never the end of the checks
after it (`tools/deploy/lib/reach.mjs`).

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
where a first visit can find every stage, and only as measured. What they
cost the start as they are: 2,646,596 bytes of WebAssembly (glslang 943,680,
twgsl 1,702,916; 887,392 gzipped, the host's compression) and 90,585 of
loaders, fetched and compiled inside the fetch budget before the engine is
made. Under Node both start in about 20 ms, compiled lazily; in a browser
their fetch and start on the slow machine have not been measured apart from
the start (§8, item 6). With every stage found in the map, a start needs
none of it; making them lazy again is a later decision, taken on that
measurement.

The start, step by step:

1. "Loading…" on screen. The WebGPU module imported (the fetch budget,
   `WEBGPU_FETCH_MS`, 10 s, running across this step and the third).
2. The adapter asked (the GPU's budget, `WEBGPU_START_MS`, 10 s, running
   across this step and the fourth).
3. Where it fits, the translators fetched and started (`loadTranslators`).
4. The engine made (`createWebGpuEngine`): the engine object, the lookup
   installed and its sources' read started, the device requested
   (`initAsync`), the translators handed to Babylon, and the sources waited
   for, each by its bound from when their read began (the store 500 ms, the
   map 1 s) and never closer than 500 ms to the start's deadline.
5. The engine handed over; the world's build and its first preparations,
   each in its call.

With `?wgsl=off` step 4 installs no lookup and reads nothing.

## 7. The recorder

`?wgsl=` is one of the page's own overrides (`engine`, `tier`, `probe`,
`wgsl`): carried across the page's navigation, never announced to a follower.

- **Always**: the page object `dayhikeWgsl` (one per page, across every engine
  it makes) counts `hits` (stages found and used), `hitsBySource` (the same by
  the source's name, `page` for a stage this page translated earlier,
  `shipped` for the map, `store` for the browser's store), `misses` (stages translated), `translateMs` (both translators, every
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

A measurement reads it whole with `JSON.stringify(dayhikeWgsl)` from the
page, and reads the counters alone for a gate: `hits` and `misses` show
whether the mechanism fired, `hitsBySource.shipped` how many the map served.
`dayhikeWgsl.download()` saves the stages a `?wgsl=record` page prepared as a
corpus file (§5.2), each once: the input of the build's translation.

## 8. What is not known yet, and how each will be measured

**Read so far** (the lookup's first readings in a browser: a Windows machine,
an NVIDIA T4, 4 virtual CPUs, Chrome 154, high tier, canopy page, before the
map): a first visit translated 92 stages in 40.0 s (Tint 79 % of it, glslang
the rest; Babylon's own processing 4.6 s outside the preparation) and settled
at 57 s, against 54 s with `?wgsl=off`; a second visit found 68 and
translated 22 (9.5 s) and settled at 36 s, a third found 86 and translated 2
and settled at 37 s, WebGL2 at 27 s and 18 s. The store opened in 2 to 6 ms
and answered within 83 ms; a stage's key costs 0.5 to 0.6 ms; `?wgsl=verify`
counted no difference over 98 stages; a truncated and a byte-flipped entry
were each dropped and translated afresh, nothing else. A start's WGSL was
4.99 MB of text for 106 stages (3.20 MB of GLSL in); the store's 128 entries,
1.22 MB gzipped. With translation gone a stall with no frame and an idle
page thread remains (9 s at the start), the GPU process compiling the render
pipelines as far as the device's queue shows: the map does not remove it.

1. **The real corpus's size, per tier.** Both tiers together, measured
   (§5.2): 421 stages, a map of 23.4 MB raw, 4.0 MB gzip, 0.49 MB brotli,
   under the 32 MiB ceiling set from it; its JSON read in 18 to 24 ms under
   Node. Per tier, and in a browser on the slow machine, not yet.
2. **What else in the text differs between loads of one page** (§3): two
   loads recorded with `?wgsl=record`, their reports kept whole
   (`JSON.stringify(dayhikeWgsl)`, the stages' `glsl` with them), and each
   pair of stages of equal length and different key compared line by line.
   With the plugins' numbers pinned, what is left is named there, and pinned
   the same way where it can be (a light's index, a define's order).
3. **Whether keys recorded on one machine are asked for on another**: the
   same pages recorded on the Apple M4 and on the Windows machine, the key
   sets intersected. The texture compression formats differ (ASTC and ETC2
   against BC), and they reach the text through the defines where a material
   reads a compressed texture's format; a corpus is then the union of both,
   and each machine finds its own half.
4. **Whether Node's translation equals the browser's**, byte for byte: every
   recorded `G_s` translated with the tool, each result compared with the
   recorded `W_s`. Expected equal (the same WebAssembly; `wgslHonesty.test.ts`
   holds the tool to the page's own path under Node); it is what makes the
   shipped map honest in a browser. `?wgsl=verify` on a page given the map
   checks it there.
5. **The first visit with the map**: the Windows machine, a fresh profile,
   high tier, canopy page, a map built from that page's recorded corpus: the
   counters (`hitsBySource.shipped` near a start's 90 stages, `misses` near
   none), the time to settle against §9's 30 s, the map's fetch and parse
   against its 1 s, and the first frame against WebGL2's.
6. **What fetching and starting the translators costs a start** once every
   stage is found: 2,646,596 bytes of WebAssembly (887,392 gzipped) and
   90,585 of loaders, fetched and compiled before the engine is made. Timed
   apart on the Windows machine, a fresh profile and a warm one; it decides
   whether they are fetched lazily again (§6).
7. **The GPU process** once translation is gone (the stall above): a Chrome
   trace with the GPU categories, a first and a second load.
8. **The memory the kept WGSL costs**: the page's heap on a first and a
   return visit, against the estimate of §5 (about 5 MB for the page's own
   translations, about 6 MB for the store's read, the map beside them).
9. **The skinned draw on a real device**, first and second load: no
   validation error at its first draw, its effect's vertex source carrying
   `_int_matricesIndices_`; `?wgsl=off` alike (read once on the Windows
   machine: met).
10. **The store in a private window and against a small origin quota**: the
    store works for the window's life or is none, and the page draws either
    way; a `put` the browser refuses keeps nothing, and the eviction keeps the
    store under its bounds.

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
and the WebGL2 shader pins unchanged: read at 36 s and 37 s, with 22 and 2
misses, not met. The store cannot move the first load (§5.1); that is the
shipped map's bar, the first load within 30 s with the counters showing the
map's hits, which item 5 of §8 reads.

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

`pluginNumbers.test.ts` pins Babylon's numbering of plugin classes by its
text, holds `PLUGIN_ORDER` to every plugin class a PBR and a Standard
material carry and every one in `src/`, and two loads with the models
arriving in either order to the same defines. `wgslHonesty.test.ts` holds
the build's map, entry by entry, to the page's own translation of the same
corpus with the real translators, and the tool's salt to the page's.
