# Quality tier detection: design

**As built.** All of it, on WebGL2; the sections below are the design as
written on 2026-09-26 against `main` at `ba0fd95`, amended where the build or
a browser reading moved it. The tier is chosen from the GPU the browser names:
thirteen classes (`gpuClass.ts`), each with a start tier, a ceiling and whether
it is probed; the reference machine's `apple-base` starts and stays at medium.
Where the GPU cannot be named, a probe before the first hike renders the canopy
pose behind "Setting up graphics…": 60 frames discarded and 120 measured, a
tier holding at a mean of at most 17.5 ms, a step ending early as a miss once
its frames pass 2,100 ms or more than 20 of them stall (and its warm-up bounded
by the same 2,100 ms), 15 s for a step to be ready or less where the cap leaves
less, 30 s for the whole probe, three attempts, a miss kept when the cap cuts
the next step, its attempt still counted. The probe is skipped where WebGL2
links every shader on the page's thread (Firefox), and where the page draws
below 60 Hz. Its verdict holds 30 days, while the window is at most 1.5 times
the one measured. The governor, on Auto only, drops one tier after three 10 s
windows over 20.8 ms following 30 s of play, remembered for 7 days, with one
HUD line for 6 s. The player chooses Auto, High, Medium or Low from one
drop-down on the title's and the pause screen's Settings; a choice made
mid-hike is applied live, the renderer rebuilt on a fresh canvas behind a
cover that lifts when the new scene and its forest are ready, or at a bound
counted from the end of the new renderer's build: 20 s for Apply, 10 s for a
governor's drop (§9.6). `?tier=` overrides everything and `?probe=` forces a
probe, on the machine whose address carries them: a lobby host's announced
route goes out without them, and a follower drops them from a route it is sent
to. The older rule from cores and memory (`tierFor`, `detectTier`) is kept as
the tier of a renderer given none (§6.3).

Day Hike picks a quality tier once, when the renderer is made, from the number
of logical cores and the memory the browser reports. Neither says anything about
the GPU, which is what the tier spends, and the browsers now report them in ways
that put the same machine on three different tiers: a desktop Chrome from
version 147 on reports memory up to 32 GB, which sends every machine with more
than eight threads and 16 GB to **high** whatever its GPU (the reference machine
qualifies, and its high-tier frame at the canopy pose is 24 ms); a Chrome before
147 never reports more than 8 GB and so never reaches high; Safari and Firefox
report no memory at all, read the default of 4 GB, and put every Mac and every
Firefox player on **low**, with no blades, no litter, no shadows and a 0.6
radius scale. The comment above the rule says the player can override it, and
nothing lets them: there is no setting, and the `?tier=` override every
rendering note used was an uncommitted patch.

The goal is one sentence: **start every player on the highest tier their GPU
holds at 60 Hz, confirm it with the frame where the GPU cannot be named, let
the player see and change it, and apply a change without leaving the hike.**

Renderer-side only. No `sim/` change, no level-id move (`passHash` stays
−311867473), no protocol change (`PROTOCOL_VERSION` stays 5), no asset change.
Peers on different tiers share one world (§11).

## 1. Decisions

| question | decision |
| --- | --- |
| The signals | One function, `gatherSignals` (`gpuSignals.ts`), reads the WebGL renderer string (`RENDERER`, else `UNMASKED_RENDERER_WEBGL`, from a throwaway WebGL2 context it then loses), the high-performance WebGPU adapter's `info` and limits (one `requestAdapter`, shared with the engine rule), the reported cores and memory, and whether the device is mobile. Every one may be missing; the result says which (§5.1) |
| The classes | The signals map to one of thirteen GPU classes by an ordered rule table (`gpuClass.ts`, §5.2): mobile, software, three Apple classes by what the string names, discrete and integrated by vendor and generation, and "unknown" classes where a browser buckets or masks the string. Cores and memory only cap: two or fewer of either caps the tier at low |
| Class to tier | Each class has a **start** tier, a **ceiling**, and whether it is **probed** (§6.1). Named classes go straight to their tier; the unknown ones start one step down and are probed from their ceiling |
| The probe | Only for a probed class with no valid verdict, before the game is built: the standard canopy pose (seed `atmo`, mist, noon) rendered behind a "Setting up graphics…" screen on the player's own window, at the ceiling, 60 frames discarded and 120 measured after the scene is ready; the tier **holds** when the mean frame interval is ≤ **17.5 ms**; a miss at high measures medium once, a miss at medium settles on low. Bounded at 30 s; three attempts per GPU. Skipped where a WebGL2 step would link every shader on the page's thread (§7) |
| The verdict | `localStorage["dayhike.quality.auto"]`: the tier, whether a probe or the governor set it, the GPU it was measured on, the browser major, the window area and the time. Holds for 30 days on the same GPU and browser, a governor verdict for 7; a probe verdict only while the window is at most 1.5 times the area it was measured at (§6.2) |
| The setting | A **Settings** entry on the title screen (Play → Downloads → **Settings** → Credits) and on the pause screen (Resume → **Settings** → Exit), both opening one shared Settings screen: **Auto (Recommended)** (the default), **High**, **Medium**, **Low**, with a line naming what Auto picked. Saved in `localStorage["dayhike.quality"]`; a storage that throws means Auto, and a choice made then lasts the page (§8) |
| Applying it | On the title screen a choice takes effect when Play starts the hike. On the pause screen a choice is applied by **Apply**, live, without a reload: the renderer is disposed and rebuilt on a fresh canvas behind an "Applying…" screen while the session, the data channels, the player's state and the HUD carry on (§9) |
| Overrides | `?tier=low\|medium\|high` wins over everything, for testing, and the Settings screen says so; `?probe=high\|medium` forces a probe from that tier and logs it, for the gate |
| The governor | Auto only. After 30 s, in 10 s windows of frame intervals (any over 250 ms voids its window): three windows in a row with a mean over **20.8 ms** (48 fps) drop the tier one step, once, remembered as a governor verdict for 7 days. Windows holding a paused, hidden, loading, compiling, switching or free-camera frame do not count. Never raises. Applied at once through the live switch, under an opaque screen, at the next steady frame and never after the session ends, unless the page itself draws below 60 Hz; the HUD says so once (§10) |
| Determinism | The tier is read by `game/` only. A test steps one world under renderers on each tier and under none, and finds one serialised state and one `passHash` (§11) |
| Gate | On the reference machine: the probe, forced from high, picks the tier the frame at both standard poses confirms holds 60 Hz, and the class table's own row for the machine agrees; the literal matrix of §6.4 as unit tests; the settings, the live swap and the governor in the browser (§13) |
| Unchanged | What each tier draws (`QUALITY` and every consumer); the landing backdrop's low tier; the WebGPU rule's own conditions; `sim/`; the protocol |

## 2. Goals and non-goals

**Goals.**

- The starting tier follows the GPU, in every browser the game supports, and is
  the same on the second visit as on the first unless the frame says otherwise.
- Where the browser will not name the GPU, a few seconds of the heaviest
  standard view decide, once per machine, before the hike starts.
- No player is kept on a tier their machine cannot hold: a sustained low frame
  rate lowers the next hike's tier by itself.
- The player can see which tier they are on and change it from the title screen
  or mid-hike, and a mid-hike change never drops a co-op session.

**Non-goals.**

- What a tier draws. `QUALITY` (`quality.ts:35–57`) and every tier consumer stay
  as they are; making high cheaper is the grass-frame work's, and making it
  faster the WebGPU work's.
- Which engine a tier gets. The WebGPU rule (`engineChoice.ts` on its branch)
  is applied to whatever tier this design resolves, unchanged.
- Render resolution as its own setting (§15).
- Any change to the landing backdrop, which renders low on every machine.

## 3. What detection does today, and why it fails

### 3.1 The rule

`tierFor` (`quality.ts:74–79`) returns low for a mobile device or `cores <= 4
|| memoryGb <= 4`, medium for `cores <= 8 || memoryGb <= 8`, and high
otherwise. `detectTier` (`renderer.ts:517–526`) feeds it
`navigator.hardwareConcurrency ?? 4`, `navigator.deviceMemory ?? 4` and a user
agent test, `/Mobi|Android|iPhone|iPad/`. `createRenderer` calls it when no
tier is passed (`renderer.ts:690`), and `app.ts:153` passes none. The landing
backdrop passes `{ tier: "low" }` (`landingScene.ts:55`). The tier is read once,
at construction; nothing in the renderer changes it afterwards.

### 3.2 What the browsers report in 2026

| signal | Chrome, Edge, the launcher | Safari | Firefox |
| --- | --- | --- | --- |
| `navigator.deviceMemory` | GiB rounded down to a power of two; from Chrome 147 on the desktop **2, 4, 8, 16 or 32**, before it 0.25–8 [1][2] | not implemented [3] | not implemented [3] |
| `navigator.hardwareConcurrency` | logical cores | clamped to 4 or 8 [4] | logical cores; 2 under `resistFingerprinting` [5] |
| WebGL renderer | `RENDERER` is `WebKit WebGL`; `WEBGL_debug_renderer_info` gives the ANGLE string, e.g. `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)` [6] | `Apple GPU` for every GPU since 2020 [7] | `RENDERER` itself carries a sanitised string, bucketed to a representative model with `, or similar` appended (every Apple GPU reads `Apple M1`, every NVIDIA from the 900 series on `GeForce GTX 980`); the extension is deprecated there [7][8][9] |
| WebGPU adapter `info` | `vendor` and `architecture` filled from Dawn's table (`nvidia`/`ampere`, `intel`/`gen-12lp`, `amd`/`rdna-3`; Apple as its highest Metal "common" family), `device` and `description` empty [10][11]; `isFallbackAdapter` on the info object | shipped in Safari 26 [12]; what it fills is not documented and is treated as possibly empty | shipped on Windows in 141 and on Apple silicon in 145 [13]; the info is reported blank [14] and treated as possibly empty |
| user-agent client hints | `navigator.userAgentData.mobile` | none | none [15] |
| iPad | — | the user agent is a Mac's since iPadOS 13; `maxTouchPoints > 1` tells them apart [16] | — |

The launcher is Electron 44.1.1 (`desktop/package.json`), which carries Chromium
152 [17], so it reports what Chrome 147 and later report.

