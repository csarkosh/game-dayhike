# Frame budget

The game's frame time, measured the same way every time. `measure.mjs` opens each fixed view of
`views.json` on a fresh page at a tier's standard size, waits for the page's readiness class
(`body.world-ready`, set once the world is in and the URL's looks are applied), settles 30 s, warms
it for 3 s, then times its frames for 10 s with the GPU readout (`?gpuTime`) read at the start and the end. Each
sample is one JSON row appended to a JSONL file in `runs/`, and the run ends with a table of each
view's medians, against the tier's budget when `budgets.json` has one. The verdict is information:
the script exits 0 over budget or under. The options are in the header of `measure.mjs`.

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
fresh browser context downloads the world each time, so readiness takes 60 to 120 s on the Air; the
row records it as `readyS`. The wait is there because the page applies the URL's script (seed,
camera, escalation) only once the world is ready: a fixed sleep sometimes timed the default start
(5 to 9 ms a frame) and sometimes the real view (19 to 26 ms), and the Air's rows came out
bimodal. A run with loaded rows is discarded, not averaged: `rm` its file and
run again.

## The rig's day

1. **Start the rig**, from the main checkout, never from a worktree, and only with the owner's
   go-ahead:

   ```bash
   terraform -chdir=_infra/test-rig-aws-windows apply -var running=true -var max_run_hours=9
   terraform -chdir=_infra/test-rig-aws-windows output instance_id
   ```

   Session Manager answers a few minutes after the start.

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

   Read the command's output (`aws ssm get-command-invocation`): it prints Chrome's `/json/version`
   and the listening port. It stops any Chrome and any earlier `frame-budget-chrome` task first, so
   it can be run again.

4. **Forward the port**, in a second terminal, left running:

   ```bash
   tools/frame-budget/rig/forward.sh <instance id>
   ```

   The rig's 9222 is the Mac's 9333. A second argument picks another local port.

5. **Check the rig is steady**: six samples of one view and the spread of their means.

   ```bash
   npm run frame-budget -- --base <channel url> --tier high --machine rig-t4 --remote 9333 --steadiness --views forest
   ```

6. **The runs**, both tiers:

   ```bash
   npm run frame-budget -- --base <channel url> --tier medium --machine rig-t4 --remote 9333
   npm run frame-budget -- --base <channel url> --tier high --machine rig-t4 --remote 9333
   ```

   `--remote` is refused unless the Chrome behind it says Windows NT, so a run cannot be pointed
   at the Mac by mistake.

7. **Stop the rig**, with the owner's go-ahead again. An idle machine bills by the hour.

   ```bash
   terraform -chdir=_infra/test-rig-aws-windows apply -var running=false
   ```

## Budgets

```bash
node tools/frame-budget/budget.mjs --tier medium --air <air.jsonl> --rig <rig.jsonl> --machine "g4dn.xlarge" [--factor 1.5]
```

It prints the per-view k, the median k, the spread and the missing views (for `--tier high` also the Pro's two estimates and whether they agree), and writes or replaces the tier's entry in `budgets.json`, keeping the other tier's.

`budget.mjs` writes `budgets.json` from an Air file and a rig file. The Air's rows give the
medium tier's budget; the high tier's is derived from them by the ratio 1.5. The numbers are put
here when the first calibration lands.

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

## Not measurable yet

The `chase` view is a check view: it is measured only by name and sets no budget. The chase begins
about 35 s after the page opens, the idle player dies about 13 s later and the title returns at
60 s, so no settle fits a 13 s sample. It fails with "the canvas went away during the sample" until
the page gives a phase signal and a player that survives the chase.

## Traps

- **Another page drawing on this Mac's GPU voids every row.** A leftover dev page took 87 to 95 % of
  the GPU one morning and doubled every frame time. `ioreg -r -c AGXAccelerator -d 1` prints
  `"Device Utilization %"=N`; an idle desktop reads 0 to 15. The script reads it before Chrome starts
  and refuses at 20 or more: "the Mac's GPU is busy before Chrome starts".

## Rules

- Never a rig number as a Mac number. The two GPUs differ; each machine is compared with itself.
- Discard a loaded run; never average it in.
- Never run anything on the owner's MacBook Pro. The Air measures.
