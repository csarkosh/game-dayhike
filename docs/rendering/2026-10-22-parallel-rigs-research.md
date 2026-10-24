# Faster frame-budget rounds: AWS, GCP, Modal and a Linux rig, measured (2026-10-22)

## 1. The question

A frame-budget experiment (`tools/frame-budget/`, `2026-10-20-frame-budget-rig-design.md`) is
two builds compared at one tier over four views, three pairs, two sides: 24 page loads of about a
minute each, strictly one after another on one Chrome, so about 25 minutes an experiment-tier. A
round is 10 to 20 experiments, often at both tiers, and today runs on one rented Windows machine
(`_infra/test-rig-aws-windows/`, `g4dn.xlarge`, one NVIDIA T4) from the owner's M4 Air through a
Session Manager port forward: 4 to 8 hours of waiting, lengthened by a cold start of about ten
minutes and a forward that dies after some tens of minutes with the harness hanging on it.

This note measures, on 2026-10-22 and 2026-10-23 (UTC), what the alternatives actually do, on
scratch machines made and destroyed for the purpose: the time from "start" to the first measured
page, fresh and from a prepared image and from a stopped machine; how many browsers can run at
once and what the quotas allow; whether the measurement is valid there (a real GPU under WebGPU,
`timestamp-query` available, the game's per-pass readout answering); how the tunnels hold up; and
what an experiment-tier and a round cost. The harness stays on the Air, driving remote browsers:
no option measured here gave a reason to change that shape.

The one rule that shapes everything: **one experiment per GPU**. Several Chromes on one machine
share its GPU and time each other, so parallelism is machines (or containers with a GPU each),
each with one Chrome on one forwarded port.

## 2. What was measured, and how

Every machine below was a scratch copy, launched by hand with the same images, start-up scripts,
network and identity the Terraform roots use, tagged apart from the real rig, and destroyed at the
end. Chrome was started as the README's rig day starts it (`rig/start-chrome.ps1`) and reached
through a forward; the first page was the `forest` view at the high tier from the preview channel
`tune-base` (build `7e8361ad`), with `?gpuTime`, waited for `body.world-ready`, settled, and its
frames and readout taken as the harness takes them. Times are wall-clock from the launch, stop or
start call on the Air.

| Option | What ran |
|---|---|
| AWS Windows | `g4dn.xlarge` (T4), `us-east-1a`, the public Windows Server 2025 image, the module's own set-up script as user data, Chrome 156 |
| AWS Linux | `g4dn.xlarge` (T4), `us-east-1a`, AWS's "Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04)" (driver 595.91 preinstalled), Chrome 156 headless on Vulkan, as a systemd service |
| GCP Windows | `g2-standard-4` with `nvidia-l4-vws` (L4), the GCP module's start-up script, Windows Server 2025, Chrome 156; in `us-central1-a`, because every zone of `us-west1` (the root's zone) refused the L4 and the T4 with a stock-out |
| Modal | T4 and L4 containers from `debian_slim` with Chrome 156, the NVIDIA driver 610.57 injected by Modal, `modal.forward` for the tunnel |

## 3. Time to the first measured page

### Fresh machines, prepared images, stopped machines

