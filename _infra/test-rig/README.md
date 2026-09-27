# test-rig: a rented Windows GPU machine

A Windows Server machine with its own NVIDIA GPU on Google Cloud, for taking the game's
frame-time measurements in Chrome on a second class of graphics hardware (Direct3D on a
desktop-class GPU) beside the Apple M4 they are taken on today. It is meant to exist only on
the days it is used: it is billed by the second while it runs, and while it is stopped it
bills its disk and nothing else.

This is its own Terraform root module with its own state (`gs://fps-csarko-tfstate`, prefix
`test-rig`). It shares nothing with the root module in `_infra/`: no remote-state lookup, no
shared resource. A `terraform destroy` here cannot reach hosting, DNS or the signaling
service.

## What it defines

| Resource | Why |
|---|---|
| `google_compute_instance.test_rig` | `g2-standard-4` with one NVIDIA L4 in `us-west1-b`, Windows Server 2025, 50 GB `pd-balanced` boot disk, Shielded VM, stops on host maintenance (GPU machines cannot live-migrate), stops itself after `max_run_hours`. |
| `google_compute_network`, `_subnetwork` | Its own VPC and a `/24`, not the project's default network. Private Google Access on. |
| `google_compute_firewall.iap_ingress` | SSH (22) and RDP (3389) from Google's IAP range `35.235.240.0/20` only. Nothing else gets in. |
| `google_compute_router`, `_router_nat` | Outbound access for installers, the repository and npm, with no public address on the machine. |
| `google_service_account.test_rig` + two IAM bindings | The machine's identity: writes logs and metrics, nothing else. |
| `google_project_service` × 3 | Enables Compute Engine, IAP and IAM, none of which this project has enabled today. Never disabled on destroy. |
| `google_billing_budget` (optional) | A monthly alert, created only when `billing_account_id` is set. |
| `startup.ps1` | The first-boot set-up, below. |

Every resource that takes labels carries `purpose = "test-rig"`, so its cost can be filtered in
billing. Networks, firewall rules, routers, NAT, service accounts and IAM bindings take no
labels; of those only NAT costs anything, and only while the machine runs.

Not defined here: the Mac (measurements there are unchanged), and a prepared image of the
set-up machine (the next step, below).

### The two machine choices

| | `g2-standard-4` + L4 (default) | `n1-standard-4` + T4 |
|---|---|---|
| CPU, memory | 4 vCPUs, 16 GB | 4 vCPUs, 15 GB |
| GPU | NVIDIA L4, Ada Lovelace, 24 GB GDDR6 | NVIDIA T4, Turing, 16 GB GDDR6 |
| Select with | the defaults | `-var machine_type=n1-standard-4 -var gpu_type=nvidia-tesla-t4` |
| Note | | Google ends T4 support on 2027-08-01; after that a T4 machine cannot be created or started. |

Near `us-west1`, G2 is offered in `us-west1-a`, `us-west1-b`, `us-west4-a` and `us-west4-c`; N1
with T4 in `us-west1-a`, `us-west1-b`, `us-west2-b`, `us-west2-c`, `us-west3-b`, `us-west4-a`
and `us-west4-b`. `us-west1-b` offers both, so switching between them never means moving
zones.

## What it costs

Google's list prices for `us-west1`, in USD, as of 2026-09-27 (Cloud Billing Catalog API):

| Component | Standard | Spot |
|---|---|---|
| `g2-standard-4` (4 vCPU + 16 GB) | $0.1468/h | $0.0881/h |
| NVIDIA L4 | $0.5600/h | $0.3360/h |
| `n1-standard-4` (4 vCPU + 15 GB) | $0.1900/h | $0.1140/h |
| NVIDIA T4 | $0.3500/h | $0.2095/h |
| Windows Server licence, $0.046 per vCPU-hour | $0.184/h | $0.184/h (no Spot discount) |
| Cloud NAT: gateway + its address | $0.0064/h, plus $0.045/GiB carried | same |
| 50 GB `pd-balanced` boot disk | $0.10/GB-month = $5.00 a month, running or stopped | same |

