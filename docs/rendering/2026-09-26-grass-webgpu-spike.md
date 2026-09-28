# The WebGPU blade culling spike

A bounded experiment beside the grass frame reclaim
([design](2026-09-26-grass-frame-reclaim-design.md) §9,
[plan](2026-09-26-grass-frame-reclaim-plan.md) Task 6): run the game on Babylon's
WebGPU engine with every existing material and plugin, then cull and pack the
blade field on the GPU with a compute pass, and measure whether that route
pays. Its code lives on its own branch behind `?engine=webgpu`, off by
default; nothing of it ships.

**Verdict: no-go on the design's four criteria (§9.5), as measured.** The pass
works and saves about a millisecond, but the version whose saving was measured
cleanly lets clumps drop out for a frame on a turn, and the version that does
not has no clean frame measurement. The larger finding is outside the
criteria: **the WebGPU engine alone draws the canopy pose about 2.5 ms faster
at native pixels and about 10 ms faster at four times the pixels than WebGL2**
(the native figure is the build with the cull; see the dated correction after
§4), more than the whole grass reclaim aims for. That deserves its own design
(§7).

## 1. Conditions

Babylon.js 9.18.0; Chrome 153, headless, on an Apple adapter (Metal 3), from
one isolated browser per round. Seed `atmo`, `weather mist`, `time 12`, high
tier, a 1200 × 2029 window at device pixel ratio 1, the canopy pose
`(123, 110.87, −105.5)`, yaw 1.571, pitch 0.3, and the meadow pose
`(369, 51.01, −855)`, yaw 0, pitch 0.3, as in the
[near-grass verification note](2026-09-25-near-grass-fullness-verification.md)
§1–§2. Frames by that note's pair method: a fresh browser and a discarded
warm-up page per round, the two builds on fresh pages one at a time, 14 s to
load, 3 s to settle, 8 s of `onAfterRenderObservable` intervals, mean and p95;
a page is *quiet* when it sits within 0.5 ms of its build's lowest mean.
Fullness by that note's crops and thresholds. WebGPU `timestamp-query` was not
enabled and no GPU timer is reported.

Builds, all from one commit:

| label | URL | what draws the blades |
| --- | --- | --- |
| **GL** | (none) | WebGL2, thin instances, as shipped |
| **B** | `?engine=webgpu&blades=cpu` | WebGPU, thin instances, as shipped |
| **S** | `?engine=webgpu` | WebGPU, the compute pass; count read back one frame late |
| **I** | `?engine=webgpu&bladecount=indirect` | WebGPU, the compute pass; count written into the draw's indirect arguments |
| **F** | `?engine=webgpu&bladecount=full` | WebGPU, the compute pass; every bucket's whole capacity drawn, dead slots collapsed |

Much of the afternoon the machine was shared with other GPU work that could
not be stopped: whole batches moved by 2–10 ms and are discarded. Only the
rounds below whose every page was quiet are read.

## 2. The engine step

`?engine=webgpu` creates `WebGPUEngine` (after `IsSupportedAsync`) with the
adapter's own limits, and loads glslang and twgsl from the copies
`@babylonjs/core` ships (`assets/glslang`, `assets/twgsl`), bundled by the
build, never from a CDN. Every material is made to generate GLSL (a prototype
accessor on `Material._forceGLSL`, so the glTF loader's materials are covered
without cloning them), which the engine translates to WGSL at run time.

Every plugin in the scene then compiles and the canopy pose renders with zero
console errors, after six changes, each taken only on WebGPU:

