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
