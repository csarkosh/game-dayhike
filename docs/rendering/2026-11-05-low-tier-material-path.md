# Low on the material path: the veil, the silent exposure, the phone's numbers

**Status:** built and measured on the owner's Pixel 9 (2026-11-05); `client/src/game/lighting.ts`
(`writeExposureSilently`), `client/src/game/shadeVeil.ts`, `client/src/game/shadeVeilParams.ts`,
`client/src/game/shaders/shadeVeil.fragment.fx`, `client/src/game/syncJobs.ts` (the counters),
`tools/frame-budget/phone.mjs`.

## What a phone played

Every phone is put on Low with no probe (`gpuClass.ts`, class `mobile`), so Low is the phone
experience. The owner played the game on a Pixel 9 (Chrome 156, Android 17, Mali-G715, drawing
with WebGL2 as every phone does) and it was poor: slow, choppy frames, worst in the chase, and
the Hollow drawn as its raw model instead of the dark figure the other tiers show. The second is
by construction: the haunt's shades and the Hollow are drawn into a silhouette mask the grade pass
reads back as a blurred darkness (`docs/gameplay/2026-10-06-the-mist-shades.md`), and Low has no
post chain, so until now Low had no mask either and the shades were the Hollow's model fading by
`visibility`.

The frames were measured on the phone itself over the cable (`tools/frame-budget/phone.mjs`, the
section "The phone" of `tools/frame-budget/README.md`), against the live build `b0cc6c6f`. The
canvas is 250 × 452 pixels on the Pixel (the 375 × 679 CSS viewport under Low's 1.5× scaling, the
pixel ratio ignored as on every tier), so the GPU is nearly idle; standing still, Low held a
vsync-locked 60 fps everywhere. The two moments the owner named were the main thread's:

| Moment on Low, before | Mean | p95 | Longest frame |
|---|---|---|---|
| The summit scene and the Hollow's reveal, three 10 s windows from world-ready | 19.9, 22.8, 24.9 ms | 25, 50, 58 ms | 0.85 s |
| Walking in the night forest (the joystick held forward), three windows | 19.8, 22.7, 19.8 ms | 33, 50, 33 ms | 0.16 s |

A CPU profile of each, read back to source with `tools/telemetry/symbolicate.mjs`, named the
causes. The largest was one line: on the material path `Lighting.setStare` wrote
`scene.imageProcessingConfiguration.exposure` every frame, and Babylon's setter raises
`onUpdateParameters`, on which every material in the scene marks all its sub-meshes
image-processing-dirty and re-runs `isReadyForSubMesh`, `_prepareDefines` and `_prepareEffect` next
frame, and polls its program's link status. That path was a fifth of all CPU time in the reveal
(5.3 s of 27 s busy), and the lighting's `apply()` wrote the same exposure on every weather tick,
so the same cascade ran through every weather ease of the climb. The rest was the terrain
streaming while walking (`syncJobs.run` 34 % of the walking frame: the clipmap's ring rebuilds and
the height sampling they drive, the forest's and the clutter's cells) and Babylon's own frame.

## What was built

**Exposure on the material path is written silently** (`writeExposureSilently`, `lighting.ts`).
The value is a uniform of the compiled shader: `ImageProcessingConfiguration.bind` reads the stored
field into `exposureLinear` at every material bind, so a write to the field itself reaches every
material on its next draw and raises nothing. One thing keys a define on the value,
`EXPOSURE = exposure !== 1.0`, so the first write of a `Lighting` goes through Babylon's setter and
no silent write lands on exactly 1 (a value that would is nudged by one part in a million).
`lighting.test.ts` pins what this relies on against the installed Babylon: the stored value read
back, the uniform bound from it, no observer raised, no material marked dirty. The stare's dim
(`sightUnder`, 1 − `STARE_DIM` · stare) stays an exposure write, now silent, since on medium it is
an exposure cut before the tone map and this keeps the two alike.

**The mask on every path.** `createShadeSilhouette` runs wherever there is a forest, and the
views list every shade and the Hollow for it (`EntityViews.shades()`); the low tier's own fade by
`visibility` went with the flag that chose it. The fallback capsule, drawn only while the model is
not loaded, still fades by `visibility` as it did on every path.

**The shade veil** (`shadeVeil.ts`, `shadeVeil.fragment.fx`): where there is no post chain
(`postFeatures.pipeline === false`, which is Low everywhere and medium or high on a machine without
float render targets), one full-screen quad is drawn after the scene through Babylon's
`EffectRenderer` and multiplied into the frame (`ALPHA_MULTIPLY`), its colour a per-pixel factor:
the shades' darkening, computed exactly as the grade pass computes it (the seventeen taps of the
mask, `SHADE_BLUR`, `SHADE_DARK`, `SHADE_MONSTER_DARK`, the same blotched going), and the stare's
closing darkness, the grade's crawl on an open centre off the Hollow. The frame is sRGB-encoded by
then where the grade multiplies in linear light, so the factor is raised to the display's gamma
(`VEIL_GAMMA`). The two blocks are the grade's text verbatim, and `shadeVeilShader.test.ts` reads
both files and holds them the same line for line, so the grade's own text, recorded in the WGSL
corpus, is never edited for the veil. With no figure in the mask and the stare at rest the quad is
skipped, so a day's frame on Low costs what it did. The material path's old stand-in for the
stare, Babylon's vignette heavier and moved off the Hollow, went with it.

**The streaming jobs' counters** (`SyncJobs.last`: `ms`, `lateMs`, `owners`): the scheduler charges
each slice the time between the clock readings it already makes to the job's name, and the late
run's apart; in the measurement mode the page exposes the frame's counts as `window.__syncJobs()`.
They were built to choose a streaming lever by, and said none was needed (below).

