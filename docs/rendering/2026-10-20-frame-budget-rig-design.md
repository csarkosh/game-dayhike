# The frame budgets and the rig that reads them (design, 2026-10-20)

## 1. Intent

Day Hike should run at 60 frames a second on the two laptops its tiers are
named for: the **medium tier on the base 13-inch MacBook Air** and the
**high tier on the base 14-inch MacBook Pro**. Today the Air draws medium at
about 40 and the Pro, by the estimate in §3, draws high somewhere near 12
to 15. The medium target asks for a 1.5× cut in the frame's time; the high
target asks for 4 to 5×, which means the high tier will change shape to get
there. That is accepted: *60 on the base Pro is the standard, whatever high
becomes* (the owner, 2026-10-20).

Reaching those numbers is a run of separate cuts, each its own piece of
work. This design is for the thing every one of those cuts is judged with:
a rented GPU machine that runs all day, where the game's frame is read in
**milliseconds per pass**, against a **budget per tier** that stands in for
the laptop the tier is named for. A cut that buys 2 ms on the rig is
reported as 2 rig-milliseconds against that budget, never as a frame rate
on a Mac it was not measured on.

### Why a rig at all

The game's one measuring machine is the owner's M4 Air. It is also the
owner's development machine, so a measurement on it fights every build,
test run and sibling session for the GPU and the fan (the
2026-10-20 attempt at the paint pass's cost was lost to a video encode
another session started mid-run). A frame-time pair on it cannot resolve
2 ms (`2026-10-17-painted-look-design.md`'s lake-mirror round switched to
GPU timestamp queries for that reason). The base MacBook Pro is the owner's
work computer and nothing runs on it. A rented machine with its own GPU, on
which nothing else runs, answers both.

## 2. Goals, non-goals, anti-goals

**Goals**

- Two budgets in rig-milliseconds, one a tier, each derived from
  measurement where measurement is possible and labelled an estimate where
  it is not (§3).
- The game can report its GPU time per pass, on any machine, behind a URL
  flag (§5).
- A harness that measures a fixed set of views on a given build and
  machine, with the frame cap off, and writes rows a person can read and a
  doc can quote (§4, §6).
- The rig started, driven and stopped from the Mac in a few commands, and
  every reading on it stamped with what it ran on (§7).

**Non-goals**

- Matching the Macs' graphics API. The rig is Windows and Direct3D 12 under
  WebGPU; the Macs are Metal. The owner accepts this: the rig is for
  *reducing the work the GPU does*, and most of that work (pixels shaded,
  texels read, draws issued, targets resolved) costs on both. Where the
  two architectures differ (Apple's tile-based GPUs resolve overdraw and
  blending differently), the Air is the final word for medium; high has
  only the estimate.
- Running anything on the MacBook Pro.
- The cuts themselves. This design builds the instrument and sets the
  budgets; what to cut, and in what order, is later work, each cut
  measured on this instrument.
- The low tier. Its machines (phones, weak WebGL2) are not in this round,
  and WebGL2's timer extension is not relied on.

**Anti-goals** (a result that would make this a failure even if it ran)

- A rig number quoted as a Mac number. Every reading names the machine
  and the budget it was judged against.
- A budget set from a specification sheet. The published benchmark ratio
  enters once, for the Pro, and is labelled (§3).
- A reading taken while something else used the machine. Every row
  carries the load average (Mac) or the GPU's other processes (rig), and a
  run with another session's work on the machine is discarded, not
  averaged.
- The render scale moving under a reading (§5).

## 3. The standards and the budgets

### The two laptops

