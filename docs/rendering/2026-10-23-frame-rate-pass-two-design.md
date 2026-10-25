# The frame-rate pass, two: the CPU's frame

**Goal:** 60 Hz on the medium and the high tier (`2026-10-20-frame-budget-rig-design.md`:
medium 15.41 ms mean and 21.19 p95 in rig-ms, high 21.82 and 30.00), with the owner's rule for
this round: a cut that changes nothing in the picture is taken on its number; a cut that
changes the picture is the owner's call, from stills. Measured on the rig (g4dn.xlarge, a T4,
Windows, Chrome 154 on WebGPU), every cut as interleaved A/B pairs against the same build of
`main` (7e8361ad) over the trailhead, the forest, the meadow and the crest, three pairs a view,
medians of the mean frame time; the night forest for the cut that is about the night.

## 1. Where the frame went

The first pass (`2026-10-18-frame-rate-pass-design.md`) cut the GPU's work. This round opened with
the game's own per-pass GPU timestamps (`?gpuTime`) beside the frame time on every view, and a
ten-second CPU profile of the page on three views a tier, symbolicated against the build's maps.
The frame on the rig is CPU-bound on both tiers: the GPU's passes sum to 9 to 13 ms on medium
and 9 to 17 on high, under budget in every view, while the frame runs 19 to 33 ms on medium and
26 to 46 on high. The time is in Babylon's draw submission on the main thread.

| Rig, `main`, medium | frame ms | GPU passes ms | | high | frame ms | GPU passes ms |
|---|---|---|---|---|---|---|
| trailhead | 25.0 | 13.0 | | trailhead | 30.6 | 16.8 |
| forest | 19.0 | 11.3 | | forest | 33.7 | 15.2 |
| tarn | 19.2 | 9.8 | | tarn | 26.0 | |
| meadow | 31.0 | 9.9 | | meadow | 41.0 | 12.1 |
| crest | 32.8 | 9.3 | | crest | 35.0 | 9.4 |
| beach | 14.0 | 5.8 | | beach | 19.0 | |
| forest, night | 19.3 | | | forest, night | 29.9 | |

What the profile named, per frame:

- **The shadow caster pass**, 4.4 to 8.5 ms on medium and 8.4 to 13.6 on high, against 0.3 to
  3.3 ms of GPU work for it. Babylon's `_prepareRenderingManager` culls nothing from an explicit
  render list, so every caster (the clipmap's seven rings, some 470 rock face patches, the props,
  the cliffs, the animals, the boulders, the signs) was submitted to every cascade every frame,
  each with `ShadowGenerator.isReady` rebuilding a defines string (0.6 to 1.4 ms of that alone).
- **Skeletal animation** at the meadow, 3.5 ms: every pooled animal's animation groups are stepped
  whether or not the animal is on the screen, and the herd ranges to 150 m.
- **Per-draw engine work**: the pipeline cache lookup 1 to 3.7 ms, bind groups and vertex state
  re-set on every draw, material binding 3 to 5 ms. Draw count is the lever.
- Smaller: the ocean edge's breaker and swash tables stepped every frame even inland (0.6 ms,
  the surf is heard to 400 m); world-matrix synchronisation of static meshes (about 1 ms at the
  meadow).

