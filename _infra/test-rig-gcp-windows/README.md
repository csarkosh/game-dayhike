# test-rig-gcp-windows: a rented Windows GPU machine on Google Cloud

A Windows Server machine with its own NVIDIA GPU on Compute Engine, for taking the game's
frame-time measurements in Chrome on a second class of graphics hardware (Direct3D on a
desktop-class GPU) beside the Apple M4 they are taken on today. It is meant to run only on the
days it is used: it is billed by the second while it runs, and while it is stopped it bills its
disk and nothing else. Nothing reaches it from the internet; every way in goes through Google's
Identity-Aware Proxy (IAP), and Compute Engine stops it by itself after a set number of hours.

This is its own Terraform root module with its own state (`gs://fps-csarko-tfstate`, prefix
`test-rig-gcp`). It shares nothing with the root module in `_infra/`: no remote-state lookup, no
shared resource. A `terraform destroy` here cannot reach hosting, DNS or the signaling service.

The resources themselves are in [`_infra/modules/gcp-test-rig-windows/`](../modules/gcp-test-rig-windows/), as
`_infra/`'s own are in `_infra/modules/`. This directory is the root that calls it: the backend,
the two providers (the default one and the budget's `google.billing`), one `module "test_rig"`
call, the variables and outputs passed through, and `moved.tf`. Every command below runs here,
and a resource's address carries the call's name:
`module.test_rig.google_compute_instance.test_rig`. It is not called from `_infra/main.tf`, so
that starting, stopping or replacing the machine never plans against hosting, DNS or the
signaling service.

## What it defines

Resources and data sources are the module's, at `module.test_rig.<address>`.

| Resource | Why |
|---|---|
| `google_compute_instance.test_rig` | `g2-standard-4` with one NVIDIA L4 carrying the RTX Virtual Workstation licence (`nvidia-l4-vws`) in `us-west1-a`, Windows Server 2025, 50 GB `pd-balanced` boot disk deleted with it, Shielded VM, no external address. Stops on host maintenance (GPU machines cannot live-migrate) and is never restarted by Google; stops itself `max_run_hours` after each start. Its label `build` records what it was built from. |
| `data.google_compute_instance.existing` | Read only when `running = false`: the machine as Google reports it, so that creating or replacing a machine stopped is refused (see [Create, stop, start, destroy](#create-stop-start-destroy)). |
| `google_compute_resource_policy.backstop` | A Compute Engine instance schedule that stops the machine once a day at 09:00 UTC if it is still running; see [It stops itself](#it-stops-itself). |
| `google_compute_network`, `_subnetwork` | Its own VPC and a `/24`, not a default network. Private Google Access on. |
| `google_compute_firewall.iap_ingress` | SSH (22) and RDP (3389) from Google's IAP range `35.235.240.0/20`, to this machine only. Nothing else gets in. |
| `google_compute_router`, `_router_nat` | Cloud NAT: outbound access for the installers and the repository, with no public address on the machine. |
| `google_service_account.test_rig` + two IAM bindings | The machine's identity: writes logs and metrics, nothing else. See [Identity](#identity). |
| `google_project_service` × 3 | Compute Engine, IAP and IAM. Never disabled on destroy. |
| `google_billing_budget` (optional) | A monthly alert, created only when `billing_account_id` is set. |
| `../modules/gcp-test-rig-windows/startup.ps1` | The start-up script, in the machine's metadata; see [The first boot](#the-first-boot). |
| `moved.tf` | The resources' earlier addresses, from before they moved into the module; see [The move into the module](#the-move-into-the-module). |
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
`us-west1-c` the two L4s only. The module uses `us-west1-a`, where the machine was made.

### Zones and stock-outs

Offered is not available. On 2026-09-28 `us-west1-b` refused to create the default machine. The
apply printed:

```
Error: Error waiting for instance to create: The zone 'projects/fps-csarko/zones/us-west1-b' does not
have enough resources available to fulfill the request.  '... (state:STOCKOUT, sub-state:STOCKOUT,
resource type:compute)'.

A g2-standard-4 VM instance with 1 nvidia-l4-vws accelerator(s) is currently unavailable in the
us-west1-b zone. Consider trying your request in the us-west1-a zone(s), which currently has capacity
to accommodate your request.
```

A stock-out is of the hour, and it can refuse the **start** of a stopped machine as well as a create:
a stopped machine holds no GPU. What to do depends on which:

- **A create refused** (the first apply, or after a `destroy`): everything else was created, the
  machine was not, and nothing of it is in state or bills. Move it to the zone Google names, **before
  the machine exists**, and apply again: `terraform apply -var zone=us-west1-a` (or `zone = ...` in
  `terraform.tfvars`). A later change of zone would replace the machine and its disk.
- **A start refused** (a stopped machine that exists): the apply fails and the machine stays
  stopped, billing its disk. Try again later in the same zone. Do not change `zone` to get a GPU
  now: that replaces the machine, its disk and its set-up.

The commands below take the machine's zone from Terraform, `$(terraform output -raw zone)`, run from
`_infra/test-rig-gcp-windows` after an apply.

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
- **Stopped all month:** the disk alone, **$5.00**, if Cloud NAT releases its address while no
  machine uses it, as this module expects; if it keeps it, $3.65 more (first run, step 16).
- **Left running** (were nothing to stop it): 730 × $1.0972 + $5.00 = about $806 a month. The run
  limit caps one forgotten start at `max_run_hours` (default 4): 4 × $1.0972 = $4.39. If the limit
  were ever gone, the daily stop caps it at a day: 24 × $1.0972 = at most $26.33.
- Without the licence (`nvidia-l4`, a control run): $0.8972/h, about $2.71 a run.

The first run also pays for the first boot's set-up: 7 min 39 s on the first real boot
(2026-09-28), about $0.15 (see [How long a healthy first boot takes](#how-long-a-healthy-first-boot-takes)).

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
   router `test-rig`, instance schedule `test-rig-backstop-stop`, or instance `test-rig` in the
   zone chosen (`us-west1-a` by default). Each of these should print nothing:

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
| 2 | `terraform apply` | Everything created within a few minutes (the machine about a minute after the rest). | A quota error names the quota: step 2 above. `does not have enough resources available ... STOCKOUT ... Consider trying your request in the <zone> zone(s)`: Google has no such GPU free in the zone now. Twelve resources were created, the machine was not; nothing of it is in state or bills. Apply again with the zone Google names (`-var zone=...`), before the machine exists: see [Zones and stock-outs](#zones-and-stock-outs). |
| 3 | About 2 minutes after the apply, `terraform output -raw ssh_command`, run | A `cmd.exe` prompt on the machine, as a local administrator the guest agent makes for the key gcloud pushes (on the first connection gcloud makes the key pair and waits for it to reach the machine). | `gcloud compute instances get-serial-port-output test-rig --zone=$(terraform output -raw zone) --project=fps-csarko`: look for `GCEInstanceSetup: ... Finished with sysprep specialize phase, restarting...` and then `Instance setup finished. test-rig is ready to use.` |
| 4 | `terraform output -raw setup_log_command`, run | About 2 minutes after the apply (the first run: the apply finished at 02:46, `Set-up starting.` at 02:48:18): each boot's first lines `processed file: C:\ProgramData\test-rig` (icacls) and `C:\ProgramData\test-rig: SYSTEM and Administrators only`; then `Set-up starting.`, `OpenSSH Server: C:\Program Files\OpenSSH\sshd.exe OpenSSH_8.9p1 for Windows, running, key login only` (Google's package's own OpenSSH, which is the `sshd` the service runs, not Windows Server 2025's) and `Step done: ssh`. | The script runs on the first boot after Windows' specialisation, with no restart by hand: Google's own set-up script (`instance_setup.ps1` in `GoogleCloudPlatform/compute-image-windows`, `sysprep/`) finishes specialisation, restarts, and at the end of the next boot enables and runs the `GCEStartup` task, which runs `windows-startup-script-ps1`; the first run showed exactly that. If no log appears within 15 minutes all the same, read the serial port (step 3) for `Instance setup finished`, then restart once from the SSH shell (`shutdown /r /t 0`) and look again. |
| 5 | The log goes on | `Desktop user hiker: logs on automatically; password made here, kept in C:\ProgramData\test-rig\desktop-password`, `processed file: C:\ProgramData\test-rig-display`, `Display: task test-rig-display runs C:\ProgramData\test-rig-display\set-display.ps1 at every logon of hiker, asking for 1920 x 1080`, and `Step done: user-hiker`. | A `New-LocalUser` or policy error: read it; `tests/startup.test.mjs` checks the limits Microsoft documents, and a new one belongs there. |
| 6 | The driver | `Downloading https://storage.googleapis.com/compute-gpu-installation-us/... (at most 30 minutes)`, `Signature of 582.53_grid_...exe: valid, NVIDIA Corporation`, `Running the NVIDIA driver installer (at most 30 minutes)`, `The NVIDIA driver installer exited with 0` (2 min 47 s on the first run; 2 min 18 s on an AWS machine with the same installer and switches), `Step done: driver-installed`, then `nvidia-smi`'s own table lines (`\| NVIDIA-SMI 582.53 ... Driver Version: 582.53 ...`, `\| 0  NVIDIA L4  WDDM \| ...`: WDDM, the mode graphics needs), `nvidia-smi: C:\Windows\System32\nvidia-smi.exe` and `Step done: driver`. That is exit 0 with `nvidia-smi` passing at once, what the first run did. Exit `1` (NVIDIA's "Success, but reboot required") is success too: then `Restart needed: ...`, a restart, and the `nvidia-smi` lines on the next boot; so is exit 0 with `nvidia-smi` not ready yet (`Restart needed: nvidia-smi is not ready after the driver install ...`). Record which of the three happened. | Any other exit code fails the step; its log is in `C:\ProgramData\test-rig\nvidia-install`. `SHA-256 mismatch`: Google's bucket serves a different file; stop. See [When a step fails](#when-a-step-fails). |
| 7 | Chrome, Node, Git, holding still, closing | `Signature of googlechromestandaloneenterprise64.msi: valid, Google LLC`, `The chrome installer exited with 0`, `Step done: chrome`, `Chrome: <version>` (154.0.8037.58 on the first run: record it); `The node installer exited with 0`, `Step done: node`, `Node: 22.23.3`; `The git installer exited with 0`, `Step done: git`; `Disabled scheduled task \GoogleSystem\GoogleUpdater\...` and `Disabled service GoogleUpdater...Service...` lines, `Held still: ...`, `Step done: hold`; `Closed: the metadata server is blocked for hiker`, `Closed: Windows Remote Management's inbound rules disabled (...). Still listening on all addresses ...`, `Step done: closed`; `Set-up finished. Restarting once; the next boot checks it.` | `Timed out:` or `FAILED:`: [When a step fails](#when-a-step-fails). |
| 8 | The boot after the restart | `processed file: ...` and `C:\ProgramData\test-rig: SYSTEM and Administrators only` again; `NVIDIA driver 582.53; licensed product 'NVIDIA RTX Virtual Workstation'; licence 'Licensed (Expiry: Permanent)'` (as printed on the first run; AWS's machine read `Licensed (Expiry: N/A)` on the same product, and both pass); `Sessions: ... console hiker 1 Active ...`; `Display script: C:\ProgramData\test-rig-display\set-display.ps1, SYSTEM and Administrators full, hiker read and run only`; `Display task: <time> was 1280x800 at 60 Hz; ChangeDisplaySettingsEx to 1920x1080 returned 0` (the first run's); `Display: 1920x1080 at 59 Hz on NVIDIA L4, driver 32.0.15.8253` (one adapter, the L4, and no Microsoft Basic Display Adapter: **record** the size, the rate and the adapter); `Closed: metadata server blocked for hiker; no inbound rule for Windows Remote Management. Listening on all addresses ...: ...` (record the ports: the first run, before Windows Remote Management was closed, listed 135, 445, 5985, 5986 and 47001 among them); `Set-up checked: the machine is ready.`, and `C:\ProgramData\test-rig\verified` exists. The first boot took 7 min 39 s from `Set-up starting.` to here. | `WARNING: no display is at 1920 x 1080`: see [The display](#the-display); it does not stop the machine being ready. `FAILED: The driver is not running as a licensed NVIDIA RTX Virtual Workstation`: check the GPU type (`gcloud compute instances describe test-rig --zone=$(terraform output -raw zone) --format='value(guestAccelerators)'`). `FAILED: hiker is not logged on at the console`: automatic logon did not take effect on this image; read `Sessions:` and stop. `FAILED: Windows Remote Management is open on the host: <rules>`: something enabled them again; read them. Any other `FAILED:`: [When a step fails](#when-a-step-fails). |
| 9 | `terraform output -raw desktop_password_command`, run | 24 letters and digits. | Nothing: the user step did not finish (step 5). |
| 10 | The probe (see [The first run's probe](#the-first-runs-probe)), nobody connected over Remote Desktop | `PASS`. The first run's: `ANGLE (NVIDIA, NVIDIA L4 (0x000027B8) Direct3D11 vs_5_0 ps_5_0, D3D11)`, WebGPU `nvidia` / `lovelace`, not a fallback; `webgl`, `gpu_compositing`, `rasterization` `enabled`; session `Console` 1; screen 1920 × 1080; `browserMetadata` `net::ERR_NETWORK_ACCESS_DENIED`; Chrome 154.0.8037.58; **`refreshHz` 58.8**. Chrome's `devices` list also names two `Microsoft Basic Render Driver` entries beside the L4: Windows' software renderer, which Chrome lists and did not draw with (the renderer string is the L4's). Record the renderer string, the `chrome.exe` lines, `featureStatus`, the WebGPU adapter, `refreshHz`, the display adapters and `browserMetadata`. | See the probe's section: a Chrome flag first, then `-var enable_display=true`; a failing licence is step 8's. At 58.8 Hz a frame time under about 17 ms cannot be seen: before any measurement, compare a run with `--disable-gpu-vsync --disable-frame-rate-limit` (question 2 of the probe). |
| 11 | `gcloud compute instances describe test-rig --zone=$(terraform output -raw zone) --project=fps-csarko --format='value(resourceStatus.scheduling.terminationTimestamp,resourcePolicies)'` | A termination time 4 hours after the machine's start (not after its restart: a restart does not move it), and the instance schedule `test-rig-backstop-stop`. | No time: the run limit is not on the machine; stop it by hand (`terraform apply -var running=false`) and read `scheduling` in the same output. |
| 12 | **Stop, then plan**: `terraform apply -var running=false`, then `terraform plan -var running=false`, then `terraform plan` | The apply stops it (`gcloud compute instances list` shows `TERMINATED`). The stopped plan shows **No changes**. The plan for the next start shows exactly **0 to add, 1 to change, 0 to destroy**: `module.test_rig.google_compute_instance.test_rig` updated in place, `desired_status = "TERMINATED" -> "RUNNING"`. | This is the one check of what no test here can show: that nothing Google reports differently about a stopped machine makes Terraform change or replace it. What differs, by Google's documentation: the status (`TERMINATED`, which the provider reads back into `desired_status`, the one change expected) and the termination time (`resourceStatus.scheduling.terminationTimestamp`, cleared while stopped, which the provider does not read). The machine has no external address to lose. Refuse any other plan, above all one that says `module.test_rig.google_compute_instance.test_rig` "must be replaced", until it is understood; the attribute it names goes in `ignore_changes` or is pinned, and a test is added. |
| 13 | Where `gcloud compute ssh` put its key: `gcloud compute instances describe test-rig --zone=$(terraform output -raw zone) --project=fps-csarko --format='value(metadata.items[].key)'` and `gcloud compute project-info describe --project=fps-csarko --format='value(commonInstanceMetadata.items[].key)'` | The machine's keys include `ssh-keys` and `block-project-ssh-keys`; the project's do not include `ssh-keys`. The machine blocks project-wide keys, so gcloud puts its key in the machine's metadata (gcloud checks `block-project-ssh-keys` for this), where the module leaves it alone and where it goes with the machine. | The project holds `ssh-keys`: a key there is accepted by every machine of the project that does not block project keys. The first run's machine was made before the block, and gcloud put the key there. Once no machine needs it: `gcloud compute project-info remove-metadata --keys=ssh-keys --project=fps-csarko` (it removes every project-wide key: read them first with the describe above and `--format='value(commonInstanceMetadata.items)'`). |
| 14 | The first time the run limit fires: `gcloud compute operations list --project=fps-csarko --filter='targetLink~instances/test-rig' --format='table(insertTime,operationType,status)'` | A `compute.instances.deferredStop` operation about 4 hours after the start. | The machine runs past its time: stop it by hand (`terraform apply -var running=false`) and read the instance's `scheduling`. |
| 15 | The daily stop, once: start the machine between 07:00 and 08:00 UTC and, after 09:15 UTC, read the Admin Activity audit log. The machine runs until the stop at 09:00: $2.19 for a 07:00 start (2 hours), $1.10 for an 08:00 start (1 hour). The filter names the machine and Compute Engine's service agent, not a method, so the stop shows under whatever method name Google logs it: `gcloud logging read 'protoPayload.resourceName:"instances/test-rig" AND protoPayload.authenticationInfo.principalEmail:"compute-system"' --project=fps-csarko --freshness=2d --format='table(timestamp,protoPayload.methodName,protoPayload.resourceName,protoPayload.authenticationInfo.principalEmail)'` | A line at 09:00 UTC (up to 15 minutes later) whose method is a stop (record the name as logged, such as `v1.compute.instances.stop`), resource `projects/fps-csarko/zones/<zone>/instances/test-rig`, principal Compute Engine's service agent, `service-<project number>@compute-system.iam.gserviceaccount.com`. No role is granted to it by this module: it holds `compute.instances.stop` through its own role, `roles/compute.serviceAgent`. `gcloud compute instances list` shows `TERMINATED`. | No line and the machine still running: the schedule could not act; stop it by hand. Google's page asks for `roles/compute.instanceAdmin.v1` on the service agent; grant it by hand, then look again the next day: `number=$(gcloud projects describe fps-csarko --format='value(projectNumber)')`, `gcloud projects add-iam-policy-binding fps-csarko --member="serviceAccount:service-${number}@compute-system.iam.gserviceaccount.com" --role=roles/compute.instanceAdmin.v1`. Also read `gcloud compute resource-policies describe test-rig-backstop-stop --region=us-west1 --project=fps-csarko`. |
| 16 | After the first stop, the addresses Cloud NAT holds with the machine stopped: `gcloud compute routers get-status test-rig --region=us-west1 --project=fps-csarko --format='value(result.natStatus[0].autoAllocatedNatIps.len())'` | Nothing or `0`: the NAT has released its address, and a stopped machine bills its disk alone. | `1` (or more): the NAT keeps an address while no machine uses it, $0.005 an hour each, **$3.65 a month** more while stopped. Record it; the cost table's "stopped" line then reads $8.65 a month. |

### When a step fails

What you see: the log's last lines (`terraform output -raw setup_log_command`) are
`FAILED: <reason>` (a `Timed out: <what> did not finish in <n> minutes` is one such reason), then
`Restarting to retry from the first step not yet done (automatic restart 1 of 2)`. The machine
restarts by itself, and the next boot goes on from the first step without a `Step done` line; steps
already done are not repeated. After two failed boots in a row it stops restarting and the last
line reads `... no automatic restart left. Read the FAILED line above ...`: the machine then idles
until its run limit stops it, which costs up to `max_run_hours` × $1.0972 from its start: **$4.39**
at the default 4 hours. Before each automatic restart the script waits up to 15 minutes for Windows
Installer to be idle, so that an installer stopped at its time limit is not cut off in the middle of
an install it goes on with; one still busy then is taken as hung, and the restart goes ahead.

What you do: read the `FAILED:` line and the lines before it. A passing cause (a download that
stalled, a driver not yet loaded) needs nothing more than a restart: `shutdown /r /t 0` from the
SSH shell, which retries from the first step not yet done and allows two automatic restarts again
once a boot succeeds. A cause that recurs (a hash that no longer matches, a value Windows refuses)
needs a change to `startup.ps1` first: stop the machine (`terraform apply -var running=false`) so
that it bills nothing meanwhile, and see [What a change does](#what-a-change-does-to-the-machine)
for how a changed script reaches it.

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
cd _infra/test-rig-gcp-windows
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
  `Error: projects/fps-csarko/zones/<zone>/instances/test-rig not found`;
- **replacing** one: the machine carries the label `build`, a hash of everything whose change makes
  the provider replace it, and a plan whose build differs from the one Google reports is refused
  with a message that says to apply with `running = true`, wait for
  `C:\ProgramData\test-rig\verified`, then stop.

The run limit and the daily stop come from Compute Engine and cannot stop a new machine in its
first boot: the limit is at least an hour (the set-up took 7 min 39 s), and the daily stop
is avoided by the time of day (step 5 above).

Once the machine has stopped itself, the provider reads it back as `TERMINATED` (it takes
`desired_status` from the machine's status), so the next `apply` with `running = true` plans the
one change `TERMINATED` to `RUNNING` and starts it again. `gcloud compute instances stop test-rig --zone=$(terraform output -raw zone)` stops it too, with the
same effect on the next `apply`. Any `apply` with `running = true` starts a stopped machine,
whatever else it was run for; any `apply` with `running = false` leaves it stopped.

### What a change does to the machine

| Change | What happens |
|---|---|
| `running` | The machine is started or stopped. |
| `desktop_user`, `startup.ps1` | The start-up script in the machine's metadata changes in place, running or stopped; nothing restarts, and `plan` shows an in-place update of `metadata`. The next boot runs the new script. On a machine that has finished its set-up (`C:\ProgramData\test-rig\setup-complete` exists), that boot runs only what the script does at every boot: it keeps `C:\ProgramData\test-rig` closed; for a new `desktop_user` it makes that user with its own password and a display task, restarts once and checks the machine again; and it logs the licence. **No set-up step runs again, changed or new**: a new driver, Chrome, Node or Git pin, a new holding-still setting, or a new step changes nothing on that machine. To make a machine take a changed set-up, replace it: `terraform apply -replace=module.test_rig.google_compute_instance.test_rig` with `running = true`, a new machine that runs the whole new script (about 8 minutes). By hand instead, from an SSH shell: `Remove-Item C:\ProgramData\test-rig\setup-complete, C:\ProgramData\test-rig\verified` and the `done-<step>` marker of each changed step, then `shutdown /r /t 0`; every step without its marker runs, and the machine is checked again. |
| `gpu_type` (and with it `machine_type`), `max_run_hours`, `spot`, `boot_disk_size_gb`, `boot_disk_type`, `zone`, `instance_name` | **The machine is replaced**: `plan` shows `module.test_rig.google_compute_instance.test_rig` "must be replaced", and its `build` label changes. The new machine runs the first-boot set-up again (about 8 minutes); the old disk and everything on it go. **Refused while `running = false`**. The provider cannot change the run limit of a machine in place (its schema forces a new machine), although Google's API can on a stopped one. |
| `enable_display` | The provider stops the machine, changes it and starts it again if `running` is true. |
| `backstop_stop_schedule` | The schedule changes or goes, in place. |
| A new monthly Windows image, `image`, `baked_image` | Nothing until `terraform apply -replace=module.test_rig.google_compute_instance.test_rig` (with `running = true`: the refusal cannot see a `-replace`). |

### The machine made on 2026-09-28

The first machine was made (in `us-west1-a`, with a local `terraform.tfvars` holding
`zone = "us-west1-a"`) before three changes to the module: the default zone became `us-west1-a`,
the machine's metadata gained `block-project-ssh-keys = "TRUE"`, and the start-up script gained the
closing of Windows Remote Management. What each does to it:

- **The zone:** nothing. The default is now its zone, so the local `terraform.tfvars` line can go;
  its `build` label is unchanged (the zone in it is the same).
- **The metadata and the script:** both are the machine's metadata, which the provider changes in
  place, stopped or running, with no restart and no replacement. The next plan shows
  `module.test_rig.google_compute_instance.test_rig` **updated in place**: `metadata` gains `block-project-ssh-keys`
  and a new `windows-startup-script-ps1`; with `running = true` also `desired_status`
  `"TERMINATED" -> "RUNNING"`. Plan: 0 to add, 1 to change, 0 to destroy.
- **Windows Remote Management stays open on its host firewall** (not reachable: no external address,
  and the VPC admits only IAP to 22 and 3389): the machine has finished its set-up, and no set-up step
  runs again. It is closed when the machine is replaced, or by re-running that one step by hand,
  from an SSH shell: `Remove-Item C:\ProgramData\test-rig\done-closed,
  C:\ProgramData\test-rig\setup-complete, C:\ProgramData\test-rig\verified`, then
  `shutdown /r /t 0`. The next boot runs the closing step (and only it: every other step has its
  marker), restarts, and the check boot after it fails if a Windows Remote Management rule is still
  enabled; step 8's `Closed:` line then lists the listeners left.
- **Its SSH key** is in the project's metadata (step 13). After the metadata change the machine no
  longer accepts it; the next `gcloud compute ssh` puts a key in the machine's own metadata. Remove
  the project's key as step 13 says.

What the refusals cannot stop:

- **a machine that exists but is still in its first boot.** `terraform apply` creates it, and a
  minute later `terraform apply -var running=false` passes: the machine is there and of this build,
  so the provider stops it in the middle of Windows' specialisation. Nothing reads how far its
  set-up is. So: **create it running, wait for `verified`, then stop.**
- a `-replace`, and the replacement of a machine that Terraform tainted after a failed create: both
  create a new machine, and with `running = false` (say, left in `terraform.tfvars`) stop it at
  once. Run both with `running = true` only;
- a machine whose `build` label was removed or changed by hand (one without it counts as the
  current build);
- a replacement the provider decides for a reason of its own;
- a lost state: the read knows nothing of Terraform's state, so if the state were lost while a
  machine named `test-rig` still existed, it would take that machine for this module's.

### The move into the module

The resources were declared in this directory until they moved into `../modules/gcp-test-rig-windows/`,
after the machine had been applied. `moved.tf` maps each earlier address to its new one
(`google_compute_instance.test_rig` to `module.test_rig.google_compute_instance.test_rig`, and
so on for all 16 resources, a `count` resource's `[0]` included; data sources need none), so the
state follows the code and nothing is destroyed or created. After `terraform init` (which also
installs the module), `terraform plan`, with `running` as the machine was last applied, shows
each resource as moved. The move changes nothing else: any other change in that plan is one the
code already held before the move, and a plan of the commit before the move shows it too. Refuse
a plan that creates, replaces or destroys anything until it is understood; applying the plan
writes the new addresses into the state. Keep `moved.tf`: a state still at the old addresses
needs it.

## Reaching the machine

Nothing reaches the machine from the internet: the VPC admits only Google's IAP range, and only to
SSH and RDP, and the machine has no external address. IAP checks the caller's Google identity
before it forwards anything, so no address of the person connecting appears in any file.
`terraform output` prints each command with the project and zone filled in.

```bash
# A shell (cmd.exe; run `powershell` for PowerShell), as a local administrator that Google's
# guest agent makes for the key gcloud pushes.
gcloud compute ssh test-rig --zone=$(terraform output -raw zone) --project=fps-csarko --tunnel-through-iap

# Remote Desktop: make an administrator for it (the guest agent makes the password and gcloud
# prints it; it is never in Terraform state), then forward the port and connect a Remote Desktop
# client to localhost:13389.
gcloud compute reset-windows-password test-rig --zone=$(terraform output -raw zone) --project=fps-csarko --user=rdp-admin
gcloud compute start-iap-tunnel test-rig 3389 --local-host-port=localhost:13389 \
  --zone=$(terraform output -raw zone) --project=fps-csarko
```

SSH takes keys only, and only keys in the machine's own metadata: `block-project-ssh-keys` makes
the machine ignore keys in the project's metadata, which every machine of the project that does not
block them would accept, and makes `gcloud compute ssh` put its key on the machine instead (it
checks that key). The module leaves the machine's `ssh-keys` alone, and the key goes with the
machine. **Sign in over Remote Desktop as `rdp-admin`, never as the desktop user**:
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
Google's page asks for `roles/compute.instanceAdmin.v1` on that agent and warns that schedules can
stop working without it; step 15 of the first run looks for the stop in the audit log and gives the
grant to make if it is not there.

## The first boot

`startup.ps1` is the machine's `windows-startup-script-ps1` metadata value. Google's guest agent
runs it through Task Scheduler as the local system account at every boot. Google's
`google-compute-engine-ssh` package is installed before it, during first-boot specialisation, and
`enable-windows-ssh` turns SSH on, as Google documents for `gcloud compute ssh` on Windows.

At every boot it first makes `C:\ProgramData\test-rig` writable by the local system account and
Administrators only, with nothing inherited from `ProgramData` (whose Users may create files):
nobody else may swap a download between its hash check and its run as SYSTEM, forge a marker, or
read the desktop password. On the first boot it then installs, each step recording its own marker
there so that a boot that fails part-way is finished by the next. Every call that can hang has a
time limit: downloads 15 minutes (the driver's 30), installers 10 to 30 minutes, adding the OpenSSH
capability 20, starting or stopping a service 5, and every native program (`nvidia-smi`, `icacls`,
`reg`, `powercfg`, `git`, `sshd -t`, `qwinsta`) 5 minutes unless it says otherwise. One that runs
over is stopped with everything it started and logged as `Timed out: <what> did not finish in <n>
minutes` (or seconds); nothing further runs on that boot, and the machine restarts to try again
(see [When a step fails](#when-a-step-fails)). Every MSI waits first until Windows Installer is idle,
and each step is marked done only when its product is in place, never on an exit code alone:

1. **SSH, key login only.** `PasswordAuthentication no` goes at the top of `sshd_config` (sshd keeps
   the first value it reads, ahead of the `Match` block the default configuration ends with), checked
   with `sshd -t` by the `sshd.exe` the service actually runs, and rolled back if it fails.
2. **The desktop user** (below), and its display task ([The display](#the-display)).
3. **The NVIDIA RTX Virtual Workstation driver**, by Google's documented method: the driver from
   Google's bucket, the build Google's own Windows installer script picks for a virtual-workstation
   machine (NVIDIA's 582.53, vGPU 19, the long-term branch Google recommends through July 2028),
   checked against the SHA-256 that script pins and against its Authenticode signature (signer
   `NVIDIA Corporation`, exactly), and run with NVIDIA's switches `-s -n` (silent, no restart). The
   script fails on any exit code but 0 ("Success") and 1 ("Success, but reboot required"). On 1 it
   records `driver-installed` and restarts the machine before anything checks the driver; the next
   boot checks it. On 0 it checks it at once. The check is `nvidia-smi` (looked for in System32,
   NVIDIA's `NVSMI` directory and the driver store, its path logged), run with a limit of two
   minutes; a missing or failing one fails the step, and the restart that follows checks again.
   Google's script itself is not run: it ends every failure (no GPU,
   a checksum mismatch, a failed download, an installer error) with a bare `Exit`, so its exit code
   says nothing.
4. **Chrome** (stable), from Google's enterprise installer: not pinnable (that address serves only
   the current release), so its signature is checked (`Google LLC`) and its version logged.
5. **Node 22.23.3** and **Git 2.55.0 for Windows** (with Git LFS; `git lfs install --system`),
   pinned and checked by SHA-256.
6. **Holding it still** (below).
7. **Closing**: the metadata server to the desktop user (above), and Windows Remote Management on
   the host. Google's own instance set-up configures Windows Remote Management (HTTP 5985, HTTPS 5986)
   at specialisation, and the first machine listened on both. Nothing reaches them (no external
   address; the VPC admits only IAP, to 22 and 3389), and with their inbound firewall rules
   disabled, its own group and any other inbound rule on those ports, one mistaken VPC rule would
   expose them no more. SSH and Remote Desktop, which IAP carries, are left alone, and so is the
   Windows Remote Management service itself. The step logs the rules it disabled and what still
   listens.

It then restarts the machine once. On that boot it checks, with things that can fail: that
`nvidia-smi -q` names exactly `NVIDIA RTX Virtual Workstation`, `Licensed`, as the driver's
licensed product (polling for up to five minutes, since the licence is fetched over the network;
on a GPU without the licence it only logs it); that the desktop user is logged on at the console
(`qwinsta`); that the metadata-server block is in place; and that no inbound rule admits Windows
Remote Management. It logs what the display task did, the
size and refresh rate of every display adapter (with a `WARNING` if none is 1920 × 1080), and what
listens on all addresses. Only then does it write `C:\ProgramData\test-rig\verified`. A failure is
logged as `FAILED: <reason>` and the machine restarts to retry (at most twice in a row; see [When a
step fails](#when-a-step-fails)), and the probe refuses to run until `verified` exists, printing
that line.

### The display

There is no monitor, and nothing here like AWS's DCV, which sets its console's size from its own
setting. The console the desktop user logs on to is drawn on the display the NVIDIA driver presents
with nothing attached (and, with `enable_display = true`, Google's virtual display beside it); Windows
starts it at whatever mode that display offers first. This module's first machine came up at
1280 × 800, 60 Hz, with nobody connected (an AWS machine with the same kind of driver, at 1366 × 768,
60 Hz); after the change below it ran at 1920 × 1080, **59 Hz**, and `requestAnimationFrame` at
58.8 Hz. Windows keeps each display's chosen mode in
the registry per display and user, which nothing documents writing to directly.

So the set-up gives the desktop user a scheduled task, `test-rig-display`, that runs at every logon
of that user, in that user's session, and asks for 1920 × 1080 with Microsoft's documented
`ChangeDisplaySettingsEx`, saved for that user. The task runs a script file,
`C:\ProgramData\test-rig-display\set-display.ps1`, which SYSTEM and Administrators may change and
the desktop user may only read and run; the check after set-up fails if the desktop user (or anyone
else) could change it. It writes what the mode was and what Windows answered
to `C:\Users\hiker\AppData\Local\test-rig-display.txt` (`0`: done; `-2`: the driver offers no such
mode). `Set-DisplayResolution` (Windows Server's `ServerCore` module) is not used: like any such call
it sets the mode of the session it runs in, and the start-up script runs in the services session at
boot, not in the console.

The check after set-up logs that result and each adapter's size and refresh rate, and warns (it
does not fail) if no display is at 1920 × 1080. The probe reports the size Chrome's screen has, the
adapters with their size and refresh rate, and the rate `requestAnimationFrame` runs at, and warns if
the screen is not 1920 × 1080. Step 8 of the first run records the size, the rate and the adapter.
A measurement run (the probe with `--url`) **fails** when Chrome's screen is not 1920 × 1080, naming
both sizes: frame times measured at another size cannot be compared with runs at the size asked for.
The plain probe (no `--url`) only warns, since whether Chrome gets the GPU does not depend on the
size. If the driver refuses the mode, what it offers is a question for `nvidia-smi` and the NVIDIA
documentation, and a change here, before any measurement.

The log is `C:\ProgramData\test-rig\setup.log`. The repository is not cloned at boot.

### How long a healthy first boot takes

Measured on the first real machine, 2026-09-28 (`g2-standard-4`, `nvidia-l4-vws`, `us-west1-a`), from
its log:

| Stage | Took |
|---|---|
| From the end of the apply to `Set-up starting.` (Windows' specialisation, its restart, Google's set-up) | about 2 min |
| SSH, key login only | 3 s |
| The desktop user and its display task | 3 s |
| The driver's download (0.74 GB, Google's bucket) | 59 s |
| The driver's install | 2 min 47 s |
| Chrome (download and install) | 63 s |
| Node | 20 s |
| Git | 39 s |
| Holding still and closing | 9 s |
| The restart, to `Set-up checked: the machine is ready.` | 82 s |
| **From `Set-up starting.` to ready** | **7 min 39 s** |

About $0.15 at $1.0972 an hour (about $0.18 with the two minutes before it). A first boot much
slower than this is worth reading in its log before it is waited out: every step has its own
`Step done:` time.

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
`terraform apply -replace=module.test_rig.google_compute_instance.test_rig` (with `running = true`) takes the
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
git clone --depth 1 --branch worktree-test-rig-gcp https://github.com/csarkosh/game-dayhike.git
node game-dayhike\_infra\test-rig-gcp-windows\probe.mjs
```

`--branch worktree-test-rig-gcp`: the probe is on that branch until it is merged into `main`, the
repository's default branch, which a plain clone takes. Once it is merged, drop `--branch ...`.

(Or copy it over: `gcloud compute scp _infra/test-rig-gcp-windows/probe.mjs test-rig:probe.mjs
--zone=$(terraform output -raw zone) --project=fps-csarko --tunnel-through-iap`.)

It refuses to start until the set-up is verified (`C:\ProgramData\test-rig\verified`), printing the
set-up log's last `FAILED:` line; while any Remote Desktop session is active (`qwinsta`; it prints
the list); while the desktop user is not logged on at the console; and while any Chrome is running.
It starts itself again inside the desktop user's console session through a scheduled task with the
interactive logon type (Microsoft: such a task "will be run only in an existing interactive
session"), where it launches Chrome with a fresh profile and finds Chrome's DevTools endpoint
through the `DevToolsActivePort` file Chrome writes into that profile, so it can never attach to
another Chrome. From the shell, meanwhile, it reads `nvidia-smi`'s process list, which only an
administrator sees whole, and `qwinsta` every 30 seconds. It looks for `nvidia-smi.exe` where the
driver installs it (System32, NVIDIA's `NVSMI` directory, the driver store), then on `PATH`, and
prints the path it uses. It prints one JSON report, any `WARNING:`
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
   A cap at 60 Hz or lower hides frame times under 16.7 ms, and the first machine ran at 59 Hz
   (`refreshHz` 58.8): **before any measurement**, compare a run with
   `--disable-gpu-vsync --disable-frame-rate-limit` (flags are passed through to Chrome) with one
   without, and measure with the flags if the capped run hides the frame times.

3. **How steady is it?** The same heavy page three times, each in a fresh Chrome, then one run of 25
   minutes:

   ```powershell
   node game-dayhike\_infra\test-rig-gcp-windows\probe.mjs --url=<page> --seconds=120 --runs=3
   node game-dayhike\_infra\test-rig-gcp-windows\probe.mjs --url=<page> --seconds=1500
   ```

   Use the page the Mac's measurements use. Each run must load (no navigation error, the document
   complete at the address asked for, frames drawn), and Chrome's screen must be 1920 × 1080, or
   the probe fails. `spread` (the runs' slowest
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
8-minute set-up. With the machine stopped:

```powershell
# First, from an SSH shell: make the next machine set a new desktop password and check everything
# again.
Remove-Item C:\ProgramData\test-rig\done-user-hiker, C:\ProgramData\test-rig\verified
```

```bash
terraform apply -var running=false
gcloud compute images create test-rig-YYYYMMDD --project=fps-csarko \
  --source-disk=test-rig --source-disk-zone=$(terraform output -raw zone) --family=test-rig \
  --labels=purpose=test-rig
```

then `baked_image = "projects/fps-csarko/global/images/family/test-rig"` in `terraform.tfvars` and
`terraform apply -replace=module.test_rig.google_compute_instance.test_rig` with `running = true`. The image keeps
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
  script's static checks, which need no PowerShell, `tests/probe.test.mjs`, the probe's
  judgements on sample reports, and `tests/variables.test.mjs`, the test variables against this
  root.

An assertion of `terraform test` can name a resource, local or output of the configuration its
run tests, never one inside a module that configuration calls. So the runs that read the machine
test `../modules/gcp-test-rig-windows/` directly, with every input pinned to this root's defaults, and the
runs of the variables' validations test this root, whose plan goes through the module. Both
providers are mocked, the budget's `google.billing` included.

`terraform validate` here reports the budget's provider configuration as not present: when it
checks a test run that tests a module, Terraform (1.10 and 1.16 alike) does not give that module
the test file's providers, and a module's aliased provider, unlike its default one, has no empty
configuration to fall back on. `terraform test`, which does give them, passes, and
`terraform validate -no-tests` checks the configuration itself.

None of them runs in the repository's test workflow; run them by hand after a change here.

`terraform test` asserts the machine (the default and every selectable GPU, the zone, the run limit
in seconds, host maintenance, no restart by Google, STOP, no external address, Shielded VM, the disk,
the labels and the build), the daily stop and its attachment, the network (only IAP, only 22 and
3389, only this machine; NAT; Private Google Access), the identity, the metadata (the script with its
values, Google's SSH set-up, the block on project-wide SSH keys), the APIs never disabled, the prices, and the budget. It asserts that a
plan that runs the machine never reads it and one that stops it does; which changes are a new build
and which are not; and the refusal of every invalid input (a mismatched pair, a zone outside the
region, another GPU or machine type, no run limit, less than an hour, part minutes, more than a day,
the whole internet, a user name Windows refuses, a computer name Windows truncates). Applied in order
against the mocked provider: created running; stopped and kept; a plan while stopped keeps it; a new
desktop user while stopped is written in place; a new run limit while stopped is refused; with the
machine running it is applied; a stopped machine is started again. Each refusal was shown to fail
its test with its condition removed. What a mocked provider cannot show is in the file's first
lines and in the first run's steps 12 to 16; the refusal of a machine created stopped is the real
read's `not found` (above).

`tests/startup.test.mjs` checks, against the limits Microsoft documents: the description passed to
`New-LocalUser` (48 characters at most) and the desktop user's name (20); the password against
Windows' complexity rule; that the password reaches no command line and no log line; the paths the
script makes (under 260 characters); the task and rule names; that only the script's two values are
templated and nothing else Terraform's `templatefile` would read; that it uses no syntax Windows
PowerShell 5.1 lacks and its brackets balance; the pinned hashes and the driver's source; the licence
rule; the computer name (15 characters); the script's size; that `msiexec` gets no feature
property (a `REMOVE=` without `ADDLOCAL=` can install nothing of a product on a first install, and
this module passes none: a property added later is added to the check with its reason); that the
driver step restarts when its installer asks and checks `nvidia-smi` only after, and gives an
`nvidia-smi` that is not ready one restart before it fails; that every native program, service start
or stop and `Add-WindowsCapability` has a time limit; the failure restart's structure (the count
written before the restart is asked for, inside its bound of two; the count removed only by a boot
that did not fail; Windows Installer waited for first); that a new desktop user un-verifies the
machine before anything that can fail; the display task's C# against Microsoft's declarations
(`DEVMODEW`'s fields in order with their types, Unicode on the structure and both imports, two
32-character strings, the width and height flags, saved for the user); and its script file, which
the desktop user may read and run but not change, checked after set-up. Each of these was shown to
fail with its defect planted: `REMOVE=` on the `msiexec` line, a count never written or cleared on a
failed boot, a structure without `CharSet`, a field moved, among others.

`tests/variables.test.mjs` checks that `terraform test` pins every variable (so that a
`terraform.tfvars` in this directory, a person's own, cannot change a run: the suite passes with one
present, and failed without the pins against one holding another zone and `running = false`), that
each pin is exactly the variable's default (so the runs still test the defaults), that `main.tf`
passes every variable to the module unchanged, and that the default zone is `us-west1-a`. `tests/startup.test.mjs` also checks the closing of Windows Remote
Management: its firewall group and any inbound rule on 5985 or 5986 disabled, Remote Desktop and SSH
left alone, the check boot failing on an open rule.

`tests/probe.test.mjs` checks every
pass and fail rule of [the probe](#the-first-runs-probe), including Google's unlicensed
`NVIDIA Virtual Applications ... Licensed` output as a fail, the reading of `qwinsta`, the order in
which it looks for `nvidia-smi` (System32, `NVSMI`, the driver store, then `PATH`), and a screen that
is not 1920 × 1080: a failure, naming both sizes, for measurement runs, a warning for the plain probe.

What only a machine shows is in [the first run](#the-first-run-step-by-step).

## Not defined here

The Mac (its measurements are unchanged); the same machine on AWS (`_infra/test-rig-aws-windows/` when it is
there, its own module and state); a way to run the game's measurements on this machine (the
repository is cloned by hand, at the commit measured); an image (above); alarms beyond the budget.