| what failed | where | change |
| --- | --- | --- |
| `'textureSample' must only be called from uniform control flow` | a post-process shader, a texture read after a branch on a varying | uniformity analysis off for translated shaders (the engine's own per-shader switch, applied to all) |
| `sampler constructor must appear at point of use` (glslang) | `groundHex.fragment.fx`: `hexFetch2D` / `hexFetchArray` take a `sampler2D` argument | the two fetches as macros with the same arithmetic (`webgpuGlsl.ts`) |
| `'macro' is a reserved keyword` (WGSL) | the terrain plugin's local `vec3 macro` | renamed (`webgpuGlsl.ts`) |
| 17 vertex outputs, limit 16 | the blade material: PBR varyings plus the foliage plugin's | the adapter's limits requested (28 here) |
| `atmGradient` not bound | the atmosphere plugin, while the effect is off it binds no texture; WebGPU validates every declared binding | the gradient bound regardless |
| a sign's painted texture throws | the WebGPU engine's dynamic-texture extension is not imported by the WebGL2 imports | the WebGPU extensions imported |

And one that fails silently: the forest impostor bake, which waits at most
5 s for its shaders, times out under the slower run-time translation and the
far forest drops out; given six times the budget it bakes.

**The still against WebGL2** at the canopy pose (mean absolute difference 7.4
of 255): the same scene, the same post chain (the MSAA scene pass at 4 samples,
halation, grade, chromatic aberration, FXAA, finish), the same shadows. What
differs: the **trail bed** reads cooler and greyer than WebGL2's warm brown,
with a pale glint where it meets the horizon, as if the trail paint's snow
branch were taken; a fern at the left edge is dimmer; the sky's tint is a
little greener. The trail difference was not traced. Near cover and luminance
match (§5).

GLSL a WGSL rewrite would port, for the costing criterion 4 allows: about 685
lines in `client/src/game/shaders/` and about 640 more inline in the plugin
files (the terrain, trail, road and feature paints most of it).

## 3. The pass as built

`client/src/game/bladeGpu.ts`. The CPU fill in `bladeMeshes.ts` runs as
shipped on the field's 1 m crossing; its thirty-six buckets are then written
into one candidate storage buffer (28 floats a clump: the instance matrix,
`foliage`, `bladeStrength`, the bucket, a bounding sphere from the clump mesh's
box times the instance's scale plus 0.25 m of sway) instead of thirty-six
thin-instance buffers.

Per frame, before the player camera renders:

- one compute pass, one thread per candidate: the tier's band against the eye
  distance the foliage plugin itself measures (instance origin to eye, in xz; a
  clump at or past its tier's collapse end, or before its grow-in start, is
  drawn as nothing and is dropped exactly), the sphere against the six frustum
  planes, an `atomicAdd` on the bucket's counter, and the 21 floats written at
  that slot;
- for S and F, a second pass writing a zero matrix into every slot past a
  bucket's count (a dead slot's vertices collapse to a point).

The output is one storage buffer per tier, created with the vertex flag, its
twelve buckets **interleaved** (slot *s* of bucket *j* is record 12*s* + *j*,
a stride of 1,152 bytes) and bound to each bucket's clump mesh as the same
`world0`–`world3`, `foliage` and `bladeStrength` attributes a thin instance
uses, so the tier materials and every plugin draw it unchanged, with
`forcedInstanceCount`. Two things forced that layout:

- **Eight vertex buffers.** The adapter allows eight; the clump's own geometry
  takes four. Babylon puts attributes that share a GPU buffer into one vertex
  buffer only when each one's offset lies inside the stride, so a bucket's
  region of one shared buffer (a large offset) cost six slots. Interleaving the
  buckets puts every offset inside the stride.
- **A pipeline-cache collision in Babylon.** Its WebGPU pipeline cache keys a
  vertex layout on each `VertexBuffer.hashCode`, which carries the type, size,
  stride and instancing but not the byte offset, while the offset of an
  attribute inside its stride is baked into the pipeline. Two meshes reading
  the same buffer at different offsets therefore share the first one's
  pipeline and read its data: the blades vanished. The spike adds the offset
  into each of its buffers' hash. This is a bug worth reporting upstream on
  its own.

How the count reaches the draw:

- **S**: the counters read back (`StorageBuffer.read`) and applied when they
  land, as `forcedInstanceCount` = ⌈1.25 × count⌉ + 8. At the canopy pose it
  keeps 743 of 6,131 clumps and draws 1,081 instances.
- **I**: Babylon's WebGPU engine already draws an instanced mesh through its
  draw context's indirect-argument buffer once `drawContext.enableIndirectDraw`
  is set, and writes the arguments from the CPU only when the count it is
  given changes. The count is left at the bucket's total, and each frame the
  pass's own count is copied over the arguments' instance count after the pass
  and before the draw, in the same command stream (checked: zeroing that field
  instead removes every blade). The draw runs exactly this frame's survivors,
  with no dead tail and no second pass. No raw `drawIndexedIndirect` through
  `engine._device` was needed.
- **F**: the whole capacity, so every candidate's vertices still run.

## 4. Frames

**Canopy pose, native pixels (1200 × 2029).** Quiet rounds only.

| round | first page | second page | delta, second − first |
| --- | --- | --- | --- |
| same code | B 22.88 / 24.5 | B 22.77 / 24.2 | −0.11 |
| same code | S 21.70 / 23.2 | S 21.80 / 23.3 | +0.10 |
| S first | S 21.81 / 23.4 | B 22.79 / 24.3 | B − S = +0.98 |
| B first | B 22.77 / 24.3 | S 21.68 / 23.4 | S − B = −1.09 |

**S − B = −1.03 ms**, order-averaged, against a same-code floor of ±0.11; the
lowest means agree (S 21.66, B 22.69: −1.03). Four more S/B rounds were lifted
by other work and are not read. WebGL2 on the same commit and window sat at
24.22–24.26 in its quiet pages, so **the WebGPU build with S is about 2.56 ms
faster than WebGL2** (lowest means 21.66 against 24.22); no GL/S round was
quiet on both pages.

**Canopy pose, four times the pixels (2400 × 4058).** Same-code rounds: GL
55.14 / 55.14 (0.00), B 45.21 / 45.23 (+0.02). The GL/B pair rounds give
−9.2 and −11.6 with both pages lifted; the lowest means, **GL 55.14 and B
45.21, put the engine switch alone at −9.9 ms**. One GL/S round was quiet on both
pages, S first: S 44.34, GL 55.50, **−11.16**. No S/B round was quiet on both
pages; the lowest means give **S − B ≈ −0.87 ms** (44.34 against 45.21). F
against B: +1.3 and −1.7 in the two orders, both lifted, ≈ −0.2 averaged: the
dead tail costs what the cull saves, as expected when every candidate's
vertices still run. I against B: one round, B first, both pages near their
floors, −0.65.

**Meadow pose, native.** One round quiet on both pages, S first: S 22.42, B
23.91, −1.49. The lowest means give about −1.1.

**I at native** was measured only while the machine was contended (every page
3–9 ms above the floors above), and is not read. Its frame saving is therefore
**not established**; it draws fewer vertices than S (no margin, no tail) and
runs one pass fewer, so it should be no slower than S.

> **Correction, 2026-09-26.** The engine alone at native pixels is B against GL:
> −1.53 ms by lowest means (22.69 against 24.22) and −1.34 to −1.49 ms by the
> quiet pages' means, never in a pair round quiet on both pages. The summary's
> "about 2.5 ms faster at native pixels" for the engine alone is the WebGPU build
> with S (21.66 against 24.22, §4), as §6's criterion 3 correctly labels it. At
> four times the pixels the engine alone is −9.93 ms, as stated.

## 5. Fullness and the turn

Near cover at the note's crops and thresholds, two page loads each (the wind's
phase differs per load, and a load moves cover by up to 0.015):