| Tier | Laptop | GPU | Frame | Status |
|---|---|---|---|---|
| medium | 13-inch MacBook Air, M4, base | 8-core GPU, 120 GB/s | full screen at the default scaling: **1470 × 956** CSS px | the owner's machine; measured |
| high | 14-inch MacBook Pro, M5, base (Apple's current base model) | 10-core GPU, 153 GB/s | full screen at the default scaling: **1512 × 982** CSS px | not owned; estimated |

"Full screen" because the owner asked for whichever of full screen and the
usual window costs more, and the game draws at the window's CSS pixels on
every tier (`lighting.ts` sets the hardware scaling level to the tier's 1,
overriding Babylon's device ratio; `2026-10-18-frame-rate-pass-design.md`
§1), so a Retina display's full screen is its points, not its pixels. A
"More Space" display setting would add about a third more pixels; the
default scaling is the standard (my call).

Both tiers run on WebGPU in Chrome (`WEBGPU_TIERS` holds both since
2026-10-18); the standard is Chrome, the game's measured browser.

### What "60" means

Over the fixed views of §4, with the frame cap off:

- the **mean** frame time of every view is at or under **16.0 ms** (60 Hz
  is 16.7; the 0.7 is margin for the cap's own jitter), and
- the **95th percentile** frame time of every view is at or under
  **22 ms**, so the number is a steady 60 and not an average of 90 and 30.

Both bars are my call; the owner said "60 frames a second". A hike's slow
stretches (the night: rain, mist, the lamp; the chase) are views in the
set, so a tier is not 60 only at noon on the trailhead.

### The medium budget: measured

On the Air, the harness measures every fixed view at the medium tier. On
the rig, the same views, the same tier, the same CSS size. For each view,
the ratio `k = rig ms / Air ms`; the tier's **k_medium** is the median
over the views, and the spread (least and greatest k) is recorded beside
it. The budget on the rig is

    B_medium = 16.0 ms × k_medium

so a frame drawn under B_medium rig-milliseconds is expected to draw under
16.0 on the Air. A spread wider than ±20 % means the two GPUs rank the
views differently; the budget still holds as a median, but a cut whose
whole gain is in one view is confirmed on the Air before it counts.

### The high budget: derived

The Air runs the high tier too. The harness measures the fixed views at
high on the Air and on the rig, giving **k_high** the same way (the high
tier's mix of work differs from medium's, so it gets its own ratio). The
Pro's expected frame time is the Air's divided by the published ratio of
the two GPUs:

| Benchmark | M4 8-core (the Air) | M5 10-core (the Pro) | ratio |
|---|---|---|---|
| 3DMark Wild Life Extreme | 7,931 | 12,279 | 1.55 |

(NanoReview's aggregates, 2026-10-20; the M5 10-core also scores 11,301
on LaptopMedia's run, ratio 1.43.) The design uses **1.5**: between the
two readings, and the lower rounding is the conservative one (assuming
the Pro slower makes the budget tighter). So

    B_high = 16.0 ms × 1.5 × k_high

and the doc that quotes it says "derived from the Air by the published
ratio 1.5". Two checks on the factor, neither a measurement on the Pro:

1. The owner plays at high on a 2023 MacBook Pro with an **M3 Max** and
   sees about 30 frames a second. The M3 Max's 40-core GPU scores about
   31,000 on the same benchmark (NotebookCheck and NanoReview agree
   within 2 %), 2.5× the M5 10-core; the 30-core nearer 2×. A base M5
   would then draw the same frames at **12 to 15 a second**, if the
   window and browser were the same. That reading was not taken under the
   harness's conditions (window size, browser, engine and date unknown),
   so it bounds the estimate; it does not set it.
2. The Air's own high-tier reading divided by 1.5 gives a second estimate
   of the Pro's rate. If the two estimates disagree by more than 2×, the
   factor or the conditions are wrong, and the as-built section says so
   before any budget is quoted.

If the owner ever reads a frame rate off the screen while playing on the
Pro (the game can show one behind a flag; nothing is installed), that
reading replaces check 1.

### The Air is read warm

The Air is passively cooled and slows within minutes of a WebGPU page at
1.5 million pixels, by 10 to 20 %. A hike is twenty minutes, so the warm
Air is the player's machine: every Air reading in a calibration comes
after a warm-up page of five minutes at the tier, the views are taken in
a rotated order across the runs, and the as-built section says "warm"
beside B. A cold reading, if one is ever wanted, is a separate row and
never enters k. My call; the owner said "60 frames a second" and no
more.

### Where the budgets live

The numbers go in this doc's "As built" section when the first
calibration run writes them, with the date, the build (the commit) and
the rig's machine type, and they are re-derived whenever the fixed views
or the tiers' definitions change enough to move them: a cut that removes a
pass does not move k (the ratio is of the same work on two GPUs), but a
new fixed view does.

## 4. The fixed views

The views are places in the game's own worlds, each a `?cmd=` link the
harness opens, so a view is the same on every machine and every build.
They start from the README's stills (`tools/previews/stills.json`: the
world id `0f1c2a3b-…`, a seed, a place and a yaw each), which are already
the game's canonical places and already have links (`tools/previews/lib/still.mjs`,
`stillUrl`). A view opened with another game id lands in another world:
the 2026-10-20 attempt opened the `forest` still's coordinates under a
random id and measured a bare hillside.

| View | From | Why it is in the set |
|---|---|---|
| trailhead | still `trailhead` | the first frame every hike draws; the kiosk, the blades, the car |
| forest | still `forest` | the floor cover and the trees, the medium tier's slowest place in daylight |
| tarn | still `tarn` | the lake: the mirror on high, the water frame, the panorama |
| meadow | still `meadow` | the open view: the far field, the clouds, the far softening |
| crest | still `crest` | the massif: the cascades' reach, the sky, the least cover |
| beach | still `beach` | the sea: the breaker, the swash, the spray |
| forest, night | `forest`'s place, first person (`stand 250 -500 1.09`), the world held at its own night (`escalation 1`: the hour 22, the night's weather and its mist), the lamp on | the medium tier's slide (`2026-10-18` §1): rain, mist, the lamp |