| | AWS Windows (T4) | GCP Windows (L4) | AWS Linux (T4) | Modal (T4) |
|---|---|---|---|---|
| Launch call to the machine running | 8 s | 25 s (the create call itself, 13 s from an image) | 2 s to launched, running within seconds | container up in 5 s (image cached) |
| … to the OS reachable | 70 s (Session Manager online) | 163 s (Windows specialised), 182 s (SSH over IAP) | about 60 s (Session Manager online) | 5 s |
| … to the set-up finished (driver, Chrome) | **613 s** | **624 s** | **141 s** (Chrome and the Vulkan loader installed; the driver was in the image) | 41 s to build the image once, then nothing |
| … to Chrome answering on 9222 | about 660 s (started by hand with Run Command; the first start of a fresh profile takes longer than the script's 8 s wait) | 649 s | 141 s | 1 s (but see §5) |
| From a prepared image to Chrome answering | **355 s** from an image taken without sysprep (running 9 s, Session Manager online 173 s, Chrome 355 s: a new machine's first boot runs EC2Launch's own tasks before the logon); **467 s** from the sysprepped image the root now uses (a `rig_count` copy on 2026-10-24: Session Manager online 376 s, its password written 444 s, Chrome started by the logon trigger 467 s, answering through a fresh forward 587 s; sysprep's specialize pass and a reboot come before the logon). Once per copy's creation; after that the copy is a stopped machine, the row below | **55 s** (create 13 s, SSH 40 s, Chrome 55 s) | not reached: the image was still being made when the research ended (next row); a copy's first boot is the 20 s boot below plus cloud-init's first-boot work, so about a minute | not applicable |
| Stopped machine started to Chrome answering | **about 45 s** (running 9 s, Session Manager 25 s, Chrome's logon task ran 20 s after the start) | **66 s** (started 25 s, SSH 56 s, Chrome 66 s) | **20 s** (running 9 s, the kernel and userspace 18 s, Chrome's service listening 20 s after the start call; Session Manager online 28 s) | not applicable: a container is new every time |
| Stopping the machine | **6 min 37 s** | 27 s (and 43 s) | **6 min 44 s** | 0 |
| Making the image | **34 min 12 s** (a 50 GB Windows volume's first snapshot) | 6 min 38 s | **over 15 minutes** (the 80 GB volume's snapshot was at 17 % after 14 min, and the research ended before it finished) | the image build, 41 s |
| Forward up, from the call | 3 to 4 s (Session Manager), 3 s (SSH over Session Manager) | 3 s (SSH over IAP) | 3 s | not reached |
| First page `world-ready` after the canvas | 34 to 36 s | 36 s | 22 to 24 s | not reached |

Three things stand out.

- **A Windows machine from the public image is ten minutes to Chrome on either cloud**, as the
  rig is today; the set-up itself (the GRID driver, DCV, Chrome, Node, Git) is seven of them.
- **A stopped, set-up Windows machine is under a minute to Chrome on either cloud** once Chrome
  starts itself at the desktop user's logon (a logon trigger on the `frame-budget-chrome` task,
  which `rig/start-chrome.ps1` now registers). Today's rig needs Run Command to start Chrome
  after each boot; once the script has run on it, it needs nothing.
- **The AWS cost is at the stop and the image, not the start**: stopping either AWS machine,
  Windows or Linux, took close to seven minutes on this evening, and the Windows image took 34
  minutes to become available. GCP stops in half a minute and images in seven. Neither is on the
  critical path of a round if the machines are stopped (not destroyed) between rounds: a stop is
  the end of the evening, an image is made once.

The Linux machine boots in a minute and installs Chrome in two more; stopped and started again,
its Chrome service is listening 20 s after the start call, and from an image of it the start is
that boot plus cloud-init's first-boot work. On this evening every AWS snapshot was slow (the
Windows image 34 minutes, the Linux one not finished in 15); an image is made once, so it is not
on a round's path, but it is not something to make on the evening it is needed.

## 4. Is the measurement valid there?

The adapter the page sees, whether `timestamp-query` is offered and the readout answers, and the
same view's numbers side by side (forest, high tier, 1512 × 982, the same build, each row one
sample; two samples where two were taken, settled 30 s unless said otherwise):

| | AWS Windows T4 (D3D12) | AWS Linux T4 (Vulkan, headless) | GCP Windows L4 (D3D12) | Modal T4 |
|---|---|---|---|---|
| Adapter the page reports | NVIDIA Tesla T4 | `nvidia`, `turing`, `0x1eb8`, "Tesla T4" | NVIDIA L4 | **SwiftShader** (software): invalid |
| `timestamp-query` | yes | yes | yes | yes, but on SwiftShader |
| `?gpuTime` readout `supported` | yes | yes, with `?engine=webgpu` (below); **no** without it | yes | no |
| Frame mean, ms (rAF) | 33.6, 33.2 | 24.5, 29.5 | 13.9 (settled 10 s) | not measured |
| Frame p95, ms | 51.0, 50.3 | 47.2, 45.4 | 51.9 | |
| `sceneprePassRT`, ms | 11.3 (settled 10 s) | 10.3, 10.5 (settled 10 s) | 7.1 (settled 10 s) | |
| `sun_CSMShadowMap`, ms | 3.2 | 3.3, 3.4 | 3.1 | |
| Whole-frame `frameMs` | null (Chrome removed `writeTimestamp` on D3D12) | **15.1** (it answers on Vulkan) | null | |