| pose | GL | B | S | I |
| --- | --- | --- | --- | --- |
| canopy | 0.461 | 0.457, 0.472 | 0.463, 0.476 | 0.455, 0.460 |
| meadow | 0.470 | 0.467, 0.477 | 0.470, 0.470 | 0.487, 0.483 |

Averaged: canopy B 0.465, S 0.470, I 0.458 (B − 0.007); meadow B 0.472, S
0.470, I 0.485. Every build keeps the note's cover at both poses (canopy near
cover ≥ 0.45, luminance ratio 1.21–1.26 at the canopy pose and 0.94–0.97 at
the meadow pose, as on WebGL2).

**The turn**, S only (I counts nothing on the CPU to compare): a full turn in
place at the canopy pose, the read-back counts compared with the count then
drawn, summed over the turn (instances counted live but past the draw, one
frame each), at about 35 frames a second:

| turn rate | pitch 0.3 | pitch 0.9 |
| --- | --- | --- |
| 90° a second | 14 | 18 |
| 180° a second | 443 | 75 |
| 360° a second | 484 | 200 |

The read-back lags the view, so on a turn clumps entering the frame are left
undrawn for a frame or more: few at 90° a second, hundreds at 180°. I cannot
lag, since the draw reads this frame's count.

## 6. Go or no-go

