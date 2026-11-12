# Frame budget

The game's frame time, measured the same way every time. `measure.mjs` opens each fixed view of
`views.json` on a fresh page at a tier's standard size, waits for the page's readiness class
(`body.world-ready`, set once the world is in and the URL's looks are applied), settles 30 s, warms
it for 3 s, then times its frames for 10 s with the GPU readout (`?gpuTime`) read at the start and the end. Each
sample is one JSON row appended to a JSONL file in `runs/`, and the run ends with a table of each
view's medians and a verdict that names what it judged against. A rig run (`--remote`) is judged
against the tier's budget in `budgets.json`, which is in the rig's milliseconds; a run on the Mac
against the bars themselves, medium at 16.0 ms mean and 22 p95, high at those times the factor 1.5
(24.0 / 33.0, the Pro's bars carried to the Air). The verdict is information: the script exits 0
over budget or under. The options are in the header of `measure.mjs`.

Two machines measure:

- **The Mac** (a 13-inch M4 Air): the medium tier's standard. Frame time is the measure.
- **The rig** (a rented Windows machine with an NVIDIA T4, `_infra/test-rig-aws-windows/`): the
  per-pass GPU costs, and the high tier's frame times. About $0.71 an hour, so about $6 a working
  day.

The high tier's standard, the base M5 Pro, is not measured. It is derived from the Air's numbers by
the published ratio, 1.5.

## The Mac's run

An otherwise idle Air: close everything else, and let it cool between runs. The script starts
Chrome itself from a fresh profile.

```bash
npm run frame-budget -- --base <url> --tier medium --machine air-m4 --warm 300 --rotate 0
```

Run it three times, `--rotate 0`, `--rotate 1`, `--rotate 2`, so a run's drift falls on different
views. `--warm 300` keeps the first view open for five minutes before its first sample, so the Air
is warm when the numbers start. Each sample waits for `body.world-ready` and then settles 30 s. A
sample's page starts with the game's stored state cleared (its remembered tier, engine fallback,
name and translated shaders) but with the profile's HTTP cache kept, so a Chrome downloads the
build once and every later sample reads it from disk; until 2026-10-29 each sample had a context
of its own and downloaded the world again (readiness took 56 to 63 s on the Air then, 20 to 38 s on
the rig, and a month of rounds moved 135 GiB from the hosting). The row records readiness as `readyS`. The wait is there because the page applies the URL's script (seed,
camera, escalation) only once the world is ready: a fixed sleep sometimes timed the default start
(5 to 9 ms a frame) and sometimes the real view (19 to 26 ms), and the Air's rows came out
bimodal. A run with loaded rows is discarded, not averaged: `rm` its file and
run again.

## The rig's day

The Mac needs the AWS CLI and its Session Manager plugin (`session-manager-plugin`), which the port
forward in step 4 runs through.

1. **Make the rig**, first thing, with the owner's go-ahead (since 2026-10-29 a rig is made from
   its image for the day and ends itself after, disk and all, so nothing bills between days):

   ```bash
   tools/rig/session.sh up 1 --channel <name>
   ```

   It applies the rig from the main checkout's root (about 8 minutes to Chrome), builds the WGSL
   maps meanwhile, publishes the channel, opens the forward on 9333 and prints when Chrome
   answers: steps 2 to 4 below, done. Its logs go under `rig-sessions/<date>/` on the lab disk.
   The steps are kept here for doing them by hand; `terraform output instance_id` names the
   machine.

2. **Publish the build to a channel**. The address is the last line printed.

   ```bash
   npm run preview:channel -- <name>
   ```

3. **Start Chrome on the rig**, as `hiker` with a debugging port on 9222:

   ```bash
   aws ssm send-command --region us-east-1 --instance-ids <instance id> \
     --document-name AWS-RunPowerShellScript \
     --parameters "$(jq -Rs '{commands: [.]}' tools/frame-budget/rig/start-chrome.ps1)"
   ```

   Read the command's output, with the `CommandId` that `send-command` printed:

   ```bash
   aws ssm get-command-invocation --region us-east-1 --command-id <command id> --instance-id <instance id>
   ```

   It prints Chrome's `/json/version` and the listening port. It stops any Chrome and any earlier `frame-budget-chrome` task first, so
   it can be run again.

4. **Forward the port**, in a second terminal, left running:

   ```bash
   tools/frame-budget/rig/forward.sh <instance id>
   ```

   The rig's 9222 is the Mac's 9333. A second argument picks another local port.