While running, the machine, GPU, licence and NAT come to about **$0.90/h** on the default
(`$0.61/h` Spot), or about $0.73/h with the T4 ($0.51/h Spot). While stopped, only the disk is
billed: **$5.00 a month**.

One three-hour run on the default machine: 3 h × $0.8972 = $2.69, plus about $0.02 of NAT
traffic, so **about $2.71**. A month with four such runs: 4 × $2.71 + $5.00 disk = **about
$15.84**. The same month on Spot: 4 × (3 × $0.6145 + $0.02) + $5.00 = about $12.45. The first
run adds the set-up (below): about 1.4 GiB of downloads (of which the 0.74 GB driver comes
from Google's own bucket and so skips NAT) and the extra half hour it takes.

**Spot** (`-var spot=true`) cuts the machine and GPU by about 40 %. Google can take a Spot
machine back at any moment, with 30 seconds' notice; this module then has it stopped, not
deleted, and the run that was in progress starts again from the top. For a measurement that
is the whole cost of Spot: a reclaimed run is rerun, so Spot pays when reclaims are rare.

**Forgetting to stop it** would cost about $650 a month. `max_run_hours` (default 4) stops the
machine that many hours after each start, whatever anyone remembers.

## Before the first `apply`

1. **GPU quota.** The project's `GPUs (all regions)` quota
   (`compute.googleapis.com/gpus_all_regions`) is **0**, which blocks any GPU machine.
   The per-region quotas are already 1 (`NVIDIA_L4_GPUS`, `NVIDIA_T4_GPUS` and their
   preemptible versions in `us-west1`). Request `GPUs (all regions)` = 1 in the console, under
   IAM & Admin → Quotas & System Limits, filtered to Compute Engine API. Google reviews GPU
   requests by hand and replies by email; its documentation gives no turnaround time.
   The quota page for Compute Engine is available only once the Compute Engine API is
   enabled, which the first `apply` does (or `gcloud services enable
   compute.googleapis.com`).
2. **Enabling Compute Engine** makes Google create a `default` network with rules open to SSH
   and RDP from anywhere. Nothing here uses it; it can be deleted.
3. Application-default credentials: `gcloud auth application-default login`.

## Create, stop, start, destroy

```bash
cd _infra/test-rig
cp terraform.tfvars.example terraform.tfvars   # once; git-ignored
terraform init

terraform apply                     # create (and start) it
terraform apply -var running=false  # stop it: the disk is kept and billed, nothing else is
terraform apply                     # start it again (running defaults to true)
terraform destroy                   # delete it and everything above, disk included
```

`gcloud compute instances stop test-rig --zone=us-west1-b` stops it too; the next `apply`
starts it again unless `running = false` is in `terraform.tfvars`.

## Reaching the machine

`terraform output` prints each command with the project and zone filled in.

```bash
# A shell (cmd.exe; run `powershell` for PowerShell). The first connection pushes a key and
# Google's guest agent makes a local administrator for it.
gcloud compute ssh test-rig --zone=us-west1-b --project=fps-csarko --tunnel-through-iap

# Remote Desktop: create a Windows password, then forward the RDP port and connect a
# Remote Desktop client to localhost:13389.
gcloud compute reset-windows-password test-rig --zone=us-west1-b --project=fps-csarko
gcloud compute start-iap-tunnel test-rig 3389 --local-host-port=localhost:13389 \
  --zone=us-west1-b --project=fps-csarko
```

Both go through Identity-Aware Proxy, which checks the caller's Google identity; the firewall
admits nothing else, so no address of the person connecting appears in any file.
`direct_access_cidrs` can open SSH and RDP to given addresses for a client that cannot use IAP;
it is empty by default and belongs only in the git-ignored `terraform.tfvars`.

## The first boot

`startup.ps1` runs at every boot and does its work only on the first. It installs:

- **The NVIDIA driver**, by Google's documented method for Windows GPU machines: its
  `install_gpu_driver.ps1`, pinned to a commit and checked by SHA-256. That commit installs
  NVIDIA's 582.53 RTX Virtual Workstation (GRID) driver, the only kind Google qualifies for
  L4 and T4 on Windows, for compute and display alike.
- **OpenSSH Server**, which Windows Server 2025 ships installed and disabled: enabled and
  started. Google's `google-compute-engine-ssh` package, installed during first-boot
  specialisation from instance metadata, lets `gcloud compute ssh` push keys to it.
- **Chrome** (stable), from Google's enterprise installer, signature-checked. Not pinnable:
  that URL only serves the current release. The installed version is logged.
- **Node 22.23.3** and **Git 2.55.0 for Windows** (which includes Git LFS; `git lfs install
  --system` is run), both pinned and checked by SHA-256.

It then writes `C:\ProgramData\test-rig\setup-complete` and restarts once. A boot that finds
that file does nothing. Each step checks for what it installs first, and the marker is written
only once every step has succeeded, so a boot that fails part-way is finished by the next one.
The log is `C:\ProgramData\test-rig\setup.log`; the same lines reach the serial console
(`gcloud compute instances get-serial-port-output test-rig --zone=us-west1-b`) and Cloud Logging.

The repository is not cloned at boot: a run clones it at the commit it measures.

### Boot disk size

50 GB is the smallest the Windows Server 2025 image allows (the image is 50 GB), and it fits
with room to spare. Measured on the development checkout: `client/assets` 61 MB, the Git LFS
store 62 MB, `node_modules` about 250 MB. Estimated from the installers' sizes and typical
installed footprints: Windows Server 2025 with its page file and a few months of updates
20–30 GB, the NVIDIA driver about 2 GB installed (a 0.74 GB installer), Chrome with a test
profile about 1 GB (0.17 GB installer), Git 0.4 GB, Node 0.1 GB. Total 25–35 GB.

## The first run's probe

The question to settle before anything is built on this machine: does Chrome get the NVIDIA
GPU at all? On a Windows machine that nobody is logged in to, programs started over SSH run in
the non-interactive services session, and inside a Remote Desktop session Windows may hand
programs its software renderer. Either way Chrome could end up on SwiftShader or the Microsoft
Basic Render Driver and measure the CPU instead.

What the vendors document: Google says L4 and T4 work on Windows only with the RTX Virtual
Workstation driver "for both compute and display workloads", shows that driver running the
L4 in WDDM (display) mode, names RDP and PCoIP as the ways to use the GPU for graphics, and
offers a virtual display device only for machines that "don't need the performance of a
GPU". It says nothing about a machine with nobody logged in. Chromium documents
hardware-accelerated headless Chrome only on Linux (with Vulkan); on Windows it notes that
Chrome uses a single adapter, and that `chrome://gpu` reports "Software only" when it falls
back.

Google also documents the licence this driver runs under. The driver its script installs is
NVIDIA's RTX Virtual Workstation (vWS) driver. On a GPU attached as `nvidia-l4-vws`, Google
bills the vWS licence with the machine ($0.20 per GPU-hour, "Licensing Fee for NVIDIA Quadro
Virtual Workstation" in the billing catalogue) and `nvidia-smi -q` shows `Product Name :
NVIDIA RTX Virtual Workstation`, `License Status : Licensed (Expiry: Permanent)`. On a plain
`nvidia-l4`, Google's example shows `NVIDIA Virtual Applications`, `Licensed (Expiry: N/A)`, and
it states that without the vWS licence "you won't get GPU acceleration" for desktop
applications ([Install drivers for NVIDIA RTX Virtual Workstations](https://docs.cloud.google.com/compute/docs/gpus/install-grid-drivers)).
A short probe on the plain L4 could therefore look fine and still not be what every real run
gets, so it is not believed on the renderer string alone.

The probe, `probe.mjs` in this directory, starts Chrome with the flags given and prints the
WebGL renderer, the WebGPU adapter, Chrome's GPU feature status and version, the `chrome.exe`
lines of `nvidia-smi` read while Chrome is drawing, and the licence lines of `nvidia-smi -q`.
With `--url=<page> --seconds=<n>` it also records frame intervals on that page, with the
median of every minute. Copy it over and run it on the machine:

```bash
gcloud compute scp _infra/test-rig/probe.mjs test-rig:probe.mjs --zone=us-west1-b --project=fps-csarko --tunnel-through-iap
gcloud compute ssh test-rig --zone=us-west1-b --project=fps-csarko --tunnel-through-iap
node probe.mjs --headless=new
```

Run it four ways, in this order, and stop at the first that passes:

1. `node probe.mjs --headless=new`
2. `node probe.mjs --headless=new --use-angle=d3d11 --enable-unsafe-webgpu --ignore-gpu-blocklist`
3. `node probe.mjs` (a real window, in the services session that SSH gives)
4. In the interactive console session: sign in once over Remote Desktop, move that session to
   the console with `tscon %SESSIONNAME% /dest:console` (which disconnects Remote Desktop and
   leaves the session logged in on the machine's own display), then, back over SSH, run the
   probe inside that session with `schtasks /create /tn probe /sc once /st 00:00 /it /ru
   <user> /tr "cmd /c node %USERPROFILE%\probe.mjs > %USERPROFILE%\probe.txt 2>&1"` and
   `schtasks /run /tn probe`.

A way passes when **all** of these hold:

- the WebGL renderer names the L4 (a string like `ANGLE (NVIDIA, NVIDIA L4 Direct3D11 ...)`)
  and the WebGPU adapter's vendor is `nvidia` (`SwiftShader`, `Microsoft Basic Render Driver`,
  `fallback: true` or `no adapter` mean it is not);
- `nvidiaSmiChrome` lists `chrome.exe`: an independent sign that the GPU is really drawing;
- `licence` shows `License Status : Licensed`, **or** a windowed run of at least 25 minutes
  (`--url=<page> --seconds=1500`) keeps a steady `minuteP50` to the end.

If the renderer and `nvidia-smi` pass but neither licence condition holds, or the minute
medians collapse after about 20 minutes, the next step is the vWS GPU
(`-var gpu_type=nvidia-l4-vws`, $0.20/h more, which replaces the machine), not
`enable_display`. If nothing names the L4, try `-var enable_display=true` (a display for
Windows to attach the desktop to), then the vWS GPU.

If way 4 is the one that passes, its repeatable form is Windows automatic logon (the
`AutoAdminLogon` values under `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`, or
Sysinternals Autologon, which stores the password as an LSA secret rather than in the
registry in clear) plus a task that runs at logon. That is the Windows twin of the Mac's
`kcpassword`, with the same questions about where the password lives; it is the step after a
pass, not part of this module yet.

Record the `chrome` version with every result: Chrome is not pinnable, and its updater is
switched off by the start-up script so that it cannot change mid-run.

## The image, next

Once the machine has been set up, an image made from its disk lets later machines start ready
instead of spending half an hour installing. With the machine stopped:

```bash
gcloud compute images create test-rig-YYYYMMDD --project=fps-csarko \
  --source-disk=test-rig --source-disk-zone=us-west1-b --family=test-rig \
  --labels=purpose=test-rig
```

then `-var baked_image=projects/fps-csarko/global/images/family/test-rig` (a boot-disk change,
so Terraform replaces the machine). The marker file travels with the image, so the start-up
script does nothing on it. An image stores at $0.05/GB-month; with one, the machine and its
disk could be destroyed between runs instead of stopped, trading the disk's $5.00 a month for
the image's cost and a fresh machine each time. Creating an image this way does not generalise
Windows (no sysprep), which is fine for a machine that is only ever run one at a time.

## Budget alert

With `billing_account_id` set in `terraform.tfvars`, `apply` also creates a monthly budget of
`monthly_budget_usd` (default $30) over everything labelled `purpose = test-rig`, with emails
to the billing account's administrators at 50 %, 90 % and 100 % of spend and when the month is
forecast to pass 100 %. It needs the Billing Account Administrator or Costs Manager role on
that account, and it enables the Cloud Billing Budget API. It alerts; it does not stop anything.