**Windows gives what the budgets were calibrated on.** The AWS scratch machine is the rig over
again (the same image, script, size and driver), and its forest/high mean of 33.2 to 33.6 ms sits
where the rig's calibration row for the view did (33.17 ms on 2026-10-21, build `1fb913ae`; this is
build `7e8361ad`, two days of cuts later, so the agreement is a sign, not a proof). A copy of the
rig is the same instrument, and `rig_count` copies need no re-calibration. The GCP L4 is a
different GPU (about 2.3× the T4 on this view) and would need the one re-calibration the brief
allows; so would the Linux machine. (A note on settling: the same view read 15.7 ms when its frames
were taken 10 s after `world-ready` instead of 30; the README's settle is not optional.)

**Linux gives a real T4 under Vulkan, with two conditions.** Headless Chrome on the NVIDIA
driver (`--headless=new --use-angle=vulkan --enable-features=Vulkan`, no display server) reports
the Tesla T4 with `timestamp-query`, and the game's per-pass readout answers with pass costs
within 10 % of the D3D12 machine's. The conditions:

1. The game's engine rule (`chooseEngine`, `client/src/game/engineChoice.ts`) takes WebGPU only on
   macOS and Windows, so a Linux page lands on WebGL2 (the readout then says `supported: false`
   and the frame is 43 ms). `?engine=webgpu` goes past the platform check; the harness now has
   `--engine webgpu` for this, and the page's own adapter check still stands.
2. The harness refuses a `--remote` Chrome whose user agent does not say Windows NT. Chrome on
   the Linux machine is started with a Windows user agent (`--user-agent=…Windows NT 10.0…`); that
   does not change the client hints' platform, which is why condition 1 is still needed.

What differs on Linux: the whole-frame counter works (15.1 ms here, where D3D12 gives null), and
the requestAnimationFrame interval is lower and less steady than D3D12's on the same GPU (24.5
and 29.5 against 33.2 and 33.6) while the pass costs agree, so the frame-time side of a Linux
rig's rows would be a different instrument from the Windows rig's: the pass costs carry across, the
frame times and budgets do not.

**Modal is not valid today.** §5.

## 5. The Modal spike

Modal's container (gVisor, driver 610.57.04) shows the T4 to Vulkan: `vulkaninfo` lists it with
Vulkan 1.4, and a bare Vulkan program creates an instance with every instance extension, a logical
device with every one of the 273 device extensions and every feature the device reports, a queue
from each of the five families, a pipeline cache, an image with device memory, and reads a
timestamp query pair back (32 ns apart). So the driver and the sandbox allow what a browser's
renderer does.

Chrome's GPU process does not get there. With the Vulkan flags, ANGLE's initialisation fails
inside `vk_renderer.cpp` (`initialize:2530`) with `VK_ERROR_INITIALIZATION_FAILED`, the GPU process
exits (code 11) and restarts, the page's `requestAdapter()` never resolves, and with the sandbox
flags relaxed or the GPU in-process the error is the same; without the Vulkan flags Chrome runs on
SwiftShader and `requestAdapter()` answers with the software adapter. Chrome 156 with the
identical flags on the AWS Linux machine (a real kernel, driver 595.91) initialises ANGLE on
Vulkan and renders the game on the T4, so the difference is the sandbox or the injected driver,
not the flags. The flag sets tried, each on a page that asks for the adapter: `--use-angle=vulkan
--enable-features=Vulkan`; the same with `--disable-gpu-sandbox`, with `--in-process-gpu`, with
`--disable-gpu-driver-bug-workarounds --use-vulkan=native`, with only NVIDIA's ICD visible
(`VK_ICD_FILENAMES`); `--use-angle=gl-egl`; `--use-angle=swiftshader` with Dawn left to find the
device itself (it did not); the default. Nothing short of ANGLE itself says what the failing call
is. What would be tried next, in order: Chrome's own GPU log at `--vmodule=*vulkan*=3,*angle*=3`
on the GPU process, a build of ANGLE's `vulkaninfo`-like test (`angle_end2end_tests`) in the
container, and a question to Modal about ANGLE on their nvproxy allow-list. Until one of those
lands, Modal cannot measure the game.

