# test-rig-gcp: a rented Windows GPU machine on Google Cloud

A Windows Server machine with its own NVIDIA GPU on Compute Engine, for taking the game's
frame-time measurements in Chrome on a second class of graphics hardware (Direct3D on a
desktop-class GPU) beside the Apple M4 they are taken on today. It is meant to run only on the
days it is used: it is billed by the second while it runs, and while it is stopped it bills its
disk and nothing else. Nothing reaches it from the internet; every way in goes through Google's
Identity-Aware Proxy (IAP), and Compute Engine stops it by itself after a set number of hours.

This is its own Terraform root module with its own state (`gs://fps-csarko-tfstate`, prefix
`test-rig-gcp`). It shares nothing with the root module in `_infra/`: no remote-state lookup, no
shared resource. A `terraform destroy` here cannot reach hosting, DNS or the signaling service.

## What it defines

| Resource | Why |
|---|---|
| `google_compute_instance.test_rig` | `g2-standard-4` with one NVIDIA L4 carrying the RTX Virtual Workstation licence (`nvidia-l4-vws`) in `us-west1-b`, Windows Server 2025, 50 GB `pd-balanced` boot disk deleted with it, Shielded VM, no external address. Stops on host maintenance (GPU machines cannot live-migrate) and is never restarted by Google; stops itself `max_run_hours` after each start. Its label `build` records what it was built from. |
| `data.google_compute_instance.existing` | Read only when `running = false`: the machine as Google reports it, so that creating or replacing a machine stopped is refused (see [Create, stop, start, destroy](#create-stop-start-destroy)). |
| `google_compute_resource_policy.backstop` | A Compute Engine instance schedule that stops the machine once a day at 09:00 UTC if it is still running; see [It stops itself](#it-stops-itself). |
| `google_compute_network`, `_subnetwork` | Its own VPC and a `/24`, not a default network. Private Google Access on. |
| `google_compute_firewall.iap_ingress` | SSH (22) and RDP (3389) from Google's IAP range `35.235.240.0/20`, to this machine only. Nothing else gets in. |
| `google_compute_router`, `_router_nat` | Cloud NAT: outbound access for the installers and the repository, with no public address on the machine. |
| `google_service_account.test_rig` + two IAM bindings | The machine's identity: writes logs and metrics, nothing else. See [Identity](#identity). |
| `google_project_service` × 3 | Compute Engine, IAP and IAM. Never disabled on destroy. |
| `google_billing_budget` (optional) | A monthly alert, created only when `billing_account_id` is set. |
| `startup.ps1` | The start-up script, in the machine's metadata; see [The first boot](#the-first-boot). |
| `probe.mjs` | The first run's probe; see [The first run's probe](#the-first-runs-probe). |
| `tests/` | `terraform test` against a mocked Google provider (creates nothing), and the start-up script's and the probe's own checks under Node. See [What is tested](#what-is-tested). |

The machine and its disk carry the label `purpose = "test-rig"`, so their cost can be filtered in
billing. Networks, firewall rules, routers, NAT, instance schedules, service accounts and IAM
bindings take no labels; of those only NAT costs anything, and only while the machine runs.

### The GPU

| `gpu_type` | Machine | GPU | Running, all in |
|---|---|---|---|
| `nvidia-l4-vws` (default) | `g2-standard-4`: 4 vCPUs, 16 GB | NVIDIA L4, Ada Lovelace, 24 GB, with the RTX Virtual Workstation licence | $1.0972/h |
| `nvidia-l4` | `g2-standard-4` | the same L4, no licence: a control run | $0.8972/h |
| `nvidia-tesla-t4-vws` | `n1-standard-4`: 4 vCPUs, 15 GB | NVIDIA T4, Turing, 16 GB, with the licence | $0.9304/h |
| `nvidia-tesla-t4` | `n1-standard-4` | the same T4, no licence | $0.7304/h |

The licence is the default because of what Google documents: on a GPU attached without it, the
driver reports `NVIDIA Virtual Applications` and "you won't get GPU acceleration" for desktop
applications, a browser among them; on a GPU attached as `nvidia-l4-vws` it reports `NVIDIA RTX
Virtual Workstation`, `Licensed`, and Google bills the licence with the machine ([Install drivers
for NVIDIA RTX Virtual Workstations](https://docs.cloud.google.com/compute/docs/gpus/install-grid-drivers)).
The licence is chosen when the GPU is attached: switching `gpu_type` **replaces the machine and its
disk**, and the first-boot set-up runs again. The T4 needs `-var machine_type=n1-standard-4`; a
mismatched pair fails at `plan`. Google ends T4 support on 2027-08-01, after which a T4 machine
cannot be created or started.

In `us-west1`, as of 2026-09-27, `us-west1-a` and `us-west1-b` offer all four GPU types and
`us-west1-c` the two L4s only. The module uses `us-west1-b`.

### Standard or Spot

`-var spot=true` cuts the machine and GPU by about 40 % (the Windows and workstation licences are
not discounted): $0.8145/h on the default. Google can take a Spot machine back at any moment, with
30 seconds' notice; this module then has it stopped, not deleted, and the run in progress is run
again from the top. Switching it replaces the machine.

## What it costs

Google's list prices for `us-west1`, USD, as of 2026-09-27 (Cloud Billing Catalog API, services
`6F81-5844-456A` Compute Engine and `E505-1604-58F8` Networking). Billed per second while running,
with a one-minute minimum.

| Component | Standard | Spot |
|---|---|---|
| `g2-standard-4`: 4 × $0.024988 per vCPU + 16 × $0.002927 per GB | $0.1468/h | $0.0881/h |
| NVIDIA L4 | $0.5600/h | $0.3360/h |
| `n1-standard-4`: 4 × $0.031611 + 15 × $0.004237 | $0.1900/h | $0.1140/h |
| NVIDIA T4 | $0.3500/h | $0.2095/h |
| RTX Virtual Workstation licence ("Licensing Fee for NVIDIA Quadro Virtual Workstation"), on a `-vws` GPU | $0.2000/h | same |
| Windows Server 2025 Datacenter licence, $0.046 per vCPU | $0.1840/h | same |
| Cloud NAT: gateway $0.0014/h + its address $0.005/h | $0.0064/h, plus $0.045/GiB carried | same |
| 50 GB `pd-balanced` boot disk, $0.10/GB-month | $5.00 a month, running or stopped | same |
| An image of the disk (below), $0.05/GB-month | while it is kept | |
| IAP, the instance schedule, a budget that only alerts | nothing | |

On the default machine, running costs $0.1468 + $0.5600 + $0.2000 + $0.1840 + $0.0064 =
**$1.0972 an hour**.

- **One three-hour run:** 3 × $1.0972 = $3.29, plus about $0.02 of NAT traffic: **about $3.31**.
- **A month of four such runs:** 4 × $3.31 + $5.00 for the disk = **about $18.26**.
- **Stopped all month:** the disk alone, **$5.00**.
- **Left running** (were nothing to stop it): 730 × $1.0972 + $5.00 = about $806 a month. The run
  limit caps one forgotten start at `max_run_hours` (default 4): 4 × $1.0972 = $4.39. If the limit
  were ever gone, the daily stop caps it at a day: 24 × $1.0972 = at most $26.33.
- Without the licence (`nvidia-l4`, a control run): $0.8972/h, about $2.71 a run.

The first run also pays for the first boot's set-up, about 40 minutes (an estimate: a 0.74 GB
driver from Google's bucket through Private Google Access, which skips NAT, three installers, a
restart), roughly $0.75.

## The first run, step by step

None of this is in Terraform. Each step says what to see and what to do when it is not so.

### Before the first `apply`, by hand

1. **On the computer you work from:** the gcloud CLI, signed in (`gcloud auth login`), with
   application default credentials for Terraform and the state bucket (`gcloud auth
   application-default login`); Terraform 1.7 or later; and a Remote Desktop client if the
   desktop is to be looked at.
2. **Quota.** One GPU needs `GPUs (all regions)` of at least 1 and, for the default, the `us-west1`
   quota `NVIDIA_L4_VWS_GPUS` of at least 1 (a `-vws` GPU has its own quota, apart from
   `NVIDIA_L4_GPUS`; the T4 needs `NVIDIA_T4_VWS_GPUS` or `NVIDIA_T4_GPUS`). As of 2026-09-27
   fps-csarko has all of them at 1. Check:

   ```bash
   gcloud compute project-info describe --project=fps-csarko \
     --flatten=quotas --format='table(quotas.metric,quotas.limit)' | grep GPUS_ALL_REGIONS
   gcloud beta quotas info describe NVIDIA-L4-VWS-GPUS-per-project-region \
     --service=compute.googleapis.com --project=fps-csarko \
     --flatten=dimensionsInfos --format='table(dimensionsInfos.dimensions.region,dimensionsInfos.details.value)'
   ```

   The second lists a value per region, or one line with no region: the value for every region.

   A quota of 0 is raised in the console (IAM & Admin → Quotas & System Limits), and Google
   decides GPU requests by hand.
3. **Names.** The `apply` fails, without touching anything that exists, if the project already has
   any of: service account `test-rig`, network `test-rig`, firewall rule `test-rig-allow-iap`,
   router `test-rig`, instance schedule `test-rig-backstop-stop`, or instance `test-rig` in
   `us-west1-b`. Each of these should print nothing:

   ```bash
   gcloud iam service-accounts list --project=fps-csarko --filter='email~^test-rig@' --format='value(email)'
   gcloud compute networks list --project=fps-csarko --filter='name=test-rig' --format='value(name)'
   gcloud compute resource-policies list --project=fps-csarko --filter='name=test-rig-backstop-stop' --format='value(name)'
   gcloud compute instances list --project=fps-csarko --filter='name=test-rig' --format='value(name,status)'
   ```

   An instance listed there is a machine this state does not know (a lost state, or someone
   else's): find out what it is before applying, and never apply with `running = false` while it
   is there, since the refusal would take it for this module's machine.
4. **The project's own leftovers.** Enabling Compute Engine made Google create a `default` network
   (already deleted in fps-csarko) and grant the Compute Engine default service account Editor on
   the whole project, which it still holds. This module's machine uses its own account, and nothing
   of this repository uses the default one; remove the role:

   ```bash
   number=$(gcloud projects describe fps-csarko --format='value(projectNumber)')
   gcloud projects remove-iam-policy-binding fps-csarko \
     --member="serviceAccount:${number}-compute@developer.gserviceaccount.com" --role=roles/editor
   ```

5. **The time of day.** The daily stop runs at 09:00 UTC (02:00 Pacific daylight time, 01:00
   standard). A machine created or started less than an hour before it would be stopped in the
   middle of its first boot or its run: start at least an hour clear of it (four for a full run).
6. **The NVIDIA terms.** The first boot downloads NVIDIA's RTX Virtual Workstation driver from
   Google's bucket; installing it binds the machine to NVIDIA's licence terms for it.

### During the first run, in order

| # | Step | Expect | If not |
|---|---|---|---|
| 1 | `terraform plan` before the first apply | **13 to add** (15 with the budget), 0 to change, 0 to destroy; every one a creation of this module's resources. | Stop and read: anything to change or destroy means the state already holds something. |
| 2 | `terraform apply` | Everything created within a few minutes. | A quota error names the quota: step 2 above. `ZONE_RESOURCE_POOL_EXHAUSTED`: Google has no L4 free in the zone; try later, or `-var zone=us-west1-a`. |
| 3 | About 5 minutes after the apply, `terraform output -raw ssh_command`, run | A `cmd.exe` prompt on the machine (the SSH package is installed at first-boot specialisation). | `gcloud compute instances get-serial-port-output test-rig --zone=us-west1-b --project=fps-csarko`: look for the specialisation and the guest agent's lines. |
| 4 | `terraform output -raw setup_log_command`, run | Within about 10 minutes of the start: `C:\ProgramData\test-rig: SYSTEM and Administrators only`, `Set-up starting.`, then `OpenSSH Server: <path> <version>, running, key login only` (record which `sshd.exe` the service runs: Google's package's or Windows' own) and `Step done: ssh`. | No log after 15 minutes: Google documents `windows-startup-script-ps1` as running "on every boot after the VM's initial boot"; if it waited for a second boot, restart the machine once from the SSH shell (`shutdown /r /t 0`) and look again. |
| 5 | The log goes on | `Desktop user hiker: logs on automatically; password made here, kept in C:\ProgramData\test-rig\desktop-password` and `Step done: user-hiker`. | A `New-LocalUser` or policy error: read it; `tests/startup.test.mjs` checks the limits Microsoft documents, and a new one belongs there. |
| 6 | The driver | `Downloading https://storage.googleapis.com/compute-gpu-installation-us/...`, `Signature of ...: valid, NVIDIA Corporation`, `The NVIDIA driver installer exited with 0` (or `1`: NVIDIA's "Success, but reboot required"), `Step done: driver`. | Any other exit code fails the step; its log is in `C:\ProgramData\test-rig\nvidia-install`. `SHA-256 mismatch`: Google's bucket serves a different file; stop. |
| 7 | Chrome, Node, Git, holding still, closing | Each `exited with 0` (or `3010` for an MSI), each `Step done`, then `Held still: ...`, `Closed: the metadata server is blocked for hiker`, `Set-up finished. Restarting once`. | `Timed out:` or `FAILED:`: the next boot retries from that step; restart once (`shutdown /r /t 0`). |
| 8 | The boot after the restart | `NVIDIA driver 582.53; licensed product 'NVIDIA RTX Virtual Workstation'; licence 'Licensed (Expiry: Permanent)'` (record the exact strings); the display adapters (record them and their refresh rate); `Sessions: ... console hiker 1 Active ...`; `Set-up checked: the machine is ready`, and `C:\ProgramData\test-rig\verified` exists. | `FAILED: The driver is not running as a licensed NVIDIA RTX Virtual Workstation`: check the GPU type (`gcloud compute instances describe test-rig --zone=us-west1-b --format='value(guestAccelerators)'`). `FAILED: hiker is not logged on at the console`: automatic logon did not take effect on this image; read `Sessions:` and stop. On any `FAILED:`, `shutdown /r /t 0` retries. |
| 9 | `terraform output -raw desktop_password_command`, run | 24 letters and digits. | Nothing: the user step did not finish (step 5). |
| 10 | The probe (see [The first run's probe](#the-first-runs-probe)), nobody connected over Remote Desktop | `PASS`. Read every `WARNING`. Record the renderer string, the `chrome.exe` lines, `featureStatus`, the WebGPU adapter, `refreshHz`, the display adapters and `browserMetadata`. | See the probe's section: a Chrome flag first, then `-var enable_display=true`; a failing licence is step 8's. |
| 11 | `gcloud compute instances describe test-rig --zone=us-west1-b --project=fps-csarko --format='value(resourceStatus.scheduling.terminationTimestamp,resourcePolicies)'` | A termination time 4 hours after the machine's start (not after its restart: a restart does not move it), and the instance schedule `test-rig-backstop-stop`. | No time: the run limit is not on the machine; stop it by hand (`terraform apply -var running=false`) and read `scheduling` in the same output. |
| 12 | **Stop, then plan**: `terraform apply -var running=false`, then `terraform plan -var running=false`, then `terraform plan` | The apply stops it (`gcloud compute instances list` shows `TERMINATED`). The stopped plan shows **No changes**. The plan for the next start shows exactly **0 to add, 1 to change, 0 to destroy**: `google_compute_instance.test_rig` updated in place, `desired_status = "TERMINATED" -> "RUNNING"`. | This is the one check of what no test here can show: that nothing Google reports differently about a stopped machine makes Terraform change or replace it. What differs, by Google's documentation: the status (`TERMINATED`, which the provider reads back into `desired_status`, the one change expected) and the termination time (`resourceStatus.scheduling.terminationTimestamp`, cleared while stopped, which the provider does not read). The machine has no external address to lose. Refuse any other plan, above all one that says `google_compute_instance.test_rig` "must be replaced", until it is understood; the attribute it names goes in `ignore_changes` or is pinned, and a test is added. |
| 13 | Where `gcloud compute ssh` put its key: `gcloud compute project-info describe --project=fps-csarko --format='value(commonInstanceMetadata.items)'` | No `ssh-keys` (the key is in the instance's metadata, which the module leaves alone). | `ssh-keys` listed: the key went project-wide, harmless while no other machine exists in the project; remove it after a `destroy` (below). |
| 14 | The first time the run limit or the daily stop fires: `gcloud compute operations list --project=fps-csarko --filter='targetLink~instances/test-rig'` | `compute.instances.deferredStop` (the run limit) or a `stop` by Compute Engine's service agent (the daily stop). | Neither fires while the machine runs past its time: stop it by hand and read the instance's `scheduling` and the schedule's status (`gcloud compute resource-policies describe test-rig-backstop-stop --region=us-west1`). |

### After a `terraform destroy`

`destroy` (with `running` true, the default: with `running = false` the plan first reads the
machine) removes everything above, the disk included. Left behind by design:

- the APIs this module enabled (Compute Engine, IAP, IAM, and the Billing Budget API with the
  budget), which a destroy never switches off. Switch one off only if nothing else in the project
  uses it: `gcloud services disable iap.googleapis.com --project=fps-csarko`;
- any image made from the machine (below): `gcloud compute images list --project=fps-csarko
  --no-standard-images --filter='labels.purpose=test-rig'`, then
  `gcloud compute images delete <name> --project=fps-csarko`;
- a project-wide SSH key, if step 13 found one: `gcloud compute project-info remove-metadata
  --keys=ssh-keys --project=fps-csarko` (only while no other machine in the project needs it);
- the state object and its old versions: `gcloud storage rm --all-versions
  gs://fps-csarko-tfstate/test-rig-gcp/default.tfstate`, only when this module is to be forgotten
  for good.

## Create, stop, start, destroy

```bash
cd _infra/test-rig-gcp
terraform init

terraform apply                     # create it (it starts, and sets itself up on first boot)
terraform apply -var running=false  # stop it: the disk is kept and billed, nothing else is
terraform apply                     # start it again (running defaults to true)
terraform destroy                   # delete it and everything above, disk included
```

Create it running, and let the set-up finish before stopping it. A new machine must never be
stopped before its first-boot set-up has finished: the provider creates a machine running and, with
`desired_status = "TERMINATED"`, stops it at once, seconds into Windows' own first boot, in the
middle of its specialisation, and it may never boot again. So an apply with `running = false` is
refused unless the machine already exists and is not being replaced:

- **creating** one (a first apply, an apply after a `destroy`, a new `instance_name` or `zone`):
  with `running = false` the plan reads the machine from Google, and the read fails:
  `Error: projects/fps-csarko/zones/us-west1-b/instances/test-rig not found`;
- **replacing** one: the machine carries the label `build`, a hash of everything whose change makes
  the provider replace it, and a plan whose build differs from the one Google reports is refused
  with a message that says to apply with `running = true`, wait for
  `C:\ProgramData\test-rig\verified`, then stop.

The run limit and the daily stop come from Compute Engine and cannot stop a new machine in its
first boot: the limit is at least an hour (the set-up takes about 40 minutes), and the daily stop
is avoided by the time of day (step 5 above).

Once the machine has stopped itself, Terraform's state still says `RUNNING`; the next `apply`
starts it again. `gcloud compute instances stop test-rig --zone=us-west1-b` stops it too, with the
same effect on the next `apply`. Any `apply` with `running = true` starts a stopped machine,
whatever else it was run for; any `apply` with `running = false` leaves it stopped.

### What a change does to the machine

| Change | What happens |
|---|---|
| `running` | The machine is started or stopped. |
| `desktop_user`, `startup.ps1` | The start-up script in the machine's metadata changes in place, running or stopped; nothing restarts. The next boot runs it: a new desktop user is made, with its own password, then the machine restarts once and is checked again. A changed set-up step does not run again on a machine that has done it (its marker is there); a new one does. |
| `gpu_type` (and with it `machine_type`), `max_run_hours`, `spot`, `boot_disk_size_gb`, `boot_disk_type`, `zone`, `instance_name` | **The machine is replaced**: `plan` shows `google_compute_instance.test_rig` "must be replaced", and its `build` label changes. The new machine runs the first-boot set-up again (about 40 minutes); the old disk and everything on it go. **Refused while `running = false`**. The provider cannot change the run limit of a machine in place (its schema forces a new machine), although Google's API can on a stopped one. |
| `enable_display` | The provider stops the machine, changes it and starts it again if `running` is true. |
| `backstop_stop_schedule` | The schedule changes or goes, in place. |
| A new monthly Windows image, `image`, `baked_image` | Nothing until `terraform apply -replace=google_compute_instance.test_rig` (with `running = true`: the refusal cannot see a `-replace`). |

What the refusals cannot stop: a `-replace`; the replacement of a machine that Terraform tainted
after a failed create (apply with `running = true` after a failed create); a machine whose `build`
label was removed or changed by hand (one without it counts as the current build); a replacement
the provider decides for a reason of its own. The read knows nothing of Terraform's state: if the
state were lost while a machine named `test-rig` still existed, it would take that machine for
this module's.

## Reaching the machine

Nothing reaches the machine from the internet: the VPC admits only Google's IAP range, and only to
SSH and RDP, and the machine has no external address. IAP checks the caller's Google identity
before it forwards anything, so no address of the person connecting appears in any file.
`terraform output` prints each command with the project and zone filled in.

```bash
# A shell (cmd.exe; run `powershell` for PowerShell), as a local administrator that Google's
# guest agent makes for the key gcloud pushes.
gcloud compute ssh test-rig --zone=us-west1-b --project=fps-csarko --tunnel-through-iap

# Remote Desktop: make an administrator for it (the guest agent makes the password and gcloud
# prints it; it is never in Terraform state), then forward the port and connect a Remote Desktop
# client to localhost:13389.
gcloud compute reset-windows-password test-rig --zone=us-west1-b --project=fps-csarko --user=rdp-admin
gcloud compute start-iap-tunnel test-rig 3389 --local-host-port=localhost:13389 \
  --zone=us-west1-b --project=fps-csarko
```

SSH takes keys only. **Sign in over Remote Desktop as `rdp-admin`, never as the desktop user**:
signing in as the desktop user moves its session off the machine's console into Remote Desktop,
and Chrome then draws through Remote Desktop, not on the console the measurements use. If it
happens, restart the machine (`shutdown /r /t 0`): automatic logon puts the desktop user back on
the console. The probe refuses to run while any Remote Desktop session is active, and fails if the
desktop user is not at the console. `direct_access_cidrs` can open SSH and RDP to given addresses
for a client that cannot use IAP; it is empty by default and belongs only in the git-ignored
`terraform.tfvars`.

## Network: why Cloud NAT

The machine needs outbound access: the installers, the repository, npm. Google's own endpoints
(the driver's bucket, Cloud Logging) are reached through Private Google Access, without NAT. For
the rest it uses Cloud NAT rather than an external address: $0.0064/h plus $0.045/GiB, about $0.04
a three-hour run, against $0.005/h ($0.015) for an external address on the machine. The difference
buys a Windows machine that the internet cannot address even if a firewall rule is added by
mistake, and a stopped machine with no address to read back differently from a running one. Both
bill only while the machine runs.

## Identity

The machine runs as its own service account, `test-rig`, not the Compute Engine default account
(which holds project-wide Editor; see step 4 before the first apply). It has
`roles/logging.logWriter` (the start-up script's output reaches Cloud Logging through the guest
agent) and `roles/monitoring.metricWriter` (for the Ops Agent, if it is ever installed), and nothing
else. Log writing is project-wide, as Google grants it: whoever controls the machine could write
entries under any log name in the project. Accepted, since only IAP reaches it.

The desktop user cannot use that account at all: a host firewall rule blocks its processes, the
browser among them, from the metadata server (`169.254.169.254`, port 80), which hands out the
account's tokens. The guest agent and the start-up script run as the local system account and are
not blocked. The probe checks the block from inside the desktop session.

The daily stop is carried out by Compute Engine's own service agent, which already holds
`compute.instances.stop` through its role `roles/compute.serviceAgent`; nothing is granted for it.

## The first boot

`startup.ps1` is the machine's `windows-startup-script-ps1` metadata value. Google's guest agent
runs it through Task Scheduler as the local system account at every boot. Google's
`google-compute-engine-ssh` package is installed before it, during first-boot specialisation, and
`enable-windows-ssh` turns SSH on, as Google documents for `gcloud compute ssh` on Windows.

At every boot it first makes `C:\ProgramData\test-rig` writable by the local system account and
Administrators only, with nothing inherited from `ProgramData` (whose Users may create files):
nobody else may swap a download between its hash check and its run as SYSTEM, forge a marker, or
read the desktop password. On the first boot it then installs, each step recording its own marker
there so that a boot that fails part-way is finished by the next. Every download and every
installer has a time limit (downloads 15 minutes, the driver's 30; installers 10 to 30 minutes); one
that runs over is logged as `Timed out: <what> did not finish in <n> minutes`, nothing further runs
on that boot, and the next boot tries again. Every MSI waits first until Windows Installer is idle,
and each step is marked done only when its product is in place, never on an exit code alone:

1. **SSH, key login only.** `PasswordAuthentication no` goes at the top of `sshd_config` (sshd keeps
   the first value it reads, ahead of the `Match` block the default configuration ends with), checked
   with `sshd -t` by the `sshd.exe` the service actually runs, and rolled back if it fails.
2. **The desktop user** (below).
3. **The NVIDIA RTX Virtual Workstation driver**, by Google's documented method: the driver from
   Google's bucket, the build Google's own Windows installer script picks for a virtual-workstation
   machine (NVIDIA's 582.53, vGPU 19, the long-term branch Google recommends through July 2028),
   checked against the SHA-256 that script pins and against its Authenticode signature (signer
   `NVIDIA Corporation`, exactly), and run with NVIDIA's switches `-s -n` (silent, no restart). The
   script fails on any exit code but 0 ("Success") and 1 ("Success, but reboot required"), and on a
   missing or failing `nvidia-smi`. Google's script itself is not run: it ends every failure (no GPU,
   a checksum mismatch, a failed download, an installer error) with a bare `Exit`, so its exit code
   says nothing.
4. **Chrome** (stable), from Google's enterprise installer: not pinnable (that address serves only
   the current release), so its signature is checked (`Google LLC`) and its version logged.
5. **Node 22.23.3** and **Git 2.55.0 for Windows** (with Git LFS; `git lfs install --system`),
   pinned and checked by SHA-256.
6. **Holding it still** (below).
7. **Closing the metadata server to the desktop user** (above).

It then restarts the machine once. On that boot it checks, with things that can fail: that
`nvidia-smi -q` names exactly `NVIDIA RTX Virtual Workstation`, `Licensed`, as the driver's
licensed product (polling for up to five minutes, since the licence is fetched over the network;
on a GPU without the licence it only logs it); that the desktop user is logged on at the console
(`qwinsta`); and that the metadata-server block is in place. It logs the display adapters and what
listens on all addresses. Only then does it write `C:\ProgramData\test-rig\verified`. A failure is
logged as `FAILED: <reason>` and retried at the next boot, and the probe refuses to run until
`verified` exists, printing that line.

The log is `C:\ProgramData\test-rig\setup.log`. The repository is not cloned at boot.

### Boot disk size

50 GB is the smallest the Windows Server 2025 image allows (the image is 50 GB), and it fits with
room to spare. Measured on the development checkout: `client/assets` 61 MB, the Git LFS store
62 MB, `node_modules` about 250 MB. Estimated from the installers' sizes and typical installed
footprints: Windows Server 2025 with its page file and a few months of updates 20–30 GB, the NVIDIA
driver about 2 GB installed (a 0.74 GB installer), Chrome with test profiles about 1 GB, Git 0.4 GB,
Node 0.1 GB. Total 25–35 GB.

## The desktop user and its password

A browser needs a user's desktop, not the sign-in screen. The machine therefore logs one local,
non-administrator account (`desktop_user`, default `hiker`) on automatically at every boot, as
Microsoft documents for Windows automatic logon (`AutoAdminLogon` and `DefaultUserName` under
`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`). Its session is the machine's console,
whether or not anyone is connected, and that is where the probe runs Chrome.

The password is made on the machine at its first boot: 24 characters from 57 letters and digits,
from the system's cryptographic random number generator, with at least one capital, one small letter
and one digit, and never containing the account's name (Windows' complexity rule). It ends up in
exactly two places:

1. **The LSA secret `DefaultPassword`**, which automatic logon reads, and which only the local
   system account can read. Not the registry's `DefaultPassword` value, which Microsoft warns is
   plain text that authenticated users can read remotely; this is how Sysinternals Autologon
   stores it.
2. **`C:\ProgramData\test-rig\desktop-password`**, which only SYSTEM and Administrators may read,
   for signing in as that user by hand. `terraform output -raw desktop_password_command` prints it
   over SSH. An administrator can read the LSA secret anyway, so the file adds no reader.

It is never in Terraform state, in the instance metadata, on a command line, in the script's log,
in Google Cloud outside the machine's own disk, or in this repository. A new `desktop_user` (or the
image step below) makes a new password and replaces both.

## It stops itself

A running machine costs $1.0972 an hour; one forgotten for a month about $806. Two guards, both
Compute Engine's, outside Windows, so nothing inside the machine can fail in a way that keeps it
running:

1. **The run limit:** `max_run_hours` (default 4) after each start, Compute Engine stops the machine
   (`max_run_duration` with `instance_termination_action = "STOP"`, which keeps the disk). Google:
   the termination time is "recalculated by adding that duration to the VM's latest start time",
   and it "doesn't change when you reset or reboot the VM", so the set-up's restart does not
   extend it; it may stop up to 30 seconds late. Whole minutes from 1 to 24 hours: at least an hour,
   because the limit also runs during a new machine's first boot. A change replaces the machine
   (see above). To give a long run more time, stop and start it: the clock starts again.
2. **From outside, once a day:** a Compute Engine instance schedule stops the machine at 09:00 UTC
   (`backstop_stop_schedule`; `null` in `terraform.tfvars` turns it off), up to 15 minutes late, as
   Google documents. It catches a machine whose run limit is gone (removed by hand, say). It runs at
   that hour whatever the machine is doing, so it also stops a machine started just before it
   (step 5 before the first apply). Stopping a stopped machine does nothing.

Host maintenance stops the machine too (a GPU machine cannot be moved), and `automatic_restart =
false` keeps Google from starting it again; the run in progress is run again.

## Holding the machine still, and security updates

A measurement compares builds on one machine, so nothing may change or interrupt it between runs.
The set-up switches off Chrome's updater (its scheduled tasks and services: Google's updater ignores
its policies on a machine outside a domain) and automatic Windows updates (policy `NoAutoUpdate`),
keeps the display and the machine from sleeping, turns the screen saver off by policy for the
desktop user, and disables the idle lock.

**That stops security updates too, for the machine's whole life and in any image made from it.**
The machine runs the Windows and Chrome it was set up with until they are patched by hand or the
machine is replaced. The exposure is small (only IAP reaches it; the browser loads this project's
own pages), but the cadence is: **patch at least monthly, after Microsoft's monthly security
release, and whenever Chrome ships a security fix**, between measurement series, and take a new
baseline after each. The simplest patch is a new machine:
`terraform apply -replace=google_compute_instance.test_rig` (with `running = true`) takes the
newest Windows Server 2025 image and the current Chrome, at the cost of a new first-boot set-up.
In place: sign in as `rdp-admin` and run Windows Update from Settings, and run Chrome's enterprise
installer again (the address `startup.ps1` uses).

## The first run's probe

The question to settle before anything is built on this machine: does Chrome, on the desktop
user's console session with nobody connected, get the NVIDIA GPU? Programs started from an SSH shell
run in the non-interactive services session, where Chrome could fall back to software, and neither
Google nor Chromium documents a GPU-accelerated browser on Windows with nobody at the screen.
Chromium documents GPU-accelerated headless Chrome only on Linux, so the probe draws in a real
window, in the console session. `probe.mjs` settles it for a few cents.

From an SSH shell on the machine (`powershell` first):

```powershell
cd $env:USERPROFILE
$env:GIT_LFS_SKIP_SMUDGE = '1'   # the probe needs no LFS objects
git clone --depth 1 https://github.com/csarkosh/game-dayhike.git
node game-dayhike\_infra\test-rig-gcp\probe.mjs
```

(Or copy it over: `gcloud compute scp _infra/test-rig-gcp/probe.mjs test-rig:probe.mjs
--zone=us-west1-b --project=fps-csarko --tunnel-through-iap`.)

It refuses to start until the set-up is verified (`C:\ProgramData\test-rig\verified`), printing the
set-up log's last `FAILED:` line; while any Remote Desktop session is active (`qwinsta`; it prints
the list); while the desktop user is not logged on at the console; and while any Chrome is running.
It starts itself again inside the desktop user's console session through a scheduled task with the
interactive logon type (Microsoft: such a task "will be run only in an existing interactive
session"), where it launches Chrome with a fresh profile and finds Chrome's DevTools endpoint
through the `DevToolsActivePort` file Chrome writes into that profile, so it can never attach to
another Chrome. From the shell, meanwhile, it reads `nvidia-smi`'s process list, which only an
administrator sees whole, and `qwinsta` every 30 seconds. It prints one JSON report, any `WARNING:`
lines, and then `PASS` or `FAIL: <reasons>`, and exits 0 only on a pass.

Three questions, in order:

1. **Does Chrome get the real GPU?** A **pass** needs all of:
   - the WebGL renderer names NVIDIA and this machine's GPU, such as
     `ANGLE (NVIDIA, NVIDIA L4 ... Direct3D11 ...)`, not SwiftShader or the Microsoft Basic Render
     Driver;
   - `nvidia-smi` listed `chrome.exe` while Chrome was drawing: an independent sign the GPU is
     really in use;
   - the driver's licensed product is exactly `NVIDIA RTX Virtual Workstation` with licence status
     `Licensed`. `NVIDIA Virtual Applications` with `Licensed (Expiry: N/A)`, the state Google
     documents for a GPU attached without the licence, is a **fail**: Google says it gives no
     acceleration. (A control run on `nvidia-l4` therefore fails on this line by design, and the
     report shows what else it got.);
   - Chrome's own GPU feature status (`chrome://gpu`) says hardware for what the game draws with:
     `webgl`, `gpu_compositing` and `rasterization` each `enabled...`;
   - the WebGPU adapter, if there is one, is not a fallback adapter. The game does not use WebGPU,
     so no adapter, or a vendor other than `nvidia`, is a `WARNING`, not a fail;
   - Chrome ran in the `Console` session, not session 0 and not a Remote Desktop session;
   - no Remote Desktop session was active, before, during or after;
   - the desktop session cannot reach the metadata server, from Node (a connection) or from Chrome's
     own network process (a top-level navigation to `http://169.254.169.254/computeMetadata/v1/`,
     which no page policy stops, so only the host firewall can). Any answer, even an error page, is
     a fail; the report's `browserMetadata` says what Chrome got.

   The report also carries the `chrome.exe` lines of `nvidia-smi` and Chrome's version, which every
   result should record: Chrome is not pinned.

2. **What display, and is the frame capped?** A machine with no monitor presents whatever its driver
   provides. The report gives the display adapters with their resolution and refresh rate
   (`Win32_VideoController`; more than one is a `WARNING`), the screen size Chrome sees, and
   `refreshHz`, the rate `requestAnimationFrame` runs at on a blank page, with `cappedAt60OrLower`.
   A cap at 60 Hz or lower would hide frame times under 16.7 ms; if so, compare a run with
   `--disable-gpu-vsync --disable-frame-rate-limit` (flags are passed through to Chrome).

3. **How steady is it?** The same heavy page three times, each in a fresh Chrome, then one run of 25
   minutes:

   ```powershell
   node game-dayhike\_infra\test-rig-gcp\probe.mjs --url=<page> --seconds=120 --runs=3
   node game-dayhike\_infra\test-rig-gcp\probe.mjs --url=<page> --seconds=1500
   ```

   Use the page the Mac's measurements use. Each run must load (no navigation error, the document
   complete at the address asked for, frames drawn) or the probe fails. `spread` (the runs' slowest
   median frame interval minus the fastest, over their median) and `drift` (each run's last minute
   over its first) answer the question, and `nvidia.gpu` samples the GPU's utilisation, clock,
   temperature and power every minute to show whether anything throttles. The 25 minutes also cover
   NVIDIA's limits on an unlicensed driver, which begin after about 20.

If the renderer or `nvidia-smi` fails with the licence in order, try a Chrome flag first
(`--use-angle=d3d11`, `--ignore-gpu-blocklist`), then `-var enable_display=true` (Google's virtual
display beside the GPU; the machine is stopped and started for it). If the licence fails, check the
GPU type (step 8 of the first run).

## An image, so later machines start ready

Once the machine is set up and verified, an image of its disk lets a later machine skip the
40-minute set-up. With the machine stopped:

```powershell
# First, from an SSH shell: make the next machine set a new desktop password and check everything
# again.
Remove-Item C:\ProgramData\test-rig\done-user-hiker, C:\ProgramData\test-rig\verified
```

```bash
terraform apply -var running=false
gcloud compute images create test-rig-YYYYMMDD --project=fps-csarko \
  --source-disk=test-rig --source-disk-zone=us-west1-b --family=test-rig \
  --labels=purpose=test-rig
```

then `baked_image = "projects/fps-csarko/global/images/family/test-rig"` in `terraform.tfvars` and
`terraform apply -replace=google_compute_instance.test_rig` with `running = true`. The image keeps
the other set-up markers, so the start-up script only makes the new password, restarts, checks the
machine and writes `verified`. An image made this way is not generalised (no Sysprep), which is fine
for a machine that only ever runs one at a time; whether the workstation licence and automatic logon
carry over to a machine made from it is something only that machine shows (steps 8 and 10 again).
It costs $0.05/GB-month for what it stores; with one, the machine could be destroyed between runs
instead of stopped, trading the disk's $5.00 a month for that. An image is not managed by
Terraform: `terraform destroy` leaves it (see [After a destroy](#after-a-terraform-destroy)).

## Budget alert

With `billing_account_id` set in `terraform.tfvars`, `apply` also creates a monthly budget of
`monthly_budget_usd` (default $45) over everything labelled `purpose = test-rig`, emailing the
billing account's administrators at 80 % ($36) and 100 % of actual spend and when the month is
forecast to pass 100 %. The numbers are set so that an alert means something is wrong: an ordinary
month of four three-hour runs is $18.26, so the first alert comes at about twice that, which a
machine left running until the daily stop ($26.33) on top of an ordinary month passes, and ordinary
use does not. It needs the Billing Account Administrator or Costs Manager role on that account, and
it enables the Cloud Billing Budget API. It alerts; it stops nothing. NAT is billed without the
label, a few cents a run.

## What is tested

Three sets of checks run without Google Cloud, without Windows and without a machine:

- `terraform test`, from this directory: `tests/plan.tftest.hcl`, against a mocked Google provider
  (nothing is created, no credentials are used);
- `node --test tests/*.test.mjs`, from this directory: `tests/startup.test.mjs`, the start-up
  script's static checks, which need no PowerShell, and `tests/probe.test.mjs`, the probe's
  judgements on sample reports.

None of them runs in the repository's test workflow; run them by hand after a change here.

`terraform test` asserts the machine (the default and every selectable GPU, the zone, the run limit
in seconds, host maintenance, no restart by Google, STOP, no external address, Shielded VM, the disk,
the labels and the build), the daily stop and its attachment, the network (only IAP, only 22 and
3389, only this machine; NAT; Private Google Access), the identity, the metadata (the script with its
values, Google's SSH set-up), the APIs never disabled, the prices, and the budget. It asserts that a
plan that runs the machine never reads it and one that stops it does; which changes are a new build
and which are not; and the refusal of every invalid input (a mismatched pair, a zone outside the
region, another GPU or machine type, no run limit, less than an hour, part minutes, more than a day,
the whole internet, a user name Windows refuses, a computer name Windows truncates). Applied in order
against the mocked provider: created running; stopped and kept; a plan while stopped keeps it; a new
desktop user while stopped is written in place; a new run limit while stopped is refused; with the
machine running it is applied; a stopped machine is started again. Each refusal was shown to fail
its test with its condition removed. What a mocked provider cannot show is in the file's first
lines and in the first run's steps 12 to 14; the refusal of a machine created stopped is the real
read's `not found` (above).

`tests/startup.test.mjs` checks, against the limits Microsoft documents: the description passed to
`New-LocalUser` (48 characters at most) and the desktop user's name (20); the password against
Windows' complexity rule; that the password reaches no command line and no log line; the paths the
script makes (under 260 characters); the task and rule names; that only the script's two values are
templated and nothing else Terraform's `templatefile` would read; that it uses no syntax Windows
PowerShell 5.1 lacks and its brackets balance; the pinned hashes and the driver's source; the licence
rule; the computer name (15 characters); and the script's size. `tests/probe.test.mjs` checks every
pass and fail rule of [the probe](#the-first-runs-probe), including Google's unlicensed
`NVIDIA Virtual Applications ... Licensed` output as a fail, and the reading of `qwinsta`.

What only a machine shows is in [the first run](#the-first-run-step-by-step).

## Not defined here

The Mac (its measurements are unchanged); the same machine on AWS (`_infra/test-rig/` when it is
there, its own module and state); a way to run the game's measurements on this machine (the
repository is cloned by hand, at the commit measured); an image (above); alarms beyond the budget.