### 3.3 Who lands where today

| browser | machine | reads | tier today |
| --- | --- | --- | --- |
| Chrome ≥ 147, Edge, launcher | the reference machine (Apple M4, 8-core GPU, 10 threads, 16 GB) | 10 cores, 16 GB | **high**, at 24 ms a frame at the canopy pose (§4.2) |
| Chrome ≥ 147 | a laptop with an Intel UHD GPU, 12 threads, 16 GB | 12, 16 | **high** |
| Chrome ≥ 147 | the same GPU, 8 threads | 8, 16 | medium |
| Chrome < 147 | any desktop | ≤ 8 GB | medium at best |
| Safari | any Mac | 4 or 8 cores, no memory (4) | **low** |
| Firefox | any machine | no memory (4) | **low** |
| Safari on iPad | an iPad, Mac user agent | 4 or 8, no memory | low, by memory rather than as mobile |
| any | a phone | — | low |

The near-grass notes say "a desktop browser reports at most 8 GB of device
memory, so detection alone lands on medium"; that was true before Chrome 147.
The gate reads both values in the reference machine's Chrome and records them
(§13.1).

### 3.4 The setting that does not exist

`quality.ts:66` says "The player can override it". Nothing in the HUD, the pause
menu (`pauseMenu.ts`: Resume, Exit), the command bar or the landing page names a
tier. `?tier=` exists only as the measurement patch three rendering notes applied
and reverted, and, on the WebGPU branch, as `parseTierOverride` in
`engineChoice.ts`, committed there because that design needed it.

### 3.5 Two settings nothing reads

`QUALITY` carries `lodBias` (1 on low) and `textureMipCap` (512, 1024, none), and
`quality.test.ts` pins them, but no code reads either: the only consumer of
`QUALITY` is `lighting.ts` (`:154`, `:163`, `:198–202`), which takes the hardware
scaling and the shadow settings. This design leaves them as they are and records
them as a follow-up (§15); the tier cost tables below do not count them.

## 4. What a tier costs

### 4.1 What each tier draws

From the code, per tier:

| | low | medium | high |
| --- | --- | --- | --- |
| hardware scaling (`lighting.ts:163`) | 1.5: render at 1/1.5 of the CSS size each way, 0.44 of the pixels | 1: the CSS size | 1 |
| shadows (`lighting.ts:198–202`) | none | one 1024² cascade | two 2048² cascades |
| post chain (`postParams.ts:18–21`) | none; the material colour path | from the grade, MSAA 4 on it | scene pass, halation, MSAA 4 on the scene pass |
| forest near band (`renderer.ts:778–782`) | 70 m | 120 m | 120 m |
| clutter and wildlife radii (`:796–799`, `:834–845`) | 0.6× | 1× | 1× |
| blade field (`:803`, `bladeClump.ts:120–123`) | none, nor the sward floor | half counts | full counts |
| litter (`:811`, `duffClump.ts:93–96`) | none | near × 1 | near × 2 |
| cliff rings (`cliffField.ts:23–27`) | 0, 80, 200 m | 60, 140, 250 m | 60, 160, 400 m |
| mist quads, rain, motes | 6, 600, 0 | 12, 1200, 600 | 12, 2000, 1500 |
| engine, once the WebGPU rule is on | WebGL2 | WebGPU where the adapter fits | WebGPU where the adapter fits |

### 4.2 What it costs, measured

Every current figure is the high tier's, at the canopy pose (seed `atmo`, mist,
noon, `(123, 110.87, −105.5)`, yaw 1.571, pitch 0.3), on the reference machine
in Chrome, in a 1200 × 2029 window at device pixel ratio 1 (2.43 million
pixels):

| engine | native | 4× pixels | source |
| --- | --- | --- | --- |
| WebGL2 | 24.0 ms (near-grass tip); 24.22 lowest quiet page | 54.8; 55.14 | [grass-frame] §3.2; [WebGPU] §3.1 |
| WebGPU, blades as shipped | 22.69 lowest page | 45.21 | [WebGPU] §3.1 |

[grass-frame] is `2026-09-26-grass-frame-reclaim-verification.md` and
[WebGPU] `2026-09-26-webgpu-high-tier-design.md`, both in this folder once their
work lands. JavaScript is 3.8 ms of the 24.0 ([grass-frame] §3.2); the frame is
GPU-bound.
A line through the two WebGL2 points gives **13.9 ms + 4.23 ms per million
pixels**, and through the two WebGPU points 15.2 + 3.08. By that line, high at the
canopy pose on the reference machine takes about 22.7 ms in a 1920 × 1080 window
and 19.9 ms in a full-screen 1470 × 956 laptop window on WebGL2 (21.6 and 19.5
on WebGPU): **high does not hold 60 Hz on the reference machine at any common
window size**, and the grass-frame work's expected 0.5 ms does not change that.
The two-point line is an estimate, not a measurement; the gate measures the
1920 × 1080 window.

There is **no current figure for medium or low**. The last ones are from
2026-09-16, before the blade field, the ground cover, the litter, the cliffs and
the near-grass work: at 4× pixels, medium 41.2 ms at a meadow pose and 41.1 at a
deep-forest one, low 30.8 at the meadow, on the build that added the blade
clumps (`2026-09-16-blade-clumps-verification.md`). They are not comparable. What medium saves over high is known in kind: the
second cascade and the doubled shadow map (four cascades once cost about 5 ms at
a deep-forest camera, `quality.ts:30–33`), the scene pass and halation, half the
blades (1.36 ms at native at high, [grass-frame] §3.2), half the near litter. The
gate measures all three tiers at both standard poses before the one class-table
row that depends on them ships (§6.1, Apple base).

### 4.3 Resolution: CSS pixels, not device pixels

The engine is made with `adaptToDeviceRatio` (`renderer.ts:647`), which sets the
hardware scaling to 1/devicePixelRatio (`abstractEngine.pure.js:1214`); but
`lighting.ts:163` then sets it to the tier's value, 1 or 1.5
(`setHardwareScalingLevel`, `abstractEngine.pure.js:905–908`). The render size
is the canvas's CSS size divided by that, so a Retina panel does **not** double
the cost: a full-screen game on a 2560 × 1664 panel at the default 1470 × 956
renders 1.41 million pixels on medium and high. One exception: `resize()`
multiplies the scaling by the old ratio over the new when the device pixel ratio
changes (`abstractEngine.pure.js:1226–1231`), so a window dragged from a 1×
monitor to a 2× panel renders at twice the CSS size each way from then on. The
probe measures the canvas the player has; the governor catches the rest.

### 4.4 The engine

On the WebGPU branch the tier decides the engine: high and medium use Babylon's
`WebGPUEngine` where the high-performance adapter fits and nothing remembered
says otherwise, low stays WebGL2 (`engineChoice.ts`, `WEBGPU_TIERS`). So every
tier this design picks is also an engine choice, and a tier change can be an
engine change (§9.4). This design does not change the engine rule; it hands it
the tier, and it shares the adapter request (§5.1).

## 5. The signals

### 5.1 One function

`gatherSignals(env): Promise<GpuSignals>` in `client/src/game/gpuSignals.ts`,
Babylon-free, with the browser behind `env` so every branch is tested with plain
objects:

```ts
type AdapterInfo = { vendor: string; architecture: string; device: string; description: string; isFallbackAdapter: boolean };
type GpuSignals = {
  renderer: string | null;          // the WebGL renderer string, or null without a WebGL2 context
  adapter: AdapterInfo | null;      // null without navigator.gpu, an adapter, or within 2 s
  limits: Readonly<Record<string, number>> | null;  // the same adapter's limits, for the engine rule
  adapterStatus: "ok" | "none" | "rejected" | "timed-out";  // why adapter is null, or "ok"
  parallelCompile: boolean | null;  // KHR_parallel_shader_compile on the WebGL2 context, or null without one
  cores: number | null;             // null where not reported
  memoryGb: number | null;
  mobile: boolean;
  browser: number;                  // the major version, as engineChoice.ts's browserMajor reads it
};
```

- **Renderer.** A throwaway canvas and WebGL2 context. `gl.getParameter(gl.RENDERER)`
  is taken as it is unless it reads `WebKit WebGL` (Chrome and Safari's masked
  value); only then is `WEBGL_debug_renderer_info` asked for, so Firefox, where
  `RENDERER` already carries the sanitised string, never logs the extension's
  deprecation warning. The same context is asked for
  `KHR_parallel_shader_compile` (`parallelCompile`, §7.1). The context is then
  lost with `WEBGL_lose_context`, so it does not count against the browser's
  live-context limit.
- **Adapter.** `navigator.gpu.requestAdapter({ powerPreference:
  "high-performance" })`, raced against 2 s; `adapter.info` (`vendor`,
  `architecture`, `device`, `description`, `isFallbackAdapter`, with the legacy
  `adapter.isFallbackAdapter` as the WebGPU branch reads it) and every limit, read
  with `for…in` as `gpuEngine.ts`'s `probeAdapter` does. `adapterStatus` says
  why there is no adapter: `none` (no `navigator.gpu`, or an answer with no
  adapter), `rejected` (the request threw or rejected, or the adapter could not
  be read) or `timed-out` (no answer within 2 s).
- **Sharing the adapter with the WebGPU rule.** The rule's `adapterFits` takes
  its `{ limits, isFallbackAdapter }` from here. Babylon's
  `WebGPUEngine.IsSupportedAsync`, which `probeAdapter` keeps, is itself a
  `requestAdapter`, so at the merge it is replaced by these signals rather than
  kept beside them. A `timed-out` at 2 s means **not known yet** for the engine
  choice, never a failure to record: the shared request runs on the engine
  rule's own budget, or a 2 s timeout falls through to the engine's own wait,
  so an adapter that answers in 2 to 10 s (a discrete GPU waking) is not kept
  off WebGPU. `none` and `rejected` are "no adapter", with nothing recorded, as
  `probeAdapter`'s null is today.
- **Cores and memory.** The numbers where they are numbers, else null. Never
  defaulted: a missing value is not a small one.