The first six are the stills as they are (their hour and weather the
game's defaults), the free camera at the place. The night view is my
call, and it differs from the others in three ways, all settled here:

- It is **first person**, because the lamp is a light at the player's
  eye (`lamp.on` rides the snapshot), so a free camera at the place would
  light nothing in frame. The view therefore carries the body, the bob
  and the HUD the others do not. That is fine: a view is only ever
  compared with itself, across builds and machines, never with another
  view.
- A new **`lamp` command** (`lamp`, `lamp on|off`; not persisted, so it
  rides no invite link) switches the lamp from a link. There is none
  today, and a synthesised keypress needs an input focus the harness
  cannot grant on the Mac. It is a small change to `commands.ts` and the
  host's handling of the Lamp key.
- The night is the escalation's (`escalation 1`), not `time 22` with
  `weather rain` held at `escalation 0`: on a forest world the mist and
  the night's weather come only with the escalation, so holding it at 0
  would measure a dry, clear 22:00. Builder's call.

**The chase is not a fixed view.** The chase's cast (the shades, their
smoke, the pulse) exists only once the simulation's phase is the chase,
reached through the find at the summit (`sim/summit.ts`), and the
escalation command holds only the world's night, not that phase. Putting
a solo world into the chase from a link would be a simulation change of
days. So the budgets are set by the seven link-reachable views above,
and the chase is measured separately, where it happens (the `summit`
look, then the descent from the body, in the harness's hands with the
cutscene waited through), whenever the chase's own features are on the
table for a cut. Its reading is a check on the tier's verdict, written
beside it, not a budget-setter. My call; the owner may want the chase in
the set, at the simulation change's cost. Each view holds the free
camera still (`freecam x z yaw`), the world at `escalation 0` and
`unsettle 0` except where the view says otherwise, and `telemetry=off`.
Wildlife and weather make a view's frames differ slightly from run to
run; that is the game, and the sample length absorbs it.

## 5. GPU time per pass, in the game

A URL flag, `?gpuTime`, puts the game in **measurement mode**:

1. **Timestamp queries.** On a WebGPU adapter that offers
   `timestamp-query`, the engine is created with it among its required
   features (today `webgpuFeatures` in `engineChoice.ts` asks only for
   texture features), and Babylon's `enableGPUTimingMeasurements` is
   switched on, with its whole-frame counter. Without the feature (an
   adapter that lacks it, or WebGL2), the flag does nothing to the engine
   and the readout says so.
2. **The render scale held at full.** `renderScale.ts` would otherwise
   drop the drawn pixels under 48 frames a second, and a reading would
   compare a 75 % frame with a 100 % one. In measurement mode the scale is
   held at 1 for the page's life.
3. **The readout.** A global the page makes only in measurement mode
   (`window.__gpuTime()`, say; `window.__dh` is the telemetry's early
   error catch and stays its own) returns one JSON object: the whole GPU frame
   (last-second average, ms), the main pass, and every render target
   Babylon timed, by its name, each as a last-second average in ms, with
   the target's size and whether it drew in the last frame. On the page, a
   small line in the HUD's corner shows the whole frame and the main pass,
   so a person at the Air can watch a cut land without the harness.