5. **Check the rig is steady**: six samples of one view and the spread of their means.

   ```bash
   npm run frame-budget -- --base <channel url> --tier high --machine g4dn.xlarge --remote 9333 --steadiness --views forest
   ```

6. **The runs**, both tiers:

   ```bash
   npm run frame-budget -- --base <channel url> --tier medium --machine g4dn.xlarge --remote 9333
   npm run frame-budget -- --base <channel url> --tier high --machine g4dn.xlarge --remote 9333
   ```

   The machine's label is the instance type, so every row names the machine it was taken on. As
   on the Mac, each sample waits for `body.world-ready` and then settles 30 s; `--settle <s>`
   changes the settle (a view's `extraSettleS` is added to it).

   `--remote` is refused unless the Chrome behind it says Windows NT, so a run cannot be pointed
   at the Mac by mistake.

7. **End the rig.** A running machine bills by the hour, and an ended one nothing:

   ```bash
   tools/rig/session.sh down
   ```

   Left alone, it ends itself fifteen minutes after the last harness and forward left it
   (`rig/idle-stop.ps1`), or at its run cap. `terraform apply -var running=false` still parks a
   machine with its disk ($4 a month), for the rare day its disk is wanted tomorrow.

## Several rigs at once

One Chrome runs one experiment at a time, so a round of ten or twenty experiments is run on as
many machines as there are experiments to run side by side: `rig_count` in
`_infra/test-rig-aws-windows/` (its README, "Several machines at once") makes copies of the rig,
`terraform output -json forward_commands` prints one forward a machine (local ports 9333, 9334, …),
and the chain spreads a queue of experiments over those ports, each port taking the next job as it
comes free:

```bash
node tools/frame-budget/rig/chain.mjs --queue round.json --ports 9333,9334,9335 --dry-run   # the jobs and the round's length
node tools/frame-budget/rig/chain.mjs --queue round.json --ports 9333,9334,9335
```

`round.json` names the base build and the experiments, each with its `against` build, `views`,
and `tier` (both tiers unless one is named); the header of `rig/chain.mjs` has the shape. A job is
one `measure.mjs` run with `--remote <port>` and `--out runs/<name>-<tier>.jsonl`, capped by its
page loads; one that fails (a forward that dropped under it, a page that never came ready) goes
back on the queue once, its partial rows kept beside the file. `rig/forward.sh` reopens a forward
that ends, so a dropped tunnel costs a sample, not an evening. A rig is stopped by itself after
fifteen minutes without a harness on its port once `rig/idle-stop.ps1` has been run on it (once;
an image keeps it).

A round in one command, the rigs started, forwarded, measured on and stopped:

```bash
tools/frame-budget/rig/round.sh round.json             # as many rigs as the queue has jobs (at most 10)
tools/frame-budget/rig/round.sh round.json --rigs 4    # or a count of its own
```

It sets `rig_count` to the queue's job count (an experiment on two tiers is two jobs; `--max-rigs`
caps it; a machine is 8 minutes and $0.10 from the image, so the count is the round's own), applies
`running=true` from the main checkout's root, opens one `forward.sh` a machine on 9333, 9334, …,
runs the chain over every port, and ends every machine (`tools/rig/session.sh down`) when it ends,
however it ends (`--keep-running` leaves them to their idle watchdog, which ends each fifteen
minutes after its last harness). The round then waits for its slowest machine's start and its
slowest job, not for the sum of its jobs. Making machines is an apply: the owner's go-ahead is the
rule for a round as for one machine. The forwards' logs go under `rig-sessions/<date>/` on the lab
disk (`DAYHIKE_LAB`), never this Mac's own.

Every remote run first closes the rig Chrome's pages but its blank one (`closeStrayPages`): a
forward that dropped mid-sample leaves that sample's page drawing, and the retry beside it read
every frame at half speed (46 ms against 24, 2026-10-24).

`--engine webgpu` forces the engine on every page: for a rig whose Chrome runs on Linux, which the
game's own rule would put on WebGL2 (`docs/rendering/2026-10-22-parallel-rigs-research.md` §4).

## A scene's frames, one by one

The views above time ten settled seconds of a place. What happens as a world changes (the summit
scene, the chase after it) is timed by `timeline.mjs`, where a hitch is the measure and a mean is
not: on a rig's Chrome it stands the player 30 m down the stem from seed atmo's body, waits out a
settle (75 s puts the night where a climb leaves it; the world eases over 20 s), walks them the
last metres so the find comes as a match's does, and keeps every frame's time from before the find
to the end of the chase's first minute, with the page's long frames, the pipelines' report
(`dayhikePipelines`: asked, landed, frames held), the WGSL lookup's counters (`dayhikeWgsl`: the
stages the shipped maps had, and those translated in the page), the GPU readout once a second and,
with `--profile`, a CPU profile. `--climb <s>` is the same sprint with no find, the chase's control;
`--approach escape` plays the end scene instead (the console's `escape`) and times 30 s of it.
`--climb <s> --walk` walks instead of sprinting, and `--stand "x z yaw"` moves any of them (a
forest: `250 -500 1.09` on seed atmo). `--intro <s>` is a start as a player meets it: the landing
page, Play clicked, and that many seconds kept from the click (the page's frames, the film's
presented and dropped frames, the world's readiness as a mark); `--cold` empties the site's cache
and storage first, a first visit. With `--phone --remote 9222 --tier low` the intro is timed on a
phone's Chrome over the cable ("The phone", below), at the phone's own size, Play tapped.

```bash
node tools/frame-budget/timeline.mjs --base <url> --out <dir on the lab disk> --remote 9333 --label base --settle 75 --profile
node tools/frame-budget/timeline.mjs --base <url> --out <dir> --remote 9334 --label base-webgl2 --engine webgl2 --settle 75 --profile
node tools/frame-budget/timeline-report.mjs <dir>/base.json --maps <the build's client/dist/assets> --worst 10
```

`timeline-report.mjs` reads a run back by stretch (the approach, the scene's five shots, the chase
ten seconds at a time): frames, mean, median, p95 and worst, the share of frames over a 60 Hz
frame, the stalls (over 50 ms) and freezes (over 250 ms); the seconds the screen was held on one
image; the shaders translated in the page; each streaming shell's milliseconds a frame and what
ran late; a film's frames by stretch, and its pauses by two measures (`lib/film.mjs`): the steps
its clock fell behind the page's (`currentTime` and the page's clock read together, four times a
second) and the film's seconds no frame was presented for (a picture that stood and then jumped,
from each frame callback's own film time and count of frames presented); the main thread's
hottest functions by stretch; and the worst frames, each with what ran in it. The wall time
between two frame callbacks is not used: after a page stop a callback can arrive with a timestamp
from before the stop, and the pair after it reads as a pause as long as the stop while the film
played through it. `--maps` names functions by source (keep a build's `client/dist/assets/*.map` beside its
runs: a channel's maps are not stored); without it, `--full` prints whole URLs for
`tools/telemetry/symbolicate.mjs <build>`, which reads a deployed build's. `--watch a.ts:12,b.ts:34`
gives named functions' inclusive milliseconds a frame over the chase's first 20 s.

Three things to know when reading a run:

- **A held frame is a short frame.** A WebGPU page holding its frames for pipelines
  (`asyncPipelines.ts`) keeps calling its frame, which draws nothing: the frame times read 60 a
  second while the screen shows one image. The held seconds are in the report's pipelines table,
  not its frame times. `--screencast` saves what the compositor presented, for looking.
- **The rig's frames are sometimes capped.** Its Chrome runs with the frame cap off, yet stretches
  of a run tick at the display's 60 Hz (a median of 16 to 18 ms where the next stretch reads 3):
  a median there says the page kept up, not what a frame cost.
- **The rig's CPU is the slow part.** A g4dn.xlarge's core is a fraction of an Apple M4's, and a
  walk or a sprint is bound by the main thread on it (streaming, the simulation, Babylon's own
  frame): moving stretches read 25 to 40 ms there on builds that hold 60 Hz on the Air. Compare a
  build with another on the same stretch; a stall or a hold is a fault on any machine.

## An intro's verdict

The intro is a player's first sight of the game: a film over the hike while the hike loads under
it, with captions and a loading bar the page draws. Its bar is two limits, from the Play tap to
the film's end: no page stop longer than 0.25 s (a long animation frame; while the page is
stopped the captions and the bar stand), and no film pause longer than 0.1 s by either of the
film's measures (above). It is met by three first-visit runs in a row on a cool phone, all inside
both limits.

```bash
node tools/frame-budget/timeline-verdict.mjs <dir>/live-1.json <dir>/live-2.json <dir>/live-3.json
```

It prints one row a run (pass or FAIL, the stops over 0.1 s and over 0.25 s, the longest, the
clock's worst step, the picture's worst skip, the frames dropped), under a failing run what put
it outside, and a last line for the lot; it exits 1 when a run fails. A run on a phone that did
not start cool (`meta.phone.cool`) fails as a run not to count. `timeline-report.mjs` prints the
same verdict for an intro run, with every stop over 0.25 s and when it came.

For an intro run with a profile (`--profile` at the run), the report also names the stops by
cause (`lib/causes.mjs`): the seconds inside the stops over 0.1 s spent sampling the world (the
simulation's code), linking shaders, uploading textures, in Babylon, collecting garbage, in the
game's builders. A native call is named by what it is; a script's frame by where its source
lives, so the table needs `--maps` at the report (without it script time reads as "other").

## Budgets

```bash
node tools/frame-budget/budget.mjs --tier medium --air <air.jsonl> --rig <rig.jsonl> --machine "g4dn.xlarge" [--factor 1.5]
```

It prints the per-view k, the median k, the spread and the missing views (for `--tier high` also the Pro's two estimates and whether they agree), and writes or replaces the tier's entry in `budgets.json`, keeping the other tier's.

`budget.mjs` writes `budgets.json` from an Air file and a rig file. The Air's rows give the
medium tier's budget; the high tier's is derived from them by the ratio 1.5. The entry's `commit`
is the build the kept rows were taken on, their one `sha` (files of two builds, an `--against`
file among them, are refused), and its `date` the local date of the latest kept row. The first
calibration (2026-10-21, build `1fb913ae`) is in `budgets.json`, and its per-view numbers in the
design doc's As built (`docs/rendering/2026-10-20-frame-budget-rig-design.md`).

## Comparing builds

`--against <url2>` measures a second build interleaved with the first: A B, B A, A B, each pair
back to back. Compare built pages only, a channel against a channel or the live site. The dev
server is about 3x slower than the built site, so the dev server against the live site is no
comparison; the dev server is for checking a view's shape.

## What a row holds

| Field | Meaning |
|---|---|
| `time`, `machine`, `tier`, `view` | when, which machine's label, the tier and the view measured |
| `browser`, `userAgent`, `gpu`, `sha` | Chrome's version and user agent, the GPU the page reports, the build's commit |
| `base`, `build` | the address measured, and `A` or `B` |
| `mean`, `p95`, `n` | the frames' mean and 95th percentile in ms (requestAnimationFrame intervals), and how many frames |
| `canvas` | the canvas size at the start and the end; unequal is flagged `scale-moved` |
| `readyS` | seconds from the canvas to `body.world-ready` |
| `gpuTime` | the page's GPU readout at the start and the end of the frames (below) |
| `load` | the CPU cores busy outside the harness as the sample ends: `ps`'s %CPU summed over every process but the script and the Chrome it started; null with `--remote` |
| `quiet` | `load` at or under 2.0; null with `--remote` |
| `flags` | why the row cannot be trusted: `scale-moved`, `loaded` |

Flagged rows stay in the file and are left out of the medians, the budget's mean and p95, and the
verdict. `load` is not the load average: the harness's own uncapped Chrome takes an idle Air's
one-minute load average from 2 to 8, which would flag every row, so the script counts only the work
outside itself and its Chrome. If an otherwise idle Air still flags every row as `loaded`, something
else is running: say so, find it, and do not average the rows.

## Reading the GPU readout

- **On an Apple GPU the per-pass numbers are not per-pass costs.** The timestamps span the command
  buffer's time in the queue, so every pass reads about the same figure (queue latency, about two
  frames) and none is a cost: on 5 ms frames a half-resolution `paint` pass read 8.7 ms and every
  pass read 8 to 10 ms, and on vsync-paced frames every pass read about the interval. On the Mac the
  frame time (`mean` and `p95`) is the measure. Pass costs come from the rig (T4: `paint` 0.16 to
  0.30 ms, `paintCompose` 0.09 to 0.12 ms, this build). A paint pass's cost on the Air comes from
  pair deltas only.
- A target that draws every n-th frame (the lake's mirror) reports its per-draw ms.
  `drewLastFrame` says whether it drew in the latest resolved frame. Its per-frame share is that
  ms divided by n.
- A target in `missed` has no counter: it was made before the timing was on, or never activated.
  Its time sits in the main pass.
- `frameMs` is null in today's Chrome: Babylon's frame timer uses `writeTimestamp`, which Chrome
  removed. The per-pass numbers and `mainMs` are what there is.
- The post chain's entries are named after the pass that drew into them, so `paint` is the paint
  pass's draw. The last post process draws to the canvas, and that is `mainMs`.

## The phone

Every phone is put on Low with no probe (`gpuClass.ts`, class `mobile`), so Low's standard is a
phone: the owner's Pixel 9 (Chrome, Android, Mali-G715, WebGL2). `phone.mjs` measures it over the
cable, as `measure.mjs --remote` measures a rig through a forwarded port:

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
npm run frame-budget:phone -- --base https://games.csarko.sh/dayhike --tier low \
  --views trailhead,reveal,walk-night --windows 3 --label pixel9 --tag before \
  --out /Volumes/CyrusExtSSD/dayhike-lab/frame-budget/<date>-pixel9-low
```

The phone: Developer options (About phone, Build number tapped seven times), USB debugging, a
data cable (a charge-only one never shows up), and the Allow prompt accepted. `adb devices` lists
it; `adb shell cat /proc/net/unix | grep devtools_remote` shows Chrome's socket. A Chrome in the
background does not answer on it: the harness wakes the screen, keeps it on while charging and
opens the game in front with `am start` before it attaches, but a phone that locks itself mid-run
ends the run. Wireless debugging (`adb tcpip` or pairing) is refused from the owner's IDE terminal
by macOS's local-network rule for Homebrew binaries (2026-11-05); use the cable.

What a phone run is, against the Mac's and the rig's:

- The phone's own size, no emulation: the Pixel's canvas on Low is 250 × 452 (the 375 × 679 CSS
  viewport under Low's 1.5× scaling, the pixel ratio ignored as on every tier).
- Whole frames only. The GPU readout (`?gpuTime`) is WebGPU's and every phone draws with WebGL2;
  the measurement mode is still asked for, so the page exposes `window.__syncJobs()`, the
  streaming jobs' milliseconds a frame by owner, which each window sums into its row's `jobs`.
- Windows, not a settle and one sample: `--windows 3` times three consecutive 10 s windows from
  the first, so a moment that passes (the summit scene, the reveal, the death) is seen in turn. A
  `check` view's `extraSettleS` is skipped with more than one window.
- `walk-night` walks: the joystick's base is found in the page (`.touch .stick`) and held forward
  by synthetic touches (`Input.dispatchTouchEvent`) for every window; `reveal` is the chase view
  timed from world-ready (the standing player is dead by 40 s, so it cannot be settled into).
- `--profile` saves a CPU profile of the view (`Profiler.start/stop`); its minified frames read
  back to source with `node tools/telemetry/symbolicate.mjs <build sha> <stack.txt>`.
- A JPEG at each window's end beside the rows, and the phone's battery temperature and thermal
  status (`adb shell dumpsys`) in each row: a run that warms the phone past thermal status 1 is
  a run to discard.
- `--engine webgpu` forces the engine (`?engine=`): the game's own rule puts every phone on
  WebGL2, so this is how a phone's WebGPU path is timed. A row's `engine` is what was asked for
  and its `ran` is what the page drew with.

An intro is timed on the phone by `timeline.mjs`, as on a rig, with `--phone`:

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
node tools/frame-budget/timeline.mjs --base https://games.csarko.sh/dayhike/ --out <dir on the lab disk> \
  --remote 9222 --tier low --phone --intro 85 --cold --cool --profile --label live-1
```

The tab is the phone's own size and Play is tapped, not clicked. `--cool` waits before the run
until the phone is cool: thermal status 0 and a battery at most 34.5 °C, read every 15 s, for
twelve minutes at most (`--cool 300` for five). It matters: three intros back to back warm a
Pixel 9 until a fourth runs about 2.5 times slower, and a phone on charge with its screen held on
cools slowly. How warm the phone was, how long the run waited and whether it started cool are in
the run's `meta.phone`, with or without `--cool`. `--query engine=webgpu` times the intro on
WebGPU.

## Not measurable yet

The `chase` view is a check view: it is measured only by name and sets no budget. The chase begins
about 35 s after the page opens, the idle player dies about 13 s later and the title returns at
60 s, so no settle fits a 13 s sample. It fails with "the canvas went away during the sample" until
the page gives a phase signal and a player that survives the chase. On a phone the same moment is
`reveal`, timed in windows from world-ready (above): the summit scene, the Hollow stepping out and
the death each fall in a window of their own.

## Traps

- **Another page drawing on this Mac's GPU voids every row.** A leftover dev page took 87 to 95 % of
  the GPU one morning and doubled every frame time. `ioreg -r -c AGXAccelerator -d 1` prints
  `"Device Utilization %"=N`; an idle desktop reads 0 to 15. The script reads it before Chrome starts
  and refuses at 20 or more: "the Mac's GPU is busy before Chrome starts".

## Rules

- Never a rig number as a Mac number. The two GPUs differ; each machine is compared with itself.
- Discard a loaded run; never average it in.
- Never run anything on the owner's MacBook Pro. The Air measures.