What Modal would give if it did: a container up in 5 s with Chrome a second later, per-second
billing ($0.59 an hour for a T4, $0.80 an L4, $1.10 an A10), nothing while idle, and a tunnel
(`modal.forward(9222, unencrypted=True)`, a random public TCP port) that ends with the function.
The workspace's Starter plan allows 10 GPUs at once ($30 a month of credit included); a round of
40 experiment-tiers on 10 T4s would be about 1 h 40 min and $10.

## 6. Parallelism and quotas

| | Machines at once | What limits it | Seen |
|---|---|---|---|
| AWS, `g4dn.xlarge` | **192** in `us-east-1` (768 on-demand G vCPUs, 4 a machine); Spot G is 0 | the quota | three scratch machines side by side, no refusal |
| GCP | **1** GPU in the whole project (`GPUS_ALL_REGIONS` = 1; each type's regional quota is also 1) | the quota, and stock-outs | a second L4 machine refused with "Quota GPUS_ALL_REGIONS exceeded. Limit: 1.0 globally"; `us-west1-a`, `-b` and `-c` refused both the L4 and the T4 with a stock-out before `us-central1-a` had one |
| Modal | **10** GPUs at once on the current plan | the plan | not exercised past one |

A quota request on GCP is a form and usually a day; the stock-outs are the deeper problem for a
fleet that must come up together on a given evening. AWS had no such trouble.

## 7. The tunnels

| Tunnel | Up in | Lifetime seen | Notes |
|---|---|---|---|
| Session Manager port forward (today's `forward.sh`) | 3 to 4 s | 31 min idle (a request every 15 s), then refused new connections for about two minutes while the machine was saturated (below), the connection already open living through it | Hung twice when opened within seconds of the agent coming online after a start (the session started, the port never passed a connection), once on Windows and once on Linux; a second forward opened in 2 to 3 s each time. The account has no Session Manager preferences document, so the idle timeout is the default 20 minutes; an idle forward outlived it. |
| SSH over Session Manager (`AWS-StartSSHSession` as `ProxyCommand`, `ssh -N -L`, `ServerAliveInterval 15`) | 3 s | 32 min idle, then dropped in the same saturation | Needs OpenSSH Server on the machine (a Windows capability, about a minute to add; the key goes in `administrators_authorized_keys`). Still no inbound rule: the SSH runs inside the Session Manager session. No better than the plain forward when the agent starves. |
| SSH over IAP (GCP) | 3 s | the length of a run | Died on the first attempt after a restart (the machine was not yet accepting SSH); a retry loop is needed around it. |
| Modal `forward` | with the container | not reached | |

**What killed both tunnels at once was the machine, not the tunnel.** After half an hour up,
two game pages were opened through the two tunnels at the same moment (one each, both on the
one Windows machine's Chrome): within a minute neither tunnel accepted a new connection, a Run
Command sent to the machine stayed `Pending`, and both tunnels came back by themselves once the
pages were closed (the connections already open had lived through it). Smaller and the same
shape: with one page at a time, both tunnels refused new connections for about 20 s as the next
page loaded, then answered again, the run through them unbroken. Both tunnels ride
the same agent, and the agent is a process on a 4-vCPU machine whose Chrome is drawing an
uncapped game; when it starves, every way in starves with it. One page at a time (the harness's
own shape) did not do this in the time watched, but it is the likeliest reading of the owner's
"the forward dies after 20 to 50 minutes and the harness hangs": a long frame-bound page, the
agent late, the session dropped. Two consequences for the design: never two pages on one machine
(the rule already), and a forward that watches itself.

So a dropped or hung tunnel is now harmless in two ways: `rig/forward.sh` keeps a request going
through the forward every 5 s and opens the session again when it ends or when Chrome has not
answered through it for 30 s (which also covers the hang at a machine's start), and
`rig/chain.mjs` puts a run whose Chrome went away back on the queue for any port to take, keeping
the partial rows aside. A sample in flight is lost; the experiment is not. (The harness itself
still ends a run when its socket closes, which is what the chain relies on; resuming a run from
its partial rows would save the sample as well and is not built.)

## 8. Cost

List prices, per second with a one-minute minimum, `us-east-1` and `us-central1`:

| | Running, an hour | An experiment-tier (25 min) | A round of 40 experiment-tiers | Idle |
|---|---|---|---|---|
| AWS Windows `g4dn.xlarge` | $0.715 (with the address) | **$0.30** | **$11.9** | stopped: $4.00 a month a machine for the disk; an image $1.25 to 1.75 a month |
| AWS Linux `g4dn.xlarge` | $0.531 | $0.22 | $8.9 | stopped: $6.40 a month (80 GB); or nothing, from the image |
| GCP Windows `g2-standard-4` + L4 vws | $1.10 | $0.46 | $18.3 | stopped: $5.00 a month |
| Modal T4 | $0.59 (+ CPU and memory, about $0.07) | $0.27 | $11 | nothing |

The round's cost barely depends on how many machines run it: 40 jobs × 25 min of one GPU is the
same GPU time on 1 machine or 20. What changes is the wall-clock time and the start-up overhead,
one boot a machine (under a minute from stopped, so under $0.02 a machine), and the disks kept
while stopped. **Eight stopped Windows rigs cost $32 a month in disks and run a 40-job round in
about 2 h 10 min; twenty cost $80 a month and run it in under an hour.** From an image instead of
stopped disks, the disks cost nothing between rounds and each start costs a first boot: about
eight minutes on AWS Windows from the sysprepped image (six from one taken without sysprep,
which the GRID driver's documentation advises against), which is why stopped disks are the
recommendation there, and under a minute on GCP.

Idle release: Modal bills nothing once the function ends. For the machines, `rig/idle-stop.ps1`
registers a watchdog task that shuts the machine down after 15 minutes without a connection to
Chrome's port (a harness run holds one the whole time), so a rig forgotten after a round costs a
quarter of an hour rather than `max_run_hours`. Tried on the GCP machine with a 3-minute limit
and no client on its port: it shut itself down 3 min 13 s after the task was registered, and
Compute Engine reported it `TERMINATED` (stopped). Windows' own shutdown is what the rig's stop
timer already relies on, so this is the same mechanism on a shorter, client-aware clock.

What this research cost, by the machines' running hours at list price: the two AWS Windows
machines about 1.5 hours together ($1.10), the two Linux machines about 1 hour ($0.55), the two GCP
machines about 0.8 hours ($0.90), Modal about 25 GPU-minutes of T4 across a dozen short runs
($0.30), and the snapshots, images and addresses for the hours they existed under $0.10: **about
$3**, all of it destroyed at the end.

## 9. Recommendation

**Run the round on N copies of today's AWS Windows rig, kept stopped between rounds, with the
chain spreading the experiments over N forwards.** It is the only option that is at once valid
without re-calibration (the same T4, the same D3D12, the same image and script, frame times that
match the calibration rows), allowed in numbers (192 machines against GCP's one and Modal's ten),
and under a minute from stopped to Chrome. The wall-clock of a round becomes the longest job plus
a minute, divided by N:

| N rigs | A round of 40 experiment-tiers | Of 20 | Disks while stopped |
|---|---|---|---|
| 1 (today) | 16 h 40 min | 8 h 20 min | $4 a month |
| 4 | 4 h 10 min | 2 h 5 min | $16 |
| 8 | 2 h 5 min | 1 h 15 min | $32 |
| 10 | 1 h 40 min | 50 min | $40 |
| 20 | 50 min | 25 min | $80 |

Ten is the practical number: a round in under two hours, a $40 a month of disks that an image
could replace, and a queue of forwards the Air carries without effort (each harness is a CDP
client, a few per cent of a core). The GPU hours are the same at any N.

Not recommended, and why:

- **GCP** as the fleet: one GPU per project without a quota request, and stock-outs in three
  zones on the one evening tried. Its Windows machine is otherwise the quickest of the three to
  stop, image and start, and the right place for a second GPU class (the L4) if one is wanted.
- **Modal** today: the browser cannot reach the GPU. Worth the two follow-ups in §5, because a
  working Modal rig would be the fastest and cheapest of all.
- **The Linux rig** as the fleet: it starts in a minute from an image and costs a quarter less,
  but its frame times are another instrument (Vulkan, headless, a lower and less steady rAF
  interval), so the budgets would be re-derived and the rows would not compare with the Windows
  rig's. It is the right second rig for a question about the Vulkan path (and it reads the
  whole-frame GPU time, which D3D12 does not).

## 10. What to do next

What was built for this is listed under "As built" below: the `rig_count` copies, the chain over
N ports, the self-reopening forward, the idle watchdog, the engine override, and Chrome's logon
trigger in the start script.

The rig itself now carries Chrome's logon trigger and the idle watchdog, and an image of it,
`test-rig-20261023` (`ami-0b574292e2419a6cf`, made 2026-10-23 after a sysprep, as the root's
README describes), is the root's `image_id` in its git-ignored `terraform.tfvars`: a copy starts
from it set up, with Chrome's trigger and the watchdog in place, so no Run Command is needed on
it. Its first boot is not quick, though: sysprep's specialize pass and a reboot put Chrome at
467 s, three minutes under a fresh machine's set-up (§3), and that is paid once, when the copy
is created; every later start is the stopped machine's, under a minute. The rig's own next boot is a first
boot from the sysprep: it makes a new desktop password and verifies itself again before Chrome
comes up. That boot found a flaw: sysprep's answer file turns Remote Desktop back on, and the
set-up script's closing step is a first-boot step an image never runs again, so a machine from
an image failed its check ("Remote Desktop is on") on its first boot and was marked verified only
on its second (nothing is exposed meanwhile, as the security group admits no inbound connection).
Removing the step's marker before the sysprep, as a second image tried, changes nothing. The
set-up script now closes the host again before its check whenever it finds Remote Desktop on;
that change replaces the rig (from the image, so no set-up), after which the image is made once
more. A snapshot after the first is incremental: the second image took under four minutes.

To do, in this order:

1. Apply the set-up script change (`running = true`; the rig is replaced from the image and
   verifies itself), make the image again with the README's procedure, set its id as `image_id`,
   and deregister `test-rig-20261023` and `test-rig-20261024` with their snapshots.
2. `terraform apply -var rig_count=10` on a round's day, then `running=false` at its end; the
   ten forwards from `terraform output forward_commands`, each in its own terminal (or one
   process manager), and the round as a queue file for `chain.mjs`.
2. Optionally, a Session Manager preferences document with `idleSessionTimeout` at 60 (its
   maximum), if a forward is ever seen to die idle; none did here.
3. Modal's two follow-ups (§5), when there is an evening for them.

## As built

What this change adds. The two scripts are on the rig and in its image; the module change is
applied (the first machine's tag and policy), and `rig_count = 2` was applied once, for the copy
timed in §3, then lowered again:

- `_infra/modules/aws-test-rig-windows/instance.tf`: `aws_instance.extra[*]` and
  `aws_ec2_instance_state.extra[*]`, `rig_count - 1` copies of the machine; each copy's start-up
  script is the first machine's rendered with `<password_parameter>-<n>`, its user data the
  first's with that script in place, its `build` tag derived from them the same way; the
  replacement refusal is per machine by the `rig` tag, so a copy of an older build does not
  implicate the first and a copy above a lowered count is ignored; a copy made after `image_id`
  is set starts from that image. The first machine gains the tag `rig = 0` in place and nothing
  else. `iam.tf`: the backstop stops every machine (one ARN as before when there is one), the
  role may write every copy's parameter. `outputs.tf`, root and module: `instance_ids`,
  `forward_commands`. `variables.tf`, root and module: `rig_count` (1 to 32). The README's
  "Several machines at once". `tests/plan.tftest.hcl`: three machines, and the refusal of copies
  while stopped; 28 runs pass against the mocked provider, and `tests/*.test.mjs` pass.
- `tools/frame-budget/rig/chain.mjs` and `lib/chain.mjs` (`test/chain.test.mjs`): the queue, the
  jobs' caps, the per-port workers, the retry, the summary.
- `tools/frame-budget/rig/forward.sh`: the self-watching, self-reopening forward.
- `tools/frame-budget/rig/idle-stop.ps1`: the idle watchdog task.
- `tools/frame-budget/rig/start-chrome.ps1`: the task's logon trigger.
- `tools/frame-budget/measure.mjs` and `lib/views.mjs` (`test/views.test.mjs`): `--engine`.
- `tools/frame-budget/README.md`: "Several rigs at once".

Not built: Chrome's start as part of the module's set-up script (it stays the start script's,
run once by hand and kept by an image; putting it in `setup.ps1` would replace the existing
machine at the next apply, so it waits for a day the machine is replaced anyway); resuming a
harness run from its partial rows; the Modal follow-ups of §5; a GCP quota request.
