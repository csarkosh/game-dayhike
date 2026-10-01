# WGSL map per tier: design

**As built, 2026-10-01.** The shipped map of translations
([the shader lookup design](2026-09-28-webgpu-shader-lookup-design.md),
§5.2) becomes three, one a quality tier, each of the stages recorded on that
tier; the corpus gains an index of which tiers each stage was recorded on; a
recording says which tier it was made on; and the page fetches the map of
the tier it decided at launch. The map's format, the corpus's files, the
keys and the salt are unchanged.

## 1. Why

The corpus held 762 stages, and its one map was 8,131,195 bytes against the
ceiling of 8,388,608 (`MAP_MAX_BYTES`, 8 MiB: a page parses the map in one
task and holds its lines for the engine's life). Two recordings were owed:
the low tier, never in the corpus, about 138 stages; and a party of two,
about 187 (a second hiker's headlamp changes the light count, so every lit
material gets another variant). Their union would make about 11.1 MB. The
lookup design's rule for that case is a map per platform, not a higher
ceiling. On 2026-10-01 the high tier's stages passed 8 MiB, and the ceiling
was raised once, to 10 MiB (10,485,760); the split by platform is the step
after that, not a higher ceiling again. The tier is the platform the page
knows before its engine is made
(`startupTier` in `main.ts` decides it, and `engineFor(tier, …)` makes the
engine for it), and it is the largest divider of the corpus: a page at one
tier never asks for another tier's variants.

## 2. Decisions

| | Decision | Why |
|---|---|---|
| 1 | **One map a tier, always**, `wgsl-map-<tier>-<hash>.json` for `low`, `medium`, `high`, each of the stages the index puts on that tier; no single-map path. | Two paths are two to check; the page knows its tier whenever it makes an engine (a switch of tier in Settings makes a new engine at the new tier). |
| 2 | **The corpus stays one flat set of stage files**, and gains `client/shaders/corpus/tiers.json`, each stage's name to the tiers it was recorded on. | The files are the stages' exact text, named by their hash; a tier is a fact about a recording, not about the text, so it lives beside the files. |
| 3 | **The existing 762 stages are indexed on `medium` and `high`.** | They were recorded on those two tiers (§5.2 of the lookup design). A recording on low adds `low` to the stages it hits. |
| 4 | **A recording names its tiers** (`"tiers": ["high"]` in the envelope, format `/1` kept, the field optional); **a recording without the field is merged into every tier.** | Old recordings stay valid. One page may make engines at two tiers (a change in Settings); the report keeps every tier its engines were made for, and the recording names them all. |
| 5 | **Each map carries its tier** (`"tier": "low"` after the salt; the page refuses another tier's). | Two tiers' maps of the same entries would otherwise be the same bytes, which the build folds into one file; and a page can tell a wrong map. |
| 6 | **Every stage is translated once**; the three maps are made of subsets of the one translation. | Translation is the cost (about 84 ms a stage); a map is a `mapText` of its entries. |
| 7 | **An engine made for no tier takes the medium map** (`DEFAULT_TIER`, the renderer's own default). | Only the tests make one; `main.ts` always gives the tier it decided, and `webgpuSwitchOff.test.ts` pins that line. |

## 3. The index

`client/shaders/corpus/tiers.json`, committed, written only by the merge:

```
{"format":"dayhike-wgsl-tiers/1","stages":{
"0101a04874dd196a":["medium","high"],
…
}}
```

One stage a line, the ids (the 16 digits that name a stage's file)
ascending, the tiers in the order low, medium, high, each once, one at
least: the same corpus gives the same bytes. `readCorpusDir`
(`tools/wgsl/lib/corpus.mjs`) reads it with the files and refuses, naming
each: an index of another format or shape, or whose text is not what the
merge writes (reordered, reformatted: edited by hand); a stage it names that has no
file; a file whose stage it leaves out; a corpus with stage files and no
index (an empty corpus has none). The tests' fixtures carry their own, every
stage on every tier.

## 4. The recording

`{"format": "dayhike-wgsl-corpus/1", "tiers": ["high"], "stages": [...]}`.
The page's report (`dayhikeWgsl`) gains `tiers`: the quality tiers the
engines that looked shaders up on the page were made for, in the order
first seen (`lookUpShaders` is told the engine's tier). `download()` writes
them (`corpusText(stages, tiers)`); a report whose engines were made for no
tier writes no field. `readRecording` gives the tiers back, or null for none,
and refuses tiers that are not some of the three, each once. A page whose
start probed at two tiers, or changed tier in Settings, records every stage
on both: over-inclusion only (a map holds a stage no page at that tier asks
for, and is larger by it), never a stage missing. A recording for one tier
pins it with `?tier=` on the URL, which the start takes over the probe.

The merge (`tools/wgsl/merge-corpus.mjs`) puts each stage of a recording on
the recording's tiers, every tier for one that names none: a new stage is a
new file on them, and a stage the corpus holds gains them. The index is
written afresh where any stage was added or gained a tier, and otherwise
left as it is; no stage file is ever rewritten. It prints how many stages
gained a tier and how many the corpus holds on each.

## 5. The maps

`tools/wgsl/build-map.mjs` writes to `client/shaders/map/` (not committed)
`wgsl-map-low.json`, `wgsl-map-medium.json`, `wgsl-map-high.json` and
`wgsl-map.inputs`, the digest of what they were made from (the format, the
salt, the stages and the index; `--reuse` keeps maps whose digest matches).
Each map is `mapText(salt, entries, tier)`: format 2 with `"tier"` after the
salt, of the stages the index puts on that tier (`entriesOn`). Each is held
to the ceiling and to ASCII before any is written, read back with the page's
reader for its tier and compared entry by entry with its translation, and
on any difference every map is removed. The log has the corpus's count on
each tier, the translation once, and each map's figures.

The Vite plugin (`tools/wgsl/lib/mapPlugin.mjs`) exports from
`virtual:dayhike-wgsl-map` an object of the three URLs: in the build, each
map imported `?url&no-inline`, so emitted as `assets/wgsl-map-<tier>-<hash>.json`;
on the dev server, `<base>wgsl-map-<tier>.json` each, served once the tool
has made them; under the suite, three empty strings.

## 6. The page's fetch

`createWebGpuEngine(canvas, { tier, … })`: `main.ts` passes the tier the
engine is made for (`input.tier`, the one `startupTier` decided, or the one
a switch in Settings asks for). The engine's default sources are
`defaultSources(salt, wgslMapUrls[tier], tier)`: `loadWgslMap` fetches that
tier's map as before and reads it with `readMap(text, salt, tier)`, so a map
of another tier is a source with nothing in it, one console line, as a map
of another build is. Nothing else of the lookup changes: the keys, the salt,
the store, the bounds.

## 7. The checks

- `tools/wgsl/check-build.mjs`: for each tier exactly one
  `assets/wgsl-map-<tier>-*.json`, parsing as a map of the format; the WebGPU
  chunk naming each; the WebGL2 chunks naming none; the deploy check
  accepting each against the chunks. A tier's map may be empty while another
  tier's holds translations (a tier not yet recorded has none); a build whose
  every map is empty fails, as one map that was empty did.
- `npm run deploy:verify`, check 4d, fetches the three maps, then checks each:
  the chunk names the tier's map (`findMapUrl(chunk, tier)`), served
  immutable, parsing, this build's, under the ceiling, empty only beside a
  tier that is not.
- Tests: the index's text and refusals (`corpusFiles.test.mjs`), the merge's
  tiers (`mergeCorpus.test.mjs`), the per-tier split, the tier in a map and
  `--reuse` on a change of tiers (`buildMap.test.mjs`), the three assets and
  the fold of same bytes (`mapPlugin.test.mjs`), the three in a build
  (`checkBuild.test.mjs`), the recording's tiers and the map's tier
  (`wgslFormat.test.ts`), the report's tiers (`shaderLookup.test.ts`), and
  the page's choice of file by tier (`gpuEngineSources.test.ts`).

## 8. Measured

The build of the 762 stages, every one on medium and high and none yet on
low, on an Apple M4, Node 22: 68,990 ms of translation, 91 ms a stage; the
low map 416 bytes (0 entries); the medium map 8,131,211 bytes raw,
1,595,455 gzip −9, 524,427 brotli −q 11, and the high map 8,131,209 bytes
raw (762 entries each, the two differing in the tier they carry), each 16
bytes over the one map's 8,131,195 and 257,397 under the ceiling of
8,388,608; read with the page's reader in 13.7 to 14.3 ms, every entry
expanded in 20 to 22 ms. The low tier's recording, and the party's, are the
next merges: each adds its tiers to the stages it hits and its new stages to
its own tier's map alone, so the medium and high maps grow only by what
those tiers ask for.
