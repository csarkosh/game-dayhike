# test-rig: a rented Windows GPU machine on AWS

A Windows Server machine with its own NVIDIA GPU on Amazon EC2, for taking the game's
frame-time measurements in Chrome on a second class of graphics hardware (Direct3D on a
desktop-class GPU) beside the Apple M4 they are taken on today. It is meant to run only on the
days it is used: it is billed by the second while it runs, and while it is stopped it bills its
disk and nothing else.

This is its own Terraform root module with its own state (`gs://fps-csarko-tfstate`, prefix
`test-rig-aws`). It shares nothing with the root module in `_infra/`: no remote-state lookup,
no shared resource. `_infra/` manages Route53 records in the same AWS account; nothing here
touches Route53, and a `terraform destroy` here cannot reach hosting, DNS or the signaling
service.

## What it defines

| Resource | Why |
|---|---|
| `aws_instance.test_rig` | `g4dn.xlarge` (one NVIDIA T4) by default, or `g6.xlarge` (one L4). Windows Server 2025 from AWS's public image, 50 GB gp3 boot disk, encrypted and deleted with the machine. IMDSv2 required. Shutting down from inside Windows stops it. |
| `aws_ec2_instance_state.test_rig` | Running or stopped (`running`), without destroying anything; made again after any change to the machine, so the change cannot leave it in the wrong state (see [What a change does](#what-a-change-does-to-the-machine)). |
| `terraform_data.setup_script` | The start-up script's SHA-256: a changed script replaces the machine. |
| `aws_vpc`, `aws_subnet`, `aws_internet_gateway`, `aws_route_table` (+ association) | A network of its own with one public subnet. |
| `aws_security_group.test_rig` | No inbound rule at all (`ingress = []`, so one added outside Terraform is removed); all outbound. |
| `aws_default_security_group.test_rig` | Takes over this VPC's default security group and leaves it with no rules. |
| `aws_iam_role.test_rig` + instance profile + policies | The machine's identity; see [Identity](#identity). |
| `aws_scheduler_schedule.backstop` + its role | Stops the machine once a day at 09:00 UTC if it is still running; see [It stops itself](#it-stops-itself). |
| `aws_budgets_budget.test_rig` (optional) | A monthly alert, created only with `budget_enabled = true`. |
| `setup.ps1` | The start-up script, passed as user data; see [The first boot](#the-first-boot). |
| `probe.mjs` | The first run's probe; see [The first run's probe](#the-first-runs-probe). |
| `tests/plan.tftest.hcl` | `terraform test`, against a mocked AWS provider; creates nothing. See [What is tested](#what-is-tested). |

Every resource that takes tags carries `purpose = "test-rig"` through the provider's default
tags, the machine's disk included.

### The two machine sizes

| | `g4dn.xlarge` (default) | `g6.xlarge` |
|---|---|---|
| CPU, memory | 4 vCPUs, 16 GiB | 4 vCPUs, 16 GiB |
| GPU | NVIDIA T4, Turing, 16 GB | NVIDIA L4, Ada Lovelace, 24 GB |
| Windows, on demand | $0.710/h | $0.9888/h |
| Select with | the defaults | `-var instance_type=g6.xlarge` |

Both are offered in `us-east-1a`, `-b`, `-c`, `-d` and `-f` (as of 2026-09-27); the subnet goes in
the first zone, by name, that offers both, so switching size never moves the machine: the
switch stops it, changes the size and starts it, with the disk and everything on it kept. The
GRID driver below covers both GPUs.

### On demand, not Spot

Spot is not offered. This account's quota for Spot G instances ("All G and VT Spot Instance
Requests") is 0 in both `us-east-1` and `us-west-2`, so a Spot request would fail; and AWS's
Spot Instance Advisor puts the interruption frequency of Windows `g4dn.xlarge` in its highest
band, ">20%", in both regions (`g6.xlarge`: 10–15 % in `us-east-1`, >20 % in `us-west-2`).
An interrupted run is a run to do again. The on-demand quota ("Running On-Demand G and VT
instances") is 768 vCPUs in both regions; one machine uses 4.

## What it costs

AWS's list prices, USD, as of 2026-09-25 (AWS Price List API, services `AmazonEC2` and
`AmazonVPC`; `us-east-1` and `us-west-2` are the same). EC2 bills Windows by the second, with a
one-minute minimum.

| Component | Price | When |
|---|---|---|
| `g4dn.xlarge`, Windows, on demand | $0.710/h | running |
| `g6.xlarge`, Windows, on demand | $0.9888/h | running |
| Public IPv4 address | $0.005/h | running (released when stopped) |
| gp3 disk | $0.08/GB-month, $4.00 a month at 50 GB | running or stopped |
| EBS snapshot (an image, below) | $0.05/GB-month of data stored | while the image is kept |
| Session Manager, Amazon DCV on EC2, a budget that only alerts, EventBridge Scheduler at one call a day | nothing | |

On the default machine, running costs $0.710 + $0.005 = **$0.715 an hour**.

- **One three-hour run:** 3 × $0.715 = **$2.15**.
- **A month of four such runs:** 4 × $2.145 = $8.58, plus the disk's $4.00 = **$12.58**.
- **Stopped all month:** the disk alone, **$4.00**.
- **Left running all month** (730 hours, were nothing to stop it): 730 × $0.715 = $521.95 + $4.00 =
  **about $526**. The machine's own timer caps one forgotten start at `max_run_hours` (default
  4): 4 × $0.715 = $2.86. If the timer never fired, the daily backstop caps it at a day:
  24 × $0.715 = at most $17.16.
- On `g6.xlarge`: $0.9938/h, $2.98 a run, $15.93 a month of four.

The first run also pays for the first boot's set-up, about 40 minutes (an estimate: a 0.75 GB
driver from S3, three installers, a restart), roughly $0.50. Traffic into the machine is free;
what leaves it (DCV's picture through Session Manager, results) counts against the account's
100 GB a month of free data transfer out.

## Before the first run, by hand

None of this is in Terraform. In order:

1. **On the computer you work from:**
   - AWS credentials for the account (the AWS provider's default chain);
   - Google application default credentials for the state bucket
     (`gcloud auth application-default login`);
   - Terraform 1.7 or later;
   - **the Session Manager plugin for the AWS CLI**
     ([Install the Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)).
     Every way into the machine needs it;
   - **a DCV client**, or a browser: DCV's web client is served by the machine at
     `https://localhost:8443` through the port forward, under DCV's own self-signed certificate,
     which the browser asks you to accept once.
2. **`terraform.tfvars`**, only if a default is to change: `cp terraform.tfvars.example
   terraform.tfvars` (git-ignored). No value is required. `budget_email` is needed only with
   `budget_enabled = true`.
3. **For the budget, a day ahead:** activate `purpose` as a cost allocation tag in the Billing
   console (Cost allocation tags) or with `aws ce update-cost-allocation-tags-status`. The key is
   offered there up to 24 hours after a tagged resource exists, and activation takes up to 24
   hours more; until then the budget reads $0.
4. **Names.** The `apply` fails, without touching anything that exists, if the account already
   has any of: IAM role and instance profile `test-rig`, IAM role `test-rig-backstop-stop`, EventBridge
   Scheduler schedule `test-rig-backstop-stop`, budget `test-rig`, or a parameter at
   `/test-rig/desktop-password` that the machine could not overwrite. Check first:

   ```bash
   aws iam get-role --role-name test-rig; aws iam get-role --role-name test-rig-backstop-stop
   aws iam get-instance-profile --instance-profile-name test-rig
   aws scheduler get-schedule --region us-east-1 --name test-rig-backstop-stop
   ```

   Each should answer "cannot be found" (`NoSuchEntity`, `ResourceNotFoundException`).
5. **The NVIDIA terms.** The first boot downloads the GRID driver from AWS's bucket. AWS: "By
   downloading, … you agree to use the downloaded software only to develop AMIs for use with the
   NVIDIA L4, NVIDIA L40S, NVIDIA A10G, NVIDIA Tesla T4, or NVIDIA Tesla M60 hardware", and "Upon
   installation of the software, you are bound by the terms of the NVIDIA GRID Cloud End User
   License Agreement". Applying this module accepts them.
6. **After the first `apply`**, from a Session Manager shell (it opens a few minutes after the
   start, while the set-up runs; `Get-Content -Wait C:\ProgramData\test-rig\setup.log` follows
   it):
   - wait for `C:\ProgramData\test-rig\verified`, and read the log's licence line
     (`licensed product 'NVIDIA RTX Virtual Workstation'; licence 'Licensed ...'`) and stop-timer
     line;
   - check the stop timer once (see [It stops itself](#it-stops-itself));
   - check that CloudTrail did not record the password (see
     [The desktop user and its password](#the-desktop-user-and-its-password));
   - **close every DCV client**, then run the probe (see
     [The first run's probe](#the-first-runs-probe)).
7. **After a `terraform destroy`**, delete what it leaves by design:
   - the password: `aws ssm delete-parameter --region us-east-1 --name /test-rig/desktop-password`;
   - any image made from the machine, and its snapshot (see
     [An image](#an-image-so-later-machines-start-ready));
   - the activation of `purpose` as a cost allocation tag, if it is no longer wanted.

## Create, stop, start, destroy

```bash
cd _infra/test-rig
terraform init

terraform apply                     # create it (it starts, and sets itself up on first boot)
terraform apply -var running=false  # stop it: the disk is kept and billed, nothing else is
terraform apply                     # start it again (running defaults to true)
terraform destroy                   # delete it and everything above, disk included
```

Create it running: stopping a machine in the middle of its first boot interrupts the set-up,
which then finishes at the next start.

Once the machine has stopped itself, Terraform's state still says `running`; the next `apply`
starts it again. `aws ec2 stop-instances --instance-ids <id>` stops it too, with the same
effect on the next `apply`. Any `apply` with `running = true` starts a stopped machine, whatever
else it was run for; any `apply` with `running = false` leaves it stopped, whatever else it
changed. What `destroy` leaves behind is in step 7 above.

### What a change does to the machine

| Change | What happens |
|---|---|
| `running` | The machine is started or stopped. |
| `instance_type` | The provider stops the machine, changes its size and **starts it again**, whatever `running` says; the running/stopped setting is then applied again (it is re-made after any change to the machine), so a machine meant to be stopped ends stopped. The disk is kept. |
| `max_run_hours` | The instance tag `max-run-minutes` changes in place. Nothing is restarted or replaced; the new limit applies from the machine's next start. The running/stopped setting is applied again, as above. |
| The start-up script (`setup.ps1`, or `desktop_user`, `password_parameter`, `display_width`, `display_height`, `region`, which are written into it) | **The machine is replaced**: `plan` shows `aws_instance.test_rig` "must be replaced", triggered by `terraform_data.setup_script`. The new machine runs the first-boot set-up again (about 40 minutes, about $0.50) and gets a new desktop password; the old disk and everything on it go. |
| A new monthly Windows image | Nothing: the machine keeps its image. `terraform apply -replace=aws_instance.test_rig` moves it on purpose. |
| `image_id` | Nothing until `terraform apply -replace=aws_instance.test_rig`. |
| What AWS offers in the machine's zone | Nothing: the zone is fixed once the subnet exists. |

Why a changed script replaces the machine rather than being ignored: the script's set-up steps
run only at first boot, so a new script written into a machine that is already set up would
change nothing a reader could see, while `plan` said nothing either. Replacing it costs a new
set-up, but is what `plan` shows, and the new machine is what the script says. The trigger is the
text of the script, not the bytes of the user data, so a Terraform release that compresses
differently replaces nothing.

## Reaching the machine

Nothing reaches the machine from the internet: its security group has no inbound rule.
Everything goes through Systems Manager Session Manager, which the machine's SSM Agent reaches
outbound; Session Manager checks the caller's AWS credentials. `terraform output` prints each
command with the instance id and region filled in.

```bash
# A PowerShell on the machine, as the local administrator ssm-user.
aws ssm start-session --region us-east-1 --target <instance id>

# The desktop: forward DCV's port, then open https://localhost:8443 (DCV's web client; its
# certificate is DCV's own, self-signed) or point the DCV client at localhost:8443.
aws ssm start-session --region us-east-1 --target <instance id> \
  --document-name AWS-StartPortForwardingSession --parameters portNumber=8443,localPortNumber=8443

# Sign in to DCV as the desktop user (default `hiker`) with this password.
aws ssm get-parameter --region us-east-1 --name /test-rig/desktop-password \
  --with-decryption --query Parameter.Value --output text
```

DCV listens on `127.0.0.1:8443` and `[::1]:8443` only, with QUIC off (Session Manager forwards
TCP). Session Manager is reachable a few minutes after each start, while the set-up is still
running: the user data starts the SSM Agent (EC2Launch v2's `startSsm` task) before it runs the
script, which EC2Launch would otherwise do only afterwards. `Get-Content -Wait
C:\ProgramData\test-rig\setup.log` follows the set-up. DCV answers once the set-up has
installed it and restarted.

Remote Desktop and Windows Remote Management are closed on the machine as well: Remote Desktop
is off, and the host firewall's Remote Desktop and Windows Remote Management rules are disabled,
so a mistaken security-group rule would expose neither. Neither DCV (Windows console sessions,
its own port on loopback) nor Session Manager (the agent's outbound HTTPS) uses them.

## Network: why a public address

The machine needs outbound access: the driver from S3, the installers, the repository, Windows
Update, and Session Manager itself. It has a public IPv4 address for that, in a public subnet,
behind a security group with no inbound rule. The alternatives, priced as above:

| Outbound through | Cost | Billed |
|---|---|---|
| Public IPv4 address on the machine (chosen) | $0.005/h, about $0.015 a three-hour run | only while the machine runs |
| NAT gateway | $0.045/h ($32.85 a month) + $0.045/GB carried | for as long as it exists, running or not |
| Interface endpoints for Session Manager (ssm, ssmmessages, ec2messages) | $0.01/h each, $21.90 a month for three | for as long as they exist; the internet is still needed for everything else |

A NAT gateway or endpoints could be created and destroyed with each run, but each would cost
more per hour than the address and add minutes to every start. What the address gives up is
that the machine is addressable from the internet; with no inbound rule nothing is admitted,
and a rule added by mistake would show in `plan`.

## Identity

The instance role has:

- `AmazonSSMManagedInstanceCore`, AWS's baseline managed policy for Session Manager. It is
  broader in form than one instance: it allows the agent's own `ssm:`, `ssmmessages:` and
  `ec2messages:` calls (registering the instance, fetching documents and associations, carrying
  sessions) on `"*"`, as AWS writes it. None of it reaches Route53, another instance, or anything
  of `_infra/`'s;
- `s3:GetObject` on `ec2-windows-nvidia-drivers/*`, the bucket AWS's documentation names for its
  Windows GRID drivers (and none of the others); the driver is read by key, so no listing;
- `s3:GetObject` on `dcv-license.<region>/*`. AWS's DCV guide requires it on EC2: the DCV server
  "periodically connects to an S3 bucket to determine whether a valid license is available";
- `ssm:PutParameter` on the one parameter that holds the desktop user's password;
- an explicit deny of `ssm:GetParameter`, `GetParameters`, `GetParametersByPath` and
  `GetParameterHistory` on every parameter. `AmazonSSMManagedInstanceCore` allows the first two
  on all of them, and the machine has no reason to read any, its own password included.

Nothing else: nothing on Route53, no other bucket, no other instance. The backstop's role may
call `ec2:StopInstances` on this one instance.

The desktop user cannot use the role at all: a host firewall rule blocks its processes, the
browser among them, from the instance metadata service (`169.254.169.254`), in the form AWS's
"Limit access to IMDS" page gives for Windows. What still needs the metadata service runs as the
local system account and is not blocked: the SSM Agent, EC2Launch, DCV's licence check, the
driver's licensing, and the start-up script (which reads the stop timer's tag and writes the
password). The probe checks the block from inside the desktop session.

## The first boot

`setup.ps1` is the machine's user data: an EC2Launch v2 `startSsm` task, then an `executeScript`
task with `frequency: always` and `runAs: localSystem`, so it runs at every boot as the local
system account, with a Session Manager shell available while it runs. The script is gzipped into
the user data (EC2 caps user data at 16 KB) and unpacked on the machine.

At every boot it first arms the stop timer (below), before anything that can take long, then
makes `C:\ProgramData\test-rig` writable by the local system account and Administrators only,
with nothing inherited from `ProgramData` (whose Users may create files): nobody else may swap a
download between its hash check and its run as SYSTEM, or forge a marker. On the first boot it
then installs, each step recording its own marker there so that a boot that fails part-way is
finished by the next. Every download and every installer has a time limit (downloads 15 minutes,
the driver's 30; installers 10 to 30 minutes); one that runs over is stopped with everything it
started and logged as `Timed out: <what> did not finish in <n> minutes`, and the next boot tries
again:

1. **The desktop user** (below).
2. **The NVIDIA GRID driver**, by AWS's documented method for Windows G instances: the installer
   from the `ec2-windows-nvidia-drivers` bucket, read with the AWS Tools for PowerShell that
   AWS's Windows images carry. It is pinned to the versioned key of the build AWS serves as
   `latest` (GRID 20.2, driver 596.86, built for Windows Server 2022 and 2025), checked against
   its SHA-256 and its Authenticode signature (signer `NVIDIA Corporation`, exactly), and run
   with NVIDIA's documented switches `-s -n` (silent, no restart). NVIDIA's installation guide:
   exit code 0 is "Success", 1 is "Success, but reboot required", any other value is "Failure";
   the script fails on anything but 0 or 1. The licence check on the next boot is the second
   line. See [Which driver](#which-driver).
3. **Amazon DCV server** 2025.0-20103, pinned and checked by SHA-256 and signature (`Amazon Web
   Services, Inc.`), installed unattended with its console session owned by the desktop user,
   no firewall rule, and no Indirect Display Driver (so the only display adapter is the GPU's).
   AWS documents that on Windows a console session "is automatically created and active after
   the server is installed", that DCV is free on EC2, and that the GPU drivers give "DirectX and
   OpenGL hardware acceleration for applications". It is set not to lock the desktop when a
   client disconnects (`os-auto-lock`, on by default on Windows) and to start the console at
   `display_width` × `display_height` (1920 × 1080).
4. **Chrome** (stable), from Google's enterprise installer: not pinnable (that address serves
   only the current release), so its signature is checked (`Google LLC`) and its version logged.
5. **Node 22.23.3** and **Git 2.55.0 for Windows** (with Git LFS; `git lfs install --system`),
   pinned and checked by SHA-256.
6. **Holding it still** (below).
7. **Closing the host**: Remote Desktop off, the Remote Desktop and Windows Remote Management
   firewall rules disabled, the metadata service blocked for the desktop user (above).

It then exits with 3010, which EC2Launch v2 answers by restarting and running the script again.
On that boot it checks, with things that can fail: that `nvidia-smi -q` names a licensed
**Virtual Workstation** as the driver's licensed product (polling for up to five minutes, since
the licence is fetched over the network); that DCV lists a console session owned by the desktop
user; that the desktop user is logged on (an `explorer.exe` of theirs); that Remote Desktop is
off and no Remote Desktop or Windows Remote Management firewall rule is enabled; and that the
metadata-service block is in place. It logs what listens on all addresses. Only then does it
write `C:\ProgramData\test-rig\verified`. A failure is logged as `FAILED: <reason>` and retried
at the next boot, and the probe refuses to run until `verified` exists, printing that line.

The log is `C:\ProgramData\test-rig\setup.log`. The repository is not cloned at boot.

### Which driver

AWS documents two driver families for Windows G instances besides the compute-only Tesla
driver, and says of both that they run in WDDM mode ("In WDDM mode, the card supports both
compute and graphics workloads"), with DirectX among the supported APIs:

- **GRID**: "certified to provide optimal performance for professional visualization
  applications that render content such as 3D models or high-resolution videos"; "NVIDIA Quadro
  Virtual Workstation mode is enabled by default"; up to four 4K displays per GPU.
- **Gaming**: "optimizations for gaming and are updated frequently"; a single 4K display per GPU;
  licensed by a registry value and a certificate file that must match the driver version.

Either gives a browser DirectX acceleration. This module installs **GRID**: its
virtual-workstation mode is on by default with no further step, its licence check is
documented by product name, and its current build names Windows Server 2025 (the gaming
driver's current build names Server 2022 only). AWS also notes that a machine started from a
custom image needs that image made with Sysprep for the GRID driver to work (see the image,
below).

### Boot disk size

AWS's Windows Server 2025 image is 30 GB. Estimated: Windows with its page file and some months
of updates 20–30 GB; the NVIDIA driver 0.75 GB downloaded plus about 2 GB installed and 1.5 GB
unpacked during install; DCV, Chrome with test profiles, Git and Node 2 GB; the repository with
its LFS objects and `node_modules` under 0.5 GB (measured on the development checkout). 50 GB
leaves room; it costs $4.00 a month.

## The desktop user and its password

A browser needs a user's desktop, not the sign-in screen. The machine therefore logs on one
local, non-administrator account (`desktop_user`, default `hiker`) automatically at every boot,
as Microsoft documents for Windows automatic logon (`AutoAdminLogon` and `DefaultUserName` under
`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`). DCV's console session is that
desktop, whether or not anyone is connected.

The password is made on the machine at its first boot: 24 characters from 57 letters and digits,
from the system's cryptographic random number generator. It ends up in exactly two places:

1. **The LSA secret `DefaultPassword`** on the machine, which automatic logon reads, and which
   only the local system account can read. Not the registry's `DefaultPassword` value, which
   Microsoft warns is plain text that "can be remotely read by the Authenticated Users group";
   this is how Sysinternals Autologon stores it.
2. **Parameter Store**, `/test-rig/desktop-password` in the machine's region, a SecureString
   encrypted with the account's AWS managed key `aws/ssm`. The machine may write it and is denied
   reading it. Any principal in this account whose IAM policies allow `ssm:GetParameter` on it
   can read it (AWS: access to the `aws/ssm` key cannot be narrowed further); in an account whose
   only such principal is its own user, that is who.

It is never in Terraform state (the parameter is not a Terraform resource: Terraform would read
its value back into state), in the user data, in the script's log, or in this repository. A
rerun of the user step (after a failure, or after an image, below) makes a new password and
replaces both. The machine's role may overwrite the parameter but not delete it; the desktop
user cannot reach the role (above).

Not yet confirmed: whether CloudTrail's record of the machine's `PutParameter` call leaves the
value out. AWS's pages say SecureString values are kept out of logs, but give no statement for
this call's record. After the first `apply`, look:

```bash
aws cloudtrail lookup-events --region us-east-1 --max-results 1 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=PutParameter \
  --query 'Events[0].CloudTrailEvent' --output text
```

`requestParameters` should hold the name and type and no `value` (or a masked one). If the value
is there, anyone who can read the account's CloudTrail can read it, and the event history cannot
be edited: change the password (remove `C:\ProgramData\test-rig\done-user` from a Session
Manager shell and restart the machine; the next boot makes a new one and restarts once more) and
note here that the value is logged.

## It stops itself

A running machine costs $0.715 an hour; one forgotten for a month about $526. Two guards:

1. **Inside Windows:** a scheduled task, run as the local system account whether or not anyone is
   logged on, runs `shutdown /s /f /t 0` `max_run_hours` (default 4 hours) after every boot, by a
   start-up trigger with that delay. The instance's shutdown behaviour is `stop`, so the machine
   stops and keeps its disk. The start-up trigger restarts its clock at every boot by itself and
   needs no re-arming: it fires even on a boot where the start-up script does not run. The script,
   first thing at every boot, reads the limit from the instance tag `max-run-minutes`; if the task
   is missing or its delay differs from the tag, it registers the task again, with a second,
   one-time trigger for the current boot (a start-up trigger registered during a boot fires only
   from the next), reads it back (the delay, a next run time, the task ready) and logs it, or
   falls back to a pending `shutdown /s /t <seconds>`. The task never starts late: a shutdown
   missed while the machine was off does not fire at a later boot.
2. **From outside, once a day:** an EventBridge Scheduler schedule calls `StopInstances` on the
   machine at 09:00 UTC (`backstop_stop_schedule`; `null` in `terraform.tfvars` turns it off). It
   catches a machine whose Windows never came up far enough to run the task. Stopping a stopped
   machine does nothing.

To give a long run more time, raise `max_run_hours` and restart the machine (the new limit is
read at boot), or restart it (the clock starts again).

What can be tested without a machine is tested (see [What is tested](#what-is-tested)): the
shutdown behaviour, the tag and its value in minutes, that the task has a delayed start-up trigger
and no late start, that it is armed first, the delay's form (`PT4H`, `PT15M`, `PT1H30M`), the
one-time trigger's time, and the refusal of a tag outside 15 to 1440 minutes. What only a machine
shows is that Windows really shuts down on time, by each trigger. Check it once, after the
first-boot set-up, for about $0.40:

1. `terraform apply -var max_run_hours=0.25` changes the tag in place (nothing restarts), then
   `Restart-Computer -Force` from a Session Manager shell. At that boot the script sees 15 minutes
   instead of 4 hours and registers the task with a one-time trigger:
   `aws ec2 describe-instances --instance-ids <id> --query 'Reservations[0].Instances[0].State.Name'`
   should read `stopped` about 15 minutes after the restart.
2. `terraform apply -var max_run_hours=0.25` again starts it. The task is unchanged, so this time
   the start-up trigger stops it: `stopped` again about 15 minutes after the start. The log says
   which trigger it relied on (`Stop timer:` lines).
3. `terraform apply -var running=false` puts the default back, and leaves the machine stopped.

## Holding the machine still, and security updates

A measurement compares builds on one machine, so nothing may change or interrupt it between
runs. The set-up switches off Chrome's updater (its scheduled tasks and services: Google's
updater ignores its policies on a machine outside a domain) and automatic Windows updates (policy
`NoAutoUpdate`), keeps the display and the machine from sleeping, turns the screen saver off by
policy for the desktop user, and disables the idle lock.

Updates cannot usefully be paused for the length of a run instead: this machine runs only while
it is measured, so a pause for every run is automatic updates off. **That stops security updates
too.** The machine and any image of it run the Windows and Chrome they were set up with until
they are patched by hand. The exposure is small (no inbound rule; the browser loads this
project's own pages), but the cadence is: **patch at least monthly, after Microsoft's monthly
security release, and whenever Chrome ships a security fix**, between measurement series, and
take a new baseline after each. Windows, through Systems Manager Run Command:

```bash
aws ssm send-command --region us-east-1 --instance-ids <instance id> \
  --document-name AWS-InstallWindowsUpdates --parameters Action=Install,AllowReboot=True
```

Chrome: run its enterprise installer again (the same command `setup.ps1` uses), or replace the
machine (`terraform apply -replace=aws_instance.test_rig`), which also takes the newest Windows
image.

## The first run's probe

The question to settle before anything is built on this machine: does Chrome, on the desktop
user's console session with nobody connected, get the NVIDIA GPU? Programs started from a
Session Manager shell run in the non-interactive services session, where Chrome could fall back
to software. `probe.mjs` settles it for a few cents.

From a Session Manager shell on the machine:

```powershell
cd $env:USERPROFILE
$env:GIT_LFS_SKIP_SMUDGE = '1'   # the probe needs no LFS objects
git clone --depth 1 https://github.com/csarkosh/game-dayhike.git
node game-dayhike\_infra\test-rig\probe.mjs
```

It refuses to start until the set-up is verified (`C:\ProgramData\test-rig\verified`), printing
the set-up log's last `FAILED:` line, and while any DCV client is connected to the console
session: it reads DCV's own count (`dcv describe-session console --json`, `num-of-connections`)
and prints it with `dcv list-connections console`. **Close every DCV client before running it.**
The question is what Chrome gets with nobody connected; with a client connected, DCV's capture is
in the frame's path and the client may set the display layout. It reads the count every 30 seconds
during the run and again after it, and fails if a client connected at any of those readings.

It starts itself again inside the desktop user's console session through a scheduled task with
the interactive logon type and the highest run level (Microsoft: an interactive-token task "will
be run only in an existing interactive session"), where it launches Chrome with a fresh profile
and finds Chrome's DevTools endpoint through the `DevToolsActivePort` file Chrome writes into
that profile, so it can never attach to another Chrome. It refuses to start while any Chrome is
running. From the shell, meanwhile, it reads `nvidia-smi`'s process list, which only an
administrator sees whole. It prints one JSON report, any `WARNING:` lines, and then `PASS` or
`FAIL: <reasons>`, and exits 0 only on a pass.

Three questions, in order:

1. **Does Chrome get the real GPU?** A **pass** needs all of:
   - the WebGL renderer names NVIDIA and this machine's GPU, such as
     `ANGLE (NVIDIA, NVIDIA Tesla T4 ... Direct3D11 ...)`, not SwiftShader or the Microsoft Basic
     Render Driver;
   - `nvidia-smi` listed `chrome.exe` while Chrome was drawing: an independent sign the GPU is
     really in use;
   - the driver's licensed product is a Virtual Workstation with licence status `Licensed`: the
     mode AWS documents as enabled by default for the GRID driver. `NVIDIA Virtual Applications`
     (GRID's other mode, for Remote Desktop Session Host app hosting) is a fail, whatever its
     status;
   - Chrome's own GPU feature status (`chrome://gpu`) says hardware for what the game draws with:
     `webgl` (Babylon's WebGL engine; Chrome reports WebGL 1 and 2 as one entry),
     `gpu_compositing` and `rasterization` each `enabled...`, not a software or disabled state;
   - the WebGPU adapter, if there is one, is not a fallback adapter. The game does not use WebGPU,
     so no adapter, or a vendor other than `nvidia` (Chrome on Windows serves WebGPU through
     Direct3D 12 on the same GPU), is a `WARNING`, not a fail;
   - Chrome ran in the `Console` session, not session 0;
   - no DCV client was connected, before or after;
   - the desktop session could not open a connection to the instance metadata service.

   The report also carries the `chrome.exe` lines of `nvidia-smi` and Chrome's version, which
   every result should record.

2. **What display, and is the frame capped?** A machine with no monitor presents whatever its
   driver or DCV provides. The report gives the display adapters with their resolution and
   refresh rate (`Win32_VideoController`), DCV's description of the console session with its
   display layout, the screen size Chrome sees, and `refreshHz`, the rate
   `requestAnimationFrame` runs at on a blank page, with `cappedAt60OrLower`. A cap at 60 Hz or
   lower would hide frame times under 16.7 ms; if so, compare a run with Chrome's
   `--disable-gpu-vsync --disable-frame-rate-limit` (flags are passed through:
   `node probe.mjs --url=<page> --disable-gpu-vsync --disable-frame-rate-limit`).

   What AWS documents: DCV sets the console's resolution at start from its
   `console-session-default-layout` parameter (set here from `display_width` and
   `display_height`) and at any time with `dcv set-display-layout`; with the GPU driver the
   resolution is customisable up to 4096 × 2160, DCV limits its web client to 1920 × 1080 by
   default, and a connecting client may change the layout. What AWS does not document: the
   refresh rate of that display, and whether anything caps the frame rate of an application
   drawing on it with nobody connected. That is what `refreshHz` measures.

3. **How steady is it?** The same heavy page three times, each in a fresh Chrome, then one run of
   25 minutes:

   ```powershell
   node game-dayhike\_infra\test-rig\probe.mjs --url=<page> --seconds=120 --runs=3
   node game-dayhike\_infra\test-rig\probe.mjs --url=<page> --seconds=1500
   ```

   Use the page the Mac's measurements use. Each run must load (no navigation error, the
   document complete at the address asked for, frames drawn) or the probe fails. The report
   gives each run's frame-interval percentiles and the median of every minute; `spread` (the
   runs' slowest median frame interval minus the fastest, over their median) and `drift` (each
   run's last minute over its first) answer the question, and `nvidia.gpu` samples the GPU's
   utilisation, clock, temperature and power every minute to show whether anything throttles.
   The 25 minutes also cover NVIDIA's unlicensed-driver limits, which begin after about 20.

If the renderer or `nvidia-smi` fails with the licence in order, the next things to try are a
Chrome flag (`--use-angle=d3d11`, `--ignore-gpu-blocklist`) and then `display_width`/`height`
at a size the driver lists. If the licence fails, AWS's GRID page is the reference; the gaming
driver is the documented alternative. Switching to it means changing the licence rule too, in
both `setup.ps1` and `probe.mjs`: AWS documents the gaming driver's licensed state as
`Product Name : NVIDIA Cloud Gaming` / `License Status : Licensed (Expiry: N/A)`, which the
Virtual Workstation rule fails by design.

## An image, so later machines start ready

Once the machine is set up and verified, an image of it lets a later machine skip the 40-minute
set-up. AWS's GRID page says a Windows machine started from a custom image needs that image
"created with Windows Sysprep to ensure that the GRID driver works". So, from a Session Manager
shell:

```powershell
# Make the next boot set a new desktop password and check everything again.
Remove-Item C:\ProgramData\test-rig\done-user, C:\ProgramData\test-rig\verified
& "$env:ProgramFiles\Amazon\EC2Launch\EC2Launch.exe" sysprep --shutdown
```

then, once it has stopped:

```bash
aws ec2 create-image --region us-east-1 --instance-id <instance id> --name test-rig-YYYYMMDD \
  --tag-specifications 'ResourceType=image,Tags=[{Key=purpose,Value=test-rig}]' \
  'ResourceType=snapshot,Tags=[{Key=purpose,Value=test-rig}]'
```

and set `image_id = "ami-..."` in `terraform.tfvars`, then
`terraform apply -replace=aws_instance.test_rig` (the machine ignores a change of image until it
is replaced). The image keeps its set-up markers, so the start-up script only makes the new
password, checks the machine and arms the timer. A later change to the start-up script still
replaces the machine, from the image: its set-up steps are then skipped, so a change to them
needs a new image.

It costs $0.05/GB-month for the data its snapshot holds: the used part of the disk, perhaps
25–35 GB, so about $1.25–1.75 a month. With an image, the machine could be destroyed between
runs instead of stopped, trading the disk's $4.00 a month for that. A disk made from a snapshot
loads its blocks from S3 as they are first read, so the first run on a new machine reads slowly:
measure after a warm-up run. An image is not managed by Terraform: `terraform destroy` leaves it
billing until `aws ec2 deregister-image` and `aws ec2 delete-snapshot`.

## Budget alert

With `budget_enabled = true` (and `budget_email` set), `apply` also creates a monthly AWS Budgets
budget of `monthly_budget_usd` (default $30) over costs tagged `purpose = test-rig`, emailing
`budget_email` at 80 % ($24) and 100 % ($30) of actual spend and when the month is forecast to
pass 100 %. It alerts; it stops nothing. The numbers are set so that an alert means something is
wrong: an ordinary month of four three-hour runs is $12.58 ($15.93 on `g6.xlarge`), so the first
alert comes at about twice that, which a machine left running for most of a day ($17.16 until
the daily stop) on top of an ordinary month passes, and ordinary use does not. AWS counts a tag only once it is activated as a cost allocation tag, an
account-wide setting made once, by hand, in the Billing console (Cost allocation tags) or with
`aws ce update-cost-allocation-tags-status`; the key appears there up to 24 hours after tagged
resources exist, and activation takes up to 24 hours more; until then the budget reads $0. The
public IPv4 address is billed without the tag, a cent or two a run.

## What is tested

`terraform test` (from this directory) runs `tests/plan.tftest.hcl` against a mocked AWS provider:
nothing is created and no credentials are used. It asserts:

- the machine: `g4dn.xlarge` by default and `g6.xlarge` by variable, the public image, shutdown
  behaviour `stop`, IMDSv2 required, the 50 GB encrypted gp3 disk deleted with it, the public
  address, only its own security group, and the zone (first by name, unmoved by a size switch);
- the network: no inbound rule on the machine's security group, and no rule at all on the
  VPC's default group;
- identity: EC2 alone may take the role; its only managed policy is
  `AmazonSSMManagedInstanceCore`; it may do exactly three things (read the GRID driver bucket,
  read DCV's licence bucket, write the password parameter) and is denied every parameter read;
  the backstop's role is taken only by this account's scheduler and may only stop this machine,
  and the schedule's target is this machine;
- the start-up: the user data starts the SSM Agent before the script, runs it at every boot as
  the local system account, fits in 16 KB; the script arms a stop task with a delayed start-up
  trigger first, and never late; the timer reaches the machine as the tag `max-run-minutes`
  (240, or 90 for 1.5 hours); a changed script is what replaces the machine;
- the sequence of changes, applied in order against the mocked provider with the machine meant
  to be stopped: a new size keeps the machine and applies the stopped setting again; a new timer
  changes the tag, keeps the machine and applies the setting again; a changed script replaces
  the machine, which is left stopped; the same script again keeps it. A mocked provider cannot
  show the AWS provider's own start after a new size, or the setting's stop that follows; it
  shows that Terraform re-applies `stopped` after every change to the machine (the AWS provider's
  source shows the rest: a new size is stop, modify, start; creating the setting stops or starts
  the machine as asked; removing it does nothing);
- the budget: off by default and needing no email then; with it on, the tag filter, $30, alerts
  at 80 % and 100 % actual and 100 % forecast, and a refusal without an email address;
- the backstop off with `null`; and the refusal of another size, another region, no timer, and a
  timer in part minutes.

What only a machine shows is in [Before the first run, by hand](#before-the-first-run-by-hand),
step 6.

## Not defined here

The Mac (its measurements are unchanged); a way to run the game's measurements on this machine
(the repository is cloned by hand, at the commit measured); an image (above); Spot (above);
alarms beyond the budget.
