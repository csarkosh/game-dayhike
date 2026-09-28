# WebGPU on the high and medium tiers: verification

What is measured against the WebGPU design's gates
([`2026-09-26-webgpu-high-tier-design.md`](2026-09-26-webgpu-high-tier-design.md),
§13), how, and what the numbers were. This note starts with Task 1's gate: the
engine chosen before the game starts, switched off, and every way the WebGPU
start can fail ending on WebGL2. Each later gate appends a section.

## 1. Method

**Builds.** Two checkouts on two ports, each serving its own build from the dev
server: the branch, detached at the commit a gate reads, and `origin/main`
(`ba0fd95`), the commit the branch was cut from. Neither is the branch's own
working tree, so a commit landing there cannot change a build mid-gate. Two
measurement patches are applied to both and reverted after; they are never
committed:

- a pose patch to `client/src/app.ts` and `client/src/game/renderer.ts` that
  exposes `__fcSet(x, y, z, yaw, pitch)`, pinning the free camera at a pose
  every frame (positive pitch looks down), and `__scene` / `__engine`, the
  scene and the engine the renderer was given;
- the dev server's port in `client/vite.config.ts`.

`main` also takes the tier patch of the earlier notes (`?tier=`); the branch
reads `?tier=` itself since Task 1.

**Browser.** Chrome 153, headless, on the reference machine (Apple M4). The
renderer string, read from `WEBGL_debug_renderer_info` on a control page, is
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`, as in
every earlier note; the WebGPU adapter is the same GPU through Metal. The
window is 1200 × 2029 CSS pixels at device pixel ratio 1, and the engine
renders 1200 × 2029. One browser serves the whole gate: it is started once, not
once per round.

**Page.** `/dayhike/game/<fresh uuid>?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=high`,
with `&engine=webgpu` where the WebGPU path is exercised; the switch is off
(`WEBGPU_ENABLED = false`), so the override is the only way onto it.

**Frame: the pair method** (design §13.1). Per round, a discarded warm-up page,
then the two builds on fresh pages one at a time in alternating order, each
page after 30 s of rest; per page 14 s to load, the pose, 3 s to settle, 8 s of
`onAfterRenderObservable` intervals, mean and p95, the JS frame time
(`onBeginFrameObservable` to `onEndFrameObservable`) and the draw calls.
Same-code rounds on each build give its noise floor. A page is **quiet** when
its mean is within 0.5 ms of its build's lowest; only rounds whose pages are
both quiet are read. A page waits while any test run is going on the machine or
its load average is above 3.5.

**The fallback paths** (design §13.6). Each case runs in a fresh isolated
browser context: its own storage and its own HTTP cache, so a remembered
record never leaks from one case into the next. What the case needs is
injected into the first document before the page's own scripts run, and none
of it is committed:

| injection | what it does |
| --- | --- |
| no WebGPU | `navigator.gpu` reads `undefined` |
| 16 inter-stage variables | `requestAdapter` returns the real adapter with `limits.maxInterStageShaderVariables` 16 |
| a stalled adapter | `requestAdapter` returns a promise that never settles |
| a stalled fetch | `fetch` of either translator's `.wasm` never settles |
| a loader served as HTML | each translator loader's script `src` points at a blob of the site's own HTML page, which is what the host sends, with status 200, for a missing file (the dev server answers such a request with a 404 instead) |
| storage refused | every read of `localStorage` throws, as with blocked site data |
| errors held back | the device's `uncapturederror` listeners receive nothing until the page is told to pass them on, so a WebGPU game keeps running past its startup window despite the translation faults of design §3.3 |
| the loaders in order | the twgsl loader runs to its end before the glslang loader starts (§3.2 says why this is needed) |
| the query kept | the landing's own query is carried onto the game route its Play button opens, standing in for the switch turned on |

A device is lost by calling `destroy()` on the engine's device from the
console; an uncaptured validation error is raised on it by creating a buffer
with no usage. A recorder, injected with the rest, logs the HUD's status line,
the canvases and the first frame every 50 ms, and every console warning, error
and unhandled rejection of that document; a poller outside the page reads the
same state about twice a second across the page's own reloads. The console of
the last three documents is read from the browser at the end of each case.

## 2. Poses

The canopy pose of the earlier notes, `__fcSet(123, 110.87, -105.5, 1.571, 0.3)`
on seed `atmo` (627994160), `weather mist`, `time 12`, high tier, is the one
pose Task 1's gate reads a frame at. The fallback cases load the same page
without a pose: they read what the page does, not what it draws. The start as
a player sees it begins at the landing page, `/dayhike/?engine=webgpu&tier=high`
(or `?tier=high` for WebGL2), and its Play button.

## 3. Task 1's gate

Measured 2026-09-26 on the branch at `bd3b1ae` (Tasks 1, 3 and 4 built; Task
2's compatibility changes not yet), against `origin/main` at `ba0fd95`.

### 3.1 Switched off, the branch is `main`

At the canopy pose, native pixels, the branch as it would ship (no `?engine=`)
against `main`:

| round | first page | second page | delta |
| --- | --- | --- | --- |
| same code, `main` | `main` 24.24 / 27.0 | `main` 24.33 / 26.7 | +0.09 |
| same code, branch | branch 24.24 / 26.9 | branch 24.16 / 27.0 | −0.08 |
| 1 | `main` 24.25 / 26.6 | branch 24.22 / 26.5 | −0.03 |
| 2 | branch 24.88 / 27.2 | `main` 24.49 / 26.6 | not quiet |
| 3 | `main` 24.20 / 26.7 | branch 24.18 / 26.6 | −0.02 |
| 4 | branch 24.20 / 26.6 | `main` 24.23 / 26.5 | −0.03 |
| 5 | branch 24.23 / 26.6 | `main` 24.22 / 26.8 | +0.01 |

**The order-averaged delta is −0.02 ms**, inside both same-code floors (+0.09
and −0.08). The JS frame is 3.79 ms on both builds, and the draw calls 222–229
on both. Round 2's branch page sat 0.72 ms over its build's lowest and is not
read. A WebGL2 page on each build logs no warning and no error: the Babylon
banner, the dev server's two lines and one form-field notice, the same on both.

### 3.2 As built, the WebGPU engine does not start

On `?engine=webgpu` the engine did not come up on 18 of 19 loads on the dev
server, nor on any of 3 loads of a production build served locally
(`vite build`, `vite preview`). Each time the page showed "Loading…" for 10 s,
logged `WebGPU: the engine did not start; drawing with WebGL2. Error: the
WebGPU engine was not ready in 10000 ms`, remembered the failure as `init` and
drew with WebGL2 on a fresh canvas 12–13 s after the page opened. Each such load
also left an unhandled rejection in the console, `Aborted(TypeError:
WebAssembly.instantiate(): Import #0 "env": module is not an object or
function)`, after four warnings from the translator's own loader.

**Why.** Both translator loaders that Babylon ships, `glslang.js` and
`twgsl.js`, are classic scripts that begin with a top-level `var Module`, and
each factory looks `Module` up when it is called, not when its script runs.
`loadTranslators` (`gpuEngine.ts`) runs the two loaders at once, so whichever
finishes last owns the page's `Module`. Babylon then initialises glslang from
the global the glslang loader defined, which calls the page's `Module`; it
loads `twgsl.js` a second time before initialising twgsl, which puts twgsl's
factory back first. So the start works only when the twgsl loader finishes
before the glslang loader:

| order the loaders finished in | loads | outcome |
| --- | --- | --- |
| glslang, then twgsl (the natural order: 16 KB against 75 KB) | 4 of 4 where the order was recorded | glslang's `.wasm` handed to twgsl's factory; the engine never ready; `init` after 10 s |
| twgsl held until glslang had loaded | 2 of 2 | the same |
| glslang held until twgsl had loaded | 2 of 2, and every later load that holds it | the engine starts, first frame 2.4–2.9 s after the page opened |

The one load in the natural order that started, the first of the gate, must
have finished the other way round. The checks the loaders pass are not enough to see this:
both globals exist, and both `.wasm` files arrive whole and valid; the failure
is at instantiation, inside Babylon's own wait, which the 10 s budget ends. The
fallback handles it as designed, but it is not a GPU failure: with the switch
on, it would record `init` on nearly every first start and hold every such
browser on WebGL2 for 30 days, after 10 s of "Loading…". The loaders need to
run one after the other, twgsl's first (or glslang's alone, since Babylon
fetches twgsl's itself). `loadTranslators` is unchanged at the branch's current
tip.

Every other WebGPU case below injects the working order, so that the paths
after the engine's start can be reached at all; each says so.

### 3.3 The fallback paths

| design §13.6 | forced by | what happened | record | console beyond the forced fault |
| --- | --- | --- | --- | --- |
| 1. no WebGPU | no WebGPU | without `?engine=`: WebGL2, no line, no wait; with `?engine=webgpu`: WebGL2 and one warning, `not on this browser (no WebGPU)`; first frame at 2.4 s either way | none | none |
| 2. a limit short | 16 inter-stage variables | WebGL2 at once and one warning, `not on this browser (maxInterStageShaderVariables 16 < 17)`, first frame at 2.5 s | none | none |
| 3. a lost device | loaders in order, errors held back; `destroy()` 12 s in | first loss: "WebGPU context lost", the record `lost`, `losses` 1, the line "Graphics restarted after a GPU error." left for the next load, and a reload keeping `?engine=webgpu`; that load tried WebGPU once more, hit §3.2 (no injection survives a reload) and drew with WebGL2 after 10 s, the restarted line shown for 6 s, the record replaced by `init`. With the first loss's record put back, and the device lost again on the next WebGPU load: the record `lost`, `losses` 2, and a reload onto `engine=webgl2` with "Graphics switched to WebGL2 after a GPU error." for 6 s. The next load without the override: WebGL2. With the override and the record still there: WebGPU again | `lost`, 1; then 2 | between the loss and the reload landing, 2.3–2.7 s, Babylon's own recovery ran ("WebGPU context successfully restored") and threw an uncaught `TypeError: Cannot read properties of undefined (reading '0')` once |
| 4. a failure inside the startup window | loaders in order; the §3.3 fault itself | the uniformity error (`'textureSample' must only be called from uniform control flow`) at frame 6 or 7, 2.5 s in: the record `pipeline`, the page replaced by the same route with `engine=webgl2` (the override would otherwise start WebGPU again), the switched line from the game's start for 6 s. The next load without the override: WebGL2. With the override and the record present: WebGPU, then the same. With the record deleted: the same again | `pipeline` | the Babylon warnings of the fault only |
| 5. storage refused, then (4) | loaders in order, storage refused | the same replace onto `engine=webgl2`, the switched line (the notice lives in `sessionStorage`, which still works), one navigation and no second | nothing stored | none |
| a failure after the startup window | loaders in order, errors held back; a validation error at 84 s | no reload; one `console.error`, `WebGPU: a GPU error after startup; remembered, but ?engine=webgpu in this URL still asks for WebGPU.`; the game went on drawing with WebGPU. Without the override in the URL, the next load is WebGL2, as every load is with the switch off | `pipeline` | none |
| 6. the real failures of §3.3 | none | §3.2: the engine never starts, so the loads end on WebGL2 through the start's own budget, not through the faults; with the loaders in order, through (4) | `init`; `pipeline` in order | the unhandled rejection of §3.2 |
| 7. a stalled adapter | a stalled adapter | "Loading…" for 10 s, `the adapter did not answer in 10000 ms; drawing with WebGL2.`, WebGL2 at 13.0 s | `init` | none |
| 7. a stalled fetch | a stalled fetch | "Loading…" for 10 s, `its translators did not load in 10000 ms; drawing with WebGL2.`, WebGL2 at 12.1 s | none | none |
| 8. a loader served as HTML | a loader served as HTML | both loaders "loaded" and defined nothing: `the WebGPU translators did not load: glslang, twgsl`, WebGL2 at once, first frame at 2.2 s | none | the two `SyntaxError`s of the HTML itself |

In every case the page ends on WebGL2, or, where the override asks for it and
the GPU allows, on WebGPU, and a WebGL2 page after a fallback logs no error of
its own. Three things the table shows beyond the design's text:

- **A translation that fails was not seen.** With the device's errors held
  back, one of §3.3's faults (glslang: `sampler constructor must appear at point
  of use`) left only an unhandled rejection, `GLSL compilation failed`, and the
  game ran on for 80 s with that effect never drawn: it did not reach
  `onEffectErrorObservable`, which is where design §5.5 looks. The branch
  handles this since `15d187f`, after the gated commit, which hands such a
  failure to its effect as a compile error.
- **Babylon's own recovery runs until the reload lands**, and on this scene it
  throws once (item 3). Design §5.5 says it is not relied on; it is not, but
  its throw is a console error on the loss path.
- **The HUD line** is shown from the moment the game starts on WebGL2 until
  6 s later: 4.9–5.8 s by the poller, which reads about twice a second, in every
  case that sets it.

### 3.4 The start as a player sees it

From the landing page, Play pressed, to the game's first frame, with the
landing's query carried onto the game route. **Cold** is the first load in a
fresh browser context, with an empty HTTP cache; **warm** is the next load in
the same context. The browser's GPU shader cache is shared across contexts, so
a first start on a new machine is colder than this.

| path | cold | warm | what was on screen |
| --- | --- | --- | --- |
| WebGL2 | 1.1 s | 2.7 s | the Play button reading "Loading…", then the game; the page's main thread is busy building the game in between, so nothing can paint |
| WebGPU as built | 12.3 s, on WebGL2 | 11.4 s, on WebGL2 | the button's "Loading…" for tens of milliseconds, then the HUD's "Loading…" over the game's canvas for 10 s (§3.2), then the game on WebGL2 |
| WebGPU, loaders in order | 1.37 s | 1.28 s | the button's "Loading…", then the HUD's from 44 ms (cold) and 16 ms (warm) until the first WebGPU frame |

No sample between the press and the first frame, taken every 50 ms, showed a
canvas without "Loading…" on it or the landing behind it. A game URL opened
directly shows the HUD's "Loading…" from its first paint, half a second in,
until the game. On WebGPU the game then meets §3.3's faults and falls back,
until Task 2 lands.

### 3.5 The bundle and the translators

From a production build of the branch at `445f8f6` against `main`
(`vite build`, the same dependencies and assets): the statically loaded bytes
grow by **9,190 B** (5,937 B at gzip −9), 2,318,284 B to 2,327,474 B. Loaded
only on the WebGPU path: the engine's chunk `gpuEngine-*.js`, 245,559 B (60,647
at gzip; 246,324 B at `bd3b1ae`), `glslang.wasm` 943,680 B, `twgsl.wasm`
1,702,916 B, and their loaders, 16,030 and 74,555 B.

The two `.wasm` files are served as `application/wasm` by the dev server and by
the production build served locally, and begin with the WebAssembly magic
bytes. The live host serves the `.wasm` files it already has (the texture
decoders under `libs/ktx2/`) as `application/wasm`; the translators are not
deployed yet, and the deploy check (`tools/deploy/verify.mjs`) fetches them
and checks their type once they are.

### 3.6 Verdict

| bar | result |
| --- | --- |
| switched off, WebGL2 at the canopy pose within the same-code floor of `main` | **met**: −0.02 ms against floors of +0.09 and −0.08 |
| zero console errors on WebGL2 pages | **met** |
| every failure ends on WebGL2 (§13.6 1–8 as built) | **met**, each path as the design lists it |
| the HUD line, the record, the reload onto `engine=webgl2`, no second reload | **met** |
| zero console errors apart from the forced faults | **not met**: the unhandled rejection of §3.2 on every WebGPU start, Babylon's recovery throwing after a lost device, and, before `15d187f`, the dropped translation failure |
| the WebGPU engine starts where the GPU fits | **not met**: §3.2, the translator loaders run at once and share one global |

The fallback does what the design says in every case, including the one it was
not written for: the WebGPU start as built fails on the translators' loaders,
and ends on WebGL2 after its 10 s budget. That failure is a defect of the start,
not of the GPU, and it must be fixed before the switch can be turned on, since
it would otherwise be remembered as a GPU failure for 30 days. Task 2's gates
start from WebGPU actually starting.

## 4. The required limits, measured

Task 2 Step 7 (2D). Read on 2026-09-27 over 13 WebGPU pages, 7 on the high
tier and 6 on medium: mist, clear, rain with the lamp on, and the eerie
weather at 21 h with the lamp on; every pose of design §7.1 and the spawn
view; the trailhead with the five rangers in view, every lamp of a full party
lit (seven lights bound, the game's cap), and the Hollow; the kiosk with its
poster, the car, the summit body and a fingerpost; then the compile sweep of
Step 8. Every pipeline the engine made was counted, 1,603 in all (98–142 a
page), and replayed on a second device at chosen limits, so each verdict is
the browser's own. The reference adapter is an Apple M4 (Metal, not a
fallback) in Chrome 154.

| limit | WebGPU default | required | set by (tier) | reference adapter |
| --- | --- | --- | --- | --- |
| `maxInterStageShaderVariables` | 16 | **19** | the giant trees' faded material (`material1` of the fir and of the pine, one effect): 18 vertex outputs, and 18 fragment inputs with `front_facing` (both tiers), the one pipeline that sets it | 28 |
| `maxVertexBuffers` | 8 | 8, the default | 7: the duff clumps, the giant fir's `material1` at every level of detail, the fern, the meadow's clutter and the grass (both tiers) | 8 |
| `maxSampledTexturesPerShaderStage` | 16 | 16, the default | 16: the terrain's fragment stage on the clipmap rings (both tiers); next, 8 | not read |
| `maxSamplersPerShaderStage` | 16 | 16, the default | 16: the same | not read |
| `maxUniformBuffersPerShaderStage` | 12 | 12, the default | 12: both stages of every lit PBR material with seven lights bound (the terrain, the duff, the kiosk, the car, the trees); 8 with three | not read |

**Inter-stage variables.** At 19, with every other limit at WebGPU's default,
no pipeline on any of the 13 pages fails. At 18 the trees' faded material
fails on both tiers:
`Total fragment input variables count (19 = 18 (user-defined) + 1 (front_facing) exceeds the maximum (18).`
The halation's blur failed there too on high, but only in the replay: it
sizes its taps from the device's own limit, so the page, built on a device of
19, made a blur for 19, and the replay made that pipeline on a device of 18. A
page whose device offers 18 builds a blur that fits. The faded material alone
sets 19.
At the defaults the trees' other material (`material0`, 17 vertex outputs, and
17 fragment inputs with `front_facing`) fails too. So the fragment stage's 18
inputs with `front_facing`, which the design inferred from Babylon's
processing, is now measured, and it is what sets 19. The browser counts a
fragment stage's user-defined inputs with its `front_facing`, `sample_index`
and `sample_mask` (neither of the last two appears), and a vertex stage's
user-defined outputs, one more only for point-list topology, which no pipeline
uses; the position is not counted. §6.1's reading of 18 was the vertex stage
alone: validation stops at the first stage that fails.

**No margin.** Three limits sit exactly at WebGPU's default: one more texture
or sampler on the terrain, or an eighth light, fails the pipeline on every
adapter. `WEBGPU_REQUIRED_LIMITS` names all five at the values above, so the
device request and the adapter check list the scene's whole need;
`interStage.test.ts` and `stageBindings.test.ts` count, from what the suite
can build, the trees' varyings, the terrain's textures and samplers and the
lights bound, and fail when any grows.

**The rest.** Every other limit the scene touches is below its default: one
texture and one sampler in the vertex stage (skinning), no storage buffer or
storage texture, two bind groups, one colour target, 10 vertex attributes
(16), an array stride of 68 bytes (2048), a largest 2D texture of 2560 (8192)
and 6 array layers (256), a largest buffer of 6 MiB, a uniform binding of
3312 B (64 KiB), and no compute pipeline.

**At exactly these limits.** Two more pages had the device made with
`{ maxInterStageShaderVariables: 19, maxVertexBuffers: 8 }` and every other
limit at the default (read back 19, 8, 16, 16 and 12): high in mist (147
pipelines, 142 effects) and medium in the eerie weather at 21 h with the lamp
on (119 pipelines, 127 effects). Both stayed on WebGPU throughout, with no
GPU error, no effect error, no console warning or error, no unhandled
rejection and no stored record; their compile sweeps ran 319 and 318 jobs
with no failure.

Whether an adapter on Windows offers 19 inter-stage variables was not read.

## 6. The trail bed

Read on 2026-09-27 at `785825e`, the method of §1 with three differences:
Chrome 154 (154.0.8037.58); every page in a fresh isolated browser context
with a recorder injected before the page's scripts (the first frame is the
first animation frame at which the engine's frame counter is above 0, in ms
from navigation); and one diagnostic injection on every WebGPU page read
after §6.1, named there. The stills are 1200 × 2029 at device pixel ratio 1,
the pose `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` set about 20 s after
navigation and the still taken at about 24.5 s, each on its own fresh page.
The sun at every still: direction (0, −0.9701, 0.2425), intensity 0.7508 in
mist and 3.9518 in clear, equal within each pair. The stills stay outside the
repository; the numbers are here. The run read the engine's start first and
met the fern and the shrub on the way; both are recorded ahead of the bed.

### 6.1 The engine starts, and stays on no load

`&engine=webgpu`, 25 s a load, a fresh context each, no pose. The WebGL2
controls (high 2217 ms, medium 2044 ms to the first frame) log no warning or
error and store no record.

| load | first frame on WebGPU (ms) | first GPU error (ms) | ended on | record stored |
| --- | --- | --- | --- | --- |
| high 1–6 | 2163, 2427, 2369, 2238, 2233, 3390 | 10916, 14938, 13741, 13400, 12777, 20733 | WebGL2 | `pipeline` |
| medium 1–3 | 2098, 2105, 2628 | 12260, 11699, 14469 | WebGL2 | `pipeline` |

With six earlier high loads and one diagnostic load of the same outcome, 13 of
13 high and 3 of 3 medium loads started WebGPU (first frame 2.1–3.4 s) and
none stayed: 10.9–20.7 s in, a pipeline failed validation, the record
`{"reason":"pipeline","browser":154,"babylon":"9.18.0",…,"losses":0}` was
stored, and the page ended on WebGL2. The two messages, each twice per load
(once in Babylon's log and once in the browser's):

- `Total fragment input variables count (18 = 17 (user-defined) + 1 (front_facing) exceeds the maximum (17).`
- `Vertex output variable "<retval>.vFadeDist_1" has a location (17) that is too large. It should be less than (17).` and `Total vertex output variables count (18 = 18 (user-defined)) exceeds the maximum (17).`

The device is made with exactly 17 inter-stage variables
(`WEBGPU_REQUIRED_LIMITS`). The adapter (Apple M4, `metal-3`, not a fallback)
offers 28. On one page whose device was asked for the adapter's 28 by an
injection (the build unchanged), WebGPU ran 30 s with no warning and no record,
and the locations Babylon gave each compiled effect were read back:

| effect | locations | reads `front_facing` | drawn by |
| --- | --- | --- | --- |
| PBR with the foliage plugin | 17 | yes | the giant fir's and the giant pine's second primitive (`material0`) |
| PBR with the foliage and distance-fade plugins | 18 (the 18th `vFadeDist`) | yes | their first primitive (`material1`) |
| `kernelBlur` | 18 | not read | the halation's two blurs (high tier) |

So the giant fir and the giant pine, which come into the drawn set 10–20 s
after the load, need 18 here; the halation's blur counts 18 as well (whether it
fails at 17 was not seen: the page had fallen back by then). §4 measures the
fragment stage as well: 18 inputs with `front_facing`, so 19. No effect of the
fern, the shrub or the terrain is over 16. Every WebGPU page read after this
carries that injection (the device at 28), so it stays on WebGPU.

### 6.2 The fern and the shrub

High tier, the canopy page at 24 s. The enabled `understory.fern.node0` (51
thin instances) and `understory.shrub.node0` (71) have their own materials and
share one effect on both engines. Their UV buffers, made by the glTF loader,
are interleaved in a 48-byte stride, the fern's at byte offset 24 and the
shrub's at 12, and both carry the vertex-buffer hash 196630. Babylon's WebGPU
pipeline cache keys an attribute by that hash, not by its offset (Appendix A),
so the pipeline built first fixes the offset for both.

At the pose `__fcSet(130.66, 113.2, -144.14, -0.82, 0.35)` (a fern instance at
(128.22, 110.00, −137.95) and a shrub at (124.31, 109.83, −142.14), the shrub in
view), the shrub's leaf cover in its crown (crop `330:180:300:320`, pixels of
sRGB luma under 80, less the same crop with the shrub hidden, 0.1261–0.1265):

| page | leaf cover |
| --- | --- |
| WebGL2, both drawn | 0.058 |
| WebGL2, the fern hidden | 0.058 (ΔE 0.01 on the shrub) |
| WebGPU, both drawn | **0.016** |
| WebGPU, the fern hidden | 0.059 |

On WebGPU the shrub is drawn with the fern's pipeline and reads its UVs 12
bytes too far into each vertex: mis-cut slivers of the wrong part of the atlas.
Hidden from the start, the fern cannot build the pipeline first, and the shrub
is right. The same plant at the canopy pose's left edge (`60:500:150:180`) is
mis-cut the same way.

### 6.3 The crops

Literals, `x:y:w:h` in the still's pixels:

- **bed** `830:770:150:90`: the bed beyond the near stretch, clear of grass
  tufts on both engines;
- **bed_near** `1000:930:150:90`: the nearer stretch of the same bed;
- **sky** `1020:180:100:60`: the top of the frame, which at this pose is fogged
  canopy, the brightest and least varied block of the top 240 rows;
- **haze** `750:490:40:40`: the most even haze between the trunks;
- and the design's **near** `280:500:420:970` and **mid** `220:22:400:678`.

The bed crop sits roughly 10–20 m out by eye; the terrain is displaced on the
GPU and does not pick, so the design's 4–12 m could not be measured.

### 6.4 The numbers, per tier and engine

(a) as is; (b) the environment's intensity 0, the scene's environment and every
material's reflection texture null; (c) clear weather. Luminance Y and CIELAB
of each crop's mean linear RGB; the WebGL2 floor from two loads of (a) is
ΔE ≤ 0.02 on the bed (luminance ratio 0.999–1.000) and ΔE ≤ 0.09 on the sky.

| high | bed Y (L*, a*, b*) | bed_near Y | sky Y | haze Y |
| --- | --- | --- | --- | --- |
| WebGL2 (a) | 0.08546 (35.09, 4.79, −0.00) | 0.08644 | 0.13671 | 0.22403 |
| WebGPU (a) | 0.04159 (24.19, 2.57, −5.00) | 0.10560 | 0.14403 | 0.22504 |
| WebGL2 (b) | 0.03230 (20.94, 8.06, 6.14) | 0.04414 | 0.13649 | 0.22389 |
| WebGPU (b) | 0.00293 (2.64, 0.42, −0.16) | 0.03793 | 0.13507 | 0.22403 |
| WebGL2 (c) | 0.01037 (9.29, 1.87, 4.47) | 0.02538 | 0.01669 | 0.00395 |
| WebGPU (c) | 0.00631 (5.70, 0.07, −12.57) | 0.06765 | 0.03570 | 0.00561 |

| WebGPU against WebGL2, luminance ratio / ΔE | bed | bed_near | sky | haze |
| --- | --- | --- | --- | --- |
| high (a) | 0.487 / 12.2 | 1.222 / 3.75 | 1.054 / 1.51 | 1.005 / 0.15 |
| high (b) | 0.091 / 20.8 | 0.859 / 2.09 | 0.990 / 0.21 | 1.001 / 0.02 |
| high (c) | 0.609 / 17.5 | 2.666 / 16.5 | 2.139 / 9.47 | 1.420 / 3.25 |
| medium (a) | 0.485 / 12.25 | 1.223 / 3.76 | 1.054 / 1.52 | 1.005 / 0.19 |
| medium (b) | 0.090 / 20.9 | 0.859 / 2.08 | 0.967 / 0.74 | 1.001 / 0.02 |
| medium (c) | 0.578 / 18.0 | 2.886 / 17.05 | 2.169 / 9.60 | 1.405 / 3.25 |

In (a) the two tiers agree to within 0.01 in every ratio. In (b) they agree
but for the sky, 0.990 on high against 0.967 on medium. In (c) they part
further: the bed 0.609 against 0.578, the near bed 2.666 against 2.886, the sky
2.139 against 2.169 and the haze 1.420 against 1.405. The bed's gap is of the
same kind and size on both tiers, so the medium tier's probe, shadow and grade
pass neither cause it nor close it. On WebGPU the bed goes black beyond a
sharp, stepped edge some metres out, with a pale band toward the crest; nearer
than the edge it is the right warm brown, and the ground beside it, under the
same material, matches WebGL2.

### 6.5 The branch of the ladder taken, and what was ruled out

(b) does not close the gap: it widens it (WebGPU's bed goes to L* 2.6, black,
where WebGL2's keeps its brown). So the ladder's second branch: the uncommitted
patch of Task 5 Step 1, the bed's `surfaceAlbedo` replaced by the snow mix, the
wetness and the canopy weight as three channels, and
`WebGPUCacheRenderPipeline.LogErrorIfNoVertexBuffer` set. The three channels
agree between the engines within the lighting difference seen elsewhere (bed
luminance ratio 1.13, near bed 1.34), with no stepped edge; no missing vertex
buffer is reported. Ruled out: **the snow mix, the wetness, the weights
attribute and a missing vertex buffer**. The black is made inside the bed's
own colour. Read back on both engines at the canopy pose in mist: **the
probe's six faces** are identical at levels 0 and 1 to the second decimal, and
within 0.7 of 255 at levels 3 and 5 (each engine's own mip filter); **the BRDF
lookup** is equal to half-float precision (means 0.07, 0.83, 0.29, 1.00). The
terrain material's defines are the same on both.

### 6.6 The two causes, as found

**The ground's texture arrays have mips on layer 0 only, on WebGPU.** Read
back, per layer and level: on WebGL2 every layer of `terrainRAH` and
`terrainNormals` (512², 6 layers, 10 levels, RGBA8) is populated at every
level; on WebGPU layer 0 is, and layers 1–5 are populated at level 0 and
**zero at every coarser level**, alpha included. Babylon 9.18's WebGPU mip
generation for a `RawTexture2DArray` renders the chain of layer 0 alone. The
bed's colour is multiplied by an occlusion factor read from layers 4 (pebble)
and 1 (floor) of `terrainRAH` (`trailPaint.ts`); once the bed is drawn from a
coarser level the factor reads 0, and the bed goes black: black with the
environment off, the environment's cool grey on black in (a), the sky's blue in
(c), the stepped edge at the level-0/level-1 boundary. Generating the missing
layers' mips on the page with the engine's own mip pass brings the bed back in
kind (warm brown, continuous to the crest, no edge): bed 1.29×, ΔE 4.95.

**The rest of the frame is brighter on WebGPU: the probe's spherical harmonics
on WebGPU only.** With the environment off, the near and mid crops match to
ΔE ≤ 0.07 on both tiers; with it, they read 1.23× / 1.07× in mist and 1.38× /
1.99× in clear. The probe cube's harmonics are computed on WebGPU
(`preScaledHarmonics.l00` = (0.26736, 0.28445, 0.31118), every other band 0)
and undefined on WebGL2, where `BaseTexture.sphericalPolynomial` is Babylon's
stub getter: the WebGPU module imports `pbrBaseMaterial.js`, the non-pure
module, which registers the real getter; every other file imports modules that
do not.

Both corrected on the page, without a build edit (the missing mips generated,
and the computed harmonics zeroed, which is what WebGL2 binds), against the
WebGL2 stills, luminance ratio / ΔE:

| still | bed | bed_near | sky | haze | near | mid |
| --- | --- | --- | --- | --- | --- | --- |
| high, mist, as is | 0.487 / 12.2 | 1.222 / 3.75 | 1.054 / 1.51 | 1.005 / 0.15 | 1.231 / 3.07 | 1.068 / 1.44 |
| high, mist, mips only | 1.291 / 4.95 | 1.351 / 5.82 | 1.032 / 1.27 | 1.005 / 0.16 | 1.239 / 3.18 | 1.069 / 1.47 |
| high, mist, harmonics only | 0.472 / 12.63 | 0.921 / 1.68 | 1.000 / 0.01 | 0.999 / 0.02 | 1.000 / 0.06 | 1.001 / 0.03 |
| **high, mist, both** | **1.000 / 0.01** | **1.000 / 0.01** | **0.999 / 0.03** | **1.000 / 0.01** | **1.001 / 0.01** | **1.000 / 0.01** |
| high, clear, as is | 0.609 / 17.51 | 2.666 / 16.51 | 2.139 / 9.47 | 1.420 / 3.25 | 1.378 / 7.57 | 1.991 / 9.49 |
| **high, clear, both** | **1.002 / 0.05** | **0.978 / 0.29** | **0.971 / 0.29** | **1.030 / 0.15** | **0.999 / 0.02** | **1.002 / 0.01** |
| medium, mist, as is | 0.485 / 12.25 | 1.223 / 3.76 | 1.054 / 1.52 | 1.005 / 0.19 | 1.236 / 3.16 | 1.068 / 1.45 |
| **medium, mist, both** | **1.000 / 0.00** | **1.000 / 0.01** | **1.000 / 0.01** | **1.001 / 0.03** | **1.001 / 0.01** | **1.001 / 0.01** |

With both corrected, the WebGPU frame is the WebGL2 frame within the
same-engine floor on both tiers in mist, and within ΔE 0.3 in clear.

### 6.7 What follows

The four findings (the inter-stage limit, the loader's buffers, the arrays'
mips, the harmonics) are fixed on the WebGPU path in the commits after this
note. None of the fixes has yet been read in a browser: the start's hold, the
shrub, the bed and the frame's brightness are to be read again on the fixed
build, and appended here.

## 7. The second machine: Windows, an NVIDIA Tesla T4

Read on 2026-09-28 at `a63e5c2`, with the measurement patches of §1, on a
rented machine: Windows Server 2025, an NVIDIA Tesla T4, a 1920 × 1080 desktop
at device pixel ratio 1 (the window 1920 × 945), 4 logical cores
(`navigator.hardwareConcurrency`), nobody at its screen. Chrome 154.0.8037.58,
driven remotely; WebGL2 through ANGLE on Direct3D 11, WebGPU through Direct3D
12. The build was served by the dev server on the machine itself. Every page
opened in a fresh isolated browser context with the recorder injected before
the page's scripts, and every reading after the first 12 loads carries its
proof of place: the user agent (`Windows NT`), the WebGL renderer
(`ANGLE (NVIDIA, NVIDIA Tesla T4 (0x00001EB8) Direct3D11 …)`) and, on WebGPU,
the running engine's adapter (`nvidia`, `turing`).

### 7.1 WebGPU starts, and stays

19 loads, each read to 60 s: 15 on WebGPU (`?engine=webgpu`; 10 high, 5
medium) and 4 WebGL2 controls (2 a tier).

- **WebGPU at the first frame and at 60 s on 15 of 15**, in the same document
  and at the same address throughout; no record stored; no error and no warning
  beyond the page's usual lines. The first frame came 7.9–9.8 s after
  navigation. The engine at 60 s was WebGPU on all 15, but on three of them
  the page was not yet drawing at the display's rate: 1.4 and 1.5 frames a
  second on the first two high loads, still in the slow start of §7.2, and 21.4
  on the eighth; the other twelve read 59.8–60.2. (The reference Mac on `785825e`, asking for 17 inter-stage
  variables: 16 of 16 fell back with `pipeline`.)
- The WebGL2 controls: WebGL2 throughout, first frame 7.6–7.7 s, 60 frames a
  second at 60 s.
- Chrome on Windows warns, on every page that asks for an adapter, that
  `powerPreference` is ignored there (crbug.com/369219127).
- The adapter (`requestAdapter({ powerPreference: "high-performance" })`):
  vendor `nvidia`, architecture `turing`, not a fallback. Its limits for the
  five the build names, and what the device was made with:

  | limit | adapter | device |
  | --- | --- | --- |
  | `maxInterStageShaderVariables` | 28 | 19 |
  | `maxVertexBuffers` | 8 | 8 |
  | `maxSampledTexturesPerShaderStage` | 48 | 16 |
  | `maxSamplersPerShaderStage` | 16 | 16 |
  | `maxUniformBuffersPerShaderStage` | 12 | 12 |

  Samplers and uniform buffers per stage are at the scene's measured need
  (§4) on this adapter too, as on the Apple M4: they cannot be raised on
  either machine.

### 7.2 The start-up

High tier, the canopy page without a pose, 75 s a load; each engine loaded
twice in one browser context (cold, then the same page again), with a
per-second timeline from navigation: animation frames, the engine's frames,
long tasks, WebGPU `createShaderModule` and `createRenderPipeline` calls, the
engine's effect preparations and the time each took to settle, WebGL shader
compiles and program links.

| load | first frame | first second at the display's rate (60) | frames drawn in 0–50 s | effect preparations (0–57 s) | their summed time | long tasks (0–57 s) | shader modules / render pipelines | WebGL compiles / links |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU cold | 8013 ms | 57 s | 135 | 61 | 39.8 s | 49.0 s | 134 / 70 | – |
| WebGPU second | 8014 ms | 52 s | 100 | 55 | 35.4 s | 44.1 s | 118 / 65 | – |
| WebGL2 cold | 7602 ms | 17 s | 2159 | 60 | 0.28 s | 8.9 s | – | 124 / 62 |
| WebGL2 second | 7700 ms | 17 s | 2141 | 61 | 0.21 s | 9.0 s | – | 126 / 63 |

- On WebGPU each effect's preparation (Babylon's GLSL through glslang to
  SPIR-V and through Tint to WGSL, in WebAssembly on the page's thread) took
  0.7–2.0 s, one effect after another, about one a second: long tasks of
  700–1250 ms back to back from 13 s to 52 s, 40 of them over 400 ms. The page
  drew about one frame per long task, 1–2 frames a second, from about 11 s to
  about 50 s, then 60 once the last effect of the view was prepared. The
  render pipelines themselves returned at once (65–70 a load). Effects seen
  later cost the same: at 71–74 s on the cold load a few more came in and the
  page fell to 1–25 frames a second for 3 s.
- WebGL2 prepared the same 60 or so effects in 0.2–0.3 s in all (the context
  offers `KHR_parallel_shader_compile`) and was at 60 from 17 s.
- The first frame, the same on both engines, is set by the world's build (a
  long task of about 4.8 s at 1.6–6.5 s, and one of 1.1–1.2 s). The network
  is not part of it: the page's `load` fired at 1.5–1.6 s, its own resources
  were in by about 0.6 s and the rest of the assets by about 10 s, cold and
  second load alike. The second load of the same page was no faster.
- The Mac never saw this: its WebGPU first frames were 2.1–3.4 s and its pages
  were at 60 by 20–25 s. On this machine a WebGPU player sees about 40 s of
  1–2 frames a second after the first frame, where WebGL2 is at 60 by 17 s,
  and each material seen for the first time in play holds the page for about
  a second.

### 7.3 The four fixes, read again

- **The shrub** (§6.2): its UV buffer is keyed apart from the other plants'
  (`uv` 196630 + 12 × 2^24 against + 24 × 2^24); the shadow pass's group
  (the car, the kiosk's poster, the summit body) is keyed apart and drawn with
  the same shadows on both engines. At the `pair3` pose the shrub is the same
  whole plant on both engines. Its leaf cover in the crown crop read 0.0593 on
  WebGPU against 0.0513 and 0.0499 on two WebGL2 loads, 0.008 over, where two
  WebGL2 loads differ by 0.0014: **a miss of the number**, whose bar is 0.003.
  It is accepted as the same picture on the silhouette count: the leaves sway
  between stills, and on the WebGPU still two lie over the fog where on the
  WebGL2 stills they lie over a trunk, which the leaf-cover count (luma under
  80) cannot see. The silhouette count (pixels 12 or more of luma from the
  shrub hidden), which sees leaves over the trunk too, reads 0.0880 on WebGPU,
  between WebGL2's 0.0836 and 0.0886.
- **The bed's arrays** (§6.6): every layer of `terrainRAH` and
  `terrainNormals` read back at mip 1 (centre texel and mean) and mip 9 is
  identical on the two engines on this machine; no layer reads zeros; the
  texture has 10 levels.
- **The brightness**: `sphericalPolynomial` undefined on both engines' probe.
- **The registrations**: no Babylon audio engine on either engine, and
  `EngineStore.FallbackTexture` the empty default on both.
- 70 pipelines at the canopy pose at about 78 s (73 made by the device, 3 of
  them outside the cache), as on the Mac.

### 7.4 Parity, a first reading

A first reading on a second machine, not the frame and parity gates on the
reference machine. Stills of 1920 × 945, each on its own page 75–83 s after
navigation (both engines at 60 by then), the pose set by the free camera, the
sun recorded beside each and equal within every pair (mist 0.7508, clear
3.9518, direction (0, −0.9701, 0.2425)); crops placed afresh on this frame, and
every pose also scored on a 3 × 3 grid. The bar is §7.3's of the design
(luminance ratio 0.95–1.05 or twice the floor's; ΔE ≤ 2 or twice the floor's).

- **The same picture within the floor**: the canopy pose in mist on both tiers
  (every crop; the bed 1.0051 / ΔE 0.10 against a WebGL2 floor of 1.0047 /
  0.09 at high; warm brown to the crest, no stepped edge, no glint), the
  meadow, the meadow's trail, the trail down, the night pose, on both tiers.
  The face at 30 m: the same rock and cliff modules (within 0.2 %); the one or
  two grid cells that miss hold animals crossing the WebGL2 stills only.
- **Where the canopy's sun-dapple falls**: in clear weather at the canopy pose,
  and at the trail-along and seam poses, the bed crops read 3–7 % apart
  (ΔE ≤ 1.12), the medium tier's canopy bed 0.950 and its near bed 0.933, just
  outside the bar. Two WebGL2 loads put the dapple in the same place (within
  0.8 %) and two WebGPU loads agree with each other as closely; the two engines
  put it in different places. Nothing static differs.
- Everything that moves with the world's clock (the canopy's sway and its
  dapple, the shrub's leaves, the animals) differs between the engines at the
  same time after load; the animals' positions read on a pair of pages at the
  face pose differ, the WebGPU page having drawn 1703 frames to WebGL2's 4163.
  The slow start of §7.2 would put a WebGPU page's world clock behind if each
  frame's step is clamped; the world clock itself was not read. Stills of
  moving things are to be compared at the same world time.

### 7.5 The fallback

- **An uncaptured error** in a solo hike: rebuilt on WebGL2 with no reload,
  the record `pipeline`, the address pinned to `engine=webgl2`, the line once,
  the pose kept. **Met.** The cover stood 19.0 s: 8.9 s to the WebGL2 engine,
  10.1 s for its scene.
- **The same with a follower**: the follower never showed "Reconnecting…",
  and saw the host move again after the swap. **Met.** After the swap the host
  was in the pause menu with its pointer lock gone (the canvas that held the
  lock was replaced) and had to press Resume.
- **A lost device, twice**: one retry on a new WebGPU engine on a fresh canvas,
  two devices made in all, the second loss onto WebGL2 with the record `lost`
  (losses 2) and the address pinned; the lines once each. **Met.**
- **An error during a Settings Apply under way**: at most two engines, the
  cover and the line once, the record `pipeline`. **Met.** An error on the old
  engine while the new one is made could not be produced: the page's thread
  does not run between the click and the old engine's release.
- **A Settings Apply that crosses engines**: not as written, since the address
  must carry `?engine=webgpu` with the switch off, which puts every tier on
  WebGPU. High → Low built Low on WebGPU, which failed (defect 1 below); Low →
  Medium then stayed on WebGL2, as the record says.
- **The governor on WebGPU at medium**: not run. This machine's class
  (`discrete-legacy`) is Auto at low with no probe, so Auto is never at medium
  here.
- **A failure's rebuild whose WebGPU retry fails**: WebGL2, the line once, the
  record `init`. The line **met**; defects 2 and 3 below.
- **`?tier=high` on the title page, then Play**: the hike at high. **Met.**

### 7.6 Three defects, as found

1. **The low tier fails on WebGPU.** `?tier=low&engine=webgpu`: the first
   frame on WebGPU at 7.8 s; at frame 26 (13.2 s)
   `Error while parsing WGSL: :3240:30 error: 'textureSample' must only be called from uniform control flow`
   on `textureSample(terrainRAHTexture, terrainRAHSampler, …)`, with the notes
   `if ((x_3915 < (7.0f + x_3917))) {` and
   `:3146:9 note: return value of 'fwidth' may be non-uniform`; the pipeline
   invalid, the page on WebGL2 at 60 s, the record `pipeline`. Every WebGPU
   load at low fails. High and medium pass because Babylon's cascaded-shadow
   include defines `DISABLE_UNIFORMITY_ANALYSIS`, which turns the analysis off
   for the whole module; low has no shadow.
2. **A half-made engine left behind.** After a lost device whose one retry
   failed (the device request refused), `EngineStore.Instances` held two
   engines to the end of the hike: the running WebGL2 engine, and the retry's
   `WebGPUEngine`, disposed, with no device, its canvas detached, no scene.
3. **The address not pinned.** On that same path the record is `init` and the
   address still says `engine=webgpu`, so a reload asks for WebGPU again and
   fails its start once more before WebGL2; after a pipeline error or a second
   lost device the address is pinned to `engine=webgl2`.

## 8. The default, switched on where it was measured faster

As of 2026-09-28 WebGPU is the default engine on the high tier, in Google
Chrome or Microsoft Edge on macOS or Windows on a device that is not a phone
or a tablet, where no failure is remembered and the adapter fits
(`chooseEngine`, `engineChoice.ts`; the design, §5.1). Everywhere else the
game draws with WebGL2, as before. These are the figures that decided it.

**Frame time.** Mean frame time on an Apple M4 at 1920 × 1080 in Chrome 154,
WebGL2 → WebGPU:

| pose | high tier | medium tier |
| --- | --- | --- |
| canopy | 24.2 → 20.9 ms | 19.2 → 19.3 ms |
| meadow | 19.5 → 17.1 ms | 17.3 → 16.7 ms (at the display's cap) |
| trailside | 21.6 → 19.6 ms | not measured |
| night | 23.6 → 20.1 ms | not measured |
| canopy at 4 × the pixels | 51.0 → 40.1 ms | not measured |

The high tier is faster on WebGPU at every pose that is not at the display's
cap. The medium tier is not faster under the canopy, and its meadow reading
sits at the display's cap, where a gain cannot show: medium stays on WebGL2.

**A first visit.** On the high tier, the time from opening the page to
drawing at the full frame rate:

| machine and browser | WebGPU | WebGL2 |
| --- | --- | --- |
| an Apple M4, Chrome on macOS | 4 to 6 s | 4 to 6 s |
| a Windows machine with an NVIDIA T4 and 4 virtual CPUs, Chrome on Windows | 18 to 21 s | 28 s |

**What was not measured.**

- **Other browsers.** Only Chrome. Edge was not measured: it is on the
  WebGPU default as the same engine as Chrome. The desktop launcher, an
  Electron build of Chromium, was not measured and stays on WebGL2 at every
  tier, as do Brave, Opera, Vivaldi and the other browsers built on Chromium
  that are neither Chrome nor Edge. Safari and Firefox were not measured, and
  the rule keeps them on WebGL2.
- **Other platforms.** Only macOS and Windows. Linux, ChromeOS, Android and
  iOS were not measured, and the rule keeps them on WebGL2.
- **The medium tier** beyond the canopy and the meadow.
- **A party.** Every reading is of one player alone; a hike with other
  players drawn was not measured on either engine.

## Appendix A. The pipeline-cache bug, as a draft issue

Design Appendix A's text, kept here with the gates that concern it. It is a
draft for the Babylon.js issue tracker; nothing here files it, and its
reproduction has not yet been run in a browser.

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