**The phone harness** (`phone.mjs`): the views opened on the phone's Chrome through adb's forwarded
port at the phone's own size, timed in consecutive windows from world-ready with a JPEG at each
window's end, the joystick held forward by synthetic touches for `walk-night`, `reveal` timed from
world-ready (the standing player is dead by 40 s), and a CPU profile when asked.

## What the Pixel measured after

The branch's build (`ed381b4e`, a preview channel), the same phone, the same views, the jobs'
counters read each frame:

| Moment on Low, after, the phone cool | Mean | p95 | Longest frame | Late job runs |
|---|---|---|---|---|
| The reveal, two windows (the third is the death) | 16.9, 16.8 ms | 16.7, 16.7 ms | 75 ms | 0 |
| Walking in the night forest, three windows | 17.0, 17.1, 16.6 ms | 16.7 ms | 108 ms | 0 |
| The trailhead, three windows | 16.7, 16.7, 16.6 ms | 16.7 ms | 42 ms | 0 |

That run was on a phone that had rested; the morning's rows were taken on one warm from an hour
of runs, at Android's thermal status 1, where the CPU is held back and even a page's world takes
twice as long to come in (26 s against 12). So the walk was measured again, the live build and
the branch interleaved, as the phone warmed:

| Walking, three windows each | Branch (silent exposure, the veil) | Live |
|---|---|---|
| Thermal status 0 | 17.2, 17.1, 16.6 ms (p95 16.7) | 18.8, 19.6, 16.7 ms (p95 25, 33) |
| Thermal status 1 | 20.7, 23.8, 16.6 ms (p95 41, 42) | 19.5, 23.3, 16.6 ms (p95 33, 50) |

(The third window of each is the player stopped against a tree, every time: no streaming, 60 fps.)
The reveal is the exposure's: it holds 60 fps cool and 19.6 ms warm where it was 20 to 31 ms, and
its profile no longer has the image-processing-dirty path at all; what remains of its long frames
is shader compiles on the Hollow's and the night's first draw (`getProgramParameter` 8 %,
`_processShaderCodeAsync` 10 % of the warm reveal's CPU). The walk is not the exposure's: no
exposure is written on a steady night, and the warm walk is the same on both builds. Its profile
on the branch is 43 % the renderer's `sync`, of which the streaming jobs are 35 % (the clipmap's
ring sampling through `olympic.ts`, `field.ts`, `montane.ts`, `trail.ts`, and its geometry's
upload slice), and 42 % Babylon's draw; the jobs never ran late in any window, so the frames over
20 ms are the budget's 4 ms and the upload slice on a throttled CPU, not a forced late run.

Of the design's ladder of streaming levers, the first (one ring fewer) was dropped before it was
built: `FOG_DISTANCE` is 4 km and six rings reach 2 km, and the outermost ring rebuilds once every
128 m walked, so dropping it buys nothing. The second (late runs spread over frames) answers a
cause the counters ruled out. The third was built: Low samples the clipmap at twice the base
spacing (`BASE_SPACING_BY_TIER`), so each ring covers twice the ground and a walk crosses each
lattice half as often, the ring count unchanged and the reach doubled with it. The near ground at
2 m and at 1 m, shot at the same stand on Low, cannot be told apart under the ground cover.

| Walking, warm (thermal status 1), three windows each | Twice the spacing on Low | The branch before it |
|---|---|---|
| First pair | 17.6, 18.5, 16.7 ms (p95 16.8, 25) | 20.2, 23.9, 16.6 ms (p95 33, 50) |
| Second pair | 20.4, 20.9, 16.7 ms (p95 33, 42) | 20.0, 22.7, 16.7 ms (p95 33, 42) |

The coarser spacing never costs and in one pair of two buys three to five milliseconds a frame;
the run-to-run spread of a warm phone is of the same size, so its gain is real but not sharp. It
stays. **The round stops here**: a warm Pixel 9 walks the night forest at 18 to 21 ms a frame on
Low, against 20 to 24 before, and the bar the design set for the walk (a mean at or under 17.5 ms
and a p95 at or under 20) is met only while the phone is cool. What is left of the warm walking
frame is Babylon's own draw (42 %) and the terrain's sampling, each a round of its own.

The counters say one more thing about that sampling. While walking, nearly all of the jobs' time
is under `idle`: the clipmap's prepare-ahead, which samples the ground its rings will move onto
next with the budget no job needs, so that a crossing commits a move without sampling. On the
warm Pixel it took 4.2 s of a 10 s window, 7 ms a frame against a 4 ms budget: a slice that says
nothing of its length runs whenever any budget is left, and on a throttled phone a slice sized for
a desktop's tenth of a millisecond runs for several. The budget bounds the slices begun, not the
time spent, and on this CPU that is the difference between 17 ms and 21. Sizing the prepare-ahead's
slices by the machine (or declaring their length, which the scheduler already honours) is the
first lever of the next round.

## What is left

- The ground cloud, the night's mist volume the Hollow comes out of on the post tiers, is still
  none on Low (`CLOUD_STEPS` 0). Wanted; a round of its own, measured on the phone.
- The streaming jobs' slices on a slow CPU: the idle prepare-ahead overruns the 4 ms budget by
  the length of its last slice every frame (above). Declaring the slices' length, or sizing them
  by a measured tick, would hold the budget.
- The canvas resolution on phones: 250 × 452 is cheap and the GPU is idle, so a sharper canvas
  on Low is a look decision now that the CPU has room.
- The summit scene's first frames still stall (75 ms here, 0.85 s before): the night's and the
  Hollow's effects compiling on first draw. Warming them at load is a candidate.
- The iPhone, which the owner saw worse.