Against design §9.5:

1. **S at least 1.0 ms faster than B**: S −1.03 ms at native at the canopy pose
   (two quiet rounds, floor ±0.11), met by 0.03 ms. −0.87 at four times the
   pixels. I not established.
2. **Near cover at least B's less 0.01 at both poses, and no clump appearing or
   vanishing**: cover met by S and by I (I by 0.003 at the canopy pose). The
   turn is **not met by S**: clumps drop out for a frame on a turn. I meets it
   by construction but has no clean frame figure.
3. **The WebGPU build with S no slower than WebGL2**: met by a wide margin,
   about −2.6 ms at native and about −10 ms at four times the pixels.
4. **Every plugin compiles through the translators**: met, after six
   WebGPU-only changes (§2); one look difference, the trail bed, is not
   explained.

**No-go**: criterion 2 fails for the build whose saving was measured, and
criterion 1 is unmeasured for the build that passes criterion 2. By the
design's rule nothing is proposed upstream on the strength of this spike. A
re-measure of I against B on a quiet machine is the one number that could turn
it into a go.

## 7. What a real implementation would need

- **The engine first, on its own.** The switch to WebGPU is worth several
  times what the blade pass is, with the plugins as they are. A design for it
  would take on: the trail bed's look; the impostor bake's budget; the six
  changes above done properly (the hex fetches as macros in the include
  itself; per-material `forceGLSL` rather than a prototype accessor, or the
  plugins ported); a WebGL2 fallback, since WebGPU is not everywhere
  (`IsSupportedAsync` returning false already falls back here); the
  translators' 2.6 MB of WASM on the page's first load (about 0.9 MB
  compressed); the shader translation's cost at load; Safari.
- **For the blade pass**: I rather than S; the CPU fill kept (it is untouched
  here and costs what it did) or moved to a compute pass over the lattice; the
  frustum widened for the shadow of a clump just outside it (blades receive
  shadows but cast none, so nothing here); the walk.
- **Per blade** (each blade culled and packed, not each clump, the False Earth
  layout, design §9.4) is the next step only after I is measured. It would need
  a WGSL `ShaderMaterial` for the blades, porting the foliage plugin's vertex
  code (`foliage.vertex.fx`, `foliageWorldPos.vertex.fx`: about 140 lines) and
  its fragment code (about 65), and the lighting, fog and atmosphere the PBR
  material gives the blades for free today.

## 8. Upstream

Two things this spike found, whatever the verdict:

- **A bug**: `VertexBuffer.hashCode` omits the byte offset, and the WebGPU
  pipeline cache keys vertex layouts on it while baking attribute offsets into
  the pipeline, so meshes that read one interleaved buffer at different
  offsets share a pipeline and read the wrong data. The spike's workaround adds
  the offset into the hash; the fix belongs in `_computeHashCode` or in the
  cache's key.
- **The shape of the missing piece** (design §9.5's proposal, if a later
  measure goes): Babylon already draws instanced meshes indirectly on WebGPU
  through the draw context's argument buffer. What is missing is a supported
  way to say "the instance count lives at this offset of this storage buffer":
  for example a `Mesh.indirectInstanceCount = { buffer, offset }` that the
  engine copies into the draw's arguments before the pass, or a
  `forcedInstanceCount` that accepts a storage buffer. That, with the hash fix,
  is all the I build needed beyond public API.