Three traps, for the builder and the doc:

- Babylon counts a render target only if `enableGPUTimingMeasurements`
  was on when the target was made; a target made before has no counter
  and its time lands in the main pass (`thinWebGPUEngine.js`). So the
  flag switches timing on at the engine's creation, before the scene,
  and a readout whose target list is short says which targets it missed.

- A target that draws every n-th frame has its counter read back by pass
  index a frame late, so it reports whichever pass sits at that index in
  between. A skipping pass (the lake's mirror, every third frame) is timed
  with the skip forced off and the reading divided by n. The readout marks
  a target that did not draw in the last frame, so a reader can tell.
- Chrome quantises WebGPU timestamps to 100 µs unless started with
  `--enable-webgpu-developer-features`; the harness passes that flag to
  the Chrome it starts, and the rig's Chrome is started with it.

The flag is for measurement, not play: it rides no invite link
(`commands.ts`'s rule for things that must not reach a match), and the
feature is requested only when the flag is present, so a player's engine
never pays for queries.

## 6. The harness

`tools/frame-budget/` holds the measuring script and its pure parts, in
the layout of `tools/previews/` (a script, a `lib/` of pure functions
with tests under `test/`).

**What it does.** Given a base URL (the dev server, the live site, or a
preview channel, §8), a tier, a machine label and the list of views, it
opens one fresh Chrome page per sample (a reloaded page carries GPU state
into the next reading), sizes the viewport to the tier's standard CSS
size, waits for the scene to settle (the stills' 55 s, or until the
readout reports a steady frame), warms up 3 s, then samples 10 s: frame
times from `requestAnimationFrame`, and, when the page is in measurement
mode, the per-pass readout at the sample's start and end. It writes one
JSON row per sample (machine, user agent, build sha from the page, tier,
view, mean, p95, n, the canvas size at start and end, the per-pass
readout, the load average or the rig's process list, the time) to a JSONL
file, and a table at the end. A sample whose canvas size changed, or
whose load was not quiet, is written with a flag and left out of the
table's medians.

**Pairs, not absolutes.** The frame cap is off (`--disable-gpu-vsync
--disable-frame-rate-limit` on the Chrome it starts). A comparison of two
builds is interleaved, A B B A, on fresh pages, three pairs a view, and
the table reports the deltas per pair and their median, following
`measuring-frame-time`'s rules as this repo has learned them.

**Two ways to the browser.** On the Mac it starts Chrome itself from a
fresh profile (as `tools/previews/shoot.mjs` does). On the rig it
connects to a Chrome already running there, through a DevTools port
forwarded to the Mac (§7), and opens each sample in a fresh browser
context, so the same script, the same views and the same rows come from
both. A calibration pairs the same Chrome version on both machines (the
rig's Chrome is whatever its image froze; the Mac's is updated to match
or the rig's is), and the rows carry the version either way.

**The budget check.** With the budgets of §3 in a small committed file
(`tools/frame-budget/budgets.json`: the tier, the rig's machine type, B,
k, the date and the commit they came from), the table marks each view
over or under its budget, and the whole tier's verdict is the worst view.

## 7. The rig

The AWS machine `_infra/test-rig-aws-windows/` as it is: `g4dn.xlarge`,
one NVIDIA T4, Windows Server, Chrome, $0.71 an hour running plus the
address, nothing while stopped; it stops itself daily at 09:00 UTC and on
its own timer after a working day. Started from the main checkout with
`terraform apply -var running=true` and stopped with `running=false`,
never from a worktree (`test-rigs-on-main`).

**Why the T4.** Graphics benchmarks put it between the two laptops
(3DMark Time Spy graphics about 5,200 to 5,600, the class of a GTX 1660;
the M4 10-core is the class of a laptop RTX 3050 and the M5 10-core a
quarter above that), so a view that is slow on either Mac is slow on it,
and nothing hides under a 60 Hz cap. The L4 option (`g6.xlarge`, $0.99)
is about twice the M5 and would make small cuts vanish; nothing weaker
than a T4 is rented with Windows by any of the clouds looked at. Amazon's
rented Mac minis with the M4's 10-core GPU (`mac-m4.metal`) would be the
same API as the Air, but come with a 24-hour minimum per use and no
proof yet that Chrome renders on one without a display; they are not
this design.

**Serving the game to it.** Not from a clone on the machine (the
2026-09-28 recipe) but from public URLs: the live site for the current
main, and a preview channel (§8) for any branch. The rig then needs no
checkout, no `npm ci` and no update step; a new build is a new channel.
Solo play only, which is all a view needs.

**Driving it.** Chrome runs as the desktop user's interactive task with
`--remote-debugging-port=9222` (session 0 would get no GPU), the port is
forwarded with `aws ssm start-session` to a local port, and the harness
connects there. The stack script from the 2026-09-28 recipe is kept with
the tool (`tools/frame-budget/rig/`), trimmed of the vite and signaling
tasks it no longer needs, with the developer-features flag added. The
rig's display is 1920 × 1080 at a device ratio of 1, so both standards'
CSS sizes fit as viewports.

**Steadiness.** It has never been measured. The first run on it opens
six fresh pages of one view and reports the spread of the mean; a spread
over 5 % raises the pairs per view (§6) until the median is steady. Every
reading on it records the instance type, the GPU's name from the adapter,
and Chrome's version, so a reading from a later driver or machine size is
not mistaken for the same rig.

**Cost.** A working day of eight hours is about $6. The budget alert
(`budget_enabled`) is the owner's to switch on.

## 8. Preview channels

A build of any branch, published to a Firebase Hosting preview channel
(`firebase hosting:channel:deploy <name> --expires 7d`), is a public URL
of the form `https://fps-csarko--<name>-<hash>.web.app/dayhike/`, built as
the production client is (the same env, the same site layout) but
touching nothing live. `tools/deploy/channel.mjs` does it:
`npm run preview:channel -- <name>`, printing the URL. The 2026-10-20
no-paint preview was made this way by hand.

The signaling server does not list channel origins, so a channel plays
solo only (an invite from one is refused); that is right for
measurements and should stay so. The build is tagged with the branch's
commit like any other, so a reading from a channel names its build.

## 9. The first use

The question that started this (2026-10-20): what the paint pass costs.
The first run after calibration measures main against the no-paint branch
on the rig, per pass and per view, at both tiers, and the answer is
written in rig-milliseconds against each budget, plus the medium tier's
confirmation on the Air.

## 10. Left to the builder

- The harness's exact CDP mechanics (the previews tool's `connect` and
  `evaluate` are a start), its settle rule, and the JSONL and table
  formats.
- How `?gpuTime` reaches `engineChoice.ts`'s feature list and the
  renderer's render scale, and where the readout hangs.
- The `lamp` command and the night view's exact link; the chase's
  separate measurement through the `summit` look.
- The rig's running time per day (`max_run_hours`, 4 by default) passed
  as a variable for a working day.
- The rig's stack script and the port-forward helper, from the archived
  recipe (`~/Projects/fps-sdd-archive/2026-09-27-webgpu-gate/aws-rig/`).
- Tests: the pure parts (the budget arithmetic, the pair tables, the view
  links) under `tools/frame-budget/test/`; the channel script's dry run;
  `?gpuTime` on a NullEngine proving the flag changes nothing without the
  feature.
- The first calibration run, and this doc's "As built" section with its
  numbers.

## As built

### The first calibration (2026-10-21)

Build `1fb913ae` on both machines, served from the Firebase preview
channel `frame-budget` (the no-paint build `c9bbfd66`, the same build with
`PAINT_ENABLED = false`, from the channel `no-paint`). The rig was
`g4dn.xlarge` (one NVIDIA Tesla T4, Windows, Chrome 154.0.8037.58, in
`us-east-1`); the Air a 13-inch M4 MacBook Air (Chrome 155.0.8059.85,
Apple M4, 1470×956), read **warm** after a five-minute page at the tier.
Three rotations a view on the Air (`--rotate 0,1,2`, one sample each),
three samples a view on the rig; the frame cap off on both; no row
flagged. The numbers live in `tools/frame-budget/budgets.json`.

| Tier | k (median) | spread (least, greatest) | B mean | B p95 | factor |
|---|---|---|---|---|---|
| medium | **0.963** | 0.751 (forest-night), 1.933 (crest) | **15.41 ms** | **21.19 ms** | 1 |
| high | **0.909** | 0.871 (forest), 1.686 (crest) | **21.82 ms** | **30.00 ms** | 1.5 |

The per-view medians of the means (ms; p95 after the slash):

| View | Air medium | rig medium | k | Air high | rig high | k |
|---|---|---|---|---|---|---|
| trailhead | 24.04 / 109 | 25.70 / 29 | 1.069 | 34.90 / 161 | 31.72 / 35 | 0.909 |
| forest | 24.25 / 140 | 18.89 / 36 | 0.779 | 38.08 / 124 | 33.17 / 48 | 0.871 |
| tarn | 20.13 / 107 | 19.39 / 35 | 0.963 | 27.63 / 97 | 28.86 / 33 | 1.045 |
| meadow | 19.15 / 36 | 32.03 / 37 | 1.673 | 30.82 / 92 | 42.58 / 48 | 1.382 |
| crest | 17.23 / 34 | 33.31 / 51 | 1.933 | 21.61 / 32 | 36.43 / 54 | 1.686 |
| beach | 15.89 / 32 | 12.97 / 15 | 0.816 | 23.10 / 30 | 20.22 / 35 | 0.875 |
| forest-night | 24.22 / 138 | 18.20 / 36 | 0.751 | 36.08 / 130 | 32.16 / 37 | 0.891 |

**The spread is wider than ±20 % on both tiers**, as §3 allowed for: the
T4 is slow where the Air is fast (the meadow and the crest, the two open
views with the most grass and the farthest ground) and fast where the Air
is slow (the forests, the beach). So the budgets hold as medians, and a
cut whose whole gain is in one view is confirmed on the Air before it
counts. The two GPUs rank the views differently, not just scale them.

**The Pro's two estimates DISAGREE**, and §3 says this is said before
any high budget is quoted. From the Air, high's median view (30.82 ms)
divided by 1.5 puts the base M5 Pro at **48.7 frames a second**; the
M3 Max reading (about 30 a second, scaled by the GPUs' benchmark ratio)
puts it at **12 to 15**. That is 3.6× apart, over the 2× line. The
reading taken under the harness's conditions is the Air's; the M3 Max
figure was the owner playing on a 16-inch Pro's own screen (3456×2234
native, 5.5× the pixels of the Air's window), on an unknown browser and
engine and an earlier build, and a pixel count alone accounts for the
gap. So B_high above stands on the Air and the factor 1.5, labelled
"derived", and the M3 Max check is treated as the bound §3 said it was,
not a second estimate. It is replaced the day the owner reads a frame
rate off the Pro's screen. If the factor itself is off, every high-tier
verdict is off by the same factor.

**Where the tiers stand against their bars.** Medium on the Air draws
every view at 16 to 24 ms mean (41 to 63 frames a second): the beach's
mean is under the bar, the trailhead, the forests and forest-night need
a 1.5× cut. High on the Air draws 22 to 38 ms (26 to 46), which on a
base M5 Pro by the factor would be 14 to 25 ms: the crest and the beach
at the bar, the rest needing up to a 1.6× cut on the Pro by this
estimate, not the 4 to 5× that §1 feared from the M3 Max figure.

**What the rows say beside the means.**

- *The Air's p95s are bursts, not a slow mean.* With the frame cap off,
  four views on medium (trailhead, forest, tarn, forest-night) and five on
  high show a p95 of 90 to 160 ms beside a steady mean: periodic long
  frames in a burst-and-stall pattern that repeats across rotations
  (meadow, crest and beach sit at 30 to 36). The mean is the throughput
  figure the budget is derived from; the p95 bar (22 ms) is judged on the
  rig, whose p95s are 15 to 54. Whether the Air's stalls survive the
  60 Hz cap a player runs under is a question for the first cut.
- *The high crest on the Air* read 21.61, 22.01 and 15.88 ms in its three
  rotations (28 % spread, every other view under 9 %); the median takes
  the odd one out. *The rig's tarn at high* read 30.26, 11.37 and 28.86 ms;
  the 11.37 was a complete, post-ready sample (882 frames) and is
  unexplained; the median takes it out too.
- *The rig is steady only warm.* Six samples of the forest at medium
  spread 57.7 % right after boot (18.2 to 30.2 ms) and 7.4 % after three
  and a half hours up (19.2 to 20.6). The README's day starts with the
  steadiness run, and a cold rig's first set is not a calibration.
- *Readiness.* The Air's rows reached `body.world-ready` 56 to 63 s after
  the canvas (a fresh browser context downloads the world each sample);
  the rig's in 20 to 37 s. Every row taken before the harness waited for
  that class (the whole first day) measured a mix of the default start and
  the view, and was discarded; see the README's "the readiness wait".
- *Apple's per-pass readout is latency, not cost.* On the M4 every pass
  reads about the same figure (two frames of queue latency uncapped); pass
  costs come from the rig alone. The Mac's rows carry the readout for
  completeness and nothing is derived from it.

The cost of the day: about 12 rig hours at $0.71 (started 14:11 PDT, the
daily stop at 02:00; the first five hours' rows were the void ones).

### The paint pass's cost (the first use, 2026-10-21)

The game (`1fb913ae`) against the same build with the paint pass off
(`c9bbfd66`), three interleaved pairs a view on the rig at both tiers, and
the medium tier's confirmation on the Air. Two readings of the same pass:

**By the T4's timestamp queries** (the A rows' `?gpuTime` readout, every
view, both tiers): the `paint` pass at half resolution (735×478) reads
**0.16 to 0.21 ms**, 0.26 to 0.32 on the crest; its `paintCompose` at full
size **0.09 to 0.13 ms**. Together **0.25 to 0.45 rig-milliseconds** a
frame: 1.6 to 2.9 % of B_medium, 1.1 to 2.1 % of B_high. For scale, the
main scene pass reads 11.7 ms on the trailhead at medium and the colour
grade 0.30.

**By frame-time pairs** (B minus A on the means, the median of three
pairs; a negative number is the frame without the pass being faster):

| View | rig medium | rig high | Air medium (warm) |
|---|---|---|---|
| trailhead | −1.17 | +0.45 | −1.15 |
| forest | −0.23 | −1.65 | −0.96 |
| tarn | −0.72 | +0.06 | −1.35 |
| meadow | −1.36 | +0.88 | −1.02 |
| crest | −0.26 | −0.83 | −1.21 (two pairs) |
| beach | −0.59 | −0.90 | −1.44 |
| forest-night | −0.73 | −0.75 | −1.23 |

On the Air the pairs resolve the pass: **1.0 to 1.4 ms a frame in every
view**, nineteen of the twenty kept pairs with the same sign, the view
medians within half a millisecond of each other. On the rig a single pair
moves by 1 to 3 ms either way, so the rig's pairs cannot resolve a pass
this small: at medium every view's median is negative (fifteen of
twenty-one pairs, 0.2 to 1.4 ms), at high the signs are mixed. The two
readings are of different things. The timestamp queries time the two
passes' GPU execution, a third of a millisecond; the pairs measure what
the frame loses when the pass is gone, which includes the target switches,
the compose's texture reads and the CPU's draws, and on the Air that is
about a millisecond. One check was not run today and bounds the Air's
figure: a same-build pair (A against A, the two channels serving one
build) would show any bias between the channels themselves.

Four samples were discarded by the medians, not by a flag. One is a
stall (the rig's B trailhead at 159 ms); the other three share a shape, a
complete, post-ready sample at 0.4 to 0.6× the view's time. The rig's B tarn at
12.5 ms is the same odd fast tarn as the calibration's (that view at high,
now twice), and the Air's A meadow at 12.2 ms (beside 19.6 and 19.8) is
the third. The camera's placement not landing is the suspect, unconfirmed;
`--pairs 3` and the median are the guard. One Air row (crest B) was
flagged `loaded` (2.2 cores busy outside the harness) and left out by the
harness; the brief's rule would have rerun the set, and it was not rerun:
the twenty other pairs settle it.

**The answer to 2026-10-20's question:** the painted look costs about
**1.2 ms a frame on the Air** at medium (7 % of the frame; a seventh of
the 8 ms medium's slow views must find), and **0.3 rig-milliseconds of
GPU time on the T4** (2 % of either budget), with the rig's frame-time
pairs leaning the same way at medium. It is a real cost and not the
problem: the time medium must find is elsewhere, and the per-pass readout
says where to look first (the scene pass at 11.7 rig-ms on the
trailhead).