The Air's CPU is faster than the rig's and its GPU slower, so the two machines reach a similar
frame for different reasons: a CPU cut is judged by the rig's frame time, a GPU cut by the
per-pass readout, and the Air has the last word on medium (the rig design's non-goal stands).

## 2. The cuts taken (nothing in the picture changes)

| Cut | Medium, B − A ms (trailhead / forest / meadow / crest) | High |
|---|---|---|
| Each cascade draws only the casters its frustum holds | −2.9 / −1.3 / −4.6 / −6.9 | −10.1 / −15.8 / −15.2 / −12.6 |
| Babylon's WebGPU non-compatibility mode | −5.9 / −4.6 / −6.0 / −7.4 | −8.2 / −9.3 / −10.0 / −9.3 |
| An animal off the screen holds its clip | meadow −2.7, forest +0.2 | |
| The shadow map not drawn while no shadow can show | forest at night −4.2 (16.6 → 12.4) | |

**Casters by cascade** (`lighting.ts`, `cascadeCasters`). `getCustomRenderList` is set for every
cascade, not only the far one: it reads `getCascadeTransformMatrix(layer)` (Babylon computes the
cascades' matrices as the map binds, before it asks for any layer's list), extracts the planes,
and keeps the casters whose bounding info is in them by Babylon's own camera rule
(`isInFrustum`; `alwaysSelectAsActiveMesh` and `infiniteDistance` always pass), the far cascade's
near-only exclusion applied in the same pass, into a per-layer array so a frame allocates
nothing. High's first cascade reaches a few metres and its second about a hundred, so nearly
every caster leaves them; medium's one cascade reaches 300 m and loses the casters behind the
camera. A caster outside a cascade's frustum contributes nothing to it, so the map is the same.
High: trailhead 34.8 → 24.7, forest 38.0 → 22.7, meadow 45.9 → 30.6, crest 41.3 → 27.9.

**Non-compatibility mode** (`gpuEngine.ts`): `engine.compatibilityMode = false` once the engine
stands, after `installPipelines` has wrapped its draw. The frames were compared with `main`'s
pixel for pixel, with `main`'s own frame-to-frame noise as the yardstick: no difference beyond it
on any view of either tier. Medium: trailhead 26.2 → 20.1, forest 20.0 → 15.6, meadow 35.0 →
29.0, crest 37.5 → 29.9; high: 34.7 → 26.4, 40.6 → 31.3, 49.7 → 39.7, 44.4 → 35.0.

*Amendment, 2026-10-25.* Within hours of shipping, the mode lost the engine in play ("Buffer …
used in submit while destroyed", the page rebuilt on WebGL2), and it was turned off again. The
fast path records each sub-mesh's draw in each pass as a render bundle, with its vertex and
index buffers baked in, and drops the bundle only on a new effect, a changed material context or
a changed uniform buffer. A geometry that takes a new buffer in place of another (a thin-instance
bucket grown, `setVerticesData` on a buffer that cannot be written in place) dirties the main
pass's material, which sets its effect again; the shadow pass sets a new effect only when its
defines change, so its bundle kept the destroyed buffer. `webgpuDrawCache.ts` wraps the three
doors a geometry takes a buffer through (`setVerticesBuffer`, `setIndices`, `setIndexBuffer`)
and resets the draw context of every sub-mesh of every mesh on it, in every pass, after each;
the mode is on again with it. Checked on the Air before it shipped: one shadow-casting pine's
matrix buffer swapped for a copy failed the renderer on the next frame without the reset and
drew on with it; thin-instance matrix buffers on every mesh swapped and grown every half second
for a minute, on both tiers, drew without a GPU error; and a flight of the free camera across the
world, which failed without the reset after about five minutes, ran its ten minutes with it.

**Animals off the screen** (`creatureModel.ts` `animateGroup`, `wildlifeMeshes.ts`
`creatureInView`): past 25 m, an animal whose 4 m sphere misses the camera's frustum (the scene's
planes, last frame's) has its clip paused where it stands, and restarted from that frame when it
returns. Within 25 m every animal animates, in view or not, so a long shadow cast into the view
by an animal just off its edge keeps moving.

**The shadow map under full cloud and at night** (`lighting.ts` `shadowMapDrawn`): the rain and
eerie presets set the shadow's darkness to 1 and the night's sun to nothing, and no cast shadow
can show through either; the map is drawn once more as the light goes and then left until it
returns. The receivers still sample it; what it holds cannot show.

## 3. Measured and dropped

- **The sky dome drawn last among the opaques**: medium +0.05 to +0.96 ms, high −0.26 to +0.40.
  On a CPU-bound frame the sky's overdraw was never on the critical path.
- **The headlamp's light disabled when off**: −0.41 to +0.71 ms, noise; and toggling a light's
  enabled state changes the defines, a recompile at every switch.
- **MSAA 2×**: identical to 4×. WebGPU allows one or four samples and Babylon rounds two to four
  (`WebGPUTextureHelper.GetSample`). The choice is 4× or none.

## 4. The owner's calls

- **MSAA off.** The frame on the rig does not move (the GPU is not its bottleneck), but the
  prepass's GPU time falls 2.3 and 1.8 ms on medium and 2.7 and 1.9 on high at the trailhead and
  the forest, and nothing at the meadow and the crest; on the Air's slower GPU that is the frame.
  FXAA stays on either way. Stills of both tiers at 4× and none, crops at 2×, were given.
- **The shadow map every other frame**: medium −4.9 / −2.9 / −6.1 / −9.4, high −6.3 / −9.9 /
  −12.8 / −10.4. A still cannot show it: the shadow follows the camera a frame late, and the
  cascades step at 30 Hz as the camera turns. *Taken, 2026-10-23:* the owner compared the two
  builds live on the high tier's forest and meadow and chose the half rate on both tiers
  (`SHADOW_MAP_REFRESH_RATE` in `lighting.ts`, composed with `shadowMapDrawn`: once as the
  light goes, every second frame while it shows). A gentler variant, the far cascade alone
  held between draws with the near cascades every frame (`farCascadeHold.ts` on the
  `tune/farhold` branch, built as a channel, unmeasured), is the fallback if the half rate
  shows more than wanted. Measured one at a time against `main`, not yet on one build with
  the four cuts of §2.

## 5. Measuring

The harness (`tools/frame-budget/`) drove the rig's Chrome from the laptop over an SSM port
forward for eight hours. Lessons paid for: the forward drops after 20 to 50 minutes and the
harness hangs on the dead socket, so every run is bounded and a watchdog restarts the forward
when the port stops answering; a queue chained on done markers fires straight through when the
tunnel is down (a run on a dead tunnel exits at once and still prints its marker), so the last
step of a chain checks the rows exist before it stops the rig; a build whose sample count or
constant was wrong measures what it built, not what was meant (the shadow-map experiment used a
constant Babylon does not have, which read as render-once in every weather; only its night
number was trusted, and the shipped code uses the real one). The rig's own `main` frame crept up
3 to 5 ms over the evening: pairs stay valid, absolute verdicts want a fresh Chrome.

## 6. Not done

The four cuts were measured one at a time against `main`; their sum on one build, and the
budget verdict, are the next run. The Air has not seen the build. Left for later, in order of
promise: `ShadowGenerator.isReady`'s defines string rebuilt per caster per cascade per frame
(a memo, a fork of one method; 0.6 to 1.4 ms); the face patches merged into fewer caster meshes
(a draw each today); the ocean edge's tables stepped only within the surf's hearing; static
meshes' world matrices frozen. The harness should fail a run whose socket has gone quiet rather
than hang, and the rig's Chrome should restart between runs.