- **Mobile.** `navigator.userAgentData.mobile` where it exists; else the user
  agent matches `/Mobi|Android|iPhone|iPad/`; or the user agent says
  `Macintosh` and `maxTouchPoints > 1` (an iPad). `platform.ts`'s
  `isTouchDevice` is a different question and stays so: a touch-screen Windows
  laptop keeps its GPU's tier.

It runs once per page, at load, in `main.ts`; the title screen repaints when it
resolves (tens of milliseconds), and a page opened straight on a game route
awaits it before the game is built.

### 5.2 The class table

`classifyGpu(signals): GpuClass` in `client/src/game/gpuClass.ts`, pure. First
match wins, top to bottom:

| # | when | class |
| --- | --- | --- |
| 1 | `mobile` | `mobile` |
| 2 | renderer matches `/swiftshader\|llvmpipe\|softpipe\|lavapipe\|basic render driver\|\bwarp\b/i` | `software` |
| 3 | renderer ends `, or similar` (Firefox's bucket) and names `Apple M1` | `apple-unknown` |
| 4 | … a bucket naming `GeForce GTX 980` | `discrete-unknown` (every NVIDIA from the 900 series on, RTX 5090 included) |
| 5 | … a bucket naming `GeForce GTX 480`, `GeForce 8800`, `Radeon HD 5850` or `Radeon HD 3200` | `discrete-legacy` |
| 6 | … a bucket naming `Arc(TM) A750` | `discrete-unknown` (Firefox names every `Intel(R) Arc(TM)` this way: the integrated Meteor, Lunar, Arrow and Panther Lake GPUs as well as the discrete cards) |
| 7 | … a bucket naming `Intel` | `integrated-unknown` |
| 8 | … any other bucket (`Radeon R9 200 Series` covers Vega, Fury and the Renoir and Rembrandt APUs alike) | `unknown` |
| 9 | `/Apple M\d+ (Pro\|Max\|Ultra)/` | `apple-large` |
| 10 | `/Apple M\d+/` | `apple-base` |
| 11 | `/Apple GPU/` | `apple-unknown` |
| 12 | `/\bRTX\b/` (GeForce RTX, RTX A-series, Quadro RTX) | `discrete-modern` |
| 13 | `/GTX (9\d\d\|10\d\d\|16\d\d)\|TITAN X\|\bMX ?\d{3}/` | `discrete-older` |
| 13a | `/Quadro [PT][1-6]\d{3}\|NVIDIA T(1000\|1200)/` (Pascal and Turing workstation cards) | `discrete-older` |
| 14 | `/GeForce\|Quadro\|NVIDIA/` | `discrete-legacy` |
| 15 | `/Radeon RX (5\|6\|7\|9)\d{3}\|Radeon P(ro\|RO) W(5\|6\|7)\d{3}/` (RDNA 1–4; AMD writes the workstation line both `Pro` and `PRO`) | `discrete-modern` |
| 16 | `/Radeon (RX (4\|5)\d\d\b\|RX Vega\|VII\|Pro\|PRO)\|\bRX ?(4\|5)\d0\b/` (Polaris, Vega, the Macs' Radeon Pro; Polaris also as `Radeon (TM) RX 470`, `Radeon(TM) RX 560`, `RX550/550`, `RX590`) | `discrete-older` |
| 17 | `/Radeon (680\|7[68]0\|8[6-9]0)M\|Radeon 8\d{2}0S/` (680M, 760M, 780M, 860M to 890M, 8060S) | `integrated-modern` |
| 17a | `/Radeon \d{3}M/` (the smaller RDNA APUs: 610M and 820M have two compute units, 740M and 840M four, 660M six) | `integrated-unknown` |
| 18 | `/Radeon ?\(TM\) Graphics\|Radeon Graphics/` (an APU that does not say which) | by the adapter's architecture: `gcn-*` → `integrated-older`, else `integrated-unknown`. An `rdna-*` adapter does not make it modern: Chrome's AMD groups are coarse ranges of device ids, and put Barcelo (a Vega APU, 0x15E7) under RDNA 2 and the two-compute-unit Mendocino (0x1506) and Raphael (0x164E) under RDNA 3 and 2 |
| 19 | `/Vega \d+\|Radeon(\(TM\))? (R[4579]\|HD)/` | `integrated-older` for Vega, `discrete-legacy` for the rest |
| 20 | `/Arc.*\b[AB][5-9]\d\dM?\b/` (a laptop part carries an M: `A770M`) | `discrete-modern` |
| 21 | `/Arc.*\b[AB]3\d\dM?\b/` (`A370M`) | `discrete-older` |
| 22 | `/Arc\((TM\|tm)\) Graphics\|Arc(\((TM\|tm)\))? \d{3}[VT]\b/` (Meteor, Lunar and Arrow Lake, as Windows names them, `Arc(TM) 140V GPU`, and as Mesa does, `Arc(tm) Graphics`) | `integrated-modern` |
| 23 | `/Iris\(R\) Xe\|Iris Xe\|\bXe Graphics/` (Mesa names Tiger Lake `Intel(R) Xe Graphics`) | `integrated-unknown` (80 to 96 execution units, and among the commonest laptop GPUs; the probe decides) |
| 24 | `/UHD Graphics\|HD Graphics\|Iris(\((TM\|R)\))? (Plus\|Pro\|Graphics\|OpenGL)/` (with Ice Lake's `Iris(R) Plus`, the older Macs' `Iris(TM) Graphics 6100` and `Iris OpenGL Engine`) | `integrated-older` |
| 25 | `/Adreno.*X\d/` (Snapdragon X laptops) | `integrated-modern` |
| 26 | renderer null or unmatched, adapter present: `isFallbackAdapter` → `software`; vendor `apple` → `apple-unknown`; `nvidia` with `ampere`, `lovelace`, `blackwell` → `discrete-modern`, `turing` → `discrete-unknown` (GTX 16 and RTX 20 alike), `pascal`, `maxwell` → `discrete-older`; `intel` with `xe-lpg`, `xe-2lpg`, `xe-3lpg` → `integrated-modern`, `gen-12lp` → `integrated-unknown`, `gen-9`, `gen-11` → `integrated-older`, `gen-12hp`, `xe-2hpg` → `discrete-modern`; vendor `google` with `swiftshader`, `mesa` with `software`, `microsoft` with `warp` → `software` | as listed |
| 27 | anything else | `unknown` |

The adapter is the second signal on purpose: the WebGL renderer names the GPU
the WebGL path draws with, and a fallback WebGPU adapter says only that WebGPU
would be software, which the engine rule already refuses. Rows 12–25 run on the
ANGLE string whole; the PCI id in it (`(0x00002503)`) is not used.

**The caps.** After the class: `cores !== null && cores <= 2`, or `memoryGb !==
null && memoryGb <= 2`, caps the tier at low. Firefox under
`resistFingerprinting` reports two cores and is capped; that is the price of
asking for sameness, and the setting overrides it.

## 6. From class to tier

### 6.1 The class-to-tier table

`CLASS_TIERS` in `gpuClass.ts`:

| class | start | ceiling | probed | why |
| --- | --- | --- | --- | --- |
| `mobile` | low | low | no | thermals, not the GPU, are the limit (`quality.ts:69–72`) |
| `software` | low | low | no | a CPU rasteriser |
| `discrete-legacy` | low | low | no | Kepler and older, pre-Polaris Radeon |
| `integrated-older` | low | low | no | Intel Gen 9–11, Vega APUs |
| `integrated-unknown` | low | medium | yes | Iris Xe, a bare "Radeon Graphics" whatever the adapter says, the smallest RDNA APUs (610M to 840M), Firefox's Intel buckets |
| `integrated-modern` | medium | medium | no | Arc integrated, the larger RDNA 2+ APUs by name (680M, 760M, 780M, 860M to 890M, 8060S), Snapdragon X |
| `apple-base` | medium | medium | no | the reference machine's class: high is 24 ms at the canopy pose (§4.2) |
| `discrete-older` | medium | medium | no | Maxwell to Turing GTX, Pascal and Turing Quadro, Polaris, Vega, Arc A3xx |
| `unknown` | medium | high | yes | nothing recognisable |
| `apple-unknown` | medium | high | yes | Safari's `Apple GPU`, Firefox's `Apple M1` bucket: an M1 or an M4 Max |
| `discrete-unknown` | medium | high | yes | Firefox's `GTX 980` and Arc buckets, WebGPU's `turing` |
| `apple-large` | high | high | no | Pro, Max and Ultra |
| `discrete-modern` | high | high | no | RTX, RDNA 1+, Arc A5xx and up |

Only the `apple-base` row rests on a measurement of this machine class, and its
medium is still unmeasured (§4.2): the gate confirms it or moves it (§13.1). The
other named rows are set from the GPUs' throughput relative to the reference
machine's; no one's hardware but the governor's checks them, and each is one
literal in one test, so a later measurement moves one row.

### 6.2 The Auto verdict

`localStorage["dayhike.quality.auto"]`, one record per profile:

```ts
type AutoRecord = {
  v: number;            // DETECT_VERSION, 1; bumped when what a tier costs, or a class's start or ceiling, moves enough to redo every verdict
  gpu: string;          // the renderer string, else "vendor/architecture", else ""
  cls: GpuClass;        // the class the verdict was made for; with no verdict, the class of the first probe
  browser: number;      // the browser major
  attempts: number;     // probes started for this gpu and browser since the last verdict
  verdict: AutoVerdict | null;
};
type AutoVerdict = {
  tier: QualityTier;
  source: "probe" | "governor" | "build";
  pixels: number;       // the game container's CSS area when it was set
  at: number;           // Date.now()
  readings?: ProbeReading[];
};
```

The record **matches** while `v`, `gpu` and `browser` equal the running ones;
one that does not is replaced, attempts and all. The class is not part of the
match: an unnamed renderer is classed by its adapter, which can answer in time
on one load and not on the next, and a match on the class would throw each
load's attempts away and probe again without end. The class retires the
verdict instead: a verdict **counts** only while `cls` is the running class, so
a classifier change that moves a GPU to another class needs no
`DETECT_VERSION` bump. A verdict that counts **holds** while `at` is no later
than now (one dated ahead was written under a clock running ahead) and less
than 30 days old, 7 for a `governor` verdict (slowness from load outside the
game, another app or a video call, passes), and a `probe` verdict only while
the container's area is at
most 1.5 times `pixels` (it certifies a size, and a bigger window costs more);
a `governor` or `build` verdict holds at any size. A probe or governor verdict
decides Auto's tier; a `build` verdict, the tier that built after a higher one
failed (§9.3), only lowers the ceiling to it. A tier is never taken above the
class's ceiling or past the caps, whatever the verdict says.

A probe's start adds one to a matching record's `attempts`, keeping its class
and verdict until the probe's own verdict replaces them, or starts a record at
one. A verdict from a probe that finished sets `attempts` to 0, unless the
verdict it replaces was made for another class: then the count is carried, so
two classes alternating
on one GPU, each probed to a verdict the other ignores, probe at most three
times between them rather than on every load. A `governor` or `build`
verdict measured nothing and keeps a matching record's `attempts`: when it
lapses, the probes left are those left before it, so a GPU whose three probes
reached no verdict is not probed three more times a week after a drop. Nor
does a probe cut short after a miss (§7.6) clear the count: its verdict keeps
the attempt it spent, so a machine whose second step never fits the cap sees
at most three probes in all, not one each time the governor's week lapses.

### 6.3 Precedence

```
tier = ?tier=…                          (the override, for testing)
     | the player's choice, if not Auto (§8)
     | Auto:
         the verdict, if it holds                          (§6.2)
         else the class's start tier, and a probe from the class's ceiling
              if the class is probed and fewer than 3 attempts were made   (§7)
```

`autoTier(input): { tier, probeFrom }` in `quality.ts` (pure). As built,
`tierFor` and `Capabilities` stay in `quality.ts` with their tests, and
`renderer.ts`'s `detectTier` still gives a renderer built with no tier the old
rule from cores and memory; the page passes a tier to every renderer it
builds, so neither decides a hike here, and they stay because the WebGPU work,
which merges this, keeps `detectTier` for a renderer given no tier. `resolveTier({ override, choice, auto })`
in `tierChoice.ts` returns the tier and its source (`override`, `choice`, `auto`),
which the page logs once per renderer build:
`quality: medium (auto, apple-base), engine webgl2`.

### 6.4 The literal matrix

The plan's Task 2 pins, as a table of literals, the class and the Auto tier for
33 inputs: every row of §5.2 by a real renderer string (Chrome's ANGLE strings
for Apple M4, M3 Max, M2 Pro, RTX 3060, GTX 1060, GT 730, RX 6700 XT, RX 580,
Radeon 780M, a bare Radeon Graphics under three adapters, UHD 620, Iris Xe, Arc
integrated, Arc A770, an Intel Mac's Iris Plus 655 and SwiftShader; Safari's
`Apple GPU`; Firefox's buckets for Apple, NVIDIA, Intel and AMD; `llvmpipe`),
the adapter-only rows, the missing-everything row, the mobile and iPad rows,
and both caps; then the verdict cases of §6.2 (holds, a bigger window, another
GPU, 31 days old, an old version, a governor drop, three attempts spent). A
monotonic check runs beside them: over a grid of cores and memory, less of
either never raises the tier of any class.

## 7. The startup probe

### 7.1 When it runs

When the page is about to start a hike on **Auto**, with no override, and
`autoTier` returns a `probeFrom`: a probed class with no verdict that holds and
fewer than three attempts. Also, on Auto, with `?probe=high|medium` in the
address, from that tier, whatever the class and the record, for the gate. It runs in `main.ts`'s game
route, **before** `startGame`: nothing of the hike exists yet, so it cannot
stall a session or pop anything a player is looking at, and a follower simply
arrives a few seconds after the host.

It is **skipped**, before its screen is shown, where its step would draw with
WebGL2 and the browser does not expose `KHR_parallel_shader_compile`
(`probeStepCanSettle`): the class's start tier, nothing written, no attempt
counted, one log line (§7.7); a verdict that holds is still honoured, and
`?probe=` still forces the probe. Firefox 156 on the reference machine exposes
no such extension, so every program links on the page's thread: 73 link-status
reads blocked for 169–337 ms each, 14.4 s in all, the step never saw 1.5 s
without a compile inside its 15 s, and the screen stayed up about 19 s on each
of three hikes for no verdict. The governor and the Settings screen remain that
player's ways to another tier.

### 7.2 What it renders

The canopy pose of every rendering note: seed `atmo` (627994160), the default
terrain variant, weather `mist`, hour 12, the free camera at `(123,
elevationAt(atmo, 123, −105.5) + 1.6, −105.5)` (110.87), yaw 1.571, pitch 0.3.
It is the heaviest standard view (§4.2), the same on every machine, and every
measurement in the repository is at it, so a probe reading reads against them.
The forest and a non-authoritative world are built as the landing backdrop builds
its own (`landingScene.ts`), the renderer at the tier being measured, on a
**fresh canvas** filling the game's container, under an opaque screen: the
landing's dark ground with one status line, "Setting up graphics…". On the
WebGPU branch the canvas gets the engine the rule gives that tier. Each measured
tier gets its own canvas; the renderer is disposed and its engine made with
`loseContextOnDispose` (`thinEngine.pure.js:3386`) so no context outlives it.

### 7.3 Ready, warm, measured

1. **Ready**: `scene.isReady()`, `scene.getWaitingItemsCount() === 0`, and no
   effect compiled for 1.5 s (`engine.onAfterShaderCompilationObservable`); at
   most 15 s from the end of the step's build, after which the probe gives up
   (§7.6). Two steps each given 15 s cannot both fit the 30 s cap, so a step
   is also given no more than what the cap has left less the 4.2 s its frames
   may need once ready (`stepReadyMaxMs`, counted from the step's start, its
   build included), the sooner of the two deciding, and is not started where
   that is nothing: a second step that could only be ready too late to be
   measured gives up there, not at the cap after the player has waited it out,
   while a first step keeps its full 15 s after a slow build.
2. **Warm**: 60 frames discarded (the fields' first rebuilds, the reflection
   probe, the first shadow renders), or fewer once the warm-up's own
   intervals, each counted at most 250 ms, sum to 2,100 ms
   (`PROBE_STEP_BUDGET_MS`, below): at 100 ms a frame the 60 alone would take
   6 s, and a machine that holds reaches 60 in about 1 s. Counting each
   interval at most 250 ms keeps a tab hidden for seconds from spending the
   whole bound in one gap, and still ends the warm-up of a machine under 4
   frames a second. A
   shader that compiles after the scene is ready starts the warm-up again: its
   hitch, 100 ms or more, would tip a machine that holds 60 Hz into a miss.
   The 30 s cap bounds the restarts.
3. **Measured**: 120 frame intervals, `performance.now()` between render-loop
   callbacks. Intervals over 250 ms are dropped; fewer than 100 left is no
   reading. The 120 hold only if they sum to at most 120 × 17.5 ms = 2,100 ms
   (`PROBE_STEP_BUDGET_MS`, §7.4), so once the kept intervals sum past that
   the step ends there as a miss: its reading is the mean and p95 of the
   frames measured, their count, and `early` (logged "ended early"). The
   floor is the arithmetic's own: 2,100 ms of intervals of at most 250 ms is at
   least 9 frames. A slow machine then reads its miss in about 2 s, not 12,
   and a step spends at most about 4.2 s on frames after it is ready. That sum
   counts frames only, and below 4 frames a second every interval is a stall;
   so a step also ends as a miss once more than 20 of its intervals are over
   250 ms (`PROBE_MAX_STALLS`, 120 less the 100 a reading needs): its reading
   is the mean and p95 of every interval measured, stalls included, their
   count, and `stalls` (logged "21 over 250 ms"). 21 intervals over 250 ms
   among at most 120 is a mean over 43 ms, a miss whatever the rest read.

The reading: `{ tier, frames, meanMs, p95Ms, pixels, engine }`, with `early`
for a step that ended as a miss on its sum, and `stalls`, their count, for
one that ended on its stalls (3, above).

### 7.4 The budget, and a capped reading

The budget is 60 Hz, 16.67 ms, and every tier is asked the same question of
it. A tier **holds** when the mean interval is at most **17.5 ms**: the budget
plus 5 %, room for a timer's jitter and one garbage collection in 120 frames (a
single 50 ms hitch lifts the mean 0.28 ms).

The browser delivers frames at the display's refresh, never faster. On a 60 Hz
display a tier with room to spare reads 16.67 ms, the same as one with no room:
**a capped reading says "at least 60 Hz here", and that is all the probe asks.**
It never infers headroom from a reading, and so never steps up from one; it
starts at the class's ceiling instead (§7.5). On a 120 or 144 Hz display the
reading is uncapped below the budget, which changes nothing. A frame that misses
a 60 Hz vsync shows as a 33 ms interval, so a GPU that needs 18 ms reads a mean
between 18 and 33 ms and misses.

The page itself can draw below 60 Hz whatever the GPU: a display that refreshes
slower, or a browser that halves its frame rate (Safari renders at 30 fps in
Low Power Mode and when the Mac runs hot). Every tier would then read a miss,
and low would be kept for 30 days. So before the attempt is spent, the probe
times the probe screen's own idle frames, 30 of them (about 0.5 s), and takes
their median, so one hitch does not count. Below 60 Hz (over 17.5 ms), the
probe is **skipped**: the class's start tier, nothing written, one log line; a
later load tries again. A display below 60 Hz therefore keeps its class's start
tier rather than reading low.

### 7.5 Steps

`nextProbeStep(ceiling, readings)`, pure:

- no reading yet: measure the ceiling;
- the last reading holds: the verdict is its tier;
- a miss at high with no medium reading: measure medium;
- any other miss: the verdict is low. Low is the floor and is never measured.

So at most two measurements and one rebuild. The verdict is written (§6.2,
`source: "probe"`, every reading kept), and the hike starts at it.

### 7.6 What the player sees, and its bounds

A dark screen and "Setting up graphics…", once per machine and browser, on the
first hike that needs it: a world build (one blocks the page "for a second or
more", `main.ts:391`), the models from the HTTP cache after the first visit,
compilation, about 3 s of frames per tier. The whole probe is capped at 30 s; on
the cap, or on a throw anywhere in it, the probe is abandoned, the hike starts at
the class's start tier, and the attempt counts. What a step that already missed
taught is kept: a probe cut after a miss (at high, say, with medium not yet
read) has the verdict of the tier below the miss, never above the class's start
tier (`cutVerdict`), written as the probe's, so the next hike does not measure
the miss again. After three attempts without a verdict the start tier stands
and only the governor acts.

The attempt is spent only once the tab is seen (a hidden tab draws no frames)
and the idle frames hold 60 Hz (§7.4). On a game route the page says
"Loading…" from the first moment of the wait for the signals until the probe's
screen or the hike takes over, and a throw anywhere in starting the hike leaves
the line "This browser could not start the game." rather than a blank page.

### 7.7 The log

One `console.info` per measured tier and one for the outcome:
`quality probe: high 23.96 ms mean, 33.4 p95, 120 frames, 1920×1080, webgl2 → misses`
and `quality probe: verdict medium (apple-unknown)`, or, with no verdict,
`quality probe: skipped, the page draws below 60 Hz (33.3 ms a frame); starting at medium (apple-unknown)`
(or `no verdict`, or `not run, the page moved on`), or, cut after a miss (§7.6),
`quality probe: cut short after high missed, verdict medium; starting at medium (apple-unknown)`.
A step that ended early (§7.3) says so after its frames: `22 frames (ended early)`. Where the probe is skipped
for compiling on the page's thread (§7.1), before any screen:
`quality probe: skipped, this browser compiles shaders on the page's thread; starting at medium (apple-unknown)`,
or, where no WebGL2 context could be made to ask for the extension (a class
read from the WebGPU adapter alone),
`quality probe: skipped, no WebGL2 context could be made to measure with; starting at medium (apple-unknown)`.

### 7.8 With the WebGPU rule

The WebGPU rule decides the engine from the tier, so the probe runs first and
the engine choice after it. Where the two meet:

- **The engine a verdict was measured on.** The Auto record is keyed on the
  engine each verdict was measured with: a WebGL2 verdict does not decide a
  WebGPU hike, nor the reverse. The attempt budget stays per GPU and browser.
- **Probe engines are not watched.** A probe step's WebGPU engine is never
  given the rule's failure watcher, whose answer is a reload: a lost device
  mid-probe would reload the page with the attempt spent. A failure during a
  step, at creation or in its frames, is the rule's `init` failure, and the step
  runs again on WebGL2.
- **The game's canvas comes after the probe**, so the probe's canvases never
  sit beside it in the container.
- **One catch for the whole start of a hike**, the engine's launch included, so
  a throw on either engine leaves the line of §7.6 rather than a blank page.
- **"Loading…" from the start of the wait for the signals**, giving way to the
  probe's screen when there is a probe, and then to the engine's own wait line.

## 8. The player setting

### 8.1 Where it is

- **Title screen.** A **Settings** button on the home panel, a secondary button
  like Downloads and Credits, in the order Play → Downloads → Settings →
  Credits (on the launcher, which has no Downloads: Play, the join form,
  Settings, Credits). It opens a Settings panel beside the Credits and
  Downloads panels, at the route `/settings`, entered and left exactly as
  `/credits` is
  (`router.ts`'s `Panel`, `navigateToPanel`, `leavePanel`; `landing.ts`'s class
  toggle; the browser's Back button pops it). Present in every build, and for a
  follower too: the setting is the player's own.
- **Pause screen.** Resume → **Settings** → Exit. Settings swaps the pause
  panel for the Settings panel in place, with the same fade the landing's panels
  use; Back and Escape return to the pause panel.

### 8.2 The Settings screen

One component, `client/src/game/settings.ts`, as `credits.ts` is: a pure
`settingsModel(input): SettingsView` that decides everything, and
`renderSettings(root, view, handlers)` that paints it with DOM calls and
`textContent` only, into whichever panel hosts it.

The choice is one native `<select>` (`select.choice`), not a row of buttons.
The visible "Graphics" is its `<label for>`, so it is also the select's
accessible name; the select has an id and a `name` (`graphics`), and
`aria-describedby` points at the line under it for a tier chosen above the
recommendation (`Higher than recommended for this computer.`), a polite live
region that is always in the page and empty when it has nothing to say.

The select is built once: `setView` updates it and its four options in place
and sets its value from the view, which fires no `change`, so the select keeps
the keyboard's focus across a repaint and a repaint never reads as a pick. A
pick is heard on `change` alone. While a choice is applied the select is
disabled.

`settings.ts` owns one small style literal for what is its own. The select
takes the look the game's text inputs share (the landing's join field:
`padding: 0.5rem 0.75rem`, `font: inherit`, `color: #fff`, a fill of
`rgba(255, 255, 255, 0.08)`, a 1 px `rgba(255, 255, 255, 0.25)` border, a 4 px
radius) in both hosts, with `appearance: none` and a caret of its own: two
small `linear-gradient` triangles in the text's colour at the right, clear of
the label by a `2.25rem` right padding. It sizes to its longest option, at
least `14rem` (the width of the pause page's Apply and Back; on a phone the
title screen's Back is full width, so wider than the select) and never wider
than its panel.
The open list is the browser's: the select carries `color-scheme: dark` and
each `option` a dark fill (`#16191c`) and a light text (`#eaf1f1`), so the list
is not drawn light on the dark page. Keyboard focus shows the ring the
buttons show (`outline: 2px solid var(--btn-edge-lit)`, offset 3 px); disabled,
the text, fill and border dim and the pointer stops reading as a hand. Apply
and Back are plain `<button>`s, so they take the host's own rules
(`.landing button`, `.pausemenu button`) and the host's tokens. Keyboard and
touch are the browser's own for a select, and differ by platform. Tab reaches
it everywhere. On a closed select, type-ahead letters change it in Chrome,
Firefox and Safari; the arrow keys step it on Windows and Linux and in Firefox
everywhere, while on macOS Chrome and Safari open the list on Up, Down and
Space, and the choice lands on Return or a click in the list. A tap opens the
platform's picker on Android and iOS.

```
SETTINGS
GRAPHICS
[ Auto (Recommended)       v ]
Auto picks Medium on this computer.
This hike is using Medium.                      (pause only)
[ APPLY ]                                        (pause only)
[ BACK ]
```

The lines, in order, each only when it applies:

| when | line |
| --- | --- |
| `?tier=` is in the address | `The address sets High (?tier=high), which overrides this setting.` |
| Auto's pick is known | `Auto picks Medium on this computer.` |
| Auto will probe at the next hike | `Auto tests this computer when your next hike starts.` |
| pause | `This hike is using Medium.` |
| storage throws | `This browser is not keeping settings, so this choice lasts until the page closes.` |

The choices are in the order Auto, High, Medium, Low; Auto is chosen when
nothing is saved.

### 8.3 Title and pause

- **Title**: choosing an option saves it at once. The next Play builds the hike
  at it; the landing's backdrop stays low. Opening the panel moves the focus
  into it (§8.5).
- **Pause**: choosing an option selects it without saving; **Apply** saves it
  and applies it live (§9); **Back** or Escape discards an unapplied selection.
  The focus moves into the page on entering Settings, and again once a choice
  is applied (Apply goes disabled and loses it), by the rule of §8.5.
  Apply is disabled when the selection resolves to the tier already running,
  while `?tier=` is in the address, and while applying. While applying the
  panel's ground goes opaque, Apply reads "Applying…", and Back and Escape do
  nothing; when the new scene is ready the ground returns to the pause vignette
  and the running line names the new tier.
- **Escape with the select focused** on the pause screen: with its list closed,
  Escape goes back to the pause panel as from anywhere else. Where a browser
  hands the page the Escape that closes an open list, and says the list is open
  through the `:open` pseudo-class, that Escape is left to the list and the
  next one goes back. A native select says nothing else about its list, so a
  browser that both hands the page that Escape and lacks `:open` goes back on
  it; a browser whose list takes its own keys never shows the page that
  Escape at all.
- **Game keys** do not act while the select is used: the pause menu holds the
  controls (`createPlayGate`), so arrows and letters typed into it move no one,
  and nothing in the game calls `preventDefault` on them while held, so the
  select still sees every key. `/` still opens the command bar over the pause
  menu, as it does from any control there.
- **Nothing pressed on a form control stays held.** The game's input
  (`input.ts`) ignores a keydown or a mousedown aimed at a form control (a
  select or its options, a text field, a text area, anything editable). A
  select's open list takes the keyboard and the mouse for itself, so the Space
  or the click that opened it can lose its release to the list; recorded, it
  would leave the player jumping, or Interact held, after Resume. Releases are
  still heard from anywhere, so a key pressed in the game and released over a
  control is let go, and keys pressed in the game stay tracked through the
  menu.

### 8.4 Persistence

`localStorage["dayhike.quality"]` holds `auto`, `high`, `medium` or `low`,
read and written through `tierChoice.ts` with every access in `try`/`catch`
(`playerName.ts`'s pattern, `safeStorage` on the WebGPU branch). Anything else
there reads as Auto. Where the storage accessor or a write throws, the page keeps
the choice in memory for its own life and says so (§8.2).

### 8.5 Where the focus goes

As Settings opens, and on the pause screen once a choice is applied, the
focus goes to the select only when a key made the press that got there
(Enter or Space on the Settings button, or on Apply). After a mouse, a finger
or a pen it goes to the screen's heading instead: on iOS a select focused
inside a tap can bring its picker up unasked. The heading takes focus from
script only (`tabIndex` -1) and shows no ring after a pointer (keyboard focus
on it keeps the browser's ring); a screen reader is carried
into the screen either way, and Tab goes on to the select. Both hosts tell the
two apart the same way, by the click's `detail` (`openerOf` in `settings.ts`):
a click no pointer made counts 0. The title screen's panel reached with no
press on its button, by the browser's Forward, opens as for a pointer.

## 9. Applying a tier mid-hike

### 9.1 Why it can be done

The session does not depend on the renderer. Each frame, the loop (`app.ts`,
host `:833–876`, client `:967–1002`) steps the fixed-tick session, then hands
the renderer the state (`renderer.sync`, `:846`, `:980`) and renders. The
session, the transports, the player's input sampler and the HUD hold no
reference into the scene. So `renderer` can become a replaceable reference in
`startGame`: on a tier change the old one is disposed, a new one built on a new
canvas, and every loop callback, which reads `renderer` when it runs, draws with
the new one from the next frame.

### 9.2 What is bound to the renderer, its scene or its canvas

Every binding in `app.ts` and `main.ts`, and what a swap does with it:

| binding | where | on a swap |
| --- | --- | --- |
| the render loop | `renderer.engine.runRenderLoop(loop)`, `app.ts:1039` | the loop body becomes a named function; `stopRenderLoop()` on the old engine, `runRenderLoop(loop)` on the new |
| signs, trailhead car, kiosk and poster | `createSigns(world)`, `app.ts:453–488`, into `renderer.scene` with `renderer.shadows` | disposed before the old scene, rebuilt against the new from the session's world |
| the body at the crest | `createBodyMesh(renderer.scene, …)`, `app.ts:822`, `:920` | the same |
| interactables | `registerInteractables(world)`, `app.ts:380–392` | untouched: they live in the sim's world, not the scene |
| the interact prompt | `renderer.project(target.pos)`, `app.ts:407` | untouched: read through `renderer` each frame |
| wildlife audio | `renderer.hasWildlife`, `app.ts:161`; `renderer.wildlifeEvents()`, `renderer.listener()` each frame | kept: `hasWildlife` depends on the forest, not the tier; the old shell's undrained events are dropped with it |
| ambient listener and wind | `renderer.listener()`, `renderer.wind()`, `app.ts:368–369` | untouched: read each frame |
| hour and weather | `renderer.setHour`, `setWeather` from the console and the escalation, mirrored in `appliedHour`, `appliedWeather` | re-applied at once, weather with no fade |
| wireframe, skin shading | mirrored in `wireframe`, `skin` | re-applied; `createSkinShading` resets skin to on (`skin.ts:126`), so this matters |
| walking cue, unsettle, wind override | `renderer.setBobScale`, `setUnsettle`, `setWindOverride` from `applyView`, not mirrored today | mirrored (`bobScale`, `unsettleLevel`, `windOverride`) and re-applied |
| the free camera | pushed each frame by `stepFreecamView`, but not while input is suppressed (`app.ts:629`), as it is under the pause menu | the last pushed view is mirrored and re-applied, or the camera would drop to the player behind the menu |
| `cameraOnPlayer` | `app.ts:223` | set false: the new camera is not on the player until its first `sync` |
| the input sampler | `createInputSampler(canvas, …)`: `pointerdown` and `click` on the canvas, pointer-lock identity `document.pointerLockElement === canvas` (`input.ts:119`, `:160–161`) | `rebind(fresh)`: the two listeners move, the lock identity follows; held keys and the accumulated aim are kept (recreating it would reset the player's view) |
| the touch layer | four pointer listeners and `setPointerCapture` on the canvas (`touchControls.ts:542–557`) | `rebind(fresh)` |
| touch model size, prompt size, resize | `canvas.clientWidth` / `clientHeight`, `app.ts:193`, `:409`, `:1052` | `canvas` becomes a `let`; `touchModel.resize` after the swap |
| `canvas.style.touchAction` | `app.ts:188` | set on the fresh canvas |
| the WebGPU watcher (WebGPU branch) | `watchWebGpu(engine, onGpuFailure)` in `main.ts`'s `launch` | moves into the swap: removed from the old engine, attached to a new WebGPU one (§9.4) |
| observers on the scene or the engine | none in `app.ts`; on the WebGPU branch, the watcher's four on the engine (`gpuEngine.ts`) | the watcher's, as above; the renderer's own go with its scene |
| everything else in the container | HUD, command bar, pause menu, connect panel, poster, end panel, netgraph, prompt | untouched: DOM over the canvas, no scene reference |

Inside the renderer everything is rebuilt by construction: entity views (remote
players' figures come back on the next `sync`, as capsules until their models
load), wildlife (the director starts again, so the animals near the player may
change; they are per-peer and never shared), the forest, clutter, blades, litter,
cliffs, water, mist, rain and motes. `terrainMaterialFor`'s cache is keyed by
scene (`renderer.ts:106`), so it cannot hand the new scene a disposed material.

### 9.3 The order, and why the old renderer goes first

In `rendererSwap.ts`, `swapRenderer(current, target, bindings)`, synchronous:

1. `stopRenderLoop()` on the old engine;
2. dispose the scene extras (signs, body) while their scene is alive;
3. `renderer.dispose()`, the engine created with `loseContextOnDispose: true`, so
   every GPU object of the old context goes with it, including any the scene
   forgot. One exception to "at once": while the scene's BRDF lookup texture is
   still being expanded (the first second or so of a renderer's life), the
   whole old scene and its engine are kept until the expansion finishes, for
   at most `BRDF_SETTLE_POLLS` (125) checks 16 ms apart that actually run, so
   the new renderer's build in steps 4 to 7 spends none of it; disposing the
   scene first makes Babylon's expansion callback throw (`releaseEngine`,
   `renderer.ts`). The renderer's own parts are disposed at once and nothing
   draws the kept scene, but what lives in it carries on until it goes: model
   requests still in flight download and parse into it, and the ground maps
   keep downloading. For that time the old context is alive beside the new;
4. a fresh canvas replaces the old one in the container (`replaceWith`), with
   `touchAction: none`;
5. `createRenderer(fresh, level, forest, { tier, engine })`, the same `level` and
   `forest` objects the session holds;
6. re-apply the view state of §9.2; rebuild the scene extras against the new
   scene; rebind the input sampler and the touch layer; resize the touch model;
7. `runRenderLoop(loop)` on the new engine.

**Always a fresh canvas**, whether the engine changes or not. A canvas that held
a WebGL2 context can never give a WebGPU one or the reverse, so the engine
change needs the fresh canvas anyway; using it for every swap means one path,
tested once, and a lost old context frees every GPU object wholesale, where
reusing a context leaves whatever the scene failed to delete alive in it.

**Dispose first, not build first.** Building the new renderer while the old one
stands would keep the old one as the fallback, but the renderer is written for
one live instance per page and breaks with two:

- `createAtmosphere` registers its material plugin globally by name
  (`atmosphere.ts:144`); Babylon replaces a registration of the same name
  (`materialPluginManager.pure.js:390–409`), and the old atmosphere's dispose
  unregisters it by name (`atmosphere.ts:191`;
  `materialPluginManager.pure.js:413–425`), which removes the new one's:
  every material the new scene makes after the swap (the models still loading)
  would have no atmosphere.
- `atmosphere.ts:35–36` keeps the record and the gradient texture in module
  variables that the old dispose sets to null under the new scene.
- `skin.ts:143` resets the skin switches on dispose.
- Two scenes' textures, shadow maps and buffers in GPU memory at once, on the
  machine that is lowering its tier because it is short of GPU.

The landing-to-game path already disposes one renderer before it builds the
next (`main.ts:424`), so dispose-first is the order everything is written for.

**Failures.** The previous renderer is gone once step 3 runs, so falling back
means rebuilding the previous configuration, not keeping the previous object:

- **A ladder of three rungs:** the target, then the tier that was running, then
  low, the tier least likely to fail; the last two on WebGL2, each on a fresh
  canvas. A rung that fails, in its build or in anything after it (putting the
  view back, the signs, the rebind), is taken down whole (the renderer it built,
  with its engine and the atmosphere's registration, or else the engine it was
  given) before the next is tried. Only when every rung fails does the throw go
  up, with nothing of any of them alive.
- **The choice is kept only on success.** A switch that falls back keeps the
  choice as it was, since the running tier came from it, and says "Could not
  switch; still using Medium." It never writes the running tier as a choice,
  which would turn an Auto player into a fixed-tier one the probe and the
  governor never act for.
- **The failed tier is remembered** (`recordFallback`), except under
  `?tier=`. The Auto record gets a verdict of its own source, `build`, at the
  tier that did build (low when none did): it holds at any window size for 30
  days, and it caps rather than decides: the failed tier and all above it are
  out of Auto's reach, so Auto never tries the failed tier each hike, while a
  probed class whose start is below the cap is still measured, from the cap.
  It is written only when it lowers what is known: a verdict for the class that
  holds at or below the tier that built is kept, since a fallback says nothing
  new about the tiers below it. So a governor's drop whose own switch falls
  back keeps its finding, and the next hike starts at it, where the start's
  ladder (below) converges on a tier that builds, rather than the slow tier,
  the drop and the stall coming round again. A stored choice of the failed tier goes back to Auto, since
  no record can override an explicit choice, and the Settings screen says "High
  did not start on this computer, so Settings is back on Auto (Recommended)."
  until the next choice.
- **When no rung builds**, the hike ends. The Settings page, which is what the
  player is looking at, says "The graphics could not be restarted; returning to
  the title screen.", and the landing shows a line saying why once, if it is
  drawn within 30 s of the hike ending; a reload later than that drops the
  line rather than show it out of its moment. A follower
  sent back into the host's game then starts at a tier that builds.
- **The hike's start has the same fallback** around its first renderer only,
  not the world: the tier decided, then the class's start tier, then low, each
  on a fresh canvas (`buildFirstRenderer`), recorded the same way. A start that
  throws anywhere else undoes everything it made (`buildOrUndo`).
- The screen is never blank: the "Applying…" ground is opaque at once and stays
  until a renderer stands (§9.6), and the command bar cannot open over it.

### 9.4 The engine

On the WebGPU branch, a target tier the rule gives WebGPU needs a WebGPU engine,
and making one is asynchronous (`createWebGpuEngine`: `initAsync`, the
translators, up to `WEBGPU_START_MS` 15 s). It is made **before** step 1, on the
fresh canvas the swap will use, while the old renderer keeps drawing under the
"Applying…" ground:

- it rejects: `rememberFailure("init")` as today, and the swap goes ahead on
  WebGL2 at the target tier, on another fresh canvas (the rejected one may hold a
  WebGPU context);
- it stands: the swap uses it, and the WebGPU watcher is attached to it.

After the swap, a shader or pipeline error inside the new engine's startup
window (`createStartupWindow`), which the rule answers with a reload at page
start, is answered with a **live swap onto WebGL2 at the same tier** instead, with
the fallback remembered (`pipeline`) and the HUD line the rule already has,
"Graphics switched to WebGL2 after a GPU error." A reload mid-hike would drop a
co-op session; a swap does not. A lost device keeps the rule's own answer. The
remembered fallback (`dayhike.engine`) is read for every swap as for every page
start, so a failed engine is not tried again by the next swap.

### 9.5 The hitch, and the simulation

The loop is the engine's render loop, so steps 1–7 run with no frame and no tick:
JavaScript runs one thing at a time, and the rebuild is one synchronous job. For
its length the page does nothing else: the host's world does not advance, no
snapshot is sent, no input is read. What is known of its length: the page's own
comments say a world build blocks "for a second or more" (`main.ts:391`,
`app.ts:688`); a renderer rebuild does less (no `createForest`, no session), and
more on WebGPU, where pipelines compile on first draw. The gate measures it
(§13.4). After it:

- The first frame's `dt` is the whole stall; `FixedStepAccumulator` runs at most
  15 ticks (0.25 s) and drops the rest (`loop.ts:4`, `:12–17`): the world takes a
  quarter of a second's ticks at once and resumes about where it stopped.
- **A host with peers** stalls them: their predicted players keep moving, their
  inputs queue at the host (`INPUT_BUFFER_TARGET` 2, drained at up to two a
  tick, `constants.ts:14–16`), remote figures hold still while no snapshot comes, and
  then everything reconciles. The data channels stay open: their keep-alive runs
  in the browser, not the page, and nothing in the game times a peer out
  (`CLIENT_TIMEOUT_MS` is declared and read by nothing). A host whose tab is hidden
  already stops the world for everyone for as long as it is hidden, so peers
  already live with a longer stall than this one.
- **A follower** stalls only itself: the host goes on, the follower's queued
  snapshots arrive at once after it, and its prediction reconciles.

The sim is not kept ticking through the rebuild, because nothing can run
during a synchronous job; splitting `createRenderer` into steps that yield would
be a rewrite of the renderer's construction for a second of stall on a choice the
player makes from the pause screen.

### 9.6 What the player sees

Apply → the pause panel's ground goes opaque and Apply reads "Applying…" → after
that has painted (`afterNextPaint`) the synchronous swap runs → the loop resumes
on the new renderer under the opaque ground while the models load and the
shaders compile → when the new scene is ready (`scene.isReady()` and no
waiting items, and the forest's billboard bakes settled, which run outside the
scene's count; `whenSceneReady`) the ground fades back to the pause vignette.
The player is on the pause screen throughout, so a pop-in behind it is not
seen, and Resume puts them back where they were, looking where they looked.

**The bounds.** The wait is bounded from the end of the build, so that a model
or a layer that never settles cannot hold the screen, and the bound belongs to
whoever put the cover up: `switchTo` takes it as a required argument and hands
it to `whenSceneReady`, which has no default.

- **Apply: 20 s** (`APPLY_SWAP_READY_MAX_MS`). It covers a player on the pause
  screen who asked for the switch. It is sized for the slowest build measured:
  in Chrome on an Apple M4 at 6× CPU throttling the build took about 4.2 s and
  the forest was whole 3.2–6.1 s after a 10 s bound, 16.1 s after the build at
  most, so that bound lifted the cover on bare hillside in 12 switches of 12,
  with the forest appearing 1.7–4.2 s later. At 1× the cover lifts on
  readiness, 3.5–3.75 s after Apply. On a machine slower still the cover lifts
  at 20 s and the forest fills in after it, in view.
- **The governor's drop: 10 s** (`GOVERNOR_SWAP_READY_MAX_MS`, §10). It covers
  a player in the middle of play who did not ask, without sight or controls, in
  a world that goes on around them (a party, a hunt); there a forest that fills
  in after the lift costs less than ten more seconds of that. On a machine as
  slow as the 6× one, the cover lifts at 10 s on bare hillside and the forest
  fills in after it, in view.

## 10. The governor

`createGovernor(now)` in `client/src/game/governor.ts`, pure, fed each frame's
interval from both loops' `dt` (`feedGovernor` in `app.ts`), with whether the
frame was steady play:

- nothing before **30 s** after the hike's session starts or after a tier
  switch (`restart`), while models stream in and shaders compile;
- intervals gathered in **10 s** windows. A window holding a frame that was not
  steady play, or an interval over **250 ms** (a stall), is **void**: it neither
  counts nor breaks a run, the way the probe's meter ignores the frames around a
  known hitch (§7.3). A frame is steady (`steadyFrame`) when the player is
  engaged, the pause screen and the command bar are closed (the bar from its
  "/", before the pointer is let go), the tab is visible, the scene has nothing
  waiting to load, no shader compiled since the last frame, no tier is being
  switched, and the free camera is not flying (its flight crosses the fields'
  rebuild lattice every frame, work walking never causes);
- a window whose mean interval is over **20.8 ms** (1.25 × the 60 Hz budget, 48
  fps) counts; one at or under resets the run;
- **three** counting windows in a row, 30 s of steady play under 48 fps: the
  verdict is a drop, once, latched;
- the drop is acted on at the first steady frame from the one that made it
  (`frame` returns true then), so a drop made as the pause screen opens waits
  for play to resume and is never acted on under it;
- once the session ends (`endSession`), the ending's last seconds before the
  landing are not play: nothing more is counted or acted on (`stop`).

Why these: the probe's bar is 17.5 ms (§7.4), and the governor's sits well above
it, so a tier the probe found holding does not trip it on a heavier stretch of
trail; only play that stays under 48 fps for half a minute does. Brief spikes
cannot: at 60 Hz a 200 ms hitch lifts its 10 s window's mean by about 0.3 ms,
against 4.1 ms of room to the limit, and one over 250 ms voids its window
instead. A run needs three windows in a row, so one slow window between normal
ones starts over.

On a drop, on Auto only (never a chosen tier, never under `?tier=`), and above
low only (`governorDecision`), `actOnDrop` runs under the probe's opaque
"Setting up graphics…" screen with the controls held, so neither what follows
nor the scene coming back is seen mid-play. The screen is raised over the play
HUD (`OVER_PLAY_Z`, 21: above the interact prompt, the touch layer and the
roster, and so above the pause menu). The controls are held or freed only by
one gate (`createPlayGate`): held while the command bar or the pause menu is
open, once the match is over, and under the cover. While the cover is up, the
pointer's lock changes nothing: Escape shows no menu that would be unseen yet
reachable by keyboard, re-locking hands no controls back, and the command bar
stays shut. When it lifts, the gate reconciles once with the lock as it is: a
freed pointer shows the menu on Resume, a locked one plays on, and after the
match's end the controls stay held. It lifts the moment the session or the
match ends, so the ending is never hidden; a switch under it finishes, or is
abandoned, as it would. If anything before the switch throws, the loop runs
again; a switch that ran owns the loop.

1. **The page's own frame rate first.** The render loop stops and the page's
   idle frames are timed as the probe times them (§7.4, `timeIdleCadence`: 30
   intervals, the first and any stall dropped, the median), bounded at 2 s. A
   browser that draws below 60 Hz whatever the GPU (Safari in Low Power Mode,
   a Mac running hot) is slow on every tier, and a lower one would buy nothing
   but a verdict that holds it down for a week. So when the median is over
   17.5 ms, or the frames cannot be timed, the governor **stands down**: one
   `console.info`, nothing written, the loop runs again and the screen goes.
   It does not try again that hike.
2. The Auto record is written (`withGovernorDrop`): a verdict one step below
   the running tier, `source: "governor"`, for this GPU, browser and class. It
   holds at any window size for 7 days, so the hikes that week start there, and
   it is the tier the Settings screen's Auto line now names. A week, not the
   probe's 30 days: the governor cannot tell a slow GPU from load outside the
   game, another app, a screen recorder or a video call, which passes.
3. One `console.info`.
4. The tier is lowered **now**, through the live switch of §9, the same path
   Apply takes, with the tier's source kept as Auto; the screen goes once the
   scene is ready, or at 10 s from the end of the build
   (`GOVERNOR_SWAP_READY_MAX_MS`), half the Apply's bound (§9.6): the player
   under it did not ask and cannot see or move in a world that goes on, so on
   a slow machine the screen lifts at 10 s and the forest may fill in after,
   in view. A switch that falls back or fails is handled as §9.3 says,
   which keeps the governor's verdict when the tier that built is above it.
5. Once the switch reaches the lower tier, one HUD line for 6 s: "Graphics
   lowered to Medium to keep the game smooth."

The governor never raises, and acts at most once per hike: a later hike that is
still slow on the lower tier drops one more step then.

**The drop pauses the hike.** The switch is one synchronous rebuild (§9.5), and
the idle timing before it stops the loop too, even when the governor then stands
down. On a host, the world stops for everyone in the hike for as long as they
take; on a follower, that follower stops alone. The governor accepts that cost
because it acts at most once a hike, and only after a minute of play under 48
fps, when one pause costs the players less than more of the same.

## 11. Determinism

The tier is a `game/` value. `sim/` imports nothing but itself and `net/`
nothing from `game/` (`client/test/architecture.test.ts:74`, `:88`), so no tier
can reach the simulation or the wire, and `protocol.ts` has no field for one.
What differs between two peers on different tiers is only drawn: the
wildlife's visible disc (0.6× on low) and the director's sightings, which are
per-peer already; the clutter radius (boulders are drawn later on low, never
moved); shadows. `renderer.sync` reads the world state and writes none of it.

A test pins it (`client/test/game/tierDeterminism.test.ts`): one forest world,
one player, 120 ticks of a scripted walk, stepped four times, with no renderer
and with a `NullEngine` renderer on each tier calling `sync` after every tick;
the four `serializeWorldState` strings are equal, and every run's
`forest.passHash` is −311867473. Beside it the architecture test gains the
new modules by name: no file under `sim/` or `net/` imports `quality`,
`gpuSignals`, `gpuClass`, `tierChoice`, `frameProbe`, `governor`,
`rendererSwap` or `settings`.

## 12. Rollout and safety

### 12.1 Who moves, and what it costs them

| who | today | after | cost |
| --- | --- | --- | --- |
| Chrome ≥ 147 and the launcher, ≥ 16 GB, > 8 threads, integrated or base Apple GPU | high | medium or low by class | cheaper: they were on high by memory alone |
| the same, discrete RTX, RDNA or Apple Pro, Max, Ultra | high | high | none |
| Chrome < 147, discrete modern | medium | high | dearer: the second cascade, the scene pass and halation, full blades and litter; the GPU margin and the governor carry it |
| Safari on a Mac | low | probed from high: high, medium or low | dearer where the probe confirms it, at the heaviest pose before the first hike |
| Firefox | low | by bucket; the unknown buckets probed | dearer where the probe confirms it; the Intel buckets stay at low unless it does |
| a player with a choice | — | their choice | theirs |
| phones, tablets, software rasterisers | low | low | none |

### 12.2 The engine

Moving a Safari or Firefox player to medium or high moves them onto WebGPU where
the WebGPU rule is on and their adapter fits: Safari 26, Firefox 141 on Windows,
145 on Apple silicon. The WebGPU design's parity and frame gates run in Chrome.
Whether the rule should wait for those browsers is that design's call; this
design flags that the tier change widens who reaches it, and the fallback rules
of §9.4 apply to them as to everyone.

### 12.3 The nets

- The probe confirms every promotion that is not a named GPU, at the heaviest
  standard pose, on the player's own window.
- The governor lowers a named class that turns out not to hold, at once and
  for the hikes after.
- The setting lets any player overrule both, and says what Auto would pick.
- `DETECT_VERSION` retires every stored verdict at once when the tiers' costs
  move (the grass-frame and WebGPU work may).

## 13. Gates

On the reference machine (Apple M4, 8-core GPU, 16 GB), in Chrome, headless for
the frame rounds as every earlier note, seed `atmo`, mist, noon. The standard
poses are the canopy pose and the meadow pose `(369, 51.01, −855)`, yaw 0,
pitch 0.3. Frames by the near-grass pair method's page rule (the pose, 3 s to
settle, 8 s of intervals, mean and p95; quiet pages only), in two windows:
1920 × 1080 (a common full-screen viewport; the table row follows it) and 1200 ×
2029 (every earlier note's), device pixel ratio 1.

### 13.1 Detection on the reference machine

- `navigator.deviceMemory`, `hardwareConcurrency`, the renderer string and the
  adapter info as read, recorded; the class (`apple-base` expected) and Auto's
  tier (`medium` expected).
- `?probe=high`, three page loads per window: every reading and the verdict from
  the log. **Bar:** the verdict is the same on all three loads, and equals the
  class table's tier for the machine at 1920 × 1080; where it does not, the
  `apple-base` row moves to the verdict, with its test literal, before anything
  ships.
- The probe's reading against the pair method's figure for the same tier, pose
  and window: **within 1.0 ms**, which shows the opaque screen over the canvas
  does not change what is measured.

### 13.2 The frame per tier

Each tier at both poses in both windows, WebGL2, and WebGPU where the rule
reaches it. **Bar:** the tier Auto picks holds at both poses (mean ≤ 16.7 ms)
at 1920 × 1080; the next tier up does not (or Auto should have picked it).
Recorded as the first current medium and low figures (§4.2).

### 13.3 The settings

- Both entries open the one screen; its four choices in order, Auto chosen on a
  fresh profile, and the Auto line naming the machine's tier.
- A choice on the title screen survives a reload; Play then starts at it (the
  log line), and at High and Medium on the engine the WebGPU rule picks, WebGL2
  at Low.
- `?tier=high` shows the override line and disables Apply.
- A private window (storage refused): the storage line, Auto, a choice that
  lasts the page.

### 13.4 The live swap

In a solo hike and in a two-page party (host and follower, two browser
profiles on the same machine): pause, Settings, High → Apply, Low → Apply,
Medium → Apply, on the host and then on the follower; on WebGL2, and with
`?engine=webgpu` where the WebGPU work has landed. **Bars:**

- the synchronous stall (the long task around the swap) and the time to scene
  ready, each swap, at 1× and at 6× CPU throttling: reported;
- after each swap: `EngineStore.Instances.length` 1; the scene's meshes,
  materials, textures and observers equal to a fresh page's at that tier (± the
  instances the streaming rebuilt), read from `__scene` by the measurement
  patch;
- stills 1 s apart after the ground lifts: nothing appears or vanishes;
- Resume: the pointer locks on the first click, the view is where it was;
  under Chrome's touch emulation, the stick and look work;
- the follower stays connected through the host's three swaps (no
  "Reconnecting…", no session end) and its figure moves on the host's screen
  within 1 s of the ground lifting;
- zero console errors.

### 13.5 The governor

On Auto at medium with the measurement patch's `__engine.setHardwareScalingLevel(0.5)`
at the canopy pose: the drop is logged between 60 and 61 s after the hike's
session starts, the opaque screen covers the switch and the hike goes on at
low, the HUD line shows once, and Settings' Auto line says Low with nothing to
apply; a reload starts at low from the verdict. Opening the pause screen or
hiding the tab in that minute puts the drop off by at least the window it fell
in, since that window does not count, and a drop made as the pause screen
opens waits for Resume. Flying the free camera through that minute drops
nothing. Without the scaling, at a pose §13.2 found holding 60 Hz, nothing
happens in 5 min. In Safari with Low Power Mode
on, which draws at 30 fps, the first minute of play ends in the "held" line:
nothing is written, and the hike goes on at the tier it had.

### 13.6 The rest

- Safari on the reference machine: the class (`apple-unknown`), the probe on the
  first hike, its verdict, and the second hike starting at it with no probe.
  Not a frame gate: the pages cannot be run headless there.
- Firefox on the reference machine: the class (`apple-unknown`); no "Setting up
  graphics…" screen; the log line `quality probe: skipped, this browser compiles
  shaders on the page's thread; starting at medium (apple-unknown)` and the
  hike at medium; nothing stored under `dayhike.quality.auto`; the second hike
  the same (§7.1).
- The unit suite: the matrix of §6.4, the probe's steps, the governor's windows,
  the model tests of §8, the swap tests of §9, the determinism pin of §11.

## 14. Fallbacks

- The `apple-base` row moves to what §13.1's probe verdict says, low included.
- The probe's opaque screen distorts its reading (§13.1 over 1.0 ms): the probe
  renders visibly under a 50 % dark overlay instead.
- A display or a browser under 60 Hz is not probed (§7.4) and keeps the class's
  start tier; if reports show that start is too low for such machines, the hold
  bar becomes the display's own period, estimated as the median interval of a
  steady run of the landing backdrop (low tier, cheap enough to be capped).
- The swap's stall is over 3 s at 1× CPU on the reference machine: the pause
  Settings screen says so before Apply ("Applying pauses the hike for everyone
  for a few seconds.") when a host has peers.
- The governor fires on a machine the gate holds at 60 Hz: the limit 20.8 →
  22.2 ms (45 fps) and the windows 3 → 4.

## 15. Follow-ups

- `lodBias` and `textureMipCap`: wire them or delete them from `QUALITY`.
- Render scale as its own axis: a tier chosen for its features could run at a
  lower render scale rather than dropping a whole tier, and a scale is the one
  change a governor could make live without a rebuild.
- The WebGPU rule's reload after a lost device could become a live swap (§9.4).
- The device pixel ratio's change on a window moved between displays (§4.3): hold
  the tier's scaling against it.
- Once medium and low figures exist (§13.2), the named classes' rows can be
  checked against a second machine.

## Sources

1. Chrome Platform Status, "Update Device Memory API limits", shipping in 147: https://chromestatus.com/feature/6330376953921536
2. MDN browser-compat-data, `api/Navigator.json`, `deviceMemory` note: "From Chrome 147, reported values are 2, 4, 8, 16, and 32": https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json ; the blink-dev intent to ship and its move to 147: https://www.mail-archive.com/blink-dev@chromium.org/msg15917.html
3. MDN, `Navigator.deviceMemory` (limited availability): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
4. MDN browser-compat-data, `hardwareConcurrency`, Safari: "clamped to 4 or 8 cores": https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json ; WebKit PR 74374: https://github.com/WebKit/WebKit/pull/74374
5. Mozilla bug 1360039, `hardwareConcurrency` spoofed to 2 under `resistFingerprinting`: https://bugzilla.mozilla.org/show_bug.cgi?id=1360039
6. Renderer strings by browser and platform: https://deviceandbrowserinfo.com/learning_zone/articles/webgl_renderer_values ; this repository's `2026-09-16-grass-floor-verification.md` records `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`
7. Mozilla bug 1722113, "Expose sanitized UNMASKED_RENDERER as RENDERER" (Safari's "Apple GPU" since February 2020; bucketing since Firefox 91): https://bugzilla.mozilla.org/show_bug.cgi?id=1722113
8. Firefox's sanitiser, `dom/canvas/SanitizeRenderer.cpp`: https://searchfox.org/mozilla-central/source/dom/canvas/SanitizeRenderer.cpp
9. `WEBGL_debug_renderer_info` deprecated in Firefox: https://github.com/ruffle-rs/ruffle/issues/5279
10. WebGPU adapter identifiers design (vendor and architecture exposed, device and description empty by default): https://github.com/gpuweb/gpuweb/blob/main/design/AdapterIdentifiers.md
11. Dawn's `gpu_info.json` (architecture names; Apple reported as its highest "common" family): https://github.com/google/dawn/blob/main/src/dawn/gpu_info.json ; MDN `GPUAdapterInfo`: https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapterInfo
12. WebKit, "WebKit Features in Safari 26.0": https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
13. Mozilla Gfx, "Shipping WebGPU on Windows in Firefox 141": https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/ ; MDN browser-compat-data issue 28555 (Firefox 145, macOS 26 on Apple silicon): https://github.com/mdn/browser-compat-data/issues/28555
14. Firefox leaves `GPUAdapterInfo` blank: https://github.com/utof/repulsive-test2/issues/53
15. `navigator.userAgentData` is Chromium-only: https://caniuse.com/mdn-api_navigator_useragentdata
16. iPadOS's Mac user agent and `maxTouchPoints`: https://developer.apple.com/forums/thread/119186
17. Electron 44 (Chromium 152.0.7977.54): https://www.electronjs.org/blog/electron-44-0
